// Native UI + real SDK/Service, with explicitly scripted provider responses only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {waitFor,sleep} from './native-ui.mjs';
import {scriptedState,releaseScriptedTurn,revokeSyntheticB} from './session-control.mjs';
import {markerText,replyText} from './scripted-upstream.mjs';
import {coreCommandLabel} from '../fixtures/shell-labels.mjs';
const blocked=message=>Object.assign(Error(message),{blocked:true});
export function historyMarkers(rows){
 const counts={};for(const name of ['A1','D2','STOP_HOLD','QUIT_HOLD','FILE_HOLD'])counts[name]={user:rows.filter(r=>r.role==='user'&&r.text.includes(markerText(name))).length,assistant:rows.filter(r=>r.role==='assistant'&&r.text.includes(replyText(name))).length};return counts;
}
const HELD=['STOP_HOLD','QUIT_HOLD','FILE_HOLD'];
const assistantRowsAfterUser=(rows,id)=>{
 const from=rows.findIndex(row=>row.role==='user'&&row.id===id);assert(from>=0,'Original interrupted user required');
 const next=rows.findIndex((row,index)=>index>from&&row.role==='user');
 return rows.slice(from+1,next<0?undefined:next).filter(row=>row.role==='assistant'&&row.text.trim());
};
export function captureInterruptedHistory(rows,name){
 assert(HELD.includes(name),'Known interrupted fixture turn required');
 const result={assistant:null};
 for(const role of ['user','assistant']){
  const text=role==='user'?markerText(name):replyText(name),matches=role==='assistant'?assistantRowsAfterUser(rows,result.user.id):rows.filter(row=>row.role===role&&row.text.includes(text));
  assert(matches.length<2,'At most one observed interrupted '+role+' '+name);
  if(role==='assistant'&&matches.length===0)continue;
  assert.equal(matches.length,1,'One observed interrupted '+role+' '+name);
  assert.equal(matches[0].text,text,'Exact interrupted '+role+' bytes '+name);
  assert.equal(typeof matches[0].id,'string');assert(matches[0].id.length>0,'Actual message identity required');
  result[role]={id:matches[0].id,text};
 }
 if(result.assistant)assert.notEqual(result.user.id,result.assistant.id,'Distinct user and assistant identities required');return result;
}
export function assertInterruptedHistory(rows,names,interrupted={},requireStopped){
 assert(names.every(name=>['A1','D2'].includes(name))&&new Set(names).size===names.length,'Only exact completed fixture turns may be claimed');
 assert(Object.keys(interrupted).every(name=>HELD.includes(name)),'Known interrupted turns only');
 assert(!requireStopped||Object.hasOwn(interrupted,requireStopped),'Stopped receipt requires an observed interrupted turn');
 const counts=historyMarkers(rows);
 for(const name of ['A1','D2',...HELD])for(const role of ['user','assistant']){
  const expected=names.includes(name)||(Object.hasOwn(interrupted,name)&&!!interrupted[name][role])?1:0;
  assert.equal(counts[name][role],expected,'Exact persisted '+role+' occurrence '+name);
  if(expected){const text=role==='user'?markerText(name):replyText(name),row=rows.find(row=>row.role===role&&row.text.includes(text));
   assert.equal(row.text,text,'Exact persisted '+role+' bytes '+name);
   if(Object.hasOwn(interrupted,name)){
    assert.equal(row.id,interrupted[name][role].id,'Original interrupted '+role+' identity '+name);
    assert.equal(row.text,interrupted[name][role].text,'Frozen interrupted '+role+' bytes '+name);
    if(role==='assistant'){
     // Elapsed receipts belong to this mount, not stored history. Never invent one after reload.
     if(row.receipt)assert.match(row.receipt,/^\d+(?:분(?: \d+초)?|초) 뒤 멈췄어요$/,'Interrupted answer cannot claim completion');
     if(name===requireStopped)assert(row.receipt,'Explicit Stop must render its observed stopped receipt');
    }
   }
  }
 }
 for(const snapshot of Object.values(interrupted)){
  const assistants=assistantRowsAfterUser(rows,snapshot.user.id);
  assert.equal(assistants.length,snapshot.assistant?1:0,'No extra assistant may appear in an interrupted turn');
 }
 return counts;
}
export const assertCompletedHistory=(rows,names)=>assertInterruptedHistory(rows,names);
// Read only the spoken body; omit the actual classroom streaming prelude from a detached copy.
export const HISTORY_ROWS_EXPRESSION=`[...document.querySelectorAll('.hps-msg-user,.hps-msg-assistant')].map(e=>{
 const body=e.querySelector('.hps-msg-body')?.cloneNode(true);
 body?.querySelectorAll('.hps-code-progress-prelude').forEach(node=>node.remove());
 const user=e.classList.contains('hps-msg-user'),spoken=user||body?.querySelector('.hps-prose,.hps-codepill,.hps-stream-note,.hps-code-progress');
 return {id:e.getAttribute('data-message-id'),role:user?'user':'assistant',text:spoken?(body?.textContent?.trim()??''):'',receipt:(e.querySelector('.hps-turn-elapsed')??(e.nextElementSibling?.matches('.hps-turn-elapsed')?e.nextElementSibling:null))?.textContent??null};
})`;
export async function awaitUpstreamClosure(read,serviceSeq,timeout=10000){
 return waitFor(async()=>{const state=await read();return state.rows.find(row=>row.service_seq===serviceSeq&&row.client_closed===true&&row.state==='upstream_socket_closed'&&!row.fixture_finish);},'exact upstream socket closure before fixture cleanup',timeout);
}
export async function runHistoryStreaming(ctx){
 const {c,ui,step,report,draft,start,focusChat,readDraft,nativeOpenBoundFolder,workspaceFiles,save,control,restart}=ctx;
 const passed=id=>report.tests.some(t=>t.id===id&&t.status==='PASS');
 const need=id=>{if(!passed(id))throw blocked('Scripted followup requires observed '+id);};
 const history=async()=>{const chat=await ui.frame('.hps-input textarea');return chat.evaluate(HISTORY_ROWS_EXPRESSION);};
 const interrupted={};
 const capture=async name=>{interrupted[name]=captureInterruptedHistory(await history(),name);};
 const state=()=>scriptedState(control);
 const bound=async()=>{const value=await state();assert.equal(value.provider_called,false);assert.equal(value.request_limit,12);assert.equal(value.output_cap,4096);assert(value.rows.every(r=>r.attempt<=12&&(!r.max_tokens||r.max_tokens<=4096)));assert.equal(value.rejections.length,0,'Fixture refusals cannot be hidden as a successful turn');return value;};
 const openFolder=async folder=>{await ui.palette(coreCommandLabel('workbench.action.files.openFolder'));await ui.ownedOpenFolder(folder+path.sep);await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(folder)),'public File Open Folder actual destination',60000);};
 const send=async(name,held=false)=>{const before=await bound(),chat=await focusChat();await ui.input(chat,'.hps-input textarea',markerText(name));await ui.key(chat,'Enter');await waitFor(()=>chat.evaluate("!!document.querySelector('.hps-btn-stop')"),'actual native stream Stop visible',45000);
  await waitFor(async()=>{const value=await state();return value.rows.some(r=>r.attempt>(before.counts.A??0)&&r.subject==='A'&&r.marker===name&&r.state===(held?'streaming':'complete'));},'actual SDK → actual Service → scripted upstream '+name,60000);
  if(!held){await waitFor(()=>chat.evaluate(`!document.querySelector('.hps-btn-stop')&&[...document.querySelectorAll('.hps-msg-assistant')].some(e=>e.textContent.includes(${JSON.stringify(replyText(name))}))`),'actual completed scripted assistant rendered');assert.equal(await chat.evaluate("document.querySelectorAll('.hps-error-banner').length"),0);}
 };
 const originalFiles=workspaceFiles(c.workspace.a),bindings=path.join(c.userDataDir,'User/globalStorage/hypeproof.hypeproof-chat/activity-bindings');
 const finishHeld=async(name)=>{
  const upstream=(await bound()).rows.find(r=>r.marker===name);assert(upstream,'Actual held upstream required');
  const linked=async()=>{const response=await fetch(c.service.origin+'/__feedback-native/requests',{redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json();};
  let serviceRow,observed,failure;
  try{
   serviceRow=await waitFor(async()=>{const value=await linked();assert.equal(value.provider_called,false);assert.equal(value.blocked_outbound,0);return value.calls.find(r=>r.seq===upstream.service_seq&&r.client_closed&&r.service_body_cancelled);},'exact client disconnect and Service body cancellation',10000);
   observed=await awaitUpstreamClosure(bound,upstream.service_seq);
  }catch(error){failure=error;observed=(await bound()).rows.find(r=>r.service_seq===upstream.service_seq);}
  const layers={marker:name,service_seq:upstream.service_seq,service_request_id:serviceRow?.request_id??null,usage_request_id:serviceRow?.usage_request_id??null,request_class:serviceRow?.request_class??null,client_disconnected:serviceRow?.client_closed===true,service_body_cancelled:serviceRow?.service_body_cancelled===true,upstream_socket_closed:observed?.client_closed===true&&observed.state==='upstream_socket_closed'&&!observed.fixture_finish,upstream_cancel:failure?'NOT_PROPAGATED':'OBSERVED',cleanup_is_not_cancel_proof:true};
  (report.cancellation_layers??=[]).push(layers);save();
  try{
   if(failure)throw failure;
   assert(layers.client_disconnected&&layers.service_body_cancelled&&layers.upstream_socket_closed,'All exact linked cancellation layers must be observed');
  }finally{
   if(!layers.upstream_socket_closed)try{await releaseScriptedTurn(control,name);}catch(error){layers.cleanup_error=error.message;save();}
  }
  return layers;
 };
 await step('T03-native-scripted-history-persistence',async()=>{
  const owner=JSON.parse(fs.readFileSync(path.join(c.userDataDir,'feedback-owner.json'),'utf8'));assert.equal(owner.workspaces.d,c.workspace.d);assert.equal(fs.readdirSync(c.workspace.d).length,0,'History destination D must never have been opened');
  await send('A1');await ui.input(await focusChat(),'.hps-input textarea',draft);
  const before=(await readDraft()).chat.info.id,view=await start();ctx.candidate(true);await ui.savedActivity(view,c.workspace.b);await waitFor(()=>view.evaluate("document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),'saved activity candidate for history');await ui.chooseCandidateFolder(view,c.workspace.d);await ui.press(view,'.studio-primary');
  await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.d)),'history destination D real reload',60000);
  const moved=await ui.frame('.hps-input textarea',60000);assert.notEqual(moved.info.id,before);ctx.candidate(false);report.latest_activity_a_saved_workspace=c.workspace.d;save();
  assertCompletedHistory(await history(),['A1']);await send('D2');const dDraft=draft+'-history-D';await ui.input(await focusChat(),'.hps-input textarea',dDraft);
  assert.equal((await nativeOpenBoundFolder(c.workspace.a)).value,draft);assertCompletedHistory(await history(),['A1']);
  assert.equal((await nativeOpenBoundFolder(c.workspace.d)).value,dDraft);assertCompletedHistory(await history(),['A1','D2']);
  assert.equal((await nativeOpenBoundFolder(c.workspace.a)).value,draft);const counts=assertCompletedHistory(await history(),['A1']);
  const rows=(await bound()).rows;assert(rows.some(r=>r.marker==='D2'&&r.markers.A1&&r.markers.D2),'Actual SDK upstream prompt includes carried history');assert.deepEqual(workspaceFiles(c.workspace.a),originalFiles);
  report.history='PASS_SCRIPTED_NATIVE_SELECTED_PERSISTENCE';return {native_turn_entry:true,actual_sdk:true,synthetic_upstream:true,source_history_carried:true,destination_history_wins:true,exact_occurrences:counts,provider_called:false};
 });
 await step('T06-native-stream-block-and-stop',async()=>{
  need('T03-native-scripted-history-persistence');await send('STOP_HOLD',true);await capture('STOP_HOLD');const unsent=draft+'-during-stop';await ui.input(await focusChat(),'.hps-input textarea',unsent);
  const beforeBindings=workspaceFiles(bindings),view=await start();await ui.clickText(view,'작업 폴더 열기');await waitFor(()=>view.evaluate("document.querySelector('#connection-error')?.textContent.includes('진행 중인 작업을 마치거나 중지한 후 활동을 변경하세요.')"),'actual active-stream navigation refusal');
  assert(String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)));assert.deepEqual(workspaceFiles(bindings),beforeBindings);await ui.shot(path.join(c.evidence,'stream-navigation-refused.png'));
  const chat=await focusChat();assert.equal((await readDraft()).value,unsent);await ui.press(chat,'.hps-btn-stop');await waitFor(()=>chat.evaluate("!document.querySelector('.hps-btn-stop')&&[...document.querySelectorAll('.hps-stop-notice')].some(e=>e.textContent.includes('답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요.'))"),'actual Stop acknowledged and idle');assert.equal((await readDraft()).value,unsent);
  assertInterruptedHistory(await history(),['A1'],interrupted,'STOP_HOLD');
  const cancellation=await finishHeld('STOP_HOLD'),before=(await bound()).counts.A;await nativeOpenBoundFolder(c.workspace.d);await nativeOpenBoundFolder(c.workspace.a);assert.equal((await readDraft()).value,unsent);assertInterruptedHistory(await history(),['A1'],interrupted);await sleep(10000);assert.equal((await bound()).counts.A,before,'Stop/navigation must not dispatch duplicates');
  return {active_stream_refused_navigation:true,actual_stop_acknowledged:true,partial_assistant_observed:!!interrupted.STOP_HOLD.assistant,stopped_receipt_observed_before_navigation:!!interrupted.STOP_HOLD.assistant,unsent_draft_preserved:true,completed_history_preserved:true,interrupted_history_preserved:true,no_duplicate_dispatch_window_ms:10000,cancellation,provider_called:false};
 });
 await step('T06-native-stream-normal-quit-recovery',async()=>{
  need('T06-native-stream-block-and-stop');await send('QUIT_HOLD',true);await capture('QUIT_HOLD');const unsent=draft+'-during-quit';await ui.input(await focusChat(),'.hps-input textarea',unsent);const before=(await bound()).counts.A;
  const processProof=await restart(unsent);assertInterruptedHistory(await history(),['A1'],interrupted);const cancellation=await finishHeld('QUIT_HOLD');await sleep(10000);assert.equal((await bound()).counts.A,before,'Restart must not resume or duplicate interrupted model execution');
  await ui.shot(path.join(c.evidence,'stream-quit-restored.png'));return {...processProof,completed_history_restored:true,interrupted_history_preserved:true,interrupted_execution_replayed:false,no_duplicate_dispatch_window_ms:10000,cancellation,provider_called:false};
 });
 await step('T06-native-stream-direct-file-open',async()=>{
  need('T06-native-stream-normal-quit-recovery');if((await bound()).counts.A>=12)throw blocked('Same activity attempt ceiling leaves no room; no reissue/reset');
  await send('FILE_HOLD',true);await capture('FILE_HOLD');const unsent=draft+'-during-file-open';await ui.input(await focusChat(),'.hps-input textarea',unsent);const before=(await bound()).counts.A;
  await openFolder(c.workspace.d);await ui.frame('.hps-input textarea',60000);assertCompletedHistory(await history(),['A1','D2']);const cancellation=await finishHeld('FILE_HOLD');
  await openFolder(c.workspace.a);await ui.frame('.hps-input textarea',60000);assert.equal((await readDraft()).value,unsent,'Direct File Open preserves in-flight unsent draft');assertInterruptedHistory(await history(),['A1'],interrupted);await sleep(10000);assert.equal((await bound()).counts.A,before,'Direct folder reload must not replay execution');
  await ui.input(await focusChat(),'.hps-input textarea',draft);return {actual_direct_file_open:true,completed_history_restored:true,unsent_draft_preserved:true,no_duplicate_dispatch_window_ms:10000,cancellation,provider_called:false};
 });
 await step('T06-native-revoked-credential-no-auto-execution',async()=>{
  need('T06-native-stream-direct-file-open');const before=await bound(),beforeBindings=workspaceFiles(bindings),filesC=workspaceFiles(c.workspace.c);const callsBefore=await(await fetch(c.service.origin+'/__feedback-native/requests')).json();const bAttempts=calls=>calls.filter(r=>r.subject==='B'&&r.method==='POST'&&['/v1/messages','/v1/messages/count_tokens','/v1/chat/completions'].includes(r.path)).length;const denied=await revokeSyntheticB(control);
  await openFolder(c.workspace.c);const view=await ui.frame('.studio-start',60000);await waitFor(()=>view.evaluate(`document.querySelector('#connection-error')?.textContent.includes(${JSON.stringify(denied.ui_friendly)})`),'actual revoked activity refuses automatic admission');
  assert.equal(await view.evaluate("!!document.querySelector('.studio-course')"),false,'Revoked credential cannot admit activity');await sleep(10000);assert.deepEqual((await bound()).counts,before.counts,'Revoked credential must not reach upstream');const callsAfter=await(await fetch(c.service.origin+'/__feedback-native/requests')).json();assert.equal(bAttempts(callsAfter.calls),bAttempts(callsBefore.calls),'Revoked credential must not even attempt hidden model requests');assert.deepEqual(workspaceFiles(c.workspace.c),filesC);assert.deepEqual(workspaceFiles(bindings),beforeBindings);
  await openFolder(c.workspace.a);await ui.frame('.hps-input textarea',60000);assert.equal((await readDraft()).value,draft);assertInterruptedHistory(await history(),['A1'],interrupted);assert.deepEqual(workspaceFiles(c.workspace.a),originalFiles);
  const ledger=await bound();report.scripted_upstream=ledger;report.sdk_service_requests=await(await fetch(c.service.origin+'/__feedback-native/requests')).json();const requests=report.sdk_service_requests.calls.filter(r=>r.path==='/v1/messages'||r.path==='/v1/messages/count_tokens');report.sdk_auxiliary={status:requests.some(r=>r.request_class&&/title|aux/i.test(r.request_class))?'OBSERVED_REQUEST_CLASS':'NOT_OBSERVED',count_tokens:requests.filter(r=>r.path.endsWith('/count_tokens')).length,requests:requests.map(({seq,path,status,turn_sha256,request_class,parent_request_id,ledger_request_id,scripted_dispatches})=>({seq,path,status,turn_sha256,request_class,parent_request_id:parent_request_id??null,ledger_request_id:ledger_request_id??null,scripted_dispatches:scripted_dispatches??0}))};report.scripted_model_turns='ACTUAL_SDK_WITH_SCRIPTED_UPSTREAM_NOT_REAL_MODEL';report.streaming='PASS_HOST_SELECTED; upstream cancellation separately recorded';save();
  return {canonical_revoke:true,invalid_activity_denied:true,automatic_model_attempts:0,no_auto_generation_window_ms:10000,a_history_draft_files_preserved:true,upstream_cancel:report.cancellation_layers?.every(x=>x.upstream_socket_closed)?'OBSERVED':'NOT_PROPAGATED',provider_called:false};
 });
}
