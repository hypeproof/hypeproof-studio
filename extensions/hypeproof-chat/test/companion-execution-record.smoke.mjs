import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {TaskWorkspaceStore} from '../src/taskWorkspaceStore.ts';
import {validCompanionDesktopHandoffRecord} from '../src/companionDesktopHandoff.ts';
const hash=s=>createHash('sha256').update(s).digest('hex');
const at=store=>({taskId:store.getView().activeTaskId,revision:store.getView().revision});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'companion-execution-record-'));let store=new TaskWorkspaceStore(root,'owned-test');await store.initialize();
 const make=(id='request_one')=>{
  const target={actorId:'account',deviceId:'phone',pairingId:'pair',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:at(store).taskId,version:at(store).revision,epoch:1,consentRevision:1,artifactId:'selected_html',artifactVersion:hash('original')};
  const checkpoint={schema:'hps-companion-desktop-handoff-local/1',id,createdAt:1000,target,originalDraft:'정답에 설명을 붙여 줘',reviewedIntent:'정답에 설명을 붙여 줘',attachments:[{artifactId:target.artifactId,artifactVersion:target.artifactVersion}],run:{id:null,state:'not_started'}};
  const authority={grantId:'grant',turnId:'turn_'+id,requestHash:hash('exact packet '+id),authorityDigest:hash('verified service reservation '+id)};
  const source={requestId:id,requestHash:authority.requestHash,taskId:target.taskId,text:checkpoint.reviewedIntent,artifactId:target.artifactId,artifactVersion:target.artifactVersion};
  const run={userMessageId:'user_'+id,turnId:authority.turnId,submittedHash:hash(source.text),restorePointId:authority.turnId,restoreDigest:hash('manifest'),artifactPath:'selected.html',beforeArtifactVersion:target.artifactVersion,runtime:'agent-sdk',state:'outcome_unknown'};
  return{checkpoint,authority,source,run};
 };
 return{root,get store(){return store;},make,reopen(){store=new TaskWorkspaceStore(root,'owned-test');},path:join(root,'task-workspaces',store.scope+'.companion-handoff.json'),cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('prepared execution survives reopen without inventing a draft, presented ACK or execution result',async()=>{const f=await fixture();try{
 const x=f.make(),before=f.store.getDraft();const first=await f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>true);
 assert.equal(first.created,true);assert.equal(first.record.authoringExecution.state,'prepared');assert.equal(first.record.authoringImport,undefined);assert.equal(first.record.authoringRun,undefined);assert.deepEqual(f.store.getDraft(),before);
 f.reopen();const again=await f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>true);assert.equal(again.created,false);assert.deepEqual(again.record,first.record);
 await assert.rejects(f.store.reserveCompanionExecution({...x.checkpoint,reviewedIntent:'changed'},x.authority,at(f.store),()=>true));
 await assert.rejects(f.store.reserveCompanionExecution(x.checkpoint,{...x.authority,authorityDigest:hash('another grant')},at(f.store),()=>true));
}finally{await f.cleanup();}});
test('binding is one-shot, agent SDK only, and unknown run prevents another request after crash',async()=>{const f=await fixture();try{
 const x=f.make();await f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>true);
 await assert.rejects(f.store.bindCompanionExecutionRun(x.source,x.authority,{...x.run,runtime:'proxy'},at(f.store),()=>true));
 await assert.rejects(f.store.bindCompanionExecutionRun(x.source,{...x.authority,turnId:'another'},x.run,at(f.store),()=>true));
 await f.store.bindCompanionExecutionRun(x.source,x.authority,x.run,at(f.store),()=>true);
 await assert.rejects(f.store.bindCompanionExecutionRun(x.source,x.authority,x.run,at(f.store),()=>true));
 f.reopen();const held=await f.store.readCompanionHandoff(at(f.store)),next=f.make('request_two');assert.equal(held.authoringRun.state,'outcome_unknown');
 await assert.rejects(f.store.reserveCompanionExecution(next.checkpoint,next.authority,at(f.store),()=>true,{id:held.checkpoint.id,digest:held.digest}));
 await assert.rejects(f.store.discardCompanionHandoff(held.checkpoint.id,held.digest,at(f.store)));
 assert.deepEqual(await f.store.readCompanionHandoff(at(f.store)),held);
}finally{await f.cleanup();}});
test('two definitive runs retain the first and replay returns its record without replacing the current request',async()=>{const f=await fixture();try{
 const first=f.make();await f.store.reserveCompanionExecution(first.checkpoint,first.authority,at(f.store),()=>true);await f.store.bindCompanionExecutionRun(first.source,first.authority,first.run,at(f.store),()=>true);
 await f.store.finishCompanionAuthoringRun(first.source,first.run.turnId,{state:'completed',afterArtifactVersion:hash('revised')},at(f.store),()=>true);
 const kept=await f.store.readCompanionHandoff(at(f.store));await f.store.saveDraft(at(f.store).taskId,{text:'',images:[],queued:null});
 const second=f.make('request_two');second.checkpoint.target.artifactVersion=hash('revised');second.checkpoint.attachments[0].artifactVersion=hash('revised');second.source.artifactVersion=hash('revised');second.run.beforeArtifactVersion=hash('revised');
 assert.equal((await f.store.reserveCompanionExecution(second.checkpoint,second.authority,at(f.store),()=>true,{id:kept.checkpoint.id,digest:kept.digest})).created,true);
 await f.store.bindCompanionExecutionRun(second.source,second.authority,second.run,at(f.store),()=>true);await f.store.finishCompanionAuthoringRun(second.source,second.run.turnId,{state:'failed'},at(f.store),()=>true);
 f.reopen();const before=await readFile(f.path,'utf8'),replay=await f.store.reserveCompanionExecution(first.checkpoint,first.authority,at(f.store),()=>true);assert.equal(replay.created,false);assert.deepEqual(replay.record,kept);assert.equal(await readFile(f.path,'utf8'),before);assert.equal((await f.store.readCompanionHandoff(at(f.store))).checkpoint.id,'request_two');assert.deepEqual(await f.store.retainedCompanionAuthoringRequest(at(f.store),'request_one'),kept);
}finally{await f.cleanup();}});
test('new desktop draft and revoked authority preserve bytes and never bind execution',async()=>{const f=await fixture();try{
 const x=f.make();await assert.rejects(f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>false));
 await f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>true);const prior=await readFile(f.path,'utf8');
 await f.store.saveDraft(at(f.store).taskId,{text:'내가 작성하던 내용',images:[],queued:null});
 await assert.rejects(f.store.bindCompanionExecutionRun(x.source,x.authority,x.run,at(f.store),()=>true));assert.equal(await readFile(f.path,'utf8'),prior);assert.equal(f.store.getDraft().text,'내가 작성하던 내용');
 await f.store.saveDraft(at(f.store).taskId,{text:'',images:[],queued:null});let calls=0;
 await assert.rejects(f.store.bindCompanionExecutionRun(x.source,x.authority,x.run,at(f.store),()=>++calls===1));assert(calls>=2);assert.equal(await readFile(f.path,'utf8'),prior);
}finally{await f.cleanup();}});
test('stored execution cannot masquerade as an imported draft or bind a mismatched turn',async()=>{const f=await fixture();try{
 const x=f.make(),saved=(await f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>true)).record;
 assert(validCompanionDesktopHandoffRecord(saved));assert.equal(validCompanionDesktopHandoffRecord({...saved,authoringImport:{requestHash:x.authority.requestHash,state:'imported',revision:0,presented:true}}),false);
 assert.equal(validCompanionDesktopHandoffRecord({...saved,authoringRun:x.run}),false);
 assert.equal(validCompanionDesktopHandoffRecord({...saved,authoringExecution:{...saved.authoringExecution,state:'bound'},authoringRun:{...x.run,turnId:'wrong',restorePointId:'wrong'}}),false);
 assert.equal(await f.store.captureCompanionAuthoringSend(at(f.store),x.source.text,x.run.userMessageId,f.store.getDraft()),null);
}finally{await f.cleanup();}});
test('execution retains the exact reviewed text including boundary whitespace',async()=>{const f=await fixture();try{
 const x=f.make();x.checkpoint.originalDraft=x.checkpoint.reviewedIntent='  정답을 설명해 줘.\n';x.source.text=x.checkpoint.reviewedIntent;x.run.submittedHash=hash(x.source.text);
 await f.store.reserveCompanionExecution(x.checkpoint,x.authority,at(f.store),()=>true);
 await assert.rejects(f.store.bindCompanionExecutionRun({...x.source,text:x.source.text.trim()},x.authority,{...x.run,submittedHash:hash(x.source.text.trim())},at(f.store),()=>true));
 await f.store.bindCompanionExecutionRun(x.source,x.authority,x.run,at(f.store),()=>true);
 f.reopen();const held=await f.store.readCompanionHandoff(at(f.store));assert.equal(held.checkpoint.reviewedIntent,x.source.text);assert.equal(held.authoringRun.submittedHash,hash(x.source.text));
}finally{await f.cleanup();}});
