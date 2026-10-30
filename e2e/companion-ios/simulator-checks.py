#!/usr/bin/env python3
"""Unsigned shell checks on fresh, explicitly owned simulators only."""
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]


def command(args, *, timeout, capture=False):
    return subprocess.run(args, cwd=ROOT, check=True, timeout=timeout,
                          text=True, stdout=subprocess.PIPE if capture else None)


def runtime_number(version):
    parts = [int(part) for part in version.split(".")]
    parts += [0] * (3 - len(parts))
    return (parts[0] << 16) | (parts[1] << 8) | parts[2]


def select_types(metadata):
    runtimes = [runtime for runtime in metadata["runtimes"]
                if runtime.get("isAvailable") and
                runtime["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]
    for runtime in sorted(runtimes, key=lambda value: runtime_number(value["version"]), reverse=True):
        supported = runtime.get("supportedDeviceTypes")
        types = supported if supported else metadata["devicetypes"]
        number = runtime_number(runtime["version"])
        selected = {}
        for kind, family in [("iphone", "iPhone"), ("ipad", "iPad")]:
            candidates = [device_type for device_type in types
                          if device_type.get("productFamily", device_type["name"].split()[0]) == family
                          and device_type.get("minRuntimeVersion", 0) <= number
                          <= device_type.get("maxRuntimeVersion", 0xFFFFFFFF)]
            if candidates:
                selected[kind] = sorted(candidates, key=lambda value: value["identifier"])[-1]
        if set(selected) == {"iphone", "ipad"}:
            return runtime, selected
    raise RuntimeError("BLOCKED: one available iOS runtime supporting both iPhone and iPad is required")


def verify(output, run=command):
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise RuntimeError("Evidence output must be empty; choose a fresh IOS_EVIDENCE_DIR")
    run_id = str(uuid.uuid4())
    # Exclusive claim also prevents two invocations from passing the empty check concurrently.
    with (output / "attempt.json").open("x") as receipt:
        json.dump({"run_id": run_id}, receipt)
        receipt.write("\n")
    run(["xcodebuild", "-version"], timeout=30)
    # Read runtime/type metadata only. Existing user/peer simulator UUIDs are never selected.
    metadata = json.loads(run(["xcrun", "simctl", "list", "--json"], timeout=60, capture=True).stdout)
    runtime, types = select_types(metadata)
    owned = []
    selected = {}
    cleanup = []
    try:
        for kind, device_type in types.items():
            name = f"HypeProof Companion {run_id} {kind}"
            created = run(["xcrun", "simctl", "create", name, device_type["identifier"], runtime["identifier"]],
                          timeout=60, capture=True).stdout.strip()
            # Only a UUID returned by this invocation's create command may be mutated or removed.
            identifier = str(uuid.UUID(created))
            owned.append(identifier)
            selected[kind] = {"udid": identifier, "name": name,
                              "device_type": device_type["identifier"], "runtime": runtime["identifier"]}
            (output / "devices.json").write_text(json.dumps(selected, indent=2) + "\n")
            run(["xcodebuild", "test", "-project", "apps/companion-ios/HypeProofCompanion.xcodeproj",
                 "-scheme", "HypeProofCompanion", "-destination", f"platform=iOS Simulator,id={identifier}",
                 "-derivedDataPath", str(output / "DerivedData"),
                 "-resultBundlePath", str(output / f"{kind}.xcresult"),
                 "CODE_SIGNING_ALLOWED=NO", "-parallel-testing-enabled", "NO"], timeout=600)
    finally:
        deletion_failures = []
        for identifier in reversed(owned):
            for operation in ["shutdown", "delete"]:
                try:
                    run(["xcrun", "simctl", operation, identifier], timeout=60)
                    cleanup.append({"udid": identifier, "operation": operation, "result": "passed"})
                except Exception as error:
                    # Shutdown may fail if the simulator never booted; deletion must still run.
                    cleanup.append({"udid": identifier, "operation": operation, "result": type(error).__name__})
                    if operation == "delete":
                        deletion_failures.append(identifier)
        (output / "cleanup.json").write_text(json.dumps(cleanup, indent=2) + "\n")
        if deletion_failures:
            raise RuntimeError("Owned simulator deletion failed; inspect cleanup.json")


if __name__ == "__main__":
    verify(Path(os.environ.get("IOS_EVIDENCE_DIR", ROOT / "artifacts/companion-ios-simulator")))
    print("PASS native simulator shell checks; physical device, live auth, relay and store acceptance NOT RUN")
