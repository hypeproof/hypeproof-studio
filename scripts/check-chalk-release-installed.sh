#!/usr/bin/env bash
# Post-build check for the pinned Chalk extension (verify-branding.sh check 8c).
#
# ship=false: the app must not carry Chalk at all.
# ship=true : the installed folder must be byte-for-byte the verified vsix's extension/
#             folder, and its package.json version must equal the pinned version.
#
# Prints one line on failure and exits 1; exits 0 silently on success.
# Usage: bash scripts/check-chalk-release-installed.sh "<HypeProof Studio.app>"
set -euo pipefail

APP="${1:?usage: check-chalk-release-installed.sh <App.app>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$APP/Contents/Resources/app/extensions/hypeproof-chalk"

SHIP="$(node "$ROOT/scripts/fetch-chalk-release.mjs" --print-ship)"
if [[ "$SHIP" != "true" ]]; then
  if [[ -e "$TARGET" ]]; then
    echo "Chalk is installed in a build with ship=false: $TARGET" >&2
    exit 1
  fi
  exit 0
fi

[[ -d "$TARGET" ]] || { echo "pinned Chalk extension is not installed at $TARGET" >&2; exit 1; }
[[ -f "$TARGET/dist/extension.js" ]] || { echo "Chalk dist/extension.js missing" >&2; exit 1; }

VSIX="$(node "$ROOT/scripts/fetch-chalk-release.mjs" --print-vsix)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$VSIX" 'extension/*' -d "$TMP"
diff -rq "$TMP/extension" "$TARGET" >/dev/null || { echo "installed Chalk differs from the pinned vsix" >&2; exit 1; }

PINNED="$(node "$ROOT/scripts/fetch-chalk-release.mjs" --print-version)"
INSTALLED="$(node -p "require('$TARGET/package.json').version")"
[[ "$PINNED" == "$INSTALLED" ]] || { echo "Chalk version $INSTALLED != pinned $PINNED" >&2; exit 1; }
