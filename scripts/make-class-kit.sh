#!/usr/bin/env bash
# make-class-kit.sh — build a class kit: a hand-off folder for class
# participants who are not hypeproof organization members.
# Operator page: docs/INSTALL-CLASS-KIT.ko.md
#
# Why: the Studio release and source repositories are private, so install.sh and
# install.ps1 need a member's gh login for the Studio archive and for the SDK
# seeder. A member runs this script once with their own login. It collects those
# files into one folder, and the installers take them from there instead:
#
#   macOS    bash install.sh --kit <folder>
#   Windows  powershell -ExecutionPolicy Bypass -File install.ps1 -KitDir <folder>
#
# What goes into the folder:
#   Studio archive per platform               read from the private release with gh and
#                                             checked against the release SHA-256
#   install.sh  install.ps1                   copied from this checkout
#   seed-sdk-binary.sh  seed-sdk-binary.ps1   copied from this checkout
#   kit-info.txt                              Studio version, platforms, build time, source commit
#   SHA256SUMS                                SHA-256 of every file above
#
# What never goes into it: a token, gh configuration, the member's account name,
# host name or local paths. gh is used only to read the release.
#
# SHA256SUMS lets the installers refuse a damaged or half-copied kit. It does not
# prove who made the kit: whoever can change a file can change SHA256SUMS too.
# Hand the kit over yourself. Whether participants may receive the private app
# at all is the owner's decision, not this script's.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/make-class-kit.sh --out <dir> [--version <x.y.z>] [--platform <p>]...
  --out <dir>        folder to create; it must not exist yet
  --version <x.y.z>  Studio release to pack (default: the latest release; when it
                     lacks a requested platform, the newest release that has them all)
  --platform <p>     darwin-arm64 | win32-x64; repeat for both (default: both)
Needs: GitHub CLI logged in with a hypeproof member account (gh auth login).
EOF
}

RELEASES_REPO="hypeproof/hypeproof-studio-releases"
# Keep these three in step with install.sh (STUDIO_ASSET_GLOB_DARWIN_ARM64) and
# install.ps1 (asset_glob, asset_glob_fallback). The installers look the archive
# up in the kit with the same patterns, so a kit packed with other names would
# not be found.
GLOB_DARWIN_ARM64="HypeProof-Studio-darwin-arm64*.zip"
GLOB_WIN32_X64="*UserSetup-x64-*.exe"
GLOB_WIN32_X64_FALLBACK="*Setup-x64-*.exe"
# The files the installers otherwise fetch from the private source repository.
HELPERS="install.sh install.ps1 seed-sdk-binary.sh seed-sdk-binary.ps1"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
say()  { printf '==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

sha256_of() {  # sha256_of <file> -> lowercase hex digest
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# ── Arguments ────────────────────────────────────────────────────────────────
OUT=""
VERSION=""
VERSION_GIVEN=0
PLATFORM_ARGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)      OUT="${2:?--out needs a folder}"; shift 2 ;;
    --version)  VERSION="${2:?--version needs a value such as 0.1.56}"; VERSION_GIVEN=1; shift 2 ;;
    --platform) PLATFORM_ARGS="${PLATFORM_ARGS} ${2:?--platform needs darwin-arm64 or win32-x64}"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) usage >&2; die "Unknown argument: $1" ;;
  esac
done

[ -n "$OUT" ] || { usage >&2; die "--out <dir> is required"; }
# A trailing slash would put the staging folder inside the folder being created.
while [ "${OUT%/}" != "$OUT" ] && [ "$OUT" != "/" ]; do OUT="${OUT%/}"; done
[ ! -e "$OUT" ] || die "${OUT} already exists. Remove it or choose another folder."
# The kit holds the private app. Keep it out of any git checkout, where an
# untracked folder is one `git add -A` away from being committed.
probe="$OUT"
while [ ! -d "$probe" ]; do probe="$(dirname "$probe")"; done
if git -C "$probe" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "${OUT} is inside a git checkout. Choose a folder outside it."
fi

want_darwin=0
want_win=0
for p in ${PLATFORM_ARGS:-darwin-arm64 win32-x64}; do
  case "$p" in
    darwin-arm64) want_darwin=1 ;;
    win32-x64)    want_win=1 ;;
    *) die "Unknown platform '${p}' (use darwin-arm64 or win32-x64)" ;;
  esac
