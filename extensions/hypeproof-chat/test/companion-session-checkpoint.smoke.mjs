import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CompanionMobileSessionController } from '../webview-ui/src/companionSessionController.ts';
import { CompanionLocalCheckpoint, COMPANION_CHECKPOINT_TTL_MS, COMPANION_CHECKPOINT_MAX_BYTES, parseCompanionSessionCheckpoint } from '../webview-ui/src/companionSessionCheckpoint.ts';
import { packCompanionPreviewPayload } from '../src/companionPreviewPayload.ts';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const tick=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
class Clock {timers=new Set();setTimeout(callback,ms){const h={callback,ms};this.timers.add(h);return h;}clearTimeout(h){this.timers.delete(h);}fire(ms){for(const h of [...this.timers])if(h.ms===ms){this.timers.delete(h);h.callback();}}}
const text='<html lang="ko"><pre>'+'a'.repeat(9000)+'</pre></html>';
const request={schema:'hps-companion-host-request/1',requestId:'restore-request',actorId:'actor',deviceId:'phone',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:'task',version:2,epoch:1,consentRevision:4,artifactId:'quiz',artifactVersion:createHash('sha256').update(text).digest('hex'),operation:'preview.read'};
const context={accountId:'account',sessionId:'session',deviceId:request.deviceId,pairingId:'ci_pair',cipherContext:'c'.repeat(64),workspaceId:request.workspaceId,artifactId:request.artifactId,artifactVersion:request.artifactVersion,epoch:request.epoch};
const outcome={state:'completed',code:'preview_read',requestId:request.requestId,artifact:{id:request.artifactId,version:request.artifactVersion,text}};
const envelope=JSON.stringify({schema:'hps-companion-host-result/1',requestId:request.requestId,outcome});
const parts=(await packCompanionPreviewPayload(envelope,request.requestId)).map((text,i)=>({message_id:'part_'+i,text}));
assert.equal(parts.length,8);
const checkpoint=()=>({schema:'hps-companion-local-checkpoint/1',createdAt:1000,expiresAt:1000+COMPANION_CHECKPOINT_TTL_MS,context:{...context},request:{...request},validated:[],pendingAcks:[],batch:[],cursor:0});
function fixture(initial=null){
 let raw=initial,now=1000;const calls={prepare:0,send:0,receive:0,ack:[]};const ledger=new Map();
 const storage={read:async()=>raw,replace:async value=>{raw=value;},remove:async()=>{raw=null;}};
 const descriptor=()=>({computerName:'내 컴퓨터',online:true,selection:{request,projectName:'내 작품',artifactName:'퀴즈'},checkpointContext:context});
 let delivered=false;
 const ports={descriptor:async()=>descriptor(),transport:{prepare:async()=>{calls.prepare++;},send:async()=>{calls.send++;},receive:async()=>{calls.receive++;if(delivered)return[];delivered=true;parts.forEach(m=>ledger.set(m.message_id,m.text));return parts;},acknowledge:async id=>{
   const persisted=JSON.parse(raw);assert.ok(persisted.pendingAcks.includes(id),'write before transport ACK');assert.equal(ledger.get(id),persisted.validated.find(m=>m.message_id===id)?.text);
   calls.ack.push(id);
 }}};
 const make=()=>{const clock=new Clock();const local=new CompanionLocalCheckpoint(storage,()=>now);const controller=new CompanionMobileSessionController(ports,{checkpoint:local,clock,timeoutMs:1000,pollMs:10});return{controller,clock,local};};
 const reattach=async saved=>saved.messages.every(m=>ledger.get(m.message_id)===m.text)?'same_live_transport_verified_bytes':'unavailable';
 return{calls,ports,storage,ledger,make,reattach,get raw(){return raw;},set raw(v){raw=v;},set now(v){now=v;}};
}

