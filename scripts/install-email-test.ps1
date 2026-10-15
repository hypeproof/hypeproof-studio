# Private workshop installer. ASCII source for Windows PowerShell 5.1 / irm | iex.
# Production installation and existing user data are never replaced.
function Get-HpsEmailArtifact([string]$Origin, [string]$Path, [string]$Token, [string]$OutFile) {
    if ($Origin -cne 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev' -or
        $Path -cnotmatch '^/install/(manifest\.json|files/(app|sdk)\.zip)$') { throw 'Invalid download origin or path.' }
    $request = [Net.HttpWebRequest]::Create($Origin + $Path)
    $request.AllowAutoRedirect = $false
    $request.Timeout = 120000
    $request.ReadWriteTimeout = 120000
    $request.Headers['Authorization'] = 'Bearer ' + $Token
    $response = $null
    $stream = $null
    $file = $null
    try {
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { throw 'Non-success response.' }
        $stream = $response.GetResponseStream()
        $file = [IO.File]::Open($OutFile, [IO.FileMode]::CreateNew)
        $stream.CopyTo($file)
    } catch { throw 'Download failed. Check the participation code and network, then retry. Redirects are refused.' }
    finally {
        if ($file) { $file.Dispose() }
        if ($stream) { $stream.Dispose() }
        if ($response) { $response.Dispose() }
        $request.Headers.Remove('Authorization')
    }
}

function Assert-HpsEmailManifest($Manifest, [string]$Build = '32ba0ac2') {
    $expected = @{
        'app.zip' = @{ sha256 = '4ce6a985b94ad876c7ce7ec57aa9616f635fc32a8cf0866607075d84b7b7c3d6'; bytes = 196647056 }
        'sdk.zip' = @{ sha256 = '24be58876b19c2b957a8ed4601b9e62aa20bbc979f55dfbd527965fa6577de2e'; bytes = 121940997 }
    }
    if ($Build -ceq '682dfd37') {
        # Read-only recognition of the previous pilot for shortcut handover.
        $expected = @{
            'app.zip' = @{ sha256 = '378abcfa30aca94aab866a404b459385ecdbe53057d3d5844bb32c44cca982f1'; bytes = 196839798 }
            'sdk.zip' = @{ sha256 = 'f099b98ef4b2d048973d189928186ffc1835ef2de099aa9e62ee045b31889d05'; bytes = 80241659 }
        }
    } elseif ($Build -ceq '9d535c87') {
        $expected['app.zip'] = @{ sha256 = '9bf8d7f49f3dfcf00eeba349460c7820bc8a0237b156ce46841dfa30f517e168'; bytes = 196644907 }
    } elseif ($Build -ceq '0b57074d') {
        $expected['app.zip'] = @{ sha256 = 'cb0faa1c19bd710833a6539a5f31d8f1e224d20946da67c60493cf0592da0fff'; bytes = 196645359 }
    } elseif ($Build -ceq 'f90b65e3') {
        $expected['app.zip'] = @{ sha256 = '6b30b955a6f3365521300db8dfab78716f7710ebded9ec6720c52604de7b6b29'; bytes = 196645861 }
    } elseif ($Build -ceq '3f1a3f20') {
        $expected['app.zip'] = @{ sha256 = '4472b4c05630a31e4e658b5ccbf1e54490a424ff88fb3953f3d6981868143ea4'; bytes = 196646585 }
    } elseif ($Build -cne '32ba0ac2') { throw 'Unexpected installation build.' }
    if ($Manifest.schema -ne 1 -or $Manifest.build -cne $Build -or @($Manifest.artifacts).Count -ne 2) { throw 'Unexpected installation manifest.' }
    $seen = @{}
    foreach ($artifact in $Manifest.artifacts) {
        if (-not $expected.ContainsKey([string]$artifact.name) -or $seen.ContainsKey([string]$artifact.name)) { throw 'Unexpected or duplicate artifact.' }
        $seen[$artifact.name] = $true
        $pin = $expected[$artifact.name]
        if ($artifact.path -cne ('/install/files/' + $artifact.name) -or
            $artifact.sha256 -cne $pin.sha256 -or $artifact.bytes -ne $pin.bytes) { throw 'Artifact does not match this pinned installer.' }
    }
}

function Assert-HpsEmailHash([string]$Path, $Artifact) {
    if ((Get-Item -LiteralPath $Path).Length -ne $Artifact.bytes -or
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Artifact.sha256) { throw 'Download integrity check failed. Nothing will be installed.' }
}

