import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
const dir=mkdtempSync(join(tmpdir(),'delegation-stop-host-'));
try{
 const f=await createTaskHarness(dir),h=f.h;
 h.profileGeneration=3;h.delegationControls=new Map();
 const ctrl=new AbortController();h.activeStreams.set('one',ctrl);
 let calls=0;const scope=()=>JSON.stringify([h.turnRequestScope(),h.profileGeneration]);
 h.delegationControls.set('one',{scope:scope(),stop:()=>calls++});
 const send=msg=>h.handleMessage(f.scoped(msg),f.source);
 await send({type:'stopDelegations',streamId:'foreign'});assert.equal(calls,0);
 await h.handleMessage({...f.scoped({type:'stopDelegations',streamId:'one'}),taskId:'foreign'},f.source);assert.equal(calls,0);
 await send({type:'stopDelegations',streamId:'one'});assert.equal(calls,1);assert.equal(ctrl.signal.aborted,false,'supported control leaves main turn available');
 h.profileGeneration++;await send({type:'stopDelegations',streamId:'one'});assert.equal(calls,1,'old profile cannot control');
 const timeout=new AbortController();h.activeStreams.set('timeout',timeout);
 h.reportDelegationStop('timeout','foreign',timeout,'unconfirmed');assert.equal(timeout.signal.aborted,false,'stale callback cannot abort');
 h.reportDelegationStop('timeout',scope(),timeout,'pending');assert.equal(timeout.signal.aborted,false);
 h.reportDelegationStop('timeout',scope(),timeout,'unconfirmed');assert.equal(timeout.signal.aborted,true,'missing SDK ack stops whole turn');
 h.delegationControls.delete('one');await send({type:'stopDelegations',streamId:'one'});
 assert.equal(ctrl.signal.aborted,true,'missing control keeps original whole-turn cancel');
 assert.ok(f.posts.some(p=>p.type==='delegationStopState'&&p.state==='unconfirmed'));
 assert.ok(f.posts.some(p=>p.type==='streamStopped'&&p.streamId==='one'));
 assert.ok(!f.posts.some(p=>p.type==='delegationStopState'&&p.state==='confirmed'));
 console.log('PASS actual host message handler: active stream/task/profile binding, SDK control routing, unsupported whole-turn fallback without false confirmation');
}finally{rmSync(dir,{recursive:true,force:true});}
