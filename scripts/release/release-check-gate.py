#!/usr/bin/env python3
"""PR check `process / release-check` (#3568): the Release check body contract in CI.

    python3 scripts/release/release-check-gate.py --pr 3568 --repo hypeproof/hypeproof-studio [--checkout .]

Applies config/pr-body-contract.json to the PR body, labels, base, linked issue and head tree.
The rules live in scripts/hype-pr/body_contract.py and are imported unchanged; this file only
decides the lane (normal, hotfix, forward port), reads the inputs and reports.

Exemptions are explicit and logged, not silent passes:
  - dependabot[bot] PRs;
  - release/* head branches opened by a Bot account (the release PR the cut creates);
  - chore/harness-sync opened by hypeproof-agent[bot] (the harness sync PR).

Ownership: this entry point is studio-owned for now. Move it to hypeproof-harness
scripts/hype-pr/ when another consumer enables the contract (harness#512).

Exit: 0 pass or logged skip, 1 contract failure, 2 lookup or usage error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hype-pr"))
import body_contract  # noqa: E402

CLOSES = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)", re.IGNORECASE)
FORWARD_PORT = re.compile(r"^\s*Forward-port of #(\d+)\b", re.IGNORECASE | re.MULTILINE)


@dataclass
class Verdict:
    status: str  # "pass" | "fail" | "skip"
    lines: list[str] = field(default_factory=list)
    reason: str | None = None


def exemption(pr: dict) -> str | None:
    """The logged reason a PR is not judged, or None."""
    login = pr["user"]["login"]
    ref = pr["head"]["ref"]
    if login == "dependabot[bot]":
        return "dependabot[bot] PR"
    if ref.startswith("release/") and pr["user"].get("type") == "Bot":
        return f"release bot PR on {ref}"
    if ref == "chore/harness-sync" and login == "hypeproof-agent[bot]":
        return "harness sync PR by hypeproof-agent[bot]"
    return None


def linked_issue(body: str) -> int | None:
    match = CLOSES.search(body or "")
    return int(match.group(1)) if match else None


def judge(pr: dict, *, head_contract, main_contract, path_exists: Callable[[str], bool],
          main_exists: Callable[[str], bool], issue_body: str | None = None,
          pull_base: Callable[[int], str] = lambda number: "", issue_open: Callable[[int], bool] = lambda number: True) -> Verdict:
    """Decide one PR. Pure: every input from GitHub or git is passed in."""
    reason = exemption(pr)
    if reason:
        return Verdict("skip", [f"skipped: {reason}"], reason)

    body = pr.get("body") or ""
    labels = list(pr.get("labels") or [])
    base = pr["base"]["ref"]
    lane = body_contract.hotfix_lane(main_contract)
    errors: list[str] = []
    mode = "normal"
    contract = head_contract
    exists = path_exists

    if lane is not None:
        hotfix_label, forward_label = lane["label"], lane["forward_label"]
        if base.startswith(lane["base_prefix"]):
            mode = "hotfix"
            contract = main_contract  # the lane is policy: read from the default branch
            exists = lambda path: path_exists(path) or main_exists(path)  # noqa: E731
            if hotfix_label not in labels:
                errors.append(f"add the `{hotfix_label}` label: this PR targets {base}")
            if forward_label in labels:
                errors.append(f"`{forward_label}` is for the port to main, not for a PR into {base}")
        else:
            if hotfix_label in labels:
                errors.append(f"`{hotfix_label}` is only for PRs into {lane['base_prefix']}*")
            if forward_label in labels:
                mode = "forward"
                match = FORWARD_PORT.search(body)
                if not match:
                    errors.append("add a line `Forward-port of #N` naming the hotfix PR this brings to main")
                elif not pull_base(int(match.group(1))).startswith(lane["base_prefix"]):
                    errors.append(f"#{match.group(1)} is not a PR into {lane['base_prefix']}*")

    rule = body_contract.enforced_release_check(contract)
    if rule is None:
        return Verdict("pass", [f"not enforced: {body_contract.CONTRACT_PATH} release_check.enforced is off"])

    errors += body_contract.check_release_check(
        body, smoke_check_prefix=rule["smoke_check_prefix"], path_exists=exists,
        issue_body=issue_body, hotfix=mode == "hotfix",
        manager_check=rule.get("manager_check") is True)

    follow_up = body_contract.smoke_issue_reference(body)
    if follow_up is not None and not errors and not issue_open(follow_up):
        errors.append(f"`Smoke check` #{follow_up} must be an open issue in this repository")

    if errors:
        return Verdict("fail", [f"- {error}" for error in errors], None)
    return Verdict("pass", [f"Release check contract passes ({mode} lane)"])


def gh_api(path: str) -> dict:
    run = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if run.returncode != 0:
        raise LookupError(f"gh api {path}: {run.stderr.strip().splitlines()[-1] if run.stderr.strip() else 'failed'}")
    return json.loads(run.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--checkout", default=".")
    args = parser.parse_args()
    repo = args.repo

    try:
        pr = gh_api(f"repos/{repo}/pulls/{args.pr}")
        pr["labels"] = [label["name"] for label in pr.get("labels", [])]
        issue_number = linked_issue(pr.get("body") or "")
        issue_body = gh_api(f"repos/{repo}/issues/{issue_number}").get("body") if issue_number else None

        read_head, head_exists = body_contract.git_reader(args.checkout, pr["head"]["sha"])
        read_main, main_exists = body_contract.git_reader(args.checkout, "origin/main")

        def pull_base(number: int) -> str:
            return gh_api(f"repos/{repo}/pulls/{number}")["base"]["ref"]

        def issue_open(number: int) -> bool:
            issue = gh_api(f"repos/{repo}/issues/{number}")
            return "pull_request" not in issue and issue.get("state") == "open"

        verdict = judge(pr, head_contract=read_head(), main_contract=read_main(),
                        path_exists=head_exists, main_exists=main_exists, issue_body=issue_body,
                        pull_base=pull_base, issue_open=issue_open)
    except (LookupError, ValueError, KeyError) as error:
        print(f"release-check: cannot judge PR #{args.pr}: {error}", file=sys.stderr)
        return 2

    for line in verdict.lines:
        print(line)
    if verdict.status == "skip":
        print(f"::notice title=release-check skipped::{verdict.reason}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"## release-check — PR #{args.pr}: {verdict.status}\n\n"
                         + "\n".join(f"- {line.removeprefix('- ')}" for line in verdict.lines) + "\n")
    if verdict.status == "fail":
        print(f"::error title=release-check::PR body fails the Release check contract ({body_contract.CONTRACT_PATH})")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
