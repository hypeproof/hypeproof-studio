import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
let proxyUrl='https://api.hypeproof-ai.xyz/v1';
const vscode={env:{appName:'HypeProof Studio'},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='proxyUrl'?proxyUrl:fallback})}};
const module={exports:{}};
let fetchImpl=()=>assert.fail('no network expected');
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortSignal,URL,TextEncoder,TextDecoder,fetch:(...args)=>fetchImpl(...args)});
const proto=module.exports.ChatPanelProvider.prototype;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function host(){
 const posts=[];
 // Exercise request snapshots and retry validation too; a partial method copy
 // can fail before the deferred storage boundary this test is meant to cover.
 return Object.assign(Object.create(proto),{pendingSends:0,activeStreams:new Map(), delegationControls: new Map(),turnTimelines:new Map(),turnRequests:new Map(),getHistory:()=>[],posts,post:async message=>{posts.push(message);}});
}
// Pause the actual send before profile/stream creation. Both submit routes must
// own the connection immediately; an exception must release that ownership.
for(const type of ['sendMessage','retryMessage']) for(const toolMode of ['auto','web-search']){
 const h=host(),auth=deferred();let reads=0;h.context={secrets:{get:()=>{reads++;return auth.promise;}}};
 assert.equal(h.hasActiveStream(),false);
 const text='여행 계획을 정리해줘',images=['data:image/png;base64,c3ludGhldGlj'],userMessageId='pending-user';
 const pending=proto.handleMessage.call(h,{type,text,prompt:text,history:[],images,toolMode,userMessageId});
 assert.equal(reads,1,'the real credential read must be reached before injecting its failure');
 assert.equal(h.activeStreams.size,0);assert.equal(h.hasActiveStream(),true,'accepted send locks before credential read completes');
 auth.reject(new Error('synthetic storage failure'));
 await assert.rejects(pending,/synthetic storage failure/);
 assert.equal(h.hasActiveStream(),false,'early failure releases the connection');
 assert.equal(h.turnRequests.get(userMessageId)?.message.toolMode,toolMode,'failed request retains its own retry mode');
 const rejected=h.posts.findIndex(message=>message.type==='inputRejected');
 const error=h.posts.findIndex(message=>message.type==='streamError');
 assert.ok(rejected>=0&&error>rejected,'restore input before reporting the failed pending send');
 assert.equal(h.posts[rejected].text,text);assert.deepEqual(h.posts[rejected].images,images);assert.equal(h.posts[rejected].toolMode,toolMode);
}
// A counter, not a boolean: one rejected pending send cannot unlock another.
{
 const h=host(),first=deferred(),second=deferred();let reads=0;
 h.context={secrets:{get:()=>++reads===1?first.promise:second.promise}};
 const a=proto.handleSend.call(h,'정리해줘',[]),b=proto.handleSend.call(h,'계획해줘',[]);
 first.reject(new Error('first'));await assert.rejects(a,/first/);
 assert.equal(h.hasActiveStream(),true);second.reject(new Error('second'));await assert.rejects(b,/second/);
 assert.equal(h.hasActiveStream(),false);
}
// Even a no-model response remains bound until its history write finishes.
// A failed write restores the request instead of leaving a false saved result.
for(const fail of [false,true]){
 const h=host(),save=deferred();h.cachedProfile={worlds:[{id:'synthetic',emoji:'',guest:'테스트',chip:'테스트'}]};
 h.coachDisplayName=()=> '코치';h.appendHistory=()=>save.promise;
 const post=h.post;h.post=async message=>{if(message.type==='streamEnd')assert.equal(h.hasActiveStream(),false,'completion must permit the queued follow-up');return post(message);};
 const pending=proto.handleSend.call(h,'다른 친구도 있어?',[]);
 assert.equal(h.activeStreams.size,0);assert.equal(h.hasActiveStream(),true,'history persistence still owns activity');
 assert.equal(h.posts.some(message=>message.type==='streamEnd'),false,'saving history is not yet completion');
 if(fail){
  save.reject(new Error('synthetic history failure'));await assert.rejects(pending,/synthetic history failure/);
  assert.equal(h.posts.find(message=>message.type==='inputRejected')?.text,'다른 친구도 있어?');
  assert.equal(h.posts.find(message=>message.type==='inputRejected')?.toolMode,'auto');
  assert.ok(h.posts.some(message=>message.type==='streamError'),'a displayed reply must not hide a failed history write');
  assert.equal(h.posts.find(message=>message.type==='streamError').streamId,h.posts.find(message=>message.type==='streamStart').streamId,'a post-start storage failure belongs to that displayed turn, not a preflight code');
  assert.equal(h.posts.some(message=>message.type==='streamEnd'),false,'failed storage cannot signal successful completion');
 }else{save.resolve();await pending;assert.equal(h.posts.some(message=>message.type==='inputRejected'),false);}
 assert.equal(h.hasActiveStream(),false);
}
// App-authored replies outside handleSend (publish/switch/image edit) own the
// same persistence boundary and must always terminate their displayed stream.
for(const fail of [false,true]){
 const h=host(),save=deferred();h.coachDisplayName=()=> '코치';h.appendHistory=()=>save.promise;
 const post=h.post;h.post=async message=>{
  if(['streamEnd','streamError'].includes(message.type))assert.equal(h.hasActiveStream(),false,'terminal notification must release standalone reply ownership first');
  return post(message);
 };
 const pending=proto.postAppReply.call(h,'앱에서 작업 결과를 알려드립니다.');
 assert.equal(h.hasActiveStream(),true,'standalone reply locks while history is being saved');
 assert.deepEqual(h.posts.map(message=>message.type),['streamStart','streamChunk']);
 if(fail){save.reject(new Error('synthetic app reply storage failure'));await assert.rejects(pending,/synthetic app reply storage failure/);}
 else{save.resolve();await pending;}
 const terminal=h.posts.filter(message=>['streamEnd','streamError','streamStopped'].includes(message.type));
 assert.equal(terminal.length,1,'exactly one completion or failure for the displayed reply');
 assert.equal(terminal[0].type,fail?'streamError':'streamEnd');
 if(fail)assert.equal(terminal[0].retryable,false,'replaying an unrelated user prompt cannot retry an app history write');
 assert.equal(terminal[0].streamId,h.posts[0].streamId);
 assert.equal(h.hasActiveStream(),false);
}
// A standalone reply settling cannot release a different pending request.
{
 const h=host(),save=deferred(),auth=deferred();h.coachDisplayName=()=> '코치';h.appendHistory=()=>save.promise;
 h.context={secrets:{get:()=>auth.promise}};
 const reply=proto.postAppReply.call(h,'작업 결과');
 const send=proto.handleSend.call(h,'후속 질문',[]);
 save.reject(new Error('reply failed'));await assert.rejects(reply,/reply failed/);
 assert.equal(h.hasActiveStream(),true,'another request retains ownership');
 auth.reject(new Error('send failed'));await assert.rejects(send,/send failed/);
 assert.equal(h.hasActiveStream(),false);
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
// Host admission cannot trust a stale webview's enabled composer. Missing,
// removed, or ended funding choices return the original draft before any AI
// stream/workspace preparation; a valid choice and legacy/local paths proceed.
for (const selected of [undefined,'removed','ended','ready']) {
 const h=host(),posts=[];let configPosts=0;
 h.context={secrets:{get:async()=> 'synthetic-token'},workspaceState:{get:()=>undefined}};
 h.getCoach=()=>null;h.ensureProfile=async()=>null;h.loadAccess=async()=>{};
 h.post=async m=>{if(m.type!=='lowDisk')posts.push(m);};h.postConfig=async()=>{configPosts++;};
 h.accessState={status:'ready',selected,view:{required:true,choices:[{id:'ready',active:true},{id:'ended',active:false}]}};
 // The first read after admission is the seat's instructor mode (folder consent); reaching it means the turn was admitted.
 Object.defineProperty(h,'_instructorMode',{get(){throw Error('accepted turn reached preparation');}});
 if(selected==='ready') {
  await assert.rejects(proto.handleSend.call(h,'자료 요청',[],['synthetic-image']),/accepted turn reached preparation/);
  assert.equal(posts.some(m=>/이용권을 선택/.test(m.notice??'')),false,'a valid choice is admitted without the funding notice');
 } else {
  await proto.handleSend.call(h,'자료 요청',[],['synthetic-image']);
  assert.equal(posts.length,1);assert.equal(posts[0].type,'inputRejected');
  assert.equal(posts[0].text,'자료 요청');assert.deepEqual(posts[0].images,['synthetic-image']);
  assert.match(posts[0].notice,/이용권을 선택/);assert.equal(h.accessState.selected,undefined);
  assert.equal(configPosts,1);
 }
 assert.equal(h.hasActiveStream(),false);
}
for (const local of [false,true]) {
 const h=host();h.context={secrets:{get:async()=> 'synthetic-token'},workspaceState:{get:()=>undefined}};
 h.getCoach=()=>null;h.ensureProfile=async()=>null;h.loadAccess=async()=>{};
 h.accessState={status:'ready',view:{required:local,choices:[]}};
 Object.defineProperty(h,'_instructorMode',{get(){throw Error('accepted turn reached preparation');}});
 const savedEnv={...process.env};
 try {
  if(local) {
   vscode.env.appName='HypeProof Studio Dev';proxyUrl='http://127.0.0.1:8787/v1';
   Object.assign(process.env,{HPS_DEV_RUNTIME:'1',HPS_DEV_PROVIDER:'claude',HPS_DEV_EXECUTABLE:process.execPath,HPS_DEV_MODEL:'synthetic'});
  }
  await assert.rejects(proto.handleSend.call(h,'자료 요청',[]),/accepted turn reached preparation/);
 } finally {
  for(const k of ['HPS_DEV_RUNTIME','HPS_DEV_PROVIDER','HPS_DEV_EXECUTABLE','HPS_DEV_MODEL']) {
   if(savedEnv[k]===undefined)delete process.env[k];else process.env[k]=savedEnv[k];
  }
  vscode.env.appName='HypeProof Studio';proxyUrl='https://api.hypeproof-ai.xyz/v1';
 }
}

// Failed interrupted writes remain task-bound and recover exactly once.
{
 const h=host();let scope='original',writes=0,refuse=true;
 h.turnRequestScope=()=>scope;
 const messages=[{id:'stopped-user',role:'user',content:'계획해줘'},{id:'stopped-answer',role:'assistant',content:'부분 답변'}];
 h.interruptedHistory={scope,messages};
 h.appendHistory=async items=>{writes++;assert.equal(items,messages);if(refuse)throw Error('synthetic disk refusal');};
 await assert.rejects(h.retryInterruptedHistory(),/받은 대화를 저장하지 못했습니다/);
 assert.ok(h.interruptedHistoryError(),'failed persistence remains visible');
 scope='other';await h.retryInterruptedHistory();assert.equal(writes,1,'never append another task transcript here');
 assert.equal(h.interruptedHistoryError(),null);
 scope='original';refuse=false;await h.retryInterruptedHistory();await h.retryInterruptedHistory();
 assert.equal(writes,2,'recovered transcript is not written twice');assert.equal(h.interruptedHistoryError(),null);
}

// A transport abort is not a user Stop unless this turn was actually cancelled.
for (const stopped of [false, true]) {
 const h=host(), ctrl=new AbortController();
 if(stopped) ctrl.abort();
 await proto.handleSendError.call(h,Object.assign(new Error('synthetic transport timeout'),{name:'AbortError'}),'transport-abort',{profile:null,proxyUrl:'https://synthetic.invalid',signal:ctrl.signal});
 assert.equal(h.posts.filter(message=>message.type==='streamError').length,stopped?0:1,'uncancelled transport failure must end the spinner; explicit Stop stays quiet');
}

// Older workspaces also reuse the failed request id when the user retries.
{
 const h=host();let saved=[{id:'question',role:'user',content:'계획해줘',createdAt:1},{id:'partial',role:'assistant',content:'받은 부분',createdAt:2}];
 h.getHistory=()=>saved;h.historyKey=()=> 'synthetic-history';
 h.context={workspaceState:{update:async (_key,messages)=>{saved=messages;}}};
 await h.appendHistory([{id:'question',role:'user',content:'계획해줘',createdAt:3},{id:'complete',role:'assistant',content:'완료한 답변',createdAt:4}]);
 assert.deepEqual(Array.from(saved,message=>message.id),['question','partial','complete'],'retry preserves partial context and one original question');
}
console.log('PASS pending send: authentication wait, retry, overlapping failures, funding admission, history persistence and connection preparation');
