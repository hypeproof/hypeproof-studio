#!/usr/bin/env python3
"""merge_when_green.py - exact-head merge watchers that cannot die silently (hypeproof-harness#399).

    merge_when_green.py start --repo hypeproof/R --pr N --head SHA    detach a watcher
    merge_when_green.py watch --repo hypeproof/R --pr N --head SHA    the watcher itself
    merge_when_green.py audit --repo hypeproof/R [--repo ...] [--rearm]

A watcher squash-merges the PR at exactly SHA once it has checks, every check is
SUCCESS or SKIPPED and mergeStateStatus is CLEAN (the merge runs through
with-agent-identity.sh). Like the shell watcher it waits --delay seconds (60) before
the first read, and for --settle-min minutes (5) a PR still showing its old head is
read as pending, because GitHub needs a moment after a push. Exit 0 merged, 1 failed
check, 2 DIRTY, 3 head moved, 4 timeout, 5 merge failed. Arming one is the caller's
merge decision; this tool only keeps it alive and visible.

On 2026-10-25 three watchers started with `nohup ... &` inside a background shell
died with that shell, and three green PRs sat unmerged. So:
  * `start` puts the watcher in its own session, which outlives the shell;
  * every watcher logs start, each poll and its exit reason to
    $HYPE_LOOP_HOME/merge-watch/<owner>-<repo>-<pr>.jsonl;
  * `audit` lists open hypeproof-agent[bot] PRs: watched, dead (armed, no exit
    logged, process gone, or timed out), stopped (exited on a red check, DIRTY,
    a moved head or a failed merge), silent (alive, no poll for 5 minutes) or
    unarmed (never armed at the PR's current head). --rearm restarts dead
    watchers; their PR head is still the armed SHA by construction.

After a merge the watcher moves the PR and every issue it closes (its
closingIssuesReferences) to Done with scripts/board/board.py, through the same
wrapper (#397). The PR is merged by then, so a board failure never changes the exit
code: it is printed on stderr and logged in the exit event's `board`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve()
WRAPPER = Path(os.environ.get("HYPE_LOOP_AGENT_WRAPPER")
               or HERE.parents[3] / "scripts/agent-identity/with-agent-identity.sh")
BOARD = Path(os.environ.get("HYPE_LOOP_BOARD") or HERE.parents[3] / "scripts/board/board.py")
GREEN = {"SUCCESS", "SKIPPED"}
EXIT = {"merged": 0, "check_failed": 1, "dirty": 2, "head_moved": 3, "timeout": 4, "merge_failed": 5}
STOPPED = {"check_failed", "dirty", "head_moved", "merge_failed"}
SILENT_S = 300


def watch_dir() -> Path:
    d = Path(os.environ.get("HYPE_LOOP_HOME", "~/.hypeproof/loop")).expanduser() / "merge-watch"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log_path(repo: str, pr: int) -> Path:
    return watch_dir() / f"{repo.replace('/', '-')}-{pr}.jsonl"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def log(repo: str, pr: int, event: str, **fields) -> None:
    with open(log_path(repo, pr), "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"at": now(), "event": event, **fields}, sort_keys=True) + "\n")


def events(repo: str, pr: int) -> list[dict]:
    path = log_path(repo, pr)
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def gh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)


def poll(repo: str, pr: int, head: str, settling: bool) -> str | None:
    """The watcher's verdict for one read, or None to keep waiting."""
    got = gh("pr", "view", str(pr), "--repo", repo, "--json", "headRefOid,mergeStateStatus,statusCheckRollup")
    if got.returncode != 0:
        log(repo, pr, "poll", error=(got.stderr or got.stdout).strip()[:200])
        return None
    state = json.loads(got.stdout)
    checks = state.get("statusCheckRollup") or []
    pending = [c.get("name") for c in checks if not c.get("conclusion")]
    bad = [c.get("name") for c in checks if c.get("conclusion") and c["conclusion"] not in GREEN]
    merge_state = state.get("mergeStateStatus")
    log(repo, pr, "poll", head=state.get("headRefOid"), merge_state=merge_state, pending=len(pending), bad=bad)
    if state.get("headRefOid") != head:
        return None if settling else "head_moved"
    if not checks:
        return None  # no check run yet: never merge before CI has started
    if bad and not pending:
        return "check_failed"
    if merge_state == "DIRTY":
        return "dirty"
    if not bad and not pending and merge_state == "CLEAN":
        return "merged"
    return None


def watch(repo: str, pr: int, head: str, interval: float, timeout_s: float, delay: float, settle_s: float) -> int:
    if os.environ.get("HYPE_MWG_STARTED") != "1":  # `start` logged the start already
        log(repo, pr, "start", head=head, pid=os.getpid())
    time.sleep(delay)
    begun = time.monotonic()
    verdict = None
    while verdict is None and time.monotonic() < begun + timeout_s:
        verdict = poll(repo, pr, head, settling=time.monotonic() - begun < settle_s)
        if verdict is None:
            time.sleep(interval)
    verdict = verdict or "timeout"
    detail = ""
    if verdict == "merged":
        done = subprocess.run(["bash", str(WRAPPER), "gh", "pr", "merge", str(pr), "--repo", repo, "--squash",
                               "--match-head-commit", head], capture_output=True, text=True, timeout=300)
        if done.returncode != 0:
            verdict, detail = "merge_failed", (done.stderr or done.stdout).strip()[:300]
    board = board_done(repo, pr) if verdict == "merged" else None
    if board and not board["ok"]:
        print(f"merge_when_green: #{pr} merged but the board was not updated: {json.dumps(board)}", file=sys.stderr)
    log(repo, pr, "exit", verdict=verdict, detail=detail, **({"board": board} if board else {}))
    return EXIT.get(verdict, 5)