test('retained framing/1 checkpoint restores exact original raw bytes without a request resend',async()=>{
 const bytes=Buffer.from(envelope),count=Math.ceil(bytes.length/1024);
 const legacy=Array.from({length:count},(_,index)=>({message_id:'legacy_'+index,text:JSON.stringify({
  schema:'hps-companion-result-part/1',requestId:request.requestId,sha256:createHash('sha256').update(bytes).digest('hex'),
  length:bytes.length,count,index,data:bytes.subarray(index*1024,(index+1)*1024).toString('base64')})}));
 const saved=checkpoint();saved.validated=legacy;
 const f=fixture(JSON.stringify(saved));legacy.forEach(m=>f.ledger.set(m.message_id,m.text));const live=f.make();
 assert.equal(await live.controller.restore(f.reattach),'restored');
 assert.deepEqual(live.controller.getSnapshot().receipt.outcome,outcome);
 assert.equal(f.calls.prepare,0);assert.equal(f.calls.send,0);assert.equal(f.calls.receive,0);
 assert.deepEqual(JSON.parse(f.raw).validated,legacy,'checkpoint retains historical bytes, not re-encoded /2');
 await live.controller.forget();
});

test('remount restores partial ACK obligations and deduplicated suffix, one request, exact immutable receipt', {timeout:5000},async()=>{
 const f=fixture(),first=f.make(),pause=deferred(),entered=deferred();const ack=f.ports.transport.acknowledge;let hold=true;
 f.ports.transport.acknowledge=async id=>{if(hold&&id===parts[3].message_id){hold=false;entered.resolve();await pause.promise;}return ack(id);};
 assert.equal(await first.controller.restore(f.reattach),'empty');
 const pending=first.controller.requestPreview(request);await entered.promise;
 const saved=JSON.parse(f.raw);assert.equal(saved.cursor,4);assert.equal(saved.batch.length,8);assert.deepEqual(saved.pendingAcks,['part_3']);assert.equal(first.controller.getSnapshot().receipt,null);
 first.controller.dispose();await pending;const restored=f.make();let snapshots=0;restored.controller.subscribe(()=>{snapshots++;});
 assert.equal(snapshots,0);assert.equal(f.calls.prepare,1);assert.equal(f.calls.send,1);
 assert.equal(await restored.controller.restore(f.reattach),'restored');
 assert.deepEqual(restored.controller.getSnapshot().receipt.outcome,outcome);assert.equal(Object.isFrozen(restored.controller.getSnapshot().receipt.outcome.artifact),true);
 assert.equal(new Set(f.calls.ack).size,8);assert.equal(f.calls.receive,1);assert.equal(f.calls.prepare,1);assert.equal(f.calls.send,1);
 const receipt=restored.controller.getSnapshot().receipt.outcome;await restored.controller.reconnect(request);assert.equal(restored.controller.getSnapshot().receipt.outcome,receipt);
 // Disposing the previous page cannot revive its old ACK/save after the new owner forgets.
 pause.resolve();await tick();await restored.controller.forget();assert.equal(f.raw,null);assert.equal(restored.controller.getSnapshot().receipt,null);
});

test('saved bytes never prove provenance; key loss and changed current context hold without resend',async()=>{
 for(const mode of ['keys_lost','foreign_session','foreign_device','foreign_workspace','foreign_version','foreign_epoch','changed_bytes','lost_after_verification']){
   const saved=checkpoint();saved.validated=[parts[0]];saved.pendingAcks=['part_0'];saved.batch=parts;saved.cursor=1;
   const f=fixture(JSON.stringify(saved));parts.forEach(m=>f.ledger.set(m.message_id,m.text));
   if(mode==='changed_bytes'){const v=JSON.parse(f.raw);v.validated[0]={...v.validated[0],text:v.validated[0].text.replace('YWFh','YmJi')};v.batch[0]=v.validated[0];f.raw=JSON.stringify(v);}
   if(mode.startsWith('foreign_')){const key={foreign_session:'sessionId',foreign_device:'deviceId',foreign_workspace:'workspaceId',foreign_version:'artifactVersion',foreign_epoch:'epoch'}[mode];f.ports.descriptor=async()=>({computerName:'computer',online:true,selection:{request,projectName:'p',artifactName:'a'},checkpointContext:{...context,[key]:key==='epoch'?2:key==='artifactVersion'?'0'.repeat(64):'other'}});}
   let attestations=0;const attest=async saved=>{attestations++;return mode==='keys_lost'||(mode==='lost_after_verification'&&attestations>1)?'keys_lost':f.reattach(saved);};
   const live=f.make();await live.controller.requestPreview(request);assert.equal(f.calls.send,0,'checkpoint must be inspected before an explicit request can start');const status=await live.controller.restore(attest);
   assert.notEqual(status,'restored',mode);assert.equal(live.controller.getSnapshot().receipt,null);
   await live.controller.requestPreview(request);await live.controller.reconnect(request);
   assert.equal(f.calls.send,0);assert.equal(f.calls.receive,0);assert.deepEqual(f.calls.ack,[]);await live.controller.forget();
 }
});

