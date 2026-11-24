// TUX-SP-12 — the start page reads the Service's offer once per window, without a credential.
// #4193 — there is no trial-code choice any more: when the offer does not advertise free start,
// the host says so (`freeStartCheck`) and re-reads it on `freeStartRecheck`.
// Pure helpers (src/trialOffer.ts) and the start page host (src/startPage.ts) on a synthetic
// Service. No network, no VS Code.
//
// Run: node --experimental-strip-types test/trial-offer.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as offerModule from '../src/trialOffer.ts';
const { parseTrialOffer, fetchTrialOffer } = offerModule;
const require = createRequire(import.meta.url);

// ── parse: positive controls ──────────────────────────────────────────────────────────────
{
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 1, request_limit: 40 }), { entry: 'code', durationHours: 1, requestLimit: 40 });
  assert.deepEqual(parseTrialOffer({ entry: 'open', duration_hours: 2, request_limit: 77 }), { entry: 'open', durationHours: 2, requestLimit: 77 });
  // The allowance is optional: the entry mode alone is still a valid advertisement.
  assert.deepEqual(parseTrialOffer({ entry: 'code' }), { entry: 'code' });
  // Half an hour is representable.
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 0.5, request_limit: 10 }), { entry: 'code', durationHours: 0.5, requestLimit: 10 });
  console.log('PASS parse: code/open, allowance optional');
}

// ── parse: negative controls (a malformed answer is "not advertised", never a guess) ───────
{
  for (const bad of [null, undefined, 'code', [], {}, { entry: 'free' }, { entry: 'OPEN' }]) assert.equal(parseTrialOffer(bad), null, JSON.stringify(bad));
  // A broken allowance drops the numbers but keeps the entry mode: the code line must not disappear because of a bad number.
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: -1, request_limit: 40 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 1, request_limit: 0 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 1, request_limit: 1.5 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'code', duration_hours: 100000, request_limit: 40 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'code', request_limit: 40 }), { entry: 'code' });
  assert.deepEqual(parseTrialOffer({ entry: 'open', duration_hours: 'x', request_limit: 40 }), { entry: 'open' });
  console.log('PASS parse: malformed answers are refused or lose only the numbers');
}

// ── #4193: the trial-code note is gone ───────────────────────────────────────────────────
{
  assert.equal(offerModule.trialEntryNote, undefined, 'no trial-code note helper');
  assert.equal(offerModule.TRIAL_CODE_LINE, undefined, 'no trial-code line');
  console.log('PASS note: no trial-code note is exported');
}

// ── fetch: one unauthenticated GET, no credential, failures are "not advertised" ──────────
{
  const calls = [];
  const ok = async (url, init = {}) => { calls.push({ url, init }); return new Response(JSON.stringify({ entry: 'code', duration_hours: 1, request_limit: 40 }), { status: 200 }); };
  assert.deepEqual(await fetchTrialOffer('https://service.test/v1/', ok), { entry: 'code', durationHours: 1, requestLimit: 40 });
  assert.equal(calls[0].url, 'https://service.test/v1/trial/offer');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), null, 'never sends a credential');
  assert.equal(calls[0].init.method ?? 'GET', 'GET');
  assert.equal(await fetchTrialOffer('https://service.test/v1', async () => new Response('{}', { status: 404 })), null);
  assert.equal(await fetchTrialOffer('https://service.test/v1', async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchTrialOffer('https://service.test/v1', async () => new Response('not json', { status: 200 })), null);
  console.log('PASS fetch: GET /trial/offer without credentials; 404/offline/garbage → null');
}

