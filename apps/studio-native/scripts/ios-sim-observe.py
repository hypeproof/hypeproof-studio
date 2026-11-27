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
The same two commands also record a launch or relaunch that stops making progress (`scan_hang`): while the
log's last step is a launch step and the log has not grown for HANG_QUIET_SECONDS, and once a test ran out of
its time allowance or failed to get launch progress. Each capture takes the app's launchctl rows, the host's
HPStudio process rows (names only) and the device's `simctl list` state; only the failed-test capture also
takes the 3-minute log. Output goes to <evidence>/hang-diagnostics.txt plus one row each, at most HANG_CAPTURES
per kind per shard. Diagnostics only, with their own limits.

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
import os
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


def take(evidence, device, *, step, sample, full_table, log=None):
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
    if step != "boot":
        # After the existing readings too, so their timing is unchanged (#4432 F21 2c). The row's
        # uptime_ms and the render reading's own uptime are on the app's stall-line clock.
        render = render_reading()
        render["uptime_ms"] = uptime_ms()
        host["render"] = render["processes"]
        host["render_uptime_ms"] = render["uptime_ms"]
        host["costs"] += render["costs"]
        if log is not None:
            row["test"], row["test_t"] = current_test(log)
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
# A launch or relaunch that stops making progress (#4432, run 46002155151 shard 2: the relaunch after
# "Terminate <bundle>:<pid>" never returned, the 3 min allowance ran out and the test ended with "Failed to
# get launch progress", which neither terminate pattern matches, so nothing was recorded).
HANG_STEP = re.compile(r"^\s+t =\s+([0-9]+(?:\.[0-9]+)?)s\s+(.*?)\s*$", re.MULTILINE)
HANG_LAUNCH_STEP = re.compile(r"^(?:(?:Launch|Activate) [A-Za-z0-9.-]+|Setting up automation session)$")
HANG_AFTER = re.compile(r"-\[[\w.]+ (\w+)\](?:' exceeded execution time allowance| : Failed to get launch progress)")
HANG_QUIET_SECONDS = 30
HANG_CAPTURES = 3
HANG_PS = ["ps", "-axco", "pid,ppid,state,etime,comm"]
HANG_PS_NAMES = ("HPStudio", "HPStudioUITests-Runner")
SIMCTL_LIST_LIMIT = 30
HANG_FILE = "hang-diagnostics.txt"
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
# SimRenderServer and SimMetalHost are host processes (parent launchd, not launchd_sim) that draw the
# simulator's screen; run 45263058705 had them in "other" at 983-1837 MB (#4432 F21). PosterBoard, its
# poster extensions and widget extensions run inside the simulator; they get their own group so a burst of
# them is not hidden in "simulator". A widget extension whose 16-character name lost "Widget" (for example
# "HealthMedication") is not recognised by name and stays in "simulator" through its parent.
HOST_GROUPS = (
    ("ui-runner", re.compile(r"^(HPStudioUITests|XCTRunner|xctest|testmanagerd)")),
    ("app", re.compile(r"^HPStudio$")),
    ("instruments", re.compile(r"^(python3?(\.\d+)?|Python|sample|log|simctl|top|ps|sysctl|vm_stat)$")),
    ("logging", re.compile(r"^(logd|logd_helper|diagnosticd)$")),
    ("ax", re.compile(r"(ccessib|^axassetsd$|^AX)")),
    ("xcodebuild", re.compile(r"^(xcodebuild|XCBBuildServic|SWBBuildServic)")),
    ("springboard-ext", re.compile(r"(Poster|Widget)")),
    ("simulator", re.compile(r"^(launchd_sim|CoreSimulator|com\.apple\.CoreSi|SimulatorTrampo|simdiskimaged|Simulator|SimRenderServer|SimMetalHost)")),
    ("runner-agent", re.compile(r"^Runner\.")),
    ("system", re.compile(r"^(kernel_task|WindowServer|launchd|mds|mds_stores|mdworker|mdworker_shared|corespotlightd)$")),
)
# The simulator's render processes, read every watch cycle (#4432 F21 2c). pgrep matches the process name
# only and `top -pid` reads only the named pids, so the reading stays small when the full ps table times out.
# The size is top's MEM column (the host table's column), not ps RSS: in run 45275644733 shard 2 ps RSS
# said 9.5 MB for SimRenderServer while top MEM said 1638 MB (RSS leaves out most of the render memory).
RENDER_NAMES = "SimRenderServer|SimMetalHost"
RENDER_PGREP = ["pgrep", "-lx", RENDER_NAMES]
RENDER_LIMIT = 10
# One top sample is enough for MEM (CPU would need two).
RENDER_TOP_STATS = "pid,mem"
# The test the watch row falls in: the last "Test Case ... started" and the last step time in the test log.
LOG_TAIL_BYTES = 262144
TEST_STARTED = re.compile(r"Test Case '-\[[\w.]+ (\w+)\]' started")
TEST_STEP = re.compile(r"^\s+t =\s+([0-9]+(?:\.[0-9]+)?)s ", re.MULTILINE)
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


