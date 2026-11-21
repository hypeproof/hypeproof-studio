#!/usr/bin/env python3
"""Record how an iOS UI shard's simulator boots, for observation only (#4432).

`time` runs one command unchanged (same arguments, no limit added), passes its exit code
through, and records its duration. `sample` records the device's process and runnable
counts with `ps` only, plus the host's full process table and vm_stat. Neither waits for a
condition or decides anything; a failed reading is recorded, never raised.

Rows go to <evidence>/simulator-steps.jsonl in the format the approval push job writes.
"""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("approval_push", HERE / "verify-approval-push-simulator.py")
push = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(push)


def time_command(evidence, step, command):
    started = time.monotonic()
    status = subprocess.run(command).returncode
    name = " ".join(command[:3]) if command[:2] == ["xcrun", "simctl"] else command[0]
    push.record(evidence, step=step, command=name, outcome=f"exit {status}",
                seconds=round(time.monotonic() - started, 1))
    return status


def sample(evidence, device, index):
    processes = push.bounded(["ps", "-axo", "pid=,ppid=,stat=,command="])
    activity = push.device_activity(processes, device)
    push.record(evidence, step="boot", command="observe", outcome="sample", sample=index,
                processes=None if activity is None else activity[0],
                runnable=None if activity is None else activity[1],
                loadavg=push.bounded(["sysctl", "-n", "vm.loadavg"]).strip())
    with (evidence / "simulator-ps.txt").open("a") as target:
        target.write(f"== sample {index}\n")
        target.write(push.bounded(["ps", "-axo", "pid,ppid,stat,etime,%cpu,%mem,command"]))
        target.write("\n")
    with (evidence / "simulator-vmstat.txt").open("a") as target:
        target.write(f"== sample {index}\n{push.bounded(['vm_stat'])}\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    timer = commands.add_parser("time")
    timer.add_argument("--evidence", type=Path, required=True)
    timer.add_argument("--step", required=True)
    timer.add_argument("rest", nargs=argparse.REMAINDER)
    sampler = commands.add_parser("sample")
    sampler.add_argument("--evidence", type=Path, required=True)
    sampler.add_argument("--device", required=True)
    sampler.add_argument("--index", type=int, required=True)
    args = parser.parse_args(argv)
    args.evidence.mkdir(parents=True, exist_ok=True)
    if args.command == "time":
        command = args.rest[1:] if args.rest[:1] == ["--"] else args.rest
        if not command:
            parser.error("time needs a command after --")
        return time_command(args.evidence, args.step, command)
    try:
        sample(args.evidence, args.device, args.index)
    except Exception as error:  # Observation never changes the shard's result.
        print(f"simulator observation {args.index} not recorded: {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
