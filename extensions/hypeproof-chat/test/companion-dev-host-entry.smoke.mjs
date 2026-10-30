import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createTaskHarness} from './task-workspace-harness.mjs';
import {nativeBridgeFixture} from './lib/companion-native-bridge-harness.mjs';
const require=createRequire(import.meta.url),realFs=require('node:fs/promises');
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/companionDevHostEntry.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,footer:{js:'module.exports.__testAcquire = acquireJournalLease;'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve};};
class Disposable{constructor(fn){this.fn=fn;}dispose(){this.fn?.();this.fn=undefined;}}
class EventEmitter{listeners=new Set();event=fn=>{this.listeners.add(fn);return new Disposable(()=>this.listeners.delete(fn));};fire(){for(const fn of this.listeners)fn();}dispose(){this.listeners.clear();}}
function load({io=realFs,commands={registerCommand:()=>new Disposable(()=>{})},native={}}={}){const module={exports:{}};const vscode={ExtensionMode:{Development:2,Production:1},Disposable,EventEmitter,commands,...native.vscode};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:id==='node:fs/promises'?io:require(id),process,Buffer,console,URL,Response,AbortController,AbortSignal,TextDecoder,TextEncoder,performance,crypto,btoa,atob,fetch:native.fetcher??fetch,setTimeout,clearTimeout,structuredClone});return module.exports;}

test('only DEV gets factory registration API; construction/register create no account/task/journal/network authority',()=>{
 const apiModule=load();let reads=0,created=0,registered=0;
 const ports={get accounts(){reads++;throw Error('no account access at registration');},connections:{},configured(){reads++;throw Error('no config access');},taskView(){reads++;throw Error('no task access');},epoch(){reads++;throw Error('no epoch access');}};
 assert.equal(apiModule.createCompanionDevHostEntry({extensionMode:1},ports),undefined);
 const exports=load({commands:{registerCommand:()=>{registered++;return new Disposable(()=>{});}}});
 const context={extensionMode:2,subscriptions:[],get globalStorageUri(){reads++;throw Error('no filesystem authority at registration');}};
 const control=exports.createCompanionDevHostEntry(context,ports);assert.deepEqual(Object.keys(control.api),['registerClients']);const registration=control.api.registerClients({pairing(){created++;throw Error('not called');},relay(){created++;throw Error('not called');}});assert.equal(registered,3);assert.equal(created,0);assert.equal(reads,0);control.invalidate();registration.dispose();control.dispose();
});

test('journal lease retains admitted old write and cross-process lock until drain; successor cannot load early',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'companion-journal-'));const entered=deferred(),finish=deferred();let held=false,generation=1,successorLoaded=false;
 const io={...realFs,writeFile:async(file,...args)=>{if(String(file).endsWith('.tmp')&&!held){held=true;entered.resolve();await finish.promise;}return realFs.writeFile(file,...args);}};const acquire=load({io}).__testAcquire;
 let first,second;try{
  first=await acquire(directory,()=>generation===1).ready;const saved=first.journal.save({entries:[],marker:'admitted-old'});await entered.promise;generation=2;first.stopAdmission();await assert.rejects(()=>first.journal.save({entries:[],marker:'late-old'}),/journal_closed/);
  const next=acquire(directory,()=>generation===2);const loading=next.ready.then(async lease=>{second=lease;const state=await lease.journal.load();successorLoaded=true;return state;});const closing=first.release();await new Promise(r=>setTimeout(r,35));assert.equal(successorLoaded,false,'successor load is blocked while old admitted IO owns the lock');finish.resolve();await saved;await closing;const loaded=await loading;assert.equal(loaded.marker,'admitted-old');await assert.rejects(()=>first.journal.save({entries:[],marker:'late-overwrite'}),/journal_closed/);assert.equal(JSON.parse(await readFile(join(directory,'journal.json'),'utf8')).marker,'admitted-old');await second.release();
 }finally{finish.resolve();await first?.release();await second?.release();await rm(directory,{recursive:true,force:true});}
});

