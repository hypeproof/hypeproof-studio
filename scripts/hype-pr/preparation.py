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


# Former owner path -> organization path for the seven repositories transferred on
# 2026-10-10 (#287). The registry is keyed by the organization path. Exact identities
# only: an organization path the tool rejects sends the agent back to the former owner
# path, which GitHub redirects silently.
TRANSFERRED = impact.TRANSFERRED


def policy_repo(repo):
    """The registered policy ID: the organization path, also for a former owner path.

    A checkout cloned before the transfer still has the former path as its origin,
    and GitHub redirects it to the same repository. Do not generalize this to an
    arbitrary owner or unregistered repository.
    """
    return TRANSFERRED.get(repo, repo)


def organization_repo(repo):
    """Organization path for a transferred repository's former owner path, else None."""
    return TRANSFERRED.get(repo)


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
    # A consumer's launcher runs Harness from its own engine worktree in the
    # cache (#359) and names the canonical checkout it came from.
    for name in ("HYPEPROOF_HARNESS", "HYPEPROOF_CANONICAL_CHECKOUT"):
        configured = os.environ.get(name)
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
        # The organization path is the one to clone (#287).
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


BRANCH_PREFIXES = ("feat", "fix", "docs", "chore")


def bare_branch(ref):
    """`main` for `origin/main`, `refs/heads/main` or `refs/remotes/origin/main`.

    The base is looked up on GitHub, where a remote-tracking name means nothing:
    `commits/origin/main` answers 422 and the run used to end in that raw status.
    """
    for prefix in ("refs/remotes/origin/", "refs/heads/", "origin/"):
        if ref.startswith(prefix) and len(ref) > len(prefix):
            return ref[len(prefix):]
    return ref


def remote_tip(repo, ref):
    """The commit `ref` names on GitHub, with a fix instead of a bare 404/422."""
    try:
        return impact.gh(f"repos/{repo}/commits/{ref}")["sha"]
    except impact.GitHubAccessError as exc:
        if re.search(r"HTTP (?:404|422)\b", str(exc)):
            raise ValueError(f"ref `{ref}` not found on `{repo}`: push the branch or pass the bare branch name") from None
        raise


