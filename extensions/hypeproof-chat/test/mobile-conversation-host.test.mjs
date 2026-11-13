import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTaskHarness} from './task-workspace-harness.mjs';
async function host(run){const root=await mkdtemp(join(tmpdir(),'mobile-host-'));try{const f=await createTaskHarness(root);Object.assign(f.h,{_instructorMode:{isInstructor:false},reflectionStreams:new Map(),reflectionRefreshing:false});await run(f);}finally{await rm(root,{recursive:true,force:true})}}
test('actual existing task history is projected, drafts and classroom block remote work',async()=>host(async f=>{
 const id=f.store.getView().activeTaskId;await f.store.append(id,[{id:'user-1',role:'user',content:'내 생각',createdAt:1}]);
 const scope=f.h.mobileConversationScope();assert.equal(scope.task,id);assert.match(scope.workspace,/^[a-f0-9]{64}$/);assert.equal(scope.messages[0].content,'내 생각');assert.equal(scope.ready,true);
 await f.store.saveDraft(id,{text:'아직 쓰는 중',images:[],queued:null});assert.equal(f.h.mobileConversationScope().ready,false);
 let dispatched=0;f.h.handleMessage=async()=>{dispatched++;};
 assert.equal(await f.h.submitMobileConversation(scope,{id:'must-wait',text:'Do not replace the draft'}),false);assert.equal(dispatched,0);
 f.connections.active={...f.activity,kind:'classroom'};assert.equal(f.h.mobileConversationScope(),undefined);
}));
test('mobile submits through typed message boundary and requires persisted answer',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope();let message;
 f.h.handleMessage=async m=>{message=m;await f.store.append(scope.task,[{id:m.userMessageId,role:'user',content:m.text,createdAt:1},{id:'a',role:'assistant',content:'누구의 불편인가요?',createdAt:2}])};
 assert.equal(await f.h.submitMobileConversation(scope,{id:'phone',text:'생각'}),true);
 assert.equal(message.type,'sendMessage');assert.equal(message.activityId,scope.activity);assert.equal(message.taskId,scope.task);assert.equal(message.userMessageId,'phone');assert.equal(f.h.mobileTurn,undefined);
}));
test('mobile preflight rejects stale scope and does not report success after stream error',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope();let count=0;f.h.handleMessage=async()=>{count++;await f.h.post({type:'streamError',streamId:'x',error:'offline'})};
 assert.equal(await f.h.submitMobileConversation({...scope,task:'old'},{id:'p',text:'hello'}),false);assert.equal(count,0);
 assert.equal(await f.h.submitMobileConversation(scope,{id:'p',text:'hello'}),false);assert.equal(count,1);
}));

test('reflection remains in the existing task store and never becomes a desktop execution relay',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope();const binding={session:'account-session',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};
 await f.h.saveReflectionBinding(binding);assert.equal(f.h.mobileConversationScope(),undefined);assert.equal(f.h.mobileConversationScope(true).task,scope.task);
 const remote={state:{id:'personal-reflection',revision:2,messages:[{id:'phone-user',role:'user',content:'요즘 사람을 가르쳐요.',created_at:1},{id:'phone-answer',role:'assistant',content:'최근 마음에 남은 순간이 있나요?',created_at:2}],has_earlier:false,turn:null},opening:'요즘 어떤 일에 시간을 많이 쓰세요?',hint:'정리되지 않아도 괜찮아요.'};
 f.h.setReflectionAccount({conversationSession:async()=>binding.session,reflectionRequest:async()=>remote});
 await f.h.refreshPersonalReflection();assert.equal(f.store.getHistory()[0].id,'phone-user');
 await f.h.refreshPersonalReflection();assert.equal(f.store.getHistory().length,2);
 await f.h.handleTaskMessage({type:'taskCreate',taskId:scope.task});
 await f.h.openPersonalReflection();assert.equal(f.store.getView().activeTaskId,scope.task);assert.equal(f.store.getHistory().length,2);
 f.h.setReflectionAccount({conversationSession:async()=> 'different-account'});
 await assert.rejects(f.h.applyReflectionSnapshot(binding,{...remote,state:{...remote.state,revision:3}}));
 assert.equal(f.store.getHistory().length,2);
}));
test('uncertain reflection send preserves an idempotent pending request and restores input',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope();const binding={session:'s',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};await f.h.saveReflectionBinding(binding);
 const calls=[];f.h.setReflectionAccount({conversationSession:async()=> 's',reflectionRequest:async(s,path,body)=>{if(body)calls.push(body);throw Error('synthetic offline');}});
 const msg={type:'sendMessage',text:'남겨야 하는 내 이야기',history:[],userMessageId:'original-turn'};
 await f.h.sendPersonalReflection(msg);assert.equal(f.h.reflectionBinding().pending.id,'original-turn');assert.ok(f.posts.some(p=>p.type==='inputRejected'&&p.text===msg.text));
 await f.h.sendPersonalReflection({...msg,userMessageId:'a-new-ui-id'});assert.equal(calls.length,2);assert.equal(calls[1].id,'original-turn');
}));

