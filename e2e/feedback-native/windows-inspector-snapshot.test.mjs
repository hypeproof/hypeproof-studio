import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {parseWindowsListenerSnapshot,parseWindowsSnapshotPhases,WINDOWS_SNAPSHOT_PHASES,ownedListener,listenerCommand} from './extension-inspector.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const snapshot=(delta={})=>JSON.stringify({schema:'hps-owned-windows-listener/1',port:9788,listeners:[103],parents:[{ProcessId:103,ParentProcessId:101}],...delta});
test('strict Windows native snapshot keeps positive/foreign/ambiguous ownership and empty-port distinction',()=>{
 assert.equal(ownedListener(9788,101,'win32',()=>snapshot()),103);
 assert.equal(ownedListener(9788,101,'win32',()=>snapshot({listeners:[]})),null);
 assert.throws(()=>ownedListener(9788,999,'win32',()=>snapshot()),/not an owned/);
 assert.throws(()=>ownedListener(9788,101,'win32',()=>snapshot({listeners:[103,104]})),/Ambiguous/);
});
test('native snapshot parser rejects malformed, wrong scope, oversized, duplicate and nonnumeric rows',()=>{
 for(const raw of ['', '{}','null', 'private invalid', ' '.repeat(1048577),snapshot({schema:'other'}),snapshot({port:9789}),snapshot({extra:1}),snapshot({listeners:[103,103]}),snapshot({listeners:[0]}),snapshot({listeners:['103']}),snapshot({listeners:[4294967296]}),snapshot({listeners:Array.from({length:65},(_,i)=>i+2)}),snapshot({parents:Array(16385).fill({ProcessId:1,ParentProcessId:0})}),snapshot({parents:[{ProcessId:103,ParentProcessId:-1}]}),snapshot({parents:[{ProcessId:103,ParentProcessId:101,executable:'private'}]}),snapshot({parents:[{ProcessId:103,ParentProcessId:101},{ProcessId:103,ParentProcessId:999}]})])assert.throws(()=>parseWindowsListenerSnapshot(raw,9788));
});
test('fixed Windows file query uses native snapshot only, unchanged timeout and no fallback',()=>{
 const [exe,args]=listenerCommand(9788,'win32');assert.equal(exe,'powershell.exe');assert.deepEqual(args.slice(0,-2),['-NoProfile','-NonInteractive','-File',path.join(here,'windows-inspector-snapshot.ps1'),'-Port','9788']);assert.equal(args.at(-2),'-DiagnosticNonce');assert.match(args.at(-1),/^[a-f0-9]{32}$/);
 for(const port of [-1,0,65536,9788.5,'9788;bad'])assert.throws(()=>listenerCommand(port,'win32'));
 const script=fs.readFileSync(args[3],'utf8'),native=fs.readFileSync(path.join(here,'windows-inspector-snapshot.cs'),'utf8');
 assert(!/Get-NetTCPConnection|Get-CimInstance|netstat/i.test(script+native));assert(!script.includes('ConvertTo-Json'));assert(script.includes('[Console]::Out.WriteLine([OwnedInspectorSnapshot]::Serialize($snapshot))'));assert(script.includes("Join-Path $PSScriptRoot 'windows-inspector-snapshot.cs'"));
 assert(native.includes('finally{Marshal.FreeHGlobal(buffer);}'));assert(native.includes('finally{CloseHandle(snapshot);}'));assert(native.includes('int end=Marshal.GetLastWin32Error();'));assert(native.includes('RequireEnumerationEnd(end)'));assert(native.indexOf('int end=Marshal.GetLastWin32Error();')<native.indexOf('phase.Mark("process_enumeration_finished")'));
 let calls=0;assert.throws(()=>ownedListener(9788,101,'win32',(_exe,_args,options)=>{calls++;assert.equal(options.timeout,10000);throw Object.assign(Error('denied'),{code:'ETIMEDOUT'});}),/Cannot establish/);assert.equal(calls,1);
});
const compiler=process.platform==='win32'?'powershell.exe':'pwsh';
const available=spawnSync(compiler,['-NoProfile','-NonInteractive','-Command','exit 0'],{timeout:10000,stdio:'ignore'});
test('actual C# parser compile and synthetic binary controls without Windows API calls',{skip:available.error?.code==='ENOENT',timeout:30000},()=>{
 assert.equal(available.status,0,'PowerShell compiler prerequisite failed');
 const output=execFileSync(compiler,['-NoProfile','-NonInteractive','-File',path.join(here,'windows-inspector-snapshot.test.ps1')],{encoding:'utf8',timeout:20000,maxBuffer:2097152});assert.match(output,/PASS actual C# compile/);
 const phaseWire=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('PHASE_WIRE ')).slice(11));
 const prefix=WINDOWS_SNAPSHOT_PHASES.slice(0,3).map((phase,i)=>`HPS_OWNED_SNAPSHOT_PHASE/1|${'a'.repeat(32)}|${phase}|${i}\n`).join('');
 const phases=parseWindowsSnapshotPhases(prefix+phaseWire,'a'.repeat(32),10000);assert.equal(phases.status,'valid_prefix');assert.equal(phases.samples.length,11);assert.equal(phases.samples.at(-1).phase,'process_enumeration_finished');
 const wires=output.split(/\r?\n/).filter(line=>line.startsWith('WIRE ')).map(line=>parseWindowsListenerSnapshot(line.slice(5),9788));
 assert.equal(wires.length,4);assert.deepEqual(wires[0].pids,[]);assert.equal(wires[0].parents.size,0);assert.deepEqual(wires[1].pids,[103]);assert.equal(wires[1].parents.get(103),101);
 assert.equal(wires[2].pids.length,8);assert.equal(wires[2].parents.size,8);
 assert.equal(wires[3].pids.length,64);assert.equal(wires[3].parents.size,16384);assert.equal(wires[3].parents.get(4294967295),4294967295);
 const rawWires=output.split(/\r?\n/).filter(line=>line.startsWith('WIRE ')).map(line=>JSON.parse(line.slice(5)));
 const legacy=output.split(/\r?\n/).filter(line=>line.startsWith('LEGACY_WIRE ')).map(line=>JSON.parse(line.slice(12)));
 assert.deepEqual(rawWires.slice(0,2),legacy);assert.equal(legacy.length,2);
 const culture=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('CULTURE_WIRE ')).slice(13));assert.deepEqual(culture,rawWires[1]);
});

