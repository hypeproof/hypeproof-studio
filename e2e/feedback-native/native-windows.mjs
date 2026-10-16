// Hosted-only native two-window observation. No command bridge or state seeding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NativeUI,waitFor,sleep} from './native-ui.mjs';
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
export async function runOwnedWindows({c,ui,draft,openOwnedWindow,commandTitle,workspaceFiles,saveProgress}){
 ownedWindowPrerequisite(c);assert.equal(typeof openOwnedWindow,'function');assert(commandTitle);
 const original=await ui.workbench(),before=(await ui.list()).filter(t=>t.type==='page'&&t.url.includes('workbench')).map(t=>t.id);
 assert.deepEqual(before,[original.info.id],'Start with exactly the owned original window');
 const bindings=path.join(c.userDataDir,'User/globalStorage/hypeproof.hypeproof-chat/activity-bindings');
 const bindingFile=path.join(bindings,createHash('sha256').update(fs.realpathSync(c.workspace.c)).digest('hex')+'.json');
 assert(!fs.lstatSync(bindingFile).isSymbolicLink());const bindingHash=sha256(bindingFile),filesC=workspaceFiles(c.workspace.c);
 const proof={scope:'actual simultaneous windows and destination noninterference',original_window:original.info.id,secondary_window:null,secondary_closed:false,pending_marker_consumption:'NOT_OBSERVED; internal transient marker is not inferred from UI',slow_native_activation:'NOT_RUN; deterministic61s/expiry controls reused',observations:0};
 let secondary,other,cli;ui.workbenchId=original.info.id;
 const persist=()=>saveProgress(structuredClone(proof));
 try{
  cli=openOwnedWindow(c.workspace.c);cli.on('error',()=>{});
  secondary=await waitFor(async()=>{const pages=(await ui.list()).filter(t=>t.type==='page'&&t.url.includes('workbench'));return pages.length===1?null:newOwnedWorkbench(before,pages);},'one new owned workbench while original remains',60000);
  proof.secondary_window=secondary.id;persist();other=new NativeUI(c.cdp,secondary.id);
  const cChat=await other.frame('.hps-input textarea',60000),cFrame=cChat.info.id;
  const unchanged={workbenchId:secondary.id,frameId:cFrame,draft:draft+'-independent-activity-B',bindingHash,files:filesC};
  const observeOther=async()=>{
   const current=await other.workbench(),chat=await other.frame('.hps-input textarea');
   assertUnchangedOtherWindow(unchanged,{workbenchId:current.info.id,frameId:chat.info.id,
    inExpectedRoot:String(await current.evaluate('document.title')).includes(path.basename(c.workspace.c)),
    draft:await chat.evaluate("document.querySelector('.hps-input textarea').value"),bindingHash:sha256(bindingFile),files:workspaceFiles(c.workspace.c)});proof.observations++;
  };
  await waitFor(()=>cChat.evaluate(`document.querySelector('.hps-input textarea')?.value===${JSON.stringify(draft+'-independent-activity-B')}`),'second window restores its existing B draft');await observeOther();
  const oldChat=await ui.frame('.hps-input textarea');assert.equal(await oldChat.evaluate("document.querySelector('.hps-input textarea').value"),draft);
  await ui.palette(commandTitle);const view=await ui.frame('.studio-start');await ui.savedActivity(view,c.workspace.b);
  await waitFor(()=>view.evaluate("document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),'original window candidate');await ui.chooseCandidateFolder(view,c.workspace.b);
  await observeOther();await ui.press(view,'.studio-primary');
  await waitFor(async()=>{await observeOther();return String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.b));},'original window reaches B while other remains C',60000);
  const moved=await ui.frame('.hps-input textarea',60000);assert.notEqual(moved.info.id,oldChat.info.id);
  await waitFor(()=>moved.evaluate(`document.querySelector('.hps-input textarea')?.value===${JSON.stringify(draft+'-B')}`),'correct B destination retains its existing draft');
  const until=Date.now()+10000;while(Date.now()<until){await observeOther();assert.equal((await ui.frame('.hps-input textarea')).info.id,moved.info.id,'No repeated destination reload');await sleep(150);}
  proof.destination_restored=true;proof.no_reload_loop_window_ms=10000;proof.other_binding_draft_files_preserved=true;
  await other.shot(path.join(c.evidence,'simultaneous-other-C.png'));await ui.shot(path.join(c.evidence,'simultaneous-destination-B.png'));persist();
  // Restore the original window using the public native File command before cleanup.
  await ui.palette('File: Open Folder...');await ui.ownedOpenFolder(c.workspace.a+path.sep);
  await waitFor(async()=>String(await(await ui.workbench()).evaluate('document.title')).includes(path.basename(c.workspace.a)),'original window returns to A',60000);await ui.restoredDraft(draft);await observeOther();
 }finally{
  // Never close the original, an arbitrary page, or the whole app to claim success.
  try{if(other){try{await other.closeOwnedWindow();proof.secondary_closed=true;}finally{other.close();}}}
  finally{ui.workbenchId=undefined;persist();}
 }
 assert(proof.secondary_closed);return {...proof,provider_dispatch:false,token_reentry:false};
}
