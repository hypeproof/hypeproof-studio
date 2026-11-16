// CGP-LEARN-R-006 (box_spacing) / CGP-LEARN-R-005 (stage_stepper) — the learner side's copy of the v1 specs, its
// re-validation of served params, the caption and the style object. Pure; Node only.
//
// Spec parity: test/fixtures/step-ui-catalog-published.json is the Service's published snapshot (hypeproof-service
// worker/test/fixtures/step-ui-catalog-published.json), vendored byte-for-byte and pinned by sha256 below. BLOCK_SPECS must
// equal its box_spacing and stage_stepper entries. When a hypeproof-service checkout is at hand (HYPEPROOF_SERVICE_DIR), the
// vendored file is also compared with the Service's own file; otherwise that live check prints NOT RUN. Do not read NOT RUN as a pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as B from '../src/blockParams.ts';
import * as F from '../src/lessonFocus.ts';

let n = 0;
const ok = (label) => { n++; console.log(`  ok   ${label}`); };
const FIXTURE_URL = new URL('./fixtures/step-ui-catalog-published.json', import.meta.url);
// The vendored snapshot as of hypeproof-service#541 (0f1797945): box_spacing v1 (#509), stage_stepper v1 (#510) and
// narrated_diagram v1 (#541).
const FIXTURE_SHA256 = '8aff3c48192544eae00ed1fbc8154246bcba55b649ef789bcb0b693887a40b7a';
const bytes = readFileSync(FIXTURE_URL);
assert.equal(createHash('sha256').update(bytes).digest('hex'), FIXTURE_SHA256, 'the vendored Service snapshot changed: re-vendor it byte-for-byte and update the pin');
const snapshot = JSON.parse(bytes.toString('utf8'));
for (const type of ['box_spacing', 'stage_stepper', 'narrated_diagram']) {
  assert.deepEqual(B.BLOCK_SPECS[type]['1'].params, snapshot.types[type]['1'].params, `${type} v1 params equal the Service's`);
  assert.deepEqual(B.BLOCK_SPECS[type]['1'].presets, snapshot.types[type]['1'].presets, `${type} v1 presets equal the Service's`);
  assert.deepEqual(Object.keys(B.BLOCK_SPECS[type]), Object.keys(snapshot.types[type]).filter((v) => v === '1'), `${type}: only v1 is drawn`);
}
// The App draws exactly v1 of both, and RENDERED_UI_VERSIONS says so.
assert.deepEqual([F.RENDERED_UI_VERSIONS.box_spacing, F.RENDERED_UI_VERSIONS.stage_stepper, F.RENDERED_UI_VERSIONS.narrated_diagram], [[1], [1], [1]]);
ok('spec parity: BLOCK_SPECS equals the vendored Service snapshot (sha256 pinned)');
const svc = process.env.HYPEPROOF_SERVICE_DIR;
const svcFile = svc && join(svc, 'worker/test/fixtures/step-ui-catalog-published.json');
if (svcFile && existsSync(svcFile)) {
  const live = JSON.parse(readFileSync(svcFile, 'utf8'));
  for (const type of ['box_spacing', 'stage_stepper', 'narrated_diagram']) assert.deepEqual(live.types[type]?.['1'], snapshot.types[type]['1'], `${type} v1: the Service checkout agrees`);
  ok(`live parity with ${svc}`);
} else console.log('  NOT RUN live parity with a hypeproof-service checkout (set HYPEPROOF_SERVICE_DIR)');

