#!/usr/bin/env python3
"""resolve_check.py - parse resolved files before a rebase, merge or cherry-pick continues.

A keep-both resolution git accepted dropped an @container block's closing brace in Studio's
chatDetails.css (hypeproof/hypeproof-harness#400). Run `continue` instead of `git <op> --continue`:

    resolve_check.py check [--repo PATH] [FILE ...]   # no FILE: the step in progress
    resolve_check.py continue [--repo PATH]

The step in progress is every staged added/modified file (its index blob: what --continue
commits) plus every unmerged file. Checks: no conflict marker at column 0; CSS {} () [] balance
outside comments and strings, an unclosed block reported on its opening line; json.loads for
JSON; closed Markdown code fences. A check that the HEAD or incoming version fails too says
nothing about this resolution (or misreads the file, as JSONC), so the file goes to "skipped".
Prints one JSON object. Exit codes: 0 clean (and continued), 1 findings, 2 usage error or no
operation in progress, 3 clean but `git <op> --continue` failed (for example the next conflict).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

MARKER = re.compile(r"(<{7}|\|{7}|={7}|>{7})(?: |$)")
FENCE = re.compile(r"[ \t]*(`{3,}|~{3,})(.*)$")
PAIRS = {"}": "{", ")": "(", "]": "["}
# (state file under the git dir, operation, ref holding the incoming commit)
OPERATIONS = (("rebase-merge", "rebase", "REBASE_HEAD"), ("rebase-apply/applying", "am", "REBASE_HEAD"),
              ("rebase-apply", "rebase", "REBASE_HEAD"),
              ("MERGE_HEAD", "merge", "MERGE_HEAD"), ("CHERRY_PICK_HEAD", "cherry-pick", "CHERRY_PICK_HEAD"))


def fail(code: int, message: str):
    print(json.dumps({"ok": False, "error": message, "code": code}, ensure_ascii=False))
    sys.exit(code)


def git(top: Path, *args: str, check: bool = True) -> bytes | None:
    proc = subprocess.run(["git", "-C", str(top), *args], capture_output=True)
    if proc.returncode and check:
        fail(2, f"git {' '.join(args)} failed: {proc.stderr.decode(errors='replace').strip()}")
    return None if proc.returncode else proc.stdout


def toplevel(path: Path) -> Path | None:
    out = git(path, "rev-parse", "--show-toplevel", check=False)
    return Path(out.decode().strip()) if out is not None else None


def operation(top: Path) -> tuple[str, str] | None:
    """(git subcommand, incoming ref) of the operation in progress, or None."""
    paths = git(top, "rev-parse", *[a for state, _, _ in OPERATIONS for a in ("--git-path", state)]).decode()
    found = [(op, ref) for (_, op, ref), p in zip(OPERATIONS, paths.splitlines()) if (top / p).exists()]
    return found[0] if found else None  # --git-path resolves per-worktree state in linked worktrees


def step_files(top: Path) -> tuple[dict[str, str], list[str]]:
    """Staged added/modified regular files as {path: index blob id}, and the still-unmerged paths."""
    raw = git(top, "diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "--diff-filter=AM", "-z")
    raw = raw.decode("utf-8", errors="surrogateescape").split("\0")
    metas = [meta.split(" ") for meta in raw[0::2]]  # ":<old mode> <new mode> <old id> <new id> <status>"
    staged = {path: m[3] for m, path in zip(metas, raw[1::2]) if m[1] in ("100644", "100755")}
    entries = git(top, "ls-files", "-u", "-z").decode("utf-8", errors="surrogateescape").split("\0")
    return staged, sorted({e.split("\t", 1)[1] for e in entries if "\t" in e})


# ---------------------------------------------------------------- checks

def finding(line: int, rule: str, detail: str) -> dict:
    return {"line": line, "rule": rule, "detail": detail}


def markers(text: str) -> list[dict]:
    lines = [line.rstrip("\r") for line in text.split("\n")]
    # A lone ======= or ||||||| line is a Markdown underline unless a <<<<<<< or >>>>>>> marker is there too.
    paired = any(MARKER.match(line) and line[0] in "<>" for line in lines)
    return [finding(no, "conflict-marker", f"conflict marker {line[:7]} left in the file")
            for no, line in enumerate(lines, 1) if MARKER.match(line) and (paired or line[0] in "<>")]


def css_braces(text: str) -> list[dict]:
    """{} () [] balance outside comments and strings; an unclosed opener is reported on its own line."""
    out, stack, line, i, n = [], [], 1, 0, len(text)
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end < 0:
                return out + [finding(line, "unterminated", "comment /* is never closed")]
            line += text.count("\n", i, end)
            i = end + 1
        elif c in "\"'":
            j = i + 1
            while j < n and text[j] not in (c, "\n"):
                j += 2 if text[j] == "\\" else 1
            if j >= n or text[j] != c:
                out.append(finding(line, "unterminated", f"string {c} is never closed on its line"))
                j -= 1  # leave the newline for the loop to count
            line += text.count("\n", i, max(i, j))
            i = j
        elif c == "\\":  # an escaped character is never a bracket
            i += 1
            line += text.startswith("\n", i)
        elif c in "{([":
            stack.append((c, line))
        elif c in PAIRS:
            if not any(opener == PAIRS[c] for opener, _ in stack):
                out.append(finding(line, "unexpected-close", f"'{c}' closes nothing"))
            else:
                while stack[-1][0] != PAIRS[c]:  # openers it skips over were never closed
                    out.append(finding(stack[-1][1], "unclosed", f"'{stack.pop()[0]}' opened here is never closed"))
                stack.pop()
        i += 1
    return out + [finding(at, "unclosed", f"'{opener}' opened here is never closed") for opener, at in stack]


def check_json(text: str) -> list[dict]:
    try:
        json.loads(text)
    except ValueError as exc:
        return [finding(getattr(exc, "lineno", 1), "json", f"not valid JSON: {getattr(exc, 'msg', exc)}")]
    return []


def md_fences(text: str) -> list[dict]:
    fence = None  # (marker, line it opened on)
    for no, line in enumerate(text.split("\n"), 1):
        m = FENCE.match(line.rstrip("\r"))
        if m and fence:
            if m.group(1)[0] == fence[0][0] and len(m.group(1)) >= len(fence[0]) and not m.group(2).strip():
                fence = None
        elif m and not (m.group(1)[0] == "`" and "`" in m.group(2)):
            fence = (m.group(1), no)
    return [finding(fence[1], "md-fence", f"code fence {fence[0]} opened here is never closed")] if fence else []


CHECKS = {".css": css_braces, ".json": check_json, ".md": md_fences, ".markdown": md_fences}


def check_file(name: str, text: str, parents) -> tuple[list[dict], dict | None]:
    """Findings for one file, or a skipped note when its failing check also fails on a parent version."""
    lines = text.split("\n")
    found = markers(text)
    if found:  # a marker-like line that a parent already has is content, not a leftover
        seen = {line.rstrip("\r") for p in parents() for line in p.split("\n")}
        found = [f for f in found if lines[f["line"] - 1].rstrip("\r") not in seen]
        if found:
            return found, None  # the structure check only adds noise until the markers are gone
    check = CHECKS.get(os.path.splitext(name)[1].lower())
    found = check(text) if check else []
    if found:  # a defect the HEAD or incoming version has on the same line text is not this resolution's
        at = lambda ls, n: ls[n - 1].rstrip("\r") if 0 < n <= len(ls) else ""  # noqa: E731
        old = {(f["rule"], at(p.split("\n"), f["line"])) for p in parents() for f in check(p)}
        new = [f for f in found if (f["rule"], at(lines, f["line"])) not in old]
        if len(new) < len(found):
            return new, {"file": name, "check": check.__name__, "reason": "the HEAD or incoming version has "
                         f"{len(found) - len(new)} of these findings too"}
    return found, None


def hunk(lines: list[str], line: int) -> str:
    lo, hi = max(1, line - 2), min(len(lines), line + 3)
    return "\n".join(f"{'>' if no == line else ' '}{no:5} | {lines[no - 1].rstrip()[:200]}" for no in range(lo, hi + 1))


# ---------------------------------------------------------------- commands

def run_check(base: Path, files: list[str]) -> dict:
    """Check FILEs (relative to base, judged as they are) or, with none, the step in progress."""
    top = toplevel(base) or fail(2, f"not inside a git work tree: {base}")
    op = operation(top)
    revs = ["HEAD"] + ([op[1]] if op else [])
    staged, unmerged = ({}, []) if files else step_files(top)
    targets = []  # (name, repo path whose parent versions count, bytes or None)
    for name in files:
        disk = base / name
        targets.append((name, None, disk.read_bytes() if disk.is_file() else fail(2, f"no such file: {disk}")))
    for rel in sorted(set(staged) | set(unmerged)):
        disk = top / rel  # unmerged means not staged yet, so read what the work tree holds now
        data = git(top, "cat-file", "blob", staged[rel]) if rel in staged else (
            disk.read_bytes() if disk.is_file() and not disk.is_symlink() else None)
        targets.append((rel, rel, data))
    findings, skipped = [], []
    for name, rel, data in targets:
        if name in unmerged:
            findings.append({"file": name, "line": None, "rule": "unmerged",
                             "detail": "still unmerged: finish resolving it, then git add it", "hunk": ""})
        if data is None or b"\0" in data[:8192]:
            continue
        text, cache = data.decode("utf-8", errors="replace"), []

        def parents(rel=rel, cache=cache) -> list[str]:
            if not cache:
                versions = [git(top, "cat-file", "blob", f"{rev}:{rel}", check=False) for rev in revs] if rel else []
                cache.append([v.decode("utf-8", errors="replace") for v in versions if v is not None])
            return cache[0]

        found, note = check_file(name, text, parents)
        findings += [{"file": name, **f, "hunk": hunk(text.split("\n"), f["line"])} for f in found]
        skipped += [note] if note else []
    return {"ok": not findings, "files": [t[0] for t in targets], "findings": findings, "skipped": skipped}


def cmd_continue(repo: str) -> tuple[dict, int]:
    top = toplevel(Path(repo)) or fail(2, f"not inside a git work tree: {repo}")
    op = operation(top) or fail(2, "no rebase, merge or cherry-pick in progress")
    result = {**run_check(top, []), "op": op[0], "continued": False}
    if not result["ok"]:
        return result, 1
    proc = subprocess.run(["git", "-C", str(top), op[0], "--continue"], capture_output=True, text=True,
                          env=dict(os.environ, GIT_EDITOR="true"))
    still = operation(top) is not None
    result.update(continued=proc.returncode == 0, in_progress=still, unmerged=step_files(top)[1] if still else [],
                  git={"returncode": proc.returncode, "output": (proc.stdout + proc.stderr).strip()[-2000:]})
    return result, 0 if proc.returncode == 0 else 3


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="resolve_check.py", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, text in (("check", "check FILEs, or with none the step in progress"),
                       ("continue", "check the step in progress, then git <op> --continue only when clean")):
        sub.add_parser(name, help=text).add_argument("--repo", default=".")
    sub.choices["check"].add_argument("files", nargs="*", metavar="FILE")
    args = p.parse_args(argv)
    if args.cmd == "continue":
        result, code = cmd_continue(args.repo)
    else:
        result = run_check(Path(args.repo), args.files)
        code = 0 if result["ok"] else 1
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
