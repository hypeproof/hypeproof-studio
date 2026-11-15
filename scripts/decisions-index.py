#!/usr/bin/env python3
"""Generate the index of docs/research/chatgpt-desktop-2026-10/decisions/ (README.md).

One file per requirement row or decision id (`CGP-SHELL-R-030.md`, `DEC-12.md`); entries without an id use a slug
of their heading. The index is one line per file, sorted case-insensitively, so two PRs that add different files
touch different lines.

  python3 scripts/decisions-index.py           # rewrite README.md
  python3 scripts/decisions-index.py --check   # exit 1 when README.md is out of date
  python3 scripts/decisions-index.py --rebuild OUT [--rev REV]
      # rebuild the former decisions.md from order.json (files at REV via git, else the working tree)
"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = ROOT / 'docs/research/chatgpt-desktop-2026-10/decisions'
HEADER = """# Decisions taken by the parity loop: index

One file per requirement row or decision id. Add a decision to the file of its row (`CGP-SHELL-R-030.md`) or
its DEC (`DEC-12.md`), creating it if needed, then run `python3 scripts/decisions-index.py`. Do not edit the
list below by hand. `_intro.md` is the original preamble; `order.json` records where every piece came from in
the former single `decisions.md` (split 2026-11-15) and states the rebuild rule: the pieces' byte ranges in
order, with `table_header` written once right after the intro piece. `--rebuild OUT --rev <split commit>`
reproduces the former file byte for byte.

"""


def label(path: pathlib.Path) -> str:
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('#'):
            return line.lstrip('#').strip()
        if line.startswith('| ') and not line.startswith('| DEC | Choice'):
            return line.split('|')[1].strip()
    return path.stem


def render() -> str:
    files = sorted((p for p in DIR.glob('*.md') if p.name != 'README.md'), key=lambda p: p.name.lower())
    lines = []
    for p in files:
        text = re.sub(r'\s+', ' ', label(p)).replace('|', '\\|')
        lines.append(f'- [{p.stem}]({p.name}): {text}')
    return HEADER + '\n'.join(lines) + '\n'


def rebuild(rev) -> bytes:
    """order.json's rule: each piece's byte range in order; table_header once, right after the intro piece."""
    rel = DIR.relative_to(ROOT).as_posix()
    def read(name: str) -> bytes:
        if rev:
            return subprocess.check_output(['git', 'show', f'{rev}:{rel}/{name}'], cwd=ROOT)
        return (DIR / name).read_bytes()
    order = json.loads(read('order.json'))
    head = order['table_header'].encode('utf-8')
    out, cache, head_written = b'', {}, False
    for p in order['pieces']:
        data = cache.setdefault(p['file'], read(p['file']))
        out += data[p['start']:p['start'] + p['length']]
        if p['kind'] == 'intro' and not head_written:
            out += head
            head_written = True
    return out


def main() -> int:
    if '--rebuild' in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index('--rebuild') + 1])
        rev = sys.argv[sys.argv.index('--rev') + 1] if '--rev' in sys.argv else None
        out.write_bytes(rebuild(rev))
        return 0
    readme = DIR / 'README.md'
    want = render()
    if '--check' in sys.argv:
        if not readme.exists() or readme.read_text(encoding='utf-8') != want:
            print('decisions index is out of date: run python3 scripts/decisions-index.py', file=sys.stderr)
            return 1
        return 0
    readme.write_text(want, encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
