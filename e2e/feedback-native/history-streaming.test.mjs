import test from 'node:test';import assert from 'node:assert/strict';
import {historyMarkers,assertCompletedHistory,awaitUpstreamClosure} from './history-streaming.mjs';
test('rendered history requires exact user+assistant occurrence and rejects duplicates, foreign turns or partial-only claims',()=>{const rows=[{role:'user',text:'HPS_NATIVE_A1'},{role:'assistant',text:'HPS_NATIVE_REPLY_A1'}];assertCompletedHistory(rows,['A1']);assert.throws(()=>assertCompletedHistory([...rows,...rows],['A1']));assert.throws(()=>assertCompletedHistory(rows.slice(0,1),['A1']));assert.throws(()=>assertCompletedHistory(rows,['A1','D2']));assert.equal(historyMarkers(rows).A1.assistant,1);assert.throws(()=>assertCompletedHistory([...rows,{role:'user',text:'HPS_NATIVE_STOP_HOLD'}],['A1']));});

test('an interrupted turn user line is persisted exactly once (#1834), and a second replay or a missing line fails',()=>{
 // JY decision 2026-11-18: the interrupted user line is kept by design. Positive, negative and duplicate controls.
 const base=[{role:'user',text:'HPS_NATIVE_A1'},{role:'assistant',text:'HPS_NATIVE_REPLY_A1'}];
 const stopOnce={role:'user',text:'HPS_NATIVE_STOP_HOLD'};
 assertCompletedHistory([...base,stopOnce],['A1'],['STOP_HOLD']);
 assert.throws(()=>assertCompletedHistory([...base,stopOnce,stopOnce],['A1'],['STOP_HOLD']),/exactly once/);
 assert.throws(()=>assertCompletedHistory(base,['A1'],['STOP_HOLD']),/exactly once/);
 assert.throws(()=>assertCompletedHistory([...base,stopOnce],['A1']),/not be replayed/);
 assert.throws(()=>assertCompletedHistory([...base,stopOnce,{role:'assistant',text:'HPS_NATIVE_REPLY_STOP_HOLD'}],['A1'],['STOP_HOLD']),/not be committed/);
});

test('cancellation waits for the exact upstream sequence and rejects cleanup or absent propagation',async()=>{
 let reads=0;const closed={service_seq:8,client_closed:true,state:'upstream_socket_closed'};
 const actual=await awaitUpstreamClosure(async()=>({rows:++reads===1?[{...closed,service_seq:7}]:[closed]}),8,1000);assert.equal(actual.service_seq,8);assert(reads>1);
 await assert.rejects(awaitUpstreamClosure(async()=>({rows:[{...closed,service_seq:7}]}),8,50),/exact upstream/);
 await assert.rejects(awaitUpstreamClosure(async()=>({rows:[{...closed,fixture_finish:'explicit_fixture_release'}]}),8,50),/exact upstream/);
 await assert.rejects(awaitUpstreamClosure(async()=>({rows:[{service_seq:8,client_closed:false,state:'streaming'}]}),8,50),/exact upstream/);
});
