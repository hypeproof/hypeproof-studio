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
