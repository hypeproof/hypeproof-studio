#!/bin/bash
# HypeProof Studio @@TAG@@ installer for macOS (Apple Silicon). Generated per release.
#
#   curl -fsSL https://github.com/hypeproof/hypeproof-studio/releases/download/@@TAG@@/install-mac.sh | bash
#
# Template: scripts/release/templates/install-mac.sh, rendered by
# scripts/release/install-kit.mjs in verify-unified-release.yml's publish job. Every
# value in the "Baked in at release time" block is this release's own: the tag, the
# commit it was built from and the SHA-256 of its darwin-arm64 zip. Nothing is looked
# up at run time, so this script installs exactly this build or nothing.
#
# curl is the normal download transport. SHA-256/version checks do not establish
# Apple signing, notarization or Gatekeeper acceptance. Existing quarantine
# attributes and macOS security settings are preserved; consult release evidence
# for signing/notarization status, and report any macOS launch refusal.
#
# Layouts:
#   app  ~/Applications/HypeProof Studio.app (default for a stable tag).
#        --system puts it in /Applications instead (must be writable; never sudo).
#   kit  side-by-side test install (default for an -rc tag, and what the Test Kit's
#        INSTALL-*.command uses): ~/Applications/<kit dir>/HypeProof Studio.app with its
#        own RC profile at ~/Library/Application Support/HPS-RC-Profiles/<version>/ and a
#        START-<version>.command beside the app. An existing main install is untouched.
#
# What it reuses rather than reimplements:
#   - the app install steps of scripts/install.sh (install_studio_mac): verified zip,
#     extract and replace while preserving extended attributes;
#   - the native SDK seed: this release's own claude-agent-sdk-darwin-arm64-<v>.tgz,
#     installed by the canonical scripts/seed-sdk-binary.sh --tarball, exactly as Lab's
#     open install (hypeprooflab web/public/install/studio/install-mac.sh) does. The
#     seeder is fetched at this release's source commit and checked against its SHA-256.
#
# Options (after `bash -s --` when piped):
#   --layout app|kit   override the default layout
#   --system           app layout in /Applications
#   --no-seed          skip the SDK seed (the coach cannot start until it is seeded; the
#                      in-app download offer, REQ-M46, is off by default)
#   --open             start Studio when done
#   --from-command     run by the Test Kit's INSTALL-*.command: pause before
#                      closing on error (retained for compatibility)
# Install outcome (CONV-DEC-08, PRA-15): one anonymous, count-only POST at the end, to
# https://api.hypeproof-ai.xyz/v1/install/events, with exactly
#   {"result":"ok"|"fail","step":"done"|<failed step>,"os":"macos","app_version":"<version>"}
# No id, path, hostname or error text. HPS_NO_INSTALL_PING=1 skips it. The ping has a short
# timeout, is never retried, and never changes this script's exit code.
# Test seams: HPS_INSTALL_ASSET_DIR=<dir> takes the zip, seed and seeder from a local
# folder instead of the network (checksums still apply); HPS_INSTALL_UNAME_M fakes the arch;
# HPS_INSTALL_PING_URL points the outcome ping elsewhere (a base URL or the full endpoint).
set -euo pipefail

# ── Baked in at release time ─────────────────────────────────────────────────
HPS_TAG="@@TAG@@"
HPS_VERSION="@@VERSION@@"
HPS_APP_VERSION="@@APP_VERSION@@"
HPS_SOURCE_SHA="@@SOURCE_SHA@@"
HPS_ZIP_NAME="HypeProof-Studio-darwin-arm64.zip"
HPS_ZIP_SHA256="@@ZIP_SHA256@@"
HPS_SEED_NAME="@@SEED_NAME@@"
HPS_SEED_SHA256="@@SEED_SHA256@@"
HPS_SEED_VERSION="@@SEED_VERSION@@"
HPS_SEEDER_SHA256="@@SEEDER_SHA256@@"
HPS_PRERELEASE="@@PRERELEASE@@"
HPS_FREE_START="@@FREE_START@@"
HPS_KIT_DIR_NAME="@@KIT_DIR_NAME@@"
# ─────────────────────────────────────────────────────────────────────────────

