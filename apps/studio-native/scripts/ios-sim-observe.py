#!/usr/bin/env python3
"""Record how an iOS UI shard's simulator boots and runs, for observation only (#4432).

`time` runs one command unchanged (same arguments, no limit added), passes its exit code
through, and records its duration. `sample` takes one reading: the device's process and
runnable counts, its age since boot (launchd_sim elapsed time), the state, elapsed time and
%CPU of the speech/accessibility daemons (push.SPEECH_DAEMONS), wall-clock time, load and free
memory, from one `ps` call and `vm_stat`. `watch` takes a reading every interval until
it is stopped; the shard starts it beside the test and stops it when the test ends, so the
test never waits for it. A reading that cannot be taken is recorded as `timeout` or
`no device`, never raised.

`settle` is the one command here that waits. Only the real-voice row of the shard plan runs it
(ios-verify.sh, #4432): the seed job's settle wait with its limit (push.SEED_SETTLE_LIMIT), then
one speech probe so the device's voice list is loaded before the test. It writes
<evidence>/voice-settle.json and prints both times. A settle timeout is recorded and the test
still runs; the test alone decides the job.

`terminate-watch` runs beside the test like `watch`. Every few seconds it reads the shard's
xcodebuild log; for each new "Failed to terminate <bundle>:<pid>" line, or "Application '<bundle>' does not
have a process ID" after a launch that stalled at its "Terminate <bundle>:<pid>" step (at most
TERMINATE_CAPTURES per shard) it records, while the device is still in that state, the
device's `launchctl list` rows for the app and the last 3 minutes of runningboardd,
SpringBoard and testmanagerd log, each with its own limit. `terminate-scan` is the same pass
once, after the test, for a line the watcher was stopped before reaching. Output goes to
<evidence>/terminate-diagnostics.txt plus one row per capture. Both are diagnostics only:
they change no test, wait, limit or result (#4432 F6).

`stall-watch` runs beside the test like `terminate-watch`. For each new main-thread stall that the
app reports while it is still going on ("HPStudio main stall (ongoing): ... since uptime <start>"),
at most STALL_CAPTURES per shard, it runs `sample` on this shard's app process for
SAMPLE_SECONDS, with its own limit, so the main thread's stack during the stall is recorded
(#4432 F11). The app names its own pid in the line ("; pid <n>;"), so no process table is read
(run 45132515641: `ps -axo` did not return within its limit on a saturated host). Only a line
without a valid pid falls back to `ps`: the newest host HPStudio whose executable is under this
shard's simulator device, so another shard or simulator on the same host is never sampled. Samples go to <evidence>/stall-sample-<n>.txt, with one header in
<evidence>/stall-samples.txt and one row per capture. Diagnostics only, like the others.

Rows go to <evidence>/simulator-steps.jsonl in the format the approval push job writes.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("approval_push", HERE / "verify-approval-push-simulator.py")
push = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(push)

# One ps call per reading, sorted by CPU, so the busiest processes come first.
PS = push.PS_TABLE
BUSIEST = 40


def etime_seconds(value):
    """ps elapsed time `[[dd-]hh:]mm:ss` in seconds, or None."""
    match = re.fullmatch(r"(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)", value)
    if not match:
        return None
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


def device_reading(table, device):
    """(processes, runnable, seconds since boot) for this device, or None when its launchd_sim is absent."""
    rows = [line.split(None, 6) for line in table.splitlines()[1:]]
    rows = [row for row in rows if len(row) == 7]
    launchd = [row for row in rows if row[6].startswith("launchd_sim ") and f"/Devices/{device}/" in row[6]]
    if len(launchd) != 1:
        return None
    pid, age = launchd[0][0], etime_seconds(launchd[0][3])
    children = [row[2] for row in rows if row[1] == pid]
    return len(children), sum(stat.startswith("R") for stat in children), age


def free_pages(vm_stat):
    match = re.search(r"^Pages free:\s+(\d+)\.", vm_stat, re.MULTILINE)
    return int(match[1]) if match else None


def take(evidence, device, *, step, sample, full_table):
    wall = datetime.now(timezone.utc).isoformat(timespec="seconds")
    table = push.bounded(PS)
    vm_stat = push.bounded(["vm_stat"])
    row = {"step": step, "command": "observe", "sample": sample, "utc": wall,
           "loadavg": push.bounded(["sysctl", "-n", "vm.loadavg"]).strip(), "free_pages": free_pages(vm_stat)}
    if table.startswith("<"):
        # bounded() reports a ps that did not return within its limit this way.
        row.update(outcome="timeout", detail=table.strip())
    else:
        reading = device_reading(table, device)
        if reading is None:
            row.update(outcome="no device")
        else:
            # The speech/accessibility daemons are often runnable at 0 % CPU, so they never reach
            # the busiest-process table; each row names their state directly.
            row.update(outcome="sample", processes=reading[0], runnable=reading[1], device_age_seconds=reading[2],
                       daemons=push.device_daemons(table, device))
    push.record(evidence, **row)
    lines = table.splitlines()
    with (evidence / "simulator-ps.txt").open("a") as target:
        target.write(f"== {step} sample {sample} {wall}\n")
        target.write("\n".join(lines if full_table else lines[:BUSIEST + 1]) + "\n")
    with (evidence / "simulator-vmstat.txt").open("a") as target:
        target.write(f"== {step} sample {sample} {wall}\n{vm_stat}\n")


TERMINATE_FAILURE = re.compile(r"Failed to terminate ([A-Za-z0-9.-]+):(\d+)")
# A launch that hangs in its own "Terminate <bundle>:<pid>" step ends, after the time allowance, with
# "Application '<bundle>' does not have a process ID" (run 45116092106 shard 1). That pid is the one used.
TERMINATE_STEP = re.compile(r"\bTerminate ([A-Za-z0-9.-]+):(\d+)\s*$")
NO_PROCESS = re.compile(r"Application '([A-Za-z0-9.-]+)' does not have a process ID")
TERMINATE_CAPTURES = 3
LAUNCHCTL_LIMIT = 30
LOG_SHOW_LIMIT = 60
LOG_SHOW_WINDOW = "3m"
LOG_SHOW_PREDICATE = 'process IN {"runningboardd", "SpringBoard", "testmanagerd"}'
TERMINATE_FILE = "terminate-diagnostics.txt"
STALL_ONGOING = re.compile(r"HPStudio main stall \(ongoing\): \d+ ms since uptime (\d+) ms")
STALL_PID = re.compile(r"HPStudio main stall \(ongoing\): \d+ ms since uptime (\d+) ms; pid ([0-9]{1,10});")
STALL_CAPTURES = 3
# One second, with -mayDie (symbols are read at once): run 45132515641 had a 3 s sample not return
# within SAMPLE_LIMIT on a saturated host.
SAMPLE_SECONDS = 1
SAMPLE_LIMIT = 30
PS_LIMIT = 10
APP_EXECUTABLE = re.compile(r"/HPStudio\.app/HPStudio(\s|$)")
STALL_FILE = "stall-samples.txt"
_running = None


def run_bounded(args, limit):
    """Like push.bounded, and the running child is known so a stopped watcher can stop it too."""
    global _running
    try:
        _running = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    start_new_session=True)
    except OSError as error:
        return f"<{args[0]} unavailable: {error}>"
    try:
        out, _ = _running.communicate(timeout=limit)
        return out
    except subprocess.TimeoutExpired:
        push.stop_group(_running)
        return f"<{' '.join(args)} did not return within {limit}s>"
    finally:
        _running = None


def stop_running(signum, _frame):
    if _running is not None:
        push.stop_group(_running)
    raise SystemExit(128 + signum)


def terminate_failures(log_text):
    """(bundle, pid) of each distinct terminate failure in order; the inner ":0" retry is not a new one.

    A "does not have a process ID" line counts with the pid of the last "Terminate <bundle>:<pid>" step."""
    seen, last_step = [], {}
    def add(bundle, pid):
        if pid != "0" and (bundle, pid) not in seen:
            seen.append((bundle, pid))
    for line in log_text.splitlines():
        step = TERMINATE_STEP.search(line)
        if step:
            last_step[step.group(1)] = step.group(2)
        for bundle, pid in TERMINATE_FAILURE.findall(line):
            add(bundle, pid)
        missing = NO_PROCESS.search(line)
        if missing and missing.group(1) in last_step:
            add(missing.group(1), last_step[missing.group(1)])
    return seen


def captured_failures(evidence):
    path = evidence / TERMINATE_FILE
    if not path.exists():
        return []
    return re.findall(r"^== terminate \d+ ([A-Za-z0-9.-]+):(\d+) ", path.read_text(), re.MULTILINE)


def capture_terminate(evidence, device, bundle, pid, index, *, run=None):
    run = run or run_bounded
    wall = datetime.now(timezone.utc).isoformat(timespec="seconds")
    launchctl = run(["xcrun", "simctl", "spawn", device, "launchctl", "list"], LAUNCHCTL_LIMIT)
    if launchctl.startswith("<"):
        app_rows, launchctl_outcome = launchctl.strip(), "timeout"
    else:
        rows = [line for line in launchctl.splitlines() if "hypeproof" in line.lower()]
        app_rows = "\n".join(rows) if rows else "<no hypeproof entry>"
        launchctl_outcome = "listed" if rows else "absent"
    log = run(["xcrun", "simctl", "spawn", device, "log", "show", "--last", LOG_SHOW_WINDOW, "--style", "compact",
               "--info", "--predicate", LOG_SHOW_PREDICATE], LOG_SHOW_LIMIT)
    log_outcome = "timeout" if log.startswith("<") else "shown"
    push.record(evidence, step="terminate", command="diagnose", sample=index, utc=wall, bundle=bundle, pid=int(pid),
                launchctl=launchctl_outcome, log=log_outcome, log_lines=len(log.splitlines()))
    with (evidence / TERMINATE_FILE).open("a") as target:
        target.write(f"== terminate {index} {bundle}:{pid} {wall}\n")
        target.write(f"-- launchctl list (hypeproof rows, limit {LAUNCHCTL_LIMIT}s)\n{app_rows}\n")
        target.write(f"-- log show --last {LOG_SHOW_WINDOW} {LOG_SHOW_PREDICATE} (limit {LOG_SHOW_LIMIT}s)\n{log.rstrip()}\n")


def scan_terminate(evidence, device, log_path, *, run=None):
    """Capture each failure in the log not yet captured, up to TERMINATE_CAPTURES. Returns how many it took."""
    try:
        text = Path(log_path).read_text(errors="replace")
    except OSError:
        return 0
    done = captured_failures(evidence)
    taken = 0
    for bundle, pid in terminate_failures(text):
        if (bundle, pid) in done:
            continue
        if len(done) >= TERMINATE_CAPTURES:
            break
        capture_terminate(evidence, device, bundle, pid, len(done) + 1, run=run)
        done.append((bundle, pid))
        taken += 1
    return taken


def stall_starts(log_text):
    """Start uptime of each distinct ongoing stall in order; its 20 s and 40 s lines are not new ones."""
    seen = []
    for start in STALL_ONGOING.findall(log_text):
        if start not in seen:
            seen.append(start)
    return seen


def stall_pids(log_text):
    """Pid that the app named for each ongoing stall start; a value that is not a valid pid is left out."""
    pids = {}
    for start, pid in STALL_PID.findall(log_text):
        value = int(pid)
        if start not in pids and 0 < value < 2 ** 31:
            pids[start] = value
    return pids


def captured_stalls(evidence):
    path = evidence / STALL_FILE
    if not path.exists():
        return []
    return re.findall(r"^== stall \d+ start (\d+) ", path.read_text(), re.MULTILINE)


def app_pid(ps_text, device):
    """Newest pid of the app whose executable is under this simulator device; None if there is none."""
    marker = f"/CoreSimulator/Devices/{device}/"
    pids = []
    for line in ps_text.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit() and marker in parts[1] and APP_EXECUTABLE.search(parts[1]):
            pids.append(int(parts[0]))
    return max(pids) if pids else None


def capture_stall(evidence, device, start, index, *, pid=None, run=None):
    run = run or run_bounded
    wall = datetime.now(timezone.utc).isoformat(timespec="seconds")
    source = "line"
    if pid is None:
        source = "ps"
        table = run(["ps", "-axo", "pid=,command="], PS_LIMIT)
        pid = None if table.startswith("<") else app_pid(table, device)
    target = evidence / f"stall-sample-{index}.txt"
    if pid is not None:
        out = run(["sample", str(pid), str(SAMPLE_SECONDS), "-mayDie", "-file", str(target)], SAMPLE_LIMIT)
        outcome = "timeout" if out.startswith("<") else ("sampled" if target.exists() else "failed")
    else:
        out = table.strip() if table.startswith("<") else f"<no HPStudio process under device {device}>"
        outcome = "ps timeout" if table.startswith("<") else "no process"
    push.record(evidence, step="stall", command="sample", sample=index, utc=wall, start=int(start),
                pid=pid, pid_from=source, outcome=outcome)
    with (evidence / STALL_FILE).open("a") as header:
        header.write(f"== stall {index} start {start} {wall} pid {pid if pid is not None else '-'} {outcome}\n{out.strip()[-2000:]}\n")


def scan_stall(evidence, device, log_path, *, run=None):
    """Sample each ongoing stall in the log not yet sampled, up to STALL_CAPTURES. Returns how many it took."""
    try:
        text = Path(log_path).read_text(errors="replace")
    except OSError:
        return 0
    done = captured_stalls(evidence)
    pids = stall_pids(text)
    taken = 0
    for start in stall_starts(text):
        if start in done:
            continue
        if len(done) >= STALL_CAPTURES:
            break
        capture_stall(evidence, device, start, len(done) + 1, pid=pids.get(start), run=run)
        done.append(start)
        taken += 1
    return taken


def time_command(evidence, step, command):
    started = time.monotonic()
    status = subprocess.run(command).returncode
    name = " ".join(command[:3]) if command[:2] == ["xcrun", "simctl"] else command[0]
    push.record(evidence, step=step, command=name, outcome=f"exit {status}",
                utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                seconds=round(time.monotonic() - started, 1))
    return status


def settle(evidence, device, *, limit=None, step="voice"):
    """Real-voice job: bounded settle wait, then one speech probe. Records both; never raises."""
    limit = push.SEED_SETTLE_LIMIT if limit is None else limit
    started = time.monotonic()
    try:
        seconds, activity = push.wait_settled(evidence, device, limit=limit, step=step)
        result = {"outcome": "settled", "seconds": seconds, "processes": activity[0], "runnable": activity[1]}
    except push.SimctlHang as error:
        result = {"outcome": "timeout", "seconds": round(time.monotonic() - started, 1), "detail": str(error)}
    except Exception as error:  # A reading that cannot be taken never decides the job.
        result = {"outcome": "error", "seconds": round(time.monotonic() - started, 1), "detail": str(error)[:400]}
    print(f"{step}: simulator settle {result['outcome']} after {result['seconds']}s (limit {limit}s)", flush=True)
    if result["outcome"] != "settled":
        print(f"::warning::{step}: simulator did not settle ({result['outcome']}); the test runs anyway", flush=True)
    probe = push.speech_probe(evidence, device, step=step)
    document = {"schema": "hps-ios-voice-settle/1", "device": device, "settle_limit": limit, "settle": result,
                "speech_probe": probe}
    (evidence / "voice-settle.json").write_text(json.dumps(document, indent=2) + "\n")
    return document


def safely(action, label):
    try:
        action()
    except Exception as error:  # Observation never changes the shard's result.
        print(f"simulator observation {label} not recorded: {error}", file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    timer = commands.add_parser("time")
    timer.add_argument("--evidence", type=Path, required=True)
    timer.add_argument("--step", required=True)
    timer.add_argument("rest", nargs=argparse.REMAINDER)
    for name in ("sample", "watch", "settle", "terminate-watch", "terminate-scan", "stall-watch"):
        sub = commands.add_parser(name)
        sub.add_argument("--evidence", type=Path, required=True)
        sub.add_argument("--device", required=True)
        if name == "sample":
            sub.add_argument("--index", type=int, required=True)
        elif name == "watch":
            sub.add_argument("--interval", type=float, default=60)
        elif name.startswith("terminate-") or name == "stall-watch":
            sub.add_argument("--log", type=Path, required=True)
            if name.endswith("-watch"):
                sub.add_argument("--interval", type=float, default=2 if name == "stall-watch" else 5)
    args = parser.parse_args(argv)
    args.evidence.mkdir(parents=True, exist_ok=True)
    if args.command == "time":
        command = args.rest[1:] if args.rest[:1] == ["--"] else args.rest
        if not command:
            parser.error("time needs a command after --")
        return time_command(args.evidence, args.step, command)
    if args.command == "settle":
        settle(args.evidence, args.device)
        return 0
    if args.command.startswith("terminate-"):
        # A stopped watcher also stops the capture command it is waiting on.
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, stop_running)
        while True:
            safely(lambda: scan_terminate(args.evidence, args.device, args.log), "terminate")
            if args.command == "terminate-scan":
                return 0
            time.sleep(args.interval)
    if args.command == "stall-watch":
        # A stopped watcher also stops the sample it is waiting on.
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, stop_running)
        while True:
            safely(lambda: scan_stall(args.evidence, args.device, args.log), "stall")
            time.sleep(args.interval)
    if args.command == "sample":
        safely(lambda: take(args.evidence, args.device, step="boot", sample=args.index, full_table=True), args.index)
        return 0
    # watch: runs beside the test until the shard stops it.
    index = 0
    while True:
        index += 1
        safely(lambda: take(args.evidence, args.device, step="test", sample=index, full_table=False), f"test {index}")
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
