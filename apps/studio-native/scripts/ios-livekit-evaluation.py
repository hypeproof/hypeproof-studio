#!/usr/bin/env python3
"""Run the existing Debug iOS app against an owned, pinned loopback evaluator.

No token is placed in argv, environment, UI typing, console or published evidence.
Raw SDK logs and disposable configs stay in a private temporary directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

BUNDLE = "ai.hypeproof.studio.mobile"
SCENARIOS = ("energy_interrupt", "stop")
EVENTS = {"manual_rendering_enabled", "connected", "admitted", "microphone_track_published",
          "start_sent", "started_received", "remote_track_subscribed", "audio_fenced",
          "local_energy_onset", "interrupt_user_speech", "interrupt_sent",
          "interrupted_received", "stop_requested", "renderer_detached", "cleanup_complete"}


class CheckFailure(Exception):
    pass


def require(condition, code):
    if not condition:
        raise CheckFailure(code)


def read_json(path):
    require(path.stat().st_size <= 262144, "receipt_size")
    return json.loads(path.read_text())


def state(value):
    keys = {"sessionID", "turnID", "generation", "phase", "busy", "captureOpen", "outputOpen",
            "roomAttached", "manualRendering", "decodedBuffers", "decodedSamples", "events"}
    require(isinstance(value, dict) and set(value) == keys, "state_schema")
    for name in ("sessionID", "turnID"):
        require(isinstance(value[name], str), "identity")
        uuid.UUID(value[name])
    require(type(value["generation"]) is int and value["generation"] == 1, "generation")
    require(value["phase"] in {"playing", "interrupted", "stopped"}, "phase")
    for name in ("busy", "captureOpen", "outputOpen", "roomAttached", "manualRendering"):
        require(type(value[name]) is bool, "boolean")
    for name in ("decodedBuffers", "decodedSamples"):
        require(type(value[name]) is int and 0 < value[name] <= 48000 * 90, "decoded_count")
    require(isinstance(value["events"], list) and len(value["events"]) <= 64
            and all(isinstance(e, str) and e in EVENTS for e in value["events"]), "event_schema")
    return value


def validate(native, events, server, *, run_id, scenario, source, room):
    """Cross-check actual renderer and server receipts; no independent PASS aggregation."""
    require(native.get("schema") == "hps-native-livekit-evaluation/1"
            and native.get("status") == "PASS", "native_failed")
    require(native.get("runID", "").lower() == run_id.lower()
            and native.get("scenario") == scenario
            and native.get("candidateSourceSHA") == source
            and native.get("room") == room, "candidate_identity")
    for key, expected in {"physicalMicrophone": "NOT_RUN", "physicalPlayout": "UNKNOWN",
                          "unobservedTransportTail": "UNKNOWN", "humanSpeechAndAEC": "NOT_RUN"}.items():
        require(native.get(key) == expected, "claim_scope")
    require(native.get("postCleanupGraceMilliseconds") == 700
            and native.get("stabilityWindowMilliseconds") == 700, "observation_window")
    before, fenced, drained, final = (state(native.get(k)) for k in ("beforeFence", "afterFence", "afterDrain", "final"))
    identity = (before["sessionID"].lower(), before["turnID"].lower(), before["generation"])
    require(all((s["sessionID"].lower(), s["turnID"].lower(), s["generation"]) == identity
                for s in (fenced, drained, final)), "tuple_changed")
    require(before["phase"] == "playing" and before["busy"] and before["roomAttached"]
            and before["captureOpen"] and before["outputOpen"] and before["manualRendering"]
            and before["decodedBuffers"] >= 10, "no_actual_audio")
    require({"admitted", "microphone_track_published", "start_sent", "started_received",
             "remote_track_subscribed"}.issubset(before["events"]), "transport_sequence")
    require(fenced["phase"] == ("interrupted" if scenario == "energy_interrupt" else "stopped")
            and not fenced["captureOpen"] and not fenced["outputOpen"], "missing_fence")
    for stopped in (drained, final):
        require(stopped["phase"] == "stopped" and not any(stopped[k] for k in
                ("busy", "roomAttached", "captureOpen", "outputOpen", "manualRendering"))
                and {"renderer_detached", "cleanup_complete"}.issubset(stopped["events"]), "incomplete_cleanup")
    for metric in ("decodedBuffers", "decodedSamples"):
        require(final[metric] == drained[metric] >= fenced[metric] >= before[metric], "receipt_resurrected")
    require(server.get("status") == "PASS" and server.get("owned_server_reaped") is True
            and server.get("candidate_source_sha") == source and server.get("room") == room, "server_identity_or_cleanup")
    require(not any(e.get("observation") in {"worker_failed", "cleanup_failed"} for e in events), "server_failure")
    sent = [e for e in events if e.get("observation") == "sent"]
    def matching(event):
        return (str(event.get("session_id")).lower(), str(event.get("turn_id")).lower(), event.get("generation")) == identity
    require(sum(e.get("event") == "started" and matching(e) for e in sent) == 1, "server_started_tuple")
    require(any(e.get("event") == "stopped" and matching(e) for e in sent), "server_stop_missing")
    require(any(e.get("observation") == "client_disconnected" for e in events), "disconnect_missing")
    cancelled = [e for e in events if e.get("observation") == "cancelled" and e.get("generation") == identity[2]]
    expected_reason = "energy_onset" if scenario == "energy_interrupt" else "client_stop"
    require(any(e.get("reason") == expected_reason and e.get("publication_removed") is True
                and e.get("queued_after_seconds") == 0 for e in cancelled), "server_cancel_missing")
    if scenario == "energy_interrupt":
        require(any(e.get("observation") == "energy_onset" and e.get("generation") == identity[2] for e in events),
                "actual_published_pcm_missing")
    # Explicitly allowlist output. Raw SDK/server strings and credentials never escape.
    return {"scenario": scenario, "run_id": run_id, "room": room, "source_sha": source,
            "status": "PASS", "before_fence": before, "after_fence": fenced, "after_drain": drained, "final": final,
            "raw_callback_tail_buffers": drained["decodedBuffers"] - fenced["decodedBuffers"],
            "raw_callback_tail_samples": drained["decodedSamples"] - fenced["decodedSamples"],
            "post_cleanup_grace_ms": 700, "stability_window_ms": 700,
            "server_cancel": expected_reason, "server_queue_after_seconds": 0,
            "server_publication_removed": True, "server_stop_received": True,
            "server_disconnected": True, "server_reaped": True,
            "physical_audio": "NOT_RUN", "acoustic_played_range": "UNKNOWN",
            "unobserved_transport_tail": "UNKNOWN"}


def command(argv, *, timeout=30, check=True):
    result = subprocess.run(argv, timeout=timeout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check:
        require(result.returncode == 0, "owned_command_failed")
    return result


def await_file(path, process, seconds, allow_successful_exit=False):
    deadline = time.monotonic() + seconds
    while not path.is_file():
        exit_code = process.poll()
        require(exit_code is None or (allow_successful_exit and exit_code == 0), "evaluator_exited_early")
        require(time.monotonic() < deadline, "receipt_timeout")
        time.sleep(.1)
    return read_json(path)


def reap(process):
    if process is None:
        return
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=3)


def scenario_run(args, host, private, scenario):
    lab = Path(__file__).resolve().parents[1] / "voice-evaluation/lab.py"
    output = private / scenario
    process = None
    config_path = receipt_path = None
    primary = None
    try:
        with (private / (scenario + ".log")).open("xb") as log:
            process = subprocess.Popen([host["python"], str(lab), "--server", host["server"],
                "--output", str(output), "--serve-seconds", "75", "--exit-after-client",
                "--source-sha", args.source_sha], stdout=log, stderr=log, start_new_session=True)
            connection = await_file(output / "connection.private.json", process, 15)
            require(connection.get("candidate_source_sha") == args.source_sha, "config_source")
            room = connection.get("room")
            require(isinstance(room, str) and re.fullmatch(r"hps-eval-[0-9a-f-]{36}", room), "config_room")
            run_id = str(uuid.uuid4())
            connection.update(run_id=run_id, scenario=scenario, synthetic_consent=True)
            command(["xcrun", "simctl", "terminate", args.device, BUNDLE], check=False)
            container = Path(command(["xcrun", "simctl", "get_app_container", args.device, BUNDLE, "data"]).stdout.decode().strip())
            caches = container / "Library/Caches"
            caches.mkdir(parents=True, exist_ok=True)
            config_path = caches / "hps-livekit-ci-config.json"
            receipt_path = caches / "hps-livekit-ci-result.json"
            receipt_path.unlink(missing_ok=True)
            with config_path.open("w") as file:
                json.dump(connection, file)
            config_path.chmod(0o600)
            command(["xcrun", "simctl", "launch", args.device, BUNDLE, "--hps-livekit-evaluation-ci-synthetic"])
            native = await_file(receipt_path, process, 65, allow_successful_exit=True)
            require(process.wait(timeout=15) == 0, "evaluator_failed")
            events, server = read_json(output / "events.json"), read_json(output / "result.json")
            return validate(native, events, server, run_id=run_id, scenario=scenario,
                            source=args.source_sha, room=room)
    except BaseException as error:
        primary = error
        raise
    finally:
        # Attempt both sides independently; never publish a token-bearing private file.
        actions = [lambda: command(["xcrun", "simctl", "terminate", args.device, BUNDLE], timeout=10, check=False),
                   lambda: reap(process)]
        actions.extend(lambda path=path: path.unlink(missing_ok=True)
                       for path in (config_path, receipt_path) if path is not None)
        cleanup_error = None
        for action in actions:
            try:
                action()
            except BaseException as error:
                if cleanup_error is None:
                    cleanup_error = error
        if primary is None and cleanup_error is not None:
            raise CheckFailure("owned_cleanup_failed") from None


def main(args):
    os.umask(0o077)
    require(sys.platform == "darwin", "darwin_required")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source_sha), "source_sha")
    uuid.UUID(args.device)
    output = Path(args.evidence)
    output.mkdir(parents=True, exist_ok=True)
    result = {"schema": "hps-native-livekit-host/1", "source_sha": args.source_sha,
              "status": "FAIL", "scenarios": [], "physical_audio": "NOT_RUN"}
    def interrupted(_signum, _frame):
        raise InterruptedError("owned_execution_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        result["app_executable_sha256"] = hashlib.sha256((Path(args.app) / "HPStudio").read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix="hps-native-livekit-") as directory:
            private = Path(directory)
            prepare = Path(__file__).resolve().parents[1] / "voice-evaluation/prepare-host.py"
            python = shutil.which("python3.12") or shutil.which("python3.13") or sys.executable
            command([sys.executable, str(prepare), "--output", str(private / "host"), "--python", python], timeout=600)
            host = read_json(private / "host/host.json")
            for scenario in SCENARIOS:
                result["scenarios"].append(scenario_run(args, host, private, scenario))
            result["status"] = "PASS"
    except Exception as error:
        result["failure"] = str(error) if isinstance(error, CheckFailure) else type(error).__name__
    finally:
        (output / "native-livekit.json").write_text(json.dumps(result, indent=2) + "\n")
    print("native LiveKit transport: " + result["status"])
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--app", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--evidence", required=True)
    raise SystemExit(main(parser.parse_args()))
