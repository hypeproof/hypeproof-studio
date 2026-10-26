#!/usr/bin/env python3
"""preflight.py - the mechanical checks an implementer passes before handing a Studio row off (hypeproof-harness#404).

    preflight.py --repo WORKTREE [--base origin/main] [--row CGP-CHAT-R-015]

First-round verifications in the CGP loop failed mostly for bookkeeping, not
behaviour: no commits on the branch, new files not linked to a trace node, design
conventions, a missing requirement or intent link. Each failure cost a verify ->
fix -> re-verify round. This finds them first:

  commits      the branch has commits, and nothing is uncommitted or untracked
               (hype-pr inspect refuses both)
  trace        every added source and test file is in some node's `sources`
               in config/traceability.json
  structure    every trace node the branch adds or changes keeps hype-pr's
               structural rule (change-impact `structural_gaps`): a requirement
               depends on an intent or requirement, a design on a requirement or
               design, an implementation on a design or requirement, a test on a
               requirement or test
  design       in added CSS/TSX lines: a literal transition duration (use a
               token), outline longhand (use the shorthand), a check-mark glyph
               (use the icon component), a new overflow:auto/scroll scroller
               without a focusGeometry.css change in the same branch
  requirement  with --row: the row id appears in docs/studio-requirements.md or
               docs/design/*.md in text a requirement or design node cites (the
               whole file or any enclosing heading), and that node's depends_on
               chain reaches an intent
  tests        the browser tests to run before handing off (affected_tests.py)
  mutation     with --mutations (#404's fourth item): one mechanical mutant for each
               guard line the branch adds to an implementation source (drop an early
               return, negate an if, shift a boundary or a constant, startsWith ->
               includes, flip ===, aria-hidden or &&), at most 10, each run against
               the row's own non-browser tests in a detached scratch worktree of
               HEAD with the checkout's node_modules linked in; a mutant they survive,
               or a failing control run, is a finding. Only on a clean worktree;
               --mutation-budget seconds in total (300)

Prints one JSON object; exit 0 when there are no findings, 1 otherwise, 2 on error.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import affected_tests  # noqa: E402

TRACE = "config/traceability.json"
REQ_DOCS = ("docs/studio-requirements.md", "docs/design/*.md")
SOURCE = re.compile(r"^(extensions/[^/]+/(src|webview-ui/src)|chalk/src|packages/[^/]+/src)/.+\.(ts|tsx|css|mjs|js)$")
TEST = affected_tests.TEST_RX
LITERAL_DURATION = re.compile(r"\btransition(-duration)?\s*:[^;]*?(?<![\w-])\d+(\.\d+)?m?s\b")
OUTLINE_LONGHAND = re.compile(r"\boutline-(width|style|color)\s*:")
SCROLLER = re.compile(r"\boverflow(-x|-y)?\s*:\s*(auto|scroll)\b")
GLYPH = re.compile(r"[✓✔]")
HEADING = re.compile(r"^(#{1,6}) ")


def git(repo: str, *args: str) -> str:
    out = subprocess.run(["git", "--no-optional-locks", "-C", repo, *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise ValueError(out.stderr.strip() or f"git {args[0]} failed")
    return out.stdout


def structural_gaps(nodes: dict) -> list[str]:
    """hype-pr's rule, from the Harness's own change-impact engine."""
    path = Path(__file__).resolve().parents[3] / "scripts/change-impact/impact.py"
    spec = importlib.util.spec_from_file_location("change_impact", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.structural_gaps(nodes)


def check_commits(repo: str, base: str) -> list[dict]:
    found = []
    if not git(repo, "rev-list", f"{base}..HEAD").strip():
        found.append({"check": "commits", "detail": f"no commits on the branch since {base}"})
    status = git(repo, "status", "--porcelain", "--untracked-files=all").splitlines()
    if any(not s.startswith("??") for s in status):
        found.append({"check": "commits", "detail": "uncommitted changes in tracked files"})
    if any(s.startswith("??") for s in status):
        found.append({"check": "commits", "detail": "untracked files: " + ", ".join(s[3:] for s in status if s.startswith("??"))[:200]})
    return found


def check_trace(repo: str, base: str, nodes: list[dict]) -> list[dict]:
    linked = {s.get("path") for n in nodes for s in n.get("sources") or []}
    added = git(repo, "diff", "--name-only", "--diff-filter=A", f"{base}...HEAD").split()
    return [{"check": "trace", "file": p, "detail": f"added {'test' if TEST.search(p) else 'source'} file is in no node's sources"}
            for p in added if (SOURCE.search(p) or TEST.search(p)) and p not in linked]


def check_structure(repo: str, base: str, nodes: list[dict]) -> list[dict]:
    try:
        before = {n["id"]: n for n in json.loads(git(repo, "show", f"{base}:{TRACE}"))["nodes"]}
    except ValueError:
        before = {}  # the registry is new on this branch
    head = {n["id"]: n for n in nodes}
    touched = {nid for nid, n in head.items() if before.get(nid) != n}
    found = [{"check": "structure", "detail": f"{nid} depends on unknown {p}"}
             for nid in sorted(touched) for p in head[nid].get("depends_on") or [] if p not in head]
    graph = {nid: {"stage": n.get("stage"), "depends_on": [p for p in n.get("depends_on") or [] if p in head]}
             for nid, n in head.items()}
    return found + [{"check": "structure", "detail": f"{nid} ({graph[nid]['stage']}) has no parent of the stage hype-pr requires"}
                    for nid in structural_gaps(graph) if nid in touched]


def check_design(repo: str, base: str) -> list[dict]:
    changed = affected_tests.changed_lines(repo, base, "HEAD")
    focus_scope_changed = any(Path(p).name == "focusGeometry.css" for p in changed)
    found = []
    for path, lines in changed.items():
        if TEST.search(path) or not path.endswith((".css", ".tsx")):
            continue
        added = set(git(repo, "diff", "-U0", f"{base}...HEAD", "--", path).splitlines())
        for line in lines:
            if f"+{line}" not in added:
                continue  # a removed line
            if path.endswith(".css") and LITERAL_DURATION.search(line):
                found.append({"check": "design", "file": path, "detail": f"literal transition duration, use a token: {line.strip()[:80]}"})
            if path.endswith(".css") and OUTLINE_LONGHAND.search(line):
                found.append({"check": "design", "file": path, "detail": f"outline longhand, use the shorthand: {line.strip()[:80]}"})
            if path.endswith(".css") and SCROLLER.search(line) and not focus_scope_changed:
                found.append({"check": "design", "file": path, "detail": "new scroller without a focusGeometry.css scroll scope: "
                              + line.strip()[:80]})
            if path.endswith(".tsx") and GLYPH.search(line):
                found.append({"check": "design", "file": path, "detail": f"check-mark glyph, use the icon component: {line.strip()[:80]}"})
    return found


def enclosing(lines: list[str]) -> set[str]:
    """Every heading the last line sits under: the nearest one of each shallower level."""
    found, depth = set(), 7
    for line in reversed(lines):
        m = HEADING.match(line)
        if m and len(m.group(1)) < depth:
            found.add(line.strip())
            depth = len(m.group(1))
    return found


def check_requirement(repo: str, row: str, nodes: list[dict]) -> list[dict]:
    """The row is in requirement or design text that a requirement or design node cites, reaching an intent."""
    grep = subprocess.run(["git", "-C", repo, "grep", "-n", "-F", row, "HEAD", "--", *REQ_DOCS],
                          capture_output=True, text=True)
    if grep.returncode not in (0, 1):  # 1 is "no match"
        raise ValueError(grep.stderr.strip() or "git grep failed")
    hits = [h.split(":", 3)[1:3] for h in grep.stdout.splitlines()]
    if not hits:
        return [{"check": "requirement", "detail": f"no requirement text mentions {row} ({', '.join(REQ_DOCS)})"}]
    places = {(path, None) for path, _ in hits}
    for path, line in hits:
        places |= {(path, h) for h in enclosing(git(repo, "show", f"HEAD:{path}").splitlines()[:int(line)])}
    cites = lambda n, specific: any((s.get("path"), (s.get("section") or "").strip() or None) in places  # noqa: E731
                                    and bool(s.get("section")) == specific for s in n.get("sources") or [])
    stage = [n for n in nodes if n.get("stage") in ("requirement", "design")]
    # A heading citation names the row's own node; a whole-file citation is the fallback.
    cited = [n for n in stage if cites(n, True)] or [n for n in stage if cites(n, False)]
    if not cited:
        return [{"check": "requirement", "detail": f"no requirement or design node cites the text that mentions {row}"}]
    by_id = {n["id"]: n for n in nodes}
    for node in cited:
        seen, todo = set(), list(node.get("depends_on") or [])
        while todo:
            nid = todo.pop()
            if nid not in seen:
                seen.add(nid)
                todo += (by_id.get(nid) or {}).get("depends_on") or []
        if any((by_id.get(n) or {}).get("stage") == "intent" for n in seen):
            return []
    return [{"check": "requirement", "detail": f"{', '.join(sorted(n['id'] for n in cited))}: no depends_on chain reaches an intent"}]


def _swap(pattern: str, table) -> object:
    """An operator that replaces group 1 of the first match of `pattern` by `table(group 1)`."""
    rx = re.compile(pattern)

    def op(line: str) -> str | None:
        m = rx.search(line)
        return line[:m.start(1)] + table(m[1]) + line[m.end(1):] if m else None
    return op


# #404's fourth item: the first operator that applies to a guard line the branch adds makes its one
# mutant ("" removes the line). They cover what the verifiers found alive: auto-retry and early-exit
# guards, prefix boundaries, length bounds, aria-hidden.
OPERATORS = (
    ("drop early return", lambda line: "" if re.match(r"\s*if \(.+\) (\{ )?return\b", line) else None),
    ("negate", lambda line: re.sub(r"\bif \((.+)\) \{$", r"if (!(\1)) {", line) if re.search(r"\bif \(.+\) \{$", line) else None),
    ("boundary", _swap(r" (<=|>=|<|>) ", {"<": "<=", "<=": "<", ">": ">=", ">=": ">"}.get)),
    ("constant", _swap(r"(?:[<>]=? |[!=]== |\.slice\(0, )(\d+)\b", lambda n: str(int(n) + 1))),
    ("prefix", lambda line: line.replace(".startsWith(", ".includes(", 1) if ".startsWith(" in line else None),
    ("equality", _swap(r" (===|!==) ", {"===": "!==", "!==": "==="}.get)),
    ("boolean", _swap(r"\b(?:aria-[\w-]+|hidden|disabled)=[{\"']?(true|false)\b", {"true": "false", "false": "true"}.get)),
    ("logic", _swap(r" (&&|\|\|) ", {"&&": "||", "||": "&&"}.get)),
)
MUTANTS_MAX, MUTANT_TIMEOUT_S = 10, 60


def guard_mutants(repo: str, base: str) -> list[dict]:
    """One mutant per added guard line of the branch's implementation sources, in diff order."""
    import resolve_generated  # generated files are regenerated, not guarded
    mutants = []
    for path in sorted(affected_tests.changed_lines(repo, base, "HEAD")):
        if (not SOURCE.match(path) or TEST.search(path) or path.endswith(".css")
                or path in resolve_generated.REGISTRY or not (Path(repo) / path).is_file()):
            continue
        number = None
        for line in git(repo, "diff", "-U0", "--no-color", f"{base}...HEAD", "--", path).splitlines():
            hunk = re.match(r"@@ -\S+ \+(\d+)", line)
            if hunk:
                number = int(hunk[1])
            elif line.startswith("+") and not line.startswith("+++") and number is not None:
                text = line[1:]
                # A comment guards nothing, and a line over 400 characters is a generated bundle
                # (tooltips.ts embeds one as a string), as in affected_tests.py.
                if not text.lstrip().startswith(("//", "*", "/*")) and len(text) <= 400:
                    for name, op in OPERATORS:
                        mutant = op(text)
                        if mutant is not None and mutant != text:
                            mutants.append({"file": path, "line": number, "operator": name, "mutant": mutant})
                            break
                number += 1
    return mutants[:MUTANTS_MAX]


