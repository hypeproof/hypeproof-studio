// A report advance waits on one evaluator call that the Service allows 90 s. Chalk must outlast that call, or a draft the
// Service is still writing reaches the instructor as a 502. Only this route gets the longer budget.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { withBearerAsConnection } from './harness/connect.mjs';

const chalk = withBearerAsConnection((await import('../src/index.ts')).default);
const env = { ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };
const batch = '/admin/cohorts/c1/classroom/runs/r1/report-batches/b1';

async function budgetOf(method, path) {
  const realFetch = globalThis.fetch, realTimeout = AbortSignal.timeout;
  let budget = null;
  AbortSignal.timeout = (ms) => { budget = ms; return realTimeout.call(AbortSignal, ms); };
  globalThis.fetch = async () => Response.json({ ok: true });
  try {
    const r = await chalk.fetch(new Request('https://chalk.test' + path, { method, ...(method === 'POST' ? { body: '{}' } : {}), headers: { authorization: 'Bearer fixture-issuer', 'content-type': 'application/json' } }), env);
    assert.equal(r.status, 200, `${method} ${path}`);
    return budget;
  } finally {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  }
}

test('the advance forward outlasts the Service evaluator limit', async () => {
  assert.ok((await budgetOf('POST', batch + '/advance')) > 90_000);
});

test('neighbouring report routes keep the short forward budget', async () => {
  assert.equal(await budgetOf('POST', batch + '/reconcile'), 8_000);
  assert.equal(await budgetOf('GET', batch + '/jobs'), 8_000);
});
