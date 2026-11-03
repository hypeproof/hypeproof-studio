#!/usr/bin/env python3
"""loopctl.py - deterministic state owner for the hype-loop skill.

The model never edits a loop ledger by hand. It runs the instruction; this
script owns everything that must be exact: the charter gate, preflight, the
cron expression, the tick counter, STOP, the dashboard render, and the final
report. Every command prints one JSON object on stdout.

State lives outside every repo working tree:

    $HYPE_LOOP_HOME (default ~/.hypeproof/loop)/
      STOP                     global kill switch (stops every loop)
      <loop-id>/
        ledger.json            the loop's single source of truth
        STOP                   per-loop kill switch
        tick-prompt.md         rendered CronCreate prompt
        dashboard.html         rendered Korean dashboard (republished each tick)
        final-report.md        written by `finalize`

Exit codes: 0 ok, 2 usage, 3 charter missing/invalid/unconfirmed, 4 STOP
present, 5 duplicate loop, 6 live-class freeze, 7 low disk, 8 unknown loop,
9 bad state for the command.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCHEMA = "hype-loop/v1"
SKILL_DIR = Path(__file__).resolve().parents[1]
ASSETS = SKILL_DIR / "assets"
ACTIVE_STATES = {"pending", "running"}
CRON_LIFETIME = dt.timedelta(days=7)  # Claude Code session crons expire after 7 days
RENEW_BEFORE = dt.timedelta(hours=12)
STALE_TICK = dt.timedelta(minutes=25)
DEFAULT_MIN_DISK_GB = 5.0

# Charter keys the interview must fill before anything is scheduled.
CHARTER_REQUIRED = (
    "goal",
    "done_condition",
    "scope",
    "rounds",
    "interval",
    "autonomy",
    "verification",
    "models",
    "budget",
    "reporting",
)
AUTONOMY_KEYS = ("merge", "deploy", "prod_writes", "prs")
AUTONOMY_VALUES = {"allowed", "ask", "never", "later"}

# Lessons baked in as checks (see references/lessons.md for sources).
# L3: state must survive a reboot; /tmp and the session scratchpad do not.
VOLATILE_PREFIXES = ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")
# L11: secrets never enter a ledger, prompt or dashboard.
SECRET_PATTERNS = re.compile(
    r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(ant-)?[A-Za-z0-9_-]{20,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})"
)
# L13: hype-pr refuses these branch prefixes.
REFUSED_BRANCH_PREFIXES = ("free-start/",)


class LoopError(Exception):
    def __init__(self, code: int, message: str, **extra):
        super().__init__(message)
        self.code = code
        self.extra = extra


# ---------------------------------------------------------------- helpers

def now() -> dt.datetime:
    fixed = os.environ.get("HYPE_LOOP_NOW")  # test seam
    if fixed:
        return dt.datetime.fromisoformat(fixed)
    return dt.datetime.now(dt.timezone.utc).astimezone()


def iso(t: dt.datetime) -> str:
    return t.isoformat(timespec="seconds")


def home() -> Path:
    return Path(os.environ.get("HYPE_LOOP_HOME", "~/.hypeproof/loop")).expanduser()


def check_durable_home() -> None:
    """L3: refuse a loop home that a reboot wipes (scratchpad-wiped-on-reboot)."""
    resolved = str(home().resolve()) + "/"
    if os.environ.get("HYPE_LOOP_ALLOW_VOLATILE") == "1":
        return
    if resolved.startswith(VOLATILE_PREFIXES):
        raise LoopError(
            2,
            f"HYPE_LOOP_HOME {home()} is on a volatile path that a reboot wipes; use ~/.hypeproof/loop",
        )


def secret_hits(*texts: str) -> list[str]:
    hits = []
    for text in texts:
        for m in SECRET_PATTERNS.finditer(text or ""):
            hits.append(m.group(0)[:6] + "...")
    return hits


def loop_dir(loop_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", loop_id):
        raise LoopError(2, f"invalid loop id: {loop_id!r}")
    return home() / loop_id


def ledger_path(loop_id: str) -> Path:
    return loop_dir(loop_id) / "ledger.json"


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


@contextlib.contextmanager
def locked(loop_id: str | None = None):
    """Serialize every mutation under one lock file in HYPE_LOOP_HOME."""
    check_durable_home()  # refuse a volatile home before creating anything under it
    root = home()
    root.mkdir(parents=True, exist_ok=True)
    with open(root / ".lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def load(loop_id: str) -> dict:
    path = ledger_path(loop_id)
    if not path.is_file():
        raise LoopError(8, f"unknown loop: {loop_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def save(ledger: dict) -> None:
    ledger["updated"] = iso(now())
    atomic_write(ledger_path(ledger["loop_id"]), json.dumps(ledger, ensure_ascii=False, indent=2) + "\n")


def all_ledgers() -> list[dict]:
    out = []
    root = home()
    if not root.is_dir():
        return out
    for path in sorted(root.glob("*/ledger.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def stop_reason(ledger: dict) -> str | None:
    if (home() / "STOP").exists():
        return "global STOP file"
    if (loop_dir(ledger["loop_id"]) / "STOP").exists():
        return "loop STOP file"
    if ledger["done"] >= ledger["target"]:
        return f"done {ledger['done']} >= target {ledger['target']}"
    return None


def sha(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- interval / cron

def parse_interval(text: str) -> int:
    """Return the interval in minutes. Accepts 5m..60m dividing 60, or Nh dividing 24."""
    m = re.fullmatch(r"\s*(\d+)\s*([mh])\s*", str(text))
    if not m:
        raise LoopError(2, f"interval must look like 30m or 2h, got {text!r}")
    n, unit = int(m.group(1)), m.group(2)
    minutes = n * 60 if unit == "h" else n
    if unit == "m" and (n < 5 or 60 % n):
        raise LoopError(2, "minute intervals must be at least 5m and divide 60 (5,6,10,12,15,20,30,60)")
    if unit == "h" and (n < 1 or 24 % n):
        raise LoopError(2, "hour intervals must divide 24 (1,2,3,4,6,8,12,24)")
    return minutes


def cron_expr(minutes: int, offset: int) -> str:
    """Off-minute cron. offset must avoid :00 and :30, where every other job fires."""
    if minutes < 60:
        if not 0 < offset < minutes:
            offset = offset % minutes or 1
        mins = ",".join(str(m) for m in range(offset, 60, minutes))
        return f"{mins} * * * *"
    offset = offset % 60 or 7
    hours = minutes // 60
    return f"{offset} * * * *" if hours == 1 else f"{offset} */{hours} * * *"


def pick_offset(minutes: int, requested: int | None) -> int:
    if requested is not None:
        return requested
    span = min(minutes, 60)
    # 7 matches the slot Jay already uses (7,37); fall back to 3 for short intervals.
    return 7 if span > 7 else 3 if span > 3 else 1


# ---------------------------------------------------------------- charter

def validate_charter(charter: dict) -> list[str]:
    problems = []
    if not isinstance(charter, dict):
        return ["charter is not a JSON object"]
    for key in CHARTER_REQUIRED:
        value = charter.get(key)
        if value in (None, "", [], {}):
            problems.append(f"missing {key}")
    rounds = charter.get("rounds")
    if rounds not in (None, "") and (not isinstance(rounds, int) or isinstance(rounds, bool) or rounds < 1):
        problems.append("rounds must be a positive integer")
    if charter.get("interval"):
        try:
            parse_interval(charter["interval"])
        except LoopError as exc:
            problems.append(str(exc))
    autonomy = charter.get("autonomy")
    if isinstance(autonomy, dict):
        for key in AUTONOMY_KEYS:
            if autonomy.get(key) not in AUTONOMY_VALUES:
                problems.append(f"autonomy.{key} must be one of {sorted(AUTONOMY_VALUES)}")
    elif autonomy:
        problems.append("autonomy must be an object")
    prefix = str(charter.get("branch_prefix") or "")
    if prefix.startswith(REFUSED_BRANCH_PREFIXES):
        problems.append(f"branch_prefix {prefix!r} is refused by hype-pr; pick another prefix")
    if secret_hits(json.dumps(charter, ensure_ascii=False)):
        problems.append("charter contains something that looks like a secret; reference ~/hps-secrets instead")
    return problems


def load_charter(path: str | None) -> dict:
    if not path:
        raise LoopError(3, "no charter: run the /hype-loop start interview first (references/interview.md)")
    p = Path(path).expanduser()
    if not p.is_file():
        raise LoopError(3, f"charter file not found: {p}")
    try:
        charter = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise LoopError(3, f"charter is not valid JSON: {exc}") from exc
    problems = validate_charter(charter)
    if problems:
        raise LoopError(3, "charter incomplete: " + "; ".join(problems), problems=problems)
    return charter


AUTONOMY_KO = {"allowed": "허용", "ask": "물어보기", "never": "금지", "later": "나중에(Jay)"}


def charter_summary(charter: dict, instruction: str) -> str:
    a = charter["autonomy"]
    scope = charter["scope"]
    scope_txt = ", ".join(scope) if isinstance(scope, list) else str(scope)
    lines = [
        f"목표: {charter['goal']}",
        f"완료 조건: {charter['done_condition']}",
        f"범위: {scope_txt}",
        f"횟수·주기: {charter['rounds']}회, {charter['interval']}마다",
        "묻지 않고 할 수 있는 것: "
        + ", ".join(f"{k} {AUTONOMY_KO.get(a[k], a[k])}" for k in AUTONOMY_KEYS),
        f"검증 기준: {charter['verification']}",
        f"모델·예산: {charter['models']} / {charter['budget']}",
        f"보고: {charter['reporting']}",
        f"틱 지시: {instruction.strip()[:160]}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- preflight

def disk_free_gb(path: Path) -> float:
    override = os.environ.get("HYPE_LOOP_DISK_FREE_GB")  # test seam
    if override:
        return float(override)
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free / 1e9


def freeze_state(hook: str | None) -> tuple[bool, str]:
    """Run the live-class freeze hook. Exit 0 = clear, anything else = frozen."""
    if not hook:
        return False, "no freeze hook configured"
    try:
        proc = subprocess.run(hook, shell=True, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return True, "freeze hook timed out (treated as frozen)"
    detail = (proc.stdout or proc.stderr).strip().splitlines()
    msg = detail[-1] if detail else f"exit {proc.returncode}"
    return proc.returncode != 0, msg


def preflight(ledger_like: dict, existing_crons: set[str], instruction_sha: str | None) -> dict:
    """Checks shared by start and resume. Raises LoopError on a hard stop."""
    check_durable_home()
    root = home()
    if (root / "STOP").exists():
        raise LoopError(4, f"global STOP file present: {root / 'STOP'} (remove it to start loops)")
    loop_id = ledger_like.get("loop_id")
    for other in all_ledgers():
        if other.get("loop_id") == loop_id or other.get("state") not in ACTIVE_STATES:
            continue
        same_task = instruction_sha and other.get("instruction_sha") == instruction_sha
        live_cron = other.get("cron", {}).get("id") in existing_crons
        if same_task or live_cron:
            raise LoopError(
                5,
                f"duplicate: loop {other['loop_id']} is already {other['state']}"
                + (" with the same instruction" if same_task else f" with live cron {other['cron'].get('id')}"),
                duplicate_of=other["loop_id"],
            )
    min_gb = float(ledger_like.get("min_disk_gb", DEFAULT_MIN_DISK_GB))
    free = disk_free_gb(root)
    if free < min_gb:
        raise LoopError(7, f"low disk: {free:.1f} GB free < {min_gb} GB", disk_free_gb=round(free, 1))
    frozen, why = freeze_state(ledger_like.get("freeze_hook"))
    if frozen:
        raise LoopError(6, f"live-class freeze: {why}")
    return {"disk_free_gb": round(free, 1), "freeze": why}


# ---------------------------------------------------------------- rendering

def render_prompt(ledger: dict) -> str:
    tpl = (ASSETS / "tick-prompt.md").read_text(encoding="utf-8")
    values = {
        "LOOP_ID": ledger["loop_id"],
        "LOOPCTL": str(Path(__file__).resolve()),
        "TARGET": str(ledger["target"]),
        "INSTRUCTION": ledger["instruction"].strip(),
        "CHARTER_SUMMARY": charter_summary(ledger["charter"], ledger["instruction"]),
        "DASHBOARD": str(loop_dir(ledger["loop_id"]) / "dashboard.html"),
    }
    for key, value in values.items():
        tpl = tpl.replace("{{" + key + "}}", value)
    return tpl


def render_dashboard(ledger: dict) -> Path:
    tpl = (ASSETS / "dashboard.html").read_text(encoding="utf-8")
    public = {
        k: ledger.get(k)
        for k in ("loop_id", "state", "target", "done", "interval", "cron", "created", "updated", "log", "final")
    }
    public["instruction"] = ledger["instruction"].strip()
    public["charter_summary"] = charter_summary(ledger["charter"], ledger["instruction"])
    data = json.dumps(public, ensure_ascii=False).replace("</", "<\\/")
    out = tpl.replace("__LOOP_DATA__", data).replace("__LOOP_TITLE__", html.escape(ledger["loop_id"]))
    path = loop_dir(ledger["loop_id"]) / "dashboard.html"
    atomic_write(path, out)
    return path


# ---------------------------------------------------------------- commands

def cmd_charter_check(args) -> dict:
    charter = load_charter(args.charter)
    instruction = read_instruction(args)
    return {"ok": True, "summary": charter_summary(charter, instruction)}


def read_instruction(args) -> str:
    text = None
    if getattr(args, "instruction_file", None):
        text = Path(args.instruction_file).expanduser().read_text(encoding="utf-8")
    elif getattr(args, "instruction", None):
        text = args.instruction
    if not text or not text.strip():
        raise LoopError(3, "no instruction: the interview must settle what each tick runs")
    if secret_hits(text):
        raise LoopError(3, "instruction contains something that looks like a secret; reference ~/hps-secrets instead")
    return text


def new_loop_id(instruction: str) -> str:
    stamp = now().strftime("%Y%m%d-%H%M")
    return f"loop-{stamp}-{sha(instruction)[:6]}"


def cmd_start(args) -> dict:
    charter = load_charter(args.charter)
    if not args.confirmed:
        raise LoopError(3, "charter not confirmed: show the charter summary to the person, then pass --confirmed")
    instruction = read_instruction(args)
    minutes = parse_interval(charter["interval"])
    target = int(charter["rounds"])
    existing = {c for c in (args.existing_crons or "").split(",") if c}
    with locked():
        loop_id = args.loop_id or new_loop_id(instruction)
        if ledger_path(loop_id).exists():
            raise LoopError(5, f"loop {loop_id} already exists", duplicate_of=loop_id)
        ledger = {
            "schema": SCHEMA,
            "loop_id": loop_id,
            "state": "pending",
            "target": target,
            "done": 0,
            "interval": charter["interval"],
            "interval_minutes": minutes,
            "instruction": instruction,
            "instruction_sha": sha(instruction),
            "charter": charter,
            "freeze_hook": args.freeze_hook or charter.get("freeze_hook") or os.environ.get("HYPE_LOOP_FREEZE_HOOK"),
            "min_disk_gb": args.min_disk_gb,
            "cron": {"expr": cron_expr(minutes, pick_offset(minutes, args.minute)), "id": None},
            "dashboard": {"path": None, "url": None},
            "current_tick": None,
            "created": iso(now()),
            "log": [],
            "final": None,
        }
        checks = preflight(ledger, existing, ledger["instruction_sha"])
        d = loop_dir(loop_id)
        d.mkdir(parents=True, exist_ok=True)
        save(ledger)
        prompt_path = d / "tick-prompt.md"
        atomic_write(prompt_path, render_prompt(ledger))
        dash = render_dashboard(ledger)
        ledger["dashboard"]["path"] = str(dash)
        save(ledger)
    return {
        "ok": True,
        "loop_id": loop_id,
        "cron_expr": ledger["cron"]["expr"],
        "prompt_path": str(prompt_path),
        "dashboard_path": str(dash),
        "charter_summary": charter_summary(charter, instruction),
        "preflight": checks,
        "next": "CronCreate(cron=cron_expr, prompt=<contents of prompt_path>, recurring=true), then bind-cron",
    }


def cmd_bind_cron(args) -> dict:
    with locked():
        ledger = load(args.loop_id)
        if ledger["state"] not in ACTIVE_STATES:
            raise LoopError(9, f"loop is {ledger['state']}; resume it first")
        created = now()
        ledger["cron"].update(
            {"id": args.cron_id, "created_at": iso(created), "expires_at": iso(created + CRON_LIFETIME)}
        )
        ledger["state"] = "running"
        save(ledger)
    return {"ok": True, "loop_id": args.loop_id, "cron_id": args.cron_id, "expires_at": ledger["cron"]["expires_at"]}


def cmd_set_dashboard(args) -> dict:
    with locked():
        ledger = load(args.loop_id)
        ledger["dashboard"]["url"] = args.url
        save(ledger)
    return {"ok": True, "url": args.url}


def cmd_tick_begin(args) -> dict:
    with locked():
        ledger = load(args.loop_id)
        if ledger["state"] not in ACTIVE_STATES:
            return {"action": "stop", "reason": f"loop is {ledger['state']}", "cron_id": ledger["cron"].get("id")}
        reason = stop_reason(ledger)
        if reason:
            return {"action": "stop", "reason": reason, "cron_id": ledger["cron"].get("id")}
        t = now()
        cur = ledger.get("current_tick")
        if cur:
            started = dt.datetime.fromisoformat(cur["started"])
            if t - started < STALE_TICK:
                return {"action": "skip", "reason": f"tick {cur['tick']} still running", "tick": cur["tick"]}
            ledger["log"].append({**cur, "ended": iso(t), "status": "abandoned", "summary": "no tick-end recorded"})
        try:
            free = disk_free_gb(home())
        except OSError:
            free = None
        min_gb = float(ledger.get("min_disk_gb", DEFAULT_MIN_DISK_GB))
        if free is not None and free < min_gb:
            ledger["current_tick"] = None
            save(ledger)
            return {"action": "skip", "reason": f"low disk: {free:.1f} GB < {min_gb} GB"}
        frozen, why = freeze_state(ledger.get("freeze_hook"))
        if frozen:
            ledger["current_tick"] = None
            save(ledger)
            return {"action": "skip", "reason": f"live-class freeze: {why}"}
        ledger["done"] += 1
        ledger["current_tick"] = {"tick": ledger["done"], "started": iso(t)}
        save(ledger)
        expires = ledger["cron"].get("expires_at")
        renew = bool(expires) and dt.datetime.fromisoformat(expires) - t < RENEW_BEFORE
    return {
        "action": "run",
        "tick": ledger["done"],
        "target": ledger["target"],
        "renew_cron": renew,
        "cron_id": ledger["cron"].get("id"),
        "cron_expr": ledger["cron"]["expr"],
    }


def cmd_tick_end(args) -> dict:
    with locked():
        ledger = load(args.loop_id)
        cur = ledger.get("current_tick") or {"tick": ledger["done"], "started": None}
        if args.tick is not None and args.tick != cur["tick"]:
            raise LoopError(9, f"tick mismatch: open tick is {cur['tick']}, got {args.tick}")
        if secret_hits(args.summary, " ".join(args.links or [])):
            raise LoopError(3, "tick summary looks like it contains a secret; rewrite it without the value")
        entry = {**cur, "ended": iso(now()), "status": args.status, "summary": args.summary.strip()}
        if args.links:
            entry["links"] = args.links
        ledger["log"].append(entry)
        ledger["current_tick"] = None
        save(ledger)
        dash = render_dashboard(ledger)
        reason = stop_reason(ledger)
    return {
        "ok": True,
        "tick": entry["tick"],
        "done": ledger["done"],
        "target": ledger["target"],
        "final": reason is not None,
        "stop_reason": reason,
        "dashboard_path": str(dash),
        "dashboard_url": ledger["dashboard"].get("url"),
        "cron_id": ledger["cron"].get("id"),
    }


def cmd_stop(args) -> dict:
    with locked():
        ledger = load(args.loop_id)
        atomic_write(loop_dir(args.loop_id) / "STOP", f"{iso(now())} {args.reason or 'stop requested'}\n")
    return {
        "ok": True,
        "loop_id": args.loop_id,
        "cron_id": ledger["cron"].get("id"),
        "next": "CronDelete(cron_id) in the session that owns it, then finalize",
    }


def cmd_finalize(args) -> dict:
    with locked():
        ledger = load(args.loop_id)
        reason = args.reason or stop_reason(ledger) or "stopped"
        state = "done" if ledger["done"] >= ledger["target"] else "stopped"
        ok = sum(1 for e in ledger["log"] if e.get("status") == "ok")
        ledger["state"] = state
        ledger["final"] = {
            "at": iso(now()),
            "reason": reason,
            "ticks_run": ledger["done"],
            "ticks_ok": ok,
            "ticks_failed": sum(1 for e in ledger["log"] if e.get("status") == "fail"),
        }
        ledger["current_tick"] = None
        save(ledger)
        dash = render_dashboard(ledger)
        report = loop_dir(args.loop_id) / "final-report.md"
        lines = [
            f"# hype-loop final report: {ledger['loop_id']}",
            "",
            f"- State: {state} ({reason})",
            f"- Ticks: {ledger['done']}/{ledger['target']} run, {ok} ok",
            f"- Created: {ledger['created']}  Finished: {ledger['final']['at']}",
            f"- Dashboard: {ledger['dashboard'].get('url') or dash}",
            "",
            "## Instruction",
            "",
            ledger["instruction"].strip(),
            "",
            "## Ticks",
            "",
        ]
        for e in ledger["log"]:
            lines.append(f"- #{e.get('tick')} [{e.get('status')}] {e.get('summary', '')}")
        atomic_write(report, "\n".join(lines) + "\n")
    return {"ok": True, "state": state, "reason": reason, "report": str(report), "dashboard_path": str(dash)}


def cmd_resume(args) -> dict:
    existing = {c for c in (args.existing_crons or "").split(",") if c}
    with locked():
        ledger = load(args.loop_id)
        if ledger["state"] not in ACTIVE_STATES:
            raise LoopError(9, f"loop is {ledger['state']}; start a new loop instead")
        reason = stop_reason(ledger)
        if reason:
            raise LoopError(4 if "STOP" in reason else 9, f"will not resume: {reason}")
        if ledger["cron"].get("id") in existing:
            raise LoopError(5, f"cron {ledger['cron']['id']} is still live in this session; nothing to resume")
        checks = preflight(ledger, existing, None)
        atomic_write(loop_dir(args.loop_id) / "tick-prompt.md", render_prompt(ledger))
    return {
        "ok": True,
        "loop_id": args.loop_id,
        "cron_expr": ledger["cron"]["expr"],
        "old_cron_id": ledger["cron"].get("id"),
        "prompt_path": str(loop_dir(args.loop_id) / "tick-prompt.md"),
        "done": ledger["done"],
        "target": ledger["target"],
        "preflight": checks,
        "next": "CronCreate with the same cron_expr and prompt, then bind-cron with the new id",
    }


def summarize(ledger: dict) -> dict:
    t = now()
    expires = ledger["cron"].get("expires_at")
    left_h = None
    if expires:
        left_h = round((dt.datetime.fromisoformat(expires) - t).total_seconds() / 3600, 1)
    last = ledger["log"][-1] if ledger["log"] else None
    return {
        "loop_id": ledger["loop_id"],
        "state": ledger["state"],
        "progress": f"{ledger['done']}/{ledger['target']}",
        "interval": ledger["interval"],
        "cron_id": ledger["cron"].get("id"),
        "cron_expr": ledger["cron"]["expr"],
        "cron_hours_left": left_h,
        "stop_pending": stop_reason(ledger),
        "last": last,
        "dashboard": ledger["dashboard"].get("url") or ledger["dashboard"].get("path"),
    }


def cmd_status(args) -> dict:
    if args.loop_id:
        return {"loops": [summarize(load(args.loop_id))]}
    loops = [summarize(l) for l in all_ledgers() if args.all or l.get("state") in ACTIVE_STATES]
    return {"loops": loops, "global_stop": (home() / "STOP").exists()}


def cmd_render(args) -> dict:
    ledger = load(args.loop_id)
    return {"ok": True, "dashboard_path": str(render_dashboard(ledger))}


def cmd_import_legacy(args) -> dict:
    """Adopt a hand-made {target, done, log[]} ticks.json as a hype-loop ledger."""
    legacy = json.loads(Path(args.source).expanduser().read_text(encoding="utf-8"))
    for key in ("target", "done"):
        if not isinstance(legacy.get(key), int):
            raise LoopError(2, f"legacy file has no integer {key}")
    charter = load_charter(args.charter)
    if not args.confirmed:
        raise LoopError(3, "charter not confirmed: show the charter summary first, then pass --confirmed")
    if int(charter["rounds"]) != legacy["target"]:
        raise LoopError(3, f"charter rounds {charter['rounds']} != legacy target {legacy['target']}")
    ns = argparse.Namespace(
        charter=args.charter, confirmed=True, instruction=args.instruction, instruction_file=args.instruction_file,
        existing_crons=args.existing_crons, loop_id=args.loop_id, freeze_hook=None,
        min_disk_gb=args.min_disk_gb, minute=args.minute,
    )
    result = cmd_start(ns)
    with locked():
        ledger = load(result["loop_id"])
        ledger["done"] = legacy["done"]
        for i, raw in enumerate(legacy.get("log") or [], 1):
            entry = raw if isinstance(raw, dict) else {"summary": str(raw)}
            entry.setdefault("tick", i)
            entry.setdefault("status", "ok")
            ledger["log"].append(entry)
        ledger["imported_from"] = {"path": str(Path(args.source).expanduser()), "legacy_cron_id": args.legacy_cron_id}
        save(ledger)
        render_dashboard(ledger)
    result["done"] = legacy["done"]
    result["legacy_cron_id"] = args.legacy_cron_id
    result["next"] = "CronCreate the new prompt, bind-cron, then CronDelete the legacy cron"
    return result


# ---------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="loopctl.py", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    def instruction_args(sp):
        g = sp.add_mutually_exclusive_group()
        g.add_argument("--instruction")
        g.add_argument("--instruction-file")

    sp = sub.add_parser("charter-check", help="validate a charter and print the Korean summary")
    sp.add_argument("--charter")
    instruction_args(sp)
    sp.set_defaults(fn=cmd_charter_check)

    for name, fn in (("start", cmd_start), ("import-legacy", cmd_import_legacy)):
        sp = sub.add_parser(name)
        sp.add_argument("--charter")
        sp.add_argument("--confirmed", action="store_true")
        instruction_args(sp)
        sp.add_argument("--existing-crons", default="", help="comma-separated CronList ids in this session")
        sp.add_argument("--loop-id")
        sp.add_argument("--min-disk-gb", type=float, default=DEFAULT_MIN_DISK_GB)
        sp.add_argument("--minute", type=int, help="cron minute offset (default 7)")
        if name == "start":
            sp.add_argument("--freeze-hook")
        else:
            sp.add_argument("--source", required=True)
            sp.add_argument("--legacy-cron-id")
        sp.set_defaults(fn=fn)

    sp = sub.add_parser("bind-cron")
    sp.add_argument("loop_id")
    sp.add_argument("--cron-id", required=True)
    sp.set_defaults(fn=cmd_bind_cron)

    sp = sub.add_parser("set-dashboard")
    sp.add_argument("loop_id")
    sp.add_argument("--url", required=True)
    sp.set_defaults(fn=cmd_set_dashboard)

    sp = sub.add_parser("tick-begin")
    sp.add_argument("loop_id")
    sp.set_defaults(fn=cmd_tick_begin)

    sp = sub.add_parser("tick-end")
    sp.add_argument("loop_id")
    sp.add_argument("--tick", type=int)
    sp.add_argument("--status", choices=["ok", "fail", "partial"], required=True)
    sp.add_argument("--summary", required=True)
    sp.add_argument("--links", nargs="*")
    sp.set_defaults(fn=cmd_tick_end)

    sp = sub.add_parser("stop")
    sp.add_argument("loop_id")
    sp.add_argument("--reason")
    sp.set_defaults(fn=cmd_stop)

    sp = sub.add_parser("finalize")
    sp.add_argument("loop_id")
    sp.add_argument("--reason")
    sp.set_defaults(fn=cmd_finalize)

    sp = sub.add_parser("resume")
    sp.add_argument("loop_id")
    sp.add_argument("--existing-crons", default="")
    sp.set_defaults(fn=cmd_resume)

    sp = sub.add_parser("status")
    sp.add_argument("loop_id", nargs="?")
    sp.add_argument("--all", action="store_true")
    sp.set_defaults(fn=cmd_status)

    sp = sub.add_parser("render")
    sp.add_argument("loop_id")
    sp.set_defaults(fn=cmd_render)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = args.fn(args)
    except LoopError as exc:
        print(json.dumps({"ok": False, "error": str(exc), "code": exc.code, **exc.extra}, ensure_ascii=False))
        return exc.code
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
