import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {verifyCompanionExecutionReservation} from '../src/companionExecutionAuthority.ts';
const hash=text=>createHash('sha256').update(text).digest('hex'),now=1793144000000;
function fixture(){
 const selection={schema:'hps-companion-host-request/1',requestId:'preview1',actorId:'account1',deviceId:'phone1',hostId:'host1',workspaceId:'workspace1',projectId:'project1',taskId:'task1',version:4,epoch:0,consentRevision:239367519982534,artifactId:'selected1',artifactVersion:hash('original HTML'),operation:'preview.read'};
 const packet=JSON.stringify({schema:'hps-companion-authoring-intent/1',requestId:'intent1',pairingId:'ci_'+'1'.repeat(32),selection,text:'  정답에 설명을 붙여 줘\n'});
 const expected={packet,selection,pairingId:'ci_'+'1'.repeat(32),accountId:'account1',hostSessionId:'desktopSession1',deviceSessionId:'phoneSession1',grantId:'ceg_'+'2'.repeat(32),grantDigest:hash('signed issue transcript'),turnId:'turn1',modelSessionId:'activatedSession1',modelTokenJti:'activatedJti1',modelProfileId:'adult.profile',expiresAt:now/1000+60,maxTurns:2,maxCallsPerTurn:12};
 const authority={schema:'hps-companion-execution-reservation/1',capability:'authoring.selected-html',grant_id:expected.grantId,grant_digest:expected.grantDigest,turn_id:'turn1',request_id:'intent1',request_hash:hash(packet),selection_hash:selection.artifactVersion,model_session_id:'activatedSession1',model_token_jti:'activatedJti1',model_profile_id:'adult.profile',account_id:'account1',host_session_id:'desktopSession1',device_session_id:'phoneSession1',pairing_id:expected.pairingId,host_id:'host1',device_id:'phone1',workspace_id:'workspace1',project_id:'project1',task_id:'task1',artifact_id:'selected1',epoch:0,consent_revision:239367519982534,expires_at:expected.expiresAt,max_turns:2,max_calls_per_turn:12};
 const grant={...authority,id:expected.grantId,selection_hash:selection.artifactVersion,current_selection_hash:selection.artifactVersion,created_at:now/1000-10,revoked_at:null};
 for(const key of ['schema','capability','grant_id','turn_id','request_id','request_hash','model_session_id','model_token_jti','model_profile_id'])delete grant[key];
 const turn={turn_id:'turn1',grant_id:expected.grantId,request_id:'intent1',request_hash:hash(packet),selection_hash:selection.artifactVersion,model_session_id:'activatedSession1',model_token_jti:'activatedJti1',model_profile_id:'adult.profile',ordinal:1,state:'reserved',result_hash:null,created_at:now/1000,finished_at:null};
 const response={schema:'hps-companion-selected-html-execution/1',capability:'authoring.selected-html',grant,turn,authority,authority_digest:hash(JSON.stringify(authority)),scope_authority:'authenticated_host_lease',dispatch_requires_live_validation:true};
 return{expected,response,verify:(r=response,e=expected,at=now)=>verifyCompanionExecutionReservation(JSON.stringify(r),e,at)};
}
test('exact native scope and original whitespace yield frozen normal-turn evidence, never a runner',()=>{
 const f=fixture(),got=f.verify();assert.equal(got.intent.text,'  정답에 설명을 붙여 줘\n');assert.equal(got.reservation.requestHash,hash(f.expected.packet));
 assert.equal(got.headers['x-hps-turn-id'],f.expected.turnId);assert.match(got.headers['x-hps-companion-execution'],/^[\x20-\x7e]+$/);
 assert.deepEqual(Object.keys(JSON.parse(got.headers['x-hps-companion-execution'])),['grant_id','request_id','request_hash','task_id','epoch','consent_revision','selection_hash']);
 assert.equal(got.expiresAtMs,f.expected.expiresAt*1000);assert(Object.isFrozen(got)&&Object.isFrozen(got.headers)&&Object.isFrozen(got.intent.selection));
 f.response.authority.task_id='late_mutation';f.expected.selection.taskId='another';assert.equal(got.intent.selection.taskId,'task1');
 const reordered=fixture();reordered.response.authority=Object.fromEntries(Object.entries(reordered.response.authority).reverse());assert.deepEqual(reordered.verify().reservation,got.reservation);
});
test('valid-looking server digests cannot substitute another scope, consent, request or turn',()=>{
 for(const key of ['grant_id','grant_digest','turn_id','request_id','request_hash','selection_hash','model_session_id','model_token_jti','model_profile_id','account_id','host_session_id','device_session_id','pairing_id','host_id','device_id','workspace_id','project_id','task_id','artifact_id','epoch','consent_revision','expires_at','max_turns','max_calls_per_turn']){
  const f=fixture(),v=f.response.authority[key];f.response.authority[key]=typeof v==='number'?v+1:v+'x';f.response.authority_digest=hash(JSON.stringify(f.response.authority));assert.throws(()=>f.verify(),/reservation_mismatch/,key);
 }
 const f=fixture(),packet=JSON.parse(f.expected.packet);packet.text=packet.text.trim();assert.throws(()=>f.verify(f.response,{...f.expected,packet:JSON.stringify(packet)}));
 assert.throws(()=>f.verify(f.response,{...f.expected,selection:{...f.expected.selection,version:5}}));
});
test('terminal, unknown, revoked and expired receipts cannot authorize another SDK dispatch',()=>{
 for(const state of ['completed','failed','unknown']){const f=fixture();f.response.turn.state=state;assert.throws(()=>f.verify());}
 for(const [where,key,value] of [['grant','revoked_at',now/1000],['grant','current_selection_hash',hash('successor')],['turn','result_hash',hash('result')],['turn','finished_at',now/1000],['turn','ordinal',3],['turn','grant_id','other'],['turn','model_token_jti','anotherPass']]){const f=fixture();f.response[where][key]=value;assert.throws(()=>f.verify());}
 const f=fixture();assert.throws(()=>f.verify(f.response,f.expected,f.expected.expiresAt*1000));
 // Identical reserved receipts only reproduce evidence; durable store.created, not this parser, controls one-shot admission.
 assert.deepEqual(f.verify(),f.verify());
});
test('the caller cannot silently increase limits or use a phone session as the desktop owner',()=>{
 for(const patch of [{maxTurns:3},{maxCallsPerTurn:13},{expiresAt:now/1000+601},{expiresAt:now+60000},{hostSessionId:'phoneSession1'},{turnId:'turn\r\nInjected: yes'}]){
  const f=fixture();assert.throws(()=>f.verify(f.response,{...f.expected,...patch}));
 }
 const f=fixture();f.response.grant.max_calls_per_turn=100;assert.throws(()=>f.verify());
});
test('untrusted response shape and byte bounds fail without echoing payload or accepting preview authority',()=>{
 for(const change of [r=>r.execution_authorized=true,r=>r.authority.extra=true,r=>r.turn.extra=true,r=>r.scope_authority='authenticated_declaration',r=>r.dispatch_requires_live_validation=false,r=>r.authority_digest='wrong',r=>r.schema='hps-companion-pairing-preview/2']){const f=fixture();change(f.response);assert.throws(()=>f.verify(),/^Error: companion_execution_reservation_mismatch$/);}
 const f=fixture();for(const raw of ['null','[]','{"secret":"never_echo_this"',' '.repeat(16385)])assert.throws(()=>verifyCompanionExecutionReservation(raw,f.expected,now),/^Error: companion_execution_reservation_mismatch$/);
});

test('native 48-bit consent is preserved while unsafe consent integers are refused',()=>{
 const f=fixture(),v=f.verify();assert.equal(v.sdkBinding.consent_revision,239367519982534);
 for(const consent of [-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  const f=fixture();f.expected.selection.consentRevision=consent;
  const packet=JSON.parse(f.expected.packet);packet.selection.consentRevision=consent;f.expected.packet=JSON.stringify(packet);
  assert.throws(()=>f.verify(),/reservation_mismatch/);
 }
});
