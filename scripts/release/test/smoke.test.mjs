// Controls for smoke check details: colour codes are removed before a result reaches the release PR or issue.
//   node --test scripts/release/test/smoke.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {runSmokeChecks, stripAnsi} from '../smoke/smoke.mjs';

test('stripAnsi: removes SGR colour codes and keeps the text', () => {
  assert.equal(stripAnsi('\x1b[32mPASS\x1b[0m ok'), 'PASS ok');
  assert.equal(stripAnsi('\x1b[1;31mfail\x1b[22;39m'), 'fail');
  // negative control: plain text, and a bracket that is not an escape, pass through unchanged
  assert.equal(stripAnsi('[32mPASS'), '[32mPASS');
  assert.equal(stripAnsi('HTTP 200 ok'), 'HTTP 200 ok');
});

test('runSmokeChecks: every check detail is stored without colour codes, PASS and FAIL alike', async () => {
  const stub = (id, result, detail) => ({id, name: `stub ${id}`, run: async () => ({result, detail})});
  const checks = await runSmokeChecks([
    stub('S8', 'PASS', '\x1b[32m3 check-runs passed\x1b[0m'),
    stub('S9', 'FAIL', '\x1b[31mexit 1: \x1b[0mbroken'),
  ], {});
  assert.equal(checks.find(c => c.id === 'S8').detail, '3 check-runs passed');
  assert.equal(checks.find(c => c.id === 'S9').detail, 'exit 1: broken');
  // negative control: a throwing check keeps its message (no escape codes in it)
  const thrown = await runSmokeChecks([{id: 'S7', name: 'throws', run: async () => { throw new Error('boom'); }}], {});
  assert.equal(thrown[0].result, 'FAIL');
  assert.equal(thrown[0].detail, 'boom');
});
