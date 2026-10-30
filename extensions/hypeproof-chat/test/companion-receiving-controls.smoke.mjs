import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';

test('real provider rejects foreign/stale/production controls but admits current Stop while normal turn is busy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'receiving-controls-'));
 try{const f=await createTaskHarness(root,()=>{},{configureVscode:v=>v.ExtensionMode={Development:2,Production:1}});f.h.context.extensionMode=2;
 const calls=[];const binding=nonce=>({view:{nonce,state:'listening',canStop:true,canRevoke:true},act:action=>calls.push([nonce,action])});
 f.h.setCompanionReceivingControls(binding('old'));f.h.setCompanionReceivingControls(binding('new'));
 await f.handle({type:'companionReceivingAction',nonce:'old',action:'stop'});
 await f.h.handleMessage({type:'companionReceivingAction',nonce:'new',action:'stop'},{postMessage:async()=>true});
 await f.handle({type:'companionReceivingAction',nonce:'new',action:'send'});assert.equal(calls.length,0);
 f.h.pendingSends=1;f.h.connectionChanging=true;
 await f.handle({type:'companionReceivingAction',nonce:'new',action:'stop',activityId:'stale-panel-scope'});assert.deepEqual(calls,[['new','stop']],'lifecycle owner nonce fences independent Stop, not current turn admission');
 f.h.setCompanionReceivingControls({...binding('new'),view:{nonce:'new',state:'stopped',canStop:false,canRevoke:true}});
 await f.handle({type:'companionReceivingAction',nonce:'new',action:'stop'});assert.equal(calls.length,1);
 f.h.setCompanionReceivingControls(null);await f.handle({type:'companionReceivingAction',nonce:'new',action:'revoke'});assert.equal(calls.length,1);
 f.h.context.extensionMode=1;f.h.setCompanionReceivingControls(binding('prod'));await f.handle({type:'companionReceivingAction',nonce:'prod',action:'revoke'});assert.equal(calls.length,1);assert.equal(f.posts.at(-1).controls,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
