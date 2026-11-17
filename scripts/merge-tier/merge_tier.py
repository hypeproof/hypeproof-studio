#!/usr/bin/env python3
"""Merge tier classifier and the `merge-tier` human gate (hypeproof-harness#385).

Policy: policy/merge-tiers.yaml. A PR is tier A when one of its changed paths
matches a tier-A glob of its repository (after `exempt`); otherwise tier B.

  classify --repo R (--changed-files FILE | --files P [P ...]) [--changed-count N]
      Print {"tier", "matched", ...} as JSON. Exit 0 = tier B, 10 = tier A,
      2 = classification error (fail closed: never treat it as tier B).

  gate --repo R --pr N [--changed-files FILE]
      The `merge-tier` check. Tier A passes only with an approval on the head
      commit from a policy human approver who is not the author or last pusher,
      and with no automation approval. Tier B passes unless the latest hype-review
      lists blockers; a tier-A-grade human approval on the head overrides those
      (the blocker promotes the PR to tier A). Both tiers fail on an open objection
      (#679, evaluate_objections, docs/MERGE-OBJECTIONS.md). CI being green is not
      decided here: the repository's required checks and hype-merge enforce it.
      Exit 0 = pass, 1 = fail, 2 = could not decide (fails the check too).

The changed-file list given to `gate` should come from
`git diff --name-only --no-renames origin/<base>...HEAD`: without --no-renames a
rename out of a tier-A path would only show its new, harmless name.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - environment guard
    sys.stderr.write("PyYAML is required: python -m pip install 'pyyaml>=6,<7'\n")
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "policy" / "merge-tiers.yaml"
GATE_NAME = "merge-tier"
FILES_CAP = 100  # gh returns at most this many files per PR

# hype-review markers (scripts/ai-review/review_pr.py render_body).
AI_REVIEW_HEADER = "## 🤖 AI 리뷰"
AI_BLOCKER_HEADER = "### ❌ Blocker"
BOT_LOGINS = {"github-actions", "dependabot", "renovate", "copilot-pull-request-reviewer"}
REPO_RE = re.compile(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+")


class TierError(RuntimeError):
    """The tier could not be decided. Callers treat this as 'not tier B'."""


@dataclass(frozen=True)
class Rule:
    pattern: str
    reason: str


@dataclass
class RepoTiers:
    tier_a: list[Rule] = field(default_factory=list)
    exempt: list[str] = field(default_factory=list)
    error: str = ""            # set when the repo entry cannot be resolved here


@dataclass
class Policy:
    repos: dict[str, RepoTiers]
    human_approvers: frozenset[str]
    automation_actors: frozenset[str]
    path: Path
    # Objections (#679): how long a member review lease holds the merge, and extra
    # logins (beyond human_approvers and repository members) whose findings count.
    review_lease_minutes: int = 30
    objection_reviewers: frozenset[str] = frozenset()

    def classified(self, repo: str) -> bool:
        return repo in self.repos


# --------------------------------------------------------------------------- policy

def _pattern(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TierError(f"{where}: empty or non-string glob")
    if value.startswith("/") or "/../" in f"/{value}/" or "\\" in value:
        raise TierError(f"{where}: glob must be a relative repository path: {value!r}")
    return value


def _rules(entries: Any, where: str, default_reason: str = "") -> list[Rule]:
    if entries is None:
        return []
    if not isinstance(entries, list):
        raise TierError(f"{where}: expected a list")
    out = []
    for i, entry in enumerate(entries):
        if isinstance(entry, str):
            out.append(Rule(_pattern(entry, f"{where}[{i}]"), default_reason))
        elif isinstance(entry, dict):
            reason = entry.get("reason") or entry.get("why") or default_reason
            out.append(Rule(_pattern(entry.get("path"), f"{where}[{i}]"), " ".join(str(reason).split())))
        else:
            raise TierError(f"{where}[{i}]: expected a glob or {{path, reason}}")
    return out


def _logins(value: Any, where: str) -> frozenset[str]:
    if value is None:
        return frozenset()
    if not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() for v in value):
        raise TierError(f"{where}: expected a list of logins")
    return frozenset(value)


def load_policy(path: Path = POLICY, root: Path | None = None) -> Policy:
    """Read the tier policy. Any structural problem raises TierError (fail closed)."""
    root = root or path.resolve().parents[1]
    if not path.is_file():
        raise TierError(f"tier policy missing: {path}")
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise TierError(f"tier policy unreadable: {exc}") from None
    if not isinstance(doc, dict):
        raise TierError("tier policy must be a mapping")
    if doc.get("version", 1) != 1:
        raise TierError(f"unsupported tier policy version: {doc.get('version')!r}")
    repos_doc = doc.get("repos")
    if not isinstance(repos_doc, dict) or not repos_doc:
        raise TierError("tier policy has no repos")
    common_doc = doc.get("common") or {}
    if not isinstance(common_doc, dict):
        raise TierError("common: expected a mapping")
    common_a = _rules(common_doc.get("tier_a"), "common.tier_a")
    common_exempt = [r.pattern for r in _rules(common_doc.get("exempt"), "common.exempt")]

    repos: dict[str, RepoTiers] = {}
    for repo, body in repos_doc.items():
        if not isinstance(repo, str) or not REPO_RE.fullmatch(repo):
            raise TierError(f"repos: not an owner/name key: {repo!r}")
        body = body or {}
        if not isinstance(body, dict):
            raise TierError(f"repos.{repo}: expected a mapping")
        tiers = RepoTiers(tier_a=list(common_a) + _rules(body.get("tier_a"), f"repos.{repo}.tier_a"),
                          exempt=list(common_exempt) + [r.pattern for r in _rules(body.get("exempt"), f"repos.{repo}.exempt")])
        source = body.get("from_control_plane")
        if source is not None:
            cp_path = root / _pattern(source, f"repos.{repo}.from_control_plane")
            if cp_path.is_file():
                cp = yaml.safe_load(cp_path.read_text(encoding="utf-8")) or {}
                tiers.tier_a += _rules(cp.get("protected_paths"), f"{source}.protected_paths", "control plane")
                tiers.exempt += [r.pattern for r in _rules(cp.get("exempt_paths"), f"{source}.exempt_paths")]
            else:
                # Only that repository's own checkout has its control plane; classifying
                # it anywhere else is an error, never an empty (all tier B) rule set.
                tiers.error = f"{repo} tiers come from {source}, which is not in this checkout"
        if not tiers.tier_a and not tiers.error:
            raise TierError(f"repos.{repo}: no tier-A globs")
        repos[repo] = tiers
    objections = doc.get("objections") or {}
    if not isinstance(objections, dict) or set(objections) - {"review_lease_minutes", "reviewers"}:
        raise TierError("objections: expected a mapping with review_lease_minutes and reviewers")
    lease = objections.get("review_lease_minutes", 30)
    if type(lease) is not int or not 1 <= lease <= 240:
        raise TierError("objections.review_lease_minutes: expected an integer from 1 to 240")
    return Policy(repos=repos,
                  human_approvers=_logins(doc.get("human_approvers"), "human_approvers"),
                  automation_actors=_logins(doc.get("automation_actors"), "automation_actors"),
                  path=path, review_lease_minutes=lease,
                  objection_reviewers=_logins(objections.get("reviewers"), "objections.reviewers"))


def glob_match(path: str, pattern: str) -> bool:
    """check_control_plane.matches semantics (case-sensitive), plus a leading `**/`."""
    if pattern.endswith("/**"):
        prefix = pattern[:-3]
        if path == prefix or path.startswith(prefix + "/"):
            return True
    if fnmatch.fnmatchcase(path, pattern):
        return True
    return pattern.startswith("**/") and glob_match(path, pattern[3:])


def classify(repo: str, files: list[str] | None, policy: Policy,
             changed_count: int | None = None) -> dict[str, Any]:
    """{"tier": "A"|"B", "matched": [{path, pattern, reason}], "files": n}.

    Raises TierError when the tier cannot be decided: unknown repository, no file
    list, an empty one, or fewer files than the PR changed.
    """
    if repo not in policy.repos:
        raise TierError(f"{repo} has no entry in {policy.path.name}")
    tiers = policy.repos[repo]
    if tiers.error:
        raise TierError(tiers.error)
    if files is None:
        raise TierError("changed-file list unavailable")
    if not files:
        raise TierError("changed-file list is empty")
    if any(not isinstance(f, str) or not f.strip() for f in files):
        raise TierError("changed-file list has an empty entry")
    if changed_count is not None and changed_count > len(files):
        raise TierError(f"only {len(files)} of {changed_count} changed files are known")
    matched = []
    for f in files:
        if any(glob_match(f, ex) for ex in tiers.exempt):
            continue
        for rule in tiers.tier_a:
            if glob_match(f, rule.pattern):
                matched.append({"path": f, "pattern": rule.pattern, "reason": rule.reason or rule.pattern})
                break
    return {"repo": repo, "tier": "A" if matched else "B", "matched": matched, "files": len(files)}


def reasons(result: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for m in result.get("matched") or []:
        if m["reason"] not in out:
            out.append(m["reason"])
    return out


# --------------------------------------------------------------------------- reviews

def is_bot(login: str, automation: frozenset[str] | set[str] = frozenset()) -> bool:
    low = login.lower()
    return (not login or low.endswith("[bot]") or low.startswith("app/") or low in BOT_LOGINS
            or login in automation or f"{login}[bot]" in automation or f"app/{login}" in automation)


def latest_verdicts(reviews: list[dict] | None) -> dict[str, dict]:
    """Each reviewer's latest non-COMMENTED review (as check_control_plane does)."""
    latest: dict[str, dict] = {}
    for r in sorted(reviews or [], key=lambda r: r.get("submittedAt") or ""):
        if r.get("state") == "COMMENTED":
            continue
        login = (r.get("author") or {}).get("login", "")
        if login:
            latest[login] = r
    return latest


