#!/usr/bin/env bash
# seed-sdk-binary.sh — instructor pre-seed of the Claude Agent SDK native
# `claude` binary for venue machines (#282 W4a, docs/sdk-bundling.md §5).
#
# Downloads the platform tarball DIRECTLY from the npm registry (no npm/node
# required on the target machine), verifies its sha512 against the pinned
# manifest, extracts the `claude` binary to the per-user seeded location the
# Studio extension resolves (sdkCoachHelpers.seededSdkBinaryPath), marks it
# executable, and writes the `.verified.json` integrity marker the runtime
# trusts (full sha512 runs ONCE here; the extension checks marker + size).
#
# Seeded locations (must stay in lockstep with seededSdkBinaryPath):
#   darwin — ~/Library/Application Support/HypeProof-Studio/sdk/<version>/claude
#   linux  — ${XDG_CONFIG_HOME:-~/.config}/HypeProof-Studio/sdk/<version>/claude
#   win32  — %APPDATA%\HypeProof-Studio\sdk\<version>\claude.exe
#            (handled by the PowerShell companion scripts/seed-sdk-binary.ps1,
#            which mirrors this script for win32-x64 / win32-arm64. #426)
#
# Usage:
#   bash scripts/seed-sdk-binary.sh                    # networked venue machine
#   bash scripts/seed-sdk-binary.sh --tarball /Volumes/USB/claude-agent-sdk-darwin-arm64-0.3.299.tgz
#   bash scripts/seed-sdk-binary.sh --force            # re-seed over an existing install
#   bash scripts/seed-sdk-binary.sh --version 0.3.299  # explicit version (non-pinned → registry integrity)
#   bash scripts/seed-sdk-binary.sh --platform win32-x64 --download-only DIR
#       release mode: verify the tarball and stage it in DIR as
#       claude-agent-sdk-<platform>-<version>.tgz plus a `.sha256` file
#       (sha256sum format) without installing anything. Any platform works
#       here, win32 included. The release workflow publishes these as the
#       public native seed (verify-unified-release.yml).
#
# HPS_NPM_REGISTRY overrides the registry base URL (default
# https://registry.npmjs.org); tests point it at a local fixture server. A
# pinned version is still checked against the pinned sha512 table.
#
# Idempotent: an already-seeded binary with a valid marker exits 0 untouched.
# Written to be zsh-compatible (no bash-only idioms beyond the bash shebang).

set -euo pipefail

# ── Pinned manifest ──────────────────────────────────────────────────────────
# Single source of truth is extensions/hypeproof-chat/src/sdkBinaryManifest.ts
# (itself locked to package-lock.json). test/sdk-binary.smoke.mjs fails if the
# values below drift from that manifest — bump both together with the SDK dep.
PINNED_VERSION="0.3.299"

pinned_sha512() {
  case "$1" in
    darwin-arm64) printf '%s' "sha512-KfkR3Ve7Eku1QuxT3LhC5e9Oj7c8UXvLJFFLbCw0u3OrhpzJUQ0ldd9ArmYNU3J47gpaqYgafnk9ztVPLdcajA==" ;;
    darwin-x64)   printf '%s' "sha512-7G6qjn+xNCmyewcQ/XG/ElBoEGr8uDD4D8X33bqXEbNZ4vXbssiOzmcyxfuWLa7YqR8g9cJnmaWB6UzFEwiC6Q==" ;;
    win32-x64)    printf '%s' "sha512-PWHbjAdrecVlmR0kdgsX20QvUiFgWQl4zskuWd6Ieg3e5w+Ol0FZGXYRLS+Erd+pYUEZBNjDCqK2yd2KdBbDQw==" ;;
    win32-arm64)  printf '%s' "sha512-sKvddLLYlXzk0FwjT9gNZDzmdzupI7qI0Dok7uu/KYGFgMGiSEGIsB9bfg+31HMDDftaT16P80MLzH+F8zQBFA==" ;;
    linux-x64)    printf '%s' "sha512-Q+sweKF/ruNq4Gmf4CzglwaKJmtQjhBK5MT3U1oUhlNStwHejgBg1GLa/KrQMRE0R4u0ayapLyVNrfu0hQYGkQ==" ;;
    linux-arm64)  printf '%s' "sha512-8b5apRvHageZ/9xDfoIu8tJ6lpPAGjg4tD9JYef4SjpsY4KM/gvR6qC+Kqq5JHiH/Tq/mjgGYZjMkTZS8TOnsQ==" ;;
    *)            printf '%s' "" ;;
  esac
}

say() { printf "\n\033[1;35m▶ %s\033[0m\n" "$*"; }
err() { printf "\033[1;31mERROR:\033[0m %s\n" "$*" >&2; exit 1; }

