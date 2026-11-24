#!/usr/bin/env python3
"""One-off experiment for #4432 F21: when does SpringBoard's poster re-render run, and can it be finished
before tests? Runs only from ios-poster-experiment.yml (a draft PR that is closed without merge).

Each shard of PR run 45326775841 wrote one burst of poster cache files, at device ages of 4.5 to 23 min,
with SimRenderServer at 1.1-2.5 GB; test starts before the burst wrote nothing. This records, with the
shard probes (ios-sim-observe.py poster_mtimes and render_reading), three questions:

  triggers  U2: on a fresh device, does one candidate action start the burst within its window?
  first     the natural burst on a fresh device (device age, size, SimRenderServer memory).
  reboot    U1: after that burst, shutdown and boot the same device; does the burst run again?

Files and host commands only (simctl create/boot/shutdown/ui/openurl, top, pgrep). Every phase has its own
limit; a phase that sees nothing records that and the next phase runs. The script never fails the job for
a finding, only for a broken simulator command.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("observe", HERE / "ios-sim-observe.py")
observe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(observe)

POLL = 30                 # seconds between readings
BURST_FILES = 30          # cache files written in one minute that count as a burst
AFTER_BURST = 120         # seconds observed after a burst before the phase ends
TRIGGER_WINDOW = 360      # seconds observed after one candidate action
FIRST_LIMIT = 25 * 60     # natural burst on a fresh device
REBOOT_LIMIT = 20 * 60    # burst again after shutdown and boot
COMMAND_LIMIT = 300       # any one simctl command

# Candidate actions (Guess: none is known to start the task). Each runs on its own fresh device at a device
# age of about 2-3 min, earlier than any natural burst seen (4.5 min), so a burst inside its window points at it.
TRIGGERS = {
    "appearance": [["ui", "{device}", "appearance", "dark"], ["ui", "{device}", "appearance", "light"]],
    "wallpaper-settings": [["openurl", "{device}", "prefs:root=Wallpaper"]],
    "dasd-kickstart": [["spawn", "{device}", "launchctl", "kickstart", "-k", "system/com.apple.dasd"]],
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Log:
    def __init__(self, evidence):
        self.path = evidence / "poster-experiment.jsonl"
        self.evidence = evidence

    def row(self, **fields):
        fields = {"utc": now(), **fields}
        with self.path.open("a") as target:
            target.write(json.dumps(fields, sort_keys=True) + "\n")
        print(json.dumps(fields, sort_keys=True), flush=True)
        return fields


def simctl(log, phase, args, *, check=True):
    started = time.monotonic()
    try:
        done = subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True, timeout=COMMAND_LIMIT)
        outcome, out = f"exit {done.returncode}", (done.stdout + done.stderr).strip()[:400]
    except subprocess.TimeoutExpired:
        outcome, out, done = f"timeout {COMMAND_LIMIT}s", "", None
    log.row(phase=phase, command="simctl " + " ".join(args), outcome=outcome, seconds=round(time.monotonic() - started, 1), output=out)
    if check and (done is None or done.returncode != 0):
        raise SystemExit(f"simctl {' '.join(args)}: {outcome}")
    return out


def new_device(log, phase, device_type, runtime):
    device = simctl(log, phase, ["create", f"HP-Poster-{phase}", device_type, runtime]).splitlines()[-1].strip()
    boot(log, phase, device)
    return device


def boot(log, phase, device):
    simctl(log, phase, ["boot", device])
    simctl(log, phase, ["bootstatus", device, "-b"])
    return time.monotonic()


def cache_files(library, since):
    """(the shard probe's per-minute table, cache files under Caches/*Poster* written after `since` (epoch s)).

    The table is minute-grained, so a burst is decided from the second-precise count only: files the previous
    phase wrote in the same minute must not count again."""
    table = observe.poster_mtimes(library)
    fresh = 0
    try:
        roots = [entry for entry in (library / "Caches").iterdir() if observe.MTIME_CACHE.search(entry.name) and entry.is_dir()]
    except OSError:
        roots = []
    for root in roots:
        for folder, _, names in os.walk(root):
            for name in names:
                try:
                    if os.lstat(os.path.join(folder, name)).st_mtime >= since:
                        fresh += 1
                except OSError:
                    continue
    return table, fresh


def watch(log, phase, device, booted, limit, *, stop_after_burst):
    """Read every POLL s until `limit`; returns the first burst row or None."""
    library = observe.devices_root() / device / "data/Library"
    since = time.time()
    started, burst, burst_at, last, highest = time.monotonic(), None, None, 0, None
    while time.monotonic() - started < limit:
        table, fresh = cache_files(library, since)
        render = observe.render_reading()["processes"]
        peak = max((p["mem_mb"] for p in render if p["name"] == "SimRenderServer"), default=None)
        highest = peak if highest is None or (peak is not None and peak > highest) else highest
        row = log.row(phase=phase, device_age_s=round(time.monotonic() - booted), new_cache_files=fresh,
                      minutes=table["minutes"], walk_entries=table["visited"], walk_stopped=table["stopped"],
                      simrenderserver_mb=peak)
        if fresh - last >= BURST_FILES and burst is None:
            burst, burst_at = log.row(phase=phase, finding="burst", new_cache_files=fresh, device_age_s=row["device_age_s"],
                                      simrenderserver_mb=peak), time.monotonic()
        last = fresh
        if burst is not None:
            burst["peak_mb"] = highest
        if burst and stop_after_burst and time.monotonic() - burst_at >= AFTER_BURST:
            break
        time.sleep(POLL)
    if burst is None:
        log.row(phase=phase, finding="no burst", limit_s=limit, peak_mb=highest, new_cache_files=last)
    return burst


def run(evidence, phases):
    evidence.mkdir(parents=True, exist_ok=True)
    log = Log(evidence)
    sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], text=True, timeout=60).strip()
    runtimes = subprocess.check_output(["xcrun", "simctl", "list", "runtimes", "--json"], text=True, timeout=120)
    selection = subprocess.run([sys.executable, str(HERE / "select-ios-simulator.py"), sdk], input=runtimes,
                               capture_output=True, text=True, timeout=60, check=True).stdout.split()
    device_type, runtime = selection[0], selection[1]
    log.row(phase="setup", sdk=sdk, device_type=device_type, runtime=runtime)
    results = {}
    if "triggers" in phases:
        for name, commands in TRIGGERS.items():
            phase = "trigger-" + name
            device = new_device(log, phase, device_type, runtime)
            booted = time.monotonic()
            for command in commands:
                simctl(log, phase, [part.replace("{device}", device) for part in command], check=False)
            results[phase] = watch(log, phase, device, booted, TRIGGER_WINDOW, stop_after_burst=True)
            simctl(log, phase, ["shutdown", device], check=False)
            simctl(log, phase, ["delete", device], check=False)
    if "first" in phases:
        device = new_device(log, "first", device_type, runtime)
        results["first"] = watch(log, "first", device, time.monotonic(), FIRST_LIMIT, stop_after_burst=True)
        if "reboot" in phases and results["first"]:
            simctl(log, "reboot", ["shutdown", device])
            booted = boot(log, "reboot", device)
            results["reboot"] = watch(log, "reboot", device, booted, REBOOT_LIMIT, stop_after_burst=True)
        elif "reboot" in phases:
            log.row(phase="reboot", finding="skipped: no first burst to compare with")
        simctl(log, "first", ["shutdown", device], check=False)
        simctl(log, "first", ["delete", device], check=False)
    lines = ["# Poster experiment (#4432 F21)", "", f"sdk {sdk}, {device_type}, {runtime}", ""]
    for phase, burst in results.items():
        lines.append(f"- {phase}: " + ("no burst" if not burst else
                     f"burst at device age {burst['device_age_s']} s ({burst['new_cache_files']} new cache files), SimRenderServer peak {burst.get('peak_mb')} MB"))
    (evidence / "poster-experiment.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines), flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--phases", default="triggers,first,reboot")
    args = parser.parse_args(argv)
    run(args.evidence, set(args.phases.split(",")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
