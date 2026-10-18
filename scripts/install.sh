#!/bin/sh
# =============================================================================
# HypeProof one-line bootstrap (macOS / Linux)
#
#   gh api repos/hypeproof/hypeproof-studio/contents/scripts/install.sh -H "Accept: application/vnd.github.raw" > /tmp/hps-bootstrap.sh && bash /tmp/hps-bootstrap.sh
#
# This is the POSIX-sh sibling of install.ps1 (Windows). Both read ONE
# versioned dependency manifest (hypeproof-deps.yaml) as the single source of
# truth. The manifest values are embedded below so the bootstrap stays a single
# self-contained file when piped from curl; they are kept byte-for-byte in sync
# with hypeproof-deps.yaml (schema 1) and re-verified at the end by the built-in
# `hps doctor` pass.
#
# What it does:
#   1. Detect OS / arch / login shell + rc file.
#   2. Ensure a package manager (Homebrew on mac; brew or native pkg on Linux).
#   3. Check each REAL runtime dependency from the manifest; install the missing.
#   4. Download + install the HypeProof Studio app and seed the native SDK binary.
#   5. Dedupe every PATH / rc edit via a receipt so re-runs are idempotent upgrades.
#   6. Finish with a fail-closed `hps doctor` that re-verifies the same manifest.
#
# Flags / env:
#   -y | HPS_NONINTERACTIVE=1   unattended (assume yes, no prompts)
#   INSTALLER_NO_MODIFY_PATH=1  never touch PATH / rc files
#   HPS_SKIP_STUDIO=1           skip Studio app + SDK seed (deps only)
#   HPS_DEBUG=1                 xtrace
#   --kit <dir> | HPS_KIT_DIR=<dir>
#                               class kit (docs/INSTALL-CLASS-KIT.ko.md): take the
#                               Studio archive and the SDK seeder from this folder
#                               instead of GitHub. No GitHub login is used.
# =============================================================================

set -eu

# ----------------------------------------------------------------------------- #
# 0. Constants (embedded from hypeproof-deps.yaml — schema: 1)
# ----------------------------------------------------------------------------- #
MANIFEST_SCHEMA=1

STUDIO_RELEASES_REPO="hypeproof/hypeproof-studio-releases"
# "latest" resolves from the releases API at run time. A hard pin here goes stale
# the moment a release ships (it sat at 0.1.33 while the repo served v0.1.34),
# and every participant would then install a version behind. Override with
# HPS_STUDIO_VERSION=0.1.33 to install a specific one.
STUDIO_VERSION="${HPS_STUDIO_VERSION:-latest}"
# The published assets carry NO version in the name — `HypeProof-Studio-darwin-arm64.zip`.
# The trailing `-` before `*` made the glob unmatchable, so step 5 always died with
# "No Studio asset matching …". `*` after the arch matches both shapes.
STUDIO_ASSET_GLOB_DARWIN_ARM64="HypeProof-Studio-darwin-arm64*.zip"
# shellcheck disable=SC2034  # unused while install_studio_mac fails Intel early;
# kept as the ready-made glob for when a darwin-x64 asset ships (#331).
STUDIO_ASSET_GLOB_DARWIN_X64="HypeProof-Studio-darwin-x64*.zip"

# SDK seeding is delegated to the canonical scripts/seed-sdk-binary.sh — the
# single source of truth for the platform package, the pinned SDK version, the
# sha512 table, the seeded location (darwin/linux), and the runtime-trusted
# `.verified.json` marker. Do NOT reinvent seeding here.
SEED_SCRIPT_NAME="seed-sdk-binary.sh"
# Raw base for the bootstrap (curl | bash) path, where no sibling script exists.
# It must point at a tree that ACTUALLY hosts scripts/seed-sdk-binary.sh: that is
# this repo, not the releases repo (which carries the Studio binaries only).
# Override with HPS_RAW_BASE once a mirror is published.
RAW_BASE="${HPS_RAW_BASE:-https://raw.githubusercontent.com/hypeproof/hypeproof-studio/main/scripts}"
# Where seed_sdk stopped, for the doctor's stop message: "" (not run or succeeded),
# "unavailable" (no seeder could be obtained) or "failed" (seeder exited non-zero,
# code in SDK_SEED_RC). On macOS a missing seed is a doctor failure, never a warning:
# the app bundle deliberately excludes the native binary and nothing in Studio
# fetches it. Linux installs no Studio app, so there it stays a warning.
SDK_SEED_STAGE=""
SDK_SEED_RC=""

HPS_HOME="${HOME}/.hypeproof"
RECEIPT="${HPS_HOME}/receipt.json"
STUDIO_SUPPORT="${HOME}/Library/Application Support/HypeProof-Studio"  # mac path; overridden on Linux below
# Where the Studio app goes. HPS_APPS_DIR is a test seam: scripts/test-installer-kit.sh
# points it at a temporary folder so a test run cannot touch a real installation.
APPS_DIR="${HPS_APPS_DIR:-/Applications}"
STUDIO_APP="${APPS_DIR}/HypeProof Studio.app"

# Class kit (instructor hand-off for participants who are not organization
# members). The folder is built by scripts/make-class-kit.sh and carries the two
# things this script otherwise fetches from the private repositories: the Studio
# archive and the SDK seeder. Empty = the normal member install from GitHub.
KIT_DIR="${HPS_KIT_DIR:-}"
KIT_SUMS_NAME="SHA256SUMS"
KIT_INFO_NAME="kit-info.txt"

[ "${HPS_DEBUG:-0}" = "1" ] && set -x

# ----------------------------------------------------------------------------- #
# 1. Pretty output helpers
# ----------------------------------------------------------------------------- #
if [ -t 1 ]; then
  C_RESET="$(printf '\033[0m')"; C_BOLD="$(printf '\033[1m')"
  C_GREEN="$(printf '\033[32m')"; C_YELLOW="$(printf '\033[33m')"
  C_RED="$(printf '\033[31m')"; C_BLUE="$(printf '\033[36m')"
