import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanionTransportBudget } from '../src/companionTransportBudget.ts';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function clock() {
  let now = 0;
  const waits = new Set();
  return {
    now: () => now,
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      const finish = () => { waits.delete(item); signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { waits.delete(item); signal.removeEventListener('abort', abort); reject(Error('aborted')); };
      const item = { deadline: now + ms, finish };
      waits.add(item); signal.addEventListener('abort', abort, { once: true });
    }),
    advance: async ms => { now += ms; for (const item of [...waits]) if (item.deadline <= now) item.finish(); await flush(); },
    get waiting() { return waits.size; },
  };
}

test('burst admission reserves rolling slots, resumes FIFO, and does not serialize network completion', async () => {
  const time = clock(), budget = new CompanionTransportBudget({ ...time, maxRequests: 2 });
  const calls = []; let finishFirst;
  const first = budget.run(() => { calls.push('first'); return new Promise(resolve => { finishFirst = resolve; }); });
  const second = budget.run(async () => { calls.push('second'); return 2; });
  const third = budget.run(async () => { calls.push('third'); return 3; });
  const fourth = budget.run(async () => { calls.push('fourth'); return 4; });
  await flush(); assert.deepEqual(calls, ['first', 'second']); assert.equal(await second, 2);
  await time.advance(59_999); assert.deepEqual(calls, ['first', 'second']);
  await time.advance(1); assert.deepEqual(calls, ['first', 'second', 'third', 'fourth']);
  assert.deepEqual(await Promise.all([third, fourth]), [3, 4]);
  finishFirst(1); assert.equal(await first, 1); assert.equal(time.waiting, 0); budget.dispose();
});

test('waiting cancellation never invokes the operation and does not strand later FIFO work', async () => {
  const time = clock(), budget = new CompanionTransportBudget({ ...time, maxRequests: 1 });
  await budget.run(async () => 'used');
  const abort = new AbortController(); let calls = 0;
  const cancelled = budget.run(async () => { calls++; }, abort.signal);
  const rejection = assert.rejects(cancelled, /cancelled/);
  const later = budget.run(async () => { calls++; return 'later'; });
  abort.abort(); await rejection; await flush(); assert.equal(calls, 0);
  await time.advance(60_000); assert.equal(await later, 'later'); assert.equal(calls, 1);
  const already = new AbortController(); already.abort();
  await assert.rejects(budget.run(async () => { calls++; }, already.signal), /cancelled/);
  assert.equal(calls, 1); budget.dispose();
});

test('queue overload, wait ceiling and dispose reject cleanly without hidden invocation or unhandled rejections', async () => {
  const time = clock(), budget = new CompanionTransportBudget({ ...time, maxRequests: 1 });
  await budget.run(async () => 'used');
  let calls = 0;
  const waiting = Array.from({ length: 32 }, () => budget.run(async () => { calls++; }));
  const settled = Promise.allSettled(waiting);
  await assert.rejects(budget.run(async () => { calls++; }), /overloaded/);
  await time.advance(60_000); assert.equal(calls, 1);
  await time.advance(5_000);
  const results = await settled;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => /wait_expired/.test(r.reason.message)));
  const pending = budget.run(async () => { calls++; });
  const rejection = assert.rejects(pending, /disposed/);
  budget.dispose(); await rejection;
  await assert.rejects(budget.run(async () => { calls++; }), /disposed/);
  await time.advance(120_000); assert.equal(calls, 1); assert.equal(time.waiting, 0);
});

test('failed operations consume one reservation and are never retried; failed sleep rejects queued work', async () => {
  const time = clock(), budget = new CompanionTransportBudget({ ...time, maxRequests: 1 });
  let calls = 0;
  await assert.rejects(budget.run(async () => { calls++; throw Error('http_429'); }), /http_429/);
  const next = budget.run(async () => { calls++; return 'ok'; });
  await flush(); assert.equal(calls, 1);
  await time.advance(60_000); assert.equal(await next, 'ok'); assert.equal(calls, 2); budget.dispose();
  const failedClock = new CompanionTransportBudget({ now: () => 0, maxRequests: 1, sleep: async () => { throw Error('clock'); } });
  await failedClock.run(async () => 'used');
  await assert.rejects(failedClock.run(async () => { calls++; }), /clock_failed/);
  assert.equal(calls, 2); failedClock.dispose();
  assert.throws(() => new CompanionTransportBudget({ maxRequests: 51 }), /invalid_limit/);
});

test('default budget admits fifty immediate calls and holds the next until the rolling window clears', async () => {
  const time = clock(), budget = new CompanionTransportBudget(time);
  let calls = 0;
  await Promise.all(Array.from({ length: 50 }, () => budget.run(async () => ++calls)));
  assert.equal(calls, 50);
  const next = budget.run(async () => ++calls);
  await time.advance(59_999); assert.equal(calls, 50);
  await time.advance(1); assert.equal(await next, 51); budget.dispose();
});


test('optional spacing paces admissions without waiting for network completion and honours cancellation', async () => {
  const time = clock(), budget = new CompanionTransportBudget({ ...time, minSpacingMs: 1200 });
  const calls = []; let finishFirst;
  const first = budget.run(() => { calls.push(time.now()); return new Promise(resolve => { finishFirst = resolve; }); });
  const second = budget.run(async () => { calls.push(time.now()); return 'second'; });
  const controller = new AbortController();
  const cancelled = budget.run(async () => { calls.push('cancelled'); }, controller.signal);
  const rejected = assert.rejects(cancelled, /cancelled/);
  const fourth = budget.run(async () => { calls.push(time.now()); return 'fourth'; });
  await flush(); assert.deepEqual(calls, [0]);
  await time.advance(1199); assert.deepEqual(calls, [0]);
  await time.advance(1); assert.equal(await second, 'second'); assert.deepEqual(calls, [0, 1200]);
  controller.abort(); await rejected; await flush();
  await time.advance(1199); assert.deepEqual(calls, [0, 1200]);
  await time.advance(1); assert.equal(await fourth, 'fourth'); assert.deepEqual(calls, [0, 1200, 2400]);
  finishFirst('first'); assert.equal(await first, 'first'); assert.equal(time.waiting, 0); budget.dispose();
  const lateTime = clock(), lateBudget = new CompanionTransportBudget({ ...lateTime, minSpacingMs: 5000 });
  let lateCalls = 0;
  await lateBudget.run(async () => ++lateCalls);
  const late = assert.rejects(lateBudget.run(async () => ++lateCalls), /wait_expired/);
  await lateTime.advance(65_000); await late;
  assert.equal(lateCalls, 1); lateBudget.dispose();
  for (const minSpacingMs of [-1, 5001, 0.5, NaN, Infinity, null]) assert.throws(() => new CompanionTransportBudget({ minSpacingMs }), /invalid_spacing/);
});