def last_pusher(pr: dict) -> str:
    commits = pr.get("commits") or []
    author = (pr.get("author") or {}).get("login", "")
    if not commits:
        return author
    authors = commits[-1].get("authors") or []
    return (authors[0].get("login") if authors else "") or author


def human_approvals_on_head(pr: dict, policy: Policy) -> list[str]:
    """Policy human approvers (not author, not last pusher, not bots) whose latest
    verdict is APPROVED on exactly the PR's head commit."""
    head = pr.get("headRefOid") or ""
    if not head:
        return []
    author = (pr.get("author") or {}).get("login", "")
    pusher = last_pusher(pr)
    out = []
    for login, r in latest_verdicts(pr.get("reviews")).items():
        if (r.get("state") == "APPROVED" and login in policy.human_approvers
                and login not in (author, pusher) and not is_bot(login, policy.automation_actors)
                and (r.get("commit") or {}).get("oid") == head):
            out.append(login)
    return sorted(out)


def automation_approvals(pr: dict, policy: Policy) -> list[str]:
    return sorted(login for login, r in latest_verdicts(pr.get("reviews")).items()
                  if r.get("state") == "APPROVED" and login in policy.automation_actors)


def ai_review_blockers(reviews: list[dict] | None) -> int:
    """Blocker count of the latest hype-review, 0 if it has none (or there is none)."""
    ai = [r for r in reviews or [] if (r.get("body") or "").lstrip().startswith(AI_REVIEW_HEADER)]
    if not ai:
        return 0
    body = max(ai, key=lambda r: r.get("submittedAt") or "").get("body") or ""
    if AI_BLOCKER_HEADER not in body:
        return 0
    section = body.split(AI_BLOCKER_HEADER, 1)[1].split("\n###", 1)[0].split("\n---", 1)[0]
    return max(1, sum(1 for line in section.splitlines() if line.lstrip().startswith("- ")))


