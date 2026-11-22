"""Inject one Simulator OS notification while the targeted XCUITest waits.

Steps, each a separate CI step so the log shows where time goes and where a hang starts:
  build    build-for-testing before any simulator exists (compilation never competes with
           simulator IPC on the runner)
  boot     create, boot and warm up the owned simulator
  run      test-without-building, inject the notification at the test's checkpoint
  cleanup  shut down and delete the owned simulator
No argument runs all four in order, for local use.

Two more steps cache a simulator that has already booted once (#4432):
  seed     (separate CI job on main) create, boot, wait until the first-boot work has
           stopped, time one speechVoices() call on it (ios-speech-probe.swift; recorded
           only), shut down, and archive the device folder for actions/cache
  restore  (approval push job, before any simctl call) unpack a cached device into the
           CoreSimulator device set. The boot step uses it only when CoreSimulatorService
           lists it as an available, shut-down device; otherwise it records why and
           creates a new device exactly as before. A cache never decides the test result.

Every simctl call keeps its existing time limit. When one does not return in time, the step
records what the runner was doing (processes, load, samples of the stuck simctl and of
CoreSimulatorService, the host CoreSimulator log) in simctl-hang-<step>.txt and fails with
the step's name. Limits are never raised to hide a hang.

`bootstatus -b` returns before a new device finishes its first-boot work, and on the 3-CPU,
7 GB hosted runner that work can last minutes (run 44879419945: still 267 device processes, 30
runnable, 415 s after boot). The boot step records a few `ps` samples of it before the warm-up,
for observation only: they wait for nothing and decide nothing.
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
# Observation only: a fixed number of samples, never a wait for a condition.
OBSERVE_SAMPLES = 3
OBSERVE_INTERVAL = 5
# The seed job's own wait for first-boot work to stop. A new limit in a new job; the
# approval push job never waits on it. The iOS real-voice job (ios-sim-observe.py settle) uses
# the same wait and limit before its one test.
SEED_SETTLE_LIMIT = 900
SEED_SETTLE_INTERVAL = 5
SEED_SETTLE_SAMPLES = 3
# While the seed waits, the 40 busiest processes go to simulator-ps.txt about once a minute, so
# a long tail of first-boot work (run 44936067384: 40-90 runnable for 4+ minutes) has names.
SEED_TABLE_EVERY = 60
SEED_TABLE_ROWS = 40
# /2: the seed also times one speechVoices() call on the settled device (ios-speech-probe.swift).
SEED_SCHEMA = "hps-ios-sim-seed/2"
# The seed's speech probe: new bounds on a new, measurement-only step. Its result is recorded
# and never decides the seed (#4432: speechVoices() blocked 160+ s in UI shards).
SPEECH_PROBE_BUILD_LIMIT = 180
SPEECH_PROBE_LIMIT = 240
# Device daemons on the TextToSpeech / accessibility path, read from each observation row.
SPEECH_DAEMONS = ("axassetsd", "sirittsd", "mobileassetd", "AccessibilityUIServer", "corespeechd", "assistantd")
PS_TABLE = ["ps", "-axro", "pid,ppid,stat,etime,%cpu,%mem,command"]
DEVICE_NAME = "HP-Studio-Approval-Push"


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


def diagnose(evidence, step, stuck_pid, stuck_label="stuck simctl"):
    processes = bounded(["ps", "-axo", "pid,ppid,stat,etime,%cpu,%mem,command"])
    keys = ("CoreSimulator", "simctl", "launchd_sim", "xcodebuild", "XCTest", "SimulatorTrampoline", "xctrunner")
    related = [line for line in processes.splitlines() if any(key in line for key in keys)]
    service = [line.split()[0] for line in related if "CoreSimulatorService" in line]
    # Host-wide, so a load that is not the simulator's (a build service, indexing) is visible too.
    busiest = bounded(["ps", "-axro", "pid,ppid,stat,etime,%cpu,%mem,command"]).splitlines()[:41]
    sections = [
        ("step", step),
        ("load", bounded(["sysctl", "-n", "vm.loadavg"])),
        ("memory", bounded(["vm_stat"])),
        ("busiest host processes", "\n".join(line[:240] for line in busiest)),
        ("simulator-related processes", "\n".join(related)),
    ]
    if stuck_pid is not None:
        sections.append((f"sample of the {stuck_label} ({stuck_pid})", bounded(["sample", str(stuck_pid), "2", "-mayDie"])))
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


def device_activity(processes, device):
    """(processes started by the device's launchd_sim, how many of them are runnable)."""
    rows = [line.split(None, 3) for line in processes.splitlines()]
    rows = [row for row in rows if len(row) == 4]
    launchd = [pid for pid, _, _, command in rows
               if command.startswith("launchd_sim ") and f"/Devices/{device}/" in command]
    if len(launchd) != 1:
        return None
    children = [stat for _, ppid, stat, _ in rows if ppid == launchd[0]]
    return len(children), sum(stat.startswith("R") for stat in children)


def device_daemons(table, device):
    """State, elapsed time and %CPU of each SPEECH_DAEMONS process the device's launchd_sim started.

    `table` is PS_TABLE output. Every name is present; an empty list means not running.
    """
    rows = [line.split(None, 6) for line in table.splitlines()]
    rows = [row for row in rows if len(row) == 7 and row[0].isdigit()]
    launchd = [row[0] for row in rows if row[6].startswith("launchd_sim ") and f"/Devices/{device}/" in row[6]]
    found = {name: [] for name in SPEECH_DAEMONS}
    if len(launchd) != 1:
        return found
    for pid, ppid, stat, etime, cpu, _, command in rows:
        if ppid != launchd[0]:
            continue
        # The runtime path can hold spaces ("iOS 27.2.simruntime"), so match the executable's name.
        name = command.split("/RuntimeRoot/", 1)[-1].split(" -", 1)[0].rsplit("/", 1)[-1].strip()
        if name in found:
            found[name].append({"stat": stat, "etime": etime, "cpu": float(cpu)})
    return found


def observe(evidence, device, *, samples=OBSERVE_SAMPLES, interval=OBSERVE_INTERVAL):
    """Record the device's first-boot activity with `ps` only. Waits for nothing, decides nothing."""
    started = time.monotonic()
    for index in range(samples):
        if index:
            time.sleep(interval)
        activity = device_activity(bounded(["ps", "-axo", "pid=,ppid=,stat=,command="]), device)
        record(evidence, step="boot", command="observe", outcome="sample",
               processes=None if activity is None else activity[0],
               runnable=None if activity is None else activity[1],
               seconds=round(time.monotonic() - started, 1))


def is_settled(samples, cpus):
    """Settled: the last samples start no new device process and keep runnable ones within the CPUs."""
    recent = samples[-SEED_SETTLE_SAMPLES:]
    if len(recent) < SEED_SETTLE_SAMPLES or None in recent:
        return False
    return len({count for count, _ in recent}) == 1 and all(runnable <= cpus for _, runnable in recent)


def seed_table(evidence, table, device, sample, seconds, step="seed"):
    """Append one seed reading to simulator-ps.txt: the busiest host processes, then every
    runnable process of the device (starved ones sit at 0 % CPU and miss the busiest list)."""
    lines = table.splitlines()
    rows = [line.split(None, 6) for line in lines]
    launchd = [r[0] for r in rows if len(r) == 7 and r[6].startswith("launchd_sim ") and f"/Devices/{device}/" in r[6]]
    runnable = [line for line, r in zip(lines, rows)
                if launchd and len(r) == 7 and r[1] == launchd[0] and r[2].startswith("R")]
    with (evidence / "simulator-ps.txt").open("a") as target:
        target.write(f"== {step} sample {sample} {seconds}s\n")
        target.write("\n".join(lines[:SEED_TABLE_ROWS + 1]) + "\n")
        target.write(f"-- runnable device processes: {len(runnable)}\n")
        target.write("".join(line + "\n" for line in runnable))


def wait_settled(evidence, device, *, limit=SEED_SETTLE_LIMIT, interval=SEED_SETTLE_INTERVAL, table_every=SEED_TABLE_EVERY,
                 step="seed"):
    """Seed and real-voice jobs only: wait until the new device stops its first-boot work. Reads `ps` only."""
    cpus = os.cpu_count() or 1
    started = time.monotonic()
    samples = []
    table_at = None
    while True:
        table = bounded(PS_TABLE)
        # The same reading as before, from the CPU-sorted table: pid, ppid, stat and command.
        rows = [line.split(None, 6) for line in table.splitlines()]
        activity = device_activity("\n".join(f"{r[0]} {r[1]} {r[2]} {r[6]}" for r in rows if len(r) == 7), device)
        samples.append(activity)
        seconds = round(time.monotonic() - started, 1)
        record(evidence, step=step, command="observe", outcome="sample",
               processes=None if activity is None else activity[0],
               runnable=None if activity is None else activity[1], seconds=seconds,
               daemons=device_daemons(table, device))
        settled = is_settled(samples, cpus)
        if table_at is None or seconds - table_at >= table_every or settled:
            seed_table(evidence, table, device, len(samples), seconds, step)
            table_at = seconds
        if settled:
            record(evidence, step=step, command="settle", limit=limit, outcome="settled", seconds=seconds)
            return seconds, activity
        if time.monotonic() - started + interval > limit:
            record(evidence, step=step, command="settle", limit=limit, outcome="timeout", seconds=seconds)
            diagnose(evidence, step, None)
            raise SimctlHang(f"{step} simulator first-boot work did not settle within {limit}s")
        time.sleep(interval)


def speech_probe(evidence, device, *, build_limit=SPEECH_PROBE_BUILD_LIMIT, limit=SPEECH_PROBE_LIMIT, xcrun="xcrun", step="seed"):
    """Seed and real-voice jobs only: time one speechVoices() call on the settled device. Recorded only; never raises."""
    try:
        return _speech_probe(evidence, device, build_limit, limit, xcrun, step)
    except Exception as error:  # A probe failure never decides the seed or the voice job.
        row = {"step": step, "command": "speech-probe", "outcome": "error", "detail": str(error)[:400]}
        record(evidence, **row)
        return row


def _speech_probe(evidence, device, build_limit, limit, xcrun, step):
    sdk = subprocess.check_output([xcrun, "--sdk", "iphonesimulator", "--show-sdk-version"], text=True, timeout=30).strip()
    binary = evidence / "ios-speech-probe"
    started = time.monotonic()
    try:
        built = subprocess.run([xcrun, "--sdk", "iphonesimulator", "swiftc", "-target", f"{os.uname().machine}-apple-ios{sdk}-simulator",
                                "-O", str(ROOT / "scripts/ios-speech-probe.swift"), "-o", str(binary)],
                               capture_output=True, text=True, timeout=build_limit)
        outcome = f"exit {built.returncode}"
    except subprocess.TimeoutExpired:
        built, outcome = None, "timeout"
    record(evidence, step=step, command="speech-probe-build", limit=build_limit, outcome=outcome,
           seconds=round(time.monotonic() - started, 1),
           **({"detail": (built.stderr or "")[-400:]} if built is not None and built.returncode else {}))
    if outcome != "exit 0":
        return {"outcome": f"build {outcome}"}
    before = device_daemons(bounded(PS_TABLE), device)
    started = time.monotonic()
    child = subprocess.Popen([xcrun, "simctl", "spawn", device, str(binary)], stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        out, _ = child.communicate(timeout=limit)
    except subprocess.TimeoutExpired:
        seconds = round(time.monotonic() - started, 1)
        # The probe runs under the device's launchd_sim, not under simctl: sample it by name.
        stuck = bounded(["pgrep", "-x", binary.name]).split()
        stuck = stuck[0] if stuck and stuck[0].isdigit() else None
        row = {"step": step, "command": "speech-probe", "limit": limit, "outcome": "timeout", "seconds": seconds,
               "daemons_before": before, "daemons_at_limit": device_daemons(bounded(PS_TABLE), device)}
        record(evidence, **row)
        diagnose(evidence, "speech-probe", stuck, "speech probe")
        stop_group(child)
        child.stdout.close()
        if stuck:
            try:
                os.kill(int(stuck), signal.SIGKILL)
            except ProcessLookupError:
                pass
        return {"outcome": "timeout", "seconds": seconds}
    seconds = round(time.monotonic() - started, 1)
    lines = [line for line in (out or "").splitlines() if line.startswith("{")]
    try:
        reading = json.loads(lines[-1]) if lines else {}
    except ValueError:
        reading = {}
    row = {"step": step, "command": "speech-probe", "limit": limit, "outcome": f"exit {child.returncode}",
           "seconds": seconds, "call_milliseconds": reading.get("milliseconds"), "voices": reading.get("voices"),
           "ko_KR": reading.get("ko_KR"), "daemons_before": before, "daemons_after": device_daemons(bounded(PS_TABLE), device)}
    if not reading:
        row["detail"] = (out or "")[-400:]
    record(evidence, **row)
    print(f"{step}: speechVoices() probe {row['outcome']} in {seconds}s ({row['voices']} voices)", flush=True)
    return {k: row[k] for k in ("outcome", "seconds", "call_milliseconds", "voices")}


def cache_key(environ=os.environ):
    """One key for the seed job and the approval push job: runner image, Xcode, device choice."""
    import hashlib
    digest = hashlib.sha256(SEED_SCHEMA.encode() + (ROOT / "scripts/select-ios-simulator.py").read_bytes()
                            + (ROOT / "scripts/ios-speech-probe.swift").read_bytes()).hexdigest()[:16]
    xcode = Path(environ.get("DEVELOPER_DIR", "default")).parents[1].name if environ.get("DEVELOPER_DIR") else "default"
    parts = ["ios-sim-preboot-v1", environ.get("ImageOS", "local"), environ.get("ImageVersion", "local"),
             os.uname().machine, xcode, digest]
    return "-".join(part.replace(" ", "_") for part in parts)


def seed_dir():
    return Path(os.environ.get("HP_SIM_SEED_DIR", ROOT / "evidence/sim-seed")).resolve()


def devices_root():
    return Path.home() / "Library/Developer/CoreSimulator/Devices"


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


def listed_device(evidence, step, device):
    """The device row CoreSimulatorService reports for this UDID, or None."""
    devices = json.loads(simctl(evidence, step, ["list", "devices", device, "--json"], timeout=30))["devices"]
    rows = [row for rows in devices.values() for row in rows if row["udid"] == device]
    return rows[0] if len(rows) == 1 else None


def create_device(evidence, step):
    sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], text=True, timeout=30).strip()
    # The first simctl call mounts the hosted runner's preinstalled runtime images.
    # https://github.com/actions/runner-images/issues/15247
    print(f"Discovering installed iOS {sdk} simulator runtimes.", flush=True)
    runtimes = simctl(evidence, step, ["list", "runtimes", "--json"], timeout=180)
    device_type, runtime = subprocess.check_output(
        ["python3", str(ROOT / "scripts/select-ios-simulator.py"), sdk],
        input=runtimes, text=True, timeout=30,
    ).split()
    device = str(uuid.UUID(simctl(evidence, step, ["create", DEVICE_NAME, device_type, runtime], timeout=30))).upper()
    # The cleanup step reads this even when a later call in this step hangs.
    state_path(evidence).write_text(json.dumps({"device": device}) + "\n")
    data = listed_device(evidence, step, device)["dataPath"]
    state_path(evidence).write_text(json.dumps({"device": device, "data": data}) + "\n")
    return device, device_type, runtime