# ── Args ─────────────────────────────────────────────────────────────────────
VERSION=""
TARBALL=""
PLATFORM=""
FORCE="no"
DOWNLOAD_ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version)  VERSION="${2:?--version needs a value}"; shift 2 ;;
    --tarball)  TARBALL="${2:?--tarball needs a path}"; shift 2 ;;
    --platform) PLATFORM="${2:?--platform needs a value (e.g. darwin-arm64)}"; shift 2 ;;
    --force)    FORCE="yes"; shift ;;
    --download-only) DOWNLOAD_ONLY="${2:?--download-only needs a directory}"; shift 2 ;;
    -h|--help)  sed -n '2,40p' "$0"; exit 0 ;;
    *) err "Unknown argument: $1 (see --help)" ;;
  esac
done

# ── Platform detection (darwin-arm64 is the first-class target) ─────────────
if [ -z "$PLATFORM" ]; then
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)          PLATFORM="darwin-arm64" ;;
    Darwin-x86_64)         PLATFORM="darwin-x64" ;;
    Linux-x86_64)          PLATFORM="linux-x64" ;;
    Linux-aarch64|Linux-arm64) PLATFORM="linux-arm64" ;;
    *) err "Unsupported platform $(uname -s)/$(uname -m) — pass --platform explicitly" ;;
  esac
fi
case "$PLATFORM" in
  darwin-*|linux-*|win32-*) ;;
  *) err "Unsupported --platform $PLATFORM (expected darwin-*, linux-* or win32-*)" ;;
esac
if [ -z "$DOWNLOAD_ONLY" ]; then case "$PLATFORM" in
  win32-*) err "win32 seeding lives in the PowerShell companion — run scripts/seed-sdk-binary.ps1 (#426)" ;;
esac; fi

# ── Version resolution: pinned by default, cross-checked against the repo ───
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCKFILE="$SCRIPT_DIR/../extensions/hypeproof-chat/package-lock.json"
if [ -z "$VERSION" ]; then
  VERSION="$PINNED_VERSION"
  # Drift guard when run from the repo: the extension lockfile is the ultimate
  # pin for the SDK dependency (package.json pins the exact version; the
  # lockfile records the resolved tarball). Fails loudly instead of seeding a
  # mismatched binary.
  if [ -f "$LOCKFILE" ]; then
    LOCK_VERSION="$(sed -n 's|.*claude-agent-sdk/-/claude-agent-sdk-\([0-9][0-9.]*\)\.tgz.*|\1|p' "$LOCKFILE" | head -n1)"
    if [ -n "$LOCK_VERSION" ] && [ "$LOCK_VERSION" != "$VERSION" ]; then
      err "Pinned version $VERSION disagrees with extension package-lock.json ($LOCK_VERSION). Update PINNED_VERSION + sha512 table (and sdkBinaryManifest.ts) together with the dependency."
    fi
  fi
fi

# ── Expected integrity ───────────────────────────────────────────────────────
PKG="@anthropic-ai/claude-agent-sdk-$PLATFORM"
REGISTRY="${HPS_NPM_REGISTRY:-https://registry.npmjs.org}"
REGISTRY="${REGISTRY%/}"
SEED_NAME="claude-agent-sdk-$PLATFORM-$VERSION.tgz"
TGZ_URL="$REGISTRY/$PKG/-/claude-agent-sdk-$PLATFORM-$VERSION.tgz"
if [ "$VERSION" = "$PINNED_VERSION" ]; then
  EXPECTED_SHA="$(pinned_sha512 "$PLATFORM")"
  [ -n "$EXPECTED_SHA" ] || err "No pinned sha512 for platform $PLATFORM"
else
  say "고정 버전이 아닌 $VERSION — npm 레지스트리에서 확인값을 받는 중"
  EXPECTED_SHA="$(curl -fsSL "$REGISTRY/$PKG/$VERSION" \
    | sed -n 's|.*"integrity":"\(sha512-[^"]*\)".*|\1|p' | head -n1)"
  [ -n "$EXPECTED_SHA" ] || err "Could not read dist.integrity for $PKG@$VERSION from the registry"
fi

# ── Destination (keep in lockstep with seededSdkBinaryPath) ──────────────────
DEST_DIR=""
case "$PLATFORM" in
  darwin-*) DEST_DIR="$HOME/Library/Application Support/HypeProof-Studio/sdk/$VERSION" ;;
  linux-*)  DEST_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/HypeProof-Studio/sdk/$VERSION" ;;
esac
DEST_BIN="$DEST_DIR/claude"
MARKER="$DEST_BIN.verified.json"

