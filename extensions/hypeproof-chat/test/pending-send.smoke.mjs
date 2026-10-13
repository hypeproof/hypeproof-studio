import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
let proxyUrl='https://api.hypeproof-ai.xyz/v1';
const vscode={workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='proxyUrl'?proxyUrl:fallback})}};
const module={exports:{}};
let fetchImpl=()=>assert.fail('no network expected');
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortSignal,URL,TextEncoder,TextDecoder,fetch:(...args)=>fetchImpl(...args)});
const proto=module.exports.ChatPanelProvider.prototype;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function host(){return {pendingSends:0,activeStreams:new Map(),hasActiveStream:proto.hasActiveStream,handleSend:proto.handleSend,applyPendingFundingSelection:proto.applyPendingFundingSelection,post:async()=>{}};}
// Pause the actual send before profile/stream creation. Both submit routes must
// own the connection immediately; an exception must release that ownership.
for(const type of ['sendMessage','retryMessage']){
 const h=host(),auth=deferred();h.context={secrets:{get:()=>auth.promise}};
 assert.equal(h.hasActiveStream(),false);
 const pending=proto.handleMessage.call(h,{type,text:'여행 계획을 정리해줘',prompt:'여행 계획을 정리해줘',history:[]});
 assert.equal(h.activeStreams.size,0);assert.equal(h.hasActiveStream(),true,'accepted send locks before credential read completes');
 auth.reject(new Error('synthetic storage failure'));
 await assert.rejects(pending,/synthetic storage failure/);
 assert.equal(h.hasActiveStream(),false,'early failure releases the connection');
}
// A duplicate click/retry during authentication cannot take another writer or
// make the real turn look ended. Its text and image return to the draft.
{
 const h=host(),auth=deferred(),posts=[];let reads=0;
 h.context={secrets:{get:()=>{reads++;return auth.promise;}}};h.post=async m=>posts.push(m);
 const first=proto.handleSend.call(h,'정리해줘',[]);
 await proto.handleMessage.call(h,{type:'retryMessage',prompt:'추가 계획',history:[],images:['synthetic-image']});
 assert.equal(reads,1,'the duplicate never reads credentials or acquires another writer');
 assert.equal(h.pendingSends,1);assert.equal(h.hasActiveStream(),true);
 assert.equal(posts.length,1);assert.equal(posts[0].type,'inputRejected');
 assert.equal(posts[0].text,'추가 계획');assert.deepEqual(posts[0].images,['synthetic-image']);
 assert.match(posts[0].notice,/초안/);
 auth.reject(new Error('first'));await assert.rejects(first,/first/);
 assert.equal(h.hasActiveStream(),false);
}
// Even a no-model response remains bound until its history write finishes.
{
 const h=host(),save=deferred(),posts=[];h.cachedProfile={worlds:[{id:'synthetic',emoji:'',guest:'테스트',chip:'테스트'}]};
 h.coachDisplayName=()=> '코치';h.appendHistory=()=>save.promise;
 h.post=async m=>{posts.push(m);if(m.type==='streamEnd')assert.equal(h.hasActiveStream(),false,'queued next send is released only after writer cleanup');};
 const pending=proto.handleSend.call(h,'다른 친구도 있어?',[]);
 assert.equal(h.activeStreams.size,0);assert.equal(h.hasActiveStream(),true,'history persistence still owns activity');
 assert.equal(posts.some(m=>m.type==='streamEnd'),false,'pending history must not flush the next message yet');
 save.resolve();await pending;assert.equal(h.hasActiveStream(),false);assert.equal(posts.filter(m=>m.type==='streamEnd').length,1);
}
// The inverse ordering: preparation already owns the connection, so no send
// reaches secrets or history. No provider call is needed by these controls.
{
 const h=host();h.connectionChanging=true;h.context={secrets:{get:()=>assert.fail('must not read credentials')}};
 await proto.handleMessage.call(h,{type:'sendMessage',text:'정리해줘',history:[]});
 assert.equal(h.hasActiveStream(),false);
}
// Funding selection observes the same pre-stream boundary as activity switching.
{
 const h=host(),auth=deferred();h.context={secrets:{get:()=>auth.promise}};
 h.accessState={selected:'a',view:{choices:[{id:'a',active:true},{id:'b',active:true}]}};
 h.loadAccess=async()=>{};h.postConfig=async()=>{};
 const pending=proto.handleSend.call(h,'일정 정리',[]);
 await proto.handleMessage.call(h,{type:'selectFunding',id:'b'});
 assert.equal(h.accessState.selected,'a','pending authentication must retain the original funding source');
  assert.equal(h.accessState.pendingSelection,'b','the explicit choice is queued visibly instead of silently discarded');
 auth.reject(new Error('synthetic'));await assert.rejects(pending,/synthetic/);
  assert.equal(h.accessState.selected,'b','queued choice applies when the prior request actually releases its claim');
  assert.equal(h.accessState.pendingSelection,undefined);
}
// A failed background usage refresh must not restore the selection it captured
// before the person explicitly selected a ready source.
{
 const h=host(),refresh=deferred(),token='synthetic-funding-token';
 h.context={secrets:{get:async()=>token}};h.accessScope=createHash('sha256').update(proxyUrl+'\0'+token).digest('hex');
 h.accessCheckedAt=Date.now();h.accessState={status:'ready',view:{choices:[{id:'ready',active:true},{id:'ended',active:false}]}};
 h.loadAccess=proto.loadAccess;h.postConfig=async()=>{};fetchImpl=()=>refresh.promise;
 const pending=h.loadAccess(true);await new Promise(resolve=>setTimeout(resolve,0));
 await proto.handleMessage.call(h,{type:'selectFunding',id:'ready'});
 assert.equal(h.accessState.selected,'ready');refresh.reject(new Error('synthetic refresh failure'));await pending;
 assert.equal(h.accessState.selected,'ready','refresh failure preserves the newer explicit selection');
 assert.equal(h.accessState.status,'unknown','preserving selection does not invent usage readiness');
}
// The same participant token at another endpoint is another funding scope.
{
 const h=host(),token='synthetic-same-token';h.context={secrets:{get:async()=>token}};
 h.accessScope=createHash('sha256').update(proxyUrl+'\0'+token).digest('hex');h.accessCheckedAt=Date.now();
 h.accessState={status:'ready',selected:'previous-service',view:{choices:[]}};
 proxyUrl='https://other-service.example.invalid/v1';let requests=0;
 fetchImpl=async url=>{requests++;assert.equal(url,proxyUrl+'/access');return{ok:true,json:async()=>({schema:'hps-access-view/1',configured:false,as_of:new Date().toISOString(),choices:[]})};};
 await proto.loadAccess.call(h);assert.equal(requests,1);assert.equal(h.accessState.selected,undefined);
 proxyUrl='https://api.hypeproof-ai.xyz/v1';
}
// Account changes discard queued choices; ended sources are never selected.
{
 const h=host();h.context={};h.accessScope='old';h.loadAccess=async()=>{};h.postConfig=async()=>{};
 h.accessState={status:'ready',selected:'a',view:{choices:[{id:'b',active:true},{id:'ended',active:false}]}};
 h.pendingSends=1;await proto.handleMessage.call(h,{type:'selectFunding',id:'b'});
 h.accessScope='new';h.pendingSends=0;h.applyPendingFundingSelection();
 assert.equal(h.accessState.selected,'a');assert.equal(h.accessState.pendingSelection,undefined);assert.match(h.accessState.notice,/연결이 바뀌/);
 await proto.handleMessage.call(h,{type:'selectFunding',id:'ended'});
 assert.equal(h.accessState.selected,'a');assert.match(h.accessState.notice,/선택할 수 없/);
}
console.log('PASS pending send: authentication wait, retry, duplicate draft preservation, queue-safe history persistence and connection preparation');
