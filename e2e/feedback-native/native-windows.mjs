// Hosted-only native two-window observation. No command bridge or state seeding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NativeUI,waitFor,sleep,sameDisplayedWorkspace} from './native-ui.mjs';
import {sha256,within} from './safety.mjs';
export function ownedWindowPrerequisite(c,env=process.env){
 if(env.GITHUB_ACTIONS!=='true'||!env.RUNNER_TEMP||c.attach)throw Object.assign(Error('Two-window input requires an owned hosted desktop'),{blocked:true});
 if(!within(fs.realpathSync(c.userDataDir),fs.realpathSync(env.RUNNER_TEMP)))throw Error('Owned profile must be within this hosted runner temp');
 const marker=JSON.parse(fs.readFileSync(path.join(c.userDataDir,'feedback-owner.json'),'utf8'));
 assert.equal(marker.schema,'hps-feedback-owned-profile/1');assert.equal(marker.receipt,c.candidate.receipt);
 for(const name of ['a','b','c'])assert.equal(marker.workspaces[name],c.workspace[name]);
 const roots=['a','b','c'].map(name=>fs.realpathSync(c.workspace[name]));assert.equal(new Set(roots).size,3,'Three distinct physical roots required');
 for(const root of roots)assert(within(root,fs.realpathSync(env.RUNNER_TEMP)),'All windows must stay in owned hosted temp roots');
 return {hosted:true,owned:true};
}
export function newOwnedWorkbench(before,after){
 const pages=after.filter(t=>t.type==='page'&&t.url.includes('workbench'));
 if(pages.length!==2)throw Error('Exactly two native workbench windows required');
 const added=pages.filter(t=>!before.includes(t.id));
 if(added.length!==1||!pages.some(t=>t.id===before[0]))throw Error('Original window and one newly observed window required');
 return added[0];
}
export function assertUnchangedOtherWindow(expected,actual){
 for(const field of ['workbenchId','frameId','draft','bindingHash'])assert.equal(actual[field],expected[field],'Other window '+field+' changed');
 assert.equal(actual.inExpectedRoot,true,'Other window changed root');
 assert.deepEqual(actual.files,expected.files,'Other window files changed');
}
// Use the shell's public picker so nativeHostService, not CDP focus emulation,
// activates the exact already observed window. No title suffix matching.
export async function switchOwnedWindow(from,to){
 assert(from.workbenchId&&to.workbenchId&&from.workbenchId!==to.workbenchId&&from.endpoint===to.endpoint,'Two distinct explicitly owned windows required');
 const target=await to.workbench();
 if(await target.evaluate('document.hasFocus()'))return;
 const current=await from.workbench();assert.equal(await current.evaluate('document.hasFocus()'),true,'Switch Window must start in the actually focused owned window');
 const title=await target.evaluate('document.title');assert.equal(typeof title,'string');assert(title.trim(),'Observed destination title required');
 await from.palette('Switch Window...');await from.quick(title);
 await waitFor(()=>target.evaluate('document.hasFocus()'),'public Switch Window activated exact owned destination');
}
export async function finishOwnedWindows({primary,observe,cleanup,proof,persist}){
 // Diagnostic failures and cleanup must never replace the original failure.
 try{await observe();}catch(error){proof.diagnostic_error=error.message;}
 let cleanupError;
 try{await cleanup();}catch(error){cleanupError=error;proof.cleanup_error=error.message;}
 persist();
 if(primary)throw primary;
 if(cleanupError)throw cleanupError;
}
// The production binding file stores id/ref, not workspace. Resolve only the
// exact physical root's known Windows drive spellings, never arbitrary files.
export function selectOwnedBinding(directory,physicalRoot,service,activityId,platform=process.platform){
 const paths=platform==='win32'?path.win32:path.posix;
 assert(paths.isAbsolute(physicalRoot),'Binding workspace must be an absolute physical path');
 assert(/^[a-f0-9]{64}$/.test(activityId??''),'Actual Service activity identity required');
 const url=new URL(service);assert(!url.username&&!url.password&&!url.search&&!url.hash,'Credential-free Service identity required');
 const expectedId=createHash('sha256').update(JSON.stringify([url.href.replace(/\/+$/,''),activityId])).digest('hex');
 const physical=paths.normalize(physicalRoot),spellings=new Set([physical]);
 if(platform==='win32'&&/^[a-z]:/i.test(physical)){
  spellings.add(physical[0].toUpperCase()+physical.slice(1));spellings.add(physical[0].toLowerCase()+physical.slice(1));
 }
 const names=new Set([...spellings].map(value=>{
  assert(sameDisplayedWorkspace(value,physical,platform),'Only exact workspace drive spelling may vary');
  return createHash('sha256').update(value).digest('hex')+'.json';
 }));
 const dirStat=fs.lstatSync(directory);assert(dirStat.isDirectory()&&!dirStat.isSymbolicLink(),'Owned binding directory must be regular');
 const matches=fs.readdirSync(directory).filter(name=>names.has(name));
 assert.equal(matches.length,1,'Exactly one existing binding for the physical workspace required');
 const file=path.join(directory,matches[0]),stat=fs.lstatSync(file);
 assert(stat.isFile()&&!stat.isSymbolicLink(),'Binding must be a regular non-linked file');
 const bytes=fs.readFileSync(file),record=JSON.parse(bytes);
 assert.equal(record.version,1,'Binding version');assert.equal(record.id,expectedId,'Binding must match actual Service and activity');
 assert(typeof record.ref==='string'&&/^hps\.activity\.credential\.[^\s]+$/.test(record.ref),'Valid existing credential reference required');
 return {file,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function runOwnedWindows({c,ui,draft,openOwnedWindow,commandTitle,workspaceFiles,saveProgress,activityId}){
 ownedWindowPrerequisite(c);assert.equal(typeof openOwnedWindow,'function');assert(commandTitle);
 const original=await ui.workbench(),before=(await ui.list()).filter(t=>t.type==='page'&&t.url.includes('workbench')).map(t=>t.id);
 assert.deepEqual(before,[original.info.id],'Start with exactly the owned original window');
 const bindings=path.join(c.userDataDir,'User/globalStorage/hypeproof.hypeproof-chat/activity-bindings');
 const selectedBinding=selectOwnedBinding(bindings,fs.realpathSync(c.workspace.c),c.service.origin+'/v1',activityId);
 const bindingFile=selectedBinding.file,bindingHash=selectedBinding.sha256,filesC=workspaceFiles(c.workspace.c);
 const proof={scope:'actual simultaneous windows and destination noninterference',original_window:original.info.id,secondary_window:null,secondary_closed:false,pending_marker_consumption:'NOT_OBSERVED; internal transient marker is not inferred from UI',slow_native_activation:'NOT_RUN; deterministic61s/expiry controls reused',observations:0,phases:[],diagnostics:[]};
 let secondary,other,cli,primary;ui.workbenchId=original.info.id;
 const persist=()=>saveProgress(structuredClone(proof));
 const phase=name=>{proof.phases.push({phase:name,at:new Date().toISOString()});persist();};
 const diagnose=async()=>{
  for(const [name,window] of [['original',ui],['secondary',other]])if(window){
   const item={window:name,id:window.workbenchId};proof.diagnostics.push(item);
   try{const w=await window.workbench();item.state=await w.evaluate("({title:document.title,focused:document.hasFocus(),visibility:document.visibilityState,activeTag:document.activeElement?.tagName})");}catch(error){item.state_error=error.message;}
   try{await window.shot(path.join(c.evidence,'simultaneous-before-cleanup-'+name+'.png'));item.screenshot='simultaneous-before-cleanup-'+name+'.png';}catch(error){item.screenshot_error=error.message;}
  }
  try{proof.targets=(await ui.list()).map(t=>({id:t.id,type:t.type,title:t.title,url:new URL(t.url).protocol+'//'+new URL(t.url).host+new URL(t.url).pathname}));}catch(error){proof.targets_error=error.message;}
  proof.ui_phases={original:ui.phases,secondary:other?.phases};persist();
 };
 try{
  phase('open-secondary');cli=openOwnedWindow(c.workspace.c);cli.on('error',()=>{});
  secondary=await waitFor(async()=>{const pages=(await ui.list()).filter(t=>t.type==='page'&&t.url.includes('workbench'));return pages.length===1?null:newOwnedWorkbench(before,pages);},'one new owned workbench while original remains',60000);
  proof.secondary_window=secondary.id;persist();other=new NativeUI(c.cdp,secondary.id);
  phase('observe-secondary-restoration');const cChat=await other.frame('.hps-input textarea',60000),cFrame=cChat.info.id;
  const unchanged={workbenchId:secondary.id,frameId:cFrame,draft:draft+'-independent-activity-B',bindingHash,files:filesC};
  const observeOther=async()=>{
   const current=await other.workbench(),chat=await other.retainedFrame(cChat);
   assertUnchangedOtherWindow(unchanged,{workbenchId:current.info.id,frameId:chat.info.id,
    inExpectedRoot:String(await current.evaluate('document.title')).includes(path.basename(c.workspace.c)),
    draft:await chat.evaluate("document.querySelector('.hps-input textarea').value"),bindingHash:sha256(bindingFile),files:workspaceFiles(c.workspace.c)});proof.observations++;
  };
  await waitFor(()=>cChat.evaluate(`document.querySelector('.hps-input textarea')?.value===${JSON.stringify(draft+'-independent-activity-B')}`),'second window restores its existing B draft');await observeOther();
  phase('switch-original-through-public-picker');await switchOwnedWindow(other,ui);phase('original-focus-observed');
  const oldChat=await ui.frame('.hps-input textarea');assert.equal(await oldChat.evaluate("document.querySelector('.hps-input textarea').value"),draft);
  phase('original-open-saved-activity');await ui.palette(commandTitle);const view=await ui.frame('.studio-start');await ui.savedActivity(view,c.workspace.b);
  await waitFor(()=>view.evaluate("document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),'original window candidate');await ui.chooseCandidateFolder(view,c.workspace.b);
  phase('original-commit-destination');await observeOther();await ui.press(view,'.studio-primary');
  await waitFor(async()=>{await observeOther();return String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.b));},'original window reaches B while other remains C',60000);
  phase('original-destination-restoration');const moved=await ui.frame('.hps-input textarea',60000);assert.notEqual(moved.info.id,oldChat.info.id);
  await waitFor(()=>moved.evaluate(`document.querySelector('.hps-input textarea')?.value===${JSON.stringify(draft+'-B')}`),'correct B destination retains its existing draft');
  phase('observe-two-window-noninterference');const until=Date.now()+10000;while(Date.now()<until){await observeOther();assert.equal((await ui.frame('.hps-input textarea')).info.id,moved.info.id,'No repeated destination reload');await sleep(150);}
  proof.destination_restored=true;proof.no_reload_loop_window_ms=10000;proof.other_binding_draft_files_preserved=true;
  await other.shot(path.join(c.evidence,'simultaneous-other-C.png'));await ui.shot(path.join(c.evidence,'simultaneous-destination-B.png'));persist();
  // Restore the original window using the public native File command before cleanup.
  phase('original-return-to-A');await ui.palette('File: Open Folder...');await ui.ownedOpenFolder(c.workspace.a+path.sep);
  await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)),'original window returns to A',60000);await ui.restoredDraft(draft);await observeOther();
 }catch(error){primary=error;proof.primary_error=error.message;proof.failed_phase=proof.phases.at(-1)?.phase;persist();}
 await finishOwnedWindows({primary,proof,persist,observe:diagnose,cleanup:async()=>{
  try{
   if(other){
    phase('cleanup-switch-secondary');await switchOwnedWindow(ui,other);
    phase('cleanup-close-secondary');await other.closeOwnedWindow();proof.secondary_closed=true;
   }
  }finally{other?.close();ui.workbenchId=undefined;}
 }});
 assert(proof.secondary_closed);return {...proof,provider_dispatch:false,token_reentry:false};
}
