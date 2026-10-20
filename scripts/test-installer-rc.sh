#!/usr/bin/env bash
# Regression test for install.sh's login-shell and rc-file detection, and for the
# closing step (open Studio, mention PATH only when it changed).
#
# Why (2026-10-20, Studio 2026.1020.2): the Lab one-liner runs
# `bash /tmp/hps-install.sh`. install.sh took the login shell from $SHELL, which
# was bash in that run, and printed `shell=bash rc=~/.bash_profile` on a zsh
# Mac. Every PATH edit then went to a file zsh never reads.
#
# Everything runs in a temporary HOME with stub `uname`, `dscl` and `open`. The
# installer is sourced with HPS_LIB_ONLY=1, so nothing is installed, no real rc
# file is read or written, and no app is opened.
#
# Controls (.claude/rules/verification.md §2):
#   negative — the old $SHELL-only rule must pick ~/.bash_profile for a zsh
#              account when SHELL=/bin/bash. If it does not, this harness does
#              not reproduce the bug and proves nothing.
#   positive — the current rule must pick ~/.zprofile for that account, and a
#              bash account must still get ~/.bash_profile.
# shellcheck disable=SC2016  # stub bodies and sourced snippets are literal sh, expanded where they run
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$REPO_ROOT/scripts/install.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail=0
pass() { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=1; }

BIN="$WORK/bin"; LOG="$WORK/log"
mkdir -p "$BIN" "$LOG"
stub() { printf '#!/bin/sh\n%s\n' "$2" > "$BIN/$1"; chmod +x "$BIN/$1"; }
stub uname 'case "${1:-}" in -m) echo arm64 ;; *) echo Darwin ;; esac'
# dscl answers for the account in STUB_ACCOUNT_SHELL; empty = no such record.
stub dscl  '[ -n "${STUB_ACCOUNT_SHELL:-}" ] || exit 56; printf "UserShell: %s\n" "$STUB_ACCOUNT_SHELL"'
stub open  'printf "%s\n" "$*" >> "$STUB_LOG/open.log"; exit 0'

# in_installer <case> <env...> -- <snippet>: source install.sh in a clean
# environment with its own HOME and run <snippet>; prints the snippet's output.
in_installer() {
  local name="$1"; shift
  local extra=()
  while [ "$1" != "--" ]; do extra+=("$1"); shift; done
  shift
  local home="$WORK/home-$name"
  mkdir -p "$home"
  env -i HOME="$home" PATH="$BIN:/usr/bin:/bin:/usr/sbin:/sbin" TERM=dumb USER=learner \
    STUB_LOG="$LOG" HPS_LIB_ONLY=1 ${extra[@]+"${extra[@]}"} \
    bash -c '. "$0" >/dev/null; '"$1" "$INSTALLER" 2>&1
}

echo "=== 1. negative control: the old \$SHELL-only rule reproduces the bug ==="
old_rc() {  # the rule install.sh used until 2026-10-20, verbatim
  local HOME="$1" SHELL="$2" OS=darwin LOGIN_SHELL RC_FILE
  LOGIN_SHELL="$(basename "${SHELL:-/bin/sh}")"
  case "$LOGIN_SHELL" in
    zsh)  RC_FILE="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) if [ "$OS" = "darwin" ]; then RC_FILE="$HOME/.bash_profile"; else RC_FILE="$HOME/.bashrc"; fi ;;
    *)    RC_FILE="$HOME/.profile" ;;
  esac
  printf '%s\n' "$RC_FILE"
}
if [ "$(old_rc /h /bin/bash)" = "/h/.bash_profile" ]; then
  pass "old rule: a zsh account run under SHELL=/bin/bash writes ~/.bash_profile (the reported bug)"
else bad "old rule did not reproduce the bug; this harness is not measuring it"; fi

echo
echo "=== 2. login shell comes from the account, rc file follows it ==="
expect_rc() {  # expect_rc <case> <want-shell> <want-rc-relative-to-HOME> <env...>
  local name="$1" want_sh="$2" want_rc="$3"; shift 3
  local got
  got="$(in_installer "$name" "$@" -- 'printf "%s|%s\n" "$LOGIN_SHELL" "$RC_FILE"')"
  if [ "$got" = "$want_sh|$WORK/home-$name/$want_rc" ]; then pass "$name: $want_sh -> ~/$want_rc"
  else bad "$name: want '$want_sh|~/$want_rc', got '$got'"; fi
}
# Positive: the reported case.
expect_rc zsh-account-bash-runner zsh .zprofile STUB_ACCOUNT_SHELL=/bin/zsh SHELL=/bin/bash
expect_rc zsh-account zsh .zprofile STUB_ACCOUNT_SHELL=/bin/zsh SHELL=/bin/zsh
# Negative: bash users keep the existing behaviour.
expect_rc bash-account bash .bash_profile STUB_ACCOUNT_SHELL=/bin/bash SHELL=/bin/bash
expect_rc bash-account-zsh-env bash .bash_profile STUB_ACCOUNT_SHELL=/bin/bash SHELL=/bin/zsh
# No account record (dscl fails): fall back to $SHELL.
expect_rc no-record-zsh zsh .zprofile SHELL=/bin/zsh
expect_rc no-record-bash bash .bash_profile SHELL=/bin/bash

got="$(in_installer zdotdir STUB_ACCOUNT_SHELL=/bin/zsh ZDOTDIR="$WORK/zdot" -- 'printf "%s\n" "$RC_FILE"')"
if [ "$got" = "$WORK/zdot/.zprofile" ]; then pass "ZDOTDIR is honoured for zsh"
else bad "ZDOTDIR: got '$got'"; fi