def adopt_restored(evidence, device):
    """Use a restored device only when CoreSimulatorService itself lists it as ready to boot."""
    row = listed_device(evidence, "boot", device)
    if row is None:
        reason = "not listed by CoreSimulatorService"
    elif row.get("isAvailable") is not True:
        reason = f"listed but unavailable: {row.get('availabilityError', 'no reason given')}"
    elif row.get("state") != "Shutdown":
        reason = f"listed in state {row.get('state')}"
    else:
        record(evidence, step="boot", command="cache", outcome="accepted", device=device)
        state_path(evidence).write_text(json.dumps({"device": device, "data": row["dataPath"], "restored": device}) + "\n")
        print(f"Using the restored once-booted simulator: {device}", flush=True)
        return True
    record(evidence, step="boot", command="cache", outcome="rejected", reason=reason, device=device)
    print(f"Restored simulator not used ({reason}); creating a new one.", flush=True)
    if row is None:
        # CoreSimulatorService does not know the folder, so removing it touches no device it owns.
        shutil.rmtree(devices_root() / device, ignore_errors=True)
    else:
        simctl(evidence, "boot", ["delete", device], timeout=30, check=False)
    return False


def boot(evidence):
    state = load_state(evidence) or {}
    restored = state.get("restored")
    if not (restored and adopt_restored(evidence, restored)):
        create_device(evidence, "boot")
    device = load_state(evidence)["device"]
    print(f"Booting the owned iOS Simulator: {device}", flush=True)
    simctl(evidence, "boot", ["boot", device], timeout=60, capture=False)
    # A cold GitHub macOS runner can take over two minutes to initialize.
    simctl(evidence, "boot", ["bootstatus", device, "-b"], timeout=240, capture=False)
    observe(evidence, device)
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
    if not state or "device" not in state:
        print("No owned simulator to clean up.", flush=True)
        return
    for action in ("shutdown", "delete"):
        try:
            simctl(evidence, "cleanup", [action, state["device"]], timeout=30, capture=False, check=False)
        except SimctlHang as error:
            # Cleanup never replaces the result of the steps before it.
            print(f"Owned simulator {action}: {error}", flush=True)
    state_path(evidence).unlink(missing_ok=True)


