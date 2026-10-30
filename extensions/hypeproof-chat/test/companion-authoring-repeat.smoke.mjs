import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {TaskWorkspaceStore} from '../src/taskWorkspaceStore.ts';
import {CompanionAuthoringHost} from '../src/companionAuthoringHost.ts';
import {companionSelectionRequest} from '../src/companionHostBridge.ts';
import {parseCompanionAuthoringIntent} from '../src/companionAuthoringIntent.ts';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(Store=TaskWorkspaceStore){
 const root=await mkdtemp(join(tmpdir(),'companion-authoring-'));let store=new Store(root,'scope');await store.initialize();
 const pair={schema:'hps-companion-pairing-preview/2',id:'pair',status:'paired',account_id:'account',host_session_id:'host_session',device_session_id:'device_session',host_id:'host',device_id:'device',workspace_id:hash('hps-companion-workspace/1:scope'),project_id:'project',invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:10000,capability:'preview.read',execution_authorized:false};
 const snapshot={preparation:{version:1,scope:'scope',workspace:root,projectId:'project',activityId:'activity',hostId:'host',preparedAt:1},pair,accountId:'account',accountSessionId:'host_session',binding:{sessionId:'host_session',passId:'pass'},profile:{profile_id:'profile',activity_id:'activity',activity_kind:'trial',sdk_tools:{read:true},minor_cohort:false,game:{template_tier:'website'},pass:{expires_at:10000}},taskId:store.getView().activeTaskId,version:store.getView().revision,epoch:1,consentRevision:1,folderReadAllowed:true,host:'online',artifact:{id:'artifact',version:'c'.repeat(64),path:join(root,'index.html'),label:'index.html'}};
 await writeFile(snapshot.artifact.path,'<p>previous working version</p>');const request={schema:'hps-companion-authoring-intent/1',requestId:'intent_one',pairingId:'pair',selection:companionSelectionRequest(snapshot,'selected_one'),text:'정답 뒤에 설명을 보여 줘'};
 let approve=true,onConfirm=async()=>{},owner=1,confirms=0,imports=0;
 const make=()=>new CompanionAuthoringHost({snapshot:async()=>({...structuredClone(snapshot),version:store.getView().revision}),store:()=>store,lifecycle:{capture:()=>owner,isCurrent:n=>n===owner},confirm:async received=>{assert.deepEqual(received,request);confirms++;await onConfirm();return approve;},imported:async()=>{imports++;},now:()=>1000});let host=make();
 const message=()=>({sender:'device',invitationId:pair.id,invitationDigest:pair.invitation_digest,claimDigest:pair.claim_digest,messageId:request.requestId,text:JSON.stringify(request)});
 return{root,snapshot,request,message,get host(){return host;},get store(){return store;},get confirms(){return confirms;},get imports(){return imports;},set approve(v){approve=v;},set onConfirm(v){onConfirm=v;},invalidate(){owner++;},restart(){store=new TaskWorkspaceStore(root,'scope');host=make();},cleanup:()=>rm(root,{recursive:true,force:true})};
}
// Real disk import/Send provenance; completion is a controlled terminal receipt, not an SDK run.
const at=f=>{const v=f.store.getView();return{taskId:v.activeTaskId,revision:v.revision};};
async function finish(f,state='completed'){
 const userMessageId='user_'+f.request.requestId,turnId='turn_'+f.request.requestId;
 const source=await f.store.captureCompanionAuthoringSend(at(f),f.request.text,userMessageId,f.store.getDraft());assert(source);
 await f.store.saveDraft(at(f).taskId,{text:'',images:[],queued:null});
 await f.store.bindCompanionAuthoringRun(source,{userMessageId,turnId,submittedHash:hash(f.request.text),restorePointId:turnId,restoreDigest:'e'.repeat(64),artifactPath:'index.html',beforeArtifactVersion:f.snapshot.artifact.version,runtime:'agent-sdk',state:'outcome_unknown'},at(f),()=>true);
 if(state!=='outcome_unknown')await f.store.finishCompanionAuthoringRun(source,turnId,{state,afterArtifactVersion:f.snapshot.artifact.version},at(f),()=>true);
}
function next(f,id='intent_two'){f.request.requestId=id;f.request.selection=companionSelectionRequest({...f.snapshot,version:f.store.getView().revision},'selection_'+id);f.request.text='Next exact request '+id;}
test('two explicit imports/sends retain exact old linkage and idempotent replay after process reopen',async()=>{const f=await fixture();try{
 const first=f.message();assert.equal((await f.host.handle(first)).state,'imported_draft');await finish(f);const prior=await f.store.readCompanionHandoff(at(f));next(f);assert.equal((await f.host.handle(f.message())).state,'imported_draft');await finish(f);f.restart();assert.deepEqual(await f.store.retainedCompanionAuthoringRequest(at(f),'intent_one'),prior);assert.equal((await f.store.readCompanionHandoff(at(f))).authoringRun.turnId,'turn_intent_two');const n=f.confirms;assert.equal((await f.host.handle(first)).code,'already_imported');assert.equal(f.confirms,n);assert.equal(f.store.getDraft().text,'');assert.equal((await f.host.handle({...first,text:first.text+' '})).code,'request_id_conflict');await assert.rejects(f.store.captureCompanionAuthoringSend(at(f),'ordinary','user_intent_one',f.store.getDraft()));
}finally{await f.cleanup();}});
for(const mode of ['cancel','owner','draft'])test('next request '+mode+' preserves terminal slot and draft',async()=>{const f=await fixture();try{
 await f.host.handle(f.message());await finish(f);const path=join(f.root,'task-workspaces',f.store.scope+'.companion-handoff.json'),prior=await readFile(path,'utf8');next(f);if(mode==='cancel')f.approve=false;f.onConfirm=async()=>{if(mode==='owner')f.invalidate();if(mode==='draft')await f.store.saveDraft(f.snapshot.taskId,{text:'new desktop work',images:[],queued:null});};assert.notEqual((await f.host.handle(f.message())).state,'imported_draft');assert.equal(await readFile(path,'utf8'),prior);assert.equal(f.store.getDraft().text,mode==='draft'?'new desktop work':'');
}finally{await f.cleanup();}});
for(const state of ['outcome_unknown','unsent','failed'])test('prior '+state+' permits only definitive terminal rotation',async()=>{const f=await fixture();try{
 await f.host.handle(f.message());if(state!=='unsent')await finish(f,state);const n=f.confirms;next(f);assert.equal((await f.host.handle(f.message())).state,state==='failed'?'imported_draft':'denied');assert.equal(f.confirms,n+(state==='failed'?1:0));
}finally{await f.cleanup();}});
for(const phase of ['before','after'])test('atomic archive/current interruption '+phase+' rename preserves old record',async()=>{
 const require=createRequire(import.meta.url),fs=require('node:fs/promises');let armed=false;
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/taskWorkspaceStore.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});
 const io={...fs,rename:async(from,to)=>{if(armed&&String(to).endsWith('.companion-handoff.json')){const data=JSON.parse(await fs.readFile(from,'utf8')).data;if(data.version===2){armed=false;if(phase==='after')await fs.rename(from,to);throw Error('synthetic_atomic_rotation_interrupt');}}return fs.rename(from,to);}};
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='node:fs/promises'?io:require(id),Buffer,process,console,URL,structuredClone,TextEncoder,TextDecoder,setTimeout,clearTimeout,performance});
 const f=await fixture(module.exports.TaskWorkspaceStore);try{await f.host.handle(f.message());await finish(f);next(f);armed=true;assert.equal((await f.host.handle(f.message())).state,'outcome_unknown');f.restart();const current=await f.store.readCompanionHandoff(at(f)),old=await f.store.retainedCompanionAuthoringRequest(at(f),'intent_one');assert.equal(current.checkpoint.id,phase==='before'?'intent_one':'intent_two');assert.equal(old?.authoringRun.state??null,phase==='before'?null:'completed');assert.equal(f.store.getDraft().text,'');if(phase==='after'){assert.equal(current.authoringImport.state,'prepared');assert.equal((await f.host.handle(f.message())).state,'outcome_unknown');}
 }finally{await f.cleanup();}
});
test('history capacity refuses without deleting any retained request or current slot',async()=>{const f=await fixture();try{
 await f.host.handle(f.message());await finish(f);for(let n=2;n<=17;n++){next(f,'intent_'+n);assert.equal((await f.host.handle(f.message())).state,'imported_draft');await finish(f);}
 const path=join(f.root,'task-workspaces',f.store.scope+'.companion-handoff.json'),before=await readFile(path,'utf8');assert.equal(JSON.parse(before).data.history.length,16);next(f,'intent_over_capacity');assert.notEqual((await f.host.handle(f.message())).state,'imported_draft');assert.equal(await readFile(path,'utf8'),before);assert.equal(f.store.getDraft().text,'');
}finally{await f.cleanup();}});
