"""Receipt gate controls; these are not evidence that the iOS SDK ran."""
import copy
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / "scripts/ios-livekit-evaluation.py"
SPEC = importlib.util.spec_from_file_location("ios_livekit_evaluation", PATH)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
RUNNER_SPEC = importlib.util.spec_from_file_location("ios_livekit_verify", PATH.with_name("ios-livekit-verify.py"))
runner = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(runner)


class NativeMediaReceiptControls(unittest.TestCase):
    def test_cold_runtime_enumeration_is_bounded_before_app_or_provider_work(self):
        source = Path(os.environ.get("HPS_RUNNER_CONTROL_SOURCE", PATH.with_name("ios-livekit-verify.py")))
        spec = importlib.util.spec_from_file_location("runtime_readiness_control", source)
        actual = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(actual)
        # Virtual elapsed time exercises the real runner's stage/deadline decisions
        # without making the test wait for a hosted CoreSimulator service.
        cases = ((90, 0, "create", False), (179, 0, "create", False),
                 (181, 0, "runtimes", False), (90, 1045, "runtimes", False),
                 (181, 0, "runtimes", True))
        if os.environ.get("HPS_RUNNER_CONTROL_SOURCE"):
            cases = cases[:2]  # Both slow completions fail under the old 60-second bound.
        for duration, prior_elapsed, expected_failure, diagnostic_failure in cases:
            with self.subTest(duration=duration, prior_elapsed=prior_elapsed,
                              diagnostic_failure=diagnostic_failure), tempfile.TemporaryDirectory() as directory:
                now = [0.0]
                calls = []
                def execute(argv, *, timeout, log):
                    stage = log.stem
                    calls.append((stage, timeout))
                    if stage == "xcode": log.write_text("Xcode 26.3\nBuild version 17C529")
                    elif stage == "sdk":
                        log.write_text("26.3")
                        now[0] = prior_elapsed
                    elif stage == "runtimes":
                        now[0] += min(duration, timeout)
                        if duration > timeout:
                            log.write_text('CoreSimulator connection invalid: Error Domain=NSPOSIXErrorDomain Code=60 "/private/secret/path" token=private-value')
                            return 124
                        log.write_text(json.dumps({"runtimes": [{"isAvailable": True,
                            "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-3", "version": "26.3"}]}))
                    elif stage == "create":
                        # Stop at the first downstream operation; this control does
                        # not manufacture a native build or transport PASS.
                        log.write_text("injected simulator creation refusal")
                        return 9
                    else: self.fail("unexpected app/provider stage: " + stage)
                    return 0
                read_diagnostics = getattr(actual, "runtime_diagnostics")
                with patch.object(actual.sys, "platform", "darwin"), \
                     patch.object(actual.subprocess, "check_output", return_value="a" * 40), \
                     patch.object(actual.signal, "signal"), \
                     patch.dict(actual.os.environ, {"ImageVersion": "unknown-private-value", "ImageOS": "/private/path",
                                                    "RUNNER_ARCH": "token=private-value"}), \
                     patch.object(actual, "runtime_diagnostics", side_effect=OSError("private-read-error")
                                  if diagnostic_failure else read_diagnostics), \
                     patch.object(actual, "runtime_process_counts", create=True,
                                  side_effect=OSError("private-process-error") if diagnostic_failure else None,
                                  return_value={"status": "observed", "CoreSimulatorService": 1,
                                                "simdiskimaged": 2}) as process_snapshot, \
                     patch.object(actual.time, "monotonic", side_effect=lambda: now[0]), \
                     patch.object(actual, "execute", side_effect=execute):
                    self.assertEqual(actual.main(SimpleNamespace(evidence=directory)), 1)
                receipt = json.loads((Path(directory) / "native-livekit-runner.json").read_text())
                self.assertEqual(receipt["status"], "FAIL")
                self.assertEqual(receipt["failure"], expected_failure)
                runtime_calls = [bound for stage, bound in calls if stage == "runtimes"]
                self.assertEqual(len(runtime_calls), 1, "runtime enumeration must not retry")
                self.assertEqual(runtime_calls[0], min(180, 1050 - prior_elapsed))
                if prior_elapsed: self.assertLessEqual(runtime_calls[0], 1050 - prior_elapsed)
                runtime_step = next(step for step in receipt["steps"] if step["stage"] == "runtimes")
                self.assertEqual(runtime_step["seconds"], min(duration, runtime_calls[0]))
                self.assertEqual(runtime_step["timeout_seconds"], runtime_calls[0])
                self.assertEqual(runtime_step["configured_timeout_seconds"], 180)
                self.assertEqual(runtime_step["remaining_seconds"], 1050 - prior_elapsed)
                self.assertEqual(receipt["runner_image"], {"ImageVersion": "unknown", "ImageOS": "unknown",
                                                          "RUNNER_ARCH": "unknown"})
                self.assertNotIn("private", json.dumps(receipt))
                if expected_failure == "runtimes":
                    self.assertEqual(receipt["failure_exit"], 124)
                    self.assertEqual([stage for stage, _ in calls], ["xcode", "sdk", "runtimes"])
                    diagnostics = receipt["runtime_diagnostics"]
                    if diagnostic_failure:
                        self.assertEqual(diagnostics, {"status": "unavailable"})
                        self.assertEqual(receipt["runtime_process_counts"], {"status": "unavailable"})
                    else:
                        self.assertIn("connection_invalid", diagnostics["markers"])
                        self.assertEqual(diagnostics["error_codes"], [{"domain": "NSPOSIXErrorDomain", "code": 60}])
                    if prior_elapsed:
                        process_snapshot.assert_not_called()
                        self.assertEqual(receipt["runtime_process_counts"], {"status": "skipped_budget"})
                    else:
                        process_snapshot.assert_called_once()
                        self.assertEqual(process_snapshot.call_args.args[1], 2)
                else:
                    self.assertEqual([stage for stage, _ in calls], ["xcode", "sdk", "runtimes", "create"])
                    process_snapshot.assert_not_called()
                print(json.dumps({"virtual_runtime_seconds": duration, "prior_elapsed": prior_elapsed,
                                  "runtime_bound": runtime_calls[0], "failure": receipt["failure"]}), flush=True)

    def test_runner_image_metadata_accepts_only_known_formats(self):
        self.assertEqual(runner.image_metadata({"ImageVersion": "20261104.0514.1", "ImageOS": "macos15-arm64",
                                              "RUNNER_ARCH": "ARM64", "PRIVATE_TOKEN": "sentinel"}),
                         {"ImageVersion": "20261104.0514.1", "ImageOS": "macos15-arm64", "RUNNER_ARCH": "ARM64"})
        for environment in ({}, {"ImageVersion": "20261104.0514.1\nsentinel", "ImageOS": "unknown-sentinel",
                                 "RUNNER_ARCH": "ARM64 sentinel", "PRIVATE_TOKEN": "sentinel"}):
            self.assertEqual(set(runner.image_metadata(environment).values()), {"unknown"})

    def test_runtime_process_snapshot_redacts_names_and_reaps_its_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            def spawn(_argv, *, stdout, stderr):
                stdout.write(b"/private/sentinel/com.apple.CoreSimulator.CoreSimulatorService\n"
                             b"/private/sentinel/simdiskimaged\n/secret/token-process\n"
                             b"CoreSimulatorService-not-a-match\n")
                stdout.flush()
                return SimpleNamespace(wait=lambda timeout: 0, poll=lambda: 0)
            with patch.object(runner.subprocess, "Popen", side_effect=spawn) as child:
                result = runner.runtime_process_counts(Path(directory), 2)
            self.assertEqual(result, {"status": "observed", "CoreSimulatorService": 1, "simdiskimaged": 1})
            self.assertEqual(child.call_args.args[0], ["/bin/ps", "-A", "-o", "comm="])
            self.assertNotIn("sentinel", json.dumps(result))
            with patch.object(runner.subprocess, "Popen") as child:
                child.return_value.wait.side_effect = [subprocess.TimeoutExpired("ps", 2), 0]
                child.return_value.poll.return_value = None
                with self.assertRaises(subprocess.TimeoutExpired):
                    runner.runtime_process_counts(Path(directory), 2)
                child.return_value.kill.assert_called_once_with()
                self.assertEqual([call.kwargs["timeout"] for call in child.return_value.wait.call_args_list], [2, 1])

    def test_runner_repeated_signal_preserves_its_owned_cleanup_window(self):
        source = Path(os.environ.get("HPS_RUNNER_CONTROL_SOURCE", PATH.with_name("ios-livekit-verify.py")))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "held.py"
            child.write_text('''import os,signal,time,sys
from pathlib import Path
r=Path(sys.argv[1])
def stop(*args):
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 (r/'cleaning').write_text('owned cleanup started')
 while not (r/'release').exists():time.sleep(.01)
 raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
(r/'pid').write_text(str(os.getpid()))
while True:time.sleep(.01)
''')
            driver = root / "driver.py"
            driver.write_text('''import importlib.util,sys
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('actual_runner',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
r=Path(sys.argv[2]);m.sys.platform='darwin'
m.subprocess.check_output=lambda *args,**kwargs:'a'*40
actual=m.execute
def first_stage(argv,**kwargs):
 return actual([sys.executable,str(r/'held.py'),str(r)],**kwargs)
m.execute=first_stage
raise SystemExit(m.main(SimpleNamespace(evidence=str(r/'evidence'))))
''')
            process = subprocess.Popen([sys.executable, str(driver), str(source), str(root)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            child_pid = None
            try:
                deadline = time.monotonic() + 5
                while not (root / "pid").exists():
                    self.assertIsNone(process.poll()); self.assertLess(time.monotonic(), deadline); time.sleep(.01)
                child_pid = int((root / "pid").read_text())
                os.kill(process.pid, signal.SIGINT)
                while not (root / "cleaning").exists():
                    self.assertIsNone(process.poll()); self.assertLess(time.monotonic(), deadline); time.sleep(.01)
                os.kill(process.pid, signal.SIGTERM)
                time.sleep(.05)
                print(json.dumps({"runner_alive_during_child_cleanup": process.poll() is None}), flush=True)
                self.assertIsNone(process.poll(), "second signal cut short the owned cleanup window")
                (root / "release").write_text("finish cleanup")
                process.communicate(timeout=5)
                with self.assertRaises(ProcessLookupError): os.kill(child_pid, 0)
                receipt = json.loads((root / "evidence/native-livekit-runner.json").read_text())
                self.assertEqual(process.returncode, 1)
                self.assertEqual(receipt["status"], "FAIL")
                self.assertEqual(receipt["failure"], "InterruptedError")
            finally:
                (root / "release").write_text("finish cleanup")
                if child_pid is not None:
                    with contextlib.suppress(ProcessLookupError): os.killpg(child_pid, signal.SIGKILL)
                if process.poll() is None: os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)

    def test_standalone_runner_reaps_its_timed_out_process(self):
        with tempfile.TemporaryDirectory() as directory:
            code = runner.execute([sys.executable, "-c", "import time; time.sleep(60)"],
                                  timeout=.05, log=Path(directory) / "owned.log")
            self.assertEqual(code, 124)

    def test_simulator_delete_is_attempted_after_shutdown_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(runner, "execute", side_effect=[OSError("injected shutdown"), 0]) as execute:
                result = runner.cleanup("owned-simulator", Path(directory))
            self.assertEqual(result, [{"action": "shutdown", "exit": 125}, {"action": "delete", "exit": 0}])
            self.assertEqual(execute.call_args_list[1].args[0], ["xcrun", "simctl", "delete", "owned-simulator"])

    def sample(self, scenario="energy_interrupt"):
        identity = {"sessionID": "11111111-1111-4111-8111-111111111111",
                    "turnID": "22222222-2222-4222-8222-222222222222", "generation": 1}
        before = dict(identity, phase="playing", busy=True, captureOpen=True, outputOpen=True,
                      roomAttached=True, manualRendering=True, decodedBuffers=12, decodedSamples=5760,
                      events=["admitted", "microphone_track_published", "start_sent",
                              "started_received", "remote_track_subscribed"])
        fenced = dict(before, phase="interrupted" if scenario == "energy_interrupt" else "stopped",
                      captureOpen=False, outputOpen=False)
        final = dict(fenced, phase="stopped", busy=False, roomAttached=False, manualRendering=False,
                     events=before["events"] + ["audio_fenced", "renderer_detached", "cleanup_complete"])
        expected = {"run_id": "33333333-3333-4333-8333-333333333333", "scenario": scenario,
                    "source": "a" * 40, "room": "hps-eval-44444444-4444-4444-8444-444444444444",
                    "server_sha": "c" * 64}
        native = {"schema": "hps-native-livekit-evaluation/1", "status": "PASS", "runID": expected["run_id"],
                  "scenario": scenario, "candidateSourceSHA": expected["source"], "room": expected["room"],
                  "beforeFence": before, "afterFence": fenced, "afterDrain": copy.deepcopy(final), "final": final,
                  "physicalMicrophone": "NOT_RUN", "physicalPlayout": "UNKNOWN",
                  "unobservedTransportTail": "UNKNOWN", "humanSpeechAndAEC": "NOT_RUN",
                  "postCleanupGraceMilliseconds": 700, "stabilityWindowMilliseconds": 700}
        wire = {"session_id": identity["sessionID"], "turn_id": identity["turnID"], "generation": 1}
        events = [dict(wire, observation="sent", event="started"), dict(wire, observation="sent", event="stopped"),
                  {"observation": "client_disconnected"}, {"observation": "cancelled", "generation": 1,
                   "reason": "energy_onset" if scenario == "energy_interrupt" else "client_stop",
                   "queued_after_seconds": 0, "publication_removed": True},
                  {"observation": "energy_onset", "generation": 1}]
        server = {"status": "PASS", "owned_server_reaped": True,
                  "candidate_source_sha": expected["source"], "room": expected["room"],
                  "sdk": "1.2.1", "server": "livekit-server version 1.13.11", "server_sha256": "c" * 64}
        return native, events, server, expected

    def test_matching_receipts_are_scoped_and_allowlisted(self):
        for scenario in gate.SCENARIOS:
            native, events, server, expected = self.sample(scenario)
            native["untrusted_extra"] = "must not be published"
            result = gate.validate(native, events, server, **expected)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["physical_audio"], "NOT_RUN")
            self.assertNotIn("untrusted_extra", result)
            self.assertEqual(result["runtime"]["server_sha256"], "c" * 64)

    def test_host_metadata_is_allowlisted_on_success_and_failure(self):
        for status in ("PASS", "FAIL"):
            raw = {"status": status, "system": "Darwin", "arch": "arm64", "source_commit": "a" * 40,
                   "server_version": "1.13.11", "go_version": "1.26.11", "server_sha256": "b" * 64,
                   "module_hashes": {"go.mod": "c" * 64, "go.sum": "d" * 64, "token": "private"},
                   "steps": [{"stage": "server-build", "exit": 1, "seconds": 2.0, "log": "/private/raw"}],
                   "error_type": "InterruptedError", "seconds": 3.0,
                   "server": "/private/server", "python": "/private/python", "token": "private", "raw_log": "private"}
            safe = gate.host_receipt(raw)
            self.assertEqual(set(safe), {"status", "system", "arch", "source_commit", "server_version", "go_version",
                                        "server_sha256", "module_hashes", "steps", "error_type", "seconds"})
            self.assertEqual(safe["steps"], [{"stage": "server-build", "exit": 1, "seconds": 2.0}])
            self.assertNotIn("private", str(safe))

    def test_runtime_receipt_must_match_prepared_server_and_sdk(self):
        for key, value in (("server_sha256", "d" * 64), ("sdk", "other"), ("server", "other")):
            native, events, server, expected = self.sample()
            server[key] = value
            with self.assertRaises(gate.CheckFailure):
                gate.validate(native, events, server, **expected)

    def test_inflight_tail_is_reported_and_only_post_cleanup_stability_is_required(self):
        native, events, server, expected = self.sample()
        for key in ("afterDrain", "final"):
            native[key]["decodedBuffers"] += 2
            native[key]["decodedSamples"] += 960
        result = gate.validate(native, events, server, **expected)
        self.assertEqual(result["raw_callback_tail_buffers"], 2)

    def test_a_green_receipt_for_another_attempt_or_turn_is_rejected(self):
        for mutation in ("run", "source", "turn", "server_room", "double_start"):
            with self.subTest(mutation=mutation):
                native, events, server, expected = self.sample()
                if mutation == "run": native["runID"] = "other"
                if mutation == "source": native["candidateSourceSHA"] = "b" * 40
                if mutation == "turn": events[0]["turn_id"] = "other"
                if mutation == "server_room": server["room"] = "other"
                if mutation == "double_start": events.append(copy.deepcopy(events[0]))
                with self.assertRaises(gate.CheckFailure):
                    gate.validate(native, events, server, **expected)

    def test_local_state_cannot_substitute_for_received_pcm_or_server_energy(self):
        for mutation in ("no_pcm", "no_energy", "no_cancel", "no_stop", "no_disconnect"):
            with self.subTest(mutation=mutation):
                native, events, server, expected = self.sample()
                if mutation == "no_pcm": native["beforeFence"]["decodedBuffers"] = 0
                if mutation == "no_energy": events = [e for e in events if e["observation"] != "energy_onset"]
                if mutation == "no_cancel": events = [e for e in events if e["observation"] != "cancelled"]
                if mutation == "no_stop": events = [e for e in events if e.get("event") != "stopped"]
                if mutation == "no_disconnect": events = [e for e in events if e["observation"] != "client_disconnected"]
                with self.assertRaises(gate.CheckFailure):
                    gate.validate(native, events, server, **expected)

    def test_late_receipts_and_incomplete_cleanup_fail_closed(self):
        for mutation in ("late_pcm", "open_output", "busy", "manual_mode", "not_detached", "not_reaped", "worker_error", "physical_claim"):
            with self.subTest(mutation=mutation):
                native, events, server, expected = self.sample()
                if mutation == "late_pcm": native["final"]["decodedBuffers"] += 1
                if mutation == "open_output": native["afterFence"]["outputOpen"] = True
                if mutation == "busy": native["final"]["busy"] = True
                if mutation == "manual_mode": native["final"]["manualRendering"] = True
                if mutation == "not_detached": native["afterDrain"]["events"].remove("renderer_detached")
                if mutation == "not_reaped": server["owned_server_reaped"] = False
                if mutation == "worker_error": events.append({"observation": "worker_failed"})
                if mutation == "physical_claim": native["physicalPlayout"] = "PASS"
                with self.assertRaises(gate.CheckFailure):
                    gate.validate(native, events, server, **expected)


if __name__ == "__main__":
    unittest.main()
