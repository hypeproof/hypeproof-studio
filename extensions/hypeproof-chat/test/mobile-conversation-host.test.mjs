import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTaskHarness} from './task-workspace-harness.mjs';
async function host(run){const root=await mkdtemp(join(tmpdir(),'mobile-host-'));try{const f=await createTaskHarness(root);Object.assign(f.h,{_instructorMode:{isInstructor:false}});await run(f);}finally{await rm(root,{recursive:true,force:true})}}
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