# --------------------------------------------------------------------------- objections (#679)
#
# One objection model, read by the `merge-tier` check and by hype-merge (monitor.py).
# Reviewer, author and app-user protocol: docs/MERGE-OBJECTIONS.md. Inputs, in the
# shape `gh pr view --json` and the OBJECTION_QUERY GraphQL read return them:
#   reviews        [{id, author, authorAssociation, state, body, submittedAt, commit}]
#   comments       PR conversation comments [{id, author, authorAssociation, body, createdAt}]
#   reviewThreads  inline threads [{comments: [{id, author, authorAssociation, body,
#                  createdAt, replyTo: {id} | null, pullRequestReview: {id} | null}]}]
# A PR dict without `comments` or `reviewThreads` (or with `_objectionInputsTruncated`)
# is incomplete, and an incomplete read fails closed.
#
# Who counts: an objection is raised only by a trusted actor who is neither the author
# nor the last pusher (policy human approvers, objections.reviewers, or the repository's
# OWNER/MEMBER/COLLABORATOR association), never by a bot. A release by "the author"
# only counts from the PR author or the last pusher (for a bot PR, that bot). Quoted
# lines (`>`) and fenced code never create or release anything.

TRUSTED_ASSOCIATIONS = frozenset({"OWNER", "MEMBER", "COLLABORATOR"})
BLOCKING_SEVERITIES = ("P0", "P1", "P2")
FINDING_MARKER = re.compile(r"<!--\s*hype-finding\s+v1\b(.*?)-->")
HOLD_MARKER = re.compile(r"<!--\s*hype-hold\s+v1\b(.*?)-->")
LEASE_MARKER = re.compile(r"<!--\s*member-work-lease:([A-Za-z0-9._-]{1,128})\s*-->")
MARKER_ATTR = re.compile(r"\b(id|severity|status|kind)=(\S+)")
OBJECTION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{3,63}")
_SEP = r"\s*(?::|—|–|-)\s*"
_LEAD = r"^(?:[-*+]\s+)?(?:#{1,6}\s+)?"
# Today's unmarked review-agent forms, at the start of a line of the reviewer's own text.
# The severity is read loosely (`p1`, `P 1`) and an out-of-range one (`P4`, `P10`) is kept
# as a P1 "unknown severity" finding: a typo never silently drops a blocker.
_SEV = r"[Pp]\s?(\d{1,2})"
PROSE_FINDING = (
    re.compile(_LEAD + r"\*\*\s*" + _SEV + _SEP + r"(.+?)\s*\*\*"),         # **P2: title** / **P2 — title**
    re.compile(_LEAD + r"\*\*\s*" + _SEV + r"\s*\*\*(?:" + _SEP + r"|\s+)(.+)$"),  # **P2** title
    re.compile(_LEAD + r"\[\s*" + _SEV + r"\s*\](?:" + _SEP + r"|\s+)(.+)$"),     # [P2] title
)
NOT_A_FINDING = re.compile(r"^(?:none|n/?a|nothing|no (?:new )?(?:blocking )?findings?|없음)\b", re.I)
HOLD_LINE = re.compile(r"^/hold(?:\s+(.+))?$")
WITHDRAW_LINE = re.compile(r"^/withdraw(?:\s+(\S+))?$")
INLINE_CODE = re.compile(r"`[^`\n]*`")
TITLE_MAX = 140


def _ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        out = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return out if out.tzinfo else out.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if value else ""


def identity(login: str) -> str:
    """A login with GitHub's bot spellings folded: app/x, x[bot] and x are one actor."""
    return (login or "").lower().removeprefix("app/").removesuffix("[bot]")


