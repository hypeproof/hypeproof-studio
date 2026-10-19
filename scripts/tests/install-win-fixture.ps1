param([ValidateSet('success', 'auth-failed', 'bad-digest', 'bad-name', 'mac-only-latest', 'paged', 'no-windows', 'pinned', 'pinned-mac-only')][string]$Scenario = 'success')
$ErrorActionPreference = 'Stop'
$global:FixtureScenario = $Scenario
$global:FixtureBytes = [Text.Encoding]::UTF8.GetBytes('fixture installer bytes, never executed')
$sha = [Security.Cryptography.SHA256]::Create()
$global:FixtureDigest = ([BitConverter]::ToString($sha.ComputeHash($global:FixtureBytes))).Replace('-', '').ToLowerInvariant()
$global:FixtureLaunched = $false
$global:FixtureDownloadedTag = $null
. (Join-Path $PSScriptRoot 'win-release-set.ps1')
# The tag each positive scenario must download; anything else is a wrong pick.
$expectedTag = @{ 'success' = 'v0.1.56'; 'mac-only-latest' = 'v0.1.55'; 'paged' = 'v0.1.55'; 'pinned' = 'v0.1.50' }[$Scenario]
if ($Scenario -in @('pinned', 'pinned-mac-only')) {
    $env:HPS_VERSION = @{ 'pinned' = 'v0.1.50'; 'pinned-mac-only' = 'v0.1.57' }[$Scenario]
} else {
    Remove-Item Env:HPS_VERSION -ErrorAction SilentlyContinue
}
function global:gh {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'api') {
        if ($args[1] -notlike 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases*') { throw 'Wrong release repository' }
        if ($global:FixtureScenario -eq 'auth-failed') { $global:LASTEXITCODE = 1; return }
        $scenario = if ($global:FixtureScenario -eq 'bad-digest' -or $global:FixtureScenario -eq 'bad-name') { 'success' } else { $global:FixtureScenario }
        $name = if ($global:FixtureScenario -eq 'bad-name') { '../HypeProof.UserSetup-x64.exe' } else { 'HypeProof.UserSetup-x64.exe' }
        $digest = if ($global:FixtureScenario -eq 'bad-digest') { '0' * 64 } else { $global:FixtureDigest }
        $json = Get-FixtureReleaseApi $args[1] $scenario $name $digest
        if ($null -eq $json) { $global:LASTEXITCODE = 1; return }
        return $json
    }
    if ($args[0] -ne 'release' -or $args[1] -ne 'download') { throw 'Unexpected GitHub command' }
    $global:FixtureDownloadedTag = $args[2]
    $repo = $args[[Array]::IndexOf($args, '--repo') + 1]
    if ($repo -ne 'hypeproof/hypeproof-studio-releases') { throw 'Wrong asset repository' }
    $dir = $args[[Array]::IndexOf($args, '--dir') + 1]
    $name = $args[[Array]::IndexOf($args, '--pattern') + 1]
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $global:FixtureBytes)
}
function global:Start-Process {
    param($FilePath, [switch]$Wait)
    if (-not $expectedTag) { throw 'Unsafe installer launch' }
    if ((Get-FileHash $FilePath -Algorithm SHA256).Hash -ne $global:FixtureDigest) { throw 'Unverified installer' }
    if ($global:FixtureDownloadedTag -ne $expectedTag) { throw "Installed $($global:FixtureDownloadedTag), expected $expectedTag" }
    $global:FixtureLaunched = $true
}
& (Join-Path $PSScriptRoot '../install-win.ps1')
if (-not $global:FixtureLaunched) { throw 'Success path did not launch verified bytes' }
Write-Host "PASS: $Scenario installed $($global:FixtureDownloadedTag)"