{
  const pinned = { padding: 32, border: 2, margin: 24, layout: 'block' };
  assert.deepEqual(B.boxParams(1, pinned), pinned);
  assert.deepEqual(B.boxParams(undefined, {}), { padding: 16, border: 1, margin: 8, layout: 'block' }, 'an unpinned key takes its default');
  for (const bad of [{ padding: 49 }, { border: -1 }, { margin: 8.5 }, { padding: '16' }, { padding: '8px;background:url(x)' }, { layout: 'table' }, { layout: 'block;color:red' }, { color: 'red' }, 'x', []])
    assert.equal(B.boxParams(1, bad), null, JSON.stringify(bad));
  assert.equal(B.boxParams(2, pinned), null, 'v2 is not drawn');
  ok('boxParams: exact v1 values only; out of range, wrong kind, CSS text and unknown keys are refused');
}
{
  // The style object is built from clamped numbers: even a value that bypassed boxParams cannot carry CSS text.
  const evil = B.boxStyle({ padding: '8px;background:url(x)', border: 99, margin: -5, layout: 'block;background:url(x)' });
  assert.deepEqual(evil, { '--param-padding': '0px', '--param-border': '8px', '--param-margin': '0px' });
  for (const v of Object.values(evil)) assert.match(v, /^\d+px$/, 'every value is a whole number of px, never CSS text');
  assert.deepEqual(B.boxStyle({ padding: 16.4, border: 1, margin: 8, layout: 'flex' }), { '--param-padding': '16px', '--param-border': '1px', '--param-margin': '8px' });
  assert.equal(B.clampLayout('block;background:url(x)'), 'block', 'the layout is one of four fixed values');
  ok('boxStyle: clamped numbers and a fixed display only; served CSS text cannot reach it');
}
{
  // The caption is learner copy computed from the same clamped values (content-box: 2 × (padding + border); margin outside).
  assert.equal(B.boxCaption({ padding: 16, border: 1, margin: 8, layout: 'block' }), '안쪽 여백 16px · 테두리 1px · 바깥 여백 8px · 블록 배치 → 상자가 내용보다 34px 넓어요. 바깥 여백 8px는 상자 밖의 빈 공간이에요.');
  assert.equal(B.boxCaption({ padding: 0, border: 0, margin: 0, layout: 'grid' }), '안쪽 여백 0px · 테두리 0px · 바깥 여백 0px · 그리드 배치 → 상자가 내용과 같은 너비예요.', 'the 0 case');
  assert.equal(B.boxCaption({ padding: 48, border: 8, margin: 48, layout: 'inline-block' }), '안쪽 여백 48px · 테두리 8px · 바깥 여백 48px · 인라인 블록 배치 → 상자가 내용보다 112px 넓어요. 바깥 여백 48px는 상자 밖의 빈 공간이에요.', 'the maximum case');
  assert.equal(B.boxCaption({ padding: 999, border: 'x', margin: -3, layout: 'flex' }), '안쪽 여백 48px · 테두리 0px · 바깥 여백 0px · 플렉스 배치 → 상자가 내용보다 96px 넓어요.', 'clamped like the preview');
  for (const [k, p] of Object.entries(B.BLOCK_SPECS.box_spacing['1'].presets)) assert.match(B.boxCaption(p.params), /→ 상자가/, `preset ${k} has a caption`);
  ok('boxCaption: CSS-exact width, margin outside, 0 and maximum cases, clamped input');
}
{
  assert.equal(B.rangeKeyStep('ArrowRight', 16, 0, 48), 17); assert.equal(B.rangeKeyStep('ArrowLeft', 0, 0, 48), 0, 'not below min');
  assert.equal(B.rangeKeyStep('PageUp', 16, 0, 48), 21, '10 % of 48 is 5'); assert.equal(B.rangeKeyStep('PageDown', 2, 0, 48), 0);
  assert.equal(B.rangeKeyStep('PageUp', 7, 0, 8), 8, '10 % of 8 rounds to 1, clamped'); assert.equal(B.rangeKeyStep('End', 3, 0, 8), 8); assert.equal(B.rangeKeyStep('Home', 3, 0, 8), 0);
  assert.equal(B.rangeKeyStep('a', 3, 0, 8), null);
  ok('rangeKeyStep: ±1, ±10 % of the range, Home/End, inside the bounds');
}
{
  const S = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ title: `${i + 1}단계`, sentence: `${i + 1}번째 문장`, ...over }));
  assert.deepEqual(B.stageParams(1, { stages: S(2) }), S(2)); assert.equal(B.stageParams(1, { stages: S(8) })?.length, 8);
  const tags = S(2, { title: '<img src=x onerror=alert(1)>', sentence: '<script>alert(1)</script>' });
  assert.deepEqual(B.stageParams(1, { stages: tags }), tags, 'markup-looking text is kept as text (drawn as text nodes)');
  for (const bad of [{ stages: S(1) }, { stages: S(9) }, { stages: S(2, { title: 'ㄱ'.repeat(41) }) }, { stages: S(2, { sentence: 'ㄱ'.repeat(61) }) },
    { stages: S(2, { title: '' }) }, { stages: S(2, { title: '한\n줄' }) }, { stages: [...S(1), { title: 'a', sentence: 'b', link: 'x' }] }, { stages: 'a' }, { stages: S(2), x: 1 }, undefined, {}])
    assert.equal(B.stageParams(1, bad), null, JSON.stringify(bad)?.slice(0, 60));
  assert.equal(B.stageLabel(1, 4), '2 / 4 단계'); assert.equal(B.stageMove(0, 4, -1), 0); assert.equal(B.stageMove(3, 4, 1), 3); assert.equal(B.stageMove(1, 4, 1), 2);
  ok('stageParams: exactly 2–8 single-line {title ≤ 40, sentence ≤ 60}; markup text kept as text; stepping stays inside');
}
{
  // The Service's single-line safe-text rule, against the case list the Service and Chalk share (byte-for-byte copies).
  const cases = JSON.parse(readFileSync(new URL('../../../chalk/test/fixtures/safe-text-cases.json', import.meta.url), 'utf8')).cases;
  assert.ok(cases.length >= 25, `shared cases (${cases.length})`);
  assert.deepEqual(cases.map(([t, readable]) => B.safeLine(t, readable)), cases.map(([, , safe]) => safe), 'safeLine equals the shared safe-text case list');
  // Every case the list refuses with the readable rule is a stage title Studio does not draw (bidi override, zero-width, …).
  for (const [t, readable, safe] of cases) if (readable && !safe && t.length <= 40)
    assert.equal(B.stageParams(1, { stages: [{ title: t, sentence: '문장' }, { title: '둘', sentence: '문장' }] }), null, JSON.stringify(t));
  assert.equal(B.stageParams(1, { stages: [{ title: 'a\u202eb', sentence: '문장' }, { title: '둘', sentence: '문장' }] }), null, 'a bidi override is refused');
  ok('safeLine: equals the shared safe-text cases; stage text the Service would refuse is not drawn');
}
{
  // Fail closed: a block with params that do not fit draws the unsupported notice, never a guessed value.
  const lesson = (ui, ui_params) => ({ sha256: 's', version: 'v', content: { steps: [{ id: 'a', ui, ui_version: 1, ui_params }] } });
  assert.equal(F.surfaceOf({ id: 'a', ui: 'box_spacing', ui_version: 1, ui_params: { padding: 49 } }), 'unsupported:box_spacing');
  assert.equal(F.surfaceOf({ id: 'a', ui: 'stage_stepper', ui_version: 1 }), 'unsupported:stage_stepper');
  assert.equal(F.stepMaterial(lesson('box_spacing', { padding: 49 }), 'a'), null);
  assert.deepEqual(F.stepMaterial(lesson('box_spacing', { padding: 4, border: 1, margin: 0, layout: 'flex' }), 'a')?.box, { padding: 4, border: 1, margin: 0, layout: 'flex' });
  assert.equal(F.surfaceOf({ id: 'a', ui: 'box_spacing', ui_version: 1, ui_params: {} }), 'box_spacing');
  assert.equal(F.stepMaterial(lesson('stage_stepper', { stages: [{ title: 'a', sentence: 'b' }, { title: 'c', sentence: 'd' }] }), 'a')?.stages?.length, 2);
  assert.deepEqual(F.materialTextGaps(), [], 'both kinds have Korean title, help and state');
  ok('fail closed: bad params give the unsupported notice and no block');
}
{
  const p0 = { padding: 16, border: 1, margin: 8, layout: 'block' }, p1 = { ...p0, padding: 20 };
  let h = B.boxEdit({ past: [] }, p0, p1); assert.deepEqual(h.past, [p0]);
  assert.deepEqual(B.boxEdit(h, p1, p1), h, 'no change, no step');
  const r = B.boxReset(h, p1, p0); assert.deepEqual(r.values, p0); assert.equal(B.boxReset(h, p0, p0), null);
  assert.deepEqual(B.boxUndo(r.history).values, p1); assert.equal(B.boxUndo({ past: [] }), null);
  ok('box history: one step per change or reset; reset to the pinned values; undo');
}
{
  // CGP-LEARN-R-009 — the width estimate equals the Service's (service-contracts textLayerWidthPx; same cases as its test).
  assert.equal(B.textLayerWidthPx('', 14), 0);
  assert.equal(B.textLayerWidthPx('가나다', 14), 42);
  assert.equal(B.textLayerWidthPx('ㄱ\u1100漢カ😀Ａ', 10), 60, 'compatibility jamo, jamo, CJK, kana, emoji, full-width');
  assert.ok(Math.abs(B.textLayerWidthPx('abc ', 10) - 24) < 1e-9, 'Latin and space at 0.6 em');
  assert.equal(B.textLayerWidthPx('⭐✅☀♥', 10), 40, 'BMP pictographic at 1 em');
  assert.ok(Math.abs(B.textLayerWidthPx('→·', 10) - 12) < 1e-9);
  ok('textLayerWidthPx: the Service width estimate, case for case');
}
{
  const BEATS = [{ title: '요청 보내기', sentence: '주소를 누르면 브라우저가 서버에 페이지를 달라고 해요.' }, { title: '서버가 찾기', sentence: '서버는 요청한 파일을 찾아서 돌려줄 준비를 해요.' }, { title: '화면에 보이기', sentence: '받은 HTML 을 브라우저가 읽어 화면에 그려요.' }];
  assert.deepEqual(B.diagramParams(1, { diagram: 'html_to_page', beats: BEATS }), { diagram: 'html_to_page', beats: BEATS });
  assert.deepEqual(B.diagramParams(undefined, { beats: BEATS }), { diagram: 'page_request', beats: BEATS }, 'an unpinned diagram takes the default');
  const with3 = (i, over) => BEATS.map((b, k) => (k === i ? { ...b, ...over } : b));
  const bad = [
    {}, { beats: BEATS.slice(0, 2) }, { beats: [...BEATS, BEATS[0]] }, { diagram: 'flowchart', beats: BEATS }, { diagram: '<svg/>', beats: BEATS },
    { beats: BEATS, color: 'red' }, { beats: with3(0, { color: 'accent' }) }, { beats: with3(1, { title: '' }) }, { beats: with3(1, { sentence: '한\n줄' }) },
    { beats: with3(2, { title: '가'.repeat(13) }) }, { beats: with3(2, { title: '⭐'.repeat(13) }) }, { beats: with3(2, { title: 'a'.repeat(21) }) },
    { beats: with3(0, { sentence: '😀'.repeat(31) }) }, 'x', [],
  ];
  for (const b of bad) assert.equal(B.diagramParams(1, b), null, JSON.stringify(b));
  assert.ok(B.diagramParams(1, { beats: with3(2, { title: '가'.repeat(12) }) }), '12 syllables fit 168 px');
  assert.equal(B.diagramParams(2, { beats: BEATS }), null, 'v2 is not drawn');
  const step = (ui_params) => ({ id: 's', ui: 'narrated_diagram', ui_version: 1, ui_params });
  assert.equal(F.surfaceOf(step({ beats: BEATS })), 'narrated_diagram');
  assert.equal(F.surfaceOf(step({ beats: with3(2, { title: '가'.repeat(13) }) })), 'unsupported:narrated_diagram', 'fail closed');
  assert.equal(F.surfaceOf({ ...step({ beats: BEATS }), ui_version: 2 }), 'unsupported:narrated_diagram');
  ok('diagramParams: exactly 3 safe beats within length and width, a v1 drawing, no other key; surfaceOf fails closed');
}
console.log(`${n} block params checks passed`);