def own_lines(body: str | None) -> tuple[list[str], list[str]]:
    """(own, quoted) lines of a comment. Fenced code belongs to neither."""
    own: list[str] = []
    quoted: list[str] = []
    fence = ""
    for raw in (body or "").splitlines():
        line = raw.strip()
        if fence:
            if line.startswith(fence):
                fence = ""
            continue
        if line.startswith(("```", "~~~")):
            fence = line[:3]
            continue
        if line.startswith(">"):
            quoted.append(line.lstrip("> \t"))
        else:
            own.append(line)
    return own, quoted


def _clean_title(text: str) -> str:
    text = re.sub(r"<!--.*?-->", "", text)
    text = " ".join(text.replace("**", "").split()).strip(" *_-—–:")
    return text if len(text) <= TITLE_MAX else text[:TITLE_MAX - 1] + "…"


def _norm_text(text: str) -> str:
    return " ".join(re.sub(r"[*_`~\[\]]", "", text).lower().split())


def parse_findings(body: str | None, *, prose: bool = True) -> list[dict[str, Any]]:
    """Findings in one review body or inline comment, in order.

    {"severity", "id" (None for prose), "title", "marked", "status": "open"|"resolved"}.
    A marker names the finding on its own line or the next one; a malformed marker is
    kept as a P1 so a typo never silently drops a blocker.
    """
    own, _ = own_lines(body)
    out: list[dict[str, Any]] = []
    skip_next_prose = False
    for i, line in enumerate(own):
        visible = INLINE_CODE.sub("", line)
        markers = list(FINDING_MARKER.finditer(visible))
        if markers:
            for marker in markers:
                attrs = dict(MARKER_ATTR.findall(marker.group(1)))
                rest = _clean_title(visible[marker.end():])
                if not rest:
                    following = next((l for l in own[i + 1:] if l.strip()), "")
                    rest = _clean_title(following)
                    skip_next_prose = True
                fid, sev, status = attrs.get("id", ""), attrs.get("severity", "").upper(), attrs.get("status", "open")
                if status == "resolved" and OBJECTION_ID.fullmatch(fid):
                    out.append({"severity": "", "id": fid, "title": rest, "marked": True, "status": "resolved"})
                elif OBJECTION_ID.fullmatch(fid) and sev in ("P0", "P1", "P2", "P3") and status == "open":
                    out.append({"severity": sev, "id": fid, "title": rest or fid, "marked": True, "status": "open"})
                else:
                    out.append({"severity": "P1", "id": None, "title": "malformed hype-finding marker: "
                                + _clean_title(marker.group(0))[:80], "marked": True, "status": "open"})
            continue
        if skip_next_prose and line.strip():
            skip_next_prose = False
            continue
        if not prose:
            continue
        for pattern in PROSE_FINDING:
            match = pattern.match(visible)
            if match:
                original = pattern.match(line)
                title = _clean_title((original or match).group(2))
                if title and not NOT_A_FINDING.match(title):
                    number = int(match.group(1))
                    severity = f"P{number}" if number <= 3 else "P1"
                    if number > 3:
                        title = _clean_title(f"unknown severity P{number}: {title}")
                    out.append({"severity": severity, "id": None, "title": title,
                                "marked": False, "status": "open"})
                break
    return out


def parse_holds(body: str | None) -> tuple[list[dict[str, Any]], list[str]]:
    """(holds, withdrawals) in one post. Withdrawal "*" means all of the poster's holds."""
    own, _ = own_lines(body)
    holds: list[dict[str, Any]] = []
    withdrawn: list[str] = []
    text_lines = [l for l in own if l and not HOLD_MARKER.search(INLINE_CODE.sub("", l))
                  and not l.startswith("approval-inbox:")]
    for line in own:
        visible = INLINE_CODE.sub("", line)
        for marker in HOLD_MARKER.finditer(visible):
            attrs = dict(MARKER_ATTR.findall(marker.group(1)))
            hid = attrs.get("id", "")
            if not OBJECTION_ID.fullmatch(hid):
                holds.append({"id": None, "title": "malformed hype-hold marker", "visible_id": False})
            elif attrs.get("status") == "withdrawn":
                withdrawn.append(hid)
            else:
                title = _clean_title(" ".join(text_lines)) or "question"
                holds.append({"id": hid, "title": title, "visible_id": True})
        match = HOLD_LINE.match(visible.strip())
        if match:
            holds.append({"id": None, "title": _clean_title(match.group(1) or "") or "hold", "visible_id": False})
        match = WITHDRAW_LINE.match(visible.strip())
        if match:
            withdrawn.append(match.group(1) or "*")
    return holds, withdrawn


@dataclass
class _Post:
    kind: str            # review | comment | thread
    id: str
    actor: str
    association: str
    body: str
    at: datetime | None
    state: str = ""
    commit: str = ""
    review_id: str = ""
    reply_to: str = ""
    thread: int = -1