else
  C_RESET=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""
fi

STEP_N=0
step()  { STEP_N=$((STEP_N + 1)); printf '%s\n' "${C_BOLD}${C_BLUE}==> [${STEP_N}] $*${C_RESET}"; }
info()  { printf '    %s\n' "$*"; }
ok()    { printf '    %s%s%s\n' "${C_GREEN}" "✓ $*" "${C_RESET}"; }
warn()  { printf '    %s%s%s\n' "${C_YELLOW}" "! $*" "${C_RESET}"; }
die()   { printf '%s\n' "${C_RED}${C_BOLD}✗ $*${C_RESET}" >&2; exit 1; }

# ----------------------------------------------------------------------------- #
# 2. Flags / interactivity
# ----------------------------------------------------------------------------- #
NONINTERACTIVE="${HPS_NONINTERACTIVE:-0}"
_kit_arg=0
for arg in "$@"; do
  if [ "$_kit_arg" = "1" ]; then
    _kit_arg=0; KIT_DIR="$arg"
    [ -n "$KIT_DIR" ] || die "--kit needs the class kit folder"
    continue
  fi
  case "$arg" in
    -y|--yes|--noninteractive) NONINTERACTIVE=1 ;;
    --kit) _kit_arg=1 ;;
    --kit=*) KIT_DIR="${arg#--kit=}"; [ -n "$KIT_DIR" ] || die "--kit needs the class kit folder" ;;
    -h|--help)
      printf 'Usage: install.sh [-y] [--kit <dir>]\n  -y           unattended (HPS_NONINTERACTIVE=1)\n  --kit <dir>  install from a class kit folder, not from GitHub (HPS_KIT_DIR)\n'
      exit 0 ;;
    *) warn "ignoring unknown argument: $arg" ;;
  esac
done
[ "$_kit_arg" = "0" ] || die "--kit needs the class kit folder"
if [ -n "$KIT_DIR" ]; then
  KIT_DIR="$(CDPATH='' cd -- "$KIT_DIR" 2>/dev/null && pwd)" || die "class kit folder not found (--kit / HPS_KIT_DIR)"
fi
# stdin is the piped script under curl|bash, so prompts are impossible there.
[ -t 0 ] || NONINTERACTIVE=1
# Homebrew 7 asks "Do you want to proceed with the installation? [y/n]" before any
# install with dependencies. The participant already agreed to the tools here, and
# the English question stops a Korean install halfway (#1645). Older Homebrew
# ignores the variable, where `--yes` would be an unknown option.
export HOMEBREW_NO_ASK=1

# --- curl | bash 안전장치: 자기 자신을 파일로 다시 실행한다 ------------------- #
# 파이프로 오면 bash 는 이 스크립트를 stdin 에서 조금씩 읽어가며 실행한다. 그런데
# Homebrew 설치기와 그것이 부르는 CLT 설치(softwareupdate)가 **같은 stdin 을
# 소비**하기 때문에, 아직 안 읽은 뒷부분(4 Studio 설치 · 5 SDK 시드 · 6 doctor)이
# 통째로 사라진다. bash 는 EOF 를 만나 그대로 **성공(0)** 으로 끝나고, 참가자는
# "설치 완료" 를 본 뒤 앱이 없는 상태로 남는다.
#
# brew·CLT 가 이미 있는 기기에서는 stdin 을 먹는 놈이 없어 재현되지 않는다 —
# 그래서 개발기에서는 늘 통과했고, 공기계에서만 터졌다. 2026-08-09 vanilla
# macOS VM 에서 재현: 9m54s / exit 0 / Studio·SDK 없음, 로그에 스크립트 뒷부분이
# 실행 대신 텍스트로 출력됨.
#
# 파일에서 읽히는 순간 이 문제는 원천적으로 사라지므로, 파이프로 들어왔으면
# 내려받아 exec 한다.
_hps_is_piped() {
  case "${0##*/}" in bash|sh|dash|zsh|-bash|-sh) return 0 ;; esac
  [ -r "$0" ] || return 0
  return 1
}
# Private scripts use the member login; a custom mirror never receives a token.
fetch_bootstrap_script() {
  _file="$1"; _dest="$2"
  if [ "$RAW_BASE" = "https://raw.githubusercontent.com/hypeproof/hypeproof-studio/main/scripts" ]; then
    command -v gh >/dev/null 2>&1 || die "Install GitHub CLI and run gh auth login before bootstrapping."
    gh api "repos/hypeproof/hypeproof-studio/contents/scripts/$_file" -H 'Accept: application/vnd.github.raw' > "$_dest"
  else
    curl -fsSL "${RAW_BASE}/$_file" -o "$_dest"
  fi
}

if [ -z "${HPS_REEXEC:-}" ] && _hps_is_piped; then
  # Class kit: re-run from the kit's own copy, so nothing is fetched from GitHub.
  [ -z "$KIT_DIR" ] || HPS_REEXEC=1 exec bash "${KIT_DIR}/install.sh" "$@"
  _self="$(mktemp -t hps-install)" || die "mktemp failed"
  fetch_bootstrap_script install.sh "$_self" \
    || die "installer re-fetch failed: ${RAW_BASE}/install.sh"
  HPS_REEXEC=1 exec bash "$_self" "$@"
fi

