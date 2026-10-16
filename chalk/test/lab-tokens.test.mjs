import assert from 'node:assert/strict';
import {test} from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import {labTokens} from '../src/routes/lab-tokens.ts';
import smoke from '../../scripts/release/smoke/checks/s6-chalk-lab-tokens.mjs';

const request = (auth = 'Bearer synthetic-issuer') => new Request('https://chalk.test/cohorts/class-one/lab-tokens', {
  headers: {authorization: auth, cookie: 'not-forwarded', 'cf-access-authenticated-user-email': 'forged@example.test'},
});
const fixture = {board: {code: 'NAMED2', cohort: 'class-one', profile: 'profile-one',
  students: [{handle: 'student-one', token: 'synthetic-student-token', claimedBy: 'Student One'}]}};

test('production uses only the fixed Lab origin, Bearer and bounded read; failures stay failures', async () => {
  const previous = globalThis.fetch;
  try {
    for (const status of [200, 401, 403, 502]) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://hypeproof-ai.xyz/api/workshop/boa-room/instructor?cohort=class-one');
        assert.deepEqual(init.headers, {authorization: 'Bearer synthetic-issuer'});
        assert.equal(init.redirect, 'manual'); assert.ok(init.signal instanceof AbortSignal);
        return Response.json(status === 200 ? fixture : {error: 'denied'}, {status});
      };
      const response = await labTokens.fetch(request(), {ENVIRONMENT: 'production', HPS_LAB_ORIGIN: 'https://untrusted.test'});
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), status === 200 ? fixture : {error: 'denied'});
    }
  } finally {globalThis.fetch = previous;}
});

test('rejects missing/Basic credentials before transport, and refuses redirect/network failures', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = () => {throw new Error('must not fetch');};
    for (const auth of ['', 'Basic synthetic']) assert.equal((await labTokens.fetch(request(auth), {})).status, 401);
    globalThis.fetch = async () => new Response(null, {status: 302, headers: {location: 'https://untrusted.test'}});
    assert.equal((await labTokens.fetch(request(), {})).status, 502);
    globalThis.fetch = async () => {throw new Error('network');};
    assert.equal((await labTokens.fetch(request(), {})).status, 502);
  } finally {globalThis.fetch = previous;}
});

test('read-only release smoke compares credentials without putting them in reports', async () => {
  const previous = globalThis.fetch;
  try {
    assert.equal((await smoke.run({env: {}, chalkUrl: 'https://chalk.test'})).result, 'NOT_RUN');
    globalThis.fetch = async () => Response.json(fixture);
    const report = await smoke.run({env: {HPS_LAB_TOKEN_READ_ISSUER: 'synthetic-issuer', HPS_LAB_TOKEN_READ_COHORT: 'class-one'}, chalkUrl: 'https://chalk.test'});
    assert.equal(report.result, 'PASS'); assert.ok(!JSON.stringify(report).includes('synthetic-'));
    globalThis.fetch = async () => Response.json({error: 'denied'}, {status: 403});
    assert.equal((await smoke.run({env: {HPS_LAB_TOKEN_READ_ISSUER: 'synthetic-issuer', HPS_LAB_TOKEN_READ_COHORT: 'class-one'}, chalkUrl: 'https://chalk.test'})).result, 'FAIL');
  } finally {globalThis.fetch = previous;}
});