def _posts(pr: dict) -> tuple[list[_Post], bool]:
    posts: list[_Post] = []
    complete = isinstance(pr.get("comments"), list) and isinstance(pr.get("reviewThreads"), list) \
        and not pr.get("_objectionInputsTruncated")
    for r in pr.get("reviews") or []:
        posts.append(_Post("review", str(r.get("id") or r.get("databaseId") or ""),
                           (r.get("author") or {}).get("login", ""), str(r.get("authorAssociation") or ""),
                           r.get("body") or "", _ts(r.get("submittedAt")), str(r.get("state") or ""),
                           str((r.get("commit") or {}).get("oid") or "")))
    for c in pr.get("comments") or []:
        posts.append(_Post("comment", str(c.get("id") or ""), (c.get("author") or {}).get("login", ""),
                           str(c.get("authorAssociation") or ""), c.get("body") or "", _ts(c.get("createdAt"))))
    for index, thread in enumerate(pr.get("reviewThreads") or []):
        comments = thread.get("comments") if isinstance(thread, dict) else None
        if isinstance(comments, dict):
            comments = comments.get("nodes")
        for c in comments or []:
            posts.append(_Post("thread", str(c.get("id") or ""), (c.get("author") or {}).get("login", ""),
                               str(c.get("authorAssociation") or ""), c.get("body") or "", _ts(c.get("createdAt")),
                               review_id=str((c.get("pullRequestReview") or {}).get("id") or ""),
                               reply_to=str((c.get("replyTo") or {}).get("id") or ""), thread=index))
    return posts, complete


def _addresses(post: _Post, obj: dict[str, Any]) -> bool:
    """The author's post answers this objection: it names its id, mentions its actor or
    quotes its title. Text the author quotes counts; text they did not write does not."""
    own, quoted = own_lines(post.body)
    # Only visible text answers: an HTML comment (a hidden marker) never does (#679, a bug
    # the simulation found: an author's hidden resolve marker named the id).
    text = re.sub(r"<!--.*?-->", " ", " ".join(own))
    if obj.get("visible_id") and obj.get("id") and re.search(
            r"(?<![A-Za-z0-9._-])" + re.escape(obj["id"]) + r"(?![A-Za-z0-9_-])", text):
        return True
    if re.search(r"(?<![A-Za-z0-9-])@" + re.escape(obj["actor"]) + r"(?![A-Za-z0-9-])", text, re.I):
        return True
    key = _norm_text(obj.get("title") or "")[:40]
    return len(key) >= 12 and key in _norm_text(" ".join(quoted))