const privateSnapshot={state:{id:'personal-reflection',revision:2,messages:[{id:'private-user',role:'user',content:'Private account A reflection',created_at:1},{id:'private-answer',role:'assistant',content:'One question?',created_at:2}],has_earlier:false,turn:null},opening:'First question?',hint:'Optional'};
test('a desktop draft keeps receiving phone history and the next explicit send uses its revision',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope(),binding={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};
 await f.h.saveReflectionBinding(binding);
 const draft={...f.store.getDraft(scope.task),text:'아직 정리 중인 내 생각'};await f.store.saveDraft(scope.task,draft);
 const calls=[];f.h.setReflectionAccount({conversationSession:async()=>binding.session,reflectionRequest:async(session,path,body)=>{
  calls.push({session,path,body});if(!body)return privateSnapshot;
  assert.equal(body.revision,2,'The accepted next turn must be based on the refreshed phone history.');
  return {...privateSnapshot,acknowledged_id:body.id,state:{...privateSnapshot.state,revision:4,messages:[...privateSnapshot.state.messages,
   {id:body.id,role:'user',content:body.text,created_at:3},{id:body.id+'-answer',role:'assistant',content:'Next question?',created_at:4}],
   turn:{id:body.id,text:body.text,status:'completed',created_at:3,updated_at:4}}};
 }});
 await f.h.refreshPersonalReflection();
 assert.equal(calls.length,1,'A local draft must not suppress the account-history GET.');assert.equal(calls[0].body,undefined);
 assert.deepEqual(Array.from(f.store.getHistory(),m=>m.id),['private-user','private-answer']);
 assert.equal(f.h.reflectionBinding().revision,2);assert.equal(f.store.getDraft(scope.task).text,draft.text);
 assert.ok(f.posts.some(p=>p.type==='history'&&p.messages.some(m=>m.id==='private-answer')),'The refreshed phone reply must reach the existing desktop view.');
 const reopened=new f.internals.TaskWorkspaceStore(f.activity.workspace,f.activity.id);await reopened.initialize();
 assert.equal(reopened.getDraft(scope.task).text,draft.text);assert.equal(reopened.getHistory(scope.task).length,2);
 assert.equal(f.h.mobileConversationScope(true).ready,false,'Reading history must not make a draft ready for execution.');
 await assert.rejects(f.h.beginPersonalMaking(),/작성 중인 글/);assert.equal(f.store.getView().tasks.length,1);
 assert.equal(calls.length,1,'Sync and refused making must not send a turn.');
 // Match the composer's explicit send boundary; the saved words were preserved until now.
 await f.store.saveDraft(scope.task,{...draft,text:''});
 await f.h.sendPersonalReflection({type:'sendMessage',text:draft.text,history:[],userMessageId:'explicit-next'});
 assert.equal(calls.length,2);assert.equal(calls[1].path,'/turns');
 assert.equal(calls[1].body.revision,2);assert.equal(calls[1].body.text,draft.text);
}));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){await new Promise(setImmediate);await new Promise(setImmediate);}
function answerTo(body){return {...privateSnapshot,acknowledged_id:body.id,state:{...privateSnapshot.state,revision:4,messages:[...privateSnapshot.state.messages,
 {id:body.id,role:'user',content:body.text,created_at:3},{id:body.id+'-answer',role:'assistant',content:'Next question?',created_at:4}],
 turn:{id:body.id,text:body.text,status:'completed',created_at:3,updated_at:4}}};}
