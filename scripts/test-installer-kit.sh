#!/usr/bin/env bash
# Regression test for the class kit path (docs/INSTALL-CLASS-KIT.ko.md):
# scripts/make-class-kit.sh builds a kit, scripts/install.sh --kit installs from it.
#
# Nothing real is installed and no network is used. A stub gh serves a fake
# release, the dependency tools are stubs, HOME is a temporary folder, and
# HPS_APPS_DIR (the installer's test seam) points the app copy at a temporary
# folder. A run cannot touch a real installation.
#
# What must hold:
#   1. The kit holds the archive and the helper scripts, its SHA256SUMS agrees
#      with an independent `shasum -c`, and nothing about the member is in it.
#   2. install.sh --kit installs the app and runs the kit's seeder. The only gh
#      call is the dependency check's `gh --version`.
#   3. Negative controls: a damaged archive, a damaged seeder, a missing or
#      malformed SHA256SUMS and a kit built for another platform each stop the
#      install, and the damaged seeder is never executed.
#   4. Positive control for the instrument: without --kit the same sandbox takes
#      the member path and the gh log fills up. So "gh was not called" in 2 and
#      3 is a measurement, not a stub that cannot see.
# shellcheck disable=SC2016  # the stub bodies below are literal sh, expanded when a stub runs
set -uo pipefail

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) echo "SKIP: install.sh supports macOS and Linux only"; exit 0 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Instrument only the absolute Apple executables in a disposable source copy.
# Production has no signing override; these fixtures do not prove Apple signing.
mkdir -p "$WORK/repo/scripts"
for f in make-class-kit.sh install.ps1 seed-sdk-binary.sh seed-sdk-binary.ps1; do
  cp "$REPO_ROOT/scripts/$f" "$WORK/repo/scripts/$f"
done
sed -e 's|/usr/libexec/PlistBuddy|PlistBuddy|g' -e 's|/usr/bin/codesign|codesign|g' \
  -e 's|/usr/sbin/spctl|spctl|g' "$REPO_ROOT/scripts/install.sh" > "$WORK/repo/scripts/install.sh"
REPO_ROOT="$WORK/repo"

fail=0
pass() { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=1; }

# ---------------------------------------------------------------------------- #
# Sandbox
# ---------------------------------------------------------------------------- #
BIN="$WORK/bin"; LOG="$WORK/log"; REL="$WORK/release"; SB_HOME="$WORK/home"
mkdir -p "$BIN" "$LOG" "$REL" "$SB_HOME" "$WORK/tmp"

# A fake release: a zip with a minimal app bundle, the Windows user installer,
# and a system installer listed first as a decoy for the fallback glob.
mkdir -p "$REL/HypeProof Studio.app/Contents"
cat > "$REL/HypeProof Studio.app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>9.9.9</string>
<key>CFBundleIdentifier</key><string>ai.hypeproof.studio</string>
</dict></plist>
EOF
# The vendored Agent SDK package names the native binary version the app loads; the
# installer must seed that version, not the seeder's own pin. The real seeder's pin is
# used here so the run stays offline (a non-pinned version asks the npm registry).
SDK_VERSION="$(sed -n 's/^PINNED_VERSION="\(.*\)"$/\1/p' "$REPO_ROOT/scripts/seed-sdk-binary.sh")"
VENDOR="$REL/HypeProof Studio.app/Contents/Resources/app/extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk"
mkdir -p "$VENDOR"
printf '{"name":"@anthropic-ai/claude-agent-sdk","version":"%s","optionalDependencies":{"@anthropic-ai/claude-agent-sdk-darwin-x64":"0.0.1","@anthropic-ai/claude-agent-sdk-darwin-arm64":"%s"}}' \
  "$SDK_VERSION" "$SDK_VERSION" > "$VENDOR/package.json"
( cd "$REL" && zip -q -r HypeProof-Studio-darwin-arm64.zip "HypeProof Studio.app" )
printf 'fixture windows user installer, never executed' > "$REL/HypeProof.StudioUserSetup-x64-9.9.9.exe"
printf 'fixture windows system installer, a decoy'      > "$REL/HypeProof.StudioSetup-x64-9.9.9.exe"

