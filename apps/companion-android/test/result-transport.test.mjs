import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompanionAndroidResultTransport} from '../web/resultTransport.ts';
import {CompanionSelectionReceiver,createCompanionSelection} from '../../../extensions/hypeproof-chat/src/companionSelection.ts';
import {CompanionClientAdapter} from '../../../extensions/hypeproof-chat/src/companionClientAdapter.ts';
import {CompanionTransportBudget} from '../../../extensions/hypeproof-chat/src/companionTransportBudget.ts';
import {CompanionMobileSessionController} from '../../../extensions/hypeproof-chat/webview-ui/src/companionSessionController.ts';
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const pair={id:'ci_'+'a'.repeat(32),status:'paired',account_id:'account',host_id:'host',device_id:'phone',workspace_id:'workspace',project_id:'project',invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:Math.floor(Date.now()/1000)+900,capability:'preview.read'};
const html='<button>원래 선택한 결과</button>';
const request={schema:'hps-companion-host-request/1',requestId:'original',actorId:'account',deviceId:'phone',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:'task',version:1,epoch:1,consentRevision:1,artifactId:'quiz',artifactVersion:await hash(html),operation:'preview.read'};
async function metadata(r,revision){const value=await createCompanionSelection(r,pair,revision);return{message_id:value.messageId,message_hash:await hash(value.text),text:value.text};}
const initial=await metadata(request,1),later=await metadata({...request,requestId:'later'},2),stale=await metadata({...request,requestId:'old'},1);
const text=JSON.stringify({schema:'hps-companion-host-result/1',requestId:request.requestId,outcome:{state:'completed',code:'preview_read',requestId:request.requestId,artifact:{id:'quiz',version:request.artifactVersion,text:html}}});
const result={message_id:'result',message_hash:await hash(text),text};
async function fixture(messages,options={}){
 const receiver=new CompanionSelectionReceiver({pair});await receiver.accept(initial);
 const requests=[],notices=[];let invalid=0,receives=0,prepared=0,sent=0,now=0,failed=false;
 const budget=new CompanionTransportBudget({minSpacingMs:1200,now:()=>now,sleep:async ms=>{now+=ms;}});
 const pairing={role:'device',sessionId:'device-session',invitation:{...pair},transport:async(_role,_id,action)=>{requests.push({action,time:now});return{};},async refresh(){await this.transport('device',pair.id,'status',{});return this.invitation;}};
 const relay={role:'device',pairing,row:{...pair},transport:async(_role,_id,action,raw)=>{requests.push({action,raw,time:now});if(options.failAck&&action==='ack'&&!failed){failed=true;throw Error(typeof options.failAck==='string'?options.failAck:'fixture_lost_ack_response');}return{};},async prepare(){prepared++;return'prepared';},async send(){sent++;},async receive(){receives++;await this.transport('device',pair.id,'receive','{}');if(options.receiveGate)await options.receiveGate.promise;return receives===1?messages:[];},async acknowledge(id){await pairing.refresh();return this.transport('device',pair.id,'ack',JSON.stringify({message_id:id}));},close(){}};
 let selection=receiver;
 if(options.acceptGate)selection={async accept(message){options.entered.resolve();await options.acceptGate.promise;return receiver.accept(message);},close:()=>receiver.close()};
 const demux=new CompanionAndroidResultTransport({relay,selection,initialRevision:1,onHeld:v=>notices.push(v),validateAuthoringResult:options.validateAuthoringResult,onAuthoringResult:options.onAuthoringResult,onInvalid:()=>{invalid++;controller.dispose();adapter.dispose();}});
 const adapter=new CompanionClientAdapter({pairing,relay,requestId:request.requestId,budget});
 const transport=demux.bind(adapter),controller=new CompanionMobileSessionController({transport,descriptor:async signal=>{await adapter.refresh(signal);return{computerName:'fixture computer',online:true,selection:{request,projectName:'original',artifactName:'original'}};}},{timeoutMs:5000,pollMs:1});
 return{demux,adapter,controller,transport,receiver,notices,requests,get invalid(){return invalid;},get receives(){return receives;},get prepared(){return prepared;},get sent(){return sent;},close(){demux.close();controller.dispose();adapter.dispose();budget.dispose();}};
}
test('authoring receipt is separately validated and ACKed without poisoning preview results',async()=>{
 const text=JSON.stringify({schema:'hps-companion-authoring-result/1',requestId:'intent-one',requestHash:'e'.repeat(64),outcome:{state:'imported_draft',code:'desktop_draft_imported',requestId:'intent-one',executionAuthorized:false}});
 const receipt={message_id:'authoring-result',message_hash:await hash(text),text};let seen=0;
 const f=await fixture([receipt,result],{validateAuthoringResult:value=>value.text===text,onAuthoringResult:value=>{assert.equal(value.text,text);seen++;}});
 try{await f.controller.reconnect(null);await f.controller.requestPreview(request);assert.equal(seen,1);assert.equal(f.invalid,0);assert.equal(f.controller.getSnapshot().receipt.outcome.artifact.text,html);assert.equal(f.requests.filter(r=>r.action==='ack'&&JSON.parse(r.raw).message_id===receipt.message_id).length,1);}
 finally{f.close();}
 const wrong=await fixture([receipt,result],{validateAuthoringResult:()=>false});try{await wrong.controller.reconnect(null);await wrong.controller.requestPreview(request);assert.equal(wrong.invalid,1);assert.equal(wrong.controller.getSnapshot().receipt,null);assert.equal(wrong.requests.filter(r=>r.action==='ack').length,0);}finally{wrong.close();}
});
test('failed metadata ACK retains authenticated provenance and original result for explicit reconciliation',async()=>{
 const f=await fixture([later,stale,result],{failAck:true});try{
  await f.controller.reconnect(null);await f.controller.requestPreview(request);
  assert.equal(f.controller.getSnapshot().receipt,null);assert.equal(f.controller.getSnapshot().waitingReason,'request_unconfirmed');
  assert.deepEqual(f.demux.progress,{heldSelections:1,capturedMetadata:2},'only metadata, not result bytes, gets an extra provenance entry');
  await f.controller.reconnect(request);
  assert.equal(f.controller.getSnapshot().receipt.outcome.artifact.text,html);assert.equal(f.prepared,1);assert.equal(f.sent,1);assert.equal(f.receives,1,'deduplicated receive is not needed again after failed metadata ACK');
  assert.equal(f.notices.length,1);assert.equal(f.notices[0].requestId,'later');assert.equal(f.controller.getSnapshot().selection.request.requestId,'original');
  const acks=f.requests.filter(r=>r.action==='ack');assert.equal(acks.filter(r=>JSON.parse(r.raw).message_id===later.message_id).length,2);assert.equal(acks.filter(r=>JSON.parse(r.raw).message_id===stale.message_id).length,1);
  assert.ok(f.requests.every((r,i,a)=>i===0||r.time-a[i-1].time>=1200),'every actual adapter HTTP, including metadata ACK retry, uses its existing budget');
  assert.deepEqual(f.demux.progress,{heldSelections:1,capturedMetadata:0});assert.equal(f.invalid,0);
 }finally{f.close();assert.deepEqual(f.demux.progress,{heldSelections:0,capturedMetadata:0});}
});
test('authoring ACK failure retains manual reconciliation; expired ACK closes without publishing completion',async()=>{
 const text=JSON.stringify({schema:'hps-companion-authoring-result/1',requestId:'intent-one',requestHash:'e'.repeat(64),outcome:{state:'imported_draft',code:'desktop_draft_imported',executionAuthorized:false}});
 const receipt={message_id:'authoring-result',message_hash:await hash(text),text};let published=0;
 const f=await fixture([receipt],{failAck:true,validateAuthoringResult:m=>m.text===text,onAuthoringResult:()=>published++});
 try{await assert.rejects(f.transport.receive(new AbortController().signal),/fixture_lost_ack_response/);assert.equal(published,0);assert.equal(f.invalid,0);
  assert.deepEqual(await f.transport.receive(new AbortController().signal),[]);assert.equal(published,1);assert.equal(f.receives,1);assert.equal(f.sent,0);
 }finally{f.close();}
 const expired=await fixture([receipt],{failAck:'relay_message_expired',validateAuthoringResult:m=>m.text===text,onAuthoringResult:()=>published++});
 try{await assert.rejects(expired.transport.receive(new AbortController().signal),/android_selection_invalid/);assert.equal(expired.invalid,1);assert.equal(published,1);assert.equal(expired.sent,0);await assert.rejects(expired.transport.receive(new AbortController().signal),/closed/);}
 finally{expired.close();}
});
test('invalid authenticated metadata closes fail-closed before ACK or original-result rendering',async()=>{
 const body=JSON.parse(later.text);body.request.workspaceId='foreign';const raw=JSON.stringify(body),bad={message_id:'selection_'+await hash(raw),message_hash:await hash(raw),text:raw};
 const f=await fixture([bad,result]);try{
  await f.controller.reconnect(null);await f.controller.requestPreview(request);
  assert.equal(f.invalid,1);assert.equal(f.controller.getSnapshot().receipt,null);assert.equal(f.requests.filter(r=>r.action==='ack').length,0);assert.equal(f.sent,1);assert.deepEqual(f.demux.progress,{heldSelections:0,capturedMetadata:0});
  await assert.rejects(f.transport.receive(new AbortController().signal),/closed/);
 }finally{f.close();}
});
test('expired metadata ACK terminates truthfully instead of creating an unrecoverable retry loop',async()=>{
 const f=await fixture([later,result],{failAck:'relay_message_expired'});try{
  await f.controller.reconnect(null);await f.controller.requestPreview(request);
  assert.equal(f.invalid,1);assert.equal(f.controller.getSnapshot().receipt,null);assert.equal(f.sent,1);assert.deepEqual(f.demux.progress,{heldSelections:0,capturedMetadata:0});
  await assert.rejects(f.transport.receive(new AbortController().signal),/closed/);
 }finally{f.close();}
});
test('owner close during asynchronous metadata validation cannot publish a late selection or ACK',async()=>{
 const entered=deferred(),gate=deferred(),f=await fixture([later,result],{entered,acceptGate:gate});
 const signal=new AbortController();try{
  const receiving=f.transport.receive(signal.signal),denied=assert.rejects(receiving,/closed/);await entered.promise;f.close();gate.resolve();await denied;
  assert.equal(f.notices.length,0);assert.equal(f.requests.filter(r=>r.action==='ack').length,0);assert.equal(f.invalid,0);assert.deepEqual(f.demux.progress,{heldSelections:0,capturedMetadata:0});
 }finally{gate.resolve();f.close();}
});
test('caller cancellation during validation retains bytes for retry without a late notice or ACK',async()=>{
 const entered=deferred(),gate=deferred(),f=await fixture([later,result],{entered,acceptGate:gate});
 const first=new AbortController();try{
  const receiving=f.transport.receive(first.signal),denied=assert.rejects(receiving,/closed/);await entered.promise;first.abort();gate.resolve();await denied;
  assert.equal(f.notices.length,0);assert.equal(f.requests.filter(r=>r.action==='ack').length,0);
  const messages=await f.transport.receive(new AbortController().signal);assert.deepEqual(messages,[{message_id:result.message_id,text:result.text}]);assert.equal(f.notices.length,1);assert.equal(f.receives,1);assert.equal(f.invalid,0);
 }finally{gate.resolve();f.close();}
});
test('new selection cannot be adopted before its own successful metadata ACK',async()=>{
 const f=await fixture([later,result],{failAck:true});let adopted=0;try{
  await f.controller.reconnect(null);await f.controller.requestPreview(request);assert.equal(f.demux.heldSelection,null);
  await assert.rejects(f.demux.adoptHeld({revision:2,requestId:'later'},request,new AbortController().signal,async()=>{adopted++;}),/not_ready/);
  assert.equal(adopted,0);await f.controller.reconnect(request);assert.equal(f.demux.heldSelection.request.requestId,'later');assert.equal(f.sent,1);
 }finally{f.close();}
});
test('explicit adoption locks concurrent receives and duplicate adoption; close prevents late publication',async()=>{
 const f=await fixture([later,result]),gate=deferred(),entered=deferred(),signal=new AbortController().signal;try{
  await f.controller.reconnect(null);await f.controller.requestPreview(request);assert.equal(f.demux.heldSelection.revision,2);
  const adopting=f.demux.adoptHeld({revision:2,requestId:'later'},request,signal,async next=>{assert.equal(next.requestId,'later');entered.resolve();await gate.promise;});
  const denied=assert.rejects(adopting,/closed/);await entered.promise;
  await assert.rejects(f.transport.receive(signal),/busy/);await assert.rejects(f.demux.adoptHeld({revision:2,requestId:'later'},request,signal,async()=>{}),/not_ready/);
  f.close();gate.resolve();await denied;assert.equal(f.demux.heldSelection,null);assert.equal(f.sent,1);
 }finally{gate.resolve();f.close();}
});
