#!/usr/bin/env python3
"""keep_both.py - resolve the purely additive hunks of a conflicted file (hypeproof-harness#398).

    keep_both.py [--repo DIR] FILE...

The Harness copy of ~/.hypeproof/loop/bin/keep-both.py, made safe to run without
reading every hunk first. The live script kept both sides of every hunk. Parallel
agent branches append to the same files (imports, union members, CSS blocks, doc
sections), and most of their conflicts are two insertions at one place. But a
hunk where both sides changed the same lines is not, and keeping both of those
duplicates or resurrects code.

So a hunk is resolved only when its merge base has no lines at all: both sides
inserted at the same place, with nothing changed. Those keep ours, then theirs
(once, when both inserted the same lines). Every other hunk stays in the file as
a diff3 hunk (the base between `|||||||` and `=======`) for a person or agent.

The hunks always come from git rewriting the conflict with its base (`git
checkout --conflict=diff3`), and only when the working copy is exactly a conflict
git writes again (merge, diff3 or zdiff3 style), so no hand edit is lost. A merge
that git splits differently on a rewrite is refused too; for JSON registries use
the json_nodes merge driver.

A file is refused, with its bytes put back as they were, when it is not
conflicted, was added or deleted on one side or both, does not match a rewrite,
cannot be rewritten (e.g. another git process holds the index lock), or has a
hunk of any other shape. Nothing is staged; check the result with
resolve_check.py, then `git add`.

Prints one JSON object; exit 0 when every hunk of every file was resolved, 1 when
a hunk or a file was left, 2 on a usage error.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

STYLES = ("merge", "diff3", "zdiff3")


class Shape(Exception):
    pass


def git(repo: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        raise ValueError(out.stderr.strip() or f"git {args[0]} failed")
    return out


def rendering(repo: str, path: str, style: str) -> str | None:
    """The conflict as git writes it in `style`, or None when git cannot (old git, a held index lock)."""
    out = git(repo, "checkout", f"--conflict={style}", "--", path, check=False)
    return (Path(repo) / path).read_bytes().decode() if out.returncode == 0 else None  # bytes: keep CRLF as written


def marker(line: str, char: str) -> bool:
    line = line.rstrip("\r")
    return line == char * 7 or line.startswith(char * 7 + " ")


def separator(line: str) -> bool:
    return line.rstrip("\r") == "=" * 7


def normalized(text: str) -> list[str]:
    return [line[:7] if any(marker(line, c) for c in "<|>") else line for line in text.split("\n")]


def insertions(ours: list[str], base: list[str], theirs: list[str], before: list[str]) -> list[str] | None:
    """Two insertions at one place keep ours, then theirs (once when both are the same); nothing else."""
    if base:
        return None
    return ours if ours == theirs else ours + theirs


def resolve(text: str, decide=insertions) -> tuple[str, int, int]:
    """Replace each hunk by `decide(ours, base, theirs, lines before it)`, or leave it when that is None.

    Shape on any other layout. resolve_reqdocs.py passes its own rules for requirement docs.
    """
    lines, out, done, left, i = text.split("\n"), [], 0, 0, 0
    while i < len(lines):
        if not marker(lines[i], "<"):
            if marker(lines[i], "|") or marker(lines[i], ">") or separator(lines[i]):
                raise Shape(f"a conflict marker outside a hunk at line {i + 1}")
            out.append(lines[i])
            i += 1
            continue
        inner, end = [], i + 1
        while end < len(lines) and not marker(lines[end], ">"):
            if marker(lines[end], "<"):
                raise Shape(f"a hunk opens inside another at line {end + 1}")
            if marker(lines[end], "|") or separator(lines[end]):
                inner.append(end)
            end += 1
        if end == len(lines) or len(inner) != 2 or not marker(lines[inner[0]], "|") or not separator(lines[inner[1]]):
            raise Shape(f"the hunk at line {i + 1} is not ours ||||||| base ======= theirs")
        mid, sep = inner
        merged = decide(lines[i + 1:mid], lines[mid + 1:sep], lines[sep + 1:end], out)
        if merged is None:
            out += lines[i:end + 1]
            left += 1
        else:
            out += merged
            done += 1
        i = end + 1
    return "\n".join(out), done, left


def keep_both(repo: str, path: str, decide=insertions) -> dict:
    stages = {line.split()[2]: line.split()[1] for line in git(repo, "ls-files", "-u", "--", path).stdout.splitlines()}
    if not stages:
        return {"path": path, "status": "not conflicted"}
    if set(stages) != {"1", "2", "3"}:
        return {"path": path, "status": "added or deleted on one side or both; resolve by hand"}
    target = Path(repo) / path
    saved = target.read_bytes()
    try:
        work = normalized(saved.decode())
        if not any(r is not None and normalized(r) == work for r in (rendering(repo, path, s) for s in STYLES)):
            target.write_bytes(saved)
            return {"path": path, "status": "not a conflict git writes again (edited since, or merged with other"
                    " options); resolve by hand"}
        source = rendering(repo, path, "diff3")
        if source is None:
            target.write_bytes(saved)
            return {"path": path, "status": "git could not rewrite the conflict with its base; resolve by hand"}
        text, done, left = resolve(source, decide)
    except Shape as e:
        target.write_bytes(saved)
        return {"path": path, "status": f"unexpected conflict layout ({e}); resolve by hand"}
    except BaseException:
        target.write_bytes(saved)
        raise
    target.write_bytes(text.encode())
    return {"path": path, "status": "resolved" if not left else "hunks left", "kept_both": done, "left": left}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repo", default=".")
    p.add_argument("files", nargs="+")
    args = p.parse_args(argv)
    try:
        results = [keep_both(args.repo, f) for f in args.files]
    except (ValueError, OSError) as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        return 2
    ok = all(r["status"] == "resolved" for r in results)
    print(json.dumps({"ok": ok, "files": results}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
