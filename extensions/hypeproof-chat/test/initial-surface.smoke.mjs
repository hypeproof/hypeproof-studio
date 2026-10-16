import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export * from './src/initialSurface';export * from './src/studioNavigation';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const mod={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require,process,console,Buffer,URL});
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
}finally{fs.rmSync(root,{recursive:true,force:true});}
