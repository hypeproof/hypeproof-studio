param([string]$BaseZip = '')
# Real archive and filesystem behavior; this does not launch the Windows app.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../install-email-ui-update.ps1'))
if ($source.ToCharArray() | Where-Object { [int]$_ -gt 127 }) { throw 'Updater must remain ASCII.' }
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) { . ([scriptblock]::Create($fn.Extent.Text)) }
function Refuses([scriptblock]$Action,[string]$Pattern) { $message=$null;try{& $Action}catch{$message=$_.Exception.Message};if(-not $message -or $message -notmatch $Pattern){throw "Expected refusal: $Pattern"} }
$origin='https://hps-studio-email-test-20261013.jayleekr0125.workers.dev'
Refuses { Get-HpsEmailArtifact 'https://other.invalid' '/install/files/ui-update.zip' 'fake' 'unused' } 'Invalid download'
Refuses { Get-HpsEmailArtifact $origin '/install/files/app.zip' 'fake' 'unused' } 'Invalid download'
$tempRoot=if(Test-Path '/private/tmp'){'/private/tmp'}else{[IO.Path]::GetTempPath()}
$tmp=Join-Path $tempRoot ('hps-ui-fixture-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $tmp|Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
 foreach($entries in @(@('index.js','index.css'),@('../index.js','index.css'),@('index.js','INDEX.JS'),@('index.js','index.css','data/secret'))) {
  $zipPath=Join-Path $tmp ([Guid]::NewGuid().ToString('N')+'.zip');$zip=[IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Create)
  foreach($name in $entries){$writer=New-Object IO.StreamWriter($zip.CreateEntry($name).Open());$writer.Write('synthetic new UI '+$name);$writer.Dispose()};$zip.Dispose()
  $dest=Join-Path $tmp ([Guid]::NewGuid().ToString('N'))
  if($entries.Count-eq 2 -and $entries[0]-ceq 'index.js' -and $entries[1]-ceq 'index.css'){$goodZip=$zipPath;$extracted=$dest;Expand-HpsUiUpdate $zipPath $dest}
  else{Refuses {Expand-HpsUiUpdate $zipPath $dest} 'archive';if(Test-Path $dest){throw 'Invalid archive wrote files.'}}
 }
 Write-Host 'PASS: exact two-file allowlist, path traversal, duplicates and extra payload rejection'
 if($BaseZip){
  $dest=Join-Path $tmp 'installed';$assets=Join-Path $dest 'resources/app/extensions/hypeproof-chat/webview-ui/dist/assets';New-Item -ItemType Directory -Path $assets -Force|Out-Null
  $original=[IO.Compression.ZipFile]::OpenRead($BaseZip)
  foreach($name in @('index.js','index.css')){[IO.Compression.ZipFileExtensions]::ExtractToFile($original.GetEntry('resources/app/extensions/hypeproof-chat/webview-ui/dist/assets/'+$name),(Join-Path $assets $name))}
  [IO.Compression.ZipFileExtensions]::ExtractToFile($original.GetEntry('resources/app/product.json'),(Join-Path $dest 'resources/app/product.json'));$original.Dispose()
  [IO.File]::WriteAllText((Join-Path $dest 'HypeProof Studio.exe'),'never executed')
  $manifest=@{schema=1;build='682dfd37';artifacts=@(@{name='app.zip';path='/install/files/app.zip';bytes=196839798;sha256='378abcfa30aca94aab866a404b459385ecdbe53057d3d5844bb32c44cca982f1'},@{name='sdk.zip';path='/install/files/sdk.zip';bytes=80241659;sha256='f099b98ef4b2d048973d189928186ffc1835ef2de099aa9e62ee045b31889d05'})}
  [IO.File]::WriteAllText((Join-Path $dest '.email-test-install.json'),($manifest|ConvertTo-Json -Depth 5))
  $data=Join-Path $dest 'data';New-Item -ItemType Directory -Path $data|Out-Null;[IO.File]::WriteAllText((Join-Path $data 'keep'),'synthetic conversation and OAuth sentinel')
  $script:failOnce=$true
  function Copy-Item { param($LiteralPath,$Destination,[switch]$Force)
   if($script:failOnce -and $LiteralPath-eq (Join-Path $extracted 'index.css')){$script:failOnce=$false;throw 'Synthetic disk write failure'}
   Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
  }
  Refuses {Set-HpsUiAssets $dest $extracted ('1'*64)} 'restored'
  if((Get-FileHash (Join-Path $assets 'index.js')).Hash-ine 'c82891aac312d02cebd4d3100d2c93860c4308c7cb2d2dc8e93c1ef427d82a95'){throw 'Rollback did not restore JS.'}
  Remove-Item Function:Copy-Item
  Set-HpsUiAssets $dest $extracted ('1'*64)
  Set-HpsUiAssets $dest $extracted ('1'*64)
  if([IO.File]::ReadAllText((Join-Path $data 'keep'))-cne 'synthetic conversation and OAuth sentinel'){throw 'User data changed.'}
  if(@(Get-ChildItem $dest -Directory -Force | Where-Object Name -like '.ui-backup-*').Count-ne 2){throw 'Rerun created an unexpected backup.'}
  [IO.File]::WriteAllText((Join-Path $assets 'index.js'),'other work')
  Refuses {Set-HpsUiAssets $dest $extracted ('1'*64)} 'other changes'
  Write-Host 'PASS: original packaged assets, write-failure rollback, backup, rerun, unknown change refusal and data preservation'
 }
} finally {Remove-Item -LiteralPath $tmp -Recurse -Force}
