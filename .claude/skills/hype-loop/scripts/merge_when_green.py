#!/usr/bin/env python3
"""merge_when_green.py - exact-head merge watchers that cannot die silently (hypeproof-harness#399).

    merge_when_green.py start --repo hypeproof/R --pr N --head SHA    detach a watcher
    merge_when_green.py watch --repo hypeproof/R --pr N --head SHA    the watcher itself
    merge_when_green.py audit --repo hypeproof/R [--repo ...] [--rearm]

A watcher shares canonical approval/target/hold readiness, binds approvals to SHA,
and respects STOP/merges.paused. It squash-merges the PR at exactly SHA once it has checks, every check is
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
wrapper with HYPEPROOF_AGENT_BOARD=1, the board-scoped token (#397, #565). The PR is merged by then, so a board failure never changes the exit
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
import uuid
from pathlib import Path

HERE = Path(__file__).resolve()
WRAPPER = Path(os.environ.get("HYPE_LOOP_AGENT_WRAPPER")
               or HERE.parents[3] / "scripts/agent-identity/with-agent-identity.sh")
BOARD = Path(os.environ.get("HYPE_LOOP_BOARD") or HERE.parents[3] / "scripts/board/board.py")
CANONICAL = HERE.parents[3]
if not (CANONICAL / "scripts/hype-merge/monitor.py").is_file():
    CANONICAL = Path(os.environ.get("HYPEPROOF_HARNESS") or CANONICAL)
sys.path.insert(0, str(CANONICAL / "scripts/hype-merge"))
import monitor  # canonical readiness; missing policy/engine fails closed
from automerge import is_review_only_blocker

GREEN = {"SUCCESS", "SKIPPED"}
EXIT = {"merged": 0, "check_failed": 1, "dirty": 2, "head_moved": 3, "timeout": 4, "merge_failed": 5, "policy_blocked": 6, "stopped": 7}
STOPPED = {"check_failed", "dirty", "head_moved", "merge_failed", "policy_blocked", "stopped"}
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
    reservation = os.environ.get("HYPE_MWG_RESERVATION")
    if reservation:
        fields.setdefault("reservation", reservation)
    with open(log_path(repo, pr), "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"at": now(), "event": event, **fields}, sort_keys=True) + "\n")


def events(repo: str, pr: int) -> list[dict]:
    path = log_path(repo, pr)
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def gh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)


def stopped() -> bool:
    root = Path(os.environ.get("HYPE_LOOP_HOME", "~/.hypeproof/loop")).expanduser()
    return any((root / name).exists() for name in ("STOP", "merges.paused"))


def poll(repo: str, pr: int, head: str, settling: bool) -> str | None:
    """The watcher's verdict for one read, or None to keep waiting."""
    if stopped():
        return "stopped"
    try:
        rule = monitor.load_release_delegations().get(repo)
    except Exception as exc:
        log(repo, pr, "poll", policy_error=type(exc).__name__)
        return "policy_blocked"
    fields = ("state,number,author,baseRefName,headRefOid,isDraft,labels,latestReviews,reviews,"
              "mergeStateStatus,mergeable,reviewDecision,statusCheckRollup")
    if rule:
        fields += ",headRefName,files,commits,changedFiles,isCrossRepository"
    got = gh("pr", "view", str(pr), "--repo", repo, "--json", fields)
    if got.returncode != 0:
        log(repo, pr, "poll", error=(got.stderr or got.stdout).strip()[:200])
        return None
    state = json.loads(got.stdout)
    state["repository"] = {"nameWithOwner": repo}
    # Canonical monitor binds latest review provenance to this exact head.
    try:
        if repo not in monitor.load_auto_merge_policy_repos():
            log(repo, pr, "poll", blockers=["policy_forbids_machine_merge"])
            return "policy_blocked"
        monitor.enrich_check_origins(repo, [state])
        monitor.enrich_release_enrollment(repo, [state], rule)
        assessment = monitor.build_queue([state])[0]
    except Exception as exc:
        log(repo, pr, "poll", policy_error=type(exc).__name__)
        return "policy_blocked"
    checks = monitor.latest_check_runs(state.get("statusCheckRollup") or [])
    pending = [c.get("name") or c.get("context") for c in checks if
               (not c.get("conclusion") if monitor.is_check_run(c) else c.get("state") in (None, "PENDING", "EXPECTED"))]
    bad = [c.get("name") or c.get("context") for c in checks if
           (bool(c.get("conclusion")) and c["conclusion"] not in GREEN if monitor.is_check_run(c)
            else c.get("state") not in (None, "SUCCESS", "PENDING", "EXPECTED"))]
    merge_state = state.get("mergeStateStatus")
    log(repo, pr, "poll", head=state.get("headRefOid"), merge_state=merge_state, pending=len(pending), bad=bad, blockers=assessment.blockers)
    if state.get("headRefOid") != head:
        return None if settling else "head_moved"
    if state.get("state") != "OPEN":
        return "policy_blocked"
    if not checks:
        return None  # no check run yet: never merge before CI has started
    if state.get("_checkSnapshotUnavailable"):
        return None  # Unknown current origin is not a final failed-check verdict.
    if any(name != monitor.CONTROL_PLANE_GATE for name in bad) and not pending:
        return "check_failed"
    if merge_state == "DIRTY":
        return "dirty"
    if assessment.status == "blocked" and any(
        not b.startswith(("checks_pending_or_failed", "merge_state:UNKNOWN", "mergeable:UNKNOWN", "required_check_missing:", "required_check_not_green:", monitor.CONTROL_PLANE_GATE))
        for b in assessment.blockers if not is_review_only_blocker(b)
    ):
        return "policy_blocked"
    if not bad and not pending and merge_state == "CLEAN" and assessment.status == "ready":
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
    if verdict == "merged" and stopped():
        verdict = "stopped"
    if verdict == "merged":
        done = subprocess.run(["bash", str(WRAPPER), "gh", "pr", "merge", str(pr), "--repo", repo, "--squash",
                               "--match-head-commit", head], capture_output=True, text=True, timeout=300)
        if done.returncode != 0:
            verdict, detail = "merge_failed", (done.stderr or done.stdout).strip()[:300]
    board = board_done(repo, pr) if verdict == "merged" else None
    if board and not board["ok"]:
        print(f"merge_when_green: #{pr} merged but the board was not updated: {json.dumps(board)}", file=sys.stderr)
    log(repo, pr, "exit", head=head, pid=os.getpid(), verdict=verdict, detail=detail, **({"board": board} if board else {}))
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
            # Board writes need the board-scoped bot token, not the repository one (harness#565).
            done = subprocess.run(["bash", str(WRAPPER), sys.executable, str(BOARD), "set", url, "--state", "done"],
                                  capture_output=True, text=True, timeout=300,
                                  env={**os.environ, "HYPEPROOF_AGENT_BOARD": "1"})
            items.append({"url": url, "returncode": done.returncode, "detail": (done.stdout or done.stderr).strip()[-300:]})
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        error = f"{type(exc).__name__}: {str(exc)[:200]}"
    ok = error is None and all(item["returncode"] == 0 for item in items)
    return {"ok": ok, "items": items, **({"error": error} if error else {})}



