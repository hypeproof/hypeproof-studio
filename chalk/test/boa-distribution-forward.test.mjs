import assert from 'node:assert/strict';
import { test } from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const { default: chalk } = await import('../src/index.ts');

const batch = { cohort: 'boah-dental-2026-1017', profile: 'boah-dental-2026-1017-s1', users: ['first', 'second'], hours: 12 };
const result = { results: [{ handle: 'first', token: 'student-only' }], board: { code: 'NAMED2', total: 1 } };
const send = (headers = {}, env = {}) => chalk.fetch(new Request('https://chalk.test/workshop/boa-tokens', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(batch),
}), { ENVIRONMENT: 'production', ...env }, {});

test('publishes through fixed Lab origin, forwards only bounded headers and preserves the batch result', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://hypeproof-ai.xyz/api/workshop/boa-tokens');
    assert.equal(init.headers.get('authorization'), 'Bearer private-issuer');
    assert.equal(init.headers.get('cookie'), null);
    assert.equal(init.headers.get('cf-access-authenticated-user-email'), null);
    assert.equal(init.headers.get('x-hps-operator-secret'), null);
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), batch);
    return Response.json(result);
  };
  try {
    const r = await send({ authorization: 'Bearer private-issuer', cookie: 'private',
      'cf-access-authenticated-user-email': 'forged@example.test', 'x-hps-operator-secret': 'forged' },
    { HPS_LAB_ORIGIN: 'https://untrusted.test' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), result);
  } finally { globalThis.fetch = previous; }
});

test('missing/Basic credentials never reach Lab; Lab scope rejection is preserved', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'not scoped' }, { status: 403 }); };
  try {
    assert.equal((await send()).status, 401);
    assert.equal((await send({ authorization: 'Basic admin' })).status, 401);
    assert.equal(calls, 0);
    const denied = await send({ authorization: 'Bearer wrong-scope' });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'not scoped' });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('redirect or timeout never reports successful distribution or incorrectly promises no write occurred', async () => {
  const previous = globalThis.fetch;
  const errorLog = console.error;
  console.error = () => {};
  try {
    for (const upstream of [() => new Response(null, { status: 302, headers: { location: 'https://untrusted.test' } }),
      () => { throw new DOMException('deadline', 'TimeoutError'); }]) {
      globalThis.fetch = async () => upstream();
      const r = await send({ authorization: 'Bearer private-issuer' });
      assert.equal(r.status, 502);
      const body = await r.json();
      assert.match(body.error.message, /보드를 먼저 확인/);
      assert.equal('board' in body, false);
      assert.equal(JSON.stringify(body).includes('private-issuer'), false);
    }
  } finally { globalThis.fetch = previous; console.error = errorLog; }
});
