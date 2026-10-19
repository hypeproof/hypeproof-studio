#!/usr/bin/env bash
# Regression test: the macOS installer fails closed on a missing SDK seed (PRA-11),
# and on Linux, where no Studio app is installed, never claims it will stop.
#
# Why (trial diagnosis 2026-10-18, I7 -> I2): seed_sdk and the doctor only warned
# "Studio will self-heal on first launch" when the native SDK seed was missing or
# the seeder failed. No in-app fetch exists (the native binary is excluded from the
# app bundle and nothing downloads it later), so the install reported success and
# the learner hit a dead-end coach screen. install.ps1 already fails its doctor on
# the same condition (install.ps1 "SDK: missing seed or untrusted ... marker").
#
# What this checks, with no network and no real install: install.sh is loaded with
# HPS_LIB_ONLY=1 into a sandboxed HOME, the seeder is replaced by stubs, and every
# network tool on PATH is a stub that logs and fails.
#
# Controls (.claude/rules/verification.md section 2):
#   negative - seeder fails / seeder unavailable / seeder succeeds without a marker
#              must make the doctor exit non-zero with the Korean stop message that
#              names the stage and the recovery command, for members and class kits.
#   positive - seeder succeeds and writes the marker: the doctor exits 0.
#   linux    - install.sh installs no Studio app on Linux and its doctor has no SDK
#              check, so a failed or marker-less seed leaves the doctor at exit 0.
#              The seed warning there must not say the install will stop.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$HERE/install.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
pass() { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; FAILED=$((FAILED + 1)); }

# Network tools: any call is logged and fails, so a test that reaches the network
# shows up in net.log instead of passing by luck.
BIN="$WORK/bin"; mkdir -p "$BIN"
for t in curl gh npm wget; do
  printf '#!/bin/sh\nprintf "%%s %%s\\n" "%s" "$*" >> "%s/net.log"\nexit 97\n' "$t" "$WORK" > "$BIN/$t"
  chmod +x "$BIN/$t"
done

# Seeder stubs. They take the same arguments as seed-sdk-binary.sh.
cat > "$WORK/seed-fail.sh" <<'EOF'
echo "stub seeder: npm registry unreachable" >&2
exit 3
EOF
cat > "$WORK/seed-ok.sh" <<'EOF'
d="$STUDIO_SUPPORT_STUB/sdk/0.0.1"
mkdir -p "$d"
printf '{\n  "sdkVersion": "0.0.1",\n  "size": 1\n}\n' > "$d/claude.verified.json"
exit 0
EOF
cat > "$WORK/seed-nomarker.sh" <<'EOF'
exit 0
EOF

# run_case <name> <seed: fail|ok|nomarker|unavailable> <kit: 0|1> [os: darwin|linux]
# Runs seed_sdk then doctor in a fresh sandboxed shell. Prints the combined output
# to $WORK/<name>.out and the exit code to $WORK/<name>.rc.
run_case() {
  _name="$1"; _seed="$2"; _kit="$3"; _os="${4:-darwin}"
  _home="$WORK/home-$_name"; mkdir -p "$_home"
  (
    export HOME="$_home" PATH="$BIN:$PATH" XDG_CONFIG_HOME="$_home/.config"
    export HPS_LIB_ONLY=1 HPS_REEXEC=1 HPS_SKIP_STUDIO=0
    unset HPS_SDK_VERSION HPS_KIT_DIR
    set --                                       # install.sh parses "$@" as its flags
    # shellcheck disable=SC1090
    . "$INSTALLER"
    set +e
    # shellcheck disable=SC2034  # read by doctor() from the sourced installer
    OS="$_os"
    # shellcheck disable=SC2034
    DEP_IDS=""                                   # only the SDK check decides
    STUDIO_APP="$_home/Applications/HypeProof Studio.app"; mkdir -p "$STUDIO_APP"
    STUDIO_SUPPORT="$_home/Library/Application Support/HypeProof-Studio"
    export STUDIO_SUPPORT_STUB="$STUDIO_SUPPORT"
    if [ "$_kit" = "1" ]; then KIT_DIR="$_home/kit"; mkdir -p "$KIT_DIR"; else KIT_DIR=""; fi
    kit_verify() { :; }
    have() { [ "$1" != gh ] && command -v "$1" >/dev/null 2>&1; }   # gh auth is out of scope
    case "$_seed" in
      unavailable) resolve_seed_script() { return 1; } ;;
      *)           eval "resolve_seed_script() { printf '%s\n' '$WORK/seed-$_seed.sh'; }" ;;
    esac
    # Same shell as the installer's main flow: seed_sdk hands its stage to the
    # doctor through globals, which a subshell would drop.
    seed_sdk || exit 90                          # seed_sdk itself must not stop the install
    ( doctor ); echo $? > "$WORK/$_name.rc"
  ) > "$WORK/$_name.out" 2>&1
  [ -f "$WORK/$_name.rc" ] || echo 90 > "$WORK/$_name.rc"
}

has()  { grep -qF -- "$2" "$WORK/$1.out"; }
rc()   { cat "$WORK/$1.rc"; }