def render_reading(run=None):
    """{"processes": [{"pid", "name", "mem_mb"}], "costs": [...]} of SimRenderServer and SimMetalHost.

    A command that does not return leaves "processes" empty and its outcome in "costs"."""
    run = run or push.bounded
    costs, processes = [], []
    listed = measured(run, RENDER_PGREP, RENDER_LIMIT, costs, name="pgrep render")
    names = {}
    for line in [] if listed.startswith("<") else listed.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            names[int(parts[0])] = parts[1].strip()
    if names:
        args = ["top", "-l", "1"] + [part for pid in sorted(names) for part in ("-pid", str(pid))] + ["-stats", RENDER_TOP_STATS]
        out = measured(run, args, RENDER_LIMIT, costs, name="top render")
        table = False
        for line in [] if out.startswith("<") else out.splitlines():
            parts = line.split()
            if parts[:2] == ["PID", "MEM"]:
                table = True
                continue
            if table and len(parts) == 2 and parts[0].isdigit() and int(parts[0]) in names:
                size = mem_mb(parts[1])
                if size is not None:
                    processes.append({"pid": int(parts[0]), "name": names[int(parts[0])], "mem_mb": size})
        processes.sort(key=lambda row: row["pid"])
    return {"processes": processes, "costs": costs}


# Poster probe (#4432 F21 2a): is the simulator's wallpaper a poster that SpringBoard's PosterBoardUpdate
# task re-renders? Runs 45263058705 and 45275644733 had one such task per shard ("posterboardupdate.prewarm",
# about 2 min) with SimRenderServer at 983-1837 MB. This records only what is on the device; it changes nothing.
POSTER_FILE = "poster-probe.txt"
POSTER_WALK_LIMIT = 10        # seconds for the file walk
POSTER_WALK_ENTRIES = 20000   # directory entries visited at most
POSTER_WALK_DEPTH = 6         # levels below data/Library
POSTER_DIR = re.compile(r"(PosterBoard|Poster|Wallpaper)", re.IGNORECASE)
POSTER_JOB = re.compile(r"(poster|wallpaper)", re.IGNORECASE)  # matched on names only
POSTER_COMPONENT = re.compile(r"/([^/\s]*(?:poster|wallpaper)[^/\s]*)", re.IGNORECASE)
# Provider bundle ids that name a poster kind in PosterBoard's paths (for example com.apple.EmojiPoster...).
POSTER_PROVIDER = re.compile(r"com\.apple\.[A-Za-z0-9.]*Poster[A-Za-z0-9.]*")
# Files SpringBoard has used for a still image wallpaper (Guess: names from older iOS layouts).
STILL_WALLPAPER = re.compile(r"^(LockBackground|HomeBackground)[^/]*$")


def devices_root():
    return Path.home() / "Library/Developer/CoreSimulator/Devices"


POSTER_COUNT_LIMIT = 2000      # files counted per matching directory at most


def bounded_file_count(path):
    """Files below `path`, counting at most POSTER_COUNT_LIMIT (then ">=" that number); None if unreadable."""
    count = 0
    try:
        for entry in path.rglob("*"):
            if entry.is_file():
                count += 1
                if count >= POSTER_COUNT_LIMIT:
                    return f">={POSTER_COUNT_LIMIT}"
    except OSError:
        return None
    return count


