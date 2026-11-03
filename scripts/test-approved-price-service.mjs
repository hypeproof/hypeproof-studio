// Actual pinned Service Hono + in-memory SQLite. Never reaches a deployed host.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPROVED_DIGEST, digest, loadApprovedPrice, publishApprovedPrice } from './publish-approved-usage-price.mjs';
const source = resolve(process.env.HPS_SERVICE_SOURCE || '.service-source');
const pin = JSON.parse(await readFile(new URL('../config/service-deployment.json', import.meta.url), 'utf8'));
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), pin.sha, 'Service source must match deployment pin');
const fromSource = relative => import(pathToFileURL(resolve(source, relative)).href);
await fromSource('worker/test/harness/loader.mjs');
const { validateUsagePrice } = await fromSource('worker/src/lib/usage-costs.ts');
const { accessDigest } = await fromSource('worker/src/lib/access-contracts.ts');
const { accessHarness } = await fromSource('worker/test/harness/access.mjs');
const price = await loadApprovedPrice();
assert.equal(await accessDigest(validateUsagePrice(price)), APPROVED_DIGEST);
const h = await accessHarness();
try {
  delete h.env.HPS_ACCESS_CONTRACTS;
  const transport = async (url, options) => {
    const r = await h.request(new URL(url).pathname, { method: options.method, auth: options.headers.authorization, body: JSON.parse(options.body) });
    return new Response(r.text, { status: r.status, headers: r.headers });
  };
  const run = password => publishApprovedPrice({ price, password, fetchImpl: transport });
  await assert.rejects(run('incorrect-synthetic'), /HTTP 401/);
  await assert.rejects(run('synthetic-admin'), /HTTP 403/);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM usage_price_revisions').get().n, 0);
  h.env.HPS_USAGE_APPROVED_PRICE_DIGESTS = APPROVED_DIGEST;
  assert.equal((await run('synthetic-admin')).status, 'PASS');
  assert.equal((await run('synthetic-admin')).status, 'PASS');
  const row = h.db.prepare('SELECT digest,document FROM usage_price_revisions WHERE revision=?').get(price.revision);
  assert.equal(row.digest, APPROVED_DIGEST); assert.equal(digest(JSON.parse(row.document)), APPROVED_DIGEST);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM usage_price_revisions').get().n, 1);
  const conflict = structuredClone(price); conflict.rates['tokens:input'].numerator = 2;
  h.env.HPS_USAGE_APPROVED_PRICE_DIGESTS += ',' + await accessDigest(conflict);
  assert.equal((await h.request('/admin/access/usage/prices', { method: 'POST', body: conflict })).status, 409);
  assert.equal((await h.request('/admin/access/usage/attempts', { method: 'POST', body: {} })).status, 503);
  assert.equal(h.env.HPS_ACCESS_CONTRACTS, undefined);
  console.log('PASS pinned canonical Service validation/digest + actual Hono/SQLite publication, exact approval, auth, idempotency, conflict and paid-off preservation; no deployed requests');
} finally { h.close(); }