# gh: a logged-in member. Every call is logged. With STUB_GH_FORBID=1 anything
# but `gh --version` fails, which is how the kit runs are held to "no GitHub".
cat > "$BIN/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG/gh.log"
if [ "$*" = "--version" ]; then echo "gh version 2.97.0 (2026-07-31)"; exit 0; fi
if [ "${STUB_GH_FORBID:-0}" = "1" ]; then echo "stub gh: forbidden call: $*" >&2; exit 97; fi
api_base="https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets"
asset_file() {
  case "$1" in
    "$api_base/101") echo "$STUB_REL/HypeProof.StudioSetup-x64-9.9.9.exe" ;;
    "$api_base/102") echo "$STUB_REL/HypeProof-Studio-darwin-arm64.zip" ;;
    "$api_base/103") echo "$STUB_REL/HypeProof.StudioUserSetup-x64-9.9.9.exe" ;;
    *) return 1 ;;
  esac
}
digest_of() {
  if [ "${STUB_BAD_DIGEST:-0}" = "1" ]; then printf 'sha256:%064d\n' 0; return; fi
  if command -v shasum >/dev/null 2>&1; then printf 'sha256:%s\n' "$(shasum -a 256 "$1" | awk '{print $1}')"
  else printf 'sha256:%s\n' "$(sha256sum "$1" | awk '{print $1}')"; fi
}
case "$1 ${2:-}" in
  "auth status") exit 0 ;;
  "release view")
    if [ "${STUB_MAC_ONLY_LATEST:-0}" = "1" ]; then echo "v9.9.10"; else echo "v9.9.9"; fi
    exit 0 ;;
  "api repos/hypeproof/hypeproof-studio-releases/releases/tags/v9.9.10")
    # A macOS-only release: the darwin archive and nothing for Windows.
    f="$(asset_file "$api_base/102")"
    printf '%s\t%s\t%s\n' "$(basename "$f")" "$api_base/102" "$(digest_of "$f")"
    exit 0 ;;
  "api repos/hypeproof/hypeproof-studio-releases/releases?per_page=100")
    # The release list, filtered by the script's own --jq expression through a real
    # jq, so the expression is measured rather than mirrored by the stub.
    filter=""; prev=""
    for a in "$@"; do [ "$prev" = "--jq" ] && filter="$a"; prev="$a"; done
    [ -n "$filter" ] && [ -n "${STUB_JQ:-}" ] || { echo "stub gh: list needs --jq and STUB_JQ" >&2; exit 96; }
    "$STUB_JQ" -r "$filter" "$STUB_RELEASES"; exit $? ;;
  "api repos/hypeproof/hypeproof-studio-releases/releases/tags/v9.9.9")
    for id in 101 102 103; do
      f="$(asset_file "$api_base/$id")"
      case "$*" in
        *'\(.digest)'*) printf '%s\t%s\t%s\n' "$(basename "$f")" "$api_base/$id" "$(digest_of "$f")" ;;
        *)              printf '%s\t%s\n'     "$(basename "$f")" "$api_base/$id" ;;
      esac
    done
    exit 0 ;;
  "api repos/hypeproof/hypeproof-studio/contents/scripts/"*)
    cat "$STUB_REPO/scripts/${2##*/}"; exit $? ;;
esac
if [ "$1" = "api" ] && f="$(asset_file "${2:-}")"; then
  case "$*" in
    *"--jq .digest"*) digest_of "$f" ;;
    *"application/octet-stream"*) cat "$f" ;;
    *) echo "stub gh: unexpected asset call: $*" >&2; exit 98 ;;
  esac
  exit 0
fi
echo "stub gh: unexpected call: $*" >&2
exit 99
EOF

