param([ValidateSet('success', 'auth-failed', 'bad-digest', 'bad-name', 'missing-digest')][string]$Scenario = 'success')
$ErrorActionPreference = 'Stop'
$global:FixtureScenario = $Scenario
$global:FixtureBytes = [Text.Encoding]::UTF8.GetBytes('bootstrap fixture, never executed')
$sha = [Security.Cryptography.SHA256]::Create()
$global:FixtureDigest = ([BitConverter]::ToString($sha.ComputeHash($global:FixtureBytes))).Replace('-', '').ToLowerInvariant()
$global:FixtureLaunched = $false
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../install.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load only the production functions being exercised; never execute Main.
foreach ($name in @('Get-PrivateSourceText', 'Resolve-StudioAsset', 'Install-Studio')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $definition) { throw "Missing function $name" }
    Invoke-Expression $definition.Extent.Text
}
function Write-Info($message) {}
function Write-Ok($message) {}
function Write-Warn2($message) {}
function Write-Err2($message) {}
function Test-StudioInstalled { return $false }
function Unblock-File { param($LiteralPath) }
function gh {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'api') {
        if ($global:FixtureScenario -eq 'auth-failed') { $global:LASTEXITCODE = 1; return }
        if ($args[1] -eq 'repos/hypeproof/hypeproof-studio/contents/scripts/seed-sdk-binary.ps1') { return '# authenticated source fixture' }
        if ($args[1] -notmatch '^https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/(latest|tags/vlatest)$') { throw 'Wrong API repository' }
        $name = if ($global:FixtureScenario -eq 'bad-name') { '../HypeProof.UserSetup-x64.exe' } else { 'HypeProof.UserSetup-x64.exe' }
        $digest = if ($global:FixtureScenario -eq 'bad-digest') { '0' * 64 } else { $global:FixtureDigest }
        if ($global:FixtureScenario -eq 'missing-digest') { $digest = '' }
        return (@{tag_name='v0.1.56'; assets=@(@{name=$name;digest="sha256:$digest"})} | ConvertTo-Json -Depth 5)
    }
    if ($args[0] -ne 'release' -or $args[1] -ne 'download' -or $args[2] -ne 'v0.1.56') { throw 'Unexpected GitHub command/tag' }
    if ($args[[Array]::IndexOf($args, '--repo') + 1] -ne 'hypeproof/hypeproof-studio-releases') { throw 'Wrong asset repository' }
    $dir = $args[[Array]::IndexOf($args, '--dir') + 1]
    $name = $args[[Array]::IndexOf($args, '--pattern') + 1]
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $global:FixtureBytes)
}
function Start-Process {
    param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
    if ($global:FixtureScenario -ne 'success') { throw 'Unsafe installer launch' }
    if ((Get-FileHash $FilePath -Algorithm SHA256).Hash -ne $global:FixtureDigest) { throw 'Unverified installer' }
    $global:FixtureLaunched = $true
    return @{ExitCode=0}
}
$script:TempRoot = Join-Path $env:TEMP ('hps-bootstrap-fixture-' + [guid]::NewGuid())
try {
    $manifest = @{studio=@{releases_repo='hypeproof/hypeproof-studio-releases'; version='latest'; asset_glob='*UserSetup*.exe'; asset_glob_fallback='*Setup*.exe'}}
    if (-not (Install-Studio $manifest @{})) { throw 'Private asset resolution failed' }
    if (-not $global:FixtureLaunched) { throw 'Success path did not launch verified bytes' }
    if ((Get-PrivateSourceText 'https://raw.githubusercontent.com/hypeproof/hypeproof-studio/main/scripts/seed-sdk-binary.ps1') -ne '# authenticated source fixture') { throw 'Private seed read failed' }
    $manifest.studio.releases_repo = 'foreign/repo'
    $rejected = $false
    try { Resolve-StudioAsset $manifest | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Foreign repository was accepted' }
    Write-Host 'PASS: private Windows bootstrap functions'
    # Class kit mode goes through the same functions. Its fixture runs from here
    # so the Windows PowerShell 5.1 job that runs this file covers it too; it
    # throws on any failure.
    & (Join-Path $PSScriptRoot 'install-kit-fixture.ps1')
} finally {
    if (Test-Path $script:TempRoot) { Remove-Item -Recurse -Force $script:TempRoot }
}