def owner_terminal(rows: list[dict], starts: list[dict]) -> bool:
    if not rows or not starts or rows[-1].get("event") != "exit":
        return False
    last, owner = rows[-1], starts[-1]
    if last.get("reservation") and owner.get("reservation"):
        return (last["reservation"] == owner["reservation"] and last.get("head") == owner.get("head")
                and (owner.get("pid") is None or last.get("pid") == owner.get("pid")))
    if "head" in last or "pid" in last:
        return last.get("head") == owner.get("head") and last.get("pid") == owner.get("pid")
    # Old single-owner logs have no correlation fields. Multiple starts may have
    # overlapped under the old implementation; their unscoped terminal is uncertain.
    return len(starts) == 1

def start(repo: str, pr: int, head: str, interval: float, timeout_s: float, delay: float, settle_s: float, *, dead_pid: int | None = None) -> dict:
    # Serialize starts for this PR on Mac/Linux; never infer stale ownership from age.
    import fcntl
    with open(log_path(repo, pr).with_suffix(".lock"), "a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        return _start_locked(repo, pr, head, interval, timeout_s, delay, settle_s, dead_pid=dead_pid)


def _start_locked(repo: str, pr: int, head: str, interval: float, timeout_s: float, delay: float, settle_s: float, *, dead_pid: int | None = None) -> dict:
    if stopped():
        raise RuntimeError("STOP or merges.paused is present; no watcher started")
    old = events(repo, pr)
    # A missing exit is uncertain, not permission to duplicate an in-flight worker.
    starts = [e for e in old if e.get("event") in ("start_pending", "start")]
    if starts and not owner_terminal(old, starts) and not (dead_pid is not None and starts[-1].get("pid") == dead_pid):
        return {"repo": repo, "pr": pr, "head": head, "status": "existing_or_uncertain",
                "log": str(log_path(repo, pr))}
    cmd = [sys.executable, str(HERE), "watch", "--repo", repo, "--pr", str(pr), "--head", head, "--interval",
           str(interval), "--timeout-min", str(timeout_s / 60), "--delay", str(delay), "--settle-min", str(settle_s / 60)]
    reservation = uuid.uuid4().hex
    log(repo, pr, "start_pending", head=head, reservation=reservation)
    with open(log_path(repo, pr).with_suffix(".out"), "a") as out:
        # A new session: the watcher survives the shell (or background task) that started it.
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True,
                                env={**os.environ, "HYPE_MWG_STARTED": "1", "HYPE_MWG_RESERVATION": reservation})
    try:
        log(repo, pr, "start", head=head, pid=proc.pid, reservation=reservation)
    except OSError:
        return {"repo": repo, "pr": pr, "head": head, "status": "launch_uncertain",
                "reservation": reservation, "log": str(log_path(repo, pr))}
    return {"repo": repo, "pr": pr, "head": head, "pid": proc.pid, "log": str(log_path(repo, pr))}


