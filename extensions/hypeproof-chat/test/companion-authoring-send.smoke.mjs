import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createTaskHarness} from './task-workspace-harness.mjs';
import {TaskWorkspaceStore} from '../src/taskWorkspaceStore.ts';
import {takeRestorePoint,turnRestoreStoreDir,scanFolder,restoreToPoint,loadRestorePoint} from '../src/turnRestore.ts';
import {companionAuthoringRun,companionAuthoringRunState} from '../src/companionAuthoringSend.ts';
const hash=s=>createHash('sha256').update(s).digest('hex');
const require=createRequire(import.meta.url);let runSdkCoach,sdkModuleDirectory;
before(async()=>{
 const out=sdkModuleDirectory=await mkdtemp(join(tmpdir(),'companion-sdk-module-')),bundle=join(out,'sdk.cjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/sdkCoach.ts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',format:'cjs',external:['@anthropic-ai/claude-agent-sdk','zod'],logLevel:'silent',plugins:[{name:'vscode-fixture',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:p=>({fsPath:p})}};',loader:'js'}));}}]});
 ({runSdkCoach}=require(bundle));
});
after(async()=>{if(sdkModuleDirectory)await rm(sdkModuleDirectory,{recursive:true,force:true});});
async function fixture(){
 const base=await mkdtemp(join(tmpdir(),'companion-normal-send-')),root=join(base,'workspace');await mkdir(root);const f=await createTaskHarness(base);f.h.opsGeneration=1;
 const file=join(root,'index.html'),original='<h1>old version</h1>';await writeFile(file,original);
 const view=f.store.getView(),requestHash='b'.repeat(64),text='  Change only the heading.\nKeep the old page.  ';
 const checkpoint={schema:'hps-companion-desktop-handoff-local/1',id:'phone-intent',createdAt:0,target:{actorId:'actor',deviceId:'device',pairingId:'pair',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:view.activeTaskId,version:view.revision,epoch:1,consentRevision:1,artifactId:hash('hps-companion-artifact/1:'+file),artifactVersion:hash(original)},originalDraft:text,reviewedIntent:text,attachments:[{artifactId:hash('hps-companion-artifact/1:'+file),artifactVersion:hash(original)}],run:{id:null,state:'not_started'}};
 const at=()=>{const v=f.store.getView();return{taskId:v.activeTaskId,revision:v.revision};};
 await f.store.stageCompanionHandoff(checkpoint,at(),requestHash,()=>true);
 await f.store.importCompanionAuthoringDraft(checkpoint.id,requestHash,at(),f.store.getDraft(),()=>true);
 await f.store.presentCompanionAuthoringDraft(checkpoint.id,requestHash,at(),()=>true);
 const capture=async(id,submitted=text.trim())=>{
  const owner=f.h.freezeCompanionAuthoringSend(submitted,id,f.source);if(!owner)return null;
  const source=await owner.read;if(!owner.current())throw Error('fixture_owner_changed');
  return source?{store:owner.store,source,current:owner.current}:null;
 };
 const point=async id=>{const store=turnRestoreStoreDir(join(base,'private'),root,view.activeTaskId);return{root,store,...await takeRestorePoint({store,root,id,turnId:id,kind:'turn'})};};
 return{base,root,f,file,original,text,at,capture,point,held:()=>f.store.readCompanionHandoff(at()),cleanup:()=>rm(base,{recursive:true,force:true})};
}
test('ordinary Send freezes the exact presented draft; real SDK policy writes a revision only after durable provenance, with a usable old restore point',async()=>{
 const f=await fixture();try{
  const userId='local-'+randomUUID(),turnId=randomUUID();
  // Actual React also autosaves the rendered import; do not assume its write settled.
  const autosave=f.f.store.saveDraft(f.at().taskId,{text:f.text,images:[],queued:null,toolMode:'auto'});
  const captured=f.capture(userId);await autosave;const frozen=await captured;assert(frozen);
  // Match the actual composer: Send is posted before its cleared-draft save.
  await f.f.store.saveDraft(f.at().taskId,{text:'',images:[],queued:null});
  const before=await f.point(turnId),binding=companionAuthoringRun(frozen.source,userId,turnId,before,'agent-sdk');
  await f.f.store.bindCompanionAuthoringRun(frozen.source,binding,f.at(),frozen.current);
  let queries=0,approvals=0;const edited='<h1>revised by SDK tool</h1>';
  const sdk={query:({options})=>(async function*(){
   queries++;assert.equal((await f.held()).authoringRun.state,'outcome_unknown','reservation must precede the runner');
   const input={file_path:f.file,content:edited},decision=await options.canUseTool('Write',input,{toolUseID:'write-one',signal:new AbortController().signal});
   assert.equal(decision.behavior,'allow');await writeFile(decision.updatedInput.file_path,decision.updatedInput.content);
   yield{type:'assistant',message:{id:'answer',content:[{type:'text',text:'The heading changed.'}]}};
   yield{type:'result',subtype:'success',is_error:false};
  })()};
  const result=await runSdkCoach({sdk,binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'synthetic-only',model:'hypeproof-default',profile:{game:{template_tier:'website'},sdk_tools:{read:true,write:true}},systemPrompt:'',history:[],userText:frozen.source.text,signal:new AbortController().signal,cwd:f.root,turnId,onDelta:()=>{},requestApproval:async()=>{approvals++;return{approved:true,actor:'user'};}});
  assert.equal(result.failed,false);assert.equal(queries,1);assert.equal(approvals,1);assert.equal(await readFile(f.file,'utf8'),edited);
  const after=await scanFolder(f.root);await f.f.store.finishCompanionAuthoringRun(frozen.source,turnId,{state:'completed',afterArtifactVersion:hash(edited)},f.at(),frozen.current);
  const held=await f.held();assert.equal(held.authoringRun.userMessageId,userId);assert.equal(held.authoringRun.turnId,turnId);assert.equal(held.authoringRun.submittedHash,hash(f.text.trim()));assert.equal(held.authoringRun.beforeArtifactVersion,hash(f.original));assert.equal(held.authoringRun.afterArtifactVersion,hash(edited));assert.equal(held.authoringRun.state,'completed');
  assert(await loadRestorePoint(before.store,turnId));
  const restored=await restoreToPoint({store:before.store,root:f.root,point:before.point,beforeRestoreId:randomUUID(),expectedDigest:after.digest,stillCurrent:frozen.current});assert.equal(restored.ok,true);assert.equal(await readFile(f.file,'utf8'),f.original);
 }finally{await f.cleanup();}
});
test('edited native input stays ordinary Send and preflight refusal cannot reserve a phone run',async()=>{
 const f=await fixture();try{
  await f.f.store.saveDraft(f.at().taskId,{text:'native edit',images:[],queued:null});let calls=0,origin;
  assert.equal(await f.capture('local-native','native edit'),null);
  f.f.h.handleSend=async(...args)=>{calls++;origin=args.at(-1);};f.f.h.missingFolderApplies=()=>false;
  await f.f.handle(f.f.scoped({type:'sendMessage',text:'native edit',history:[],userMessageId:'local-native'}));assert.equal(calls,1);assert.equal(origin,f.f.source);assert.equal((await f.held()).authoringRun,undefined);
  await f.f.store.saveDraft(f.at().taskId,{text:f.text,images:[],queued:null});f.f.h.missingFolderApplies=()=>true;f.f.h.missingTaskFolderPath=async()=>'/missing';let held=0;f.f.h.holdSendForMissingFolder=async()=>{held++;};
  await f.f.handle(f.f.scoped({type:'sendMessage',text:f.text.trim(),history:[],userMessageId:'local-preflight'}));assert.equal(calls,1);assert.equal(held,1);assert.equal((await f.held()).authoringRun,undefined);
  await f.f.store.saveDraft(f.at().taskId,{text:'ordinary native message',images:[],queued:null});
  await writeFile(f.f.store.filePath.replace(/\.json$/,'.companion-handoff.json'),'{malformed optional metadata');
  assert.equal(await f.capture('local-without-provenance','ordinary native message'),null);
  f.f.h.missingFolderApplies=()=>false;
  await f.f.handle(f.f.scoped({type:'sendMessage',text:'ordinary native message',history:[],userMessageId:'local-without-provenance'}));assert.equal(calls,2);assert.equal(origin,f.f.source);
 }finally{await f.cleanup();}
});
test('missing or wrong snapshot holds only the positively frozen phone request before a runner can start',async()=>{
 const f=await fixture();try{
  const frozen=await f.capture('local-snapshot'),turnId=randomUUID();let runners=0;
  for(const before of[null,await f.point(turnId)]){
   if(before)before.point.files[0].sha256='d'.repeat(64);
   assert.throws(()=>{companionAuthoringRun(frozen.source,'local-snapshot',turnId,before,'agent-sdk');runners++;},/보관/);
  }
  assert.equal(runners,0);assert.equal((await f.held()).authoringRun,undefined);assert.equal(await readFile(f.file,'utf8'),f.original);
 }finally{await f.cleanup();}
});
test('late owner change, changed native draft and different task refuse provenance writes without consuming either draft',async()=>{
 for(const mode of['owner','draft','task']){const f=await fixture();try{
  const frozen=await f.capture('local-'+mode),turnId=randomUUID(),binding=companionAuthoringRun(frozen.source,'local-'+mode,turnId,await f.point(turnId),'agent-sdk');
  if(mode==='owner')f.f.h.opsGeneration++;
  if(mode==='draft')await f.f.store.saveDraft(f.at().taskId,{text:'new native work',images:[],queued:null});
  if(mode==='task')await f.f.store.create('other task',f.at());
  await assert.rejects(f.f.store.bindCompanionAuthoringRun(frozen.source,binding,f.at(),frozen.current));
  assert.equal((await f.held()).authoringRun,undefined);assert.equal(f.f.store.getDraft().text,mode==='draft'?'new native work':mode==='owner'?f.text:'');
 }finally{await f.cleanup();}}
});
test('interrupted reservation stays unknown across reload; duplicate Send cannot bind or invoke its runner again',async()=>{
 const f=await fixture();try{
  const userId='local-once',frozen=await f.capture(userId),turnId=randomUUID(),binding=companionAuthoringRun(frozen.source,userId,turnId,await f.point(turnId),'agent-sdk');
  await f.f.store.bindCompanionAuthoringRun(frozen.source,binding,f.at(),frozen.current);
  const reloaded=new TaskWorkspaceStore(f.base,'synthetic-personal-a');await reloaded.initialize();const view=reloaded.getView();
  const held=await reloaded.readCompanionHandoff({taskId:view.activeTaskId,revision:view.revision});assert.equal(held.authoringRun.state,'outcome_unknown');
  await assert.rejects(reloaded.bindCompanionAuthoringRun(frozen.source,{...binding,turnId:randomUUID()}, {taskId:view.activeTaskId,revision:view.revision},()=>true));
  let runners=0;const duplicate=async()=>{await f.capture(userId);runners++;};
  await assert.rejects(duplicate());assert.equal(runners,0);assert.equal((await f.held()).authoringRun.state,'outcome_unknown');
 }finally{await f.cleanup();}
});
test('actual SDK terminal evidence separates unchanged successful turns, explicit refusal, failure and absent terminal from edit acceptance',async()=>{
 const f=await fixture();try{
  const success={type:'result',subtype:'success',is_error:false,usage:{input_tokens:11,output_tokens:7}};
  const cases=[{name:'unchanged',events:[success],state:'completed'},
   {name:'refused',events:[{type:'system',subtype:'model_refusal_no_fallback'},success],state:'failed'},
   {name:'failed',events:[{...success,subtype:'error_during_execution',is_error:true}],state:'failed'},
   {name:'no-terminal',events:[],state:'outcome_unknown'},
   {name:'unknown-terminal',events:[{...success,subtype:'future_unknown_result'}],state:'outcome_unknown'}];
  for(const item of cases){
   let terminalObserved=false,refused=false,queries=0;
   const sdk={query:()=>(async function*(){queries++;for(const event of item.events)yield event;})()};
   const result=await runSdkCoach({sdk,binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'synthetic-only',model:'hypeproof-default',profile:{game:{template_tier:'website'},sdk_tools:{read:true,write:true}},systemPrompt:'',history:[],userText:'This fixture makes no file edit',signal:new AbortController().signal,cwd:f.root,onDelta:()=>{},onRefusal:()=>{refused=true;},onTerminal:successful=>{terminalObserved=successful;},requestApproval:async()=>false});
   const state=companionAuthoringRunState({aborted:false,failed:result.failed,refused,terminalObserved,artifactMeasured:true});
   assert.equal(state,item.state,item.name);assert.equal(queries,1);assert.equal(await readFile(f.file,'utf8'),f.original);
   assert.equal(companionAuthoringRunState({aborted:true,failed:result.failed,refused,terminalObserved,artifactMeasured:true}),'outcome_unknown');
  }
 }finally{await f.cleanup();}
});
