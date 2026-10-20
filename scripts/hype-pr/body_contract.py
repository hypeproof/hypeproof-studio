#!/usr/bin/env python3
"""Check a PR body against the Release check contract a repository declares.

A repository opts in by committing `config/pr-body-contract.json`:

    {"version": 1, "release_check": {"enforced": true,
                                     "smoke_check_prefix": "scripts/release/smoke/checks/"}}

With the contract enforced, the PR body must carry:

    ## Release check
    How to verify: <where> → <what to click or run> → <expected result>
    Smoke: yes|no — <reason>
    Smoke check: <path under smoke_check_prefix, or #issue>     (only when Smoke: yes)
    Smoke differs from issue: <reason>                          (only when the linked
                                                                 issue says yes and the PR says no)

The release manager reads the first line of the section, so How to verify comes first.
Issues are never checked: the issue's own "Smoke needed?" answer is only compared with
the PR's, and skipped when the issue has no answer.

With `"manager_check": true` under release_check, the section starts with

    Release manager check: yes|no — <reason>

`yes` means a user sees or meets changed behavior in the rc App; How to verify is then
required on the next line. `no` needs a reason and How to verify is not asked. Smoke is
asked either way. The hotfix lane ignores this line.

A contract may also declare a hotfix lane:

    "hotfix": {"base_prefix": "hotfix/", "label": "hotfix", "forward_label": "hotfix-forward"}

A PR whose base starts with base_prefix is a hotfix. It carries `label`, skips the
release manager's How to verify line, and still answers Smoke. The fix then goes
to main in a separate PR that carries `forward_label` and a `Forward-port of #N` line.

Pure functions only, no dependencies: the same file runs in a consumer's CI.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Callable

CONTRACT_PATH = "config/pr-body-contract.json"
SECTION = re.compile(r"^#{2,}\s*Release check[^\n]*\n(?P<body>[\s\S]*?)(?=^#{1,6}\s|\Z)", re.I | re.M)
ARROW = re.compile(r"\s*(?:→|->)\s*")
PLACEHOLDER = re.compile(r"<!--|<[^<>\n]+>")
MIN_REASON = 10
MIN_STEP = 2


def field(section: str, name: str) -> str | None:
    match = re.search(rf"^\s*(?:[-*]\s*)?{re.escape(name)}\s*:\s*(.*)$", section, re.I | re.M)
    return match.group(1).strip() if match else None


def is_filled(value: str | None, minimum: int) -> bool:
    return bool(value) and not PLACEHOLDER.search(value) and len(value) >= minimum


def issue_smoke(issue_body: str | None) -> str | None:
    """The linked issue's "Smoke needed?" answer from a GitHub issue form, if any."""
    if not issue_body:
        return None
    match = re.search(r"^#{2,}\s*Smoke needed\?\s*\n+\s*(\S+)", issue_body, re.I | re.M)
    if not match:
        return None
    answer = match.group(1).strip().lower()
    return answer if answer in {"yes", "no"} else None


