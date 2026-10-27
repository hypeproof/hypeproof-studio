import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCompanionSelection,CompanionSelectionReceiver} from '../src/companionSelection.ts';
const pair={id:'ci_'+'a'.repeat(32),status:'paired',account_id:'account',host_id:'host',device_id:'device',workspace_id:'workspace',project_id:'project',invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:Math.floor(Date.now()/1000)+900,capability:'preview.read'};
const request={schema:'hps-companion-host-request/1',requestId:'selection-request',actorId:'account',deviceId:'device',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:'task',version:1,epoch:2,consentRevision:3,artifactId:'artifact',artifactVersion:'c'.repeat(64),operation:'preview.read'};
const wire=text=>({message_id:'selection_'+createHash('sha256').update(text).digest('hex'),message_hash:'d'.repeat(64),text});
const message=async(revision=1,value=request)=>wire((await createCompanionSelection(value,pair,revision)).text);
test('first authenticated declaration pins exact request metadata; duplicates/older revision never replace current',async()=>{
 const receiver=new CompanionSelectionReceiver({pair}),one=await message();
 const first=await receiver.accept(one);assert.equal(first.kind,'selection');assert.deepEqual(first.request,request);assert.ok(Object.isFrozen(first.request));
 assert.equal((await receiver.accept(one)).kind,'duplicate');
 const changed={...request,requestId:'another-request',version:2};const second=await message(2,changed);
 assert.deepEqual((await receiver.accept(second)).request,changed);
 assert.deepEqual(await receiver.accept(one),{kind:'stale',messageId:one.message_id,revision:1});
 await assert.rejects(receiver.accept(await message(2,{...changed,epoch:3})));
 assert.equal((await receiver.accept(second)).kind,'duplicate');
 assert.equal(one.message_id.length,74);assert.ok(Buffer.byteLength(one.text)<=2032);
});
test('foreign paired scope, unknown keys, execution claims, wrong digest/ID and request caps fail closed',async()=>{
 const original=JSON.parse((await message()).text);
 for(const change of [v=>v.pairingId='ci_other',v=>v.invitationDigest='e'.repeat(64),v=>v.claimDigest='e'.repeat(64),
  v=>v.execution_authorized=true,v=>v.path='/private/work',v=>v.request.html='<html>secret</html>',
  v=>v.request.actorId='other',v=>v.request.deviceId='other',v=>v.request.hostId='other',v=>v.request.workspaceId='other',v=>v.request.projectId='other',
  v=>v.request.requestId='a'.repeat(97),v=>v.request.operation='desktop.continue',v=>v.request.version=-1,v=>v.request.epoch=1.5,
  v=>v.request.artifactVersion='invalid',v=>v.revision=65]){
   const altered=structuredClone(original);change(altered);await assert.rejects(new CompanionSelectionReceiver({pair}).accept(wire(JSON.stringify(altered))));
 }
 const good=await message();await assert.rejects(new CompanionSelectionReceiver({pair}).accept({...good,message_id:'selection_'+'e'.repeat(64)}));
 await assert.rejects(new CompanionSelectionReceiver({pair}).accept({...good,message_hash:'bad'}));
 await assert.rejects(new CompanionSelectionReceiver({pair}).accept({...good,text:' '.repeat(2033)}));
 await assert.rejects(new CompanionSelectionReceiver({pair}).accept({...good,text:'private-invalid-json'}),e=>e.message==='companion_selection_invalid');
 await assert.rejects(createCompanionSelection({...request,requestId:'a'.repeat(97)},pair,1));
 assert.throws(()=>new CompanionSelectionReceiver({pair:{...pair,grant_expires_at:0}}));
});
test('known task/version scope narrows declaration, and result messages are not selection/ACK candidates',async()=>{
 const receiver=new CompanionSelectionReceiver({pair,knownScope:{taskId:request.taskId,version:request.version,epoch:request.epoch,consentRevision:request.consentRevision}});
 assert.equal((await receiver.accept(await message())).kind,'selection');
 await assert.rejects(receiver.accept(await message(2,{...request,version:2})));
 const result=JSON.stringify({schema:'hps-companion-host-result/1',requestId:request.requestId,outcome:{state:'denied',code:'host_consent_required'}});
 assert.equal(await receiver.accept({message_id:'result',message_hash:'d'.repeat(64),text:result}),null);
 receiver.close();await assert.rejects(receiver.accept(await message()),/closed/);
});
test('queued accepts are bounded and closing cancels late selection exposure',async()=>{
 const receiver=new CompanionSelectionReceiver({pair}),one=await message();
 const pending=Array.from({length:8},()=>receiver.accept(one));const overflow=receiver.accept(one);receiver.close();
 const all=await Promise.allSettled([...pending,overflow]);assert.ok(all.every(v=>v.status==='rejected'));
});
