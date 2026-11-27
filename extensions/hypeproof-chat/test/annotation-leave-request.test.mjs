// Run: node --experimental-strip-types --test test/annotation-leave-request.test.mjs
// The discard confirmation closes as "keep the marks" unless the id, count, scope and answer all line up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotationLeaveRequest } from '../src/annotationLeavePrompt.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ present, timeoutMs } = {}) {
  const state = { scope: 'a', next: 0, calls: [] };
  const request = new AnnotationLeaveRequest({
    scope: () => state.scope,
    id: () => `req-${++state.next}`,
    present: async prompt => { state.calls.push(prompt); return present ? present(prompt) : true; },
  }, timeoutMs);
  return { state, request };
}

const settled = promise => { const box = { done: false }; promise.then(v => { box.done = true; box.value = v; }); return box; };

test('test_tc_0166_invalid_counts_do_not_present_and_boundaries_do', async () => {
  const { state, request } = harness();
  for (const count of [0, 11, 1.5, -1, NaN]) assert.equal(await request.confirm(count), false);
  assert.deepEqual(state.calls, []);
  const first = settled(request.confirm(1));
  await tick();
  assert.deepEqual(state.calls, [{ id: 'req-1', count: 1 }]);
  request.respond('req-1', true);
  await tick();
  assert.equal(first.value, true);
  const tenth = settled(request.confirm(10));
  await tick();
  assert.deepEqual(state.calls.at(-1), { id: 'req-2', count: 10 });
  request.respond('req-2', false);
  await tick();
  assert.equal(tenth.value, false);
});

test('test_tc_0167_second_confirm_while_pending_is_false_and_first_survives', async () => {
  const { state, request } = harness();
  const first = settled(request.confirm(3));
  await tick();
  assert.equal(await request.confirm(2), false);
  assert.equal(state.calls.length, 1);
  assert.equal(first.done, false);
  request.respond('req-1', true);
  await tick();
  assert.equal(first.value, true);
  assert.equal(state.calls.at(-1), null);
});

test('test_tc_0168_scope_change_before_respond_keeps_marks', async () => {
  const { state, request } = harness();
  const result = settled(request.confirm(2));
  await tick();
  state.scope = 'b';
  request.respond('req-1', true);
  await tick();
  assert.equal(result.value, false);
  assert.equal(state.calls.at(-1), null);
});

test('test_tc_0169_other_id_keeps_request_open_and_non_true_discard_is_false', async () => {
  for (const bad of ['true', 1]) {
    const { state, request } = harness();
    const result = settled(request.confirm(2));
    await tick();
    request.respond('other', true);
    await tick();
    assert.equal(result.done, false);
    assert.equal(state.calls.length, 1);
    request.respond('req-1', bad);
    await tick();
    assert.equal(result.value, false);
    assert.equal(state.calls.at(-1), null);
  }
});

test('test_tc_0170_present_failure_or_non_true_result_closes_false_and_clears', async () => {
  for (const present of [() => Promise.reject(new Error('boom')), () => false, () => undefined, () => 'true']) {
    const { state, request } = harness({ present: p => (p ? present() : undefined) });
    assert.equal(await request.confirm(2), false);
    assert.equal(state.calls.length, 2);
    assert.equal(state.calls[1], null);
    // closed: a new request can be made
    assert.equal(await request.confirm(0), false);
  }
});

test('test_tc_0171_timeout_closes_false_and_clears_prompt', async () => {
  const { state, request } = harness({ timeoutMs: 20 });
  assert.equal(await request.confirm(2), false);
  assert.equal(state.calls.length, 2);
  assert.equal(state.calls[1], null);
});
