#!/usr/bin/env python3
"""Read-only Android emulator readiness; never dismiss dialogs or pass a failed test."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def inspect(window: str, power: str) -> dict:
    focus = re.search(r"^\s*mCurrentFocus=(.+)$", window, re.MULTILINE)
    focus = focus.group(1).strip() if focus else None
    result = {"schema": "hps-android-environment/1", "status": "not_ready", "reason": "unobserved_state", "focus": focus}
    if focus and "Application Not Responding:" in focus:
        # Diagnose the actual foreground owner, not every background log mention.
        package = focus.split("Application Not Responding:", 1)[1].rstrip("}").strip()
        result["reason"] = "studio_anr" if package in ("ai.hypeproof.studio.mobile", "ai.hypeproof.studio.mobile.preview") else "foreign_anr"
        return result
    awake = re.search(r"^\s*mWakefulness=(\w+)\s*$", power, re.MULTILINE)
    locked = re.search(r"^\s*isKeyguardShowing=(true|false)\s*$", window, re.MULTILINE)
    if not awake or not locked or not focus or not re.fullmatch(r"Window\{[^\r\n]{1,1024}\}", focus):
        return result
    if awake.group(1) != "Awake":
        result["reason"] = "display_not_awake"
    elif locked.group(1) != "false":
        result["reason"] = "keyguard_showing"
    elif "Application Error:" in focus:
        result["reason"] = "foreground_error_dialog"
    else:
        result.update(status="ready", reason="awake_unlocked_focus_observed")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window", type=Path, required=True)
    parser.add_argument("--power", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    window, power = args.window.read_bytes(), args.power.read_bytes()
    result = inspect(window.decode("utf-8", errors="strict"), power.decode("utf-8", errors="strict"))
    result["inputs"] = {"window_sha256": hashlib.sha256(window).hexdigest(), "power_sha256": hashlib.sha256(power).hexdigest()}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print("Android environment: " + result["status"] + " (" + result["reason"] + ")")
    return 0 if result["status"] == "ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
