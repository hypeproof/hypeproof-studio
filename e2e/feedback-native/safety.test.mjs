import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {loopback,validateConfig,assertNoBackdoors,sanitize,candidateProof,sha256,foregroundAllowed,sourceSnapshot,stopOwnedCandidate} from './safety.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'feedback-native-safety-'));
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));
const config=()=>({schema:'hps-feedback-native/1',candidate:{app:path.join(tmp,'app'),receipt:path.join(tmp,'receipt.json')},service:{origin:'http://127.0.0.1:8787',manifest:path.join(tmp,'service.json'),tokenAFile:path.join(tmp,'token')},workspace:{a:path.join(tmp,'a'),b:path.join(tmp,'b')},userDataDir:path.join(tmp,'data'),evidence:path.join(tmp,'evidence'),secretStorage:'inmemory'});
test('requires explicit credential-free local endpoints and absolute isolated folders',()=>{assert.equal(loopback('http://127.0.0.1:9777'), 'http://127.0.0.1:9777');for(const url of ['https://example.com','http://localhost.evil:90','http://user:secret@127.0.0.1','file:///tmp/x','http://127.0.0.1/?secret=a'])assert.throws(()=>loopback(url));assert.equal(validateConfig(config()).schema,'hps-feedback-native/1');for(const mutate of [c=>c.workspace.b=c.workspace.a,c=>c.workspace.a=path.join(c.candidate.app,'inside'),c=>c.userDataDir='relative',c=>c.secretStorage='unknown',c=>c.service.tokenAFile='relative']){const c=config();mutate(c);assert.throws(()=>validateConfig(c));}});
test('allows actual routing or explicit analytics-only pair; refuses credential/history/routing backdoors',()=>{const data=path.join(tmp,'guard');fs.mkdirSync(path.join(data,'User'),{recursive:true});assertNoBackdoors(data,{});assertNoBackdoors(data,{HPS_TEST_E2E:'1',HPS_TEST_REAL_WORKSPACE:'1'});for(const env of [{HPS_TEST_E2E:'1'},{HPS_TEST_REAL_WORKSPACE:'1'},{HPS_TEST_TOKEN:'secret'},{HPS_TEST_E2E:'1',HPS_TEST_REAL_WORKSPACE:'1',HPS_TEST_HISTORY_SEED:'1'}])assert.throws(()=>assertNoBackdoors(data,env));fs.writeFileSync(path.join(data,'User/hps-test-state.json'),'{}');assert.throws(()=>assertNoBackdoors(data,{}));});
test('sanitizes exact credentials and bearer material before evidence serialization',()=>{assert.equal(sanitize('code abc-secret Bearer raw-token',['abc-secret']),'code [REDACTED] Bearer [REDACTED]');});
test('candidate acceptance binds receipt source SHA, clean inputs and injected bytes; newer clean commits cannot relabel old builds',()=>{
 const c=config(),source=path.join(tmp,'source');fs.mkdirSync(source);
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Safety Test');git('config','user.email','safety@example.invalid');
 const src=path.join(source,'extensions/hypeproof-chat/src');fs.mkdirSync(src,{recursive:true});fs.writeFileSync(path.join(src,'한글.ts'),'export {};');git('add','.');git('commit','-qm','fixture');
 const resources=path.join(c.candidate.app,process.platform==='darwin'?'Contents/Resources/app':'resources/app'),extension=path.join(resources,'extensions/hypeproof-chat');
 fs.mkdirSync(path.join(extension,'dist'),{recursive:true});const injected=path.join(extension,'dist/extension.js');fs.writeFileSync(injected,'fixture bundle');
 fs.mkdirSync(path.join(tmp,'build'),{recursive:true});const stage=path.join(tmp,'build/extension.js');fs.copyFileSync(injected,stage);
 fs.writeFileSync(path.join(extension,'package.json'),JSON.stringify({version:'0.0.0',contributes:{commands:[{command:'fixture',title:'Fixture'}]}}));fs.writeFileSync(path.join(resources,'product.json'),'{}');
 const binding=sourceSnapshot(source),receipt={format:'hps-studio-dev/1',source,source_sha:binding.sha,source_dirty:false,source_binding:binding,app:c.candidate.app,official_app_unchanged:true,extension_sha256:sha256(injected)};
 const write=value=>fs.writeFileSync(c.candidate.receipt,JSON.stringify(value));write(receipt);
 const python=process.platform==='win32'?'python':'python3';
 const pythonBinding=JSON.parse(execFileSync(python,['-c',"import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('dev',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.source_snapshot(Path(sys.argv[2]))))",path.resolve(import.meta.dirname,'../../scripts/studio-dev.py'),source],{encoding:'utf8'}));
 assert.deepEqual(binding,pythonBinding,'Python preparation and Node acceptance bind the same Unicode source inputs');
 assert.equal(candidateProof(c).commands[0],'fixture');
 write({...receipt,source_binding:undefined});assert.throws(()=>candidateProof(c),/dirty|binding/);write(receipt);
 write({...receipt,source_dirty:true});assert.throws(()=>candidateProof(c),/dirty/);write(receipt);
 write({...receipt,source_binding:{...binding,inputs_sha256:'0'.repeat(64)}});assert.throws(()=>candidateProof(c),/binding/);write(receipt);
 c.candidate.sourceSha='wrong';assert.throws(()=>candidateProof(c),/stale/);delete c.candidate.sourceSha;
 fs.writeFileSync(path.join(src,'한글.ts'),'dirty');assert.throws(()=>candidateProof(c),/changed/);git('checkout','--','.');
 fs.writeFileSync(stage,'stale local build');assert.throws(()=>candidateProof(c),/Preparation stage build/);fs.copyFileSync(injected,stage);
 fs.writeFileSync(injected,'tamper');assert.throws(()=>candidateProof(c),/bytes differ/);fs.copyFileSync(stage,injected);
 git('commit','--allow-empty','-qm','new clean commit after preparation');c.candidate.sourceSha=git('rev-parse','HEAD');
 assert.throws(()=>candidateProof(c),/receipt source SHA.*stale/,'Updating config to new clean HEAD cannot relabel an old receipt/bundle');
});

