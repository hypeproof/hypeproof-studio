#!/usr/bin/env python3
"""tick_cleanup.py - free disk and memory between loop ticks (hypeproof-harness#398).

    tick_cleanup.py [--apply] [--queue FILE] [--states done] [--worktree PATH ...]
                    [--base origin/main] [--temp-dir DIR] [--min-age-min 60]

The Harness copy of ~/.hypeproof/loop/bin/tick-cleanup.sh. It removes only what a
loop produced and no longer needs, and it is a dry run unless --apply is given:

  worktrees  each --worktree, and each --queue item whose state is in --states and
             that names a `worktree`, when it is a linked worktree (never a main
             checkout), not locked, clean including untracked files, no process
             has its working directory inside it, and nothing on it exists only
             here: no commits beyond --base, or HEAD is exactly a branch or PR head
             on origin (refs/heads/*, refs/pull/*/head)
  temp       test temp dirs (hps-*, hp-*, approval*) in the user temp dir that are
             older than --min-age-min minutes
  browsers   orphaned test browsers: the parent is gone (ppid 1), it is not a
             helper (--type=), a test drives it (--remote-debugging-port) and its
             --user-data-dir is an hp-headless-* profile (the Studio test helper's)
             inside the temp dir. On macOS an app opened from the Dock also has
             ppid 1, so no name and no other profile ever matches

Prints one JSON object (removed or would-be removed, kept with reasons, disk free,
swap used, a summary line). Exit 0, or 2 on a usage error. Not ported: the live
script's removal of CGP scratch dirs; other loops keep item evidence there.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

TEMP_PREFIXES = ("hps-", "hp-", "approval")
PROFILE_PREFIX = "hp-headless-"  # extensions/hypeproof-chat/test/lib/headless-chromium.mjs
USER_DATA_DIR = re.compile(r"--user-data-dir=(\S+)")


def run(*cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(list(cmd), capture_output=True, text=True)


def user_temp() -> Path:
    if sys.platform == "darwin":
        out = run("getconf", "DARWIN_USER_TEMP_DIR")
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip()).resolve()
    return Path(os.environ.get("TMPDIR") or "/tmp").resolve()


def inside(path: str | Path, root: Path) -> bool:
    p = Path(path).resolve()
    return p == root or root in p.parents


def working_dirs() -> list[str]:
    """Every process's current directory (Linux /proc, else lsof)."""
    if Path("/proc/self/cwd").exists():
        found = []
        for p in Path("/proc").iterdir():
            if p.name.isdigit():
                try:
                    found.append(os.readlink(p / "cwd"))
                except OSError:
                    continue
        return found
    out = run("lsof", "-d", "cwd", "-Fn").stdout
    return [line[1:] for line in out.splitlines() if line.startswith("n")]