function Expand-HpsEmailZip([string]$Path, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        # Validate every entry before writing any; reject aliases on Windows too.
        $seen = @{}
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            $parts = $name.TrimEnd('/').Split('/')
            if ($name.StartsWith('/') -or $name.Contains(':') -or $parts.Count -eq 0 -or
                (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe archive entry.' }
            foreach ($part in $parts) {
                if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$|[<>"|?*\x00-\x1f]' -or
                    $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe archive path.' }
            }
            if ($seen.ContainsKey($name.TrimEnd('/'))) { throw 'Duplicate archive entry.' }
            $seen[$name.TrimEnd('/')] = $true
        }
        [IO.Compression.ZipFile]::ExtractToDirectory($Path, $Destination)
    } finally { $zip.Dispose() }
}

function Assert-HpsEmailNotRunning([string]$Root) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($process in @(Get-Process -ErrorAction Stop)) {
        try { $path = $process.Path } catch { $path = $null }
        if ($path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Close HypeProof Studio Email Test, then retry.' }
    }
}

function Assert-HpsEmailDirectory([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation path is not a normal directory.' }
        }
        $parent = [IO.Directory]::GetParent($current)
        $current = if ($parent) { $parent.FullName } else { $null }
    }
}

function Test-HpsEmailExistingInstall([string]$Destination, [string]$Build = '32ba0ac2') {
    if (-not (Test-Path -LiteralPath $Destination)) { return $false }
    Assert-HpsEmailDirectory $Destination
    $receiptPath = Join-Path $Destination '.email-test-install.json'
    $executable = Join-Path $Destination 'HypeProof Studio.exe'
    foreach ($path in @($receiptPath, $executable)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Existing installation is incomplete or has no matching receipt. It was preserved; ask the operator for help.'
        }
    }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    Assert-HpsEmailManifest $receipt $Build
    return $true
}

function Assert-HpsEmailShortcutTarget([string]$Target, [string]$Base, [string]$Executable) {
    if ($Target -ieq $Executable) { return }
    foreach ($build in @('682dfd37', '9d535c87', '0b57074d', 'f90b65e3', '3f1a3f20')) {
        $previous = Join-Path $Base $build
        if ($Target -ieq (Join-Path $previous 'HypeProof Studio.exe') -and
            (Test-HpsEmailExistingInstall $previous $build)) { return }
    }
    throw 'An unrelated shortcut has the same name. It was not changed.'
}