HPS_REPO="hypeproof/hypeproof-studio"
HPS_BUNDLE_ID="ai.hypeproof.studio"
APP_NAME="HypeProof Studio.app"
RELEASE_URL="https://github.com/$HPS_REPO/releases/download/$HPS_TAG"
SEEDER_URL="https://raw.githubusercontent.com/$HPS_REPO/$HPS_SOURCE_SHA/scripts/seed-sdk-binary.sh"
ONE_LINER="curl -fsSL $RELEASE_URL/install-mac.sh | bash"

LAYOUT=""
SYSTEM=0
SEED=1
OPEN=0
FROM_COMMAND=0

# ── Install outcome ping (count only) ────────────────────────────────────────
# INSTALL_STEP names the stage in progress, so a failure reports where it stopped. The
# Service allows: preflight dependencies download verify extract place launch other.
INSTALL_STEP=preflight
PING_SENT=0
WORK=""
install_ping() {
  # $1 = ok|fail, $2 = step. Sends at most once per run; every error is swallowed.
  [ "$PING_SENT" = 0 ] || return 0
  PING_SENT=1
  [ "${HPS_NO_INSTALL_PING:-}" != 1 ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local version=unknown
  if [[ "$HPS_VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,5}(-[0-9A-Za-z.]{1,16})?$ ]]; then
    version="$HPS_VERSION"
  fi
  # A base URL or the full endpoint, as the Lab open install accepts.
  local url="${HPS_INSTALL_PING_URL:-https://api.hypeproof-ai.xyz}"
  url="${url%/}"
  case "$url" in */v1/install/events) ;; *) url="$url/v1/install/events" ;; esac
  # -q first: a ~/.curlrc (retry, output) must not turn one ping into several.
  curl -q --silent --output /dev/null --proto '=http,https' --connect-timeout 2 --max-time 3 \
    -X POST -H 'content-type: application/json' \
    --data "{\"result\":\"$1\",\"step\":\"$2\",\"os\":\"macos\",\"app_version\":\"$version\"}" \
    "$url" >/dev/null 2>&1 || true
  return 0
}
on_exit() {
  local rc=$?
  [ -z "$WORK" ] || rm -rf "$WORK"
  # An exit outside fail() (set -e, a signal) still counts once, at the step in progress.
  [ "$rc" = 0 ] || install_ping fail "$INSTALL_STEP"
  exit "$rc"
}
trap on_exit EXIT

say() { printf "\n\033[1;35m▶ %s\033[0m\n" "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf "\033[1;33m주의:\033[0m %s\n" "$*" >&2; }
fail() {
  printf "\n\033[1;31m설치를 멈췄습니다:\033[0m %s\n" "$1" >&2
  install_ping fail "$INSTALL_STEP"
  if [ "$FROM_COMMAND" = 1 ] && { : < /dev/tty; } 2>/dev/null; then
    read -r -p 'Enter 키를 누르면 닫습니다. ' _ < /dev/tty || true
  fi
  exit 1
}

# The options as given, so a failed seed can print the exact command that repeats this install.
RETRY_ARGS=""
for a in "$@"; do RETRY_ARGS="$RETRY_ARGS $a"; done
while [ $# -gt 0 ]; do
  case "$1" in
    --layout) LAYOUT="${2:-}"; shift 2 || fail "--layout 뒤에 app 또는 kit 를 적어 주세요." ;;
    --system) SYSTEM=1; shift ;;
    --no-seed) SEED=0; shift ;;
    --open) OPEN=1; shift ;;
    --from-command) FROM_COMMAND=1; shift ;;
    -h|--help) sed -n '2,40p' "$0" 2>/dev/null || true; exit 0 ;;
    *) fail "알 수 없는 옵션입니다: $1" ;;
  esac
done
if [ -z "$LAYOUT" ]; then
  if [ "$HPS_PRERELEASE" = 1 ]; then LAYOUT=kit; else LAYOUT=app; fi
fi
case "$LAYOUT" in app|kit) ;; *) fail "--layout 은 app 또는 kit 만 됩니다." ;; esac
[ "$SYSTEM" = 0 ] || [ "$LAYOUT" = app ] || fail "--system 은 app 설치에만 씁니다."