def board_done(repo: str, pr: int) -> dict:
    """Set the merged PR and the issues it closes to done on the boards; report, never raise."""
    if not BOARD.is_file():
        return {"ok": False, "error": f"{BOARD} is missing"}
    items, error = [], None
    try:
        urls = [f"https://github.com/{repo}/pull/{pr}"]
        got = gh("pr", "view", str(pr), "--repo", repo, "--json", "closingIssuesReferences")
        if got.returncode == 0:
            urls += [ref["url"] for ref in json.loads(got.stdout).get("closingIssuesReferences") or []]
        else:
            error = f"closing issues not read: {(got.stderr or got.stdout).strip()[:200]}"
        for url in urls:
            done = subprocess.run(["bash", str(WRAPPER), sys.executable, str(BOARD), "set", url, "--state", "done"],
                                  capture_output=True, text=True, timeout=300)
            items.append({"url": url, "returncode": done.returncode, "detail": (done.stdout or done.stderr).strip()[-300:]})
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        error = f"{type(exc).__name__}: {str(exc)[:200]}"
    ok = error is None and all(item["returncode"] == 0 for item in items)
    return {"ok": ok, "items": items, **({"error": error} if error else {})}


def start(repo: str, pr: int, head: str, interval: float, timeout_s: float, delay: float, settle_s: float) -> dict:
    cmd = [sys.executable, str(HERE), "watch", "--repo", repo, "--pr", str(pr), "--head", head, "--interval",
           str(interval), "--timeout-min", str(timeout_s / 60), "--delay", str(delay), "--settle-min", str(settle_s / 60)]
    with open(log_path(repo, pr).with_suffix(".out"), "a") as out:
        # A new session: the watcher survives the shell (or background task) that started it.
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True,
                                env={**os.environ, "HYPE_MWG_STARTED": "1"})
    log(repo, pr, "start", head=head, pid=proc.pid)  # now, so a second audit sees it and does not arm twice
    return {"repo": repo, "pr": pr, "head": head, "pid": proc.pid, "log": str(log_path(repo, pr))}


def alive(pid: int, repo: str, pr: int, head: str) -> bool:
    # -ww: procps on Linux cuts a piped command line at 80 columns, which hid `--pr N` on CI.
    ps = subprocess.run(["ps", "-ww", "-o", "command=", "-p", str(pid)], capture_output=True, text=True)
    cmd = ps.stdout if ps.returncode == 0 else ""
    return ("merge_when_green.py watch" in cmd and f"--repo {repo} " in cmd and f"--head {head}" in cmd
            and re.search(rf"--pr {pr}(\s|$)", cmd) is not None)


def audit(repos: list[str], rearm: bool, interval: float, timeout_s: float, delay: float, settle_s: float) -> dict:
    out = {"watched": [], "dead": [], "stopped": [], "silent": [], "unarmed": [], "rearmed": [], "errors": []}
    for repo in repos:
        got = gh("pr", "list", "--repo", repo, "--author", "app/hypeproof-agent", "--state", "open",
                 "--json", "number,headRefOid")
        if got.returncode != 0:
            out["errors"].append({"repo": repo, "error": (got.stderr or got.stdout).strip()[:200]})
            continue
        for pr in json.loads(got.stdout):
            n, head = pr["number"], pr["headRefOid"]
            row = {"repo": repo, "pr": n, "head": head[:12]}
            runs = [e for e in events(repo, n) if e["event"] == "start"]
            last = events(repo, n)[-1] if runs else None
            if not runs or runs[-1].get("head") != head:
                out["unarmed"].append(row)  # never armed at this head: the merge decision is not ours
            elif last["event"] == "exit" and last.get("verdict") in STOPPED:
                out["stopped"].append({**row, "exit": last.get("verdict")})
            elif last["event"] == "exit" and last.get("verdict") == "merged":
                out["watched"].append({**row, "exit": "merged"})
            elif last["event"] == "exit" or not alive(runs[-1]["pid"], repo, n, head):
                out["dead"].append({**row, "exit": last.get("verdict")} if last["event"] == "exit" else row)
                if rearm:
                    out["rearmed"].append(start(repo, n, head, interval, timeout_s, delay, settle_s))
            elif (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(last["at"])).total_seconds() > SILENT_S:
                out["silent"].append(row)
            else:
                out["watched"].append(row)
    out["ok"] = not (out["dead"] and not rearm) and not out["stopped"] and not out["silent"] and not out["errors"]
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("start", "watch", "audit"):
        s = sub.add_parser(name)
        s.add_argument("--repo", action="append" if name == "audit" else None, required=True)
        if name != "audit":
            s.add_argument("--pr", type=int, required=True)
            s.add_argument("--head", required=True)
        else:
            s.add_argument("--rearm", action="store_true")
        s.add_argument("--interval", type=float, default=45.0)
        s.add_argument("--timeout-min", type=float, default=45.0)
        s.add_argument("--delay", type=float, default=60.0)
        s.add_argument("--settle-min", type=float, default=5.0)
    args = p.parse_args(argv)
    timing = (args.interval, args.timeout_min * 60, args.delay, args.settle_min * 60)
    if args.cmd == "watch":
        return watch(args.repo, args.pr, args.head, *timing)
    result = (start(args.repo, args.pr, args.head, *timing) if args.cmd == "start"
              else audit(args.repo, args.rearm, *timing))
    print(json.dumps(result, sort_keys=True))
    return 0 if args.cmd == "start" or result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
