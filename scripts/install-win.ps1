# Requires GitHub CLI and a member login (gh auth login).
# Download this script using the authenticated GitHub API, then run it locally.
$ErrorActionPreference = "Stop"
$Repo = "hypeproof/hypeproof-studio-releases"
$AppName = "HypeProof Studio"
$Tag = if ($env:HPS_VERSION) { $env:HPS_VERSION } else { "latest" }
$Tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("hps-" + [Guid]::NewGuid().ToString("N"))) -Force

function Say($msg) { Write-Host "`n▶ $msg" -ForegroundColor Magenta }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# One release API answer as an object, or $null when gh fails.
function Get-ReleaseJson([string]$url) {
    $raw = & gh api $url
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    return (($raw -join "`n") | ConvertFrom-Json)
}

# The per-user installer, else the machine installer, or $null.
function Select-WindowsAsset($release) {
    if (-not $release -or -not $release.PSObject.Properties['assets']) { return $null }
    foreach ($pattern in @("UserSetup.*x64.*\.exe$", "Setup.*x64.*\.exe$")) {
        $hit = @($release.assets) | Where-Object { $_ -and $_.PSObject.Properties['name'] -and ([string]$_.name) -match $pattern } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

# /releases/latest when it has a Windows installer; otherwise the newest published
# release (no drafts, no prereleases, ordered by created_at like /releases/latest)
# that has one. Returns @{ release; asset; latest_tag } or throws.
function Find-WindowsRelease {
    $latest = Get-ReleaseJson "https://api.github.com/repos/$Repo/releases/latest"
    $latestTag = if ($latest -and $latest.PSObject.Properties['tag_name']) { [string]$latest.tag_name } else { "" }
    $hit = Select-WindowsAsset $latest
    if ($hit) { return @{ release = $latest; asset = $hit; latest_tag = $latestTag } }
    $published = @()
    $read = $false
    for ($page = 1; $page -le 10; $page++) {
        $list = Get-ReleaseJson "https://api.github.com/repos/$Repo/releases?per_page=100&page=$page"
        if ($null -eq $list) { break }
        $read = $true
        # foreach, not @(): Windows PowerShell 5.1 emits a parsed JSON array as one object.
        $items = @(); foreach ($x in $list) { $items += $x }
        foreach ($r in $items) {
            if (-not $r -or -not $r.PSObject.Properties['tag_name']) { continue }
            if ($r.PSObject.Properties['draft'] -and $r.draft) { continue }
            if ($r.PSObject.Properties['prerelease'] -and $r.prerelease) { continue }
            $published += $r
        }
        if ($items.Count -lt 100) { break }
    }
    if (-not $latest -and -not $read) { throw "Release access failed. Run gh auth login with an organization member account." }
    $sorted = @($published | Sort-Object -Property @{ Expression = { if ($_.PSObject.Properties['created_at']) { [string]$_.created_at } else { "" } } } -Descending)
    foreach ($r in $sorted) {
        $hit = Select-WindowsAsset $r
        if ($hit) { return @{ release = $r; asset = $hit; latest_tag = $latestTag } }
    }
    throw "No release in $Repo has a Windows x64 installer yet. Ask the operator for a Windows build."
}

try {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "Install GitHub CLI, then run gh auth login." }
    if ($env:HPS_RELEASE_TOKEN) { $env:GH_TOKEN = $env:HPS_RELEASE_TOKEN }
    # 1. Resolve release
    # A pinned HPS_VERSION installs exactly that tag. Without one, take the newest
    # release that has a Windows installer: releases can be macOS only
    # (config/release-platforms.json in hypeproof-studio), so /releases/latest
    # alone would leave new Windows installs with nothing to install.
    if ($Tag -eq "latest") {
        Say "Looking up the newest release with a Windows installer..."
        $found = Find-WindowsRelease
        $release = $found.release
        $asset = $found.asset
        if ($found.latest_tag -and $found.latest_tag -ne [string]$release.tag_name) {
            Write-Host "   The newest release $($found.latest_tag) is macOS only; installing $($release.tag_name)." -ForegroundColor Yellow
        }
    } else {
        Say "Looking up release ($Tag)..."
        $release = Get-ReleaseJson "https://api.github.com/repos/$Repo/releases/tags/$Tag"
        if (-not $release) { throw "Release access failed. Run gh auth login with an organization member account." }
        $asset = Select-WindowsAsset $release
        if (-not $asset) { Fail "No Windows x64 installer .exe found in $Tag release. Unset HPS_VERSION to install the newest release that has one." }
    }

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
