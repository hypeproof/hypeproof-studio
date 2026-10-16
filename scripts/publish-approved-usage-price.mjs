import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const APPROVED_DIGEST = 'c784f24ce54eb0534533f4292d526a6e981135c362cf1967797df25a9051aa8b';
export const PRICE_FILE = new URL('../config/usage-prices/haiku55-20261016.json', import.meta.url);
export const ENDPOINT = 'https://api.hypeproof-ai.xyz/admin/access/usage/prices';
// Same deterministic JSON representation as Service accessJson/accessDigest.
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
export function validateApprovedPrice(price) {
  requireValue(price && typeof price === 'object' && !Array.isArray(price), 'Invalid approved price document');
  requireValue(digest(price) === APPROVED_DIGEST, 'Approved price digest mismatch');
  requireValue(price.schema === 'hps-usage-price/1' && price.publication === 'approved'
    && price.provider === 'anthropic' && price.model === 'claude-haiku-5-5'
    && price.protocol === 'anthropic-messages' && price.service_tier === 'standard' && price.region === 'global', 'Approved dimensions mismatch');
  requireValue(price.starts_at === Date.parse('2026-10-16T00:00:00Z')
    && price.ends_at === Date.parse('2026-10-17T00:00:00Z')
    && price.context_window?.min_input_tokens === 0 && price.context_window?.max_input_tokens === 100001,
  'Approved UTC interval/context mismatch');
  requireValue(price.currency === 'USD' && price.rounding === 'ceil-per-meter' && price.fx === null, 'Approved cost unit mismatch');
  const denominators = { 'tokens:input': 10, 'tokens:output': 2, 'tokens:cache_read': 100,
    'tokens:cache_write:5m': 8, 'tokens:cache_write:1h': 5 };
  requireValue(Object.keys(price.rates).length === 5 && Object.keys(price.bounds).length === 5, 'Approved meter set mismatch');
  for (const [meter, denominator] of Object.entries(denominators)) {
    const rate = price.rates[meter];
    requireValue(Number.isSafeInteger(rate?.numerator) && rate.numerator === 1
      && Number.isSafeInteger(rate?.denominator) && rate.denominator === denominator
      && price.bounds[meter] === (meter === 'tokens:output' ? 4096 : 100000), 'Approved rational meter mismatch');
  }
  return price;
}
export async function loadApprovedPrice() { return validateApprovedPrice(JSON.parse(await readFile(PRICE_FILE, 'utf8'))); }
async function boundedJson(response) {
  requireValue(response.body, 'Publication response body missing');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) { await reader.cancel(); throw new Error('Publication response too large'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('Invalid or incomplete publication response; publication state unknown, do not retry automatically'); }
}
export async function publishApprovedPrice({ price, password, fetchImpl = fetch } = {}) {
  validateApprovedPrice(price);
  requireValue(typeof password === 'string' && password.length > 0 && !/[:\r\n]/.test(password), 'Existing admin credential missing or unsupported');
  let response;
  try {
    response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64'),
        accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(price) });
  } catch { throw new Error('Publication transport failed; publication state unknown, do not retry automatically'); }
  requireValue(response.status === 201, `Price publication HTTP ${response.status}; stopped without retry`);
  const saved = await boundedJson(response);
  validateApprovedPrice(saved);
  // Canonical publishUsagePrice SELECTs the stored immutable digest before 201.
  // This is the checked POST response, not an independent read-only GET.
  return { schema: 'hps-approved-price-publication/1', status: 'PASS', http_status: 201,
    digest: digest(saved), revision: saved.revision, confirmation: 'canonical-post-stored-digest-check',
    requests: 1, automatic_retries: 0, unit: 'USD micro-units', classification: 'official-public-price-calculation-not-invoice',
    interval: { starts_at: saved.starts_at, ends_at: saved.ends_at }, paid_contracts_changed: false };
}
async function main(args) {
  requireValue(args.length === 1 && ['--check', '--publish'].includes(args[0]), 'Use --check or explicit --publish');
  const price = await loadApprovedPrice();
  if (args[0] === '--check') {
    console.log(JSON.stringify({ status: 'VALIDATED_NOT_PUBLISHED', digest: APPROVED_DIGEST, revision: price.revision }));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `digest=${APPROVED_DIGEST}\n`);
  } else console.log(JSON.stringify(await publishApprovedPrice({ price, password: process.env.HPS_ADMIN_PASSWORD })));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
