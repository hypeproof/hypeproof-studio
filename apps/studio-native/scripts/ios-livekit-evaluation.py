#!/usr/bin/env python3
"""Run the existing Debug iOS app against an owned, pinned loopback evaluator.

No token is placed in argv, environment, UI typing, console or published evidence.
Raw SDK logs and disposable configs stay in a private temporary directory.
"""
import argparse
import hashlib
import json
import math
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
          "interrupted_received", "stop_requested", "stop_acknowledged", "renderer_detached", "cleanup_complete"}
HOST_STAGES = {"clang-version", "go-version", "source-init", "source-fetch", "source-checkout",
               "server-build", "modules-verify", "server-version", "server-libraries", "venv",
               "python-dependencies", "python-check", "python-freeze"}
FAILURE_CODES = {"actual_published_pcm_missing", "boolean", "candidate_identity", "claim_scope", "config_room",
    "config_source", "darwin_required", "decoded_count", "disconnect_missing", "evaluator_exited_early",
    "evaluator_failed", "event_schema", "generation", "identity", "incomplete_cleanup", "missing_fence",
    "native_failed", "no_actual_audio", "observation_window", "owned_cleanup_failed", "owned_command_failed",
    "phase", "receipt_resurrected", "receipt_size", "receipt_timeout", "runtime_identity", "server_cancel_missing",
    "server_failure", "server_identity_or_cleanup", "server_started_tuple", "server_stop_missing", "source_sha",
    "state_schema", "transport_sequence", "tuple_changed", "client_stop_ack_missing"}


class CheckFailure(Exception):
    def __init__(self, code):
        super().__init__(code if isinstance(code, str) and code in FAILURE_CODES else "qualification_failed")


class OwnedInterruption(Exception):
    """Not InterruptedError: selector backends swallow that as retryable EINTR."""


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


def validate(native, events, server, *, run_id, scenario, source, room, server_sha):
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
        require("stop_acknowledged" in stopped["events"], "client_stop_ack_missing")
    for metric in ("decodedBuffers", "decodedSamples"):
        require(final[metric] == drained[metric] >= fenced[metric] >= before[metric], "receipt_resurrected")
    require(server.get("status") == "PASS" and server.get("owned_server_reaped") is True
            and server.get("candidate_source_sha") == source and server.get("room") == room, "server_identity_or_cleanup")
    require(server.get("sdk") == "1.2.1" and server.get("server") == "livekit-server version 1.13.11"
            and server.get("server_sha256") == server_sha
            and re.fullmatch(r"[0-9a-f]{64}", server_sha), "runtime_identity")
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
            "runtime": {"rtc_sdk_version": server["sdk"], "server_version": "1.13.11",
                        "server_sha256": server["server_sha256"]},
            "physical_audio": "NOT_RUN", "acoustic_played_range": "UNKNOWN",
            "unobserved_transport_tail": "UNKNOWN"}


def command(argv, *, timeout=30, check=True, termination_grace=2):
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except BaseException as primary:
        # subprocess.run kills immediately on interruption. A preparation helper
        # must first unwind/reap its own separate groups and write its receipt.
        try:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=termination_grace)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate(timeout=2)
        except BaseException as cleanup_error:
            if hasattr(primary, "add_note"):
                primary.add_note("owned_command_cleanup_failed:" + type(cleanup_error).__name__)
        raise
    result = subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
    if check:
        require(result.returncode == 0, "owned_command_failed")
    return result