def alive(pid: int, repo: str, pr: int, head: str) -> bool | None:
    # -ww: procps on Linux cuts a piped command line at 80 columns, which hid `--pr N` on CI.
    try:
        ps = subprocess.run(["ps", "-ww", "-o", "command=", "-p", str(pid)], capture_output=True, text=True)
    except OSError:
        return None
    if ps.returncode and ps.stderr.strip():
        return None  # denied/unavailable observation is not proof of a dead owner
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
            history = events(repo, n)
            runs = [e for e in history if e["event"] in ("start_pending", "start")]
            last = history[-1] if runs else None
            terminal = owner_terminal(history, runs)
            liveness = (alive(runs[-1]["pid"], repo, n, head) if runs and
                        runs[-1].get("head") == head and runs[-1].get("pid") and not terminal else None)
            if not runs or runs[-1].get("head") != head:
                out["unarmed"].append(row)  # never armed at this head: the merge decision is not ours
            elif terminal and last.get("verdict") in STOPPED:
                out["stopped"].append({**row, "exit": last.get("verdict")})
            elif terminal and last.get("verdict") == "merged":
                out["watched"].append({**row, "exit": "merged"})
            elif last["event"] == "exit" and not terminal:
                out["errors"].append({**row, "error": "uncorrelated legacy owner exit; not rearmed"})
            elif not terminal and liveness is None:
                out["errors"].append({**row, "error": "watcher liveness unknown; not rearmed"})
            elif terminal or liveness is False:
                out["dead"].append({**row, "exit": last.get("verdict")} if last["event"] == "exit" else row)
                if rearm:
                    out["rearmed"].append(start(repo, n, head, interval, timeout_s, delay, settle_s, dead_pid=runs[-1].get("pid")))
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
        s.add_argument("--interval", type=float, default=120.0)
        s.add_argument("--timeout-min", type=float, default=90.0)
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