test('corrupt journal read is not absence; closed waiting acquisition never gets a runner',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'companion-corrupt-'));const acquire=load().__testAcquire;let first;
 try{await writeFile(join(directory,'journal.json'),'{broken');first=await acquire(directory,()=>true).ready;await assert.rejects(()=>first.journal.load(),/JSON|Unexpected|property/i);
  const waiting=acquire(directory,()=>true);waiting.cancel();await assert.rejects(()=>waiting.ready,/cancelled/);await assert.rejects(()=>first.release(),/JSON|Unexpected|property/i);await waiting.settled;const successor=await acquire(directory,()=>true).ready;await successor.release();await assert.rejects(()=>first.journal.load(),/journal_closed/);assert.equal(await readFile(join(directory,'journal.json'),'utf8'),'{broken');
 }finally{await first?.release().catch(()=>{});await rm(directory,{recursive:true,force:true});}
});

test('real provider exposes existing task view and emits metadata invalidation at native task/profile/runtime boundaries',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'companion-provider-'));try{const f=await createTaskHarness(directory);let invalidations=0;f.h.companionRuntimeInvalidated=()=>{invalidations++;};assert.equal(f.h.companionTaskView().activeTaskId,f.store.getView().activeTaskId);f.h.taskChanging=true;assert.equal(f.h.companionTaskView(),null);f.h.taskChanging=false;f.h.draftSource=undefined;await f.h.setConnectionChanging(true);assert.equal(invalidations,1);await f.h.setConnectionChanging(false);
  f.h.ensureProfile=async()=>null;f.h.opsGeneration=4;assert.equal(await f.h.opsNewGeneration(),5);assert.equal(invalidations,2);
  f.h._instructorMode={reset(){}};f.h.endTaskCommandAllows=()=>{};f.h.refreshCrBytesContext=async()=>{};f.h.refreshSitePublishContext=()=>{};f.h.invalidateProfile();assert.equal(invalidations,3);
  f.connections.active=undefined;await f.h.prepareTaskWorkspace(false);assert.equal(invalidations,4);assert.equal(f.h.companionTaskView(),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('real task switch invalidates before committing a new active task; metadata-only draft updates keep the owner',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'companion-task-boundary-'));try{
  let f;f=await createTaskHarness(directory,message=>{if(message.type==='activityFreeze'&&message.nonce)void f.handle(f.scoped({type:'saveActivityDraft',nonce:message.nonce,draft:{text:'saved before switch',images:[],queued:null}}));});
  const first=f.store.getView().activeTaskId;const observed=[];f.h.companionRuntimeInvalidated=()=>observed.push(f.store.getView().activeTaskId);
  await f.handle(f.scoped({type:'saveActivityDraft',draft:{text:'ordinary draft',images:[],queued:null}}));assert.equal(observed.length,0);
  await f.handle(f.scoped({type:'taskCreate'}));assert.notEqual(f.store.getView().activeTaskId,first);assert.deepEqual(observed,[first]);assert.equal(f.h.companionTaskView().activeTaskId,f.store.getView().activeTaskId);
 }finally{await rm(directory,{recursive:true,force:true});}
});


test('registered native controls construct a real prepared owner on gesture and recreate only after journal release',async()=>{
 const native=await nativeBridgeFixture();let handler,created=0;const messages=[];
 try{
  native.context.globalStorageUri={fsPath:native.state};native.accounts.view=()=>({status:'signedIn',account:{id:'account'}});
  native.vscode.commands={registerCommand:(_id,fn)=>{handler=fn;return new Disposable(()=>{});}};
  native.vscode.ProgressLocation={Notification:15};native.vscode.window.showQuickPick=async items=>items.find(item=>item.action==='prepare');
  native.vscode.window.withProgress=async(_options,work)=>work({}, {onCancellationRequested:()=>new Disposable(()=>{})});
  native.vscode.window.showInformationMessage=async message=>{messages.push(message);};native.vscode.window.showErrorMessage=async message=>{throw Error(message);};
  const control=load({native}).createCompanionDevHostEntry(native.context,{accounts:native.accounts,connections:native.connections,configured:()=>({service:'http://127.0.0.1:44321/v1',site:'http://127.0.0.1:44321'}),taskView:()=>native.store.getView(),epoch:()=>1});
  const registration=control.api.registerClients({pairing(){created++;return {invitation:null,async start(scope){this.invitation={...native.pair,...scope,id:'ci_'+'a'.repeat(32),status:'open'};return {schema:'hps-companion-pairing-preview/2',id:this.invitation.id,invite_secret:'synthetic-challenge',host_key:'synthetic-public-key',invitation_digest:'a'.repeat(64),host_invite_proof:'synthetic-proof',challenge_expires_at:Math.floor(Date.now()/1000)+60};},async refresh(){return this.invitation;},async approve(){},async revoke(){}};},relay(){throw Error('no implicit cipher connection');}});
  assert.equal(created,0);const before=native.calls.length;await handler();assert.equal(created,1);assert.equal(native.calls.length,before+1,'one explicit authenticated routing /me, no implicit relay or profile read');control.invalidate();await handler();assert.equal(created,2);assert.equal(native.calls.length,before+2);assert.equal(messages.length,2);registration.dispose();control.dispose();
 }finally{await native.cleanup();}
});


