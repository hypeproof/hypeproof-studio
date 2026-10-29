#!/usr/bin/env node
import {ownedFocusLogs} from './focus-diagnostics.mjs';
import {coreCommandLabel} from '../fixtures/shell-labels.mjs';
// Native acceptance slice: no DOM event injection, host command bridge, token seeding or provider dispatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runDelayedActivation,delayedPrerequisite,delayedHistoryPrerequisite} from './delayed-activation.mjs';
import {runOwnedWindows} from './native-windows.mjs';
import {runHistoryStreaming} from './history-streaming.mjs';
import {captureWindowsQuitOwner,confirmWindowsStreamingQuit,observeWindowsQuitStructure} from './native-quit-dialog.mjs';
import {createMacQuitPort,captureMacQuitOwner,confirmMacStreamingQuit,forceStopMacOwnedChild} from './native-mac-quit.mjs';
import {compatibilityEnvironment} from '../unified-release/output-bound.mjs';
import {checkSeededSdk} from '../unified-release/sdk-seed.mjs';
import {endSyntheticSession} from './session-control.mjs';
import {NativeUI,waitFor,sleep,skillPreviewOutcome} from './native-ui.mjs';
import {validateConfig,candidateProof,assertNoBackdoors,loopback,sanitize,sha256,foregroundAllowed,restartOwnedCandidate,stopOwnedCandidate,distinctActivities,verifyRestartArtifacts,sdkProtocolProof} from './safety.mjs';
const args=process.argv.slice(2);
if(args.includes('--help')||!args[0]){console.log('Usage: node e2e/feedback-native/run.mjs CONFIG.json [--preflight | --allow-foreground]\nAttach leaves the app running. Owned launch requires a generated profile marker. No external provider requests are sent; owned scripted mode exercises the actual SDK.');process.exit(args.includes('--help')?0:2);}
const c=validateConfig(JSON.parse(fs.readFileSync(args[0],'utf8'))),secrets=[];
delayedPrerequisite(c);
fs.mkdirSync(c.evidence,{recursive:true});
if(fs.existsSync(path.join(c.evidence,'result.json')))fs.copyFileSync(path.join(c.evidence,'result.json'),path.join(c.evidence,'result-previous-'+Date.now()+'.json'));
const report={schema:'hps-feedback-native-result/1',started_at:new Date().toISOString(),platform:process.platform,mode:c.attach?'attach-no-process-ownership':'owned-prepared-candidate',tests:[],acceptance:'PARTIAL',model_turns:'NOT_RUN',history:'NOT_RUN',streaming:'NOT_RUN',process_restart_credentials:'NOT_RUN',production:'NOT_RUN'};
const ui=new NativeUI(c.cdp);let child,profile,profileB,extensionGate,macQuitPort,macQuitCapture;
const blocked=message=>Object.assign(Error(message),{blocked:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{report.execution_status='INTERRUPTED';report.native_ui='NOT_RUN_REMAINDER';report.finished_at=new Date().toISOString();try{await extensionGate?.close();}catch(error){report.inspector_signal_cleanup_error=error.message;}ui.close();if(child)child.kill();save();process.exit(130);});
const save=()=>{report.ui_phases=ui.phases;return fs.writeFileSync(path.join(c.evidence,'result.json'),sanitize(JSON.stringify(report,null,2),secrets));};
async function step(id,body){const start=Date.now();try{const evidence=await body();report.tests.push({id,status:'PASS',elapsed_ms:Date.now()-start,...evidence});console.log(id+' PASS');}catch(error){const status=error.blocked?'BLOCKED':'FAIL';report.tests.push({id,status,elapsed_ms:Date.now()-start,error:sanitize(error.message,secrets)});console.log(id+' '+status+': '+sanitize(error.message,secrets));try{await ui.shot(path.join(c.evidence,id+'-'+status.toLowerCase()+'.png'));}catch{} if(id==='T03-same-activity-real-folder-continuity'){try{report.tests.at(-1).owned_folder_dialog_canceled=await ui.cancelOwnedOpenFolder();}catch(cleanup){report.tests.at(-1).cleanup_error=sanitize(cleanup.message,secrets);}} if(['T04-different-activity-collision','T03-same-activity-activity-folder-chooser','T03-native-scripted-history-persistence'].includes(id)&&!c.attach&&ownedActivityCandidate){try{const canceled=await ui.cancelActivityCandidate();report.tests.at(-1).owned_activity_candidate_canceled=canceled;if(canceled)ownedActivityCandidate=false;}catch(cleanup){report.tests.at(-1).candidate_cleanup_error=sanitize(cleanup.message,secrets);}} }save();}
const command=id=>{const title=report.candidate.commandTitles[id];if(!title)throw blocked('Candidate manifest does not contain '+id+'; rebuild/reinject current implementation');return ui.palette(title);};
const readDraft=async()=>{const chat=await ui.frame('.hps-input textarea');return {chat,value:await chat.evaluate("document.querySelector('.hps-input textarea').value")};};
async function focusChat(){await command('hypeproof-chat.focus');return ui.focusChatReady();}
async function start(){await command('hypeproof-chat.start');return ui.frame('.studio-start');}
async function ensureChat(){try{return await ui.frame('.hps-input textarea',1800);}catch{}let view=await ui.frame('.studio-start');if(await view.evaluate("!!document.querySelector('.studio-course')")){await ui.press(view,'.studio-primary');return ui.frame('.hps-input textarea',60000);}if(await ui.hasTextButton(view,'수업에 참여하기'))await ui.clickText(view,'수업에 참여하기');await ui.input(view,'#course-code',secrets[0]);await ui.clickText(view,'코드 확인하기');await waitFor(()=>view.evaluate("!!document.querySelector('.studio-course')"),'authenticated course profile');if(await ui.hasTextButton(view,'다른 작업 폴더 선택')){await ui.clickText(view,'다른 작업 폴더 선택');await ui.folder(c.workspace.a,'이 활동의 작업 폴더 선택');}await ui.press(view,'.studio-primary');return ui.frame('.hps-input textarea',60000);}
async function selectTokenB(folder){
 const view=await start();ownedActivityCandidate=true;return ui.activityCandidate(view,secrets[1],folder);
}
async function nativeOpenBoundFolder(folder){
 const before=(await readDraft()).chat.info.id;
 await ui.palette(coreCommandLabel('workbench.action.files.openFolder'));await ui.ownedOpenFolder(folder+path.sep);
 await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(folder)),'native File Open Folder bound destination',60000);
 const chat=await ui.frame('.hps-input textarea',60000);
 assert.notEqual(chat.info.id,before,'Real folder navigation must replace the visible extension target');
 return readDraft();
}
function workspaceFiles(root){
 const entries=[];
 function visit(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isSymbolicLink())throw blocked('Owned folder file preservation cannot follow symlinks');if(item.isDirectory())visit(file);else if(item.isFile())entries.push([path.relative(root,file),sha256(file)]);if(entries.length>5000)throw blocked('Owned fixture folder exceeds bounded file snapshot');}}
 visit(root);return entries.sort((a,b)=>a[0].localeCompare(b[0]));
}
let launchOwned,openOwnedWindow,ownedActivityCandidate=false,savedFile;
async function sidebar(){const w=await ui.workbench();return w.evaluate("(()=>{const e=document.querySelector('.part.sidebar');return !!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).display!=='none';})()");}
function requireDialogs(){if(!report.dialogs_ready)throw blocked('Set isolated User/settings.json window.dialogStyle=custom and files.simpleDialog.enable=true, then reload candidate');}
async function openFromStart(folder,confirm,beforeCommit){const view=await start();await ui.clickText(view,'작업 폴더 열기');await ui.folder(folder,'작업 폴더 열기');const w=await ui.workbench();await waitFor(async()=>String(await ui.toasts()).includes('연결할까요'),'unbound folder confirmation');if(confirm){await beforeCommit?.();await ui.clickText(w,'현재 활동 연결');}else await ui.key(w,'Escape');}
try{
 await step('preflight',async()=>{assertNoBackdoors(c.userDataDir,{});report.candidate=candidateProof(c);const service=JSON.parse(fs.readFileSync(c.service.manifest,'utf8'));assert.equal(loopback(service.origin),loopback(c.service.origin));if(c.scenarios.includes('history-streaming')){assert(service.scripted?.schema==='hps-native-scripted-upstream/1','Owned scripted Service required');const sdk=checkSeededSdk(c.candidate.app);assert(sdk.ok,'Verified actual SDK seed required before native turns');report.sdk={...sdk,sha256:sha256(sdk.binary)};report.sdk_protocol=sdkProtocolProof(c,service,report.sdk);}report.service={source:service.source,runtime:service.runtime,evidence_level:service.evidence_level,provider:service.provider};const token=fs.readFileSync(c.service.tokenAFile,'utf8').trim();if(!token)throw Error('Empty explicit token file');secrets.push(token);const response=await fetch(c.service.origin+'/v1/profile',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,'Actual Service profile status');profile=await response.json();report.profile={image_edit_enabled:profile.image_edit?.enabled===true,activity_id:profile.activity_id??null};if(c.service.tokenBFile){const tokenB=fs.readFileSync(c.service.tokenBFile,'utf8').trim();if(!tokenB)throw Error('Empty explicit token B file');secrets.push(tokenB);const responseB=await fetch(c.service.origin+'/v1/profile',{headers:{authorization:'Bearer '+tokenB},signal:AbortSignal.timeout(15000)});assert.equal(responseB.status,200,'Actual Service token B profile status');profileB=await responseB.json();distinctActivities(profile,profileB);report.profile_b={activity_id:profileB.activity_id,different_activity:true,service_profile_status:responseB.status};}const settings=JSON.parse(fs.readFileSync(path.join(c.userDataDir,'User/settings.json'),'utf8'));assert.equal(settings['hypeproofChat.proxyUrl']?.replace(/\/v1\/?$/,''),loopback(c.service.origin),'Candidate must use the explicit actual Service');report.dialogs_ready=settings['window.dialogStyle']==='custom'&&settings['files.simpleDialog.enable']===true;return {service_profile_status:response.status,candidate_receipt_hash:sha256(c.candidate.receipt)};});
 if(report.tests[0].status!=='PASS')throw blocked('Preflight failed; no UI was touched');
 if(!foregroundAllowed(args)){report.execution_status='PREFLIGHT_ONLY';report.native_ui='NOT_RUN; foreground input defaults off. --allow-foreground is reserved for an explicitly authorized dedicated UI slot or hosted runner';save();console.log('Preflight only; native tests NOT_RUN (foreground opt-in absent or preflight requested)');process.exit(0);}
 if(!c.attach){const marker=JSON.parse(fs.readFileSync(path.join(c.userDataDir,'feedback-owner.json'),'utf8'));assert.equal(marker.receipt,c.candidate.receipt,'Owned launch receipt marker');const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HPS_TEST_')||/^(?:ELECTRON_RUN_AS_NODE|ANTHROPIC_API_KEY|OPENAI_API_KEY|HPS_DEV_TOKEN_FILE|HPS_IMAGE_EDIT_PROVIDER_KEY)$/.test(key))delete env[key];Object.assign(env,compatibilityEnvironment(env));env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';env.HPS_TEST_E2E='1';env.HPS_TEST_REAL_WORKSPACE='1';env.HPS_DEV_TOKEN_FILE=path.join(c.userDataDir,'no-bootstrap-token');assertNoBackdoors(c.userDataDir,env);const binary=path.join(c.candidate.app,process.platform==='darwin'?'Contents/MacOS/HypeProof Studio':'HypeProof Studio.exe');const launch=['--user-data-dir='+c.userDataDir,'--remote-debugging-port='+new URL(c.cdp).port,'--disable-workspace-trust','--skip-welcome','--skip-release-notes',...(c.secretStorage==='inmemory'?['--use-inmemory-secretstorage']:[]),c.workspace.a];launchOwned=(extra=[])=>{assert(extra.length===0||(c.delayedActivation&&extra.length===1&&extra[0]==='--inspect-brk-extensions=9788'),'Only reviewed inspector launch option allowed');child=spawn(binary,[...launch.slice(0,-1),...extra,launch.at(-1)],{env,stdio:'ignore'});child.on('error',()=>{});return child;};openOwnedWindow=folder=>{if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||folder!==c.workspace.c)throw blocked('Second window requires hosted owned C');return spawn(binary,[...launch.slice(0,-1),'--new-window',folder],{env,stdio:'ignore'});};launchOwned();report.launch_flags={analytics_isolation:true,production_workspace_routing:true,token_backdoor:false,history_backdoor:false,secret_storage:c.secretStorage};}
 await step('native-entry',async()=>{await ui.workbench();report.shell_locale=await ui.detectLocale(c.candidate.app);const chat=await ensureChat();const focused=await chat.evaluate("document.activeElement===document.querySelector('.hps-input textarea')");await ui.shot(path.join(c.evidence,'native-entry.png'));return {actual_chat_visible:true,input_initial_focus:focused,provider_dispatch:false};});
 if(!report.tests.find(t=>t.id==='native-entry'&&t.status==='PASS'))throw blocked('Chat entry is required for remaining native checks');
 const draft='feedback-native-draft-'+Date.now().toString(36);
 if(c.scenarios.includes('files')){
 await step('T02-explorer-user-layout-reload',async()=>{await command('hypeproof-chat.openStudioFiles');await ui.explorerReady();await waitFor(sidebar,'Explorer visible');const w=await ui.workbench();assert(await w.evaluate("!!document.querySelector('.explorer-folders-view')"),'Native Explorer view must exist');await ui.palette(c.toggleSidebarTitle||coreCommandLabel('workbench.action.toggleSidebarVisibility'));await waitFor(async()=>!await sidebar(),'user hides sidebar');await focusChat();assert.equal(await sidebar(),false,'Opening chat respects user sidebar choice');const beforeReload=await ui.chatDocumentIdentity();await ui.palette(c.reloadTitle||coreCommandLabel('workbench.action.reloadWindow'),{expectReload:true});ui.close();const afterReload=await ui.reloadedChatReady(beforeReload);await focusChat();assert.equal(await sidebar(),false,'Reload respects user sidebar choice');await command('hypeproof-chat.openStudioFiles');await ui.explorerReady();await waitFor(sidebar,'Explicit Files action restores Explorer');return {explicit_native_explorer:true,user_choice_preserved:true,reload_observed:true,post_reload_chat_document:{before:beforeReload,after:afterReload}};});
 await step('T01-native-file-save',async()=>{requireDialogs();const file=path.join(c.workspace.a,'feedback-native-'+Date.now().toString(36)+'.txt'),body='Native Studio Explorer acceptance\n';assert(!fs.existsSync(file));const w=await ui.newTextFile(body);await ui.key(w,'s',ui.modifier);await ui.pathDialog(file,['Save','저장','OK','확인']);await waitFor(()=>fs.existsSync(file)&&fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')===body,'native save finishes writing expected bytes');assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),body);await command('hypeproof-chat.openStudioFiles');await ui.explorerReady();await waitFor(()=>w.evaluate(`document.querySelector('.explorer-folders-view')?.textContent.includes(${JSON.stringify(path.basename(file))})`),'new file in native Explorer');savedFile={path:file,sha256:sha256(file)};return {relative_path:path.basename(file),sha256:savedFile.sha256,originals_overwritten:false};});
 }
 if(c.scenarios.includes('folders')){
 await step('T04-folder-cancel-draft',async()=>{requireDialogs();const chat=await focusChat();await ui.input(chat,'.hps-input textarea',draft);await sleep(500);await openFromStart(c.workspace.b,false);await focusChat();assert.equal((await readDraft()).value,draft);return {native_picker_cancel:true,draft_preserved:true};});
 await step('T03-same-activity-real-folder-continuity',async()=>{requireDialogs();await focusChat();const initial=await readDraft();if(initial.value!==draft)throw blocked('Folder continuity requires the cancellation draft to exist in the actual chat; preceding draft setup did not complete');const before=initial.chat.info.id;await openFromStart(c.workspace.b,true);const moved=await ui.frame('.hps-input textarea',60000);assert.notEqual(moved.info.id,before,'A real folder reload must replace the visible extension target');await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.b)),'workbench title is B');assert.equal((await readDraft()).value,draft,'Same-activity draft copied once to new folder');const draftB=draft+'-B';await ui.input(moved,'.hps-input textarea',draftB);await sleep(500);await ui.palette(coreCommandLabel('workbench.action.files.openFolder'));await ui.ownedOpenFolder(c.workspace.a+path.sep);await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)),'native File Open Folder returns to A',60000);await ui.frame('.hps-input textarea',60000);assert.equal((await readDraft()).value,draft,'Bound A draft must win over B draft');return {real_reload:true,code_reentry:false,activity_bound_folder:true,destination_draft_wins:true,history:'NOT_RUN; no model turns'};});
 await step('T03-same-activity-activity-folder-chooser',async()=>{
  requireDialogs();
  if(!report.tests.some(t=>t.id==='T03-same-activity-real-folder-continuity'&&t.status==='PASS'))throw blocked('Third navigation route requires observed same-activity A/B bindings and drafts');
  assert.equal((await readDraft()).value,draft,'A draft before activity-folder chooser');
  const before=(await readDraft()).chat.info.id,view=await start();ownedActivityCandidate=true;
  await ui.savedActivity(view,c.workspace.b);
  await waitFor(()=>view.evaluate("document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),'saved A activity candidate');
  await ui.chooseCandidateFolder(view,c.workspace.b);await ui.press(view,'.studio-primary');
  await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.b)),'activity chooser opens actual bound B',60000);
  const moved=await readDraft();assert.notEqual(moved.chat.info.id,before,'Third route must replace visible extension target');ownedActivityCandidate=false;
  assert.equal(moved.value,draft+'-B','Activity chooser preserves destination B own draft');
  assert.equal((await nativeOpenBoundFolder(c.workspace.a)).value,draft,'Public File Open Folder restores original A after third route');
  return {route:'Start saved activity → activity folder chooser → begin',same_activity:true,real_reload:true,destination_draft_wins:true,code_reentry:false,provider_dispatch:false,history:'NOT_RUN'};
 });
 if(c.scenarios.includes('restart')){
 await step('T05-owned-full-process-credential-draft-restart',async()=>{
  if(!report.tests.some(t=>t.id==='T03-same-activity-real-folder-continuity'&&t.status==='PASS'))throw blocked('Full restart requires observed T03 PASS and persisted A draft');
  if(!report.tests.some(t=>t.id==='T03-same-activity-activity-folder-chooser'&&t.status==='PASS'))throw blocked('Restart requires successful third-route return to A');
  if(!savedFile)throw blocked('Restart artifact proof requires observed native file save');
  if(await sidebar())await ui.palette(c.toggleSidebarTitle||coreCommandLabel('workbench.action.toggleSidebarVisibility'));
  await waitFor(async()=>!await sidebar(),'explicit user hidden sidebar before normal quit');
  verifyRestartArtifacts({sidebarVisible:await sidebar(),savedFile,workspace:c.workspace.a});
  report.restart_observations=[];
  const evidence=await restartOwnedCandidate({config:c,child,expectedDraft:draft,
   onProgress:observation=>{report.restart_observations.push({at:new Date().toISOString(),...observation});save();},
   quit:()=>ui.quitOwned(),
   waitExit:owned=>waitFor(()=>owned.exitCode!==null||owned.signalCode!==null,'owned child exits after native quit',30000),
   waitCdpDown:async()=>{await waitFor(()=>ui.cdpDown(),'owned CDP endpoint refuses connections after quit',30000);ui.close();},
   launch:()=>launchOwned(),
   observeDraft:()=>ui.restoredDraft(draft)});
  const focus=await ui.restoredFocus();
  const artifacts={...verifyRestartArtifacts({sidebarVisible:await sidebar(),savedFile,workspace:c.workspace.a}),...focus};
  report.restart_observations.push({at:new Date().toISOString(),phase:'hidden_layout_and_saved_file_restored',...artifacts});save();
  await ui.shot(path.join(c.evidence,'process-restart-restored.png'));return {...evidence,...artifacts};
 });
 report.process_restart_credentials=report.tests.at(-1).status;
 if(!child||child.exitCode!==null||child.signalCode!==null)throw blocked('Owned restart did not leave a live candidate; no remaining native inputs');
 }
 if(c.scenarios.includes('activity-isolation'))await step('T04-different-activity-collision',async()=>{
  requireDialogs();
  if(c.attach)throw blocked('Activity isolation requires generated owned third folder C');
  if(!report.tests.some(t=>t.id==='T03-same-activity-real-folder-continuity'&&t.status==='PASS'))throw blocked('Different-activity test requires observed T03 PASS and A draft');
  distinctActivities(profile,profileB);
  const marker=JSON.parse(fs.readFileSync(path.join(c.userDataDir,'feedback-owner.json'),'utf8'));
  assert.equal(marker.workspaces?.c,c.workspace.c,'C ownership must come from generated profile marker');
  assert.equal(fs.readdirSync(c.workspace.c).length,0,'Third folder C must be genuinely empty before activity B admission');
  assert.equal((await readDraft()).value,draft,'A draft present before other activity selection');
  const originalFiles=workspaceFiles(c.workspace.a),view=await selectTokenB(c.workspace.a);
  await ui.press(view,'.studio-primary');
  await waitFor(()=>view.evaluate("document.querySelector('#connection-error')?.textContent.includes('이 폴더는 다른 활동에 연결돼 있습니다. 다른 작업 폴더를 선택해 주세요.')"),'visible different-activity bound-folder rejection');
  await ui.shot(path.join(c.evidence,'different-activity-rejected.png'));
  await ui.clickText(view,'선택 취소');ownedActivityCandidate=false;await focusChat();
  assert.equal((await readDraft()).value,draft,'Cancel rejected B preserves current A draft');
  assert.deepEqual(workspaceFiles(c.workspace.a),originalFiles,'Rejected B and cancel preserve actual A files');
  const before=(await readDraft()).chat.info.id,candidate=await selectTokenB(c.workspace.c);
  await ui.press(candidate,'.studio-primary');
  await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.c)),'B admitted into owned C',60000);
  const admitted=await ui.frame('.hps-input textarea',60000);
  assert.notEqual(admitted.info.id,before,'Activity B admission switches real visible extension target');ownedActivityCandidate=false;
  assert.equal((await readDraft()).value,'','Fresh B must not inherit A draft');
  const bDraft=draft+'-independent-activity-B';await ui.input(admitted,'.hps-input textarea',bDraft);await sleep(500);
  assert.equal((await nativeOpenBoundFolder(c.workspace.a)).value,draft,'File Open Folder A restores A credential and draft without token entry');
  assert.equal((await nativeOpenBoundFolder(c.workspace.c)).value,bDraft,'File Open Folder C restores B credential and draft without token entry');
  assert.equal((await nativeOpenBoundFolder(c.workspace.a)).value,draft,'Final A restoration remains isolated');
  assert.deepEqual(workspaceFiles(c.workspace.a),originalFiles,'Activity roundtrip preserves original A files');
  return {token_b_different_activity:true,bound_a_rejected:true,cancel_preserves_a:true,empty_owned_c_admits_b:true,no_a_draft_in_b:true,actual_folder_roundtrip:true,a_b_drafts_isolated:true,code_reentry_on_roundtrip:false,provider_dispatch:false};
 });
 else report.tests.push({id:'T04-different-activity-collision',status:'NOT_RUN',reason:'Explicit activity-isolation scenario with independent token B and owned C required'});
 }
 if(c.scenarios.includes('history-streaming')){
  await step('T05-owned-simultaneous-windows',async()=>{
   if(!report.tests.some(t=>t.id==='T04-different-activity-collision'&&t.status==='PASS'))throw blocked('Two windows require actual independent A/C bindings');
   return runOwnedWindows({c,ui,draft,activityId:profileB.activity_id,openOwnedWindow,commandTitle:report.candidate.commandTitles['hypeproof-chat.start'],workspaceFiles,saveProgress:value=>{report.multiwindow=value;save();}});
  });
  if((await ui.list()).filter(t=>t.type==='page'&&t.url.includes('workbench')).length!==1)throw blocked('Secondary window cleanup incomplete; no ambiguous remaining input');
  if(!String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a))||(await readDraft()).value!==draft)throw blocked('Two-window scenario did not restore original A/draft; history prerequisite unavailable');
 }
 if(c.scenarios.includes('history-streaming')){
  if(!report.tests.some(t=>t.id==='T04-different-activity-collision'&&t.status==='PASS'))throw blocked('History/streaming requires observed A/B isolation first');
  await runHistoryStreaming({c,ui,step,report,draft,start,focusChat,readDraft,nativeOpenBoundFolder,workspaceFiles,save,candidate:value=>{ownedActivityCandidate=value;},control:{manifestFile:c.service.manifest,origin:c.service.origin,expectedSource:report.service.source,onSecret:secret=>secrets.push(secret)},restart:async expectedDraft=>restartOwnedCandidate({config:c,child,expectedDraft,onProgress:observation=>{(report.streaming_restart_observations??=[]).push({at:new Date().toISOString(),...observation});save();},quit:async()=>{
   if(process.platform==='darwin'){
    macQuitPort??=await createMacQuitPort();const owned=child;
    const owner=await captureMacQuitOwner({child:owned,executable:fs.realpathSync(path.join(c.candidate.app,'Contents/MacOS/HypeProof Studio')),port:macQuitPort.port});
    macQuitCapture={child:owned,owner};
    if(!owner.accessibilityTrusted)throw blocked('owned_ax_permission_unavailable');
    let confirmed=false;
    await ui.quitOwned('darwin',async()=>{await confirmMacStreamingQuit({owner,current:()=>child===owned&&owned.exitCode===null&&owned.signalCode===null,port:macQuitPort.port,onProgress:observation=>{(report.streaming_restart_observations??=[]).push({at:new Date().toISOString(),...observation});save();}});confirmed=true;});
    assert(confirmed,'Expected Mac streaming quit confirmation was not completed');return;
   }
   const owned=child,owner=await captureWindowsQuitOwner({child:owned,executable:fs.realpathSync(path.join(c.candidate.app,'HypeProof Studio.exe'))});
   const current=()=>child===owned&&owned.exitCode===null&&owned.signalCode===null;
   const census=async phase=>{const observation=await observeWindowsQuitStructure({owner,current});(report.streaming_restart_observations??=[]).push({at:new Date().toISOString(),phase,...observation});save();};
   await census('native_quit_structure_before');
   try{await ui.quitOwned('win32',()=>confirmWindowsStreamingQuit({owner,current,onProgress:observation=>{(report.streaming_restart_observations??=[]).push({at:new Date().toISOString(),...observation});save();}}));}
   catch(error){await census('native_quit_structure_refused');throw error;}
  },waitExit:owned=>waitFor(()=>owned.exitCode!==null||owned.signalCode!==null,'owned child exits streaming quit',30000),waitCdpDown:async()=>{await waitFor(()=>ui.cdpDown(),'streaming quit CDP refuses',30000);ui.close();},launch:()=>launchOwned(),observeDraft:()=>ui.restoredDraft(expectedDraft)})});
  if(!report.tests.some(t=>t.id==='T06-native-stream-normal-quit-recovery'&&t.status==='PASS')||!child||child.exitCode!==null||child.signalCode!==null)throw blocked('Streaming recovery did not establish a live restored owned candidate; no remaining input');
 }
 if(c.scenarios.includes('skills')){
 await step('T07-native-skill-preview-select-disable',async()=>{if(!c.skill?.url)throw blocked('Explicit pinned public skill URL required');if(ownedActivityCandidate)throw blocked('Prior owned activity candidate remains pending; skill import must not start in stale entry UI');try{await ui.frame('.hps-input textarea',1500);}catch{await focusChat();}if(!String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)))throw blocked('Skill test requires original A workspace restored; prior folder scenario did not finish');await ui.focusChatReady();const beforeImportPreview=await ui.editorState(await ui.workbench());beforeImportPreview.returnTarget={kind:'chat',identity:await ui.chatDocumentIdentity()};await ui.assertNoDirtyEditors();await command('hypeproof-chat.externalSkills');await ui.quick('GitHub에서 가져오기');await ui.prompt('공개 GitHub 지침 스킬 가져오기',c.skill.url);const w=await ui.workbench();let outcomeText='';await waitFor(async()=>{outcomeText=String(await ui.toasts());return skillPreviewOutcome(outcomeText);}, 'skill preview confirmation or canonical public-download failure',90000);const text=outcomeText;if(skillPreviewOutcome(text)!=='preview')throw blocked('Public import unavailable: '+text);const preview=await w.evaluate("document.querySelector('.editor-instance')?.textContent||document.body.textContent");assert(preview.includes(c.skill.revision),'Visible preview includes immutable revision');assert(preview.includes('라이선스')&&preview.includes('capability'),'Visible preview includes license/capabilities');await ui.shot(path.join(c.evidence,'skill-preview.png'));await ui.clickText(w,'선택하여 사용');await waitFor(async()=>String(await ui.toasts()).includes('이 작업 폴더의 다음 요청부터 선택한 지침을 사용합니다.'),'selected skill saved completion notification');const importedPreview=await ui.newPreview(w,beforeImportPreview,['외부 지침 스킬',c.skill.revision,'manifest SHA-256','라이선스','capability']);const importPreviewCleanup=await ui.closeOwnedPreview(w,beforeImportPreview,importedPreview);await command('hypeproof-chat.externalSkills');await ui.quick(c.skill.name);const beforePreview=await ui.editorState(w);beforePreview.returnTarget=beforeImportPreview.returnTarget;await ui.quick('내용과 출처 보기');const storedPreview=await ui.newPreview(w,beforePreview,['외부 지침 스킬',c.skill.revision,'manifest SHA-256','라이선스','capability']);await ui.shot(path.join(c.evidence,'stored-skill-preview.png'));const storedPreviewCleanup=await ui.closeOwnedPreview(w,beforePreview,storedPreview);await command('hypeproof-chat.externalSkills');await ui.quick(c.skill.name);await ui.quick('사용 해제');await command('hypeproof-chat.externalSkills');await ui.waitQuick(w,s=>s.ready&&s.mode==='picker','stored skill list reopened after disable');await waitFor(()=>ui.choiceSelector(w,c.skill.name),'stored skill row after disable');const pick=await w.evaluate("document.querySelector('.quick-input-list')?.textContent");assert(pick.includes(c.skill.name)&&!pick.includes('✓ '+c.skill.name),'Skill remains stored but deselected');await ui.key(w,'Escape');return {native_command:true,preview_before_select:true,stored_snapshot_preview:true,stored_preview_resource:storedPreview.resource,preview_cleanup:[importPreviewCleanup,storedPreviewCleanup],disabled:true,offline_network_isolation:'NOT_RUN',instruction_dispatch:'NOT_RUN'};});
 }
 if(c.scenarios.includes('image-denied'))await step('T16-native-image-capability-denied',async()=>{if(c.scenarios.includes('history-streaming')&&!report.tests.some(t=>t.id==='T06-native-revoked-credential-no-auto-execution'&&t.status==='PASS'))throw blocked('Image denial requires completed history/streaming cleanup; prior failure is retained');if(profile.image_edit?.enabled===true)throw blocked('Profile enables images; denied-path test must not dispatch an image or invent disabled capability');await focusChat();await command('hypeproof-chat.editImage');await waitFor(async()=>String(await ui.toasts()).includes('이 활동은 이미지 편집을 허용하지 않아요.'),'profile capability denial');await ui.shot(path.join(c.evidence,'image-denied.png'));return {native_registration:true,profile_capability_denied:true,image_selected:false,provider_dispatch:'NOT_RUN'};});
 if(c.delayedActivation){
  await step('T05-owned-delayed-activation-and-real-expiry',async()=>{
   delayedHistoryPrerequisite(c,report.tests);
   if(ownedActivityCandidate)throw blocked('Prior candidate remains pending before delayed activation');await ui.assertNoDirtyEditors();
   if(!report.tests.some(t=>t.id==='T05-owned-full-process-credential-draft-restart'&&t.status==='PASS'))throw blocked('Delayed activation requires ordinary credential restart PASS');
   const evidence=await runDelayedActivation({c,ui,app:()=>child,launch:extra=>launchOwned(extra),openFromStart,nativeOpenBoundFolder,readDraft,focusChat,workspaceFiles,activityId:profile.activity_id,bundleHash:report.candidate.extension_sha256,draft,onGate:gate=>{extensionGate=gate;},requestCandidate:value=>{ownedActivityCandidate=value;},saveProgress:value=>{report.delayed_activation=value;save();}});
   report.latest_activity_a_saved_workspace=c.workspace.g;
   return evidence;
  });
  if(report.tests.at(-1).status!=='PASS'){if(c.scenarios.includes('session-ended'))report.tests.push({id:'T04-canonical-synthetic-session-ended',status:'NOT_RUN',reason:'Stopped after failed delayed activation; no further native input or session mutation'});throw blocked('Delayed-activation scenario failed; stop before further native input');}
 }
 if(c.scenarios.includes('session-ended'))await step('T04-canonical-synthetic-session-ended',async()=>{
  if(c.attach)throw blocked('Session shutdown requires owned metadata fixture; attach cannot mutate a Service');
  if(!report.tests.some(t=>t.id==='T03-same-activity-activity-folder-chooser'&&t.status==='PASS'))throw blocked('Session negative requires observed A continuity');
  if(ownedActivityCandidate)throw blocked('Prior activity candidate remains pending');
  assert(String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)),'Session negative must finish in A');
  await focusChat();assert.equal((await readDraft()).value,draft,'A draft before session shutdown');
  const files=workspaceFiles(c.workspace.a),bindings=path.join(c.userDataDir,'User/globalStorage/hypeproof.hypeproof-chat/activity-bindings');
  if(!fs.existsSync(bindings))throw blocked('Actual persistent activity binding directory required before invalidation');
  const beforeBindings=workspaceFiles(bindings),view=await start();
  report.session_invalidation_observations=[];
  const ended=await endSyntheticSession({manifestFile:c.service.manifest,origin:c.service.origin,expectedSource:report.service.source,token:secrets[0],onSecret:secret=>secrets.push(secret),onProgress:observation=>{report.session_invalidation_observations.push({at:new Date().toISOString(),...observation});save();}});
  report.session_invalidation={...ended,ui_denial:'PENDING'};save();
  await ui.savedActivity(view,report.latest_activity_a_saved_workspace??c.workspace.b);
  const refusal=await ui.sessionRefusal(view,ended.ui_friendly);
  assert.equal(await view.evaluate("document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),false,'Invalid session must not create an admitted candidate');
  await ui.shot(path.join(c.evidence,'session-ended-denied.png'));
  await focusChat();assert.equal((await readDraft()).value,draft,'Session denial preserves actual A draft');
  assert.deepEqual(workspaceFiles(c.workspace.a),files,'Session denial preserves actual A files');
  assert.deepEqual(workspaceFiles(bindings),beforeBindings,'Session denial preserves all existing activity binding files');
  report.session_invalidation.ui_denial='PASS';
  return {...ended,ui_denial:true,ui_copy_source:'App classifyProfileFailure',visible_refusal:refusal,draft_preserved:true,files_preserved:true,bindings_preserved:true,token_reentry:false,no_chat_submission:true};
 });
 else report.tests.push({id:'T04-canonical-synthetic-session-ended',status:'NOT_RUN',reason:'Explicit owned synthetic session control required; no external or attached Service mutation'});
 report.execution_status=report.tests.some(t=>t.status==='FAIL')?'FAIL':report.tests.some(t=>t.status==='BLOCKED')?'BLOCKED':'PASS_SELECTED_SLICE';
}catch(error){report.fatal=sanitize(error.message,secrets);report.execution_status=report.tests.some(t=>t.status==='FAIL')?'FAIL':error.blocked?'BLOCKED':'FAIL';console.error(report.fatal);}finally{
 // Persist the primary outcome before bounded cleanup observations.
 save();ui.close();
 if(child){
  try{report.cleanup=await stopOwnedCandidate({config:c,child,
   forceStop:macQuitCapture?.child===child&&macQuitPort?owned=>forceStopMacOwnedChild({child:owned,owner:macQuitCapture.owner,current:()=>child===owned&&macQuitCapture.child===owned,port:macQuitPort.port}):undefined,
   waitExit:owned=>waitFor(()=>owned.exitCode!==null||owned.signalCode!==null,'owned cleanup child exit',10000),
   waitCdpDown:()=>waitFor(()=>ui.cdpDown(),'owned cleanup CDP refusal',5000)});
  }catch(error){report.cleanup={status:'FAIL',child_exit_observed:false,cdp_down:false,error:sanitize(error.message,secrets)};}
  report.owned_process_stopped=report.cleanup.child_exit_observed&&report.cleanup.cdp_down;
  report.cleanup_stop_not_restart_evidence=true;
  if(report.cleanup.status!=='PASS')report.execution_status='FAIL';
 }else report.attached_process_left_running=!!c.attach;
 try{await macQuitPort?.close();}catch{report.mac_quit_helper_cleanup='FAIL';report.execution_status='FAIL';}
 report.focus_host_diagnostics=ownedFocusLogs(c.userDataDir);
 report.finished_at=new Date().toISOString();save();console.log('Result: '+path.join(c.evidence,'result.json'));
}
if(report.execution_status==='FAIL')process.exitCode=1;else if(report.execution_status==='BLOCKED')process.exitCode=2;