confirm() {  # confirm "question" -> 0 yes / 1 no; auto-yes when noninteractive
  [ "$NONINTERACTIVE" = "1" ] && return 0
  printf '%s [Y/n] ' "$1"
  read -r _ans </dev/tty 2>/dev/null || return 0
  case "$_ans" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

have() { command -v "$1" >/dev/null 2>&1; }

# ----------------------------------------------------------------------------- #
# 2b. Class kit (--kit <dir> / HPS_KIT_DIR)
# ----------------------------------------------------------------------------- #
# Every kit file is checked against the kit's SHA256SUMS before it is used. That
# catches a damaged or half-copied kit. It does not authenticate the person who
# handed the folder over: whoever can change a file can change SHA256SUMS too.
sha256_of() {  # sha256_of <file> -> lowercase hex digest
  if have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# kit_verify <name> — die unless <name> is a plain file name listed in the kit's
# SHA256SUMS and the file in the kit has exactly that SHA-256.
kit_verify() {
  case "$1" in ''|*[!A-Za-z0-9._-]*) die "class kit: invalid file name '$1'" ;; esac
  _want="$(awk -v n="$1" '{ sub(/\r$/, "") } $2 == n { print $1; exit }' "${KIT_DIR}/${KIT_SUMS_NAME}")"
  [ -n "$_want" ] || die "class kit: $1 is not listed in ${KIT_SUMS_NAME}"
  [ -f "${KIT_DIR}/$1" ] || die "class kit: $1 is missing from ${KIT_DIR}"
  [ "$(sha256_of "${KIT_DIR}/$1")" = "$_want" ] \
    || die "class kit: SHA-256 mismatch for $1 — the copy is damaged. Ask your instructor for the kit again."
}

# kit_asset_name <glob> — first file name in the kit's SHA256SUMS matching <glob>.
kit_asset_name() {
  awk '{ sub(/\r$/, ""); print $2 }' "${KIT_DIR}/${KIT_SUMS_NAME}" | while IFS= read -r _kit_name; do
    # shellcheck disable=SC2254  # $1 is a glob on purpose, as in gh_asset_url
    case "$_kit_name" in $1) printf '%s\n' "$_kit_name"; break ;; esac
  done
}

# Verify the whole kit before anything is installed, then pin the Studio version
# it holds. A damaged kit should stop here, not after ten minutes of Homebrew.
kit_preflight() {
  step "Checking the class kit"
  [ -f "${KIT_DIR}/${KIT_SUMS_NAME}" ] \
    || die "class kit: ${KIT_SUMS_NAME} not found in ${KIT_DIR} — this folder is not a class kit"
  _kit_names="$(awk '{ sub(/\r$/, "") } NF == 0 { next }
      NF != 2 || length($1) != 64 || $1 !~ /^[0-9a-f]+$/ || $2 !~ /^[A-Za-z0-9._-]+$/ || ($2 in seen) { exit 1 }
      { seen[$2] = 1; print $2 }' "${KIT_DIR}/${KIT_SUMS_NAME}")" || die "class kit: ${KIT_SUMS_NAME} is malformed"
  _kit_count=0
  for _kit_file in $_kit_names; do
    kit_verify "$_kit_file"
    _kit_count=$((_kit_count + 1))
  done
  kit_verify "$KIT_INFO_NAME"
  _kit_version="$(sed -n 's/^studio_version=//p' "${KIT_DIR}/${KIT_INFO_NAME}" | head -n1 | tr -d '\r')"
  printf '%s' "$_kit_version" | grep -Eq '^[0-9]+(\.[0-9]+)+(-[0-9A-Za-z.]+)?$' \
    || die "class kit: ${KIT_INFO_NAME} has no usable studio_version"
  # The kit holds exactly one Studio version, so it decides (HPS_STUDIO_VERSION is ignored).
  STUDIO_VERSION="$_kit_version"
  ok "class kit verified: Studio ${STUDIO_VERSION}, ${_kit_count} file(s) match ${KIT_SUMS_NAME}"
}

# ----------------------------------------------------------------------------- #
# 3. Detect OS / arch / shell
# ----------------------------------------------------------------------------- #
step "Detecting platform"
UNAME_S="$(uname -s)"; UNAME_M="$(uname -m)"
case "$UNAME_S" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux"  ;;
  *)      die "unsupported OS: $UNAME_S (this bootstrap is macOS/Linux; use install.ps1 on Windows)" ;;
esac
case "$UNAME_M" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64"   ;;
  *)             die "unsupported architecture: $UNAME_M" ;;
esac
PLATFORM="${OS}-${ARCH}"

# Login shell + its rc file (for PATH edits).
LOGIN_SHELL="$(basename "${SHELL:-/bin/sh}")"
case "$LOGIN_SHELL" in
  zsh)  RC_FILE="${ZDOTDIR:-$HOME}/.zshrc" ;;
  bash) if [ "$OS" = "darwin" ]; then RC_FILE="$HOME/.bash_profile"; else RC_FILE="$HOME/.bashrc"; fi ;;
  fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
  *)    RC_FILE="$HOME/.profile" ;;
esac

# Studio support dir differs per OS.
if [ "$OS" = "linux" ]; then
  STUDIO_SUPPORT="${XDG_DATA_HOME:-$HOME/.local/share}/HypeProof-Studio"
fi

ok "OS=${OS} arch=${ARCH} platform=${PLATFORM}"
ok "shell=${LOGIN_SHELL} rc=${RC_FILE}"

# ----------------------------------------------------------------------------- #
# 4. Receipt (idempotency ledger)
# ----------------------------------------------------------------------------- #
mkdir -p "$HPS_HOME"
[ -f "$RECEIPT" ] || printf '{\n  "schema": %s,\n  "installed": [],\n  "path_edits": []\n}\n' "$MANIFEST_SCHEMA" > "$RECEIPT"

receipt_note() {  # receipt_note <key> <value> — append-once audit line (JSON is advisory, kept human-readable)
  _k="$1"; _v="$2"
  grep -q "\"${_k}\": \"${_v}\"" "$RECEIPT" 2>/dev/null && return 0
  # keep it simple + robust: append a trailing comment-style record the doctor can read
  printf '  # %s=%s @ %s\n' "$_k" "$_v" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$RECEIPT"
}

