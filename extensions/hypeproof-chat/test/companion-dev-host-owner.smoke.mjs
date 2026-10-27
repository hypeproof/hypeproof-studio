import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { nativeBridgeFixture } from './lib/companion-native-bridge-harness.mjs';
import { CompanionTransportBudget } from '../src/companionTransportBudget.ts';
const require=createRequire(import.meta.url),pairId='ci_'+'a'.repeat(32);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/companionDevHostOwner.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve};};
async function fixture(){
 const native=await nativeBridgeFixture(),module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?native.vscode:require(id),process,Buffer,console,fetch:native.fetcher,URL,Response,AbortSignal,AbortController,TextEncoder,TextDecoder,crypto,btoa,atob,performance,structuredClone,setTimeout,clearTimeout});
 const calls={start:0,refresh:0,approve:[],revoke:0,offer:0,connect:0,close:0,acks:[],prepared:[],sent:[]};let onStart=async()=>{},onRefresh=async()=>{},batch=[];
 const pair={invitation:null,keys:null,qr:null,claim:null,frozenClaim:null,
  async start(scope){calls.start++;await onStart();this.keys={privateKey:'test-owned-synthetic-reference'};this.invitation={...native.pair,id:pairId,status:'open',host_id:scope.host_id,workspace_id:scope.workspace_id,project_id:scope.project_id};this.qr={schema:this.invitation.schema,id:pairId,invite_secret:'synthetic-invitation-challenge',host_key:'synthetic-public-key',invitation_digest:'a'.repeat(64),host_invite_proof:'synthetic-proof',challenge_expires_at:Math.floor(Date.now()/1000)+120};return this.qr;},
  async refresh(){calls.refresh++;await onRefresh();return this.invitation;},async approve(code){calls.approve.push(code);this.invitation={...this.invitation,status:'approved'};return this.invitation;},async revoke(){calls.revoke++;this.invitation={...this.invitation,status:'revoked'};return this.invitation;}};
 const relay={role:'host',get row(){return pair.invitation;},async publishOffer(){calls.offer++;},async connect(){calls.connect++;},async prepare(text,id){calls.prepared.push({text,id});return id;},async send(id){calls.sent.push(id);},async receive(){const delivered=batch;batch=[];return delivered;},async acknowledge(id){calls.acks.push(id);},close(){calls.close++;}};
 const budget=new CompanionTransportBudget();let rawFetch=(...args)=>native.fetcher(...args);let config={service:'http://127.0.0.1:44321/v1',site:'http://127.0.0.1:44321'};
 const owner=new module.exports.CompanionDevHostOwner({context:native.context,connections:native.connections,accounts:native.accounts,configured:()=>config,identity:{accountId:'account',sessionId:'host-session'},budget,fetch:(...args)=>rawFetch(...args),taskView:()=>native.store.getView(),epoch:()=>1,journal:native.journal,clients:{pairing:()=>pair,relay:()=>relay}});
 const startAndClaim=async()=>{const value=await owner.startInvitation();pair.invitation={...pair.invitation,status:'claimed',compare_code:'a'.repeat(12),device_session_id:'device-session',device_id:'phone'};await owner.inspectClaim();return value;};
 const connect=async()=>{await startAndClaim();await owner.confirmComparedCode('a'.repeat(12));pair.invitation={...pair.invitation,status:'paired'};await owner.connectCipher();};
 return{native,owner,pair,relay,calls,startAndClaim,connect,set rawFetch(v){rawFetch=v;},set onStart(v){onStart=v;},set onRefresh(v){onRefresh=v;},set config(v){config=v;},set batch(v){batch=v;},cleanup:async()=>{owner.close();budget.dispose();await native.cleanup();}};
}

test('explicit lifecycle requires supplied code and preserves separate native exact-file Cancel/Allow',async()=>{
 const f=await fixture();try{
  assert.equal(f.calls.start,0);assert.equal(f.native.calls.length,0);const invitation=await f.startAndClaim();assert.equal(invitation.view.executionAuthorized,false);assert.equal(f.calls.approve.length,0);await assert.rejects(()=>f.owner.confirmComparedCode('b'.repeat(12)),/explicit_comparison_required/);assert.equal(f.calls.approve.length,0);await f.owner.confirmComparedCode('a'.repeat(12));f.pair.invitation={...f.pair.invitation,status:'paired'};await f.owner.connectCipher();assert.equal(f.calls.offer,1);assert.equal(f.calls.connect,1);
  const denied=await f.owner.describeSelected('selected_cancel');assert(denied);assert.equal(JSON.stringify(denied).includes(f.native.root),false);assert.equal(JSON.stringify(denied).includes(f.native.text),false);f.native.approved=false;f.batch=[{message_id:denied.requestId,message_hash:'c'.repeat(64),text:JSON.stringify(denied)}];await f.owner.receiveAndHandle();assert.equal(f.native.dialogs.length,1);assert.equal((await f.native.journal.load())?.entries?.length??0,0);assert.equal(JSON.parse(f.calls.prepared.at(-1).text).outcome.code,'host_consent_required');
  f.native.approved=true;const allowed=await f.owner.describeSelected('selected_allow');f.batch=[{message_id:allowed.requestId,message_hash:'d'.repeat(64),text:JSON.stringify(allowed)}];const work=f.owner.receiveAndHandle();assert.equal(work,f.owner.receiveAndHandle());await work;assert.equal(f.native.dialogs.length,2);assert.equal((await f.native.journal.load()).entries.length,1);assert.equal(JSON.parse(f.calls.prepared.at(-1).text).outcome.artifact.text,f.native.text);assert.equal(JSON.stringify(f.owner.view()).includes(f.native.root),false);assert.equal(JSON.stringify(f.owner.view()).includes('synthetic-invitation-challenge'),false);
 }finally{await f.cleanup();}
});