def restore(evidence, source=None):
    """Unpack a cached once-booted device before any simctl call. Never fails the job."""
    source = source or seed_dir()
    meta_path, archive = source / "seed.json", source / "device.tar"
    if not (meta_path.is_file() and archive.is_file()):
        record(evidence, step="restore", command="cache", outcome="miss")
        print("No cached once-booted simulator; the boot step creates a new one.", flush=True)
        return
    meta = json.loads(meta_path.read_text())
    device = str(uuid.UUID(meta["device"])).upper()
    # Whether the service already runs decides whether it can discover the folder at start.
    running = subprocess.run(["pgrep", "-x", "com.apple.CoreSimulator.CoreSimulatorService"],
                             stdout=subprocess.DEVNULL).returncode == 0
    target = devices_root() / device
    if meta.get("schema") != SEED_SCHEMA or target.exists():
        record(evidence, step="restore", command="cache", outcome="rejected", device=device,
               reason="unknown seed schema" if meta.get("schema") != SEED_SCHEMA else "device folder already exists")
        return
    devices_root().mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    status = subprocess.run(["tar", "-C", str(devices_root()), "-xf", str(archive)], timeout=300).returncode
    seconds = round(time.monotonic() - started, 1)
    if status or not (target / "device.plist").is_file():
        shutil.rmtree(target, ignore_errors=True)
        record(evidence, step="restore", command="cache", outcome="rejected", device=device,
               reason=f"tar exit {status}", seconds=seconds)
        return
    record(evidence, step="restore", command="cache", outcome="restored", device=device, seconds=seconds,
           archive_bytes=archive.stat().st_size, service_running_before=running)
    state_path(evidence).write_text(json.dumps({"restored": device}) + "\n")
    print(f"Restored once-booted simulator {device} in {seconds}s.", flush=True)


