"""Receipt gate controls; these are not evidence that the iOS SDK ran."""
import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
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
                    "source": "a" * 40, "room": "hps-eval-44444444-4444-4444-8444-444444444444"}
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
                  "candidate_source_sha": expected["source"], "room": expected["room"]}
        return native, events, server, expected

    def test_matching_receipts_are_scoped_and_allowlisted(self):
        for scenario in gate.SCENARIOS:
            native, events, server, expected = self.sample(scenario)
            native["untrusted_extra"] = "must not be published"
            result = gate.validate(native, events, server, **expected)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["physical_audio"], "NOT_RUN")
            self.assertNotIn("untrusted_extra", result)

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