def evaluate_objections(pr: dict, policy: Policy, now: datetime | None = None) -> dict[str, Any]:
    """Every objection on the PR, open or released, and the blocking ones.

    {"complete", "objections": [...], "blocking": [...], "problems": [...], "blockers": [...]}
    Each objection: kind (changes_requested | question | finding | review_in_progress),
    actor, id, severity, title, at, commit, on_head, status (open | released |
    overridden | info), released_by, blocks.
    """
    now = now or datetime.now(timezone.utc)
    head = pr.get("headRefOid") or ""
    author_ids = {identity((pr.get("author") or {}).get("login", "")), identity(last_pusher(pr))} - {""}
    posts, complete = _posts(pr)
    reviews = [p for p in posts if p.kind == "review"]
    by_id = {p.id: p for p in reviews if p.id}
    approvers = {a.casefold() for a in policy.human_approvers | policy.objection_reviewers}

    def human(p: _Post) -> bool:
        return bool(p.actor) and not is_bot(p.actor, policy.automation_actors) and identity(p.actor) not in author_ids

    def trusted(p: _Post) -> bool:
        # Text-based objections (findings, holds, leases) need a trusted author: on a public
        # repository anyone can comment. GitHub logins are case-insensitive.
        return human(p) and (p.actor.casefold() in approvers or p.association in TRUSTED_ASSOCIATIONS)

    def from_author(p: _Post) -> bool:
        return identity(p.actor) in author_ids

    def after(p: _Post, t: datetime | None) -> bool:
        # GitHub times have one-second resolution. A release must be strictly later than
        # what it releases, so a tie keeps the block (#679 A10).
        return p.at is not None and t is not None and p.at > t

    verdicts = latest_verdicts(pr.get("reviews"))
    overrides = []
    for login in human_approvals_on_head(pr, policy):
        at = _ts(verdicts[login].get("submittedAt"))
        if at:
            overrides.append((at, login))

    def overridden(t: datetime | None) -> str:
        later = sorted(login for at, login in overrides if t is not None and at > t)
        return later[0] if later else ""

    objections: list[dict[str, Any]] = []

    def add(kind, actor, oid, title, at, commit="", severity="", visible_id=False, source=""):
        obj = {"kind": kind, "actor": actor, "id": oid, "severity": severity, "title": title,
               "at": _iso(at), "commit": commit, "on_head": bool(commit) and commit == head,
               "status": "open", "released_by": "", "blocks": True, "visible_id": visible_id,
               "source": source, "_at": at}
        objections.append(obj)
        return obj

    # (a) a human's latest verdict is CHANGES_REQUESTED. Only that person's later
    # review (or a dismissal) releases it; no approval by anyone else does. Any human
    # counts, as in GitHub's own review decision and hype-merge's legacy blocker: a
    # refusal stays on record if its author later leaves the policy or pushes to the PR,
    # and a stranger's refusal on a public repository is cleared by a visible dismissal.
    for login, r in verdicts.items():
        p = by_id.get(str(r.get("id") or r.get("databaseId") or "")) or _Post(
            "review", "", login, str(r.get("authorAssociation") or ""), r.get("body") or "",
            _ts(r.get("submittedAt")), "CHANGES_REQUESTED", str((r.get("commit") or {}).get("oid") or ""))
        if r.get("state") == "CHANGES_REQUESTED" and p.actor and not is_bot(p.actor, policy.automation_actors):
            own, _ = own_lines(r.get("body"))
            first = next((l for l in own if l and not l.startswith("approval-inbox:")
                          and not HOLD_MARKER.search(l)), "")
            add("changes_requested", login, login, _clean_title(first) or "requested changes",
                _ts(r.get("submittedAt")), str((r.get("commit") or {}).get("oid") or ""), source=p.id)

    # (b) holds: an app question, a hype-hold marker or a `/hold` line.
    for p in posts:
        if p.kind == "thread" or not trusted(p):
            continue
        holds, _ = parse_holds(p.body)
        for hold in holds:
            hid = hold["id"] or "hold-" + sha1(f"{p.kind}:{p.id}:{hold['title']}".encode()).hexdigest()[:10]
            obj = add("question", p.actor, hid, hold["title"], p.at, p.commit, visible_id=hold["visible_id"],
                      source=p.id)
            if hold["id"] is None and hold["title"] == "malformed hype-hold marker":
                obj["visible_id"] = False
                continue
            for q in posts:
                if not after(q, p.at):
                    continue
                if identity(q.actor) == identity(p.actor):
                    _, withdrawn = parse_holds(q.body)
                    if "*" in withdrawn or hid in withdrawn:
                        obj.update(status="released", released_by=f"withdrawn by {p.actor}")
                        break
                    if q.kind == "review" and q.state in ("APPROVED", "CHANGES_REQUESTED"):
                        obj.update(status="released", released_by=f"{p.actor} reviewed ({q.state.lower()})")
                        break
                elif from_author(q) and _addresses(q, obj):
                    obj.update(status="released", released_by=f"answered by {q.actor}")
                    break

    # (c) review findings: hype-finding markers, and today's prose forms, in trusted
    # reviewers' review bodies and in the first comment of their inline threads.
    resolved: dict[tuple[str, str], datetime] = {}
    for p in posts:
        if not trusted(p):
            continue
        # A finding lives in a review body or the first comment of an inline thread; its
        # reviewer may mark it resolved anywhere (a comment, a reply, a later review).
        raises = (p.kind == "review" and p.state in ("COMMENTED", "CHANGES_REQUESTED")) or (
            p.kind == "thread" and not p.reply_to)
        commit = p.commit if p.kind == "review" else (by_id[p.review_id].commit if p.review_id in by_id else "")
        for f in parse_findings(p.body, prose=raises):
            if f["status"] == "resolved":
                key = (identity(p.actor), f["id"])
                if p.at and (key not in resolved or p.at > resolved[key]):
                    resolved[key] = p.at
                continue
            if not raises:
                continue
            fid = f["id"] or f"{f['severity'].lower()}-" + sha1(
                f"{p.actor}|{p.kind}:{p.id}|{_norm_text(f['title'])}".encode()).hexdigest()[:10]
            obj = add("finding", p.actor, fid, f["title"], p.at, commit, f["severity"],
                      visible_id=f["id"] is not None, source=p.id)
            obj["_thread"] = p.thread if p.kind == "thread" else -1
    for obj in objections:
        if obj["kind"] != "finding":
            continue
        at = obj["_at"]
        if obj["severity"] == "P3":
            obj.update(status="info", blocks=False)
            continue
        mark = resolved.get((identity(obj["actor"]), obj["id"])) if obj["visible_id"] else None
        if mark and at and mark > at:
            obj.update(status="released", released_by=f"resolved by {obj['actor']}")
            continue
        rereview = next((q for q in reviews if identity(q.actor) == identity(obj["actor"]) and after(q, at)
                         and (q.state == "APPROVED" or (q.commit and q.commit != obj["commit"]))), None)
        if rereview:
            obj.update(status="released", released_by=f"{obj['actor']} re-reviewed {rereview.commit[:8]}")
            continue
        if obj["severity"] == "P2":
            reply = next((q for q in posts if from_author(q) and after(q, at) and (
                (q.kind == "thread" and q.thread == obj["_thread"] >= 0) or _addresses(q, obj))), None)
            if reply:
                obj.update(status="released", released_by=f"answered by {reply.actor}")
                continue
        by = overridden(at)
        if by:
            obj.update(status="overridden", released_by=f"approved after it by {by}")

    # (d) a review in progress. Per trusted non-author, a member-work-lease marker opens a
    # lease; that person's next review (even in the same second) closes it. The window
    # runs from the FIRST marker of the open lease, so re-posting the marker cannot hold a
    # merge for ever (#679 A16). An open lease holds until a human approver approves the
    # head after it, or the window ends; then it fails open.
    window = timedelta(minutes=policy.review_lease_minutes)
    opened: dict[str, _Post] = {}
    closed: dict[str, tuple[_Post, _Post]] = {}
    rank = lambda q: (q.at, 1 if q.kind == "review" else 0)  # same second: marker first
    for p in sorted((q for q in posts if q.at), key=rank):
        key = identity(p.actor)
        if p.kind == "review":
            if key in opened:
                closed[key] = (opened.pop(key), p)
        elif p.kind != "thread" and trusted(p) and LEASE_MARKER.search(" ".join(own_lines(p.body)[0])):
            opened.setdefault(key, p)
    for key in sorted(set(opened) | set(closed)):
        p = opened[key] if key in opened else closed[key][0]
        until = p.at + window
        obj = add("review_in_progress", p.actor, "lease-" + _iso(p.at), f"review in progress until {_iso(until)}",
                  p.at, source=p.id)
        obj["until"] = _iso(until)
        by = overridden(p.at)
        if key not in opened:
            obj.update(status="released", released_by=f"{p.actor} reviewed")
        elif by:
            obj.update(status="overridden", released_by=f"approved after it by {by}")
        elif now >= until:
            obj.update(status="info", released_by="lease window ended; fails open")

    for obj in objections:
        if obj["status"] != "open":
            obj["blocks"] = False
        obj.pop("_at", None)
        obj.pop("_thread", None)
    blocking = [o for o in objections if o["blocks"]]
    problems = [objection_problem(o) for o in blocking]
    blockers = [objection_blocker(o) for o in blocking]
    if not complete:
        problems.insert(0, "objections: PR comments or review threads could not be read completely; "
                           "failing closed until they can")
        blockers.insert(0, "objections_unreadable")
    return {"complete": complete, "objections": objections, "blocking": blocking,
            "problems": problems, "blockers": blockers}


