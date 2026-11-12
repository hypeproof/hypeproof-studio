// CGP-SHELL-R-003 — Chalk forwards the cohort update freeze write (PUT/DELETE /admin/cohorts/:id/update-freeze) to the
// Service with the Lab-connected issuer, like every instructor write. The pinned service-contracts (0.1.2) does not admit
// the path yet, so the forwarder names it; nothing else under it is admitted. The Service re-checks issuer + scope.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { withBearerAsConnection } from './harness/connect.mjs';

const chalk = withBearerAsConnection((await import('../src/index.ts')).default);
const env = { ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };
const path = '/admin/cohorts/cohort-one/update-freeze';

test('PUT and DELETE reach the Service with the connected issuer; nothing else under the path does', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ update_freeze: null }, { status: 200 }); };
  try {
    const body = JSON.stringify({ from: '2026-11-12', until: '2026-11-30' });
    for (const method of ['PUT', 'DELETE']) {
      const r = await chalk.fetch(new Request('https://chalk.test' + path, { method, ...(method === 'PUT' ? { body } : {}), headers: { authorization: 'Bearer fixture-issuer', 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'forged@example.test' } }), env, {});
      assert.equal(r.status, 200, method);
      const call = calls.at(-1);
      assert.equal(call.url, 'https://service.test' + path, method);
      assert.equal(call.init.method, method);
      assert.equal(call.init.headers.get('authorization'), 'Bearer fixture-issuer', 'the issuer from the connection');
      assert.equal(call.init.headers.get('cf-access-authenticated-user-email'), null, 'no forged operator header');
      if (method === 'PUT') assert.equal(new TextDecoder().decode(call.init.body), body);
    }
    const count = calls.length;
    for (const [method, p] of [['GET', path], ['POST', path], ['PUT', path + '/x'], ['PUT', '/admin/cohorts/cohort-one/update-freezes']]) {
      const r = await chalk.fetch(new Request('https://chalk.test' + p, { method, ...(method === 'GET' ? {} : { body: '{}' }), headers: { authorization: 'Bearer fixture-issuer' } }), env, {});
      assert.equal(r.status, 404, method + ' ' + p);
    }
    assert.equal(calls.length, count, 'refused requests never reach the Service');
    // Without a connection the write is refused before the Service.
    const bare = (await import('../src/index.ts')).default;
    const anon = await bare.fetch(new Request('https://chalk.test' + path, { method: 'DELETE' }), env, {});
    assert.ok(anon.status === 401 || anon.status === 503, 'no connection: ' + anon.status);
    assert.equal(calls.length, count);
    // The Service's verdict is preserved (e.g. a read-only scope → 403 with its reason).
    globalThis.fetch = async () => Response.json({ error: 'issuer not scoped for session control on cohort=cohort-one. scope needs can_start_session=true.' }, { status: 403 });
    const denied = await chalk.fetch(new Request('https://chalk.test' + path, { method: 'DELETE', headers: { authorization: 'Bearer fixture-issuer' } }), env, {});
    assert.equal(denied.status, 403);
  } finally { globalThis.fetch = previous; }
});