async function overlapHost(f){
 const scope=f.h.mobileConversationScope(),binding={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};
 await f.h.saveReflectionBinding(binding);const get=deferred(),calls=[];
 f.vscode.window.showWarningMessage=async()=>undefined;
 const accounts={conversationSession:async()=>binding.session,reflectionRequest:async(session,path,body)=>{calls.push({session,path,body});return body?answerTo(body):get.promise;}};
 f.h.setReflectionAccount(accounts);
 const message={type:'sendMessage',activityId:scope.activity,taskId:scope.task,text:'보내기로 선택한 원래 이야기',history:[],userMessageId:'overlap-original'};
 return {scope,binding,get,calls,accounts,message};
}
test('one explicit Send during history GET keeps durable words and posts once at the fresh revision',async()=>host(async f=>{
 const o=await overlapHost(f),refresh=f.h.refreshPersonalReflection(),sending=f.h.sendPersonalReflection(o.message);
 try {
  await flush();assert.equal(f.h.reflectionBinding().pending?.id,o.message.userMessageId,'Send must enter the durable outbox while the GET is held.');
  assert.equal(f.h.reflectionBinding().pending.text,o.message.text);assert.equal(o.calls.length,1,'No POST may use the pre-refresh revision.');
  assert.equal(f.posts.some(p=>p.type==='inputRejected'),false,'An ordinary sync overlap is not a rejected Send.');
  await f.h.sendPersonalReflection({...o.message,userMessageId:'duplicate-click'});
  await f.h.handleTaskMessage({type:'taskCreate',taskId:o.scope.task});assert.equal(f.store.getView().activeTaskId,o.scope.task);
 } finally {o.get.resolve(privateSnapshot);await Promise.all([refresh,sending]);}
 const posts=o.calls.filter(c=>c.body);assert.equal(posts.length,1);assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)),{id:o.message.userMessageId,text:o.message.text,revision:2});
 assert.equal(f.h.reflectionBinding().pending,undefined);assert.equal(f.h.activeStreams.size,0);
 const reopened=new f.internals.TaskWorkspaceStore(f.activity.workspace,f.activity.id);await reopened.initialize();
 assert.equal(reopened.getHistory(o.scope.task).filter(m=>m.id===o.message.userMessageId).length,1);
 assert.equal(reopened.getHistory(o.scope.task).find(m=>m.id===o.message.userMessageId+'-answer').content,'Next question?');
}));
test('Send arriving during snapshot disk persistence cannot lose its outbox or use the old revision',async()=>host(async f=>{
 const o=await overlapHost(f),entered=deferred(),release=deferred(),append=f.store.append.bind(f.store);
 f.store.append=async(...args)=>{entered.resolve();await release.promise;return append(...args);};
 const refresh=f.h.refreshPersonalReflection();o.get.resolve(privateSnapshot);await entered.promise;
 const sending=f.h.sendPersonalReflection(o.message);await flush();assert.equal(f.h.reflectionBinding().pending?.id,o.message.userMessageId);
 release.resolve();await Promise.all([refresh,sending]);
 assert.equal(o.calls.filter(c=>c.body).length,1);assert.equal(o.calls.find(c=>c.body).body.revision,2);
 assert.equal(f.store.getHistory(o.scope.task).filter(m=>m.id===o.message.userMessageId).length,1);
}));
test('failed or aborted GET preserves queued input across reopen and never replays without explicit Send',async t=>{
 for(const error of [Error('synthetic offline'),Object.assign(Error('synthetic abort'),{name:'AbortError'})])await t.test(error.name+error.message,async()=>host(async f=>{
  const o=await overlapHost(f),refresh=f.h.refreshPersonalReflection();const observed=assert.rejects(refresh);
  const sending=f.h.sendPersonalReflection(o.message);await flush();o.get.reject(error);await Promise.all([observed,sending]);
  assert.equal(o.calls.length,1,'A failed prerequisite must not dispatch or start a hidden follow-up GET.');
  assert.ok(f.posts.some(p=>p.type==='inputRejected'&&p.text===o.message.text));assert.equal(f.h.reflectionBinding().pending.id,o.message.userMessageId);
  // Recreate the provider and disk store, restoring only the persisted Memento
  // value; no in-flight promise, stream lock or callback survives this boundary.
  const saved=JSON.parse(JSON.stringify(f.h.reflectionBinding())),reopened=await createTaskHarness(f.activity.workspace);
  Object.assign(reopened.h,{_instructorMode:{isInstructor:false},reflectionStreams:new Map(),reflectionRefreshing:false});
  await reopened.h.saveReflectionBinding(saved);
  let posts=0;reopened.h.setReflectionAccount({conversationSession:async()=>o.binding.session,reflectionRequest:async(_s,_p,body)=>{if(body){posts++;assert.equal(body.revision,2);return answerTo(body);}return privateSnapshot;}});
  await reopened.h.refreshPersonalReflection();assert.equal(posts,0);assert.equal(reopened.store.getDraft(o.scope.task).text,o.message.text);
  await reopened.h.sendPersonalReflection({...o.message,userMessageId:'new-ui-id'});assert.equal(posts,1);
  assert.ok(reopened.store.getHistory(o.scope.task).some(m=>m.id===o.message.userMessageId));
 }));
});
test('queued Send revalidates account, activity, task and unsafe work after the same GET',async t=>{
 for(const change of ['account-object','account-session','activity','task','hold'])await t.test(change,async()=>host(async f=>{
  const o=await overlapHost(f),refresh=f.h.refreshPersonalReflection();const observed=refresh.catch(()=>{});
  const sending=f.h.sendPersonalReflection(o.message);await flush();assert.equal(f.h.reflectionBinding().pending?.id,o.message.userMessageId);
  if(change==='account-object')f.h.setReflectionAccount({conversationSession:async()=> 'account-b'});
  if(change==='account-session')o.accounts.conversationSession=async()=> 'account-b';
  if(change==='activity')f.connections.active={...f.activity,id:'other-personal'};
  if(change==='task')await f.store.create('Other task',{taskId:f.store.getView().activeTaskId,revision:f.store.getView().revision});
  if(change==='hold')f.h.opsHold='paused';
  o.get.resolve(privateSnapshot);await Promise.all([observed,sending]);assert.equal(o.calls.filter(c=>c.body).length,0);
  // Returning to the original scope restores words, never a delayed send.
  f.connections.active=f.activity;f.h.opsHold=undefined;await f.store.select(o.scope.task,{taskId:f.store.getView().activeTaskId,revision:f.store.getView().revision});o.accounts.conversationSession=async()=>o.binding.session;f.h.setReflectionAccount(o.accounts);
  await f.h.refreshPersonalReflection();assert.equal(o.calls.filter(c=>c.body).length,0);assert.equal(f.store.getDraft(o.scope.task).text,o.message.text);
 }));
});
test('waiting for refresh never rebases an uncertain earlier POST payload',async()=>host(async f=>{
 const o=await overlapHost(f),pending={id:'previous-uncertain',text:o.message.text,revision:0};
 await f.h.saveReflectionBinding({...o.binding,pending});
 const refresh=f.h.refreshPersonalReflection(),sending=f.h.sendPersonalReflection(o.message);await flush();
 o.get.resolve(privateSnapshot);await Promise.all([refresh,sending]);
 const posted=o.calls.filter(c=>c.body);assert.equal(posted.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(posted[0].body)),pending,'Only an explicit never-dispatched wait may adopt the new revision.');
}));
test('a known rejection after refresh clears only that request so edited Send uses a new ID and revision',async t=>{
 for(const code of ['reflection_changed','reflection_busy','invalid_reflection_turn'])await t.test(code,async()=>host(async f=>{
  const o=await overlapHost(f);let reads=0,posts=0;
  o.accounts.reflectionRequest=async(session,path,body)=>{
   o.calls.push({session,path,body});
   if(!body){reads++;return reads===1?o.get.promise:{...privateSnapshot,state:{...privateSnapshot.state,revision:4}};}
   posts++;if(posts===1)throw Object.assign(Error('Known pre-dispatch rejection'),{code});
   assert.equal(body.id,'edited-explicit');assert.equal(body.revision,4);assert.equal(body.text,'내가 고쳐 쓴 이야기');
   const answer=answerTo(body);return {...answer,state:{...answer.state,revision:6}};
  };
  const refresh=f.h.refreshPersonalReflection(),sending=f.h.sendPersonalReflection(o.message);await flush();o.get.resolve(privateSnapshot);await Promise.all([refresh,sending]);
  assert.equal(posts,1,'Reconciliation may read, but must not replay the rejected POST.');assert.equal(reads,2);
  assert.equal(f.h.reflectionBinding().revision,4);assert.equal(f.h.reflectionBinding().pending,undefined,'A known rejection must clear its pending request at the latest binding revision.');
  assert.ok(f.posts.some(p=>p.type==='inputRejected'&&p.text===o.message.text));
  await f.h.sendPersonalReflection({...o.message,userMessageId:'edited-explicit',text:'내가 고쳐 쓴 이야기'});assert.equal(posts,2);
  assert.equal(f.store.getHistory(o.scope.task).filter(m=>m.id==='edited-explicit').length,1);
 }));
});
test('failed queued outbox persistence cannot dispatch when the GET later completes',async()=>host(async f=>{
 const o=await overlapHost(f),refresh=f.h.refreshPersonalReflection(),save=f.h.saveReflectionBinding.bind(f.h);
 f.h.saveReflectionBinding=async(b,update)=>{if(b.pending)throw Error('synthetic disk failure');return save(b,update);};
 await f.h.sendPersonalReflection(o.message);assert.ok(f.posts.some(p=>p.type==='inputRejected'&&p.text===o.message.text));
 o.get.resolve(privateSnapshot);await refresh;assert.equal(o.calls.filter(c=>c.body).length,0);assert.equal(f.h.activeStreams.size,0);
}));
test('draft history refresh still defers during unsafe host work',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope(),binding={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};
 await f.h.saveReflectionBinding(binding);await f.store.saveDraft(scope.task,{...f.store.getDraft(scope.task),text:'Keep my draft'});
 let reads=0;f.h.setReflectionAccount({conversationSession:async()=>binding.session,reflectionRequest:async()=>{reads++;return privateSnapshot;}});
 for(const key of ['taskChanging','connectionChanging','turnRestoreBusy','clearingHistory','opsHold','interruptedHistory','reflectionRefreshing']){
  f.h[key]=true;await f.h.refreshPersonalReflection();f.h[key]=false;
 }
 f.h.verifySession={running:true};await f.h.refreshPersonalReflection();f.h.verifySession=undefined;
 f.h.activeStreams.set('existing-turn',new AbortController());await f.h.refreshPersonalReflection();f.h.activeStreams.clear();
 f.connections.active={...f.activity,kind:'classroom'};await f.h.refreshPersonalReflection();f.connections.active=f.activity;
 f.h._instructorMode.isInstructor=true;await f.h.refreshPersonalReflection();f.h._instructorMode.isInstructor=false;
 assert.equal(reads,0);assert.equal(f.store.getDraft(scope.task).text,'Keep my draft');assert.equal(f.store.getHistory().length,0);
 await f.h.refreshPersonalReflection();assert.equal(reads,1);assert.equal(f.store.getHistory().length,2);
}));
test('account or task changes while a draft refresh waits cannot import the old transcript',async t=>{
 for(const change of ['account','task'])await t.test(change,async()=>host(async f=>{
  const scope=f.h.mobileConversationScope(),binding={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};
  await f.h.saveReflectionBinding(binding);await f.store.saveDraft(scope.task,{...f.store.getDraft(scope.task),text:'Private draft A'});
  let finish;const response=new Promise(resolve=>finish=resolve);let reads=0;
  f.h.setReflectionAccount({conversationSession:async()=>binding.session,reflectionRequest:async()=>{reads++;return response;}});
  const refresh=f.h.refreshPersonalReflection();assert.equal(reads,1);
  if(change==='account')f.h.setReflectionAccount({conversationSession:async()=> 'account-b'});
  else {await f.h.handleTaskMessage({type:'taskCreate',taskId:scope.task});assert.notEqual(f.store.getView().activeTaskId,scope.task);}
  finish(privateSnapshot);await assert.rejects(refresh,/계정이나 열린 대화/);
  assert.equal(f.store.getDraft(scope.task).text,'Private draft A');assert.equal(f.store.getHistory(scope.task).length,0);assert.equal(f.store.getHistory().length,0);
  assert.equal(f.posts.some(p=>p.type==='history'&&p.messages.some(m=>m.id==='private-user')),false);assert.equal(f.h.reflectionRefreshing,false);
 }));
});
async function makingHost(f) {
 const s=f.h.mobileConversationScope(true),b={session:'account-a',activity:s.activity,workspace:s.workspace,task:s.task,revision:2};
 await f.h.saveReflectionBinding(b);await f.store.append(s.task,privateSnapshot.state.messages.map(m=>({id:m.id,role:m.role,content:m.content,createdAt:m.created_at})));
 f.h.setReflectionAccount({conversationSession:async()=> 'account-a',reflectionRequest:async()=>{throw Error('Making must not call Service');}});
 f.vscode.window.showWarningMessage=async()=>undefined;
 return b;
}
test('making copies only human-reviewed words into a durable unsent existing desktop task',async()=>host(async f=>{
 const b=await makingHost(f);let prompts=0;
 f.vscode.window.showInputBox=async options=>{prompts++;assert.equal(options.value,'Private account A reflection');return 'Make a one-page appointment preview';};
 await f.h.beginPersonalMaking();const made=f.store.getView().activeTaskId;
 assert.notEqual(made,b.task);assert.equal(prompts,1);assert.equal(f.store.getDraft(made).text,'Make a one-page appointment preview');assert.equal(f.store.getHistory(made).length,0);
 assert.equal(f.store.getHistory(b.task).length,2);assert.equal(f.store.getDraft(b.task).text,'');assert.equal(f.h.isPersonalReflection(),false);
 const reopened=new f.internals.TaskWorkspaceStore(f.store.root??f.activity.workspace,f.activity.id);await reopened.initialize();
 assert.equal(reopened.getDraft(made).text,'Make a one-page appointment preview');
 assert.equal(f.posts.some(p=>p.type==='streamStart'),false);
}));
test('making cancellation, duplicate clicks and an account change cannot create or leak a draft',async()=>host(async f=>{
 const b=await makingHost(f);f.vscode.window.showInputBox=async()=>undefined;await f.h.beginPersonalMaking();assert.equal(f.store.getView().tasks.length,1);
 let finish,entered;const started=new Promise(r=>entered=r),input=new Promise(r=>finish=r);let count=0;
 f.vscode.window.showInputBox=async()=>{count++;entered();return input;};
 const making=f.h.beginPersonalMaking();await started;await f.h.beginPersonalMaking();assert.equal(count,1);
 f.h.setReflectionAccount({conversationSession:async()=> 'account-b'});finish('Private new intention');await assert.rejects(making,/계정이나 열린 대화/);
 assert.equal(f.store.getView().activeTaskId,b.task);assert.equal(f.store.getView().tasks.length,1);assert.equal(f.store.getDraft(b.task).text,'');
}));
test('failed making persistence reopens the exact reviewed text and preserves the source',async()=>host(async f=>{
 const b=await makingHost(f);let count=0;
 f.vscode.window.showInputBox=async options=>{count++;if(count===1)return 'The words I must keep';assert.equal(options.value,'The words I must keep');return undefined;};
 f.store.create=async()=>{throw Error('Synthetic disk unavailable');};await f.h.beginPersonalMaking();
 assert.equal(count,2);assert.equal(f.store.getView().activeTaskId,b.task);assert.equal(f.store.getView().tasks.length,1);assert.equal(f.store.getHistory(b.task).length,2);
}));
test('navigation during reflection opening cannot rename or import into an unrelated task',async()=>host(async f=>{
 f.vscode.window.showInformationMessage=async()=> '내 이야기 시작하기';
 const a=f.store.getView().activeTaskId;let finish,started;
 const waiting=new Promise(r=>started=r),response=new Promise(r=>finish=r);
 f.h.setReflectionAccount({conversationSession:async()=> 'account-a',reflectionRequest:async()=>{started();return response;}});
 const opening=f.h.openPersonalReflection();await waiting;
 await f.h.handleTaskMessage({type:'taskCreate',taskId:a});const b=f.store.getView().activeTaskId;
 await f.store.rename(b,'Important existing project');await f.store.append(b,[{id:'original',role:'user',content:'Build my website',createdAt:1}]);
 finish(privateSnapshot);await assert.rejects(opening,/열린 작업/);
 assert.equal(f.store.getTask(b).title,'Important existing project');assert.equal(f.store.getHistory().map(m=>m.id).join(','),'original');assert.equal(f.h.reflectionBinding(),undefined);
}));
test('navigation during asynchronous account verification cannot import private output into another binding',async()=>host(async f=>{
 const a=f.h.mobileConversationScope(true),ba={session:'account-a',activity:a.activity,workspace:a.workspace,task:a.task,revision:0};await f.h.saveReflectionBinding(ba);
 await f.h.handleTaskMessage({type:'taskCreate',taskId:a.task});const b=f.h.mobileConversationScope(true),bb={session:'account-b',activity:b.activity,workspace:b.workspace,task:b.task,revision:0};await f.h.saveReflectionBinding(bb);
 await f.h.handleTaskMessage({type:'taskSelect',taskId:b.task,id:a.task});
 let finish,started;const waiting=new Promise(r=>started=r),response=new Promise(r=>finish=r);
 f.h.setReflectionAccount({conversationSession:async()=>{started();return response;}});
 const applying=f.h.applyReflectionSnapshot(ba,privateSnapshot);await waiting;
 await f.h.handleTaskMessage({type:'taskSelect',taskId:a.task,id:b.task});finish('account-a');await assert.rejects(applying,/계정이나 열린 대화/);
 assert.equal(f.h.reflectionBinding().session,'account-b');assert.equal(f.h.reflectionBinding().revision,0);assert.equal(f.store.getHistory().length,0);assert.equal(f.store.getHistory(a.task).length,0);
}));