test('scope/signout/config close before new work; local close never claims signed revoke',async()=>{
 for(const change of [f=>{f.native.connections.current={...f.native.connections.current,ref:'changed'};},f=>f.native.secrets.clear(),f=>{f.config={service:'http://127.0.0.1:44322/v1',site:'http://127.0.0.1:44321'};}]){const f=await fixture();try{await f.connect();const before=f.calls.refresh;change(f);await assert.rejects(()=>f.owner.describeSelected('changed'));assert.equal(f.owner.view().state,'closed');assert.equal(f.calls.refresh,before);assert.equal(f.calls.revoke,0);assert.equal(f.pair.keys,null);assert.equal(f.calls.close,1);}finally{await f.cleanup();}}
 const f=await fixture();try{await f.connect();f.owner.close();assert.equal(f.owner.view().reason,'local_close');assert.equal(f.calls.revoke,0);await assert.rejects(()=>f.owner.revoke(),/closed/);}finally{await f.cleanup();}
});

test('close during client key preparation blocks late publication and releases references',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();try{f.onStart=async()=>{entered.resolve();await release.promise;};const starting=f.owner.startInvitation();await entered.promise;f.owner.close();await assert.rejects(()=>starting,/closed/);release.resolve();await new Promise(r=>setTimeout(r,0));assert.equal(f.owner.view().state,'closed');assert.equal(f.pair.keys,null);assert.equal(f.pair.qr,null);assert.equal(f.calls.approve.length,0);assert.equal(f.calls.revoke,0);}finally{release.resolve();await f.cleanup();}
});

test('cancel during explicit refresh closes cipher and cannot publish a late view',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),abort=new AbortController();try{await f.connect();f.onRefresh=async()=>{entered.resolve();await release.promise;};const work=f.owner.describeSelected('cancel_refresh',abort.signal);await entered.promise;abort.abort();await assert.rejects(()=>work,/closed/);release.resolve();await new Promise(r=>setTimeout(r,0));assert.equal(f.owner.view().state,'closed');assert.equal(f.calls.close,1);assert.equal(f.calls.revoke,0);}finally{release.resolve();await f.cleanup();}
});

test('signed revoke is explicit and returns only bounded safe state',async()=>{
 const f=await fixture();try{await f.connect();const view=await f.owner.revoke();assert.equal(view.state,'revoked');assert.equal(view.executionAuthorized,false);assert.equal(f.calls.revoke,1);assert.equal(f.calls.close,1);assert.equal(f.pair.keys,null);assert.equal(JSON.stringify(view).includes('privateKey'),false);}finally{await f.cleanup();}
});

test('post-fetch binding rejection cancels an unconsumed live body before it can escape to auth transport',async()=>{
 const f=await fixture();let cancelled=0;try{f.rawFetch=async()=>{const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({account:{id:'account'},session_id:'host-session'})));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});f.config={service:'http://127.0.0.1:44322/v1',site:'http://127.0.0.1:44321'};return response;};await assert.rejects(()=>f.owner.startInvitation());assert.equal(cancelled,1);assert.equal(f.owner.view().state,'closed');assert.equal(f.calls.start,0);}finally{await f.cleanup();}
});

test('production mode or foreign configuration cannot read native credentials or start clients',async()=>{
 for(const unsafe of [f=>{f.native.context.extensionMode=1;},f=>{f.config={service:'https://api.hypeproof-ai.xyz/v1',site:'https://hypeproof-ai.xyz'};}]){const f=await fixture();let reads=0;try{f.native.accounts.accessToken=async()=>{reads++;throw Error('must not access native credentials');};unsafe(f);await assert.rejects(()=>f.owner.startInvitation(),/scope_changed/);assert.equal(reads,0);assert.equal(f.calls.start,0);assert.equal(f.native.calls.length,0);}finally{await f.cleanup();}}
});
