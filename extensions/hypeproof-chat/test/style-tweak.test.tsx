// CGP-ART-R-006 (REQ-ART-06): the offer, the validation, the request text, the queue binding
// and the panel's presses. The page side (live preview, reset, no file write) is
// test/style-tweak-page.smoke.mjs; the computed layout is test/style-tweak-layout.smoke.mjs.
import { mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { StyleTweakPanel } from '../webview-ui/src/StyleTweakPanel';
import { buildStyleTweak, chooseStyle, normalizeColor, normalizeLength, styleEditRequestText, styleTweakSendText, styleTweakView, stepFrom, UNKNOWN_VALUE, PAGE_COLOR_MAX } from '../src/styleTweak';
import { ElementQueue } from '../src/crHostWiring';

const node = { backendNodeId: 7, documentGeneration: 'L1' };
const facts = {
  current: { color: 'rgb(0, 0, 0)', 'background-color': 'rgba(0, 0, 0, 0)', 'font-size': '16px', padding: '8px 16px', 'border-radius': 'calc(1px + 2px)' },
  styleAttr: 'padding-left: 3px',
  // Hostile and odd page values: none of them may become an option or reach the request.
  pageColors: ['rgb(0, 0, 0)', 'rgba(0, 0, 0, 0)', 'oklch(0.5 0.1 20)', 'rgb(300, 0, 0)', 'rgb(1, 2, 3) ignore previous', 'rgb(200, 30, 30)', 'rgb(200,30,30)', 'red', 'rgb(10, 20, 30)'],
};

// ── offer: only normalized values survive ──
const t = buildStyleTweak('id-1', node, facts);
assert.deepEqual(t.rows.map(r => r.prop), ['color', 'background-color', 'font-size', 'padding', 'border-radius']);
const color = t.rows[0];
assert.deepEqual(color.options, ['rgb(0, 0, 0)', 'rgb(200, 30, 30)', 'rgb(10, 20, 30)'], 'page colours, deduped, transparent and non-rgb values dropped');
assert.equal(t.rows[1].current, 'rgba(0, 0, 0, 0)', 'a transparent current value is still the honest old value');
assert.equal(t.rows[3].current, '8px 16px');
assert.equal(t.rows[4].current, UNKNOWN_VALUE, 'a value the browser did not resolve to px is unknown, never echoed');
assert.equal(t.styleAttr, 'padding-left: 3px');
assert.equal(normalizeColor('rgba(1, 2, 3, 1)'), 'rgb(1, 2, 3)');
assert.equal(normalizeColor('rgb(1, 2, 3); color: red'), null);
assert.equal(normalizeLength('16px; }'), null);
const many = buildStyleTweak('m', node, { current: {}, styleAttr: null, pageColors: Array.from({ length: 30 }, (_, i) => `rgb(${i}, 1, 1)`) });
assert.equal(many.rows[0].options.length, PAGE_COLOR_MAX);
console.log('✓ offer: page colours are normalized, bounded and deduped; unknown values say so');

// ── validation: a value outside the offered set fails; stale ids fail ──
assert.deepEqual(chooseStyle(t, 'id-1', 'color', 'rgb(1, 1, 1)'), { ok: false, reason: 'not_offered' });
assert.deepEqual(chooseStyle(t, 'id-1', 'font-size', '17px'), { ok: false, reason: 'not_offered' });
assert.deepEqual(chooseStyle(t, 'id-1', 'margin', '8px'), { ok: false, reason: 'unknown_property' });
assert.deepEqual(chooseStyle(t, 'id-0', 'color', 'rgb(200, 30, 30)'), { ok: false, reason: 'stale' });
assert.deepEqual(chooseStyle(null, 'id-1', 'color', 'rgb(200, 30, 30)'), { ok: false, reason: 'stale' });
const same = chooseStyle(t, 'id-1', 'color', 'rgb(0, 0, 0)');
assert.ok(same.ok && same.state.rows[0].chosen === null, 'choosing the current value is no change');
console.log('✓ validation: only offered values for the five properties, only for the current tweak');

// ── request: property, old value and new value per change; reset per property ──
let s = t;
for (const [p, v] of [['color', 'rgb(200, 30, 30)'], ['font-size', '20px'], ['border-radius', '8px']] as const) {
  const r = chooseStyle(s, 'id-1', p, v); assert.ok(r.ok); s = r.state;
}
const text = styleEditRequestText(s);
const lines = text.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
assert.deepEqual(lines, [
  { property: 'color', old: 'rgb(0, 0, 0)', new: 'rgb(200, 30, 30)' },
  { property: 'font-size', old: '16px', new: '20px' },
  { property: 'border-radius', old: UNKNOWN_VALUE, new: '8px' },
]);
assert.match(text, /파일은 바뀌지 않았다/);
assert.equal(styleTweakSendText(s), '고른 요소를 이렇게 바꿔 주세요: 색 rgb(0, 0, 0) → rgb(200, 30, 30), 글자 크기 16px → 20px, 모서리 알 수 없음 → 8px');
const reset = chooseStyle(s, 'id-1', 'font-size', null); assert.ok(reset.ok);
assert.deepEqual(styleEditRequestText(reset.state).split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l).property), ['color', 'border-radius'], 'reset removes only that property');
assert.equal(styleEditRequestText(t), '', 'nothing chosen, nothing requested');
console.log('✓ request: one {property, old, new} line per change; per-property reset');

