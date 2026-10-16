import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {renderResponse} from './render-protocol.mjs';import {rawHeadlessCdp,waitForHeadlessEndpoint,waitForHeadlessPageTarget} from './headless-cdp.mjs';
const request=results=>({model:'scripted',tools:[{name:'mcp__hypeproof__browser_screenshot'}],messages:[{role:'user',content:[{type:'text',text:'HPS_RENDER_PROOF:390:positive'},...results]}]});
const config={origin:'http://127.0.0.1:1234'};
test('explicit render protocol requests real MCP tools and only hashes supplied screenshot result bytes',()=>{
 const opened=renderResponse(request([]),config);assert(opened.stream.includes('mcp__hypeproof__browser_open'));assert.equal(opened.metadata.results.length,0);
 const next=renderResponse(request([{type:'tool_result',tool_use_id:'render_open',content:'Opened'}]),config);assert(next.stream.includes('mcp__hypeproof__browser_screenshot'));assert.equal(next.metadata.results[0].images.length,0);
 const bytes=Buffer.from('test image bytes'),result={type:'tool_result',tool_use_id:'render_shot',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:bytes.toString('base64')}}]};
 const complete=renderResponse(request([{type:'tool_result',tool_use_id:'render_open',content:'Opened'},result]),config);assert(complete.stream.includes('HPS_RENDER_PROOF_COMPLETE'));assert.equal(complete.metadata.results[1].images[0].sha256,createHash('sha256').update(bytes).digest('hex'));
 const denied=renderResponse(request([{...result,is_error:true,content:'Tool unavailable'}]),config);assert.equal(denied.metadata.results[0].is_error,true);assert.deepEqual(denied.metadata.results[0].images,[]);
});
test('render protocol refuses external/arbitrary origins and missing mode before issuing tools',async()=>{
 for(const origin of['https://example.com','http://localhost:1234','http://127.0.0.1:1234/other','http://user:pass@127.0.0.1:1234','http://127.0.0.1:1234?x=y'])assert.throws(()=>renderResponse(request([]),{origin}));
 assert.throws(()=>renderResponse({...request([]),messages:[]},config));await assert.rejects(rawHeadlessCdp('ws://example.com/browser'),/Owned loopback/);
});
test('headless readiness waits for unlocked complete endpoint, and refuses exit, permanent errors and timeout',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hps-headless-ready-')),file=path.join(dir,'DevToolsActivePort'),child={exitCode:null,signalCode:null};
 try{
  const pending=waitForHeadlessEndpoint(file,child,{timeoutMs:1000,intervalMs:5});
  fs.writeFileSync(file,'12345\n');
  const write=setTimeout(()=>fs.writeFileSync(file,'12345\r\n/devtools/browser/1234-abcd\r\n'),20);
  try{assert.deepEqual(await pending,{port:12345,wsPath:'/devtools/browser/1234-abcd'});}finally{clearTimeout(write);}
  let reads=0;
  const unlocked=await waitForHeadlessEndpoint(file,child,{timeoutMs:1000,intervalMs:1,readFile(...args){if(++reads===1)throw Object.assign(Error('Windows writer owns file'),{code:'EBUSY'});return fs.readFileSync(...args);}});
  assert.equal(unlocked.port,12345);assert.equal(reads,2);
  await assert.rejects(waitForHeadlessEndpoint(file,{exitCode:1,signalCode:null}),/exited before readiness/);
  await assert.rejects(waitForHeadlessEndpoint(file,child,{readFile(){throw Object.assign(Error('Denied'),{code:'EACCES'});}}),/Denied/);
  fs.writeFileSync(file,'70000\n/devtools/browser/1234-abcd');
  await assert.rejects(waitForHeadlessEndpoint(file,child,{timeoutMs:10,intervalMs:2}),/readiness timed out/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('page readiness observes initial page after empty/non-page targets without creating or attaching',async()=>{
 const child={exitCode:null,signalCode:null},seen=[],signals=[];
 const target=await waitForHeadlessPageTarget({port:12345},child,{intervalMs:1,fetchImpl:async(url,options)=>{
  seen.push(url);signals.push(options.signal);assert.equal(options.redirect,'error');
  return {ok:true,json:async()=>seen.length===1?[]:seen.length===2?[{type:'service_worker',id:'worker',url:'about:blank'},{type:'page',id:'other',url:'https://example.com'}]:[{type:'page',id:'owned-page',url:'about:blank'}]};
 }});
 assert.deepEqual(target,{targetId:'owned-page'});assert.deepEqual(seen,Array(3).fill('http://127.0.0.1:12345/json/list'));assert(signals.every(s=>s.aborted));
});
test('page readiness refuses errors and aborts pending discovery on deadline or owned child exit',async()=>{
 const live=()=>({exitCode:null,signalCode:null});
 let called=0;await assert.rejects(waitForHeadlessPageTarget({port:0},live(),{fetchImpl:()=>called++}),/port required/);assert.equal(called,0);
 await assert.rejects(waitForHeadlessPageTarget({port:12345},{exitCode:1,signalCode:null},{fetchImpl:()=>called++}),/exited before page/);assert.equal(called,0);
 for(const response of[{ok:false},{ok:true,json:async()=>({})}])await assert.rejects(waitForHeadlessPageTarget({port:12345},live(),{fetchImpl:async()=>response}),/discovery/);
 let errorSignal;await assert.rejects(waitForHeadlessPageTarget({port:12345},live(),{fetchImpl:async(_url,{signal})=>{errorSignal=signal;throw Error('transport failure');}}),/transport failure/);assert(errorSignal.aborted);
 await assert.rejects(waitForHeadlessPageTarget({port:12345},live(),{timeoutMs:10,intervalMs:1,fetchImpl:async()=>({ok:true,json:async()=>[]})}),/readiness timed out/);
 for(const die of[false,true]){
  const child=live();let aborted=false,death;
  const pending=waitForHeadlessPageTarget({port:12345},child,{timeoutMs:30,intervalMs:1,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true});if(die)death=setTimeout(()=>{child.signalCode='SIGTERM';},2);})});
  try{await assert.rejects(pending,die?/exited before page/:/readiness timed out/);assert(aborted);}finally{clearTimeout(death);}
 }
});
