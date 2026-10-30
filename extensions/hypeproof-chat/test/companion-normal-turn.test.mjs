// Genuine provider admission/lifecycle + actual SDK gate, with scripted SDK and local disk only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto, createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { freezeCompanionNormalTurn, companionNormalTurnResult } from '../src/companionNormalTurn.ts';
const require = createRequire(import.meta.url), hash = s => createHash('sha256').update(s).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let compiled;
test.before(async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)), sdk = join(root, 'src/sdkCoach.ts');
  compiled = (await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';export {ActivityConnections} from './src/activityConnections';export {TaskWorkspaceStore} from './src/taskWorkspaceStore';export {createCompanionExecutionPolicy} from './src/companionExecutionPolicy';", resolveDir: root, loader: 'ts' },
    bundle:true,platform:'node',format:'cjs',external:['vscode','@anthropic-ai/claude-agent-sdk','zod'],write:false,logLevel:'silent',
    plugins:[{name:'scripted-sdk-at-normal-import',setup(b){
      b.onLoad({filter:/chatPanelProvider\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace("if(prepared){\n        prepared.result=","if(prepared){\n        globalThis.fixtureTurnError(error);\n        prepared.result="),loader:'ts',resolveDir:join(root,'src')}));
      b.onResolve({filter:/^\.\/sdkCoach$/},a=>a.importer.endsWith('/chatPanelProvider.ts')?{path:sdk,namespace:'scripted'}:undefined);
      b.onLoad({filter:/.*/,namespace:'scripted'},()=>({contents:`export * from ${JSON.stringify(sdk)};import {runSdkCoach as actual} from ${JSON.stringify(sdk)};export const runSdkCoach=args=>globalThis.scriptedSdk(actual,args);`,loader:'ts',resolveDir:root}));
    }}] })).outputFiles[0].text;
});
async function fixture(t, opts={}) {
  const base=await mkdtemp(join(tmpdir(),'companion-normal-turn-')), workspace=join(await realpath(base),'work');await mkdir(workspace);
  t.after(()=>rm(base,{recursive:true,force:true}));
  const file=join(workspace,'selected.html'), original='<h1>before</h1>';await writeFile(file,original);await writeFile(join(workspace,'private.txt'),'do not send to model');
  const errors=[],state=new Map(),posts=[],history=[{id:'prior',role:'user',content:'private prior task context',createdAt:0}],calls={sdk:0,lowDisk:0,approval:0,activity:0,reveal:0};let live=true,generation=1,ui={text:'',images:[],queued:null},uiStreaming=false,f;
  const forbidden=name=>()=>{throw Error('forbidden scoped context/effect: '+name);};
  const profile={ux:{coach:{naming_mode:'fixed',fallback_name:'코치'}},profile_id:'fixture',activity_id:'server-a',activity_kind:'personal',coach_runtime:'agent-sdk',workspace_root:workspace,game:{template_tier:'website'},sdk_tools:{read:true,write:true},worlds:[{id:'guest',guest:'world',emoji:'',chip:'world'}]};
  const vscode={ExtensionMode:{Development:2,Production:1},ViewColumn:{One:1,Two:2,Beside:2},env:{appName:'HypeProof Studio'},Uri:{file:fsPath=>({scheme:'file',fsPath})},window:{},
    workspace:{isTrusted:true,workspaceFolders:[{uri:{fsPath:workspace}}],getConfiguration:()=>({get:(key,fallback)=>({proxyUrl:'http://127.0.0.1:1/v1',coachRuntime:opts.runtime??'agent-sdk'}[key]??fallback)})}};
  const token='x.'+Buffer.from(JSON.stringify({c:'synthetic',u:randomUUID()})).toString('base64url')+'.x';
  const raw={extensionMode:2,globalStorageUri:{fsPath:join(base,'private')},workspaceState:{get:(k,d)=>state.get(k)??d,update:async(k,v)=>state.set(k,v)},globalState:{get:(k,d)=>state.get(k)??d,update:async(k,v)=>state.set(k,v)},secrets:{get:async()=>token,keys:async()=>[]}};
  const mod={exports:{}};
  vm.runInNewContext(compiled,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:id==='node:fs/promises'&&opts.beforeClose?{...require(id),open:async(...args)=>{const handle=await require(id).open(...args),close=handle.close.bind(handle);handle.close=async()=>{await close();if(f)await opts.beforeClose(f,String(args[0]));};return handle;}}:require(id),console,Buffer,structuredClone,process:{...process,env:{...process.env,APPDATA:join(base,'sdk-config')}},setTimeout,clearTimeout,setInterval,clearInterval,AbortController,AbortSignal,URL,TextEncoder,TextDecoder,crypto:webcrypto,
    fixtureTurnError:error=>errors.push(String(error?.stack??error)),fetch:async url=>{assert.equal(new URL(url).pathname,'/v1/activity');calls.activity++;return Response.json({activity_id:'server-a'});},
    scriptedSdk:async(actual,args)=>{
      calls.sdk++;f.sdkArgs=args;
      if(!opts.ordinary){const held=await f.held();assert.equal(held.authoringExecution.state,'bound');assert.equal(held.authoringRun.turnId,args.turnId);}
      try { return await actual({...args,binaryResolution:opts.missingSdk?{available:false,reasons:['fixture']}:{available:true,reasons:[]},stallTimeoutMs:0,
        sdk:{query:({options})=>(async function*(){
          assert.equal(args.history.length,0);assert.equal(args.userText,f.request.text);assert.equal(args.images?.length??0,0);
          assert.deepEqual([...options.tools].sort(),opts.ordinary?['Edit','Glob','Grep','MultiEdit','Read','Write']:['Edit','Read','Write']);
          if(!opts.ordinary){
          const headers=options.env.ANTHROPIC_CUSTOM_HEADERS.split('\n');
          assert(headers.includes('x-hps-turn-id: '+f.input.reservation.turnId));
          assert.deepEqual(JSON.parse(headers.find(line=>line.startsWith('x-hps-companion-execution: ')).slice('x-hps-companion-execution: '.length)),
            {grant_id:f.input.reservation.grantId,request_id:f.request.requestId,request_hash:f.input.reservation.requestHash,
              task_id:f.request.selection.taskId,epoch:1,consent_revision:1,selection_hash:hash(f.original)});
          }
          if(opts.partial)yield{type:'assistant',message:{id:'partial-sdk',content:[{type:'text',text:opts.partial}]}};
          if(opts.onQuery)await opts.onQuery(f);
          if(opts.write!==false){
            const input={file_path:file,content:'<h1>after</h1>'}, decision=await options.canUseTool('Write',input,{toolUseID:'write',signal:args.signal});
            if(opts.denyWrite){assert.equal(decision.behavior,'deny');f.deniedWrite=true;return;}
            assert.equal(decision.behavior,'allow');await writeFile(decision.updatedInput.file_path,decision.updatedInput.content);
            yield{type:'assistant',message:{id:'tool-assistant',content:[{type:'tool_use',id:'write',name:'Write',input}]}};
            yield{type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',content:'written'}]}};
          }
          yield{type:'assistant',message:{id:'assistant',content:[{type:'text',text:'```html\n<h1>must not auto-reveal</h1>\n```\n```agent.md\nno external instruction write\n```'}]}};
          if(opts.failure)throw Error('scripted SDK failure');
          if(!opts.noTerminal)yield{type:'result',subtype:'success',is_error:false};
        })()}}); } finally { if(opts.onUnwind)await opts.onUnwind(f); }
    }});
  const {ChatPanelProvider,ActivityConnections,TaskWorkspaceStore,createCompanionExecutionPolicy}=mod.exports;
  const connections=new ActivityConnections(raw,()=> 'http://127.0.0.1:1/v1',()=>workspace,async()=>({}));
  const activity={id:'activity-a',serverId:'server-a',workspace,kind:'personal',name:'test',service:'http://127.0.0.1:1/v1'};connections.active=activity;connections.token=async()=>token;
  const context=connections.wrap(),store=new TaskWorkspaceStore(join(base,'store'),'scope');await store.initialize();
  const h=Object.create(ChatPanelProvider.prototype);
  const fields={context,servedWorkspaceRoot:workspace,taskWorkspace:{activityId:activity.id,store},opsGeneration:1,profileGeneration:1,taskChanging:false,connectionChanging:false,
    draftWrites:Promise.resolve(),pendingSends:0,activeStreams:new Map(),delegationControls:new Map(),turnTimelines:new Map(),turnRequests:new Map(),answerTurnIds:new Map(),observationWrites:Promise.resolve(),
    _instructorMode:{isInstructor:false,onTurnSuccess(){},revertModelOnTurnError:async()=>{}},finishNotifier:{release(){},turnEnded(){}},
    crSdkResults:{reset(){},onToolUse(){},onToolResult:()=>null},elementQueue:{queued:null,take:forbidden('element')},verifySession:{takeCoachContext:forbidden('verify context'),endTurn(){}},
    liveServer:{currentUrl:()=>null,setCoachEditing(){}},
    annotationBatch:{revision:0,size:0},annotationScope:()=>null,syncAnnotationScope(){},refreshLowDisk:async()=>{calls.lowDisk++;},
    getHistory:()=>history,appendHistory:async items=>{history.push(...items);},postConfig:async()=>{},postInbox:async()=>{},postLearningState:async()=>{},
    coachDisplayName:()=> '코치',getCoach:()=>({name:'코치',personality:'',configured:true}),ensureProfile:async()=>({...profile,coach_runtime:opts.runtime??'agent-sdk'}),loadAccess:async()=>{},
    dropPageAttachment:forbidden('page'),pullQuestResultFromPreview:forbidden('quest'),takeProjectSwitchBrief:forbidden('project brief'),isLearningWikiEnabled:forbidden('wiki'),
    prepareObservation:async()=>null,crBlobSinkFor:()=>null,recordLearnerUploads:forbidden('upload'),resolveCoachCwd:()=>workspace,
    funnel:{emit(){}},saveAgentMdIfPresent:forbidden('agent.md'),revealBuilt:async html=>{calls.reveal++;await writeFile(join(workspace,'index.html'),html);return true;},revealPrebuiltWorld:forbidden('prebuilt'),revealWrittenHtml:forbidden('preview timer'),
    buildBrowserMcpHost:()=>undefined,postAccuracyEducation:async()=>{},provenanceRecorder:()=>undefined,postArtifactProvenance:async()=>{},postTurnReview(){},postCheckpoint(){},
    handleSendError:async error=>{errors.push(String(error?.stack??error));},resolveActionApprovalTracked:async()=>{calls.approval++;if(opts.onApproval)await opts.onApproval(f);return true;},reportOpsTurn:async()=>{},
  };
  for(const [key,value]of Object.entries(fields))Object.defineProperty(h,key,{value,writable:true,configurable:true});
  const source={postMessage:async message=>{posts.push(structuredClone(message));
    // Actual ChatPanel includes streaming in companionBlocked and its draft generation.
    // Keep the real response contract instead of treating a newly running stream as idle.
    if(opts.realStreamReadiness && message.type==='streamStart'){uiStreaming=true;generation++;}
    if(message.type==='companionDraftCapture'){
    if(opts.onCapture)await opts.onCapture(f,message);
    await h.handleMessage({type:'saveActivityDraft',activityId:activity.id,taskId:store.getView().activeTaskId,nonce:message.nonce,draft:ui,uiGeneration:generation,imagePreparationFailed:!!opts.uiBlocked || !!(opts.realStreamReadiness&&uiStreaming)},source);
  }return true;}};
  h.editorChat={webview:source,reveal(){}};
  const view=store.getView(),request={schema:'hps-companion-authoring-intent/1',requestId:'phone-request',pairingId:'pair',text:'  Revise only this HTML.\n  ',selection:{schema:'hps-companion-host-request/1',requestId:'selected-preview',actorId:'actor',deviceId:'device',hostId:'host',workspaceId:'workspace',projectId:'project',taskId:view.activeTaskId,version:view.revision,epoch:1,consentRevision:1,artifactId:hash('hps-companion-artifact/1:'+file),artifactVersion:hash(original),operation:'preview.read'}};
  const packet=JSON.stringify(request),reservation={grantId:'ceg_'+'1'.repeat(32),turnId:randomUUID(),requestHash:hash(packet),authorityDigest:'b'.repeat(64)},signal=new AbortController();
  const input={packet,createdAt:1,reservation,current:()=>live,signal:signal.signal,
    executionBinding:{turnId:reservation.turnId,grant_id:reservation.grantId,request_id:request.requestId,request_hash:reservation.requestHash,
      task_id:request.selection.taskId,epoch:1,consent_revision:1,selection_hash:hash(original)},
    executionPolicy:createCompanionExecutionPolicy({workspaceRoot:workspace,artifactPath:file,expiresAt:Date.now()+60000,isCurrent:()=>live}),
    verifyReservation:async()=>{if(opts.verify)await opts.verify(f);return {...reservation,...f.authorityPatch};}};
  f={errors,h,store,context,connections,vscode,workspace,base,file,original,request,input,calls,posts,history,source,profile,signal,
    held:()=>{const v=store.getView();return store.readCompanionHandoff({taskId:v.activeTaskId,revision:v.revision});},
    revoke:()=>{live=false;},type:text=>{ui={...ui,text};generation++;},get ui(){return ui;},get generation(){return generation;},
    submit:()=>h.submitPreparedCompanionTurn(input),
    reload:async()=>{const fresh=new TaskWorkspaceStore(join(base,'store'),'scope');await fresh.initialize();return fresh;},
    submitOrdinary:()=>h.handleSend(request.text,[],undefined,undefined,undefined,'auto',request.requestId)};
  if(opts.ordinary){
    h.getHistory=()=>store.getHistory();h.appendHistory=items=>ChatPanelProvider.prototype.appendHistory.call(h,items);
    h.pullQuestResultFromPreview=async()=>{};h.dropPageAttachment=()=>{};h.elementQueue.take=()=>null;
    h.verifySession.takeCoachContext=()=>null;h.takeProjectSwitchBrief=()=>null;h.isLearningWikiEnabled=()=>false;
    h.recordLearnerUploads=()=>{};h.saveAgentMdIfPresent=async()=>{};
  }
  if(opts.lifecycle){
    const disposed=[];h.editorChat=undefined;raw.extensionUri={fsPath:workspace};
    vscode.Uri.joinPath=(root,...parts)=>({fsPath:join(root.fsPath,...parts)});
    h.renderHtml=()=>'<html></html>';h.queuedSources=new Set();h.writeApprovalRequest={cancel(){},invalidate(){}};
    source.onDidReceiveMessage=()=>{};
    const panel={webview:source,visible:true,reveal(){},onDidChangeViewState(){},onDidDispose(fn){disposed.push(fn);}};
    await h.openInEditor(panel);f.dispose=()=>disposed.forEach(fn=>fn());
  }
  return f;
}

