#!/usr/bin/env python3
"""Fail when a tracked text file names a customer.

Customer names must not appear in this repository: Studio is meant to become
public, and cohort and profile IDs that name customers live only in the
private Service package. The denylist holds SHA-256 digests of lowercase
terms, never the terms, so this file does not reintroduce what it guards.

A term matches anywhere inside a word (Korean words carry particles), so
every substring of every word whose length equals a denylisted term's length
is hashed and compared. To add a term, append
`hashlib.sha256(term.lower().encode()).hexdigest()` and its length.

Usage: python3 scripts/check-customer-names.py [path ...]   (default: all tracked files)
"""
import hashlib
import re
import subprocess
import sys

# (length in characters, sha256 of the lowercase term)
DENYLIST = {
    (3, "8ff847bfa31e7b94cdcb0dc6e9c83836a761956f24e9763cb6a488ca80b01a4a"),
    (4, "7160f1a6e25a169f8d5d52d0339c58a743ba47aa361b06d9887a640f3a59e91c"),
    (4, "78c0e277cab95041a3964bb5e53bf1eb3d30b346b80bb58ca5dd9de2c0e4c886"),
    (4, "eb7195f83d36d8ffa6d3cecf0343c3b41ecd45ad973bb86d62caef40eb86dccd"),
    (6, "214b87fa31a098b6ba3002f3e706ef2221292b3fb6a88f802e40a6f97234b80b"),
    (7, "60d1b247f7b0352899b404cf90a5077c70b4b32ae0b9e64bab467b6e32b784aa"),
    (8, "c2bc1ef87c0b8df34da430f5566e01a6bcd7a463f7ac9f90c6e1905e0b1fa0a8"),
    (9, "6b3943532f3a99afd194231caf84fa8f20f4309440debceed3e4682d5742171c"),
}
WORD = re.compile(r"\w+", re.UNICODE)


def offending_terms(text, denylist):
    lengths = sorted({n for n, _ in denylist})
    digests = {d for _, d in denylist}
    found = set()
    for word in WORD.findall(text.lower()):
        for n in lengths:
            for i in range(len(word) - n + 1):
                digest = hashlib.sha256(word[i:i + n].encode()).hexdigest()
                if digest in digests:
                    found.add(digest[:12])
    return found


def main(argv, denylist=DENYLIST):
    paths = argv or subprocess.check_output(["git", "ls-files", "-z"], text=True).split("\0")
    failures = 0
    for path in filter(None, paths):
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
        except OSError:
            continue
        if b"\0" in raw[:4096]:
            continue
        hits = offending_terms(raw.decode("utf-8", "replace"), denylist)
        if hits:
            failures += 1
            print(f"{path}: names a customer (denylist entries {', '.join(sorted(hits))})")
    if failures:
        print(f"{failures} file(s) name a customer. Use a generic name; real IDs come from the Service registry (scripts/service-profile.mjs).")
        return 1
    print("No customer names in tracked text files.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