test('never-acquired peer lock timeout permits a fresh explicit invitation after the peer releases', {timeout:80_000}, async()=>{
 const native=await nativeBridgeFixture();let handler,created=0,control,registration,peer;const errors=[];
 try{
  native.context.globalStorageUri={fsPath:native.state};native.accounts.view=()=>({status:'signedIn',account:{id:'account'}});
  native.vscode.commands={registerCommand:(_id,fn)=>{handler=fn;return new Disposable(()=>{});}};native.vscode.ProgressLocation={Notification:15};
  native.vscode.window.showQuickPick=async items=>items.find(item=>item.action==='prepare');native.vscode.window.withProgress=async(_options,work)=>work({}, {onCancellationRequested:()=>new Disposable(()=>{})});native.vscode.window.showInformationMessage=async()=>{};native.vscode.window.showErrorMessage=async message=>errors.push(message);
  const service='http://127.0.0.1:44321/v1',p=native.preparation;
  const directory=join(native.state,'companion-host',createHash('sha256').update(JSON.stringify([service,'account','host-session',p.scope,p.hostId,p.projectId])).digest('hex'));
  const lockModule=new URL('../src/accountLock.ts',import.meta.url).href;
  const script=`import {accountLock} from ${JSON.stringify(lockModule)}; let release; const finish=new Promise(r=>release=r); process.on('message',()=>release()); const timer=setTimeout(release,60000); await accountLock(process.argv[1])(async()=>{process.send('held');await finish;});clearTimeout(timer);process.disconnect();`;
  peer=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,directory],{stdio:['ignore','ignore','inherit','ipc']});await once(peer,'message');
  control=load({native}).createCompanionDevHostEntry(native.context,{accounts:native.accounts,connections:native.connections,configured:()=>({service,site:'http://127.0.0.1:44321'}),taskView:()=>native.store.getView(),epoch:()=>1});
  registration=control.api.registerClients({pairing(){created++;return {invitation:null,async start(scope){this.invitation={...native.pair,...scope,id:'ci_'+'a'.repeat(32),status:'open'};return {schema:'hps-companion-pairing-preview/2',id:this.invitation.id,invite_secret:'synthetic-challenge',host_key:'synthetic-public-key',invitation_digest:'a'.repeat(64),host_invite_proof:'synthetic-proof',challenge_expires_at:Math.floor(Date.now()/1000)+60};},async refresh(){return this.invitation;},async approve(){},async revoke(){}};},relay(){throw Error('no implicit relay');}});
  await handler();assert.equal(created,0);assert.equal(errors.length,1,'contention is reported to the first explicit gesture');const exited=once(peer,'exit');peer.send('release');await exited;
  await handler();assert.equal(created,1,'a fresh gesture can start after never-owned contention ends');assert.equal(errors.length,1);
 }finally{registration?.dispose();control?.dispose();if(peer?.connected){const exited=once(peer,'exit');peer.send('release');await exited;}await native.cleanup();}
});

test('admitted journal IO failure drains and unlocks but rejects cleanup instead of admitting a local successor',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'companion-io-failure-'));const io={...realFs,writeFile:async()=>{throw Error('synthetic_owned_write_failure');}};
 const acquire=load({io}).__testAcquire;const first=await acquire(directory,()=>true).ready;
 try{await assert.rejects(()=>first.journal.save({entries:[]}),/synthetic_owned_write_failure/);await assert.rejects(()=>first.release(),/synthetic_owned_write_failure/);await assert.rejects(()=>readFile(join(directory,'account-session.lock')),error=>error.code==='ENOENT');}
 finally{await first.release().catch(()=>{});await rm(directory,{recursive:true,force:true});}
});