test('actual provider uses normal SDK/restore lifecycle, exact text and durable binding, with no composer import or context shortcuts',async t=>{
  const f=await fixture(t);const result=await f.submit();
  assert.equal(result.state,'completed',f.errors.join('\n'));assert.equal(result.run.turnId,f.input.reservation.turnId);assert.equal(result.run.beforeArtifactVersion,hash(f.original));assert.equal(result.run.afterArtifactVersion,hash('<h1>after</h1>'));
  assert.equal(f.calls.reveal,0);await assert.rejects(readFile(join(f.workspace,'index.html')), {code:'ENOENT'});
  assert.equal(f.calls.sdk,1);assert.equal(f.calls.activity,1);assert.equal(f.calls.lowDisk,2);assert.equal(f.calls.approval,1);
  assert.equal(await readFile(f.file,'utf8'),'<h1>after</h1>');assert.equal(f.ui.text,'');assert.equal(f.store.getDraft().text,'');
  assert.equal(f.posts.some(p=>p.type==='companionDraftApply'||p.type==='inputRejected'),false);
  assert.equal((await f.held()).authoringImport,undefined);assert.equal(f.h.pendingSends,0);assert.equal(f.h.activeStreams.size,0);
  assert.equal((await f.submit()).state,'completed');assert.equal(f.calls.sdk,1,'duplicate reconciles without a second dispatch');
});

