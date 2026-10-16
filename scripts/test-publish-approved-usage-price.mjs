import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { APPROVED_DIGEST, ENDPOINT, canonical, digest, loadApprovedPrice,
  validateApprovedPrice, publishApprovedPrice } from './publish-approved-usage-price.mjs';
const price = await loadApprovedPrice();
const password = 'synthetic-admin-only-not-a-real-secret';
const json = (body, status = 201) => new Response(JSON.stringify(body), { status });

test('exact approval, UTC exclusive day, rational micro-USD rates and canonical key order', () => {
  assert.equal(digest(price), APPROVED_DIGEST);
  assert.equal(digest(Object.fromEntries(Object.entries(price).reverse())), APPROVED_DIGEST);
  assert.equal(canonical({ z: [2, { b: 1, a: 0 }], a: null }), '{"a":null,"z":[2,{"a":0,"b":1}]}');
  assert.equal(price.ends_at - price.starts_at, 86400000);
  for (const mutate of [p => p.ends_at++, p => p.publication = 'synthetic', p => p.region = 'us',
    p => p.rates['tokens:input'].denominator = 1000000, p => p.rates['tokens:output'].numerator = 0.5,
    p => p.context_window.max_input_tokens = 100000, p => p.bounds['tokens:output'] = 8192,
    p => p.revision += '-next', p => p.extra = true]) {
    const changed = structuredClone(price); mutate(changed); assert.throws(() => validateApprovedPrice(changed));
  }
});

test('one canonical authenticated POST, exact body and stored-digest-checked response; explicit idempotent rerun', async () => {
  let calls = 0; let stored = null;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(url, ENDPOINT); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
    assert.ok(options.signal); assert.equal(options.headers.authorization, 'Basic ' + Buffer.from('admin:' + password).toString('base64'));
    assert.equal(options.body, JSON.stringify(price));
    const incoming = JSON.parse(options.body); if (stored === null) stored = digest(incoming);
    return stored === digest(incoming) ? json(incoming) : json({}, 409);
  };
  for (let i = 0; i < 2; i++) {
    const result = await publishApprovedPrice({ price, password, fetchImpl });
    assert.equal(result.digest, APPROVED_DIGEST); assert.equal(result.requests, 1);
    assert.equal(result.classification, 'official-public-price-calculation-not-invoice');
    assert.equal(result.paid_contracts_changed, false); assert.ok(!JSON.stringify(result).includes(password));
  }
  assert.equal(calls, 2); assert.equal(stored, APPROVED_DIGEST);
});

test('unapproved document or absent credential fails before any network', async () => {
  for (const options of [{ price: { ...price, model: 'other' }, password }, { price, password: '' }, { price, password: 'bad:format' }]) {
    await assert.rejects(publishApprovedPrice({ ...options, fetchImpl: () => assert.fail('network forbidden') }));
  }
});

test('auth, approval, immutable revision conflict, redirect and server errors stop after one request', async () => {
  for (const status of [401, 403, 409, 302, 503]) {
    let calls = 0;
    await assert.rejects(publishApprovedPrice({ price, password, fetchImpl: async () => { calls++; return json({ secret: password }, status); } }), error => error.message.includes(String(status)) && !error.message.includes(password));
    assert.equal(calls, 1);
  }
});

test('timeout or network failure is unknown, redacted and never retried', async () => {
  let calls = 0;
  await assert.rejects(publishApprovedPrice({ price, password, fetchImpl: async () => { calls++; throw new Error(password); } }), error => /state unknown/.test(error.message) && !error.message.includes(password));
  assert.equal(calls, 1);
});

test('missing, oversized, malformed or altered success response cannot pass', async () => {
  for (const response of [new Response(null, { status: 201 }), new Response('x'.repeat(32769), { status: 201 }),
    new Response('<private>' + password, { status: 201 }), json({ ...price, ends_at: price.ends_at + 1 })]) {
    let calls = 0;
    await assert.rejects(publishApprovedPrice({ price, password, fetchImpl: async () => { calls++; return response; } }), error => !error.message.includes(password));
    assert.equal(calls, 1);
  }
});

test('workflow opt-in is default off, dry runs cannot deploy/publish, no paid flag or SQL publication', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
  assert.match(workflow, /publish_approved_usage_price:\n(?:.*\n){2}        default: false/);
  assert.match(workflow, /name: Publish explicitly approved[^\n]*\n        if: \$\{\{ !inputs.dry_run && inputs.publish_approved_usage_price \}\}/);
  assert.match(workflow, /price_args=\(\)/);
  assert.match(workflow, /HPS_USAGE_APPROVED_PRICE_DIGESTS:\$\{APPROVED_PRICE_DIGEST\}/);
  assert.doesNotMatch(workflow, /HPS_ACCESS_CONTRACTS:|keep.vars|INSERT INTO usage_price/);
});
