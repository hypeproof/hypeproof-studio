#!/usr/bin/env bash
# Answer parsing for the installers' yes/no questions (PRA-13).
#
# The questions are Korean, so learners answer in Korean, and a learner with
# the Korean IME on who presses y or n types the jamo on that key (y -> ㅛ,
# n -> ㅜ). The old install.sh confirm() read every answer except n/no as yes,
# so "아니요" installed Homebrew (with a sudo prompt). This test runs the
# shipped functions, extracted from the installers, against fixed answers:
#
#   negative control  every "no" answer, Korean or IME jamo, is read as no,
#                     and an answer that is not understood is never read as yes
#   positive control  every "yes" answer, and Enter on a default-yes question,
#                     is read as yes
#
# install.sh: confirm_answer and confirm() (with /dev/tty swapped for stdin).
# install.ps1: Get-ConfirmAnswer and Confirm-Or (Read-Host stubbed) under pwsh.
# pwsh is required on CI; locally the PowerShell half is skipped without it.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SH="$REPO_ROOT/scripts/install.sh"
PS="$REPO_ROOT/scripts/install.ps1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0

YES=(y Y yes YES Yes ㅛ ㅛㄷㄴ 네 넵 예 응 ㅇ ㅇㅇ " 네 " "네." "예!")
NO=(n N no NO No ㅜ ㅜㅐ 아니 아니요 아니오 "아니요." ㄴ ㄴㄴ 싫어요 " 아니요 ")
UNKNOWN=(뭐 "maybe" "yess" "ㅁ" "nope?" "글쎄요")

extract() {  # extract <file> <first-line-regex> -> the function, up to its closing "}"
  awk -v start="$2" '$0 ~ start {on=1} on {sub(/\r$/, ""); print} on && /^}/ {exit}' "$1"
}

# --------------------------------------------------------------------------- #
# install.sh
# --------------------------------------------------------------------------- #
{
  extract "$SH" '^confirm_answer[(][)] [{]'
  extract "$SH" '^confirm[(][)] [{]' | sed 's#</dev/tty##'
} >"$WORK/answers.sh"
grep -q '^confirm_answer() {' "$WORK/answers.sh" && grep -q '^confirm() {' "$WORK/answers.sh" \
  || { echo "FAIL: could not extract confirm/confirm_answer from install.sh"; exit 1; }
# install.sh is #!/bin/sh and runs under dash on Linux, so the extracted
# functions run under every POSIX shell present (sh, dash, bash), not only the
# bash running this test. One case per line: <want>\t<answer> for
# confirm_answer, and confirm\t<want exit>\t<answers joined by |> for confirm().
{
  for a in "${YES[@]}"; do printf 'yes\t%s\n' "$a"; done
  for a in "${NO[@]}"; do printf 'no\t%s\n' "$a"; done
  for a in "${UNKNOWN[@]}"; do printf 'unknown\t%s\n' "$a"; done
  printf 'empty\t\n'
  printf 'empty\t   \n'
  printf 'confirm\t1\t아니요\n'       # the reported defect: Korean "no" installed Homebrew
  printf 'confirm\t1\tㅜ\n'           # n with the Korean IME on
  printf 'confirm\t0\t\n'             # Enter = yes, as the hint says
  printf 'confirm\t0\t네\n'
  printf 'confirm\t0\t뭐|ㅛ\n'        # not understood, asked again, then yes
  printf 'confirm\t1\t뭐|뭐|뭐|네\n'  # three not-understood answers stop at no
} >"$WORK/cases-sh.tsv"
cat >"$WORK/run-sh.sh" <<'RUN'
# run-sh.sh <functions> <cases>: POSIX sh only.
. "$1"
NONINTERACTIVE=0
n=0
tab="$(printf '\t')"
while IFS="$tab" read -r kind a b; do
  if [ "$kind" = confirm ]; then
    printf '%s\n' "$b" | tr '|' '\n' | confirm "질문" >/dev/null 2>&1
    got=$?
    [ "$got" = "$a" ] || { echo "FAIL install.sh confirm <$b> -> $got (want $a)"; n=$((n + 1)); }
  else
    got="$(confirm_answer "$a")"
    [ "$got" = "$kind" ] || { echo "FAIL install.sh confirm_answer '$a' -> $got (want $kind)"; n=$((n + 1)); }
  fi
