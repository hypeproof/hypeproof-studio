// CGP-ART-R-004 — Chalk forwards POST .../plan/section-revision to the Service with the Lab-connected issuer, the body
// bytes unchanged, and a timeout long enough for one Haiku call; nothing else under the plan path is admitted.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { withBearerAsConnection } from './harness/connect.mjs';
const { forwardTimeoutMs, isSectionRevision } = await import('../src/routes/forward.ts');
const chalk = withBearerAsConnection((await import('../src/index.ts')).default);
const path = '/admin/chalk/cohorts/test-cohort/courses/course-1/plan/section-revision';
const env = { HPS_SIGNING_SECRET: 'test-secret-0123456789abcdef', ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };
const original = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json({ changed: true, revision: 4 }, { status: 200 }); };
try {
  const body = JSON.stringify({ at: { file: 'lesson', section: 'flow', marker: { name: 'data-chalk-step', value: 's-2' } }, request: '짝 활동으로', expected_revision: 3, request_id: 'plan-1' });
  const r = await chalk.fetch(new Request('https://chalk.test' + path, { method: 'POST', body, headers: { authorization: 'Bearer fixture', 'content-type': 'application/json', 'cf-access-authenticated-user-email': 'forged@example.test' } }), env, {});
  assert.equal(r.status, 200);
  const call = calls.at(-1);
  assert.equal(call.url, 'https://service.test' + path);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.get('authorization'), 'Bearer fixture');
  assert.equal(call.init.headers.get('cf-access-authenticated-user-email'), null);
  assert.equal(new TextDecoder().decode(call.init.body), body);
  // Only the exact POST is admitted.
  const n = calls.length;
  for (const [method, p] of [['GET', path], ['PUT', path], ['POST', path + '/x'], ['POST', path.replace('section-revision', 'section-revisions')], ['POST', '/admin/chalk/cohorts/test-cohort/courses/course-1/plan']])
    assert.equal((await chalk.fetch(new Request('https://chalk.test' + p, { method, body: method === 'GET' ? undefined : '{}', headers: { authorization: 'Bearer fixture' } }), env, {})).status, 404, method + ' ' + p);
  assert.equal(calls.length, n);
  // The revision waits on the model; every other forward keeps its budget.
  assert.equal(isSectionRevision(path, 'POST'), true);
  assert.equal(isSectionRevision(path, 'GET'), false);
  assert.equal(forwardTimeoutMs(path, 'POST', false), 45_000);
  assert.equal(forwardTimeoutMs('/admin/cohorts/c/authoring/k/proposal', 'POST', false), 8_000);
  assert.equal(forwardTimeoutMs('/workshop/boa-tokens', 'POST', true), 60_000);
  assert.equal(forwardTimeoutMs('/workshop/boa-tokens', 'GET', true), 8_000);
  console.log('PASS plan-section forward: POST section-revision forwarded byte-for-byte with the connected issuer, 45 s budget, nothing else admitted');
} finally { globalThis.fetch = original; }