# grep-before-append PATH export into rc; deduped via receipt + rc scan.
ensure_path_entry() {  # ensure_path_entry <dir>
  _dir="$1"
  case ":${PATH}:" in *":${_dir}:"*) : ;; *) PATH="${_dir}:${PATH}"; export PATH ;; esac
  [ "${INSTALLER_NO_MODIFY_PATH:-0}" = "1" ] && return 0
  [ -n "$RC_FILE" ] || return 0
  _line="export PATH=\"${_dir}:\$PATH\""
  if [ -f "$RC_FILE" ] && grep -Fq "$_dir" "$RC_FILE" 2>/dev/null; then
    return 0  # already present -> idempotent
  fi
  mkdir -p "$(dirname "$RC_FILE")" 2>/dev/null || true
  {
    printf '\n# Added by HypeProof installer (%s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "$_line"
  } >> "$RC_FILE"
  receipt_note "path_edit" "$_dir"
  info "PATH: added ${_dir} to ${RC_FILE}"
}

# ----------------------------------------------------------------------------- #
# 5. Package manager (Homebrew on mac; brew/native on Linux)
# ----------------------------------------------------------------------------- #
BREW=""
resolve_brew() {
  if have brew; then BREW="$(command -v brew)"; return 0; fi
  for _b in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
    [ -x "$_b" ] && { BREW="$_b"; eval "$("$_b" shellenv)"; return 0; }
  done
  return 1
}

# The Homebrew installer runs with stdin from /dev/null (see below), which switches
# it to non-interactive mode: it then checks sudo with `sudo -n` only and aborts
# with "Insufficient permissions" on any Mac where sudo needs a password (#1646).
# So ask for the Mac password here, once, and keep it fresh until Homebrew and the
# Command Line Tools are installed (longer than sudo's 5-minute timeout).
BREW_SUDO_KEEPALIVE=""
brew_sudo_begin() {
  sudo -n true 2>/dev/null && return 0
  printf '\n    Homebrew를 설치하려면 이 Mac의 로그인 암호가 한 번 필요합니다.\n'
  printf '    암호를 입력해도 화면에는 아무것도 표시되지 않습니다. 다 입력하고 Enter를 누르세요.\n\n'
  sudo -v -p '    Mac 암호: ' </dev/tty \
    || die "Mac 암호를 확인하지 못했습니다. 암호를 다시 확인하고 설치를 다시 실행하세요. 이 Mac의 관리자 계정이 아니라면 관리자 계정으로 실행해야 합니다."
  ( while kill -0 "$$" 2>/dev/null; do sudo -n true 2>/dev/null || true; sleep 50; done ) &
  BREW_SUDO_KEEPALIVE=$!
}
brew_sudo_end() {
  [ -n "$BREW_SUDO_KEEPALIVE" ] || return 0
  # set -e: a killed child makes `wait` return 143, which would end the install.
  kill "$BREW_SUDO_KEEPALIVE" 2>/dev/null || true
  wait "$BREW_SUDO_KEEPALIVE" 2>/dev/null || true
  BREW_SUDO_KEEPALIVE=""
}

ensure_brew() {
  step "Ensuring package manager (Homebrew)"
  if resolve_brew; then ok "brew present: $BREW"; return 0; fi
  if [ "$OS" = "darwin" ]; then
    if confirm "Homebrew not found. Install it now (also triggers Xcode CLT)?"; then
      NONINTERACTIVE_BREW=""
      [ "$NONINTERACTIVE" = "1" ] && NONINTERACTIVE_BREW="NONINTERACTIVE=1"
      [ "$NONINTERACTIVE" = "1" ] || brew_sudo_begin
      # </dev/null 은 이중 안전장치다. 위쪽 re-exec 가 이미 stdin 의존을 없앴지만,
      # brew 설치기와 그것이 부르는 softwareupdate 가 stdin 을 읽는다는 사실 자체는
      # 그대로이므로 여기서도 끊어둔다 (누가 re-exec 를 걷어내도 안 터지게).
      env $NONINTERACTIVE_BREW /bin/bash -c \
        "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
        </dev/null \
        || { brew_sudo_end; die "Homebrew install failed. See https://brew.sh"; }
      brew_sudo_end
      resolve_brew || die "Homebrew installed but 'brew' not on PATH; open a new shell and re-run."
      ensure_path_entry "$(dirname "$BREW")"
      ok "Homebrew installed: $BREW"
    else
      warn "Skipping Homebrew; will fall back to direct downloads where possible."
    fi
  else
    # Linux: prefer an already-present native manager; brew optional.
    warn "No Homebrew on Linux; will use the native package manager / direct fallback."
  fi
}

# Native Linux package manager abstraction (fallback path when brew absent).
LINUX_PM=""
detect_linux_pm() {
  for _p in apt-get dnf yum pacman zypper apk; do
    have "$_p" && { LINUX_PM="$_p"; return 0; }
  done
  return 1
}
linux_pkg_install() {  # linux_pkg_install <pkg...>
  [ -n "$LINUX_PM" ] || detect_linux_pm || return 1
  _sudo=""; [ "$(id -u)" -ne 0 ] && have sudo && _sudo="sudo"
  case "$LINUX_PM" in
    apt-get) $_sudo apt-get update -y && $_sudo apt-get install -y "$@" ;;
    dnf)     $_sudo dnf install -y "$@" ;;
    yum)     $_sudo yum install -y "$@" ;;
    pacman)  $_sudo pacman -Sy --noconfirm "$@" ;;
    zypper)  $_sudo zypper install -y "$@" ;;
    apk)     $_sudo apk add "$@" ;;
    *)       return 1 ;;
  esac
}

# ----------------------------------------------------------------------------- #
# 6. Dependency table (embedded from manifest `tools:`)
#    Fields:  id | check-cmd | brew-pkg | linux-native-pkg | preinstalled? | min/pin note
# ----------------------------------------------------------------------------- #
# We iterate this list; each row maps 1:1 to a manifest tool entry.
DEP_IDS="git bash gh node python jq curl"

