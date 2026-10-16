// Background protocol/ownership controls. No Electron, VS Code, credential or provider use.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {activationBreakpoint,breakpointUrlPattern,descendant,listenerCommand,ownedListener,inspectorTarget,assertPause,InspectorPeer,OwnedExtensionGate} from './extension-inspector.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,30));}throw Error('Protocol control timeout');};
const temporary=()=>fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'owned inspector-한글-')));
function fixture(dir){
 const file=path.join(dir,'extension.cjs');fs.writeFileSync(file,`const fs = require('node:fs');
async function consumeActivityResume(){fs.writeFileSync(process.argv[2],'consumed');return 'valid';}
async function activate(){
 const activationRoot = process.argv[3];
 const activationService = 'owned-loopback';
 const resumeStatus = await consumeActivityResume(activationRoot,activationService);
 return resumeStatus;
}
void activate();setInterval(()=>{},1000);
`);return activationBreakpoint(file,hash(fs.readFileSync(file)));
}
test('bundle boundary is exact, regular, hashed and before consumption; malformed/duplicate bundles fail',()=>{
 const dir=temporary();try{const target=fixture(dir);assert(target.lineNumber<target.consumeLineNumber);assert.throws(()=>activationBreakpoint(target.file,'0'.repeat(64)),/changed/);const text=fs.readFileSync(target.file,'utf8');fs.writeFileSync(target.file,text.replace("const activationService = 'owned-loopback';","const somethingElse = 'owned-loopback';"));assert.throws(()=>activationBreakpoint(target.file,hash(fs.readFileSync(target.file))),/boundary/);fs.writeFileSync(target.file,text+'\n// const resumeStatus = await consumeActivityResume(\n');assert.throws(()=>activationBreakpoint(target.file,hash(fs.readFileSync(target.file))),/Exactly one/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('listener ownership rejects another App, cycles, ambiguous PID and unsafe endpoint/port',()=>{
 const parents=new Map([[103,102],[102,101],[101,1],[200,200]]);assert(descendant(103,101,parents));assert(!descendant(103,999,parents));assert(!descendant(200,101,parents));assert(!descendant(101,101,parents));
 const execute=(command,args)=>command==='lsof'?'p103\n':'103 102\n102 101\n101 1\n';assert.equal(ownedListener(9788,101,'darwin',execute),103);
 assert.throws(()=>ownedListener(9788,999,'darwin',execute),/not an owned/);assert.throws(()=>ownedListener(9788,101,'darwin',()=> 'p103\np104\n'),/Ambiguous/);
 assert.equal(ownedListener(9788,101,'win32',()=>JSON.stringify({listeners:[103],parents:[{ProcessId:103,ParentProcessId:101}]})),103);
 assert.throws(()=>listenerCommand('9788;echo bad','win32'));
 const id='12345678-1234-1234-1234-123456789abc',target={id,type:'node',webSocketDebuggerUrl:'ws://127.0.0.1:9788/'+id};assert.equal(inspectorTarget([target],9788).id,id);
 for(const url of['ws://example.com:9788/'+id,'ws://127.0.0.1:9789/'+id,'ws://user@127.0.0.1:9788/'+id])assert.throws(()=>inspectorTarget([{...target,webSocketDebuggerUrl:url}],9788));assert.throws(()=>inspectorTarget([target,target],9788));
});
test('pause requires exact own breakpoint/source/statement/root; no arbitrary expression is accepted',()=>{
 const windows=new RegExp(breakpointUrlPattern('file:///D:/owned/extension.js'));assert(windows.test('file:///d:/owned/extension.js'));assert(!windows.test('file:///D:/Owned/extension.js'));assert(!windows.test('file:///E:/owned/extension.js'));assert(!windows.test('file:///D:/other/extension.js'));
 const target={url:'file:///owned/extension.js',sha256:hash('source'),lineNumber:5};const event={params:{hitBreakpoints:['ours'],callFrames:[{location:{scriptId:'1',lineNumber:5}}]}};
 const args={event,scripts:new Map([['1',target.url]]),breakpoint:'ours',target,source:'source',root:'/owned/A',expectedRoot:'/owned/A'};assert(assertPause(args));
 for(const delta of[{source:'changed'},{root:'/other/A'},{breakpoint:'someone-else'},{scripts:new Map([['1','file:///other/extension.js']])},{target:{...target,lineNumber:6}}])assert.throws(()=>assertPause({...args,...delta}));
 const peer=new InspectorPeer('ws://127.0.0.1:9788/id',()=>{});assert.throws(()=>peer.send('Runtime.evaluate',{expression:'Date.now=()=>0'}),/not permitted/);assert.throws(()=>peer.send('Debugger.evaluateOnCallFrame',{expression:'context.globalState.update()'}),/not permitted/);
});
test('actual owned Node inspector completes startup then holds before statement, and replacement host has a new PID',async()=>{
 const dir=temporary(),target=fixture(dir),server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
 let child,gate;const errors=[];const launch=(root,marker)=>{child=spawn(process.execPath,['--inspect-brk=127.0.0.1:'+port,target.file,marker,root],{stdio:['ignore','ignore','pipe']});child.stderr.on('data',data=>errors.push(data));return child;};
 try{
  gate=new OwnedExtensionGate({port,appPid:()=>process.pid,target,initialRoot:dir,observeListener:()=>child?.exitCode===null?child.pid:null}).start();
  const first=launch(dir,path.join(dir,'initial-consumed'));await gate.initial.promise;await wait(()=>fs.existsSync(path.join(dir,'initial-consumed')));const firstPid=first.pid;
  const destination=path.join(dir,'fresh-destination'),marker=path.join(dir,'delayed-consumed');fs.mkdirSync(destination);
  const pending=await gate.prepareTransition(destination,2000,'short-propagation');first.kill();await once(first,'exit');
  const next=launch(destination,marker);await wait(()=>gate.events.some(e=>e.phase==='pre-consumption-paused'&&e.label==='short-propagation'));assert(!fs.existsSync(marker),'Statement cannot execute during hold');
  const proof=await pending.finished;assert(proof.hold_monotonic_ms>=2000&&proof.hold_wall_ms>=2000);assert.equal(proof.previous_host_pid,firstPid);assert.notEqual(proof.pid,firstPid);assert.equal(proof.pid,next.pid);await wait(()=>fs.existsSync(marker));
  await gate.close();assert.equal(gate.events.at(-1).status,'PASS');assert(!gate.failure);
 }finally{await gate?.close().catch(()=>{});if(child?.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
});
test('cleanup closes socket after remove failure and never resumes an unverified pause',async()=>{
 const gate=new OwnedExtensionGate({port:9788,appPid:()=>2,target:{},initialRoot:'/owned'});const calls=[];gate.peer={breakpoint:'ours',paused:true,ownedPause:false,send:async method=>{calls.push(method);throw Error('seeded refusal');},close:async()=>calls.push('close')};await assert.rejects(gate.close(),/seeded refusal/);assert.deepEqual(calls,['Debugger.removeBreakpoint','close']);assert.equal(gate.events.at(-1).status,'FAIL');
});
test('startup deadline and ownership failures reject once before any long hold or automatic retry',async()=>{
 let probes=0;const gate=new OwnedExtensionGate({port:9788,appPid:()=>123,target:{},initialRoot:'/owned',observeListener:()=>{probes++;throw Error('seeded unowned listener');}}).start();
 await assert.rejects(gate.initial.promise,/unowned listener/);await gate.close();assert.equal(probes,1);assert(gate.failure);assert(!gate.events.some(x=>x.phase==='activation-released'));
 const deadline=new OwnedExtensionGate({port:9788,appPid:()=>123,target:{},initialRoot:'/owned',observeListener:()=>{throw Error('deadline must run first');}});deadline.phase.deadline=0;deadline.start();await assert.rejects(deadline.initial.promise,/startup deadline/);await deadline.close();
});
test('actual owned Node target cannot substitute a different PID and failed cleanup stays failed',async()=>{
 const dir=temporary(),target=fixture(dir),server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
 const child=spawn(process.execPath,['--inspect-brk=127.0.0.1:'+port,target.file,path.join(dir,'never-consumed'),dir],{stdio:'ignore'});
 const gate=new OwnedExtensionGate({port,appPid:()=>process.pid,target,initialRoot:dir,observeListener:()=>child.exitCode===null?child.pid+1:null}).start();
 try{await assert.rejects(gate.initial.promise,/PID differs/);assert(!gate.events.some(x=>x.phase==='pre-consumption-paused'));await assert.rejects(gate.close(),/unverified pause/);assert.equal(gate.events.at(-1).status,'FAIL');}
 finally{await gate.close().catch(()=>{});if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
});
test('lost owned debugger fails immediately and cannot admit a subsequent phase',async()=>{
 const dir=temporary(),target=fixture(dir),server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
 const child=spawn(process.execPath,['--inspect-brk=127.0.0.1:'+port,target.file,path.join(dir,'initial'),dir],{stdio:'ignore'}),gate=new OwnedExtensionGate({port,appPid:()=>process.pid,target,initialRoot:dir,observeListener:()=>child.exitCode===null?child.pid:null}).start();
 try{await gate.initial.promise;gate.peer.ws.close();await wait(()=>gate.failure);assert.match(gate.failure.message,/disconnected unexpectedly/);await assert.rejects(gate.prepareTransition('/other',610000,'must-not-start'),/disconnected unexpectedly/);await assert.rejects(gate.close(),/socket not open/);assert.equal(gate.events.at(-1).status,'FAIL');}
 finally{await gate.close().catch(()=>{});if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
});
