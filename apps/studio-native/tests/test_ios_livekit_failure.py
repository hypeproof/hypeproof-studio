"""Real early-exit process controls for diagnostic preservation, not native acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

SOURCE = Path(os.environ.get("HPS_FAILURE_CONTROL_SOURCE",
    Path(__file__).resolve().parents[1] / "scripts/ios-livekit-evaluation.py"))
SPEC = importlib.util.spec_from_file_location("failure_helper", SOURCE)
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)


class NativeFailureEvidence(unittest.TestCase):
    def test_diagnostic_reader_failure_preserves_primary_error_and_fixed_label(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            failure = helper.CheckFailure("owned_command_failed")
            with patch.object(helper, "command", side_effect=failure), \
                 patch.object(helper, "native_failure_snapshot", side_effect=OSError("PRIVATE_SENTINEL")), \
                 patch.object(helper, "evaluator_failure_snapshot", side_effect=ValueError("PRIVATE_SENTINEL")):
                with self.assertRaises(helper.CheckFailure) as caught:
                    helper.scenario_run(SimpleNamespace(device="owned-device"), {}, root, "energy_interrupt")
            self.assertIs(caught.exception, failure)
            self.assertEqual(str(failure), "owned_command_failed")
            self.assertEqual(failure.scenario_diagnostics["phase"], "terminate_previous_app")
            for key in ("native", "evaluator", "evaluator_after_cleanup"):
                self.assertEqual(failure.scenario_diagnostics[key], {"availability": "unavailable"})
            self.assertNotIn("PRIVATE_SENTINEL", json.dumps(failure.scenario_diagnostics))
            self.assertEqual(str(helper.CheckFailure("PRIVATE_SENTINEL")), "qualification_failed")

    def test_cold_preflight_precedes_fresh_credentials_without_changing_success_gate(self):
        from test_ios_livekit_evaluation import NativeMediaReceiptControls
        native, events, server, expected = NativeMediaReceiptControls().sample()
        now = [1000.0]
        issued = []
        phases = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            container = root / "container"
            caches = container / "Library/Caches"
            class Process:
                def poll(self): return 0
                def wait(self, **kwargs): return 0
            def start(argv, **kwargs):
                phases.append("evaluator_start")
                output = Path(argv[argv.index("--output") + 1])
                output.mkdir()
                issued.append(now[0])
                (output / "connection.private.json").write_text(json.dumps({
                    "candidate_source_sha": expected["source"], "room": expected["room"],
                    "expires_at": int(now[0]) + 75, "token": "PRIVATE_SENTINEL"}))
                (output / "events.json").write_text(json.dumps(events))
                (output / "result.json").write_text(json.dumps(server))
                return Process()
            def command(argv, **kwargs):
                action = argv[2]
                phases.append(action)
                if action == "terminate": now[0] += 30
                if action == "get_app_container":
                    now[0] += 30
                    return subprocess.CompletedProcess(argv, 0, str(container).encode(), b"")
                if action == "launch":
                    now[0] += 10
                    connection = json.loads((caches / "hps-livekit-ci-config.json").read_text())
                    self.assertEqual(connection["expires_at"] - now[0], 65,
                                     "cold preflight consumed fresh credential lifetime")
                    (caches / "hps-livekit-ci-result.json").write_text(json.dumps(native))
                return subprocess.CompletedProcess(argv, 0, b"", b"")
            with patch.object(helper, "command", side_effect=command), \
                 patch.object(helper.subprocess, "Popen", side_effect=start), \
                 patch.object(helper.time, "monotonic", side_effect=lambda: now[0]), \
                 patch.object(helper.time, "time", side_effect=lambda: now[0]), \
                 patch.object(helper.uuid, "uuid4", return_value=uuid.UUID(expected["run_id"])):
                result = helper.scenario_run(SimpleNamespace(source_sha=expected["source"], device="owned-device"),
                    {"python": sys.executable, "server": "owned-server", "server_sha256": expected["server_sha"]},
                    root, "energy_interrupt")
            self.assertEqual(issued, [1060.0])
            self.assertEqual(phases[:3], ["terminate", "get_app_container", "evaluator_start"])
            self.assertEqual(result, helper.validate(native, events, server, **expected))
            self.assertNotIn("PRIVATE_SENTINEL", json.dumps(result))
            print(json.dumps({"preflight_seconds": 60, "issued_after_preflight": True,
                              "seconds_remaining_after_launch": 65, "success_gate_unchanged": True}), flush=True)

    def test_early_exit_preserves_phase_and_partial_evidence_before_cleanup(self):
        modes = ("config",) if os.environ.get("HPS_FAILURE_CONTROL_SOURCE") else ("config", "native", "partial")
        for mode in modes:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                app = root / "app"
                app.mkdir()
                (app / "HPStudio").write_bytes(b"synthetic identity; no native execution")
                container = root / "container"
                caches = container / "Library/Caches"
                caches.mkdir(parents=True)
                worker = root / "early-exit.py"
                worker.write_text('''import json,pathlib,sys,time
output,root,mode=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2]),sys.argv[3]
output.mkdir()
if mode!='config':
 (output/'connection.private.json').write_text(json.dumps({'candidate_source_sha':'a'*40,
  'room':'hps-eval-11111111-1111-4111-8111-111111111111','expires_at':int(time.time())+75,
  'url':'ws://127.0.0.1:12345','token':'PRIVATE_SENTINEL'}))
 deadline=time.monotonic()+5
 while not (root/'launched').exists():
  if time.monotonic()>deadline:raise SystemExit(99)
  time.sleep(.01)
if mode=='partial':
 (root/'container/Library/Caches/hps-livekit-ci-result.json').write_text(json.dumps({
  'schema':'hps-native-livekit-evaluation/1','status':'FAIL','failure':'receipt','scenario':'energy_interrupt',
  'token':'PRIVATE_SENTINEL','room':'PRIVATE_SENTINEL','final':{'phase':'stopped','busy':False,
  'generation':1,'decodedBuffers':3,'decodedSamples':2880,'events':['connected','PRIVATE_SENTINEL'],
  'sessionID':'PRIVATE_SENTINEL'}}))
(output/'result.json').write_text(json.dumps({'status':'FAIL','error_type':'AssertionError',
 'error':'timeout: stopped acknowledgement and client disconnect','owned_server_reaped':True,
 'duration_seconds':.1,'token':'PRIVATE_SENTINEL','hostname':'PRIVATE_SENTINEL'}))
(output/'events.json').write_text(json.dumps([{'observation':'manual_room_ready','at_ms':0,
 'room':'PRIVATE_SENTINEL'},{'observation':'rejected','reason':'not_admitted','at_ms':12,
 'token':'PRIVATE_SENTINEL'},{'observation':'PRIVATE_SENTINEL','reason':'PRIVATE_SENTINEL'}]))
raise SystemExit(7)
''')
                actual_popen = subprocess.Popen
                processes, commands, order = [], [], []
                def start(argv, **kwargs):
                    order.append("evaluator_start")
                    output = argv[argv.index("--output") + 1]
                    process = actual_popen([sys.executable, str(worker), output, str(root), mode], **kwargs)
                    processes.append(process)
                    return process
                def command(argv, **kwargs):
                    if "--output" in argv:  # Only host preparation is substituted.
                        output = Path(argv[argv.index("--output") + 1])
                        output.mkdir()
                        (output / "host.json").write_text(json.dumps({"python": sys.executable,
                            "server": "PRIVATE_SENTINEL", "server_sha256": "c" * 64, "status": "PASS"}))
                    else:
                        commands.append(argv[2])
                        order.append(argv[2])
                        if argv[2] == "get_app_container":
                            return subprocess.CompletedProcess(argv, 0, str(container).encode(), b"")
                        if argv[2] == "launch":
                            (root / "launched").write_text("launch observed")
                    return subprocess.CompletedProcess(argv, 0, b"", b"")
                try:
                    with patch.object(helper.sys, "platform", "darwin"), \
                         patch.object(helper.signal, "signal"), \
                         patch.object(helper, "command", side_effect=command), \
                         patch.object(helper.subprocess, "Popen", side_effect=start):
                        self.assertEqual(helper.main(SimpleNamespace(source_sha="a" * 40,
                            device="11111111-1111-4111-8111-111111111111", app=str(app),
                            evidence=str(root / "evidence"))), 1)
                    receipt = json.loads((root / "evidence/native-livekit.json").read_text())
                    self.assertEqual(receipt["status"], "FAIL")
                    self.assertEqual(receipt["scenarios"], [])
                    self.assertIn("scenario_failure", receipt, "early failure discarded existing partial receipts")
                    failure = receipt["scenario_failure"]
                    expected_phase = {"config": "await_config", "native": "await_native_result",
                                      "partial": "await_evaluator_exit"}[mode]
                    self.assertEqual(failure["phase"], expected_phase)
                    self.assertEqual(failure["evaluator_exit"], 7)
                    self.assertEqual(failure["evaluator_exit_after_cleanup"], 7)
                    self.assertEqual(failure["evaluator"]["error_code"], "stop_disconnect_timeout")
                    self.assertTrue(failure["evaluator_after_cleanup"]["owned_server_reaped"])
                    self.assertGreaterEqual(failure["elapsed_seconds"], 0)
                    self.assertTrue(all(p["duration_seconds"] >= 0 for p in failure["phases"]))
                    self.assertEqual(len(processes), 1, "failed evaluator must never be replayed")
                    self.assertEqual(order[:3], ["terminate", "get_app_container", "evaluator_start"])
                    if mode == "config":
                        self.assertEqual(commands, ["terminate", "get_app_container", "terminate"])
                        self.assertEqual(failure["config_lifetime"], {})
                    else:
                        self.assertEqual(commands, ["terminate", "get_app_container", "launch", "terminate"])
                        self.assertTrue(all(0 < seconds <= 75 for seconds in failure["config_lifetime"].values()))
                        self.assertEqual(len(failure["config_lifetime"]), 3)
                    if mode == "partial":
                        self.assertEqual(failure["native"]["final"]["decodedBuffers"], 3)
                        self.assertEqual(failure["native"]["final"]["events"], ["connected"])
                    else:
                        self.assertEqual(failure["native"]["availability"], "missing")
                    self.assertNotIn("PRIVATE_SENTINEL", json.dumps(receipt))
                    self.assertNotIn(str(root), json.dumps(receipt))
                    self.assertFalse((caches / "hps-livekit-ci-config.json").exists())
                    self.assertFalse((caches / "hps-livekit-ci-result.json").exists())
                    print(json.dumps({"mode": mode, "phase": failure["phase"],
                                      "process_exit": failure["evaluator_exit"], "partial_preserved": True}), flush=True)
                finally:
                    for process in processes:
                        if process.poll() is None: process.terminate()
                        process.wait(timeout=5)

    def test_malformed_or_unlisted_partial_fields_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            native = root / "native.json"
            native.write_text('{"token":"PRIVATE_SENTINEL"')
            self.assertEqual(helper.native_failure_snapshot(native), {"availability": "invalid"})
            native.write_text(json.dumps({"schema": "hps-native-livekit-evaluation/1", "status": ["PRIVATE_SENTINEL"],
                "failure": "PRIVATE_SENTINEL", "final": {"phase": ["PRIVATE_SENTINEL"], "busy": 1,
                "decodedSamples": -1, "events": ["PRIVATE_SENTINEL", {"token": "PRIVATE_SENTINEL"}]}}))
            safe = helper.native_failure_snapshot(native)
            self.assertEqual(safe, {"availability": "present", "final": {"events": []}})
            (root / "result.json").write_text(json.dumps({"status": {"token": "PRIVATE_SENTINEL"},
                "error_type": "PRIVATE_SENTINEL", "error": "PRIVATE_SENTINEL", "duration_seconds": 10 ** 400}))
            (root / "events.json").write_text(json.dumps([None, {"observation": {"token": "PRIVATE_SENTINEL"}},
                {"observation": "worker_failed", "error_type": "PRIVATE_SENTINEL", "at_ms": float("nan")}]))
            safe = helper.evaluator_failure_snapshot(root)
            self.assertEqual(safe, {"availability": "present", "events_availability": "present",
                                   "observations": [{"observation": "worker_failed"}]})


if __name__ == "__main__":
    unittest.main()
