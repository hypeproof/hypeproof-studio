param([ValidateSet('success', 'auth-failed', 'bad-digest', 'bad-name')][string]$Scenario = 'success')
$ErrorActionPreference = 'Stop'
$global:FixtureScenario = $Scenario
$global:FixtureBytes = [Text.Encoding]::UTF8.GetBytes('fixture installer bytes, never executed')
$sha = [Security.Cryptography.SHA256]::Create()
$global:FixtureDigest = ([BitConverter]::ToString($sha.ComputeHash($global:FixtureBytes))).Replace('-', '').ToLowerInvariant()
$global:FixtureLaunched = $false
function global:gh {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'api') {
        if ($args[1] -ne 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/latest') { throw 'Wrong release repository' }
        if ($global:FixtureScenario -eq 'auth-failed') { $global:LASTEXITCODE = 1; return }
        $name = if ($global:FixtureScenario -eq 'bad-name') { '../HypeProof.UserSetup-x64.exe' } else { 'HypeProof.UserSetup-x64.exe' }
        $digest = if ($global:FixtureScenario -eq 'bad-digest') { '0' * 64 } else { $global:FixtureDigest }
        return (@{tag_name='v0.1.56'; assets=@(@{name=$name;digest="sha256:$digest"})} | ConvertTo-Json -Depth 5)
    }
    if ($args[0] -ne 'release' -or $args[1] -ne 'download') { throw 'Unexpected GitHub command' }
    $repo = $args[[Array]::IndexOf($args, '--repo') + 1]
    if ($repo -ne 'hypeproof/hypeproof-studio-releases') { throw 'Wrong asset repository' }
    $dir = $args[[Array]::IndexOf($args, '--dir') + 1]
    $name = $args[[Array]::IndexOf($args, '--pattern') + 1]
    [IO.File]::WriteAllBytes((Join-Path $dir $name), $global:FixtureBytes)
}
function global:Start-Process {
    param($FilePath, [switch]$Wait)
    if ($global:FixtureScenario -ne 'success') { throw 'Unsafe installer launch' }
    if ((Get-FileHash $FilePath -Algorithm SHA256).Hash -ne $global:FixtureDigest) { throw 'Unverified installer' }
    $global:FixtureLaunched = $true
}
& (Join-Path $PSScriptRoot '../install-win.ps1')
if (-not $global:FixtureLaunched) { throw 'Success path did not launch verified bytes' }
