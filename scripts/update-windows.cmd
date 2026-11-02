@echo off
rem HypeProof Studio Windows updater: double-click to install the latest public release.
rem Everything after the marker line below is PowerShell; this file runs itself through it.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText('%~f0', [Text.Encoding]::UTF8); iex ($s -split '\r?\n#PS#\r?\n', 2)[1]"
echo.
pause
exit /b
#PS#
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
try {
  $rel = Invoke-RestMethod "https://api.github.com/repos/hypeproof/hypeproof-studio/releases/latest"
  $asset = $rel.assets | Where-Object { $_.name -match '^HypeProof\.StudioUserSetup-x64-.*\.exe$' } | Select-Object -First 1
  if (-not $asset) { throw "Windows 설치 파일을 찾지 못했어요 ($($rel.tag_name))" }
  $exe = Join-Path $env:TEMP $asset.name
  Write-Host "HP Studio $($rel.tag_name) 받는 중..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $exe -UseBasicParsing
  Write-Host "HP Studio를 닫고 설치합니다. 기존 대화와 설정은 그대로 남아요."
  Get-Process | Where-Object { $_.ProcessName -like 'HypeProof*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $p = Start-Process $exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/MERGETASKS=!runcode' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "설치 프로그램이 오류 코드 $($p.ExitCode)로 끝났어요" }
  Write-Host "설치 완료: HP Studio $($rel.tag_name). 이제 HP Studio를 다시 열어주세요."
} catch {
  Write-Host "업데이트하지 못했어요: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "https://github.com/hypeproof/hypeproof-studio/releases/latest 에서 설치 파일을 직접 받아주세요."
}