def current_branch(checkout):
    try:
        return git(checkout, "symbolic-ref", "--short", "HEAD", stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        sha = git(checkout, "rev-parse", "--short", "HEAD")
        raise ValueError(f"check out a branch (HEAD is detached at {sha}): git switch -c fix/<name>") from None


def check_branch_name(branch):
    if ".." in branch:
        raise ValueError(f"branch `{branch}` contains `..`; rename it: git branch -m {shlex.quote(branch)} <new-name>")
    if not re.fullmatch(r"(?:%s)/[A-Za-z0-9._/-]+" % "|".join(BRANCH_PREFIXES), branch):
        prefixes = ", ".join(f"{p}/" for p in BRANCH_PREFIXES)
        fix = shlex.quote(f"fix/{branch}")
        raise ValueError(f"branch `{branch}` needs a {prefixes} prefix; rename it, for example: "
                         f"git branch -m {shlex.quote(branch)} {fix}")


def has_commit(checkout, sha):
    return subprocess.run(["git", "-C", str(checkout), "cat-file", "-e", f"{sha}^{{commit}}"],
                          capture_output=True, timeout=60).returncode == 0


def fetch_command(checkout, base):
    return ["git", "-C", str(checkout), "fetch", "--quiet", "origin", base]


def ensure_base_tip(checkout, base, base_tip):
    """Fetch the base once when its remote tip is not in this checkout yet.

    `merge-base` with an unknown commit fails with a bare git error, and the usual
    cause is only that `git fetch origin <base>` was not run after the base moved.
    """
    if has_commit(checkout, base_tip):
        return
    fetched = subprocess.run(fetch_command(checkout, base), capture_output=True, timeout=300)
    # git's own output is not passed on: a fetch error can repeat a remote URL with a credential.
    if fetched.returncode:
        raise ValueError(f"base tip {base_tip[:12]} of `{base}` is not in this checkout and "
                         f"`git fetch origin {base}` failed; check network access and credentials, then retry")
    if not has_commit(checkout, base_tip):
        raise ValueError(f"base tip {base_tip[:12]} of `{base}` is still not in this checkout after "
                         f"`git fetch origin {base}`; check that origin is the repository being inspected")


def inspect(checkout, repo, base="main", roots=None, members=(), local_gaps=False):
    checkout = Path(git(checkout, "rev-parse", "--show-toplevel"))
    if repo_identity(checkout) != repo:
        raise ValueError("checkout origin does not match --repo")
    branch = current_branch(checkout)
    check_branch_name(branch)
    base = bare_branch(base)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", base) or ".." in base:
        raise ValueError(f"invalid base branch `{base}`; pass a bare branch name such as main")
    head = git(checkout, "rev-parse", "HEAD")
    # Read remote base directly: a stale local origin/main must not bless a receipt.
    base_tip = remote_tip(repo, base)
    ensure_base_tip(checkout, base, base_tip)
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


# Rules an assessment must meet, in the words `validate_assessment` reports them.
# Written into every assessment template and mirrored in skills/hype-pr/SKILL.md.
MIN_EXPLANATION = 20
RESULTS = ("pass", "not-applicable")
LINK_KINDS = ("implementation", "supporting", "editorial")
UNRESOLVED = ("unknown", "change-required")
FOLLOWUP = re.compile(r"https://github\.com/[^/]+/[^/]+/(?:issues|pull)/\d+")
ASSESSMENT_RULES = [
    "fingerprint: keep the value inspect wrote; if the source changed, inspect again and reassess",
    f"summary: concrete purpose and effect, at least {MIN_EXPLANATION} characters",
    "reviews: exactly one entry per affected node (report tasks), no other IDs",
    f"reviews.<id>.disposition: one of {', '.join(sorted(impact.DISPOSITIONS))}",
    f"reviews.<id>.reason: at least {MIN_EXPLANATION} characters",
    f"reviews.<id>.followups: when disposition is {' or '.join(UNRESOLVED)}, a non-empty list of "
    "https://github.com/<owner>/<repo>/issues/<n> or /pull/<n> URLs in a registered repository",
    "path_links: exactly one entry per unmapped watched path (report unmapped)",
    f"path_links.<path>.kind: one of {', '.join(LINK_KINDS)}",
    f"path_links.<path>.reason: at least {MIN_EXPLANATION} characters",
    "path_links.<path>.nodes: a non-empty list of node IDs registered in the report; "
    "implementation needs at least one requirement and one test node",
    "validation: a non-empty list of checks the agent actually ran",
    f"validation[i].check: what was run; validation[i].result: one of {', '.join(RESULTS)}; "
    f"validation[i].evidence: at least {MIN_EXPLANATION} characters",
    "top-level keys starting with _ (such as this list) are ignored by prepare",
]
# What the template records about the inspected revisions, so a stale fingerprint
# can say what moved. Diagnostic only: the fingerprint is the binding.
INSPECTED_KEYS = ("repo", "branch", "base_branch", "base_tip", "head", "tool_version", "source_commits")


def assessment_template(report):
    return {"_rules": ASSESSMENT_RULES,
            "_inspected": {k: report[k] for k in INSPECTED_KEYS if k in report},
            "fingerprint": report["fingerprint"], "summary": "",
            "reviews": {t["id"]: {"disposition": "", "reason": "", "followups": []} for t in report["tasks"]},
            "path_links": {p: {"kind": "", "nodes": [], "reason": ""} for p in report["unmapped"]},
            "validation": [{"check": "", "result": "", "evidence": ""}]}


def explain(value):
    return isinstance(value, str) and len(value.strip()) >= MIN_EXPLANATION


def explanation_problem(where, value):
    """None when `value` is a substantive explanation, else what is wrong with it."""
    if explain(value):
        return None
    if not isinstance(value, str):
        return f"{where}: missing, needs text of at least {MIN_EXPLANATION} characters"
    return f"{where}: {len(value.strip())} chars, needs >= {MIN_EXPLANATION}"


def choice_problem(where, value, allowed):
    try:
        if value in allowed:
            return None
    except TypeError:  # an unhashable value is not an allowed one
        pass
    return f"{where}: {json.dumps(value, ensure_ascii=False)} not in {{{', '.join(sorted(allowed))}}}"


def short(value):
    if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value):
        return value[:12]
    return json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value


def report_differences(stored, current, keys=None):
    """Which report fields differ, with both values where they are short.

    A stale receipt used to be refused with one sentence for every cause. The
    cause decides the fix: a moved base wants a rebase or just a new inspect, a
    different tool version a refreshed Harness, another head a new commit.
    """
    stored = stored if isinstance(stored, dict) else {}
    keys = list(keys if keys is not None else dict.fromkeys([*stored, *current]))
    found = []
    for key in keys:
        if key == "fingerprint" or stored.get(key) == current.get(key):
            continue
        old, new = stored.get(key), current.get(key)
        if isinstance(old, dict) and isinstance(new, dict) and key in {"source_commits", "external_sources"}:
            for sub in dict.fromkeys([*old, *new]):
                if old.get(sub) != new.get(sub):
                    found.append(f"{key}[{sub}] (receipt {short(old.get(sub))}, now {short(new.get(sub))})")
        elif isinstance(old, (str, int, type(None))) and isinstance(new, (str, int, type(None))):
            found.append(f"{key} (receipt {short(old)}, now {short(new)})")
        else:
            found.append(f"{key} changed")
    if not found and "fingerprint" in keys and stored.get("fingerprint") != current.get("fingerprint"):
        found.append("fingerprint (the receipt was edited)")
    return found


