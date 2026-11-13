// CGP-LEARN-R-004 / CGP-LEARN-D-004 (DES-CGP-LEARN-04) — the instructor-only block chip in the Chalk step editor, on the REAL
// served /authoring page in headless Chromium (CDP) at 1280 and 768 px. The Service is stubbed behind window.fetch and follows
// hypeproof-service#461: the features read carries step_ui_catalog; a confirmed step carries ui + ui_version (+ ui_params).
// Checked (geometry relative to page elements, so no assertion depends on a font):
//   1. a pinned step shows "criterion_form · v1 · 기본"; an unpinned one shows the catalog's latest with "(확정할 때 고정)";
//      before the catalog is read, "· 버전은 확정할 때 고정"; a step without a block shows no chip;
//   2. a step whose params match no preset shows "직접 설정";
//   3. changing a step's block type drops the old type's ui_version / ui_params from the saved content (the Service pins
//      the new type at confirm), and keeping the type keeps them byte for byte;
//   4. 14px text floor, no horizontal scroll.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { TEST_CONNECT_SECRET, sessionCookie } from './harness/connect.mjs';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('step-ui-chip.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  step-ui-chip.browser (no headless Chromium)');
  process.exit(0);
}
const PRESETS = JSON.parse(readFileSync(new URL('./fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const TONES = JSON.parse(readFileSync(new URL('./fixtures/assistant-tone-catalog.json', import.meta.url), 'utf8'));
const V1 = { params: {}, presets: { default: { label: '기본', params: {} } } };
const PARAM_V1 = { params: { level: { kind: 'integer', min: 1, max: 3, default: 1 } }, presets: { default: { label: '기본', params: { level: 1 } }, hard: { label: '도전', params: { level: 3 } } } };
const CATALOG = { schema: 'hps-step-ui-catalog/1', types: { criterion_form: { versions: { '1': V1 } }, decision_form: { versions: { '1': V1, '2': V1 } }, metric_board: { versions: { '1': PARAM_V1 } } } };
const FEATURES = { choices: [{ key: 'read', label: '읽기' }], approval_presets: PRESETS, assistant_tones: TONES, step_ui_catalog: CATALOG };
const SAVED = {
  schema: 'hps-session-design/1', title: '첫 수업', audience: '초등', duration_minutes: 90, objective: '목표', starter: '예제', prerequisites: '',
  steps: [
    { id: 'pinned', title: '기준', instructions: '적기', hint: '', acceptance: '저장', ui: 'criterion_form', ui_version: 1 },
    { id: 'fresh', title: '결정', instructions: '적기', hint: '', acceptance: '저장', ui: 'decision_form' },
    { id: 'custom', title: '수치', instructions: '보기', hint: '', acceptance: '말하기', ui: 'metric_board', ui_version: 1, ui_params: { level: 2 } },
    { id: 'hard', title: '수치2', instructions: '보기', hint: '', acceptance: '말하기', ui: 'metric_board', ui_version: 1, ui_params: { level: 3 } },
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
const stub = `window.__rev=3;window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.endsWith('/proposal')||p.endsWith('/section-revision'))return json({error:'not found'},404);
  if(p.includes('/features/'))return json(${JSON.stringify(FEATURES)});
  if(p.includes('/models/'))return json({default:'sonnet',choices:[{alias:'sonnet',label:'Sonnet'}]});
  if(m==='GET')return json({profile_id:'p1',revision:window.__rev,content:${JSON.stringify(SAVED)}});
  return json({});};
  for(const [k,v] of [['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;return 0`;
const chips = `return Object.fromEntries([...document.querySelectorAll('.step')].map(f=>[f.querySelector('[data-field=id]').value,{hidden:f.querySelector('[data-ui-chip]').hidden,text:f.querySelector('[data-ui-chip]').textContent}]))`;
let checks = 0;
try {
  for (const width of [1280, 768]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState==='complete' && typeof uiChip==='function' && !!window.chalkConnection?.current?.connected`, '/authoring');
    await ev(stub);
    await ev(`document.getElementById('load').click();return 0`);
    await until(`return !busy && revision===3 && document.querySelectorAll('.step').length===5`, 'the draft');

    // 1. Before the catalog is read.
    const before = await ev(chips);
    assert.equal(before.pinned.text, 'criterion_form · v1 · 기본', `${width}px: a pinned step shows its pin without the catalog's latest`);
    assert.equal(before.fresh.text, 'decision_form · 버전은 확정할 때 고정', `${width}px: unpinned, catalog not read yet`);
    assert.equal(before.plain.hidden, true, `${width}px: no block, no chip`);
    // After the features read.
    await ev(`document.getElementById('features-load').click();return 0`);
    await until(`return !busy && !!featureCatalogue?.step_ui_catalog`, 'the features read');
    const after = await ev(chips);
    assert.deepEqual(after, {
      pinned: { hidden: false, text: 'criterion_form · v1 · 기본' },
      fresh: { hidden: false, text: 'decision_form · v2 · 기본 (확정할 때 고정)' },
      custom: { hidden: false, text: 'metric_board · v1 · 직접 설정' },
      hard: { hidden: false, text: 'metric_board · v1 · 도전' },
      plain: { hidden: true, text: '' },
    }, `${width}px: chips`);
    checks += 4;

    // 3. Keeping a type keeps its pin; changing it drops the old pin.
    const kept = await ev(`return JSON.stringify(content().steps.map(s=>[s.id,s.ui??null,s.ui_version??null,s.ui_params??null]))`);
    assert.equal(kept, JSON.stringify([['pinned', 'criterion_form', 1, null], ['fresh', 'decision_form', null, null], ['custom', 'metric_board', 1, { level: 2 }], ['hard', 'metric_board', 1, { level: 3 }], ['plain', null, null, null]]), `${width}px: pins carried unchanged`);
    await ev(`const f=[...document.querySelectorAll('.step')].find(f=>f.querySelector('[data-field=id]').value==='custom');const s=f.querySelector('[data-ui]');s.value='decision_form';s.dispatchEvent(new Event('change'));return 0`);
    const changed = await ev(`const s=content().steps.find(s=>s.id==='custom');return {ui:s.ui,v:'ui_version' in s,p:'ui_params' in s,chip:${JSON.stringify('')}+[...document.querySelectorAll('.step')].find(f=>f.querySelector('[data-field=id]').value==='custom').querySelector('[data-ui-chip]').textContent,dirty}`);
    assert.deepEqual(changed, { ui: 'decision_form', v: false, p: false, chip: 'decision_form · v2 · 기본 (확정할 때 고정)', dirty: true }, `${width}px: a new type drops the old pin and shows the latest`);
    await ev(`const f=[...document.querySelectorAll('.step')].find(f=>f.querySelector('[data-field=id]').value==='custom');const s=f.querySelector('[data-ui]');s.value='metric_board';s.dispatchEvent(new Event('change'));return 0`);
    assert.deepEqual(await ev(`const s=content().steps.find(s=>s.id==='custom');return [s.ui_version??null,s.ui_params??null]`), [1, { level: 2 }], `${width}px: back to the original type restores its pin`);
    checks += 3;

    // 4. Layout.
    const geo = await ev(`const c=[...document.querySelectorAll('[data-ui-chip]')].filter(e=>!e.hidden);return {overflow:document.scrollingElement.scrollWidth-innerWidth,fonts:c.map(e=>parseFloat(getComputedStyle(e).fontSize)),past:c.filter(e=>e.getBoundingClientRect().right>innerWidth+0.5).length}`);
    assert.ok(geo.overflow <= 0, `${width}px: no horizontal scroll (${geo.overflow})`);
    assert.ok(geo.fonts.length === 4 && geo.fonts.every((x) => x >= 14), `${width}px: 14px floor ${geo.fonts}`);
    assert.equal(geo.past, 0, `${width}px: chips inside the viewport`);
    checks += 3;
  }
  console.log(`PASS step-ui-chip.browser: ${checks} checks at 1280 and 768 px`);
} finally {
  await b.close();
  server.close();
}