# Dependency tools at versions the manifest accepts, so the installer installs
# nothing. curl answers --version only: any download attempt is logged and fails.
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$BIN/$1"; }
stub uname    'case "${1:-}" in -m) echo arm64 ;; *) echo Darwin ;; esac'
stub brew     'printf "%s\n" "$*" >> "$STUB_LOG/brew.log"; exit 1'
stub git      'if [ "${1:-}" = "--version" ]; then echo "git version 2.50.1"; else exit 1; fi'
stub node     'echo "v22.22.1"'
stub python3  'echo "Python 3.12.4"'
stub jq       'echo "jq-1.7.1"'
stub curl     'if [ "${1:-}" = "--version" ]; then echo "curl 8.7.1"; exit 0; fi; printf "%s\n" "$*" >> "$STUB_LOG/curl.log"; exit 22'
stub defaults 'sed -n "s/.*<string>\(.*\)<\/string>.*/\1/p" "$2" | head -n1'
# open: the installer opens Studio at the end of an interactive install. A test run
# is unattended and uses HPS_APPS_DIR, so it must never get here; the log proves it.
stub open     'printf "%s\n" "$*" >> "$STUB_LOG/open.log"; exit 0'
# macOS mktemp prefers the per-user temp folder over TMPDIR, and the member path
# never removes its fetched seeder. Keep every temp file inside this test's folder.
stub mktemp   'case "${1:-}" in -d) exec /usr/bin/mktemp -d "${2:-$STUB_TMP/tmp.XXXXXXXXXX}" ;; -t) exec /usr/bin/mktemp "$STUB_TMP/$2.XXXXXXXXXX" ;; *) exec /usr/bin/mktemp "$@" ;; esac'
stub PlistBuddy 'if [ "${STUB_SIGNING:-}" = wrong-bundle ]; then echo other.app; else sed -n "s/.*<key>CFBundleIdentifier<\/key><string>\(.*\)<\/string>.*/\1/p" "$3"; fi'
cat > "$BIN/codesign" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG/codesign.log"
app="${!#}"
[[ ! -e "$app/tampered" ]] || exit 1
case "${STUB_SIGNING:-}" in
  unsigned) exit 1 ;;
  old-unsigned) [[ ! -e "$app/old-sentinel" ]] || exit 1 ;;
  wrong-team|wrong-signing-id) [[ "$*" != *'-R='* ]] || exit 1 ;;
esac
if [[ "$*" == *'-R='* ]]; then
  [[ "$*" == *'identifier "ai.hypeproof.studio" and anchor apple generic'* &&
     "$*" == *'certificate 1[field.1.2.840.113635.100.6.2.6] exists'* &&
     "$*" == *'certificate leaf[field.1.2.840.113635.100.6.1.13] exists'* &&
     "$*" == *'certificate leaf[subject.OU] = "RZBNT9ZB67"'* ]] || exit 98
  [[ "$1 $2 $3" == '--verify --strict --all-architectures' ]] || exit 98
else
  [[ "$1 $2 $3 $4" == '--verify --deep --strict --all-architectures' ]] || exit 98
fi
EOF
cat > "$BIN/spctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$STUB_LOG/spctl.log"
[ "$1 $2 $3 $4" = '--assess --type execute --verbose=4' ] || exit 98
case "${STUB_SIGNING:-}" in
  notary-reject) echo rejected >&2; exit 1 ;;
  not-notarized) echo 'source=Developer ID' >&2 ;;
  disabled) echo 'assessments disabled' >&2 ;;
  spoofed-source) printf 'source=Notarized Developer ID\nsource=Unnotarized Developer ID\n' >&2 ;;
  *) echo 'source=Notarized Developer ID' >&2 ;;
esac
EOF
cat > "$BIN/cp" <<'EOF'
#!/usr/bin/env bash
dest="${!#}"
if [[ "$dest" == */.hps-install.*/*.app ]]; then
  [[ "${STUB_SIGNING:-}" != copy-fail ]] || exit 1
  /bin/cp "$@" || exit $?
  if [[ "${STUB_SIGNING:-}" == stage-tamper ]]; then touch "$dest/tampered"; fi
else
  exec /bin/cp "$@"
fi
EOF
stub ditto 'printf "%s\n" "$*" >> "$STUB_LOG/ditto.log"; exit 1'
cat > "$BIN/mv" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG/mv.log"
case "${STUB_SIGNING:-}" in
  interrupt-after-backup)
    if [[ "$2" == */previous.app ]]; then
      /bin/mv "$@" || exit $?
      kill -TERM "$PPID"
      exit 0
    fi ;;
  backup-fail) [[ "$2" != */previous.app ]] || exit 1 ;;
  swap-fail|restore-fail)
    if [[ "$1" == */.hps-install.*/* && "$2" == "$HPS_APPS_DIR/HypeProof Studio.app" ]]; then
      if [[ "$1" != */previous.app || "$STUB_SIGNING" == restore-fail ]]; then exit 1; fi
    fi ;;
