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
