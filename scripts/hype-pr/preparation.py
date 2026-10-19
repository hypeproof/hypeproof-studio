"""Agent-local PR preparation. This is a workflow guard, not a security boundary.

The coding agent supplies semantic judgments; deterministic checks bind them to
committed sources. No provider secret or GitHub mutation is needed for preparation.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("pr_impact", ROOT / "scripts/change-impact/impact.py")
impact = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(impact)


# Organization path -> registered policy ID for the seven repositories transferred
# on 2026-10-10 (#287). Exact identities only: an organization path the tool rejects
# sends the agent back to the former owner path, which GitHub redirects silently.
TRANSFERRED = impact.TRANSFERRED


def policy_repo(repo):
    """Transferred repos retain their registered IDs until registry migration.

    GitHub redirects these old API names to the same transferred repositories.
    Do not generalize this to an arbitrary owner or unregistered repository.
    """
    return TRANSFERRED.get(repo, repo)


def organization_repo(repo):
    """Organization path for a transferred repository's former owner path, else None."""
    return next((org for org, former in TRANSFERRED.items() if former == repo), None)


def git(checkout, *args, stderr=None):
    return subprocess.check_output(["git", "-C", str(checkout), *args], timeout=60, stderr=stderr).decode().strip()


def repo_identity(checkout, stderr=None):
    remote = git(checkout, "remote", "get-url", "origin", stderr=stderr)
    match = re.fullmatch(r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+/[^/]+?)(?:\.git)?/?", remote)
    if not match:
        raise ValueError("origin must identify the intended GitHub repository")
    return policy_repo(match[1])


def local_sources(policy, checkout):
    """Sibling checkouts whose source blobs can be read without the GitHub API.

    A snapshot reads every registered source of every registered repository, and
    `inspect` builds two snapshots while `prepare` builds two more. Only the
    repository being inspected was ever read locally, so the other registered
    repositories cost one `contents` request per source file per snapshot. With
    254 registered sources in the Lab manifest alone that is enough requests in
    a burst to trip GitHub's secondary rate limit.

    A checkout is used only when its own origin says it is that repository, and
    only for blob reads (see `Reader.content_roots`). Set
    HYPEPROOF_NO_LOCAL_SOURCES to read everything from the API instead.
    """
    return source_checkouts(policy, checkout)[0]


# What a repository without a usable sibling checkout costs. Said once per repository.
API_READS = "its sources are read through the GitHub API instead, which is slow and counts against rate limits"


def checkout_problem(candidate, repo):
    """Why a directory cannot serve `repo`'s pinned reads, or None when it can."""
    if not (candidate / ".git").exists():
        return "not a git work tree"
    try:
        # git's own message is not passed on: the caller names the directory and the fix.
        identity = repo_identity(candidate, stderr=subprocess.DEVNULL)
    except ValueError:
        # The address is not repeated either. A remote URL can carry a credential.
        return "its origin is not a plain https://github.com/ or git@github.com: address"
    except (subprocess.SubprocessError, OSError):
        try:
            git(candidate, "rev-parse", "--git-dir", stderr=subprocess.DEVNULL)
        except (subprocess.SubprocessError, OSError):
            # A worktree whose repository was deleted looks like this.
            return "git cannot open it: its .git does not lead to a repository"
        return "it has no origin remote"
    if identity != repo:
        return f"its origin is {organization_repo(identity) or identity}"
    return None


