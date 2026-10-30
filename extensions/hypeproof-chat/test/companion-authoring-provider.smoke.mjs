import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createTaskHarness} from './task-workspace-harness.mjs';
import {CompanionAuthoringHost} from '../src/companionAuthoringHost.ts';
import {companionSelectionRequest} from '../src/companionHostBridge.ts';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'authoring-provider-'));let f,generation=1,ui={text:'',images:[],queued:null},onConfirm=()=>{},onApply=()=>{},applies=0;
 f=await createTaskHarness(root,message=>{
  if(message.type==='companionDraftCapture')void f.handle(f.scoped({type:'saveActivityDraft',nonce:message.nonce,draft:ui,uiGeneration:generation}));
  if(message.type==='companionDraftApply'){onApply();const applied=message.generation===generation&&!ui.text;if(applied){ui={...ui,text:message.text};generation++;applies++;}void f.handle(f.scoped({type:'saveActivityDraft',nonce:message.nonce,draft:ui,uiGeneration:generation,companionApplied:applied}));}
 });
 const snapshot={preparation:{version:1,scope:'scope',workspace:root,projectId:'project',activityId:'activity',hostId:'host',preparedAt:1},pair:{schema:'hps-companion-pairing-preview/2',id:'pair',status:'paired',account_id:'account',host_session_id:'session',device_session_id:'device_session',host_id:'host',device_id:'device',workspace_id:hash('hps-companion-workspace/1:scope'),project_id:'project',invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:10000,capability:'preview.read',execution_authorized:false},accountId:'account',accountSessionId:'session',binding:{sessionId:'session',passId:'pass'},profile:{profile_id:'profile',activity_id:'activity',activity_kind:'personal',sdk_tools:{read:true},minor_cohort:false,game:{template_tier:'website'},pass:{expires_at:10000}},taskId:f.store.getView().activeTaskId,version:f.store.getView().revision,epoch:1,consentRevision:1,folderReadAllowed:true,host:'online',artifact:{id:'artifact',version:'c'.repeat(64),path:join(root,'index.html'),label:'index.html'}};
 const request={schema:'hps-companion-authoring-intent/1',requestId:'intent',pairingId:'pair',selection:companionSelectionRequest(snapshot,'selection'),text:'reviewed phone request'};
 const receiver=new CompanionAuthoringHost({store:()=>f.store,snapshot:async()=>({...snapshot,version:f.store.getView().revision}),lifecycle:{capture:()=>1,isCurrent:()=>true},confirm:async()=>{onConfirm();return true;},reviewDraft:(id,isCurrent)=>f.h.reviewCompanionDraft(id,isCurrent),imported:async()=>{throw Error('reviewed UI path required');},now:()=>1000});
 const message={sender:'device',invitationId:'pair',invitationDigest:'a'.repeat(64),claimDigest:'b'.repeat(64),messageId:request.requestId,text:JSON.stringify(request)};
 return{f,receiver,message,request,get ui(){return ui;},get applies(){return applies;},type(text){ui={...ui,text};generation++;},set onConfirm(fn){onConfirm=fn;},set onApply(fn){onApply=fn;},cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('real provider nonce/source flush and generation CAS import once into current ordinary draft, without Send',async()=>{const f=await fixture();try{
 f.f.h.handleSend=()=>{throw Error('must never execute');};assert.equal((await f.receiver.handle(f.message)).state,'imported_draft');assert.equal(f.ui.text,f.request.text);assert.equal(f.f.store.getDraft().text,f.request.text);assert.equal(f.applies,1);assert.equal((await f.receiver.handle(f.message)).code,'already_imported');assert.equal(f.applies,1);
}finally{await f.cleanup();}});
test('unsaved UI before/during modal and edit-clear ABA cannot be overwritten',async()=>{for(const when of ['before','modal','aba','apply']){const f=await fixture();try{
 if(when==='before')f.type('unsaved desktop');if(when==='modal')f.onConfirm=()=>f.type('typed while reviewing');if(when==='aba')f.onConfirm=()=>{f.type('temporary');f.type('');};if(when==='apply')f.onApply=()=>f.type('late desktop');
 const result=await f.receiver.handle(f.message);assert.notEqual(result.state,'imported_draft');assert.equal(f.applies,0);assert.equal(f.ui.text,when==='before'?'unsaved desktop':when==='modal'?'typed while reviewing':when==='apply'?'late desktop':'');assert.equal(f.f.posts.some(m=>m.type==='sendMessage'),false);if(when==='apply')assert.equal((await f.receiver.handle(f.message)).state,'outcome_unknown','lost/rejected view ACK cannot become a confirmed import on duplicate');
}finally{await f.cleanup();}}});
