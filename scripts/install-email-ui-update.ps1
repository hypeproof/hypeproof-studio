# Private Windows UI-only update. ASCII for PowerShell 5.1 / irm | iex.
function Get-HpsEmailArtifact([string]$Origin, [string]$Path, [string]$Token, [string]$OutFile) {
    if ($Origin -cne 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev' -or
        $Path -cnotmatch '^/install/files/ui-update\.zip$') { throw 'Invalid download origin or path.' }
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

function Expand-HpsUiUpdate([string]$ZipPath, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        if ($zip.Entries.Count -ne 2) { throw 'UI archive must contain exactly two files.' }
        $seen = @{}
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -cnotin @('index.js', 'index.css') -or $seen.ContainsKey($entry.FullName) -or
                $entry.Length -le 0 -or $entry.Length -gt 20971520 -or
                (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unexpected UI archive entry.' }
            $seen[$entry.FullName] = $true
        }
        [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
    } finally { $zip.Dispose() }
}

function Set-HpsUiAssets([string]$Destination, [string]$Extracted, [string]$PatchHash) {
    if (-not (Test-HpsEmailExistingInstall $Destination)) { throw 'Install the private test app before updating it.' }
    Assert-HpsEmailDirectory (Join-Path $Destination 'resources/app')
    $productPath = Join-Path $Destination 'resources/app/product.json'
    if (((Get-Item -LiteralPath $productPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected product path.' }
    $product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
    if ($product.commit -cne '682dfd37c3511f3fa159f1516aac230dcda2467c' -or $product.version -cne '0.1.5') { throw 'This update only supports private build 682dfd37.' }
    $assets = Join-Path $Destination 'resources/app/extensions/hypeproof-chat/webview-ui/dist/assets'
    Assert-HpsEmailDirectory $assets
    $names = @('index.js', 'index.css')
    $original = @{
        'index.js'='c82891aac312d02cebd4d3100d2c93860c4308c7cb2d2dc8e93c1ef427d82a95'
        'index.css'='0d1bce6e14447c6b8312c688a20f1abfdd8936d17fbbc9003b085e6861a1f12f'
    }
    $matches = 0
    foreach ($name in $names) {
        $path = Join-Path $assets $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected installed asset path.' }
        $current = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        $next = (Get-FileHash -LiteralPath (Join-Path $Extracted $name) -Algorithm SHA256).Hash
        if ($current -ieq $next) { $matches++ }
        elseif ($current -ine $original[$name]) { throw 'Installed UI files have other changes. They were preserved.' }
    }
    if ($matches -eq 2) { Write-Host 'This UI update is already installed.'; return }
    if ($matches -ne 0) { throw 'Partial UI update detected. Existing files were preserved; contact the operator.' }
    Assert-HpsEmailNotRunning $Destination
    $backup = Join-Path $Destination ('.ui-backup-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $assets $name) -Destination (Join-Path $backup $name) }
    $receipt = Join-Path $backup 'update.json'
    try {
        foreach ($name in $names) {
            Copy-Item -LiteralPath (Join-Path $Extracted $name) -Destination (Join-Path $assets $name) -Force
            if ((Get-FileHash -LiteralPath (Join-Path $assets $name) -Algorithm SHA256).Hash -ine
                (Get-FileHash -LiteralPath (Join-Path $Extracted $name) -Algorithm SHA256).Hash) { throw 'Updated asset integrity failure.' }
        }
        [IO.File]::WriteAllText($receipt, (@{schema=1;baseCommit=$product.commit;patchSha256=$PatchHash;installedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    } catch {
        $rollbackFailed = $false
        foreach ($name in $names) {
            try { Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $assets $name) -Force }
            catch { $rollbackFailed = $true }
        }
        if ($rollbackFailed) { throw 'Update stopped. Original UI files remain in the .ui-backup folder; contact the operator before opening Studio.' }
        throw 'Update stopped and original UI files were restored. User data was preserved.'
    }
    Write-Host 'UI update installed. Original UI files were backed up; conversations and Google settings were preserved.'
}

function Install-HpsEmailUiUpdate {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitProcess) { throw 'Open 64-bit Windows PowerShell.' }
    foreach ($scope in @('MachinePolicy', 'UserPolicy')) {
        if ((Get-ExecutionPolicy -Scope $scope) -in @('Restricted', 'AllSigned')) { throw 'Organization policy restricts unsigned code. No policy was changed.' }
    }
    $expectedHash = '724e48534a23a763cd94da1c7e74e86e45e97aee5c71a5180768e95db6095839'
    $expectedBytes = 168466 # __UI_UPDATE_BYTES__
    if ($expectedHash -cnotmatch '^[a-f0-9]{64}$' -or $expectedBytes -le 0) { throw 'This UI update has not been published yet.' }
    $destination = Join-Path $env:LOCALAPPDATA 'HypeProof-Studio-Email-Test/682dfd37'
    Assert-HpsEmailDirectory $destination
    if (-not (Test-HpsEmailExistingInstall $destination)) { throw 'Install the private test app before updating it.' }
    Assert-HpsEmailNotRunning $destination
    $tmp = Join-Path $env:TEMP ('hps-ui-update-' + [Guid]::NewGuid().ToString('N'))
    $lock = $null; $secret = $null; $token = $null
    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    try {
        $lock = [IO.File]::Open((Join-Path (Split-Path $destination -Parent) '.install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        New-Item -ItemType Directory -Path $tmp | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
        $secret = Read-Host 'Paste your participation code (hidden), then press Enter' -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if (-not $token -or $token -match '[\r\n]') { throw 'A participation code is required.' }
        $zip = Join-Path $tmp 'ui-update.zip'
        Get-HpsEmailArtifact 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev' '/install/files/ui-update.zip' $token $zip
        if ((Get-Item -LiteralPath $zip).Length -ne $expectedBytes -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ine $expectedHash) { throw 'UI download integrity check failed. Nothing was changed.' }
        $extracted = Join-Path $tmp 'assets'
        Expand-HpsUiUpdate $zip $extracted
        Set-HpsUiAssets $destination $extracted $expectedHash
        Start-Process -FilePath (Join-Path $destination 'HypeProof Studio.exe') -WorkingDirectory $destination | Out-Null
    } finally {
        $token = $null
        if ($secret) { $secret.Dispose() }
        [Net.ServicePointManager]::SecurityProtocol = $oldTls
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
        if ($lock) { $lock.Dispose() }
    }
}

try { Install-HpsEmailUiUpdate }
catch { Write-Error ('UI update stopped: ' + $_.Exception.Message) -ErrorAction Stop }