dep_check_cmd() {
  case "$1" in
    git)    echo "git --version" ;;
    bash)   echo "bash --version" ;;
    gh)     echo "gh --version" ;;
    node)   echo "node --version" ;;
    python) echo "python3 --version" ;;
    jq)     echo "jq --version" ;;
    curl)   echo "curl --version" ;;
  esac
}
dep_binary() {  # the executable that `have` should test
  case "$1" in
    python) echo "python3" ;;
    *)      echo "$1" ;;
  esac
}
dep_brew_pkg() {
  case "$1" in
    git)    echo "git" ;;
    bash)   echo "bash" ;;          # mac /bin/bash 3.2 is fine; brew bash only if truly missing
    gh)     echo "gh" ;;
    node)   echo "node@22" ;;
    python) echo "python@3.11" ;;
    jq)     echo "jq" ;;
    curl)   echo "curl" ;;
  esac
}
dep_linux_pkg() {
  case "$1" in
    git)    echo "git" ;;
    bash)   echo "bash" ;;
    gh)     echo "gh" ;;            # may require github-cli repo; best-effort
    node)   echo "nodejs npm" ;;
    python) echo "python3" ;;
    jq)     echo "jq" ;;
    curl)   echo "curl" ;;
  esac
}
dep_preinstalled_ok() {  # deps we accept as-is if already present (no forced upgrade)
  case "$1" in
    bash|curl) return 0 ;;
    *)         return 1 ;;
  esac
}

# --- version gate (embedded from manifest `min_version`) --------------------- #
# 2026-08-10, 순정 macOS VM 실측에서 드러난 구멍: 이 아래 두 곳(install_one_dep /
# doctor)이 **존재만** 보고 버전을 보지 않았다. 그 결과 stock macOS 의
# /usr/bin/python3 (3.9.6) 이 manifest 의 min_version 3.11 을 만족하는 것으로
# 취급되어 python@3.11 이 아예 설치되지 않았고, 그럼에도 "all manifest checks
# passed" 가 찍혔다. 참가자 머신 전부가 이 상태로 워크숍에 온다.
#
# tier 를 존중한다 — required/recommended 만 강제한다. bash(maintainer, min 5.0)
# 를 강제하면 /bin/bash 3.2 인 모든 macOS 설치가 깨진다. dev/maintainer 티어는
# scripts/hps-doctor.sh 가 warn 으로 다룬다(동일 정책).
dep_min_version() {
  case "$1" in
    git)    echo "2.30" ;;
    gh)     echo "2.40" ;;
    python) echo "3.11" ;;
    jq)     echo "1.6"  ;;
    node)   echo "18.0" ;;
    *)      echo ""     ;;   # bash·curl: tier 상 강제하지 않는다
  esac
}

# 체크 명령 출력에서 첫 dotted-numeric 토큰을 뽑는다.
#   "git version 2.39.5" → 2.39.5 · "jq-1.7.1-apple" → 1.7.1 · "v22.23.2" → 22.23.2
dep_version_of() {
  eval "$(dep_check_cmd "$1")" 2>/dev/null | head -n1 \
    | sed -n 's/[^0-9]*\([0-9][0-9]*\(\.[0-9][0-9]*\)*\).*/\1/p'
}

# ver_ge A B — dotted-numeric A >= B. hps-doctor.sh 와 동일 구현(정책 일치).
ver_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN{
    na=split(a,A,"."); nb=split(b,B,".");
    n=(na>nb)?na:nb;
    for(i=1;i<=n;i++){ x=(i<=na?A[i]+0:0); y=(i<=nb?B[i]+0:0);
      if(x>y){ exit 0 } if(x<y){ exit 1 } }
    exit 0
  }'
}

# dep_satisfies_min <id> — 버전 요구가 없거나(빈 min) 충족하면 0.
dep_satisfies_min() {
  _min="$(dep_min_version "$1")"
  [ -z "$_min" ] && return 0
  _got="$(dep_version_of "$1")"
  [ -z "$_got" ] && return 0        # 버전을 못 읽으면 막지 않는다(기존 동작 유지)
  ver_ge "$_got" "$_min"
}

install_one_dep() {  # install_one_dep <id>
  _id="$1"; _bin="$(dep_binary "$_id")"
  if have "$_bin"; then
    if dep_satisfies_min "$_id"; then
      ok "${_id}: $(eval "$(dep_check_cmd "$_id")" 2>/dev/null | head -n1)"
      return 0
    fi
    # 있지만 manifest 최소 버전 미만 — 설치를 계속 진행해 브루 패키지를 올린다.
    # (예: stock macOS 의 python3 3.9.6 vs min 3.11 → python@3.11 설치)
    info "${_id}: $(dep_version_of "$_id") < 최소 $(dep_min_version "$_id") — 설치를 진행합니다…"
  fi

  # mac /bin/bash 3.2 & system curl satisfy the manifest even if not on PATH as such.
  if dep_preinstalled_ok "$_id" && [ "$OS" = "darwin" ] && [ -x "/bin/$_id" ]; then
    ok "${_id}: using system /bin/${_id}"
    return 0
  fi

  info "${_id}: missing — installing…"
  if resolve_brew; then
    if "$BREW" install "$(dep_brew_pkg "$_id")"; then
      # keg-only formulae (node@22, python@3.11) need their opt/bin on PATH
      case "$_id" in
        node)   ensure_path_entry "$("$BREW" --prefix)/opt/node@22/bin" ;;
        python) ensure_path_entry "$("$BREW" --prefix)/opt/python@3.11/bin"
                _pp="$("$BREW" --prefix)/opt/python@3.11/libexec/bin"
                [ -d "$_pp" ] && ensure_path_entry "$_pp" ;;
      esac
      receipt_note "installed" "$_id"
      ok "${_id}: installed via brew"
      return 0
    fi
    warn "${_id}: brew install failed — trying direct fallback"
  fi

  # Direct / native fallback.
  # shellcheck disable=SC2046  # intentional word-splitting: some rows are multi-pkg ("nodejs npm")
  if [ "$OS" = "linux" ] && linux_pkg_install $(dep_linux_pkg "$_id"); then
    receipt_note "installed" "$_id"
    ok "${_id}: installed via native package manager"
    return 0
  fi

  # Last-resort per-tool fallbacks.
  case "$_id" in
    node)
      if confirm "Install Node 22 via the official nvm fallback?"; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash || true
        # shellcheck disable=SC1090
        export NVM_DIR="${HOME}/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        nvm install 22.22.1 && nvm alias default 22.22.1 || true
        have node && { receipt_note "installed" "node"; ok "node: installed via nvm"; return 0; }
      fi ;;
  esac

  die "${_id}: could not install (no brew / native pkg / fallback succeeded). Install it manually and re-run."
}

