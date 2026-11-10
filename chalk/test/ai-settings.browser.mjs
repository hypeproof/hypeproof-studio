// CGP-AGENT-R-015 / CGP-AGENT-D-013 — one "수업 AI 설정" page in Chalk authoring. Measured on the REAL served /authoring
// page in headless Chromium (CDP) at 1280 and 375 px, with the Service stubbed behind window.fetch:
//   1. the five sections come in the D-013 order (정체성 → 지시문 → 모델·처리 수준 → 기능·승인 → 미리보기) and the section nav
//      lists the same order; there is no 시작 문장 section because the Service accepts no starter-prompt field (DEC-30);
//   2. every field round-trips: edited through the page's own controls, sent by the page's own 초안 저장 as the existing
//      hps-session-design/1 keys, and shown again after the page re-opens the saved lesson;
//   3. the preview is a read-only summary (no controls) that follows the draft;
//   4. a loaded frozen version is shown as text only and does not follow later draft edits;
//   5. 44px targets, no horizontal scroll, no overlapping sections at both widths.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const PRESETS = JSON.parse(readFileSync(new URL('./fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('ai-settings.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  ai-settings.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const server = createServer(async (req, res) => {
  const r = await app.fetch(new Request('http://127.0.0.1' + req.url), { ENVIRONMENT: 'test' });
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
const MODELS = { default: 'sonnet', choices: [{ alias: 'sonnet', label: 'Sonnet' }, { alias: 'haiku', label: 'Haiku' }], effort: { default: 'medium', allowed: ['low', 'medium', 'high'] } };
const FEATURES = { choices: [{ key: 'read', label: '읽기' }, { key: 'write', label: '쓰기' }, { key: 'web_search', label: '웹 검색' }], approval_presets: PRESETS };
const FROZEN = { schema: 'hps-session-design/1', assistant: { display_name: '고정된 이름' }, steps: [{ id: 's1', instructions: 'a' }], model: { default: 'haiku', allowed: ['haiku'] }, features: { allowed: ['read'] }, approval_preset: 'always_ask' };
// Service stub: models/features reads, a saved draft that PUT writes and GET returns, and a frozen version.
const stub = `window.__puts=[];window.__saved=null;window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.includes('/models/'))return json(${JSON.stringify(MODELS)});
  if(p.includes('/features/'))return json(${JSON.stringify(FEATURES)});
  if(p.includes('/versions/'))return json({module:{content:${JSON.stringify(FROZEN)}},source_revision:1,rehearsal:'passed',activated:false});
  if(m==='PUT'){const body=JSON.parse(init.body);window.__puts.push(body);window.__saved=body.content;return json({revision:body.expected_revision+1});}
  if(m==='GET'&&window.__saved)return json({profile_id:'p1',revision:1,content:window.__saved});
  return json({});};
  for(const [k,v] of [['token','t'],['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;return 0`;
const geometry = `const q=s=>[...document.querySelectorAll(s)];
  const sections=q('#ai-settings>details.ai-section').map(d=>d.getBoundingClientRect());
  let overlap=0;for(let i=1;i<sections.length;i++)if(sections[i].top<sections[i-1].bottom-0.5)overlap++;
  return {overflow:document.scrollingElement.scrollWidth-innerWidth,overlap,
    nav:q('#ai-nav a').map(a=>a.getBoundingClientRect().height),summ:q('#ai-settings>details>summary').map(a=>a.getBoundingClientRect().height),
    past:q('#ai-settings, #ai-settings *').filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().right>innerWidth+0.5&&!e.closest('pre')).length}`;
