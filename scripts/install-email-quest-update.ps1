# Private Windows quest extension update. ASCII for PowerShell 5.1 / irm | iex.
function Get-HpsEmailArtifact([string]$Origin, [string]$Path, [string]$Token, [string]$OutFile) {
    if ($Origin -cne 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev' -or
        $Path -cnotmatch '^/quest/files/extension\.zip$') { throw 'Invalid download origin or path.' }
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

function Get-HpsQuestPins {
    return @{
        sha256 = '1a77cbc1008cadbba2bbe948c4ca46f3b731257e7fa0a7014276bfa464773ada'
        bytes = 582857
        sourceCommit = 'd7106eda'
        files = @{
            'dist/extension.js' = @('22a79a769f1d93657c6e0a9e42d113d81fd6d5573bd1b9981ec74cf6ca8b7e1d','22a79a769f1d93657c6e0a9e42d113d81fd6d5573bd1b9981ec74cf6ca8b7e1d','aa74fd3ddbbdfffad34937d071465526f17e8ab97d9e77190f8ec95907585fc4','cafe1f4dc5b0168a48deeba878a09dfd79243b7fcda97eed340b6bda93fc8794')
            'media/chat.svg' = @('6e83bfc861e8967e367686ff41ced2ea7a3ac02c57b1a641df38a78af271a894','6e83bfc861e8967e367686ff41ced2ea7a3ac02c57b1a641df38a78af271a894','6e83bfc861e8967e367686ff41ced2ea7a3ac02c57b1a641df38a78af271a894','6e83bfc861e8967e367686ff41ced2ea7a3ac02c57b1a641df38a78af271a894')
            'media/hypeproof-theme.json' = @('3e8f494b2057704f6b5c780ba53b63798d29c7fee886ea8c984292a537647161','3e8f494b2057704f6b5c780ba53b63798d29c7fee886ea8c984292a537647161','44e49a9b066605d60472e3b5164836bfb87baf2edffc71f1538e60c0569579dd','a4dcb218307cc49d733ac3d835d727b859d071a02aab06da920773633cec5b9a')
            'package.json' = @('faa447f00efef56e1bb0b4d698ab44ad7769745ce62d4ddb4fdb8165feb5db35','faa447f00efef56e1bb0b4d698ab44ad7769745ce62d4ddb4fdb8165feb5db35','42768ce5b2c2a6681621750998b791590607f46e489c4d9a5de79c4153943362','de7d8ad7d8f12aa0acafb790b8a9902d97cdd502d44a53dfbe4234ace0f15c79')
            'webview-ui/dist/assets/index.css' = @('0d1bce6e14447c6b8312c688a20f1abfdd8936d17fbbc9003b085e6861a1f12f','a3c1efa1b862e641769f9b4383bfefdf204180bbcb04dddeeb4c18630dd2db56','a3c1efa1b862e641769f9b4383bfefdf204180bbcb04dddeeb4c18630dd2db56','cb7b57b8a9d254c469586e84ed961f402694ad679403e1699937f7f0cfc1b73f')
            'webview-ui/dist/assets/index.js' = @('c82891aac312d02cebd4d3100d2c93860c4308c7cb2d2dc8e93c1ef427d82a95','ce6f249455eb564547a58ffe5d27ec992e929391a1df371b7b5b5ab876d418a3','a6d1b5e3f83e3c3ba7cdd64c9bc01715c9864dd575246a6165d8cf138cba4563','021a15fb11e170781acd335fffeba47000c5702bfad61f79355479d838070333')
            'webview-ui/dist/index.html' = @('b5e4ef96f4b220ede9314970df919572dc9e3d147db8b5d9f7a62d4a5e5ee0b6','b5e4ef96f4b220ede9314970df919572dc9e3d147db8b5d9f7a62d4a5e5ee0b6','b5e4ef96f4b220ede9314970df919572dc9e3d147db8b5d9f7a62d4a5e5ee0b6','b5e4ef96f4b220ede9314970df919572dc9e3d147db8b5d9f7a62d4a5e5ee0b6')
        }
    }
}

# Each column is one complete revision; the last column is the update target.
function Get-HpsQuestRevisionCount($Pins) {
    if ($Pins.files.Count -ne 7) { throw 'Invalid extension revision matrix.' }
    $count = $null
    foreach ($name in $Pins.files.Keys) {
        $revisions = $Pins.files[$name]
        if ($revisions -isnot [Array] -or $revisions.Count -lt 1) { throw 'Invalid extension revision matrix.' }
        if ($null -eq $count) { $count = $revisions.Count }
        if ($revisions.Count -ne $count) { throw 'Incomplete extension revision matrix.' }
        foreach ($hash in $revisions) {
            if ($hash -isnot [string] -or $hash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid extension revision hash.' }
        }
    }
    return $count
}

function Assert-HpsQuestFile([string]$Path) {
    Assert-HpsEmailDirectory (Split-Path $Path -Parent)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or
        ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected extension file path.' }
}

function Expand-HpsQuestUpdate([string]$ZipPath, [string]$Destination) {
    $pins = Get-HpsQuestPins
    $targetRevision = (Get-HpsQuestRevisionCount $pins) - 1
    if ((Get-Item -LiteralPath $ZipPath).Length -ne $pins.bytes -or
        (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash -ine $pins.sha256) { throw 'Extension archive integrity check failed.' }
    if (Test-Path -LiteralPath $Destination) { throw 'Extraction destination already exists.' }
    Assert-HpsEmailDirectory (Split-Path $Destination -Parent)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        if ($zip.Entries.Count -ne 7) { throw 'Extension archive must contain exactly seven files.' }
        $seen = @{}
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -cnotin @($pins.files.Keys) -or $seen.ContainsKey($entry.FullName) -or
                $entry.Length -le 0 -or $entry.Length -gt 20971520 -or
                (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unexpected extension archive entry.' }
            $seen[$entry.FullName] = $true
        }
        [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
        foreach ($name in $pins.files.Keys) {
            $path = Join-Path $Destination $name
            Assert-HpsQuestFile $path
            if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $pins.files[$name][$targetRevision]) { throw 'Extension file integrity check failed.' }
        }
    } finally { $zip.Dispose() }
}

function Set-HpsQuestExtension([string]$Destination, [string]$Extracted, [string]$PatchHash) {
    $pins = Get-HpsQuestPins
    $revisionCount = Get-HpsQuestRevisionCount $pins
    $targetRevision = $revisionCount - 1
    if ($PatchHash -cne $pins.sha256) { throw 'Unexpected extension revision.' }
    if (-not (Test-HpsEmailExistingInstall $Destination)) { throw 'Install the private test app before updating it.' }
    Assert-HpsEmailNotRunning $Destination
    $productPath = Join-Path $Destination 'resources/app/product.json'
    Assert-HpsQuestFile $productPath
    $product = Get-Content -LiteralPath $productPath -Raw | ConvertFrom-Json
    if ($product.commit -cne '682dfd37c3511f3fa159f1516aac230dcda2467c' -or $product.version -cne '0.1.5') { throw 'This update only supports private build 682dfd37.' }
    $extension = Join-Path $Destination 'resources/app/extensions/hypeproof-chat'
    $names = @($pins.files.Keys | Sort-Object)
    $matches = New-Object int[] $revisionCount
    $oldHashes = @{}
    foreach ($name in $names) {
        $installed = Join-Path $extension $name
        $incoming = Join-Path $Extracted $name
        Assert-HpsQuestFile $installed
        Assert-HpsQuestFile $incoming
        $current = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
        if ((Get-FileHash -LiteralPath $incoming -Algorithm SHA256).Hash -ine $pins.files[$name][$targetRevision]) { throw 'Extension file integrity check failed.' }
        $oldHashes[$name] = $current
        for ($i = 0; $i -lt $revisionCount; $i++) { if ($current -ieq $pins.files[$name][$i]) { $matches[$i]++ } }
    }
    if ($matches[$targetRevision] -eq $names.Count) { Write-Host 'This quest extension update is already installed.'; return }
    if ($matches -notcontains $names.Count) { throw 'Installed extension files have unknown or partial changes. They were preserved.' }
    $package = Get-Content -LiteralPath (Join-Path $Extracted 'package.json') -Raw | ConvertFrom-Json
    if ($package.version -cne '0.1.5') { throw 'Unexpected packaged extension version.' }
    $backup = Join-Path $Destination ('.quest-backup-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    # Back up all seven replaced files before changing any installed file.
    # OAuth resources, SDK and user data are outside this exact allowlist.
    foreach ($name in $names) {
        $copy = Join-Path $backup $name
        New-Item -ItemType Directory -Path (Split-Path $copy -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $extension $name) -Destination $copy
        if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -ine $oldHashes[$name]) { throw 'Backup integrity check failed. Nothing was changed.' }
    }
    try {
        Assert-HpsEmailNotRunning $Destination
        foreach ($name in $names) {
            Copy-Item -LiteralPath (Join-Path $Extracted $name) -Destination (Join-Path $extension $name) -Force
            if ((Get-FileHash -LiteralPath (Join-Path $extension $name) -Algorithm SHA256).Hash -ine $pins.files[$name][$targetRevision]) { throw 'Updated extension integrity failure.' }
        }
        $receipt = @{schema=1;baseCommit=$product.commit;sourceCommit=$pins.sourceCommit;patchSha256=$PatchHash;originalHashes=$oldHashes;installedAt=(Get-Date).ToUniversalTime().ToString('o')}
        [IO.File]::WriteAllText((Join-Path $backup 'update.json'), ($receipt | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
    } catch {
        $rollbackFailed = $false
        foreach ($name in $names) {
            try {
                Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $extension $name) -Force
                if ((Get-FileHash -LiteralPath (Join-Path $extension $name) -Algorithm SHA256).Hash -ine $oldHashes[$name]) { throw 'Rollback hash mismatch.' }
            } catch { $rollbackFailed = $true }
        }
        if ($rollbackFailed) { throw 'Update stopped. Original extension files remain in the .quest-backup folder; contact the operator before opening Studio.' }
        throw 'Update stopped and all original extension files were restored. User data was preserved.'
    }
    Write-Host 'Quest extension installed. Original files were backed up; conversations, Google settings and SDK were preserved.'
}

function Install-HpsEmailQuestUpdate {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitProcess) { throw 'Open 64-bit Windows PowerShell.' }
    foreach ($scope in @('MachinePolicy', 'UserPolicy')) {
        if ((Get-ExecutionPolicy -Scope $scope) -in @('Restricted', 'AllSigned')) { throw 'Organization policy restricts unsigned code. No policy was changed.' }
    }
    $pins = Get-HpsQuestPins
    $destination = Join-Path $env:LOCALAPPDATA 'HypeProof-Studio-Email-Test/682dfd37'
    Assert-HpsEmailDirectory $destination
    if (-not (Test-HpsEmailExistingInstall $destination)) { throw 'Install the private test app before updating it.' }
    Assert-HpsEmailNotRunning $destination
    $tmp = Join-Path $env:TEMP ('hps-quest-update-' + [Guid]::NewGuid().ToString('N'))
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
        $zip = Join-Path $tmp 'extension.zip'
        Get-HpsEmailArtifact 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev' '/quest/files/extension.zip' $token $zip
        $extracted = Join-Path $tmp 'extension'
        Expand-HpsQuestUpdate $zip $extracted
        Set-HpsQuestExtension $destination $extracted $pins.sha256
        Start-Process -FilePath (Join-Path $destination 'HypeProof Studio.exe') -WorkingDirectory $destination | Out-Null
    } finally {
        $token = $null
        if ($secret) { $secret.Dispose() }
        [Net.ServicePointManager]::SecurityProtocol = $oldTls
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
        if ($lock) { $lock.Dispose() }
    }
}

try { Install-HpsEmailQuestUpdate }
catch { Write-Error ('Quest update stopped: ' + $_.Exception.Message) -ErrorAction Stop }

