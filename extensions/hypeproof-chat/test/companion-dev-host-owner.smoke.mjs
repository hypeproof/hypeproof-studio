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
async function fixture(authoring=false){
 const native=await nativeBridgeFixture(),module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?native.vscode:require(id),process,Buffer,console,fetch:native.fetcher,URL,Response,AbortSignal,AbortController,TextEncoder,TextDecoder,crypto,btoa,atob,performance,structuredClone,setTimeout,clearTimeout});
 const calls={start:0,refresh:0,approve:[],revoke:0,offer:0,connect:0,close:0,acks:[],prepared:[],sent:[]};let onStart=async()=>{},onRefresh=async()=>{},onPrepare=async()=>{},onSend=async()=>{},batch=[];
 const pair={invitation:null,keys:null,qr:null,claim:null,frozenClaim:null,
  async start(scope){calls.start++;await onStart();this.keys={privateKey:'test-owned-synthetic-reference'};this.invitation={...native.pair,id:pairId,status:'open',host_id:scope.host_id,workspace_id:scope.workspace_id,project_id:scope.project_id};this.qr={schema:this.invitation.schema,id:pairId,invite_secret:'synthetic-invitation-challenge',host_key:'synthetic-public-key',invitation_digest:'a'.repeat(64),host_invite_proof:'synthetic-proof',challenge_expires_at:Math.floor(Date.now()/1000)+120};return this.qr;},
  async refresh(){calls.refresh++;await onRefresh();return this.invitation;},async approve(code){calls.approve.push(code);this.invitation={...this.invitation,status:'approved'};return this.invitation;},async revoke(){calls.revoke++;this.invitation={...this.invitation,status:'revoked'};return this.invitation;}};
 const relay={role:'host',get row(){return pair.invitation;},async publishOffer(){calls.offer++;},async connect(){calls.connect++;},async prepare(text,id){calls.prepared.push({text,id});await onPrepare();return id;},async send(id){calls.sent.push(id);await onSend();},async receive(){const delivered=batch;batch=[];return delivered;},async acknowledge(id){calls.acks.push(id);},close(){calls.close++;}};
 const budget=new CompanionTransportBudget();let rawFetch=(...args)=>native.fetcher(...args);let config={service:'http://127.0.0.1:44321/v1',site:'http://127.0.0.1:44321'};
 const owner=new module.exports.CompanionDevHostOwner({context:native.context,connections:native.connections,accounts:native.accounts,configured:()=>config,identity:{accountId:'account',sessionId:'host-session'},...(authoring?{authoring:{store:()=>native.store,reviewDraft:async()=>({check:async()=>{},imported:async()=>{},close(){}})}}:{}),budget,fetch:(...args)=>rawFetch(...args),taskView:()=>native.store.getView(),epoch:()=>1,journal:native.journal,clients:{pairing:()=>pair,relay:()=>relay}});
 const startAndClaim=async()=>{const value=await owner.startInvitation();pair.invitation={...pair.invitation,status:'claimed',compare_code:'a'.repeat(12),device_session_id:'device-session',device_id:'phone'};await owner.inspectClaim();return value;};
 const connect=async()=>{await startAndClaim();await owner.confirmComparedCode('a'.repeat(12));pair.invitation={...pair.invitation,status:'paired'};await owner.connectCipher();};
 return{native,owner,pair,relay,calls,startAndClaim,connect,set rawFetch(v){rawFetch=v;},set onStart(v){onStart=v;},set onRefresh(v){onRefresh=v;},set onPrepare(v){onPrepare=v;},set onSend(v){onSend=v;},set config(v){config=v;},set batch(v){batch=v;},cleanup:async()=>{owner.close();budget.dispose();await native.cleanup();}};
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

test('selection publication is metadata only, uncertain explicit retry preserves exact bytes and identity',async()=>{
 const f=await fixture();try{
  await f.connect();let fail=true;f.onSend=async()=>{if(fail)throw Error('uncertain_delivery');};
  const first=await f.owner.publishSelected('publication');assert.equal(first.state,'delivery_unconfirmed');assert.equal(f.calls.sent.length,1);
  assert.equal(f.native.dialogs.length,0);assert.equal((await f.native.journal.load())?.entries?.length??0,0);
  const encoded=JSON.parse(f.calls.prepared[0].text);assert.equal(encoded.schema,'hps-companion-selection/1');assert.equal(encoded.execution_authorized,false);
  assert.equal(f.calls.prepared[0].text.includes(f.native.root),false);assert.equal(f.calls.prepared[0].text.includes(f.native.text),false);
  await assert.rejects(f.owner.publishSelected('another'),/selection_pending/);assert.equal(f.calls.sent.length,1);
  fail=false;const next=await f.owner.publishSelected('publication');assert.equal(next.state,'transport_accepted');assert.equal(next.messageId,first.messageId);
  assert.deepEqual(f.calls.prepared[0],f.calls.prepared[1]);assert.deepEqual(f.calls.sent,[first.messageId,first.messageId]);
  assert.equal(f.owner.view().publication.messageId,first.messageId);assert.equal(f.owner.view().publication.requestId,'publication');
  f.owner.close();assert.equal(f.owner.view().publication,undefined);
 }finally{await f.cleanup();}
});

