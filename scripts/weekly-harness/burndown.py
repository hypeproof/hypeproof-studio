#!/usr/bin/env python3
"""hypeproof weekly-loop burndown — pre-meeting report for a cycle label.

Canonical source in hypeproof-harness; vendored into each consumer repo
(hypeproof-studio, sediment, hypeprooflab) via sync.sh. Intentionally uses
only the Python standard library so each product repo can vendor and run it
without bootstrapping a package manager. GitHub access goes through the `gh`
CLI — no tokens are read or stored here.

Per repo it reports closed vs open counts for the cycle label and lists each
issue (number, title, owner, state). Output is markdown, suitable for pasting
at the top of the Monday agenda (docs/WEEKLY-LOOP.ko.md §7). The Monday
meeting opens with this table.

USAGE:
    burndown.py --cycle weekly-2026-07-21
    burndown.py --cycle weekly-2026-07-21 --repo hypeproof/sediment
    burndown.py --cycle weekly-2026-07-21 --issues-json fixtures.json  # offline

`--issues-json` bypasses `gh` for deterministic tests: a JSON object mapping
"owner/name" to a list of gh-shaped issue dicts (number, title, body, state,
assignees, url).

Below the cycle tables comes the board, the work record (hypeproof-harness#397):
Command Center #4's Done since the cycle date, In Progress and Blocked for the same
repos, from the Harness `scripts/board/board.py report`. board.py is looked up in
$HYPEPROOF_HARNESS, in this repo and in a sibling `hypeproof-harness` checkout. A
missing board.py or a failed read is printed in place of that section (and on stderr)
and the exit code stays 0. An offline run (`--issues-json`) has no board section.

EXIT CODES:
    0  report generated (open issues are the meeting's business, not a failure)
    2  config error / bad cycle label / gh failure
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_REPOS = [
    "hypeproof/hypeprooflab",
    "hypeproof/hypeproof-studio",
    "hypeproof/sediment",
]

CYCLE_RE = re.compile(r"^weekly-\d{4}-\d{2}-\d{2}$")
OWNER_LINE_RE = re.compile(
    r"^\s*(?:[-*]\s*)?(?:\*\*)?(?:Owner|담당자?)(?:\*\*)?\s*[:：]\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)


def gh_cycle_issues(repo: str, label: str) -> list[dict]:
    proc = subprocess.run(
        [
            "gh", "issue", "list",
            "--repo", repo,
            "--label", label,
            "--state", "all",
            "--limit", "200",
            "--json", "number,title,body,state,assignees,url",
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip()
        raise RuntimeError(f"gh issue list failed for {repo}: {detail}")
    return json.loads(proc.stdout or "[]")


def issue_owner(issue: dict) -> str:
    """Owner line from the body wins; fall back to the first assignee."""
    m = OWNER_LINE_RE.search(issue.get("body") or "")
    if m:
        return m.group(1).strip()
    assignees = issue.get("assignees") or []
    if assignees:
        login = assignees[0].get("login") if isinstance(assignees[0], dict) else assignees[0]
        if login:
            return f"@{login}"
    return "—"


def render(cycle: str, repos: list[str], issues_by_repo: dict[str, list[dict]]) -> str:
    lines: list[str] = [f"# Weekly burndown — {cycle}", ""]
    grand_open = 0
    grand_closed = 0
    for repo in repos:
        issues = issues_by_repo.get(repo, [])
        open_issues = [i for i in issues if str(i.get("state", "")).upper() == "OPEN"]
        closed_issues = [i for i in issues if str(i.get("state", "")).upper() != "OPEN"]
        grand_open += len(open_issues)
        grand_closed += len(closed_issues)
        lines.append(f"## {repo} — closed {len(closed_issues)} / open {len(open_issues)}")
        lines.append("")
        if not issues:
            lines.append(f"_no issues carry label `{cycle}`_")
            lines.append("")
            continue
        lines.append("| # | Title | Owner | State |")
        lines.append("|---|---|---|---|")
        for issue in sorted(issues, key=lambda i: (str(i.get("state", "")).upper() != "OPEN", i.get("number", 0))):
            title = str(issue.get("title", "")).replace("|", "\\|")
            state = str(issue.get("state", "?")).upper()
            lines.append(
                f"| [#{issue.get('number', '?')}]({issue.get('url', '')}) | {title} "
                f"| {issue_owner(issue)} | {state} |"
            )
        lines.append("")
    total = grand_open + grand_closed
    pct = f" ({grand_closed * 100 // total}% done)" if total else ""
    lines.append(f"**Total: closed {grand_closed} / open {grand_open}{pct}** — "
                 "open issues get carried over (new cycle label + new ETA) or dropped in the meeting.")
    return "\n".join(lines)


def board_section(cycle: str, repos: list[str]) -> str:
    """Command Center #4 since the cycle date, from the Harness board.py report."""
    here, env = Path(__file__).resolve().parents[2], os.environ.get("HYPEPROOF_HARNESS")
    roots = ([Path(env).expanduser()] if env else []) + [here, here.parent / "hypeproof-harness"]
    script = next((r / "scripts/board/board.py" for r in roots if (r / "scripts/board/board.py").is_file()), None)
    if script is None:
        note = "no Harness checkout with scripts/board/board.py (set HYPEPROOF_HARNESS)"
    else:
        cmd = [sys.executable, str(script), "report", "--since", cycle[len("weekly-"):], "--markdown"]
        proc = subprocess.run(cmd + [arg for repo in repos for arg in ("--repo", repo)],
                              text=True, capture_output=True, check=False)
        if proc.returncode == 0:
            return proc.stdout.strip()
        note = f"board.py report failed: {(proc.stdout or proc.stderr).strip()[:300]}"
    print(f"WARN   board section: {note}", file=sys.stderr)
    return f"_Board section unavailable: {note}_"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Markdown burndown report for a weekly cycle label, per product repo."
    )
    parser.add_argument("--cycle", required=True, help="cycle label, e.g. weekly-2026-07-21")
    parser.add_argument(
        "--repo",
        action="append",
        dest="repos",
        metavar="OWNER/NAME",
        help=f"repo to report (repeatable; default: {', '.join(DEFAULT_REPOS)})",
    )
    parser.add_argument(
        "--issues-json",
        metavar="PATH",
        help='offline fixture: JSON {"owner/name": [issue, ...]} instead of gh',
    )
    args = parser.parse_args(argv)

    if not CYCLE_RE.match(args.cycle):
        print(
            f"ERROR  bad cycle label {args.cycle!r} — expected weekly-YYYY-MM-DD",
            file=sys.stderr,
        )
        return 2

    repos = args.repos or DEFAULT_REPOS

    fixture: dict[str, list[dict]] | None = None
    if args.issues_json:
        try:
            fixture = json.loads(Path(args.issues_json).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"ERROR  cannot read fixture {args.issues_json}: {exc}", file=sys.stderr)
            return 2

    issues_by_repo: dict[str, list[dict]] = {}
    for repo in repos:
        try:
            issues_by_repo[repo] = (
                fixture.get(repo, []) if fixture is not None else gh_cycle_issues(repo, args.cycle)
            )
        except RuntimeError as exc:
            print(f"ERROR  {exc}", file=sys.stderr)
            return 2

    print(render(args.cycle, repos, issues_by_repo))
    if fixture is None:  # an offline run reads nothing from GitHub, the board included
        print("\n" + board_section(args.cycle, repos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