test('late UI text and edit-clear ABA while Service verification awaits never dispatch or overwrite native work',async t=>{
  for(const mode of ['text','aba']){
    const f=await fixture(t,{verify:async f=>{f.type('native unsaved');if(mode==='aba')f.type('');}});
    const result=await f.submit();assert.equal(result.state,'denied');assert.equal(f.calls.sdk,0);assert.equal(f.ui.text,mode==='text'?'native unsaved':'');
    assert.equal(f.posts.some(p=>p.type==='inputRejected'||p.type==='companionDraftApply'),false);assert.equal(await f.held(),null);
  }
});

test('revoked owner, wrong reservation, missing restore, wrong runtime and SDK absence never fall back',async t=>{
  for(const mode of ['owner','reservation','restore','runtime','sdk']){
    const f=await fixture(t,{runtime:mode==='runtime'?'proxy':undefined,missingSdk:mode==='sdk',verify:mode==='owner'?async f=>f.revoke():undefined});
    if(mode==='reservation')f.input.verifyReservation=async()=>({...f.input.reservation,turnId:randomUUID()});
    if(mode==='restore')f.h.beginTurnRestore=async()=>null;
    const result=await f.submit();assert.notEqual(result.state,'completed',mode);assert.equal(f.calls.sdk,mode==='sdk'?1:0,mode);assert.equal(await readFile(f.file,'utf8'),f.original);
    assert.equal(f.posts.some(p=>p.type==='inputRejected'),false);assert.equal(f.h.pendingSends,0);
  }
});

