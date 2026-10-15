param([string]$SdkZip = '', [string]$AppZip = '')
# Run with pwsh -NoProfile -File scripts/tests/install-email-test-fixture.ps1.
# Real PowerShell functions and archive IO; no Windows/Google acceptance claim.
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../install-email-test.ps1'
$source = [IO.File]::ReadAllText($sourcePath)
if ($source.ToCharArray() | Where-Object { [int]$_ -gt 127 }) { throw 'Installer must remain ASCII for Windows PowerShell 5.1 piping.' }
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$functions = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)
foreach ($function in $functions) { . ([scriptblock]::Create($function.Extent.Text)) }
function Expect-Failure([scriptblock]$Action, [string]$Match) {
    $message = $null
    try { & $Action } catch { $message = $_.Exception.Message }
    if (-not $message -or $message -notmatch $Match) { throw "Expected refusal matching $Match, got $message" }
}
$manifest = [pscustomobject]@{ schema=1; build='9d535c87'; artifacts=@(
    [pscustomobject]@{name='app.zip';path='/install/files/app.zip';sha256='9bf8d7f49f3dfcf00eeba349460c7820bc8a0237b156ce46841dfa30f517e168';bytes=196644907},
    [pscustomobject]@{name='sdk.zip';path='/install/files/sdk.zip';sha256='24be58876b19c2b957a8ed4601b9e62aa20bbc979f55dfbd527965fa6577de2e';bytes=121940997}
)}
Assert-HpsEmailManifest $manifest
foreach ($mutation in @(
    { param($m) $m.build='old' },
    { param($m) $m.artifacts[1]=$m.artifacts[0] },
    { param($m) $m.artifacts[0].path='https://other.example/app.zip' },
    { param($m) $m.artifacts[0].sha256='0'*64 },
    { param($m) $m.artifacts[0].bytes=1 }
)) {
    $copy = $manifest | ConvertTo-Json -Depth 4 | ConvertFrom-Json
    & $mutation $copy
    Expect-Failure { Assert-HpsEmailManifest $copy } 'manifest|artifact|pinned'
}
Write-Host 'PASS: version, duplicate, origin, digest and size manifest pins'
$tempRoot = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Unix -and (Test-Path '/private/tmp')) { '/private/tmp' } else { [IO.Path]::GetTempPath() }
$directory = Join-Path $tempRoot ('hps-email-fixture-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
try {
    $file = Join-Path $directory 'bytes'
    [IO.File]::WriteAllText($file, 'fixture never executed')
    $artifact = @{bytes=(Get-Item $file).Length; sha256=(Get-FileHash $file -Algorithm SHA256).Hash}
    Assert-HpsEmailHash $file $artifact
    [IO.File]::WriteAllText($file, 'fixture changed bytes')
    Expect-Failure { Assert-HpsEmailHash $file $artifact } 'integrity'
    $artifact.bytes = (Get-Item $file).Length
    Expect-Failure { Assert-HpsEmailHash $file $artifact } 'integrity'
    Write-Host 'PASS: actual downloaded byte corruption is rejected'
    Expect-Failure { Install-HpsEmailOfflineSdk $file } 'tarball integrity'

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    foreach ($entryName in @('safe/file.txt', '../escape.txt', '/absolute.txt', 'C:/drive.txt', 'safe/../escape.txt', 'file.txt:payload', 'CON.txt', 'trailing./file', 'a\..\escape')) {
        $zipPath = Join-Path $directory ([Guid]::NewGuid().ToString('N') + '.zip')
        $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
        $entry = $zip.CreateEntry($entryName)
        $writer = New-Object IO.StreamWriter($entry.Open())
        $writer.Write('safe fixture'); $writer.Dispose(); $zip.Dispose()
        $destination = Join-Path $directory ([Guid]::NewGuid().ToString('N'))
        if ($entryName -eq 'safe/file.txt') {
            Expand-HpsEmailZip $zipPath $destination
            if ([IO.File]::ReadAllText((Join-Path $destination 'safe/file.txt')) -ne 'safe fixture') { throw 'Safe extraction failed.' }
        } else {
            Expect-Failure { Expand-HpsEmailZip $zipPath $destination } 'Unsafe'
            if (Test-Path $destination) { throw 'Unsafe archive wrote before validation finished.' }
        }
    }
    Write-Host 'PASS: safe archive extracts; Windows path traversal/alias entries write nothing'

    $origin = 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev'
    Expect-Failure { Get-HpsEmailArtifact 'https://unrelated.invalid' '/install/manifest.json' 'synthetic' $file } 'Invalid download'
    Expect-Failure { Get-HpsEmailArtifact $origin '/install/files/app.zip?redirect=1' 'synthetic' $file } 'Invalid download'
    # Exercise the actual HTTP response handling with a fake transport, not a request to a service.
    $downloadFn = ($functions | Where-Object Name -eq 'Get-HpsEmailArtifact').Extent.Text.Replace('[Net.HttpWebRequest]::Create($Origin + $Path)', '(New-FixtureRequest)')
    . ([scriptblock]::Create($downloadFn))
    function New-FixtureRequest {
        $r = [pscustomobject]@{AllowAutoRedirect=$true;Timeout=0;ReadWriteTimeout=0;Headers=@{}; Status=$script:FixtureStatus}
        $r | Add-Member ScriptMethod GetResponse {
            if ($this.AllowAutoRedirect) { throw 'Unsafe automatic redirect.' }
            if ($this.Headers.Authorization -ne 'Bearer synthetic') { throw 'Expected in-memory Bearer header.' }
            $response = [pscustomobject]@{StatusCode=$this.Status}
            $response | Add-Member ScriptMethod Dispose { }
            $response | Add-Member ScriptMethod GetResponseStream { return [IO.MemoryStream]::new([Text.Encoding]::ASCII.GetBytes('downloaded')) }
            return $response
        }
        return $r
    }
    foreach ($status in @(301,302,303,307,308,401,403,500)) {
        $script:FixtureStatus=$status
        $out = Join-Path $directory "response-$status"
        Expect-Failure { Get-HpsEmailArtifact $origin '/install/files/app.zip' 'synthetic' $out } 'Download failed'
        if (Test-Path $out) { throw 'Non-200 response was saved.' }
    }
    $script:FixtureStatus=200
    $out = Join-Path $directory 'response-200'
    Get-HpsEmailArtifact $origin '/install/files/app.zip' 'synthetic' $out
    if ([IO.File]::ReadAllText($out) -ne 'downloaded') { throw 'Successful download failed.' }
    Write-Host 'PASS: HTTP redirect/auth/server errors fail closed; only direct200 is saved'

    $existing = Join-Path $directory 'existing'
    if (Test-HpsEmailExistingInstall $existing) { throw 'Absent installation was reused.' }
    New-Item -ItemType Directory -Path $existing | Out-Null
    $userData = Join-Path $existing 'student-data.txt'
    [IO.File]::WriteAllText($userData, 'preserve me')
    Expect-Failure { Test-HpsEmailExistingInstall $existing } 'preserved'
    [IO.File]::WriteAllText((Join-Path $existing 'HypeProof Studio.exe'), 'not executable')
    [IO.File]::WriteAllText((Join-Path $existing '.email-test-install.json'), ($manifest | ConvertTo-Json -Depth 4))
    if (-not (Test-HpsEmailExistingInstall $existing)) { throw 'Matching receipt was not reused.' }
    $old = $manifest | ConvertTo-Json -Depth 4 | ConvertFrom-Json
    $old.build = 'old'
    [IO.File]::WriteAllText((Join-Path $existing '.email-test-install.json'), ($old | ConvertTo-Json -Depth 4))
    Expect-Failure { Test-HpsEmailExistingInstall $existing } 'manifest'
    if ([IO.File]::ReadAllText($userData) -ne 'preserve me') { throw 'Existing user data changed.' }
    Write-Host 'PASS: rerun reuses matching receipt only; unknown/old folders and user data preserved'

    $pilotBase = Join-Path $directory 'pilot'
    $previous = Join-Path $pilotBase '682dfd37'
    New-Item -ItemType Directory -Path $previous -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $previous 'HypeProof Studio.exe'), 'old app kept')
    $legacy = [pscustomobject]@{schema=1;build='682dfd37';artifacts=@(
        [pscustomobject]@{name='app.zip';path='/install/files/app.zip';sha256='378abcfa30aca94aab866a404b459385ecdbe53057d3d5844bb32c44cca982f1';bytes=196839798},
        [pscustomobject]@{name='sdk.zip';path='/install/files/sdk.zip';sha256='f099b98ef4b2d048973d189928186ffc1835ef2de099aa9e62ee045b31889d05';bytes=80241659}
    )}
    $legacyReceipt = Join-Path $previous '.email-test-install.json'
    [IO.File]::WriteAllText($legacyReceipt, ($legacy | ConvertTo-Json -Depth 4))
    $newExe = Join-Path $pilotBase '9d535c87/HypeProof Studio.exe'
    Assert-HpsEmailShortcutTarget (Join-Path $previous 'HypeProof Studio.exe') $pilotBase $newExe
    Assert-HpsEmailShortcutTarget $newExe $pilotBase $newExe
    Expect-Failure { Assert-HpsEmailShortcutTarget (Join-Path $directory 'unrelated.exe') $pilotBase $newExe } 'unrelated'
    $legacy.artifacts[0].sha256 = '0'*64
    [IO.File]::WriteAllText($legacyReceipt, ($legacy | ConvertTo-Json -Depth 4))
    Expect-Failure { Assert-HpsEmailShortcutTarget (Join-Path $previous 'HypeProof Studio.exe') $pilotBase $newExe } 'pinned'
    Write-Host 'PASS: shortcut handover accepts only the current target or a verified previous pilot; unrelated/corrupt installs are preserved'

    $oldAppData = $env:APPDATA
    try {
        $env:APPDATA = Join-Path $directory 'profile-appdata'
        $profile = Join-Path $env:APPDATA 'HypeProof Studio/User/globalStorage'
        New-Item -ItemType Directory -Path $profile -Force | Out-Null
        $state = Join-Path $profile 'state.vscdb'
        [IO.File]::WriteAllText($state, 'synthetic encrypted storage bytes')
        Backup-HpsEmailUserData $pilotBase
        $snapshot = Join-Path $pilotBase 'rollback-before-9d535c87/profile/User/globalStorage/state.vscdb'
        if ([IO.File]::ReadAllText($snapshot) -cne [IO.File]::ReadAllText($state)) { throw 'Profile snapshot lost bytes.' }
        [IO.File]::WriteAllText($state, 'new version changed storage')
        Backup-HpsEmailUserData $pilotBase
        if ([IO.File]::ReadAllText($snapshot) -cne 'synthetic encrypted storage bytes') { throw 'Rerun overwrote the pre-update profile.' }
        if ([IO.File]::ReadAllText($state) -cne 'new version changed storage') { throw 'Backup changed live user data.' }
        Remove-Item -LiteralPath (Join-Path $pilotBase 'rollback-before-9d535c87/complete.json')
        Expect-Failure { Backup-HpsEmailUserData $pilotBase } 'incomplete rollback'
        Write-Host 'PASS: pre-update profile is copied, rerun preserves original bytes, incomplete snapshot blocks launch'
    } finally { $env:APPDATA = $oldAppData }

    if ($SdkZip) {
        $oldAppData = $env:APPDATA; $oldTemp = $env:TEMP; $oldSystem = $env:SystemRoot
        try {
            $env:APPDATA = Join-Path $directory 'appdata'; $env:TEMP = $directory
            $bundle = Join-Path $directory 'sdk-bundle'
            Expand-HpsEmailZip $SdkZip $bundle
            $tarball = Join-Path $bundle 'claude-agent-sdk-win32-x64-0.3.299.tgz'
            $canonical = [IO.File]::ReadAllText((Join-Path $bundle 'seed-sdk-binary.ps1'))
            $manifestSource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../extensions/hypeproof-chat/src/sdkBinaryManifest.ts'))
            $sri = 'sha512-PWHbjAdrecVlmR0kdgsX20QvUiFgWQl4zskuWd6Ieg3e5w+Ol0FZGXYRLS+Erd+pYUEZBNjDCqK2yd2KdBbDQw=='
            if (-not $canonical.Contains($sri) -or -not $manifestSource.Contains($sri) -or -not $canonical.Contains('0.3.299')) { throw 'Offline SDK pins drifted from canonical sources.' }
            if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
                $env:SystemRoot = Join-Path $directory 'mock-windows'
                New-Item -ItemType Directory -Path (Join-Path $env:SystemRoot 'System32') | Out-Null
                New-Item -ItemType SymbolicLink -Path (Join-Path $env:SystemRoot 'System32/tar.exe') -Target '/usr/bin/tar' | Out-Null
            }
            Install-HpsEmailOfflineSdk $tarball
            if (-not (Test-HpsEmailSdkReady)) { throw 'Extracted actual SDK was not accepted by the runtime marker contract.' }
            $marker = Join-Path $env:APPDATA 'HypeProof-Studio/sdk/0.3.299/claude.exe.verified.json'
            $before = [IO.File]::ReadAllText($marker)
            Install-HpsEmailOfflineSdk $tarball
            if ([IO.File]::ReadAllText($marker) -cne $before) { throw 'Rerun replaced a valid SDK receipt.' }
            Remove-Item -LiteralPath $marker
            if (Test-HpsEmailSdkReady) { throw 'Missing SDK receipt was accepted.' }
            Expect-Failure { Install-HpsEmailOfflineSdk $tarball } 'preserved'
            Write-Host 'PASS: real pinned SDK tarball extracts, canonical marker is accepted, rerun preserves it, incomplete seed refused (native binary NOT executed)'
        } finally { $env:APPDATA=$oldAppData; $env:TEMP=$oldTemp; $env:SystemRoot=$oldSystem }
    }

    if ($AppZip) {
        Assert-HpsEmailHash $AppZip $manifest.artifacts[0]
        $app = Join-Path $directory 'actual-app'
        Expand-HpsEmailZip $AppZip $app
        $product = Get-Content -LiteralPath (Join-Path $app 'resources/app/product.json') -Raw | ConvertFrom-Json
        $ext = Join-Path $app 'resources/app/extensions/hypeproof-chat'
        $sdkPackage = Get-Content -LiteralPath (Join-Path $ext 'dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk/package.json') -Raw | ConvertFrom-Json
        $candidate = Get-Content -LiteralPath (Join-Path $app '.email-candidate-source.json') -Raw | ConvertFrom-Json
        if ($product.commit -cne '720be6610200bc8da81686bd3eb20591d6407d88' -or
            $candidate.extension_source -cne '9d535c87b133a99d83f92a1e176b833253a6ac23' -or
            $sdkPackage.version -cne '0.3.299') { throw 'Packaged shell/extension/SDK version drift.' }
        foreach ($entry in $candidate.field_files.psobject.Properties) {
            if ((Get-FileHash -LiteralPath (Join-Path $ext $entry.Name) -Algorithm SHA256).Hash -ine $entry.Value) { throw 'Packaged extension hash drift.' }
        }
        foreach ($name in @('oauth/google-desktop-client.json','resources/google-shared-runner.json')) {
            if (-not (Test-Path -LiteralPath (Join-Path $ext $name) -PathType Leaf)) { throw 'Operator Google configuration missing.' }
        }
        Write-Host 'PASS: actual app ZIP hash and extraction; shell720be661, extension9d535c87, SDK0.3.299, seven extension hashes and operator resources (Windows NOT executed)'
    }

    function Get-Process { @([pscustomobject]@{Path=(Join-Path $directory '9d535c87/HypeProof Studio.exe');ProcessName='HypeProof Studio'}) }
    Expect-Failure { Assert-HpsEmailNotRunning $directory } 'Close HypeProof'
    Assert-HpsEmailNotRunning (Join-Path $directory 'unrelated')
    Expect-Failure { Assert-HpsEmailSharedProfileIdle } 'every HypeProof'
    Write-Host 'PASS: running test application blocks installation; unrelated apps preserved'
} finally { Remove-Item -LiteralPath $directory -Recurse -Force }
Write-Host 'PASS: installer fixtures complete. Real Windows installation remains NOT RUN.'