test('selected file change before explicit retry or during preparation prevents metadata send and clears pending',async()=>{
 for(const phase of ['retry','prepare']){
  const f=await fixture();try{await f.connect();
   const change=()=>{f.native.document.version++;f.native.document.getText=()=>'<html>new selected version</html>';};
   if(phase==='retry'){f.onSend=async()=>{throw Error('uncertain');};await f.owner.publishSelected('publication');change();}
   else f.onPrepare=async()=>change();
   const sent=f.calls.sent.length;await assert.rejects(f.owner.publishSelected('publication'),/selection_changed|closed/);
   assert.equal(f.calls.sent.length,sent);assert.equal(f.owner.view().state,'closed');assert.equal(f.owner.view().publication,undefined);
  }finally{await f.cleanup();}
 }
});

test('cancel during metadata preparation is terminal and cannot emit a late send or receipt',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),abort=new AbortController();try{
  await f.connect();f.onPrepare=async()=>{entered.resolve();await release.promise;};
  const work=f.owner.publishSelected('publication',abort.signal);await entered.promise;abort.abort();await assert.rejects(work,/closed/);
  release.resolve();await new Promise(r=>setTimeout(r,0));assert.equal(f.calls.sent.length,0);assert.equal(f.owner.view().publication,undefined);assert.equal(f.owner.view().state,'closed');
 }finally{release.resolve();await f.cleanup();}
});

test('selection change during a completed HTTP send clears publication instead of returning a current receipt',async()=>{
 const f=await fixture();try{await f.connect();f.onSend=async()=>{f.native.document.version++;f.native.document.getText=()=>'<html>changed during send</html>';};
  await assert.rejects(f.owner.publishSelected('publication'),/closed|selection_changed/);
  assert.equal(f.calls.sent.length,1,'already sent metadata cannot be recalled');assert.equal(f.owner.view().publication,undefined);assert.equal(f.owner.view().state,'closed');
 }finally{await f.cleanup();}
});


test('cipher receive deadline closes native owner and erases keys before late receive can publish',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();try{
  await f.connect();assert.ok(f.pair.keys);f.owner.session.deadlineMs=15;
  f.relay.receive=async()=>{entered.resolve();await release.promise;return[];};
  const pending=f.owner.receiveAndHandle();await entered.promise;await assert.rejects(pending,/closed/);
  assert.equal(f.owner.view().state,'closed');assert.equal(f.pair.keys,null);assert.equal(f.pair.qr,null);assert.equal(f.calls.close,1);
  release.resolve();await new Promise(r=>setTimeout(r,0));assert.equal(f.calls.prepared.length,0);assert.equal(f.calls.sent.length,0);
  f.owner.close();assert.equal(f.calls.close,1,'owner cleanup is idempotent');
 }finally{release.resolve();await f.cleanup();}
});

test('same verified DEV receive routes authored intent to distinct import receipt without preview journal execution',async()=>{const f=await fixture(true);try{
 await f.connect();const selection=await f.owner.describeSelected('selected');const request={schema:'hps-companion-authoring-intent/1',requestId:'intent',pairingId:f.pair.invitation.id,selection,text:'제목을 바꾸고 싶어요'};
 f.batch=[{message_id:request.requestId,message_hash:'c'.repeat(64),text:JSON.stringify(request)}];const turn=await f.owner.receiveAndHandle();assert.equal(turn.processed,1);assert.equal(f.native.store.getDraft().text,request.text);const reply=JSON.parse(f.calls.prepared.at(-1).text);assert.equal(reply.schema,'hps-companion-authoring-result/1');assert.equal(reply.outcome.state,'imported_draft');assert.equal(reply.outcome.executionAuthorized,false);assert.equal((await f.native.journal.load()).entries.length,0);assert.equal(f.calls.acks.at(-1),'intent');assert.equal(f.native.dialogs.length,1);
 f.batch=[{message_id:request.requestId,message_hash:'c'.repeat(64),text:JSON.stringify(request)}];await f.owner.receiveAndHandle();assert.equal(f.native.dialogs.length,1);
}finally{await f.cleanup();}});
test('unknown verified message closes the owner and is never acknowledged as handled',async()=>{const f=await fixture(true);try{
 await f.connect();f.batch=[{message_id:'unknown',message_hash:'c'.repeat(64),text:JSON.stringify({schema:'future-operation/1'})}];await assert.rejects(()=>f.owner.receiveAndHandle(),/closed/);assert.equal(f.owner.view().state,'closed');assert.equal(f.calls.acks.length,0);assert.equal(f.calls.prepared.length,0);
}finally{await f.cleanup();}});
