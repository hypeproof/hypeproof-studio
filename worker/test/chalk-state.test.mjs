import assert from 'node:assert/strict';
import { test } from 'node:test';
import './harness/loader.mjs';
const { default: service } = await import('../src/index.ts');
const { issue, issueIssuer, verify } = await import('../src/lib/tokens.ts');
const { revokeToken, setRoster } = await import('../src/lib/kv.ts');

const secret = 'test-secret-' + 'x'.repeat(30);
const cohort = 'boah-dental-2026-a';
const values = new Map();
const kv = {
  async get(key, type) { const value = values.get(key); return value === undefined ? null : type === 'json' ? JSON.parse(value) : value; },
  async put(key, value) { values.set(key, value); },
};
const env = { HPS_SIGNING_SECRET: secret, ENVIRONMENT: 'production', HPS_KV: kv, HPS_ADMIN_PASSWORD: 'fixture-only' };
const read = (headers = {}, id = cohort) => service.fetch(new Request(`https://service.test/admin/chalk/cohorts/${id}/state`, { headers }), env);

test('state scope and public metadata are enforced in the Service', async () => {
  await setRoster(kv, cohort, ['private-member-one', 'private-member-two']);
  const { token } = await issueIssuer({ issuer: 'state-reader', scopes: [{ cohort, profiles: [] }] }, 1, secret);
  const res = await read({ authorization: `Bearer ${token}` });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.ok(!text.includes('private-member'));
  const body = JSON.parse(text);
  assert.equal(body.roster_size, 2);
  assert.deepEqual(body.profiles, []);
  assert.deepEqual(Object.keys(body).sort(), ['id','now','paused','profiles','roster_size','scope','session','templates']);
  assert.equal((await read({ authorization: `Bearer ${token}` }, 'other-cohort')).status, 403);
});

test('student, invalid, revoked and non-Bearer operator credentials cannot read issuer state', async () => {
  const student = await issue({ u: 'student', c: cohort, p: 'profile' }, 1, secret);
  assert.equal((await read({ authorization: `Bearer ${student.token}` })).status, 403);
  assert.equal((await read({ authorization: 'Bearer invalid' })).status, 401);
  const issuer = await issueIssuer({ issuer: 'revoked', scopes: [{ cohort, profiles: [] }] }, 1, secret);
  const payload = await verify(issuer.token, secret);
  await revokeToken(kv, payload.jti, { by: 'fixture', reason: 'test' }, 3600);
  assert.equal((await read({ authorization: `Bearer ${issuer.token}` })).status, 401);
  assert.equal((await read({ authorization: `Basic ${btoa('admin:fixture-only')}` })).status, 401);
  assert.equal((await read({ 'cf-access-authenticated-user-email': 'operator@example.test' })).status, 401);
  const absent = await read();
  assert.equal(absent.status, 401);
  assert.equal(absent.headers.get('cache-control'), 'no-store');
});