test('missing SDK terminal remains unknown; duplicate cannot replay',async t=>{
  const f=await fixture(t,{noTerminal:true});assert.equal((await f.submit()).state,'outcome_unknown');assert.equal((await f.submit()).state,'outcome_unknown');assert.equal(f.calls.sdk,1);
});

test('ordinary Send enters the shared method without waiting for optional metadata admission',async t=>{
  const f=await fixture(t),gate=deferred();let first=true;f.h.getHistory=()=>[];
  f.store.captureCompanionAuthoringSend=async()=>{if(first){first=false;await gate.promise;}return null;};
  const calls=[];f.h.rememberTurnRequest=text=>{calls.push(text);throw Error('checkpoint before network');};f.h.missingFolderApplies=()=>false;
  const send=text=>f.h.handleMessage({type:'sendMessage',activityId:'activity-a',taskId:f.store.getView().activeTaskId,text,history:[],userMessageId:text},f.source);
  const a=send('first'),b=send('second');assert.equal(f.h.pendingSends,2);assert.equal(calls.length,0);gate.resolve();await Promise.all([a,b]);assert.deepEqual(calls,['first','second']);assert.equal(f.h.pendingSends,0);
});

test('immutable prepared envelope refuses another selected policy; no terminal proof without measured hashes',async t=>{
  const f=await fixture(t),frozen=freezeCompanionNormalTurn(f.input);f.input.reservation.turnId=randomUUID();
  assert.notEqual(frozen.reservation.turnId,f.input.reservation.turnId);assert.equal(frozen.source.text,f.request.text);
  assert.equal(companionNormalTurnResult(frozen.source,frozen.reservation).state,'outcome_unknown');
  assert.throws(()=>freezeCompanionNormalTurn({...f.input,executionPolicy:{...f.input.executionPolicy,artifactPath:join(f.workspace,'other.html')}}));
});

test('prepared native entry requires exact execution binding before persistence or SDK work',async t=>{
  for(const patch of [undefined,{grant_id:'ceg_'+'2'.repeat(32)},{request_id:'different-phone-request'},
    {request_hash:'0'.repeat(64)},{task_id:'another-task'},{epoch:2},{consent_revision:2},{selection_hash:'0'.repeat(64)}]){
    const f=await fixture(t);f.input.executionBinding=patch===undefined?undefined:{...f.input.executionBinding,...patch};
    assert.throws(()=>f.submit(),/companion_/);assert.equal(f.calls.sdk,0);assert.equal(await f.held(),null);
  }
});


test('native input arriving during durable binding blocks SDK dispatch and remains untouched',async t=>{
  const f=await fixture(t),bind=f.store.bindCompanionExecutionRun.bind(f.store);
  f.store.bindCompanionExecutionRun=async(...args)=>{const result=await bind(...args);f.type('late native input');return result;};
  const result=await f.submit();assert.notEqual(result.state,'completed');assert.equal(f.calls.sdk,0);assert.equal(f.ui.text,'late native input');
  assert.equal(f.posts.some(p=>p.type==='inputRejected'||p.type==='companionDraftApply'),false);
  assert.equal((await f.submit()).state,'denied');assert.equal(f.calls.sdk,0);
});

test('successful unchanged file means completed turn; SDK failure never means success',async t=>{
  const unchanged=await fixture(t,{write:false});const a=await unchanged.submit();assert.equal(a.state,'completed',unchanged.errors.join('\n'));assert.equal(a.run.beforeArtifactVersion,a.run.afterArtifactVersion);
  const failed=await fixture(t,{failure:true});const b=await failed.submit();assert.equal(b.state,'failed',failed.errors.join('\n'));assert.equal((await failed.submit()).state,'failed');assert.equal(failed.calls.sdk,1);
});