test('foreground input is default-deny and preflight overrides opt-in',()=>{assert.equal(foregroundAllowed([]),false);assert.equal(foregroundAllowed(['--preflight']),false);assert.equal(foregroundAllowed(['--allow-foreground']),true);assert.equal(foregroundAllowed(['--allow-foreground','--preflight']),false);});

test('Service startup refuses missing or wrong explicit revision before opening a listener',()=>{for(const pin of ['', '0'.repeat(40)]){let stderr;try{execFileSync(process.execPath,[path.join(import.meta.dirname,'service.mjs')],{cwd:process.cwd(),env:{...process.env,HPS_SERVICE_SOURCE:process.cwd(),HPS_SERVICE_SHA:pin},stdio:['ignore','pipe','pipe']});assert.fail('Unpinned Service started');}catch(error){assert.notEqual(error.status,0);stderr=error.stderr.toString();}assert.match(stderr,pin?/HEAD differs/:/must explicitly pin/);}});

test('token B and third C paths are explicit and isolated; a linked C alias cannot pass',()=>{
 const c=config();c.service.tokenBFile=path.join(tmp,'token-b');c.workspace.c=path.join(tmp,'c');c.scenarios=['folders','activity-isolation'];assert.equal(validateConfig(c),c);
 for(const mutate of [v=>v.service.tokenBFile='relative',v=>delete v.service.tokenBFile,v=>delete v.workspace.c,v=>v.workspace.c=v.workspace.a,v=>v.workspace.c=path.join(v.workspace.a,'nested'),v=>v.workspace.c=v.candidate.app]){const changed=structuredClone(c);mutate(changed);assert.throws(()=>validateConfig(changed));}
 const root=path.join(tmp,'aliases'),a=path.join(root,'a'),b=path.join(root,'b'),alias=path.join(root,'c');fs.mkdirSync(a,{recursive:true});fs.mkdirSync(b);fs.symlinkSync(a,alias,process.platform==='win32'?'junction':'dir');
 const linked=structuredClone(c);linked.workspace={a,b,c:alias};assert.throws(()=>validateConfig(linked),/Real C/);
});
test('both explicit tokens are redacted; equal profile does not imply equal activity',async()=>{
 const {distinctActivities}=await import('./safety.mjs');
 assert.equal(distinctActivities({profile_id:'same',activity_id:'a'.repeat(64)},{profile_id:'same',activity_id:'b'.repeat(64)}),true);
 for(const other of [{activity_id:'a'.repeat(64)},{activity_id:''},{}])assert.throws(()=>distinctActivities({activity_id:'a'.repeat(64)},other));
 assert.equal(sanitize('token-a-value token-b-value',['token-a-value','token-b-value']),'[REDACTED] [REDACTED]');
});
function restartFixture(){
 const events=[],config={attach:false,secretStorage:'os-keychain'},child={pid:10,exitCode:null,signalCode:null};
 return {events,config,child,expectedDraft:'persisted-A',quit:async()=>events.push('native-quit'),waitExit:async old=>{events.push('normal-exit');old.exitCode=0;},waitCdpDown:async()=>events.push('cdp-refused'),launch:async()=>{events.push('same-profile-new-process');return{pid:11,exitCode:null,signalCode:null};},observeDraft:async()=>{events.push('actual-chat-without-token');return'persisted-A';}};
}
test('restart proof requires normal native exit, CDP down, new PID then restored draft in order',async()=>{
 const {restartOwnedCandidate}=await import('./safety.mjs'),f=restartFixture();const result=await restartOwnedCandidate(f);
 assert.deepEqual(f.events,['native-quit','normal-exit','cdp-refused','same-profile-new-process','actual-chat-without-token']);assert.equal(result.code_reentry,false);assert.equal(result.new_pid,11);
});
test('attach or memory storage blocks before input; exit/endpoint/PID/draft negatives cannot pass',async()=>{
 const {restartOwnedCandidate}=await import('./safety.mjs');
 for(const change of [f=>f.config.attach=true,f=>f.config.secretStorage='inmemory']){const f=restartFixture();change(f);await assert.rejects(restartOwnedCandidate(f),e=>e.blocked===true);assert.deepEqual(f.events,[]);}
 for(const change of [f=>f.child.exitCode=0,f=>f.waitExit=async()=>{},f=>f.waitExit=async old=>{old.exitCode=1;},f=>f.waitExit=async old=>{old.signalCode='SIGTERM';},f=>f.waitCdpDown=async()=>{throw Error('still listening');},f=>f.launch=async()=>({pid:10,exitCode:null,signalCode:null}),f=>f.observeDraft=async()=>'',f=>f.observeDraft=async()=> 'B-draft']){const f=restartFixture();change(f);await assert.rejects(restartOwnedCandidate(f));}
});

