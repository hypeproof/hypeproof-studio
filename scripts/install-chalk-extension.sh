#!/usr/bin/env bash
# Install the pinned Chalk extension into a built Studio .app (C-4, config/chalk-release.json).
#
# ship=false: remove any Chalk copy the app carries (a reused base app or a release zip
# may have one) and install nothing. No download, no token.
# ship=true: remove the old copy, then copy the verified vsix's extension/ folder in.
#
# Runs after the base is saved to cache and after repack or full path joins (build-mac.yml),
# so the cached base never contains Chalk.
#
# Usage: bash scripts/install-chalk-extension.sh "<HypeProof Studio.app>"
set -euo pipefail

APP="${1:?usage: install-chalk-extension.sh <App.app>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_RESOURCES="$APP/Contents/Resources/app"
TARGET="$APP_RESOURCES/extensions/hypeproof-chalk"

[[ -f "$APP_RESOURCES/product.json" ]] || { echo "install-chalk-extension: no product.json under $APP_RESOURCES" >&2; exit 1; }

rm -rf "$TARGET"

VSIX="$(node "$ROOT/scripts/fetch-chalk-release.mjs" --print-vsix)"
if [[ -z "$VSIX" ]]; then
  echo "chalk: ship=false; installed nothing (removed any previous copy)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$VSIX" 'extension/*' -d "$TMP"
[[ -f "$TMP/extension/package.json" ]] || { echo "install-chalk-extension: vsix has no extension/ folder" >&2; exit 1; }
mkdir -p "$(dirname "$TARGET")"
cp -R "$TMP/extension" "$TARGET"
echo "chalk: installed $TARGET from $(basename "$VSIX")"