def host_receipt(raw):
    """Only bounded nonsecret provenance; never paths, raw logs or extra fields."""
    safe = {}
    for key, choices in {"status": {"PASS", "FAIL"}, "system": {"Darwin"}, "arch": {"arm64", "amd64"}}.items():
        if raw.get(key) in choices:
            safe[key] = raw[key]
    for key, pattern in {"source_commit": r"[0-9a-f]{40}", "server_sha256": r"[0-9a-f]{64}",
                         "server_version": r"[0-9]+\.[0-9]+\.[0-9]+", "go_version": r"[0-9]+\.[0-9]+\.[0-9]+",
                         "error_type": r"[A-Za-z][A-Za-z0-9_]{0,63}"}.items():
        value = raw.get(key)
        if isinstance(value, str) and re.fullmatch(pattern, value):
            safe[key] = value
    def seconds(value):
        return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 3600
    if seconds(raw.get("seconds")):
        safe["seconds"] = raw["seconds"]
    hashes = raw.get("module_hashes")
    if isinstance(hashes, dict):
        safe["module_hashes"] = {name: value for name, value in hashes.items()
                                 if name in {"go.mod", "go.sum"} and isinstance(value, str)
                                 and re.fullmatch(r"[0-9a-f]{64}", value)}
    safe["steps"] = []
    for item in raw.get("steps", [])[:32]:
        if (isinstance(item, dict) and item.get("stage") in HOST_STAGES
                and type(item.get("exit")) is int and -255 <= item["exit"] <= 255
                and seconds(item.get("seconds"))):
            safe["steps"].append({key: item[key] for key in ("stage", "exit", "seconds")})
    return safe


def partial_json(path, kind=dict):
    """Read bounded optional evidence without letting diagnostics mask the failure."""
    try:
        if path is None or not path.is_file():
            return "missing", None
        value = read_json(path)
        return ("present", value) if isinstance(value, kind) else ("invalid", None)
    except Exception:
        return "invalid", None


def diagnostic_snapshot(reader, path):
    try:
        return reader(path)
    except Exception:
        # An unreadable/malformed diagnostic must never replace the primary failure.
        return {"availability": "unavailable"}


def native_failure_snapshot(path):
    availability, raw = partial_json(path)
    safe = {"availability": availability}
    if raw is None:
        return safe
    if raw.get("schema") != "hps-native-livekit-evaluation/1":
        return {"availability": "invalid"}
    for key, allowed in {"status": {"PASS", "FAIL"}, "scenario": set(SCENARIOS) | {"unknown"},
                         "failure": {"config", "receipt", "interruption", "fence", "cleanup", "bounded_execution"}}.items():
        if isinstance(raw.get(key), str) and raw[key] in allowed:
            safe[key] = raw[key]
    for key in ("beforeFence", "afterFence", "afterDrain", "final"):
        value = raw.get(key)
        if not isinstance(value, dict):
            continue
        state = {}
        if value.get("phase") in ("ready", "starting", "playing", "interrupted", "stopped"):
            state["phase"] = value["phase"]
        for name in ("busy", "captureOpen", "outputOpen", "roomAttached", "manualRendering"):
            if type(value.get(name)) is bool:
                state[name] = value[name]
        for name, maximum in (("generation", 4294967295), ("decodedBuffers", 48000 * 90), ("decodedSamples", 48000 * 90)):
            if type(value.get(name)) is int and 0 <= value[name] <= maximum:
                state[name] = value[name]
        if isinstance(value.get("events"), list):
            state["events"] = [event for event in value["events"][:64] if isinstance(event, str) and event in EVENTS]
        safe[key] = state
    return safe