def assessment_problems(report, assessment):
    """Every way the assessment fails the rules, each with its JSON path and rule."""
    if not isinstance(assessment, dict):
        return ["assessment: must be a JSON object; start from inspect --assessment-template"]
    problems = []
    if assessment.get("fingerprint") != report["fingerprint"]:
        moved = report_differences(assessment.get("_inspected"), report, INSPECTED_KEYS) \
            if isinstance(assessment.get("_inspected"), dict) else []
        problems.append("fingerprint: assessment is stale; inspect and assess the current source revisions"
                        + (f" (changed since inspect: {'; '.join(moved)})" if moved else ""))
    problem = explanation_problem("summary", assessment.get("summary"))
    if problem:
        problems.append(problem)

    tasks = [t["id"] for t in report["tasks"]]
    reviews = assessment.get("reviews", {})
    if not isinstance(reviews, dict):
        problems.append("reviews: must be an object keyed by affected node ID")
        reviews = {}
    for nid in tasks:
        if nid not in reviews:
            problems.append(f"reviews.{nid}: missing; assess every affected node, including upstream "
                            "consistency and downstream work")
    for nid, review in reviews.items():
        where = f"reviews.{nid}"
        if nid not in tasks:
            problems.append(f"{where}: not an affected node in this report; remove it")
        if not isinstance(review, dict):
            problems.append(f"{where}: must be an object with disposition, reason and followups")
            continue
        problems += filter(None, [choice_problem(f"{where}.disposition", review.get("disposition"), impact.DISPOSITIONS),
                                  explanation_problem(f"{where}.reason", review.get("reason"))])
        if review.get("disposition") in UNRESOLVED:
            links = review.get("followups")
            rule = ("unresolved impact needs tracked issue/PR followups, not automatic approval: "
                    "https://github.com/<owner>/<repo>/issues/<n> or /pull/<n> in a registered repository")
            if not isinstance(links, list) or not links:
                problems.append(f"{where}.followups: {review['disposition']} {rule}")
            for i, url in enumerate(links if isinstance(links, list) else []):
                if not (isinstance(url, str) and FOLLOWUP.fullmatch(url)
                        and policy_repo("/".join(url.split("/")[3:5])) in report["source_commits"]):
                    problems.append(f"{where}.followups[{i}]: {json.dumps(url, ensure_ascii=False)}: {rule}")

    path_links = assessment.get("path_links", {})
    if not isinstance(path_links, dict):
        problems.append("path_links: must be an object keyed by unmapped path")
        path_links = {}
    for path in report["unmapped"]:
        if path not in path_links:
            problems.append(f"path_links.{path}: missing; classify and link every unmapped watched change")
    for path, entry in path_links.items():
        where = f"path_links.{path}"
        if path not in report["unmapped"]:
            problems.append(f"{where}: not an unmapped watched path in this report; remove it")
        if not isinstance(entry, dict):
            problems.append(f"{where}: must be an object with kind, nodes and reason")
            continue
        problems += filter(None, [choice_problem(f"{where}.kind", entry.get("kind"), LINK_KINDS),
                                  explanation_problem(f"{where}.reason", entry.get("reason"))])
        ids = entry.get("nodes")
        if not isinstance(ids, list) or not ids:
            problems.append(f"{where}.nodes: link existing registered node IDs (a non-empty list); "
                            "register new criteria instead of inventing IDs")
            continue
        unknown = [n for n in ids if not (isinstance(n, str) and n in report["nodes"])]
        if unknown:
            problems.append(f"{where}.nodes: {', '.join(json.dumps(n, ensure_ascii=False) for n in unknown)} "
                            "not registered; link existing registered node IDs; register new criteria instead of inventing IDs")
            continue
        stages = {report["nodes"][nid]["stage"] for nid in ids}
        if entry.get("kind") == "implementation" and not {"requirement", "test"} <= stages:
            missing = sorted({"requirement", "test"} - stages)
            problems.append(f"{where}.nodes: implementation needs requirement and test links (missing {', '.join(missing)})")

    checks = assessment.get("validation")
    if not isinstance(checks, list) or not checks:
        problems.append("validation: record validation performed by the agent (a non-empty list)")
        checks = []
    for i, check in enumerate(checks):
        where = f"validation[{i}]"
        if not isinstance(check, dict):
            problems.append(f"{where}: must be an object with check, result and evidence")
            continue
        if not check.get("check"):
            problems.append(f"{where}.check: missing; name the check that was run")
        problems += filter(None, [choice_problem(f"{where}.result", check.get("result"), RESULTS),
                                  explanation_problem(f"{where}.evidence", check.get("evidence"))])
    return problems


def validate_assessment(report, assessment):
    if report["blockers"]:
        raise ValueError("preparation blocked: " + "; ".join(report["blockers"]))
    problems = assessment_problems(report, assessment)
    if problems:
        raise ValueError(f"assessment has {len(problems)} problem{'s' if len(problems) > 1 else ''} "
                         "(rules: `_rules` in the assessment template, or skills/hype-pr/SKILL.md):\n- "
                         + "\n- ".join(problems))


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
    differences = []
    if branch != current["branch"]:
        differences.append(f"--head is {branch} but the checkout is on {current['branch']}")
    if receipt["report"] != current:
        # The fallback keeps the refusal even if no single field can be named.
        differences += report_differences(receipt["report"], current) or ["report changed"]
    if differences:
        raise ValueError("preparation is stale or belongs to another branch/repository/tool version: "
                         + "; ".join(differences) + ". Run inspect, reassess and prepare again")
    validate_assessment(current, receipt["assessment"])
    remote_head = remote_tip(repo, branch)
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
