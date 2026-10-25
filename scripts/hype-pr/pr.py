#!/usr/bin/env python3
"""Plan and execute HypeProof pull request workflow policy.

This tool is intentionally conservative:

- reviewer requests are explicit opt-in and exclude the PR author
- auto-merge is opt-in and only enabled when repo policy allows it and the
  detected risk is low enough
- dry-run is the default for commands that would mutate GitHub
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class EngineRefused(RuntimeError):
    """The launcher-owned engine holds something that only a human can decide about."""


def engine_dir():
    """Where the launcher keeps its own detached worktree of the canonical repo.

    HYPEPROOF_ENGINE_DIR names that worktree. The default sits in the user's
    cache, outside every checkout a person works in.
    """
    configured = os.environ.get("HYPEPROOF_ENGINE_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.home() / ".cache" / "hypeproof" / "harness-engine"


def prepare_engine(canonical):
    """The Harness tree to run for a consumer, and a notice about it or None.

    A consumer that delegates to a stale checkout runs yesterday's engine
    against today's policy. Updating the developer's own checkout to fix that
    switched branches under sessions developing Harness there (#359), and
    hashing a tree that moved under them invalidated their receipts. So the
    canonical checkout is only ever read and fetched: the engine is a detached
    worktree of the same repository that only this launcher owns, moved to
    origin/main on every run.

    HYPEPROOF_HARNESS only says where the canonical checkout is; the engine is
    still made from it and refreshed through it. HYPEPROOF_HARNESS_PIN=1 is
    the explicit override for developing Harness: it runs the canonical
    checkout as it is, with no fetch and no engine.

    Runs are serialized on a lock file next to the engine. A run that cannot
    take it within ENGINE_LOCK_SECONDS does not wait for the other one: it
    runs the existing engine and says it may be stale.

    Nothing is ever discarded. Tracked changes in the engine stop the run with
    EngineRefused, because they are somebody's work even though the engine is
    not meant to be edited. When the update cannot happen (offline, the
    canonical checkout is not a git checkout) the existing engine runs and the
    notice says it may be stale. With no engine yet, the canonical checkout
    runs as it is and the notice says why.
    """
    canonical = Path(canonical)
    if os.environ.get("HYPEPROOF_HARNESS_PIN"):
        return canonical, None
    engine = engine_dir()
    engine.parent.mkdir(parents=True, exist_ok=True)
    with open(engine.parent / (engine.name + ".lock"), "a") as lock:
        if not _lock(lock, ENGINE_LOCK_SECONDS):
            busy = "another run is updating it"
            if engine.is_dir() and any(engine.iterdir()):
                return engine, f"running the engine at {engine}, which may be stale: {busy}"
            return canonical, f"no engine at {engine} yet and {busy}; running {canonical} as it is"
        return _refresh_engine(canonical, engine)


ENGINE_LOCK_SECONDS = 15


def _lock(handle, seconds):
    """Take an exclusive lock on handle within seconds; True when taken.

    Released when the handle is closed, also when the process dies.
    """
    try:
        import fcntl
    except ImportError:  # No fcntl (Windows): runs are not serialized.
        return True
    import time

    deadline = time.monotonic() + seconds
    while True:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.1)


def _refresh_engine(canonical, engine):
    """prepare_engine under its lock: fetch, then create or move the engine."""

    def git(where, *args):
        return subprocess.run(["git", "-C", str(where), *args], text=True, capture_output=True)

    def first_line(proc):
        return (proc.stderr.strip().splitlines() or ["exit code %d" % proc.returncode])[-1]

    stale = None
    if git(canonical, "rev-parse", "--git-dir").returncode:
        stale = f"{canonical} is not a git checkout"
    elif git(canonical, "fetch", "--quiet", "origin", "main").returncode:
        stale = "cannot fetch origin/main; check network access and credentials"

    # An empty directory is as good as none: the worktree can be added into it.
    if engine.exists() and (not engine.is_dir() or any(engine.iterdir())):
        top = git(engine, "rev-parse", "--show-toplevel")
        if top.returncode or Path(top.stdout.strip()).resolve() != engine.resolve():
            raise EngineRefused(f"engine directory {engine} is not a git worktree; move it aside "
                                "(or set HYPEPROOF_ENGINE_DIR elsewhere) and run again")
        # Untracked files are left out: a checkout never removes them, it stops
        # when one is in the way, and that is reported below.
        # Not stdout.strip(): porcelain pads the status to two columns, so
        # stripping eats the leading space of the first line and its path
        # loses a character.
        dirty = sorted(line[3:] for line in git(engine, "status", "--porcelain", "--untracked-files=no")
                       .stdout.splitlines() if line.strip())
        if dirty:
            raise EngineRefused(f"engine worktree {engine} has local changes ({', '.join(dirty[:5])}); "
                                "it is launcher-owned and is not updated over them. Move the changes "
                                f"out, then remove it with: git -C {canonical} worktree remove {engine}")
        if stale:
            return engine, f"running the engine at {engine}, which may be stale: {stale}"
        moved = git(engine, "checkout", "--quiet", "--detach", "origin/main")
        if moved.returncode:
            return engine, f"running the engine at {engine}, which may be stale: " \
                           f"checkout of origin/main failed ({first_line(moved)})"
        return engine, None

    if stale:
        return canonical, f"no engine at {engine} yet and {stale}; running {canonical} as it is"
    # A worktree whose directory was deleted is still registered and blocks the add.
    git(canonical, "worktree", "prune")
    added = git(canonical, "worktree", "add", "--quiet", "--detach", str(engine), "origin/main")
    if added.returncode:
        return canonical, f"cannot create the engine at {engine} ({first_line(added)}); running {canonical} as it is"
    return engine, None


def refresh_canonical(canonical):
    """Leave the canonical checkout alone; kept for launchers that still call it.

    Vendored hype-review copies from before #359 load this module from the
    canonical checkout and call this before running that checkout. It used to
    move the checkout to main. Moving a developer's checkout is what #359
    removed, so it now changes nothing and reports nothing.
    """
    return None


BUNDLE_PATHS = ("scripts/hype-pr", "skills/hype-pr", "docs/AGENT-GUIDE.ko.md", "docs/HYPE-PR.ko.md")


def bundle_drift(canonical, root):
    """Report when the installed bundle no longer matches the canonical one.

    The engine that runs is always the canonical copy, so drift is not fatal and
    must not block work. The launcher, the skill and its docs are the installed
    copy though, and a launcher that predates a fix does not carry it. That is
    how the canonical-checkout repair sat inert in a consumer repo: the old
    launcher checked only that preparation.py existed and delegated in silence.

    Only a real difference in the bundle is reported. Harness commits that touch
    nothing here are not drift, and a consumer that went red every time Harness
    moved would be muted within a week.

    Returns None when the installed bundle is current, otherwise a message.
    """
    stamp = root / "scripts/hype-pr/HARNESS_VERSION"
    if not stamp.is_file():
        return None
    installed = stamp.read_text().strip()

    def git(*args):
        return subprocess.run(["git", "-C", str(canonical), *args], text=True, capture_output=True)

    if not installed or git("cat-file", "-e", installed + "^{commit}").returncode:
        return f"installed revision {installed or '(empty)'} is unknown to the canonical checkout"
    if git("diff", "--quiet", installed, "HEAD", "--", *BUNDLE_PATHS).returncode == 0:
        return None
    return f"installed bundle is from {installed[:7]} and the canonical bundle has changed since"


def drift_notice_due(root, argv, today=None):
    """Whether to print the bundle drift notice on this run (hypeproof-harness#362).

    The notice printed on every run, so it was read once and then scrolled past
    for weeks. It now prints at most once a day per checkout, stamped in that
    checkout's own git dir (never the working tree), and always on `create`,
    the run that publishes work built on the installed bundle. Consumer sync
    PRs, not this notice, are what keeps consumers current.
    """
    from datetime import date

    if "create" in argv:
        return True
    today = today or date.today().isoformat()
    git_dir = subprocess.run(["git", "-C", str(root), "rev-parse", "--absolute-git-dir"],
                             text=True, capture_output=True).stdout.strip()
    if not git_dir:
        return True
    stamp = Path(git_dir) / "hype-pr-drift-notice"
    try:
        if stamp.read_text().strip() == today:
            return False
    except OSError:
        pass
    try:
        stamp.write_text(today + "\n")
    except OSError:
        pass
    return True


ROOT = Path(__file__).resolve().parents[2]
# Consumer copies delegate to the canonical checkout; policy/engine are never vendored.
if not (ROOT / "policy/repos.yaml").is_file():
    configured = os.environ.get("HYPEPROOF_HARNESS")
    if configured:
        canonical = Path(configured).expanduser().resolve()
    else:
        common = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute", "--git-common-dir"], text=True).strip()
        canonical = Path(common).parent.parent / "hypeproof-harness"
    if not (canonical / "scripts/hype-pr/pr.py").is_file() or not (canonical / "policy/repos.yaml").is_file():
        raise SystemExit("hype-pr: canonical Harness checkout missing; clone hypeproof-harness as a sibling or set HYPEPROOF_HARNESS")
    try:
        engine, notice = prepare_engine(canonical)
    except EngineRefused as exc:
        raise SystemExit(f"hype-pr: {exc}")
    target = engine / "scripts/hype-pr/pr.py"
    # Staleness keeps its own verdict: the automatic update is what should have
    # fixed it, so its notice belongs in that message rather than replacing it.
    if not (engine / "scripts/hype-pr/preparation.py").is_file():
        raise SystemExit("hype-pr: canonical Harness checkout is outdated; update it to current main or set HYPEPROOF_HARNESS to an updated checkout"
                         + (f" (automatic update stopped: {notice})" if notice else ""))
    if notice:
        # Reported, not fatal. The tree can serve the engine; it may just not
        # be current main.
        print(f"hype-pr: {notice}", file=sys.stderr)
    drift = bundle_drift(engine, ROOT)
    if drift and drift_notice_due(ROOT, sys.argv[1:]):
        print(f"hype-pr: {drift}; reinstall with: python3 {engine}/scripts/hype-pr/install.py {ROOT}", file=sys.stderr)
    if engine != canonical:
        # The engine has no sibling clones; the canonical checkout's are the
        # person's working copies (preparation.source_checkouts).
        os.environ["HYPEPROOF_CANONICAL_CHECKOUT"] = str(canonical)
    if __name__ == "__main__":
        os.execv(sys.executable, [sys.executable, str(target), *sys.argv[1:]])
    raise RuntimeError("import hype-pr from the canonical Harness checkout")
sys.path.insert(0, str(ROOT / "scripts" / "repo-governance"))
from audit import load_policy, repo_full_name, validate_policy  # noqa: E402
sys.path.insert(0, str(ROOT / "scripts" / "hype-pr"))


# Owner of a bare --repo name the registry does not hold.
DEFAULT_OWNER = "hypeproof"
DEFAULT_BASE = "main"
AUTO_MERGE_METHOD = "squash"


PATH_RISK_RULES: tuple[tuple[str, str], ...] = (
    (r"(^|/)(auth|admin|oauth|secret|token|credential|permission|rbac)", "security"),
    (r"SECURITY\.md|\.pem$|\.key$|\.env", "security"),
    (r"(^|/)\.github/workflows/|vercel|fly\.toml|wrangler|deploy|release", "deploy"),
    (r"(^|/)(migrations?|sql|schema|tenant|rls|database|data)/|\.sql$", "data"),
    (r"package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.lock", "dependency"),
    (r"CODEOWNERS|branch[_-]?protection|policy/|repo-governance", "governance"),
    (r"(^|/)docs?/|README|AGENTS|CLAUDE|OPENCLAW|\.md$", "docs"),
    (r"(^|/)(frontend|app|components|pages|public)/|\.tsx?$|\.css$", "ui"),
)

AUTO_MERGE_BLOCKING_RISKS = {"security", "deploy", "data", "dependency", "governance"}
AUTO_MERGE_BLOCKING_LABELS = {
    "human-needed",
    "security",
    "deploy",
    "data",
    "incident",
    "breaking-change",
    "do-not-merge",
}


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


def uniq(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def parse_repo(value: str) -> str:
    """Full name for a --repo value, by the organization path of a transferred repo.

    A bare name resolves through the registry first, so a repository that stayed
    with a personal owner keeps its owner; anything else gets DEFAULT_OWNER.
    """
    from preparation import policy_repo
    if "/" in value:
        owner, name = value.split("/", 1)
        if owner and name:
            return policy_repo(value)
    for repo in load_policy()["repos"].get("repositories", []):
        if repo.get("name") == value:
            return repo_full_name(repo)
    return f"{DEFAULT_OWNER}/{value}"


from issue_guard import positive_issue, validate_scoped_issue  # noqa: E402
import body_contract  # noqa: E402


def github_repo(repo: str) -> str:
    """Address GitHub by the organization path of a transferred repository.

    GitHub would redirect the former owner path, but then the former name is what
    lands in commands and output (#287).
    """
    return parse_repo(repo)


def fetch_scoped_issue(repo: str, number: int) -> dict[str, Any]:
    target = github_repo(repo)
    path = f"repos/{target}/issues/{number}"
    if os.environ.get("HYPE_PR_WORK_DIR"):
        from work_transport import exchange
        return exchange("read", {"path": path})
    response = run(["gh", "api", "--method", "GET", path])
    if response.returncode != 0:
        raise ValueError(f"cannot read scoped issue {target}#{number}: {response.stderr.strip() or 'GitHub API failed'}")
    try:
        return json.loads(response.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError(f"scoped issue {target}#{number} returned invalid JSON") from exc


def active_members(policy: dict[str, Any]) -> list[str]:
    members = policy.get("members", {}).get("members", {})
    return uniq(list(members.get("admins", [])) + list(members.get("writers", [])))


def reviewers_for_author(policy: dict[str, Any], author: str | None) -> list[str]:
    author_norm = (author or "").lstrip("@").lower()
    return [
        login
        for login in active_members(policy)
        if login.lower() != author_norm
    ]


def find_repo(policy: dict[str, Any], repo_ref: str) -> tuple[dict[str, Any], dict[str, Any]]:
    wanted = parse_repo(repo_ref)
    for repo in policy["repos"].get("repositories", []):
        full = repo_full_name(repo)
        from preparation import policy_repo
        if wanted in (full, repo.get("name")) or policy_repo(wanted) == policy_repo(full):
            return repo, policy["profiles"][repo["profile"]]
    raise ValueError(f"unknown repo in policy: {repo_ref}")


def detect_risks(paths: list[str]) -> list[str]:
    risks: list[str] = []
    for path in paths:
        for pattern, risk in PATH_RISK_RULES:
            if re.search(pattern, path, flags=re.IGNORECASE) and risk not in risks:
                risks.append(risk)
    return risks


def required_checks(repo: dict[str, Any]) -> list[str]:
    return list(repo.get("required_status_checks") or [])


def plan(
    *,
    policy: dict[str, Any],
    repo_ref: str,
    author: str | None,
    paths: list[str],
    labels: list[str],
    draft: bool,
    auto_merge: bool,
    request_reviewers: bool = False,
) -> dict[str, Any]:
    repo, profile = find_repo(policy, repo_ref)
    full = repo_full_name(repo)
    profile_repo = profile.get("repository", {})
    risks = detect_risks(paths)
    eligible_reviewers = reviewers_for_author(policy, author)
    reviewer_logins = eligible_reviewers if request_reviewers else []
    profile_allows_auto_merge = bool(profile_repo.get("allow_auto_merge"))
    checks = required_checks(repo)

    blockers: list[str] = []
    if not auto_merge:
        blockers.append("auto_merge_not_requested")
    if draft:
        blockers.append("draft_pr")
    if not profile_allows_auto_merge:
        blockers.append("profile_disallows_auto_merge")
    if not checks:
        blockers.append("no_required_status_checks_declared")
    for risk in risks:
        if risk in AUTO_MERGE_BLOCKING_RISKS:
            blockers.append(f"risk:{risk}")
    for label in labels:
        if label in AUTO_MERGE_BLOCKING_LABELS:
            blockers.append(f"label:{label}")

    return {
        "status": "planned",
        "repo": full,
        "profile": repo.get("profile"),
        "author": author,
        "reviewers": reviewer_logins,
        "review_request": {
            "enabled": request_reviewers,
            "active_members": active_members(policy),
            "exclude_author": True,
            "eligible_reviewers": eligible_reviewers,
            "requested_reviewers": reviewer_logins,
        },
        "risk": {
            "paths": paths,
            "detected": risks,
            "auto_merge_blocking": [risk for risk in risks if risk in AUTO_MERGE_BLOCKING_RISKS],
        },
        "auto_merge": {
            "requested": auto_merge,
            "profile_allows": profile_allows_auto_merge,
            "eligible": not blockers,
            "method": AUTO_MERGE_METHOD,
            "blocked_by": uniq(blockers),
        },
        "required_status_checks": checks,
    }


def fetch_pr(repo: str, pr: str) -> dict[str, Any]:
    return gh_json([
        "pr",
        "view",
        pr,
        "--repo",
        github_repo(repo),
        "--json",
        "author,files,isDraft,labels,number,title,url",
    ])


def gh_json(args: list[str]) -> Any:
    result = run(["gh", *args])
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    text = result.stdout.strip()
    return json.loads(text) if text else None


def run(cmd: list[str], *, input_text: str | None = None) -> CommandResult:
    proc = subprocess.run(
        cmd,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
        cwd=ROOT,
    )
    return CommandResult(proc.returncode, proc.stdout, proc.stderr)


def command_request_reviewers(args: argparse.Namespace, policy: dict[str, Any]) -> int:
    pr = fetch_pr(args.repo, args.pr)
    author = pr["author"]["login"]
    paths = [item["path"] for item in pr.get("files") or []]
    labels = [item["name"] for item in pr.get("labels") or []]
    planned = plan(
        policy=policy,
        repo_ref=args.repo,
        author=author,
        paths=paths,
        labels=labels,
        draft=bool(pr.get("isDraft")),
        auto_merge=False,
        request_reviewers=True,
    )
    reviewers = planned["reviewers"]
    result = {
        "plan": planned,
        "reviewer_commands": reviewer_commands(args.repo, args.pr, reviewers),
        "apply": args.apply,
    }
    if not args.apply:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    result["reviewer_results"] = apply_reviewer_requests(args.repo, str(args.pr), reviewers)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if any(item["returncode"] != 0 for item in result["reviewer_results"]) else 0


def pr_number(pr_ref: str) -> str:
    """`https://github.com/o/r/pull/12`, `12` or the dry-run placeholder -> the number part."""
    return str(pr_ref).rstrip("/").rsplit("/", 1)[-1]


def requested_reviewers_command(method: str, repo: str, pr_ref: str, reviewer: str) -> list[str]:
    # REST rather than `gh pr edit --add/--remove-reviewer`: gh pr edit also reads the
    # org's teams, which an App installation token cannot (hypeproof-agent, #354).
    return [
        "gh",
        "api",
        "--method",
        method,
        f"repos/{github_repo(repo)}/pulls/{pr_number(pr_ref)}/requested_reviewers",
        "-f",
        f"reviewers[]={reviewer}",
    ]


def reviewer_commands(repo: str, pr_ref: str, reviewers: list[str]) -> list[list[str]]:
    return [requested_reviewers_command("POST", repo, pr_ref, reviewer) for reviewer in reviewers]


def reviewer_cleanup_commands(repo: str, pr_ref: str, reviewers: list[str]) -> list[list[str]]:
    return [requested_reviewers_command("DELETE", repo, pr_ref, reviewer) for reviewer in reviewers]


def apply_reviewer_requests(repo: str, pr_ref: str, reviewers: list[str]) -> list[dict[str, Any]]:
    if os.environ.get("HYPE_PR_WORK_DIR"):
        from work_transport import exchange
        results = []
        for reviewer in reviewers:
            try:
                exchange("reviewer", {"repo": parse_repo(repo), "pr": pr_ref, "reviewer": reviewer})
                results.append({"reviewer": reviewer, "returncode": 0})
            except ValueError:
                results.append({"reviewer": reviewer, "returncode": 1,
                                "stderr": "Work reviewer request failed; no approval implied"})
        return results
    results: list[dict[str, Any]] = []
    for reviewer, cmd in zip(reviewers, reviewer_commands(repo, pr_ref, reviewers)):
        gh_result = run(cmd)
        results.append(
            {
                "reviewer": reviewer,
                "returncode": gh_result.returncode,
                "stdout": gh_result.stdout.strip(),
                "stderr": gh_result.stderr.strip(),
            }
        )
    return results


def apply_reviewer_cleanup(repo: str, pr_ref: str, reviewers: list[str]) -> list[dict[str, Any]]:
    if os.environ.get("HYPE_PR_WORK_DIR"):
        from work_transport import exchange
        results = []
        for reviewer in reviewers:
            try:
                exchange("unreviewer", {"repo": parse_repo(repo), "pr": pr_ref, "reviewer": reviewer})
                results.append({"reviewer": reviewer, "returncode": 0})
            except ValueError:
                results.append({"reviewer": reviewer, "returncode": 1,
                                "stderr": "Work reviewer cleanup failed; reconcile the created PR"})
        return results
    results: list[dict[str, Any]] = []
    commands = reviewer_cleanup_commands(repo, pr_ref, reviewers)
    for reviewer, cmd in zip(reviewers, commands):
        gh_result = run(cmd)
        results.append(
            {
                "reviewer": reviewer,
                "returncode": gh_result.returncode,
                "stdout": gh_result.stdout.strip(),
                "stderr": gh_result.stderr.strip(),
            }
        )
    return results


def preparation_module():
    sys.path.insert(0, str(ROOT / "scripts/hype-pr"))
    import preparation
    return preparation


def agent_identity_errors(args, report) -> list[str]:
    """The bot's PR must hold only bot-authored and bot-committed commits (#403)."""
    sys.path.insert(0, str(ROOT / "scripts/agent-identity"))
    import branch_identity
    bot = branch_identity.bot_identity().split(" <", 1)[0]
    if args.author != bot or not report:
        return []
    try:
        bad = branch_identity.check(getattr(args, "checkout", "."), [report["head"]], report["base_tip"])
    except ValueError as exc:
        return [f"agent identity check failed: {exc}"]
    return [branch_identity.report(bad, branch_identity.bot_identity(), f"origin/{args.base}")] if bad else []


def prepared_report(args, policy):
    return preparation_module().verify(
        getattr(args, "preparation", None), getattr(args, "checkout", "."),
        parse_repo(args.repo), args.base, args.head, active_members(policy))


def command_prepare(args, policy):
    module = preparation_module()
    # Only the inspect report lists the repositories without a usable local clone.
    # What prepare binds into a receipt must not depend on what is cloned here.
    report = module.inspect(args.checkout, parse_repo(args.repo), args.base, members=active_members(policy),
                            local_gaps=args.command == "inspect")
    if args.command == "inspect":
        if args.output:
            Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            Path(args.output).chmod(0o600)
        if args.assessment_template:
            Path(args.assessment_template).write_text(json.dumps(module.assessment_template(report), ensure_ascii=False, indent=2) + "\n")
            Path(args.assessment_template).chmod(0o600)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if report["blockers"] else 0
    assessment = json.loads(Path(args.assessment).read_text())
    output = args.output or git_receipt_path(args.checkout)
    result = module.prepare(report, assessment, output)
    print(json.dumps({"status": "prepared", "receipt": str(result), "head": report["head"],
                      "agent_attestation": True, "human_approval": False}, ensure_ascii=False))
    return 0


def git_receipt_path(checkout):
    module = preparation_module()
    location = module.git(checkout, "rev-parse", "--path-format=absolute", "--git-path", "hype-pr/preparation.json")
    return Path(location)


def release_lane(args, report):
    """Decide the PR's lane (normal, hotfix or forward port), its contract and labels.

    The hotfix lane is policy, so it is read from the default branch: a hotfix
    branch is cut from an old tag that may predate the contract. A normal PR is
    checked against the contract in the commit it proposes, so a repository opts
    in through its own reviewed change.
    """
    checkout = getattr(args, "checkout", ".") or "."
    read_head, head_exists = body_contract.git_reader(checkout, report["head"] if report else "HEAD")
    read_main, main_exists = body_contract.git_reader(checkout, f"origin/{DEFAULT_BASE}")
    main_contract = read_main()
    lane = body_contract.hotfix_lane(main_contract)
    labels = list(args.label or [])
    forward_of = getattr(args, "forward_of", None)
    if lane is None:
        if forward_of:
            raise ValueError(f"--forward-of needs a hotfix lane in {body_contract.CONTRACT_PATH} on {DEFAULT_BASE}")
        return {"mode": "normal", "contract": read_head(), "path_exists": head_exists, "labels": labels}
    hotfix_label, forward_label = lane["label"], lane["forward_label"]
    if args.base.startswith(lane["base_prefix"]):
        if forward_of:
            raise ValueError(f"--forward-of opens the port to {DEFAULT_BASE}; this PR targets the hotfix branch {args.base}")
        if forward_label in labels:
            raise ValueError(f"`{forward_label}` is for the port to {DEFAULT_BASE}, not for a PR into {args.base}")
        if args.auto_merge:
            raise ValueError("a hotfix PR is merged by hand; drop --auto-merge")
        if hotfix_label not in labels:
            labels.append(hotfix_label)
        return {"mode": "hotfix", "contract": main_contract, "labels": labels, "lane": lane,
                "path_exists": lambda path: head_exists(path) or main_exists(path)}
    if hotfix_label in labels:
        raise ValueError(f"`{hotfix_label}` is only for PRs into {lane['base_prefix']}*; "
                         f"bring a hotfix to {args.base} with --forward-of <hotfix PR>, which adds `{forward_label}`")
    if forward_of:
        if forward_label not in labels:
            labels.append(forward_label)
        mode = "forward"
    elif forward_label in labels:
        raise ValueError(f"`{forward_label}` needs --forward-of <hotfix PR>")
    else:
        mode = "normal"
    return {"mode": mode, "contract": read_head(), "path_exists": head_exists, "labels": labels, "lane": lane}


def check_release_check(args, lane, body, issue):
    """Apply the repository's PR body contract for the PR's lane.

    Without an enforced contract nothing about the body is checked, except that a
    forward port names its hotfix PR. On --apply a failing body stops creation
    before GitHub is asked; a dry run reports.
    """
    rule = body_contract.enforced_release_check(lane["contract"])
    errors = []
    if rule is not None:
        errors = body_contract.check_release_check(
            body, smoke_check_prefix=rule["smoke_check_prefix"], path_exists=lane["path_exists"],
            issue_body=(issue or {}).get("body"), hotfix=lane["mode"] == "hotfix",
            manager_check=rule.get("manager_check") is True)
        follow_up = body_contract.smoke_issue_reference(body)
        if args.apply and follow_up is not None and not errors:
            found = fetch_scoped_issue(parse_repo(args.repo), follow_up)
            if found.get("pull_request") is not None or found.get("state") != "open":
                errors.append(f"`Smoke check` #{follow_up} must be an open issue in this repository")
    if lane["mode"] == "forward":
        errors += body_contract.forward_port_errors(body, args.forward_of)
        if args.apply and not errors:
            pull = fetch_pull(parse_repo(args.repo), args.forward_of)
            if not str((pull.get("base") or {}).get("ref", "")).startswith(lane["lane"]["base_prefix"]):
                errors.append(f"#{args.forward_of} is not a PR into {lane['lane']['base_prefix']}*")
    if errors and args.apply:
        raise ValueError("PR body fails the Release check contract (" + body_contract.CONTRACT_PATH + "):\n- "
                         + "\n- ".join(errors))
    return {"enforced": rule is not None, "mode": lane["mode"], "errors": errors}


def fetch_pull(repo: str, number: int) -> dict[str, Any]:
    response = run(["gh", "api", "--method", "GET", f"repos/{github_repo(repo)}/pulls/{number}"])
    if response.returncode != 0:
        raise ValueError(f"cannot read PR {repo}#{number}: {response.stderr.strip() or 'GitHub API failed'}")
    return json.loads(response.stdout)


def board_on_create(repo_ref: str, pr_url: str, issue: int) -> dict[str, Any]:
    """Put the new PR and the issue it closes on the project boards as in_review (#397).

    The PR already exists, so a board failure does not fail `create`; it is
    reported in the result and on stderr.
    """
    board = ROOT / "scripts/board/board.py"
    if not board.is_file():
        return {"ok": False, "error": f"{board} is missing"}
    items = []
    for url in (pr_url, f"https://github.com/{github_repo(repo_ref)}/issues/{issue}"):
        done = run([sys.executable, str(board), "set", url, "--state", "in_review"])
        items.append({"url": url, "returncode": done.returncode, "detail": (done.stdout or done.stderr).strip()[-300:]})
    return {"ok": all(item["returncode"] == 0 for item in items), "items": items}


def command_create(args: argparse.Namespace, policy: dict[str, Any]) -> int:
    work = bool(os.environ.get("HYPE_PR_WORK_DIR"))
    if work and args.auto_merge:
        raise ValueError("Work transport does not schedule auto-merge; follow existing review policy")
    preparation_required = parse_repo(args.repo) in json.loads((ROOT / "policy/change-impact.json").read_text())["repositories"]
    report = prepared_report(args, policy) if args.apply and preparation_required else None
    identity_errors = agent_identity_errors(args, report) if args.apply else []
    if identity_errors:
        raise ValueError("\n".join(identity_errors))
    lane = release_lane(args, report)
    labels = lane["labels"]
    paths = report["paths"] if report else (args.path or [])
    planned = plan(
        policy=policy,
        repo_ref=args.repo,
        author=args.author,
        paths=paths,
        labels=labels,
        draft=args.draft,
        auto_merge=args.auto_merge,
        request_reviewers=args.request_reviewers,
    )
    body = args.body or ""
    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8")
    if report:
        body += preparation_module().summary(report)
    scoped_issue = None
    issue = None
    if args.apply:
        repo = parse_repo(args.repo)
        issue = fetch_scoped_issue(repo, args.issue)
        scoped_issue = validate_scoped_issue(issue, repo, args.issue, body,
                                             canonical=preparation_module().policy_repo)
    release_check = check_release_check(args, lane, body, issue)
    cmd = [
        "gh",
        "pr",
        "create",
        "--repo",
        github_repo(args.repo),
        "--base",
        args.base,
        "--head",
        args.head,
        "--title",
        args.title,
        "--body",
        body,
    ]
    if args.draft:
        cmd.append("--draft")
    for label in labels:
        cmd.extend(["--label", label])

    result: dict[str, Any] = {
        "plan": planned,
        "preparation": {"required_for_apply": preparation_required, "verified": report is not None},
        "scoped_issue": scoped_issue or {"repo": parse_repo(args.repo), "number": args.issue, "verified": False},
        "release_check": release_check,
        "create_command": cmd,
        "reviewer_commands": reviewer_commands(args.repo, "<created-pr>", planned["reviewers"]),
        "reviewer_cleanup_commands": reviewer_cleanup_commands(
            args.repo,
            "<created-pr>",
            [] if args.request_reviewers else planned["review_request"]["eligible_reviewers"],
        ),
        "apply": args.apply,
    }
    if not args.apply:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if work:
        if report is None:
            raise ValueError("Work PR creation requires verified preparation")
        from work_transport import exchange
        outcome = exchange("create", {
            "repo": parse_repo(args.repo), "base": args.base, "head": args.head,
            "title": args.title, "body": body, "draft": args.draft,
            "labels": labels, "author": args.author,
            "expected": {"head": report["head"], "base": report["base_tip"],
                         "sources": report["source_commits"]},
        })
        created = CommandResult(0, outcome["url"], "")
    else:
        created = run(cmd)
    result["create"] = {
        "returncode": created.returncode,
        "stdout": created.stdout.strip(),
        "stderr": created.stderr.strip(),
    }
    if work:
        result["label_errors"] = outcome.get("label_errors", [])
    if created.returncode != 0:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return created.returncode

    pr_ref = created.stdout.strip().splitlines()[-1]
    if lane["mode"] == "hotfix":
        # The hotfix PR cannot close its issue (only merges into the default branch
        # do), so the issue stays open until the port to main lands. Say what is next.
        number = pr_ref.rstrip("/").rsplit("/", 1)[-1]
        result["next"] = (f"after the hotfix merges and is tagged, bring it to {DEFAULT_BASE}: "
                          f"create --repo {args.repo} --base {DEFAULT_BASE} --head <port branch> "
                          f"--issue {args.issue} --forward-of {number} (body: `Forward-port of #{number}`)")
    result["reviewer_results"] = apply_reviewer_requests(args.repo, pr_ref, planned["reviewers"])
    cleanup_reviewers = [] if args.request_reviewers else planned["review_request"]["eligible_reviewers"]
    result["reviewer_cleanup_results"] = apply_reviewer_cleanup(args.repo, pr_ref, cleanup_reviewers)
    if planned["auto_merge"]["eligible"]:
        merge_cmd = [
            "gh",
            "pr",
            "merge",
            pr_ref,
            "--repo",
            github_repo(args.repo),
            "--auto",
            f"--{AUTO_MERGE_METHOD}",
            "--delete-branch",
        ]
        merged = run(merge_cmd)
        result["auto_merge_command"] = merge_cmd
        result["auto_merge_result"] = {
            "returncode": merged.returncode,
            "stdout": merged.stdout.strip(),
            "stderr": merged.stderr.strip(),
        }
    if not work:  # the Work transport has no local gh to write the boards with
        result["board"] = board_on_create(args.repo, pr_ref, args.issue)
        if not result["board"]["ok"]:
            print(f"hype-pr: the PR was created but the board was not updated: {result['board']}", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    cleanup_failed = any(item["returncode"] != 0 for item in result["reviewer_cleanup_results"])
    return 1 if cleanup_failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="HypeProof guarded PR creation harness.")
    sub = parser.add_subparsers(dest="command", required=True)

    plan_parser = sub.add_parser("plan", help="Plan explicit reviewers and auto-merge eligibility without GitHub calls.")
    plan_parser.add_argument("--repo", required=True, help="owner/name or policy repo name")
    plan_parser.add_argument("--author", required=True, help="GitHub login of PR author")
    plan_parser.add_argument("--path", action="append", default=[], help="Changed path. Can repeat.")
    plan_parser.add_argument("--label", action="append", default=[], help="PR label. Can repeat.")
    plan_parser.add_argument("--draft", action="store_true")
    plan_parser.add_argument("--auto-merge", action="store_true")
    plan_parser.add_argument("--request-reviewers", action="store_true", help="Opt in to all active non-author reviewers.")

    req_parser = sub.add_parser("request-reviewers", help="Request all active members on an existing PR.")
    req_parser.add_argument("--repo", required=True)
    req_parser.add_argument("--pr", required=True)
    req_parser.add_argument("--apply", action="store_true", help="Mutate GitHub. Omit for dry-run.")

    create_parser = sub.add_parser("create", help="Create a guarded PR without reviewers by default.")
    create_parser.add_argument("--repo", required=True)
    create_parser.add_argument("--head", required=True)
    create_parser.add_argument("--base", default=DEFAULT_BASE)
    create_parser.add_argument("--title", required=True)
    create_parser.add_argument("--body", default="")
    create_parser.add_argument("--body-file")
    create_parser.add_argument("--author", required=True)
    create_parser.add_argument("--issue", required=True, type=positive_issue, help="Open PR-sized work issue in the target repository")
    create_parser.add_argument("--path", action="append", default=[])
    create_parser.add_argument("--label", action="append", default=[])
    create_parser.add_argument("--forward-of", type=positive_issue, default=None,
                               help="Hotfix PR this change brings to the default branch")
    create_parser.add_argument("--draft", action="store_true")
    create_parser.add_argument("--auto-merge", action="store_true")
    create_parser.add_argument("--request-reviewers", action="store_true", help="Opt in to all active non-author reviewers.")
    create_parser.add_argument("--checkout", default=".", help="Target worktree; inferred from the invocation directory")
    create_parser.add_argument("--preparation", help="Receipt from prepare, required for --apply")
    create_parser.add_argument("--apply", action="store_true", help="Mutate GitHub. Omit for dry-run.")

    for name in ("inspect", "prepare"):
        command = sub.add_parser(name, help="Inspect source links or bind the agent assessment before PR creation")
        command.add_argument("--repo", required=True)
        command.add_argument("--checkout", default=".")
        command.add_argument("--base", default=DEFAULT_BASE)
        command.add_argument("--output")
        if name == "inspect":
            command.add_argument("--assessment-template")
        else:
            command.add_argument("--assessment", required=True)

    return parser


def describe_process_failure(exc: subprocess.CalledProcessError | subprocess.TimeoutExpired) -> str:
    """One line naming the command that failed and what to try, not a Python repr."""
    cmd = [str(part) for part in (exc.cmd if isinstance(exc.cmd, (list, tuple)) else [exc.cmd])]
    if len(cmd) > 3 and cmd[0] == "git" and cmd[1] == "-C":
        # `git -C <checkout> merge-base ...` -> where it ran, then the command a person would type.
        where, cmd = f" in {cmd[2]}", ["git", *cmd[3:]]
    else:
        where = ""
    shown = " ".join(cmd)
    if isinstance(exc, subprocess.TimeoutExpired):
        return f"`{shown}`{where} timed out after {exc.timeout:g}s; check network access and retry"
    stderr = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
    detail = stderr.strip().splitlines()[-1] if stderr.strip() else "its own message, if any, is printed above"
    hint = ""
    if cmd[:2] == ["git", "merge-base"]:
        hint = "; fetch the base (git fetch origin main) and make sure the branch shares history with it"
    elif cmd[:2] == ["git", "rev-parse"]:
        hint = "; run hype-pr inside the git worktree of the change, or pass --checkout"
    return f"`{shown}`{where} failed with exit status {exc.returncode} ({detail}){hint}"


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if hasattr(args, "repo") and args.repo:
        from preparation import organization_repo, policy_repo
        current = organization_repo(args.repo)
        if current:
            # A notice, not an error: automation may still pass the former path (#287).
            print(f"hype-pr: {args.repo} was transferred; pass --repo {current}", file=sys.stderr)
        args.repo = policy_repo(args.repo)
    if getattr(args, "base", None):
        from preparation import bare_branch
        bare = bare_branch(args.base)
        if bare != args.base:
            # GitHub knows branches, not this machine's remote-tracking names.
            print(f"hype-pr: --base {args.base} names a local ref; using the branch {bare}", file=sys.stderr)
            args.base = bare
    try:
        policy = load_policy()
        findings = validate_policy(policy)
        if findings:
            print(json.dumps({"status": "policy-invalid", "findings": [f.as_dict() for f in findings]}, indent=2))
            return 4
        if args.command == "plan":
            data = plan(
                policy=policy,
                repo_ref=args.repo,
                author=args.author,
                paths=args.path,
                labels=args.label,
                draft=args.draft,
                auto_merge=args.auto_merge,
                request_reviewers=args.request_reviewers,
            )
            print(json.dumps(data, ensure_ascii=False, indent=2))
            return 0
        if args.command == "request-reviewers":
            return command_request_reviewers(args, policy)
        if args.command in {"inspect", "prepare"}:
            return command_prepare(args, policy)
        if args.command == "create":
            return command_create(args, policy)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print(f"hype-pr: {describe_process_failure(exc)}", file=sys.stderr)
        return 2
    except (RuntimeError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"hype-pr: {exc}", file=sys.stderr)
        return 2
    parser.error(f"unknown command: {args.command}")
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
