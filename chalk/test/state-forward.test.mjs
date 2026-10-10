import assert from 'node:assert/strict';
import { test } from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { state } from '../src/routes/state.ts';

const request = () => new Request('https://chalk.test/cohorts/cohort-one/state', { headers: {
  authorization: 'Bearer fixture-token',
  'cf-access-authenticated-user-email': 'forged@example.test',
  'x-hps-operator-secret': 'forged',
  cookie: 'secret-cookie',
} });
const env = { HPS_SERVICE_ORIGIN: 'https://service.test', HPS_KV: new Proxy({}, { get() { throw new Error('Chalk storage must not be used'); } }) };

test('one bounded HTTP read forwards only Bearer and preserves Service auth failures', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://service.test/admin/chalk/cohorts/cohort-one/state');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual([...init.headers.keys()].sort(), ['authorization', 'x-request-id']);
    assert.equal(init.headers.get('authorization'), 'Bearer fixture-token');
    return Response.json({ error: 'issuer not scoped' }, { status: 403, headers: { 'x-request-id': 'service-rid' } });
  };
  try {
    const res = await state.fetch(request(), env);
    assert.equal(calls, 1);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'issuer not scoped' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-hps-service-request-id'), 'service-rid');
  } finally { globalThis.fetch = previous; }
});

test('transport failure stays unavailable and does not invent empty state', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('deadline', 'TimeoutError'); };
  try {
    const res = await state.fetch(request(), env);
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.error.type, 'upstream');
    assert.ok(!('roster_size' in body));
  } finally { globalThis.fetch = previous; }
});
