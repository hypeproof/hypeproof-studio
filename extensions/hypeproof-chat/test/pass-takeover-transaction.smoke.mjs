import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export {StartPage} from './src/startPage.ts';export {ActivityConnections} from './src/activityConnections.ts';export {ensureWorkspace} from './src/extension.ts';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const service='https://synthetic.invalid/v1';
let responseProfile, chosen, navigationFailure=false;
const vscode={workspace:{workspaceFolders:[],getConfiguration:()=>({get:(k,d)=>k==='proxyUrl'?service:d})},window:{showOpenDialog:async()=>chosen?[{fsPath:chosen}]:undefined,showInformationMessage(){}},Uri:{file:fsPath=>({fsPath})},commands:{executeCommand:async name=>{if(name==='vscode.openFolder'&&navigationFailure)throw Error('injected navigation failure');}}};
const mod={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),process,console,Buffer,URL,AbortSignal,TextEncoder,TextDecoder,setTimeout,clearTimeout,fetch:async url=>new Response(JSON.stringify(url.endsWith('/activity')?{activity_id:responseProfile.activity_id}:responseProfile),{status:200})});
const {ActivityConnections,StartPage,ensureWorkspace}=mod.exports;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hps-pass-transaction-'));
const profile=(id,home,pass=false)=>({activity_id:id.repeat(64),activity_kind:pass?'trial':'class',profile_id:'synthetic',display_name:'Synthetic activity',ux:{coach:{naming_mode:'fixed'}},welcome:{},workspace_root:home,workspace_start:'empty',...(pass?{pass:{request_limit:200,requests_used:0}}:{})});
function open(root){vscode.workspace.workspaceFolders=[{uri:{fsPath:root},name:path.basename(root)}];}
async function fixture(){
 const base=fs.mkdtempSync(path.join(tmp,'case-')),home=path.join(base,'home'),other=path.join(base,'other');fs.mkdirSync(home);fs.mkdirSync(other);
 fs.writeFileSync(path.join(home,'index.html'),'learner original');fs.writeFileSync(path.join(home,'notes.md'),'learner notes');
 const secrets=new Map(),state=new Map(),global=new Map();let failStore=false;
 const raw={globalStorageUri:{fsPath:path.join(base,'storage')},extension:{packageJSON:{version:'test'}},workspaceState:{keys:()=>[...state.keys()],get:(k,d)=>state.has(k)?state.get(k):d,update:async(k,v)=>state.set(k,v)},globalState:{get:(k,d)=>global.has(k)?global.get(k):d,update:async(k,v)=>global.set(k,v)},secrets:{keys:async()=>[...secrets.keys()],get:async k=>secrets.get(k),store:async(k,v)=>{if(failStore)throw Error('injected secret failure');secrets.set(k,v);},delete:async k=>secrets.delete(k),onDidChange:()=>({dispose(){}})}};
 open(home);const oldProfile=profile('a',home),store=new ActivityConnections(raw,()=>service,()=>vscode.workspace.workspaceFolders[0].uri.fsPath,async()=>responseProfile);await store.commit('synthetic-old',oldProfile,home);
 const scoped=store.wrap();let starts=0;const chat={ensureProfile:async()=>store.current?.serverId===oldProfile.activity_id?oldProfile:responseProfile,profileFailure:()=>null,invalidateProfile(){},refreshConfig(){},hasActiveStream:()=>false,setConnectionChanging(){},coachDisplayName:()=> 'Coach',coachNameIsChosen:()=>true,openInEditor:async()=>starts++};
 const states=[];const page=new StartPage(scoped,chat,(p,commit,selected)=>ensureWorkspace(p,scoped,false,commit,selected));page.panel={webview:{postMessage:async msg=>states.push(msg)}};
 const binding=path.join(base,'storage/activity-bindings',fs.readdirSync(path.join(base,'storage/activity-bindings')).find(f=>f.endsWith('.json')));
 return {home,other,raw,store,page,secrets,state,states,binding,starts:()=>starts,failStore:v=>failStore=v};
}
function snapshot(s){return {binding:fs.readFileSync(s.binding,'utf8'),secrets:[...s.secrets],state:[...s.state],ref:s.store.current.ref};}
function preserved(s,before){assert.equal(fs.readFileSync(s.binding,'utf8'),before.binding);assert.deepEqual([...s.secrets],before.secrets);assert.deepEqual([...s.state],before.state);assert.equal(s.store.current.ref,before.ref);assert.equal(fs.readFileSync(path.join(s.home,'index.html'),'utf8'),'learner original');assert.equal(fs.readFileSync(path.join(s.home,'notes.md'),'utf8'),'learner notes');assert.equal(s.starts(),0);open(s.home);s.store.acquire()();}
try{
 // Real host order: chooser -> fresh profile -> prepare -> commit -> openFolder.
 for(const failure of ['prepare','secret','navigation']){
  const s=await fixture(),before=snapshot(s);responseProfile=profile('b',s.home,true);open(s.other);chosen=s.home;
  await s.page.handle({type:'connectCourse',token:'synthetic-new'});await s.page.handle({type:'chooseActivityFolder'});
  if(failure==='prepare'){const original=s.store.prepare.bind(s.store);s.store.prepare=(root,p,prepare)=>original(root,p,()=>{prepare();throw Error('injected preparation failure');});}
  if(failure==='secret')s.failStore(true);navigationFailure=failure==='navigation';
  await s.page.handle({type:'beginCourse'});navigationFailure=false;s.failStore(false);
  preserved(s,before);assert.ok(s.states.at(-1).state.error);console.log('PASS actual host call order preserves exact old binding/credential/files after '+failure+' failure');
 }
 for(const source of ['chooser','saved','revalidation']){
  const s=await fixture();responseProfile=profile('b',s.other,true);chosen=s.home;
  if(source==='saved'){
   // A previously valid local record must not override the newly fetched Service home.
   const undo=await s.store.commit('synthetic-saved',profile('b',s.home,true),s.home),record=s.store.current;
   await undo();s.secrets.set(record.ref,JSON.stringify(record));
   await s.page.handle({type:'selectActivity',ref:record.ref});
  }else{
   if(source==='revalidation')responseProfile=profile('b',s.home,true);
   await s.page.handle({type:'connectCourse',token:'synthetic-new'});await s.page.handle({type:'chooseActivityFolder'});
   responseProfile=profile('b',s.other,true);
  }
  const before=snapshot(s);await s.page.handle({type:'beginCourse'});preserved(s,before);assert.match(s.states.at(-1).state.error,/다른 활동/);console.log('PASS '+source+' cannot convert a bound nonhome folder into Service pass home');
 }
 const s=await fixture();responseProfile=profile('b',s.home,true);chosen=s.home;
 const oldWindow=new ActivityConnections(s.raw,()=>service,()=>s.home,async()=>responseProfile);await oldWindow.initialize();
 await s.page.handle({type:'connectCourse',token:'synthetic-new'});await s.page.handle({type:'chooseActivityFolder'});await s.page.handle({type:'beginCourse'});
 assert.equal(s.store.current.serverId,responseProfile.activity_id);assert.equal(s.starts(),1);assert.throws(()=>oldWindow.acquire(),/다른 활동/);s.store.acquire()();
 assert.equal(fs.readFileSync(path.join(s.home,'index.html'),'utf8'),'learner original');
 console.log('PASS fresh nominal home takes over prior class, preserves files, starts once and blocks old window');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
