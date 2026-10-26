#!/usr/bin/env python3
"""resolve_additive.py - resolve design-token and ordered-list conflicts from parallel rows (hypeproof-harness#398).

    resolve_additive.py [--repo DIR] FILE...

The Harness copy of ~/.hypeproof/loop/bin/resolve-additive.py, on keep_both.py's machinery
(diff3 rewrite, refuse a file git would not write again, stage nothing). A hunk is resolved
only when it has one of these shapes; every other hunk stays for a person:

  CSS (.css)          custom-property declarations (`--name: value;`) merge by property name
                      three ways, as resolve_reqdocs.py merges table rows by ID. Two insertions
                      at one place keep both, but a property both sides declare with different
                      values stays: keep_both.py would keep both, and the later one would win.
  JS (.mjs .js .ts)   one `const NAME = [...]` line of strings on every side (the type-scale
                      ORDER list) merges like a script chain: an entry either side added is kept
                      after its predecessor, and an entry either side removed stays removed.

The live script ignored the base, so it could not tell an edited token from a new one and put
a removed list entry back. Check with resolve_check.py, then `git add`. Prints one JSON object;
exit 0 when every hunk of every file was resolved, 1 when a hunk or a file was left, 2 on a
usage error.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import keep_both  # noqa: E402
from resolve_chains import merge_steps  # noqa: E402
from resolve_reqdocs import merge_by_key  # noqa: E402

DECL = re.compile(r"^\s*(--[\w-]+)\s*:")
LIST = re.compile(r"^(\s*(?:export\s+)?(?:const|let)\s+[\w$]+\s*=\s*)(\[.*\])(;?\s*?)(\r?)$")
JS_SUFFIXES = (".mjs", ".js", ".cjs", ".ts", ".tsx")


def prop(line: str) -> str | None:
    match = DECL.match(line)
    return match[1] if match else None


def css_props(ours: list[str], base: list[str], theirs: list[str], before: list[str]) -> list[str] | None:
    if base:
        return merge_by_key(ours, base, theirs, prop)
    declared = [[(prop(line), line) for line in side if line.strip()] for side in (ours, theirs)]
    mine, yours = (dict(pairs) for pairs in declared)
    if None in mine or None in yours or len(mine) + len(yours) != sum(map(len, declared)):
        return None  # not only declarations, or one property twice on a side
    if any(mine[name] != yours[name] for name in mine.keys() & yours.keys()):
        return None  # both sides declare it, with different values
    return ours + [line for line in theirs if not line.strip() or prop(line) not in mine]


def ordered_list(ours: list[str], base: list[str], theirs: list[str], before: list[str]) -> list[str] | None:
    sides = [LIST.match(side[0]) if len(side) == 1 else None for side in (ours, base, theirs)]
    if None in sides or len({m[1] for m in sides}) != 1:
        return None  # one declaration of the same name on every side
    try:
        lists = [json.loads(m[2]) for m in sides]
    except ValueError:
        return None
    if not all(isinstance(items, list) and all(isinstance(x, str) for x in items) for items in lists):
        return None
    merged = merge_steps(lists[1], lists[0], lists[2])
    head, _, end, cr = sides[0].groups()
    return None if merged is None else [head + json.dumps(merged, ensure_ascii=False) + end + cr]


def resolve_file(repo: str, path: str) -> dict:
    if path.endswith(".css"):
        return keep_both.keep_both(repo, path, css_props)
    if path.endswith(JS_SUFFIXES):
        return keep_both.keep_both(repo, path, ordered_list)
    return {"path": path, "status": "not a CSS or JS file"}


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