test('production entry remains disabled; revoked scope after cleanup cannot return terminal success',async t=>{
  const prod=await fixture(t);prod.context.extensionMode=1;assert.equal((await prod.submit()).state,'denied');assert.equal(prod.calls.sdk,0);assert.equal(await prod.held(),null);
  const stale=await fixture(t);const post=stale.source.postMessage;stale.source.postMessage=async message=>{const result=await post(message);if(message.type==='streamEnd')stale.revoke();return result;};
  assert.equal((await stale.submit()).state,'outcome_unknown');assert.equal(stale.calls.sdk,1);
});


test('queued native Send keeps synchronous admission and cannot be overtaken by prepared verification',async t=>{
  const gate=deferred(),entered=deferred(),f=await fixture(t,{verify:async()=>{entered.resolve();await gate.promise;}});
  const prepared=f.submit();await entered.promise;
  const seen=[];f.h.rememberTurnRequest=text=>{seen.push(text);throw Error('ordinary admission checkpoint');};f.h.missingFolderApplies=()=>false;
  const native=f.h.handleMessage({type:'sendMessage',activityId:'activity-a',taskId:f.store.getView().activeTaskId,text:'native queued',history:[],userMessageId:'native'},f.source);
  assert.equal(f.h.pendingSends,2);assert.equal(seen.length,0);gate.resolve();
  assert.equal((await prepared).state,'denied');await native;assert.deepEqual(seen,['native queued']);assert.equal(f.calls.sdk,0);assert.equal(f.h.pendingSends,0);
});

test('caller abort during SDK turn stays unknown and never replays',async t=>{
  const f=await fixture(t,{write:false,onQuery:async f=>f.signal.abort()});
  assert.equal((await f.submit()).state,'outcome_unknown');assert.equal(f.calls.sdk,1);assert.equal((await f.submit()).state,'denied');assert.equal(f.calls.sdk,1);assert.equal(await readFile(f.file,'utf8'),f.original);
});

test('actual provider revalidates all reservation fields before SDK writes and after approval',async t=>{
  for(const field of ['grantId','turnId','requestHash','authorityDigest']){
    const f=await fixture(t,{denyWrite:true,onQuery:async f=>{f.authorityPatch={[field]:'changed'};}});
    assert.notEqual((await f.submit()).state,'completed',field);assert.equal(f.deniedWrite,true,field);
    assert.equal(f.calls.approval,0);assert.equal(await readFile(f.file,'utf8'),f.original);
    await f.submit();assert.equal(f.calls.sdk,1,'changed reservation cannot replay');
  }
  const f=await fixture(t,{denyWrite:true,onApproval:async f=>{f.authorityPatch={authorityDigest:'changed-after-approval'};}});
  assert.notEqual((await f.submit()).state,'completed');assert.equal(f.deniedWrite,true);
  assert.equal(f.calls.approval,1);assert.equal(await readFile(f.file,'utf8'),f.original);
});


test('prepared turn completes final draft review before its own UI streamStart changes real composer readiness',async t=>{
  const f=await fixture(t,{realStreamReadiness:true});const result=await f.submit();
  assert.equal(result.state,'completed',f.errors.join('\n'));assert.equal(f.calls.sdk,1);
  const start=f.posts.findIndex(p=>p.type==='streamStart'),capture=f.posts.map((p,i)=>p.type==='companionDraftCapture'?i:-1).filter(i=>i>=0);
  assert(start>=0 && capture.length>=3 && capture.every(i=>i<start),'all required UI reviews finish before prepared stream announcement');
  assert.equal((await f.held()).authoringExecution.state,'bound');assert.equal(f.ui.text,'');
});
test('real composer image-preparation block still denies a prepared turn before any local reservation or SDK',async t=>{
  const f=await fixture(t,{realStreamReadiness:true,uiBlocked:true});const result=await f.submit();
  assert.equal(result.state,'denied');assert.equal(f.calls.sdk,0);assert.equal(await f.held(),null);assert.equal(f.posts.some(p=>p.type==='streamStart'),false);assert.equal(f.h.pendingSends,0);assert.equal(f.h.activeStreams.size,0);
});


test('prepared failure after internal stream setup but before announcement releases busy state and keeps draft/history',async t=>{
  const f=await fixture(t,{realStreamReadiness:true});f.h.beginTurnRestore=async()=>null;
  const before=JSON.stringify(f.history),result=await f.submit();assert.equal(result.state,'outcome_unknown');assert.equal(f.calls.sdk,0);
  assert.equal(f.posts.some(p=>p.type==='streamStart'||p.type==='inputRejected'||p.type==='companionDraftApply'),false);
  assert.equal(f.h.pendingSends,0);assert.equal(f.h.activeStreams.size,0);assert.equal(f.h.turnTimelines.size,0);
  assert.equal(f.ui.text,'');assert.equal(JSON.stringify(f.history),before);assert.equal((await f.held()).authoringExecution.state,'prepared');
});
test('ordinary Send still announces its stream before restore setup and cleans up a later refusal',async t=>{
  const f=await fixture(t);f.h.isLearningWikiEnabled=()=>false;f.h.pullQuestResultFromPreview=async()=>null;f.h.takeProjectSwitchBrief=()=>null;f.h.dropPageAttachment=()=>{};f.h.elementQueue.take=()=>null;f.h.verifySession.takeCoachContext=()=>undefined;f.h.recordLearnerUploads=()=>{};
  let reached=false;f.h.beginTurnRestore=async()=>{reached=true;assert.equal(f.posts.filter(p=>p.type==='streamStart').length,1);throw Error('ordinary restore boundary');};
  await assert.rejects(f.h.handleSend('ordinary request',[]),/ordinary restore boundary/);assert.equal(reached,true);assert.equal(f.h.pendingSends,0);assert.equal(f.h.activeStreams.size,0);
});


