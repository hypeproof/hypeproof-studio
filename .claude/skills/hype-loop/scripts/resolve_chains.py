#!/usr/bin/env python3
"""resolve_chains.py - merge conflicting `&&`-chained package.json scripts three ways (hypeproof-harness#398).

    resolve_chains.py [--repo DIR] package.json...

The Harness copy of ~/.hypeproof/loop/bin/resolve-test-chains.py, on keep_both.py's
machinery (diff3 rewrite, refuse a file git would not write again, stage nothing). A hunk is
resolved only when it sits in the `"scripts"` object and every line on every side is one
`"name": "step && step ..."` script line:

  * a script on both sides gets the base's steps with both sides' changes: a step either side
    added is kept (theirs after its predecessor in theirs), and a step either side removed stays
    removed. The live script took ours plus theirs' extra steps, so a step main had removed came
    back from an older branch (what retired resolve-test-chain.py);
  * a script one side added is kept; one side deleted while the other left it is dropped;
  * a script deleted on one side and changed on the other, or a base step both sides replaced
    with different steps, stays for a person, like any other line in a hunk.

The file must parse as JSON afterwards, or it is put back. Check with resolve_check.py, then
`git add`. Prints one JSON object; exit 0 when every hunk of every file was resolved, 1 when a
hunk or a file was left, 2 on a usage error.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import keep_both  # noqa: E402

SCRIPT = re.compile(r'^(\s*)"([^"\\]+)": "(.*)",?(\r?)$')


def scripts(side: list[str]) -> dict | None:
    out = {}
    for line in side:
        match = SCRIPT.match(line)
        if not match or match[2] in out:
            return None
        out[match[2]] = (match[1], match[3].split(" && "), match[4])
    return out


def in_scripts(before: list[str], indent: int) -> bool:
    """Whether a line at `indent` sits in the `"scripts"` object, judged by the lines above it."""
    for line in reversed(before):
        if line.strip() and len(line) - len(line.lstrip(" ")) < indent:
            return re.match(r'^\s*"scripts": \{\s*$', line) is not None
    return False


def merge_steps(base: list[str], ours: list[str], theirs: list[str]) -> list[str] | None:
    if [s for s in base if s not in ours and s not in theirs] and (
            [s for s in ours if s not in base] and [s for s in theirs if s not in base]):
        return None  # both replaced a base step: two different edits of one thing
    merged = [s for s in ours if s in theirs or s not in base]
    for i, step in enumerate(theirs):
        if step in merged or step in base:
            continue  # already there, or ours removed it
        before = [s for s in theirs[:i] if s in merged]
        merged.insert(merged.index(before[-1]) + 1 if before else 0, step)
    return merged


def chains(ours: list[str], base: list[str], theirs: list[str], before: list[str]) -> list[str] | None:
    sides = [scripts(side) for side in (base, ours, theirs)]
    if None in sides or not ours or not in_scripts(before, len(SCRIPT.match(ours[0])[1])):
        return None  # a dependency, a version or a description is not a chain
    old, mine, yours = sides
    merged = []
    for name in list(mine) + [n for n in yours if n not in mine]:
        o, m, t = old.get(name), mine.get(name), yours.get(name)
        if m and t:
            steps = merge_steps(o[1] if o else [], m[1], t[1])
            if steps is None:
                return None
            merged.append((m[0], name, steps, m[2]))
        elif o is None:  # one side added it
            side = m or t
            merged.append((side[0], name, side[1], side[2]))
        elif (m or t) != o:
            return None  # deleted on one side, changed on the other
        # else deleted on one side and left as it was on the other: dropped
    comma = ours[-1].rstrip("\r").endswith(",")  # what follows the hunk is the same on every side
    return [f'{indent}"{name}": "{" && ".join(steps)}"' + ("," if i < len(merged) - 1 or comma else "") + cr
            for i, (indent, name, steps, cr) in enumerate(merged)]


def resolve_file(repo: str, path: str) -> dict:
    if Path(path).name != "package.json":
        return {"path": path, "status": "not a package.json"}
    target = Path(repo) / path
    saved = target.read_bytes() if target.is_file() else None
    result = keep_both.keep_both(repo, path, chains)
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
    try:
        results = [resolve_file(args.repo, f) for f in args.files]
    except (ValueError, OSError) as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        return 2
    ok = all(r["status"] == "resolved" for r in results)
    print(json.dumps({"ok": ok, "files": results}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