# ── Machine checks ───────────────────────────────────────────────────────────
[ "$(uname -s)" = Darwin ] || fail "이 설치 명령은 Mac용입니다."
ARCH="${HPS_INSTALL_UNAME_M:-$(uname -m)}"
[ "$ARCH" = arm64 ] || fail "Apple 칩(M1 이후) Mac만 지원합니다. 이 Mac은 $ARCH 입니다. Intel Mac용 HypeProof Studio는 아직 없습니다."
[ "$(id -u)" != 0 ] || fail "sudo 없이 실행해 주세요. 이 설치는 관리자 권한이 필요 없습니다."
INSTALL_STEP=dependencies
for tool in curl shasum ditto /usr/libexec/PlistBuddy; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool 을 찾지 못했습니다."
done

INSTALL_STEP=preflight

# ── Paths ────────────────────────────────────────────────────────────────────
if [ "$LAYOUT" = kit ]; then
  PARENT="$HOME/Applications/$HPS_KIT_DIR_NAME"
  STATE="$HOME/Library/Application Support/HPS-$HPS_VERSION"
  if [ "$HPS_PRERELEASE" = 1 ]; then STATE="$HOME/Library/Application Support/HPS-RC-Profiles/$HPS_VERSION"; fi
  MARKER=".hps-kit-$HPS_VERSION"
  START="$PARENT/START-$HPS_VERSION.command"
elif [ "$SYSTEM" = 1 ]; then
  PARENT="/Applications"
else
  PARENT="$HOME/Applications"
fi
APP="$PARENT/$APP_NAME"

# Exact text marker: schema, fixed namespace, candidate, embedded version, source, app, profile.
rc_marker() { printf '%s\n' hps-rc-profile-v1 'HypeProof Studio RC' "$HPS_VERSION" "$HPS_APP_VERSION" "$HPS_SOURCE_SHA" "$APP" "$STATE"; }
check_rc_path() {
  local target="$1" current="$HOME" part
  local relative="${target#"$HOME"/}"
  while [ -n "$relative" ]; do
    part="${relative%%/*}"
    current="$current/$part"
    [ ! -L "$current" ] || fail "RC 경로가 심볼릭 링크여서 멈췄습니다: $current"
    if [ "$relative" = "$part" ]; then break; fi
    relative="${relative#*/}"
  done
}
plist() { /usr/libexec/PlistBuddy -c "Print $1" "$2/Contents/Info.plist" 2>/dev/null || true; }

# ── Safety checks (nothing is written before these pass) ─────────────────────
if [ -L "$PARENT" ] || [ -L "$APP" ]; then
  fail "설치 경로가 심볼릭 링크여서 멈췄습니다: $APP"
fi
if [ "$LAYOUT" = kit ]; then
  [ ! -L "$STATE" ] || fail "프로필 경로가 심볼릭 링크여서 멈췄습니다: $STATE"
  if [ -e "$PARENT" ] && [ ! -f "$PARENT/$MARKER" ]; then
    fail "같은 이름의 다른 폴더가 있어 덮어쓰지 않습니다: $PARENT"
  fi
  if [ "$HPS_PRERELEASE" = 1 ]; then
    [[ "$HOME" != *$'\n'* && "$HOME" != *$'\r'* ]] || fail "설치 경로에 줄바꿈이 있습니다."
    check_rc_path "$APP"
    check_rc_path "$STATE"
    if [ -e "$STATE" ]; then
      if [ ! -f "$STATE/.hps-rc-profile-v1" ] || [ -L "$STATE/.hps-rc-profile-v1" ] || ! cmp -s "$STATE/.hps-rc-profile-v1" <(rc_marker); then
        fail "기존 RC 프로필의 버전·소스·경로가 맞지 않습니다. 기존 프로필은 변경하지 않았습니다."
      fi
      if [ ! -f "$PARENT/.hps-rc-profile-v1" ] || [ -L "$PARENT/.hps-rc-profile-v1" ] || ! cmp -s "$PARENT/.hps-rc-profile-v1" <(rc_marker); then
        fail "기존 RC 키트의 프로필 표식이 맞지 않습니다."
      fi
    fi
  elif [ -e "$STATE" ] && [ ! -f "$STATE/$MARKER" ]; then
    fail "같은 이름의 다른 프로필이 있어 덮어쓰지 않습니다: $STATE"
  fi
elif [ -e "$APP" ]; then
  [ "$(plist CFBundleIdentifier "$APP")" = "$HPS_BUNDLE_ID" ] \
    || fail "$APP 는 HypeProof Studio가 아닌 것 같아 덮어쓰지 않습니다."
fi
if [ "$SYSTEM" = 1 ] && [ ! -w /Applications ]; then
  fail "/Applications 에 쓸 수 없습니다. sudo 대신 --system 없이 실행하면 ~/Applications 에 설치합니다."
