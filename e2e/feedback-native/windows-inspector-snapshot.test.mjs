import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {parseWindowsListenerSnapshot,ownedListener,listenerCommand} from './extension-inspector.mjs';
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
 const [exe,args]=listenerCommand(9788,'win32');assert.equal(exe,'powershell.exe');assert.deepEqual(args,['-NoProfile','-NonInteractive','-File',path.join(here,'windows-inspector-snapshot.ps1'),'-Port','9788']);
 for(const port of [-1,0,65536,9788.5,'9788;bad'])assert.throws(()=>listenerCommand(port,'win32'));
 const script=fs.readFileSync(args[3],'utf8'),native=fs.readFileSync(path.join(here,'windows-inspector-snapshot.cs'),'utf8');
 assert(!/Get-NetTCPConnection|Get-CimInstance|netstat/i.test(script+native));assert(script.includes("Join-Path $PSScriptRoot 'windows-inspector-snapshot.cs'"));
 assert(native.includes('finally{Marshal.FreeHGlobal(buffer);}'));assert(native.includes('finally{CloseHandle(snapshot);}'));assert(native.includes('RequireEnumerationEnd(Marshal.GetLastWin32Error())'));
 let calls=0;assert.throws(()=>ownedListener(9788,101,'win32',(_exe,_args,options)=>{calls++;assert.equal(options.timeout,10000);throw Object.assign(Error('denied'),{code:'ETIMEDOUT'});}),/Cannot establish/);assert.equal(calls,1);
});
const compiler=process.platform==='win32'?'powershell.exe':'pwsh';
const available=spawnSync(compiler,['-NoProfile','-NonInteractive','-Command','exit 0'],{timeout:10000,stdio:'ignore'});
test('actual C# parser compile and synthetic binary controls without Windows API calls',{skip:available.error?.code==='ENOENT',timeout:30000},()=>{
 assert.equal(available.status,0,'PowerShell compiler prerequisite failed');
 const output=execFileSync(compiler,['-NoProfile','-NonInteractive','-File',path.join(here,'windows-inspector-snapshot.test.ps1')],{encoding:'utf8',timeout:20000,maxBuffer:65536});assert.match(output,/PASS actual C# compile/);
 const wires=output.split(/\r?\n/).filter(line=>line.startsWith('WIRE ')).map(line=>parseWindowsListenerSnapshot(line.slice(5),9788));
 assert.equal(wires.length,2);assert.deepEqual(wires[0].pids,[]);assert.equal(wires[0].parents.size,0);assert.deepEqual(wires[1].pids,[103]);assert.equal(wires[1].parents.get(103),101);
});
