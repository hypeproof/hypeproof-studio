#!/usr/bin/env python3
"""Learner-facing installer prompts and step headers must be Korean (PRA-13, I9).

A learner answers the installer's questions and follows its step headers. The
rest of the install was already Korean, so an English question in the middle
(the Homebrew consent, the WSL "[y/N]") stopped people halfway. This check reads
both installers and fails when a learner-facing literal carries no Hangul:

  install.sh   confirm "<q>", step "<header>", the confirm() answer hint, and
               any ok/warn/die literal that reports the doctor verdict
  install.ps1  Confirm-Or '<q>', Read-Host '<q>', Write-Head '<header>', the
               Confirm-Or answer hints, and every Write-Host '==> ...' verdict

Tool names (Homebrew, WSL, Ubuntu) may stay inside a Korean sentence. Package
manager output and debug/log lines are not checked. A literal that is only a
format placeholder ("{0} {1}") carries no copy of its own and is skipped; its
parts are checked where they are written.

Usage: check-installer-korean.py [install.sh] [install.ps1]
"""
import pathlib
import re
import sys

HANGUL = re.compile(r"[가-힣]")

# A quoted literal: "..." (sh/ps1, backslash or backtick escapes) or '...' (no escapes in
# sh; '' doubles a quote in ps1).
_DQ = r'"((?:[^"\\`]|\\.|`.)*)"'
_SQ = r"'((?:[^']|'')*)'"
_LIT = rf"(?:{_DQ}|{_SQ})"

SH_CALLS = re.compile(rf"(?<![\w-])(confirm|step)\s+{_LIT}")
SH_VERDICT = re.compile(rf"(?<![\w-])(ok|warn|die)\s+{_LIT}")
PS_CALLS = re.compile(rf"(?<![\w-])(Confirm-Or|Read-Host|Write-Head)\s+\(?\s*{_LIT}")
PS_VERDICT = re.compile(rf"(?<![\w-])(Write-Host)\s+\(?\s*{_LIT}")


def has_hangul(text):
    return bool(HANGUL.search(text))


def _placeholder_only(text):
    """True when nothing but format placeholders and punctuation is left: no copy."""
    return not re.search(r"[^\W\d_]", re.sub(r"\{\d+\}|%s", "", text))


def _function_body(text, opener):
    """Lines of the function whose definition line starts with `opener`."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.lstrip().startswith(opener):
            body = []
            for nxt in lines[i:]:
                body.append(nxt)
                if nxt.startswith("}"):
                    break
            return "\n".join(body)
    return None


def sh_targets(text):
    """(line number, kind, literal) for every learner-facing literal in install.sh."""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        # Comments and function definition lines ("confirm() {  # confirm \"q\"") are not output.
        if line.lstrip().startswith("#") or re.match(r"\s*[\w-]+\(\)\s*\{", line):
            continue
        for m in SH_CALLS.finditer(line):
            out.append((n, m.group(1), m.group(2) if m.group(2) is not None else m.group(3)))
        for m in SH_VERDICT.finditer(line):
            lit = m.group(2) if m.group(2) is not None else m.group(3)
            if "doctor" in lit:
                out.append((n, m.group(1) + " (doctor verdict)", lit))
    body = _function_body(text, "confirm()")
    if body is not None:
        hints = re.findall(r"printf\s+" + _SQ, body)
        out.append((0, "confirm() answer hint", hints[0] if hints else ""))
    return out


def ps_targets(text):
    """(line number, kind, literal) for every learner-facing literal in install.ps1."""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("#") or re.match(r"\s*function\s", line):
            continue
        for m in PS_CALLS.finditer(line):
            lit = m.group(2) if m.group(2) is not None else m.group(3)
            if not _placeholder_only(lit):
                out.append((n, m.group(1), lit))
        for m in PS_VERDICT.finditer(line):
            lit = m.group(2) if m.group(2) is not None else m.group(3)
            if lit.lstrip().startswith("==>") and not _placeholder_only(lit):
                out.append((n, "Write-Host (verdict)", lit))
    body = _function_body(text, "function Confirm-Or")
    if body is not None:
        m = re.search(r"\$suffix\s*=\s*if\s*\([^)]*\)\s*\{\s*" + _SQ + r"\s*\}\s*else\s*\{\s*" + _SQ, body)
        out.append((0, "Confirm-Or answer hint (default yes)", m.group(1) if m else ""))
        out.append((0, "Confirm-Or answer hint (default no)", m.group(2) if m else ""))
    return out


def offending(targets):
    return [t for t in targets if not has_hangul(t[2])]


def main(argv):
    root = pathlib.Path(__file__).resolve().parent
    sh = pathlib.Path(argv[1]) if len(argv) > 1 else root / "install.sh"
    ps = pathlib.Path(argv[2]) if len(argv) > 2 else root / "install.ps1"
    bad = []
    for path, fn in ((sh, sh_targets), (ps, ps_targets)):
        targets = fn(path.read_text(encoding="utf-8-sig"))
        bad += [(path.name, *t) for t in offending(targets)]
        print(f"{path.name}: {len(targets)} learner-facing literal(s) checked")
    for name, n, kind, lit in bad:
        print(f"  {name}:{n}: {kind} has no Korean: {lit!r}")
    if bad:
        print("installer copy: learner-facing prompts/headers must be Korean (PRA-13)")
        return 1
    print("installer copy: every learner-facing prompt and header is Korean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
