#!/usr/bin/env bash
# One-line installer for HypeProof Studio on macOS.
#
# Requires GitHub CLI (gh) and a member login with release repository access.
# Bootstrap after gh auth login:
#   gh api repos/hypeproof/hypeproof-studio-releases/contents/install-mac.sh \
#     -H 'Accept: application/vnd.github.raw' > /tmp/hps-install.sh
#   bash /tmp/hps-install.sh
# Canonical source is scripts/install-mac.sh; publish the same file to the release repo.

set -euo pipefail

REPO="hypeproof/hypeproof-studio-releases"
APP_NAME="HypeProof Studio"
TAG="${HPS_VERSION:-latest}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf "\n\033[1;35m▶ %s\033[0m\n" "$*"; }
err() { printf "\033[1;31mERROR:\033[0m %s\n" "$*" >&2; exit 1; }

# 1. Arch check — HypeProof Studio ships an Apple Silicon (arm64) build only.
#    build-mac.yml is arm64-only, so no darwin-x64 asset is ever produced; an
#    x86_64 install would otherwise fail later at download with a confusing
#    "Could not find darwin-x64.zip" (hypeproof-studio#347-class silent gap).
#    Fail early with a clear message. Intel support is an open OS-scope decision
#    (hypeproof/hypeproof-studio#331) — turn this into a darwin-x64 suffix once a
#    matching asset is produced.
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  ASSET_SUFFIX="darwin-arm64.zip" ;;
  x86_64) err "Intel Mac(x86_64)는 현재 지원되지 않습니다 — HypeProof Studio는 Apple Silicon(arm64) 전용 빌드만 제공합니다. (Intel 지원 여부는 논의 중: hypeproof/hypeproof-studio#331)" ;;
  *) err "Unsupported architecture: $ARCH" ;;
esac

# 2. Resolve the private release through the member's GitHub CLI login.
command -v gh >/dev/null 2>&1 || err "GitHub CLI(gh)를 설치하고 gh auth login을 실행해 주세요."
if [[ -n "${HPS_RELEASE_TOKEN:-}" ]]; then export GH_TOKEN="$HPS_RELEASE_TOKEN"; fi
if [[ "$TAG" == "latest" ]]; then
  API="repos/$REPO/releases/latest"
else
  API="repos/$REPO/releases/tags/$TAG"
fi
say "Looking up release ($TAG)..."
RELEASE_TAG=$(gh api "$API" --jq '.tag_name') || err "릴리스 접근 실패: 조직 멤버 계정으로 gh auth login을 실행해 주세요."
ASSET=$(gh api "$API" --jq '.assets[] | select(.name | endswith("darwin-arm64.zip")) | [.name, .digest] | @tsv' | head -1)
IFS=$'\t' read -r ASSET_NAME DIGEST <<< "$ASSET"
[[ "$ASSET_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || err "Invalid release asset name"
[[ "$DIGEST" =~ ^sha256:[a-fA-F0-9]{64}$ ]] || err "Release SHA-256 digest is missing"

# 3. gh uses the authenticated API and safely follows the signed asset URL.
say "Downloading $ASSET_NAME"
gh release download "$RELEASE_TAG" --repo "$REPO" --pattern "$ASSET_NAME" --dir "$TMP"
ACTUAL=$(shasum -a 256 "$TMP/$ASSET_NAME" | awk '{print $1}')
[[ "$ACTUAL" == "${DIGEST#sha256:}" ]] || err "Release SHA-256 mismatch"
mv "$TMP/$ASSET_NAME" "$TMP/hps.zip"

# 4. Extract
say "Extracting..."
(cd "$TMP" && unzip -q hps.zip)

APP_PATH=$(find "$TMP" -maxdepth 3 -name "$APP_NAME.app" -type d | head -1)
[[ -n "$APP_PATH" ]] || err "$APP_NAME.app not found inside zip"

# 5. Install to /Applications
say "Installing to /Applications"
if [[ -d "/Applications/$APP_NAME.app" ]]; then
  rm -rf "/Applications/$APP_NAME.app"
fi
cp -R "$APP_PATH" "/Applications/"

# 6. Remove Gatekeeper quarantine (unsigned build)
say "Clearing quarantine attributes (unsigned build)"
xattr -dr com.apple.quarantine "/Applications/$APP_NAME.app" || true

# 7. Launch
say "Done. Launching..."
open "/Applications/$APP_NAME.app"

cat <<EOF

✅ $APP_NAME 설치 완료.

이 빌드는 아직 Apple 공증(notarization)을 받지 않았습니다. 이 명령은 터미널로 받아 설치해서
보통 경고 없이 열립니다. macOS가 앱을 막으면 보안 설정을 바꾸거나 우회하지 말고, 이 설치 명령을
한 번 더 실행하세요.

문제가 있으면: https://github.com/$REPO/issues
EOF
