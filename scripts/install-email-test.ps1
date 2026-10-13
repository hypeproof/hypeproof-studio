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

function Assert-HpsEmailManifest($Manifest) {
    $expected = @{
        'app.zip' = @{ sha256 = '378abcfa30aca94aab866a404b459385ecdbe53057d3d5844bb32c44cca982f1'; bytes = 196839798 }
        'sdk.zip' = @{ sha256 = 'f099b98ef4b2d048973d189928186ffc1835ef2de099aa9e62ee045b31889d05'; bytes = 80241659 }
    }
    if ($Manifest.schema -ne 1 -or $Manifest.build -cne '682dfd37' -or @($Manifest.artifacts).Count -ne 2) { throw 'Unexpected installation manifest.' }
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

function Test-HpsEmailExistingInstall([string]$Destination) {
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
    Assert-HpsEmailManifest $receipt
    return $true
}

function Test-HpsEmailSdkReady {
    $dir = Join-Path $env:APPDATA 'HypeProof-Studio\sdk\0.3.207'
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
    return ($receipt.sdkVersion -eq '0.3.207' -and $receipt.size -eq $size -and $size -ge 157286400 -and
        $receipt.tarballSha512 -ceq 'sha512-YPjVT0q6aXEM2MgN4CI6/9fqiTXwETji+4NoPOzCYuqAkhXZqp30Jsk7/NHqYGNNSfURKrsuAoliKB0rsbpbjg==')
}

function Install-HpsEmailOfflineSdk([string]$Tarball) {
    # Pinned offline adapter for seed-sdk-binary.ps1 / sdkBinaryManifest.ts.
    # Keep version, SRI, marker and destination in lockstep; never eval another script.
    $version = '0.3.207'
    $sri = 'sha512-YPjVT0q6aXEM2MgN4CI6/9fqiTXwETji+4NoPOzCYuqAkhXZqp30Jsk7/NHqYGNNSfURKrsuAoliKB0rsbpbjg=='
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
    $destination = Join-Path $base '682dfd37'
    Assert-HpsEmailDirectory $base
    Assert-HpsEmailNotRunning $base
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
            $tarball = Join-Path $sdk 'claude-agent-sdk-win32-x64-0.3.207.tgz'
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
        if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -ine $executable) { throw 'An unrelated shortcut has the same name. It was not changed.' }
        $shortcut.TargetPath = $executable
        $shortcut.WorkingDirectory = $destination
        $shortcut.Description = 'Private HypeProof Studio email workshop test'
        $shortcut.Save()
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
