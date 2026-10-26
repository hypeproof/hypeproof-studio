#!/usr/bin/env python3
"""resolve_generated.py - regenerate committed generated files during a conflict (hypeproof-harness#401).

    resolve_generated.py [--repo PATH] [--map FILE=COMMAND ...] [--sources FILE=SRC[,SRC] ...]

Studio commits chalk/src/lib/design-tokens.ts, a transport generated from four CSS
files. Two agent PRs that each touch a token conflict on it, and resolving the
generated text by hand (or keep-both) can only go wrong: the right answer is to
regenerate it from the merged CSS. Run this after resolving the other files of a
rebase, merge or cherry-pick step and before resolve_check.py continue:

  * a registered file that is unmerged or staged in the step is regenerated with
    its command from the repository root and staged;
  * if one of its sources is still unmerged, nothing is written for it and it is
    listed under "waiting" (exit 1): resolve those first.

--map adds or replaces a registry entry and --sources names its source files. Prints
one JSON object. Exit 0 done or nothing to do, 1 waiting, 2 error or a failed generator.
"""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path

REGISTRY = {
    "chalk/src/lib/design-tokens.ts": {
        "run": ["node", "scripts/sync-design-tokens.mjs"],
        "sources": ["extensions/hypeproof-chat/webview-ui/src/designTokens.css",
                    "extensions/hypeproof-chat/webview-ui/src/focusGeometry.css",
                    "extensions/hypeproof-chat/webview-ui/src/koreanProse.css",
                    "chalk/src/lib/typography.css"],
    },
}


def git(top: Path, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(top), *args], capture_output=True, text=True)
    if out.returncode != 0:
        raise ValueError(f"git {args[0]}: {out.stderr.strip()}")
    return out.stdout


def resolve(top: Path, registry: dict) -> dict:
    unmerged = {line.split("\t", 1)[1] for line in git(top, "ls-files", "-u").splitlines() if "\t" in line}
    staged = set(git(top, "diff", "--cached", "--name-only").split())
    out = {"regenerated": [], "waiting": [], "failed": []}
    for path, entry in registry.items():
        if path not in unmerged and path not in staged:
            continue
        blocking = sorted(set(entry.get("sources", [])) & unmerged)
        if blocking:
            out["waiting"].append({"file": path, "resolve_first": blocking})
            continue
        if path in unmerged:
            git(top, "checkout", "--ours", "--", path)  # any side: the generator overwrites it
        try:
            done = subprocess.run(entry["run"], cwd=top, capture_output=True, text=True)
        except OSError as exc:  # the generator cannot start: failed (2), never waiting (1)
            out["failed"].append({"file": path, "detail": f"cannot start {entry['run'][0]}: {exc.strerror or exc}"})
            continue
        if done.returncode != 0:
            out["failed"].append({"file": path, "detail": (done.stderr or done.stdout).strip()[-300:]})
            continue
        git(top, "add", "--", path)
        out["regenerated"].append(path)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--repo", default=".")
    p.add_argument("--map", action="append", default=[], metavar="FILE=COMMAND")
    p.add_argument("--sources", action="append", default=[], metavar="FILE=SRC[,SRC]")
    args = p.parse_args(argv)
    registry = dict(REGISTRY)
    for item in args.map:
        path, _, command = item.partition("=")
        if not path or not command:
            print(json.dumps({"status": "error", "error": f"--map needs FILE=COMMAND, got {item!r}"}))
            return 2
        registry[path] = {"run": shlex.split(command)}
    for item in args.sources:
        path, _, sources = item.partition("=")
        if path in registry:
            registry[path] = {**registry[path], "sources": [s for s in sources.split(",") if s]}
    try:
        top = Path(git(Path(args.repo), "rev-parse", "--show-toplevel").strip())
        result = resolve(top, registry)
    except ValueError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 2 if result["failed"] else 1 if result["waiting"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
