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
import {activationBreakpoint,breakpointUrlPattern,canonicalScriptPath,assertPhysicalScript,samePhysicalScriptPath,inspectorScriptDiagnostic,descendant,listenerCommand,ownedListener,inspectorTarget,assertPause,InspectorPeer,OwnedExtensionGate} from './extension-inspector.mjs';
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
function controlledNode(port,target,marker,root){
 const child=spawn(process.execPath,['--inspect-brk=127.0.0.1:'+port,target.file,marker,root],{stdio:['ignore','ignore','pipe']});
 const state={spawned:false,error_code:null,exited:false,closed:false,stderr_bytes:0,stderr_truncated:false},chunks=[];
 child.on('spawn',()=>{state.spawned=true;});child.on('error',error=>{state.error_code=typeof error.code==='string'?error.code:'unknown';});child.on('exit',()=>{state.exited=true;});child.on('close',()=>{state.closed=true;});
 child.stderr.on('data',data=>{state.stderr_bytes+=data.length;if(state.stderr_bytes<=65536)chunks.push(data);else state.stderr_truncated=true;});
 return {child,snapshot(){const stderr=Buffer.concat(chunks),text=stderr.toString('utf8');return {...state,pid:child.pid??null,exit_code:child.exitCode,signal_code:child.signalCode,stderr_sha256:hash(stderr),listening_observed:text.includes('Debugger listening on '),attached_observed:text.includes('Debugger attached.'),waiting_for_disconnect_observed:text.includes('Waiting for the debugger to disconnect')};}};
}
function failureDiagnostic(t,gate,target,children){
 const phases=gate.events.map(({phase,label,pid,target_id,startup_ms})=>({phase,label,pid,target_id,startup_ms}));
 t.diagnostic(JSON.stringify({schema:'hps-owned-inspector-control-failure/1',platform:process.platform,node:process.version,expected_script:inspectorScriptDiagnostic(target.url,target),bundle_sha256:target.sha256,gate:{phases,current_phase:gate.phase?.label??null,holding:gate.phase?.holding===true,deadline_expired:!!gate.phase&&Date.now()>gate.phase.deadline,peer_present:!!gate.peer,owned_pid_verified:phases.some(event=>event.phase==='owned-startup-break'),paused:gate.peer?.paused??false,owned_pause:gate.peer?.ownedPause??false,socket_state:gate.peer?.ws?.readyState??null,protocol:gate.protocolDiagnostics},children:children.map(control=>control.snapshot())}));
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
 const dir=temporary();try{
 const windows=new RegExp(breakpointUrlPattern('file:///D:/owned/extension.js'));assert(windows.test('file:///d:/owned/extension.js'));assert(!windows.test('file:///D:/Owned/extension.js'));assert(!windows.test('file:///E:/owned/extension.js'));assert(!windows.test('file:///D:/other/extension.js'));
 const target=fixture(dir);const source=fs.readFileSync(target.file,'utf8');const event={params:{hitBreakpoints:['ours'],callFrames:[{location:{scriptId:'1',lineNumber:target.lineNumber}}]}};
 const args={event,scripts:new Map([['1',target.url]]),breakpoint:'ours',target,source,root:'/owned/A',expectedRoot:'/owned/A'};assert(assertPause(args));
 for(const delta of[{source:'changed'},{root:'/other/A'},{breakpoint:'someone-else'},{scripts:new Map([['1','file:///other/extension.js']])},{target:{...target,lineNumber:target.lineNumber+1}}])assert.throws(()=>assertPause({...args,...delta}));
 const peer=new InspectorPeer('ws://127.0.0.1:9788/id',()=>{});assert.throws(()=>peer.send('Runtime.evaluate',{expression:'Date.now=()=>0'}),/not permitted/);assert.throws(()=>peer.send('Debugger.evaluateOnCallFrame',{expression:'context.globalState.update()'}),/not permitted/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('script diagnostics preserve cross-platform URL spelling and redact unrelated paths without admitting them',()=>{
 const url='file:///D:/owned%20inspector-%ED%95%9C%EA%B8%80/extension.cjs',target={file:'D:\\owned inspector-한글\\extension.cjs',url,urlPattern:breakpointUrlPattern(url)};
 const exact=inspectorScriptDiagnostic(url,target);assert.equal(exact.relative_fixture,'extension.cjs');assert.equal(exact.url_sha256,hash(url));assert(exact.matches_expected_pattern);assert(exact.comparison.decoded_path_equal);assert(exact.comparison.serialized_url_equal);
 assert(inspectorScriptDiagnostic(url.replace('/D:','/d:'),target).matches_expected_pattern);
 for(const changed of [url.replace('/D:','/E:'),url.replace('/owned','/Owned'),url.replace('/extension.cjs','/other.cjs'),url+'?secret=not-to-be-logged']){
  const value=inspectorScriptDiagnostic(changed,target);assert(!value.matches_expected_pattern);assert(!JSON.stringify(value).includes('not-to-be-logged'));assert(!JSON.stringify(value).includes('owned inspector'));
 }
 const posix={file:'/owned fixture/extension.cjs',url:'file:///owned%20fixture/extension.cjs'};
 assert.equal(inspectorScriptDiagnostic(posix.url,posix).relative_fixture,'extension.cjs');assert(inspectorScriptDiagnostic(posix.url,posix).matches_expected_pattern);
 assert.equal(inspectorScriptDiagnostic('file:///other/private.cjs',posix).relative_fixture,'outside-fixture');assert.equal(inspectorScriptDiagnostic('not a URL with secret',posix).relative_fixture,'unrecognized-script-url');
 let receipt;failureDiagnostic({diagnostic:value=>{receipt=value;}},{events:[{phase:'owned-startup-break',pid:123,message:'private application text'}],phase:{label:'initial-startup',deadline:0},protocolDiagnostics:{event_counts:{'Debugger.scriptParsed':2},candidate_scripts:[],last_pause:null,breakpoint_locations:[]}},target,[{snapshot:()=>({pid:123,exit_code:null})}]);
 const observed=JSON.parse(receipt);assert(observed.gate.owned_pid_verified);assert(observed.gate.deadline_expired);assert.equal(observed.gate.protocol.event_counts['Debugger.scriptParsed'],2);assert(!receipt.includes('private application text'));assert(!receipt.includes('D:\\owned'));assert(!receipt.includes('file:///'));
});
test('diagnostics distinguish refused directory case from equivalent URL spelling',()=>{
 const url='file:///C:/Users/Runner/owned%20inspector-%ED%95%9C%EA%B8%80/extension.cjs',target={file:'C:\\Users\\Runner\\owned inspector-한글\\extension.cjs',url,urlPattern:breakpointUrlPattern(url)};
 const changedCase=inspectorScriptDiagnostic(url.replace('/Runner/','/runner/'),target);
 assert.equal(changedCase.relative_fixture,'extension.cjs');assert(!changedCase.matches_expected_pattern);assert(!changedCase.comparison.decoded_path_equal);assert(!changedCase.comparison.drive_only_equal);assert(changedCase.comparison.casefold_path_equal);assert.deepEqual(changedCase.comparison.case_difference_positions,[2]);
 const rawSpace=inspectorScriptDiagnostic(url.replace('%20',' '),target);assert(rawSpace.matches_expected_pattern);assert(rawSpace.comparison.decoded_path_equal);assert(rawSpace.comparison.casefold_path_equal);assert.deepEqual(rawSpace.comparison.case_difference_positions,[]);
 const drive=inspectorScriptDiagnostic(url.replace('/C:','/c:'),target);assert(drive.matches_expected_pattern);assert(drive.comparison.drive_only_equal);assert.deepEqual(drive.comparison.case_difference_positions,[0]);
 const different=inspectorScriptDiagnostic(url.replace('/Runner/','/Unrelated/'),target);assert(!different.matches_expected_pattern);assert(!different.comparison.casefold_path_equal);
 for(const value of [changedCase,rawSpace,drive,different]){const raw=JSON.stringify(value);for(const text of ['Runner','Unrelated','file:///','owned inspector','한글'])assert(!raw.includes(text));}
 const query=inspectorScriptDiagnostic(url+'?token=never-log',target);assert.equal(query.comparison,null);assert(!JSON.stringify(query).includes('never-log'));
});
test('actual owned Node inspector completes startup then holds before statement, and replacement host has a new PID',async t=>{
 const dir=temporary(),target=fixture(dir),server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
 let child,gate;const children=[];const launch=(root,marker)=>{const control=controlledNode(port,target,marker,root);children.push(control);return child=control.child;};
 try{
  gate=new OwnedExtensionGate({port,appPid:()=>process.pid,target,initialRoot:dir,observeListener:()=>child?.exitCode===null?child.pid:null}).start();
  const first=launch(dir,path.join(dir,'initial-consumed'));await gate.initial.promise;await wait(()=>fs.existsSync(path.join(dir,'initial-consumed')));const firstPid=first.pid;
  const destination=path.join(dir,'fresh-destination'),marker=path.join(dir,'delayed-consumed');fs.mkdirSync(destination);
  const pending=await gate.prepareTransition(destination,2000,'short-propagation');assert(gate.completedPids.has(firstPid),'Prior host must have completed this gate exact PID/source/root proof');await wait(()=>gate.events.some(e=>e.phase==='prior-host-retiring'&&e.pid===firstPid&&e.admitted===false));assert.equal(gate.peer,null);first.kill();await once(first,'exit');
  const next=launch(destination,marker);await wait(()=>gate.events.some(e=>e.phase==='pre-consumption-paused'&&e.label==='short-propagation'));assert(!fs.existsSync(marker),'Statement cannot execute during hold');
  const proof=await pending.finished;assert(proof.hold_monotonic_ms>=2000&&proof.hold_wall_ms>=2000);assert.equal(proof.previous_host_pid,firstPid);assert.notEqual(proof.pid,firstPid);assert.equal(proof.pid,next.pid);await wait(()=>fs.existsSync(marker));
  await gate.close();assert.equal(gate.events.at(-1).status,'PASS');assert(!gate.failure);assert(gate.protocolDiagnostics.event_counts['Debugger.scriptParsed']>0);assert(gate.protocolDiagnostics.candidate_scripts.some(s=>s.matches_expected_pattern));assert(gate.protocolDiagnostics.candidate_scripts.length<=8);
 }catch(error){failureDiagnostic(t,gate,target,children);throw error;}finally{await gate?.close().catch(()=>{});if(child?.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
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
test('lost owned debugger fails immediately and cannot admit a subsequent phase',async t=>{
 const dir=temporary(),target=fixture(dir),server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
 const control=controlledNode(port,target,path.join(dir,'initial'),dir),child=control.child,gate=new OwnedExtensionGate({port,appPid:()=>process.pid,target,initialRoot:dir,observeListener:()=>child.exitCode===null?child.pid:null}).start();
 try{await gate.initial.promise;gate.peer.ws.close();await wait(()=>gate.failure);assert.match(gate.failure.message,/disconnected unexpectedly/);await assert.rejects(gate.prepareTransition('/other',610000,'must-not-start'),/disconnected unexpectedly/);await assert.rejects(gate.close(),/socket not open/);assert.equal(gate.events.at(-1).status,'FAIL');}
 catch(error){failureDiagnostic(t,gate,target,[control]);throw error;}
 finally{await gate.close().catch(()=>{});if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
});

test('portable Windows equivalent URL spellings retain exact path; hostile URL forms fail closed',()=>{
 const target={file:'D:\\owned fixture-한글\\extension.cjs',url:'file:///D:/owned%20fixture-%ED%95%9C%EA%B8%80/extension.cjs'};
 const pattern=new RegExp(breakpointUrlPattern(target.url));
 for(const url of [target.url,target.url.replace('%20',' '),target.url.replace(/%[A-F0-9]{2}/g,v=>v.toLowerCase()),target.url.replace('%ED%95%9C%EA%B8%80','한글'),target.url.replace('owned','%6fwned'),target.url.replace('/D:','/d:')]){
  assert(pattern.test(url),url);assert.match(canonicalScriptPath(url,target),/extension.cjs$/);
 }
 for(const url of [target.url+'?',target.url+'#',target.url+'?token=x',target.url+'#x',target.url.replace('file:///','file://localhost/'),target.url.replace('owned','other'),target.url.replace('owned','Owned'),target.url.replace('/D:','/E:'),target.url.replace('/extension','%2fextension'),target.url.replace('/extension','%5cextension'),target.url.replace('/owned','/a/../owned'),target.url.replace('/owned','/%2e%2e/owned'),target.url.replace('%20','%2520'),target.url.replace('/owned','/./owned')])assert.throws(()=>canonicalScriptPath(url,target),undefined,url);
});
test('equivalent URL cannot substitute a different physical file or a symlink',()=>{
 const dir=temporary();try{
  const target=fixture(dir),raw=target.url.replace('%20',' ');assert.equal(assertPhysicalScript(raw,target),target.file);
  const alternate=path.join(dir,'alternate.cjs');fs.copyFileSync(target.file,alternate);assert.throws(()=>assertPhysicalScript(target.url.replace('extension.cjs','alternate.cjs'),target),/Canonical script path mismatch/);
  const renamed=path.join(dir,'other.cjs');fs.renameSync(target.file,renamed);fs.symlinkSync(renamed,target.file);
  assert.throws(()=>assertPhysicalScript(raw,target),/Physical script/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('ownership refusal records disappearing listener and later owned sample but still refuses without retry',()=>{
 const calls=[];let samples=0;
 const execute=(command,args,options)=>{calls.push({command,timeout:options.timeout});if(command==='lsof')return ++samples===1?'p103\n':'p104\n';return samples===1?'101 1\n':'104 101\n101 1\n';};
 let refusal;assert.throws(()=>ownedListener(9788,101,'darwin',execute),error=>{refusal=error;return /not an owned App descendant/.test(error.message);});
 assert.equal(refusal.ownership_refusal.initial.chains[0].listener_pid,103);assert.equal(refusal.ownership_refusal.initial.chains[0].reason,'missing_parent_row');
 assert.equal(refusal.ownership_refusal.resample.chains[0].reason,'owned_root_reached');assert.equal(refusal.ownership_refusal.resample_diagnostic_only,true);
 assert.deepEqual(calls.map(c=>c.command),['lsof','ps','lsof','ps']);assert.deepEqual(calls.map(c=>c.timeout),[10000,10000,1500,1500]);
 for(const sample of [refusal.ownership_refusal.initial,refusal.ownership_refusal.resample])for(const time of Object.values(sample.timing))assert(Number.isFinite(Date.parse(time)));
});
test('ambiguous, foreign and unavailable ownership resamples retain original rejection and bounded numeric facts',()=>{
 for(const mode of ['ambiguous','foreign','unavailable']){
  let samples=0;const execute=command=>{if(command==='lsof'){samples++;if(mode==='unavailable'&&samples===2)throw Error('private process arguments must not leak');return mode==='ambiguous'?'p103\np104\n':'p103\n';}return '103 999\n999 1\n101 1\n';};
  let refusal;assert.throws(()=>ownedListener(9788,101,'darwin',execute),error=>{refusal=error;return mode==='ambiguous'?/Ambiguous/.test(error.message):/not an owned/.test(error.message);});
  assert.equal(refusal.ownership_refusal.initial.listener_count,mode==='ambiguous'?2:1);if(mode==='unavailable')assert.equal(refusal.ownership_refusal.resample.status,'UNAVAILABLE');
  assert(!JSON.stringify(refusal.ownership_refusal).includes('private process'));
 }
});
test('gate persists ownership refusal with phase and previous host, and never attaches after diagnostic resample',async()=>{
 const error=Error('Inspector listener is not an owned App descendant');error.ownership_refusal={initial:{listener_count:1},resample:{listener_count:0},resample_diagnostic_only:true};let probes=0,attached=0;
 const gate=new OwnedExtensionGate({port:9788,appPid:()=>101,target:{},initialRoot:'/owned',observeListener:()=>{probes++;throw error;}});gate.previousPid=103;gate.attach=async()=>{attached++;};gate.start();
 await assert.rejects(gate.initial.promise,/not an owned/);await gate.close();assert.equal(probes,1);assert.equal(attached,0);
 const event=gate.events.find(e=>e.phase==='gate-failed');assert.equal(event.ownership_refusal.phase_label,'initial-startup');assert.equal(event.ownership_refusal.previous_host_pid,103);assert.equal(event.ownership_refusal.current_peer_pid,null);
});
test('actual owned Node listener refusal preserves foreign-root proof in both samples',{skip:process.platform!=='darwin'},async()=>{
 const child=spawn(process.execPath,['-e',"require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)})"],{stdio:['ignore','pipe','ignore']}),foreign=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try{
  const [output]=await once(child.stdout,'data'),port=Number(String(output).trim());assert.equal(ownedListener(port,process.pid),child.pid);
  let refusal;assert.throws(()=>ownedListener(port,foreign.pid),error=>{refusal=error;return /not an owned/.test(error.message);});
  for(const sample of [refusal.ownership_refusal.initial,refusal.ownership_refusal.resample]){assert.equal(sample.root_pid,foreign.pid);assert.equal(sample.chains[0].listener_pid,child.pid);assert(sample.chains[0].chain.some(row=>row.pid===process.pid));assert.notEqual(sample.chains[0].reason,'owned_root_reached');}
 }finally{for(const owned of [child,foreign])if(owned.exitCode===null&&owned.signalCode===null){owned.kill();await once(owned,'exit');}}
});

test('physical Windows identity permits only drive spelling after realpath, never directory case or path substitution',()=>{
 const expected='D:\\a\\_temp\\candidate\\extension.js';assert(samePhysicalScriptPath('d:\\a\\_temp\\candidate\\extension.js',expected));assert(samePhysicalScriptPath(expected,expected));
 for(const other of ['E:\\a\\_temp\\candidate\\extension.js','D:\\A\\_temp\\candidate\\extension.js','D:\\a\\_temp\\other\\extension.js','D:/a/_temp/candidate/extension.js','D:\\a\\_temp\\candidate\\..\\candidate\\extension.js','file:///D:/a/_temp/candidate/extension.js',null])assert(!samePhysicalScriptPath(other,expected));
 assert(!samePhysicalScriptPath('/owned/Extension.js','/owned/extension.js'));assert(samePhysicalScriptPath('/owned/extension.js','/owned/extension.js'));
});


test('exact prior host retirement is never new ownership; unknown, ambiguous and reused identities cannot attach',()=>{
 const events=[];let calls=0;
 const execute=command=>{calls++;return command==='lsof'?'p103\n':'101 1\n';};
 assert.equal(ownedListener(9788,101,'darwin',execute,{pid:103,observe:pid=>events.push(pid)}),null);assert.deepEqual(events,[103]);assert.equal(calls,2,'No acceptance from a second ownership sample');
 assert.throws(()=>ownedListener(9788,101,'darwin',execute),/not an owned/,'Unproven prior identity cannot bypass ownership');
 const reused=command=>command==='lsof'?'p103\n':'103 999\n999 1\n';assert.throws(()=>ownedListener(9788,101,'darwin',reused,{pid:103}),/not an owned/,'Reused PID with foreign ancestry still fails immediately');
 const foreign=command=>command==='lsof'?'p104\n':'104 999\n999 1\n';assert.throws(()=>ownedListener(9788,101,'darwin',foreign,{pid:103}),/not an owned/);
 const ambiguous=command=>command==='lsof'?'p103\np104\n':'103 101\n104 101\n';assert.throws(()=>ownedListener(9788,101,'darwin',ambiguous,{pid:103}),/Ambiguous/);
 const next=command=>command==='lsof'?'p104\n':'104 101\n101 1\n';assert.equal(ownedListener(9788,101,'darwin',next,{pid:103}),104,'New PID still requires strict current ancestry');
});

test('gate retirement needs its own completed proof and a declared transition; no ownership refusal is retried',async()=>{
 let calls=0,retirementSeen;
 const gate=new OwnedExtensionGate({port:9788,appPid:()=>101,target:{},initialRoot:'/owned',observeListener:(_port,_root,retirement)=>{calls++;retirementSeen=retirement;throw Error('unproven owner');}});gate.previousPid=103;gate.phase.previousPid=103;gate.start();await assert.rejects(gate.initial.promise,/unproven owner/);await gate.close();assert.equal(retirementSeen,undefined);assert.equal(calls,1);assert.equal(gate.completedPids.size,0);
});

test('retiring or reused prior PID consumes the unchanged transition deadline without fetch, attach or resume',async()=>{
 const originalFetch=globalThis.fetch;let fetches=0,attaches=0,probes=0;
 globalThis.fetch=async()=>{fetches++;throw Error('No endpoint query for retired PID');};
 const gate=new OwnedExtensionGate({port:9788,appPid:()=>101,target:{},initialRoot:'/owned',observeListener:(_port,_root,retirement)=>{probes++;assert.equal(retirement.pid,103);return 103;}});
 try{
  gate.completedPids.add(103);gate.previousPid=103;gate.phase.previousPid=103;gate.phase.label='declared-next';const deadline=gate.phase.deadline=Date.now()+40;gate.attach=async()=>{attaches++;};gate.start();
  await assert.rejects(gate.initial.promise,/startup deadline/);assert.equal(gate.phase.deadline,deadline);assert.equal(probes,1);assert.equal(fetches,0);assert.equal(attaches,0);assert.equal(gate.events.filter(e=>e.phase==='prior-host-retiring').length,1);assert(!gate.events.some(e=>e.phase==='activation-released'));await gate.close();
 }finally{globalThis.fetch=originalFetch;await gate.close().catch(()=>{});}
});
