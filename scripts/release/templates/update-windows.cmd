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
# PowerShell 7 -> cmd/Node -> Windows PowerShell inherits incompatible module
# paths. Prefer this engine's built-ins (also inherited by the SDK seeder).
# This changes only this installer process, never the user's saved environment.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Tag = '@@TAG@@'
$Exe = '@@EXE_NAME@@'
$Sha = '@@EXE_SHA256@@'
$SeedName = '@@SEED_NAME@@'
$SeedVersion = '@@SEED_VERSION@@'
$SeedSha = '@@SEED_SHA256@@'
$SeederSha = '@@SEEDER_SHA256@@'
$Page = "https://github.com/hypeproof/hypeproof-studio/releases/tag/$Tag"
$BaseUrl = "https://github.com/hypeproof/hypeproof-studio/releases/download/$Tag"
$dir = $null
function Get-VerifiedAsset([string]$name, [string]$sha) {
  $file = Join-Path $dir $name
  if ($env:HPS_INSTALL_ASSET_DIR) {
    Copy-Item -LiteralPath (Join-Path $env:HPS_INSTALL_ASSET_DIR $name) -Destination $file
  } else {
    Invoke-WebRequest -Uri "$BaseUrl/$name" -OutFile $file -UseBasicParsing
  }
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha) {
    throw "받은 $name 파일이 $Tag 릴리스 파일과 달라요 (SHA-256 불일치)"
  }
  return $file
}
try {
  $dir = Join-Path ([IO.Path]::GetTempPath()) ("hps-update-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  Write-Host "HP Studio $Tag 와 AI 코치 실행 파일 받는 중..."
  # Verify the entire delivery set before running either installer or seeder.
  $file = Get-VerifiedAsset $Exe $Sha
  $seed = Get-VerifiedAsset $SeedName $SeedSha
  $seeder = Get-VerifiedAsset 'seed-sdk-binary.ps1' $SeederSha
  $setupArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/MERGETASKS=!runcode')
  if ($env:HPS_INSTALL_DRY_RUN -eq '1') {
    Write-Host "DRY RUN: verified App, SDK $SeedVersion and seeder; nothing installed"
    exit 0
  }
  $installedExe = Join-Path $env:LOCALAPPDATA 'Programs\HypeProof Studio\HypeProof Studio.exe'
  if (Get-Process | Where-Object { $_.Path -and $_.Path -eq $installedExe }) {
    throw '열려 있는 HP Studio를 먼저 닫은 뒤 다시 실행해 주세요. 대화와 설정은 그대로 남아요.'
  }
  Write-Host "HP Studio를 설치합니다. 기존 대화와 설정은 그대로 남아요."
  $p = Start-Process -FilePath $file -ArgumentList $setupArgs -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "설치 프로그램이 오류 코드 $($p.ExitCode)로 끝났어요" }
  Write-Host "AI 코치 실행 파일을 준비합니다..."
  # The canonical seeder additionally verifies pinned SHA-512 and writes the trusted marker.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $seeder -Version $SeedVersion -Platform win32-x64 -Tarball $seed
  if ($LASTEXITCODE -ne 0) { throw '앱은 설치됐지만 AI 코치 실행 파일 준비가 끝나지 않았어요. 이 설치 명령을 다시 실행해 주세요.' }
  Write-Host "설치 완료: HP Studio $Tag. 이제 HP Studio를 열어주세요."
  exit 0
} catch {
  Write-Host "설치를 마치지 못했어요: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "$Page 의 Windows 설치 명령으로 다시 시도해 주세요."
  exit 1
} finally {
  if ($dir -and (Test-Path -LiteralPath $dir)) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}
