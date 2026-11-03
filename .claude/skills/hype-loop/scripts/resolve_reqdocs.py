#!/usr/bin/env python3
"""resolve_reqdocs.py - resolve the requirement-doc conflicts parallel Studio rows hit (hypeproof-harness#398).

    resolve_reqdocs.py [--repo DIR] FILE...

The Harness copy of ~/.hypeproof/loop/bin/resolve-reqdocs.py, on keep_both.py's machinery:
git rewrites the conflict with its base (diff3) and a file that is not exactly such a
conflict is refused untouched. A hunk is resolved only when it has one of these shapes;
every other hunk stays in the file for a person:

  Markdown (.md)   two insertions at one place keep ours, then theirs (keep_both.py). A
                   hunk of table rows merges by row ID, the first cell, three ways: a row
                   one side changed or deleted takes that side, a row either side added is
                   kept (ours in their order, then theirs), and a row both sides changed
                   differently, or one changed and the other deleted, is a real conflict.
  requirement-work.json
                   a hunk that is one `"sha256": "<hex>"` line of a `documents` entry is
                   that document's digest: it is recomputed from the document in the work
                   tree, so resolve the document first (files are taken .md first).

The live script put a blank line between two inserted table rows, which ends the table, and
rebuilt requirement-work.json from ours, dropping every other change the incoming side made.
Nothing is staged; check with resolve_check.py, then `git add`. Prints one JSON object;
exit 0 when every hunk of every file was resolved, 1 when a hunk or a file was left, 2 on
a usage error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import keep_both  # noqa: E402

ROW_ID = re.compile(r"\|\s*([^|]*?)\s*\|")
DIGEST = re.compile(r'^(\s*)"sha256": "[0-9a-f]{64}"(,?)(\r?)$')
PATH_KEY = re.compile(r'^(\s*)"path": "([^"]+)",?\r?$')


def row_id(line: str) -> str | None:
    match = ROW_ID.match(line) if line.startswith("|") else None
    return match[1] if match else None


def merge_by_key(ours: list[str], base: list[str], theirs: list[str], key) -> list[str] | None:
    """A three-way merge of lines that `key` names; None when a line has no key or a key repeats on a side."""
    sides = []
    for side in (base, ours, theirs):
        keys = [key(line) for line in side]
        if None in keys or len(set(keys)) != len(keys):
            return None
        sides.append(dict(zip(keys, side)))
    old, mine, yours = sides
    merged = []
    for k in list(mine) + [k for k in yours if k not in mine]:
        if mine.get(k) == yours.get(k) or yours.get(k) == old.get(k):
            line = mine.get(k)  # the same on both sides, or theirs left it as it was
        elif mine.get(k) == old.get(k):
            line = yours.get(k)  # only theirs changed (or deleted) it
        else:
            return None  # changed differently on both sides, or changed on one and deleted on the other
        if line is not None:
            merged.append(line)
    return merged


def table_rows(ours: list[str], base: list[str], theirs: list[str], before: list[str]) -> list[str] | None:
    """A three-way merge of a hunk whose every line, on every side, is a table row with a unique ID."""
    if not base:
        return keep_both.insertions(ours, base, theirs, before)
    return merge_by_key(ours, base, theirs, row_id)  # prose, a blank line or a repeated ID: left


def document_path(before: list[str], indent: int) -> str | None:
    """The `path` key of the JSON object that a line at `indent` belongs to, from the lines above it."""
    for line in reversed(before):
        depth = len(line) - len(line.lstrip(" "))
        if depth < indent:  # the object's opening line: this object has no path key
            return None
        match = PATH_KEY.match(line)
        if match and len(match[1]) == indent:
            return match[2]
    return None


def digests(repo: str):
    """A hunk rule for requirement-work.json: a conflicted document digest is recomputed from the document."""
    def decide(ours: list[str], base: list[str], theirs: list[str], before: list[str]) -> list[str] | None:
        match = DIGEST.match(ours[0]) if len(ours) == 1 else None
        if not match or len(theirs) != 1 or not DIGEST.match(theirs[0]) or len(base) > 1 or (
                base and not DIGEST.match(base[0])):
            return None
        path = document_path(before, len(match[1]))
        document = Path(repo) / path if path else None
        if document is None or not document.is_file():
            return None
        data = document.read_bytes()
        if any(keep_both.marker(line, "<") or keep_both.marker(line, ">") for line in data.decode(errors="replace").split("\n")):
            return None  # the document itself is not resolved yet
        indent, comma, cr = match.groups()
        return [f'{indent}"sha256": "{hashlib.sha256(data).hexdigest()}"{comma}{cr}']
    return decide


def resolve_file(repo: str, path: str) -> dict:
    if path.endswith(".md"):
        return keep_both.keep_both(repo, path, table_rows)
    if not path.endswith("requirement-work.json"):
        return {"path": path, "status": "not a requirement document or requirement-work.json"}
    target = Path(repo) / path
    saved = target.read_bytes() if target.is_file() else None
    result = keep_both.keep_both(repo, path, digests(repo))
    if result["status"] == "resolved":
        try:
            json.loads(target.read_text(encoding="utf-8"))
        except ValueError:
            target.write_bytes(saved)
            return {"path": path, "status": "the resolved file is not valid JSON; resolve by hand"}
    return result


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--repo", default=".")
    p.add_argument("files", nargs="+")
    args = p.parse_args(argv)
    try:  # documents first: a digest is taken from the resolved document
        results = [resolve_file(args.repo, f) for f in sorted(args.files, key=lambda f: not f.endswith(".md"))]
    except (ValueError, OSError) as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        return 2
    ok = all(r["status"] == "resolved" for r in results)
    print(json.dumps({"ok": ok, "files": results}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