def poster_files(library, *, clock=time.monotonic):
    """Walk `library` (bounded by POSTER_WALK_LIMIT seconds, POSTER_WALK_ENTRIES entries, POSTER_WALK_DEPTH levels).

    Returns {"dirs": {relative dir: file count}, "providers": [bundle ids in paths], "still": [still image files],
    "visited": entries, "stopped": None or why the walk stopped early}."""
    started, visited, stopped = clock(), 0, None
    dirs, providers, still = {}, set(), []
    stack = [(library, 0)]
    while stack:
        path, depth = stack.pop()
        try:
            entries = sorted(path.iterdir(), key=lambda entry: entry.name)
        except OSError:
            continue
        for entry in entries:
            visited += 1
            if visited > POSTER_WALK_ENTRIES:
                stopped = f"entry limit {POSTER_WALK_ENTRIES}"
                break
            if clock() - started > POSTER_WALK_LIMIT:
                stopped = f"time limit {POSTER_WALK_LIMIT}s"
                break
            relative = str(entry.relative_to(library))
            providers.update(POSTER_PROVIDER.findall(entry.name))
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if POSTER_DIR.search(entry.name):
                    dirs[relative] = bounded_file_count(entry)
                if depth + 1 < POSTER_WALK_DEPTH:
                    stack.append((entry, depth + 1))
            elif STILL_WALLPAPER.match(entry.name):
                still.append(relative)
        if stopped:
            break
    return {"dirs": dict(sorted(dirs.items())), "providers": sorted(providers), "still": sorted(still),
            "visited": visited, "stopped": stopped}


def wallpaper_kind(files):
    """"poster" when PosterBoard data names poster providers, "still" when only still image files exist,
    "both", or "unknown". A label for the record only (Guess: from file names, not from SpringBoard)."""
    poster, still = bool(files["providers"]), bool(files["still"])
    return "both" if poster and still else "poster" if poster else "still" if still else "unknown"


def poster_jobs(ps_text, device):
    """(running, runtime_root) from a `ps -axro pid,ppid,stat,etime,%cpu,%mem,command` table: the processes of this
    device's launchd_sim whose command names a poster or wallpaper, and the simulator runtime's RuntimeRoot path."""
    rows = []
    for line in ps_text.splitlines()[1:]:
        parts = line.split(None, 6)
        if len(parts) == 7 and parts[0].isdigit() and parts[1].isdigit():
            rows.append(parts)
    launchd = {row[0] for row in rows if row[6].startswith("launchd_sim ") and f"/Devices/{device}/" in row[6]}
    children = [row for row in rows if row[1] in launchd]
    # Runtime paths contain spaces ("iOS 27.2.simruntime"), so the command is not split on whitespace: the last
    # path component that names a poster or wallpaper is the process's name here.
    running = []
    for row in children:
        names = POSTER_COMPONENT.findall(row[6])
        if names:
            running.append(f"{row[0]} {names[-1]}")
    roots = [row[6].split("/RuntimeRoot/", 1)[0] + "/RuntimeRoot" for row in children if "/RuntimeRoot/" in row[6]]
    return running, (roots[0] if roots else None)


def defined_jobs(runtime_root):
    """Launchd job files of the simulator runtime whose names mention a poster or wallpaper."""
    if not runtime_root:
        return []
    found = []
    for folder in ("System/Library/LaunchDaemons", "System/Library/LaunchAgents"):
        try:
            found += [f"{folder}/{entry.name}" for entry in sorted(Path(runtime_root, folder).iterdir()) if POSTER_JOB.search(entry.name)]
        except OSError:
            continue
    return found


# Where SpringBoard's poster update task keeps its schedule (#4432 F21 step 1): names only, under the whole
# device data directory, so a time-based task (state in the device data) can be told from a Home-screen trigger.
SCHEDULE_NAME = re.compile(r"(posterboardupdate|dasd|BackgroundTask)", re.IGNORECASE)
SCHEDULE_WALK_LIMIT = 10        # seconds
SCHEDULE_WALK_ENTRIES = 60000   # directory entries visited at most
SCHEDULE_WALK_DEPTH = 8         # levels below data/
SCHEDULE_ROWS = 200             # matches recorded at most