// Normal quit must preserve the admitted request and received bytes before an
// SDK that is still unwinding can settle. Reload another real store, not a UI mirror.
for (const ordinary of [true,false]) for (const partial of ['', 'actual partial before normal quit']) {
  test(`normal shutdown preserves ${ordinary?'ordinary':'prepared'} admitted history (${partial?'partial':'no delta'}) before SDK unwind`, async t=>{
    const entered=deferred(),unwind=deferred();
    const f=await fixture(t,{ordinary,partial,lifecycle:true,write:false,onQuery:async()=>{entered.resolve();await unwind.promise;},onUnwind:()=>unwind.promise});
    let settled=false;const running=(ordinary?f.submitOrdinary():f.submit()).finally(()=>{settled=true;});
    try {
      await Promise.race([entered.promise,running.then(()=>{throw Error('SDK entry missing: '+f.errors.join('\n'));})]);
      const admitted=(await f.reload()).getHistory(),user=admitted.find(m=>m.id===f.request.requestId);
      assert(user,'admitted user must already be durable before a held runner can end');
      assert.equal(user.content,f.request.text);assert.equal(admitted.filter(m=>m.id===user.id).length,1);
      f.dispose();assert.equal(f.sdkArgs.signal.aborted,true,'actual panel disposal aborts before deactivate');
      await f.h.preserveHistoryForShutdown();
      assert.equal(f.sdkArgs.signal.aborted,true);assert.equal(settled,false,'shutdown persistence does not await SDK unwind');
      const saved=(await f.reload()).getHistory();
      assert.equal(saved.filter(m=>m.id===user.id).length,1);assert.equal(saved.find(m=>m.id===user.id).content,user.content);
      const answers=saved.filter(m=>m.role==='assistant');assert.equal(answers.length,partial?1:0);
      if(partial)assert.equal(answers[0].content,partial);
      const frozen=JSON.stringify(saved);
      await f.h.preserveHistoryForShutdown();assert.equal(JSON.stringify((await f.reload()).getHistory()),frozen,'repeat shutdown is idempotent');
      if(!ordinary){assert.equal((await f.held()).authoringRun.state,'outcome_unknown');assert.equal(f.posts.some(p=>p.type==='inputRejected'||p.type==='companionDraftApply'),false);}
      unwind.resolve();await running;
      assert.equal(JSON.stringify((await f.reload()).getHistory()),frozen,'late SDK completion cannot add/replace the frozen interrupted conversation');
      assert.equal(f.calls.sdk,1);assert.equal(f.h.pendingSends,0);
      if(!ordinary){assert.equal((await f.held()).authoringRun.state,'outcome_unknown');assert.equal((await f.submit()).state,'denied','closed owner rejects a duplicate instead of replaying an unknown turn');}
      assert.equal(f.calls.sdk,1);
    }finally{unwind.resolve();await running;}
  });
}

test('admitted history write failure and stale owner prevent SDK entry without importing a phone draft',async t=>{
  for(const ordinary of [true,false])for(const mode of ['io','owner']){
    const f=await fixture(t,{ordinary,write:false});
    const append=f.store.append.bind(f.store);
    f.store.append=async(...args)=>{if(mode==='io')throw Error('synthetic private disk failure');f.h.opsGeneration++;return append(...args);};
    await (ordinary?f.submitOrdinary():f.submit());
    assert.equal(f.calls.sdk,0);assert.equal((await f.reload()).getHistory().length,0);
    if(!ordinary)assert.equal(f.posts.some(p=>p.type==='inputRejected'||p.type==='companionDraftApply'),false);
    else assert.equal(f.posts.some(p=>p.type==='inputRejected'&&p.text===f.request.text),mode==='io','only the current ordinary composer recovers unsaved input');
  }
});

test('shutdown refuses a stale task owner and never writes interrupted bytes into the replacement task',async t=>{
  for(const ordinary of [true,false]){
    const entered=deferred(),unwind=deferred();const f=await fixture(t,{ordinary,write:false,partial:'old task partial',onQuery:async()=>{entered.resolve();await unwind.promise;},onUnwind:()=>unwind.promise});
    const running=ordinary?f.submitOrdinary():f.submit();
    try{
      await Promise.race([entered.promise,running.then(()=>{throw Error('SDK entry missing: '+f.errors.join('\n'));})]);const oldTask=f.store.getView().activeTaskId;
      f.h.opsGeneration++;
      await assert.rejects(f.h.preserveHistoryForShutdown(),/저장하지 못했습니다/);
      assert.equal((await f.reload()).getHistory(oldTask).filter(m=>m.role==='assistant').length,0,'stale snapshot is not committed');
      unwind.resolve();await running.catch(error=>assert.match(error.message,/작업이 바뀌었어요/));
      assert.equal((await f.reload()).getHistory(oldTask).filter(m=>m.role==='assistant').length,0,'late finally remains fenced');
    }finally{unwind.resolve();await running.catch(()=>{});}
  }
});