test('a reflection send holds task navigation before waiting for the durable outbox',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope(true),b={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};await f.h.saveReflectionBinding(b);
 const save=f.h.saveReflectionBinding.bind(f.h);let finish,started;const waiting=new Promise(r=>started=r),delay=new Promise(r=>finish=r);
 f.h.saveReflectionBinding=async value=>{await save(value);if(value.pending){started();await delay;}};
 let calls=0;f.h.setReflectionAccount({conversationSession:async()=> 'account-a',reflectionRequest:async()=>{calls++;throw Error('synthetic offline');}});
 const sending=f.h.sendPersonalReflection({type:'sendMessage',text:'내 개인 이야기',history:[],userMessageId:'private-send'});await waiting;
 await f.h.handleTaskMessage({type:'taskCreate',taskId:scope.task});assert.equal(f.store.getView().activeTaskId,scope.task);
 finish();await sending;assert.equal(calls,2);assert.equal(f.h.reflectionBinding().pending.id,'private-send');assert.equal(f.store.getView().tasks.length,1);
}));
test('a restart before reflection dispatch restores the durable outbox into an empty draft',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope(true),b={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0,pending:{id:'before-crash',text:'아직 전송하지 못한 이야기',revision:0}};await f.h.saveReflectionBinding(b);
 f.h.setReflectionAccount({conversationSession:async()=> 'account-a'});
 await f.h.applyReflectionSnapshot(b,{...privateSnapshot,state:{...privateSnapshot.state,revision:0,messages:[]}});
 assert.equal(f.store.getDraft(scope.task).text,b.pending.text);assert.equal(f.h.reflectionBinding().pending.id,'before-crash');
}));

