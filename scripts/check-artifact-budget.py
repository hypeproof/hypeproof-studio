#!/usr/bin/env python3
"""Bound PR evidence upload without deleting or truncating evidence.
Missing outputs retain upload-artifact's missing-file policy. Run immediately
before upload after all producers finish. Hidden files count conservatively.
"""
import argparse
import os
from pathlib import Path
import stat
MAX_BYTES = 128 * 1024 * 1024
MAX_FILES = 10000

def check(paths, max_bytes=MAX_BYTES, max_files=MAX_FILES):
    total, count = 0, 0
    seen = set()
    pending = [Path(p) for p in paths]
    while pending:
        path = pending.pop()
        if any(parent.is_symlink() for parent in (path, *path.parents)):
            raise ValueError(f'symlink evidence path: {path}')
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        key = os.path.abspath(path)
        if key in seen:
            continue
        seen.add(key)
        if stat.S_ISDIR(info.st_mode):
            pending.extend(path.iterdir())
        elif stat.S_ISREG(info.st_mode):
            count += 1
            # Raw payload plus generous per-entry archive/name overhead.
            total += info.st_size + 1024 + 2 * len(os.fsencode(key))
            if count > max_files or total > max_bytes:
                raise ValueError(f'evidence exceeds upload budget: {count} files, {total} bytes; investigate without truncating evidence')
        else:
            raise ValueError(f'non-regular evidence: {path}')
    return count, total

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+')
    args = parser.parse_args()
    try:
        count, total = check(args.paths)
        print(f'Evidence budget OK: {count} files, {total} accounted bytes / {MAX_BYTES}')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Evidence upload blocked: {error}\n')