// ── host: the start page reads the offer once and hands it to the webview ─────────────────
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
function harness(offer, setting = 'service') {
  const world = { states: [], calls: [], offer };
  const ctx = { workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} }, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, extension: { packageJSON: { version: 'test' } }, subscriptions: [] };
  const chat = { openInEditor: async () => {}, ensureProfile: async () => null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {}, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? 'https://service.test/v1' : key === 'freeStart' ? setting : fallback }) }, window: {}, commands: { executeCommand: async () => {} }, Uri: { parse: s => s }, env: {} };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    world.calls.push({ path: u.pathname, auth: new Headers(init.headers).get('authorization') });
    if (u.pathname === '/v1/trial/offer' && world.offer) return new Response(JSON.stringify(world.offer), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch, Response, Headers, Date, JSON, setTimeout: () => 0, clearTimeout: () => {} });
  const page = new module.exports.StartPage(ctx, chat, async () => false);
  page.panel = { webview: { postMessage: async msg => world.states.push(msg) } };
  return { world, page, last: () => JSON.parse(JSON.stringify(world.states.at(-1).state)) };
}
{
  const on = harness({ entry: 'code', duration_hours: 1, request_limit: 40 });
  await on.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.deepEqual(on.last().trialOffer, { entry: 'code', durationHours: 1, requestLimit: 40 });
  assert.equal(on.world.calls.filter(c => c.path === '/v1/trial/offer').length, 1);
  assert.ok(on.world.calls.every(c => c.auth === null), 'pre-entry reads carry no credential');
  // A second startReady does not read again within the window.
  await on.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r));
  assert.equal(on.world.calls.filter(c => c.path === '/v1/trial/offer').length, 1);
  // The profile endpoint is never touched by this read (it would start a trial clock).
  assert.equal(on.world.calls.filter(c => c.path === '/v1/profile').length, 0);

  const off = harness(null);
  await off.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(off.last().trialOffer, undefined, 'not advertised → no offer in state');
  console.log('PASS host: one credential-free read per window; absent when the Service does not advertise');
}

// ── #4193: without the free card the host says so and re-reads on request ────────────────
{
  const FULL = { entry: 'open', claim: '/v1/free/claim', available: true };
  // A failed read: "unavailable", never a trial-code entry.
  const h = harness(null);
  await h.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(h.last().freeStartCheck, 'unavailable', 'a failed offer read is said');
  assert.equal(h.last().freeStart, undefined);
  // The Service comes back: 다시 확인 reads again, once, without a credential, and the free card returns.
  h.world.offer = FULL;
  const before = h.world.calls.filter(c => c.path === '/v1/trial/offer').length;
  await h.page.handle({ type: 'freeStartRecheck' });
  assert.ok(h.world.states.some(m => m.state.freeStartCheck === 'checking'), 'the re-read is shown while it runs');
  assert.equal(h.world.calls.filter(c => c.path === '/v1/trial/offer').length, before + 1, 'one re-read');
  assert.ok(h.world.calls.every(c => c.auth === null), 'the re-read carries no credential');
  assert.equal(h.last().freeStartCheck, undefined, 'free start advertised: no check line');
  assert.ok(h.last().freeStart, 'the free card is drawn');
  // Once the free card is on, a stray re-check reads nothing.
  await h.page.handle({ type: 'freeStartRecheck' });
  assert.equal(h.world.calls.filter(c => c.path === '/v1/trial/offer').length, before + 1, 'no read while free start is on');

  // An answer that does not advertise free start (entry "code") is "unavailable" too; a re-read that fails again stays so.
  const code = harness({ entry: 'code' });
  await code.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(code.last().freeStartCheck, 'unavailable');
  await code.page.handle({ type: 'freeStartRecheck' });
  assert.equal(code.last().freeStartCheck, 'unavailable', 'still not advertised after the re-read');

  // Negative control: the machine switched free start off → no check line and no re-read.
  const off = harness(FULL, 'off');
  await off.page.handle({ type: 'startReady' });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(off.last().freeStartCheck, undefined, 'switched off: nothing to re-check');
  const reads = off.world.calls.filter(c => c.path === '/v1/trial/offer').length;
  await off.page.handle({ type: 'freeStartRecheck' });
  assert.equal(off.world.calls.filter(c => c.path === '/v1/trial/offer').length, reads, 'switched off: no re-read');
  console.log('PASS host: free start unavailable is said, re-read on request, and silent when switched off');
}