test('restart failure retains normal exit, refused CDP and new PID observations before draft failure',async()=>{
 const {restartOwnedCandidate}=await import('./safety.mjs'),f=restartFixture(),observations=[];
 f.onProgress=e=>observations.push(e);f.observeDraft=async()=>{throw Error('restored chat not ready');};
 await assert.rejects(restartOwnedCandidate(f),/not ready/);
 assert.deepEqual(observations.map(e=>e.phase),['native_quit_requested','owned_child_normal_exit','prior_cdp_connection_refused','new_owned_process_launched']);
 assert.equal(observations[1].exit_code,0);assert.equal(observations[3].old_pid,10);assert.equal(observations[3].new_pid,11);
 assert(!observations.some(e=>e.phase==='restored_chat_and_draft_observed'));
});

test('restart artifacts require hidden user layout and unchanged native saved bytes within actual workspace',async()=>{
 const {verifyRestartArtifacts}=await import('./safety.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restart-artifacts-'));
 try{const workspace=path.join(dir,'A');fs.mkdirSync(workspace);const file=path.join(workspace,'native.txt');fs.writeFileSync(file,'original saved bytes');const savedFile={path:file,sha256:sha256(file)};
 assert.equal(verifyRestartArtifacts({sidebarVisible:false,savedFile,workspace}).saved_file_preserved,true);
 assert.throws(()=>verifyRestartArtifacts({sidebarVisible:true,savedFile,workspace}),/hidden sidebar/);
 fs.writeFileSync(file,'changed');assert.throws(()=>verifyRestartArtifacts({sidebarVisible:false,savedFile,workspace}),/bytes changed/);
 const outside=path.join(dir,'outside.txt');fs.writeFileSync(outside,'original saved bytes');assert.throws(()=>verifyRestartArtifacts({sidebarVisible:false,savedFile:{path:outside,sha256:sha256(outside)},workspace}),/actual workspace/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('native scripted turns require immutable matching actual-SDK source/binary/Service/cancel proof before UI',async()=>{
 const {sdkProtocolProof}=await import('./safety.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-sdk-proof-'));
 try{const file=path.join(dir,'probe.json'),c={candidate:{sourceSha:'a'.repeat(40)},sdkProtocolProof:{file}},service={source:{sha:'b'.repeat(40)}},sdk={version:'0.3.299',sha256:'c'.repeat(64)};
 const valid={status:'PASS',protocol_readiness:'PASS_REAL_SDK_SCRIPTED_PROTOCOL',cancellation_verdict:'PASS_ALL_LAYERS',provider_called:false,studio_source_sha:c.candidate.sourceSha,studio_dirty:false,service:service.source,sdk_binary_sha256:sdk.sha256,sdk_version:sdk.version,fixture_hashes:Object.fromEntries(['service.mjs','scripted-upstream.mjs','scripted-sdk-probe.mjs','session-control.mjs'].map(name=>[name,sha256(new URL(name,import.meta.url))]))};
 const write=value=>{fs.writeFileSync(file,JSON.stringify(value));c.sdkProtocolProof.sha256=sha256(file);};write(valid);assert.equal(sdkProtocolProof(c,service,sdk).provider_called,false);
 for(const change of [{status:'FAIL'},{studio_dirty:true},{provider_called:true},{studio_source_sha:'d'.repeat(40)},{service:{sha:'d'.repeat(40)}},{sdk_binary_sha256:'d'.repeat(64)},{sdk_version:'0.0.0'},{cancellation_verdict:'FAIL_NOT_PROPAGATED'},{fixture_hashes:{}}]){write({...valid,...change});assert.throws(()=>sdkProtocolProof(c,service,sdk));}
 write(valid);fs.appendFileSync(file,' ');assert.throws(()=>sdkProtocolProof(c,service,sdk),/missing or changed/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('scripted history requires owned isolated fresh D; attach, missing and linked destinations refuse',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-owned-D-'));try{
 const c=config();c.scenarios=['history-streaming'];c.workspace={a:path.join(dir,'A'),b:path.join(dir,'B'),c:path.join(dir,'C'),d:path.join(dir,'D')};for(const p of Object.values(c.workspace))fs.mkdirSync(p);assert.equal(validateConfig(c),c);
 assert.throws(()=>validateConfig({...c,attach:true}),/owned fresh D/);assert.throws(()=>validateConfig({...c,workspace:{...c.workspace,d:undefined}}),/owned fresh D/);
 const linked=path.join(dir,'linked');fs.symlinkSync(c.workspace.a,linked,process.platform==='win32'?'junction':'dir');assert.throws(()=>validateConfig({...c,workspace:{...c.workspace,d:linked}}),/including linked/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('final cleanup observes child exit and CDP refusal, never equates signal request with success',async()=>{
 let stops=0;const child={pid:123,exitCode:null,signalCode:null,kill(){stops++;return true;}};
 const proof=await stopOwnedCandidate({config:{attach:false},child,waitExit:async owned=>{owned.signalCode='SIGTERM';},waitCdpDown:async()=>{}});
 assert.equal(stops,1);assert.equal(proof.status,'PASS');assert(proof.child_exit_observed&&proof.cdp_down);assert.equal(proof.signal_code,'SIGTERM');
 for(const failAt of ['exit','cdp']){
  const owned={pid:124,exitCode:null,signalCode:null,kill(){stops++;return true;}};
  const value=await stopOwnedCandidate({config:{},child:owned,waitExit:async()=>{if(failAt==='exit')throw Error('bounded exit timeout');owned.signalCode='SIGTERM';},waitCdpDown:async()=>{throw Error('CDP still alive');}});
  assert.equal(value.status,'FAIL');assert.equal(value.child_exit_observed,failAt==='cdp');assert.equal(value.cdp_down,false);
 }
 const previous=stops;await assert.rejects(stopOwnedCandidate({config:{attach:true},child}),/exact owned child/);assert.equal(stops,previous);
 const unobserved=await stopOwnedCandidate({config:{},child:{pid:125,exitCode:null,signalCode:null,kill:()=>true},waitExit:async()=>{},waitCdpDown:async()=>{throw Error('must not probe');}});assert.match(unobserved.error,/exit not observed/);assert.equal(unobserved.child_exit_observed,false);
});
