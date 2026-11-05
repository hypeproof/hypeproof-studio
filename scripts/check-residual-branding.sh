#!/usr/bin/env bash
# Residual "codium"/"VSCodium" scan (REQ-J4), the one rule both gates run:
#   - scripts/verify-branding.sh check 5, on the built .app's Contents/Resources (build-mac)
#   - studio-pr-ci "extension / shipped branding", on the files the bundled hypeproof-chat
#     extension ships (dist/, webview-ui/dist/, media/, package.json) — so a PR that puts
#     "codium" into a shipped file fails on the PR, not on the next release tag (#3553:
#     #3484's `vscodium-base` method comment survived esbuild and broke v2026.1105.0-rc.2).
#
# Usage:
#   bash scripts/check-residual-branding.sh [--exclude-file PATH]... ROOT...
# ROOT is a directory (scanned recursively) or a file. --exclude-file drops one exact path.
# Exit: 0 clean (warnings allowed), 1 residual branding found, 2 usage error.
#
# Excluded paths hold internal strings that legitimately contain "codium" and
# cannot/need not be rebranded (#355; all present in shipped v0.1.16 too):
#   - node_modules/        third-party internals: axios minified JS has a
#                          coincidental match; @vscode/fs-copyfile is a native
#                          binary with embedded strings
#   - dist/vendor/         vendored Agent SDK JS (editor-detection strings)
#   - policies/            upstream-generated MDM policy templates
#   - license/notice/attribution/third-party/credits files (legal attribution)
#   - Resources/app/package.json (upstream `author: "VSCodium"`; passed by the
#     caller with --exclude-file). Rebranding of the last two is tracked in #355.

set -uo pipefail

EXCLUDES=()
ROOTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --exclude-file)
      [[ $# -ge 2 ]] || { echo "check-residual-branding: --exclude-file needs a path" >&2; exit 2; }
      EXCLUDES+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) ROOTS+=("$1"); shift ;;
  esac
done
[[ ${#ROOTS[@]} -gt 0 ]] || { echo "check-residual-branding: no ROOT given" >&2; exit 2; }
for r in "${ROOTS[@]}"; do
  [[ -e "$r" ]] || { echo "check-residual-branding: $r does not exist" >&2; exit 2; }
done

# -I skips binaries (tunnel executable, .node addons — embedded linker strings).
CANDIDATES=$(grep -rIli "codium" "${ROOTS[@]}" 2>/dev/null \
  | grep -viE "license|notice|attribution|third.?party|credits" \
  | grep -vE "/node_modules/|/dist/vendor/|/policies/" || true)
for x in "${EXCLUDES[@]+"${EXCLUDES[@]}"}"; do
  CANDIDATES=$(printf '%s\n' "$CANDIDATES" | grep -vxF "$x" || true)
done

# Context-level triage (token/context-wise, not line-wise — minified bundles
# are single-line). Benign, never-rendered categories (#355):
#   - `github.com/VSCodium/sourcemaps/…` sourceMappingURL comments
#   - `@vscodium/…` npm package ids embedded in bundles
#   - `"author":{"name":"VSCodium"}` package.json metadata inlined by esbuild
#   - `i("VSCodium",this.productName…` policy-watcher registration key
# Known REAL leak, warn-not-fail: the extension-install reload toast says
# "Please reload VSCodium…" (upstream hardcode; needs a fork patch — tracked
# in #356, ships in v0.1.16 already, non-blocking for worker/extension work).
# Anything else is a NEW leak → hard fail.
KNOWN_TOAST="reload VSCodium to enable"
HITS=""
KNOWN_HITS=""
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  CTX=$(grep -oi ".\{0,50\}codium.\{0,50\}" "$f" 2>/dev/null \
    | grep -vi "sourcemaps" \
    | grep -vi "@vscodium/" \
    | grep -viF '"author":{"name":"VSCodium"}' \
    | grep -viF 'VSCodium",this.productName' || true)
  [[ -z "$CTX" ]] && continue
  if printf '%s' "$CTX" | grep -qviF "$KNOWN_TOAST"; then
    HITS+="$f"$'\n'
    # Show the offending context so the fix needs no second run.
    printf '%s\n' "$CTX" | grep -viF "$KNOWN_TOAST" | head -3 | sed "s|^|      $f: …|; s|$|…|"
  else
    KNOWN_HITS+="$f"$'\n'
  fi
done <<< "$CANDIDATES"

if [[ -n "$KNOWN_HITS" ]]; then
  echo "  ! Known reload-toast leak ('Please ${KNOWN_TOAST}…', #356) in:"
  printf '%s' "$KNOWN_HITS" | sed 's/^/      /'
fi
if [[ -n "$HITS" ]]; then
  echo "  Residual 'codium' found in:"
  printf '%s' "$HITS" | sed 's/^/      /'
  exit 1
fi
exit 0
