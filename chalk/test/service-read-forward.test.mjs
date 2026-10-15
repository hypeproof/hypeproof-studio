// Transport controls complement the real Service integration assertions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const { default: chalk } = await import('../src/index.ts');
const origin = 'https://service.test';
const transportSecret = 'chalk-transport-' + 'z'.repeat(32);
const env = { ENVIRONMENT: 'production', HPS_SERVICE_ORIGIN: origin };

async function withFetch(run, handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try { await run(); } finally { globalThis.fetch = previous; }
}
const send = (path, headers = {}, bindings = env) =>
  chalk.fetch(new Request('https://chalk.test' + path, { headers }), bindings, {});

test('board preserves query, upstream auth rejection and request correlation', async () => {
  await withFetch(async () => {
    const r = await send('/admin/cohorts/cohort-a/board?seat_prefix=A-', {
      authorization: 'Bearer test-token', cookie: 'private',
      'cf-access-authenticated-user-email': 'forged@example.test',
      'x-hps-chalk-operator-identity': 'forged@example.test',
      'x-hps-chalk-service-secret': 'forged', 'x-hps-operator-secret': 'forged',
    });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'issuer not scoped' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-hps-service-request-id'), 'service-read');
  }, async (url, init) => {
    assert.equal(url, origin + '/admin/chalk/cohorts/cohort-a/board?seat_prefix=A-');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual([...init.headers.keys()].sort(), ['authorization', 'x-request-id']);
    return Response.json({ error: 'issuer not scoped' }, { status: 403, headers: { 'x-request-id': 'service-read' } });
  });
});

test('raw retrieval streams exact bytes and only attests Access using server credential', async () => {
  const bytes = new TextEncoder().encode('{"prompt":"학생 질문"}\n');
  await withFetch(async () => {
    const r = await send('/admin/cohorts/cohort-a/logs/A-1/2026-08-22/session-a/events.jsonl', {
      'cf-access-authenticated-user-email': 'operator@example.test',
      'x-hps-chalk-service-secret': 'client-forgery', cookie: 'private',
    }, { ...env, HPS_CHALK_SERVICE_SECRET: transportSecret });
    assert.equal(r.status, 200);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
    assert.equal(r.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
    assert.equal(r.headers.get('content-length'), String(bytes.length));
    assert.equal(r.headers.get('x-hps-log-key'), 'studio-logs/cohort-a/A-1/2026-08-22/session-a/events.jsonl');
  }, async (url, init) => {
    assert.equal(url, origin + '/admin/chalk/cohorts/cohort-a/logs/A-1/2026-08-22/session-a/events.jsonl');
    assert.equal(init.headers.get('cf-access-authenticated-user-email'), null);
    assert.equal(init.headers.get('cookie'), null);
    assert.equal(init.headers.get('x-hps-chalk-operator-identity'), 'operator@example.test');
    assert.equal(init.headers.get('x-hps-chalk-service-secret'), transportSecret);
    return new Response(bytes, { headers: {
      'content-type': 'application/x-ndjson; charset=utf-8', 'content-length': String(bytes.length),
      'x-hps-log-key': 'studio-logs/cohort-a/A-1/2026-08-22/session-a/events.jsonl',
    } });
  });
});

test('missing or weak transport config never grants Access and operator-secret stays separate', async () => {
  for (const secret of [undefined, 'weak']) {
    await withFetch(async () => {
      const r = await send('/admin/cohorts/cohort-a/logs/A-1/2026-08-22/session-a/events.jsonl', {
        authorization: 'Bearer instructor', 'cf-access-authenticated-user-email': 'operator@example.test',
        'x-hps-chalk-operator-identity': 'forgery', 'x-hps-chalk-service-secret': transportSecret,
      }, { ...env, HPS_CHALK_SERVICE_SECRET: secret });
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error.code, 'retrieval_not_configured');
    }, async (_url, init) => {
      assert.equal(init.headers.get('x-hps-chalk-operator-identity'), null);
      assert.equal(init.headers.get('x-hps-chalk-service-secret'), null);
      return Response.json({ error: { code: 'retrieval_not_configured' } }, { status: 503 });
    });
  }
  await withFetch(async () => {
    assert.equal((await send('/admin/cohorts/cohort-a/logs', { 'x-hps-operator-secret': 'dedicated-operator-credential' })).status, 200);
  }, async (_url, init) => {
    assert.equal(init.headers.get('x-hps-operator-secret'), 'dedicated-operator-credential');
    assert.equal(init.headers.get('authorization'), null);
    assert.equal(init.headers.get('x-hps-chalk-service-secret'), null);
    return Response.json({ uploaded: [] });
  });
});

test('unavailable board does not become a successful empty roster', async () => {
  await withFetch(async () => {
    const r = await send('/admin/cohorts/cohort-a/board', { authorization: 'Bearer test-token' });
    assert.equal(r.status, 502);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const body = await r.json();
    assert.equal(body.error.type, 'upstream');
    assert.equal('seats' in body, false);
  }, async () => { throw new DOMException('deadline', 'TimeoutError'); });
});

test('actual Service storage failure remains a failure through Chalk', async () => {
  const { createMockEnv, TEST_SECRET } = await import('@hypeproof/service-testkit/test/harness/index.mjs');
  const { issueIssuer } = await import('@hypeproof/service-testkit/src/lib/tokens.ts');
  const { bridgeStateToService } = await import('./harness/service-state.mjs');
  const serverEnv = createMockEnv({ withSession: false, withRoster: false });
  const { listProfiles } = await import('@hypeproof/service-testkit/src/profiles/index.ts');
  const { serviceProfiles } = await import('../../test/fixtures/service-profiles.mjs');
  const SP = serviceProfiles(listProfiles);
  const cohort = SP.pilotCohort;
  const { token } = await issueIssuer({ issuer: 'storage-control', scopes: [{
    cohort, profiles: [SP.copyclone.id], max_hours: 6,
  }] }, 1, TEST_SECRET);
  // The real board passes authorization before D1 fails during its query.
  serverEnv.HPS_DB = { prepare() { throw new Error('injected D1 unavailable'); } };
  const integrated = bridgeStateToService(chalk);
  const r = await integrated.fetch(new Request(`https://chalk.test/admin/cohorts/${cohort}/board`, {
    headers: { authorization: 'Bearer ' + token },
  }), { ...serverEnv, ...env }, { waitUntil() {} });
  assert.equal(r.status, 500);
  const body = await r.json();
  assert.equal(body.error.type, 'internal');
  assert.equal('seats' in body, false);
  assert.equal(r.headers.get('x-hps-service-request-id'), body.error.request_id);
  assert.equal(JSON.stringify(body).includes('injected D1 unavailable'), false);
});
