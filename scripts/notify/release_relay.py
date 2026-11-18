"""Relay Studio release asks and announcements to the whole team (Jay 2026-11-16).

Studio's release-auto writes two records on the release PR as the pipeline identity
(hypeproof-org-lab-bot): hps-release-ask/1 when a release is not automatic (a gate failed,
evidence stayed missing, or RELEASE_AUTO is off), and hps-release-published/1 after a stable
release is public ("출시됨 vX"). GitHub already emailed everyone through the @mentions in those
comments. This relay, run by `stakeholders.py tick` (launchd xyz.hypeproof.notify-tick), adds the
other channels and reuses the stakeholder notifier's senders, registry and ledger:

  ask, step 1    one #team card by the existing bot mentioning every registry contact, a DM to
                 each, email when the registry enables it, and approval-inbox cards for the release
                 approvers when an inbox controller is configured (--inbox-config)
  ask, step 2    after 4 h without an answer: a DM reminder to the release approvers
  ask, step 3    after 24 h: one #team reminder mentioning the release approvers
  published      one #team card mentioning everyone ("출시됨 vX"), once per release

Only the release approvers' answers count (policy/authority.yaml, area studio-desktop-release):
a review on the PR's current head. The first one closes the ask for everybody; a new head voids
it (Studio posts a new ask for the new head). Quiet hours 22:00-09:00 KST hold every send.
Nothing here grants or records approval: the review itself is the answer.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path
from typing import Any, Callable

STUDIO = "hypeproof/hypeproof-studio"
PIPELINE = ("hypeproof-org-lab-bot", "hypeproof-org-lab-bot[bot]", "app/hypeproof-org-lab-bot")
ASK, PUBLISHED = "hps-release-ask/1", "hps-release-published/1"
AREA = "studio-desktop-release"
REMIND_AFTER, LAST_AFTER = 4 * 3600, 24 * 3600
TEAM = "*team*"  # ledger person for a whole-team post


def record(body: str, schema: str) -> dict | None:
    for m in re.finditer(r"```json\s*\n([\s\S]*?)\n```", body or ""):
        try:
            value = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("schema") == schema:
            return value
    return None


def author(c: dict) -> str:
    a = c.get("author") or {}
    return a.get("login", "") if isinstance(a, dict) else str(a)


def latest(comments: list[dict], schema: str, head: str | None = None) -> dict | None:
    for c in sorted(comments, key=lambda x: x.get("createdAt", ""), reverse=True):
        if author(c) not in PIPELINE:
            continue
        r = record(c.get("body", ""), schema)
        if r and (head is None or r.get("head_sha") == head):
            return {**r, "_url": c.get("url", ""), "_at": c.get("createdAt", "")}
    return None


def release_approvers(root: Path) -> list[str]:
    """The canon: policy/authority.yaml, area studio-desktop-release."""
    import yaml
    data = yaml.safe_load((root / "policy/authority.yaml").read_text())
    for area in data.get("areas", []):
        if area.get("id") == AREA:
            return list(area.get("approvers", []))
    raise ValueError(f"policy/authority.yaml has no area {AREA}")


def answer(reviews: list[dict], head: str, approvers: list[str]) -> dict | None:
    """The first decisive review on `head` by a release approver: it wins for everyone."""
    allowed = {a.casefold() for a in approvers}
    for r in reviews:
        if (r.get("commit") or {}).get("oid") == head and r.get("state") in ("APPROVED", "CHANGES_REQUESTED") \
                and author(r).casefold() in allowed:
            return {"by": author(r), "state": r["state"]}
    return None


def mentions(registry: dict, logins: list[str]) -> tuple[str, list[str]]:
    contacts = registry.get("contacts", {})
    ids = [contacts[l]["discord_id"] for l in logins if contacts.get(l, {}).get("discord_id")]
    return " ".join(f"<@{i}>" for i in ids), ids


def ask_text(ask: dict, url: str, names: dict[str, str]) -> str:
    who = ", ".join(names.get(a, a) for a in ask.get("approvers", []))
    reason = {"fail": "자동 출시 검사에 실패한 항목이 있어요", "uncertain": "검사 결과가 오래 확정되지 않았어요",
              "auto_off": "자동 출시가 꺼져 있어요"}.get(ask.get("reason"), "자동 출시가 되지 않았어요")
    failed = ", ".join(g["id"] for g in ask.get("gates", []) if g.get("status") != "PASS")[:120]
    return "\n".join([
        f"[출시 결정] {ask.get('version')} ({ask.get('rc_tag')}): {reason}.",
        f"걸린 항목: {failed or '없음'}",
        f"출시 승인자({who}) 중 먼저 답한 분의 결정이 적용돼요: PR 최신 커밋에서 Approve = 출시, Request changes = 보류.",
        url,
    ])


def published_text(pub: dict) -> str:
    tag = pub.get("version")
    return f"출시됨 {tag} — 설치된 앱이 업데이트를 받아요.\nhttps://github.com/{STUDIO}/releases/tag/{tag}"


def _sent(db, pr: int, head: str, person: str, step: int, channel: str) -> bool:
    return db.execute("SELECT 1 FROM sends WHERE repo=? AND pr=? AND head=? AND person=? AND step=? AND channel=?",
                      (STUDIO, pr, head, person, step, channel)).fetchone() is not None


def _log(db, pr, head, person, step, channel, now, status, detail, apply):
    if apply:
        db.execute("INSERT OR IGNORE INTO sends VALUES (?,?,?,?,?,?,?,?,?)",
                   (STUDIO, pr, head, person, step, channel, int(now), status, detail))
    return {"person": person, "step": step, "channel": channel, "status": status if apply else "would_send"}


def relay(registry: dict, db, *, senders: dict[str, Callable], team_post: Callable, gh: Callable, now: float,
          quiet: bool, apply: bool, approvers: list[str], names: dict[str, str], inbox: Callable | None = None) -> list[dict]:
    """One pass over Studio release PRs. Returns what was (or would be) sent."""
    out: list[dict] = []
    contacts = registry.get("contacts", {})
    team = sorted(contacts, key=str.casefold)
    prs = gh(["pr", "list", "--repo", STUDIO, "--label", "release", "--state", "all", "--limit", "10",
              "--json", "number,state,headRefName,headRefOid,url,comments,reviews,mergedAt"]) or []
    for p in prs:
        if not re.fullmatch(r"release/v\d+\.\d+\.\d+", p.get("headRefName", "")):
            continue
        number, head, url = p["number"], p["headRefOid"], p["url"]
        if p.get("state") == "MERGED":
            pub = latest(p.get("comments", []), PUBLISHED)
            if not pub or pub.get("verdict") != "PASS" or _sent(db, number, f"published:{pub.get('version')}", TEAM, 1, "discord"):
                continue
            if quiet:
                continue
            text, ids = mentions(registry, team)
            status, detail = team_post(f"{text}\n{published_text(pub)}", ids) if apply else ("would_send", "")
            out.append(_log(db, number, f"published:{pub.get('version')}", TEAM, 1, "discord", now, status, detail, apply))
            continue
        if p.get("state") != "OPEN":
            continue
        ask = latest(p.get("comments", []), ASK, head)
        if not ask:
            continue
        if answer(p.get("reviews", []), head, approvers):
            continue  # first answer won; nothing more to send for this head
        if quiet:
            continue
        asked_at = dt.datetime.fromisoformat(ask["_at"].replace("Z", "+00:00")).timestamp() if ask.get("_at") else now
        text = ask_text(ask, url, names)
        if not _sent(db, number, head, TEAM, 1, "discord"):
            ping, ids = mentions(registry, team)
            status, detail = team_post(f"{ping}\n{text}", ids) if apply else ("would_send", "")
            out.append(_log(db, number, head, TEAM, 1, "discord", now, status, detail, apply))
            for login in team:
                for channel in ("discord_dm",) + (("email",) if (registry.get("email") or {}).get("enabled") else ()):
                    if _sent(db, number, head, login, 1, channel):
                        continue
                    status, detail = (senders[channel](registry, contacts[login], text, subject=f"[HypeProof] {ask.get('version')} 출시 결정")
                                      if apply else ("would_send", ""))
                    out.append(_log(db, number, head, login, 1, channel, now, status, detail, apply))
            if inbox and not _sent(db, number, head, TEAM, 1, "inbox"):
                status, detail = inbox(STUDIO, number, ask) if apply else ("would_send", "")
                out.append(_log(db, number, head, TEAM, 1, "inbox", now, status, detail, apply))
            continue
        if now - asked_at >= LAST_AFTER and not _sent(db, number, head, TEAM, 3, "discord"):
            ping, ids = mentions(registry, approvers)
            status, detail = team_post(f"{ping}\n(마지막 알림) {text}", ids) if apply else ("would_send", "")
            out.append(_log(db, number, head, TEAM, 3, "discord", now, status, detail, apply))
        elif now - asked_at >= REMIND_AFTER:
            for login in approvers:
                if login in contacts and not _sent(db, number, head, login, 2, "discord_dm"):
                    status, detail = senders["discord_dm"](registry, contacts[login], f"(다시 알림) {text}") if apply else ("would_send", "")
                    out.append(_log(db, number, head, login, 2, "discord_dm", now, status, detail, apply))
    return out


def inbox_hook(config: str, state: str, root: Path) -> Callable[[str, int, dict], tuple[str, str]]:
    """Approval-inbox cards for the release approvers through the existing controller (fan-out:
    one card per eligible reviewer, first answer settles the rest; hypeproof-harness#670/#675).
    The phone push for those cards is Service #522 / Studio #4169 (not shipped yet)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("hype_approval_controller", root / "scripts/approval-inbox/controller.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    controller = module.Controller(config, state)

    def call(repo: str, pr: int, ask: dict) -> tuple[str, str]:
        context = {key: "" for key in module.CONTEXT_KEYS}
        first = module.CONTEXT_KEYS[0]
        context[first] = f"{ask.get('version')} 출시 결정 ({ask.get('rc_tag')}): " + \
            ", ".join(g["id"] for g in ask.get("gates", []) if g.get("status") != "PASS")
        for key in module.CONTEXT_KEYS[1:]:
            context[key] = "Studio release-auto 요청 (hps-release-ask/1)."
        try:
            result = controller.prepare_all(repo, pr, context)
        except Exception as error:  # the inbox decides what is requestable; report, never retry blindly
            return "failed", type(error).__name__ + ":" + str(getattr(error, "code", ""))[:60]
        states = [r.get("state", "?") + ("/" + r["reason"] if r.get("reason") else "") for r in result.get("requests", [])]
        return ("sent" if any(r.get("state") != "not_requested" for r in result.get("requests", [])) else "skipped",
                ",".join(states)[:200])
    return call
