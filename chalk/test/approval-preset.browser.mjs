// CGP-AGENT-R-001 (REQ-CGP-AGENT-01a, DEC-11) — CH-08: the instructor chooses one approval preset per lesson version in
// Chalk. Measured on the REAL served /authoring page in headless Chromium (CDP), at 1280 and 375 px. The Service is a
// stubbed window.fetch that answers the features read the page already makes, with the closed catalog the Service serves
// (`approval_presets`, hypeproof-service worker/src/lib/lesson-approval-preset.ts), so the page's own button loads it:
//   1. before the catalog read the picker is disabled, shows the unset choice 기본(학습자 앱 기본값), and a saved preset is
//      neither dropped nor rewritten by content();
//   2. after the read it lists 기본 + the three presets in catalog order as native radios with names and descriptions
//      as text (never HTML), each row a 44px target; a catalog id outside the closed set (full access) is never offered;
//   3. picking a preset writes `approval_preset`, picking 기본 sends no key at all;
//   4. a Service without `approval_presets` keeps the picker closed and says so; the saved value is still kept;
//   5. the change summary names a preset change, and a frozen candidate / loaded version shows its preset read-only;
//   6. the help text says minors' lessons default to 중요한 것만 묻기; no horizontal scroll at 375 px.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails. Never opens a window or
// sends OS input: clicks are DOM clicks inside the headless page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('approval-preset.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  approval-preset.browser (no headless Chromium)');
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
  for (let i = 0; i < 200; i++) {
    if (await ev(js).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for ' + what);
}
// The Service catalog, verbatim (strictest first). The hostile label and the extra full-access entry are negative samples:
// a server string is text, and an id outside the closed set is never a choice.
const CATALOG = [
  { id: 'always_ask', label: '항상 묻기', description: '파일을 고치거나 명령을 실행하기 전에 매번 묻고, 한 번 허락한 일도 다시 물어봐요.' },
  { id: 'before_changes', label: '바꾸기 전에 묻기', description: '파일을 고치거나 명령을 실행하기 전에 물어봐요.' },
  { id: 'important_only', label: '중요한 것만 묻기<img src=x id=injected>', description: '되돌리기 어려운 명령, 브라우저 열기, 보조 AI 맡기기처럼 중요한 일만 물어봐요.' },
  { id: 'full_access', label: '전부 허용', description: '묻지 않아요.' },
];
const DRAFT = { title: '첫 홈페이지', steps: [], approval_preset: 'before_changes' };
// Stub the Service behind the page: the features read answers with (or without) the catalog. Everything else is unused here.
const stub = (withPresets) => `window.__calls=[];window.fetch=async(path)=>{window.__calls.push(String(path));
  const p=String(path);
  if(p.endsWith('/refused'))return new Response(JSON.stringify({error:'approval_preset must be one of always_ask, before_changes, important_only'}),{status:400,headers:{'content-type':'application/json'}});
  const body=p.includes('/features/')?{choices:[{key:'read',label:'읽기'}],${withPresets ? `approval_presets:${JSON.stringify(CATALOG)}` : ''}}
    :p.includes('/versions/')?{module:{content:{approval_preset:'always_ask'}},source_revision:3,rehearsal:'passed',activated:false}:{};
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});};
  for(const [k,v] of [['token','t'],['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;
  document.querySelector('#editor details').open=true;return 0`;
const radios = `return [...document.querySelectorAll('#approval-choices input[type=radio]')].map(i=>({value:i.value,checked:i.checked,name:i.closest('label').querySelector('span').textContent,desc:i.getAttribute('aria-describedby')?document.getElementById(i.getAttribute('aria-describedby'))?.textContent:null}))`;
let checks = 0;
try {
  for (const width of [1280, 375]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState === 'complete' && typeof render === 'function' && !!document.getElementById('approval-choices')`, '/authoring with the approval picker');
    await ev(stub(true));

    // 1. Before the catalog read: closed, the unset choice is there, help text names the minors' default.
    const before = await ev(`return { disabled: document.getElementById('approval-fields').disabled, legend: document.querySelector('#approval-fields legend').textContent,
      help: document.getElementById('approval-help').textContent, status: document.getElementById('approval-status').textContent }`);
    assert.equal(before.disabled, true, `${width}px: the picker is closed until the catalog read`);
    assert.match(before.legend, /AI가 묻는 방식/, `${width}px: the picker is a fieldset with a legend`);
    assert.match(before.help, /미성년자 수업\(초등·중·고\)의 기본은 ‘중요한 것만 묻기’/, `${width}px: help text says minors default to 중요한 것만 묻기`);
    assert.match(before.help, /학습자 앱의 기본값/, `${width}px: help text says unset follows the learner app default`);
    assert.deepEqual((await ev(radios)).map((r) => [r.value, r.checked, r.name]), [['', true, '기본(학습자 앱 기본값)']], `${width}px: only the unset choice before the read, and it is chosen`);
    checks += 5;

    // A saved draft with a preset, opened before the read: shown as saved, never dropped from the next save.
    await ev(`render(${JSON.stringify(DRAFT)}); return 0`);
    assert.equal(await ev(`return content().approval_preset ?? null`), 'before_changes', `${width}px: a saved preset survives content() before the catalog read`);
    assert.deepEqual((await ev(radios)).filter((r) => r.checked).map((r) => r.name), ['저장된 값: 바꾸기 전에 묻기'], `${width}px: the saved preset is shown checked by name`);
    checks += 2;

    // 2. The page's own catalog read fills the picker in catalog order.
    await ev(`document.getElementById('features-load').click(); return 0`);
    await until(`return !document.getElementById('approval-fields').disabled`, 'the picker to open after the features read');
    const listed = await ev(radios);
    assert.deepEqual(listed.map((r) => r.value), ['', 'always_ask', 'before_changes', 'important_only'], `${width}px: 기본 + three presets in catalog order, no full access`);
    assert.deepEqual(listed.map((r) => r.name), ['기본(학습자 앱 기본값)', '항상 묻기', '바꾸기 전에 묻기', '중요한 것만 묻기<img src=x id=injected>'], `${width}px: names come from the catalog as text`);
    assert.equal(await ev(`return !!document.getElementById('injected')`), false, `${width}px: a catalog label is never parsed as HTML`);
    assert.deepEqual(listed.filter((r) => r.checked).map((r) => r.value), ['before_changes'], `${width}px: the saved preset stays chosen`);
    for (const r of listed.slice(1)) assert.equal(r.desc, CATALOG.find((c) => c.id === r.value).description, `${width}px ${r.value}: the description is the radio's accessible description`);
    assert.ok(listed[0].desc && /학습자 앱/.test(listed[0].desc), `${width}px: the unset choice says what it means`);
    assert.ok((await ev(`return document.querySelectorAll('#approval-choices input[name=approval-preset]').length`)) === 4, `${width}px: one radio group`);
    checks += 7 + listed.length - 1;

    // Geometry: 44px rows, nothing past the viewport, no horizontal page scroll.
    await ev(`document.getElementById('approval-fields').scrollIntoView({block:'center'}); return 0`);
    const g = await ev(`const f=document.getElementById('approval-fields').getBoundingClientRect();
      return { overflow: document.scrollingElement.scrollWidth - innerWidth, right: f.right - innerWidth,
        rows: [...document.querySelectorAll('#approval-choices label')].map(l=>{const r=l.getBoundingClientRect();return {h:r.height,right:r.right,font:parseFloat(getComputedStyle(l.querySelector('span')).fontSize)};}) }`);
    assert.ok(g.overflow <= 0, `${width}px: page scrolls horizontally by ${g.overflow}px`);
    assert.ok(g.right <= 0.5, `${width}px: the picker overflows the viewport`);
    for (const r of g.rows) { assert.ok(r.h >= 43.5, `${width}px: row ${r.h}px < 44`); assert.ok(r.right <= width + 0.5, `${width}px: row past the viewport`); assert.ok(r.font >= 14, `${width}px: name ${r.font}px < 14`); }
    checks += 2 + g.rows.length * 3;

    // 3. Picking writes the id; picking 기본 sends no key.
    await ev(`document.querySelector('#approval-choices input[value=always_ask]').click(); return 0`);
    assert.equal(await ev(`return content().approval_preset`), 'always_ask', `${width}px: choosing 항상 묻기 writes always_ask`);
    assert.match(await ev(`return document.getElementById('approval-status').textContent`), /지금: 항상 묻기/, `${width}px: the status names the choice`);
    await ev(`document.querySelector('#approval-choices input[value=""]').click(); return 0`);
    assert.equal(await ev(`return 'approval_preset' in content()`), false, `${width}px: choosing 기본 sends no approval_preset key`);
    checks += 3;

    // A radio change is an unsaved edit: the page goes dirty and cannot freeze until saved.
    assert.deepEqual(await ev(`return { dirty, freeze: document.getElementById('freeze').disabled }`), { dirty: true, freeze: true }, `${width}px: a choice marks the draft unsaved`);
    // A saved id the catalog does not offer is kept as loaded and named as such; the Service's 400 for it is explained in Korean.
    await ev(`render(${JSON.stringify({ ...DRAFT, approval_preset: 'x_unknown' })}); return 0`);
    assert.deepEqual((await ev(radios)).filter((r) => r.checked).map((r) => r.name), ['지금은 고를 수 없는 값(그대로 둠): x_unknown'], `${width}px: an unknown saved id is shown, not dropped`);
    assert.equal(await ev(`return content().approval_preset`), 'x_unknown', `${width}px: an unknown saved id is not rewritten`);
    await ev(`window.__err=null;call('/refused').catch(e=>{window.__err=e.message;});return 0`);
    await until(`return !!window.__err`, 'the refused save');
    assert.match(await ev(`return window.__err`), /AI가 묻는 방식은 지금 고를 수 없는 값입니다/, `${width}px: the Service's refusal names the picker in Korean`);
    // The page's own 버전 확인 button: a loaded frozen version shows its preset read-only.
    await ev(`document.getElementById('version').value='m2026.11.04-1';document.getElementById('version-load').click();return 0`);
    await until(`return /고정됨/.test(document.getElementById('version-approval').textContent)`, 'the version-load line');
    assert.equal(await ev(`return document.getElementById('version-approval').textContent`), '이 버전의 AI가 묻는 방식: 항상 묻기 (고정됨)', `${width}px: 버전 확인 shows the frozen preset`);
    checks += 6;

    // 5. Change summary and read-only frozen views.
    const lines = await ev(`return impactLines({steps:{added:[],removed:[]},approval_preset:{from:null,to:'always_ask'}}).concat(impactLines({steps:{added:[],removed:[]},approval_preset:{from:'before_changes',to:null}}))`);
    assert.deepEqual(lines, ['AI가 묻는 방식: 기본(학습자 앱 기본값) → 항상 묻기', 'AI가 묻는 방식: 바꾸기 전에 묻기 → 기본(학습자 앱 기본값)'], `${width}px: the change summary names a preset change`);
    const frozen = await ev(`readiness={version:'m2026.11.04-3',state:'passed',content:{approval_preset:'before_changes',learning:null}};renderReadiness();
      const box=document.getElementById('readiness');return {text:box.textContent,controls:box.querySelectorAll('input,select,button,textarea').length}`);
    assert.match(frozen.text, /이 후보의 AI가 묻는 방식: 바꾸기 전에 묻기 — 고정된 버전이라 바뀌지 않습니다/, `${width}px: the frozen candidate shows its preset`);
    assert.equal(frozen.controls, 0, `${width}px: the frozen preset is text, not a control`);
    assert.match(await ev(`readiness={version:'m1',state:'passed',content:{}};renderReadiness();return document.getElementById('readiness').textContent`), /이 후보의 AI가 묻는 방식: 기본\(학습자 앱 기본값\)/, `${width}px: a frozen version without a preset says 기본`);
    assert.equal(await ev(`versionApproval({module:{content:{approval_preset:'important_only'}}});return document.getElementById('version-approval').textContent`), '이 버전의 AI가 묻는 방식: 중요한 것만 묻기<img src=x id=injected> (고정됨)', `${width}px: a loaded version shows its preset read-only (catalog name)`);
    checks += 4;

    // Changing the cohort/profile/course makes the loaded catalog stale: the picker closes and asks for a new read.
    await ev(`const e=document.getElementById('profile');e.value='p2';e.dispatchEvent(new Event('input'));return 0`);
    const stale = await ev(`return { disabled: document.getElementById('approval-fields').disabled, status: document.getElementById('approval-status').textContent }`);
    assert.equal(stale.disabled, true, `${width}px: an identity change closes the picker`);
    assert.match(stale.status, /수업 기능 목록 불러오기/, `${width}px: and asks for the catalog again`);
    checks += 2;

    // 4. An older Service: no approval_presets on the features read.
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState === 'complete' && typeof render === 'function' && !!document.getElementById('approval-choices')`, '/authoring reload');
    await ev(stub(false));
    await ev(`render(${JSON.stringify(DRAFT)}); return 0`);
    await ev(`document.getElementById('features-load').click(); return 0`);
    await until(`return !document.getElementById('features-fields').disabled`, 'the features read');
    const old = await ev(`return { disabled: document.getElementById('approval-fields').disabled, status: document.getElementById('approval-status').textContent, kept: content().approval_preset ?? null }`);
    assert.equal(old.disabled, true, `${width}px: no catalog, no picker`);
    assert.match(old.status, /이 Service는 아직 승인 방식을 받지 않습니다/, `${width}px: an older Service is explained`);
    assert.equal(old.kept, 'before_changes', `${width}px: the saved preset is still kept`);
    checks += 3;
  }
  console.log(`PASS approval-preset.browser: ${checks} checks — 기본 + three catalog presets as radios, saved value kept, 기본 sends no key, change summary and frozen views name the preset, minors' default in help, 44px/14px at 375 and 1280`);
} finally {
  await b.close?.();
  server.close();
}
