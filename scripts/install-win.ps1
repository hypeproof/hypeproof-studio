# Requires GitHub CLI and a member login (gh auth login).
# Download this script using the authenticated GitHub API, then run it locally.
$ErrorActionPreference = "Stop"
$Repo = "hypeproof/hypeproof-studio-releases"
$AppName = "HypeProof Studio"
$Tag = if ($env:HPS_VERSION) { $env:HPS_VERSION } else { "latest" }
$Tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("hps-" + [Guid]::NewGuid().ToString("N"))) -Force

function Say($msg) { Write-Host "`n▶ $msg" -ForegroundColor Magenta }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

try {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "Install GitHub CLI, then run gh auth login." }
    if ($env:HPS_RELEASE_TOKEN) { $env:GH_TOKEN = $env:HPS_RELEASE_TOKEN }
    # 1. Resolve release
    $api = if ($Tag -eq "latest") {
        "https://api.github.com/repos/$Repo/releases/latest"
    } else {
        "https://api.github.com/repos/$Repo/releases/tags/$Tag"
    }

    Say "Looking up release ($Tag)..."
    $raw = & gh api $api
    if ($LASTEXITCODE -ne 0) { throw "Release access failed. Run gh auth login with an organization member account." }
    $release = $raw | ConvertFrom-Json
    $asset = $release.assets | Where-Object { $_.name -match "UserSetup.*x64.*\.exe$" } | Select-Object -First 1
    if (-not $asset) {
        $asset = $release.assets | Where-Object { $_.name -match "Setup.*x64.*\.exe$" } | Select-Object -First 1
    }
    if (-not $asset) { Fail "No Windows x64 installer .exe found in $Tag release. Visit https://github.com/$Repo/releases" }

    # 2. Download
    $installer = Join-Path $Tmp.FullName $asset.name
    if ($asset.name -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid release asset name" }
    if ($asset.digest -notmatch '^sha256:[a-fA-F0-9]{64}$') { throw "Release SHA-256 digest is missing" }
    Say "Downloading $($asset.name)"
    & gh release download $release.tag_name --repo $Repo --pattern $asset.name --dir $Tmp.FullName
    if ($LASTEXITCODE -ne 0) { throw "Release download failed" }
    $actual = (Get-FileHash -Path $installer -Algorithm SHA256).Hash
    if ($actual -ne ($asset.digest -replace '^sha256:', '')) { throw "Release SHA-256 mismatch" }

    # 3. SmartScreen warning notice
    Write-Host ""
    Write-Host "⚠  Windows SmartScreen may warn ('Windows protected your PC')." -ForegroundColor Yellow
    Write-Host "   This is expected - the build is currently unsigned." -ForegroundColor Yellow
    Write-Host "   Click 'More info' -> 'Run anyway' to proceed." -ForegroundColor Yellow
    Write-Host ""

    # 4. Run installer
    Say "Launching installer..."
    Start-Process -FilePath $installer -Wait

    Say "Done."
    Write-Host "`n✅ $AppName 설치 완료." -ForegroundColor Green
    Write-Host "문제가 있으면: 운영자(Jay)에게 단톡방으로 알려주세요."
}
catch {
    Fail $_.Exception.Message
}
finally {
    if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue }
}
