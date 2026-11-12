#!/usr/bin/env python3
"""stakeholders.py - tell the people a PR waits on, in five plain lines (hypeproof-harness#574).

    stakeholders.py plan    --repo hypeproof/R --pr N [--card card.json] [--registry reg.json]
    stakeholders.py request --repo hypeproof/R --pr N --card card.json --registry reg.json --state ledger.db [--only LOGIN] [--apply]
    stakeholders.py tick    --registry reg.json --state ledger.db [--apply]

Recipients come from data, never guesses: the human approvers a gate still needs (the
approval inbox's GitHubProvider.snapshot, i.e. hype-merge and the control-plane gate), the
owners of the criteria nodes whose sources the PR changes (config/traceability.json at the PR
head) and the linked issue's author and assignees. Jay is asked only when a gate needs him, and
only after 4 hours without an answer from another eligible approver (directly if he is the only one).
Handles map to members through hypeprooflab data/members.json.

Each person gets one card of at most five lines, shaped like an AskUserQuestion prompt:
what changes for users, why they are asked (and what is blocked on them), one question with
2-4 options (recommended first) and the link. The plain-Korean lines come from an authored
card (--card), written by the agent that asks; nothing is invented here.

Channels escalate per (PR, head SHA, person) for the people a gate waits on: step 1 a #team
post by the existing Discord bot that mentions only that person, plus a GitHub mention (GitHub
then emails them through their own notification settings); step 2 a Discord DM from the same
bot after four hours without a response; step 3 one last #team reminder after a day. No new
credential: the bot token and contacts are reused. The email transport exists but is off
unless the registry enables it. Stakeholders who block nothing get a single #team note. A review or a
comment by the person, a resolved gate, a new head or a closed PR stops it. Nothing is sent
from 22:00 to 09:00 KST. Contacts and credentials live only in the private registry (a 0600
file outside every repository); plan output shows whether a channel exists, never the contact.
Without --apply nothing is sent.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import sqlite3
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
KST = dt.timezone(dt.timedelta(hours=9))
QUIET_FROM, QUIET_UNTIL = 22, 9
STEPS = ((1, 0, ("discord", "github")), (2, 4 * 3600, ("discord_dm",)), (3, 24 * 3600, ("discord",)))
BOT = re.compile(r"(\[bot\]$|^app/|^github-actions$|^dependabot$|^hypeproof-agent$)")
APPROVALS = re.compile(r"policy_required_non_author_approvals:(\d+)/(\d+)")
MEMBERS = ("hypeproof/hypeprooflab", "data/members.json")
MAX_LINE = 160
CARD_SCHEMA = "hps-decision-card/1"
# Per role: the question and its answers. Each answer names the GitHub action the person takes
# with their own authorization; the bot never reviews or approves for a human.
DEFAULT_QUESTIONS = {
    # Approve / Hold / Ask: the same three buttons a later Studio inbox shows (Studio epic #3767).
    "approver": ("이 PR을 승인해 주실 수 있나요?", [("approve", "승인하기", "review:APPROVE"),
                                               ("ask", "질문 남기기", "review:COMMENT"), ("hold", "이번엔 보류", "none")]),
    "owner": ("이 변경이 맡으신 기준과 맞는지 봐 주실 수 있나요?", [("ok", "문제 없음", "comment"),
                                                       ("needs_look", "확인이 더 필요함", "comment"), ("someone_else", "다른 분이 볼 일", "none")]),
    "issue": ("요청하신 이슈가 이렇게 해결되는데 괜찮을까요?", [("ok", "괜찮음", "comment"),
                                                   ("change", "수정이 필요함", "comment"), ("later", "나중에 볼게요", "none")]),
}
CIRCLED = "①②③④"
# Jay, 2026-11-12: ask him only when no other eligible approver answers within 4 hours; when he is
# the only eligible approver, ask him directly.
FALLBACK_APPROVERS = ("jayleekr",)
FALLBACK_DELAY = 4 * 3600


class NotifyError(ValueError):
    pass


# --- GitHub reads (replaced in tests) ---------------------------------------------------

def gh_json(args: list[str]) -> Any:
    env = {**os.environ, "GH_PROMPT_DISABLED": "1", "GH_PAGER": "cat"}
    out = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=60, env=env, check=False)
    if out.returncode:
        raise NotifyError(f"gh {' '.join(args[:2])} failed")
    return json.loads(out.stdout) if out.stdout.strip() else None


def content(gh: Callable, repo: str, path: str, ref: str | None = None) -> Any:
    try:
        data = gh(["api", f"repos/{repo}/contents/{path}" + (f"?ref={ref}" if ref else "")])
    except NotifyError:
        return None
    return json.loads(base64.b64decode(data["content"])) if data and data.get("content") else None


def pr_facts(gh: Callable, repo: str, pr: int) -> dict:
    fields = "number,title,url,author,state,isDraft,headRefOid,files,closingIssuesReferences,reviews,comments"
    return gh(["pr", "view", str(pr), "--repo", repo, "--json", fields])


def approval_provider():
    spec = importlib.util.spec_from_file_location("notify_approval_provider", ROOT / "scripts/approval-inbox/github_provider.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot_of(repo: str, pr: int, module=None, pause: float = 5) -> dict:
    module = module or approval_provider()
    for attempt in range(3):  # the provider reads twice and refuses a PR that moved in between (CI running)
        try:
            return module.GitHubProvider().snapshot(repo, pr)
        except module.ProviderError as error:
            if error.code != "snapshot_changed" or attempt == 2:
                raise NotifyError(f"approval snapshot unavailable: {error.code}") from None
            time.sleep(pause)


def human_approvers() -> list[str]:
    import yaml  # the canonical control-plane policy names who may satisfy a human gate
    return list(yaml.safe_load((ROOT / "policy/control-plane.yaml").read_text())["human_approvers"])


# --- Recipients -------------------------------------------------------------------------

def login(value: Any) -> str:
    return str((value or {}).get("login") or "") if isinstance(value, dict) else str(value or "")


def is_person(handle: str) -> bool:
    return bool(handle) and not BOT.search(handle)


def touched_nodes(traceability: dict | None, paths: list[str]) -> list[dict]:
    hits = []
    for node in (traceability or {}).get("nodes", []):
        if any(src.get("path") in paths for src in node.get("sources", [])):
            hits.append({"id": node["id"], "owner": node.get("owner", "")})
    return hits


def recipients(facts: dict, snapshot: dict, traceability: dict | None, issues: dict[int, dict],
               approvers: list[str]) -> list[dict]:
    """[{login, role, blocking, reasons: [why_ko, ...]}] ordered blocking first."""
    head, author = facts["headRefOid"], login(facts.get("author"))
    approved = {login(r.get("author")) for r in facts.get("reviews", [])
                if r.get("state") == "APPROVED" and (r.get("commit") or {}).get("oid") == head}
    people: dict[str, dict] = {}

    def add(who: str, role: str, why: str, blocking: bool) -> None:
        if not is_person(who) or who.casefold() == author.casefold():
            return
        entry = people.setdefault(who, {"login": who, "role": role, "blocking": False, "reasons": []})
        if blocking and not entry["blocking"]:
            entry.update(role=role, blocking=True)
        if why not in entry["reasons"]:
            entry["reasons"].append(why)

    blockers = (snapshot.get("assessment") or {}).get("blockers", [])
    done = ", ".join(sorted(approved)) or "아직 없음"
    for blocker in blockers:
        m = APPROVALS.fullmatch(blocker)
        if m:
            have, need = int(m[1]), int(m[2])
            for who in approvers:
                if who not in approved:
                    add(who, "approver", f"머지가 승인 {need - have}건을 더 기다립니다 (지금 {have}/{need}, 승인: {done}).", True)
    eligible = snapshot.get("eligible_reviewers")
    if eligible is not None and not (approved & set(eligible)):
        for who in eligible:
            add(who, "approver", "정책·보안 파일을 바꾸는 PR이라 사람 승인 1건이 있어야 머지됩니다.", True)
    owned: dict[str, list[str]] = {}
    for node in touched_nodes(traceability, [f["path"] for f in facts.get("files", [])]):
        owned.setdefault(node["owner"], []).append(node["id"])
    for who, ids in owned.items():
        more = f" 외 {len(ids) - 1}개" if len(ids) > 1 else ""
        add(who, "owner", f"이 PR이 맡으신 기준({ids[0]}{more})의 파일을 바꿉니다.", False)
    for number, issue in sorted(issues.items()):
        add(login(issue.get("author")), "issue", f"#{number} 이슈를 만드셨습니다.", False)
        for who in issue.get("assignees", []):
            add(login(who), "issue", f"#{number} 이슈 담당자입니다.", False)
    blocking = [p for p in people.values() if p["blocking"] and p["role"] == "approver"]
    if any(p["login"] not in FALLBACK_APPROVERS for p in blocking):
        for p in blocking:
            if p["login"] in FALLBACK_APPROVERS:
                p["fallback"] = True
                p["reasons"].append("다른 승인자가 4시간 동안 답하지 않아 요청드립니다.")
    return sorted(people.values(), key=lambda p: (not p["blocking"], p.get("fallback", False), p["login"].casefold()))


def member_names(members: dict | None) -> dict[str, str]:
    return {m["github"]: m.get("displayName") or m["github"]
            for m in (members or {}).get("members", []) if m.get("github") and m.get("status", "active") == "active"}


# --- Card -------------------------------------------------------------------------------

def validate_card(card: dict) -> dict:
    if not isinstance(card, dict) or not isinstance(card.get("change_ko"), str) or not card["change_ko"].strip():
        raise NotifyError("card needs change_ko: one plain line on what changes for users")
    if len(card["change_ko"]) > MAX_LINE or "\n" in card["change_ko"]:
        raise NotifyError(f"change_ko must be one line of at most {MAX_LINE} characters")
    question = card.get("question_ko")
    if question is not None and (not isinstance(question, str) or not question.strip() or len(question) > 80 or "\n" in question):
        raise NotifyError("question_ko: one short question")
    options = card.get("options")
    if options is not None and (not isinstance(options, dict) or not 1 <= len(options) <= 4
                                or not all(isinstance(k, str) and isinstance(v, str) and 0 < len(v) <= 30 for k, v in options.items())):
        raise NotifyError("options: a map from answer id (approve, hold, ask) to a short label")
    return card


def card_id(repo: str, pr: int, head: str, person: str) -> str:
    return "DC-" + hashlib.sha256(f"{repo}#{pr}@{head}:{person}".encode()).hexdigest()[:16]


def decision_card(authored: dict, person: dict, name: str, repo: str, pr: int, url: str, head: str) -> dict:
    """The channel-agnostic card. Discord, email, GitHub and a later Studio inbox all render this."""
    question, answers = DEFAULT_QUESTIONS[person["role"]]
    labels = [label for _, label, _ in answers]
    if person["blocking"]:  # the authored question and labels are for whoever the PR waits on
        question = authored.get("question_ko") or question
        custom = authored.get("options") or {}
        unknown = set(custom) - {aid for aid, _, _ in answers}
        if unknown:
            raise NotifyError(f"options: unknown answer ids {sorted(unknown)} for the {person['role']} card")
        labels = [custom.get(aid, label) for aid, label, _ in answers]
    why = " ".join(person["reasons"])
    cid = card_id(repo, pr, head, person["login"])
    return {
        "schema": CARD_SCHEMA, "id": cid, "repo": repo, "pr": pr, "head": head, "url": url,
        "to": {"login": person["login"], "name": name}, "role": person["role"], "blocking": person["blocking"],
        "change_ko": authored["change_ko"].strip(),
        "why_ko": why if len(why) <= 2 * MAX_LINE else why[:2 * MAX_LINE - 1] + "…",
        "question_ko": question,
        "options": [{"id": aid, "label_ko": label, "recommended": i == 0, "github_action": action}
                    for i, ((aid, _, action), label) in enumerate(zip(answers, labels))],
        # An answer is the recipient's own GitHub review or comment, under their own GitHub
        # authorization. studio_url stays empty until the member-only Studio inbox exists.
        "answer": {"card_id": cid, "by": "recipient_own_github_authorization", "studio_url": None},
    }


def render_text(card: dict) -> list[str]:
    """Five plain lines (Discord, email body, a Studio inbox preview)."""
    choices = "  ".join(f"{CIRCLED[i]} {o['label_ko']}{' (추천)' if o['recommended'] else ''}" for i, o in enumerate(card["options"]))
    return [f"[HypeProof] {card['repo'].split('/')[-1]} #{card['pr']} — {card['to']['name']}님께",
            f"바뀌는 점: {card['change_ko']}", f"받는 이유: {card['why_ko']}", f"질문: {card['question_ko']}  {choices}", card["url"]]


def render_github(card: dict, approvals_hint: str, step: int) -> str:
    """English durable record on the PR; GitHub records stay English."""
    ask = "your approval" if card["blocking"] else "a quick look (you are a stakeholder)"
    return (f"@{card['to']['login']} this PR is waiting on {ask}{approvals_hint}. "
            "A short summary was sent to you on Discord; review or reply here to stop the reminders.\n\n"
            f"<!-- hype-notify:v1 card={card['id']} person={card['to']['login']} head={card['head']} step={step} -->")


# --- Registry, ledger and senders -------------------------------------------------------

def load_registry(path: str | None) -> dict:
    if not path:
        return {"contacts": {}}
    p = Path(path)
    st = p.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise NotifyError("the registry must be a private regular file (chmod 600) outside every repository")
    if (ROOT / ".git").exists() and str(p.resolve()).startswith(str(ROOT.resolve())):
        raise NotifyError("the registry must not live inside a repository")
    return json.loads(p.read_text())


def ledger(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.executescript("""
      CREATE TABLE IF NOT EXISTS requests (repo TEXT, pr INTEGER, head TEXT, person TEXT, card TEXT, person_json TEXT,
        first_sent_at INTEGER, closed_at INTEGER, close_reason TEXT, PRIMARY KEY (repo, pr, head, person));
      CREATE TABLE IF NOT EXISTS sends (repo TEXT, pr INTEGER, head TEXT, person TEXT, step INTEGER, channel TEXT,
        sent_at INTEGER, status TEXT, detail TEXT, PRIMARY KEY (repo, pr, head, person, step, channel));
    """)
    return db


def _transport(name: str):
    spec = importlib.util.spec_from_file_location(f"notify_transport_{name}", Path(__file__).with_name("transports") / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _discord(registry: dict) -> tuple[str | None, str | None]:
    cfg = registry.get("discord") or {}
    return cfg.get("bot_token"), cfg.get("team_channel_id")


def send_discord(registry: dict, contact: dict, text: str, **_) -> tuple[str, str]:
    """A #team post by the existing bot; Discord may ping only this person."""
    (token, channel), uid = _discord(registry), contact.get("discord_id")
    if not token or not channel or not uid:
        return "skipped", "no Discord bot, channel or contact"
    status, info = asyncio.run(_transport("discord_bot").post(channel, f"<@{uid}> {text}", token=token, mention_user_ids=[uid]))
    return ("sent", info) if 200 <= status < 300 else ("failed", f"HTTP {status} {info}")


