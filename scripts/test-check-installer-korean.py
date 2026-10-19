#!/usr/bin/env python3
"""Positive and negative controls for scripts/check-installer-korean.py (PRA-13).

Negative: English prompts and headers written the way the installers write them
must be rejected, so a check that extracts nothing (or accepts anything) fails
here first. Positive: Korean prompts that keep tool names inside the sentence
pass, and the shipped installers pass with at least as many literals as they
are known to carry, so the check cannot go green by matching nothing.
"""
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check_installer_korean", HERE / "check-installer-korean.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SH_ENGLISH = """
confirm() {
  printf '%s [Y/n] ' "$1"
}
step "Detecting platform"
if confirm "Homebrew not found. Install it now (also triggers Xcode CLT)?"; then :; fi
  ok "doctor: all manifest checks passed"
"""
SH_KOREAN = """
confirm() {
  printf '%s (Y/n, 그냥 Enter = 예) ' "$1"
}
step "설치 환경 확인"
if confirm "Homebrew가 없습니다. 지금 설치할까요? (Xcode 명령줄 도구도 함께 설치됩니다)"; then :; fi
  ok "점검(doctor): 모든 항목 통과"
  warn "brew install failed"
"""
PS_ENGLISH = """
function Confirm-Or([string]$prompt, [bool]$default = $true) {
    $suffix = if ($default) { '[Y/n]' } else { '[y/N]' }
    $ans = Read-Host ("    {0} {1}" -f $prompt, $suffix)
}
    Write-Head 'Detect environment'
        if (Confirm-Or 'Install Ubuntu on WSL as the POSIX shell fallback?' $false) { }
    $code = Read-Host 'Enter your participation code'
    Write-Host '==> doctor: ALL CHECKS PASSED' -ForegroundColor Green
"""
PS_KOREAN = """
function Confirm-Or([string]$prompt, [bool]$default = $true) {
    $suffix = if ($default) { '(Y/n, 그냥 Enter = 예)' } else { '(y/N, 그냥 Enter = 아니오)' }
    $ans = Read-Host ("    {0} {1}" -f $prompt, $suffix)
}
    Write-Head '설치 환경 확인'
        if (Confirm-Or 'WSL에 Ubuntu를 설치할까요?' $false) { }
    $code = Read-Host '참여 코드를 입력하세요'
    Write-Host '==> 점검(doctor): 모든 항목 통과' -ForegroundColor Green
    Write-Info 'Remote manifest unreachable; using embedded pinned versions.'
"""

# Negative controls: every English learner-facing literal is reported.
bad_sh = mod.offending(mod.sh_targets(SH_ENGLISH))
assert {k for _, k, _ in bad_sh} == {"step", "confirm", "ok (doctor verdict)", "confirm() answer hint"}, bad_sh
bad_ps = mod.offending(mod.ps_targets(PS_ENGLISH))
assert {k for _, k, _ in bad_ps} == {
    "Write-Head", "Confirm-Or", "Read-Host", "Write-Host (verdict)",
    "Confirm-Or answer hint (default yes)", "Confirm-Or answer hint (default no)",
}, bad_ps
# A confirm() whose answer hint cannot be found is a failure, not a pass.
assert mod.offending(mod.sh_targets('confirm() {\n  echo "$1"\n}\n'))

# Positive controls: Korean copy with tool names passes; log lines are not checked;
# the placeholder-only Read-Host format string is skipped.
assert mod.offending(mod.sh_targets(SH_KOREAN)) == []
assert mod.offending(mod.ps_targets(PS_KOREAN)) == []
assert not any(k == "Read-Host" and "{0}" in lit for _, k, lit in mod.ps_targets(PS_KOREAN))

# The shipped installers: enough literals found, and all Korean.
sh_t = mod.sh_targets((HERE / "install.sh").read_text(encoding="utf-8"))
ps_t = mod.ps_targets((HERE / "install.ps1").read_text(encoding="utf-8-sig"))
count = lambda ts, kind: sum(1 for _, k, _ in ts if k == kind)
assert count(sh_t, "step") >= 8 and count(sh_t, "confirm") >= 2, sh_t
assert count(sh_t, "confirm() answer hint") == 1
assert count(ps_t, "Write-Head") >= 10 and count(ps_t, "Confirm-Or") >= 1, ps_t
assert count(ps_t, "Write-Host (verdict)") >= 3, ps_t
assert mod.offending(sh_t) == [], mod.offending(sh_t)
assert mod.offending(ps_t) == [], mod.offending(ps_t)
print("check-installer-korean: positive and negative controls pass")
