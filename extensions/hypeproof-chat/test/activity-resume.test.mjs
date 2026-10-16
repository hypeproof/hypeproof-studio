import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const bundle = await build({stdin:{contents:"export * from './src/studioNavigation';export {activate,resolveActivateBranch,ensureWorkspace} from './src/extension';export {openBrowser} from './src/nativeBrowser';export {ChatPanelProvider} from './src/chatPanelProvider';export {StartPage} from './src/startPage';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const commands=[], mod={exports:{}};
const vscode={ViewColumn:{One:1},commands:{executeCommand:async c=>commands.push(c)},workspace:{workspaceFolders:[]},Uri:{joinPath:()=>({}),file:fsPath=>({fsPath})},window:{createWebviewPanel:()=>({webview:{onDidReceiveMessage(){},html:''},onDidChangeViewState(){},onDidDispose(){}})}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),process,console,Buffer,URL});
const {resumeDecision,resumeKey,consumeActivityResume,initializeFilesLayout,RESUME_MAX_AGE_MS,activate,openBrowser,resolveActivateBranch,ensureWorkspace,ChatPanelProvider,StartPage}=mod.exports;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hps-resume-'));
const a=path.join(tmp,'작업 A'),b=path.join(tmp,'작업 B'),link=path.join(tmp,'alias');fs.mkdirSync(a);fs.mkdirSync(b);fs.symlinkSync(a,link);
const now=Date.now(),service='https://synthetic.invalid/v1';
const record={version:1,id:'b'.repeat(64),serverId:'a'.repeat(64),service,workspace:a,ref:'hps.activity.credential.synthetic'};
const marker={version:1,id:record.serverId,ref:record.ref,service,workspace:a,at:now};
const state=()=>{const map=new Map();return {map,keys:()=>[...map.keys()],get:(k,d)=>map.has(k)?map.get(k):d,update:async(k,v)=>{if(v===undefined)map.delete(k);else map.set(k,v);}};};
try {
 assert.equal(resumeDecision(undefined,record,service,a,now),'absent');
 assert.equal(resumeDecision({...marker,at:now-61_000},record,service,link,now),'valid','a slow activation and a symlink still resume');
 assert.equal(resumeKey(link),resumeKey(a));assert.notEqual(resumeKey(b),resumeKey(a));
 assert.equal(resumeDecision({...marker,at:now-RESUME_MAX_AGE_MS},record,service,a,now),'expired');
 for(const invalid of [{id:'c'.repeat(64)},{ref:'stale-generation'},{service:'https://foreign.invalid/v1'},{workspace:b},{at:now+1},{at:NaN},{version:0}])
  assert.equal(resumeDecision({...marker,...invalid},record,service,a,now),'mismatch',JSON.stringify(invalid));
 assert.equal(resumeDecision(marker,record,service,b,now),'mismatch');
 assert.equal(resumeDecision(marker,record,'https://foreign.invalid/v1',a,now),'mismatch');
 assert.equal(resumeDecision(marker,undefined,service,a,now),'mismatch');
 console.log('PASS destination/service/activity/credential generation/time validation, slow restart, symlink and Korean paths');
 // A successful arrival must retire its own loop guard before a later manual A→B visit.
 const attemptKey='hypeproofChat.workspaceSwitchAttempt', arrived={...record,workspace:b}, arrival={...marker,workspace:b};
 const navigation={globalState:state(),workspaceState:state()};
 await navigation.globalState.update(attemptKey,b);
 vscode.workspace.workspaceFolders=[{uri:{fsPath:a}}];
 let committed=0;
 await assert.rejects(ensureWorkspace({workspace_root:b,workspace_start:'empty'},navigation,false,async()=>{committed++;},b),/Activity workspace is not the active root/,'a failed/unacknowledged B attempt must not auto-loop');
 assert.equal(committed,0);
 await navigation.globalState.update(attemptKey,b);
 await navigation.globalState.update(resumeKey(b),arrival);
 assert.equal(await consumeActivityResume(navigation,arrived,service,b),'valid');
 assert.equal(navigation.globalState.get(attemptKey),undefined,'valid actual destination arrival retires only its own loop guard');
 assert.equal(await ensureWorkspace({workspace_root:b,workspace_start:'empty'},navigation,false,async()=>{committed++;},b),true,'later explicit A→B visit must execute production openFolder');
 assert.equal(committed,1);assert.deepEqual(commands,['vscode.openFolder']);commands.length=0;
 vscode.workspace.workspaceFolders=[];
 console.log('PASS production ensureWorkspace: failed attempt refuses; valid destination arrival permits later explicit revisit');
 for (const [invalid,status] of [[{...arrival,ref:'stale'},'mismatch'],[{...arrival,at:now-RESUME_MAX_AGE_MS},'expired'],[{...arrival,service:'https://foreign.invalid/v1'},'mismatch']]) {
  await navigation.globalState.update(attemptKey,b);await navigation.globalState.update(resumeKey(b),invalid);
  assert.equal(await consumeActivityResume(navigation,arrived,service,b),status);
  assert.equal(navigation.globalState.get(attemptKey),b,'invalid arrival cannot retire a failed-attempt guard');
  vscode.workspace.workspaceFolders=[{uri:{fsPath:a}}];
  await assert.rejects(ensureWorkspace({workspace_root:b,workspace_start:'empty'},navigation,false,async()=>assert.fail('failed attempt must never commit'),b),/Activity workspace is not the active root/);
 }
 await navigation.globalState.update(attemptKey,a);await navigation.globalState.update(resumeKey(b),arrival);
 assert.equal(await consumeActivityResume(navigation,arrived,service,b),'valid');
 assert.equal(navigation.globalState.get(attemptKey),a,'valid B arrival cannot erase another destination attempt');
 vscode.workspace.workspaceFolders=[];
 console.log('PASS stale/expired/foreign arrivals preserve no-retry guards; other destinations remain untouched');
 await navigation.globalState.update(attemptKey,b);
 await navigation.globalState.update(resumeKey(b),{...arrival,state:{['hps.activity.draft.'+arrived.id]:{text:'pending'}}});
 const originalUpdate=navigation.workspaceState.update;navigation.workspaceState.update=async()=>{throw Error('draft storage unavailable');};
 await assert.rejects(consumeActivityResume(navigation,arrived,service,b),/draft storage unavailable/);
 assert.equal(navigation.globalState.get(attemptKey),b,'failed destination restore preserves loop guard');
 assert(navigation.globalState.get(resumeKey(b)),'failed restore retains resume marker for explicit recovery');
 navigation.workspaceState.update=originalUpdate;



 const ctx={globalState:state(),workspaceState:state(),secrets:{keys:async()=>[]}};
 const own='hypeproofChat.history:'+record.id,foreign='hypeproofChat.history:'+'c'.repeat(64),draft='hps.activity.draft.'+record.id;
 const pending={...marker,state:{[own]:['source history'],[foreign]:['must never import'],[draft]:{text:'saved draft'}}};
 await ctx.globalState.update(resumeKey(a),pending);
 assert.equal(await consumeActivityResume(ctx,undefined,service,b),'absent');
 assert.equal(ctx.globalState.get(resumeKey(a)),pending,'another window cannot consume this marker');
 await ctx.workspaceState.update(own,['destination history']);
 assert.equal(await consumeActivityResume(ctx,record,service,a),'valid');
 assert.deepEqual(ctx.workspaceState.get(own),['destination history']);
 assert.deepEqual(ctx.workspaceState.get(draft),{text:'saved draft'});assert.equal(ctx.workspaceState.get(foreign),undefined);
 assert.equal(ctx.globalState.get(resumeKey(a)),undefined);
 for(const invalid of [{...pending,ref:'revoked'},{...pending,at:now-RESUME_MAX_AGE_MS}]) {
  ctx.workspaceState.map.clear();await ctx.globalState.update(resumeKey(a),invalid);
  await consumeActivityResume(ctx,record,service,a);assert.equal(ctx.workspaceState.map.size,0,'invalid marker imports no state');
 }
 console.log('PASS one-shot existing-store checkpoint: destination work wins, no foreign keys, no stale import, multiwindow isolation');
 const initial=[];
 await initializeFilesLayout(async c=>initial.push(c));await initializeFilesLayout(async c=>initial.push(c));
 assert.deepEqual(initial,['workbench.action.closeSidebar','workbench.action.closeSidebar'],'first launch and subsequent folder activations close any restored Explorer');
 const focusEvents=[];
 const focusPanel={reveal(column){focusEvents.push(['reveal',column]);},webview:{postMessage(message){focusEvents.push(['message',message]);return Promise.resolve(true);}}};
 assert.equal(ChatPanelProvider.prototype.focusEditor.call({context:{},editorChat:focusPanel}),true);
 assert.equal(focusEvents[0][0],'reveal');assert.equal(focusEvents[1][0],'message');assert.equal(focusEvents[1][1].type,'focusInput');
 assert.equal(ChatPanelProvider.prototype.focusEditor.call({context:{}}),false,'closed editor does not create a second chat or send focus');
 const beforePassive=focusEvents.length;await ChatPanelProvider.prototype.openInEditor.call({editorChat:focusPanel},focusPanel);
 assert.equal(focusEvents.length,beforePassive+1,'passive reveal sends no composer focus request');
 assert.equal(focusEvents.at(-1)[0],'reveal');
 const panel={reveal(){}};await ChatPanelProvider.prototype.openInEditor.call({editorChat:panel},panel);
 await StartPage.prototype.show.call({chat:{renderHtml:()=>'<html>'},context:{extensionUri:{},subscriptions:[]},refresh:async()=>{},resumePurchase:async()=>{}});
 assert.deepEqual(commands,[],'opening chat or start must preserve the Explorer and the user layout');
 await StartPage.prototype.handle.call({},{type:'openStudioFiles'});
 assert.deepEqual(commands,['workbench.view.explorer'],'the explicit file-view action still opens Explorer');
 await initializeFilesLayout(async c=>commands.push(c));
 assert.deepEqual(commands,['workbench.view.explorer','workbench.action.closeSidebar'],'a later activation closes an explicitly opened Explorer again');
 commands.length=0;
 const issuer='eyJyb2xlIjogImlzc3VlciJ9.fakesig';
 assert.equal(resolveActivateBranch(undefined,false),'show');assert.equal(resolveActivateBranch(issuer,false),'skip');
 assert.equal(resolveActivateBranch(issuer,true),'resume');assert.equal(resolveActivateBranch(undefined,true),'resume');
 console.log('PASS Explorer closed on every activation, explicit file view opens it, chat entry preserves current layout; validated learner resume wins over issuer');
 // Exercise real activation up to the activity-store boundary: layout must finish first.
 const closed=[];
 const ordinary={label:'notes.md',input:{uri:{fsPath:path.join(a,'notes.md')}}};
 vscode.window.tabGroups={all:[{tabs:[ordinary]}],close:async()=>assert.fail('startup must not close ordinary editors')};
 const fresh={close:async()=>closed.push('new-session')};
 const restored=[{close:async()=>{closed.push('restored-visible');restored.push(fresh);}},
   {close:async()=>{closed.push('restored-inactive');}}];
 vscode.window.browserTabs=restored;
 const untilActivityStore={get globalStorageUri(){closed.push('activity-init');throw Error('activity-store-test-boundary');}};
 await assert.rejects(activate(untilActivityStore),/activity-store-test-boundary/);
 assert.deepEqual(closed,['restored-visible','restored-inactive','activity-init'],'visible and inactive restored browser tabs close before activity initialization, without chasing new tabs');
 assert.deepEqual(commands,['workbench.action.closeSidebar']);commands.length=0;
 assert.equal(vscode.window.tabGroups.all[0].tabs[0],ordinary,'ordinary file editor remains');
 vscode.window.openBrowserTab=async url=>{assert.equal(url,'http://127.0.0.1:45000/');restored.push(fresh);return fresh;};
 await openBrowser('http://127.0.0.1:45000/');
 assert(!closed.includes('new-session'),'a later explicit preview opens without startup cleanup closing it');
 closed.length=0;
 vscode.window.browserTabs=[{close(){throw Error('already disposed');}},
   {close:async()=>{throw Error('close rejected');}}, {close:async()=>{closed.push('remaining-preview');}}];
 await assert.rejects(activate(untilActivityStore),/activity-store-test-boundary/);
 assert.deepEqual(closed,['remaining-preview','activity-init'],'failed/closed preview tabs cannot block other cleanup or activation');
 commands.length=0;vscode.window.browserTabs=[];
 await assert.rejects(activate(untilActivityStore),/activity-store-test-boundary/);
 assert.deepEqual(commands,['workbench.action.closeSidebar'],'an empty browser list needs no editor-wide close command');
 console.log('PASS actual activation closes restored browser previews before activity storage; ordinary editors, new previews and startup after close failure remain available');

} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
