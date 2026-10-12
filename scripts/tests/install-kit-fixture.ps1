# Class kit mode of install.ps1 (docs/INSTALL-CLASS-KIT.ko.md). The production
# functions must take the Studio installer and the SDK seeder from a kit folder,
# check them against the folder's SHA256SUMS first, and never call gh.
# Every case runs in one go; the first failure throws. Nothing is installed:
# Start-Process is a stub, and the kit's "seeder" only leaves a marker file.
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../install.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the production functions being exercised; never execute Main.
foreach ($name in @('Read-KitSums', 'Get-KitFile', 'Resolve-KitStudioAsset', 'Use-ClassKit',
                    'Resolve-StudioAsset', 'Install-Studio', 'Get-SeededSdk', 'Seed-Sdk', 'Invoke-ToolPost')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing function $name" }
    Invoke-Expression $definition.Extent.Text
}
# install.ps1 runs under this setting, so the kit functions are held to it here too.
Set-StrictMode -Version Latest
function Write-Info($message) {}
function Write-Ok($message) {}
function Write-Warn2($message) {}
function Write-Err2($message) {}
function Test-StudioInstalled { return $false }
function Unblock-File { param($LiteralPath) }
$global:KitGhCalls = 0
function gh { $global:KitGhCalls++; throw 'gh must not be called in kit mode' }
function Start-Process {
    param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
    $global:KitLaunchedHash = (Get-FileHash $FilePath -Algorithm SHA256).Hash
    return @{ExitCode=0}
}

$installer = 'HypeProof.StudioUserSetup-x64-9.9.9.exe'
$root = Join-Path ([IO.Path]::GetTempPath()) ('hps-kit-fixture-' + [guid]::NewGuid())

