@echo off
rem HypeProof Studio @@TAG@@ for Windows (x64): double-click to install or update to this exact release.
rem Rendered per release by scripts/release/install-kit.mjs. The PowerShell part after the
rem marker line further down runs through powershell.exe, which reads this file itself.
chcp 65001 >nul
set "HPS_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText($env:HPS_SELF, [Text.Encoding]::UTF8); iex ($s -split '\r?\n#PS#\r?\n', 2)[1]"
set "HPS_RC=%ERRORLEVEL%"
echo.
if not "%HPS_NO_PAUSE%"=="1" pause
exit /b %HPS_RC%
#PS#
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Tag = '@@TAG@@'
$Exe = '@@EXE_NAME@@'
$Sha = '@@EXE_SHA256@@'
$Page = "https://github.com/hypeproof/hypeproof-studio/releases/tag/$Tag"
$Url = "https://github.com/hypeproof/hypeproof-studio/releases/download/$Tag/$Exe"
try {
  $dir = Join-Path ([IO.Path]::GetTempPath()) "hps-update-$Tag"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir $Exe
  Write-Host "HP Studio $Tag 받는 중..."
  if ($env:HPS_INSTALL_ASSET_DIR) {
    Copy-Item -LiteralPath (Join-Path $env:HPS_INSTALL_ASSET_DIR $Exe) -Destination $file -Force
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $file -UseBasicParsing
  }
  $got = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($got -ne $Sha) {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    throw "받은 설치 파일이 $Tag 릴리스 파일과 달라요 (SHA-256 불일치)"
  }
  $setupArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/MERGETASKS=!runcode')
  if ($env:HPS_INSTALL_DRY_RUN -eq '1') {
    Write-Host "DRY RUN: $file $($setupArgs -join ' ')"
    exit 0
  }
  Write-Host "HP Studio를 닫고 설치합니다. 기존 대화와 설정은 그대로 남아요."
  Get-Process | Where-Object { $_.ProcessName -like 'HypeProof*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $p = Start-Process -FilePath $file -ArgumentList $setupArgs -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "설치 프로그램이 오류 코드 $($p.ExitCode)로 끝났어요" }
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  Write-Host "설치 완료: HP Studio $Tag. 이제 HP Studio를 다시 열어주세요."
  exit 0
} catch {
  Write-Host "설치하지 못했어요: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "$Page 에서 $Exe 파일을 직접 받아 실행해 주세요."
  exit 1
}
