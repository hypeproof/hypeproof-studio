# One bounded read-only snapshot; no WMI, localized command parsing, retry or fallback.
param([Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$Port)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'windows-inspector-snapshot.cs')
  $snapshot=[OwnedInspectorSnapshot]::Read($Port)
  $snapshot | ConvertTo-Json -Compress -Depth 4
} catch {
  # Node retains only bounded lengths/hashes of stderr; never emit raw OS details here.
  [Console]::Error.WriteLine('owned_native_listener_snapshot_failed')
  exit 1
}