test('completed receipt is rebuilt and hash-verified, not trusted from persisted metadata', {timeout:5000},async()=>{
 const f=fixture();const live=f.make();assert.equal(await live.controller.restore(f.reattach),'empty');await live.controller.requestPreview(request);live.controller.dispose();
 const original=f.raw;const remounted=f.make();assert.equal(await remounted.controller.restore(f.reattach),'restored');assert.deepEqual(remounted.controller.getSnapshot().receipt.outcome,outcome);assert.equal(f.calls.receive,1);assert.equal(f.calls.send,1);remounted.controller.dispose();
 // Even a misbehaving reattachment cannot bypass the existing semantic receiver.
 const tampered=JSON.parse(original);const packet=JSON.parse(tampered.validated.at(-1).text);packet.data='!invalid';tampered.validated.at(-1).text=JSON.stringify(packet);tampered.batch[tampered.cursor-1]=tampered.validated.at(-1);f.raw=JSON.stringify(tampered);
 const invalid=f.make();assert.notEqual(await invalid.controller.restore(async()=> 'same_live_transport_verified_bytes'),'restored');assert.equal(invalid.controller.getSnapshot().receipt,null);await invalid.controller.forget();
});

test('strict local TTL, size and closed schema prune invalid checkpoints; no keys/tokens/paths',async()=>{
 for(const change of [v=>{v.expiresAt=1000;},v=>{v.createdAt=1001;},v=>{v.keys={privateKey:'forbidden'};},v=>{v.context.token='forbidden';},v=>{v.request.path='/tmp/private';}]){
   const value=checkpoint();change(value);const f=fixture(JSON.stringify(value)),live=f.make();assert.equal(await live.controller.restore(f.reattach),'invalid');assert.equal(f.raw,null);assert.equal(f.calls.send,0);assert.equal(f.calls.receive,0);
 }
 assert.throws(()=>parseCompanionSessionCheckpoint(' '.repeat(COMPANION_CHECKPOINT_MAX_BYTES+1),1000),/invalid/);
});

test('awaited cancel orders erase after an in-flight save; late writer cannot resurrect forgotten data',async()=>{
 const f=fixture(),pause=deferred(),entered=deferred();const replace=f.storage.replace;
 f.storage.replace=async raw=>{entered.resolve();await pause.promise;await replace(raw);};
 const live=f.make();assert.equal(await live.controller.restore(f.reattach),'empty');const action=live.controller.requestPreview(request);await entered.promise;
 let forgotten=false;const forgottenPromise=live.controller.cancel().then(()=>{forgotten=true;});await action;await tick();assert.equal(forgotten,false);assert.equal(f.calls.prepare,0);
 pause.resolve();await forgottenPromise;assert.equal(forgotten,true);assert.equal(f.raw,null);assert.equal(f.calls.send,0);await assert.rejects(live.controller.reconnect(),/stopped/);
});

