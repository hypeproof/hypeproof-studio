"""Inject one Simulator OS notification while the targeted XCUITest waits.

Steps, each a separate CI step so the log shows where time goes and where a hang starts:
  build    build-for-testing before any simulator exists (compilation never competes with
           simulator IPC on the runner)
  boot     create, boot and warm up the owned simulator
  run      test-without-building, inject the notification at the test's checkpoint
  cleanup  shut down and delete the owned simulator
No argument runs all four in order, for local use.

Every simctl call keeps its existing time limit. When one does not return in time, the step
records what the runner was doing (processes, load, samples of the stuck simctl and of
CoreSimulatorService, the host CoreSimulator log) in simctl-hang-<step>.txt and fails with
the step's name. Limits are never raised to hide a hang.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = "ai.hypeproof.studio.mobile"
CHECK = "HPStudioUITests/StudioJourneyTests/testSystemApprovalPushOpensMatchingReadOnlyCard"
PAYLOAD = {
    "aps": {"alert": {"title": "테스트 · 승인 푸시", "body": "알림을 눌러 Studio에서 테스트 카드를 열어 보세요."}},
    "hps": {
        "schema": "hps-push/1",
        "kind": "approval",
        "id": "SMK-11111111-1111-4111-8111-111111111111",
        "delivery_id": "22222222-2222-4222-8222-222222222222",
        "revision": 1,
    },
}
DIAGNOSTIC_LIMIT = 30


class SimctlHang(RuntimeError):
    pass


def evidence_dir():
    path = Path(os.environ.get("HP_APPROVAL_PUSH_EVIDENCE", ROOT / "evidence/approval-push")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def record(evidence, **row):
    with (evidence / "simulator-steps.jsonl").open("a") as steps:
        steps.write(json.dumps(row, sort_keys=True) + "\n")


def stop_group(child):
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def bounded(args, limit=DIAGNOSTIC_LIMIT):
    """Diagnostic output only. Never raises and never outlives its limit."""
    try:
        child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 start_new_session=True)
    except OSError as error:
        return f"<{args[0]} unavailable: {error}>"
    try:
        out, _ = child.communicate(timeout=limit)
        return out
    except subprocess.TimeoutExpired:
        stop_group(child)
        return f"<{' '.join(args)} did not return within {limit}s>"


def diagnose(evidence, step, stuck_pid):
    processes = bounded(["ps", "-axo", "pid,ppid,stat,etime,%cpu,%mem,command"])
    keys = ("CoreSimulator", "simctl", "launchd_sim", "xcodebuild", "XCTest", "SimulatorTrampoline", "xctrunner")
    related = [line for line in processes.splitlines() if any(key in line for key in keys)]
    service = [line.split()[0] for line in related if "CoreSimulatorService" in line]
    sections = [
        ("step", step),
        ("load", bounded(["sysctl", "-n", "vm.loadavg"])),
        ("memory", bounded(["vm_stat"])),
        ("simulator-related processes", "\n".join(related)),
        (f"sample of the stuck simctl ({stuck_pid})", bounded(["sample", str(stuck_pid), "2", "-mayDie"])),
    ]
    for pid in service[:1]:
        sections.append((f"sample of CoreSimulatorService ({pid})", bounded(["sample", pid, "2", "-mayDie"])))
    log = bounded(["log", "show", "--last", "3m", "--style", "compact",
                   "--predicate", 'subsystem BEGINSWITH "com.apple.CoreSimulator"'])
    sections.append(("host CoreSimulator log, last 400 lines", "\n".join(log.splitlines()[-400:])))
    path = evidence / f"simctl-hang-{step}.txt"
    with path.open("a") as target:
        target.write("".join(f"== {title}\n{body}\n\n" for title, body in sections))
    print(f"simctl hang during {step}: diagnostics in {path.name}", flush=True)


def simctl(evidence, step, args, *, timeout, input=None, capture=True, check=True):
    """Run one bounded simctl call; on a hang, keep the runner state and fail by step name."""
    command = ["xcrun", "simctl", *args]
    started = time.monotonic()
    child = subprocess.Popen(command, stdin=subprocess.PIPE if input is not None else None,
                             stdout=subprocess.PIPE if capture else None, text=True,
                             start_new_session=True)
    try:
        out, _ = child.communicate(input=input, timeout=timeout)
    except subprocess.TimeoutExpired:
        record(evidence, step=step, command=args[0], limit=timeout, outcome="timeout",
               seconds=round(time.monotonic() - started, 1))
        # Diagnose while the stuck call is still alive, then stop it.
        diagnose(evidence, step, child.pid)
        stop_group(child)
        raise SimctlHang(f"simctl {args[0]} did not return within {timeout}s during {step}")
    seconds = round(time.monotonic() - started, 1)
    record(evidence, step=step, command=args[0], limit=timeout, outcome=f"exit {child.returncode}", seconds=seconds)
    print(f"{step}: simctl {args[0]} exit {child.returncode} in {seconds}s", flush=True)
    if check and child.returncode:
        raise subprocess.CalledProcessError(child.returncode, command)
    return (out or "").strip()


def state_path(evidence):
    return evidence / "simulator.json"


def load_state(evidence):
    path = state_path(evidence)
    return json.loads(path.read_text()) if path.is_file() else None


def build(evidence):
    print("Building the focused XCUITest before any simulator exists.", flush=True)
    # A generic destination has no active architecture, so ARCHS names the runner's own.
    command = [
        "xcodebuild", "-project", "HPStudio.xcodeproj", "-scheme", "HPStudio",
        "-configuration", "Debug", "-destination", "generic/platform=iOS Simulator",
        "-derivedDataPath", str(evidence / "DerivedData"),
        f"ARCHS={os.uname().machine}", "ONLY_ACTIVE_ARCH=YES",
        "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "build-for-testing",
    ]
    started = time.monotonic()
    with (evidence / "build.log").open("w") as stream:
        status = subprocess.run(command, cwd=ROOT / "ios", stdout=stream, stderr=subprocess.STDOUT).returncode
    record(evidence, step="build", command="xcodebuild build-for-testing", outcome=f"exit {status}",
           seconds=round(time.monotonic() - started, 1))
    if status:
        print("\n".join((evidence / "build.log").read_text(errors="replace").splitlines()[-80:]), flush=True)
        raise RuntimeError(f"build-for-testing failed: exit {status}")


def boot(evidence):
    sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], text=True, timeout=30).strip()
    # The first simctl call mounts the hosted runner's preinstalled runtime images.
    # https://github.com/actions/runner-images/issues/15247
    print(f"Discovering installed iOS {sdk} simulator runtimes.", flush=True)
    runtimes = simctl(evidence, "boot", ["list", "runtimes", "--json"], timeout=180)
    device_type, runtime = subprocess.check_output(
        ["python3", str(ROOT / "scripts/select-ios-simulator.py"), sdk],
        input=runtimes, text=True, timeout=30,
    ).split()
    device = str(uuid.UUID(simctl(evidence, "boot", ["create", "HP-Studio-Approval-Push", device_type, runtime], timeout=30))).upper()
    # The cleanup step reads this even when a later call in this step hangs.
    state_path(evidence).write_text(json.dumps({"device": device}) + "\n")
    devices = json.loads(simctl(evidence, "boot", ["list", "devices", device, "--json"], timeout=30))["devices"]
    data = next(row["dataPath"] for rows in devices.values() for row in rows if row["udid"] == device)
    state_path(evidence).write_text(json.dumps({"device": device, "data": data}) + "\n")
    print(f"Booting the owned iOS Simulator: {device}", flush=True)
    simctl(evidence, "boot", ["boot", device], timeout=60, capture=False)
    # A cold GitHub macOS runner can take over two minutes to initialize.
    simctl(evidence, "boot", ["bootstatus", device, "-b"], timeout=240, capture=False)
    # Exercise the launch path once with a system app, never the app under test,
    # so the XCUITest still starts from a fresh install.
    simctl(evidence, "warm-up", ["launch", device, "com.apple.Preferences"], timeout=60)
    simctl(evidence, "warm-up", ["terminate", device, "com.apple.Preferences"], timeout=30, check=False)
    print("Simulator booted and warmed up.", flush=True)


def export_screenshots(evidence):
    names = ("approval-push-system-notification", "approval-push-matching-read-only-detail")
    with TemporaryDirectory() as path:
        exported = Path(path)
        subprocess.run(
            ["xcrun", "xcresulttool", "export", "attachments", "--path", str(evidence / "ApprovalPush.xcresult"),
             "--output-path", path],
            check=True, timeout=60, stdout=subprocess.DEVNULL,
        )
        manifest = json.loads((exported / "manifest.json").read_text())
        attachments = [item for test in manifest for item in test["attachments"]]
        for name in names:
            matches = [Path(item["exportedFileName"]).name for item in attachments
                       if item["suggestedHumanReadableName"].startswith(name + "_")
                       and item["exportedFileName"].endswith(".png")]
            if len(matches) != 1:
                raise RuntimeError(f"Expected one screenshot named {name}, found {len(matches)}")
            shutil.copyfile(exported / matches[0], evidence / f"{name}.png")


def run(evidence):
    state = load_state(evidence)
    if not state or "data" not in state:
        raise RuntimeError("No booted owned simulator; the boot step did not finish")
    device = state["device"]
    app_containers = Path(state["data"]) / "Containers/Data/Application"
    xctestruns = sorted((evidence / "DerivedData/Build/Products").glob("*.xctestrun"))
    if len(xctestruns) != 1:
        raise RuntimeError(f"Expected one .xctestrun from the build step, found {len(xctestruns)}")
    log = evidence / "xcodebuild.log"
    process = None
    command = [
        "xcodebuild", "-xctestrun", str(xctestruns[0]), "-destination", f"platform=iOS Simulator,id={device}",
        "-resultBundlePath", str(evidence / "ApprovalPush.xcresult"),
        "-parallel-testing-enabled", "NO", "-testLanguage", "en", "-testRegion", "US",
        f"-only-testing:{CHECK}", "test-without-building",
    ]
    try:
        print("Running the focused XCUITest.", flush=True)
        started = time.monotonic()
        with log.open("w") as stream:
            process = subprocess.Popen(command, cwd=ROOT / "ios", stdout=stream, stderr=subprocess.STDOUT,
                                       env={**os.environ, "TEST_RUNNER_HP_APPROVAL_PUSH_SIMULATOR": "1"})
            deadline = time.monotonic() + 540
            while process.poll() is None and time.monotonic() < deadline:
                # The device is fresh, and only this XCTest writes the marker.
                # Avoid an IPC request to CoreSimulator while Xcode launches the test.
                if next(app_containers.glob("*/Documents/approval-push-ready"), None):
                    record(evidence, step="run", command="checkpoint", outcome="reached",
                           seconds=round(time.monotonic() - started, 1))
                    print("Injecting the OS approval notification into the owned simulator.", flush=True)
                    # A hosted simulator may delay accepting the system notification.
                    # Keep this below the XCTest's Home banner wait.
                    simctl(evidence, "inject", ["push", device, BUNDLE, "-"], input=json.dumps(PAYLOAD), timeout=120)
                    status = process.wait(timeout=120)
                    record(evidence, step="run", command="xcodebuild test-without-building", outcome=f"exit {status}",
                           seconds=round(time.monotonic() - started, 1))
                    if status == 0:
                        export_screenshots(evidence)
                        print("PASS: system alert tapped, matching read-only card opened.", flush=True)
                        return
                    raise RuntimeError(f"XCUITest failed: exit {status}")
                time.sleep(0.5)
            raise RuntimeError(f"XCUITest did not reach its background notification checkpoint (exit {process.poll()})")
    except Exception:
        with (evidence / "simulator-notifications.log").open("w") as system_log:
            system_log.write(bounded(["xcrun", "simctl", "spawn", device, "log", "show", "--last", "3m", "--info", "--style", "compact",
                                      "--predicate", 'subsystem BEGINSWITH[c] "com.apple.usernotifications" OR eventMessage CONTAINS[c] "Approval push fixture"'],
                                     limit=20))
        if log.exists():
            print("\n".join(log.read_text(errors="replace").splitlines()[-115:]), flush=True)
        raise
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def cleanup(evidence):
    state = load_state(evidence)
    if not state:
        print("No owned simulator to clean up.", flush=True)
        return
    for action in ("shutdown", "delete"):
        try:
            simctl(evidence, "cleanup", [action, state["device"]], timeout=30, capture=False, check=False)
        except SimctlHang as error:
            # Cleanup never replaces the result of the steps before it.
            print(f"Owned simulator {action}: {error}", flush=True)
    state_path(evidence).unlink(missing_ok=True)


STEPS = {"build": build, "boot": boot, "run": run, "cleanup": cleanup}


def main(argv):
    evidence = evidence_dir()
    if not argv:
        try:
            for step in ("build", "boot", "run"):
                STEPS[step](evidence)
        finally:
            cleanup(evidence)
        return
    if len(argv) != 1 or argv[0] not in STEPS:
        raise SystemExit("usage: verify-approval-push-simulator.py [build|boot|run|cleanup]")
    STEPS[argv[0]](evidence)


if __name__ == "__main__":
    main(sys.argv[1:])
