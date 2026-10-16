import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const bundle = await build({stdin:{contents:"export * from './src/studioNavigation';export {resolveActivateBranch} from './src/extension';export {ChatPanelProvider} from './src/chatPanelProvider';export {StartPage} from './src/startPage';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const commands=[], mod={exports:{}};
const vscode={ViewColumn:{One:1},commands:{executeCommand:async c=>commands.push(c)},Uri:{joinPath:()=>({})},window:{createWebviewPanel:()=>({webview:{onDidReceiveMessage(){},html:''},onDidChangeViewState(){},onDidDispose(){}})}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),process,console,Buffer,URL});
const {resumeDecision,resumeKey,consumeActivityResume,initializeFilesLayout,INITIAL_LAYOUT_KEY,RESUME_MAX_AGE_MS,resolveActivateBranch,ChatPanelProvider,StartPage}=mod.exports;
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
 const fresh={globalState:state(),workspaceState:state(),secrets:{keys:async()=>[]}},initial=[];
 await initializeFilesLayout(fresh,async c=>initial.push(c));await initializeFilesLayout(fresh,async c=>initial.push(c));
 assert.deepEqual(initial,['workbench.view.explorer']);assert.equal(fresh.globalState.get(INITIAL_LAYOUT_KEY),true);
 for(const established of ['state','credential']) {
  const c={globalState:state(),workspaceState:state(),secrets:{keys:async()=>established==='credential'?['hps.activity.credential.saved']:[]}};
  if(established==='state')await c.workspaceState.update(own,[]);
  await initializeFilesLayout(c,async()=>assert.fail('existing layout must be preserved'));
 }
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
 const issuer='eyJyb2xlIjogImlzc3VlciJ9.fakesig';
 assert.equal(resolveActivateBranch(undefined,false),'show');assert.equal(resolveActivateBranch(issuer,false),'skip');
 assert.equal(resolveActivateBranch(issuer,true),'resume');assert.equal(resolveActivateBranch(undefined,true),'resume');
 console.log('PASS first-run Explorer only once; existing layout and chat entry preserved; validated learner resume wins over issuer');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
