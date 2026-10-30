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
test('strict intent is distinct, bounded and rejects authority/selection additions',async()=>{const f=await fixture();try{
 assert.deepEqual(parseCompanionAuthoringIntent(f.message().text),f.request);
 for(const value of[{...f.request,execute:true},{...f.request,text:'가'.repeat(342)},{...f.request,text:' '},{...f.request,requestId:f.request.selection.requestId},{...f.request,selection:{...f.request.selection,operation:'desktop.continue'}},{...f.request,selection:{...f.request.selection,path:'/etc/passwd'}}])assert.equal(parseCompanionAuthoringIntent(JSON.stringify(value)),null);
 assert.equal(parseCompanionAuthoringIntent(' '.repeat(2033)),null);
}finally{await f.cleanup();}});
test('explicit review imports exact ordinary draft once and restart returns receipt without touching artifact',async()=>{const f=await fixture();try{
 f.onConfirm=async()=>{assert.equal(f.store.getDraft().text,'');assert.equal(f.imports,0);};assert.equal((await f.host.handle(f.message())).state,'imported_draft');assert.equal(f.store.getDraft().text,f.request.text);assert.equal(f.confirms,1);assert.equal(f.imports,1);
 f.restart();assert.equal((await f.host.handle(f.message())).code,'already_imported');assert.equal(f.confirms,1);
 await f.store.saveDraft(f.snapshot.taskId,{text:'',images:[],queued:null});assert.equal((await f.host.handle(f.message())).code,'already_imported');assert.equal(f.store.getDraft().text,'','clearing or sending a draft cannot replay import');
 const v=f.store.getView(),expected={taskId:v.activeTaskId,revision:v.revision},held=await f.store.readCompanionHandoff(expected);await assert.rejects(()=>f.store.discardCompanionHandoff(held.checkpoint.id,held.digest,expected),'import mapping cannot be erased to allow replay');
 const changed=f.message();changed.text=JSON.stringify({...f.request,text:'changed'});assert.equal((await f.host.handle(changed)).code,'request_id_conflict');const whitespace=f.message();whitespace.text+=' ';assert.equal((await f.host.handle(whitespace)).code,'request_id_conflict');assert.equal(await readFile(f.snapshot.artifact.path,'utf8'),'<p>previous working version</p>');
}finally{await f.cleanup();}});
test('cancel, conflict, concurrent draft and owner/selection changes preserve both drafts',async()=>{for(const mode of['cancel','conflict','concurrent','owner','selection']){const f=await fixture();try{
 if(mode==='cancel')f.approve=false;if(mode==='conflict'){await f.store.saveDraft(f.snapshot.taskId,{text:'desktop work',images:[],queued:null});f.request.selection.version=f.store.getView().revision;}
 f.onConfirm=async()=>{if(mode==='concurrent')await f.store.saveDraft(f.snapshot.taskId,{text:'new during modal',images:[],queued:null});if(mode==='owner')f.invalidate();if(mode==='selection')f.snapshot.artifact.version='d'.repeat(64);};assert.notEqual((await f.host.handle(f.message())).state,'imported_draft');assert.equal(f.imports,0);assert.equal(f.store.getDraft().text,mode==='conflict'?'desktop work':mode==='concurrent'?'new during modal':'');const v=f.store.getView(),held=await f.store.readCompanionHandoff({taskId:v.activeTaskId,revision:v.revision});assert.equal(held.checkpoint.originalDraft,f.request.text);
}finally{await f.cleanup();}}});
test('foreign sender, selection and revoked authority never stage or prompt',async()=>{for(const mode of['sender','task','authority']){const f=await fixture();try{
 const m=f.message();if(mode==='sender')m.claimDigest='d'.repeat(64);if(mode==='task'){f.request.selection.taskId='foreign_task';m.text=JSON.stringify(f.request);}if(mode==='authority')f.snapshot.folderReadAllowed=false;assert.equal((await f.host.handle(m)).state,'denied');assert.equal(f.confirms,0);assert.equal(f.store.getDraft().text,'');const v=f.store.getView();assert.equal(await f.store.readCompanionHandoff({taskId:v.activeTaskId,revision:v.revision}),null);
}finally{await f.cleanup();}}});
test('interrupted write-ahead import holds unknown without automatic replay',async()=>{const f=await fixture();try{
 f.approve=false;await f.host.handle(f.message());const path=join(f.root,'task-workspaces',f.store.scope+'.companion-handoff.json'),envelope=JSON.parse(await readFile(path,'utf8'));envelope.data.record.authoringImport.state='prepared';envelope.checksum=hash(JSON.stringify(envelope.data));await writeFile(path,JSON.stringify(envelope));f.approve=true;f.restart();assert.equal((await f.host.handle(f.message())).state,'outcome_unknown');assert.equal(f.confirms,1);assert.equal(f.store.getDraft().text,'');assert.equal(f.imports,0);
}finally{await f.cleanup();}});

