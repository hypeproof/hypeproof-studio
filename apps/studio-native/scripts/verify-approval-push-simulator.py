"""Inject one Simulator OS notification while the targeted XCUITest waits."""
import json
import os
from pathlib import Path
import subprocess
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


def output(args, *, timeout=30):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def main():
    evidence = Path(os.environ.get("HP_APPROVAL_PUSH_EVIDENCE", ROOT / "evidence/approval-push")).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    sdk = output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"])
    # The first simctl call mounts the hosted runner's preinstalled runtime images.
    # https://github.com/actions/runner-images/issues/15247
    print(f"Discovering installed iOS {sdk} simulator runtimes.", flush=True)
    runtimes = output(["xcrun", "simctl", "list", "runtimes", "--json"], timeout=180)
    device_type, runtime = subprocess.check_output(
        ["python3", str(ROOT / "scripts/select-ios-simulator.py"), sdk],
        input=runtimes, text=True, timeout=30,
    ).split()
    simctl = ["xcrun", "simctl"]
    device = str(uuid.UUID(output([*simctl, "create", "HP-Studio-Approval-Push", device_type, runtime]))).upper()
    log = evidence / "xcodebuild.log"
    process = None
    try:
        devices = json.loads(output([*simctl, "list", "devices", device, "--json"]))["devices"]
        device_data = next(Path(record["dataPath"]) for records in devices.values() for record in records
                           if record["udid"] == device)
        app_containers = device_data / "Containers/Data/Application"
        print(f"Booting the owned iOS Simulator: {device}", flush=True)
        subprocess.run([*simctl, "boot", device], check=True, timeout=60)
        # A cold GitHub macOS runner can take over two minutes to initialize.
        subprocess.run([*simctl, "bootstatus", device, "-b"], check=True, timeout=240)
        print("Simulator booted. Building and running the focused XCUITest.", flush=True)
        command = [
            "xcodebuild", "-project", "HPStudio.xcodeproj", "-scheme", "HPStudio",
            "-configuration", "Debug", "-destination", f"platform=iOS Simulator,id={device}",
            "-derivedDataPath", str(evidence / "DerivedData"),
            "-resultBundlePath", str(evidence / "ApprovalPush.xcresult"),
            "-parallel-testing-enabled", "NO", "-testLanguage", "en", "-testRegion", "US",
            f"-only-testing:{CHECK}", "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-",
            "test",
        ]
        with log.open("w") as stream:
            process = subprocess.Popen(command, cwd=ROOT / "ios", stdout=stream, stderr=subprocess.STDOUT,
                                       env={**os.environ, "TEST_RUNNER_HP_APPROVAL_PUSH_SIMULATOR": "1"})
            deadline = time.monotonic() + 540
            while process.poll() is None and time.monotonic() < deadline:
                # The device is fresh, and only this XCTest writes the marker.
                # Avoid an IPC request to CoreSimulator while Xcode launches the test.
                if next(app_containers.glob("*/Documents/approval-push-ready"), None):
                    print("Injecting the OS approval notification into the owned simulator.", flush=True)
                    subprocess.run([*simctl, "push", device, BUNDLE, "-"], input=json.dumps(PAYLOAD),
                                   text=True, check=True, timeout=30)
                    status = process.wait(timeout=120)
                    if status == 0:
                        print("PASS: system alert tapped, matching read-only card opened.", flush=True)
                        return
                    raise RuntimeError(f"XCUITest failed: exit {status}")
                time.sleep(0.5)
            raise RuntimeError(f"XCUITest did not reach its background notification checkpoint (exit {process.poll()})")
    except Exception:
        try:
            with (evidence / "simulator-notifications.log").open("w") as system_log:
                subprocess.run([*simctl, "spawn", device, "log", "show", "--last", "3m", "--info", "--style", "compact",
                                "--predicate", 'subsystem BEGINSWITH[c] "com.apple.usernotifications" OR eventMessage CONTAINS[c] "Approval push fixture"'],
                               stdout=system_log, stderr=subprocess.STDOUT, timeout=20, check=False)
        except subprocess.TimeoutExpired:
            print("Timed out collecting the owned simulator's notification log.", flush=True)
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
        for action in ("shutdown", "delete"):
            try:
                subprocess.run([*simctl, action, device], timeout=30, check=False)
            except subprocess.TimeoutExpired:
                print(f"Owned simulator {action} timed out: {device}", flush=True)


if __name__ == "__main__":
    main()
