import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:[new URL('../src/activityConnections.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require,process,URL});
const {ActivityConnections,ActivityConnectionError,ACTIVITY_TOKEN_KEY}=module.exports;
const secureSaveError=e=>e instanceof ActivityConnectionError && e.message==='활동 연결을 안전하게 저장하지 못했습니다. 기기의 보안 저장소 접근을 확인한 뒤 다시 시도해 주세요. 기존 연결과 작업 파일은 보존됩니다.';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hps-activity-'));
const a=path.join(tmp,'a'),b=path.join(tmp,'b');fs.mkdirSync(a);fs.mkdirSync(b);
const secrets=new Map([[ACTIVITY_TOKEN_KEY,'synthetic-legacy-never-forward']]);
let failStore=false,failState=false;
function context(){const state=new Map();return {globalStorageUri:{fsPath:path.join(tmp,'storage')},workspaceState:{get:(k,d)=>state.has(k)?state.get(k):d,update:async(k,v)=>{if(failState)throw Error('state failure');state.set(k,v);}},secrets:{keys:async()=>[...secrets.keys()],get:async k=>secrets.get(k),store:async(k,v)=>{if(failStore)throw Error('store failure');secrets.set(k,v);},delete:async k=>secrets.delete(k),onDidChange:()=>({dispose(){}})}};}
const profile=(id,name=id)=>({activity_id:id.repeat(64),display_name:name,activity_kind:'trial'});
let origin='https://synthetic.invalid/v1',root=a;
const raw=context(),store=new ActivityConnections(raw,()=>origin,()=>root,async()=>profile('a'));
try{
 await store.initialize();assert.equal(await store.token(),undefined,'legacy credential is never promoted to an unknown origin');
 await store.commit('synthetic-a',profile('a'),a);const first=store.current;
 const other=new ActivityConnections(raw,()=>origin,()=>a,async()=>profile('a'));await other.initialize();
 const undo=await store.commit('synthetic-b',profile('b'),b);
 assert.equal(await other.token(),'synthetic-a','another window keeps its credential');
 assert.equal(await store.token(),'synthetic-b');
 assert.throws(()=>store.acquire(),/작업 폴더/,'cannot execute B in A root');
 root=b;const reopened=new ActivityConnections(context(),()=>origin,()=>b,async()=>profile('b'));await reopened.initialize();
 assert.equal(await reopened.token(),'synthetic-b','destination root resumes after window reload');
 const release=reopened.acquire();assert.throws(()=>store.acquire(),/다른 창/);release();store.acquire()();
 await assert.rejects(()=>store.commit('synthetic-b',profile('b'),a),/다른 활동/);
 assert.throws(()=>store.prepare(a,profile('b'),()=>assert.fail('must not write a starter in another activity')),/다른 활동/);
 // REQ-L12 — a bought pass continues in its own home folder (Jay, 2026-10-14: the Claude Code way); elsewhere the rule holds.
 const pass=(id,home)=>({...profile(id),pass:{request_limit:200,requests_used:0},workspace_root:home});
 assert.throws(()=>store.prepare(a,pass('c',b),()=>assert.fail('a pass takes over only its home folder')),/다른 활동/);
 // The old owner is retained until commit, including failed preparation and credential storage.
 const beforePass=fs.readFileSync(store['bindingPath'](a),'utf8');
 let prepared=false;store.prepare(a,pass('c',a),()=>{prepared=true;});assert.equal(prepared,true,'a pass can prepare its home folder');
 assert.equal(fs.readFileSync(store['bindingPath'](a),'utf8'),beforePass);
 assert.throws(()=>store.prepare(a,pass('c',a),()=>{throw Error('prepare failure');}),/prepare failure/);
 assert.equal(fs.readFileSync(store['bindingPath'](a),'utf8'),beforePass);
 failStore=true;await assert.rejects(()=>store.commit('synthetic-c',pass('c',a),a),secureSaveError);failStore=false;
 assert.equal(fs.readFileSync(store['bindingPath'](a),'utf8'),beforePass);
 const undoPass=await store.commit('synthetic-c',pass('c',a),a);
 assert.throws(()=>store.prepare(a,profile('a'),()=>assert.fail('an activity that is not a pass cannot take it back')),/다른 활동/);
 await undoPass();assert.equal(fs.readFileSync(store['bindingPath'](a),'utf8'),beforePass);
 // REQ-L12 ⑭ / REQ-STUDIO-FREE-START — a new free seat takes over its home from the machine owner's
 // earlier solo use (free seat, code-issued trial, lost record) and never from a class, a lesson or a pass.
 {
  const own=()=>{const c=context(),m=new Map();return {...c,secrets:{...c.secrets,keys:async()=>[...m.keys()],get:async k=>m.get(k),store:async(k,v)=>{m.set(k,v);},delete:async k=>m.delete(k)}};};
  // One machine: one SecretStorage shared by every activity, as the OS keychain is.
  const machine=own();const onMachine=()=>({...context(),secrets:machine.secrets});
  const at=(name)=>{const d=path.join(tmp,name);fs.mkdirSync(d);return d;};
  const freeAt=(id,home)=>({...profile(id),profile_id:'studio-open-trial',workspace_root:home});
  const codeTrialAt=(id,home)=>({...profile(id),profile_id:'studio-native-trial',workspace_root:home});
  const classAt=(id,home)=>({...profile(id),activity_kind:'classroom',profile_id:'dental-seminar',workspace_root:home});
  const enter=async(ctx,p,home,token='synthetic-'+p.activity_id.slice(0,1))=>{const s=new ActivityConnections(ctx,()=>origin,()=>home,async()=>p);await s.commit(token,p,home);return s;};
  const prepares=async(s,home,p)=>{let ok=false;s.prepare(home,p,()=>{ok=true;},await s.folderOwners(home));return ok;};
  const taken=async(s,home,p,why)=>{const owners=await s.folderOwners(home);assert.throws(()=>s.prepare(home,p,()=>assert.fail(why),owners),/다른 활동/,why);};
  const fresh=(p,home)=>new ActivityConnections(onMachine(),()=>origin,()=>home,async()=>p);

  // Positive 1 — Jay 2026-10-20: a code trial ("HypeProofDentalSeminar" trial) holds ~/HypeProofTrial; free start reuses it.
  const trialHome=at('trial-home');
  const codeTrial=await enter(onMachine(),codeTrialAt('1',trialHome),trialHome);
  const trialRef=codeTrial.current.ref;
  const newcomer=fresh(freeAt('2',trialHome),trialHome);
  assert.deepEqual([...(await newcomer.folderOwners(trialHome)).values()],['trial'],'a code-issued trial resolves as a trial owner');
  assert.throws(()=>newcomer.prepare(trialHome,freeAt('2',trialHome),()=>assert.fail('without the owner lookup the old rule holds')),/다른 활동/,'control: no lookup, no takeover');
  assert.equal(await prepares(newcomer,trialHome,freeAt('2',trialHome)),true,'a free seat prepares its home over a code-issued trial');
  assert.equal(await newcomer.freeWorkspace(freeAt('2',trialHome)),trialHome,'free start picks the home itself');
  await newcomer.commit('synthetic-2',freeAt('2',trialHome),trialHome);assert.equal(await newcomer.token(),'synthetic-2');
  // Files stay; the earlier trial keeps its record and reports the folder as taken when chosen again.
  assert.ok(await machine.secrets.get(trialRef),'the earlier trial keeps its saved record');
  await taken(fresh(codeTrialAt('1',trialHome),trialHome),trialHome,codeTrialAt('1',trialHome),'the earlier trial cannot take the folder back');
  await assert.rejects(()=>fresh(codeTrialAt('1',trialHome),trialHome).commit('synthetic-1b',codeTrialAt('1',trialHome),trialHome),/다른 활동/);

  // Positive 2 — an earlier free seat (lost free credential: reinstall, cleared keychain).
  const freeHome=at('free-home');
  await enter(own(),freeAt('f',freeHome),freeHome);
  const lost=fresh(freeAt('e',freeHome),freeHome);
  assert.equal(await prepares(lost,freeHome,freeAt('e',freeHome)),true,'a new free seat prepares its home over an earlier free seat');
  await lost.commit('synthetic-e',freeAt('e',freeHome),freeHome);assert.equal(await lost.token(),'synthetic-e');

  // Positive 3 — an owner whose record is gone (another keychain): unknown counts as the machine owner's own.
  const lostHome=at('lost-home');
  await enter(own(),codeTrialAt('3',lostHome),lostHome);
  const afterReset=fresh(freeAt('4',lostHome),lostHome);
  assert.deepEqual([...(await afterReset.folderOwners(lostHome)).values()],['unknown']);
  assert.equal(await prepares(afterReset,lostHome,freeAt('4',lostHome)),true,'a free seat takes over a folder whose record is lost');
  await afterReset.commit('synthetic-4',freeAt('4',lostHome),lostHome);

  // Negative 1 — a class (lesson) on this machine holds the home: refused; free start moves on to home-2.
  const classHome=at('class-home');
  await enter(onMachine(),classAt('d',classHome),classHome);
  const blocked=fresh(freeAt('9',classHome),classHome);
  assert.deepEqual([...(await blocked.folderOwners(classHome)).values()],['held']);
  await taken(blocked,classHome,freeAt('9',classHome),'a free seat must not take over a class folder');
  await assert.rejects(()=>blocked.commit('synthetic-9',freeAt('9',classHome),classHome),/다른 활동/,'commit refuses the class folder as prepare does');
  assert.equal(await blocked.freeWorkspace(freeAt('9',classHome)),classHome+'-2','held home: the next numbered folder');
  fs.mkdirSync(classHome+'-2');fs.writeFileSync(path.join(classHome+'-2','mine.txt'),'someone else');
  assert.equal(await blocked.freeWorkspace(freeAt('9',classHome)),classHome+'-3','an unbound sibling with files is never reused');
  assert.equal(await prepares(blocked,classHome+'-3',freeAt('9',classHome)),true);
  await blocked.commit('synthetic-9',freeAt('9',classHome),classHome+'-3');
  assert.equal(await fresh(freeAt('8',classHome),classHome).freeWorkspace(freeAt('8',classHome)),classHome+'-3','a later free seat continues in the free sibling');
  // Negative 2 — a pass holds the home.
  const passHome=at('pass-home');
  await enter(onMachine(),pass('7',passHome),passHome);
  await taken(fresh(freeAt('6',passHome),passHome),passHome,freeAt('6',passHome),'a free seat must not take over a pass folder');
  // A personal activity is not the free seat's either.
  const personalHome=at('personal-home');
  await enter(onMachine(),{...profile('5'),activity_kind:'personal',workspace_root:personalHome},personalHome);
  await taken(fresh(freeAt('6',personalHome),personalHome),personalHome,freeAt('6',personalHome),'a free seat must not take over a personal folder');
  // Negative 3 — a non-home folder, even when its owner is a trial.
  await taken(fresh(freeAt('6',trialHome),a),a,freeAt('6',trialHome),'a free seat takes over only its own folders');
  // A pass bought later takes the free folder; a new free seat cannot take it back.
  await lost.commit('synthetic-p',pass('7',freeHome),freeHome);
  await taken(fresh(freeAt('8',freeHome),freeHome),freeHome,freeAt('8',freeHome),'a free seat must not take back a pass folder');

  // Mutation check: a build that lets `held` through must fail the class control above.
  const src=fs.readFileSync(new URL('../src/activityConnections.ts',import.meta.url),'utf8');
  const mutated=src.replace("owner === 'free' || owner === 'trial' || owner === 'unknown'","owner !== undefined");
  assert.notEqual(mutated,src,'the mutation site exists');
  const mb=await build({stdin:{contents:mutated,resolveDir:new URL('../src',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
  const mm={exports:{}};vm.runInNewContext(mb.outputFiles[0].text,{module:mm,exports:mm.exports,require,process,URL});
  const mutant=new mm.exports.ActivityConnections(onMachine(),()=>origin,()=>classHome,async()=>freeAt('c',classHome));
  let mutantPrepared=false;mutant.prepare(classHome,freeAt('c',classHome),()=>{mutantPrepared=true;},await mutant.folderOwners(classHome));
  assert.equal(mutantPrepared,true,'mutation check: the mutant takes the class folder, so the class control can fail');
 }
 await undo();assert.equal(store.current.ref,first.ref,'failed navigation rolls back exact old reference');
 root=a;origin='https://different.invalid/v1';assert.equal(await store.token(),undefined,'changed server gets no saved credential');origin='https://synthetic.invalid/v1';
 failStore=true;await assert.rejects(()=>store.commit('rotation',profile('a'),a),secureSaveError);failStore=false;
 assert.equal(await store.token(),'synthetic-a');
 failState=true;await assert.rejects(()=>store.commit('rotation',profile('a'),a),/state failure/);failState=false;
 assert.equal(await store.token(),'synthetic-a');
 await store.commit('rotated-a',profile('a'),a);assert.equal(store.scope,first.id,'credential reissue retains activity identity');
 const list=await store.list();assert.equal(list.length,1);assert.equal(JSON.stringify(list).includes('rotated-a'),false,'catalog never contains credentials');
 // Real child processes contend for one physical folder, including a dead owner.
 const bundlePath=path.join(tmp,'store.cjs');fs.writeFileSync(bundlePath,bundled.outputFiles[0].text);
 const record=store.current, childPath=path.join(tmp,'child.cjs');
 const binding=fs.readdirSync(path.join(tmp,'storage/activity-bindings')).find(f=>f.endsWith('.json')&&JSON.parse(fs.readFileSync(path.join(tmp,'storage/activity-bindings',f),'utf8')).ref===record.ref);
 fs.writeFileSync(path.join(tmp,'storage/activity-bindings',binding+'.lock'),JSON.stringify({pid:2147483647,nonce:'synthetic-dead-owner'}));
 fs.writeFileSync(childPath,`
 const fs=require('node:fs'),path=require('node:path');
 const {ActivityConnections}=require('./store.cjs');
 const record=JSON.parse(fs.readFileSync(path.join(__dirname,'record.json'),'utf8'));
 const raw={globalStorageUri:{fsPath:path.join(__dirname,'storage')},workspaceState:{get:()=>record.ref},secrets:{get:async()=>JSON.stringify(record)}};
 (async()=>{const store=new ActivityConnections(raw,()=>record.service,()=>record.workspace,async()=>{});await store.initialize();
 for(let n=0;n<10;n++) {let release;for(let retry=0;retry<200;retry++){try{release=store.acquire();break;}catch{await new Promise(r=>setTimeout(r,5));}}
 if(!release)throw Error('no progress');
 const critical=path.join(__dirname,'critical');fs.writeFileSync(critical,String(process.pid),{flag:'wx'});
 await new Promise(r=>setTimeout(r,3));fs.unlinkSync(critical);release();}
 })().catch(()=>{process.exitCode=1});`);
 fs.writeFileSync(path.join(tmp,'record.json'),JSON.stringify(record),{mode:0o600});
 await Promise.all([1,2,3,4].map(()=>promisify(execFile)(process.execPath,[childPath])));
 await store.disconnect();const disconnected=new ActivityConnections(raw,()=>origin,()=>a,async()=>profile('a'));await disconnected.initialize();assert.equal(await disconnected.token(),undefined,'disconnect survives restart');
 assert.equal(secrets.get(ACTIVITY_TOKEN_KEY),'synthetic-legacy-never-forward','migration source preserved');
 console.log('PASS activity connections: window isolation, origin, root conflict, rollback, restart, rotation, storage faults and secret-free catalog');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
