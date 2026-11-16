#!/usr/bin/env python3
"""Separate bounded native RTC recipe. Does not repeat or replace existing UI tests."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid


class StageFailure(Exception):
    def __init__(self, stage, code):
        self.stage, self.code = stage, code
        super().__init__(stage)


def execute(argv, *, timeout, log):
    """Bound one owned group; allow helper finally blocks to release RTC children."""
    with log.open("wb") as stream:
        process = subprocess.Popen(argv, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        except BaseException as error:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=35)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=3)
            if isinstance(error, subprocess.TimeoutExpired):
                return 124
            raise


def cleanup(device, private):
    outcomes = []
    for action in ("shutdown", "delete"):
        try:
            code = execute(["xcrun", "simctl", action, device], timeout=20,
                           log=private / ("cleanup-" + action + ".log"))
        except BaseException:
            code = 125
        outcomes.append({"action": action, "exit": code})
    return outcomes


def runtime_diagnostics(log):
    """Keep fixed precredential signals, never raw simulator paths or log text."""
    data = log.read_bytes() if log.exists() else b""
    tail = data[-16384:].decode("utf-8", errors="replace")
    lower = tail.lower()
    markers = {
        "coresimulator": "coresimulator_mentioned",
        "timed out": "timeout_mentioned",
        "connection refused": "connection_refused",
        "connection invalid": "connection_invalid",
        "failed to initialize": "initialization_failed",
        "unable to boot": "boot_failed",
    }
    codes = re.findall(r"\b(NSPOSIXErrorDomain|NSCocoaErrorDomain|com\.apple\.CoreSimulator\.SimError)\s+Code=(-?\d+)\b", tail)
    return {"output_bytes": len(data), "output_sha256": hashlib.sha256(data).hexdigest(),
            "markers": sorted({label for text, label in markers.items() if text in lower}),
            "error_codes": [{"domain": domain, "code": int(code)} for domain, code in codes[:8]]}


def main(args):
    os.umask(0o077)
    native = Path(__file__).resolve().parents[1]
    evidence = Path(args.evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    source = subprocess.check_output(["git", "-C", str(native), "rev-parse", "HEAD"], text=True).strip()
    result = {"schema": "hps-native-livekit-runner/1", "source_sha": source,
              "status": "FAIL", "physical_audio": "NOT_RUN", "steps": []}
    device = None
    deadline = time.monotonic() + 1050  # Reserve final cleanup within a 20-minute job.
    def interrupted(_signum, _frame):
        # CI cancellation can escalate INT -> TERM while execute is allowing
        # the owned helper group to unwind. Preserve that first cleanup window.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise InterruptedError("owned_execution_interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    with tempfile.TemporaryDirectory(prefix="hps-native-rtc-") as directory:
        private = Path(directory)
        def run(stage, argv, seconds):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise StageFailure(stage, 124)
            log = private / (stage + ".log")
            timeout = min(seconds, remaining)
            started = time.monotonic()
            step = {"stage": stage, "timeout_seconds": round(timeout, 3)}
            try:
                code = execute(argv, timeout=timeout, log=log)
                step["exit"] = code
            except BaseException as error:
                step.update(exit=125, error_type=type(error).__name__)
                if stage == "runtimes":
                    result["runtime_diagnostics"] = runtime_diagnostics(log)
                raise
            finally:
                step["seconds"] = round(time.monotonic() - started, 3)
                result["steps"].append(step)
            if code:
                if stage == "runtimes":
                    result["runtime_diagnostics"] = runtime_diagnostics(log)
                if stage == "debug_build":
                    # No room/token exists during compilation. Keep only bounded
                    # compiler diagnostics, never runtime SDK output.
                    result["compiler_errors"] = [line[:500] for line in log.read_text(errors="replace").splitlines()
                                                 if "error:" in line][:12]
                raise StageFailure(stage, code)
            return log.read_text(errors="replace").strip()
        try:
            if sys.platform != "darwin" or not re.fullmatch(r"[0-9a-f]{40}", source):
                raise StageFailure("host_identity", 2)
            result["xcode"] = run("xcode", ["xcodebuild", "-version"], 10)
            sdk = run("sdk", ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], 10)
            if int(sdk.split(".")[0]) < 26:
                raise StageFailure("sdk_floor", 2)
            # This is the first CoreSimulator operation on a fresh hosted runner.
            # Allow bounded service readiness once, inside the unchanged job deadline.
            runtimes = json.loads(run("runtimes", ["xcrun", "simctl", "list", "runtimes", "--json"], 60))
            available = [r for r in runtimes["runtimes"] if r["isAvailable"] and ".iOS-" in r["identifier"]
                         and r["version"].split(".")[:2] == sdk.split(".")[:2]]
            if not available:
                raise StageFailure("runtime_missing", 2)
            runtime = available[-1]["identifier"]
            device = run("create", ["xcrun", "simctl", "create", "HP-Voice-" + uuid.uuid4().hex[:12],
                         "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro", runtime], 15)
            if str(uuid.UUID(device)).lower() != device.lower():
                device = None
                raise StageFailure("device_identity", 2)
            result["runtime"] = runtime
            run("boot", ["xcrun", "simctl", "boot", device], 15)
            run("bootstatus", ["xcrun", "simctl", "bootstatus", device, "-b"], 90)
            derived = private / "DerivedData"
            run("debug_build", ["xcodebuild", "-project", str(native / "ios/HPStudio.xcodeproj"),
                "-scheme", "HPStudio", "-configuration", "Debug", "-destination", "platform=iOS Simulator,id=" + device,
                "-derivedDataPath", str(derived), "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "build"], 600)
            app = derived / "Build/Products/Debug-iphonesimulator/HPStudio.app"
            run("signature", ["codesign", "--verify", "--strict", str(app)], 15)
            result["app_executable_sha256"] = hashlib.sha256((app / "HPStudio").read_bytes()).hexdigest()
            run("install", ["xcrun", "simctl", "install", device, str(app)], 30)
            run("native_transport", [sys.executable, str(native / "scripts/ios-livekit-evaluation.py"),
                "--device", device, "--app", str(app), "--source-sha", source, "--evidence", str(evidence)], 420)
            receipt = json.loads((evidence / "native-livekit.json").read_text())
            if receipt.get("status") != "PASS" or receipt.get("source_sha") != source:
                raise StageFailure("transport_receipt", 1)
            result["status"] = "PASS"
        except BaseException as error:
            result["failure"] = error.stage if isinstance(error, StageFailure) else type(error).__name__
            if isinstance(error, StageFailure):
                result["failure_exit"] = error.code
        finally:
            if device is not None:
                result["cleanup"] = cleanup(device, private)
                if result["status"] == "PASS" and any(step["exit"] for step in result["cleanup"]):
                    result["status"] = "FAIL"; result["failure"] = "simulator_cleanup"
            (evidence / "native-livekit-runner.json").write_text(json.dumps(result, indent=2) + "\n")
    print("native RTC recipe: " + result["status"])
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True)
    raise SystemExit(main(parser.parse_args()))