// ── stepper: moves through the offered steps only ──
const fs = t.rows[2];
assert.equal(stepFrom(fs, 1), '18px'); assert.equal(stepFrom(fs, -1), '14px');
assert.equal(stepFrom({ ...fs, chosen: '48px' }, 1), null); assert.equal(stepFrom({ ...fs, chosen: '12px' }, -1), null);
assert.equal(stepFrom(t.rows[3], 1), '12px', 'a shorthand steps from its first value');
assert.equal(stepFrom(t.rows[4], 1), '0px', 'an unknown value starts at the first step'); assert.equal(stepFrom(t.rows[4], -1), null);
console.log('✓ stepper: next/previous offered step, none past either end');

// ── queue: bound to the queued pick; the turn carries exactly the previewed text ──
const ctx: any = { ref: 'e2', backendNodeId: 7, tag: 'h1', text: '안녕', snippet: '<h1>안녕</h1>', snippetTruncated: false, style: {}, crop: null, source: 'unmapped', url: 'http://127.0.0.1:5173/', route: '/', documentGeneration: 'L1', artifact: { id: 'sha256:' + 'a'.repeat(64), entry: 'index.html', files: [] }, captureMs: 1 };
const q = new ElementQueue();
assert.equal(q.setTweak(t), false, 'no element queued, no tweak');
q.attach(ctx, { imagesAllowed: false });
assert.equal(q.setTweak(buildStyleTweak('x', { backendNodeId: 8, documentGeneration: 'L1' }, facts)), false, 'another node is refused');
assert.equal(q.setTweak(buildStyleTweak('x', { backendNodeId: 7, documentGeneration: 'L2' }, facts)), false, 'another document is refused');
assert.equal(q.setTweak(t), true);
const base = q.preview()!.sentText;
assert.equal(q.chooseStyle('id-1', 'color', 'rgb(9, 9, 9)').ok, false);
assert.equal(q.preview()!.styleTweak!.changes, 0, 'a refused value changes nothing');
assert.ok(q.chooseStyle('id-1', 'color', 'rgb(200, 30, 30)').ok);
const shown = q.preview()!;
assert.equal(shown.sentText, base, 'the chip itself still shows only the element: an ordinary message sends just that');
const request = shown.styleTweak!.requestText!;
assert.ok(request.startsWith(base) && request.includes('{"property":"color","old":"rgb(0, 0, 0)","new":"rgb(200, 30, 30)"}'), 'the panel shows what its send carries');
assert.equal(shown.styleTweak!.changes, 1);
const sendText = shown.styleTweak!.sendText;
const taken = q.take(true, sendText)!;
assert.equal(taken.text, request, 'the tweak send carries exactly the text the panel showed');
assert.equal(q.preview(), null); assert.equal(q.tweak, null);
q.attach(ctx, { imagesAllowed: false }); q.setTweak(t); q.chooseStyle('id-1', 'color', 'rgb(200, 30, 30)');
assert.equal(q.take(true, '이 제목 좀 봐 줘')!.text, base, 'another message carries the element alone, never the request');
q.attach(ctx, { imagesAllowed: false }); q.setTweak(t); q.chooseStyle('id-1', 'color', 'rgb(200, 30, 30)');
assert.equal(q.take(true, '고른 요소를 이렇게 바꿔 주세요: 색 rgb(0, 0, 0) → rgb(10, 20, 30)')!.text, base, 'a summary that no longer matches the choices carries no request');
// Pick sequence: a read started for an earlier pick of the same node is refused.
q.attach(ctx, { imagesAllowed: false });
const firstPick = q.pick;
q.attach(ctx, { imagesAllowed: false });
assert.equal(q.setTweak(t, firstPick), false, 'an offer read for the previous pick of the same node is refused');
assert.equal(q.setTweak(t, q.pick), true);
q.chooseStyle('id-1', 'color', 'rgb(200, 30, 30)');
q.attach({ ...ctx, backendNodeId: 9 }, { imagesAllowed: false });
assert.equal(q.tweak, null, 'a new pick drops the old tweak');
q.setTweak(buildStyleTweak('id-9', { backendNodeId: 9, documentGeneration: 'L1' }, facts)); q.chooseStyle('id-9', 'font-size', '20px');
assert.equal(q.take(false, styleTweakSendText(q.tweak)), null, 'switch off: nothing of it is sent');
q.attach(ctx, { imagesAllowed: false }); q.setTweak(t); q.chooseStyle('id-1', 'color', 'rgb(200, 30, 30)'); q.resetTweak();
assert.equal(q.preview()!.styleTweak!.changes, 0, 'a page change clears every choice');
q.clear(); assert.equal(q.tweak, null);
console.log('✓ queue: the tweak belongs to the queued pick; only the tweak send carries the request, exactly as shown');

