#!/usr/bin/env python3
"""affected_tests.py - the smoke and render tests a diff touches, browser ones included (hypeproof-harness#402).

    affected_tests.py --repo PATH --base REF [--head REF] [--run]

The loop's fast local check ran static smokes only and left browser smokes to CI,
so CI kept catching what a local run could have (#2726: an old ARIA role in
code-block-chrome, a scroll scope in focus-geometry). This lists every test file
that names something the diff changed:

  * a CSS class a changed rule styles (the last compound of each selector, also
    for a declaration changed inside a multi-line rule) or a changed className
    string names;
  * a quoted ARIA role from a changed `role` line, when the test names it on a
    line that also says `role`;
  * Korean copy from a changed line (a quoted string or a JSX text run);
  * the file name (with extension) of a changed source file.

Lines over 400 characters (generated bundles such as design-tokens.ts) give
only their file name.

Test files the diff changes are always listed, and so is every focus-geometry test
when CSS changed (it checks that each new scroller is a focus scope). A test that
imports test/lib/headless-chromium.mjs is marked browser: it prints NOT RUN and
passes when no Chromium is found, so --run sets FOCUS_REQUIRE_BROWSER=1 and a
missing Chromium fails instead. Prints one JSON object with each test, why it was
picked and the command that runs it from its package (`node --experimental-strip-types`
for .mjs/.ts, scripts/run-tsx-tests.mjs for .test.tsx). --browser-only keeps the
browser tests. --run needs --head to be the checked-out commit, and a test with no
runner counts as failed. Exit 0, 1 when a --run test failed, 2 error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TEST_RX = re.compile(r"(^|/)test/[^/]+\.(smoke\.mjs|test\.mjs|test\.tsx|test\.ts|browser\.mjs)$")
SOURCE_RX = re.compile(r"\.(css|tsx|ts|mjs|js|html)$")
ALWAYS_ON_CSS = "focus-geometry"
CSS_CLASS = re.compile(r"\.(-?[A-Za-z_][\w-]*)")
CLASSNAME = re.compile(r"className=(?:\{`|\{'|\{\"|\"|')([^`'\"]+)")
QUOTED = re.compile(r"(['\"`])((?:(?!\1).){1,80}?)\1")
HANGUL = re.compile(r"[가-힣]{2}")
HANGUL_RUN = re.compile(r"[가-힣][가-힣\d ,.!?~]*[가-힣.!?]")
ROLE = re.compile(r"\brole\b")
LONG_LINE = 400


def git(repo: str, *args: str) -> str:
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise ValueError(out.stderr.strip() or f"git {args[0]} failed")
    return out.stdout


def changed_lines(repo: str, base: str, head: str) -> dict[str, list[str]]:
    lines: dict[str, list[str]] = {}
    current = None
    for line in git(repo, "diff", "-U0", "--no-color", f"{base}...{head}").splitlines():
        if line.startswith("+++ ") or line.startswith("--- "):
            path = line[4:].strip()
            if line.startswith("+++ ") or path != "/dev/null":
                current = path[2:] if path[:2] in ("a/", "b/") else None
                if current:
                    lines.setdefault(current, [])
        elif current and line[:1] in "+-":
            lines[current].append(line[1:])
    return lines


def enclosing_classes(repo: str, base: str, head: str, path: str) -> set[str]:
    """Classes of the rules that hold a changed line: a multi-line rule's selector is not in the -U0 hunk."""
    text = git(repo, "show", f"{head}:{path}").splitlines()
    classes: set[str] = set()
    for line in git(repo, "diff", "-U0", "--no-color", f"{base}...{head}", "--", path).splitlines():
        m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
        for n in range(int(m[1]), int(m[1]) + int(m[2] or 1)) if m else ():
            for prev in reversed(text[:n - 1]):  # the lines above changed line n
                if "}" in prev or prev.lstrip().startswith("@"):
                    break  # outside any rule, or inside an at-rule's own block
                if "{" in prev:
                    for selector in prev.split("{", 1)[0].split(","):
                        classes.update(CSS_CLASS.findall((selector.split() or [""])[-1]))
                    break
    return classes


def tokens(changed: dict[str, list[str]]) -> tuple[dict[str, str], dict[str, str]]:
    """(token -> why, role -> why). Test files are not a source of tokens."""
    found: dict[str, str] = {}
    roles: dict[str, str] = {}
    for path, lines in changed.items():
        if TEST_RX.search(path) or not SOURCE_RX.search(path):
            continue
        found.setdefault(Path(path).name, f"changed file {path}")
        for line in lines:
            if len(line) > LONG_LINE:
                continue
            if path.endswith(".css") and "{" in line:
                for selector in line.split("{", 1)[0].split(","):
                    for cls in CSS_CLASS.findall((selector.split() or [""])[-1]):
                        found.setdefault(cls, f"CSS class in {path}")
            for group in CLASSNAME.findall(line):
                for cls in group.split():
                    if re.fullmatch(r"[A-Za-z_][\w-]*", cls):
                        found.setdefault(cls, f"className in {path}")
            for run in HANGUL_RUN.findall(line):
                found.setdefault(run.strip()[:40], f"Korean copy in {path}")
            for _, text in QUOTED.findall(line):
                if HANGUL.search(text):
                    found.setdefault(text.strip()[:40], f"Korean copy in {path}")
                elif ROLE.search(line) and re.fullmatch(r"[a-z]{3,}", text):
                    roles.setdefault(text, f"ARIA role in {path}")
    return {t: why for t, why in found.items() if len(t) >= 4}, roles