# ── Idempotency: a valid existing seed is left untouched ─────────────────────
if [ -z "$DOWNLOAD_ONLY" ] && [ "$FORCE" != "yes" ] && [ -x "$DEST_BIN" ] && [ -f "$MARKER" ]; then
  CUR_SIZE="$(wc -c < "$DEST_BIN" | tr -d ' ')"
  if grep -q "\"sdkVersion\": \"$VERSION\"" "$MARKER" && grep -q "\"size\": $CUR_SIZE" "$MARKER"; then
    say "AI 코치 실행 파일이 이미 준비되어 있습니다 (확인 완료)"
    printf '  binary : %s\n  size   : %s bytes\n  marker : %s\n' "$DEST_BIN" "$CUR_SIZE" "$MARKER"
    exit 0
  fi
  say "기존 AI 코치 실행 파일($DEST_BIN)이 확인을 통과하지 못해 다시 준비합니다"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Obtain the tarball ───────────────────────────────────────────────────────
if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || err "Tarball not found: $TARBALL"
  say "내려받아 둔 파일을 사용합니다: $TARBALL"
  TGZ="$TARBALL"
else
  say "AI 코치 실행 파일 $PKG@$VERSION 내려받는 중 (약 105-120 MiB)"
  TGZ="$TMP/sdk.tgz"
  curl -fL --retry 3 -o "$TGZ" "$TGZ_URL"
fi

# ── Verify sha512 (SRI base64 form, same value npm enforces) ─────────────────
say "파일 확인 중 (sha512)"
if command -v openssl >/dev/null 2>&1; then
  ACTUAL_SHA="sha512-$(openssl dgst -sha512 -binary "$TGZ" | base64 | tr -d '\n')"
else
  # Fallback: shasum emits hex; convert to the SRI base64 form via xxd.
  ACTUAL_SHA="sha512-$(shasum -a 512 "$TGZ" | cut -d' ' -f1 | xxd -r -p | base64 | tr -d '\n')"
fi
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  err "sha512 mismatch for $TGZ
  expected: $EXPECTED_SHA
  actual:   $ACTUAL_SHA
Refusing to install. (Corrupt download? Wrong --version/--tarball?)"
fi
printf '  ok: %s\n' "$ACTUAL_SHA"

# ── Release mode: stage the verified tarball + sha256, install nothing ───────
if [ -n "$DOWNLOAD_ONLY" ]; then
  # Same entry the installers extract: package/claude.exe on win32 (see
  # seed-sdk-binary.ps1), package/claude elsewhere.
  case "$PLATFORM" in win32-*) SEED_ENTRY="package/claude.exe" ;; *) SEED_ENTRY="package/claude" ;; esac
  tar -tzf "$TGZ" "$SEED_ENTRY" >/dev/null 2>&1 \
    || err "Tarball has no $SEED_ENTRY — not a native SDK seed for $PLATFORM"
  mkdir -p "$DOWNLOAD_ONLY"
  cp -f "$TGZ" "$DOWNLOAD_ONLY/$SEED_NAME"
  if command -v sha256sum >/dev/null 2>&1; then
    SHA256="$(sha256sum "$DOWNLOAD_ONLY/$SEED_NAME" | cut -d' ' -f1)"
  else
    SHA256="$(shasum -a 256 "$DOWNLOAD_ONLY/$SEED_NAME" | cut -d' ' -f1)"
  fi
  printf '%s  %s\n' "$SHA256" "$SEED_NAME" > "$DOWNLOAD_ONLY/$SEED_NAME.sha256"
  say "Staged release seed (nothing installed)"
  printf '  seed   : %s\n  sha256 : %s\n' "$DOWNLOAD_ONLY/$SEED_NAME" "$SHA256"
  exit 0
fi

# ── Extract + install atomically ─────────────────────────────────────────────
say "압축 푸는 중"
tar -xzf "$TGZ" -C "$TMP" package/claude
[ -f "$TMP/package/claude" ] || err "Tarball did not contain package/claude"
mkdir -p "$DEST_DIR"
chmod 755 "$TMP/package/claude"
BIN_SIZE="$(wc -c < "$TMP/package/claude" | tr -d ' ')"
mv -f "$TMP/package/claude" "$DEST_BIN"

# ── Write the runtime-trusted marker (see sdkBinaryManifest.ts trust model) ──
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$MARKER" <<EOF
{
  "sdkVersion": "$VERSION",
  "size": $BIN_SIZE,
  "tarballSha512": "$EXPECTED_SHA",
  "verifiedAt": "$NOW",
  "seededBy": "scripts/seed-sdk-binary.sh"
}
EOF

# ── Verification printout ────────────────────────────────────────────────────
say "AI 코치 실행 파일 준비 완료"
printf '  binary : %s\n' "$DEST_BIN"
printf '  size   : %s bytes\n' "$BIN_SIZE"
printf '  sha512 : %s (tarball, verified)\n' "$ACTUAL_SHA"
printf '  marker : %s\n' "$MARKER"
if "$DEST_BIN" --version >/dev/null 2>&1; then
  printf '  launch : %s\n' "$("$DEST_BIN" --version 2>/dev/null | head -n1)"
else
  printf '  launch : (skipped — binary did not answer --version here; Studio will still verify at runtime)\n'
fi