check_deps() {
  step "Checking + installing runtime dependencies (manifest schema ${MANIFEST_SCHEMA})"
  for _id in $DEP_IDS; do
    install_one_dep "$_id"
  done
  # Post: warn (not fail) if gh is unauthenticated — matches manifest gh.post.
  # Class kit: a participant needs no GitHub login to install, so do not ask for one.
  if [ -z "$KIT_DIR" ] && have gh; then
    if gh auth status >/dev/null 2>&1; then ok "gh: authenticated"; else warn "gh: not authenticated — run 'gh auth login' before using PR/review skills"; fi
  fi
}

# ----------------------------------------------------------------------------- #
# 7. HypeProof Studio app + native SDK seed
# ----------------------------------------------------------------------------- #
# Turn STUDIO_VERSION="latest" into the concrete tag the releases repo serves.
# Everything downstream (the installed-version compare, the receipt) needs a real
# number, so resolve once and rewrite the global.
resolve_studio_version() {
  [ "$STUDIO_VERSION" != "latest" ] && return 0
  _tag=""
  if have gh; then
    _tag="$(gh release view --repo "$STUDIO_RELEASES_REPO" --json tagName --jq .tagName 2>/dev/null || true)"
  fi
  [ -n "$_tag" ] || die "could not resolve the latest Studio release from ${STUDIO_RELEASES_REPO} (set HPS_STUDIO_VERSION=<x.y.z>)"
  STUDIO_VERSION="${_tag#v}"
  info "Studio version: ${STUDIO_VERSION} (resolved from latest)"
}

gh_asset_url() {
  _glob="$1"
  have gh || die "Install GitHub CLI and run gh auth login with your member account."
  _assets="$(gh api "repos/${STUDIO_RELEASES_REPO}/releases/tags/v${STUDIO_VERSION}" \
    --jq '.assets[] | "\(.name)\t\(.url)"')" || die "Private release access denied; run gh auth login."
  printf '%s\n' "$_assets" | while IFS="$(printf '\t')" read -r _name _dl; do
    case "$_name" in $_glob) echo "$_dl"; break ;; esac
  done
}

install_studio_mac() {
  _glob=""
  case "$PLATFORM" in
    darwin-arm64) _glob="$STUDIO_ASSET_GLOB_DARWIN_ARM64" ;;
    # build-mac.yml is arm64-only, so no darwin-x64 asset is ever produced.
    # Without this branch an Intel Mac installs every brew dependency first and
    # only then dies on a generic "asset may not exist yet", which reads as a
    # broken release rather than an unsupported machine. Mirrors the early
    # guard install-mac.sh already carries (#362). Turn this back into the
    # x64 glob once a matching asset ships.
    darwin-x64)   die "Intel Mac(x86_64)는 현재 지원되지 않습니다 — HypeProof Studio는 Apple Silicon(arm64) 전용 빌드만 제공합니다. (Intel 지원 여부는 논의 중: jayleekr/hypeproof-studio#331)" ;;
  esac
  if [ -d "$STUDIO_APP" ]; then
    # Idempotent upgrade: only replace if version differs.
    _cur="$(defaults read "${STUDIO_APP}/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?")"
    if [ "$_cur" = "$STUDIO_VERSION" ]; then ok "Studio ${STUDIO_VERSION} already installed"; return 0; fi
    info "Studio ${_cur} -> ${STUDIO_VERSION} (upgrading)"
  fi
  if [ -n "$KIT_DIR" ]; then
    # Class kit: the archive is already in the kit folder. Check it against the
    # kit's SHA256SUMS where the member path checks the release API digest.
    _asset="$(kit_asset_name "$_glob")"
    [ -n "$_asset" ] || die "No Studio archive matching '${_glob}' in the class kit (it was built without ${PLATFORM})"
    kit_verify "$_asset"
    _tmp="$(mktemp -d)"; _zip="${KIT_DIR}/${_asset}"
    info "Using the verified archive from the class kit…"
  else
    _url="$(gh_asset_url "$_glob")"
    [ -n "$_url" ] || die "No Studio asset matching '${_glob}' in ${STUDIO_RELEASES_REPO} v${STUDIO_VERSION} (fail-closed: ${PLATFORM} build may not exist yet)"
    _tmp="$(mktemp -d)"; _zip="${_tmp}/studio.zip"
    printf '%s' "$_url" | grep -Eq '^https://api\.github\.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/[0-9]+$' || die "Untrusted release asset URL"
    _digest="$(gh api "$_url" --jq '.digest')" || die "Cannot read asset digest"
    printf '%s' "$_digest" | grep -Eq '^sha256:[a-fA-F0-9]{64}$' || die "Missing release SHA-256"
    info "Downloading verified private release…"
    gh api "$_url" -H 'Accept: application/octet-stream' > "$_zip" || die "Private release download failed"
    _actual="$(shasum -a 256 "$_zip" | awk '{print $1}')"
    [ "$_actual" = "${_digest#sha256:}" ] || die "Release SHA-256 mismatch"
  fi
  info "Unzipping to ${APPS_DIR}…"
  ( cd "$_tmp" && unzip -q -o "$_zip" ) || die "unzip failed"
  _app="$(cd "$_tmp" && find . -maxdepth 2 -name '*.app' -type d | head -n1)"
  [ -n "$_app" ] || die "no .app found in downloaded archive"
  rm -rf "$STUDIO_APP"
  cp -R "${_tmp}/${_app#./}" "$STUDIO_APP" 2>/dev/null || \
    ditto "${_tmp}/${_app#./}" "$STUDIO_APP"
  xattr -dr com.apple.quarantine "$STUDIO_APP" 2>/dev/null || true
  rm -rf "$_tmp"
  receipt_note "studio" "$STUDIO_VERSION"
  ok "Studio ${STUDIO_VERSION} installed to ${APPS_DIR}"
}

