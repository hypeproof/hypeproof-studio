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
                    'Resolve-StudioAsset', 'Install-Studio', 'Get-SeededSdk', 'Seed-Sdk', 'Invoke-ToolPost',
                    'Invoke-Doctor', 'Test-VersionAtLeast', 'Get-AppSdkVersion')) {
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
    return @{ExitCode=$global:FixtureSetupExit}
}

$global:FixtureSetupExit = 0
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
        'seed-sdk-binary.ps1'                 = "Write-Output 'seeding progress line'`n[IO.File]::WriteAllText((Join-Path `$PSScriptRoot 'SEEDER_RAN'), (`$args -join ' '))`nexit 0`n"
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
    # The installed app's vendored Agent SDK package names the native binary version;
    # the seeder must be asked for that version, not its own pin.
    $savedLocal = $env:LOCALAPPDATA
    $env:LOCALAPPDATA = Join-Path $root 'localappdata'
    $vendor = Join-Path $env:LOCALAPPDATA 'Programs\HypeProof Studio\resources\app\extensions\hypeproof-chat\dist\vendor\node_modules\@anthropic-ai\claude-agent-sdk'
    New-Item -ItemType Directory -Force -Path $vendor | Out-Null
    [IO.File]::WriteAllText((Join-Path $vendor 'package.json'), '{"name":"@anthropic-ai/claude-agent-sdk","optionalDependencies":{"@anthropic-ai/claude-agent-sdk-win32-arm64":"0.0.1","@anthropic-ai/claude-agent-sdk-win32-x64":"9.8.7"}}')
    # The seeder's own output goes to the screen, not into the return value:
    # a caller must get one boolean, and the participant must see progress.
    $seedResult = @(Seed-Sdk $manifest $receipt)
    if (-not (Test-Path -LiteralPath (Join-Path $script:KitDir 'SEEDER_RAN'))) { throw 'Seed-Sdk did not run the seeder from the kit' }
    $env:LOCALAPPDATA = $savedLocal
    $seederArgs = [IO.File]::ReadAllText((Join-Path $script:KitDir 'SEEDER_RAN'))
    if ($seederArgs -ne '-Version 9.8.7') { throw ('Seed-Sdk did not pass the installed app SDK version to the seeder: [{0}]' -f $seederArgs) }
    if ($seedResult.Count -ne 1 -or $seedResult[0] -isnot [bool]) { throw ('Seed-Sdk returned the seeder output instead of one boolean: {0}' -f ($seedResult -join ' | ')) }
    Invoke-ToolPost @{ post = 'gh_auth' }
    if ($global:KitGhCalls -ne 0) { throw 'gh was called in kit mode' }
    Write-Host '  ok   intact kit: version pinned, user installer launched, kit seeder run, gh never called'

    # --- A failed setup is not reported as installed -----------------------------
    $script:KitDir = New-Kit 'setup-fails'
    $script:TempRoot = Join-Path $root 'temp-setup-fails'
    $global:FixtureSetupExit = 1
    $failedReceipt = @{ studio = $null }
    Assert-Refused 'setup exit code 1' 'Studio setup exited with code 1' { Install-Studio (New-Manifest) $failedReceipt }
    if ($null -ne $failedReceipt.studio) { throw 'A failed setup was recorded in the receipt' }
    $global:FixtureSetupExit = 0

    Write-Host '  ok   failed setup refused and not recorded in the receipt'

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

    # --- Doctor (last: its stubs replace Get-SeededSdk for the rest of the file): an old optional tool is reported, an old required tool fails ----
    $SkipStudio = $true
    function Write-Head($message) {}
    function Update-ProcessPath {}
    function git { if ($args -contains 'core.autocrlf') { 'false' } elseif ($args -contains 'core.longpaths') { 'true' } }
    function Test-Command($name) { return $true }
    function Get-SeededSdk { return @{ version = '0.3.207' } }
    # PRA-12: the doctor now requires a POSIX shell; this fixture is about tool versions, so Git Bash is present.
    function Find-GitBash { return 'C:\Program Files\Git\bin\bash.exe' }
    function Get-ToolVersion($tool) { return $global:FixtureToolVersions[$tool.id] }
    $doctorManifest = @{ studio = @{ version = '9.9.9' }; tools = @(
        @{ id = 'git'; cmd = 'git'; min = '2.30'; required = $true },
        @{ id = 'gh';  cmd = 'gh';  min = '2.40'; required = $false }) }
    $global:FixtureToolVersions = @{ git = 'git version 2.45.0'; gh = 'gh version 2.20.0 (2022-11-01)' }
    if ((Invoke-Doctor $doctorManifest @{ studio = $null }) -ne 0) { throw 'An old optional tool failed the doctor' }
    $global:FixtureToolVersions = @{ git = 'git version 2.20.0'; gh = 'gh version 2.60.0' }
    if ((Invoke-Doctor $doctorManifest @{ studio = $null }) -eq 0) { throw 'An old required tool passed the doctor' }
    Write-Host '  ok   doctor: old optional tool reported, old required tool fails'

    if ($global:KitGhCalls -ne 0) { throw 'gh was called in kit mode' }
    Write-Host 'PASS: class kit Windows bootstrap functions'
} finally {
    if (Test-Path $root) { Remove-Item -Recurse -Force $root }
}