def send_discord_dm(registry: dict, contact: dict, text: str, **_) -> tuple[str, str]:
    token, uid = _discord(registry)[0], contact.get("discord_id")
    if not token or not uid:
        return "skipped", "no Discord bot or contact"
    status, info = asyncio.run(_transport("discord_bot").dm(uid, text, token=token))
    return ("sent", info) if 200 <= status < 300 else ("failed", f"HTTP {status} {info}")


def send_email(registry: dict, contact: dict, text: str, subject: str = "", **_) -> tuple[str, str]:
    cfg, to = registry.get("email") or {}, contact.get("email")
    if not to or not cfg.get("token") or not cfg.get("account_id"):
        return "skipped", "no email contact or sender"
    status, err = asyncio.run(_transport("email_cloudflare").send(to, text, subject=subject, account_id=cfg["account_id"],
                                                                  token=cfg["token"], sender=cfg.get("from", "notify@hypeproof-ai.xyz")))
    return ("sent", "") if 200 <= status < 300 else ("failed", f"HTTP {status} {err[:80]}")


def send_github(registry: dict, contact: dict, text: str, repo: str = "", pr: int = 0, **_) -> tuple[str, str]:
    wrapper = (registry.get("github") or {}).get("wrapper") or str(ROOT / "scripts/agent-identity/with-agent-identity.sh")
    out = subprocess.run([wrapper, "gh", "api", f"repos/{repo}/issues/{pr}/comments", "-f", f"body={text}", "--jq", ".id"],
                         capture_output=True, text=True, timeout=120, env={**os.environ, "HYPEPROOF_AGENT_REPOSITORY": repo})
    return ("sent", f"id:{out.stdout.strip()}") if out.returncode == 0 else ("failed", "GitHub comment refused")