fi
if pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; then
  fail "설치하려는 HypeProof Studio가 실행 중입니다. Studio를 종료한 뒤 다시 실행해 주세요."
fi

WORK="$(mktemp -d)"

# fetch <name> <dest> [url] — a release asset by default; the local folder under the test seam.
fetch() {
  if [ -n "${HPS_INSTALL_ASSET_DIR:-}" ]; then
    cp "$HPS_INSTALL_ASSET_DIR/$1" "$2"
  else
    curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --silent --show-error \
      --output "$2" "${3:-$RELEASE_URL/$1}"
  fi
}
sha256() { shasum -a 256 "$1" | awk '{print $1}'; }

# ── Download + verify ────────────────────────────────────────────────────────
INSTALL_STEP=download
say "HypeProof Studio $HPS_VERSION 내려받는 중 (약 170MB)"
fetch "$HPS_ZIP_NAME" "$WORK/studio.zip" || fail "내려받지 못했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요."
INSTALL_STEP=verify
ACTUAL="$(sha256 "$WORK/studio.zip")"
[ "$ACTUAL" = "$HPS_ZIP_SHA256" ] || fail "내려받은 파일이 $HPS_TAG 원본과 다릅니다(SHA-256 불일치). 설치하지 않았습니다.
  기대값: $HPS_ZIP_SHA256
  실제값: $ACTUAL"
note "SHA-256 확인: $ACTUAL"

INSTALL_STEP=extract
say "압축 푸는 중"
mkdir "$WORK/x"
ditto -xk "$WORK/studio.zip" "$WORK/x" || fail "압축을 풀지 못했습니다."
NEW="$WORK/x/$APP_NAME"
[ -f "$NEW/Contents/Info.plist" ] || fail "압축 안에서 $APP_NAME 을 찾지 못했습니다."
INSTALL_STEP=verify
[ "$(plist CFBundleIdentifier "$NEW")" = "$HPS_BUNDLE_ID" ] || fail "앱 식별자가 맞지 않습니다."
GOT="$(plist CFBundleShortVersionString "$NEW")"
[ "$GOT" = "$HPS_APP_VERSION" ] || fail "앱 버전이 맞지 않습니다(기대 $HPS_APP_VERSION, 실제 $GOT)."
if [ "$LAYOUT" = kit ] && [ "$HPS_PRERELEASE" = 1 ]; then
  PRODUCT="$NEW/Contents/Resources/app/product.json"
  [ "$(/usr/bin/plutil -extract commit raw -o - "$PRODUCT" 2>/dev/null)" = "$HPS_SOURCE_SHA" ] || fail "RC 앱의 소스가 이 설치 명령과 다릅니다."
  [ "$(/usr/bin/plutil -extract version raw -o - "$PRODUCT" 2>/dev/null)" = "$HPS_APP_VERSION" ] || fail "RC 앱 내부 버전이 이 설치 명령과 다릅니다."
fi

# ── Install: stage beside the target, then swap (the old copy returns on failure) ──
INSTALL_STEP=place
say "$APP 에 설치하는 중"
mkdir -p "$PARENT"
[ "$LAYOUT" != kit ] || touch "$PARENT/$MARKER"
STAGE="$PARENT/.hps-install-$$"
OLD="$PARENT/.hps-previous-$$"
rm -rf "$STAGE" "$OLD"
ditto "$NEW" "$STAGE" || { rm -rf "$STAGE"; fail "앱을 복사하지 못했습니다."; }
if [ -e "$APP" ]; then mv "$APP" "$OLD"; fi
if ! mv "$STAGE" "$APP"; then
  [ ! -e "$OLD" ] || mv "$OLD" "$APP"
  rm -rf "$STAGE"
  fail "앱을 제자리에 옮기지 못했습니다. 이전 설치는 그대로 두었습니다."
fi
rm -rf "$OLD"
# Read-only diagnostic. Both install entry points preserve quarantine attributes.
if xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1; then
  warn "앱에 다운로드 격리 표시가 있습니다. macOS가 설치나 실행을 막으면 멈추고 오류 문구를 전달하세요. 보안 설정이나 격리 속성은 변경하지 마세요."
fi
[ "$(plist CFBundleShortVersionString "$APP")" = "$HPS_APP_VERSION" ] || fail "설치된 앱 버전을 확인하지 못했습니다."