# A kit as make-class-kit.sh writes it. The system installer is listed first as a
# decoy for the fallback glob; the seeder only records that it ran.
function New-Kit([string]$name, [string[]]$without = @()) {
    $dir = Join-Path $root $name
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $files = [ordered]@{
        'HypeProof.StudioSetup-x64-9.9.9.exe' = 'fixture system installer, a decoy'
        $installer                            = 'fixture user installer, never executed'
        'seed-sdk-binary.ps1'                 = "[IO.File]::WriteAllText((Join-Path `$PSScriptRoot 'SEEDER_RAN'), 'ran')`nexit 0`n"
        'kit-info.txt'                        = "schema=1`nstudio_version=9.9.9`n"
    }
    $lines = @()
    foreach ($file in @($files.Keys)) {
        if ($without -contains $file) { continue }
        $path = Join-Path $dir $file
        [IO.File]::WriteAllText($path, $files[$file])
        $lines += ('{0}  {1}' -f (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant(), $file)
    }
    [IO.File]::WriteAllText((Join-Path $dir 'SHA256SUMS'), (($lines -join "`n") + "`n"))
    return $dir
}
function New-Manifest {
    return @{ studio = @{ releases_repo = 'hypeproof/hypeproof-studio-releases'; version = 'latest'
                          asset_glob = '*UserSetup-x64-*.exe'; asset_glob_fallback = '*Setup-x64-*.exe' }
              sdk    = @{ seed_script = 'seed-sdk-binary.ps1' } }
}
function Assert-Refused([string]$label, [string]$expect, [scriptblock]$block) {
    $message = $null
    try { & $block | Out-Null } catch { $message = $_.Exception.Message }
    if ($null -eq $message) { throw ('{0}: accepted' -f $label) }
    if ($message -notlike ('*' + $expect + '*')) { throw ('{0}: refused for another reason: {1}' -f $label, $message) }
    Write-Host ('  ok   {0}: refused ({1})' -f $label, $expect)
}

try {
    # --- Positive: an intact kit installs without gh --------------------------
    # The folder name has a space and Hangul ("kit" in Korean, built from code
    # points to keep this file ASCII): a Korean user folder looks like this.
    $script:KitDir = New-Kit ('good kit ' + [char]0xD0A4 + [char]0xD2B8)
    $script:TempRoot = Join-Path $root 'temp-good'
    $script:HpsHome = Join-Path $root 'home-good'
    $manifest = New-Manifest
    $receipt = @{ studio = $null; sdk = $null }
    Use-ClassKit $manifest
    if ($manifest.studio.version -ne '9.9.9') { throw 'Use-ClassKit did not pin the kit version' }
    $global:KitLaunchedHash = $null
    if (-not (Install-Studio $manifest $receipt)) { throw 'Install-Studio failed on an intact kit' }
    $want = (Get-FileHash (Join-Path $script:KitDir $installer) -Algorithm SHA256).Hash
    if ($global:KitLaunchedHash -ne $want) { throw 'Install-Studio did not launch the user installer from the kit' }
    if ($receipt.studio -ne '9.9.9') { throw 'Receipt does not record the kit version' }
    Seed-Sdk $manifest $receipt | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $script:KitDir 'SEEDER_RAN'))) { throw 'Seed-Sdk did not run the seeder from the kit' }
    Invoke-ToolPost @{ post = 'gh_auth' }
    if ($global:KitGhCalls -ne 0) { throw 'gh was called in kit mode' }
    Write-Host '  ok   intact kit: version pinned, user installer launched, kit seeder run, gh never called'

    # --- Negative controls ---------------------------------------------------
    $script:KitDir = New-Kit 'bad-installer'
    $script:TempRoot = Join-Path $root 'temp-bad-installer'
    [IO.File]::AppendAllText((Join-Path $script:KitDir $installer), 'x')
    Assert-Refused 'damaged installer (preflight)' 'SHA-256 mismatch' { Use-ClassKit (New-Manifest) }
    $global:KitLaunchedHash = $null
    Assert-Refused 'damaged installer (use site)' 'SHA-256 mismatch' { Install-Studio (New-Manifest) @{ studio = $null } }
    if ($null -ne $global:KitLaunchedHash) { throw 'A damaged installer was launched' }

    $script:KitDir = New-Kit 'bad-seeder'
    $script:HpsHome = Join-Path $root 'home-bad-seeder'
    [IO.File]::AppendAllText((Join-Path $script:KitDir 'seed-sdk-binary.ps1'), "# changed`n")
    Assert-Refused 'damaged seeder' 'SHA-256 mismatch' { Seed-Sdk (New-Manifest) @{ sdk = $null } }
    if (Test-Path -LiteralPath (Join-Path $script:KitDir 'SEEDER_RAN')) { throw 'A damaged seeder was executed' }

    $script:KitDir = New-Kit 'unlisted'
    [IO.File]::WriteAllText((Join-Path $script:KitDir 'extra.ps1'), 'exit 0')
    Assert-Refused 'file not in SHA256SUMS' 'not listed' { Get-KitFile 'extra.ps1' }
    Assert-Refused 'path outside the kit' 'invalid file name' { Get-KitFile '..\extra.ps1' }

    $script:KitDir = New-Kit 'malformed'
    [IO.File]::AppendAllText((Join-Path $script:KitDir 'SHA256SUMS'), (('0' * 64) + "  ../outside`n"))
    Assert-Refused 'malformed SHA256SUMS' 'malformed' { Use-ClassKit (New-Manifest) }

    $script:KitDir = New-Kit 'no-sums'
    Remove-Item -LiteralPath (Join-Path $script:KitDir 'SHA256SUMS')
    Assert-Refused 'no SHA256SUMS' 'SHA256SUMS not found' { Use-ClassKit (New-Manifest) }

    $script:KitDir = New-Kit 'mac-only' @('HypeProof.StudioSetup-x64-9.9.9.exe', $installer)
    Assert-Refused 'kit without a Windows installer' 'built without win32-x64' { Resolve-StudioAsset (New-Manifest) }

    if ($global:KitGhCalls -ne 0) { throw 'gh was called in kit mode' }
    Write-Host 'PASS: class kit Windows bootstrap functions'
} finally {
    if (Test-Path $root) { Remove-Item -Recurse -Force $root }
}
