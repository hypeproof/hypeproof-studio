import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[new URL('../src/chatPanelProvider.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const vscode={workspace:{getConfiguration:()=>({get:(_key,fallback)=>fallback})}};
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),console,Buffer,process,setTimeout,clearTimeout,AbortSignal,URL,TextEncoder,TextDecoder});
const proto=module.exports.ChatPanelProvider.prototype;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function host(){
 const posts=[];
 // Exercise request snapshots and retry validation too; a partial method copy
 // can fail before the deferred storage boundary this test is meant to cover.
 return Object.assign(Object.create(proto),{pendingSends:0,activeStreams:new Map(),turnTimelines:new Map(),turnRequests:new Map(),getHistory:()=>[],posts,post:async message=>{posts.push(message);}});
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
 auth.reject(new Error('synthetic'));await assert.rejects(pending,/synthetic/);
 await proto.handleMessage.call(h,{type:'selectFunding',id:'b'});
 assert.equal(h.accessState.selected,'b','idle choice is available again');
}
console.log('PASS pending send: authentication wait, retry, overlapping failures, history persistence and connection preparation');
// Failed interrupted writes remain task-bound and recover exactly once.
{
 const h=host();let scope='original',writes=0,refuse=true;
 h.turnRequestScope=()=>scope;
 const messages=[{id:'stopped-user',role:'user',content:'계획해줘'},{id:'stopped-answer',role:'assistant',content:'부분 답변'}];
 h.interruptedHistory={scope,messages};
 h.appendHistory=async items=>{writes++;assert.equal(items,messages);if(refuse)throw Error('synthetic disk refusal');};
 await assert.rejects(h.retryInterruptedHistory(),/중단한 대화를 저장하지 못했습니다/);
 assert.ok(h.interruptedHistoryError(),'failed persistence remains visible');
 scope='other';await h.retryInterruptedHistory();assert.equal(writes,1,'never append another task transcript here');
 assert.equal(h.interruptedHistoryError(),null);
 scope='original';refuse=false;await h.retryInterruptedHistory();await h.retryInterruptedHistory();
 assert.equal(writes,2,'recovered transcript is not written twice');assert.equal(h.interruptedHistoryError(),null);
}
