// #19 — the real Service coach route, as shipped in the pinned testkit (@hypeproof/service-testkit 0.1.15). The testkit
// carries the Service's own subscription coach test (real routing, SQLite, the real token verifier, the real chat gate):
// the subscription download returns `system`, byte-equal to the server path's first block, and the server path keeps its
// text. This studio test runs that file and requires it to pass, so the studio pin is checked against the real route.
// Run: node --experimental-strip-types --test test/rehearsal-coach-route.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serviceTest = fileURLToPath(new URL('../../../node_modules/@hypeproof/service-testkit/dist/worker/test/rehearsal-coach-subscription.test.mjs', import.meta.url));

test('the testkit 0.1.15 coach route passes its subscription test (system field, server path text, controls C1–C9)', () => {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--experimental-sqlite', '--no-warnings', serviceTest], { encoding: 'utf8' });
  const out = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.status, 0, out.slice(-2000));
  assert.match(out, /#19 coach download for a subscription rehearsal: 11 checks passed/);
  assert.match(out, /PASS C1 subscription code, learner outside the roster/);
});
