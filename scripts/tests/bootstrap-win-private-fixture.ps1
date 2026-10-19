param([ValidateSet('success', 'auth-failed', 'bad-digest', 'bad-name', 'missing-digest', 'mac-only-latest', 'paged', 'no-windows', 'pinned', 'pinned-missing', 'pinned-mac-only')][string]$Scenario = 'success')
$ErrorActionPreference = 'Stop'
$global:FixtureScenario = $Scenario
$global:FixtureBytes = [Text.Encoding]::UTF8.GetBytes('bootstrap fixture, never executed')
$sha = [Security.Cryptography.SHA256]::Create()
$global:FixtureDigest = ([BitConverter]::ToString($sha.ComputeHash($global:FixtureBytes))).Replace('-', '').ToLowerInvariant()
$global:FixtureLaunched = $false
. (Join-Path $PSScriptRoot 'win-release-set.ps1')
# The tag each positive scenario must download, and the manifest version it starts from.
$expectedTag = @{ 'success' = 'v0.1.56'; 'mac-only-latest' = 'v0.1.55'; 'paged' = 'v0.1.55'; 'pinned' = 'v0.1.50'; 'pinned-missing' = 'v0.1.56' }[$Scenario]
# Negative controls still resolve v0.1.56; they must stop at the name or digest check.
$global:FixtureExpectedTag = if ($expectedTag) { $expectedTag } elseif ($Scenario -in @('bad-digest', 'bad-name', 'missing-digest')) { 'v0.1.56' } else { $null }
$global:FixturePositive = [bool]$expectedTag
$startVersion = @{ 'pinned' = '0.1.50'; 'pinned-missing' = '0.1.40'; 'pinned-mac-only' = '0.1.57' }[$Scenario]
if (-not $startVersion) { $startVersion = 'latest' }
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../install.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the production functions being exercised; never execute Main.
foreach ($name in @('Get-PrivateSourceText', 'Get-StudioReleaseJson', 'Select-StudioWindowsAsset', 'Find-WindowsStudioRelease', 'Resolve-StudioAsset', 'Install-Studio')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing function $name" }
    Invoke-Expression $definition.Extent.Text
}
# install.ps1 runs under StrictMode; hold the release lookup to it too.
$script:KitDir = $null   # a parameter of install.ps1; member path
Set-StrictMode -Version Latest
function Write-Info($message) {}
function Write-Ok($message) {}
function Write-Warn2($message) {}
function Write-Err2($message) { $global:FixtureError = $message; Write-Host "XX $message" }
function Test-StudioInstalled { return $false }
function Unblock-File { param($LiteralPath) }
function gh {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'api') {
        if ($global:FixtureScenario -eq 'auth-failed') { $global:LASTEXITCODE = 1; return }
        if ($args[1] -eq 'repos/hypeproof/hypeproof-studio/contents/scripts/seed-sdk-binary.ps1') { return '# authenticated source fixture' }
        if ($args[1] -notlike 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases*') { throw 'Wrong API repository' }
        $scenario = if ($global:FixtureScenario -in @('bad-digest', 'bad-name', 'missing-digest')) { 'success' } else { $global:FixtureScenario }
        $name = if ($global:FixtureScenario -eq 'bad-name') { '../HypeProof.UserSetup-x64.exe' } else { 'HypeProof.UserSetup-x64.exe' }
        $digest = if ($global:FixtureScenario -eq 'bad-digest') { '0' * 64 } else { $global:FixtureDigest }
        if ($global:FixtureScenario -eq 'missing-digest') { $digest = '' }
        $json = Get-FixtureReleaseApi $args[1] $scenario $name $digest
        if ($null -eq $json) { $global:LASTEXITCODE = 1; return }
        return $json
    }
    if ($args[0] -ne 'release' -or $args[1] -ne 'download') { throw 'Unexpected GitHub command' }
    if ($args[2] -ne $global:FixtureExpectedTag) { throw "Downloaded $($args[2]), expected $($global:FixtureExpectedTag)" }
    if ($args[[Array]::IndexOf($args, '--repo') + 1] -ne 'hypeproof/hypeproof-studio-releases') { throw 'Wrong asset repository' }
    $dir = $args[[Array]::IndexOf($args, '--dir') + 1]
    $name = $args[[Array]::IndexOf($args, '--pattern') + 1]
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $global:FixtureBytes)
}
function Start-Process {
    param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
    if (-not $global:FixturePositive) { throw 'Unsafe installer launch' }
    if ((Get-FileHash $FilePath -Algorithm SHA256).Hash -ne $global:FixtureDigest) { throw 'Unverified installer' }
    $global:FixtureLaunched = $true
    return @{ExitCode=0}
}
$script:TempRoot = Join-Path $env:TEMP ('hps-bootstrap-fixture-' + [guid]::NewGuid())
try {
    $manifest = @{studio=@{releases_repo='hypeproof/hypeproof-studio-releases'; version=$startVersion; asset_glob='*UserSetup*.exe'; asset_glob_fallback='*Setup*.exe'}}
    if (-not (Install-Studio $manifest @{ studio = $null })) { throw 'Private asset resolution failed' }
    if (-not $global:FixtureLaunched) { throw 'Success path did not launch verified bytes' }
    if ('v' + $manifest.studio.version -ne $expectedTag) { throw "Receipt version $($manifest.studio.version), expected $expectedTag" }
    if ((Get-PrivateSourceText 'https://raw.githubusercontent.com/hypeproof/hypeproof-studio/main/scripts/seed-sdk-binary.ps1') -ne '# authenticated source fixture') { throw 'Private seed read failed' }
    $manifest.studio.releases_repo = 'foreign/repo'
    $rejected = $false
    try { Resolve-StudioAsset $manifest | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Foreign repository was accepted' }
    Write-Host "PASS: private Windows bootstrap functions ($Scenario installed $expectedTag)"
    # Class kit mode goes through the same functions. Its fixture runs from here
    # so the Windows PowerShell 5.1 job that runs this file covers it too; it
    # throws on any failure.
    if ($Scenario -eq 'success') { & (Join-Path $PSScriptRoot 'install-kit-fixture.ps1') }
} finally {
    if (Test-Path $script:TempRoot) { Remove-Item -Recurse -Force $script:TempRoot }
}
