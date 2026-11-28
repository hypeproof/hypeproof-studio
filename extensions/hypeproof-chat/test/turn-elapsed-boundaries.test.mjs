import assert from 'node:assert/strict';
import {test} from 'node:test';
import {elapsedWorkLabel,retainElapsedReceipts} from '../src/turnElapsed.ts';

const receipt=(anchorId,ms=1000)=>({anchorId,ms,outcome:'done'});

test('test_tc_0223_minute_format_switches_at_60000ms',()=>{
  assert.equal(elapsedWorkLabel(59999,'done'),'59초 동안 작업했어요');
  assert.equal(elapsedWorkLabel(60000,'done'),'1분 동안 작업했어요');
  assert.equal(elapsedWorkLabel(61000,'done'),'1분 1초 동안 작업했어요');
});

test('test_tc_0224_stopped_wording_floors_seconds',()=>{
  assert.equal(elapsedWorkLabel(125999,'stopped'),'2분 5초 뒤 멈췄어요');
  assert.equal(elapsedWorkLabel(0,'stopped'),'0초 뒤 멈췄어요');
});

test('test_tc_0225_invalid_durations_return_null',()=>{
  assert.equal(elapsedWorkLabel(-1,'done'),null);
  assert.equal(elapsedWorkLabel(NaN,'done'),null);
  assert.equal(elapsedWorkLabel(Infinity,'stopped'),null);
});

test('test_tc_0226_receipt_reattached_only_for_matching_anchor',()=>{
  const incoming=[{id:'m1',role:'assistant',content:'a'}];
  const other=retainElapsedReceipts(incoming,[{id:'m1',role:'assistant',content:'a',elapsedTurn:receipt('m2')}]);
  assert.equal(other[0].elapsedTurn,undefined);
  const r=receipt('m1');
  const same=retainElapsedReceipts(incoming,[{id:'m1',role:'assistant',content:'a',elapsedTurn:r}]);
  assert.deepEqual(same[0].elapsedTurn,r);
});

test('test_tc_0227_existing_receipt_unknown_ids_order_and_length_kept',()=>{
  const own=receipt('m1',5);
  const incoming=[
    {id:'m0',role:'user',content:'q'},
    {id:'m1',role:'assistant',content:'a',elapsedTurn:own},
    {id:'m9',role:'assistant',content:'new'},
  ];
  const previous=[{id:'m1',role:'assistant',content:'a',elapsedTurn:receipt('m1',9999)}];
  const out=retainElapsedReceipts(incoming,previous);
  assert.deepEqual(out.map(m=>m.id),['m0','m1','m9']);
  assert.equal(out[1].elapsedTurn,own);
  assert.equal(out[2],incoming[2]);
  assert.equal(out[0].elapsedTurn,undefined);
});
