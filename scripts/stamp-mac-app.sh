#!/usr/bin/env bash
# Per-release finishing of the macOS .app, shared by the full build and the
# repack fast path (scripts/repack-mac.sh). Must run BEFORE scripts/sign-mac.sh:
# the seal has to cover the stamped files (#311, #361).
#
#   1. Editor watermark (scripts/install-shell-brand.mjs → out/media).
#   2. Info.plist CFBundleShortVersionString = product version (#361).
#   3. product.json .version = product version. VS Code's gulp derives it from
#      vscode/package.json during the build, which #361 stopped stamping (that
#      field feeds the runtime vscode.version API), so it must be re-stamped here
#      or the #206 updater gate trips.
#   4. product.json .commit = $BUILD_SOURCEVERSION when set. The full build
#      already writes the same value (build-contract.mjs exports it), so this is
#      a no-op there; for a repack it replaces the previous release's commit.
#   5. product.json has no .releaseNotesUrl (#3212). The upstream value
#      (go.microsoft.com → code.visualstudio.com/updates) made Studio open VS Code's
#      release notes after every update. Removed here because this step runs on both
#      the full build and the repack, so the next release ships it without a base rebuild.
#
# Deliberately NOT changed:
#   - CFBundleVersion: the VSCodium build number of the base (e.g. 1.116.06953).
#     The full build never sets it either; it moves only with the base.
#   - product.json .date: the upstream VS Code commit date (build/lib/date.ts),
#     constant for a given base in the full build too.
#   - product.json .checksums: cover core files under out/vs only; nothing here
#     touches them (scripts/check-mac-checksums.mjs verifies).
#
# Idempotent. Usage: bash scripts/stamp-mac-app.sh [path/to/App.app]
#   HPS_VERSION          release version (else scripts/resolve-version.sh)
#   BUILD_SOURCEVERSION  source commit to stamp into product.json .commit
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-}"
if [[ -z "$APP" ]]; then
  OUT_DIR="$REPO_ROOT/vscodium-base/VSCode-darwin-arm64"
  name="$(cd "$OUT_DIR" 2>/dev/null && ls -d ./*.app 2>/dev/null | head -1 || true)"
  [[ -n "$name" ]] || { echo "::error::no .app in $OUT_DIR"; exit 1; }
  APP="$OUT_DIR/${name#./}"
fi
[[ -d "$APP" ]] || { echo "::error::not a bundle: $APP"; exit 1; }

node "$REPO_ROOT/scripts/install-shell-brand.mjs" "$APP/Contents/Resources/app/out/media"

PLIST="$APP/Contents/Info.plist"
PJSON="$APP/Contents/Resources/app/product.json"
[[ -f "$PLIST" ]] || { echo "::error::Info.plist not found at $PLIST"; exit 1; }
[[ -f "$PJSON" ]] || { echo "::error::product.json not found at $PJSON"; exit 1; }

HPS_VER="${HPS_VERSION:-$(bash "$REPO_ROOT/scripts/resolve-version.sh")}"
HPS_VER="${HPS_VER#v}"
[[ -n "$HPS_VER" ]] || { echo "::error::empty release version"; exit 1; }

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $HPS_VER" "$PLIST" \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $HPS_VER" "$PLIST"
echo "Stamped CFBundleShortVersionString → $HPS_VER (pre-sign)"

tmp="$(mktemp)"
if [[ -n "${BUILD_SOURCEVERSION:-}" ]]; then
  [[ "$BUILD_SOURCEVERSION" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::BUILD_SOURCEVERSION is not a full commit sha: $BUILD_SOURCEVERSION"; exit 1; }
  jq --arg v "$HPS_VER" --arg c "$BUILD_SOURCEVERSION" '.version = $v | .commit = $c | del(.releaseNotesUrl)' "$PJSON" > "$tmp"
  echo "Stamped product.json.version → $HPS_VER, .commit → $BUILD_SOURCEVERSION (pre-sign)"
else
  jq --arg v "$HPS_VER" '.version = $v | del(.releaseNotesUrl)' "$PJSON" > "$tmp"
  echo "Stamped product.json.version → $HPS_VER (pre-sign; .commit left as built)"
fi
# Keep the file mode the build gave it (mktemp creates 0600).
chmod 644 "$tmp"
mv "$tmp" "$PJSON"

# CGP-SHELL-R-006: shared by full builds and repacks, before signing.
node "$REPO_ROOT/scripts/patches/core/korean/install.mjs" "$APP/Contents/Resources/app"