expect_stop() {  # expect_stop <name> <stage substring> <recovery substring>
  _n="$1"
  if [ "$(rc "$_n")" != "0" ] && [ "$(rc "$_n")" != "90" ]; then pass "$_n: doctor exits non-zero ($(rc "$_n"))"
  else bad "$_n: doctor exit $(rc "$_n") (expected non-zero)"; fi
  if has "$_n" "SDK: 설치되지 않았습니다"; then pass "$_n: Korean stop message"
  else bad "$_n: Korean stop message missing"; fi
  if has "$_n" "$2"; then pass "$_n: names the stage ($2)"
  else bad "$_n: stage '$2' not named"; fi
  if has "$_n" "$3"; then pass "$_n: names the recovery command"
  else bad "$_n: recovery command '$3' missing"; fi
  if grep -qi 'self-heal' "$WORK/$_n.out"; then bad "$_n: still claims self-heal"
  else pass "$_n: no self-heal claim"; fi
}

echo "=== 1. negative controls: a missing seed must stop the doctor ==="
run_case member-fail fail 0
expect_stop member-fail "시드 스크립트 실행" "hypeproof-studio/contents/scripts/install.sh"
if has member-fail "종료 코드 3"; then pass "member-fail: seeder exit code reported"
else bad "member-fail: seeder exit code not reported"; fi

run_case member-unavailable unavailable 0
expect_stop member-unavailable "시드 스크립트 받기" "hypeproof-studio/contents/scripts/install.sh"

run_case member-nomarker nomarker 0
expect_stop member-nomarker "검증 표시 확인" "hypeproof-studio/contents/scripts/install.sh"

run_case kit-fail fail 1
expect_stop kit-fail "시드 스크립트 실행" "--kit"
if has kit-fail "/kit/install.sh"; then pass "kit-fail: recovery re-runs the kit's own installer"
else bad "kit-fail: recovery does not point at the kit installer"; fi

echo ""
echo "=== 2. positive control: a verified seed passes ==="
run_case member-ok ok 0
if [ "$(rc member-ok)" = "0" ]; then pass "member-ok: doctor exits 0"
else bad "member-ok: doctor exit $(rc member-ok) (expected 0)"; sed 's/^/      /' "$WORK/member-ok.out"; fi
if has member-ok "SDK: seeded + verified"; then pass "member-ok: SDK reported verified"
else bad "member-ok: SDK not reported verified"; fi
if has member-ok "SDK: 설치되지 않았습니다"; then bad "member-ok: stop message on a good seed"
else pass "member-ok: no stop message"; fi

run_case kit-ok ok 1
if [ "$(rc kit-ok)" = "0" ]; then pass "kit-ok: doctor exits 0"
else bad "kit-ok: doctor exit $(rc kit-ok) (expected 0)"; fi

echo ""
echo "=== 3. linux: no Studio app, so no stop and no claim of one ==="
for _s in fail nomarker unavailable; do
  _n="linux-$_s"
  run_case "$_n" "$_s" 0 linux
  if [ "$(rc "$_n")" = "0" ]; then pass "$_n: doctor exits 0 (no SDK check on Linux)"
  else bad "$_n: doctor exit $(rc "$_n") (expected 0)"; fi
  if has "$_n" "마지막 점검에서 설치가 멈춥니다"; then bad "$_n: warns the install will stop, but it does not"
  else pass "$_n: no false stop warning"; fi
  if has "$_n" "SDK: 설치되지 않았습니다"; then bad "$_n: doctor stop message on Linux"
  else pass "$_n: no doctor stop message"; fi
  if grep -qi 'self-heal' "$WORK/$_n.out"; then bad "$_n: claims self-heal"
  else pass "$_n: no self-heal claim"; fi
done
# The seed warning itself still tells a Linux user what happened and what to do.
if has linux-fail "종료 코드 3" && has linux-fail "설치는 계속됩니다"; then
  pass "linux-fail: warning names the exit code and says the install continues"
else bad "linux-fail: warning lacks exit code or continue notice"; fi
if has linux-unavailable "설치는 계속됩니다"; then pass "linux-unavailable: warning says the install continues"
else bad "linux-unavailable: continue notice missing"; fi
# Control for the check above: the same failure on macOS does say it will stop.
if has member-fail "마지막 점검에서 설치가 멈춥니다"; then pass "member-fail (darwin): stop warning present"
else bad "member-fail (darwin): stop warning missing"; fi

echo ""
echo "=== 4. static: no self-heal claim left in the installer ==="
if grep -n 'self-heal' "$INSTALLER"; then bad "install.sh still claims Studio self-heals the SDK"
else pass "install.sh has no self-heal claim"; fi

echo ""
echo "=== 5. no network ==="
if [ -s "$WORK/net.log" ]; then bad "a network tool was called:"; sed 's/^/      /' "$WORK/net.log"
else pass "no curl/gh/npm/wget call"; fi

echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "FAILED: $FAILED check(s)"
  for f in "$WORK"/*.out; do echo "--- $(basename "$f")"; sed 's/^/    /' "$f"; done
  exit 1
fi
echo "all checks passed"
