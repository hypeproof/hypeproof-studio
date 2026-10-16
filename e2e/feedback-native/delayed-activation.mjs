import {beginFocusObservation} from './focus-diagnostics.mjs';
// Opt-in hosted public-UI scenario. The debugger only delays existing production execution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {activationBreakpoint,freeInspectorPort,OwnedExtensionGate} from './extension-inspector.mjs';
import {selectOwnedBinding} from './native-windows.mjs';
import {waitFor,sleep} from './native-ui.mjs';
import {within,sha256,restartOwnedCandidate} from './safety.mjs';
export const DELAYED_STAGES=Object.freeze([{key:'e',name:'short-propagation',holdMs:2000},{key:'f',name:'slow-valid',holdMs:61000},{key:'g',name:'real-expiry',holdMs:610000}]);
export const EXPIRY_MESSAGE='폴더 전환 확인 시간이 지났습니다. 저장된 활동에서 이어가세요. 작업 파일과 연결은 보존됩니다.';
// A failed scripted scenario may intentionally retain its interrupted draft.
// Never repair it or enter the inspector scenario as if its restoration succeeded.
export function delayedHistoryPrerequisite(c,tests){
 if(!c.scenarios.includes('history-streaming'))return;
 for(const id of ['T03-native-scripted-history-persistence','T06-native-stream-block-and-stop','T06-native-stream-normal-quit-recovery','T06-native-stream-direct-file-open','T06-native-revoked-credential-no-auto-execution']){
  if(!tests.some(t=>t.id===id&&t.status==='PASS'))throw Object.assign(Error('Delayed activation requires observed '+id+' PASS; preserve prior scenario state'),{blocked:true});
 }
}
export function delayedPrerequisite(c,env=process.env){
 if(!c.delayedActivation)return false;
 assert.deepEqual(c.delayedActivation,{enabled:true,inspectorPort:9788},'Exact reviewed hosted inspector configuration required');
 assert(env.GITHUB_ACTIONS==='true'&&env.RUNNER_TEMP&&!c.attach&&c.secretStorage==='os-keychain','Delayed activation requires owned hosted OS credentials');
 assert(c.scenarios.includes('folders')&&c.scenarios.includes('session-ended'),'Keep ordinary continuity and final session checks');
 const runner=fs.realpathSync(env.RUNNER_TEMP),owner=JSON.parse(fs.readFileSync(path.join(c.userDataDir,'feedback-owner.json'),'utf8'));
 assert.equal(owner.receipt,c.candidate.receipt);assert(within(fs.realpathSync(c.userDataDir),runner));
 const all=[c.candidate.app,c.userDataDir,...Object.values(c.workspace)].map(file=>fs.realpathSync(file));assert.equal(new Set(all).size,all.length,'Distinct owned directories required');
 for(const stage of DELAYED_STAGES){const root=c.workspace[stage.key];assert(typeof root==='string'&&path.isAbsolute(root)&&fs.realpathSync(root)===root,'Exact fresh destination root required');assert.equal(owner.workspaces[stage.key],root);assert(within(root,runner));for(const other of all.filter(x=>x!==root))assert(!within(root,other)&&!within(other,root),'Destination aliases another owned directory');assert.equal(fs.readdirSync(root).length,0,'Delayed destination must be initially empty');}
 return true;
}
export function stageObservation(stage,{draft,expectedDraft,notification,startVisible,chatVisible}){
 if(stage.name==='real-expiry'){
  assert.equal(notification,EXPIRY_MESSAGE,'Exact canonical expiry notification required');
  assert.equal(startVisible,true,'Expired resume must show actual Start');assert.equal(chatVisible,false,'Expired resume cannot automatically resume chat');
 }else assert.equal(draft,expectedDraft,'Actual fresh destination must import production checkpoint draft');
}
/** Persist observed facts before either UI or zero-profile assertion can fail. */
export function checkExpiredActivation(item,{notification,startVisible,chatVisible,uiTimes,callsAtPause,callsAfter,baselineAt,releasedAt,observedAt},persist){
 const activationCalls=callsAfter.slice(callsAtPause.length);
 item.expiry_notification=notification;item.start_visible=startVisible;item.no_automatic_chat=chatVisible===false;
 if(uiTimes)item.ui_observed_at_ms={notification:uiTimes.notification,start:uiTimes.start,chat_probe_started:uiTimes.chat_probe_started,chat_probe_finished:uiTimes.chat_probe_finished};
 item.request_boundary={baseline_sampled_at_ms:baselineAt,baseline_count:callsAtPause.length,baseline_last_seq:callsAtPause.at(-1)?.seq??0,released_at_ms:releasedAt,observed_at_ms:observedAt,snapshot_count:callsAfter.length,snapshot_last_seq:callsAfter.at(-1)?.seq??0};
 item.activation_requests=activationCalls.map(({seq,method,path,subject,status,request_id})=>({seq,method,path,subject,status,request_id:request_id??null}));
 item.no_automatic_profile_connection=activationCalls.filter(row=>row.path==='/v1/profile').length===0;
 persist();
 stageObservation(DELAYED_STAGES[2],{notification,startVisible,chatVisible});
 assert.equal(activationCalls.filter(row=>row.path==='/v1/profile').length,0,'Expired resume must not automatically connect/revalidate a profile');
}
// Passive activation must preserve bytes. Explicit saved-activity commit may rotate
// its credential ref, but never the physical root, Service/activity identity or files.
export function checkDelayedDestination({directory,root,service,activityId,binding,files,workspaceFiles,explicitRecovery=false}){
 assert.equal(fs.realpathSync(root),root,'Destination physical root unchanged');
 const current=selectOwnedBinding(directory,root,service,activityId);
 assert.equal(current.file,binding.file,'Destination binding path unchanged');
 if(!explicitRecovery)assert.equal(current.sha256,binding.sha256,'Destination binding preserved before explicit recovery');
 else{const record=JSON.parse(fs.readFileSync(current.file,'utf8'));assert(/^hps\.activity\.credential\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(record.ref),'Explicit recovery must retain a well-formed stored credential reference');}
 assert.deepEqual(workspaceFiles(root),files,'Destination files preserved');return current.sha256;
}
export async function runDelayedActivation({c,ui,app,launch,openFromStart,nativeOpenBoundFolder,readDraft,focusChat,workspaceFiles,activityId,bundleHash,draft,saveProgress,requestCandidate,onGate=()=>{}}){
 delayedPrerequisite(c);
 const resources=process.platform==='darwin'?path.join(c.candidate.app,'Contents/Resources/app'):path.join(c.candidate.app,'resources/app');
 const target=activationBreakpoint(path.join(resources,'extensions/hypeproof-chat/dist/extension.js'),bundleHash);
 await freeInspectorPort(c.delayedActivation.inspectorPort);
 const bindings=path.join(c.userDataDir,'User/globalStorage/hypeproof.hypeproof-chat/activity-bindings'),aFiles=workspaceFiles(c.workspace.a),aBinding=selectOwnedBinding(bindings,fs.realpathSync(c.workspace.a),c.service.origin+'/v1',activityId);
 const proof={scope:'actual hosted public folder transition; debugger-delayed production activation',status:'RUNNING',clock_changed:false,product_state_seeded:false,extension_development_mode:false,provider_calls:0,stages:[],inspector:[],cleanup:'PENDING'};
 const persist=()=>saveProgress(structuredClone(proof));persist();
 let gate,primary,activeStage;
 const serviceCalls=async()=>{const response=await fetch(c.service.origin+'/__feedback-native/requests',{signal:AbortSignal.timeout(5000),redirect:'error'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.provider_called,false);assert(Array.isArray(data.calls));return data.calls;};
 const generationCount=calls=>calls.filter(row=>row.method==='POST'&&['/v1/messages','/v1/messages/count_tokens','/v1/chat/completions'].includes(row.path)).length;
 const generationsBefore=generationCount(await serviceCalls());
 const restart=async extra=>restartOwnedCandidate({config:c,child:app(),expectedDraft:draft,onProgress:item=>{proof.inspector.push({at:new Date().toISOString(),restart:true,...item});persist();},quit:()=>ui.quitOwned(),waitExit:child=>waitFor(()=>child.exitCode!==null||child.signalCode!==null,'normal owned quit before inspector launch',30000),waitCdpDown:async()=>{await waitFor(()=>ui.cdpDown(),'owned renderer endpoint down',30000);ui.close();},launch:()=>launch(extra),observeDraft:()=>ui.restoredDraft(draft)});
 try{
  assert.equal((await readDraft()).value,draft,'A draft before inspector scenario');
  gate=new OwnedExtensionGate({port:c.delayedActivation.inspectorPort,appPid:()=>app()?.pid,target,initialRoot:c.workspace.a,onProgress:item=>{
   proof.inspector.push(item);
   if(item.phase==='pre-consumption-paused'&&activeStage&&item.label===activeStage.name){
    activeStage.files=workspaceFiles(activeStage.root);activeStage.binding=selectOwnedBinding(bindings,fs.realpathSync(activeStage.root),c.service.origin+'/v1',activityId);
    const observedStage=activeStage,stageItem=proof.stages.at(-1);observedStage.callsAtPause=serviceCalls().then(calls=>{observedStage.callsBaselineAt=Date.now();stageItem.request_baseline={sampled_at_ms:observedStage.callsBaselineAt,count:calls.length,last_seq:calls.at(-1)?.seq??0};persist();return calls;});void observedStage.callsAtPause.catch(()=>{});
    proof.stages.at(-1).preservation_baseline='observed while destination paused before consume';
   }
   persist();
  }}).start();
  onGate(gate);
  await restart(['--inspect-brk-extensions='+c.delayedActivation.inspectorPort]);await gate.initial.promise;
  proof.initial_owned_startup=true;persist();
  for(const stage of DELAYED_STAGES){
   const item={name:stage.name,status:'RUNNING',hold_required_ms:stage.holdMs,destination:c.workspace[stage.key]};proof.stages.push(item);persist();
   const root=c.workspace[stage.key],expectedDraft=draft+'-'+stage.name;
   activeStage={root,name:stage.name};
   assert.equal(fs.readdirSync(root).length,0,'Never reuse destination workspace/state');
   const observer=await beginFocusObservation((await readDraft()).chat,activityId);let chat;
   try{chat=await focusChat();}finally{item.focus_diagnostic=await observer.finish();persist();}
   await ui.input(chat,'.hps-input textarea',expectedDraft);await sleep(500);
   const before=(await readDraft()).chat.info.id;let pending,preparedFiles,binding;
   requestCandidate(true);
   await openFromStart(root,true,async()=>{
    // Product commit writes binding/marker after the visible confirmation. This gate never does.
    pending=await gate.prepareTransition(root,stage.holdMs,stage.name);
   });
   assert(pending,'Actual native confirmation did not arm the destination gate');
   item.pause=await pending.finished;requestCandidate(false);assert.equal(sha256(target.file),bundleHash,'Candidate bytes unchanged throughout hold');
   const callsAtPause=await activeStage.callsAtPause;assert(Array.isArray(callsAtPause)&&activeStage.callsBaselineAt<item.pause.released_at_ms,'Service request baseline must finish while destination is paused');
   preparedFiles=activeStage.files;binding=activeStage.binding;assert(preparedFiles&&binding,'Preservation baseline must be observed before consume');
   await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(root)),'actual delayed destination workbench',60000);
   if(stage.name==='real-expiry'){
    let observedNotification;
    await waitFor(async()=>{observedNotification=(await ui.toasts()).find(text=>text.trim()===EXPIRY_MESSAGE);return observedNotification;},'actual expiry notification after real ten-minute hold',30000);
    const notificationAt=Date.now();
    const view=await ui.frame('.studio-start'),visibleStart=await view.evaluate("!!document.querySelector('.studio-start')");
    const startAt=Date.now(),chatProbeAt=Date.now();
    let autoChat=false;try{await ui.frame('.hps-input textarea',1200);autoChat=true;}catch{}
    const chatProbeFinishedAt=Date.now();
    const callsAfter=await serviceCalls();
    checkExpiredActivation(item,{notification:observedNotification.trim(),startVisible:visibleStart,chatVisible:autoChat,uiTimes:{notification:notificationAt,start:startAt,chat_probe_started:chatProbeAt,chat_probe_finished:chatProbeFinishedAt},callsAtPause,callsAfter,baselineAt:activeStage.callsBaselineAt,releasedAt:item.pause.released_at_ms,observedAt:Date.now()},persist);
    await ui.shot(path.join(c.evidence,'delayed-expired-notification.png'));
    item.binding_sha256=checkDelayedDestination({directory:bindings,root,service:c.service.origin+'/v1',activityId,binding,files:preparedFiles,workspaceFiles});item.binding_preserved_before_recovery=true;persist();
    // Explicit public saved-activity recovery, no credential input or host command bridge.
    await ui.savedActivity(view,root);await waitFor(()=>view.evaluate("document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),'expired activity explicit saved selection');
    requestCandidate(true);await ui.press(view,'.studio-primary');await ui.frame('.hps-input textarea',60000);requestCandidate(false);
    assert.equal((await readDraft()).value,'','Expired checkpoint draft must not have been imported into fresh destination');item.expired_draft_not_imported=true;item.explicit_saved_activity_recovery=true;
    item.recovered_binding_sha256=checkDelayedDestination({directory:bindings,root,service:c.service.origin+'/v1',activityId,binding,files:preparedFiles,workspaceFiles,explicitRecovery:true});item.recovered_binding_identity_preserved=true;
   }else{
    const restored=await readDraft();assert.notEqual(restored.chat.info.id,before,'Destination must replace real extension target');stageObservation(stage,{draft:restored.value,expectedDraft});item.fresh_destination_checkpoint_imported=true;
    const w=await ui.workbench(),id=w.info.id;
    for(let i=0;i<10;i++){assert.equal((await ui.workbench()).info.id,id,'No repeated workbench reload');assert.equal((await readDraft()).value,expectedDraft);await sleep(1000);}
    await ui.shot(path.join(c.evidence,'delayed-'+stage.name+'.png'));item.no_ten_second_reload_loop=true;
   }
   if(stage.name!=='real-expiry')item.binding_sha256=checkDelayedDestination({directory:bindings,root,service:c.service.origin+'/v1',activityId,binding,files:preparedFiles,workspaceFiles});
   activeStage=null;const returning=await gate.prepareTransition(c.workspace.a,0,'return-A-'+stage.name);const original=await nativeOpenBoundFolder(c.workspace.a);await returning.finished;
   assert.equal(original.value,expectedDraft,'Explicit native return restores A own persisted draft');
   // Restore the original test draft through real input for the remaining ordinary checks.
   await ui.input(original.chat,'.hps-input textarea',draft);await sleep(500);
   assert.deepEqual(workspaceFiles(c.workspace.a),aFiles,'A files preserved');assert.equal(sha256(aBinding.file),aBinding.sha256,'A binding preserved');
   item.status='PASS';persist();
  }
  await gate.close();proof.cleanup='PASS';gate=null;onGate(null);
  await restart([]);assert.equal((await readDraft()).value,draft,'Ungated ordinary A restoration after scenario');
  assert.equal(generationCount(await serviceCalls()),generationsBefore,'Added gate must cause zero SDK/model/count_tokens dispatches');proof.added_model_requests=0;
  proof.ordinary_launch_restored=true;proof.status='PASS';persist();return proof;
 }catch(error){primary=error;proof.status='FAIL';if(proof.stages.at(-1)?.status==='RUNNING')proof.stages.at(-1).status='FAIL';throw error;}
 finally{
  if(gate){try{await gate.close();proof.cleanup='PASS';}catch(error){proof.cleanup='FAIL';proof.cleanup_error=error.message;if(!primary)throw error;}}
  onGate(null);
  persist();
 }
}
