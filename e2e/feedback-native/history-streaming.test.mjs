import test from 'node:test';import assert from 'node:assert/strict';
import {historyMarkers,assertCompletedHistory,captureInterruptedHistory,assertInterruptedHistory,awaitUpstreamClosure} from './history-streaming.mjs';
test('rendered history requires exact user+assistant occurrence and rejects duplicates, foreign turns or partial-only claims',()=>{const rows=[{role:'user',text:'HPS_NATIVE_A1'},{role:'assistant',text:'HPS_NATIVE_REPLY_A1'}];assertCompletedHistory(rows,['A1']);assert.throws(()=>assertCompletedHistory([...rows,...rows],['A1']));assert.throws(()=>assertCompletedHistory(rows.slice(0,1),['A1']));assert.throws(()=>assertCompletedHistory(rows,['A1','D2']));assert.equal(historyMarkers(rows).A1.assistant,1);assert.throws(()=>assertCompletedHistory([...rows,{role:'user',text:'HPS_NATIVE_STOP_HOLD'}],['A1']));});

test('observed stopped user and partial assistant persist exactly once without a fabricated completed turn',()=>{
 const complete=[{id:'a-user',role:'user',text:'HPS_NATIVE_A1'},{id:'a-answer',role:'assistant',text:'HPS_NATIVE_REPLY_A1'}];
 const partial=[{id:'stop-user',role:'user',text:'HPS_NATIVE_STOP_HOLD'},{id:'stop-answer',role:'assistant',text:'HPS_NATIVE_REPLY_STOP_HOLD'}],rows=[...complete,...partial];
 const interrupted={STOP_HOLD:captureInterruptedHistory(rows,'STOP_HOLD')};
 // The old completed-only assertion falsely failed the intended #1834 persisted transcript.
 assert.throws(()=>assertCompletedHistory(rows,['A1']),/Exact persisted user occurrence STOP_HOLD/);
 assert.equal(assertInterruptedHistory(rows,['A1'],interrupted).STOP_HOLD.assistant,1);
 const stopped=rows.map(row=>row.id==='stop-answer'?{...row,receipt:'2초 뒤 멈췄어요'}:row);
 assertInterruptedHistory(stopped,['A1'],interrupted,'STOP_HOLD');
 assert.throws(()=>assertInterruptedHistory(rows,['A1'],interrupted,'STOP_HOLD'),/stopped receipt/);
 assert.throws(()=>assertInterruptedHistory(rows,['A1','STOP_HOLD'],interrupted),/completed fixture/);
 assert.throws(()=>assertInterruptedHistory(rows.map(row=>row.id==='stop-answer'?{...row,receipt:'2초 동안 작업했어요'}:row),['A1'],interrupted),/cannot claim completion/);
 for(const changed of [[...rows,partial[0]],[...rows,partial[1]],rows.filter(row=>row.id!=='stop-answer'),rows.map(row=>row.id==='stop-answer'?{...row,id:'replacement-answer'}:row),rows.map(row=>row.id==='stop-answer'?{...row,text:row.text+' fabricated completion'}:row)])assert.throws(()=>assertInterruptedHistory(changed,['A1'],interrupted));
 assert.throws(()=>captureInterruptedHistory(partial.map(row=>({...row,id:''})),'STOP_HOLD'),/identity/);
});

test('quit and direct-open preserve their observed partial identities only in the owning workspace',()=>{
 const rows=['STOP_HOLD','QUIT_HOLD','FILE_HOLD'].flatMap(name=>[{id:name+'-user',role:'user',text:'HPS_NATIVE_'+name},{id:name+'-answer',role:'assistant',text:'HPS_NATIVE_REPLY_'+name}]);
 const interrupted=Object.fromEntries(['STOP_HOLD','QUIT_HOLD','FILE_HOLD'].map(name=>[name,captureInterruptedHistory(rows,name)]));
 assertInterruptedHistory(rows,[],interrupted);
 assert.throws(()=>assertInterruptedHistory(rows,[],{STOP_HOLD:interrupted.STOP_HOLD}),/Exact persisted user occurrence QUIT_HOLD/);
 assert.throws(()=>assertInterruptedHistory(rows,[],{}),/Exact persisted user occurrence STOP_HOLD/);
 assert.throws(()=>assertInterruptedHistory(rows.slice(0,4),[],interrupted),/Exact persisted user occurrence FILE_HOLD/);
});

test('cancellation waits for the exact upstream sequence and rejects cleanup or absent propagation',async()=>{
 let reads=0;const closed={service_seq:8,client_closed:true,state:'upstream_socket_closed'};
 const actual=await awaitUpstreamClosure(async()=>({rows:++reads===1?[{...closed,service_seq:7}]:[closed]}),8,1000);assert.equal(actual.service_seq,8);assert(reads>1);
 await assert.rejects(awaitUpstreamClosure(async()=>({rows:[{...closed,service_seq:7}]}),8,50),/exact upstream/);
 await assert.rejects(awaitUpstreamClosure(async()=>({rows:[{...closed,fixture_finish:'explicit_fixture_release'}]}),8,50),/exact upstream/);
 await assert.rejects(awaitUpstreamClosure(async()=>({rows:[{service_seq:8,client_closed:false,state:'streaming'}]}),8,50),/exact upstream/);
});