def source_checkouts(policy, checkout):
    """`local_sources`, and for each repository it could not find, why and what to do.

    A sibling that is missing or cannot be used was skipped without a word, and
    every source of that repository then went through the API. Nobody could see
    why one run took six minutes and the next thirty seconds. The second value
    maps each such repository to the path that was checked, the reason and the
    command that fixes it.

    Nothing is cloned or repaired here. A directory that is in the way may hold
    someone's work, and where to keep a clone is the owner's decision.
    """
    if os.environ.get("HYPEPROOF_NO_LOCAL_SOURCES"):
        return {}, {}
    # In the order a clone is looked for. The first one is where a missing clone
    # is expected, so it is the consumer's own workspace: that is also where the
    # launcher looks for Harness.
    bases = []
    try:
        # The consumer may be a worktree, whose siblings are not next to it.
        common = Path(git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir"))
        bases.append(common.parent.parent)
    except (subprocess.SubprocessError, OSError, IndexError):
        pass
    # ROOT can be a throwaway clone with no siblings, in which case the real
    # working copies are next to the canonical Harness checkout instead.
    configured = os.environ.get("HYPEPROOF_HARNESS")
    if configured:
        bases.append(Path(configured).expanduser().resolve().parent)
    bases.append(ROOT.parent)
    found, gaps = {}, {}
    # External source repositories are read at pinned commits only, so a sibling
    # clone can serve them the same way.
    for repo in [*policy["repositories"], *impact.external_sources(policy)]:
        name, unusable = repo.split("/")[-1], None
        for base in dict.fromkeys(bases):
            candidate = base / name
            if not candidate.exists():
                continue
            problem = checkout_problem(candidate, repo)
            if problem is None:
                found[repo] = str(candidate)
                break
            unusable = unusable or (candidate, problem)
        if repo in found:
            continue
        path, reason = unusable or (bases[0] / name, "nothing is there")
        # The organization path is the one to clone, also for a registry ID that
        # still carries the former owner (#287).
        slug = organization_repo(repo) or repo
        clone = f"gh repo clone {slug} {shlex.quote(str(path))}"
        gaps[repo] = {"repository": slug, "state": "unusable" if unusable else "missing",
                      "path": str(path), "reason": reason, "consequence": API_READS,
                      "fix": f"move {shlex.quote(str(path))} aside, then {clone}" if unusable else clone}
    return found, gaps


def gap_notice(gap):
    """One line for a person: where it looked, why not, what that costs and the fix."""
    return (f"no usable local clone of {gap['repository']} at {gap['path']} ({gap['reason']}); "
            f"{gap['consequence']}. Fix: {gap['fix']}")


def tool_version():
    paths = sorted({p for p in (ROOT / "policy").rglob("*")
                    if p.is_file() and p.suffix in {".json", ".yaml", ".yml"}}
                   | set((ROOT / "scripts/hype-pr").glob("*.py"))
                   | set((ROOT / "scripts/hype-pr").glob("*.js"))
                   | {ROOT / "scripts/change-impact/impact.py",
                      ROOT / "scripts/repo-governance/audit.py",
                      ROOT / "skills/hype-pr/SKILL.md",
                      ROOT / "skills/hype-pr/agents/openai.yaml"})
    return impact.digest({str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})


def inspect(checkout, repo, base="main", roots=None, members=(), local_gaps=False):
    checkout = Path(git(checkout, "rev-parse", "--show-toplevel"))
    if repo_identity(checkout) != repo:
        raise ValueError("checkout origin does not match --repo")
    branch = git(checkout, "symbolic-ref", "--short", "HEAD")
    if not re.fullmatch(r"(?:feat|fix|docs|chore)/[A-Za-z0-9._/-]+", branch) or ".." in branch:
        raise ValueError("use a feat/, fix/, docs/ or chore/ branch")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", base) or ".." in base:
        raise ValueError("invalid base branch")
    head = git(checkout, "rev-parse", "HEAD")
    # Read remote base directly: a stale local origin/main must not bless a receipt.
    base_tip = impact.gh(f"repos/{repo}/commits/{base}")["sha"]
    merge_base = git(checkout, "merge-base", base_tip, head)
    paths = git(checkout, "diff", "--name-only", "--no-renames", merge_base, head).splitlines()
    policy = json.loads((ROOT / "policy/change-impact.json").read_text())
    if repo not in policy["repositories"]:
        raise ValueError("repository is outside change-impact onboarding scope")
    policy["members"] = list(members)
    found, absent = source_checkouts(policy, checkout)
    reader = impact.Reader({**(roots or {}), repo: str(checkout)}, found)
    # The repository under inspection is read from this checkout, whatever is next to it.
    source_gaps = [gap for source, gap in absent.items() if source not in reader.roots]
    for gap in source_gaps:
        # Said before the reads start: a run stopped for being slow has then already said why.
        print(f"hype-pr: {gap_notice(gap)}", file=sys.stderr)
    after = impact.snapshot(reader, policy, {repo: head})
    before = impact.snapshot(reader, policy, {**after["commits"], repo: merge_base})
    planned = impact.plan(before, after)
    blockers, debt = [], []
    new_gaps = set(planned["structural_gaps"]) - set(impact.structural_gaps(before["nodes"]))
    for nid, node in after["nodes"].items():
        if node["repo"] != repo:
            continue
        old = before["nodes"].get(nid)
        if not node.get("owner"):
            if old is None or old.get("owner"):
                blockers.append(f"{nid}: new/unassigned owner; agree a domain owner")
            else:
                debt.append(f"{nid}: existing unassigned owner")
        if nid in new_gaps:
            blockers.append(f"{nid}: new missing parent stage")
    for nid in planned["structural_gaps"]:
        if nid not in new_gaps:
            debt.append(f"{nid}: existing missing parent stage")
    if git(checkout, "status", "--porcelain", "--untracked-files=all"):
        blockers.append("checkout has uncommitted or untracked changes; inspect is advisory until committed")
    if not paths:
        blockers.append("no committed PR changes")
    watched = policy["repositories"][repo]["watch_prefixes"]
    registered = {}
    for snap in (before, after):
        for nid, node in snap["nodes"].items():
            if node["repo"] == repo:
                for src in node["sources"]:
                    # An external source is another repository's file, not this path here.
                    if not impact.is_external(src):
                        registered.setdefault(src["path"], set()).add(nid)
    external = {}
    for node in after["nodes"].values():
        for src in node["sources"]:
            if impact.is_external(src):
                external.setdefault(src["repository"], set()).add(src["commit"])
    added = git(checkout, "diff", "--name-only", "--diff-filter=A", merge_base, head).splitlines()
    for path in added:
        if (re.search(r"(?i)(?:^|/)(?:intent|requirements?|designs?|testing|validation)(?:/|[-_.])", path)
                and path.endswith(".md") and path not in registered):
            blockers.append(f"{path}: register new criteria with ID, stage, owner and parent before PR creation")
    # Partial-section mappings do not hide changes elsewhere in the same file.
    unmapped = [p for p in paths if any(p.startswith(w) for w in watched)
                and (p not in registered or not (registered[p] & set(planned["changed"])))
                and p != policy["repositories"][repo]["manifest"]]
    nodes = {nid: {k: n[k] for k in ("repo", "stage", "depends_on", "owner", "sources", "revision")}
             for nid, n in after["nodes"].items()}
    report = {"version": 1, "repo": repo, "branch": branch, "base_branch": base,
              "base_tip": base_tip, "merge_base": merge_base, "head": head,
              "source_commits": after["commits"],
              "external_sources": {r: sorted(c) for r, c in sorted(external.items())},
              "tool_version": tool_version(),
              "paths": paths, "changed_nodes": planned["changed"], "tasks": planned["tasks"],
              "nodes": nodes, "unmapped": unmapped, "blockers": blockers, "existing_debt": debt}
    report["fingerprint"] = impact.digest(report)
    if local_gaps and source_gaps:
        # After the fingerprint, and only on request. This describes the machine, not
        # the change: a receipt must not go stale because someone cloned a repository.
        report["local_source_gaps"] = source_gaps
    return report


def assessment_template(report):
    return {"fingerprint": report["fingerprint"], "summary": "",
            "reviews": {t["id"]: {"disposition": "", "reason": "", "followups": []} for t in report["tasks"]},
            "path_links": {p: {"kind": "", "nodes": [], "reason": ""} for p in report["unmapped"]},
            "validation": [{"check": "", "result": "", "evidence": ""}]}


def explain(value):
    return isinstance(value, str) and len(value.strip()) >= 20


def validate_assessment(report, assessment):
    if report["blockers"]:
        raise ValueError("preparation blocked: " + "; ".join(report["blockers"]))
    if assessment.get("fingerprint") != report["fingerprint"]:
        raise ValueError("assessment is stale; inspect and assess the current source revisions")
    if not explain(assessment.get("summary")):
        raise ValueError("agent assessment needs a substantive summary")
    reviews = assessment.get("reviews", {})
    if set(reviews) != {t["id"] for t in report["tasks"]}:
        raise ValueError("assess every affected node, including upstream consistency and downstream work")
    for nid, review in reviews.items():
        if review.get("disposition") not in impact.DISPOSITIONS or not explain(review.get("reason")):
            raise ValueError(f"{nid}: disposition and substantive reasoning required")
        if review["disposition"] in {"unknown", "change-required"}:
            links = review.get("followups")
            if not isinstance(links, list) or not links or not all(
                isinstance(url, str) and re.fullmatch(r"https://github\.com/[^/]+/[^/]+/(?:issues|pull)/\d+", url)
                and policy_repo("/".join(url.split("/")[3:5])) in report["source_commits"]
                for url in links
            ):
                raise ValueError(f"{nid}: unresolved impact needs tracked issue/PR followups, not automatic approval")
    path_links = assessment.get("path_links", {})
    if set(path_links) != set(report["unmapped"]):
        raise ValueError("classify and link every unmapped watched change")
    for path, entry in path_links.items():
        if entry.get("kind") not in {"implementation", "supporting", "editorial"} or not explain(entry.get("reason")):
            raise ValueError(f"{path}: explicit artifact classification and rationale required")
        ids = entry.get("nodes")
        if not isinstance(ids, list) or not ids or not all(isinstance(n, str) and n in report["nodes"] for n in ids):
            raise ValueError(f"{path}: link existing registered node IDs; register new criteria instead of inventing IDs")
        stages = {report["nodes"][nid]["stage"] for nid in ids}
        if entry["kind"] == "implementation" and not {"requirement", "test"} <= stages:
            raise ValueError(f"{path}: implementation needs requirement and test links")
    checks = assessment.get("validation")
    if not isinstance(checks, list) or not checks:
        raise ValueError("record validation performed by the agent")
    for check in checks:
        if not check.get("check") or check.get("result") not in {"pass", "not-applicable"} or not explain(check.get("evidence")):
            raise ValueError("validation must pass or state a reason it does not apply")


def prepare(report, assessment, output):
    validate_assessment(report, assessment)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"report": report, "assessment": assessment}, ensure_ascii=False, indent=2) + "\n")
    output.chmod(0o600)
    return output