test('local storage failure after a server answer ends the stream once and preserves recovery',async()=>host(async f=>{
 const scope=f.h.mobileConversationScope(true),b={session:'account-a',activity:scope.activity,workspace:scope.workspace,task:scope.task,revision:0};await f.h.saveReflectionBinding(b);
 const response={...privateSnapshot,acknowledged_id:'accepted',state:{...privateSnapshot.state,messages:[{id:'accepted',role:'user',content:'Keep these words',created_at:1},{id:'accepted-answer',role:'assistant',content:'Question?',created_at:2}],turn:{id:'accepted',text:'Keep these words',status:'completed',updated_at:2}}};
 const warnings=[];f.vscode.window.showWarningMessage=async message=>{warnings.push(message);};
 f.h.setReflectionAccount({conversationSession:async()=>b.session,reflectionRequest:async()=>response});
 const append=f.store.append.bind(f.store);f.store.append=async()=>{throw Error('synthetic disk full');};
 await f.h.sendPersonalReflection({type:'sendMessage',text:'Keep these words',history:[],userMessageId:'accepted'});
 const terminals=f.posts.filter(p=>['streamEnd','streamError','streamStopped'].includes(p.type));
 assert.deepEqual(terminals.map(p=>p.type),['streamEnd']);assert.equal(warnings.length,1);
 assert.equal(f.h.reflectionBinding().pending.id,'accepted');assert.ok(f.posts.some(p=>p.type==='inputRejected'&&p.text==='Keep these words'));
 f.store.append=append;await f.h.refreshPersonalReflection();
 assert.deepEqual(Array.from(f.store.getHistory(),m=>m.id),['accepted','accepted-answer']);assert.equal(f.h.reflectionBinding().pending,undefined);
}));
