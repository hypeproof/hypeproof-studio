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

Rows go to <evidence>/simulator-steps.jsonl in the format the approval push job writes.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
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
    for name in ("sample", "watch", "settle"):
        sub = commands.add_parser(name)
        sub.add_argument("--evidence", type=Path, required=True)
        sub.add_argument("--device", required=True)
        if name == "sample":
            sub.add_argument("--index", type=int, required=True)
        elif name == "watch":
            sub.add_argument("--interval", type=float, default=60)
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
