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
      (the blocker promotes the PR to tier A). CI being green is not decided here:
      the repository's required checks and hype-merge enforce it.
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
    return Policy(repos=repos,
                  human_approvers=_logins(doc.get("human_approvers"), "human_approvers"),
                  automation_actors=_logins(doc.get("automation_actors"), "automation_actors"),
                  path=path)


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


# --------------------------------------------------------------------------- gate

def evaluate_gate(pr: dict, repo: str, policy: Policy, files: list[str] | None = None) -> dict[str, Any]:
    """The `merge-tier` verdict for one PR. Never raises: errors fail the gate."""
    if files is None:
        files = [f.get("path", "") for f in pr.get("files") or []] if "files" in pr else None
        count = pr.get("changedFiles")
    else:
        count = None  # a git diff list is complete by construction
    try:
        result = classify(repo, files, policy, count)
    except TierError as exc:
        return {"ok": False, "tier": "?", "matched": [], "approvers": [],
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
    return {"ok": not problems, "tier": result["tier"], "matched": result["matched"],
            "approvers": approvers, "hype_review_blockers": blockers, "problems": problems}


def fetch_pr(repo: str, number: str) -> dict:
    raw = subprocess.run(["gh", "pr", "view", number, "--repo", repo, "--json",
                          "number,author,reviews,commits,headRefOid,files,changedFiles"],
                         capture_output=True, text=True, timeout=60)
    if raw.returncode != 0:
        raise TierError(f"gh pr view failed: {raw.stderr.strip()}")
    return json.loads(raw.stdout)


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
    args = ap.parse_args(argv)

    try:
        policy = load_policy(Path(args.policy))
        if args.cmd == "classify":
            files = _read_files(args.changed_files) if args.changed_files else args.files
            result = classify(args.repo, files, policy, args.changed_count)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 10 if result["tier"] == "A" else 0
        files = _read_files(args.changed_files) if args.changed_files else None
        verdict = evaluate_gate(fetch_pr(args.repo, args.pr), args.repo, policy, files)
    except (TierError, OSError, ValueError) as exc:
        print(json.dumps({"tier": "?", "error": str(exc)}, ensure_ascii=False))
        print(f"merge-tier: cannot decide, failing closed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    if verdict["ok"]:
        print(f"OK: PR #{args.pr} is tier {verdict['tier']}; merge-tier satisfied.", file=sys.stderr)
        return 0
    for p in verdict["problems"]:
        print(f"::error::{p}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
