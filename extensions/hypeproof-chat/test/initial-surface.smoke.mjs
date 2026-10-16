import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export * from './src/initialSurface';export * from './src/studioNavigation';export * from './src/startPage';export * from './src/activityConnections';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const vscode={workspace:{workspaceFolders:[],getConfiguration:()=>({get:()=>service})},window:{},Uri:{joinPath:()=>({fsPath:'/synthetic/dist'})},ViewColumn:{One:1}};
let servedProfile,httpStatus=200;const requests=[];
const mod={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),process,console,Buffer,URL,AbortSignal,TextEncoder,setTimeout,fetch:async url=>{
 assert.equal(new URL(url).origin,new URL(service).origin,'No real/external request allowed');requests.push(new URL(url).pathname);
 if(String(url).endsWith('/purchase/products'))return new Response(JSON.stringify({products:[]}),{status:200});
 return new Response(JSON.stringify(httpStatus===200?servedProfile:{error:{code:'signature'}}),{status:httpStatus});
}});
const {restoreInitialSurface,consumeActivityResume,resumeKey,RESUME_MAX_AGE_MS,WORKSPACE_SWITCH_ATTEMPT_KEY}=mod.exports;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hps-initial-surface-'));
const service='https://synthetic.invalid/v1',record={version:1,id:'b'.repeat(64),serverId:'a'.repeat(64),service,workspace:root,ref:'hps.activity.credential.synthetic'};
const history='hypeproofChat.history:'+record.id,draft='hps.activity.draft.'+record.id;
const state=()=>{const map=new Map();return{map,keys:()=>[...map.keys()],get:(k,d)=>map.has(k)?map.get(k):d,update:async(k,v)=>{if(v===undefined)map.delete(k);else map.set(k,v);}};};
const issuer='eyJyb2xlIjogImlzc3VlciJ9.fakesig';
const expiredCopy='폴더 전환 확인 시간이 지났습니다. 저장된 활동에서 이어가세요. 작업 파일과 연결은 보존됩니다.';
const mismatchCopy='폴더 전환 정보가 현재 활동·서버·폴더와 일치하지 않습니다. 저장된 활동을 확인해 주세요.';
async function scenario(kind,{profile=true,storedIssuer,connection={current:record,matchesService:true}}={}){
 const context={globalState:state(),workspaceState:state()};
 const marker={version:1,id:record.serverId,service,workspace:root,ref:record.ref,at:Date.now(),state:{[history]:['saved turn'],[draft]:{text:'saved draft'}}};
 if(kind==='expired')marker.at-=RESUME_MAX_AGE_MS;
 if(kind==='mismatch')marker.ref='wrong-generation';
 if(kind!=='absent')await context.globalState.update(resumeKey(root),marker);
 await context.globalState.update(WORKSPACE_SWITCH_ATTEMPT_KEY,root);
 const decision=await consumeActivityResume(context,connection?.current,service,root);
 const events=[];
 await restoreInitialSurface({decision,getStoredIssuer:async()=>storedIssuer,connections:()=>connection,
  notifyExpired:message=>{events.push(['expired',message]);return new Promise(()=>{});},
  notifyMismatch:message=>{events.push(['mismatch',message]);return new Promise(()=>{});},
  showStart:async()=>{events.push(['start']);},ensureProfile:async()=>{events.push(['profile']);if(profile instanceof Error)throw profile;return profile;},openChat:async()=>{events.push(['chat']);}});
 return{decision,events,context,marker};
}
try{
 for(const [kind,copy]of [['expired',expiredCopy],['mismatch',mismatchCopy]]){
  const result=await scenario(kind);assert.equal(result.decision,kind);assert.deepEqual(result.events,[[kind,copy],['start']]);
  assert.equal(result.context.workspaceState.map.size,0,'invalid checkpoint must not silently restore history or draft');
  assert.equal(result.context.globalState.get(resumeKey(root)),undefined,'existing consumer retires invalid checkpoint');
  assert.equal(result.context.globalState.get(WORKSPACE_SWITCH_ATTEMPT_KEY),root,'invalid checkpoint cannot clear the failed-switch guard');
  assert.deepEqual(await scenario(kind,{storedIssuer:issuer}).then(r=>r.events),[[kind,copy]],'issuer still receives notification without learner auto-resume');
 }
 console.log('PASS expired/mismatched checkpoint → exact host notification, no profile/chat or state import; issuer behavior preserved');
 for(const storedIssuer of [undefined,issuer]){
  const result=await scenario('valid',{storedIssuer});assert.deepEqual(result.events,[['start'],['profile'],['chat']]);
  assert.deepEqual(result.context.workspaceState.get(history),['saved turn']);assert.deepEqual(result.context.workspaceState.get(draft),{text:'saved draft'});
  assert.equal(result.context.globalState.get(resumeKey(root)),undefined);assert.equal(result.context.globalState.get(WORKSPACE_SWITCH_ATTEMPT_KEY),undefined);
 }
 assert.deepEqual((await scenario('valid',{profile:false})).events,[['start'],['profile']]);
 await assert.rejects(scenario('valid',{profile:new Error('profile unavailable')}),/profile unavailable/);
 assert.deepEqual((await scenario('absent')).events,[['start'],['profile'],['chat']]);
 for(const connection of [null,{current:undefined,matchesService:true},{current:record,matchesService:false}]){
  assert.deepEqual((await scenario('absent',{connection})).events,[['start']]);
  assert.deepEqual((await scenario('absent',{connection,storedIssuer:issuer})).events,[]);
 }
 assert.deepEqual((await scenario('absent',{storedIssuer:'malformed',connection:null})).events,[['start']]);
 console.log('PASS valid learner precedence, revalidation success/failure, absent bound/unbound/foreign-Service and issuer paths');
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
 const secret=deferred(),surface=deferred(),profile=deferred(),chat=deferred(),events=[];
 const ready=restoreInitialSurface({decision:'valid',getStoredIssuer:()=>secret.promise,connections:()=>{events.push('binding');return{current:record,matchesService:true};},notifyExpired:()=>assert.fail(),notifyMismatch:()=>assert.fail(),showStart:()=>{events.push('start');return surface.promise;},ensureProfile:()=>{events.push('profile');return profile.promise;},openChat:()=>{events.push('chat');return chat.promise;}});
 let settled=false;ready.then(()=>{settled=true;});assert.deepEqual(events,[]);
 secret.resolve();await new Promise(r=>setImmediate(r));assert.deepEqual(events,['binding','binding','start']);assert.equal(settled,false);
 surface.resolve();await new Promise(r=>setImmediate(r));assert.equal(events.at(-1),'profile');assert.equal(settled,false);
 profile.resolve(true);await new Promise(r=>setImmediate(r));assert.equal(events.at(-1),'chat');assert.equal(settled,false);
 chat.resolve();await ready;assert.equal(settled,true);
 console.log('PASS readiness awaits stored issuer, start surface, profile and chat restoration; no auto-AI callback exists');

 // Include actual StartPage mounting/refresh: a stub showStart hides transitive profile reads.
 const {StartPage,ActivityConnections}=mod.exports;
 for(const kind of ['expired','mismatch','valid','absent']){
  const work=path.join(root,'integrated-'+kind);fs.mkdirSync(work);const vault=new Map(),posted=[];
  const raw={globalStorageUri:{fsPath:path.join(root,'storage-'+kind)},globalState:state(),workspaceState:state(),extensionUri:{fsPath:'/synthetic'},extension:{packageJSON:{version:'control'}},subscriptions:[],secrets:{keys:async()=>[...vault.keys()],get:async k=>vault.get(k),store:async(k,v)=>{vault.set(k,v);},delete:async k=>{vault.delete(k);},onDidChange:()=>({dispose(){}})}};
  servedProfile={activity_id:'a'.repeat(64),activity_kind:'classroom',profile_id:'synthetic',display_name:'Synthetic activity',ux:{coach:{naming_mode:'fixed',fallback_name:'Coach'}},welcome:{},series_index:1,series_total:1};httpStatus=200;
  const connections=new ActivityConnections(raw,()=>service,()=>work,async()=>servedProfile);await connections.commit('synthetic-local-only',servedProfile,work);const context=connections.wrap(),saved=connections.current;
  const marker={version:1,id:saved.serverId,ref:saved.ref,service,workspace:work,at:Date.now(),state:{['hps.activity.draft.'+saved.id]:{text:'must not import invalid checkpoint'}}};
  if(kind==='expired')marker.at-=RESUME_MAX_AGE_MS;if(kind==='mismatch')marker.ref='wrong-generation';
  if(kind!=='absent')await raw.globalState.update(resumeKey(work),marker);
  const decision=await consumeActivityResume(context,saved,service,work);assert.equal(decision,kind);
  let profileReads=0,chatEntries=0,viewChanged;
  const chatHost={renderHtml:()=>'<html></html>',ensureProfile:async()=>{profileReads++;return servedProfile;},profileFailure:()=>null,coachDisplayName:()=> 'Coach',coachNameIsChosen:()=>true,hasActiveStream:()=>false,setConnectionChanging:async()=>{},invalidateProfile(){},refreshConfig(){},openInEditor:async()=>{chatEntries++;}};
  const panels=[];vscode.window.createWebviewPanel=()=>{const panel={reveal(){},webview:{html:'',onDidReceiveMessage(){},postMessage:async msg=>posted.push(msg)},onDidChangeViewState:fn=>{viewChanged=fn;},onDidDispose(){}};panels.push(panel);return panel;};
  const page=new StartPage(context,chatHost,async(_profile,commit)=>{await commit(work);return false;});
  const mount=async options=>{await page.show(options);await page.handle({type:'startReady'});await new Promise(r=>setImmediate(r));};
  await restoreInitialSurface({decision,getStoredIssuer:async()=>undefined,connections:()=>connections,notifyExpired:()=>{},notifyMismatch:()=>{},showStart:mount,ensureProfile:()=>chatHost.ensureProfile(true),openChat:()=>page.openChat()});
  if(kind==='valid'||kind==='absent'){assert(profileReads>0);assert.equal(chatEntries,1,'Valid/absent bound arrival still resumes actual chat entry');continue;}
  assert.equal(profileReads,0,'Invalid arrival Start mounting must not passively hydrate the current profile');assert.equal(chatEntries,0);
  const passive=async()=>{await page.handle({type:'startReady'});viewChanged({webviewPanel:{active:true}});page.inboxChanged();await page.show();await new Promise(r=>setImmediate(r));};
  const beforeRequests=requests.length;await passive();assert.equal(profileReads,0);assert(!requests.slice(beforeRequests).some(p=>p==='/v1/profile'));
  assert.equal(posted.at(-1).state.profile,undefined);assert.equal(posted.at(-1).state.activities[0].ref,saved.ref,'Saved local activities remain available without profile hydration');
  const beforeVault=JSON.stringify([...vault]);httpStatus=401;await page.handle({type:'selectActivity',ref:saved.ref});assert.equal(page.candidate,undefined);assert(posted.at(-1).state.error);assert.equal(profileReads,0);assert.equal(JSON.stringify([...vault]),beforeVault,'Denied explicit selection preserves credentials');
  httpStatus=200;const beforeSelection=requests.length;await page.handle({type:'selectActivity',ref:saved.ref});assert(requests.slice(beforeSelection).includes('/v1/profile'),'Explicit saved selection still validates through the actual profile client');assert.equal(posted.at(-1).state.candidate,true);assert.equal(chatEntries,0);assert.equal(profileReads,0);
  await page.handle({type:'cancelCandidate'});await passive();assert.equal(profileReads,0,'Cancel/reveal must not rehydrate the old current profile');assert.equal(JSON.stringify([...vault]),beforeVault);
  assert.equal(context.workspaceState.get('hps.activity.draft.'+saved.id),undefined,'Invalid checkpoint draft stays absent through preview/cancel');
  await page.handle({type:'selectActivity',ref:saved.ref});await page.handle({type:'beginCourse'});assert.equal(chatEntries,1,'Explicit selection and begin can enter the saved activity');assert(profileReads>0);assert(requests.includes('/v1/activity'),'Explicit begin retains actual execution-eligibility verification');
  const afterEntry=profileReads;await mount();assert(profileReads>afterEntry,'Successful entry retires passive hydration suppression');
  assert(!JSON.stringify(posted).includes('synthetic-local-only'),'Credential never reaches the Start surface');
 }
 console.log('PASS actual restoration→StartPage: invalid arrival mount/view/inbox/reveal/cancel defer profile; saved selection denial/preview/entry retain validation; valid/absent restore unchanged');
}finally{fs.rmSync(root,{recursive:true,force:true});}