def check_release_check(body: str, *, smoke_check_prefix: str,
                        path_exists: Callable[[str], bool],
                        issue_body: str | None = None, hotfix: bool = False,
                        manager_check: bool = False) -> list[str]:
    """Return what is missing or malformed; an empty list means the body passes.

    A hotfix skips the release manager's checklist, so How to verify is not asked
    for; the smoke decision still is. With manager_check the author first says
    whether the release manager must check the PR at all; only yes asks How to verify.
    """
    section_match = SECTION.search(body or "")
    if not section_match or not section_match.group("body").strip():
        return ["add a non-empty `## Release check` section"]
    # Guidance comments in the template are not answers, and must not be read as one.
    section = re.sub(r"<!--[\s\S]*?-->", "", section_match.group("body"))
    errors = []

    first = next((line.strip() for line in section.splitlines() if line.strip()), "")
    verify = field(section, "How to verify")
    steps = [s for s in ARROW.split(verify or "") if s.strip()]
    verify_first, skip_verify = True, hotfix
    if manager_check and not hotfix:
        manager = re.match(r"(yes|no)\b\s*(?:[—–:-]+\s*)?(.*)$", field(section, "Release manager check") or "", re.I)
        if not manager:
            errors.append("add `Release manager check: yes — <reason>` or `Release manager check: no — <reason>`")
            skip_verify = True  # without the answer, do not also demand How to verify
        elif not re.match(r"(?:[-*]\s*)?Release manager check\s*:", first, re.I):
            errors.append("put `Release manager check` on the first line of the section")
        if manager and manager.group(1).lower() == "no":
            if not is_filled(manager.group(2).strip(), MIN_REASON):
                errors.append(f"say why no release manager check is needed, in at least {MIN_REASON} characters "
                              "(e.g. release tooling only, CI only, docs only)")
            skip_verify = True  # nothing for the release manager to verify
        verify_first = False  # the answer line comes first
    if skip_verify:
        pass
    elif verify is None:
        errors.append("add `How to verify: <where> → <what to click or run> → <expected result>`")
    elif PLACEHOLDER.search(verify) or len(steps) < 3 or any(len(s.strip()) < MIN_STEP for s in steps):
        errors.append("`How to verify` needs three filled parts: where → what to click or run → expected result")
    elif verify_first and not re.match(r"(?:[-*]\s*)?How to verify\s*:", first, re.I):
        errors.append("put `How to verify` on the first line of the section; the release manager reads that line")

    smoke = field(section, "Smoke")
    smoke_match = re.match(r"(yes|no)\b\s*(?:[—–:-]+\s*)?(.*)$", smoke or "", re.I)
    if not smoke_match:
        errors.append("add `Smoke: yes — <reason>` or `Smoke: no — <reason>`")
        return errors
    answer, reason = smoke_match.group(1).lower(), smoke_match.group(2).strip()
    if not is_filled(reason, MIN_REASON):
        errors.append(f"give the Smoke reason in at least {MIN_REASON} characters")

    if answer == "yes":
        target = field(section, "Smoke check") or ""
        if re.fullmatch(r"#\d+", target):
            pass  # a follow-up issue; its existence is checked by the caller
        elif not target.startswith(smoke_check_prefix) or not path_exists(target):
            errors.append(f"`Smoke check` must be a file under `{smoke_check_prefix}` in this PR's tree, or a follow-up issue `#N`")
    elif issue_smoke(issue_body) == "yes" and not is_filled(field(section, "Smoke differs from issue"), MIN_REASON):
        errors.append("the linked issue says Smoke needed: yes; add `Smoke differs from issue: <reason>`")
    return errors


def smoke_issue_reference(body: str) -> int | None:
    section_match = SECTION.search(body or "")
    section = re.sub(r"<!--[\s\S]*?-->", "", section_match.group("body")) if section_match else ""
    target = field(section, "Smoke check")
    match = re.fullmatch(r"#(\d+)", target or "")
    return int(match.group(1)) if match else None


def git_reader(checkout: str | Path, ref: str):
    def run(*args):
        return subprocess.run(["git", "-C", str(checkout), *args], text=True, capture_output=True)

    def read_contract():
        shown = run("show", f"{ref}:{CONTRACT_PATH}")
        return json.loads(shown.stdout) if shown.returncode == 0 else None

    def path_exists(path):
        return run("cat-file", "-e", f"{ref}:{path}").returncode == 0

    return read_contract, path_exists


def hotfix_lane(contract: dict | None) -> dict | None:
    """The contract's hotfix lane, or None when the repository declares none."""
    lane = (contract or {}).get("hotfix")
    if lane is None:
        return None
    for key in ("base_prefix", "label", "forward_label"):
        if not isinstance(lane.get(key), str) or not lane[key]:
            raise ValueError(f"{CONTRACT_PATH}: hotfix.{key} is required")
    if lane["label"] == lane["forward_label"]:
        raise ValueError(f"{CONTRACT_PATH}: hotfix.label and hotfix.forward_label must differ")
    return lane


def forward_port_errors(body: str, hotfix_pr: int) -> list[str]:
    if re.search(rf"^\s*Forward-port of #{hotfix_pr}\b", body or "", re.I | re.M):
        return []
    return [f"add a line `Forward-port of #{hotfix_pr}` naming the hotfix PR this brings to main"]


def enforced_release_check(contract: dict | None) -> dict | None:
    if not contract:
        return None
    if contract.get("version") != 1:
        raise ValueError(f"{CONTRACT_PATH}: unsupported version {contract.get('version')!r}")
    rule = contract.get("release_check") or {}
    if not rule.get("enforced"):
        return None
    if not isinstance(rule.get("manager_check", False), bool):
        raise ValueError(f"{CONTRACT_PATH}: release_check.manager_check must be true or false")
    if not isinstance(rule.get("smoke_check_prefix"), str) or not rule["smoke_check_prefix"]:
        raise ValueError(f"{CONTRACT_PATH}: release_check.smoke_check_prefix is required")
    return rule
