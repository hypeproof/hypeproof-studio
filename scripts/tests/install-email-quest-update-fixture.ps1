# Synthetic filesystem/archive fixtures; no credentials, network or app launch.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../install-email-quest-update.ps1'))
if ($source.ToCharArray() | Where-Object { [int]$_ -gt 127 }) { throw 'Updater must remain ASCII for PowerShell 5.1.' }
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) { . ([scriptblock]::Create($fn.Extent.Text)) }
function Refuses([scriptblock]$Action, [string]$Pattern) {
    $message = $null
    try { & $Action } catch { $message = $_.Exception.Message }
    if (-not $message -or $message -notmatch $Pattern) { throw "Expected refusal: $Pattern; got: $message" }
}
function Write-Fixture([string]$Path, [string]$Content) {
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}
$origin = 'https://hps-studio-email-test-20261013.jayleekr0125.workers.dev'
Refuses { Get-HpsEmailArtifact 'https://other.invalid' '/quest/files/extension.zip' 'synthetic' 'unused' } 'Invalid download'
Refuses { Get-HpsEmailArtifact $origin '/install/files/app.zip' 'synthetic' 'unused' } 'Invalid download'
$published = Get-HpsQuestPins
if ($published.files.Count -ne 7 -or $published.sha256 -cne '14ca31564bf08670c5b71dd130db2f28a1d0bbe1b766443c813ae971980a10b1' -or $published.bytes -ne 583824 -or $published.sourceCommit -cne '4192189e' -or (Get-HpsQuestRevisionCount $published) -ne 5) { throw 'Publication pins changed without updating this fixture.' }
$tempRoot = if (Test-Path '/private/tmp') { '/private/tmp' } else { [IO.Path]::GetTempPath() }
$tmp = Join-Path $tempRoot ('hps-quest-fixture-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:fixturePins = @{sourceCommit='synthetic';sha256=('1'*64);bytes=1;files=@{}}
function Get-HpsQuestPins { return $script:fixturePins }
$names = @($published.files.Keys | Sort-Object)
$base = Join-Path $tmp 'base'; $hotfix = Join-Path $tmp 'hotfix'; $incoming = Join-Path $tmp 'incoming'
# Real BOM-less UTF-8 package contains Korean descriptions; PS 5.1 defaults to ANSI.
$unicodePackage = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../extensions/hypeproof-chat/package.json'), [Text.Encoding]::UTF8)
foreach ($name in $names) {
    $old = if ($name -ceq 'package.json') { '{"version":"0.1.5","fixture":"base"}' } else { 'synthetic base ' + $name }
    $ui = if ($name -like 'webview-ui/dist/assets/*') { 'synthetic ui ' + $name } else { $old }
    $next = if ($name -ceq 'package.json') { $unicodePackage } else { 'synthetic next ' + $name }
    Write-Fixture (Join-Path $base $name) $old
    Write-Fixture (Join-Path $hotfix $name) $ui
    Write-Fixture (Join-Path $incoming $name) $next
    $script:fixturePins.files[$name] = @((Get-FileHash (Join-Path $base $name)).Hash, (Get-FileHash (Join-Path $hotfix $name)).Hash, (Get-FileHash (Join-Path $incoming $name)).Hash)
}
function New-Archive([string[]]$Entries, [switch]$Symlink) {
    $path = Join-Path $tmp ([Guid]::NewGuid().ToString('N') + '.zip')
    $archive = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Entries) {
            $entry = $archive.CreateEntry($name)
            if ($Symlink) { $entry.ExternalAttributes = -1610612736 }
            $writer = New-Object IO.StreamWriter($entry.Open())
            try {
                $payload = if ($name -cin $names) { [IO.File]::ReadAllText((Join-Path $incoming $name)) } else { 'synthetic unexpected payload' }
                $writer.Write($payload)
            } finally { $writer.Dispose() }
        }
    } finally { $archive.Dispose() }
    $script:fixturePins.sha256 = (Get-FileHash $path).Hash
    $script:fixturePins.bytes = (Get-Item $path).Length
    return $path
}
function New-Installation([string]$Name, [string]$From) {
    $dest = Join-Path $tmp $Name
    $extension = Join-Path $dest 'resources/app/extensions/hypeproof-chat'
    foreach ($entry in $names) { Write-Fixture (Join-Path $extension $entry) ([IO.File]::ReadAllText((Join-Path $From $entry))) }
    Write-Fixture (Join-Path $dest 'HypeProof Studio.exe') 'synthetic not executable'
    Write-Fixture (Join-Path $dest 'resources/app/product.json') '{"commit":"682dfd37c3511f3fa159f1516aac230dcda2467c","version":"0.1.5"}'
    $manifest = @{schema=1;build='682dfd37';artifacts=@(@{name='app.zip';path='/install/files/app.zip';bytes=196839798;sha256='378abcfa30aca94aab866a404b459385ecdbe53057d3d5844bb32c44cca982f1'},@{name='sdk.zip';path='/install/files/sdk.zip';bytes=80241659;sha256='f099b98ef4b2d048973d189928186ffc1835ef2de099aa9e62ee045b31889d05'})}
    Write-Fixture (Join-Path $dest '.email-test-install.json') ($manifest | ConvertTo-Json -Depth 5)
    foreach ($entry in @('data/conversation.json','resources/app/extensions/hypeproof-chat/resources/google-desktop-client.json','resources/app/sdk/claude.exe','unrelated/work.txt')) { Write-Fixture (Join-Path $dest $entry) ('synthetic sentinel ' + $entry) }
    return $dest
}
function Assert-Preserved([string]$Destination) {
    foreach ($entry in @('data/conversation.json','resources/app/extensions/hypeproof-chat/resources/google-desktop-client.json','resources/app/sdk/claude.exe','unrelated/work.txt')) {
        if ([IO.File]::ReadAllText((Join-Path $Destination $entry)) -cne ('synthetic sentinel ' + $entry)) { throw 'Unrelated data was changed.' }
    }
    foreach ($backup in @(Get-ChildItem -LiteralPath $Destination -Directory -Force | Where-Object Name -like '.quest-backup-*')) {
        foreach ($file in @(Get-ChildItem -LiteralPath $backup.FullName -File -Recurse -Force)) {
            if ($file.Name -eq 'google-desktop-client.json' -or $file.Name -eq 'claude.exe' -or $file.Name -eq 'conversation.json') { throw 'Unrelated or credential resources were copied to backup.' }
        }
    }
}
try {
    $zip = New-Archive $names
    $extracted = Join-Path $tmp 'extracted'
    Expand-HpsQuestUpdate $zip $extracted
    $validHash = $script:fixturePins.sha256; $validBytes = $script:fixturePins.bytes
    $script:fixturePins.sha256 = '0'*64
    Refuses { Expand-HpsQuestUpdate $zip (Join-Path $tmp 'tamper') } 'archive integrity'
    foreach ($kind in @('traversal', 'duplicate', 'case', 'extra')) {
        $entries = @($names.Clone())
        switch ($kind) {
            'traversal' { $entries[0] = '../escape' }
            'duplicate' { $entries[1] = $entries[0] }
            'case' { $entries[0] = $entries[0].ToUpperInvariant() }
            'extra' { $entries += 'data/extra' }
        }
        $bad = New-Archive $entries
        $target = Join-Path $tmp ([Guid]::NewGuid().ToString('N'))
        Refuses { Expand-HpsQuestUpdate $bad $target } 'archive'
        if (Test-Path $target) { throw 'Rejected archive wrote files.' }
    }
    $bad = New-Archive $names -Symlink
    Refuses { Expand-HpsQuestUpdate $bad (Join-Path $tmp 'symlink-archive') } 'archive'
    $script:fixturePins.sha256 = $validHash; $script:fixturePins.bytes = $validBytes
    Write-Host 'PASS: pinned archive, exact seven-file allowlist, traversal, duplicate, case, extra-file and symlink refusal'

    $dest = New-Installation 'installed' $base
    $extension = Join-Path $dest 'resources/app/extensions/hypeproof-chat'
    $script:failOnce = $true
    function Copy-Item { param($LiteralPath, $Destination, [switch]$Force)
        if ($script:failOnce -and $LiteralPath -eq (Join-Path $extracted 'package.json')) { $script:failOnce = $false; throw 'Synthetic partial disk failure' }
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
    }
    Refuses { Set-HpsQuestExtension $dest $extracted $validHash } 'all original extension files were restored'
    foreach ($name in $names) { if ((Get-FileHash (Join-Path $extension $name)).Hash -ine $script:fixturePins.files[$name][0]) { throw 'Rollback did not restore complete base.' } }
    Remove-Item Function:Copy-Item
    Assert-Preserved $dest
    Set-HpsQuestExtension $dest $extracted $validHash
    $backupCount = @(Get-ChildItem $dest -Directory -Force | Where-Object Name -like '.quest-backup-*').Count
    Set-HpsQuestExtension $dest $extracted $validHash
    if (@(Get-ChildItem $dest -Directory -Force | Where-Object Name -like '.quest-backup-*').Count -ne $backupCount) { throw 'Idempotent rerun made another backup.' }
    foreach ($name in $names) { if ((Get-FileHash (Join-Path $extension $name)).Hash -ine $script:fixturePins.files[$name][2]) { throw 'Installed extension does not match complete next version.' } }
    Assert-Preserved $dest
    $uiDest = New-Installation 'ui-installed' $hotfix
    Set-HpsQuestExtension $uiDest $extracted $validHash
    Assert-Preserved $uiDest
    Write-Host 'PASS: complete backup, partial-failure verified rollback, base/hotfix update, idempotence and OAuth/SDK/data preservation'

    $unknown = New-Installation 'unknown' $base
    Write-Fixture (Join-Path $unknown 'resources/app/extensions/hypeproof-chat/dist/extension.js') 'other local work'
    Refuses { Set-HpsQuestExtension $unknown $extracted $validHash } 'unknown or partial changes'
    if (@(Get-ChildItem $unknown -Directory -Force | Where-Object Name -like '.quest-backup-*').Count) { throw 'Unknown source was changed.' }
    $partial = New-Installation 'partial' $base
    Write-Fixture (Join-Path $partial 'resources/app/extensions/hypeproof-chat/dist/extension.js') ([IO.File]::ReadAllText((Join-Path $incoming 'dist/extension.js')))
    Refuses { Set-HpsQuestExtension $partial $extracted $validHash } 'unknown or partial changes'
    $linked = New-Installation 'linked' $base
    $media = Join-Path $linked 'resources/app/extensions/hypeproof-chat/media'
    $realMedia = Join-Path $tmp 'real-media'
    Move-Item -LiteralPath $media -Destination $realMedia
    $linkType = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }
    New-Item -ItemType $linkType -Path $media -Target $realMedia | Out-Null
    Refuses { Set-HpsQuestExtension $linked $extracted $validHash } 'normal directory'
    if ((Get-FileHash (Join-Path $realMedia 'chat.svg')).Hash -ine $script:fixturePins.files['media/chat.svg'][0]) { throw 'Reparse target was changed.' }
    # Windows PowerShell 5.1 Remove-Item fails for directory junctions.
    # Non-recursive Delete removes only this test link, never its target.
    [IO.Directory]::Delete($media)
    $running = New-Installation 'running' $base
    function Get-Process { [pscustomobject]@{Path=(Join-Path $running 'HypeProof Studio.exe')} }
    Refuses { Set-HpsQuestExtension $running $extracted $validHash } 'Close HypeProof'
    Remove-Item Function:Get-Process
    Write-Fixture (Join-Path $extracted 'dist/extension.js') 'tampered incoming file'
    Refuses { Set-HpsQuestExtension $running $extracted $validHash } 'file integrity'
    Assert-Preserved $running
    Write-Host 'PASS: unknown source, mixed revision, installed reparse path, running app and post-extraction tamper refusal'

    # Add a fourth complete column without changing the first three revisions.
    # The third column is now an accepted prior quest, not the target.
    $priorQuest = New-Installation 'prior-quest' $incoming
    $mixedQuest = New-Installation 'mixed-quest' $incoming
    $priorExtension = Join-Path $priorQuest 'resources/app/extensions/hypeproof-chat'
    foreach ($name in $names) {
        $fourth = if ($name -ceq 'package.json') { ($unicodePackage + [Environment]::NewLine) } else { 'synthetic fourth ' + $name }
        Write-Fixture (Join-Path $incoming $name) $fourth
        $script:fixturePins.files[$name] += (Get-FileHash (Join-Path $incoming $name)).Hash
    }
    $fourthZip = New-Archive $names
    $fourthHash = $script:fixturePins.sha256
    $fourthExtracted = Join-Path $tmp 'fourth-extracted'
    Expand-HpsQuestUpdate $fourthZip $fourthExtracted
    foreach ($name in $names) {
        if ((Get-FileHash (Join-Path $fourthExtracted $name)).Hash -ine $script:fixturePins.files[$name][3]) { throw 'Fourth revision was not selected as the archive target.' }
    }
    $script:failFourthOnce = $true
    function Copy-Item { param($LiteralPath, $Destination, [switch]$Force)
        if ($script:failFourthOnce -and $LiteralPath -eq (Join-Path $fourthExtracted 'package.json')) { $script:failFourthOnce = $false; throw 'Synthetic fourth revision disk failure' }
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
    }
    Refuses { Set-HpsQuestExtension $priorQuest $fourthExtracted $fourthHash } 'all original extension files were restored'
    Remove-Item Function:Copy-Item
    foreach ($name in $names) {
        if ((Get-FileHash (Join-Path $priorExtension $name)).Hash -ine $script:fixturePins.files[$name][2]) { throw 'Rollback did not restore the complete prior quest.' }
    }
    Assert-Preserved $priorQuest
    Set-HpsQuestExtension $priorQuest $fourthExtracted $fourthHash
    foreach ($name in $names) {
        if ((Get-FileHash (Join-Path $priorExtension $name)).Hash -ine $script:fixturePins.files[$name][3]) { throw 'Prior quest did not upgrade to the fourth revision.' }
    }
    $fourthBackupCount = @(Get-ChildItem $priorQuest -Directory -Force | Where-Object Name -like '.quest-backup-*').Count
    Set-HpsQuestExtension $priorQuest $fourthExtracted $fourthHash
    if (@(Get-ChildItem $priorQuest -Directory -Force | Where-Object Name -like '.quest-backup-*').Count -ne $fourthBackupCount) { throw 'Fourth revision rerun made another backup.' }
    Assert-Preserved $priorQuest
    # Every file is known, but mixing two columns must still refuse before backup.
    Write-Fixture (Join-Path $mixedQuest 'resources/app/extensions/hypeproof-chat/dist/extension.js') ([IO.File]::ReadAllText((Join-Path $incoming 'dist/extension.js')))
    Refuses { Set-HpsQuestExtension $mixedQuest $fourthExtracted $fourthHash } 'unknown or partial changes'
    if (@(Get-ChildItem $mixedQuest -Directory -Force | Where-Object Name -like '.quest-backup-*').Count) { throw 'Mixed prior/fourth revision was changed.' }
    Assert-Preserved $mixedQuest
    # All earlier complete revisions remain eligible when the target moves.
    foreach ($from in @($base, $hotfix)) {
        $earlier = New-Installation ('earlier-' + [Guid]::NewGuid().ToString('N')) $from
        Set-HpsQuestExtension $earlier $fourthExtracted $fourthHash
        foreach ($name in $names) {
            if ((Get-FileHash (Join-Path $earlier ('resources/app/extensions/hypeproof-chat/' + $name))).Hash -ine $script:fixturePins.files[$name][3]) { throw 'An earlier complete revision could not reach the fourth target.' }
        }
        Assert-Preserved $earlier
    }
    $savedColumn = $script:fixturePins.files['dist/extension.js']
    try {
        $script:fixturePins.files['dist/extension.js'] = @($savedColumn[0..2])
        $incompleteTarget = Join-Path $tmp 'incomplete-matrix'
        Refuses { Expand-HpsQuestUpdate $fourthZip $incompleteTarget } 'revision matrix'
        if (Test-Path $incompleteTarget) { throw 'Incomplete revision matrix wrote files.' }
        Refuses { Set-HpsQuestExtension $mixedQuest $fourthExtracted $fourthHash } 'revision matrix'
    } finally { $script:fixturePins.files['dist/extension.js'] = $savedColumn }
    Write-Host 'PASS: four-column target, prior quest upgrade/rollback, all earlier sources, idempotence, mixed revision refusal and complete-column validation'
} finally {
    if (Test-Path Function:Copy-Item) { Remove-Item Function:Copy-Item }
    if (Test-Path Function:Get-Process) { Remove-Item Function:Get-Process }
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
