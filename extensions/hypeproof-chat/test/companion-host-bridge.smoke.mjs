import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CompanionHostBridge } from '../src/companionHostBridge.ts';
const hash = s => createHash('sha256').update(s).digest('hex');
async function fixture(text='<html><button>합성 퀴즈</button></html>') {
 const root=await mkdtemp(join(tmpdir(),'hps-companion-bridge-')),file=join(root,'quiz.html');
 await writeFile(file,text);const scope=JSON.stringify(['activity',root]);
 let snapshot={preparation:{version:1,scope,workspace:root,projectId:hash(scope),activityId:'activity',hostId:'host',preparedAt:1},
  pair:{schema:'hps-companion-pairing-preview/2',id:'ci_synthetic',status:'paired',account_id:'account',host_session_id:'host-session',device_session_id:'phone-session',host_id:'host',device_id:'phone',workspace_id:hash('hps-companion-workspace/1:'+scope),project_id:hash(scope),invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:10000,capability:'preview.read',execution_authorized:false},
  accountId:'account',accountSessionId:'host-session',binding:{sessionId:'host-session',passId:'pass'},
  profile:{profile_id:'actual-profile',activity_id:'server-activity',activity_kind:'trial',sdk_tools:{read:true},minor_cohort:false,game:{template_tier:'website'},pass:{expires_at:10000}},
  taskId:'task',version:1,epoch:1,consentRevision:1,folderReadAllowed:true,host:'online',artifact:{id:'quiz',version:hash(text),path:file,label:'quiz.html'}};
 let saved=null,confirms=0,approve=true,now=1000,onConfirm=async()=>{},onSave=async()=>{};
 const journal={async load(){return saved?structuredClone(saved):null;},async save(s){await writeFile(join(root,'journal.json'),JSON.stringify(s));saved=structuredClone(s);await onSave(s);}};
 const make=()=>new CompanionHostBridge({snapshot:async()=>snapshot&&structuredClone(snapshot),confirm:async p=>{confirms++;assert.equal(p.artifactVersion,hash(text));await onConfirm();return approve;},journal,now:()=>now});
 const bridge=make();await bridge.recover();
 const request={schema:'hps-companion-host-request/1',requestId:'request',actorId:'account',deviceId:'phone',hostId:'host',workspaceId:snapshot.pair.workspace_id,projectId:hash(scope),taskId:'task',version:1,epoch:1,consentRevision:1,artifactId:'quiz',artifactVersion:hash(text),operation:'preview.read'};
 const message=()=>({sender:'device',invitationId:snapshot.pair.id,invitationDigest:snapshot.pair.invitation_digest,claimDigest:snapshot.pair.claim_digest,messageId:request.requestId,text:JSON.stringify(request)});
 return {root,file,text,bridge,make,journal,request,message,get snapshot(){return snapshot;},set snapshot(s){snapshot=s;},get confirms(){return confirms;},set approve(v){approve=v;},set now(v){now=v;},set onConfirm(v){onConfirm=v;},set onSave(v){onSave=v;},cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('JSON expansion beyond the packet limit gives host and mobile the same result', async () => {
 const text='<html>'+String.fromCharCode(34).repeat(1100)+'</html>';
 const f=await fixture(text);try{
  assert.ok(Buffer.byteLength(text)<1400);
  let packet;
  const relay={async prepare(raw){packet=JSON.parse(raw);assert.ok(Buffer.byteLength(raw)<=2032);return 'encrypted';},async send(){},close(){}};
  const result=await f.bridge.handleAndReply(f.message(),relay);
  assert.equal(result.code,'result_too_large');
  assert.deepEqual(packet.outcome,result);
  assert.equal(result.artifact,undefined);
  assert.equal(await readFile(f.file,'utf8'),text);
 }finally{await f.cleanup();}
});

test('actual dispatcher requires native consent and current independent profile, then preserves exact result/retry',async()=>{
 const f=await fixture();try{
  f.approve=false;assert.equal((await f.bridge.handle(f.message())).code,'host_consent_required');assert.equal((await f.journal.load()).entries.length,0);
  f.approve=true;const answer=await f.bridge.handle(f.message());assert.equal(answer.state,'completed');assert.equal(answer.artifact.text,f.text);
  await writeFile(f.file,'later saved version');assert.deepEqual(await f.bridge.handle(f.message()),answer);assert.equal(f.confirms,2,'one denied prompt plus one approved prompt; exact retry does not prompt or read again');
  const restart=f.make();await restart.recover();assert.deepEqual(await restart.handle(f.message()),answer);assert.equal(f.confirms,3,'restart loses consent and requires explicit reapproval before cached result release');
 }finally{await f.cleanup();}
});

test('pairing-only, foreign session/account/scope, ungranted/minor profile and stale requests cannot reach confirmation or journal',async()=>{
 const f=await fixture();try{
  const original=structuredClone(f.snapshot);
  for(const mutate of [s=>{s.profile.sdk_tools.read=false;},s=>{s.profile.minor_cohort=true;},s=>{delete s.profile.game;},s=>{delete s.profile.pass;},s=>{s.profile.pass.expires_at=0;},s=>{s.binding.sessionId='other';},s=>{s.accountId='other';},s=>{s.pair.host_id='other';},s=>{s.pair.execution_authorized=true;},s=>{s.folderReadAllowed=false;},s=>{s.pair.grant_expires_at=0;}]){
   f.snapshot=structuredClone(original);mutate(f.snapshot);assert.equal((await f.bridge.handle(f.message())).state,'denied');
  }
  f.snapshot=original;
  for(const change of [{actorId:'other'},{deviceId:'other'},{version:2},{epoch:2},{consentRevision:2},{file_path:'/etc/passwd'},{operation:'Write'}]){
   const m=f.message();m.text=JSON.stringify({...f.request,...change});assert.equal((await f.bridge.handle(m)).state,'denied');
  }
  assert.equal(f.confirms,0);assert.equal((await f.journal.load()).entries.length,0);assert.equal(await readFile(f.file,'utf8'),f.text);
 }finally{await f.cleanup();}
});

test('scope/profile/consent changes during native confirmation or durable running prevent content release',async()=>{
 const f=await fixture();try{
  f.onConfirm=async()=>{f.snapshot.consentRevision++;};assert.equal((await f.bridge.handle(f.message())).code,'consent_scope_changed');assert.equal((await f.journal.load()).entries.length,0);
  f.request.consentRevision=f.snapshot.consentRevision;f.onConfirm=async()=>{};f.onSave=async s=>{if(s.entries.at(-1)?.state==='running')f.snapshot.profile.sdk_tools.read=false;};
  const answer=await f.bridge.handle(f.message());assert.equal(answer.state,'denied');assert.equal(answer.artifact,undefined);assert.equal((await f.journal.load()).entries[0].output,undefined);
 }finally{await f.cleanup();}
});

test('relay reply seam prepares encrypted data, rechecks freshness before send, and never exposes paths',async()=>{
 const f=await fixture();try{
  const prepared=[],sent=[];
  const relay={async prepare(text,id){prepared.push({text,id});return 'synthetic-encrypted-by-injected-client';},async send(id){sent.push(id);},close(){}};
  await f.bridge.handleAndReply(f.message(),relay);const packet=JSON.parse(prepared[0].text);
  assert.equal(packet.schema,'hps-companion-host-result/1');assert.equal(packet.outcome.artifact.text,f.text);assert.equal(prepared[0].text.includes(f.root),false);assert.equal(sent[0],hash('hps-companion-host-result/1:request:'+hash(prepared[0].text)));
  let closed=false;const stale={async prepare(){f.snapshot.epoch++;return 'encrypted';},async send(){if(closed)throw Error('closed');assert.fail('stale policy must not send ciphertext');},close(){closed=true;}};
  const blocked=await f.bridge.handleAndReply(f.message(),stale);
  assert.equal(blocked.code,'authority_changed');
  assert.equal(closed,true);await assert.rejects(()=>stale.send('cached-packet'),/closed/);
 }finally{await f.cleanup();}
});

test('a pass expiring during host confirmation cannot be rescued by a still-live pairing',async()=>{
 const f=await fixture();try{
  f.snapshot.pair.grant_expires_at=30000;f.snapshot.profile.pass.expires_at=10;
  f.onConfirm=async()=>{f.now=11000;};
  assert.equal((await f.bridge.handle(f.message())).code,'consent_scope_changed');assert.equal(f.confirms,1);assert.equal((await f.journal.load()).entries.length,0);
 }finally{await f.cleanup();}
});

test('full reply queue blocks a second request during encryption; revocation closes cached ciphertext before any send',async()=>{
 const f=await fixture();try{
  let signalPrepare,releasePrepare,closed=false,sends=0;
  const entered=new Promise(r=>{signalPrepare=r;}),pause=new Promise(r=>{releasePrepare=r;});
  const relay={async prepare(){if(closed)throw Error('closed');signalPrepare();await pause;return 'cached ciphertext';},async send(){if(closed)throw Error('closed');sends++;},close(){closed=true;}};
  const first=f.bridge.handleAndReply(f.message(),relay);await entered;assert.equal(f.confirms,1);
  f.request.requestId='second';const second=f.bridge.handleAndReply(f.message(),relay);await Promise.resolve();assert.equal(f.confirms,1,'second request cannot replace consent while first encryption awaits');
  f.snapshot.profile.sdk_tools.read=false;releasePrepare();
  assert.equal((await first).code,'authority_changed');assert.equal((await second).code,'relay_unavailable');assert.equal(closed,true);assert.equal(sends,0);assert.equal(f.confirms,1);
  await assert.rejects(()=>relay.send('saved ciphertext'),/closed/);
 }finally{await f.cleanup();}
});

test('browser-safe result consumer binds request and artifact version and refuses extra output on noncompleted receipts',async()=>{
 const {verifyCompanionPreviewResult}=await import('../src/companionPreviewResult.ts');const f=await fixture();try{
  const outcome=await f.bridge.handle(f.message()),packet={schema:'hps-companion-host-result/1',requestId:f.request.requestId,outcome};
  assert.deepEqual(await verifyCompanionPreviewResult(JSON.stringify(packet),f.request),outcome);
  for(const mutate of [p=>{p.requestId='other';},p=>{p.outcome.artifact.text='changed';},p=>{p.outcome.artifact.path='/private';},p=>{p.outcome.state='desktop_handoff';}]){
   const bad=structuredClone(packet);mutate(bad);await assert.rejects(()=>verifyCompanionPreviewResult(JSON.stringify(bad),f.request));
  }
 }finally{await f.cleanup();}
});