const nonce='a'.repeat(32);
const phaseLines=(phases=WINDOWS_SNAPSHOT_PHASES,token=nonce)=>phases.map((phase,i)=>`HPS_OWNED_SNAPSHOT_PHASE/1|${token}|${phase}|${i}\n`).join('');
test('failure phases retain only invocation-bound ordered monotonic bounded measurements',()=>{
 const prefix=phaseLines(WINDOWS_SNAPSHOT_PHASES.slice(0,4));
 const parsed=parseWindowsSnapshotPhases(Buffer.from(prefix),nonce,10000);
 assert.equal(parsed.status,'valid_prefix');assert.equal(parsed.samples.at(-1).phase,'tcp_size_started');
 assert(!JSON.stringify(parsed).includes(nonce));
 assert.deepEqual(parseWindowsSnapshotPhases('',nonce,10000),{status:'unavailable',samples:[]});
 assert.equal(parseWindowsSnapshotPhases(phaseLines()+'owned_native_listener_snapshot_failed\n',nonce,10000).samples.length,14);
});
test('forged, malformed, duplicate, out-of-order and overbudget phases disclose no statements',()=>{
 const prefix=phaseLines(WINDOWS_SNAPSHOT_PHASES.slice(0,3));
 const bad=[phaseLines(undefined,'b'.repeat(32)),prefix+'secret process arguments\n',prefix.replace('compile_started','unknown_phase'),prefix+prefix,
  prefix.replace('compile_started','compile_finished'),prefix.replace('|1\n','|-1\n'),prefix.replace('|1\n','|1.5\n'),prefix.replace('|1\n','|01\n'),
  prefix.replace('|2\n','|0\n'),prefix.replace('|2\n','|10001\n'),prefix.replace('PHASE/1','PHASE/2'),prefix.slice(0,-1),'x'.repeat(4097)];
 for(const raw of bad){const result=parseWindowsSnapshotPhases(raw,nonce,10000);assert.deepEqual(result,{status:'invalid',samples:[]});assert(!JSON.stringify(result).includes('secret'));}
});
test('even complete phase markers cannot admit a failed query or cause another probe',()=>{
 for(const forged of [false,true]){
  let calls=0,captured;
  assert.throws(()=>ownedListener(9788,101,'win32',(_exe,args,options)=>{
   calls++;assert.equal(options.timeout,10000);const token=forged?'f'.repeat(32):args.at(-1);
   throw Object.assign(Error('private OS error'),{code:'ETIMEDOUT',stderr:phaseLines(undefined,token),stdout:snapshot()});
  }),error=>{captured=error;return error.message==='Cannot establish inspector listener ownership';});
  assert.equal(calls,1);assert.equal(captured.ownership_query_failure.code,'ETIMEDOUT');
  assert.equal(captured.ownership_query_failure.phase_diagnostics.status,forged?'invalid':'valid_prefix');
  assert(!JSON.stringify(captured.ownership_query_failure).includes('private'));
 }
});