esac
exec /bin/mv "$@"
EOF
stub xattr 'printf "%s\n" "$*" >> "$STUB_LOG/xattr.log"; exit 99'
chmod +x "$BIN"/*

# The real seeder leaves a valid seed alone, so a fixture seed lets the kit's own
# seed-sdk-binary.sh run to the end without the 67 MiB download.
SEED_DIR="$SB_HOME/Library/Application Support/HypeProof-Studio/sdk/$SDK_VERSION"
mkdir -p "$SEED_DIR"
printf 'fixture, not a real sdk binary' > "$SEED_DIR/claude"; chmod +x "$SEED_DIR/claude"
printf '{\n  "sdkVersion": "%s",\n  "size": %s\n}\n' "$SDK_VERSION" "$(wc -c < "$SEED_DIR/claude" | tr -d ' ')" \
  > "$SEED_DIR/claude.verified.json"

# sandboxed <apps-dir> <extra env...> -- <command...>: run with a clean environment.
TOKEN="hps-test-token-must-not-leak"
MEMBER="hps-test-member"
sandboxed() {
  local apps="$1"; shift
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done
  shift
  mkdir -p "$apps"
  env -i HOME="$SB_HOME" PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" SHELL=/bin/zsh TERM=dumb \
    TMPDIR="$WORK/tmp" USER="$MEMBER" LOGNAME="$MEMBER" GH_TOKEN="$TOKEN" \
    STUB_LOG="$LOG" STUB_REL="$REL" STUB_REPO="$REPO_ROOT" STUB_TMP="$WORK/tmp" \
    HPS_APPS_DIR="$apps" HPS_NONINTERACTIVE=1 ${extra[@]+"${extra[@]}"} "$@"
}
reset_logs() { rm -f "$LOG"/*.log; }
gh_calls_beyond_version() { grep -v -x -- '--version' "$LOG/gh.log" 2>/dev/null || true; }

# ---------------------------------------------------------------------------- #
echo "=== 1. make-class-kit.sh builds a complete kit and leaks nothing ==="
# ---------------------------------------------------------------------------- #
# The folder name has a space and Hangul ("kit" in Korean, written as UTF-8
# bytes): a USB volume or a Korean user folder looks like this.
KIT="$WORK/$(printf 'class kit \355\202\244\355\212\270')"
if out="$(sandboxed "$WORK/apps-unused" -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$KIT" 2>&1)"; then
  pass "kit built for the latest release"
else
  printf '%s\n' "$out"; bad "make-class-kit.sh failed"
fi

want="HypeProof-Studio-darwin-arm64.zip HypeProof.StudioUserSetup-x64-9.9.9.exe SHA256SUMS install.ps1 install.sh kit-info.txt seed-sdk-binary.ps1 seed-sdk-binary.sh"
got="$(cd "$KIT" 2>/dev/null && { LC_ALL=C; set -- *; echo "$*"; })"
if [ "$got" = "$want" ]; then pass "kit holds the two archives, four helper scripts, kit-info.txt and SHA256SUMS (decoy left out)"
else bad "kit contents differ: '$got'"; fi

if ( cd "$KIT" && { shasum -a 256 -c SHA256SUMS || sha256sum -c SHA256SUMS; } ) >/dev/null 2>&1; then
  pass "SHA256SUMS agrees with an independent checksum tool"
else bad "SHA256SUMS does not verify with shasum -c"; fi

same=1
for f in install.sh install.ps1 seed-sdk-binary.sh seed-sdk-binary.ps1; do
  cmp -s "$KIT/$f" "$REPO_ROOT/scripts/$f" || same=0
done
if [ "$same" = "1" ]; then pass "helper scripts are byte-identical to the instrumented source copy"; else bad "a helper script was altered on the way into the kit"; fi

if grep -R -a -l -e "$TOKEN" -e "$MEMBER" -e "$WORK" "$KIT" >/dev/null 2>&1; then
  bad "the kit contains the member's token, account name or a local path"
else pass "no token, account name or local path anywhere in the kit"; fi

if sandboxed "$WORK/apps-unused" -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$KIT" >/dev/null 2>&1; then
  bad "an existing folder was overwritten"
else pass "an existing folder is refused"; fi

if sandboxed "$WORK/apps-unused" STUB_BAD_DIGEST=1 -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-bad" >/dev/null 2>&1 \
   || [ -e "$WORK/kit-bad" ]; then
  bad "a download that does not match the release digest still produced a kit"
else pass "negative control: a release digest mismatch produces no kit"; fi

# ---------------------------------------------------------------------------- #
echo
echo "=== 2. install.sh --kit installs from the kit without GitHub ==="
# ---------------------------------------------------------------------------- #
kit_install() {  # kit_install <kit> <apps-dir> -> installer output; status = installer status
  ( cd "$1" && sandboxed "$2" STUB_GH_FORBID=1 -- bash install.sh --kit . 2>&1 )
}

reset_logs
APPS="$WORK/apps-kit"
if out="$(kit_install "$KIT" "$APPS")"; then pass "kit install exits 0"
else printf '%s\n' "$out"; bad "kit install failed"; fi

if [ -f "$APPS/HypeProof Studio.app/Contents/Info.plist" ]; then pass "app copied from the kit archive"
else bad "app was not installed"; fi

for line in '설치 파일 확인' '확인 완료 (Studio 9.9.9)' "설치된 앱이 쓰는 SDK 버전: ${SDK_VERSION}" 'AI 코치 실행 파일이 이미 준비되어 있습니다' 'SDK 준비 완료' '점검(doctor): 모든 항목 통과'; do
  if printf '%s' "$out" | grep -q -F "$line"; then pass "output has: $line"
  else bad "output lacks: $line"; fi
done

if [ -s "$LOG/gh.log" ] && [ -z "$(gh_calls_beyond_version)" ]; then
  pass "gh was called for 'gh --version' only ($(wc -l < "$LOG/gh.log" | tr -d ' ') time(s))"
else bad "unexpected gh calls: $(gh_calls_beyond_version | tr '\n' ';')"; fi

if [ -e "$LOG/curl.log" ] || [ -e "$LOG/brew.log" ]; then bad "the installer tried a download or a brew call"
else pass "no download and no brew call"; fi

if [ -e "$LOG/open.log" ]; then bad "an unattended test install tried to open Studio: $(cat "$LOG/open.log")"
else pass "an unattended install with the HPS_APPS_DIR seam does not open Studio"; fi

if [ "$(wc -l < "$LOG/spctl.log" | tr -d ' ')" = 2 ] && [ "$(wc -l < "$LOG/codesign.log" | tr -d ' ')" = 4 ] && [ ! -e "$LOG/xattr.log" ]; then
  pass "kit verifies extracted and staged apps without removing quarantine"
else bad "kit missed signing verification or removed quarantine"; fi

# A learner who is not a member reads this output: no class wording, no English
# status lines that the Korean install used to leak (2026-10-20).
for leak in '수업' 'HypeProof bootstrap' '(unattended mode)' 'class kit verified' 'Already seeded and verified' 'Using the verified archive'; do
  if printf '%s' "$out" | grep -q -F -- "$leak"; then bad "output still has: $leak"
  else pass "output no longer has: $leak"; fi
done

reset_logs
if out="$(sandboxed "$WORK/apps-piped" STUB_GH_FORBID=1 -- bash -s -- --kit "$KIT" < "$KIT/install.sh" 2>&1)" \
   && [ -d "$WORK/apps-piped/HypeProof Studio.app" ] && [ -z "$(gh_calls_beyond_version)" ]; then
  pass "piped into bash, the installer re-runs from the kit copy instead of fetching itself"
else printf '%s\n' "$out" | tail -n 5; bad "piped kit install did not stay inside the kit"; fi

# ---------------------------------------------------------------------------- #
echo
echo "=== 3. Negative controls: a kit that does not match its SHA256SUMS ==="
# ---------------------------------------------------------------------------- #
refused() {  # refused <label> <kit> <expected message>
  local label="$1" kit="$2" expect="$3" apps out
  apps="$WORK/apps-neg-$RANDOM"
  reset_logs
  if out="$(kit_install "$kit" "$apps")"; then
    bad "$label: the install went through"
  elif ! printf '%s' "$out" | grep -q -F "$expect"; then
    printf '%s\n' "$out" | tail -n 3; bad "$label: refused, but not with '$expect'"
  elif [ -e "$apps/HypeProof Studio.app" ]; then
    bad "$label: refused, but the app was installed first"
  elif [ -n "$(gh_calls_beyond_version)" ]; then
    bad "$label: gh was called"
  else
    pass "$label: refused ($expect)"
  fi
}
copy_kit() { rm -rf "$WORK/kit-neg"; cp -R "$KIT" "$WORK/kit-neg"; }
# Put a marker command right after the shebang: the seeder exits early on an
# existing seed, so a line appended at the end would never show that it ran.
damage_seeder() {
  local f="$WORK/kit-neg/seed-sdk-binary.sh"
  { head -n 1 "$f"; printf 'touch "%s/DAMAGED_SEEDER_RAN"\n' "$WORK"; tail -n +2 "$f"; } > "$f.new" && mv "$f.new" "$f"
}

copy_kit; printf 'x' >> "$WORK/kit-neg/HypeProof-Studio-darwin-arm64.zip"
refused "damaged archive" "$WORK/kit-neg" "SHA-256 mismatch for HypeProof-Studio-darwin-arm64.zip"

copy_kit; damage_seeder
refused "damaged seeder" "$WORK/kit-neg" "SHA-256 mismatch for seed-sdk-binary.sh"

copy_kit; rm "$WORK/kit-neg/SHA256SUMS"
refused "no SHA256SUMS" "$WORK/kit-neg" "SHA256SUMS not found"

copy_kit; printf '%064d  ../outside\n' 0 >> "$WORK/kit-neg/SHA256SUMS"
refused "malformed SHA256SUMS" "$WORK/kit-neg" "SHA256SUMS is malformed"

# (--out with a trailing slash, as tab completion or habit would write it.)
if sandboxed "$WORK/apps-unused" -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-win/" --platform win32-x64 >/dev/null 2>&1; then
  refused "kit built without this platform" "$WORK/kit-win" "it was built without darwin-arm64"
else bad "could not build a Windows-only kit"; fi

# The checks above stop at the preflight. Each use site must hold on its own:
# call the two functions directly on a damaged kit, past the preflight.
# The installer is passed as $0, so the sourced script does not take `bash -c`
# for a pipe and re-execute itself.
use_site() {  # use_site <function> -> runs it with the damaged kit; status = its status
  sandboxed "$WORK/apps-use-site" STUB_GH_FORBID=1 HPS_KIT_DIR="$WORK/kit-neg" HPS_LIB_ONLY=1 \
    HPS_STUDIO_VERSION=9.9.9 -- bash -c 'fn="$1"; shift; . "$0"; "$fn"' "$REPO_ROOT/scripts/install.sh" "$1" 2>&1
}
copy_kit; printf 'x' >> "$WORK/kit-neg/HypeProof-Studio-darwin-arm64.zip"
if out="$(use_site install_studio_mac)" || [ -e "$WORK/apps-use-site/HypeProof Studio.app" ]; then
  bad "install_studio_mac unpacked a damaged archive"
elif ! printf '%s' "$out" | grep -q -F 'SHA-256 mismatch for HypeProof-Studio-darwin-arm64.zip'; then
  printf '%s\n' "$out" | tail -n 3; bad "install_studio_mac stopped, but not on the checksum"
else pass "install_studio_mac checks the archive itself before unpacking"; fi

copy_kit; damage_seeder
if out="$(use_site seed_sdk)"; then bad "seed_sdk ran a damaged seeder"
elif ! printf '%s' "$out" | grep -q -F 'SHA-256 mismatch for seed-sdk-binary.sh'; then
  printf '%s\n' "$out" | tail -n 3; bad "seed_sdk stopped, but not on the checksum"
else pass "seed_sdk checks the seeder itself before running it"; fi

if [ -e "$WORK/DAMAGED_SEEDER_RAN" ]; then bad "a damaged seeder was executed"
else pass "the damaged seeder was never executed"; fi

# ---------------------------------------------------------------------------- #
echo
echo "=== 4. Positive control: without --kit the member path uses gh ==="
# ---------------------------------------------------------------------------- #
# A lone copy, like the one-liner's /tmp/hps-bootstrap.sh: no sibling seeder.
mkdir -p "$WORK/member"; cp "$REPO_ROOT/scripts/install.sh" "$WORK/member/hps-bootstrap.sh"
reset_logs
APPS="$WORK/apps-member"
if out="$(sandboxed "$APPS" -- bash "$WORK/member/hps-bootstrap.sh" 2>&1)" && [ -d "$APPS/HypeProof Studio.app" ]; then
  pass "member install exits 0 and installs the app"
else printf '%s\n' "$out" | tail -n 5; bad "member install failed in the sandbox"; fi

for call in 'auth status' 'release view' 'releases/tags/v9.9.9' '--jq .digest' 'application/octet-stream' 'contents/scripts/seed-sdk-binary.sh'; do
  if grep -q -F -- "$call" "$LOG/gh.log" 2>/dev/null; then pass "gh log has: $call"
  else bad "gh log lacks: $call (the member path changed, or the log is blind)"; fi
done

# The real member and kit paths must refuse before moving the old app; a second
# check protects the staged copy. Run directly with POSIX sh, not only bash.
echo
echo "=== 4a. Official Mac signing and replacement controls (Apple tool doubles) ==="
prepare_old() {
  mkdir -p "$APPS/HypeProof Studio.app/Contents"
  printf '<key>CFBundleShortVersionString</key><string>%s</string>\n<key>CFBundleIdentifier</key><string>ai.hypeproof.studio</string>\n' \
    "$1" > "$APPS/HypeProof Studio.app/Contents/Info.plist"
  touch "$APPS/HypeProof Studio.app/old-sentinel"
}
for route in kit member; do
  for mode in unsigned wrong-team wrong-signing-id wrong-bundle notary-reject not-notarized disabled spoofed-source stage-tamper copy-fail backup-fail swap-fail restore-fail; do
    APPS="$WORK/apps-sign-$route-$mode"; prepare_old 9.9.8; reset_logs
    args=()
    if [ "$route" = kit ]; then args=(STUB_GH_FORBID=1 HPS_KIT_DIR="$KIT"); fi
    out="$(sandboxed "$APPS" STUB_SIGNING="$mode" HPS_STUDIO_VERSION=9.9.9 "${args[@]}" \
      -- sh "$REPO_ROOT/scripts/install.sh" 2>&1)"; status=$?
    preserved="$APPS/HypeProof Studio.app/old-sentinel"
    if [ "$mode" = restore-fail ]; then
      preserved="$(find "$APPS" -name old-sentinel -path '*/previous.app/*' | head -n1)"
    fi
    if [ "$status" = 0 ] || [ ! -f "$preserved" ] || [ -e "$LOG/xattr.log" ]; then
      printf '%s\n' "$out" | tail -n 5; bad "$route/$mode: failed refusal or old-app preservation"
    elif [ "$route" = kit ] && [ -n "$(gh_calls_beyond_version)" ]; then
      bad "$route/$mode: used authenticated release access"
    elif [ "$mode" != backup-fail ] && [ "$mode" != swap-fail ] && [ "$mode" != restore-fail ] && [ -e "$LOG/mv.log" ]; then
      bad "$route/$mode: moved old app before validation"
    else pass "$route/$mode: refused with previous app retained"; fi
  done
done

for shell in sh bash; do
  APPS="$WORK/apps-interrupt-$shell"; prepare_old 9.9.8; reset_logs
  out="$(sandboxed "$APPS" STUB_SIGNING=interrupt-after-backup STUB_GH_FORBID=1 -- "$shell" "$KIT/install.sh" --kit "$KIT" 2>&1)"; status=$?
  if [ "$status" != 0 ] && [ -f "$APPS/HypeProof Studio.app/old-sentinel" ] && [ ! -e "$LOG/xattr.log" ]; then
    pass "$shell: TERM immediately after backup restores the old app"
  else printf '%s\n' "$out" | tail -n 5; bad "$shell: interrupted swap lost the old app"; fi
done

for mode in valid old-unsigned; do
  APPS="$WORK/apps-same-$mode"; prepare_old 9.9.9; reset_logs
  if out="$(sandboxed "$APPS" STUB_SIGNING="$mode" STUB_GH_FORBID=1 -- sh "$KIT/install.sh" --kit "$KIT" 2>&1)"; then
    checks="$(wc -l < "$LOG/spctl.log" | tr -d ' ')"
    if [ "$mode" = valid ] && [ "$checks" = 1 ] && [ -f "$APPS/HypeProof Studio.app/old-sentinel" ] && [ ! -e "$LOG/mv.log" ]; then
      pass "same-version official app is verified before reuse"
    elif [ "$mode" = old-unsigned ] && [ "$checks" = 2 ] && [ ! -e "$APPS/HypeProof Studio.app/old-sentinel" ]; then
      pass "same-version ad-hoc app is replaced with a twice-verified official app"
    else bad "same-version $mode: incorrect verification or replacement"; fi
  else printf '%s\n' "$out" | tail -n 5; bad "same-version $mode failed"; fi
done

# ---------------------------------------------------------------------------- #
echo
echo "=== 5. A macOS-only latest release: the kit falls back for Windows ==="
# ---------------------------------------------------------------------------- #
# Releases can be macOS only (config/release-platforms.json). Without --version the
# kit must pack the newest published release that has every requested platform,
# skipping newer drafts and prereleases, in created_at order, not list order.
REAL_JQ="$(command -v jq || true)"
if [ -z "$REAL_JQ" ]; then
  echo "  SKIP jq not found; the release-list filter cannot be measured"
else
  d() { printf '{"name":"%s","url":"%s/%s","digest":"sha256:%064d"}' "$1" \
    "https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets" "$2" 0; }
  rel() { printf '{"tag_name":"%s","created_at":"%s","draft":%s,"prerelease":%s,"assets":[%s]}' "$@"; }
  MAC="$(d HypeProof-Studio-darwin-arm64.zip 102)"
  WIN="$(d HypeProof.StudioUserSetup-x64-9.9.9.exe 103)"
  printf '[%s,%s,%s,%s,%s]\n' \
    "$(rel v9.9.8 2026-09-01T00:00:00Z false false "$MAC,$WIN")" \
    "$(rel v9.9.12 2026-10-21T00:00:00Z true false "$MAC,$WIN")" \
    "$(rel v9.9.11-rc.1 2026-10-20T00:00:00Z false true "$MAC,$WIN")" \
    "$(rel v9.9.10 2026-10-19T00:00:00Z false false "$MAC")" \
    "$(rel v9.9.9 2026-10-10T00:00:00Z false false "$MAC,$WIN")" > "$WORK/releases.json"
  printf '[%s,%s,%s]\n' \
    "$(rel v9.9.12 2026-10-21T00:00:00Z true false "$MAC,$WIN")" \
    "$(rel v9.9.11-rc.1 2026-10-20T00:00:00Z false true "$MAC,$WIN")" \
    "$(rel v9.9.10 2026-10-19T00:00:00Z false false "$MAC")" > "$WORK/releases-no-win.json"
  kit_info_version() { sed -n 's/^studio_version=//p' "$1/kit-info.txt" 2>/dev/null; }

  out="$(sandboxed "$WORK/apps-unused" STUB_MAC_ONLY_LATEST=1 STUB_JQ="$REAL_JQ" STUB_RELEASES="$WORK/releases.json" \
    -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-fallback" 2>&1)"
  if [ "$(kit_info_version "$WORK/kit-fallback")" = "9.9.9" ] && [ -f "$WORK/kit-fallback/HypeProof.StudioUserSetup-x64-9.9.9.exe" ]; then
    pass "latest v9.9.10 is macOS only: both-platform kit packs v9.9.9, past a newer draft and prerelease"
  else printf '%s\n' "$out" | tail -n 5; bad "macOS-only latest did not fall back to v9.9.9 (got '$(kit_info_version "$WORK/kit-fallback")')"; fi
  if printf '%s\n' "$out" | grep -q -- '--platform darwin-arm64'; then pass "the operator is told how to pack the newest macOS build"
  else bad "the fallback was silent"; fi

  out="$(sandboxed "$WORK/apps-unused" STUB_MAC_ONLY_LATEST=1 STUB_JQ="$REAL_JQ" STUB_RELEASES="$WORK/releases.json" \
    -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-mac-latest" --platform darwin-arm64 2>&1)"
  if [ "$(kit_info_version "$WORK/kit-mac-latest")" = "9.9.10" ]; then pass "a macOS-only kit stays on the latest release v9.9.10"
  else printf '%s\n' "$out" | tail -n 5; bad "a macOS-only kit left the latest release"; fi

  reset_logs
  out="$(sandboxed "$WORK/apps-unused" STUB_JQ="$REAL_JQ" STUB_RELEASES="$WORK/releases.json" \
    -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-latest-win" 2>&1)"
  if [ "$(kit_info_version "$WORK/kit-latest-win")" = "9.9.9" ] && ! grep -q -F 'releases?per_page' "$LOG/gh.log" 2>/dev/null; then
    pass "control: latest has Windows, so the latest is packed and the list is never read"
  else bad "latest with Windows still read the release list"; fi
  reset_logs

  if out="$(sandboxed "$WORK/apps-unused" STUB_MAC_ONLY_LATEST=1 STUB_JQ="$REAL_JQ" STUB_RELEASES="$WORK/releases-no-win.json" \
    -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-no-win" 2>&1)" || [ -e "$WORK/kit-no-win" ]; then
    bad "no release with Windows still produced a kit"
  elif printf '%s\n' "$out" | grep -q 'No published release .* has every requested platform'; then
    pass "negative control: no release with Windows gives a clear error and no kit"
  else printf '%s\n' "$out" | tail -n 3; bad "no-Windows error was not clear"; fi

  if out="$(sandboxed "$WORK/apps-unused" STUB_MAC_ONLY_LATEST=1 STUB_JQ="$REAL_JQ" STUB_RELEASES="$WORK/releases.json" \
    -- bash "$REPO_ROOT/scripts/make-class-kit.sh" --out "$WORK/kit-pinned" --version 9.9.10 2>&1)" || [ -e "$WORK/kit-pinned" ]; then
    bad "a pinned macOS-only version silently packed something else"
  else pass "a pinned version without Windows fails instead of falling back"; fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS — class kit: built complete, installed without GitHub, damaged kits refused"
else
  echo "FAIL — class kit regression"
fi
exit "$fail"
