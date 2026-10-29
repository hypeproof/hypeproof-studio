import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export {StartPage} from './src/startPage';export {ActivityConnections} from './src/activityConnections';export {ensureWorkspace} from './src/extension';export {resumeKey,consumeActivityResume} from './src/studioNavigation';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const service='https://synthetic.invalid/v1';
let response,chosen,choice,active=false,failNavigation=false,failFreeze=false,denied=false,proxy=service,dialogs=0,releaseDialog;
const commands=[];
const vscode={workspace:{workspaceFolders:[],getConfiguration:()=>({get:(k,d)=>k==='proxyUrl'?proxy:d})},window:{showOpenDialog:async()=>{dialogs++;if(releaseDialog)await new Promise(r=>releaseDialog=r);return chosen?[{fsPath:chosen}]:undefined;},showInformationMessage:async()=>choice},Uri:{file:fsPath=>({fsPath})},commands:{executeCommand:async(name,...args)=>{commands.push({name,args});if(name==='vscode.openFolder'&&failNavigation)throw Error('injected navigation failure');}}};
const mod={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),process,console,Buffer,URL,AbortSignal,TextEncoder,TextDecoder,setTimeout,clearTimeout,fetch:async url=>new Response(JSON.stringify(denied?{error:{code:'revoked'}}:url.endsWith('/activity')?{activity_id:response.activity_id}:response),{status:denied?401:200})});
const {ActivityConnections,StartPage,ensureWorkspace,resumeKey,consumeActivityResume}=mod.exports;
const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hps-folder-nav-')));
const profile=(id,root)=>({activity_id:id.repeat(64),activity_kind:'trial',profile_id:'synthetic',display_name:'Synthetic activity',ux:{coach:{naming_mode:'fixed'}},welcome:{},workspace_root:root,workspace_start:'empty'});
const memento=()=>{const map=new Map();return {map,keys:()=>[...map.keys()],get:(k,d)=>map.has(k)?map.get(k):d,update:async(k,v)=>{if(v===undefined)map.delete(k);else map.set(k,v);}};};
const open=root=>vscode.workspace.workspaceFolders=[{uri:{fsPath:root},name:path.basename(root)}];
async function fixture(){
 const base=fs.mkdtempSync(path.join(tmp,'case-')),a=path.join(base,'작업 A'),b=path.join(base,'작업 B'),c=path.join(base,'unbound');for(const r of [a,b,c])fs.mkdirSync(r);
 fs.writeFileSync(path.join(a,'notes.md'),'original A');fs.writeFileSync(path.join(b,'notes.md'),'original B');
 const secrets=new Map(),globalState=memento(),states=new Map([[a,memento()],[b,memento()],[c,memento()]]);
 const raw=root=>({globalStorageUri:{fsPath:path.join(base,'storage')},extension:{packageJSON:{version:'test'}},workspaceState:states.get(root),globalState,secrets:{keys:async()=>[...secrets.keys()],get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k),onDidChange:()=>({dispose(){}})}});
 open(a);response=profile('a',a);const pa=response,rb=raw(b),sa=new ActivityConnections(raw(a),()=>proxy,()=>vscode.workspace.workspaceFolders[0].uri.fsPath,async()=>response);
 await sa.commit('synthetic-A',pa,a);const sb=new ActivityConnections(rb,()=>proxy,()=>b,async()=>response);await sb.commit('synthetic-A',pa,b);
 const ctx=sa.wrap(),shown=[];let starts=0,freezes=0;
 const chat={ensureProfile:async()=>denied?null:response,profileFailure:()=>null,invalidateProfile(){},refreshConfig(){},hasActiveStream:()=>active,setConnectionChanging:async v=>{if(v){freezes++;if(failFreeze)throw Error('draft flush not acknowledged');}},coachDisplayName:()=> 'Coach',coachNameIsChosen:()=>true,openInEditor:async()=>starts++};
 const page=new StartPage(ctx,chat,(p,commit,selected)=>ensureWorkspace(p,ctx,false,commit,selected));page.panel={webview:{postMessage:async m=>shown.push(m)}};
 const history='hypeproofChat.history:'+sa.scope,draft='hps.activity.draft.'+sa.scope;
 await ctx.workspaceState.update(history,[{role:'user',text:'A history'}]);await ctx.workspaceState.update(draft,{text:'A draft'});
 commands.length=0;active=false;chosen=undefined;choice=undefined;proxy=service;denied=false;failFreeze=false;failNavigation=false;releaseDialog=undefined;
 return {a,b,c,pa,sa,sb,raw,ctx,page,shown,secrets,globalState,states,history,draft,starts:()=>starts,freezes:()=>freezes};
}
function lastOpen(){return commands.filter(c=>c.name==='vscode.openFolder').at(-1);}
function untouched(s){assert.equal(fs.readFileSync(path.join(s.a,'notes.md'),'utf8'),'original A');assert.equal(fs.readFileSync(path.join(s.b,'notes.md'),'utf8'),'original B');assert.equal(s.ctx.workspaceState.get(s.draft).text,'A draft');}
try {
 // StartPage general folder picker goes through the production router, not the E2E bypass.
 const s=await fixture();chosen=s.b;
 await s.page.handle({type:'openLocalFolder'});
 assert.equal(lastOpen().args[0].fsPath,s.b);assert.equal(lastOpen().args[1].forceReuseWindow,true);assert.equal(s.starts(),0,'reload must precede chat');
 const pending=s.globalState.get(resumeKey(s.b));assert.equal(pending.workspace,fs.realpathSync(s.b));assert.equal(pending.service,service);assert.equal(pending.ref,s.sa.current.ref);assert.equal(JSON.stringify(pending).includes('synthetic-A'),false);
 open(s.b);const reopened=new ActivityConnections(s.raw(s.b),()=>proxy,()=>s.b,async()=>response);await reopened.initialize();
 assert.equal(await reopened.token(),'synthetic-A');assert.equal(await consumeActivityResume(s.raw(s.b),reopened.current,service,s.b),'valid');
 assert.equal(s.states.get(s.b).get(s.draft).text,'A draft');assert.equal(s.states.get(s.b).get(s.history)[0].text,'A history');untouched(s);
 const again=new ActivityConnections(s.raw(s.b),()=>proxy,()=>s.b,async()=>response);await again.initialize();assert.equal(await again.token(),'synthetic-A');
 console.log('PASS general folder picker -> production prepare/commit/resume/open -> destination activation/restart keeps credential and existing draft/history');
 // A folder explicitly disconnected earlier can be intentionally entered from A again.
 const disconnected=await fixture();await disconnected.sb.disconnect();chosen=disconnected.b;
 await disconnected.page.handle({type:'openLocalFolder'});open(disconnected.b);
 const reconnected=new ActivityConnections(disconnected.raw(disconnected.b),()=>service,()=>disconnected.b,async()=>response);await reconnected.initialize();
 assert.equal(await reconnected.token(),'synthetic-A');
 // Existing B history is B's work; never overwrite it with A's checkpoint.
 const existing=await fixture();existing.states.get(existing.b).map.set(existing.history,[{text:'B history'}]);chosen=existing.b;await existing.page.handle({type:'openLocalFolder'});open(existing.b);
 const target=new ActivityConnections(existing.raw(existing.b),()=>proxy,()=>existing.b,async()=>response);await target.initialize();await consumeActivityResume(existing.raw(existing.b),target.current,service,existing.b);
 assert.equal(existing.states.get(existing.b).get(existing.history)[0].text,'B history');untouched(existing);
 // Activity folder selector and ordinary begin/re-entry both honor the bound folder over profile defaults.
 const activity=await fixture();await activity.page.handle({type:'selectActivity',ref:activity.sa.current.ref});chosen=activity.b;await activity.page.handle({type:'chooseActivityFolder'});await activity.page.handle({type:'beginCourse'});assert.equal(lastOpen().args[0].fsPath,activity.b);
 const reentry=await fixture();response={...reentry.pa,workspace_root:reentry.b};await reentry.page.handle({type:'beginCourse'});assert.equal(lastOpen(),undefined);assert.equal(reentry.starts(),1);assert.equal(reentry.sa.current.workspace,reentry.a);
 console.log('PASS activity folder picker and bound-folder re-entry retain the selected folder; destination saved history wins');
 // No dialog, authority change or navigation may happen while execution/approval is outstanding.
 const streaming=await fixture();const before=streaming.sa.current.ref;active=true;const dialogsBefore=dialogs;
 for(const type of ['openLocalFolder','chooseActivityFolder','beginCourse'])await streaming.page.handle({type});
 assert.equal(dialogs,dialogsBefore);assert.equal(lastOpen(),undefined);assert.equal(streaming.sa.current.ref,before);untouched(streaming);active=false;
 // Cancel and confirmed draft-flush failure both preserve the original window/state.
 for(const failure of ['cancel','navigation','flush','credential']) {
  const f=await fixture(),ref=f.sa.current.ref,secretCount=f.secrets.size;
  chosen=failure==='cancel'?undefined:f.b;failNavigation=failure==='navigation';failFreeze=failure==='flush';denied=failure==='credential';
  await f.page.handle({type:'openLocalFolder'});failNavigation=false;failFreeze=false;denied=false;
  assert.equal(f.sa.current.ref,ref);assert.equal(f.secrets.size,secretCount);assert.equal(f.globalState.get(resumeKey(f.b)),undefined);assert.equal(f.starts(),0);untouched(f);
 }
 console.log('PASS streaming blocks transition; picker cancel, navigation failure, unacknowledged draft save and revoked credential preserve source and clear pending resume');
 // Opening an unbound folder asks; dismissal never silently claims it.
 const unbound=await fixture();chosen=unbound.c;await unbound.page.handle({type:'openLocalFolder'});assert.equal(lastOpen(),undefined);assert.equal(await unbound.sa.forWorkspace(unbound.c),undefined);
 choice='현재 활동 연결';await unbound.page.handle({type:'openLocalFolder'});assert.equal(lastOpen().args[0].fsPath,unbound.c);assert.equal((await unbound.sa.forWorkspace(unbound.c)).serverId,unbound.pa.activity_id);untouched(unbound);
 // A different activity retains its own binding/state; no source checkpoint is attached.
 const different=await fixture();const pB=profile('b',different.b),other=new ActivityConnections(different.raw(different.b),()=>service,()=>different.b,async()=>pB);
 // Explicitly create an independent B folder, not a takeover of A's existing folder.
 const d=path.join(path.dirname(different.b),'other activity');fs.mkdirSync(d);different.states.set(d,memento());await other.commit('synthetic-B',pB,d);response=pB;chosen=d;
 await different.page.handle({type:'openLocalFolder'});assert.equal(lastOpen().args[0].fsPath,d);assert.equal(different.globalState.get(resumeKey(d)).state,undefined);untouched(different);
 // Same folder belonging to another Service refuses before a network request or new binding.
 const foreign=await fixture();proxy='https://foreign.invalid/v1';chosen=foreign.b;await foreign.page.handle({type:'openLocalFolder'});assert.equal(lastOpen(),undefined);assert.match(foreign.shown.at(-1).state.error,/다른 서버/);proxy=service;
 console.log('PASS unbound-folder explicit intent, different-activity isolation and foreign-Service refusal');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