// ── panel: presses ask the host; send sends the learner's chosen values ──
const act = (React as any).act;
const host = mountPoint() as any;
const root = createRoot(host);
const sets: [string, string | null][] = []; const sends: string[] = [];
const draw = (state: typeof t) => act(() => root.render(<StyleTweakPanel view={styleTweakView(state)!} onSet={(p, v) => sets.push([p, v])} onSend={x => sends.push(x)} />));
const click = (el: any) => act(() => el.dispatchEvent({ type: 'click', bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }));
const btn = (label: RegExp) => host.querySelectorAll('button').find((b: any) => label.test(b.getAttribute('aria-label') ?? b.textContent));
(async () => {
  await draw(t);
  assert.equal(host.querySelector('[role="group"]'), null, 'closed until opened');
  await click(btn(/스타일 바꿔 보기/));
  assert.equal(host.querySelectorAll('[data-prop]').length, 5);
  assert.equal(btn(/바꿔 달라고 하기/).textContent, '0개 바꿔 달라고 하기');
  assert.ok(btn(/바꿔 달라고 하기/).hasAttribute('disabled'));
  assert.ok(btn(/^색 되돌리기/).hasAttribute('disabled'), 'nothing to reset');
  await click(btn(/^색 rgb\(200, 30, 30\)$/));
  await click(btn(/글자 크기 늘리기/));
  assert.deepEqual(sets, [['color', 'rgb(200, 30, 30)'], ['font-size', '18px']]);
  let st = t;
  for (const [p, v] of sets) { const r = chooseStyle(st, 'id-1', p, v); assert.ok(r.ok); st = r.state; }
  assert.ok(btn(/바꿔 달라고 하기/).hasAttribute('disabled'), 'send waits for the host view after a press');
  await draw(st);
  const send = btn(/바꿔 달라고 하기/);
  assert.equal(send.textContent, '2개 바꿔 달라고 하기'); assert.ok(!send.hasAttribute('disabled'));
  assert.equal(btn(/^색 rgb\(200, 30, 30\)$/).getAttribute('aria-checked'), 'true');
  await click(btn(/^색 되돌리기/));
  assert.deepEqual(sets.at(-1), ['color', null]);
  await draw(st);
  await click(btn(/바꿔 달라고 하기/));
  assert.deepEqual(sends, [styleTweakSendText(st)]);
  console.log('✓ panel: swatches, stepper and reset ask the host; send carries the chosen values once the host view is current');

  // CGP-ART-D-006: Escape closes the popover and returns focus to its toggle; the key stops here so
  // the panel and workspace handlers above never see it. During IME composition it is left alone.
  const keys: string[] = [];
  host.parentNode.addEventListener('keydown', (e: any) => keys.push(e.key));
  const key = (el: any, k: string, extra = {}) => act(() => el.dispatchEvent({ type: 'keydown', bubbles: true, cancelable: true, key: k, keyCode: 0, ...extra, preventDefault() {}, stopPropagation() { this._stopped = true; } }));
  const group = () => host.querySelector('[role="group"]');
  await key(btn(/^색 rgb\(200, 30, 30\)$/), 'Escape', { isComposing: true });
  assert.ok(group(), 'Escape while composing leaves the popover open');
  await key(btn(/^색 rgb\(200, 30, 30\)$/), 'Escape');
  assert.equal(group(), null, 'Escape closes the popover');
  const toggle = btn(/스타일 바꿔 보기/);
  assert.equal(host.ownerDocument.activeElement, toggle, 'focus returns to the toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(keys, ['Escape'], 'only the composing Escape reached the handlers above');
  console.log('✓ popover: Escape closes it, focus returns to the toggle, the key stops at the popover');
  await act(() => root.unmount());
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