def seed(evidence, destination=None):
    """Seed job: archive a device that has booted once and finished its first-boot work."""
    destination = destination or seed_dir()
    device, device_type, runtime = create_device(evidence, "seed")
    try:
        simctl(evidence, "seed", ["boot", device], timeout=60, capture=False)
        simctl(evidence, "seed", ["bootstatus", device, "-b"], timeout=240, capture=False)
        settle_seconds, activity = wait_settled(evidence, device)
        probe = speech_probe(evidence, device)
        simctl(evidence, "seed", ["shutdown", device], timeout=30, capture=False)
        destination.mkdir(parents=True, exist_ok=True)
        partial = destination / "device.tar.partial"
        started = time.monotonic()
        subprocess.run(["tar", "-C", str(devices_root()), "-cf", str(partial), device], check=True, timeout=600)
        archive_seconds = round(time.monotonic() - started, 1)
        partial.rename(destination / "device.tar")
        meta = {"schema": SEED_SCHEMA, "device": device, "device_type": device_type, "runtime": runtime,
                "settle_seconds": settle_seconds, "settled_processes": activity[0],
                "settled_runnable": activity[1], "archive_seconds": archive_seconds,
                "archive_bytes": (destination / "device.tar").stat().st_size, "speech_probe": probe}
        (destination / "seed.json").write_text(json.dumps(meta, indent=2) + "\n")
        record(evidence, step="seed", command="archive", outcome="saved", **{k: meta[k] for k in ("archive_bytes", "archive_seconds")})
        print(f"Seeded {device}: {meta['archive_bytes']} bytes after {settle_seconds}s of settling.", flush=True)
    finally:
        cleanup(evidence)


STEPS = {"build": build, "boot": boot, "run": run, "cleanup": cleanup, "restore": restore, "seed": seed}


def main(argv):
    if argv == ["cache-key"]:
        key = cache_key()
        print(key)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write(f"key={key}\n")
        return
    evidence = evidence_dir()
    if not argv:
        try:
            for step in ("build", "boot", "run"):
                STEPS[step](evidence)
        finally:
            cleanup(evidence)
        return
    if len(argv) != 1 or argv[0] not in STEPS:
        raise SystemExit("usage: verify-approval-push-simulator.py [build|boot|run|cleanup|restore|seed|cache-key]")
    STEPS[argv[0]](evidence)


if __name__ == "__main__":
    main(sys.argv[1:])