// The page runs one request at a time (a click while busy is ignored), so the two reads go one after the other.
async function loadCatalogues() {
  await ev(`document.getElementById('models-load').click();return 0`);
  await until(`return !busy && !document.getElementById('models-fields').disabled`, 'the models read');
  await ev(`document.getElementById('features-load').click();return 0`);
  await until(`return !busy && !document.getElementById('features-fields').disabled && !document.getElementById('approval-fields').disabled`, 'the features read');
}
let checks = 0;
try {
  for (const width of [1280, 375]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState === 'complete' && typeof render === 'function' && !!document.getElementById('ai-settings')`, '/authoring with the AI settings page');
    await ev(stub);

    // 1. Section order (D-013) and the nav in the same order; no starter-prompt section.
    const order = await ev(`return {ids:[...document.querySelectorAll('#ai-settings>details.ai-section')].map(d=>d.id),names:[...document.querySelectorAll('#ai-settings>details.ai-section>summary')].map(s=>s.textContent.trim()),
      nav:[...document.querySelectorAll('#ai-nav a')].map(a=>[a.textContent.trim(),a.getAttribute('href')]),legend:document.querySelector('#ai-settings>legend').textContent}`);
    assert.deepEqual(order.names, ['정체성', '지시문', '모델·처리 수준', '기능·승인', '미리보기'], `${width}px: section order`);
    assert.deepEqual(order.nav, order.names.map((n, i) => [n, '#' + order.ids[i]]), `${width}px: nav follows the same order and targets the sections`);
    assert.equal(order.legend, '수업 AI 설정');
    // Each field sits in its section.
    const where = await ev(`const inS=(id,sel)=>!!document.querySelector('#'+id+' '+sel);return [['ai-identity','#assistant_name'],['ai-instructions','#steps'],['ai-model','#model-mode'],['ai-model','#effort-mode'],['ai-features','#feature-mode'],['ai-features','#approval-choices'],['ai-preview','#ai-preview-draft']].map(([i,s])=>inS(i,s))`);
    assert.deepEqual(where, where.map(() => true), `${width}px: each control lives in its section`);
    checks += 11;

    // 2. Round trip through the page's own controls, save, and re-open.
    await ev(`document.getElementById('new').disabled=false;document.getElementById('new').click();return 0`);
    await until(`return document.querySelectorAll('.step').length===1 && !!revision===false || revision===0`, 'the new draft');
    await loadCatalogues();
    const set = (id, v) => `{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}`;
    await ev(`${set('title', '첫 수업')}${set('audience', '초등')}${set('objective', '목표')}${set('starter', '예제')}${set('assistant_name', '제작 파트너')}
      {const st=document.querySelector('.step');for(const [f,v] of [['title','1단계'],['instructions','이렇게 도와 주세요'],['hint','힌트'],['acceptance','끝']]){const e=st.querySelector('[data-field='+f+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}}
      ${set('model-mode', 'choice')}${set('model-default', 'haiku')}
      for(const i of document.querySelectorAll('#model-allowed input'))i.checked=true;document.getElementById('model-allowed').dispatchEvent(new Event('change',{bubbles:true}));
      ${set('effort-mode', 'fixed')}${set('effort-default', 'high')}
      ${set('feature-mode', 'narrow')}
      for(const i of document.querySelectorAll('#feature-allowed input'))i.checked=i.value!=='write';document.getElementById('feature-allowed').dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#approval-choices input[value=before_changes]').click();return 0`);
    const draft = await ev(`return content()`);
    assert.equal(draft.assistant.display_name, '제작 파트너');
    assert.equal(draft.steps[0].instructions, '이렇게 도와 주세요');
    assert.deepEqual(draft.model, { default: 'haiku', allowed: ['sonnet', 'haiku'], effort: { default: 'high', allowed: ['high'] } });
    assert.deepEqual(draft.features, { allowed: ['read', 'web_search'] });
    assert.equal(draft.approval_preset, 'before_changes');
    // 3. The preview mirrors the draft, as text, with no controls.
    const pv = await ev(`const l=document.getElementById('ai-preview-draft');return {text:l.textContent,controls:document.querySelectorAll('#ai-preview input,#ai-preview select,#ai-preview textarea,#ai-preview button').length}`);
    for (const piece of ['제작 파트너', '안내를 쓴 단계 1개', 'Haiku 기본', 'High (고정)', '읽기, 웹 검색', '바꾸기 전에 묻기']) assert.ok(pv.text.includes(piece), `${width}px: preview shows ${piece} — got ${pv.text}`);
    assert.equal(pv.controls, 0, `${width}px: the preview has no controls`);
    // Save with the page's own button; the body carries the existing keys.
    await ev(`document.getElementById('save').click();return 0`);
    await until(`return window.__puts.length===1 && dirty===false`, 'the draft save');
    const sent = await ev(`return window.__puts[0]`);
    assert.equal(sent.content.schema, 'hps-session-design/1');
    assert.deepEqual({ a: sent.content.assistant, m: sent.content.model, f: sent.content.features, p: sent.content.approval_preset, i: sent.content.steps[0].instructions }, { a: draft.assistant, m: draft.model, f: draft.features, p: draft.approval_preset, i: '이렇게 도와 주세요' }, `${width}px: the save carries every AI setting under its existing key`);
    assert.deepEqual(Object.keys(sent.content).filter((k) => /tone|role|starter_prompts|conversation/.test(k)), [], `${width}px: no invented contract key`);
    // Re-open: wipe the form, load the saved lesson, and read the controls back.
    await ev(`render({steps:[]});document.getElementById('load').click();return 0`);
    await until(`return document.getElementById('assistant_name').value==='제작 파트너'`, 'the re-opened lesson');
    await loadCatalogues();
    const back = await ev(`return {name:assistant_name.value,instr:document.querySelector('.step [data-field=instructions]').value,mode:document.getElementById('model-mode').value,def:document.getElementById('model-default').value,
      em:document.getElementById('effort-mode').value,ed:document.getElementById('effort-default').value,fm:document.getElementById('feature-mode').value,
      fs:[...document.querySelectorAll('#feature-allowed input:checked')].map(i=>i.value),ap:document.querySelector('#approval-choices input:checked').value}`);
    assert.deepEqual(back, { name: '제작 파트너', instr: '이렇게 도와 주세요', mode: 'choice', def: 'haiku', em: 'fixed', ed: 'high', fm: 'narrow', fs: ['read', 'web_search'], ap: 'before_changes' }, `${width}px: every setting reads back from the saved lesson`);
    checks += 14;

    // 4. A frozen version is text only and does not follow later edits.
    await ev(`document.getElementById('version').value='m1';document.getElementById('version-load').click();return 0`);
    await until(`return !document.getElementById('ai-preview-frozen').hidden`, 'the frozen summary');
    const fz = await ev(`const box=document.getElementById('ai-preview-frozen');return {title:document.getElementById('ai-preview-frozen-title').textContent,text:document.getElementById('ai-preview-frozen-list').textContent,controls:box.querySelectorAll('input,select,textarea,button,[contenteditable]').length}`);
    assert.match(fz.title, /고정된 버전 m1 — 읽기 전용/);
    for (const piece of ['고정된 이름', 'Haiku (고정)', '읽기', '항상 묻기']) assert.ok(fz.text.includes(piece), `${width}px: frozen shows ${piece} — got ${fz.text}`);
    assert.equal(fz.controls, 0, `${width}px: a frozen version has no controls`);
    await ev(`${set('assistant_name', '다음 초안 이름')}return 0`);
    const after = await ev(`return {frozen:document.getElementById('ai-preview-frozen-list').textContent,draft:document.getElementById('ai-preview-draft').textContent}`);
    assert.equal(after.frozen, fz.text, `${width}px: editing the draft leaves the frozen summary alone`);
    assert.ok(after.draft.includes('다음 초안 이름'), `${width}px: the draft preview follows the edit`);
    checks += 8;

    // 5. Geometry.
    await ev(`document.getElementById('ai-settings').scrollIntoView();return 0`);
    const g = await ev(geometry);
    assert.ok(g.overflow <= 0, `${width}px: page scrolls horizontally by ${g.overflow}px`);
    assert.equal(g.overlap, 0, `${width}px: sections overlap`);
    assert.equal(g.past, 0, `${width}px: ${g.past} elements past the viewport`);
    for (const h of [...g.nav, ...g.summ]) assert.ok(h >= 43.5, `${width}px: target ${h}px < 44`);
    const sticky = await ev(`return getComputedStyle(document.getElementById('ai-nav')).position`);
    assert.equal(sticky, width >= 1024 ? 'sticky' : 'static', `${width}px: the section nav sticks only from 1024px`);
    checks += 5 + g.nav.length + g.summ.length;
  }
  console.log(`PASS ai-settings.browser: ${checks} checks — D-013 section order and nav, every setting round-trips through save and re-open, read-only preview, frozen version as text, 44px/no overlap at 375 and 1280`);
} finally {
  await b.close?.();
  server.close();
}