function Backup-HpsEmailUserData([string]$Base) {
    # Both pilot shells have the same product identity. Preserve the complete
    # profile before its first use by this version, including encrypted storage.
    if ($env:VSCODE_PORTABLE -or $env:VSCODE_APPDATA -or $env:VSCODE_DEV) { throw 'Custom Studio profile routing requires an operator backup before updating.' }
    if (-not $env:APPDATA) { throw 'Windows roaming user folder is unavailable.' }
    $source = Join-Path $env:APPDATA 'HypeProof Studio'
    if (-not (Test-Path -LiteralPath $source)) { return }
    Assert-HpsEmailDirectory $source
    $backup = Join-Path $Base 'rollback-before-32ba0ac2'
    Assert-HpsEmailDirectory $backup
    $receipt = Join-Path $backup 'complete.json'
    if (Test-Path -LiteralPath $backup) {
        if (-not (Test-Path -LiteralPath $receipt -PathType Leaf) -or
            ((Get-Item -LiteralPath $receipt -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'An incomplete rollback snapshot exists. It was preserved; ask the operator for help.'
        }
        $saved = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
        if ($saved.build -cne '32ba0ac2' -or $saved.source -ine $source -or
            -not (Test-Path -LiteralPath (Join-Path $backup 'profile') -PathType Container)) {
            throw 'Unexpected rollback snapshot. It was preserved.'
        }
        return
    }
    $entries = @(Get-ChildItem -LiteralPath $source -Recurse -Force -ErrorAction Stop)
    if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
        throw 'User profile contains linked files. Ask the operator to preserve it before updating.'
    }
    New-Item -ItemType Directory -Path $backup | Out-Null
    Copy-Item -LiteralPath $source -Destination (Join-Path $backup 'profile') -Recurse -Force -ErrorAction Stop
    $saved = @{build='32ba0ac2';source=$source;createdAt=(Get-Date).ToUniversalTime().ToString('o')}
    [IO.File]::WriteAllText($receipt, ($saved | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

function Assert-HpsEmailSharedProfileIdle {
    foreach ($process in @(Get-Process -ErrorAction Stop)) {
        if ($process.ProcessName -ieq 'HypeProof Studio') {
            throw 'Close every HypeProof Studio window before updating its shared user profile.'
        }
    }
}

function Test-HpsEmailSdkReady {
    $dir = Join-Path $env:APPDATA 'HypeProof-Studio\sdk\0.3.299'
    Assert-HpsEmailDirectory $dir
    $binary = Join-Path $dir 'claude.exe'
    $marker = $binary + '.verified.json'
    foreach ($path in @($binary, $marker)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false }
    }
    try { $receipt = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json }
    catch { return $false }
    $size = (Get-Item -LiteralPath $binary).Length
    return ($receipt.sdkVersion -eq '0.3.299' -and $receipt.size -eq $size -and $size -ge 157286400 -and
        $receipt.tarballSha512 -ceq 'sha512-PWHbjAdrecVlmR0kdgsX20QvUiFgWQl4zskuWd6Ieg3e5w+Ol0FZGXYRLS+Erd+pYUEZBNjDCqK2yd2KdBbDQw==')
}

function Install-HpsEmailOfflineSdk([string]$Tarball) {
    # Pinned offline adapter for seed-sdk-binary.ps1 / sdkBinaryManifest.ts.
    # Keep version, SRI, marker and destination in lockstep; never eval another script.
    $version = '0.3.299'
    $sri = 'sha512-PWHbjAdrecVlmR0kdgsX20QvUiFgWQl4zskuWd6Ieg3e5w+Ol0FZGXYRLS+Erd+pYUEZBNjDCqK2yd2KdBbDQw=='
    $sha = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($Tarball)
    try { $actual = 'sha512-' + [Convert]::ToBase64String($sha.ComputeHash($stream)) }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($actual -cne $sri) { throw 'SDK tarball integrity check failed.' }
    $dest = Join-Path $env:APPDATA ('HypeProof-Studio\sdk\' + $version)
    Assert-HpsEmailDirectory $dest
    $binary = Join-Path $dest 'claude.exe'
    $marker = $binary + '.verified.json'
    if (Test-HpsEmailSdkReady) {
        Write-Host 'The matching SDK is already prepared.'
        return
    }
    if ((Test-Path -LiteralPath $binary) -or (Test-Path -LiteralPath $marker)) { throw 'An incomplete SDK already exists. It was preserved; ask the operator for help.' }
    $temp = Join-Path $env:TEMP ('hps-email-sdk-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (-not (Test-Path -LiteralPath $tar -PathType Leaf)) { throw 'Windows tar.exe is required (Windows 10 1803 or newer).' }
        & $tar -xzf $Tarball -C $temp 'package/claude.exe'
        if ($LASTEXITCODE -ne 0) { throw 'SDK extraction failed.' }
        $extracted = Join-Path $temp 'package\claude.exe'
        if (-not (Test-Path -LiteralPath $extracted -PathType Leaf) -or (Get-Item -LiteralPath $extracted).Length -lt 157286400) { throw 'SDK executable is missing or incomplete.' }
        $size = (Get-Item -LiteralPath $extracted).Length
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Move-Item -LiteralPath $extracted -Destination $binary
        $receipt = [ordered]@{
            sdkVersion=$version; size=$size; tarballSha512=$sri;
            verifiedAt=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ');
            seededBy='scripts/install-email-test.ps1'
        }
        [IO.File]::WriteAllText($marker, ($receipt | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    } finally { Remove-Item -LiteralPath $temp -Recurse -Force }
}

function Install-HpsEmailTest {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or
        -not [Environment]::Is64BitOperatingSystem -or
        (($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -notcontains 'AMD64') -or
        (($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -contains 'ARM64')) { throw 'This test requires Windows x64.' }
    if (-not [Environment]::Is64BitProcess) { throw 'Open 64-bit Windows PowerShell, then paste the install command again.' }
    foreach ($scope in @('MachinePolicy', 'UserPolicy')) {
        if ((Get-ExecutionPolicy -Scope $scope) -in @('Restricted', 'AllSigned')) { throw 'Organization policy restricts unsigned installation code. Ask your administrator; no policy was changed.' }
    }
    if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5.1 or newer is required.' }
    if (-not $env:LOCALAPPDATA -or -not $env:TEMP) { throw 'Windows user folders are unavailable.' }
    $origin = 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev'
    $base = Join-Path $env:LOCALAPPDATA 'HypeProof-Studio-Email-Test'
    $destination = Join-Path $base '32ba0ac2'
    Assert-HpsEmailDirectory $base
    Assert-HpsEmailNotRunning $base
    Assert-HpsEmailSharedProfileIdle
    $tmp = Join-Path $env:TEMP ('hps-email-install-' + [Guid]::NewGuid().ToString('N'))
    $stage = $null
    $secret = $null
    $token = $null
    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    $lock = $null
    try {
        New-Item -ItemType Directory -Path $base -Force | Out-Null
        $lock = [IO.File]::Open((Join-Path $base '.install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        New-Item -ItemType Directory -Path $tmp | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'HypeProof Studio Email Test - private Windows x64 installation'
        $secret = Read-Host 'Paste your participation code (hidden), then press Enter' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if (-not $token -or $token -match '[\r\n]') { throw 'A participation code is required.' }
        $manifestPath = Join-Path $tmp 'manifest.json'
        Get-HpsEmailArtifact $origin '/install/manifest.json' $token $manifestPath
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        Assert-HpsEmailManifest $manifest
        if (Test-HpsEmailExistingInstall $destination) {
            if (-not (Test-HpsEmailSdkReady)) { throw 'Existing app SDK is missing or invalid. User data was preserved; ask the operator to repair the SDK.' }
            Write-Host 'Using the existing verified build; user data is preserved.'
        } else {
            foreach ($artifact in $manifest.artifacts) {
                Write-Host ('Downloading ' + $artifact.name + ' ...')
                $file = Join-Path $tmp $artifact.name
                Get-HpsEmailArtifact $origin $artifact.path $token $file
                Assert-HpsEmailHash $file $artifact
            }
            # No bundled code executes until BOTH archive digests have passed.
            $sdk = Join-Path $tmp 'sdk'
            Expand-HpsEmailZip (Join-Path $tmp 'sdk.zip') $sdk
            $stage = Join-Path $base ('.staging-' + [Guid]::NewGuid().ToString('N'))
            Expand-HpsEmailZip (Join-Path $tmp 'app.zip') $stage
            if (-not (Test-Path -LiteralPath (Join-Path $stage 'HypeProof Studio.exe') -PathType Leaf)) { throw 'Application executable is missing.' }
            $tarball = Join-Path $sdk 'claude-agent-sdk-win32-x64-0.3.299.tgz'
            if (-not (Test-Path -LiteralPath $tarball -PathType Leaf)) { throw 'SDK tarball is missing.' }
            Write-Host 'Preparing the verified offline SDK ...'
            Install-HpsEmailOfflineSdk $tarball
            Assert-HpsEmailNotRunning $base
            [IO.File]::WriteAllText((Join-Path $stage '.email-test-install.json'), ($manifest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
            Move-Item -LiteralPath $stage -Destination $destination
            $stage = $null
        }
        $executable = Join-Path $destination 'HypeProof Studio.exe'
        $desktop = [Environment]::GetFolderPath('Desktop')
        if (-not $desktop) { throw 'Desktop folder is unavailable.' }
        $shortcutPath = Join-Path $desktop 'HypeProof Studio Email Test.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        if (Test-Path -LiteralPath $shortcutPath) {
            Assert-HpsEmailShortcutTarget $shortcut.TargetPath $base $executable
            if ($shortcut.Arguments) { throw 'The existing shortcut uses custom arguments. It was preserved; ask the operator for help.' }
        }
        Assert-HpsEmailSharedProfileIdle
        Backup-HpsEmailUserData $base
        if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -ine $executable) {
            $previousShortcut = Join-Path $base 'rollback-before-32ba0ac2.lnk'
            if (Test-Path -LiteralPath $previousShortcut) { throw 'Rollback shortcut already exists. It was preserved; ask the operator for help.' }
            Copy-Item -LiteralPath $shortcutPath -Destination $previousShortcut
        }
        $shortcut.TargetPath = $executable
        $shortcut.WorkingDirectory = $destination
        $shortcut.Description = 'Private HypeProof Studio email workshop test'
        $shortcut.Save()
        Write-Host 'Previous version and SDK are retained. The operator can restore the pre-update profile from the rollback snapshot.'
        Write-Host 'Ready. In Studio, paste the same participation code and start an activity.'
        Write-Host 'Choose: Isolated Windows email test. Google consent happens inside Studio.'
        Start-Process -FilePath $executable -WorkingDirectory $destination | Out-Null
    } finally {
        $token = $null
        if ($secret) { $secret.Dispose() }
        [Net.ServicePointManager]::SecurityProtocol = $oldTls
        if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
        if ($lock) { $lock.Dispose() }
    }
}

try { Install-HpsEmailTest }
catch { Write-Error ('Installation stopped: ' + $_.Exception.Message) -ErrorAction Stop }
