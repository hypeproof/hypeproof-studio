#!/usr/bin/env python3
"""Fail on former `jayleekr/<repo>` names of the repositories that moved (#363).

Seven repositories moved from `jayleekr/` to the `hypeproof` organization on
2026-10-10. GitHub redirects the former path, so a stale name keeps working and
nobody notices until a tool keyed by the organization name refuses it, or a PR
lands on the wrong owner. This check scans the tracked files of a checkout and
fails on each `<former owner>/<name>` it finds, for every name in MOVED_REPOS
(hypeprooflab, hypeproof-harness, hypeproof-studio, hypeproof-studio-releases,
sediment, sediment-cli-releases, homebrew-sediment). This file never spells a
former name out, so the copy vendored into a consumer needs no allowlist entry.

URLs match too (github.com/..., raw.githubusercontent.com/..., git@github.com:...),
as does a `.git` suffix. A longer name does not: `jayleekr/hypeproof-studio-foo`
and `jayleekr/hypeproof-agon` are other repositories, and `jayleekr0125` or
`jayleekr.github.io` are not `jayleekr/` paths at all. Matching ignores case,
like GitHub does.

A hit that is a genuine record (a dated decision, a changelog, a fixture pinning
bytes a server returned, a test proving the former name is refused) is kept by
either:

- an allowlist entry in the scanned checkout, `config/former-names-allowlist.txt`
  by default: one glob per line, then `#` and the reason. A line without a reason
  is a configuration error. `*` and `?` stay inside one path segment, `**`
  crosses segments, and `**/` also matches no directory at all.

      docs/decisions/**            # dated decision records quote names as they were
      **/CHANGELOG*                # release history

- an inline marker on the same line: `former-name-ok: <reason>`.

Files that are not text (a NUL byte in the first 8 KiB), symlinks, and tracked
paths missing from the working tree are skipped.

Vendored into consumers by hypeproof-harness scripts/sync.sh (SCRIPT_FILES), so it
uses the Python 3.9 standard library only.

Usage:
    check_former_names.py                  # scan the checkout around the cwd
    check_former_names.py --root PATH      # scan another checkout
    check_former_names.py --allowlist FILE # allowlist path, relative to --root

Exit code 0 = no former name outside the allowlist and markers.
Exit code 1 = at least one former name; each is listed as path:line.
Exit code 2 = could not evaluate (not a git checkout, malformed allowlist).
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from typing import Iterable, List, NamedTuple, Optional, Tuple

MOVED_REPOS = (
    "hypeprooflab",
    "hypeproof-harness",
    "hypeproof-studio",
    "hypeproof-studio-releases",
    "sediment",
    "sediment-cli-releases",
    "homebrew-sediment",
)
FORMER_OWNER = "jayleekr"
NEW_OWNER = "hypeproof"

# Longest names first, so `hypeproof-studio-releases` is not read as
# `hypeproof-studio` followed by more text. The edges exclude letters, digits,
# `_` and `-`: a name continuing with one of those is a different repository,
# while `.git`, `/issues`, `#12`, quotes and punctuation end the name.
_NAMES = "|".join(re.escape(n) for n in sorted(MOVED_REPOS, key=len, reverse=True))
PATTERN = re.compile(
    r"(?<![A-Za-z0-9_-])" + FORMER_OWNER + r"/(" + _NAMES + r")(?![A-Za-z0-9_-])",
    re.IGNORECASE,
)
MARKER = re.compile(r"former-name-ok:\s*\S")
DEFAULT_ALLOWLIST = "config/former-names-allowlist.txt"
BINARY_SNIFF = 8192


class ConfigError(Exception):
    pass


class Entry(NamedTuple):
    glob: str
    reason: str
    regex: "re.Pattern[str]"
    line: int


class Hit(NamedTuple):
    path: str
    line: int
    name: str


def glob_to_regex(glob: str) -> "re.Pattern[str]":
    """Translate an allowlist glob to an anchored regex over a `/`-separated path."""
    out = []
    i = 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


def parse_allowlist(text: str, source: str = DEFAULT_ALLOWLIST) -> List[Entry]:
    entries = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        glob, sep, reason = line.partition("#")
        glob, reason = glob.strip(), reason.strip()
        if not sep or not reason:
            raise ConfigError(f"{source}:{number}: '{glob}' has no reason; write '<glob>  # <why it is a record>'")
        if " " in glob or glob.startswith("/"):
            raise ConfigError(f"{source}:{number}: '{glob}' must be one relative path glob")
        entries.append(Entry(glob, reason, glob_to_regex(glob), number))
    return entries


def load_allowlist(root: str, rel: str) -> List[Entry]:
    path = os.path.join(root, rel)
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            return parse_allowlist(fh.read(), rel)
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError(f"cannot read {rel}: {exc}") from exc


def tracked_files(root: str) -> List[str]:
    try:
        out = subprocess.run(
            ["git", "-C", root, "-c", "core.quotePath=false", "ls-files", "-z"],
            capture_output=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", b"") or b""
        raise ConfigError(f"not a git checkout: {root} {detail.decode(errors='replace').strip()}") from exc
    return [p for p in out.decode("utf-8", errors="surrogateescape").split("\0") if p]


def scan_text(path: str, text: str) -> Iterable[Hit]:
    for number, line in enumerate(text.splitlines(), 1):
        if FORMER_OWNER not in line.lower():
            continue
        if MARKER.search(line):
            continue
        for match in PATTERN.finditer(line):
            yield Hit(path, number, match.group(0))


def read_text(full: str) -> Optional[str]:
    if os.path.islink(full) or not os.path.isfile(full):
        return None
    try:
        with open(full, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    if b"\0" in data[:BINARY_SNIFF]:
        return None
    return data.decode("utf-8", errors="replace")


def allowed_by(path: str, entries: List[Entry]) -> Optional[Entry]:
    for entry in entries:
        if entry.regex.match(path):
            return entry
    return None


def check(root: str, allowlist: str = DEFAULT_ALLOWLIST) -> Tuple[List[Hit], List[Hit], List[Entry]]:
    """Return (failing hits, allowlisted hits, allowlist entries that matched no hit)."""
    entries = load_allowlist(root, allowlist)
    failing, allowed, used = [], [], set()
    for path in tracked_files(root):
        text = read_text(os.path.join(root, path))
        if text is None:
            continue
        for hit in scan_text(path, text):
            entry = allowed_by(path, entries)
            if entry is None:
                failing.append(hit)
            else:
                allowed.append(hit)
                used.add(entry.line)
    unused = [e for e in entries if e.line not in used]
    return failing, allowed, unused


def repo_root(start: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", start, "rev-parse", "--show-toplevel"],
            capture_output=True, check=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ConfigError(f"not a git checkout: {start}") from exc


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--root", default=None, help="checkout to scan (default: the one around the cwd)")
    parser.add_argument("--allowlist", default=DEFAULT_ALLOWLIST,
                        help=f"allowlist path relative to --root (default: {DEFAULT_ALLOWLIST})")
    args = parser.parse_args(argv)

    try:
        root = args.root or repo_root(os.getcwd())
        failing, allowed, unused = check(root, args.allowlist)
    except ConfigError as exc:
        print(f"former-names: {exc}", file=sys.stderr)
        return 2

    for entry in unused:
        print(f"former-names: note: {args.allowlist}:{entry.line} '{entry.glob}' matches no hit; "
              "drop it if the record is gone", file=sys.stderr)
    if not failing:
        print(f"former-names: OK ({len(allowed)} allowlisted)")
        return 0
    for hit in failing:
        moved = hit.name.split("/", 1)[1].lower()
        print(f"{hit.path}:{hit.line}: {hit.name} -> {NEW_OWNER}/{moved}")
    print(
        f"\nformer-names: {len(failing)} former name(s) of repositories that moved to the "
        f"'{NEW_OWNER}' organization on 2026-10-10.\n"
        f"  fix: write {NEW_OWNER}/<repo>. GitHub redirects the former path, which hides the mistake.\n"
        f"  a genuine record (dated decision, changelog, pinned fixture) may keep it: add "
        f"'<glob>  # <reason>' to {args.allowlist}, or 'former-name-ok: <reason>' on the line.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
