// CGP-ART-R-013: counts per test version, from the Service's participant sessions only.
// Designed behavior: last 7 days against the 7 before, by the session's open time; a session counts for the version it
// records (else its experiment's); counted once; "finished" = at least one completed task; the counted session ids are
// kept as the sources; nothing identifies a participant; no traffic → empty, a failed read → unknown (never zero); the
// change is said with an arrow and words. The real PublishSession reads evidence per experiment of the shown versions,
// keeps no pseudonym, caps and caches its reads, and says unknown when a read fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { STATS_EMPTY, changeWords, versionStats, DAY_MS } from '../src/versionStats.ts';

const now = 1_800_000_000_000;
const s = (id, daysAgo, o = {}) => ({ session_id: id, at: now - daysAgo * DAY_MS, product_version: null, tasks: {}, pages: 2, clicks: 3, ...o });
const done = { order: { started: true, completed: true } }, started = { order: { started: true, completed: false } };

test('windows, attribution, de-duplication and sources', () => {
  const v = versionStats('v1', [
    { id: 'e1', product_version_id: 'v1', sessions: [s('ps_a1', 1, { tasks: done }), s('ps_a2', 2, { tasks: started }), s('ps_a3', 8, { tasks: done }), s('ps_a4', 15), s('ps_a5', 3, { product_version: 'v2' })] },
    { id: 'e2', product_version_id: 'v2', sessions: [s('ps_b1', 0.5, { product_version: 'v1', tasks: done }), s('ps_a1', 1, { tasks: done })] },
  ], now);
  assert.equal(v.state, 'ok');
  assert.deepEqual([v.opened.last, v.opened.prev, v.completed.last, v.completed.prev], [3, 1, 2, 1]);
  assert.deepEqual(v.opened.sources.map((x) => x.session_id), ['ps_b1', 'ps_a1', 'ps_a2'], 'newest first; v2 session out; 15-day-old out; ps_a1 once');
  assert.deepEqual(v.completed.sources.map((x) => [x.session_id, x.experiment_id]), [['ps_b1', 'e2'], ['ps_a1', 'e1']]);
  assert.deepEqual(Object.keys(v.opened.sources[0]).sort(), ['at', 'clicks', 'completed', 'experiment_id', 'pages', 'session_id'], 'no participant identity in a source');
});

test('empty and unknown are never zero', () => {
  assert.deepEqual(versionStats('v1', [{ id: 'e1', product_version_id: 'v1', sessions: [s('ps_x', 20)] }], now), { state: 'empty' });
  assert.deepEqual(versionStats('v1', [{ id: 'e1', product_version_id: 'v1', sessions: [] }, { id: 'e2', product_version_id: 'v1', sessions: null }], now), { state: 'unknown' });
  assert.equal(STATS_EMPTY, '아직 연 사람이 없어요');
});

test('the change is an arrow and words', () => {
  assert.deepEqual(changeWords({ last: 5, prev: 2 }), { arrow: '▲', text: '지난주보다 +3' });
  assert.deepEqual(changeWords({ last: 1, prev: 4 }), { arrow: '▼', text: '지난주보다 -3' });
  assert.deepEqual(changeWords({ last: 2, prev: 2 }), { arrow: '', text: '지난주와 같아요' });
});

test('the real PublishSession: evidence per experiment, no pseudonym kept, cached, capped, unknown on failure', async () => {
  const here = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({ stdin: { contents: "export { PublishSession } from './src/publishSession';", resolveDir: here, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const require = createRequire(import.meta.url), module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, console, Buffer, process, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder, Response, Headers, crypto: globalThis.crypto, AbortSignal, AbortController });
  const { PublishSession } = module.exports;
  const exps = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `e${i}`, week: 1, question: 'q', method: 'task_test', success_criteria: [], hypothesis_id: null, product_version_id: i === 7 ? 'v2' : 'v1', status: 'running' }));
  const state = { project: { id: 'p', title: 'page', members: ['a'] }, test_origin: 'https://test.invalid', versions: [], hypotheses: [], links: [], experiments: exps };
  const reads = [];
  let failE2 = false;
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    const m = path.match(/\/experiments\/([^/]+)\/evidence$/);
    if (!m) return new Response(JSON.stringify(state), { status: 200 });
    reads.push(m[1]);
    if (failE2 && m[1] === 'e2') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ evidence: { sessions: [{ session_id: `ps_${m[1]}`, at: now - DAY_MS, pseudonym: 'pp_SECRET', product_version: null, tasks: done, pages: 1, clicks: 1, inputs: 9 }] } }), { status: 200 });
  };
  let t = now;
  const session = new PublishSession({ switchOn: () => true, token: async () => 'tok', scopeKey: () => 's', base: () => 'https://api.test/v1/curriculum', root: () => null, entry: () => null, events: async () => [], projectId: () => 'p', setProjectId: async () => {}, week: () => 1, defaultTitle: () => 'page', qr: (u) => u, now: () => t, fetchImpl });
  let view = await session.view();
  assert.equal(reads.length, 6, 'at most six new evidence reads per view');
  assert.equal(view.stats.v1.state, 'ok');
  assert.equal(view.stats.v1.opened.last, 6);
  assert.equal(view.stats.v2.state, 'unknown', 'the seventh experiment was not read in this view: unknown, not zero');
  assert.ok(!JSON.stringify(view.stats).includes('pp_SECRET'), 'no pseudonym reaches the view');
  view = await session.view();
  assert.equal(reads.length, 7, 'cached reads are reused; only the missing one is read');
  assert.equal(view.stats.v2.state, 'ok');
  t += 61_000; failE2 = true;
  view = await session.view();
  assert.equal(view.stats.v1.state, 'unknown', 'a failed read makes its version unknown');
});