def schedule_files(data, *, clock=time.monotonic):
    """Bounded walk of `data` for names matching SCHEDULE_NAME. Returns {"matches": [(relative path, size or
    "dir <n> files")], "visited": entries, "stopped": None or why}. Symlinks are listed, never followed."""
    started, visited, stopped, matches = clock(), 0, None, []
    stack = [(data, 0)]
    while stack and stopped is None:
        path, depth = stack.pop()
        try:
            entries = sorted(path.iterdir(), key=lambda entry: entry.name)
        except OSError:
            continue
        for entry in entries:
            visited += 1
            if visited > SCHEDULE_WALK_ENTRIES:
                stopped = f"entry limit {SCHEDULE_WALK_ENTRIES}"
                break
            if clock() - started > SCHEDULE_WALK_LIMIT:
                stopped = f"time limit {SCHEDULE_WALK_LIMIT}s"
                break
            is_dir = entry.is_dir() and not entry.is_symlink()
            if SCHEDULE_NAME.search(entry.name) and len(matches) < SCHEDULE_ROWS:
                try:
                    size = f"dir {bounded_file_count(entry)} files" if is_dir else str(entry.lstat().st_size)
                except OSError:
                    size = "unreadable"
                matches.append((str(entry.relative_to(data)), size))
            if is_dir and depth + 1 < SCHEDULE_WALK_DEPTH:
                stack.append((entry, depth + 1))
    return {"matches": matches, "visited": visited, "stopped": stopped}


# When the poster files were last written (#4432 F21 step 2). The start and end records of run 45309186160 showed
# the store growing 1,385 -> 1,746 files during the shard, but not when. Every test starts by terminating and
# launching the app, so the Home screen shows at each test start: writes bunched just after test starts point to a
# Home-screen trigger, and writes at one device age regardless of test starts point to a timer. Files only.
MTIME_STORE = "Application Support/PRBPosterExtensionDataStore"
MTIME_CACHE = re.compile(r"Poster")   # directories directly under Library/Caches whose name contains this
MTIME_WALK_LIMIT = 10        # seconds
MTIME_WALK_ENTRIES = 20000   # directory entries visited at most
MTIME_WALK_DEPTH = 8         # levels below each walked directory
MTIME_ROWS = 120             # most recent minutes listed; earlier files are summed into one "earlier" row