def remote_heads(repo: Path, cache: dict) -> set[str]:
    common = run("git", "-C", str(repo), "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip()
    if common not in cache:
        out = run("git", "-C", str(repo), "ls-remote", "origin").stdout
        cache[common] = {sha for sha, ref in (l.split("\t", 1) for l in out.splitlines() if "\t" in l)
                         if ref.startswith("refs/heads/") or re.fullmatch(r"refs/pull/\d+/head", ref)}
    return cache[common]


def keep_reason(path: Path, base: str, cwds: list[str], cache: dict) -> str | None:
    """None when the worktree can go, else why it stays."""
    if not path.is_dir():
        return "not a directory"
    g = lambda *a: run("git", "--no-optional-locks", "-C", str(path), *a)  # noqa: E731
    top = g("rev-parse", "--show-toplevel")
    if top.returncode != 0 or Path(top.stdout.strip()).resolve() != path.resolve():
        return "not the top of a git worktree"
    dirs = g("rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir").stdout.split()
    if len(dirs) != 2 or Path(dirs[0]).resolve() == Path(dirs[1]).resolve():
        return "main checkout"
    if (Path(dirs[0]) / "locked").exists():
        return "locked"
    if g("status", "--porcelain", "--untracked-files=all").stdout.strip():
        return "uncommitted or untracked changes"
    if any(inside(c, path.resolve()) for c in cwds):
        return "a process works in it"
    ahead = g("rev-list", "--count", f"{base}..HEAD")
    if ahead.returncode != 0:
        return f"cannot compare with {base}"
    if ahead.stdout.strip() != "0" and g("rev-parse", "HEAD").stdout.strip() not in remote_heads(path, cache):
        return f"commits beyond {base} that origin does not have"
    return None


def queue_worktrees(queue: Path, states: set[str]) -> list[str]:
    data = json.loads(queue.read_text())
    items = data.get("items", []) if isinstance(data, dict) else data
    return [i["worktree"] for i in items if i.get("state") in states and i.get("worktree")]


def old_temp_dirs(temp: Path, min_age_min: float, now: float) -> list[Path]:
    found = []
    for p in sorted(temp.iterdir()):
        try:
            if p.name.startswith(TEMP_PREFIXES) and p.is_dir() and not p.is_symlink() \
                    and now - p.stat().st_mtime > min_age_min * 60:
                found.append(p)
        except OSError:  # removed by its own test meanwhile
            continue
    return found


def orphan_browsers(ps_text: str, temp: Path) -> list[int]:
    """Main processes of test browsers whose parent is gone, from `ps -Ao pid=,ppid=,args=`."""
    found = []
    for line in ps_text.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit() or parts[1] != "1":
            continue
        args = parts[2]
        m = USER_DATA_DIR.search(args)
        if "--type=" in args or "--remote-debugging-port" not in args or not m:
            continue
        if Path(m.group(1)).name.startswith(PROFILE_PREFIX) and inside(m.group(1), temp):
            found.append(int(parts[0]))
    return found


def swap_used() -> str | None:
    if sys.platform == "darwin":
        m = re.search(r"used = (\S+)", run("sysctl", "-n", "vm.swapusage").stdout)
        return m.group(1) if m else None
    if not Path("/proc/meminfo").exists():
        return None
    info = dict(l.split(":", 1) for l in Path("/proc/meminfo").read_text().splitlines() if ":" in l)
    kb = lambda k: int(info.get(k, "0 kB").split()[0])  # noqa: E731
    return f"{(kb('SwapTotal') - kb('SwapFree')) / 1024:.2f}M"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="remove and kill; without it nothing changes")
    p.add_argument("--queue", type=Path, help="loop queue JSON ({items:[{state, worktree}]} or a list)")
    p.add_argument("--states", default="done", help="comma-separated queue states whose worktrees may go")
    p.add_argument("--worktree", action="append", default=[], help="a worktree to remove when safe (repeatable)")
    p.add_argument("--base", default="origin/main")
    p.add_argument("--temp-dir", type=Path, help="user temp dir (default: the OS per-user temp dir)")
    p.add_argument("--min-age-min", type=float, default=60.0)
    args = p.parse_args(argv)
    try:
        candidates = list(args.worktree)
        if args.queue:
            candidates += queue_worktrees(args.queue, {s.strip() for s in args.states.split(",") if s.strip()})
    except (OSError, ValueError, KeyError, AttributeError) as e:
        p.error(f"--queue: {e}")
    temp = args.temp_dir.resolve() if args.temp_dir else user_temp()

    ps = run("ps", "-ww", "-Ao", "pid=,ppid=,args=").stdout
    browsers = orphan_browsers(ps, temp)
    if args.apply:
        for pid in browsers:
            children = run("pgrep", "-P", str(pid)).stdout.split()
            for target in [pid, *map(int, children)]:
                try:
                    os.kill(target, signal.SIGTERM)
                except OSError:
                    pass

    temps = old_temp_dirs(temp, args.min_age_min, time.time()) if temp.is_dir() else []
    if args.apply:
        for d in temps:
            shutil.rmtree(d, ignore_errors=True)

    removed, kept, cwds, cache = [], [], working_dirs() if candidates else [], {}
    for c in dict.fromkeys(str(Path(c).expanduser()) for c in candidates):
        path = Path(c)
        reason = keep_reason(path, args.base, cwds, cache)
        if reason is None and args.apply:
            common = run("git", "-C", c, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip()
            # No --force: if a session writes into it after the checks, git refuses instead of deleting that work.
            out = run("git", "--git-dir", common, "worktree", "remove", c)
            reason = None if out.returncode == 0 else f"git worktree remove failed: {out.stderr.strip()}"
        if reason:
            kept.append({"path": c, "reason": reason})
        else:
            removed.append(c)

    free, swap = shutil.disk_usage(Path.home()).free / 2**30, swap_used()
    verb = "removed" if args.apply else "would remove"
    summary = (f"cleanup: {verb} {len(removed)} worktrees, {len(temps)} temp dirs, {len(browsers)} orphan browsers;"
               f" kept {len(kept)} worktrees; disk free {free:.0f} GB; swap used {swap}")
    print(json.dumps({"apply": args.apply, "temp_dir": str(temp),
                      "worktrees": {"removed": removed, "kept": kept},
                      "temp": [str(d) for d in temps], "browsers": browsers,
                      "disk_free_gb": round(free, 1), "swap_used": swap, "summary": summary}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
