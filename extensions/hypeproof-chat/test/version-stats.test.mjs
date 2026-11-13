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

test('window edges: (now-7d, now] is this week, (now-14d, now-7d] the week before', () => {
  const at = (id, ms, o = {}) => ({ session_id: id, at: now - ms, product_version: null, tasks: {}, pages: 1, clicks: 1, ...o });
  const v = versionStats('v1', [{ id: 'e1', product_version_id: 'v1', sessions: [
    at('ps_d65', 6.5 * DAY_MS),                       // a 6-day window would drop it
    at('ps_e7', 7 * DAY_MS, { tasks: done }),         // exactly 7 days: last week, not this week
    at('ps_e7b', 7 * DAY_MS - 1),                     // one ms inside this week
    at('ps_e14', 14 * DAY_MS, { tasks: done }),       // exactly 14 days: outside both
    at('ps_e14b', 14 * DAY_MS - 1),                   // one ms inside last week, not finished
  ] }], now);
  assert.deepEqual(v.opened.sources.map((x) => x.session_id).sort(), ['ps_d65', 'ps_e7b'], 'this week: 6.5 days in, the 7-day edge out');
  assert.deepEqual([v.opened.last, v.opened.prev], [2, 2], 'last week holds the 7-day edge and 14d-1ms, not the 14-day edge');
  assert.deepEqual([v.completed.last, v.completed.prev], [0, 1], 'last week finished = the 7-day edge only; the 14-day edge does not count');
});

test('one session in two experiments of the same version counts once', () => {
  const v = versionStats('v1', [
    { id: 'e1', product_version_id: 'v1', sessions: [s('ps_dup', 1, { tasks: done })] },
    { id: 'e2', product_version_id: 'v1', sessions: [s('ps_dup', 1, { product_version: 'v1', tasks: done })] },
  ], now);
  assert.deepEqual([v.opened.last, v.completed.last, v.opened.sources.length], [1, 1, 1]);
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

test('the real PublishSession: never waits for the counts, reads in parallel, caps, caches without a pseudonym', async () => {
  const here = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({ stdin: { contents: "export { PublishSession } from './src/publishSession';", resolveDir: here, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const require = createRequire(import.meta.url), module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, console, Buffer, process, setTimeout, clearTimeout, URL, TextEncoder, TextDecoder, Response, Headers, crypto: globalThis.crypto, AbortSignal, AbortController });
  const { PublishSession } = module.exports;
  const exps = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: `e${i}`, week: 1, question: 'q', method: 'task_test', success_criteria: [], hypothesis_id: null, product_version_id: i === 7 ? 'v2' : 'v1', status: 'running' }));
  const state = { project: { id: 'p', title: 'page', members: ['a'] }, test_origin: 'https://test.invalid', versions: [], hypotheses: [], links: [{ id: 'l1', experiment_id: 'e1', channel: null, state: 'live', expires_at: now + 3_600_000, share_url: 'https://test.invalid/l/l1/' }], experiments: exps };
  const reads = [], waiting = [];
  let mode = 'gate';
  const fetchImpl = async (url, init) => {
    const m = new URL(url).pathname.match(/\/experiments\/([^/]+)\/evidence$/);
    if (!m) return new Response(JSON.stringify(state), { status: 200 });
    reads.push(m[1]);
    const answer = () => new Response(JSON.stringify({ evidence: { sessions: [{ session_id: `ps_${m[1]}`, at: now - DAY_MS, pseudonym: 'pp_SECRET', product_version: null, tasks: done, pages: 1, clicks: 1, inputs: 9 }] } }), { status: 200 });
    if (mode === 'fail' && m[1] === 'e2') return new Response('{}', { status: 503 });
    if (mode === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    if (mode === 'gate') return new Promise((resolve) => waiting.push(() => resolve(answer())));
    return answer();
  };
  let t = now, changed = 0;
  const changes = () => new Promise((r) => { const at = changed; const tick = () => (changed > at ? r() : setTimeout(tick, 5)); tick(); });
  const session = new PublishSession({ switchOn: () => true, token: async () => 'tok', scopeKey: () => 's', base: () => 'https://api.test/v1/curriculum', root: () => null, entry: () => null, events: async () => [], projectId: () => 'p', setProjectId: async () => {}, week: () => 1, defaultTitle: () => 'page', qr: (u) => u, now: () => t, fetchImpl, statsChanged: () => { changed++; } });

  // A read that has not answered never holds back the sharing state.
  let next = changes();
  let view = await session.view();
  assert.equal(view.experiments.find((e) => e.id === 'e1').links[0].state, 'live', 'the sharing state is drawn at once');
  assert.deepEqual([view.stats.v1.state, view.stats.v2.state], ['loading', 'loading']);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(reads.length, 6, 'the six reads start together (in parallel), capped at six');
  assert.equal(waiting.length, 6);
  for (const w of waiting.splice(0)) w();
  await next;
  next = changes();
  view = await session.view();
  assert.equal(view.stats.v1.state, 'ok'); assert.equal(view.stats.v1.opened.last, 6);
  assert.equal(view.stats.v2.state, 'loading', 'the seventh experiment is read only now');
  await new Promise((r) => setTimeout(r, 20)); for (const w of waiting.splice(0)) w(); await next;
  view = await session.view();
  assert.equal(view.stats.v2.state, 'ok');
  assert.equal(reads.length, 7, 'fresh reads are reused');

  // The cache itself holds no visitor pseudonym (not only the view).
  const cache = session.statsCacheJson();
  assert.ok(cache.includes('ps_e1') && cache.includes('ps_e7'), 'the cache is populated');
  assert.ok(!cache.includes('pp_SECRET') && !cache.includes('pseudonym') && !cache.includes('inputs'), 'no pseudonym or other participant field is kept: ' + cache.slice(0, 200));
  assert.ok(!JSON.stringify(view.stats).includes('pp_SECRET'));

  // A failed read says unknown (never 0) until it is retried.
  t += 61_000; mode = 'fail'; next = changes();
  view = await session.view(); await next;
  view = await session.view();
  assert.equal(view.stats.v1.state, 'unknown', 'a failed read makes its version unknown');

  // That view started the seventh experiment's read (it is not capped out any more); let it settle first.
  await new Promise((r) => setTimeout(r, 50));
  // A read that never answers is cut off by the timeout; the panel kept drawing meanwhile.
  t += 61_000; mode = 'hang'; next = changes();
  const started = Date.now();
  view = await session.view();
  assert.ok(Date.now() - started < 1000, 'the view did not wait for the hanging read');
  assert.equal(view.stats.v1.state, 'loading');
  await next;
  assert.ok(Date.now() - started < 8000, 'the hanging read was cut off by the timeout');
  view = await session.view();
  assert.equal(view.stats.v1.state, 'unknown');
});
