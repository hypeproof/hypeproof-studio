#!/usr/bin/env bash
# Fast macOS release path: reuse a previously built base app and rebuild only
# the hypeproof-chat extension (extension dist + webview-ui dist + vendored SDK).
#
# A full build (vscodium-base/build.sh) takes 1–2 h. Most releases change only
# extensions/hypeproof-chat, so when the base inputs are unchanged
# (scripts/mac-base-key.sh) build-mac.yml calls this instead. It produces the
# same unsigned, stamped .app the full path has right before "Re-sign .app",
# and the workflow then runs the SAME sign → verify-branding → package →
# upload steps as the full path.
#
# Steps:
#   1. Copy the base app (an .app dir or the release .zip) to OUT_DIR, unless
#      it is already there (actions/cache restores in place).
#   2. Strip its code signature: a release asset is signed; the full path's base
#      is not. sign-mac.sh re-seals everything later.
#   3. Assert product.json checksums match (core files are untouched by design).
#   4. Build + vendor + install the extension with the SAME script the full
#      path uses (scripts/inject-builtin-extensions.sh), pointed at the app's
#      Resources/app instead of the vscode/ source tree.
#   5. Stamp watermark + version + commit (scripts/stamp-mac-app.sh, shared).
#   6. Assert the checksums again, and that the shipped extension matches the
#      freshly built source byte for byte.
#   7. Optional (REPACK_SIGN=1, local proof only): sign with sign-mac.sh.
#
# Usage:
#   bash scripts/repack-mac.sh --base <App.app | release.zip> [--out DIR]
# Env:
#   HPS_VERSION          release version (else resolve-version.sh)
#   BUILD_SOURCEVERSION  commit for product.json .commit (default: git HEAD)
#   REPACK_SIGN=1        also run scripts/sign-mac.sh (CODESIGN_IDENTITY, default ad-hoc)
#
# Notarization: the release pipeline has no notarization step today (see
# scripts/sign-mac.sh "THE REAL FIX"), so there is nothing to skip here. When
# one is added it belongs after signing in build-mac.yml, shared by both paths.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE=""
OUT_DIR="$REPO_ROOT/vscodium-base/VSCode-darwin-arm64"
APP_NAME_DIR="HypeProof Studio.app"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    *) echo "repack-mac: unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ -n "$BASE" ]] || { echo "usage: repack-mac.sh --base <App.app|zip> [--out DIR]" >&2; exit 2; }
[[ -e "$BASE" ]] || { echo "repack-mac: base not found: $BASE" >&2; exit 2; }

t0=$(date +%s)
step() { echo "[repack-mac +$(( $(date +%s) - t0 ))s] $*"; }

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
APP="$OUT_DIR/$APP_NAME_DIR"

# 1. Obtain the base app.
if [[ -d "$BASE" ]]; then
  BASE_ABS="$(cd "$BASE" && pwd)"
  if [[ "$BASE_ABS" != "$APP" ]]; then
    step "copying base app $BASE_ABS"
    rm -rf "$APP"
    ditto "$BASE_ABS" "$APP"
  else
    step "using base app in place: $APP"
  fi
else
  step "extracting base zip $BASE"
  rm -rf "$APP"
  ditto -xk "$BASE" "$OUT_DIR"
fi
[[ -f "$APP/Contents/Resources/app/product.json" ]] || { echo "::error::base has no $APP_NAME_DIR/Contents/Resources/app/product.json"; ls -la "$OUT_DIR"; exit 1; }
step "base: version=$(jq -r .version "$APP/Contents/Resources/app/product.json") commit=$(jq -r .commit "$APP/Contents/Resources/app/product.json")"

# 2. Strip the old signature (no-op on an unsigned cache base).
if codesign -d "$APP" >/dev/null 2>&1; then
  step "removing existing code signature"
  codesign --remove-signature "$APP"
fi
rm -rf "$APP/Contents/_CodeSignature"
# A quarantine flag from a download would follow the app into the release zip.
xattr -cr "$APP" 2>/dev/null || true

# 3. Core checksums before touching anything.
node "$REPO_ROOT/scripts/check-mac-checksums.mjs" "$APP"

# 4. Extension: build, vendor the SDK, install into the app (shared with the full path).
export BUILD_SOURCEVERSION="${BUILD_SOURCEVERSION:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
step "building + injecting hypeproof-chat"
VSCODE_TREE="$APP/Contents/Resources/app" bash "$REPO_ROOT/scripts/inject-builtin-extensions.sh"

# 5. Per-release stamp (shared with the full path).
step "stamping"
bash "$REPO_ROOT/scripts/stamp-mac-app.sh" "$APP"

# 6. Post-conditions.
node "$REPO_ROOT/scripts/check-mac-checksums.mjs" "$APP"
EXT_SRC="$REPO_ROOT/extensions/hypeproof-chat"
EXT_DST="$APP/Contents/Resources/app/extensions/hypeproof-chat"
diff -rq "$EXT_SRC/dist" "$EXT_DST/dist" >/dev/null || { echo "::error::shipped dist/ differs from the fresh build"; exit 1; }
diff -rq "$EXT_SRC/webview-ui/dist" "$EXT_DST/webview-ui/dist" >/dev/null || { echo "::error::shipped webview-ui/dist differs from the fresh build"; exit 1; }
cmp -s "$EXT_SRC/package.json" "$EXT_DST/package.json" || { echo "::error::shipped package.json differs from the stamped source"; exit 1; }
step "extension matches the fresh build (dist, webview-ui/dist, package.json)"

# 7. Optional local signing.
if [[ "${REPACK_SIGN:-0}" == "1" ]]; then
  step "signing (CODESIGN_IDENTITY=${CODESIGN_IDENTITY:--})"
  bash "$REPO_ROOT/scripts/sign-mac.sh" "$APP"
fi

step "done: $APP"
