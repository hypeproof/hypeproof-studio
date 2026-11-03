// CGP-DS-R-006 (REQ-CGP-DS-05) — Chalk's status words are named-intent chips: a 16px icon, Korean words
// and one of Studio's five intents (info / caution / danger / success / neutral). Covers the board chip
// (board-status.ts), and on /manage the seat attention tag, the wrap-up step badge and the evidence
// source state, by running the shipped manage.html script (after the board-status injection) in a VM
// and drawing each one. The colour and edge per intent are test/board-status-css.test.mjs.
//
// SOURCE=<path> runs the same checks against another copy of manage.html (mutation runs).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { document as doc } from '../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';
import { boardStatusScript, renderBoardStatusPage } from '../src/lib/board-status.ts';

const proto = Object.getPrototypeOf(doc.createElement('div'));
proto.replaceChildren ??= function (...children) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...children); };
const HANGUL = /[가-힣]/;
const INTENTS = ['info', 'caution', 'danger', 'success', 'neutral'];
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`); };
const ui = Function(boardStatusScript + ';return boardStatus;')();

/** What a grayscale capture of one chip shows: the icon's drawn paths and the words. */
const look = (chip) => {
  assert.ok(/\bcgp-state\b/.test(chip.className), 'a cgp-state chip: ' + chip.className);
  const svg = chip.children[0];
  assert.equal(svg.tagName.toLowerCase(), 'svg', 'the icon comes first');
  for (const [k, v] of [['width', '16'], ['height', '16'], ['stroke', 'currentColor'], ['aria-hidden', 'true']]) assert.equal(svg.getAttribute(k), v, 'icon ' + k);
  const shape = svg.children.map((p) => p.getAttribute('d')).join('|');
  assert.ok(shape.length > 5, 'the icon draws something');
  const label = chip.children[1];
  assert.equal(label.className, 'cgp-state-label');
  assert.equal(chip.textContent, label.textContent, 'the words are the only text: no glyph rides along');
  assert.match(label.textContent, HANGUL, 'Korean words: ' + label.textContent);
  assert.ok(INTENTS.includes(chip.getAttribute('data-intent')), 'named intent: ' + chip.getAttribute('data-intent'));
  return { intent: chip.getAttribute('data-intent'), icon: svg.getAttribute('data-icon'), shape, words: label.textContent };
};
const distinct = (family, looks) => {
  assert.equal(new Set(looks.map((l) => l.shape)).size, looks.length, family + ': two states draw the same icon');
  assert.equal(new Set(looks.map((l) => l.words)).size, looks.length, family + ': two states read the same');
};

t('board chip: every state carries its named intent', () => {
  assert.deepEqual([...ui.intents].sort(), [...INTENTS].sort());
  const want = { working: 'info', blocked: 'danger', review: 'caution', idle: 'info', done: 'success', unknown: 'neutral' };
  const looks = Object.keys(ui.states).map((k) => { const l = look(ui.chip(k)); assert.equal(l.intent, want[k], k); return l; });
  distinct('board', looks);
  for (const odd of ['constructor', '__proto__', '<b>']) assert.equal(ui.chip(odd).getAttribute('data-intent'), 'neutral', odd);
});

t('intentChip: unknown intent reads neutral, unknown icon draws help, words stay text', () => {
  for (const odd of ['', 'ok', 'DANGER', 'constructor', '__proto__', undefined]) assert.equal(ui.intentChip(odd, 'check', '정상').getAttribute('data-intent'), 'neutral', String(odd));
  for (const odd of ['', 'toString', '__proto__', '<svg>']) assert.equal(ui.intentChip('info', odd, '정상').children[0].getAttribute('data-icon'), 'help', String(odd));
  const hostile = ui.intentChip('info', 'check', '<img src=x onerror=alert(1)>확인');
  assert.equal(hostile.children[1].textContent, '<img src=x onerror=alert(1)>확인');
  assert.equal(hostile.children[1].children.length, 0, 'words are never parsed as markup');
  assert.equal(ui.intentChip('success', 'check', '완료', 'wrap-badge').className, 'cgp-state wrap-badge');
});

// ─── /manage, run as shipped ─────────────────────────────────────────────────────────────────────
const source = process.env.SOURCE ?? new URL('../src/ui/manage.html', import.meta.url);
const html = renderBoardStatusPage(readFileSync(source, 'utf8'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
const byId = (id) => { if (!nodes.has(id)) nodes.set(id, doc.createElement('div')); return nodes.get(id); };
const stub = { getItem() { return null; }, setItem() {}, removeItem() {} };
const media = () => ({ matches: false, addEventListener() {} });
const ctx = vm.createContext({
  document: { getElementById: byId, createElement: doc.createElement.bind(doc), createElementNS: doc.createElementNS.bind(doc), createTextNode: doc.createTextNode.bind(doc), activeElement: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: doc.createElement('body'), documentElement: doc.createElement('html') },
  window: { addEventListener() {}, matchMedia: media }, location: { hash: '', search: '', pathname: '/manage' }, history: { replaceState() {} },
  sessionStorage: stub, localStorage: stub, URLSearchParams, URL, console, Intl, Date, Math, JSON, crypto: globalThis.crypto,
  setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {}, matchMedia: media, navigator: { clipboard: {} },
  fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  MutationObserver: class { observe() {} disconnect() {} },
});
vm.runInContext(script, ctx);
const run = (code) => vm.runInContext(code, ctx);
const all = (node, cls) => { const out = []; const walk = (n) => { for (const c of n.children ?? []) { if (String(c.className ?? '').split(' ').includes(cls)) out.push(c); walk(c); } }; walk(node); return out; };

t('/manage seat tag: each attention word is a chip of its intent (blocked danger, help caution, ok success, ...)', () => {
  const seat = (id, extra) => ({ seat_id: id, student_id: 'st-' + id, attention: 'ok', signal: 'fresh', ...extra });
  const seats = [seat('s1', { attention: 'blocked' }), seat('s2', { attention: 'caution' }), seat('s3', { attention: 'unknown' }), seat('s4', { runtime: { status: 'running' } }), seat('s5', { runtime: { status: 'waiting_approval' } })];
  run('renderSeats')({ seats });
  const tags = all(byId('ops-rows'), 'tag');
  assert.equal(tags.length, seats.length, 'one tag per seat');
  const want = { blocked: ['danger', 'close', '차단됨'], caution: ['caution', 'alert', '주의'], unknown: ['neutral', 'help', '확인 불가'], ok: ['success', 'check', '정상'], approval: ['caution', 'pause', '승인 대기'] };
  const looks = tags.map((tag) => {
    const cls = tag.className.split(' ').at(-1), l = look(tag);
    assert.deepEqual([l.intent, l.icon, l.words], want[cls], 'seat tag ' + cls);
    return l;
  });
  distinct("seat tag", looks);
  assert.deepEqual(tags.map((x) => x.className.split(' ').at(-1)), ['blocked', 'caution', 'unknown', 'ok', 'approval'], 'the fixtures reach five tag classes');
  // The help row needs a live help list: the table, drawn through intentChip, covers all six classes.
  const table = run('tagLook');
  assert.deepEqual(Object.keys(table).sort(), ['approval', 'blocked', 'caution', 'help', 'ok', 'unknown']);
  const words = { blocked: '차단됨', caution: '주의', unknown: '확인 불가', help: '도움 요청', approval: '승인 대기', ok: '정상' };
  distinct('seat tag (all six)', Object.entries(table).map(([k, [intent, icon]]) => look(ui.intentChip(intent, icon, words[k]))));
  assert.equal(table.help[0], 'caution', 'a help request asks the instructor to act');
  assert.equal(table.approval[0], 'caution', 'a seat waiting on approval waits on a person (as in Studio)');
});

t('/manage wrap-up: each step badge is a chip of its intent, with no glyph inside the words', () => {
  const states = ['idle', 'pending', 'partial', 'blocked', 'unknown', 'done', 'none', 'off'];
  run('opsData={run:{flags:{}}}');
  run(`wrapSteps=()=>${JSON.stringify(states.map((s) => ['단계 ' + s, s, '설명', null]))}`);
  run('renderWrap()');
  const badges = all(byId('ops-wrap-steps'), 'wrap-badge');
  assert.equal(badges.length, states.length);
  const want = { idle: 'neutral', pending: 'info', partial: 'caution', blocked: 'danger', unknown: 'neutral', done: 'success', none: 'neutral', off: 'neutral' };
  const looks = badges.map((b, i) => {
    const l = look(b);
    assert.equal(l.intent, want[states[i]], 'wrap ' + states[i]);
    assert.doesNotMatch(l.words, /[○…◐!?✓–]/, 'wrap ' + states[i] + ': the glyph moved into the icon');
    return l;
  });
  distinct('wrap-up', looks);
});

t('/manage evidence: the source state is a chip of the source_state intent; unknown reads 미확인', () => {
  const states = ['real', 'simulated', 'self_reported', 'unverified', 'constructor', undefined];
  const latest = states.map((source_state, i) => ({ id: 'e' + i, source_state, evidence_type: 'action', actor: 'student', observed_at: 0, changed: null, review_state: 'unreviewed' }));
  run('opsData={actions:[]}');
  byId('ops-evidence').replaceChildren();
  run('renderEvidence')({ evidence: { latest } });
  const chips = all(byId('ops-evidence'), 'ev-source');
  assert.equal(chips.length, states.length);
  const want = [['success', 'check', '실제'], ['caution', 'flask', '가상(시뮬레이션)'], ['info', 'pencil', '학생 자기보고'], ['neutral', 'help', '미확인'], ['neutral', 'help', '미확인'], ['neutral', 'help', '미확인']];
  const looks = chips.map((c, i) => { const l = look(c); assert.deepEqual([l.intent, l.icon, l.words], want[i], 'source ' + String(states[i])); return l; });
  distinct('source state', looks.slice(0, 4));
});

console.log(`chalk status-intents: ${passed} passed`);