test('actual final receipt write failure preserves imported text and restart holds unknown without reimport',async()=>{
 const require=createRequire(import.meta.url),fs=require('node:fs/promises');let failFinal=true;
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/taskWorkspaceStore.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});
 const io={...fs,rename:async(from,to)=>{if(failFinal&&String(to).endsWith('.companion-handoff.json')){const saved=JSON.parse(await fs.readFile(from,'utf8'));if(saved.data.record.authoringImport?.state==='imported'){failFinal=false;throw Error('synthetic_final_receipt_failure');}}return fs.rename(from,to);}};
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='node:fs/promises'?io:require(id),Buffer,process,console,URL,structuredClone,TextEncoder,TextDecoder,setTimeout,clearTimeout,performance});
 const f=await fixture(module.exports.TaskWorkspaceStore);try{
  assert.equal((await f.host.handle(f.message())).state,'outcome_unknown');assert.equal(f.store.getDraft().text,f.request.text);assert.equal(f.imports,0);
  f.restart();assert.equal((await f.host.handle(f.message())).state,'outcome_unknown');assert.equal(f.confirms,1);assert.equal(f.store.getDraft().text,f.request.text);
 }finally{await f.cleanup();}
});

test('store import independently refuses a held request for another current task',async()=>{const f=await fixture();try{
 f.approve=false;await f.host.handle(f.message());const before=f.store.getView();await f.store.create('other task',{taskId:before.activeTaskId,revision:before.revision});const after=f.store.getView();
 await assert.rejects(()=>f.store.importCompanionAuthoringDraft(f.request.requestId,hash(f.message().text),{taskId:after.activeTaskId,revision:after.revision},f.store.getDraft(),()=>true));assert.equal(f.store.getDraft().text,'');assert.equal(f.store.getDraft(before.activeTaskId).text,'');
}finally{await f.cleanup();}});

test('revocation during temporary write/sync/close prevents main rename and cleans unpublished bytes',async()=>{
 const require=createRequire(import.meta.url),fs=require('node:fs/promises');
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/taskWorkspaceStore.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});
 for(const phase of ['writeFile','sync','close']){
  let armed=false,paused=false,mainRenames=0,signal,release;
  const entered=new Promise(r=>signal=r),resume=new Promise(r=>release=r);
  const io={...fs,open:async(path,...args)=>{
   const handle=await fs.open(path,...args);
   if(!String(path).includes('.json.tmp-')||String(path).includes('.companion-handoff.json.tmp-'))return handle;
   return new Proxy(handle,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    return async(...values)=>{const result=await value.apply(target,values);if(armed&&!paused&&key===phase){paused=true;signal();await resume;}return result;};}});
  },rename:async(from,to)=>{if(armed&&String(from).includes('.json.tmp-')&&!String(from).includes('.companion-handoff.json.tmp-'))mainRenames++;return fs.rename(from,to);}};
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='node:fs/promises'?io:require(id),Buffer,process,console,URL,structuredClone,TextEncoder,TextDecoder,setTimeout,clearTimeout,performance});
  const f=await fixture(module.exports.TaskWorkspaceStore);try{
   const original=await readFile(f.store.filePath,'utf8');armed=true;const pending=f.host.handle(f.message());await entered;f.invalidate();release();
   assert.equal((await pending).state,'outcome_unknown');assert.equal(mainRenames,0,phase+': no rename may be dispatched after observed revocation');
   assert.equal(await readFile(f.store.filePath,'utf8'),original);assert.equal(f.store.getDraft().text,'');assert.equal(f.imports,0);
   assert.equal((await fs.readdir(join(f.root,'task-workspaces'))).some(name=>name.includes('.tmp-')),false,'temporary draft bytes cleaned');
  }finally{release();await f.cleanup();}
 }
});

test('revoked authoring receipt writes never publish a stale stage, completion or view acknowledgement',async()=>{
 const require=createRequire(import.meta.url),fs=require('node:fs/promises');
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/taskWorkspaceStore.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false});
 for(const stage of ['review','prepared','imported','presented']){
  let paused=false,revoked=false,renamesAfterRevoke=0,signal,release;
  const entered=new Promise(r=>signal=r),resume=new Promise(r=>release=r);
  const io={...fs,open:async(path,...args)=>{
   const handle=await fs.open(path,...args);if(!String(path).includes('.companion-handoff.json.tmp-'))return handle;
   let matches=false;
   return new Proxy(handle,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    return async(...values)=>{if(key==='writeFile'){const record=JSON.parse(String(values[0])).data.record.authoringImport;matches=stage==='presented'?record?.presented===true:record?.state===stage&&!record.presented;}
     const result=await value.apply(target,values);if(!paused&&key==='close'&&matches){paused=true;signal();await resume;}return result;};}});
  },rename:async(...args)=>{if(revoked)renamesAfterRevoke++;return fs.rename(...args);}};
  const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='node:fs/promises'?io:require(id),Buffer,process,console,URL,structuredClone,TextEncoder,TextDecoder,setTimeout,clearTimeout,performance});
  const f=await fixture(module.exports.TaskWorkspaceStore);try{
   const pending=f.host.handle(f.message());await entered;f.invalidate();revoked=true;release();assert.notEqual((await pending).state,'imported_draft');assert.equal(renamesAfterRevoke,0,stage+': no stale receipt rename dispatched');
   const view=f.store.getView(),held=await f.store.readCompanionHandoff({taskId:view.activeTaskId,revision:view.revision});
   assert.equal(held?.authoringImport?.state,stage==='review'?undefined:stage==='prepared'?'review':stage==='imported'?'prepared':'imported');assert.notEqual(held?.authoringImport?.presented,true);
   f.restart();assert.equal(f.store.getDraft().text,['imported','presented'].includes(stage)?f.request.text:'','only previously admitted main write survives');
   assert.equal((await fs.readdir(join(f.root,'task-workspaces'))).some(name=>name.includes('.tmp-')),false);
  }finally{release();await f.cleanup();}
 }
});
