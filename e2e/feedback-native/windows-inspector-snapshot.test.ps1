# Portable compile + binary parser controls. Does not invoke native Windows APIs.
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-inspector-snapshot.cs')
function Check([bool]$ok) { if(-not $ok){throw 'snapshot control failed'} }
function Refuses([scriptblock]$action) { $failed=$false;try { &$action | Out-Null } catch {$failed=$true};Check $failed }
function Table($rows) {
 $b=[byte[]]::new(4+24*$rows.Count);[BitConverter]::GetBytes([uint32]$rows.Count).CopyTo($b,0)
 for($i=0;$i -lt $rows.Count;$i++) { for($j=0;$j -lt 6;$j++){[BitConverter]::GetBytes([uint32]$rows[$i][$j]).CopyTo($b,4+24*$i+4*$j)} }
 return ,$b
}
$port=9788;$networkPort=[uint32](($port -shr 8) -bor (($port -band 255) -shl 8))
$good=@([uint32]2,[uint32]0x0100007f,$networkPort,[uint32]0,[uint32]0,[uint32]103)
$b=Table @();Check (([OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port)).Length -eq 0)
$b=Table @(,$good);$ids=[OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port);Check ($ids.Length -eq 1 -and $ids[0] -eq 103)
foreach($change in @(@(0,5),@(1,0),@(1,0x0200007f),@(2,0))) { $row=$good.Clone();$row[$change[0]]=[uint32]$change[1];$b=Table @(,$row);Check (([OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port)).Length -eq 0) }
$b=Table @($good,$good);Check (([OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port)).Length -eq 1)
$other=$good.Clone();$other[5]=[uint32]104;$b=Table @($good,$other);Check (([OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port)).Length -eq 2)
$b=Table @(,$good);Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,27,$port) };Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,29,$port) }
Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,1048577,$port) };Refuses { [OwnedInspectorSnapshot]::ParseListeners($null,4,$port) }
foreach($badPort in @(-1,0,1023,65536,[int]::MaxValue)) { Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$badPort) } }
[BitConverter]::GetBytes([uint32]::MaxValue).CopyTo($b,0);Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port) }
$row=$good.Clone();$row[5]=[uint32]1;$b=Table @(,$row);Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port) }
$rows=@();for($i=0;$i -lt 65;$i++){$row=$good.Clone();$row[5]=[uint32](100+$i);$rows+=,$row};$b=Table $rows;Refuses { [OwnedInspectorSnapshot]::ParseListeners($b,$b.Length,$port) }
[OwnedInspectorSnapshot]::RequireEnumerationEnd(18);Refuses { [OwnedInspectorSnapshot]::RequireEnumerationEnd(0) };Refuses { [OwnedInspectorSnapshot]::RequireEnumerationEnd(5) }
# Struct width is pointer-aware and pins the P/Invoke ABI rather than a host-sized integer guess.
$type=[OwnedInspectorSnapshot].GetNestedType('ProcessEntry',[Reflection.BindingFlags]::NonPublic)
$expected=if([IntPtr]::Size -eq 8){568}else{556};Check ([Runtime.InteropServices.Marshal]::SizeOf([Activator]::CreateInstance($type)) -eq $expected)
# Exercise actual .NET fields -> PowerShell JSON wire shape for zero and one row.
$wire=[OwnedInspectorSnapshot+Snapshot]::new();$wire.port=9788
$wire.listeners=[uint32[]]@();$wire.parents=[OwnedInspectorSnapshot+ParentRow[]]@()
Write-Output ('WIRE '+($wire | ConvertTo-Json -Compress -Depth 4))
$row=[OwnedInspectorSnapshot+ParentRow]::new();$row.ProcessId=103;$row.ParentProcessId=101
$wire.listeners=[uint32[]]@(103);$wire.parents=[OwnedInspectorSnapshot+ParentRow[]]@($row)
Write-Output ('WIRE '+($wire | ConvertTo-Json -Compress -Depth 4))
Write-Output 'PASS actual C# compile and binary/port/length/listener/EOF/ABI controls; no native call'

# Exercise the real flushed C# diagnostic writer without any Windows API calls.
$originalError=[Console]::Error;$captured=[IO.StringWriter]::new()
try {
 [Console]::SetError($captured)
 $stages=@('tcp_size_started','tcp_size_finished','tcp_read_started','tcp_read_finished','process_snapshot_started','process_snapshot_finished','process_enumeration_started','process_enumeration_finished')
 for($i=0;$i -lt $stages.Count;$i++){[OwnedInspectorSnapshot]::WritePhase(('a'*32),$stages[$i],10+$i)}
 Refuses { [OwnedInspectorSnapshot]::WritePhase('foreign','tcp_size_started',0) }
 Refuses { [OwnedInspectorSnapshot]::WritePhase(('a'*32),'private OS text',0) }
 Refuses { [OwnedInspectorSnapshot]::WritePhase(('a'*32),'tcp_size_started',-1) }
} finally {[Console]::SetError($originalError)}
Write-Output ('PHASE_WIRE '+($captured.ToString() | ConvertTo-Json -Compress))