test('accepted-but-unconfirmed request restores as the same identity and never invokes prepare/send',async()=>{
 const saved=checkpoint();const status={message_id:'accepted',text:JSON.stringify({schema:'hps-companion-host-result/1',requestId:request.requestId,outcome:{state:'accepted',code:'accepted',requestId:request.requestId}})};
 saved.validated=[status];const f=fixture(JSON.stringify(saved));f.ledger.set(status.message_id,status.text);
 const wait=deferred();f.ports.transport.receive=()=>{f.calls.receive++;return wait.promise;};
 const restored=f.make();const pending=restored.controller.restore(f.reattach);
 while(f.calls.receive===0)await new Promise(setImmediate);
 restored.clock.fire(1000);assert.equal(await pending,'held');
 assert.deepEqual(restored.controller.getSnapshot().receipt.request,request);assert.equal(restored.controller.getSnapshot().receipt.outcome.state,'accepted');
 assert.equal(restored.controller.getSnapshot().waitingReason,'request_unconfirmed');assert.equal(f.calls.prepare,0);assert.equal(f.calls.send,0);
 wait.resolve([]);await restored.controller.forget();
});

test('shared local owner serializes remount erase after an older in-flight write',async()=>{
 const f=fixture(),pause=deferred(),entered=deferred(),replace=f.storage.replace;
 f.storage.replace=async raw=>{entered.resolve();await pause.promise;await replace(raw);};
 const old=f.make(),write=old.local.save(checkpoint());await entered.promise;
 const next=f.make();let erased=false;const forgetting=next.local.forget().then(()=>{erased=true;});await tick();assert.equal(erased,false);
 pause.resolve();await write;await forgetting;assert.equal(f.raw,null);await assert.rejects(old.local.save(checkpoint()),/forgotten/);
});


test('forget is idempotent and superseded owners cannot erase a newer checkpoint lifecycle',async()=>{
 const f=fixture(),old=f.make(),stale=f.make();
 const erased=old.local.forget();assert.equal(old.local.forget(),erased,'same in-flight erase promise');await erased;
 const next=f.make(),value=checkpoint();value.request.requestId='new-request';await next.local.save(value);const before=f.raw;
 assert.equal(old.local.forget(),erased,'same settled erase promise');await old.local.forget();assert.equal(f.raw,before,'repeated old forget preserves newer data');
 await stale.local.forget();assert.equal(f.raw,before,'first erase from a superseded owner also preserves newer data');
 assert.equal((await next.local.load()).request.requestId,'new-request');await next.local.forget();assert.equal(f.raw,null);
});

test('same owner can retry a failed erase and only reports success after storage removal settles',async()=>{
 const f=fixture(),live=f.make(),remove=f.storage.remove,pause=deferred();let removals=0;
 f.storage.remove=async()=>{removals++;if(removals===1)throw Error('transient_local_remove');await pause.promise;await remove();};
 await live.local.save(checkpoint());const before=f.raw;
 const failed=live.local.forget();assert.equal(live.local.forget(),failed);await assert.rejects(failed,/transient_local_remove/);
 assert.equal(f.raw,before,'failed erase never claims or fabricates removal');
 const retry=live.local.forget();assert.notEqual(retry,failed,'retry must schedule a new storage attempt');assert.equal(live.local.forget(),retry,'concurrent retry gestures share the attempt');
 let erased=false;const observed=retry.then(()=>{erased=true;});await tick();assert.equal(removals,2);assert.equal(erased,false);assert.equal(f.raw,before);
 pause.resolve();await observed;assert.equal(f.raw,null);assert.equal(erased,true);
 assert.equal(live.local.forget(),retry,'successful erase remains idempotent');await live.local.forget();assert.equal(removals,2);
});

test('successor loads after a failed erase and stale failed-owner retries cannot delete successor bytes',async()=>{
 const f=fixture(),old=f.make();let removals=0;
 f.storage.remove=async()=>{removals++;throw Error('transient_local_remove');};
 await old.local.save(checkpoint());await assert.rejects(old.local.forget(),/transient_local_remove/);
 const next=f.make();assert.equal((await next.local.load()).request.requestId,request.requestId,'failed predecessor erase cannot poison the shared ordering barrier');
 const newer=checkpoint();newer.request.requestId='successor-request';await next.local.save(newer);const before=f.raw;
 await assert.rejects(old.local.forget(),/superseded/);assert.equal(removals,1,'stale erase must not reach storage');assert.equal(f.raw,before);
 assert.equal((await next.local.load()).request.requestId,'successor-request');
});