def evaluator_failure_snapshot(output):
    availability, raw = partial_json(output / "result.json")
    safe = {"availability": availability}
    error_types = {"AssertionError", "RuntimeError", "ValueError", "TimeoutError", "CancelledError", "OSError"}
    if raw is not None:
        if raw.get("status") in ("PASS", "FAIL"):
            safe["status"] = raw["status"]
        if isinstance(raw.get("error_type"), str) and raw["error_type"] in error_types:
            safe["error_type"] = raw["error_type"]
        error_codes = {"timeout: stopped acknowledgement and client disconnect": "stop_disconnect_timeout",
                       "server exited before readiness": "server_exited_before_ready",
                       "server readiness timed out": "server_readiness_timeout"}
        if isinstance(raw.get("error"), str) and raw["error"] in error_codes:
            safe["error_code"] = error_codes[raw["error"]]
        if type(raw.get("owned_server_reaped")) is bool:
            safe["owned_server_reaped"] = raw["owned_server_reaped"]
        value = raw.get("duration_seconds")
        if type(value) in (int, float) and 0 <= value <= 3600 and math.isfinite(value):
            safe["duration_seconds"] = value
    availability, events = partial_json(output / "events.json", list)
    safe["events_availability"] = availability
    safe["observations"] = []
    observations = {"manual_room_ready", "client_admitted", "sent", "rejected", "worker_failed",
                    "producer_finished", "cancelled", "energy_onset", "client_disconnected",
                    "attribute_cleanup_failed", "cleanup_failed", "manual_client_left", "manual_session_complete"}
    reasons = {"sender_or_reliability", "not_admitted", "capacity_session_closed", "schema", "input_track_limit",
               "session_or_terminal", "duplicate_or_stale", "tuple", "duplicate_interrupt",
               "energy_onset", "client_interrupt", "client_stop", "disconnect", "limit"}
    for event in (events or [])[-64:]:
        if not isinstance(event, dict) or event.get("observation") not in tuple(observations):
            continue
        item = {"observation": event["observation"]}
        for key, allowed in {"event": {"start", "started", "interrupt", "interrupted", "stop", "stopped"},
                             "reason": reasons, "error_type": error_types}.items():
            if isinstance(event.get(key), str) and event[key] in allowed:
                item[key] = event[key]
        for key in ("current", "publication_removed"):
            if type(event.get(key)) is bool:
                item[key] = event[key]
        for key, maximum in (("at_ms", 3600000), ("queued_after_seconds", 90)):
            value = event.get(key)
            if type(value) in (int, float) and 0 <= value <= maximum and math.isfinite(value):
                item[key] = value
        safe["observations"].append(item)
    return safe


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
    started = time.monotonic()
    phases = []
    config_lifetime = {}
    def phase(name):
        elapsed = round(time.monotonic() - started, 3)
        if phases:
            phases[-1]["duration_seconds"] = round(elapsed - phases[-1]["elapsed_seconds"], 3)
        phases.append({"phase": name, "elapsed_seconds": elapsed})
    def config_remaining(point, connection):
        expires = connection.get("expires_at")
        if type(expires) is int:
            remaining = expires - int(time.time())
            if -3600 <= remaining <= 3600:
                config_lifetime[point] = remaining
    try:
        # Resolve the owned app/container before the evaluator issues its fresh
        # 75-second config. Cold preflight must not consume credential lifetime.
        phase("terminate_previous_app")
        command(["xcrun", "simctl", "terminate", args.device, BUNDLE], check=False)
        phase("app_container")
        container = Path(command(["xcrun", "simctl", "get_app_container", args.device, BUNDLE, "data"]).stdout.decode().strip())
        phase("prepare_paths")
        caches = container / "Library/Caches"
        caches.mkdir(parents=True, exist_ok=True)
        config_path = caches / "hps-livekit-ci-config.json"
        receipt_path = caches / "hps-livekit-ci-result.json"
        config_path.unlink(missing_ok=True)
        receipt_path.unlink(missing_ok=True)
        phase("evaluator_start")
        with (private / (scenario + ".log")).open("xb") as log:
            process = subprocess.Popen([host["python"], str(lab), "--server", host["server"],
                "--output", str(output), "--serve-seconds", "75", "--exit-after-client",
                "--source-sha", args.source_sha], stdout=log, stderr=log, start_new_session=True)
            phase("await_config")
            connection = await_file(output / "connection.private.json", process, 15)
            config_remaining("read_seconds_remaining", connection)
            phase("validate_config")
            require(connection.get("candidate_source_sha") == args.source_sha, "config_source")
            room = connection.get("room")
            require(isinstance(room, str) and re.fullmatch(r"hps-eval-[0-9a-f-]{36}", room), "config_room")
            run_id = str(uuid.uuid4())
            connection.update(run_id=run_id, scenario=scenario, synthetic_consent=True)
            phase("write_config")
            with config_path.open("w") as file:
                json.dump(connection, file)
            config_path.chmod(0o600)
            phase("launch_app")
            config_remaining("launch_seconds_remaining", connection)
            command(["xcrun", "simctl", "launch", args.device, BUNDLE, "--hps-livekit-evaluation-ci-synthetic"])
            config_remaining("launched_seconds_remaining", connection)
            phase("await_native_result")
            native = await_file(receipt_path, process, 65, allow_successful_exit=True)
            phase("await_evaluator_exit")
            require(process.wait(timeout=15) == 0, "evaluator_failed")
            phase("validate_receipts")
            events, server = read_json(output / "events.json"), read_json(output / "result.json")
            return validate(native, events, server, run_id=run_id, scenario=scenario,
                            source=args.source_sha, room=room, server_sha=host["server_sha256"])
    except BaseException as error:
        primary = error
        # Read partial receipts before cleanup removes them. These diagnostics
        # cannot grant PASS and contain no raw identity, URL, token or error text.
        elapsed = round(time.monotonic() - started, 3)
        phases[-1]["duration_seconds"] = round(elapsed - phases[-1]["elapsed_seconds"], 3)
        error.scenario_diagnostics = {"schema": "hps-native-livekit-scenario-failure/1",
            "scenario": scenario, "phase": phases[-1]["phase"],
            "elapsed_seconds": elapsed, "phases": phases, "config_lifetime": config_lifetime,
            "evaluator_exit": process.poll() if process is not None else None,
            "native": diagnostic_snapshot(native_failure_snapshot, receipt_path),
            "evaluator": diagnostic_snapshot(evaluator_failure_snapshot, output)}
        raise
    finally:
        # Attempt both sides independently; never publish a token-bearing private file.
        actions = [lambda: command(["xcrun", "simctl", "terminate", args.device, BUNDLE], timeout=5, check=False),
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
        if primary is not None:
            primary.scenario_diagnostics["evaluator_exit_after_cleanup"] = process.poll() if process is not None else None
            primary.scenario_diagnostics["evaluator_after_cleanup"] = diagnostic_snapshot(evaluator_failure_snapshot, output)
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
        # Preserve the first interruption while nested finally blocks reap children.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise OwnedInterruption("owned_execution_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        result["app_executable_sha256"] = hashlib.sha256((Path(args.app) / "HPStudio").read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix="hps-native-livekit-") as directory:
            private = Path(directory)
            prepare = Path(__file__).resolve().parents[1] / "voice-evaluation/prepare-host.py"
            python = shutil.which("python3.12") or shutil.which("python3.13") or sys.executable
            try:
                command([sys.executable, str(prepare), "--output", str(private / "host"), "--python", python],
                        timeout=600, termination_grace=15)
                host = read_json(private / "host/host.json")
                # Exercise the actual private-file publication before any of the
                # bounded 75-second scenario credentials can become visible.
                result["publication_control"] = {"status": "FAIL", "source_sha256": hashlib.sha256(
                    prepare.with_name("test_publication.py").read_bytes()).hexdigest()}
                command([host["python"], "-m", "unittest", "discover", "-s", str(prepare.parent),
                         "-p", "test_publication.py", "-v"], timeout=15)
                result["publication_control"]["status"] = "PASS"
                for scenario in SCENARIOS:
                    result["scenarios"].append(scenario_run(args, host, private, scenario))
                result["status"] = "PASS"
            finally:
                try:
                    result["host"] = host_receipt(read_json(private / "host/host.json"))
                except Exception as error:
                    result["host"] = {"status": "UNAVAILABLE", "error_type": type(error).__name__}
    except Exception as error:
        result["failure"] = str(error) if isinstance(error, CheckFailure) else type(error).__name__
        if hasattr(error, "scenario_diagnostics"):
            result["scenario_failure"] = error.scenario_diagnostics
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
