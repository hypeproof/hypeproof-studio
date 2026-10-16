// Native UI + real SDK/Service, with explicitly scripted provider responses only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {waitFor,sleep} from './native-ui.mjs';
import {scriptedState,releaseScriptedTurn,revokeSyntheticB} from './session-control.mjs';
import {markerText,replyText} from './scripted-upstream.mjs';
const blocked=message=>Object.assign(Error(message),{blocked:true});
export function historyMarkers(rows){
 const counts={};for(const name of ['A1','D2','STOP_HOLD','QUIT_HOLD','FILE_HOLD'])counts[name]={user:rows.filter(r=>r.role==='user'&&r.text.includes(markerText(name))).length,assistant:rows.filter(r=>r.role==='assistant'&&r.text.includes(replyText(name))).length};return counts;
}
export function assertCompletedHistory(rows,names){
 const counts=historyMarkers(rows);for(const name of ['STOP_HOLD','QUIT_HOLD','FILE_HOLD']){assert.equal(counts[name].user,0,'Interrupted turn user must not be replayed into persisted history '+name);assert.equal(counts[name].assistant,0,'Interrupted assistant must not be committed '+name);}for(const name of ['A1','D2']){const expected=names.includes(name)?1:0;assert.equal(counts[name].user,expected,'Exact persisted user occurrence '+name);assert.equal(counts[name].assistant,expected,'Exact persisted assistant occurrence '+name);}return counts;
}
export async function runHistoryStreaming(ctx){
 const {c,ui,step,report,draft,start,focusChat,readDraft,nativeOpenBoundFolder,workspaceFiles,save,control,restart}=ctx;
 const passed=id=>report.tests.some(t=>t.id===id&&t.status==='PASS');
 const need=id=>{if(!passed(id))throw blocked('Scripted followup requires observed '+id);};
 const history=async()=>{const chat=await ui.frame('.hps-input textarea');return chat.evaluate("[...document.querySelectorAll('.hps-msg-user,.hps-msg-assistant')].map(e=>({role:e.classList.contains('hps-msg-user')?'user':'assistant',text:e.textContent}))");};
 const state=()=>scriptedState(control);
 const bound=async()=>{const value=await state();assert.equal(value.provider_called,false);assert.equal(value.request_limit,12);assert.equal(value.output_cap,4096);assert(value.rows.every(r=>r.attempt<=12&&(!r.max_tokens||r.max_tokens<=4096)));assert.equal(value.rejections.length,0,'Fixture refusals cannot be hidden as a successful turn');return value;};
 const openFolder=async folder=>{await ui.palette('File: Open Folder...');await ui.ownedOpenFolder(folder+path.sep);await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(folder)),'public File Open Folder actual destination',60000);};
 const send=async(name,held=false)=>{const before=await bound(),chat=await focusChat();await ui.input(chat,'.hps-input textarea',markerText(name));await ui.key(chat,'Enter');await waitFor(()=>chat.evaluate("!!document.querySelector('.hps-btn-stop')"),'actual native stream Stop visible',45000);
  await waitFor(async()=>{const value=await state();return value.rows.some(r=>r.attempt>(before.counts.A??0)&&r.subject==='A'&&r.marker===name&&r.state===(held?'streaming':'complete'));},'actual SDK → actual Service → scripted upstream '+name,60000);
  if(!held){await waitFor(()=>chat.evaluate(`!document.querySelector('.hps-btn-stop')&&[...document.querySelectorAll('.hps-msg-assistant')].some(e=>e.textContent.includes(${JSON.stringify(replyText(name))}))`),'actual completed scripted assistant rendered');assert.equal(await chat.evaluate("document.querySelectorAll('.hps-error-banner').length"),0);}
 };
 const originalFiles=workspaceFiles(c.workspace.a),bindings=path.join(c.userDataDir,'User/globalStorage/hypeproof.hypeproof-chat/activity-bindings');
 const finishHeld=async(name)=>{
  const upstream=(await bound()).rows.find(r=>r.marker===name);assert(upstream,'Actual held upstream required');
  const linked=async()=>{const response=await fetch(c.service.origin+'/__feedback-native/requests',{redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json();};
  const serviceRow=await waitFor(async()=>{const value=await linked();assert.equal(value.provider_called,false);assert.equal(value.blocked_outbound,0);return value.calls.find(r=>r.seq===upstream.service_seq&&r.client_closed&&r.service_body_cancelled);},'exact client disconnect and Service body cancellation',10000);
  const observed=(await bound()).rows.find(r=>r.service_seq===upstream.service_seq);
  const layers={marker:name,service_seq:upstream.service_seq,service_request_id:serviceRow.request_id,usage_request_id:serviceRow.usage_request_id,request_class:serviceRow.request_class,client_disconnected:true,service_body_cancelled:true,upstream_socket_closed:observed.client_closed===true,upstream_cancel:observed.client_closed?'OBSERVED':'NOT_PROPAGATED',cleanup_is_not_cancel_proof:true};
  (report.cancellation_layers??=[]).push(layers);save();
  if(!observed.client_closed)await releaseScriptedTurn(control,name);
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
  need('T03-native-scripted-history-persistence');await send('STOP_HOLD',true);const unsent=draft+'-during-stop';await ui.input(await focusChat(),'.hps-input textarea',unsent);
  const beforeBindings=workspaceFiles(bindings),view=await start();await ui.clickText(view,'작업 폴더 열기');await waitFor(()=>view.evaluate("document.querySelector('#connection-error')?.textContent.includes('진행 중인 작업을 마치거나 중지한 후 활동을 변경하세요.')"),'actual active-stream navigation refusal');
  assert(String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)));assert.deepEqual(workspaceFiles(bindings),beforeBindings);await ui.shot(path.join(c.evidence,'stream-navigation-refused.png'));
  const chat=await focusChat();assert.equal((await readDraft()).value,unsent);await ui.press(chat,'.hps-btn-stop');await waitFor(()=>chat.evaluate("!document.querySelector('.hps-btn-stop')&&!!document.querySelector('.hps-stop-notice')"),'actual Stop acknowledged and idle');assert.equal((await readDraft()).value,unsent);
  const cancellation=await finishHeld('STOP_HOLD'),before=(await bound()).counts.A;await nativeOpenBoundFolder(c.workspace.d);await nativeOpenBoundFolder(c.workspace.a);assert.equal((await readDraft()).value,unsent);assertCompletedHistory(await history(),['A1']);await sleep(10000);assert.equal((await bound()).counts.A,before,'Stop/navigation must not dispatch duplicates');
  return {active_stream_refused_navigation:true,actual_stop_acknowledged:true,unsent_draft_preserved:true,completed_history_preserved:true,no_duplicate_dispatch_window_ms:10000,cancellation,provider_called:false};
 });
 await step('T06-native-stream-normal-quit-recovery',async()=>{
  need('T06-native-stream-block-and-stop');await send('QUIT_HOLD',true);const unsent=draft+'-during-quit';await ui.input(await focusChat(),'.hps-input textarea',unsent);const before=(await bound()).counts.A;
  const processProof=await restart(unsent);assertCompletedHistory(await history(),['A1']);const cancellation=await finishHeld('QUIT_HOLD');await sleep(10000);assert.equal((await bound()).counts.A,before,'Restart must not resume or duplicate interrupted model execution');
  await ui.shot(path.join(c.evidence,'stream-quit-restored.png'));return {...processProof,completed_history_restored:true,interrupted_turn_replayed:false,no_duplicate_dispatch_window_ms:10000,cancellation,provider_called:false};
 });
 await step('T06-native-stream-direct-file-open',async()=>{
  need('T06-native-stream-normal-quit-recovery');if((await bound()).counts.A>=12)throw blocked('Same activity attempt ceiling leaves no room; no reissue/reset');
  await send('FILE_HOLD',true);const unsent=draft+'-during-file-open';await ui.input(await focusChat(),'.hps-input textarea',unsent);const before=(await bound()).counts.A;
  await openFolder(c.workspace.d);await ui.frame('.hps-input textarea',60000);assertCompletedHistory(await history(),['A1','D2']);const cancellation=await finishHeld('FILE_HOLD');
  await openFolder(c.workspace.a);await ui.frame('.hps-input textarea',60000);assert.equal((await readDraft()).value,unsent,'Direct File Open preserves in-flight unsent draft');assertCompletedHistory(await history(),['A1']);await sleep(10000);assert.equal((await bound()).counts.A,before,'Direct folder reload must not replay execution');
  await ui.input(await focusChat(),'.hps-input textarea',draft);return {actual_direct_file_open:true,completed_history_restored:true,unsent_draft_preserved:true,no_duplicate_dispatch_window_ms:10000,cancellation,provider_called:false};
 });
 await step('T06-native-revoked-credential-no-auto-execution',async()=>{
  need('T06-native-stream-direct-file-open');const before=await bound(),beforeBindings=workspaceFiles(bindings),filesC=workspaceFiles(c.workspace.c);const callsBefore=await(await fetch(c.service.origin+'/__feedback-native/requests')).json();const bAttempts=calls=>calls.filter(r=>r.subject==='B'&&r.method==='POST'&&['/v1/messages','/v1/messages/count_tokens','/v1/chat/completions'].includes(r.path)).length;const denied=await revokeSyntheticB(control);
  await openFolder(c.workspace.c);const view=await ui.frame('.studio-start',60000);await waitFor(()=>view.evaluate(`document.querySelector('#connection-error')?.textContent.includes(${JSON.stringify(denied.ui_friendly)})`),'actual revoked activity refuses automatic admission');
  assert.equal(await view.evaluate("!!document.querySelector('.studio-course')"),false,'Revoked credential cannot admit activity');await sleep(10000);assert.deepEqual((await bound()).counts,before.counts,'Revoked credential must not reach upstream');const callsAfter=await(await fetch(c.service.origin+'/__feedback-native/requests')).json();assert.equal(bAttempts(callsAfter.calls),bAttempts(callsBefore.calls),'Revoked credential must not even attempt hidden model requests');assert.deepEqual(workspaceFiles(c.workspace.c),filesC);assert.deepEqual(workspaceFiles(bindings),beforeBindings);
  await openFolder(c.workspace.a);await ui.frame('.hps-input textarea',60000);assert.equal((await readDraft()).value,draft);assertCompletedHistory(await history(),['A1']);assert.deepEqual(workspaceFiles(c.workspace.a),originalFiles);
  const ledger=await bound();report.scripted_upstream=ledger;report.sdk_service_requests=await(await fetch(c.service.origin+'/__feedback-native/requests')).json();const requests=report.sdk_service_requests.calls.filter(r=>r.path==='/v1/messages'||r.path==='/v1/messages/count_tokens');report.sdk_auxiliary={status:requests.some(r=>r.request_class&&/title|aux/i.test(r.request_class))?'OBSERVED_REQUEST_CLASS':'NOT_OBSERVED',count_tokens:requests.filter(r=>r.path.endsWith('/count_tokens')).length,requests:requests.map(({seq,path,status,turn_sha256,request_class,parent_request_id,ledger_request_id,scripted_dispatches})=>({seq,path,status,turn_sha256,request_class,parent_request_id:parent_request_id??null,ledger_request_id:ledger_request_id??null,scripted_dispatches:scripted_dispatches??0}))};report.scripted_model_turns='ACTUAL_SDK_WITH_SCRIPTED_UPSTREAM_NOT_REAL_MODEL';report.streaming='PASS_HOST_SELECTED; upstream cancellation separately recorded';save();
  return {canonical_revoke:true,invalid_activity_denied:true,automatic_model_attempts:0,no_auto_generation_window_ms:10000,a_history_draft_files_preserved:true,upstream_cancel:report.cancellation_layers?.every(x=>x.upstream_socket_closed)?'OBSERVED':'NOT_PROPAGATED',provider_called:false};
 });
}