test('ordinary terminal completion upserts the admitted user once and uses only the prior model history',async t=>{
  const f=await fixture(t,{ordinary:true,write:false});await f.submitOrdinary();
  const saved=(await f.reload()).getHistory();assert.equal(saved.filter(m=>m.id===f.request.requestId).length,1);
  assert.equal(saved.filter(m=>m.role==='assistant').length,1);assert.equal(f.sdkArgs.history.length,0);
  const before=JSON.stringify(saved);await f.h.preserveHistoryForShutdown();
  assert.equal(JSON.stringify((await f.reload()).getHistory()),before,'already committed terminal answer remains unchanged');
});

test('actual deactivate joins interrupted-history persistence and spool close, including one failed write',async()=>{
  const src=await readFile(new URL('../src/extension.ts',import.meta.url),'utf8');
  const start=src.indexOf('export function deactivate() {'),end=src.indexOf('\n}',start)+2;
  assert(start>=0&&end>start);const body=src.slice(start,end).replace('export function','function');
  for(const fail of [false,true]){
    const history=deferred(),spool=deferred();let historyCalled=0,spoolCalled=0,power=0,settled=false;
    const context={providerRef:{preserveHistoryForShutdown:()=>{historyCalled++;return fail?Promise.reject(Error('synthetic save failure')):history.promise;}},
      spoolRef:{close:reason=>{assert.equal(reason,'shutdown');spoolCalled++;return spool.promise;}},workPower:{dispose:()=>power++}};
    const run=vm.runInNewContext(body+';deactivate',context)();
    const observed=run.then(()=>{settled=true;},error=>{settled=true;return error;});
    assert.equal(historyCalled,1);assert.equal(spoolCalled,1);assert.equal(power,1);
    await Promise.resolve();await Promise.resolve();assert.equal(settled,false,'deactivate waits for spool even if preservation failed');
    spool.resolve();await Promise.resolve();await Promise.resolve();
    if(!fail){assert.equal(settled,false,'spool completion alone cannot discard pending history');history.resolve();}
    const error=await observed;if(fail)assert.match(error.message,/저장하지 못했습니다/);
  }
});


test('guarded edit-history append cannot commit its version sidecar after ownership revocation during temp close',async t=>{
  let armed=false,revoked=false;
  const f=await fixture(t,{beforeClose:(f,path)=>{if(armed&&path.startsWith(f.store.versionsPath+'.tmp-')){revoked=true;f.revoke();}}});
  const task=f.store.getView().activeTaskId;
  await f.store.append(task,[{id:'original-u',role:'user',content:'original request',createdAt:1},{id:'original-a',role:'assistant',content:'original answer',createdAt:2}]);
  const before=JSON.stringify((await f.reload()).getHistory());armed=true;
  await assert.rejects(f.store.append(task,[{id:'edited-u',role:'user',content:'edited request',editOf:'original-u',createdAt:3}],()=>!revoked));
  assert.equal(revoked,true,'actual awaited sidecar temp-file close exercised');
  assert.equal(JSON.stringify((await f.reload()).getHistory()),before,'main and version history remain unchanged');
  await assert.rejects(readFile(f.store.versionsPath),{code:'ENOENT'});
});


// ExtensionHost's actual ordering: invoke deactivate, synchronously dispose the
// context subscriptions, then await the returned Promise. Closing execution
// authority must not discard an already-admitted snapshot in the store queue.
for(const ordinary of [true,false])test(`host subscription disposal preserves queued ${ordinary?'ordinary':'prepared'} shutdown snapshot`,async t=>{
  const entered=deferred(),unwind=deferred(),writes=deferred();
  const f=await fixture(t,{ordinary,lifecycle:true,partial:'received before execution owner closes',write:false,onQuery:async()=>{entered.resolve();await unwind.promise;},onUnwind:()=>unwind.promise});
  const running=ordinary?f.submitOrdinary():f.submit();
  try{
    await Promise.race([entered.promise,running.then(()=>{throw Error('SDK not entered');})]);
    const admitted=(await f.reload()).getHistory(),before=JSON.stringify(admitted);
    f.store.queue=f.store.queue.then(()=>writes.promise);
    const src=await readFile(new URL('../src/extension.ts',import.meta.url),'utf8');
    const start=src.indexOf('export function deactivate() {'),end=src.indexOf('\n}',start)+2;
    const subscription=src.split('\n').find(line=>line.includes('context.subscriptions.push({ dispose:')&&line.includes('companionDev?.dispose()'));
    assert(subscription,'actual companion subscription disposal must be represented');
    const context={subscriptions:[]};const noLongerCurrent=()=>f.revoke();
    vm.runInNewContext(subscription,{context,provider:f.h,invalidate:()=>{},companionDev:{dispose:noLongerCurrent}});
    const deactivate=vm.runInNewContext(src.slice(start,end).replace('export function','function')+';deactivate',{
      providerRef:f.h,spoolRef:{close:async()=>{}},workPower:{dispose(){}}});
    let settled=false;const exiting=deactivate().finally(()=>{settled=true;});
    f.dispose();for(const item of context.subscriptions)item.dispose();
    assert.equal(f.input.current(),false,'native execution lease really closed');assert(f.sdkArgs.signal.aborted);
    await Promise.resolve();assert.equal(settled,false,'snapshot remains queued while execution is revoked');
    assert.equal(JSON.stringify((await f.reload()).getHistory()),before);
    writes.resolve();await exiting;
    const saved=(await f.reload()).getHistory();assert.equal(saved.filter(m=>m.id===f.request.requestId).length,1);
    assert.equal(saved.filter(m=>m.role==='assistant').length,1);assert.equal(saved.find(m=>m.role==='assistant').content,'received before execution owner closes');
    const frozen=JSON.stringify(saved);unwind.resolve();await running;
    assert.equal(JSON.stringify((await f.reload()).getHistory()),frozen);assert.equal(f.calls.sdk,1);
  }finally{writes.resolve();unwind.resolve();await running.catch(()=>{});}
});