# ── Kit layout: own profile + START script ───────────────────────────────────
if [ "$LAYOUT" = kit ]; then
  mkdir -p "$STATE/User" "$STATE/extensions"
  chmod 700 "$STATE"
  if [ "$HPS_PRERELEASE" = 1 ]; then
    rc_marker > "$STATE/.hps-rc-profile-v1"
    rc_marker > "$PARENT/.hps-rc-profile-v1"
    chmod 600 "$STATE/.hps-rc-profile-v1" "$PARENT/.hps-rc-profile-v1"
  else
    touch "$STATE/$MARKER"
  fi
  if [ ! -f "$STATE/User/settings.json" ]; then
    cat > "$STATE/User/settings.json" <<JSON
{
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "window.title": "HypeProof $HPS_VERSION 테스트 — \${rootName}"
}
JSON
  fi
  cat > "$START" <<'START_COMMAND'
@@START_COMMAND@@
START_COMMAND
  chmod 755 "$START"
fi

# ── Native SDK seed (same tarball + seeder the Lab open install uses) ────────
# A failed seed is a warning, not a failed install: the app is in place.
INSTALL_STEP=other
if [ "$SEED" = 1 ] && [ -n "$HPS_SEED_NAME" ]; then
  say "AI 코치 실행 파일($HPS_SEED_VERSION) 준비하는 중 (약 110MB)"
  seed_ok=0
  if fetch "seed-sdk-binary.sh" "$WORK/seed-sdk-binary.sh" "$SEEDER_URL" \
    && [ "$(sha256 "$WORK/seed-sdk-binary.sh")" = "$HPS_SEEDER_SHA256" ] \
    && fetch "$HPS_SEED_NAME" "$WORK/$HPS_SEED_NAME" \
    && [ "$(sha256 "$WORK/$HPS_SEED_NAME")" = "$HPS_SEED_SHA256" ] \
    && bash "$WORK/seed-sdk-binary.sh" --tarball "$WORK/$HPS_SEED_NAME" --version "$HPS_SEED_VERSION"; then
    seed_ok=1
  fi
  if [ "$seed_ok" = 0 ]; then
    # Studio does not fetch the file by itself: its offer (REQ-M46) is off by default. Name the
    # one recovery that always works, the same install again.
    if [ "$FROM_COMMAND" = 1 ]; then
      retry="받은 폴더의 INSTALL-$HPS_VERSION.command 를 한 번 더 여세요."
    elif [ -n "$RETRY_ARGS" ]; then
      retry="인터넷 연결을 확인한 뒤 이 명령을 한 번 더 실행하세요: $ONE_LINER -s --$RETRY_ARGS"
    else
      retry="인터넷 연결을 확인한 뒤 이 명령을 한 번 더 실행하세요: $ONE_LINER"
    fi
    warn "AI 코치 실행 파일을 준비하지 못했습니다. 앱은 설치됐지만, 이 파일이 없으면 AI 코치가 대답하지 못할 수 있습니다. $retry"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────
install_ping ok "done"
printf "\n\033[1;32mHypeProof Studio %s 설치를 마쳤습니다.\033[0m\n" "$HPS_VERSION"
note "앱: $APP"
if [ "$LAYOUT" = kit ]; then
  note "프로필: $STATE (기존 HypeProof Studio와 따로 저장됩니다)"
  note "실행: open \"$START\""
else
  note "실행: open \"$APP\""
fi
printf '\n다음 순서:\n'
if [ "$HPS_FREE_START" = 1 ]; then
  note "1. Studio를 엽니다. 참여 코드는 필요 없습니다."
  note "2. 나이를 묻는 질문에 답합니다."
  note "3. 바로 AI 코치와 대화를 시작합니다."
else
  note "1. Studio를 엽니다."
  note "2. 강사에게 받은 참여 코드를 처음 화면에 붙여넣습니다."
fi
note "키체인 권한 때문에 막히면 취소하고 오류 문구를 전달하세요. 암호 입력이나 기존 키체인 권한 변경은 테스트 절차가 아닙니다."
printf '\n같은 빌드를 다시 설치하는 명령:\n  %s\n' "$ONE_LINER"

if [ "$OPEN" = 1 ]; then
  if [ "$LAYOUT" = kit ]; then exec /bin/bash "$START"; else open "$APP"; fi
fi
