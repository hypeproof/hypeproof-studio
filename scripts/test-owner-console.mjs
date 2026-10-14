import assert from 'node:assert/strict';
import { verifyOwnerConsole } from './verify-owner-console.mjs';

const base = 'https://owner.invalid';
const password = 'synthetic-secret';
const valid = { schema: 'hps-owner-usage/1', usage: [], costs: [], invoice_adjustments: [],
  coverage: { usage: 'stored-records', completeness: 'unverified', costs: 'not-installed' } };
const reply = (body, status = 200) => new Response(body, { status, headers: { 'cache-control': 'no-store' } });
function transport({ data = valid, publicStatus = 401, privateStatus = 200, raw } = {}) {
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined);
    assert.ok(options.signal);
    if (!options.headers.authorization) return reply('', publicStatus);
    assert.equal(options.headers.authorization, `Basic ${Buffer.from(`:${password}`).toString('base64')}`);
    if (url.pathname === '/admin/owner') return reply('<title>Owner Console · HypeProof</title>', privateStatus);
    return reply(raw ?? JSON.stringify(data), privateStatus);
  };
}
const run = options => verifyOwnerConsole({ base, password, fetchImpl: transport(options) });

// Empty history is valid; all usage kinds remain represented without inventing data.
assert.deepEqual((await run()).records_by_kind, { classroom: 0, trial: 0, pass: 0, test: 0, unclassified: 0 });
assert.deepEqual((await run({ data: { ...valid, usage: [
  { kind: 'trial', records: 8, user_id: 'PRIVATE' }, { kind: 'test', records: 4 },
  { kind: 'unclassified', records: 2 }, { kind: 'trial', records: 1 },
] } })).records_by_kind, { classroom: 0, trial: 9, pass: 0, test: 4, unclassified: 2 });

// Fail closed for access, service failures, or incompatible response contracts.
for (const options of [{ publicStatus: 200 }, { publicStatus: 302 }, { privateStatus: 401 },
  { privateStatus: 503 }, { raw: '<html>error</html>' }, { data: { ...valid, schema: 'old' } },
  { data: { ...valid, usage: [{ kind: 'trial', records: -1 }] } },
  { data: { ...valid, usage: [{ kind: 'unknown', records: 2 }] } }]) {
  await assert.rejects(run(options));
}
await assert.rejects(verifyOwnerConsole({ base, password: '', fetchImpl: () => assert.fail('must not call') }));
await assert.rejects(verifyOwnerConsole({ base: 'http://owner.invalid', password }));
await assert.rejects(verifyOwnerConsole({ base, password, fetchImpl: () => { throw new Error(password); } }),
  error => !error.message.includes(password) && error.message.includes('network'));
console.log('Owner smoke controls PASS: read-only, all purposes, empty, auth, failure, redaction');