def objection_blocker(obj: dict[str, Any]) -> str:
    """The hype-merge blocker string: kind, actor and what identifies the objection."""
    if obj["kind"] == "changes_requested":
        return f"changes_requested:{obj['actor']}"
    if obj["kind"] == "question":
        return f"question_open:{obj['actor']}:{obj['id']}"
    if obj["kind"] == "finding":
        return f"finding_open:{obj['severity']}:{obj['actor']}:{obj['id']}"
    return f"review_in_progress:{obj['actor']}:until={obj.get('until', '')}"


def objection_problem(obj: dict[str, Any]) -> str:
    """What holds the merge and exactly what releases it, for the check log and hype-merge."""
    actor, title = obj["actor"], obj["title"]
    where = "" if obj["on_head"] or not obj["commit"] else f", on the older head {obj['commit'][:8]}"
    if obj["kind"] == "changes_requested":
        return (f"{actor} requested changes{where}: \"{title}\". Only {actor} releases it, with a new "
                f"review (Approve, from the app or GitHub), or a maintainer dismisses the review")
    if obj["kind"] == "question":
        return (f"{actor} asked a question that holds the merge (id {obj['id']}): \"{title}\". It is "
                f"released when the author answers in a PR comment that mentions @{actor} or quotes the "
                f"question, or when {actor} approves or posts /withdraw")
    if obj["kind"] == "finding":
        reply = (" or the author replies to it (in its review thread, or in a PR comment that mentions "
                 f"@{actor}, quotes it or names its id),") if obj["severity"] == "P2" else ""
        return (f"{actor}'s {obj['severity']} finding (id {obj['id']}{where}): \"{title}\". It is released "
                f"when {actor} reviews a newer head without it or marks it resolved,{reply} or a human "
                f"approver who is not the author or last pusher approves the head after the finding")
    return (f"{actor} is reviewing this PR (review lease posted {obj['at']}); the merge waits for that "
            f"review until {obj.get('until', '')}, then proceeds without it")


OBJECTION_QUERY = (
    "query($owner:String!,$name:String!) { repository(owner:$owner,name:$name) { %s } }")
OBJECTION_FIELDS = (
    "number comments(last:100) { totalCount nodes { id author { login } authorAssociation body createdAt } } "
    "reviewThreads(first:100) { totalCount pageInfo { hasNextPage } nodes { comments(first:50) { totalCount "
    "nodes { id author { login } authorAssociation body createdAt replyTo { id } pullRequestReview { id } } } } }")


def objection_query(numbers: list[int]) -> str:
    """One read-only GraphQL query for the comments and review threads of these PRs."""
    if not numbers or any(type(n) is not int or n <= 0 for n in numbers):
        raise TierError("objection inputs: invalid PR numbers")
    return OBJECTION_QUERY % " ".join(f"p{n}:pullRequest(number:{n}) {{ {OBJECTION_FIELDS} }}" for n in numbers)


def apply_objection_inputs(pr: dict, node: Any) -> None:
    """Copy one GraphQL pullRequest node onto a gh-shaped PR dict; mark truncation."""
    if not isinstance(node, dict) or node.get("number") != pr.get("number"):
        pr.pop("comments", None)
        pr.pop("reviewThreads", None)
        return
    comments = node.get("comments") or {}
    threads = node.get("reviewThreads") or {}
    pr["comments"] = list(comments.get("nodes") or [])
    pr["reviewThreads"] = [{"comments": list(((t or {}).get("comments") or {}).get("nodes") or [])}
                           for t in threads.get("nodes") or []]
    truncated = (comments.get("totalCount", 0) > len(pr["comments"])
                 or (threads.get("pageInfo") or {}).get("hasNextPage") is not False
                 or any(((t or {}).get("comments") or {}).get("totalCount", 0)
                        > len(((t or {}).get("comments") or {}).get("nodes") or [])
                        for t in threads.get("nodes") or []))
    if truncated:
        pr["_objectionInputsTruncated"] = True


# --------------------------------------------------------------------------- gate