def package_scripts(repo: str, head: str, root: Path) -> dict[str, str]:
    out = subprocess.run(["git", "-C", repo, "show", f"{head}:{(root / 'package.json').as_posix()}"],
                         capture_output=True, text=True)
    try:
        return json.loads(out.stdout).get("scripts") or {} if out.returncode == 0 else {}
    except ValueError:
        return {}


def command(repo: str, head: str, path: str) -> list[str] | None:
    parts = Path(path).parts
    root = Path(*parts[:parts.index("test")]) if "test" in parts else Path(path).parent
    rel = Path(path).relative_to(root).as_posix()
    stem = Path(path).name.split(".", 1)[0]
    # A test with its own `test:<name>` script (a build step, a runner flag) runs the way the package runs it.
    if stem in package_scripts(repo, head, root).get(f"test:{stem}", ""):
        return ["npm", "run", "-s", f"test:{stem}"]
    if path.endswith(".test.tsx"):
        runner = (root / "scripts/run-tsx-tests.mjs").as_posix()
        if not git(repo, "ls-tree", "--name-only", head, "--", runner).strip():
            return None
        return ["node", "scripts/run-tsx-tests.mjs", Path(path).name[: -len(".test.tsx")]]
    return ["node", "--experimental-strip-types", rel]


def select(repo: str, base: str, head: str) -> dict:
    changed = changed_lines(repo, base, head)
    found, roles = tokens(changed)
    for path in changed:
        if path.endswith(".css") and not TEST_RX.search(path):
            for cls in enclosing_classes(repo, base, head, path):
                found.setdefault(cls, f"CSS class of the rule changed in {path}")
    tests = [p for p in git(repo, "ls-tree", "-r", "--name-only", head).splitlines() if TEST_RX.search(p)]
    reasons: dict[str, list[str]] = {}
    css = any(p.endswith(".css") for p in changed)
    for path in tests:
        if path in changed:
            reasons.setdefault(path, []).append("test changed")
        if css and ALWAYS_ON_CSS in Path(path).name:
            reasons.setdefault(path, []).append("CSS changed: every new scroller must be a focus scope")
    if found:
        args = ["grep", "-o", "-F"] + [x for t in sorted(found) for x in ("-e", t)] + [head, "--"] + tests
        out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
        for hit in sorted(set(out.stdout.splitlines())):
            _, path, token = hit.split(":", 2)
            if token in found and path not in changed:
                reasons.setdefault(path, []).append(f"{token} ({found[token]})")
    for role, why in sorted(roles.items()):
        # A role is a common word: count it only on a line that also says `role`.
        rx = f"role.*['\"]{role}['\"]|['\"]{role}['\"].*role"
        out = subprocess.run(["git", "-C", repo, "grep", "-l", "-E", "-e", rx, head, "--", *tests],
                             capture_output=True, text=True)
        for hit in out.stdout.splitlines():
            path = hit.split(":", 1)[1]
            if path not in changed:
                reasons.setdefault(path, []).append(f"role '{role}' ({why})")
    picked = []
    for path in sorted(reasons):
        root = Path(*Path(path).parts[:Path(path).parts.index("test")]).as_posix()
        browser = "headless-chromium" in git(repo, "show", f"{head}:{path}")
        picked.append({"file": path, "cwd": root or ".", "command": command(repo, head, path),
                       "browser": browser, "reasons": reasons[path]})
    return {"base": base, "head": head, "changed": sorted(changed), "tokens": len(found) + len(roles), "tests": picked}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--repo", default=".")
    p.add_argument("--base", required=True)
    p.add_argument("--head", default="HEAD")
    p.add_argument("--run", action="store_true", help="run each selected test from its package root")
    p.add_argument("--browser-only", action="store_true", help="keep only headless-browser tests")
    args = p.parse_args(argv)
    try:
        result = select(args.repo, args.base, args.head)
        if args.browser_only:
            result["tests"] = [t for t in result["tests"] if t["browser"]]
    except ValueError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 2
    failed = []
    if args.run and git(args.repo, "rev-parse", args.head) != git(args.repo, "rev-parse", "HEAD"):
        print(json.dumps({"status": "error", "error": "--run runs the checked-out tree: --head must be HEAD"}))
        return 2
    if args.run:
        for test in result["tests"]:
            if not test["command"]:
                test["rc"], test["tail"] = None, "no runner for this test file"
                failed.append(test["file"])  # a test nobody can run is not a pass
            else:
                done = subprocess.run(test["command"], cwd=Path(args.repo) / test["cwd"], capture_output=True,
                                      text=True, env={**os.environ, "FOCUS_REQUIRE_BROWSER": "1"})
                test["rc"] = done.returncode
                if done.returncode != 0:
                    test["tail"] = (done.stdout + done.stderr)[-600:]
                    failed.append(test["file"])
        result["failed"] = failed
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
