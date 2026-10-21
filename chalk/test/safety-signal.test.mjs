// DES-CGP-LEARN-13 / REQ-CGP-LEARN-13 — the instructor safety item on /manage.
// Runs the factory exactly as the route ships it, then the shipped /manage page script in a VM
// with a status fixture: a self-harm seat is pinned above the seat list with icon + "안전 확인 필요",
// never in the status chips, the summary counts or the seat row, never with matched text, and it
// stays until the instructor acknowledges it (a failed poll does not drop it).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {document as doc} from '../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';
import {renderBoardStatusPage} from '../src/lib/board-status.ts';
import {renderSafetySignal, safetySignalScript} from '../src/lib/safety-signal.ts';

const proto = Object.getPrototypeOf(doc.createElement('div'));
proto.replaceChildren = function (...children) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...children); };
let passed = 0;
const ok = (label) => { passed++; console.log('  ok   ' + label); };

// ─── factory ────────────────────────────────────────────────────────────────────────────────────
const ui = Function(safetySignalScript + ';return safetySignal;')();
assert.equal(ui.LABEL, '안전 확인 필요');
const now = Date.UTC(2026, 9, 21, 5, 0, 0);
const seat = (id, extra = {}) => ({seat_id: id, student_id: 'kid-' + id, seat_revision: 1, signal: 'fresh', attention: 'ok', reason: null, connection: {}, token: {}, evidence: {}, ...extra});
{
  const got = ui.items([
    seat('S01'),
    seat('S02', {safety: {category: 'self_harm', at: now}}),
    seat('S03', {safety: {category: 'sexual_content', at: now}}),
    seat('S04', {safety: {category: 'toString', at: now}}),
    seat('S05', {safety: {category: 'self_harm', at: 'soon'}}),
    seat('S06', {safety: {category: 'self_harm', at: -1}}),
    seat('<img>', {safety: {category: 'self_harm', at: now}}),
    seat('S08', {safety: {category: 'self_harm', at: Math.floor(now / 1000)}}),
    seat('S10', {safety: {category: 'self_harm', at: 1e300}}),
    seat('S11', {safety: {category: 'self_harm', at: Infinity}}),
    null, 'S09',
  ]);
  assert.deepEqual(got.map((x) => x.seat_id), ['S02', 'S08']);
  assert.equal(got[1].at, Math.floor(now / 1000) * 1000, 'epoch seconds are read as seconds');
  assert.deepEqual(ui.items(undefined), []);
  ui.reset();
  const many = Array.from({length: 60}, (_, i) => seat('M' + i, {safety: {category: 'self_harm', at: now + i}}));
  const shown = ui.update('run-x', many);
  assert.equal(shown.length, 50, 'at most 50 pinned items');
  assert.equal(shown[0].seat_id, 'M59', 'newest first');
  ui.reset();
  ok('only self_harm with a valid seat id and time becomes an item (10 negative controls); newest 50 at most');
}
{
  ui.reset();
  assert.equal(ui.update('run-1', [seat('S02', {safety: {category: 'self_harm', at: now}})]).length, 1);
  assert.equal(ui.update('run-1', [seat('S02')]).length, 1, 'a later poll without the field keeps the item');
  ui.ack('S02|' + now);
  assert.equal(ui.update('run-1', [seat('S02', {safety: {category: 'self_harm', at: now}})]).length, 0, 'acknowledged block does not re-pin');
  assert.equal(ui.update('run-1', [seat('S02', {safety: {category: 'self_harm', at: now + 5000}})]).length, 1, 'a newer block pins again');
  assert.equal(ui.update('run-2', []).length, 0, 'another class run starts empty');
  ok('pinned until acknowledged; newer block re-pins; a new run clears');
}