def evaluate_gate(pr: dict, repo: str, policy: Policy, files: list[str] | None = None,
                  now: datetime | None = None) -> dict[str, Any]:
    """The `merge-tier` verdict for one PR. Never raises: errors fail the gate.

    Besides the tier rules, every open objection (evaluate_objections) fails it: a
    human's requested changes, an open question, a blocking review finding, or a review
    in progress. A human approval overrides findings and leases made before it, never a
    human's requested changes or question."""
    if files is None:
        files = [f.get("path", "") for f in pr.get("files") or []] if "files" in pr else None
        count = pr.get("changedFiles")
    else:
        count = None  # a git diff list is complete by construction
    try:
        result = classify(repo, files, policy, count)
    except TierError as exc:
        return {"ok": False, "tier": "?", "matched": [], "approvers": [], "objections": [],
                "problems": [f"tier could not be decided ({exc}); failing closed"]}
    approvers = human_approvals_on_head(pr, policy)
    head = (pr.get("headRefOid") or "")[:8]
    problems: list[str] = []
    bots = automation_approvals(pr, policy)
    if result["tier"] == "A":
        if bots:
            problems.append(f"automation actor(s) {bots} approved a tier-A PR; approvals must be human")
        if not approvers:
            problems.append(
                f"tier A ({', '.join(reasons(result))}): needs an approval on the head commit {head!r} "
                f"from one of {sorted(policy.human_approvers)} who is not the author "
                f"({(pr.get('author') or {}).get('login', '')!r}) or last pusher ({last_pusher(pr)!r})")
    blockers = ai_review_blockers(pr.get("reviews"))
    if blockers and not approvers:
        problems.append(f"the latest hype-review lists {blockers} blocker(s): fix them, or a human "
                        "approver approves the head commit (the PR is then treated as tier A)")
    objections = evaluate_objections(pr, policy, now)
    problems.extend(objections["problems"])
    return {"ok": not problems, "tier": result["tier"], "matched": result["matched"],
            "approvers": approvers, "hype_review_blockers": blockers,
            "objections": objections["objections"], "objection_blockers": objections["blockers"],
            "problems": problems}


def fetch_pr(repo: str, number: str) -> dict:
    raw = subprocess.run(["gh", "pr", "view", number, "--repo", repo, "--json",
                          "number,author,reviews,commits,headRefOid,files,changedFiles"],
                         capture_output=True, text=True, timeout=60)
    if raw.returncode != 0:
        raise TierError(f"gh pr view failed: {raw.stderr.strip()}")
    pr = json.loads(raw.stdout)
    owner, name = repo.split("/", 1)
    raw = subprocess.run(["gh", "api", "graphql", "-f", "query=" + objection_query([int(pr["number"])]),
                          "-f", "owner=" + owner, "-f", "name=" + name],
                         capture_output=True, text=True, timeout=60)
    if raw.returncode != 0:
        raise TierError(f"objection inputs could not be read: {raw.stderr.strip()}")
    data = json.loads(raw.stdout)
    if data.get("errors"):
        raise TierError("objection inputs could not be read: GraphQL errors")
    apply_objection_inputs(pr, ((data.get("data") or {}).get("repository") or {}).get(f"p{pr['number']}"))
    return pr


def annotation(text: str) -> str:
    """Escape a message for a GitHub workflow command, so PR text cannot start a new one."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _read_files(path: str) -> list[str]:
    return [line.strip() for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--policy", default=str(POLICY), help="tier policy file (default: policy/merge-tiers.yaml)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("classify", help="print the tier of a changed-file list")
    c.add_argument("--repo", required=True)
    src = c.add_mutually_exclusive_group(required=True)
    src.add_argument("--changed-files", help="file with newline-separated changed paths")
    src.add_argument("--files", nargs="+")
    c.add_argument("--changed-count", type=int, help="how many files the PR changed (detects a truncated list)")
    g = sub.add_parser("gate", help="the merge-tier check for one PR")
    g.add_argument("--repo", required=True)
    g.add_argument("--pr", required=True)
    g.add_argument("--changed-files", help="trusted changed-file list (git diff --no-renames)")
    g.add_argument("--now", help="evaluate as of this UTC time (ISO 8601; read-only replay and tests)")
    args = ap.parse_args(argv)

    try:
        policy = load_policy(Path(args.policy))
        if args.cmd == "classify":
            files = _read_files(args.changed_files) if args.changed_files else args.files
            result = classify(args.repo, files, policy, args.changed_count)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 10 if result["tier"] == "A" else 0
        files = _read_files(args.changed_files) if args.changed_files else None
        now = _ts(args.now) if args.now else None
        if args.now and now is None:
            raise TierError(f"--now is not an ISO 8601 time: {args.now!r}")
        verdict = evaluate_gate(fetch_pr(args.repo, args.pr), args.repo, policy, files, now)
    except (TierError, OSError, ValueError) as exc:
        print(json.dumps({"tier": "?", "error": str(exc)}, ensure_ascii=False))
        print(f"merge-tier: cannot decide, failing closed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    if verdict["ok"]:
        print(f"OK: PR #{args.pr} is tier {verdict['tier']}; merge-tier satisfied.", file=sys.stderr)
        return 0
    for p in verdict["problems"]:
        print(f"::error::{annotation(p)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
