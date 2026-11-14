// CGP-LEARN-R-011 (b) — /manage draws a seat's "자료 신고" (material reports from the Service's classroom-ops status) as
// block identity plus a reason chip, and the 확인함 control goes through the existing review route. It runs the shipped
// manage.html script in a VM, the same way test/status-intents.test.mjs does.
//
// SOURCE=<path> runs the same checks against another copy of manage.html (mutation runs).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { document as doc } from '../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';
import { renderBoardStatusPage } from '../src/lib/board-status.ts';

const proto = Object.getPrototypeOf(doc.createElement('div'));
proto.replaceChildren ??= function (...children) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...children); };
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log(`  ok   ${name}`); };

const source = process.env.SOURCE ?? new URL('../src/ui/manage.html', import.meta.url);
const html = renderBoardStatusPage(readFileSync(source, 'utf8'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
const byId = (id) => { if (!nodes.has(id)) nodes.set(id, doc.createElement('div')); return nodes.get(id); };
const stub = { getItem() { return null; }, setItem() {}, removeItem() {} };
const media = () => ({ matches: false, addEventListener() {} });
const calls = [];
const ctx = vm.createContext({
  document: { getElementById: byId, createElement: doc.createElement.bind(doc), createElementNS: doc.createElementNS.bind(doc), createTextNode: doc.createTextNode.bind(doc), activeElement: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: doc.createElement('body'), documentElement: doc.createElement('html') },
  window: { addEventListener() {}, matchMedia: media }, location: { hash: '', search: '', pathname: '/manage' }, history: { replaceState() {} },
  sessionStorage: stub, localStorage: stub, URLSearchParams, URL, console, Intl, Date, Math, JSON, crypto: globalThis.crypto,
  setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {}, matchMedia: media, navigator: { clipboard: {} },
  fetch: async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' }; },
  MutationObserver: class { observe() {} disconnect() {} },
});
vm.runInContext(script, ctx);
const run = (code) => vm.runInContext(code, ctx);
const all = (node, cls) => { const out = []; const walk = (n) => { for (const c of n.children ?? []) { if (String(c.className ?? '').split(' ').includes(cls)) out.push(c); walk(c); } }; walk(node); return out; };
const texts = (n) => { const out = []; const walk = (x) => { for (const c of x.children ?? []) { if (c.tagName && ['P', 'H3', 'BUTTON'].includes(c.tagName.toUpperCase())) out.push(c.textContent); walk(c); } }; walk(n); return out; };
const report = (over) => ({ ref: 'grant-0001.boot-0001.1', lesson_course: 'web-1', lesson_version: 'm1', step_id: 'build', block_type: 'box_spacing', block_version: 1, params_sha256: null, reason: 'wrong', observed_at: 0, review_state: 'unreviewed', review_revision: 0, ...over });
const coach = '{actions:[{capability:"coach",held:true}]}';
const draw = (s, actions = coach) => { run('opsData=' + actions); byId('ops-evidence').replaceChildren(); run('renderMaterialReports')(s); return byId('ops-evidence'); };

await t('no report: nothing is drawn (no empty "자료 신고" group)', () => {
  for (const s of [{}, { material_reports: { reported: 0, unreviewed: 0, latest: [] } }]) assert.equal(draw(s).children.length, 0);
});
await t('a report reads step, block, version and the Korean reason; unknown reasons never echo the raw value', () => {
  const box = draw({ material_reports: { reported: 4, unreviewed: 4, latest: [report(), report({ ref: 'g.b.2', reason: 'broken', step_id: 'intro', block_type: 'stage_stepper' }), report({ ref: 'g.b.3', reason: 'unclear' }), report({ ref: 'g.b.4', reason: '<b>constructor</b>' })] } });
  const words = texts(box);
  assert.equal(words[0], '자료 신고');
  assert.match(words[1], /학생이 쓴 글은 받지 않습니다/);
  const rows = all(box, 'material-report'); assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => texts(r)[1]), ['이유: 내용이 틀려요', '이유: 열리지 않아요', '이유: 이해하기 어려워요', '이유: 이유 미확인']);
  assert.match(texts(rows[1])[0], /^단계 intro · 자료 stage_stepper · v1 · /);
  assert.ok(!words.join('\n').includes('constructor'), 'an unknown reason is not echoed');
  for (const r of rows) assert.ok(!texts(r).some((x) => /note|transcript/.test(x)));
});
await t('확인함 goes through the existing review route with the report ref and revision; a reviewed report has no button', async () => {
  const box = draw({ material_reports: { reported: 2, unreviewed: 1, latest: [report(), report({ ref: 'g.b.9', review_state: 'confirmed', review_revision: 1 })] } });
  const rows = all(box, 'material-report'), buttons = (r) => (r.children ?? []).filter((c) => c.tagName.toUpperCase() === 'BUTTON');
  assert.deepEqual(buttons(rows[0]).map((b) => b.textContent), ['확인함']); assert.equal(buttons(rows[1]).length, 0);
  assert.equal(texts(rows[1])[2], '강사가 자료를 확인함');
  calls.length = 0; buttons(rows[0])[0].onclick(); await new Promise((r) => setImmediate(r));
  const put = calls.find((c) => c.init?.method === 'PUT');
  assert.ok(put, 'a PUT was sent'); assert.match(put.url, /\/classroom\/runs\/[^/]*\/evidence\/grant-0001\.boot-0001\.1$/);
  assert.deepEqual(JSON.parse(put.init.body), { state: 'confirmed', expected_revision: 0 });
});
await t('an instructor connection without the coach capability sees the reports but no control', () => {
  const box = draw({ material_reports: { reported: 1, unreviewed: 1, latest: [report()] } }, '{actions:[]}');
  assert.equal(all(box, 'material-report')[0].children.filter((c) => c.tagName.toUpperCase() === 'BUTTON').length, 0);
  assert.match(texts(box).at(-1), /권한\(학습 지원\)이 없습니다/);
});
console.log(`chalk material-report: ${passed} passed`);