// ─── shipped /manage page ───────────────────────────────────────────────────────────────────────
const html = renderSafetySignal(renderBoardStatusPage(readFileSync(new URL('../src/ui/manage.html', import.meta.url), 'utf8')));
assert.ok(!html.includes('// SAFETY_SIGNAL_SCRIPT') && !html.includes('/* SAFETY_SIGNAL_CSS */'), 'placeholders replaced');
{
  const at = (id) => html.indexOf('id="' + id + '"');
  assert.ok(at('ops-safety') > 0 && at('ops-safety') < at('ops-help') && at('ops-safety') < at('ops-seats') && at('ops-safety') < at('ops-table'), 'region sits above help and the seat list');
  assert.ok(html.indexOf('class="safety-pin" role="region"') > 0, 'region landmark');
  ok('the safety region is placed above the help region and the seat list');
}
const nodes = new Map();
const el = (id) => { if (!nodes.has(id)) { const e = doc.createElement(id === 'ops-safety-list' ? 'ul' : 'div'); e.setAttribute('id', id); nodes.set(id, e); } return nodes.get(id); };
const pageDoc = new Proxy(doc, {get(t, k) {
  if (k === 'getElementById') return el;
  if (k === 'querySelector') return () => doc.createElement('div');
  if (k === 'querySelectorAll') return () => [];
  const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
}});
const ctx = vm.createContext({
  document: pageDoc, window: {addEventListener() {}}, addEventListener() {}, location: {hash: '', search: '', pathname: '/manage'},
  history: {replaceState() {}}, sessionStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
  localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}}, matchMedia: () => ({matches: false, addEventListener() {}}),
  URLSearchParams, URL, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, console,
  fetch: () => new Promise(() => {}), navigator: {}, crypto: globalThis.crypto, AbortController, Intl, Date,
  MutationObserver: class { observe() {} disconnect() {} },
});
for (const [, src] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  // Page set-up that needs a real browser (listeners on elements this fake DOM leaves bare) may stop
  // partway; the functions under test are declarations and exist either way.
  try { vm.runInContext(src, ctx); } catch { /* see above */ }
}
const status = (seats) => ({run: {class_run_id: 'run-1', flags: {}}, counts: {total: seats.length, runtime_ready: seats.length}, incidents: [], seats, now});
const run = (code, data) => { ctx.d = data; return vm.runInContext(code, ctx); };
const region = el('ops-safety'), list = el('ops-safety-list');
const items = () => list.childNodes.filter((n) => n.nodeType === 1);
{
  run('renderOps(d)', status([seat('S01'), seat('S02', {safety: {category: 'self_harm', at: now, text: '자살하는 방법'}}), seat('S03', {safety: {category: 'pii_solicitation', at: now}})]));
  assert.equal(region.hidden, false, 'region shown');
  assert.equal(items().length, 1, 'one pinned item');
  const li = items()[0];
  assert.equal(li.getAttribute('data-seat'), 'S02');
  const flag = li.childNodes[0];
  assert.equal(flag.className, 'safety-flag');
  assert.equal(flag.childNodes[0].getAttribute('aria-hidden'), 'true');
  assert.equal(flag.childNodes[0].textContent, '⚠', 'icon');
  assert.equal(flag.textContent, '⚠ 안전 확인 필요', 'icon + text label');
  assert.match(li.textContent, /S02 · kid-S02 — 자해·자살 관련 입력이 차단됨 · \d{2}:\d{2}:\d{2}/, 'seat, category, time');
  assert.ok(!li.textContent.includes('방법'), 'matched text is never shown');
  ok('a self-harm seat is pinned with icon + "안전 확인 필요", seat, category and time — no matched text');
}
{
  const outside = ['ops-summary', 'ops-rows', 'ops-state-filters', 'ops-incidents', 'ops-help-list'].map((id) => el(id).textContent).join('\n');
  assert.ok(!outside.includes('안전'), 'not in the summary, filters, seat rows, incidents or help list');
  const filters = vm.runInContext('boardStatus.ops(d.seats[1])', ctx);
  assert.equal(filters, vm.runInContext('boardStatus.ops(d.seats[0])', ctx), 'the status chip ignores the safety field');
  ok('never in a ranking, count, filter or status column');
}
{
  const buttons = items()[0].childNodes.filter((n) => n.localName === 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['좌석 상세', '확인했어요']);
  assert.equal(buttons[1].getAttribute('aria-label'), 'S02 안전 확인 완료');
  try { buttons[0].onclick(); } catch { /* the detail pane needs more DOM than this fake; the selection is set first */ }
  assert.equal(vm.runInContext('opsSeat', ctx), 'S02', '좌석 상세 opens that seat');
  vm.runInContext('opsSeat = null', ctx); // the fake DOM cannot draw the detail pane on the next poll
  run('opsBlank("운영 현황 조회 실패")', null);
  assert.equal(items().length, 1, 'a failed poll keeps the pinned item');
  run('renderOps(d)', status([seat('S02', {safety: {category: 'self_harm', at: now}})]));
  items()[0].childNodes.filter((n) => n.localName === 'button')[1].onclick();
  assert.equal(items().length, 0); assert.equal(region.hidden, true, 'acknowledged → region hidden');
  run('renderOps(d)', status([seat('S02', {safety: {category: 'self_harm', at: now}})]));
  assert.equal(items().length, 0, 'the same block does not come back on the next poll');
  run('renderOps(d)', status([seat('S02', {safety: {category: 'self_harm', at: now + 60000}})]));
  assert.equal(items().length, 1, 'a newer block pins again');
  // reset() goes on to clear page parts this fake DOM does not model; the safety lines run first.
  try { run('reset()', null); } catch { /* later page clean-up */ }
  assert.equal(items().length, 0); assert.equal(region.hidden, true, 'disconnect clears');
  ok('kept through a failed poll, removed by 확인했어요, re-pinned by a newer block, cleared on disconnect');
}
console.log(`PASS safety-signal: ${passed} checks`);