def poster_mtimes(library, *, clock=time.monotonic):
    """Files under the poster store and under Library/Caches/*Poster*, counted by the UTC minute of their mtime.

    Returns {"minutes": {"HH:MM": [store, caches]}, "earlier": [store, caches] or None, "first": "HH:MM" of the
    earliest listed minute, "visited": entries, "stopped": None or why}. Symlinks are not followed or counted.
    Only the last write of each file is seen: a file written twice counts once, a removed file not at all."""
    roots = [(library / MTIME_STORE, 0)]
    try:
        roots += [(entry, 1) for entry in sorted((library / "Caches").iterdir(), key=lambda entry: entry.name)
                  if MTIME_CACHE.search(entry.name) and entry.is_dir() and not entry.is_symlink()]
    except OSError:
        pass
    started, visited, stopped, stamps = clock(), 0, None, {}
    for root, column in roots:
        stack = [(root, 0)]
        while stack and stopped is None:
            path, depth = stack.pop()
            try:
                entries = sorted(path.iterdir(), key=lambda entry: entry.name)
            except OSError:
                continue
            for entry in entries:
                visited += 1
                if visited > MTIME_WALK_ENTRIES:
                    stopped = f"entry limit {MTIME_WALK_ENTRIES}"
                    break
                if clock() - started > MTIME_WALK_LIMIT:
                    stopped = f"time limit {MTIME_WALK_LIMIT}s"
                    break
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if depth + 1 < MTIME_WALK_DEPTH:
                        stack.append((entry, depth + 1))
                    continue
                try:
                    minute = datetime.fromtimestamp(entry.lstat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M")
                except OSError:
                    continue
                stamps.setdefault(minute, [0, 0])[column] += 1
        if stopped:
            break
    ordered = sorted(stamps)
    listed, earlier = ordered[-MTIME_ROWS:], ordered[:-MTIME_ROWS]
    folded = [sum(stamps[m][0] for m in earlier), sum(stamps[m][1] for m in earlier)] if earlier else None
    return {"minutes": {m: stamps[m] for m in listed}, "earlier": folded, "first": listed[0] if listed else None,
            "visited": visited, "stopped": stopped}


def poster_probe(evidence, device, *, run=None, root=None, when="start"):
    """Write POSTER_FILE: PosterBoard's data paths, poster and wallpaper launchd jobs, and the wallpaper kind.

    It reads files and the host process table only: no simctl spawn, nothing inside the simulator, and no
    simulator-steps.jsonl row, so the shard's commands and pre-test rows stay as they were. Never raises
    through the command (main wraps it in safely)."""
    run = run or push.bounded
    wall = datetime.now(timezone.utc).isoformat(timespec="seconds")
    costs = []
    data = (root or devices_root()) / device / "data"
    library = data / "Library"
    started = time.monotonic()
    files = poster_files(library) if library.is_dir() else {"dirs": {}, "providers": [], "still": [], "visited": 0,
                                                           "stopped": "no device data directory"}
    costs.append(f"walk {int((time.monotonic() - started) * 1000)} ms {'returned' if files['stopped'] is None else 'stopped'}")
    table = measured(run, PS, push.DIAGNOSTIC_LIMIT, [], name="ps")
    running, runtime_root = ([], None) if table.startswith("<") else poster_jobs(table, device)
    defined = defined_jobs(runtime_root)
    kind = wallpaper_kind(files)
    started = time.monotonic()
    schedule = schedule_files(data) if data.is_dir() else {"matches": [], "visited": 0, "stopped": "no device data directory"}
    costs.append(f"schedule walk {int((time.monotonic() - started) * 1000)} ms {'returned' if schedule['stopped'] is None else 'stopped'}")
    mtimes = None
    if when == "end":
        started = time.monotonic()
        mtimes = poster_mtimes(library) if library.is_dir() else {"minutes": {}, "earlier": None, "first": None,
                                                                 "visited": 0, "stopped": "no device data directory"}
        costs.append(f"mtime walk {int((time.monotonic() - started) * 1000)} ms {'returned' if mtimes['stopped'] is None else 'stopped'}")
    with (evidence / POSTER_FILE).open("a") as target:
        target.write(f"== poster probe {device} {wall} ({when})\n-- wallpaper kind (from file names): {kind}\n")
        target.write(f"-- PosterBoard / poster / wallpaper directories under data/Library ({files['visited']} entries"
                     f"{', stopped: ' + files['stopped'] if files['stopped'] else ''})\n")
        target.write("".join(f"{path} files {count}\n" for path, count in files["dirs"].items()) or "<none>\n")
        target.write("-- poster providers named in paths\n" + ("\n".join(files["providers"]) or "<none>") + "\n")
        target.write("-- still wallpaper files\n" + ("\n".join(files["still"]) or "<none>") + "\n")
        target.write("-- running poster/wallpaper processes of this device (host ps)\n"
                     + (table.strip() if table.startswith("<") else "\n".join(running) or "<none>") + "\n")
        target.write(f"-- poster/wallpaper launchd job files in the runtime ({runtime_root or 'runtime not found'})\n"
                     + ("\n".join(defined) or "<none>") + "\n")
        target.write(f"-- schedule state names (posterboardupdate|dasd|BackgroundTask) under data/ ({schedule['visited']} entries"
                     f"{', stopped: ' + schedule['stopped'] if schedule['stopped'] else ''})\n"
                     + ("".join(f"{path} {size}\n" for path, size in schedule["matches"]) or "<none>\n"))
        if mtimes is not None:
            target.write(f"-- poster file mtimes by UTC minute (store = {MTIME_STORE}, caches = Caches/*Poster*; "
                         f"{mtimes['visited']} entries{', stopped: ' + mtimes['stopped'] if mtimes['stopped'] else ''})\n"
                         "minute store caches\n")
            if mtimes["earlier"]:
                target.write(f"before {mtimes['first']} {mtimes['earlier'][0]} {mtimes['earlier'][1]}\n")
            target.write("".join(f"{minute} {store} {caches}\n" for minute, (store, caches) in mtimes["minutes"].items())
                         or "<none>\n")
        target.write("-- costs\n" + "\n".join(costs) + "\n")
    print(f"poster probe ({when}): wallpaper {kind}; {len(files['providers'])} poster providers, {len(files['still'])} still files, "
          f"{len(running)} running and {len(defined)} defined poster/wallpaper jobs; {len(schedule['matches'])} schedule state names"
          + (f"; file mtimes in {len(mtimes['minutes'])} minutes" if mtimes is not None else ""), flush=True)
    return kind


# Wait for the boot's poster re-render before the tests (#4432 F21, approved by chalk-po). Experiment run
# 45335574969 (#4492): on an idle device the burst comes once per boot, 3.6-7.4 min after boot, with
# SimRenderServer at 2.0-2.9 GB for about a minute, and again after a reboot; no action started it at once.
# In the UI shards the tests push it to 12-23 min, inside the tests. This is environment preparation before
# the tests, not a test wait: it ends when the burst is over or at its limit, and never fails the shard.
POSTER_WAIT_LIMIT = 540       # seconds from the `simctl boot` command
POSTER_WAIT_INTERVAL = 10     # seconds between readings
POSTER_WAIT_FILES = 30        # poster cache files written since boot that mean the burst has run
POSTER_WAIT_SETTLED_MB = 500  # SimRenderServer top MEM below this after the burst: over
POSTER_WAIT_FILE = "poster-wait.txt"


def boot_started(evidence):
    """Wall time (epoch s) when the shard's `xcrun simctl boot` began: that row's utc (its end) minus its
    seconds. None when the row is missing."""
    try:
        rows = [json.loads(line) for line in (evidence / "simulator-steps.jsonl").read_text().splitlines()]
    except (OSError, ValueError):
        return None
    for row in rows:
        if row.get("step") == "boot" and row.get("command") == "xcrun simctl boot" and "utc" in row:
            return datetime.fromisoformat(row["utc"]).timestamp() - float(row.get("seconds") or 0)
    return None


def poster_cache_writes(library, since):
    """Files under Library/Caches/*Poster* (the MTIME_CACHE directories) with an mtime at or after `since`."""
    count = 0
    try:
        roots = [entry for entry in sorted((library / "Caches").iterdir(), key=lambda entry: entry.name)
                 if MTIME_CACHE.search(entry.name) and entry.is_dir() and not entry.is_symlink()]
    except OSError:
        return 0
    for root in roots:
        for folder, folders, names in os.walk(root):
            folders[:] = [name for name in folders if not os.path.islink(os.path.join(folder, name))]
            for name in names:
                try:
                    if os.lstat(os.path.join(folder, name)).st_mtime >= since:
                        count += 1
                except OSError:
                    continue
    return count


def poster_wait(evidence, device, *, root=None, clock=time.monotonic, wall=time.time, sleep=time.sleep, render=None):
    """Read every POSTER_WAIT_INTERVAL s until the burst has run (POSTER_WAIT_FILES poster cache files since boot)
    and SimRenderServer is below POSTER_WAIT_SETTLED_MB, or until POSTER_WAIT_LIMIT s after boot. Writes each
    reading to POSTER_WAIT_FILE and one `warm-up poster-wait` row. Returns the outcome; never raises a finding."""
    render = render or render_reading
    started, started_wall = clock(), wall()
    booted = boot_started(evidence)
    since = booted if booted is not None else started_wall
    library = (root or devices_root()) / device / "data" / "Library"
    readings, files, last_mb, peak_mb = 0, 0, None, None
    lines = [f"== poster wait {device} boot {'unknown, using now' if booted is None else datetime.fromtimestamp(booted, timezone.utc).isoformat(timespec='seconds')}"]
    if not library.is_dir():
        outcome = "no device data"
    else:
        outcome = "limit"
        while True:
            files = poster_cache_writes(library, since)
            rows = render()["processes"]
            last_mb = max((row["mem_mb"] for row in rows if row["name"] == "SimRenderServer"), default=None)
            if last_mb is not None:
                peak_mb = last_mb if peak_mb is None else max(peak_mb, last_mb)
            readings += 1
            age = wall() - since
            lines.append(f"{readings} since_boot {age:.0f}s poster_cache_files {files} simrenderserver_mb {last_mb}")
            if files >= POSTER_WAIT_FILES and last_mb is not None and last_mb < POSTER_WAIT_SETTLED_MB:
                outcome = "burst over"
                break
            if age + POSTER_WAIT_INTERVAL > POSTER_WAIT_LIMIT:
                break
            sleep(POSTER_WAIT_INTERVAL)
    waited = round(clock() - started, 1)
    since_boot = None if booted is None else round(wall() - booted, 1)
    lines.append(f"-- {outcome}: waited {waited}s, since boot {since_boot}s, {files} poster cache files, SimRenderServer last {last_mb} peak {peak_mb} MB")
    with (evidence / POSTER_WAIT_FILE).open("a") as target:
        target.write("\n".join(lines) + "\n")
    push.record(evidence, step="warm-up", command="poster-wait", outcome=outcome, seconds=float(waited),
                utc=datetime.fromtimestamp(wall(), timezone.utc).isoformat(timespec="seconds"), since_boot=since_boot,
                readings=readings, poster_cache_files=files, simrenderserver_mb=last_mb, peak_mb=peak_mb,
                limit=POSTER_WAIT_LIMIT)
    if outcome != "burst over":
        print(f"::warning::poster burst not seen before tests ({outcome}, {waited}s)", flush=True)
    print(f"poster wait: {outcome} after {waited}s ({files} poster cache files, SimRenderServer {last_mb} MB)", flush=True)
    return outcome


def current_test(log_path):
    """(test name, last step t in s) at the end of the test log; (None, None) before the first test or without a log."""
    try:
        with Path(log_path).open("rb") as source:
            source.seek(0, 2)
            size = source.tell()
            source.seek(max(0, size - LOG_TAIL_BYTES))
            tail = source.read().decode(errors="replace")
    except (OSError, TypeError):
        return None, None
    starts = list(TEST_STARTED.finditer(tail))
    if not starts:
        return None, None
    last = starts[-1]
    steps = TEST_STEP.findall(tail, last.end())
    return last.group(1), float(steps[-1]) if steps else None


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


def hang_events(log_text, quiet_seconds):
    """Hang triggers in order, each (kind, test, key, last step).

    `launch-quiet`: the log's last step is a launch step and the log has not grown for HANG_QUIET_SECONDS
    (`quiet_seconds`), so the launch is still stuck while it is recorded. Its key is the test and the step's t,
    so a slow first launch and a stuck relaunch in one test are two events. `after`: the test ran out of its
    time allowance or failed to get launch progress; one per test."""
    events = []
    started = list(TEST_STARTED.finditer(log_text))
    steps = list(HANG_STEP.finditer(log_text))
    for match in HANG_AFTER.finditer(log_text):
        before = [step.group(2) for step in steps if step.start() < match.start()]
        event = ("after", match.group(1), match.group(1) + "@after", before[-1] if before else "")
        if event[2] not in [e[2] for e in events]:
            events.append(event)
    if steps and quiet_seconds >= HANG_QUIET_SECONDS:
        last = steps[-1]
        if HANG_LAUNCH_STEP.match(last.group(2)):
            owners = [m.group(1) for m in started if m.start() < last.start()]
            test = owners[-1] if owners else "unknown"
            key = f"{test}@{last.group(1)}"
            if not any(e[1] == test and e[0] == "after" for e in events):
                events.append(("launch-quiet", test, key, last.group(2)))
    return events


def captured_hangs(evidence):
    path = evidence / HANG_FILE
    if not path.exists():
        return []
    return re.findall(r"^== hang \d+ ([\w-]+) (\S+) ", path.read_text(), re.MULTILINE)


def capture_hang(evidence, device, kind, test, key, step, index, *, run=None):
    """While a launch is stuck: launchctl rows, app process rows and the device state. After the test ran out
    of time: the same plus the last 3 minutes of runningboardd, SpringBoard and testmanagerd log. Each
    command has its own limit; one that does not return is recorded as such and the next one runs."""
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
    table = measured(run, HANG_PS, PS_LIMIT, costs, name="ps app")
    if table.startswith("<"):
        processes, ps_outcome = table.strip(), "timeout"
    else:
        found = [line for line in table.splitlines() if line.split() and line.split()[-1] in HANG_PS_NAMES]
        processes = "\n".join(found) if found else "<no HPStudio process>"
        ps_outcome = "listed" if found else "absent"
    listing = measured(run, ["xcrun", "simctl", "list", "devices", device], SIMCTL_LIST_LIMIT, costs, name="simctl list")
    device_rows = [line.strip() for line in listing.splitlines() if device in line]
    state = "timeout" if listing.startswith("<") else (device_rows[0] if device_rows else "absent")
    fields = dict(step="hang", command="diagnose", sample=index, utc=wall, kind=kind, test=test, last_step=step,
                  launchctl=launchctl_outcome, processes=ps_outcome, device_state=state)
    log = None
    if kind == "after":
        # Only once the test has failed: the heaviest read never runs while a launch may still recover.
        log = measured(run, ["xcrun", "simctl", "spawn", device, "log", "show", "--last", LOG_SHOW_WINDOW, "--style", "compact",
                             "--info", "--predicate", LOG_SHOW_PREDICATE], LOG_SHOW_LIMIT, costs, name="simctl log show")
        fields.update(log="timeout" if log.startswith("<") else "shown", log_lines=len(log.splitlines()))
    push.record(evidence, costs=costs, **fields)
    with (evidence / HANG_FILE).open("a") as target:
        target.write(f"== hang {index} {kind} {key} {wall}\n-- last step: {step}\n")
        target.write(f"-- launchctl list (hypeproof rows, limit {LAUNCHCTL_LIMIT}s)\n{app_rows}\n")
        target.write(f"-- host processes {' / '.join(HANG_PS_NAMES)} (names only, limit {PS_LIMIT}s)\n{processes}\n")
        target.write(f"-- simctl list devices (limit {SIMCTL_LIST_LIMIT}s)\n{chr(10).join(device_rows) or listing.strip()}\n")
        if log is not None:
            target.write(f"-- log show --last {LOG_SHOW_WINDOW} {LOG_SHOW_PREDICATE} (limit {LOG_SHOW_LIMIT}s)\n{log.rstrip()}\n")


def scan_hang(evidence, device, log_path, *, run=None, now=None):
    """Capture each hang event not yet captured, up to HANG_CAPTURES per kind. Returns how many it took."""
    try:
        path = Path(log_path)
        text = path.read_text(errors="replace")
        quiet = (time.time() if now is None else now) - path.stat().st_mtime
    except OSError:
        return 0
    done = captured_hangs(evidence)
    taken = 0
    for kind, test, key, step in hang_events(text, quiet):
        if (kind, key) in done or sum(1 for k, _ in done if k == kind) >= HANG_CAPTURES:
            continue
        capture_hang(evidence, device, kind, test, key, step, len(done) + 1, run=run)
        done.append((kind, key))
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
    for name in ("sample", "watch", "once", "settle", "terminate-watch", "terminate-scan", "stall-watch", "posters", "poster-wait"):
        sub = commands.add_parser(name)
        sub.add_argument("--evidence", type=Path, required=True)
        sub.add_argument("--device", required=True)
        if name == "sample":
            sub.add_argument("--index", type=int, required=True)
        elif name == "posters":
            sub.add_argument("--when", choices=("start", "end"), default="start")
        elif name in ("watch", "once"):
            if name == "watch":
                sub.add_argument("--interval", type=float, default=60)
            sub.add_argument("--log", type=Path, default=None)
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
    if args.command == "once":
        # One watch reading now (the approval push job takes one when its test fails, #4432).
        safely(lambda: take(args.evidence, args.device, step="test", sample=0, full_table=False, log=args.log), "once")
        return 0
    if args.command == "posters":
        safely(lambda: poster_probe(args.evidence, args.device, when=args.when), "posters")
        return 0
    if args.command == "poster-wait":
        safely(lambda: poster_wait(args.evidence, args.device), "poster wait")
        return 0
    if args.command.startswith("terminate-"):
        # A stopped watcher also stops the capture command it is waiting on.
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, stop_running)
        while True:
            safely(lambda: scan_terminate(args.evidence, args.device, args.log), "terminate")
            safely(lambda: scan_hang(args.evidence, args.device, args.log), "hang")
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
        safely(lambda: take(args.evidence, args.device, step="test", sample=index, full_table=False, log=args.log), f"test {index}")
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
