import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CompanionExecutionHost} from '../src/companionExecutionHost.ts';
import {companionSelectionRequest} from '../src/companionHostBridge.ts';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'companion-execution-owner-')),file=join(dir,'quiz.html');await writeFile(file,'<p>original</p>');
 let time=1793147000000,live=true,approval=true,issued=0,submitted=0,reserves=0,completions=0,scope,grant,mode='',confirmHook=async()=>{},submitHook=async()=>{};
 const model={model_session_id:'purchaseGrant',model_token_jti:'currentJti',model_profile_id:'adult.profile'};
 const pair={schema:'hps-companion-pairing-preview/2',id:'ci_'+'a'.repeat(32),status:'paired',account_id:'account',host_session_id:'hostSession',device_session_id:'phoneSession',host_id:'host',device_id:'phone',workspace_id:hash('hps-companion-workspace/1:scope'),project_id:'project',invitation_digest:'b'.repeat(64),claim_digest:'c'.repeat(64),grant_expires_at:time/1000+900,capability:'preview.read',execution_authorized:false};
 const snapshot={preparation:{version:1,scope:'scope',workspace:dir,projectId:'project',activityId:'activity',hostId:'host',preparedAt:1},pair,accountId:'account',accountSessionId:'hostSession',binding:{sessionId:'hostSession',passId:'paidPass'},profile:{profile_id:'adult.profile',activity_id:'activity',activity_kind:'personal',coach_runtime:'agent-sdk',sdk_tools:{read:true,write:true},minor_cohort:false,game:{template_tier:'website'},pass:{expires_at:time/1000+3600}},taskId:'task',version:1,epoch:0,consentRevision:239367519982534,folderReadAllowed:true,host:'online',artifact:{id:hash('hps-companion-artifact/1:'+file),version:hash('<p>original</p>'),path:file,label:'quiz.html'}};
 const turns=new Map();
 function envelope(turn){
  const authority=turn&&{schema:'hps-companion-execution-reservation/1',capability:'authoring.selected-html',grant_id:grant.id,grant_digest:grant.grant_digest,turn_id:turn.turn_id,request_id:turn.request_id,request_hash:turn.request_hash,selection_hash:turn.selection_hash,...model,account_id:pair.account_id,host_session_id:pair.host_session_id,device_session_id:pair.device_session_id,pairing_id:pair.id,host_id:pair.host_id,device_id:pair.device_id,workspace_id:pair.workspace_id,project_id:pair.project_id,task_id:scope.task_id,artifact_id:scope.artifact_id,epoch:scope.epoch,consent_revision:scope.consent_revision,expires_at:scope.expires_at,max_turns:scope.max_turns,max_calls_per_turn:scope.max_calls_per_turn};
  return structuredClone({schema:'hps-companion-selected-html-execution/1',capability:'authoring.selected-html',grant,...(turn?{turn,authority,authority_digest:hash(JSON.stringify(authority))}:{}),scope_authority:'authenticated_host_lease',dispatch_requires_live_validation:true});
 }
 const host=new CompanionExecutionHost({snapshot:async()=>structuredClone(snapshot),model:async()=>structuredClone(model),current:()=>live,now:()=>time,
  confirm:async()=>{await confirmHook();return approval;},client:(s,m,current)=>{scope=s;return{
   issue:async()=>{issued++;assert(current());if(mode==='issue-lost')throw Error('lost');grant={...s,id:s.grant_id,grant_digest:hash('signed-grant'),pairing_id:pair.id,account_id:pair.account_id,host_session_id:pair.host_session_id,device_session_id:pair.device_session_id,host_id:pair.host_id,device_id:pair.device_id,workspace_id:pair.workspace_id,project_id:pair.project_id,current_selection_hash:s.selection_hash,created_at:time/1000,revoked_at:null};delete grant.grant_id;return envelope();},
   reserve:async r=>{reserves++;assert(current());if(mode==='reserve-lost')throw Error('lost');let t=turns.get(r.turn_id);if(t)assert.deepEqual({...r},Object.fromEntries(Object.keys(r).map(k=>[k,t[k]])));else{assert.equal(r.selection_hash,grant.current_selection_hash);t={...r,grant_id:grant.id,...m,ordinal:turns.size+1,state:'reserved',result_hash:null,created_at:time/1000,finished_at:null};turns.set(r.turn_id,t);}return envelope(t);},
   complete:async(id,r)=>{completions++;if(mode==='complete-lost')throw Error('lost');const t=turns.get(id);Object.assign(t,{state:r.state,result_hash:r.result_hash,finished_at:time/1000});grant.current_selection_hash=r.result_hash;return envelope(t);},revoke:async()=>{throw Error('not used');}
  };},submit:async input=>{
   submitted++;await input.verifyReservation();await submitHook(input);if(mode==='submit-unknown')return{requestId:JSON.parse(input.packet).requestId,requestHash:hash(input.packet),state:'outcome_unknown',code:'lost'};
   input.executionPolicy.toolInput('Write',{file_path:file,content:'updated'},dir);
   const request=JSON.parse(input.packet),text='<p>version '+submitted+'</p>';await writeFile(file,text);snapshot.artifact.version=hash(text);snapshot.version++;
   const run={userMessageId:request.requestId,turnId:mode==='wrong-terminal'?'another-turn':input.reservation.turnId,runtime:'agent-sdk',restorePointId:input.reservation.turnId,submittedHash:hash(request.text),beforeArtifactVersion:request.selection.artifactVersion,afterArtifactVersion:hash(text),restoreDigest:hash('actual-test-restore'),state:'completed'};
   return{requestId:request.requestId,requestHash:hash(input.packet),state:'completed',code:'normal_turn_measured',run};
  }});
 const message=(id='request1')=>{const request={schema:'hps-companion-authoring-intent/1',requestId:id,pairingId:pair.id,text:'  Update this quiz.\n',selection:companionSelectionRequest(snapshot,'preview'+snapshot.version)};return{sender:'device',invitationId:pair.id,invitationDigest:pair.invitation_digest,claimDigest:pair.claim_digest,messageId:id,text:JSON.stringify(request)};};
 return{host,snapshot,model,message,file,turns,get issued(){return issued;},get submitted(){return submitted;},get reserves(){return reserves;},get completions(){return completions;},set mode(v){mode=v;},set approval(v){approval=v;},set confirmHook(v){confirmHook=v;},set submitHook(v){submitHook=v;},invalidate(){live=false;},expire(){time+=601000;},cleanup:()=>rm(dir,{recursive:true,force:true})};
}
test('pairing alone does not run; explicit native lease runs two exact versions once through prepared Send',async()=>{const f=await fixture();try{
 assert.equal((await f.host.handle(f.message())).state,'denied');assert.equal(f.issued,0);assert.equal(f.submitted,0);
 assert.equal(await f.host.authorize(),true);assert.equal(f.issued,1);const first=f.message();const result=await f.host.handle(first);assert.equal(result.state,'completed');assert.equal(result.artifactVersion,f.snapshot.artifact.version);assert.equal(f.host.view().remaining,1);
 assert.deepEqual(await f.host.handle(first),result);assert.equal(f.submitted,1);assert.equal(f.reserves,2);
 const second=f.message('request2');assert.equal((await f.host.handle(second)).state,'completed');assert.equal(f.submitted,2);assert.equal(f.turns.size,2);assert.equal((await f.host.handle(f.message('request3'))).state,'denied');
 assert.equal(f.completions,2);assert.equal(await readFile(f.file,'utf8'),'<p>version 2</p>');
}finally{await f.cleanup();}});
test('cancelled or changed confirmation cannot issue a lease',async()=>{for(const mode of['cancel','owner','selection','model']){const f=await fixture();try{
 if(mode==='cancel')f.approval=false;f.confirmHook=async()=>{if(mode==='owner')f.invalidate();if(mode==='selection')f.snapshot.artifact.version=hash('changed');if(mode==='model')f.model.model_token_jti='other';};
 assert.equal(await f.host.authorize(),false);assert.equal(f.issued,0);assert.equal(f.submitted,0);
}finally{await f.cleanup();}}});
test('lost issue/reservation/completion and unmeasured SDK outcomes stay unknown without new allocation',async()=>{for(const mode of['issue-lost','reserve-lost','complete-lost','submit-unknown','wrong-terminal']){const f=await fixture();try{
 f.mode=mode;const authorized=await f.host.authorize();if(mode==='issue-lost')assert.equal(authorized,false);else{assert.equal(authorized,true);const msg=f.message();assert.equal((await f.host.handle(msg)).state,'outcome_unknown');const n=f.reserves;assert.equal((await f.host.handle(msg)).state,'outcome_unknown');assert.equal(f.reserves,n);}
 assert.equal(f.host.view().state,'unknown');assert.equal(await f.host.authorize(),false);assert.equal((await f.host.handle(f.message('different'))).state,'denied');
 if(mode==='wrong-terminal')assert.equal(f.completions,0,'wrong turn proof must never complete the Service reservation');
}finally{await f.cleanup();}}});
test('foreign device, stale selected bytes and changed pass cannot reserve or execute',async()=>{for(const mode of['sender','selection','model','expiry','closed']){const f=await fixture();try{
 assert.equal(await f.host.authorize(),true);const msg=f.message();if(mode==='sender')msg.claimDigest=hash('different');if(mode==='selection')f.snapshot.artifact.version=hash('changed');if(mode==='model')f.model.model_token_jti='different';if(mode==='expiry')f.expire();if(mode==='closed')f.host.close();
 assert.equal((await f.host.handle(msg)).state,'denied');assert.equal(f.reserves,0);assert.equal(f.submitted,0);
}finally{await f.cleanup();}}});
test('concurrent receive is refused and local close aborts the captured SDK policy',async()=>{const f=await fixture();let release,entered;const waiting=new Promise(r=>entered=r),pause=new Promise(r=>release=r);try{
 assert.equal(await f.host.authorize(),true);f.submitHook=async input=>{entered();await pause;assert.equal(input.signal.aborted,true);};const pending=f.host.handle(f.message());await waiting;
 assert.equal((await f.host.handle(f.message('another'))).state,'denied');f.host.close();release();assert.equal((await pending).state,'outcome_unknown');assert.equal(f.completions,0);assert.equal(await readFile(f.file,'utf8'),'<p>original</p>');
}finally{release?.();await f.cleanup();}});
