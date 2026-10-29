# One bounded read-only snapshot; fixed stderr phases never authorize ownership.
param([Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$Port,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{32}$')][string]$DiagnosticNonce)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$clock=[Diagnostics.Stopwatch]::StartNew()
function Write-Phase([string]$stage) {
 [Console]::Error.WriteLine(('HPS_OWNED_SNAPSHOT_PHASE/1|{0}|{1}|{2}' -f $DiagnosticNonce,$stage,$clock.ElapsedMilliseconds))
 [Console]::Error.Flush()
}
try {
  Write-Phase 'script_entered'
  Write-Phase 'compile_started'
  Add-Type -Path (Join-Path $PSScriptRoot 'windows-inspector-snapshot.cs')
  Write-Phase 'compile_finished'
  $snapshot=[OwnedInspectorSnapshot]::Read($Port,$DiagnosticNonce,$clock.ElapsedMilliseconds)
  Write-Phase 'native_finished'
  Write-Phase 'serialization_started'
  $snapshot | ConvertTo-Json -Compress -Depth 4
  Write-Phase 'serialization_finished'
} catch {
  [Console]::Error.WriteLine('owned_native_listener_snapshot_failed')
  [Console]::Error.Flush()
  exit 1
}
