// Real provider and disk task store: return to the originating task without losing drafts.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTaskHarness} from './task-workspace-harness.mjs';
const root=await mkdtemp(join(tmpdir(),'notice-routing-'));
try{
 let f;f=await createTaskHarness(root,message=>{
  if(message.type==='activityFreeze'&&message.nonce)void f.handle(f.scoped({type:'saveActivityDraft',nonce:message.nonce,draft:{text:'돌아와도 남을 초안',images:[],queued:null}}));
 });
 const original=f.h.turnRequestScope(),first=f.store.getView().activeTaskId;
 await f.handle(f.scoped({type:'taskCreate'}));const second=f.store.getView().activeTaskId;
 await f.h.revealNoticeTask(original);assert.equal(f.store.getView().activeTaskId,first);assert.equal(f.store.getTask(second).draft.text,'돌아와도 남을 초안');assert.equal(f.browserState.commands.at(-1),'editorChat.reveal');
 const before=f.browserState.commands.length;
 await f.h.revealNoticeTask(JSON.stringify(['foreign',first]));assert.equal(f.browserState.commands.length,before);
 const [activity]=JSON.parse(original);await f.h.revealNoticeTask(JSON.stringify([activity,'missing-task']));assert.equal(f.browserState.commands.length,before);
 await f.handle(f.scoped({type:'taskSelect',id:second}));f.h.pendingSends=1;
 await f.h.revealNoticeTask(original);assert.equal(f.store.getView().activeTaskId,second);assert.equal(f.browserState.commands.length,before,'refused switch cannot reveal unrelated task');
 console.log('PASS actual notice routing: original task, preserved draft, foreign/missing/busy rejection');
}finally{await rm(root,{recursive:true,force:true});}