done
PLATFORMS=""
if [ "$want_darwin" = "1" ]; then PLATFORMS="darwin-arm64"; fi
if [ "$want_win" = "1" ]; then PLATFORMS="${PLATFORMS:+${PLATFORMS} }win32-x64"; fi

command -v gh >/dev/null 2>&1 \
  || die "GitHub CLI (gh) not found. Install it and run gh auth login with your member account."
for f in $HELPERS; do
  [ -f "${HERE}/${f}" ] || die "${f} not found next to this script (${HERE})"
done

# ── Release metadata (member login) ──────────────────────────────────────────
if [ -z "$VERSION" ]; then
  say "Resolving the latest Studio release"
  VERSION="$(gh release view --repo "$RELEASES_REPO" --json tagName --jq .tagName)" \
    || die "Could not read the latest release of ${RELEASES_REPO}. Run gh auth login with your member account."
fi
VERSION="${VERSION#v}"
printf '%s' "$VERSION" | grep -Eq '^[0-9]+(\.[0-9]+)+(-[0-9A-Za-z.]+)?$' \
  || die "Not a Studio version: '${VERSION}' (expected something like 0.1.56)"

say "Reading release v${VERSION}"
ASSETS="$(gh api "repos/${RELEASES_REPO}/releases/tags/v${VERSION}" \
  --jq '.assets[] | "\(.name)\t\(.url)\t\(.digest)"')" \
  || die "Could not read release v${VERSION} of ${RELEASES_REPO}. Check the version and your gh login."

# pick_asset <glob>... — "name<TAB>url<TAB>digest" of the first asset matching
# the first glob that matches anything. Same precedence as install.ps1.
pick_asset() {
  local glob name url digest
  for glob in "$@"; do
    while IFS=$'\t' read -r name url digest; do
      # shellcheck disable=SC2254  # the glob must stay unquoted to match
      case "$name" in $glob) printf '%s\t%s\t%s\n' "$name" "$url" "$digest"; return 0 ;; esac
    done <<EOF
$ASSETS
EOF
  done
  return 1
}

# has_platforms "<asset names>" - whether the names cover every requested platform.
# shellcheck disable=SC2254  # the globs must stay unquoted to match
has_platforms() {
  local names="$1" ok n
  if [ "$want_darwin" = "1" ]; then
    ok=0; for n in $names; do case "$n" in $GLOB_DARWIN_ARM64) ok=1 ;; esac; done
    [ "$ok" = "1" ] || return 1
  fi
  if [ "$want_win" = "1" ]; then
    ok=0; for n in $names; do case "$n" in $GLOB_WIN32_X64|$GLOB_WIN32_X64_FALLBACK) ok=1 ;; esac; done
    [ "$ok" = "1" ] || return 1
  fi
  return 0
}

# Releases can be macOS only (config/release-platforms.json). When no version was
# asked for and the latest release lacks a requested platform, pack the newest
# published release (no drafts, no prereleases, ordered by created_at like
# /releases/latest) that has every requested platform instead.
RELEASE_LIST_JQ='.[] | select((.draft or .prerelease) | not) | [.created_at, .tag_name, ([.assets[].name] | join(" "))] | @tsv'
if [ "$VERSION_GIVEN" = "0" ] && ! has_platforms "$(printf '%s\n' "$ASSETS" | cut -f1)"; then
  latest="$VERSION"
  say "v${latest} does not have every requested platform (${PLATFORMS}); looking for the newest release that has"
  LIST="$(gh api "repos/${RELEASES_REPO}/releases?per_page=100" --paginate --jq "$RELEASE_LIST_JQ")" \
    || die "Could not list the releases of ${RELEASES_REPO}. Run gh auth login with your member account."
  VERSION=""
  while IFS=$'\t' read -r _created tag names; do
    [ -n "${tag:-}" ] || continue
    if has_platforms "$names"; then VERSION="${tag#v}"; break; fi
  done <<< "$(printf '%s\n' "$LIST" | LC_ALL=C sort -r -t "$(printf '\t')" -k1,1)"
  [ -n "$VERSION" ] \
    || die "No published release of ${RELEASES_REPO} has every requested platform (${PLATFORMS}). Ask for a Windows build, or pack --platform darwin-arm64."
  printf '%s' "$VERSION" | grep -Eq '^[0-9]+(\.[0-9]+)+(-[0-9A-Za-z.]+)?$' \
    || die "Not a Studio version: '${VERSION}'"
  info "Packing v${VERSION}: the latest release v${latest} lacks a requested platform."
  info "For the newest macOS build, make a separate kit with --platform darwin-arm64."
  say "Reading release v${VERSION}"
  ASSETS="$(gh api "repos/${RELEASES_REPO}/releases/tags/v${VERSION}" \
    --jq '.assets[] | "\(.name)\t\(.url)\t\(.digest)"')" \
    || die "Could not read release v${VERSION} of ${RELEASES_REPO}. Check your gh login."
