#!/usr/bin/env node
// Read-only release smoke. Never log credentials, identities, or raw responses.
import { pathToFileURL } from 'node:url';

export async function verifyOwnerConsole({ base, secret, fetchImpl = fetch }) {
  if (!secret || secret.length < 32) throw new Error('HPS_OWNER_SERVICE_SECRET is required');
  const origin = new URL(base);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw new Error('HTTPS is required');
  }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('Expected an origin without credentials or path');
  }
  const request = async (path, authenticated) => {
    try {
      return await fetchImpl(new URL(path, origin), {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30000),
        headers: authenticated ? { 'x-hps-owner-service-secret': secret } : {},
      });
    } catch { throw new Error('Owner console network read failed'); }
  };
  for (const path of ['/admin/owner', '/admin/owner/usage']) {
    if ((await request(path, false)).status !== 401) throw new Error('Unauthenticated Owner request was not denied');
  }
  const page = await request('/admin/owner', true);
  if (page.status !== 200 || !page.headers.get('cache-control')?.includes('no-store') ||
      !(await page.text()).includes('<title>Owner Console · HypeProof</title>')) {
    throw new Error('Authenticated Owner page contract failed');
  }
  const response = await request('/admin/owner/usage', true);
  if (response.status !== 200 || !response.headers.get('cache-control')?.includes('no-store')) {
    throw new Error(`Authenticated Owner usage read failed (HTTP ${response.status})`);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('Owner usage is not JSON'); }
  if (data?.schema !== 'hps-owner-usage/1' || !Array.isArray(data.usage) ||
      !Array.isArray(data.costs) || !Array.isArray(data.invoice_adjustments) ||
      data.coverage?.usage !== 'stored-records' || data.coverage?.completeness !== 'unverified' ||
      !['attempt-ledger', 'not-installed'].includes(data.coverage?.costs)) {
    throw new Error('Owner usage schema/coverage contract failed');
  }
  const recordsByKind = { classroom: 0, trial: 0, pass: 0, test: 0, unclassified: 0 };
  for (const row of data.usage) {
    if (!Object.hasOwn(recordsByKind, row.kind) || !Number.isSafeInteger(row.records) || row.records < 0) {
      throw new Error('Owner usage aggregate contract failed');
    }
    recordsByKind[row.kind] += row.records;
    if (!Number.isSafeInteger(recordsByKind[row.kind])) throw new Error('Owner usage aggregate overflow');
  }
  // Zero records is a valid observation, not evidence that ingestion is complete.
  return { status: 'PASS', records_by_kind: recordsByKind, cost_coverage: data.coverage.costs,
    completeness: data.coverage.completeness, writes: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await verifyOwnerConsole({
      base: process.env.PROD || 'https://api.hypeproof-ai.xyz', secret: process.env.HPS_OWNER_SERVICE_SECRET,
    })));
  } catch (error) {
    console.error(`Owner console: FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}
