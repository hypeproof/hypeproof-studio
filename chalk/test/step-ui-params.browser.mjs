// CGP-LEARN-R-005 / CGP-LEARN-R-006 — the block settings editor in the Chalk step editor, on the REAL served /authoring page
// in headless Chromium (CDP) at 1280 and 768 px. The Service is stubbed behind window.fetch and follows hypeproof-service
// #509/#510: the features read carries step_ui_catalog with box_spacing v1 (presets) and stage_stepper v1 (a text_list of
// 2–8 {title ≤ 40, sentence ≤ 60}); a refused save answers 400 {field, reason:'invalid_step_ui', error}.
// Checked (geometry relative to page elements, so no assertion depends on a font):
//   1. gate: before the features read, and on a Service whose catalog lacks them, the two kinds are not offered; a stored
//      value is kept and named; when offered, the option and a note under the choice say learners need an updated Studio;
//   2. box_spacing: the 시작 상태 select lists the catalog's presets only; a preset choice saves that preset's params; a
//      carried value that matches no preset is kept as "지금 값 유지 (직접 설정)"; the chip names the preset;
//   3. stage_stepper: carried stages load in order; stage text (an <img onerror> title) is only ever a field value; add stops
//      at the catalog max and remove at the min; the counters follow; a new step of this type starts with min empty rows;
//      switching the type away and back keeps what was typed; the other type's editor never leaks into the payload;
//   4. a Service field error marks and focuses exactly the named input with a Korean reason, and the next edit clears it;
//      planted controls: an unknown step id and a malformed path mark nothing;
//   5. 44px controls, 14px text floor, no horizontal scroll.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { TEST_CONNECT_SECRET, sessionCookie } from './harness/connect.mjs';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('step-ui-params.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  step-ui-params.browser (no headless Chromium)');
  process.exit(0);
}
const PRESETS = JSON.parse(readFileSync(new URL('./fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const TONES = JSON.parse(readFileSync(new URL('./fixtures/assistant-tone-catalog.json', import.meta.url), 'utf8'));
const V1 = { params: {}, presets: { default: { label: '기본', params: {} } } };
// Copied from hypeproof-service packages/service-contracts/src/step-ui-catalog.ts (BOX_SPACING_V1, STAGE_STEPPER_V1).
const BOX_V1 = {
  params: {
    padding: { kind: 'integer', min: 0, max: 48, default: 16 }, border: { kind: 'integer', min: 0, max: 8, default: 1 },
    margin: { kind: 'integer', min: 0, max: 48, default: 8 }, layout: { kind: 'enum', values: ['block', 'inline-block', 'flex', 'grid'], default: 'block' },
  },
  presets: {
    default: { label: '기본', params: { padding: 16, border: 1, margin: 8, layout: 'block' } },
    roomy: { label: '넉넉하게', params: { padding: 32, border: 2, margin: 24, layout: 'block' } },
    tight: { label: '촘촘하게', params: { padding: 4, border: 1, margin: 0, layout: 'flex' } },
  },
};
const STAGE_V1 = { params: { stages: { kind: 'text_list', minItems: 2, maxItems: 8, fields: { title: { maxLength: 40 }, sentence: { maxLength: 60 } }, required: true } }, presets: { default: { label: '기본', params: {} } } };
const OLD = { schema: 'hps-step-ui-catalog/1', types: { criterion_form: { versions: { '1': V1 } }, decision_form: { versions: { '1': V1 } } } };
const NEW = { schema: 'hps-step-ui-catalog/1', types: { ...OLD.types, box_spacing: { versions: { '1': BOX_V1 } }, stage_stepper: { versions: { '1': STAGE_V1 } } } };
const features = (catalog) => ({ choices: [{ key: 'read', label: '읽기' }], approval_presets: PRESETS, assistant_tones: TONES, step_ui_catalog: catalog });
const XSS = '<img src=x onerror="window.__pwn=1">';
const STAGES = [{ title: XSS, sentence: '첫 문장' }, { title: '둘째', sentence: '둘째 문장' }, { title: '셋째', sentence: '셋째 문장' }];
const CUSTOM = { padding: 20, border: 3, margin: 10, layout: 'grid' };
const SAVED = {
  schema: 'hps-session-design/1', title: '첫 수업', audience: '초등', duration_minutes: 90, objective: '목표', starter: '예제', prerequisites: '',
  steps: [
    { id: 'boxc', title: '상자', instructions: '보기', hint: '', acceptance: '말하기', ui: 'box_spacing', ui_version: 1, ui_params: CUSTOM },
    { id: 'boxr', title: '넉넉', instructions: '보기', hint: '', acceptance: '말하기', ui: 'box_spacing', ui_version: 1, ui_params: BOX_V1.presets.roomy.params },
    { id: 'stg', title: '흐름', instructions: '넘기기', hint: '', acceptance: '말하기', ui: 'stage_stepper', ui_version: 1, ui_params: { stages: STAGES } },
    { id: 'plain', title: '대화', instructions: '묻기', hint: '', acceptance: '말하기' },
  ],
};

const { default: app } = await import('../src/index.ts');
const server = createServer(async (req, res) => {
  const r = await app.fetch(new Request('http://127.0.0.1' + req.url, { headers: { cookie: await sessionCookie('t') } }), { ENVIRONMENT: 'test', HPS_CHALK_CONNECT_SECRET: TEST_CONNECT_SECRET });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const b = await launch(bin);
const ev = (js) => b.evaluate(`(() => { ${js} })()`);
async function until(js, what) {
  for (let i = 0; i < 200; i++) { if (await ev(js).catch(() => false)) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timed out waiting for ' + what);
}
const stub = `window.__puts=[];window.__fail=null;window.__catalog=${JSON.stringify(OLD)};window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.endsWith('/proposal')||p.endsWith('/section-revision'))return json({error:'not found'},404);
  if(p.includes('/features/'))return json({...${JSON.stringify(features(null))},step_ui_catalog:window.__catalog});
  if(p.includes('/models/'))return json({default:'sonnet',choices:[{alias:'sonnet',label:'Sonnet'}]});
  if(m==='PUT'){const body=JSON.parse(init.body);window.__puts.push(body);if(window.__fail)return json(window.__fail,400);return json({revision:body.expected_revision+1});}
  if(m==='GET')return json({profile_id:'p1',revision:3,content:${JSON.stringify(SAVED)}});
  return json({});};
  for(const [k,v] of [['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;return 0`;
const S = (id) => `[...document.querySelectorAll('.step')].find(f=>f.querySelector('[data-field=id]').value===${JSON.stringify(id)})`;
const pick = (id, ui) => `{const s=${S(id)}.querySelector('[data-ui]');s.value=${JSON.stringify(ui)};s.dispatchEvent(new Event('change'));}`;
const options = (id) => `[...${S(id)}.querySelector('[data-ui]').options].map(o=>[o.value,o.textContent])`;
const stepOf = (id) => `content().steps.find(s=>s.id===${JSON.stringify(id)})`;
const type = (sel, v) => `{const e=${sel};e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));}`;
const stageInput = (id, i, f) => `${S(id)}.querySelectorAll('.stage-rows>li')[${i}].querySelector('[data-stage=${f}]')`;
const readFeatures = async () => { await ev(`document.getElementById('features-load').click();return 0`); await until(`return !busy && !!featureCatalogue`, 'the features read'); };
const NOTE = ' — 학생 Studio 최신 버전 필요';
let checks = 0;
try {
  for (const width of [1280, 768]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState==='complete' && typeof blockEditor==='function' && !!window.chalkConnection?.current?.connected`, '/authoring');
    await ev(stub);
    await ev(`document.getElementById('load').click();return 0`);
    await until(`return !busy && revision===3 && document.querySelectorAll('.step').length===4`, 'the draft');

    // 1. Gate. Before the features read: not offered; stored values kept, named, and saved unchanged.
    const before = await ev(`return {plain:${options('plain')},boxc:${options('boxc')},stg:${options('stg')},editors:document.querySelectorAll('.step [data-ui-params]:not([hidden])').length,notes:document.querySelectorAll('.step [data-block-note]:not([hidden])').length}`);
    assert.deepEqual(before.plain.map((o) => o[0]), ['', 'criterion_form', 'decision_form'], `${width}px: no block kinds before the features read`);
    assert.deepEqual(before.boxc.at(-1), ['box_spacing', '저장된 값 유지: 상자 여백 탐색 (‘수업 기능 목록 불러오기’ 뒤에 고칠 수 있음)'], `${width}px: a stored block is kept and named`);
    assert.deepEqual([before.editors, before.notes], [0, 0], `${width}px: no editor and no note before the read`);
    assert.deepEqual(await ev(`return [${stepOf('boxc')}.ui_params,${stepOf('stg')}.ui_params.stages.length]`), [CUSTOM, 3], `${width}px: carried params saved unchanged`);
    // A Service whose catalog lacks the two kinds.
    await readFeatures();
    const old = await ev(`return {plain:${options('plain')}.map(o=>o[0]),stg:${options('stg')}.at(-1),editors:document.querySelectorAll('.step [data-ui-params]:not([hidden])').length}`);
    assert.deepEqual(old, { plain: ['', 'criterion_form', 'decision_form'], stg: ['stage_stepper', '저장된 값 유지: 단계 넘겨 보기 (이 Service에서 아직 고칠 수 없음)'], editors: 0 }, `${width}px: a catalog without the kinds offers neither`);
    // A Service that serves them.
    await ev(`window.__catalog=${JSON.stringify(NEW)};return 0`);
    await readFeatures();
    const offered = await ev(`return ${options('plain')}`);
    assert.deepEqual(offered.slice(3), [['box_spacing', '상자 여백 탐색' + NOTE], ['stage_stepper', '단계 넘겨 보기' + NOTE]], `${width}px: both kinds offered with the update note`);
    const notes = await ev(`return Object.fromEntries(['boxc','stg','plain'].map(id=>{const n=${'[...document.querySelectorAll(".step")].find(f=>f.querySelector("[data-field=id]").value===id)'}.querySelector('[data-block-note]');return [id,n.hidden?null:n.textContent];}))`);
    assert.match(notes.boxc, /^학생 Studio를 최신으로 업데이트해야 보여요\. .*‘업데이트 필요’/, `${width}px: the note under a block choice points at the seat versions`);
    assert.equal(notes.stg, notes.boxc); assert.equal(notes.plain, null, `${width}px: no note without a block`);
    checks += 8;

    // 2. box_spacing presets.
    const box = await ev(`const s=${S('boxc')}.querySelector('[data-block-preset]'),r=${S('boxr')}.querySelector('[data-block-preset]');return {c:[s.value,[...s.options].map(o=>o.textContent)],r:r.value,chips:[${S('boxc')}.querySelector('[data-ui-chip]').textContent,${S('boxr')}.querySelector('[data-ui-chip]').textContent],save:[${stepOf('boxc')}.ui_params,${stepOf('boxr')}.ui_params]}`);
    assert.deepEqual(box.c, ['', ['지금 값 유지 (직접 설정)', '기본', '넉넉하게', '촘촘하게']], `${width}px: a non-preset value is kept as its own choice; only the catalog's presets otherwise`);
    assert.equal(box.r, 'roomy');
    assert.deepEqual(box.chips, ['box_spacing · v1 · 직접 설정', 'box_spacing · v1 · 넉넉하게']);
    assert.deepEqual(box.save, [CUSTOM, BOX_V1.presets.roomy.params], `${width}px: carried values saved as they were`);
    await ev(`${pick('plain', 'box_spacing')}return 0`);
    assert.deepEqual(await ev(`return [${S('plain')}.querySelector('[data-block-preset]').value,${stepOf('plain')}.ui_params,'ui_version' in ${stepOf('plain')}]`), ['default', BOX_V1.presets.default.params, false], `${width}px: a new box starts from 기본 and is pinned at confirm`);
    await ev(`{const s=${S('plain')}.querySelector('[data-block-preset]');s.value='tight';s.dispatchEvent(new Event('change'));}return 0`);
    assert.deepEqual(await ev(`return [${stepOf('plain')}.ui_params,${S('plain')}.querySelector('[data-ui-chip]').textContent,dirty]`), [BOX_V1.presets.tight.params, 'box_spacing · v1 · 촘촘하게 (확정할 때 고정)', true]);
    checks += 6;

    // 3. stage_stepper. Untrusted text stays a value; nothing was created from it.
    const stg = await ev(`const f=${S('stg')};return {titles:[...f.querySelectorAll('[data-stage=title]')].map(e=>e.value),count:f.querySelector('[data-stage-count]').textContent,imgs:document.querySelectorAll('#steps img').length,pwn:window.__pwn??null,chip:f.querySelector('[data-ui-chip]').textContent,counters:[...f.querySelectorAll('.stage-field .counter')].slice(0,2).map(e=>e.textContent),max:[f.querySelector('[data-stage=title]').maxLength,f.querySelector('[data-stage=sentence]').maxLength]}`);
    assert.deepEqual(stg, { titles: [XSS, '둘째', '셋째'], count: '3 / 8단계', imgs: 0, pwn: null, chip: 'stage_stepper · v1 · 단계 3개', counters: [XSS.length + '/40', '4/60'], max: [40, 60] }, `${width}px: stages load as field values`);
    // The counter describes the input; it is not part of its name (the name does not change while typing).
    const a11y = await ev(`const e=${stageInput('stg', 0, 'title')},l=e.labels[0];return {name:l.textContent,inLabel:!!l.querySelector('.counter'),desc:(e.getAttribute('aria-describedby')||'').split(' ').includes(e._counter.id)}`);
    assert.deepEqual(a11y, { name: '제목 (40자 이내)', inLabel: false, desc: true }, `${width}px: the counter is a description, outside the label`);
    // Lengths are UTF-16 units, as maxlength and the Service count: 20 emoji are 40 units.
    await ev(`${type(stageInput('stg', 1, 'title'), '😀'.repeat(20))}return 0`);
    assert.deepEqual(await ev(`const e=${stageInput('stg', 1, 'title')};return [e._counter.textContent,${stepOf('stg')}.ui_params.stages[1].title.length]`), ['40/40', 40], `${width}px: the counter counts UTF-16 units`);
    await ev(`${type(stageInput('stg', 1, 'title'), '둘째')}return 0`);
    checks += 2;
    for (let i = 3; i < 8; i++) await ev(`${S('stg')}.querySelector('[data-stage-add]').click();return 0`);
    const full = await ev(`const f=${S('stg')};return {rows:f.querySelectorAll('.stage-rows>li').length,add:f.querySelector('[data-stage-add]').disabled,count:f.querySelector('[data-stage-count]').textContent,focus:document.activeElement===f.querySelectorAll('.stage-rows>li')[7].querySelector('[data-stage=title]')}`);
    assert.deepEqual(full, { rows: 8, add: true, count: '8 / 8단계', focus: true }, `${width}px: add stops at 8 and focuses the new row`);
    for (let i = 0; i < 6; i++) await ev(`${S('stg')}.querySelector('.stage-rows>li:last-child [data-stage-remove]').click();return 0`);
    const two = await ev(`const f=${S('stg')};return {rows:f.querySelectorAll('.stage-rows>li').length,rm:[...f.querySelectorAll('[data-stage-remove]')].map(b=>b.disabled),count:f.querySelector('[data-stage-count]').textContent,legend:[...f.querySelectorAll('[data-stage-legend]')].map(e=>e.textContent)}`);
    assert.deepEqual(two, { rows: 2, rm: [true, true], count: '2 / 8단계', legend: ['1단계', '2단계'] }, `${width}px: remove stops at 2`);
    await ev(`${type(stageInput('stg', 1, 'sentence'), '  고친 문장 ')}return 0`);
    assert.deepEqual(await ev(`return ${stepOf('stg')}.ui_params`), { stages: [STAGES[0], { title: '둘째', sentence: '고친 문장' }] }, `${width}px: stages save in order, trimmed`);
    await ev(`${pick('stg', 'criterion_form')}return 0`);
    assert.deepEqual(await ev(`const s=${stepOf('stg')};return ['ui_params' in s,'ui_version' in s,${S('stg')}.querySelector('[data-ui-params]').hidden]`), [false, false, true], `${width}px: another type drops the block params`);
    await ev(`${pick('stg', 'stage_stepper')}return 0`);
    assert.deepEqual(await ev(`const s=${stepOf('stg')};return [s.ui_version,s.ui_params]`), [1, { stages: [STAGES[0], { title: '둘째', sentence: '고친 문장' }] }], `${width}px: switching back keeps what was typed`);
    await ev(`${pick('plain', 'stage_stepper')}return 0`);
    assert.deepEqual(await ev(`return ${stepOf('plain')}.ui_params`), { stages: [{ title: '', sentence: '' }, { title: '', sentence: '' }] }, `${width}px: a new stepper starts with two empty rows, never the box's params`);
    checks += 6;

    // 4. A Service field error lands at its input.
    await ev(`window.__fail={field:'steps.stg.ui_params.stages[1].sentence',reason:'invalid_step_ui',error:'steps.stg.ui_params.stages[1].sentence must not contain a link'};document.getElementById('save').click();return 0`);
    await until(`return !busy && window.__puts.length>0`, 'the refused save');
    const marked = await ev(`const e=${stageInput('stg', 1, 'sentence')},err=e._fieldError;return {inv:[...document.querySelectorAll('.step [aria-invalid=true]')].length,mine:e.getAttribute('aria-invalid'),text:err?.textContent,described:(e.getAttribute('aria-describedby')||'').split(' ').includes(err?.id),focus:document.activeElement===e,status:document.getElementById('status').textContent}`);
    assert.deepEqual({ ...marked, status: undefined }, { inv: 1, mine: 'true', text: '확인 필요: 링크(https:// 등)는 넣을 수 없어요', described: true, focus: true, status: undefined }, `${width}px: only the named input is marked and focused`);
    assert.match(marked.status, / — ‘흐름’ 단계 · 단계 목록 2번의 한 문장: 링크\(https:\/\/ 등\)는 넣을 수 없어요\. 편집은 보존됐습니다\.$/, `${width}px: the status line names the step and the field`);
    await ev(`${type(stageInput('stg', 1, 'sentence'), '고친 문장')}return 0`);
    assert.deepEqual(await ev(`const e=${stageInput('stg', 1, 'sentence')};return [e.hasAttribute('aria-invalid'),document.querySelectorAll('.step .field-error').length,e.getAttribute('aria-describedby')===e._counter.id]`), [false, 0, true], `${width}px: the next edit clears the mark`);
    // Planted controls: a step that is not on the page, and a malformed path, mark nothing.
    for (const field of ['steps.nope.ui_params.stages[0].title', 'steps.stg.ui_params.stages[x]']) {
      await ev(`window.__fail={field:${JSON.stringify(field)},reason:'invalid_step_ui',error:${JSON.stringify(field + ' must not be empty')}};document.getElementById('save').click();return 0`);
      await until(`return !busy`, 'the refused save');
      assert.deepEqual(await ev(`return [document.querySelectorAll('.step [aria-invalid=true]').length,/^HTTP 400: /.test(document.getElementById('status').textContent)]`), [0, true], `${width}px: ${field} marks nothing and still reports the refusal`);
    }
    // A count error lands on the list.
    await ev(`window.__fail={field:'steps.stg.ui_params.stages',reason:'invalid_step_ui',error:'steps.stg.ui_params.stages must have at least 2 items'};document.getElementById('save').click();return 0`);
    await until(`return !busy`, 'the refused save');
    assert.equal(await ev(`return ${S('stg')}.querySelector('[aria-invalid=true]')?._fieldError?.textContent`), '확인 필요: 단계를 2개 이상 만들어 주세요');
    await ev(`window.__fail=null;return 0`);
    checks += 6;

    // 5. Layout.
    const geo = await ev(`const f=${S('stg')},ctl=[...document.querySelectorAll('.block-params button,.block-params input,.block-params select')].filter(e=>e.offsetParent),txt=[...document.querySelectorAll('.block-note:not([hidden]),.block-params .counter,.block-params legend,.block-params label span,.field-error')].filter(e=>e.offsetParent);
      return {overflow:document.scrollingElement.scrollWidth-innerWidth,short:ctl.filter(e=>e.getBoundingClientRect().height<43.5).map(e=>e.outerHTML.slice(0,60)),small:txt.filter(e=>parseFloat(getComputedStyle(e).fontSize)<14).map(e=>e.className||e.tagName),past:ctl.filter(e=>e.getBoundingClientRect().right>innerWidth+0.5).length,n:ctl.length}`);
    assert.ok(geo.overflow <= 0, `${width}px: no horizontal scroll (${geo.overflow})`);
    assert.ok(geo.n >= 8, `${width}px: controls measured (${geo.n})`);
    assert.deepEqual(geo.short, [], `${width}px: 44px controls`);
    assert.deepEqual(geo.small, [], `${width}px: 14px text floor`);
    assert.equal(geo.past, 0, `${width}px: controls inside the viewport`);
    // Forced colours: the stage buttons keep a visible system-colour border (enabled and disabled).
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    const fc = await ev(`return [...${S('stg')}.querySelectorAll('.block-stages button')].map(e=>{const c=getComputedStyle(e);return [c.borderTopStyle,parseFloat(c.borderTopWidth)>=1]})`);
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    assert.ok(fc.length >= 3 && fc.every(([st, w]) => st === 'solid' && w), `${width}px: forced colours keep the stage buttons' borders ${JSON.stringify(fc)}`);
    checks += 6;
  }
  console.log(`PASS step-ui-params.browser: ${checks} checks at 1280 and 768 px`);
} finally {
  await b.close();
  server.close();
}