fi

# Build in a sibling folder and rename at the end, so a failed run never leaves
# something that looks like a finished kit.
STAGE="${OUT}.partial.$$"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE"

# fetch_asset <platform> <glob>... — download one release asset into the kit.
# Fail-closed on the same points as the installers: asset name, API URL, digest.
fetch_asset() {
  local platform="$1"; shift
  local line name url digest got
  line="$(pick_asset "$@")" || die "Release v${VERSION} has no asset for ${platform} (looked for: $*)"
  IFS=$'\t' read -r name url digest <<EOF
$line
EOF
  case "$name" in ''|*[!A-Za-z0-9._-]*) die "Unsafe asset name in release v${VERSION}: ${name}" ;; esac
  printf '%s' "$url" | grep -Eq '^https://api\.github\.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/[0-9]+$' \
    || die "Untrusted release asset URL for ${name}"
  printf '%s' "$digest" | grep -Eq '^sha256:[a-fA-F0-9]{64}$' || die "Release asset ${name} has no SHA-256 digest"
  say "Downloading ${name} (${platform})"
  gh api "$url" -H 'Accept: application/octet-stream' > "${STAGE}/${name}" || die "Download failed: ${name}"
  got="$(sha256_of "${STAGE}/${name}")"
  [ "$got" = "$(printf '%s' "${digest#sha256:}" | tr 'A-F' 'a-f')" ] \
    || die "SHA-256 mismatch for ${name}: the download does not match the release"
  info "sha256 ${got}"
}

if [ "$want_darwin" = "1" ]; then fetch_asset darwin-arm64 "$GLOB_DARWIN_ARM64"; fi
if [ "$want_win" = "1" ]; then fetch_asset win32-x64 "$GLOB_WIN32_X64" "$GLOB_WIN32_X64_FALLBACK"; fi

# ── Installers and SDK seeders from this checkout ────────────────────────────
say "Copying the installers and SDK seeders"
for f in $HELPERS; do
  cp "${HERE}/${f}" "${STAGE}/${f}"
done

# ── kit-info.txt ─────────────────────────────────────────────────────────────
# The commit says which revision of the installers the kit carries. It is not an
# identity: no account, host or path is written.
commit="unknown"
if git -C "$HERE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  commit="$(git -C "$HERE" rev-parse HEAD)"
  # shellcheck disable=SC2086  # HELPERS is a fixed list of plain file names
  git -C "$HERE" diff --quiet HEAD -- $HELPERS 2>/dev/null || commit="${commit}+modified"
fi
{
  printf '# HypeProof Studio class kit. Operator page: docs/INSTALL-CLASS-KIT.ko.md (hypeproof-studio)\n'
  printf 'schema=1\n'
  printf 'studio_version=%s\n' "$VERSION"
  printf 'platforms=%s\n' "$PLATFORMS"
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_commit=%s\n' "$commit"
} > "${STAGE}/kit-info.txt"

# ── SHA256SUMS over every file in the kit ────────────────────────────────────
say "Writing SHA256SUMS"
(
  cd "$STAGE"
  LC_ALL=C
  for f in *; do
    [ "$f" = "SHA256SUMS" ] && continue
    printf '%s  %s\n' "$(sha256_of "$f")" "$f"
  done
) > "${STAGE}/SHA256SUMS"

mv "$STAGE" "$OUT"
trap - EXIT

say "Class kit ready: ${OUT}"
info "Studio ${VERSION} for ${PLATFORMS} ($(du -sh "$OUT" | awk '{print $1}'))"
info "Hand the folder over yourself. A participant opens a terminal in it and runs:"
info "  macOS    bash install.sh --kit ."
info "  Windows  powershell -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1 -KitDir ."
info "Operator page: docs/INSTALL-CLASS-KIT.ko.md"
