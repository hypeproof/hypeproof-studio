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
The last capture is kept for a stall that matters most (#4432 F22): one whose ongoing line shows a
render loop (a "body.<screen>+N" render change with N >= LOOP_PASSES) or that has reached LONG_STALL_MS.
Other stalls use only the captures before it. A stall passed over at its 3 s line can still be
taken at a later line (run 45179328976: three short stalls used every capture, then a loop got none).

Every `watch` reading and every stall capture also takes one host snapshot (#4432 F21): the host's
memory size, CPU count, swap and memory level (`sysctl`), and the 15 processes using the most memory
and the most CPU (`top -l 2`, its second sample, so %CPU is over one second). A `sample` (boot) reading,
which the shard waits for, takes only the `sysctl` part, so the runner's size is known from the start. The commands run
one at a time, each with its own limit; one that does not return is recorded as "<cmd> did not return
within Ns" and the next one runs. Only process names are read, never arguments. Each row says how long
each command took and the CPU time it used, so the cost of these diagnostics is measured too.
Snapshots go to <evidence>/host-snapshots.txt; the row keeps the per-group sums (`host`).

`boundary-verdict` runs once after the test. For each "request-boundary polls" attachment (the UI
test's record of its trace reads during a request-boundary wait that did not complete) it judges
`runner-ax`, `app` or `unknown` from those reads and the app's stall lines, and marks
`host saturated` from the host snapshots of that time (BOUNDARY_RULES). It prints one line each and
writes <evidence>/boundary-verdicts.txt. It decides nothing about the job.

Rows go to <evidence>/simulator-steps.jsonl in the format the approval push job writes.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import resource
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
    costs = []
    started_ms = uptime_ms()
    table = measured(push.bounded, PS, push.DIAGNOSTIC_LIMIT, costs)
    vm_stat = measured(push.bounded, ["vm_stat"], push.DIAGNOSTIC_LIMIT, costs)
    loadavg = measured(push.bounded, ["sysctl", "-n", "vm.loadavg"], push.DIAGNOSTIC_LIMIT, costs, name="sysctl loadavg")
    row = {"step": step, "command": "observe", "sample": sample, "utc": wall, "uptime_ms": started_ms,
           "loadavg": loadavg.strip(), "free_pages": free_pages(vm_stat)}
    # After the existing reading, so its timing is unchanged; its own commands are bounded the same way.
    # The shard waits for the boot readings, so they take only sysctl (host size) and no top.
    host = host_snapshot(evidence, step=step, sample=sample, vm_stat=vm_stat, with_top=step != "boot")
    host["costs"] = costs + host["costs"]
    row["host"] = host
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
# A body pass count in one ongoing line at or above this marks a render loop (run 45179328976: +304 at 3 s;
# the other stall lines of that run had at most +6). A classification value, not a test limit.
LOOP_PASSES = 100
LONG_STALL_MS = 10_000
STALL_LINE = re.compile(r"HPStudio main stall \(ongoing\): (\d+) ms since uptime (\d+) ms;([^\n]*)")
BODY_PASSES = re.compile(r"(?:^|\s)body\.[A-Za-z0-9_.]+\+(\d+)@")
# One second, with -mayDie (symbols are read at once): run 45132515641 had a 3 s sample not return
# within SAMPLE_LIMIT on a saturated host.
SAMPLE_SECONDS = 1
SAMPLE_LIMIT = 30
PS_LIMIT = 10
APP_EXECUTABLE = re.compile(r"/HPStudio\.app/HPStudio(\s|$)")
STALL_FILE = "stall-samples.txt"
_running = None

# Host snapshot (#4432 F21). Names only: `top` and `ps -c` read each process's name, not its arguments.
HOST_SYSCTL = ["sysctl", "hw.memsize", "hw.ncpu", "vm.swapusage", "kern.memorystatus_level", "vm.pagesize"]
HOST_SYSCTL_LIMIT = 10
HOST_TOP_ROWS = 15
TOP_STATS = "pid,ppid,mem,cpu,threads,state,command"
HOST_TOP = {order: ["top", "-l", "2", "-s", "1", "-n", str(HOST_TOP_ROWS), "-o", order, "-stats", TOP_STATS]
            for order in ("mem", "cpu")}
HOST_TOP_LIMIT = 20
HOST_PS = ["ps", "-axco", "pid,ppid,rss,pcpu,state,comm"]
HOST_PS_LIMIT = 15
HOST_FILE = "host-snapshots.txt"
# Group of a process by its (top-truncated, 16 character) name. First match wins; a process whose parent
# is a launchd_sim and that matches nothing earlier is the simulator's.
HOST_GROUPS = (
    ("ui-runner", re.compile(r"^(HPStudioUITests|XCTRunner|xctest|testmanagerd)")),
    ("app", re.compile(r"^HPStudio$")),
    ("instruments", re.compile(r"^(python3?(\.\d+)?|Python|sample|log|simctl|top|ps|sysctl|vm_stat)$")),
    ("logging", re.compile(r"^(logd|logd_helper|diagnosticd)$")),
    ("ax", re.compile(r"(ccessib|^axassetsd$|^AX)")),
    ("xcodebuild", re.compile(r"^(xcodebuild|XCBBuildServic|SWBBuildServic)")),
    ("simulator", re.compile(r"^(launchd_sim|CoreSimulator|com\.apple\.CoreSi|SimulatorTrampo|simdiskimaged|Simulator)")),
    ("runner-agent", re.compile(r"^Runner\.")),
    ("system", re.compile(r"^(kernel_task|WindowServer|launchd|mds|mds_stores|mdworker|mdworker_shared|corespotlightd)$")),
)
MEM_VALUE = re.compile(r"^(\d+(?:\.\d+)?)([BKMG])[+-]?$")


# The clock of the app's stall lines and of the UI test's trace reads (ProcessInfo.systemUptime) on the
# macOS host. CLOCK_UPTIME_RAW exists only on macOS; elsewhere (the Linux contract job runs these tests)
# time.monotonic stands in, which matches no app line but keeps every reading working.
UPTIME_CLOCK = getattr(time, "CLOCK_UPTIME_RAW", None)
# ru_maxrss is in bytes on macOS and in KiB on Linux.
MAXRSS_PER_MB = 1048576 if sys.platform == "darwin" else 1024


def uptime_ms(clock=None):
    """System uptime in ms from `clock` (a time.clock_gettime id; default UPTIME_CLOCK), or monotonic time."""
    clock = UPTIME_CLOCK if clock is None else clock
    return int((time.clock_gettime(clock) if clock is not None else time.monotonic()) * 1000)


def measured(run, args, limit, costs, name=None):
    """run(args, limit), and append its time, its children's CPU time and whether it returned to `costs`."""
    before, started = resource.getrusage(resource.RUSAGE_CHILDREN), time.monotonic()
    out = run(args, limit)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = (after.ru_utime + after.ru_stime) - (before.ru_utime + before.ru_stime)
    outcome = ("timeout" if "did not return within" in out else "unavailable") if out.startswith("<") else "returned"
    costs.append({"command": name or args[0], "ms": int((time.monotonic() - started) * 1000), "cpu_ms": int(cpu * 1000),
                  "outcome": outcome})
    return out


def sysctl_values(text):
    """name -> value text of `sysctl <names>` output; a name it does not know is left out."""
    values = {}
    for line in text.splitlines():
        name, sep, value = line.partition(": ")
        if sep and re.fullmatch(r"[a-z_.]+", name):
            values[name] = value.strip()
    return values


def mem_mb(value):
    match = MEM_VALUE.match(value)
    if not match:
        return None
    return round(float(match[1]) * {"B": 1 / 1048576, "K": 1 / 1024, "M": 1, "G": 1024}[match[2]], 1)


def top_rows(text):
    """Rows of the last sample in `top -l 2 -stats TOP_STATS` output: pid, ppid, mem_mb, cpu, state, command."""
    block = text.split("\nProcesses:")[-1] if "\nProcesses:" in text else text
    rows, table = [], False
    for line in block.splitlines():
        if line.startswith("PID"):
            table = True
            continue
        parts = line.split(None, 6)
        if not table or len(parts) < 7 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        try:
            cpu = float(parts[3])
        except ValueError:
            continue
        rows.append({"pid": int(parts[0]), "ppid": int(parts[1]), "mem_mb": mem_mb(parts[2]), "cpu": cpu,
                     "state": parts[5], "command": parts[6].strip()})
    return rows


def ps_rows(text):
    """Rows of `ps -axco pid,ppid,rss,pcpu,state,comm` in the same shape as top_rows."""
    rows = []
    for line in text.splitlines()[1:]:
        parts = line.split(None, 5)
        if len(parts) < 6 or not parts[0].isdigit():
            continue
        try:
            rows.append({"pid": int(parts[0]), "ppid": int(parts[1]), "mem_mb": round(int(parts[2]) / 1024, 1),
                         "cpu": float(parts[3]), "state": parts[4], "command": parts[5].strip()})
        except ValueError:
            continue
    return rows


def process_group(row, simulator_pids):
    for name, pattern in HOST_GROUPS:
        if pattern.search(row["command"]):
            return name
    return "simulator" if row["ppid"] in simulator_pids else "other"


def group_sums(rows):
    """{group: {"mem_mb", "cpu", "processes"}} of the given rows."""
    simulator = {row["pid"] for row in rows if row["command"].startswith("launchd_sim")}
    sums = {}
    for row in rows:
        entry = sums.setdefault(process_group(row, simulator), {"mem_mb": 0.0, "cpu": 0.0, "processes": 0})
        entry["mem_mb"] = round(entry["mem_mb"] + (row["mem_mb"] or 0), 1)
        entry["cpu"] = round(entry["cpu"] + row["cpu"], 1)
        entry["processes"] += 1
    return sums


def vm_value(vm_stat, label):
    match = re.search(rf"^{re.escape(label)}:\s+(\d+)\.", vm_stat, re.MULTILINE)
    return int(match[1]) if match else None


def host_snapshot(evidence, *, step, sample, vm_stat=None, run=None, with_top=True):
    """One host snapshot (sysctl, vm_stat unless given, top by memory and by CPU, ps -c only if both tops
    did not return). Commands run one at a time with their own limits. Returns the row's `host` value.
    With with_top=False (the boot readings, which the shard waits for) only sysctl and vm_stat run."""
    run = run or push.bounded
    costs, sections = [], []
    taken_ms = uptime_ms()
    values = sysctl_values(measured(run, HOST_SYSCTL, HOST_SYSCTL_LIMIT, costs))
    if vm_stat is None:
        vm_stat = measured(run, ["vm_stat"], HOST_SYSCTL_LIMIT, costs)
    tops = {}
    for order, args in HOST_TOP.items() if with_top else ():
        out = measured(run, args, HOST_TOP_LIMIT, costs, name=f"top -o {order}")
        tops[order] = out
        sections.append((f"top -o {order} (limit {HOST_TOP_LIMIT}s)", out if out.startswith("<") else
                         "\n".join(f"{r['pid']} {r['ppid']} {r['mem_mb']} {r['cpu']} {r['state']} {r['command']}" for r in top_rows(out))))
    rows = {}
    for out in tops.values():
        for row in [] if out.startswith("<") else top_rows(out):
            rows.setdefault(row["pid"], row)
    source = "top" if tops else "none"
    if tops and all(out.startswith("<") for out in tops.values()):
        source = "ps -c"
        out = measured(run, HOST_PS, HOST_PS_LIMIT, costs, name="ps -c")
        listed = [] if out.startswith("<") else sorted(ps_rows(out), key=lambda r: -(r["mem_mb"] or 0))
        rows = {row["pid"]: row for row in listed[:HOST_TOP_ROWS]}
        sections.append((f"ps -c (limit {HOST_PS_LIMIT}s)", out.strip()[:200] if out.startswith("<") else
                         "\n".join(f"{r['pid']} {r['ppid']} {r['mem_mb']} {r['cpu']} {r['state']} {r['command']}" for r in listed[:HOST_TOP_ROWS])))
    page = int(values["vm.pagesize"]) if values.get("vm.pagesize", "").isdigit() else None
    memsize = int(values["hw.memsize"]) if values.get("hw.memsize", "").isdigit() else None
    host = {"uptime_ms": taken_ms, "memsize": memsize, "ncpu": int(values["hw.ncpu"]) if values.get("hw.ncpu", "").isdigit() else None,
            "swapusage": values.get("vm.swapusage"), "memory_level": values.get("kern.memorystatus_level"),
            "total_pages": memsize // page if memsize and page else None,
            "free_pages": vm_value(vm_stat, "Pages free"), "wired_pages": vm_value(vm_stat, "Pages wired down"),
            "compressor_pages": vm_value(vm_stat, "Pages occupied by compressor"), "swapouts": vm_value(vm_stat, "Swapouts"),
            "table": source, "groups": group_sums(list(rows.values())), "costs": costs,
            "children_maxrss_mb": round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / MAXRSS_PER_MB, 1)}
    with (evidence / HOST_FILE).open("a") as target:
        target.write(f"== {step} sample {sample} uptime {taken_ms} {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n")
        target.write("-- sysctl\n" + "\n".join(f"{k}: {v}" for k, v in values.items()) + "\n")
        target.write("-- costs\n" + "\n".join(f"{c['command']} {c['ms']} ms cpu {c['cpu_ms']} ms {c['outcome']}" for c in costs) + "\n")
        for title, body in sections:
            target.write(f"-- {title} (pid ppid mem_mb cpu state command)\n{body.strip()}\n")
    return host


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
    costs = []
    launchctl = measured(run, ["xcrun", "simctl", "spawn", device, "launchctl", "list"], LAUNCHCTL_LIMIT, costs, name="simctl launchctl")
    if launchctl.startswith("<"):
        app_rows, launchctl_outcome = launchctl.strip(), "timeout"
    else:
        rows = [line for line in launchctl.splitlines() if "hypeproof" in line.lower()]
        app_rows = "\n".join(rows) if rows else "<no hypeproof entry>"
        launchctl_outcome = "listed" if rows else "absent"
    log = measured(run, ["xcrun", "simctl", "spawn", device, "log", "show", "--last", LOG_SHOW_WINDOW, "--style", "compact",
                         "--info", "--predicate", LOG_SHOW_PREDICATE], LOG_SHOW_LIMIT, costs, name="simctl log show")
    log_outcome = "timeout" if log.startswith("<") else "shown"
    push.record(evidence, step="terminate", command="diagnose", sample=index, utc=wall, bundle=bundle, pid=int(pid),
                launchctl=launchctl_outcome, log=log_outcome, log_lines=len(log.splitlines()), costs=costs)
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


def stall_priority(log_text):
    """For each ongoing stall start: True if any of its lines so far shows a render loop or reached LONG_STALL_MS."""
    kept = {}
    for length, start, rest in STALL_LINE.findall(log_text):
        changes = rest.split("render changes: ", 1)[-1].split("; why:", 1)[0] if "render changes: " in rest else ""
        loop = any(int(n) >= LOOP_PASSES for n in BODY_PASSES.findall(changes))
        kept[start] = kept.get(start, False) or loop or int(length) >= LONG_STALL_MS
    return kept


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
    costs = []
    source = "line"
    if pid is None:
        source = "ps"
        table = measured(run, ["ps", "-axo", "pid=,command="], PS_LIMIT, costs)
        pid = None if table.startswith("<") else app_pid(table, device)
    target = evidence / f"stall-sample-{index}.txt"
    if pid is not None:
        out = measured(run, ["sample", str(pid), str(SAMPLE_SECONDS), "-mayDie", "-file", str(target)], SAMPLE_LIMIT, costs)
        outcome = "timeout" if out.startswith("<") else ("sampled" if target.exists() else "failed")
    else:
        out = table.strip() if table.startswith("<") else f"<no HPStudio process under device {device}>"
        outcome = "ps timeout" if table.startswith("<") else "no process"
    # The host snapshot comes after the sample, so the sample of a short stall is not delayed by it.
    host = host_snapshot(evidence, step="stall", sample=index, run=run)
    host["costs"] = costs + host["costs"]
    push.record(evidence, step="stall", command="sample", sample=index, utc=wall, start=int(start),
                pid=pid, pid_from=source, outcome=outcome, host=host)
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
    kept = stall_priority(text)
    for start in stall_starts(text):
        if start in done:
            continue
        if len(done) >= STALL_CAPTURES:
            break
        if len(done) >= STALL_CAPTURES - 1 and not kept.get(start, False):
            continue
        capture_stall(evidence, device, start, len(done) + 1, pid=pids.get(start), run=run)
        done.append(start)
        taken += 1
    return taken


# boundary-verdict (#4432 F21). The UI test writes one "request-boundary polls v1" attachment per
# request-boundary wait that did not complete (StudioShellTests.RequestBoundaryPolls).
POLLS_HEADER = "request-boundary polls v1"
POLLS_WAIT = re.compile(r"key ([A-Za-z0-9_]+); count (\d+); wait start (\d+); deadline (\d+); result (\d+); ended (\d+)")
POLL_ROW = re.compile(r"poll (\d+) (\d+) (-?\d+)")
STALL_SPAN = re.compile(r"HPStudio main stall(?: \(ongoing\))?: (\d+) ms (?:from|since) uptime (\d+) ms")
# BOUNDARY_RULES. runner-ax: no app main stall overlaps the wait, and a read that started before the deadline
# returned the awaited value only after it, or one read took AX_SLOW_MS or more. app: a main stall overlaps
# the wait, or every read was fast (each under FAST_MS, no gap over MAX_POLL_GAP_MS up to the deadline) and
# none saw the value. Anything else is unknown. Host saturated: two or more SATURATION markers in host
# snapshots within HOST_WINDOW_MS of the wait.
AX_SLOW_MS = 5000
FAST_MS = 1000
MAX_POLL_GAP_MS = 2500
HOST_WINDOW_MS = 60000
FREE_FRACTION = 0.01
SLOW_COMMAND_MS = 10000
WATCH_GAP_MS = 90000
VERDICT_FILE = "boundary-verdicts.txt"


def parse_polls(text):
    """The wait and its reads from one polls attachment, or None if the text is not one."""
    lines = text.splitlines()
    if len(lines) < 2 or lines[0].strip() != POLLS_HEADER:
        return None
    wait = POLLS_WAIT.fullmatch(lines[1].strip())
    if not wait:
        return None
    key, count, start, deadline, result, ended = wait.groups()
    polls = [tuple(int(v) for v in match.groups()) for match in map(POLL_ROW.fullmatch, (l.strip() for l in lines[2:])) if match]
    dropped = next((int(l.split()[1]) for l in lines if re.fullmatch(r"dropped \d+", l.strip())), 0)
    return {"key": key, "count": int(count), "start": int(start), "deadline": int(deadline), "result": int(result),
            "ended": int(ended), "polls": polls, "dropped": dropped}


def stall_spans(log_text):
    """(start, end) uptime ms of each main stall the app reported, longest report per start."""
    spans = {}
    for length, start in STALL_SPAN.findall(log_text):
        spans[int(start)] = max(spans.get(int(start), 0), int(start) + int(length))
    return sorted(spans.items())


def classify_wait(wait, spans):
    """(verdict, reason) for one wait: runner-ax, app or unknown (BOUNDARY_RULES)."""
    if wait is None or not wait["polls"]:
        return "unknown", "no trace reads recorded"
    start, deadline, count, polls = wait["start"], wait["deadline"], wait["count"], wait["polls"]
    overlapping = [(s, e) for s, e in spans if s < deadline and e > start]
    if overlapping:
        s, e = overlapping[0]
        return "app", f"app main stall {e - s} ms from uptime {s} overlaps the wait"
    late = [p for p in polls if p[0] < deadline and p[2] >= count and p[0] + p[1] > deadline]
    if late:
        p = late[0]
        return "runner-ax", f"read from uptime {p[0]} saw {p[2]} but returned {p[0] + p[1] - deadline} ms after the deadline"
    slow = [p for p in polls if p[1] >= AX_SLOW_MS]
    if slow:
        return "runner-ax", f"one trace read took {max(p[1] for p in slow)} ms"
    starts = [start] + [p[0] for p in polls] + [deadline]
    gap = max(b - a for a, b in zip(starts, starts[1:]))
    if all(p[1] < FAST_MS for p in polls) and all(p[2] < count for p in polls) and gap <= MAX_POLL_GAP_MS:
        return "app", f"{len(polls)} fast reads up to the deadline, none saw {count}"
    return "unknown", f"{len(polls)} reads, longest gap {gap} ms, slowest {max(p[1] for p in polls)} ms"


def saturation(wait, rows):
    """Markers of host saturation in the host snapshots near the wait (empty list: none or no snapshot)."""
    if wait is None:
        return []
    low, high = wait["start"] - HOST_WINDOW_MS, wait["ended"] + HOST_WINDOW_MS
    hosts = sorted((row["host"] for row in rows if isinstance(row.get("host"), dict) and isinstance(row["host"].get("uptime_ms"), int)),
                   key=lambda host: host["uptime_ms"])
    near = [host for host in hosts if low <= host["uptime_ms"] <= high]
    markers = []
    if any(h.get("total_pages") and h.get("free_pages") is not None and h["free_pages"] < FREE_FRACTION * h["total_pages"] for h in near):
        markers.append("free memory under 1%")
    if any(low <= b["uptime_ms"] <= high and isinstance(a.get("swapouts"), int) and isinstance(b.get("swapouts"), int)
           and b["swapouts"] > a["swapouts"] for a, b in zip(hosts, hosts[1:])):
        markers.append("swapouts rose")
    if any(c.get("ms", 0) >= SLOW_COMMAND_MS or c.get("outcome") == "timeout" for h in near for c in h.get("costs", [])):
        markers.append("a snapshot command took 10 s or did not return")
    watch = sorted(row["uptime_ms"] for row in rows if row.get("step") == "test" and row.get("command") == "observe"
                   and isinstance(row.get("uptime_ms"), int))
    if any(b - a >= WATCH_GAP_MS and a <= high and b >= low for a, b in zip(watch, watch[1:])):
        markers.append("watch readings 90 s or more apart")
    return markers


def boundary_verdicts(evidence, log_path, attachments=None):
    """Judge each polls attachment; write VERDICT_FILE and one row each; return the printed lines."""
    attachments = attachments or evidence / "journey-attachments"
    waits = []
    for path in sorted(attachments.iterdir()) if attachments.is_dir() else []:
        if path.is_file() and not path.is_symlink() and path.stat().st_size < 65536:
            wait = parse_polls(path.read_text(errors="replace"))
            if wait is not None:
                waits.append(wait)
    try:
        spans = stall_spans(Path(log_path).read_text(errors="replace"))
    except OSError:
        spans = []
    steps = evidence / "simulator-steps.jsonl"
    rows = []
    for line in steps.read_text().splitlines() if steps.exists() else []:
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    lines = []
    for wait in waits:
        verdict, reason = classify_wait(wait, spans)
        markers = saturation(wait, rows)
        saturated = len(markers) >= 2
        line = (f"request-boundary verdict: {wait['key']} {verdict}{'; host saturated' if saturated else ''} ({reason}; "
                f"host: {', '.join(markers) if markers else 'no marker'})")
        push.record(evidence, step="boundary", command="verdict", key=wait["key"], verdict=verdict, saturated=saturated,
                    markers=markers, reason=reason, reads=len(wait["polls"]), dropped=wait["dropped"])
        lines.append(line)
    (evidence / VERDICT_FILE).write_text("".join(l + "\n" for l in lines) or "no request-boundary polls attachment\n")
    return lines


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
    verdict = commands.add_parser("boundary-verdict")
    verdict.add_argument("--evidence", type=Path, required=True)
    verdict.add_argument("--log", type=Path, required=True)
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
    if args.command == "boundary-verdict":
        safely(lambda: print("\n".join(boundary_verdicts(args.evidence, args.log)) or "request-boundary verdict: no polls attachment",
                             flush=True), "boundary")
        return 0
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