SENDERS: dict[str, Callable[..., tuple[str, str]]] = {"discord": send_discord, "discord_dm": send_discord_dm,
                                                      "email": send_email, "github": send_github}


def step_channels(channels: tuple, registry: dict, step: int) -> tuple:
    """Email is off by default; a registry with email.enabled adds it to the DM step."""
    if step == 2 and (registry.get("email") or {}).get("enabled"):
        return (*channels, "email")
    return channels


def quiet(now: float) -> bool:
    hour = dt.datetime.fromtimestamp(now, KST).hour
    return hour >= QUIET_FROM or hour < QUIET_UNTIL


# --- Commands ---------------------------------------------------------------------------

def plan(repo: str, pr: int, card: dict | None, registry: dict, *, gh: Callable = gh_json,
         snapshot: Callable = snapshot_of, approvers: Callable = human_approvers) -> dict:
    facts = pr_facts(gh, repo, pr)
    snap = snapshot(repo, pr)
    trace = content(gh, repo, "config/traceability.json", facts["headRefOid"])
    issues = {}
    for ref in facts.get("closingIssuesReferences", []):
        issues[ref["number"]] = gh(["issue", "view", str(ref["number"]), "--repo", repo, "--json", "author,assignees"])
    names = member_names(content(gh, *MEMBERS))
    people = recipients(facts, snap, trace, issues, approvers())
    card = validate_card(card) if card else {"change_ko": "(작성된 카드 없음: --card로 한 줄 요약을 넣어야 보낼 수 있습니다)"}
    contacts = registry.get("contacts", {})
    approvals_hint = next((f" (approvals {m[1]}/{m[2]})" for b in snap.get("assessment", {}).get("blockers", [])
                           if (m := APPROVALS.fullmatch(b))), "")
    out = []
    for person in people:
        name = names.get(person["login"], person["login"])
        decision = decision_card(card, person, name, repo, pr, facts["url"], facts["headRefOid"])
        contact = contacts.get(person["login"], {})
        out.append({**person, "name": name, "member": person["login"] in names, "card": decision,
                    "text": render_text(decision), "github_comment": render_github(decision, approvals_hint, 1),
                    "channels": {"discord": bool(contact.get("discord_id") and all(_discord(registry))),
                                 "discord_dm": bool(contact.get("discord_id") and _discord(registry)[0]),
                                 "github": True,
                                 "email": bool(contact.get("email") and (registry.get("email") or {}).get("enabled"))}})
    return {"repo": repo, "pr": pr, "url": facts["url"], "head": facts["headRefOid"], "state": facts["state"],
            "blockers": snap.get("assessment", {}).get("blockers", []), "recipients": out,
            "steps": [{"step": s, "after_hours": d // 3600, "channels": list(c)} for s, d, c in STEPS]}


def deliver(db, registry: dict, row: dict, step: int, channels: tuple, now: float, apply: bool) -> list[dict]:
    person = json.loads(row["person_json"])
    card_lines = person["text"]
    results = []
    for channel in channels:
        key = (row["repo"], row["pr"], row["head"], row["person"], step, channel)
        if db.execute("SELECT 1 FROM sends WHERE repo=? AND pr=? AND head=? AND person=? AND step=? AND channel=?", key).fetchone():
            results.append({"channel": channel, "step": step, "status": "already_sent"})
            continue
        text = person["github_comment"].replace("step=1", f"step={step}") if channel == "github" else "\n".join(card_lines)
        if not apply:
            results.append({"channel": channel, "step": step, "status": "would_send"})
            continue
        status, detail = SENDERS[channel](registry, registry.get("contacts", {}).get(row["person"], {}), text,
                                          subject=f"[HypeProof] {person['card']['question_ko']}", repo=row["repo"], pr=row["pr"])
        db.execute("INSERT INTO sends VALUES (?,?,?,?,?,?,?,?,?)", (*key, int(now), status, detail))
        results.append({"channel": channel, "step": step, "status": status, "detail": detail})
    return results


def request(repo: str, pr: int, card: dict, registry: dict, db, *, only: list[str] | None = None, apply: bool = False,
            now: float | None = None, **sources) -> dict:
    now = time.time() if now is None else now
    planned = plan(repo, pr, card, registry, **sources)
    if planned["state"] != "OPEN":
        return {**planned, "sent": [], "note": "PR is not open; nothing sent"}
    if quiet(now):
        return {**planned, "sent": [], "note": "quiet hours (22:00-09:00 KST); run again later"}
    sent = []
    for person in planned["recipients"]:
        if only and person["login"] not in only:
            continue
        row = {"repo": repo, "pr": pr, "head": planned["head"], "person": person["login"], "person_json": json.dumps(person, ensure_ascii=False)}
        due = now + FALLBACK_DELAY if person.get("fallback") else now
        if apply:
            db.execute("INSERT OR IGNORE INTO requests VALUES (?,?,?,?,?,?,?,NULL,NULL)",
                       (repo, pr, planned["head"], person["login"], json.dumps(card, ensure_ascii=False), row["person_json"], int(due)))
        if person.get("fallback"):  # tick sends it at `due` unless another approver answered first
            sent.append({"person": person["login"], "results": [{"channel": "*", "step": 1, "status": "scheduled", "due": int(due)}]})
            continue
        channels = STEPS[0][2] if person["blocking"] else ("discord",)  # FYI: one quiet note, no escalation
        sent.append({"person": person["login"], "results": deliver(db, registry, row, 1, channels, now, apply)})
    return {**planned, "sent": sent}


def responded(facts: dict, person: str, since: int) -> bool:
    def after(value: str | None) -> bool:
        return bool(value) and dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() > since
    return any(login(r.get("author")) == person and after(r.get("submittedAt")) for r in facts.get("reviews", [])) or \
        any(login(c.get("author")) == person and after(c.get("createdAt")) for c in facts.get("comments", []))


def tick(registry: dict, db, *, apply: bool = False, now: float | None = None, gh: Callable = gh_json,
         snapshot: Callable = snapshot_of, approvers: Callable = human_approvers) -> list[dict]:
    now = time.time() if now is None else now
    report = []
    for row in db.execute("SELECT * FROM requests WHERE closed_at IS NULL").fetchall():
        facts = pr_facts(gh, row["repo"], row["pr"])
        person = json.loads(row["person_json"])
        reason = None
        if facts["state"] != "OPEN":
            reason = "pr_closed"
        elif facts["headRefOid"] != row["head"]:
            reason = "new_head"
        elif responded(facts, row["person"], row["first_sent_at"]):
            reason = "responded"
        elif person["blocking"]:
            snap = snapshot(row["repo"], row["pr"])
            still = recipients(facts, snap, None, {}, approvers())
            if not any(p["login"] == row["person"] and p["blocking"] for p in still):
                reason = "resolved"
        if reason:
            if apply:
                db.execute("UPDATE requests SET closed_at=?, close_reason=? WHERE repo=? AND pr=? AND head=? AND person=?",
                           (int(now), reason, row["repo"], row["pr"], row["head"], row["person"]))
            report.append({"person": row["person"], "pr": f"{row['repo']}#{row['pr']}", "closed": reason})
            continue
        if quiet(now) or not person["blocking"]:
            continue
        if person.get("fallback") and not db.execute(
                "SELECT 1 FROM sends WHERE repo=? AND pr=? AND head=? AND person=? AND step=1",
                (row["repo"], row["pr"], row["head"], row["person"])).fetchone():
            if now < row["first_sent_at"]:
                continue
            others = db.execute("SELECT person, first_sent_at FROM requests WHERE repo=? AND pr=? AND head=? AND person<>?",
                                (row["repo"], row["pr"], row["head"], row["person"])).fetchall()
            if any(responded(facts, o["person"], o["first_sent_at"]) for o in others):
                if apply:
                    db.execute("UPDATE requests SET closed_at=?, close_reason='other_approver_answered' WHERE repo=? AND pr=? AND head=? AND person=?",
                               (int(now), row["repo"], row["pr"], row["head"], row["person"]))
                report.append({"person": row["person"], "pr": f"{row['repo']}#{row['pr']}", "closed": "other_approver_answered"})
                continue
            results = deliver(db, registry, dict(row), 1, STEPS[0][2], now, apply)
            if apply:  # escalation for the fallback counts from now
                db.execute("UPDATE requests SET first_sent_at=? WHERE repo=? AND pr=? AND head=? AND person=?",
                           (int(now), row["repo"], row["pr"], row["head"], row["person"]))
            report.append({"person": row["person"], "pr": f"{row['repo']}#{row['pr']}", "step": 1, "fallback": True, "results": results})
            continue
        for step, delay, channels in STEPS[1:]:
            if now - row["first_sent_at"] >= delay:
                results = deliver(db, registry, dict(row), step, step_channels(channels, registry, step), now, apply)
                if any(r["status"] not in ("already_sent",) for r in results):
                    report.append({"person": row["person"], "pr": f"{row['repo']}#{row['pr']}", "step": step, "results": results})
                    break
    return report


def bot_token_from(env_file: str) -> str:
    """Read DISCORD_BOT_TOKEN from the existing bot's private .env (reused, never copied or printed)."""
    path = Path(env_file).expanduser()
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise NotifyError("the bot token file must be a private regular file (chmod 600)")
    for line in path.read_text().splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "DISCORD_BOT_TOKEN" and value.strip():
            return value.strip().strip('"').strip("'")
    raise NotifyError("DISCORD_BOT_TOKEN not found in the bot token file")


def with_discord(registry: dict, env_file: str | None, channel: str | None) -> dict:
    if env_file or channel:
        discord = dict(registry.get("discord") or {})
        if env_file:
            discord["bot_token"] = bot_token_from(env_file)
        if channel:
            discord["team_channel_id"] = channel
        registry = {**registry, "discord": discord}
    return registry


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "request"):
        s = sub.add_parser(name)
        s.add_argument("--repo", required=True)
        s.add_argument("--pr", required=True, type=int)
        s.add_argument("--card")
        s.add_argument("--registry")
        s.add_argument("--discord-env", help="private .env of the existing bot (DISCORD_BOT_TOKEN)")
        s.add_argument("--team-channel", help="#team channel id (Lab CLAUDE.md is the canon)")
        if name == "request":
            s.add_argument("--state", required=True)
            s.add_argument("--only", action="append")
            s.add_argument("--apply", action="store_true")
    t = sub.add_parser("tick")
    t.add_argument("--registry", required=True)
    t.add_argument("--state", required=True)
    t.add_argument("--discord-env")
    t.add_argument("--team-channel")
    t.add_argument("--apply", action="store_true")
    args = p.parse_args(argv)
    try:
        registry = with_discord(load_registry(args.registry), args.discord_env, args.team_channel)
        card = json.loads(Path(args.card).read_text()) if getattr(args, "card", None) else None
        if args.cmd == "plan":
            out = plan(args.repo, args.pr, card, registry)
        elif args.cmd == "request":
            if not card:
                raise NotifyError("request needs --card")
            out = request(args.repo, args.pr, card, registry, ledger(args.state), only=args.only, apply=args.apply)
        else:
            out = tick(registry, ledger(args.state), apply=args.apply)
    except (NotifyError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)[:300]}, ensure_ascii=False))
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