# Resolve the canonical seed script: prefer a local sibling (repo checkout or a
# curl -O download); otherwise fetch it from the same raw base as install.sh.
# Echoes the path to run, or empty on failure.
resolve_seed_script() {
  # Class kit: the kit's seeder, which seed_sdk has already checked against the
  # kit's SHA256SUMS. Never a sibling file, never a fetch.
  if [ -n "$KIT_DIR" ]; then
    printf '%s\n' "${KIT_DIR}/${SEED_SCRIPT_NAME}"; return 0
  fi
  _self_dir=""
  # $0 is meaningful only when run from a file (not curl | bash).
  case "$0" in
    */*) _self_dir="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" ;;
  esac
  if [ -n "$_self_dir" ] && [ -f "${_self_dir}/${SEED_SCRIPT_NAME}" ]; then
    printf '%s\n' "${_self_dir}/${SEED_SCRIPT_NAME}"; return 0
  fi
  _dl="$(mktemp -d)/${SEED_SCRIPT_NAME}"
  if fetch_bootstrap_script "$SEED_SCRIPT_NAME" "$_dl"; then
    printf '%s\n' "$_dl"; return 0
  fi
  return 1
}

# app_sdk_version — the native SDK binary version the installed Studio app loads. The
# build vendors the Agent SDK package into the bundled extension
# (scripts/inject-builtin-extensions.sh); its optionalDependencies name the native
# package for each platform with the exact version. Empty when no app is installed,
# the file is missing, or the platform is not darwin-arm64 (the only Mac build).
app_sdk_version() {
  _pkg="${STUDIO_APP}/Contents/Resources/app/extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk/package.json"
  [ -f "$_pkg" ] || return 0
  grep -o '"@anthropic-ai/claude-agent-sdk-darwin-arm64" *: *"[0-9][0-9A-Za-z.-]*"' "$_pkg" \
    | head -n1 | sed 's/.*: *"\([^"]*\)"$/\1/'
}

seed_sdk() {
  # Delegate to the canonical seed-sdk-binary.sh (single source of truth for the
  # package, pinned version 0.3.207, sha512 table, seeded location, and the
  # runtime-trusted marker). An earlier inline copy here drifted (wrong package/
  # version, a marker schema + linux path the Studio runtime would not trust).
  step "Seeding native SDK binary (canonical ${SEED_SCRIPT_NAME})"
  # Class kit: a damaged seeder stops the install here. Verified in this shell,
  # because a die inside the command substitution below would only be a warning.
  [ -z "$KIT_DIR" ] || kit_verify "$SEED_SCRIPT_NAME"
  _seed="$(resolve_seed_script)" || {
    SDK_SEED_STAGE="unavailable"
    warn "${SEED_SCRIPT_NAME} 를 받지 못했습니다 (로컬 또는 ${RAW_BASE}). $(sdk_seed_consequence)"
    return 0
  }
  # Seed the SDK version the installed app loads, not the seeder's own pin: the
  # seeder comes from main, which can pin a newer SDK than the latest release
  # (after #1634 main pinned 0.3.299 while v0.1.56 loads 0.3.207, and a seeded
  # binary of another version is never found). The seeder takes a non-pinned
  # version's integrity from the npm registry.
  _sdk_version="${HPS_SDK_VERSION:-$(app_sdk_version)}"
  [ -n "$_sdk_version" ] && info "SDK version the installed app loads: ${_sdk_version}"
  # Pass --platform on Linux where auto-detect may need help; darwin auto-detects.
  if bash "$_seed" ${_sdk_version:+--version "$_sdk_version"}; then
    # Record the version the seeder actually wrote (from its verified marker).
    _mk="$(find "${STUDIO_SUPPORT%/*}/HypeProof-Studio/sdk" \
             "${XDG_CONFIG_HOME:-$HOME/.config}/HypeProof-Studio/sdk" \
             -name 'claude.verified.json' 2>/dev/null | head -n1)"
    if [ -n "$_mk" ] && have grep; then
      _rv="$(grep -o '"sdkVersion": *"[^"]*"' "$_mk" 2>/dev/null | head -n1 | sed 's/.*"sdkVersion": *"\([^"]*\)".*/\1/')"
      [ -n "$_rv" ] && receipt_note "sdk" "$_rv"
    fi
    ok "SDK seeded (canonical seeder)"
  else
    SDK_SEED_RC=$?
    SDK_SEED_STAGE="failed"
    warn "${SEED_SCRIPT_NAME} 실행이 실패했습니다 (종료 코드 ${SDK_SEED_RC}). $(sdk_seed_consequence)"
  fi
}

# sdk_seed_consequence — what a missing seed means for this install. Only the
# macOS doctor checks the seed (it is the only platform that installs the Studio
# app), so only there may the warning say the install will stop. Linux keeps a
# warning with a re-run hint and must not promise a stop the doctor never makes.
sdk_seed_consequence() {
  if [ "$OS" = "darwin" ]; then
    printf '%s\n' '마지막 점검에서 설치가 멈춥니다.'
  else
    printf '%s\n' '이 컴퓨터에는 Studio 앱을 설치하지 않으므로 설치는 계속됩니다. SDK가 필요하면 인터넷(registry.npmjs.org) 연결을 확인한 뒤 설치를 다시 실행하세요.'
  fi
}

# sdk_seed_stage_label — the stage a missing seed stopped at, in the learner's
# language. Reads SDK_SEED_STAGE / SDK_SEED_RC set by seed_sdk.
sdk_seed_stage_label() {
  case "$SDK_SEED_STAGE" in
    unavailable) printf '시드 스크립트 받기 (%s)\n' "$SEED_SCRIPT_NAME" ;;
    failed)      printf '시드 스크립트 실행 (%s, 종료 코드 %s)\n' "$SEED_SCRIPT_NAME" "${SDK_SEED_RC:-?}" ;;
    *)           printf '검증 표시 확인 (claude.verified.json 없음)\n' ;;
  esac
}