def verify(path, checkout, repo, base, branch, members):
    if not path:
        raise ValueError("run the hype-pr Skill and prepare before create --apply; --preparation is required")
    receipt = json.loads(Path(path).read_text())
    current = inspect(checkout, repo, base, members=members)
    if branch != current["branch"] or receipt["report"] != current:
        raise ValueError("preparation is stale or belongs to another branch/repository/tool version")
    validate_assessment(current, receipt["assessment"])
    remote_head = impact.gh(f"repos/{repo}/commits/{branch}")["sha"]
    if remote_head != current["head"]:
        raise ValueError("remote PR head differs from prepared HEAD; push the prepared commit first")
    return current


def summary(report):
    # Do not publish the agent's private source excerpts/reasoning across repositories.
    pins = "".join(f"External sources: `{repo}` at {', '.join(f'`{c}`' for c in commits)}\n\n"
                   for repo, commits in report.get("external_sources", {}).items())
    return ("\n\n<!-- hype-pr-prepared:v1 -->\n"
            "### Agent preparation\n\n"
            f"Source: `{report['head']}`; base: `{report['base_tip']}`\n\n{pins}"
            f"Changed files: {len(report['paths'])}; affected nodes: {len(report['tasks'])}; "
            f"existing mapping/ownership debt: {len(report['existing_debt'])}.\n\n"
            "Mapping links, semantic assessment and agent-reported validation were checked before creation. "
            "This is an agent attestation, not independent human approval or completed downstream adoption.\n")
