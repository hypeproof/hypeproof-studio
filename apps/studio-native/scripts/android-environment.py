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


FOCUS_LOST = "device focus lost (device state, not a product result)"
# AndroidJUnitRunner per-test result codes: -1 error, -2 failure. -3 (ignored) and
# -4 (assumption failure) are not failures.
FAILED_CODES = (-1, -2)


def instrumentation_results(log: str) -> list:
    """Finished tests from `am instrument -r` output, in run order, with their stack."""
    results, status, key = [], {}, None
    for line in log.splitlines():
        field = re.match(r"INSTRUMENTATION_STATUS: (\w+)=(.*)$", line)
        if field:
            key = field.group(1)
            status[key] = field.group(2)
            continue
        code = re.match(r"INSTRUMENTATION_STATUS_CODE: (-?\d+)$", line)
        if code:
            if int(code.group(1)) != 1:  # 1 marks a test start
                results.append({"class": status.get("class", ""), "test": status.get("test", ""),
                                "code": int(code.group(1)), "stack": status.get("stack", "")})
            status, key = {}, None
        elif key == "stack":
            status["stack"] += "\n" + line
    return results


def lost_compositing(stack: str):
    """The focused app window is NOT_VISIBLE with alpha 0 at the failing lookup.

    UiSync writes one DeviceFocusLost line with window manager focus, the focus
    request result and the app input windows. Window manager focus on an app window
    that input reports as NOT_VISIBLE, alpha=0 is a window that is not composited.
    In run 45814588860 every task window (launcher, wallpaper, other packages) was in
    that state, and it lasted until the end of the run.
    """
    first = stack.split("\n", 1)[0]
    if FOCUS_LOST not in first:
        return None
    focus = re.search(r"WM mCurrentFocus=Window\{([0-9a-f]+) u\d+ ([^}\s]+)\}", first)
    if not focus or not re.search(r"FocusRequests: [^|]*result='NOT_VISIBLE'", first):
        return None
    windows = first.split("app input windows: ", 1)
    if len(windows) < 2:
        return None
    for row in windows[1].split("; "):
        window = re.match(r"\d+: name=([0-9a-f]+) (\S+?), .*\binputConfig=([^,]*), alpha=([0-9.]+)", row.strip())
        if (window and window.group(1) == focus.group(1) and float(window.group(4)) == 0
                and "NOT_VISIBLE" in [flag.strip() for flag in window.group(3).split("|")]):
            return {"window": focus.group(2)}
    return None


def compositing_loss(log: str) -> dict:
    """Group failures that share a lost-compositing snapshot. Reporting only: it never
    turns a failure into a pass, and a failure without that snapshot stays separate."""
    failed = [result for result in instrumentation_results(log) if result["code"] in FAILED_CODES]
    onset, same, other = None, [], []
    for result in failed:
        name = result["class"].rsplit(".", 1)[-1] + "#" + result["test"]
        lost = lost_compositing(result["stack"])
        if lost:
            onset = onset or {"test": name, "window": lost["window"]}
            same.append(name)
        else:
            other.append(name)
    return {"schema": "hps-android-compositing/1", "state": "observed" if onset else "not_observed",
            "onset": onset, "failed_tests": len(failed), "same_cause_tests": same, "other_failed_tests": other}


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