# sdk_seed_recovery_cmd — the command that re-runs the installer the same way it
# was started. A class kit re-runs its own verified copy (no GitHub); a member
# re-runs the one-liner from this file's header. The installer is idempotent.
sdk_seed_recovery_cmd() {
  if [ -n "$KIT_DIR" ]; then
    printf 'bash "%s/install.sh" --kit "%s"\n' "$KIT_DIR" "$KIT_DIR"
  else
    printf '%s\n' 'gh api repos/hypeproof/hypeproof-studio/contents/scripts/install.sh -H "Accept: application/vnd.github.raw" > /tmp/hps-bootstrap.sh && bash /tmp/hps-bootstrap.sh'
  fi
}

install_studio() {
  [ "${HPS_SKIP_STUDIO:-0}" = "1" ] && { warn "HPS_SKIP_STUDIO=1 — skipping Studio app + SDK seed"; return 0; }
  resolve_studio_version
  step "Installing HypeProof Studio ${STUDIO_VERSION}"
  if [ "$OS" = "darwin" ]; then
    install_studio_mac
    seed_sdk
  else
    warn "Studio desktop app has no first-class Linux build in manifest v${STUDIO_VERSION}; installing runtime deps only."
    warn "Seeding SDK is still useful for headless/CLI use."
    seed_sdk
  fi
}

# ----------------------------------------------------------------------------- #
# 8. `hps doctor` — fail-closed re-verify of the SAME manifest
# ----------------------------------------------------------------------------- #
doctor() {
  step "Verify pass: hps doctor (fail-closed)"
  _fail=0
  for _id in $DEP_IDS; do
    _bin="$(dep_binary "$_id")"
    if have "$_bin" || { dep_preinstalled_ok "$_id" && [ -x "/bin/$_id" ]; }; then
      _ver="$(eval "$(dep_check_cmd "$_id")" 2>/dev/null | head -n1)"
      if dep_satisfies_min "$_id"; then
        ok "${_id}: ${_ver:-present}"
      else
        # fail-closed — 헤더가 약속한 "re-verifies the SAME manifest" 를 실제로 지킨다.
        warn "${_id}: ${_ver:-present} — manifest 최소 $(dep_min_version "$_id") 미만. 'brew install $(dep_brew_pkg "$_id")' 후 새 터미널에서 재시도"
        _fail=1
      fi
    else
      warn "${_id}: MISSING — remediation: re-run installer, or install '$(dep_brew_pkg "$_id")' via brew"
      _fail=1
    fi
  done

  # gh auth is a warn, never a doctor failure (matches manifest gh.post).
  # Class kit: no GitHub login is involved, so there is nothing to report.
  if [ -z "$KIT_DIR" ] && have gh; then
    if gh auth status >/dev/null 2>&1; then ok "gh: authenticated"; else warn "gh: unauthenticated (run 'gh auth login')"; fi
  fi

  if [ "${HPS_SKIP_STUDIO:-0}" != "1" ] && [ "$OS" = "darwin" ]; then
    if [ -d "$STUDIO_APP" ]; then ok "Studio: installed"; else warn "Studio: not found — remediation: re-run installer"; _fail=1; fi
    # Canonical marker written by seed-sdk-binary.sh is <version>/claude.verified.json
    # (darwin under Application Support, linux under XDG_CONFIG_HOME).
    if ls "${STUDIO_SUPPORT}/sdk"/*/claude.verified.json >/dev/null 2>&1 \
       || ls "${XDG_CONFIG_HOME:-$HOME/.config}/HypeProof-Studio/sdk"/*/claude.verified.json >/dev/null 2>&1; then
      ok "SDK: seeded + verified"
    else
      # Fail closed, like install.ps1's doctor. Studio has no in-app fetch for the
      # native binary, so the old warning that promised a repair on first launch
      # let the install report success and left the coach without its tools.
      warn "SDK: 설치되지 않았습니다 — 멈춘 단계: $(sdk_seed_stage_label)"
      warn "  이대로는 Studio 코치가 작업 도구를 쓸 수 없습니다. Studio는 이 파일을 스스로 받지 않습니다."
      warn "  복구: 인터넷(registry.npmjs.org) 연결을 확인한 뒤 설치를 다시 실행하세요:"
      warn "    $(sdk_seed_recovery_cmd)"
      _fail=1
    fi
  fi

  if [ "$_fail" -ne 0 ]; then
    die "doctor found unmet manifest requirements (see above). Exiting non-zero."
  fi
  ok "doctor: all manifest checks passed"
}

# ----------------------------------------------------------------------------- #
# 9. Main
# ----------------------------------------------------------------------------- #
# 테스트 훅 — `HPS_LIB_ONLY=1 . scripts/install.sh` 로 부르면 함수 정의만 하고
# 아무것도 설치하지 않는다. scripts/test-installer-version-gate.sh 가 이걸로
# 버전 게이트를 대조군과 함께 검증한다. 이 줄 위는 전부 정의부여야 한다.
[ "${HPS_LIB_ONLY:-0}" = "1" ] && return 0 2>/dev/null

printf '%s\n' "${C_BOLD}HypeProof bootstrap — platform ${PLATFORM}, manifest schema ${MANIFEST_SCHEMA}${C_RESET}"
[ "$NONINTERACTIVE" = "1" ] && info "(unattended mode)"

have curl || die "curl is required to bootstrap and was not found."

if [ -n "$KIT_DIR" ]; then kit_preflight; fi
ensure_brew
check_deps
install_studio
doctor

step "Done"
ok "HypeProof is ready. Open a new terminal (or 'source ${RC_FILE}') so PATH edits take effect."
[ "$OS" = "darwin" ] && [ -d "$STUDIO_APP" ] && \
  info "Launch: open '${STUDIO_APP}'"
exit 0