done <"$2"
exit "$n"
RUN
ran=0
for shell in sh dash bash; do
  command -v "$shell" >/dev/null 2>&1 || continue
  "$shell" "$WORK/run-sh.sh" "$WORK/answers.sh" "$WORK/cases-sh.tsv"
  rc=$?
  [ "$rc" = 0 ] || { echo "  (under $shell)"; fails=$((fails + rc)); }
  ran=$((ran + 1))
done
[ "$ran" -gt 0 ] || { echo "FAIL: no POSIX shell found to run install.sh functions"; fails=$((fails + 1)); }
echo "install.sh: answer parsing checked"

# --------------------------------------------------------------------------- #
# install.ps1
# --------------------------------------------------------------------------- #
if ! command -v pwsh >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then echo "FAIL: pwsh not found on CI"; exit 1; fi
  echo "SKIP: pwsh not found; install.ps1 answer parsing not checked"
else
  {
    extract "$PS" '^function Get-ConfirmAnswer'
    extract "$PS" '^function Confirm-Or'
  } >"$WORK/answers.ps1"
  grep -q '^function Get-ConfirmAnswer' "$WORK/answers.ps1" && grep -q '^function Confirm-Or' "$WORK/answers.ps1" \
    || { echo "FAIL: could not extract Get-ConfirmAnswer/Confirm-Or from install.ps1"; exit 1; }
  # One case per line: <want>\t<answer> for the classifier, and
  # confirm\t<default>\t<want>\t<answers joined by |> for Confirm-Or.
  {
    for a in "${YES[@]}"; do printf 'yes\t%s\n' "$a"; done
    for a in "${NO[@]}"; do printf 'no\t%s\n' "$a"; done
    for a in "${UNKNOWN[@]}"; do printf 'unknown\t%s\n' "$a"; done
    printf 'empty\t\n'
    printf 'confirm\tFalse\tTrue\t네\n'        # the reported defect: Korean "yes" read as no
    printf 'confirm\tFalse\tTrue\tㅛ\n'
    printf 'confirm\tTrue\tFalse\t아니요\n'
    printf 'confirm\tFalse\tFalse\t\n'         # Enter on a default-no question stays no
    printf 'confirm\tTrue\tTrue\t\n'
    printf 'confirm\tFalse\tTrue\t뭐|예\n'
    printf 'confirm\tTrue\tFalse\t뭐|뭐|뭐|네\n'
  } >"$WORK/cases.tsv"
  cat >"$WORK/run.ps1" <<'PS1'
param([string]$Funcs, [string]$Cases)
$ErrorActionPreference = 'Stop'
$NonInteractive = $false
. $Funcs
function Write-Host { }
$script:queue = @()
function Read-Host { $v = $script:queue[0]; $script:queue = @($script:queue | Select-Object -Skip 1); return $v }
$fails = 0
foreach ($line in [System.IO.File]::ReadAllLines($Cases, [System.Text.Encoding]::UTF8)) {
    $f = $line -split "`t", 4
    if ($f[0] -eq 'confirm') {
        $script:queue = @($f[3] -split '\|')
        $got = [string](Confirm-Or 'q' ([bool]::Parse($f[1])))
        if ($got -ne $f[2]) { [Console]::Out.WriteLine("FAIL install.ps1 Confirm-Or default=$($f[1]) <$($f[3])> -> $got (want $($f[2]))"); $fails++ }
    } else {
        $got = Get-ConfirmAnswer $f[1]
        if ($got -ne $f[0]) { [Console]::Out.WriteLine("FAIL install.ps1 Get-ConfirmAnswer '$($f[1])' -> $got (want $($f[0]))"); $fails++ }
    }
}
exit $fails
PS1
  pwsh -NoProfile -NonInteractive -File "$WORK/run.ps1" -Funcs "$WORK/answers.ps1" -Cases "$WORK/cases.tsv"
  rc=$?
  [ "$rc" = 0 ] || fails=$((fails + rc))
  echo "install.ps1: answer parsing checked"
fi

if [ "$fails" -ne 0 ]; then
  echo "installer answers: $fails failure(s)"
  exit 1
fi
echo "installer answers: Korean and IME yes/no answers are read the way the learner meant"