test('shutdown storage-only lease still rejects a real replacement task or profile owner before queued commit',async t=>{
  for(const change of ['task','profile']){
    const entered=deferred(),unwind=deferred(),writes=deferred();
    const f=await fixture(t,{partial:'old owner bytes',write:false,onQuery:async()=>{entered.resolve();await unwind.promise;},onUnwind:()=>unwind.promise});
    const running=f.submit();
    try{
      await Promise.race([entered.promise,running.then(()=>{throw Error('SDK not entered');})]);
      const task=f.store.getView().activeTaskId;
      f.store.queue=f.store.queue.then(()=>writes.promise);
      const exiting=f.h.preserveHistoryForShutdown();
      const rejected=assert.rejects(exiting,/저장하지 못했습니다/);
      f.revoke();
      if(change==='profile')f.h.profileGeneration++;
      else{const replacement=await f.reload(),view=replacement.getView();await replacement.create('replacement owner',{taskId:view.activeTaskId,revision:view.revision});f.h.taskWorkspace={activityId:'activity-a',store:replacement};}
      writes.resolve();await rejected;
      const restored=await f.reload();assert.equal(restored.getHistory(task).filter(m=>m.role==='assistant').length,0);
      if(change==='task')assert.equal(restored.getHistory().length,0,'replacement task receives no old bytes');
      unwind.resolve();await running;assert.equal((await f.reload()).getHistory(task).filter(m=>m.role==='assistant').length,0);
    }finally{writes.resolve();unwind.resolve();await running.catch(()=>{});}
  }
});


test('active prepared execution Stop preserves admitted partial history after lease close without shutdown',async t=>{
  const entered=deferred(),unwind=deferred();
  const f=await fixture(t,{partial:'received before explicit active Stop',write:false,onQuery:async()=>{entered.resolve();await unwind.promise;},onUnwind:()=>unwind.promise});
  const running=f.submit();
  try{
    await Promise.race([entered.promise,running.then(()=>{throw Error('SDK not entered');})]);
    const before=(await f.reload()).getHistory(),user=before.find(m=>m.id===f.request.requestId);assert(user);
    // Same order as execution.close: revoke the native lease, then abort its
    // admitted signal. Do not invoke preserveHistoryForShutdown in this case.
    f.revoke();f.signal.abort();assert.equal(f.input.current(),false);assert(f.sdkArgs.signal.aborted);
    assert.equal(!!f.h.shuttingDown,false,'this is explicit Stop, not extension shutdown');
    unwind.resolve();const result=await running;assert.equal(result.state,'outcome_unknown');
    const saved=(await f.reload()).getHistory();assert.equal(saved.filter(m=>m.id===user.id).length,1);
    assert.equal(saved.find(m=>m.id===user.id).content,user.content);
    const answer=saved.filter(m=>m.role==='assistant');assert.equal(answer.length,1);assert.equal(answer[0].content,'received before explicit active Stop');
    assert.equal((await f.held()).authoringRun.state,'outcome_unknown');
    const frozen=JSON.stringify(saved);assert.equal((await f.submit()).state,'denied');assert.equal(f.calls.sdk,1);
    assert.equal(JSON.stringify((await f.reload()).getHistory()),frozen,'denied replay cannot replace interrupted history');
    assert.equal(f.posts.some(p=>p.type==='inputRejected'||p.type==='companionDraftApply'),false);
  }finally{unwind.resolve();await running.catch(()=>{});}
});


test('failed interrupted snapshot retry retains its original storage owner, including profile changes',async t=>{
  for(const change of [false,true]){
    let append;
    const f=await fixture(t,{partial:'partial retained after transient I/O',write:false,onQuery:async f=>{
      append=f.store.append.bind(f.store);f.store.append=async()=>{throw Error('synthetic snapshot I/O failure');};
      f.revoke();f.signal.abort();
    }});
    // Use the actual fallback method as well: an unfenced retry must not pass
    // merely because this prepared fixture's transcript mirror is in memory.
    f.h.appendHistory=items=>Object.getPrototypeOf(f.h).appendHistory.call(f.h,items);
    const result=await f.submit();assert.equal(result.state,'outcome_unknown');assert(f.h.interruptedHistory);
    assert.equal((await f.reload()).getHistory().filter(m=>m.role==='assistant').length,0);
    f.store.append=append;
    if(change){f.h.profileGeneration++;await assert.rejects(f.h.retryInterruptedHistory(),/저장하지 못했습니다/);}
    else await f.h.retryInterruptedHistory();
    const saved=(await f.reload()).getHistory();assert.equal(saved.filter(m=>m.role==='assistant').length,change?0:1);
    if(!change)assert.equal(saved.find(m=>m.role==='assistant').content,'partial retained after transient I/O');
    assert.equal(f.calls.sdk,1);
  }
});