def failing_test(root: Path, tests: list[dict], timeout: float) -> str | None:
    """The first test that fails or hangs when run under `root`, as a short reason; None when all pass."""
    for t in tests:
        try:
            out = subprocess.run(t["command"], cwd=root / t["cwd"], capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return f"{t['file']} timed out after {timeout:g} s"  # a mutant that hangs a test is caught
        if out.returncode:
            last = ((out.stderr or out.stdout).strip().splitlines() or [""])[-1]
            return f"{t['file']} exit {out.returncode}: {last[:120]}"
    return None


def link_node_modules(repo: Path, scratch: Path, tests: list[dict], links: list[Path]) -> None:
    """Link into `scratch` every node_modules the tests' commands can resolve from: in the directory each
    runs in and its parents (Node looks upward), and up to two levels below it (webview-ui/node_modules)."""
    places = set()
    for t in tests:
        cwd = Path(t["cwd"])
        places.update([cwd, *cwd.parents])
        for path, dirs, _ in os.walk(repo / cwd):
            rel = Path(path).relative_to(repo)
            places.add(rel)
            dirs[:] = [d for d in dirs if d != "node_modules" and not d.startswith(".")] if len(rel.parts) < len(cwd.parts) + 2 else []
    for rel in sorted(places):
        source, target = repo / rel / "node_modules", scratch / rel / "node_modules"
        if source.is_dir() and target.parent.is_dir() and not target.exists():
            target.symlink_to(source.resolve(), target_is_directory=True)
            links.append(target)


def check_mutations(repo: str, base: str, budget: float, timeout: float = MUTANT_TIMEOUT_S) -> tuple[list[dict], dict]:
    """Run each guard mutant against the row's own non-browser tests in a scratch worktree; survivors are findings.

    The scratch worktree is a detached checkout of HEAD in a temp dir, never in the repo, so a killed
    run cannot leave a mutant where the implementer's next commit picks it up. Its hp- prefix lets
    tick_cleanup.py remove one a killed run left behind.
    """
    report = {"tests": [], "tried": 0, "caught": 0, "survived": [], "not_run": None}
    if git(repo, "status", "--porcelain", "--untracked-files=all").strip():
        report["not_run"] = "the worktree is not clean, so a checkout of HEAD would test other code"
        return [], report
    tests = [t for t in affected_tests.select(repo, base, "HEAD")["tests"]
             if "test changed" in t["reasons"] and not t["browser"] and t["command"]]
    mutants, started = guard_mutants(repo, base), time.monotonic()
    report["tests"] = [t["file"] for t in tests]
    if not mutants or not tests:
        report["not_run"] = "no guard line in the branch" if not mutants else "no non-browser test of the row's own"
        return [], report
    root = Path(tempfile.mkdtemp(prefix="hp-preflight-mutants-"))
    scratch, links = root / "wt", []
    try:
        git(repo, "worktree", "add", "--detach", "-q", str(scratch), "HEAD")
        link_node_modules(Path(repo), scratch, tests, links)
        failed = failing_test(scratch, tests, timeout)  # the unmutated control: a broken link or setup fails here
        if failed:
            report["not_run"] = f"the control run failed in the scratch worktree: {failed}"
            return [{"check": "mutation", "detail": report["not_run"] + "; no mutant was judged"}], report
        for m in mutants:
            if time.monotonic() - started > budget:
                report["not_run"] = f"budget of {budget:g} s reached after {report['tried']} of {len(mutants)} mutants"
                break
            target = scratch / m["file"]
            original = target.read_text(encoding="utf-8")
            lines = original.split("\n")
            lines[m["line"] - 1:m["line"]] = [m["mutant"]] if m["mutant"] else []
            target.write_text("\n".join(lines), encoding="utf-8")
            caught = failing_test(scratch, tests, timeout) is not None
            target.write_text(original, encoding="utf-8")
            report["tried"] += 1
            if caught:
                report["caught"] += 1
            else:
                report["survived"].append(m)
    finally:
        for link in links:
            link.unlink()  # first, so removing the worktree can never delete through a link
        subprocess.run(["git", "-C", repo, "worktree", "remove", "--force", str(scratch)], capture_output=True)
        shutil.rmtree(root, ignore_errors=True)
        subprocess.run(["git", "-C", repo, "worktree", "prune"], capture_output=True)
    return [{"check": "mutation", "file": m["file"], "line": m["line"],
             "detail": f"{m['file']}:{m['line']} {m['operator']} survives the row's own tests: {m['mutant'].strip()[:80] or '(removed)'}"}
            for m in report["survived"]], report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--repo", default=".")
    p.add_argument("--base", default="origin/main")
    p.add_argument("--row")
    p.add_argument("--mutations", action="store_true", help="mutation spot-check of the branch's own guards")
    p.add_argument("--mutation-budget", type=float, default=300, help="seconds for the spot-check (default 300)")
    p.add_argument("--mutation-timeout", type=float, default=MUTANT_TIMEOUT_S, help="seconds per test run (default 60)")
    args = p.parse_args(argv)
    mutations = None
    try:
        nodes = json.loads(git(args.repo, "show", f"HEAD:{TRACE}"))["nodes"]
        findings = (check_commits(args.repo, args.base) + check_trace(args.repo, args.base, nodes)
                    + check_structure(args.repo, args.base, nodes) + check_design(args.repo, args.base))
        if args.row:
            findings += check_requirement(args.repo, args.row, nodes)
        tests = affected_tests.select(args.repo, args.base, "HEAD")["tests"]
        if args.mutations:
            survived, mutations = check_mutations(args.repo, args.base, args.mutation_budget, args.mutation_timeout)
            findings += survived
    except (ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 2
    result = {"ok": not findings, "findings": findings, "run_before_handoff": [t["file"] for t in tests if t["browser"]]}
    if mutations is not None:
        result["mutations"] = mutations
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