echo
echo "=== 3. PATH edits land in the detected file, once ==="
H="$WORK/home-path-zsh"
out="$(in_installer path-zsh STUB_ACCOUNT_SHELL=/bin/zsh SHELL=/bin/bash -- \
  'ensure_path_entry /opt/hps-test/bin; ensure_path_entry /opt/hps-test/bin; printf "changed=%s\n" "$PATH_RC_CHANGED"')"
if [ "$(grep -c -F /opt/hps-test/bin "$H/.zprofile" 2>/dev/null)" = "1" ]; then pass "zsh: one PATH line in ~/.zprofile after two runs"
else bad "zsh: ~/.zprofile does not hold exactly one PATH line"; fi
if [ ! -e "$H/.bash_profile" ] && [ ! -e "$H/.zshrc" ]; then pass "zsh: ~/.bash_profile and ~/.zshrc untouched"
else bad "zsh: wrote to a file zsh login shells do not use for this"; fi
if printf '%s' "$out" | grep -q 'changed=1'; then pass "zsh: the run records that PATH changed"
else bad "zsh: PATH_RC_CHANGED not set: $out"; fi

H="$WORK/home-path-bash"
in_installer path-bash STUB_ACCOUNT_SHELL=/bin/bash -- 'ensure_path_entry /opt/hps-test/bin' >/dev/null
if grep -q -F /opt/hps-test/bin "$H/.bash_profile" 2>/dev/null && [ ! -e "$H/.zprofile" ]; then
  pass "bash: PATH line in ~/.bash_profile, nothing in ~/.zprofile"
else bad "bash: PATH line not where bash reads it"; fi

H="$WORK/home-path-legacy"
mkdir -p "$H"; printf 'export PATH="/opt/hps-test/bin:$PATH"\n' > "$H/.zshrc"
out="$(in_installer path-legacy STUB_ACCOUNT_SHELL=/bin/zsh -- \
  'ensure_path_entry /opt/hps-test/bin; printf "changed=%s\n" "$PATH_RC_CHANGED"')"
if [ ! -e "$H/.zprofile" ] && printf '%s' "$out" | grep -q 'changed=0'; then
  pass "zsh: a line an older installer put in ~/.zshrc is not duplicated into ~/.zprofile"
else bad "zsh: legacy ~/.zshrc entry was duplicated or reported as a change"; fi

echo
echo "=== 4. closing step: open Studio only for a person at a terminal ==="
APP="$WORK/apps/HypeProof Studio.app"; mkdir -p "$APP"
if [ "$(PATH="$BIN:/usr/bin:/bin" command -v open)" != "$BIN/open" ]; then
  bad "the open stub does not shadow /usr/bin/open; refusing to run the open cases"
else
  finish_case() {  # finish_case <case> <env...>  -> finish output; open.log reset first
    local name="$1"; shift
    rm -f "$LOG/open.log"
    in_installer "$name" STUB_ACCOUNT_SHELL=/bin/zsh "$@" -- \
      'NONINTERACTIVE="${T_NONINTERACTIVE:-0}"; STUDIO_APP="$T_APP"; PATH_RC_CHANGED="${T_CHANGED:-0}"; finish'
  }
  out="$(finish_case interactive T_APP="$APP")"
  # studio-launch: interactive -- asserts the stubbed open log of the installer, nothing is launched
  if [ "$(cat "$LOG/open.log" 2>/dev/null)" = "-a $APP" ]; then pass "interactive: opens the installed app with open -a"
  else bad "interactive: open.log is '$(cat "$LOG/open.log" 2>/dev/null)'"; fi
  if printf '%s' "$out" | grep -q -F 'Studio를 열었습니다. 시작 화면에서 바로 시작하세요.'; then pass "interactive: prints the Korean open line"
  else bad "interactive: open line missing"; fi
  if printf '%s' "$out" | grep -q -F '새 터미널'; then bad "interactive, PATH unchanged: still talks about a new terminal"
  else pass "PATH unchanged: no new-terminal line"; fi

  for c in "unattended T_NONINTERACTIVE=1" "ci CI=true" "test-seam HPS_APPS_DIR=$WORK/apps" "caller-opens HPS_NO_OPEN=1" "no-app"; do
    name="${c%% *}"; envs="${c#"$name"}"
    app="$APP"; [ "$name" = "no-app" ] && app="$WORK/apps/missing.app"
    # shellcheck disable=SC2086  # envs is a single KEY=VALUE word or empty
    out="$(finish_case "$name" T_APP="$app" $envs)"
    if [ -e "$LOG/open.log" ]; then bad "$name: opened Studio"
    elif printf '%s' "$out" | grep -q -F 'Studio를 열었습니다'; then bad "$name: claims to have opened Studio"
    else pass "$name: does not open Studio"; fi
  done

  out="$(finish_case path-changed T_APP="$APP" T_NONINTERACTIVE=1 T_CHANGED=1)"
  if printf '%s' "$out" | grep -q -F '(선택)' && printf '%s' "$out" | grep -q -F '새 터미널'; then
    pass "PATH changed: one optional new-terminal line"
  else bad "PATH changed: optional new-terminal line missing"; fi
fi

echo
if [ "$fail" -eq 0 ]; then echo "PASS test-installer-rc"; else echo "FAIL test-installer-rc"; fi
exit "$fail"
