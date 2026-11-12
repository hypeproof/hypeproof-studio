// CGP-AGENT-R-014 / CGP-AGENT-D-012 — the Chalk half of the authoring assistant: "AI에게 설정 부탁하기" on the 수업 AI 설정 page.
// Measured on the REAL served /authoring page in headless Chromium (CDP) at 1280 and 375 px, with the Service stubbed behind window.fetch
// (the stub follows the contract of POST /admin/cohorts/:cohort/authoring/:course/proposal: 404 while the flag is off, 400 for a body
// without a request, 429 at the daily cap, 409 for a stale revision, otherwise {revision, proposals:[{key,before,after}]}). Checked:
//   1. flag off (404) → the box stays hidden; flag on → the box shows, one text field capped at 300, send disabled while empty;
//   2. a proposal renders as a card: a field / 이전 / 새 값 table, labels from the page's own field labels, values as TEXT (an
//      HTML-looking value never becomes an element), Apply (primary) and 버리기; nothing is written to the form or the Service yet;
//   3. 적용 fills only the proposed fields and saves through the existing save with expected_revision = the proposal's revision;
//   4. a 409 on that save → the calm "설정이 바뀌어서 다시 제안을 받아 주세요", the form is put back, nothing is kept;
//   5. 버리기 writes nothing; 429 → the daily-limit copy; a 404 on send hides the box;
//   6. a frozen version being shown or unsaved edits disable the box; no horizontal scroll, 44px targets, no overlap at 375 and 1280.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
// The page holds no token: every request carries a Lab-connected session (harness/connect.mjs).
import { TEST_CONNECT_SECRET, sessionCookie } from './harness/connect.mjs';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const PRESETS = JSON.parse(readFileSync(new URL('./fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const TONES = JSON.parse(readFileSync(new URL('./fixtures/assistant-tone-catalog.json', import.meta.url), 'utf8'));
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('authoring-assistant.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  authoring-assistant.browser (no headless Chromium)');
  process.exit(0);
}
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
const MODELS = { default: 'sonnet', choices: [{ alias: 'sonnet', label: 'Sonnet' }, { alias: 'haiku', label: 'Haiku' }] };
const FEATURES = { choices: [{ key: 'read', label: '읽기' }, { key: 'write', label: '쓰기' }], approval_presets: PRESETS, assistant_tones: TONES };
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const SAVED = {
  schema: 'hps-session-design/1', title: '첫 수업', audience: '초등', duration_minutes: 120, objective: '목표', starter: '예제', prerequisites: '',
  assistant: { display_name: '제작 파트너', tone: TONES[0].id },
  steps: [{ id: 's1', title: '1단계', instructions: '기존 안내', hint: '', acceptance: '' }, { id: 's2', title: '2단계', instructions: '', hint: '', acceptance: '' }],
};
const PROPOSALS = [
  { key: 'assistant.tone', before: TONES[0].id, after: TONES[1].id },
  { key: 'steps.s1.instructions', before: '기존 안내', after: '새 안내 ' + XSS },
  { key: 'steps.s2.title', before: '2단계', after: XSS },
  { key: 'starters', before: null, after: ['첫 질문', '둘째 질문'] },
  { key: 'approval_preset', before: null, after: PRESETS[1].id },
];
// The Service as the page sees it. window.__flag: 'off' (404), 'on'. window.__prop: null for a normal answer, else {status, body}.
const stub = `window.__puts=[];window.__posts=[];window.__rev=3;window.__flag='on';window.__prop=null;window.__putStatus=0;
  window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.endsWith('/proposal')&&m==='POST'){const body=JSON.parse(init.body);window.__posts.push(body);
    if(window.__flag==='off')return json({error:'not found'},404);
    if(typeof body.request!=='string')return json({error:'request required'},400);
    if(window.__prop)return json(window.__prop.body,window.__prop.status);
    return json({revision:body.expected_revision,proposals:${JSON.stringify(PROPOSALS)},dropped:0,cost:{}});}
  if(p.includes('/models/'))return json(${JSON.stringify(MODELS)});
  if(p.includes('/features/'))return json(${JSON.stringify(FEATURES)});
  if(p.includes('/versions/'))return json({module:{content:${JSON.stringify(SAVED)}},source_revision:1,rehearsal:'passed',activated:false});
  if(m==='PUT'){const body=JSON.parse(init.body);window.__puts.push(body);if(window.__putStatus)return json({error:'revision conflict; reload the draft'},window.__putStatus);window.__rev=body.expected_revision+1;window.__saved=body.content;return json({revision:window.__rev});}
  if(m==='GET')return json({profile_id:'p1',revision:window.__rev,content:window.__saved||${JSON.stringify(SAVED)}});
  return json({});};
  window.__saved=${JSON.stringify(SAVED)};
  for(const [k,v] of [['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;return 0`;
const $ = (id) => `document.getElementById('${id}')`;
const geometry = `const q=s=>[...document.querySelectorAll(s)];const card=document.getElementById('assist').getBoundingClientRect();
  return {overflow:document.scrollingElement.scrollWidth-innerWidth,
    past:q('#assist, #assist *').filter(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().right>innerWidth+0.5).length,
    buttons:q('#assist button').filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getBoundingClientRect().height),
    boxOverNav:card.bottom>document.getElementById('ai-nav').getBoundingClientRect().top+0.5}`;
async function openDraft() {
  await ev(`${$('load')}.click();return 0`);
  await until(`return !busy && bound===identity() && revision===window.__rev`, 'the saved draft to open');
}
const sendRequest = async (text) => {
  await ev(`const e=${$('assist-text')};e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));return 0`);
  await ev(`${$('assist-send')}.click();return 0`);
  await until(`return !busy`, 'the proposal request');
};
let checks = 0;
try {
  for (const width of [1280, 375]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState === 'complete' && typeof render === 'function' && !!document.getElementById('assist') && !!window.chalkConnection?.current?.connected`, '/authoring with the assistant box');
    await ev(stub);

    // 1. The box is hidden until a draft is open and the Service answers (flag off → 404 → still hidden).
    assert.equal(await ev(`return ${$('assist')}.hidden`), true, `${width}px: hidden before any draft is open`);
    await ev(`window.__flag='off';return 0`);
    await openDraft();
    await until(`return window.__posts.length===1`, 'the availability probe');
    assert.equal(await ev(`return ${$('assist')}.hidden`), true, `${width}px: flag off (404) hides the box`);
    assert.deepEqual(await ev(`return window.__posts`), [{}], `${width}px: the probe is an empty body — no request text, no revision`);
    await ev(`window.__flag='on';assistAvail.clear();return 0`);
    await openDraft();
    await until(`return !${$('assist')}.hidden`, 'the box to show');
    const box = await ev(`const t=${$('assist-text')};return {max:t.maxLength,tag:t.tagName,fields:document.querySelectorAll('#assist textarea,#assist input').length,send:${$('assist-send')}.disabled,send_text:${$('assist-send')}.textContent,label:document.querySelector('label[for=assist-text]').textContent,count:${$('assist-count')}.textContent,card:${$('assist-card')}.hidden,dirty}`);
    assert.deepEqual({ max: box.max, tag: box.tag, fields: box.fields, send: box.send, label: box.label, count: box.count, card: box.card, dirty: box.dirty }, { max: 300, tag: 'TEXTAREA', fields: 1, send: true, label: 'AI에게 설정 부탁하기', count: '0/300', card: true, dirty: false }, `${width}px: one field, 300 cap, send disabled while empty`);
    await ev(`const e=${$('assist-text')};e.value='차분하게';e.dispatchEvent(new Event('input',{bubbles:true}));return 0`);
    assert.deepEqual(await ev(`return {send:${$('assist-send')}.disabled,count:${$('assist-count')}.textContent,dirty}`), { send: false, count: '4/300', dirty: false }, `${width}px: typing in the box enables send and does not dirty the draft`);
    checks += 5;

    // 2. A proposal is a card; nothing changes yet.
    await ev(`${$('features-load')}.click();return 0`);
    await until(`return !busy && !${$('approval-fields')}.disabled`, 'the features read');
    const before = await ev(`return JSON.stringify(content())`);
    await ev(`window.__xss=0;return 0`);
    await sendRequest('말투를 차분하게 하고 시작 문장도 넣어 주세요');
    assert.deepEqual(await ev(`return window.__posts.at(-1)`), { request: '말투를 차분하게 하고 시작 문장도 넣어 주세요', expected_revision: 3 }, `${width}px: the request carries the text and the draft revision`);
    const card = await ev(`const t=${$('assist-table')};return {hidden:${$('assist-card')}.hidden,heads:[...t.tHead.rows[0].cells].map(c=>c.textContent),
      rows:[...t.tBodies[0].rows].map(r=>[...r.cells].map(c=>c.textContent)),imgs:t.querySelectorAll('img,script,b').length,xss:window.__xss,
      apply:{text:${$('assist-apply')}.textContent,primary:${$('assist-apply')}.className,disabled:${$('assist-apply')}.disabled},discard:${$('assist-discard')}.textContent,puts:window.__puts.length,form:JSON.stringify(content()),dirty,note:${$('assist-note')}.textContent}`);
    assert.equal(card.hidden, false, `${width}px: the card shows`);
    assert.deepEqual(card.heads, ['항목', '이전', '새 값'], `${width}px: field / 이전 / 새 값`);
    // The label cells are the page's own field labels (preview names and the step form's label text).
    assert.deepEqual(card.rows.map((r) => r[0]), ['AI 말투', '단계 1 · 안내·실습', '단계 2 · 단계 제목', '시작 문장', 'AI가 묻는 방식'], `${width}px: labels come from the page`);
    assert.deepEqual(card.rows[0].slice(1), [TONES[0].label, TONES[1].label], `${width}px: tone shown by the served label, before then after`);
    assert.deepEqual(card.rows[1].slice(1), ['기존 안내', '새 안내 ' + XSS], `${width}px: a step value is text, byte for byte`);
    assert.deepEqual(card.rows[2].slice(1), ['2단계', XSS], `${width}px: HTML-looking value is shown as text`);
    assert.deepEqual(card.rows[3].slice(1), ['없음', '1. 첫 질문 / 2. 둘째 질문'], `${width}px: empty before, starters joined like the preview`);
    assert.equal(card.rows[4][2], PRESETS[1].label, `${width}px: approval preset shown by its served label`);
    assert.equal(card.imgs, 0, `${width}px: no element was created from a value`);
    assert.notEqual(card.xss, 1); assert.notEqual(card.xss, 2);
    assert.deepEqual({ a: card.apply.text, c: card.apply.primary, d: card.apply.disabled, x: card.discard }, { a: '적용', c: 'primary', d: false, x: '버리기' }, `${width}px: Apply (primary) and 버리기`);
    assert.equal(card.puts, 0, `${width}px: nothing is saved by showing the card`);
    assert.equal(card.form, before, `${width}px: the form is unchanged by showing the card`);
    assert.equal(card.dirty, false);
    const geo = await ev(geometry);
    assert.ok(geo.overflow <= 0, `${width}px: no horizontal scroll with the card open (${geo.overflow})`);
    assert.equal(geo.past, 0, `${width}px: nothing in the box passes the viewport`);
    assert.ok(geo.buttons.every((h) => h >= 44), `${width}px: 44px targets ${geo.buttons}`);
    assert.equal(geo.boxOverNav, false, `${width}px: the box does not overlap the section nav`);
    checks += 17;

    // 3. 버리기 writes nothing, and the card goes.
    await ev(`${$('assist-discard')}.click();return 0`);
    const discarded = await ev(`return {hidden:${$('assist-card')}.hidden,puts:window.__puts.length,form:JSON.stringify(content()),note:${$('assist-note')}.textContent,posts:window.__posts.length}`);
    assert.deepEqual({ h: discarded.hidden, p: discarded.puts, f: discarded.form === before }, { h: true, p: 0, f: true }, `${width}px: 버리기 writes nothing`);
    assert.match(discarded.note, /버렸어요/);
    checks += 2;

    // 4. 409 on the save: calm copy, form put back, no revision change.
    await sendRequest('다시 부탁해요');
    await ev(`window.__putStatus=409;return 0`);
    await ev(`${$('assist-apply')}.click();return 0`);
    await until(`return !busy && window.__puts.length===1`, 'the stale save');
    const stale = await ev(`return {note:${$('assist-note')}.textContent,hidden:${$('assist-card')}.hidden,revision,dirty,form:JSON.stringify(content()),exp:window.__puts[0].expected_revision}`);
    assert.equal(stale.exp, 3, `${width}px: the save asked for the revision the proposal was based on`);
    assert.equal(stale.note, '설정이 바뀌어서 다시 제안을 받아 주세요.', `${width}px: calm 409 copy`);
    assert.deepEqual({ h: stale.hidden, r: stale.revision, d: stale.dirty, f: stale.form === before }, { h: true, r: 3, d: false, f: true }, `${width}px: 409 keeps nothing applied`);
    await ev(`window.__putStatus=0;window.__puts.length=0;return 0`);
    checks += 3;

    // 5. Apply: fills only the proposed fields; the save carries expected_revision and nothing else changes.
    await sendRequest('말투를 차분하게 하고 시작 문장도 넣어 주세요');
    await ev(`${$('assist-apply')}.click();return 0`);
    await until(`return !busy && window.__puts.length===1 && dirty===false`, 'the apply save');
    const put = await ev(`return {body:window.__puts[0],revision,note:${$('assist-note')}.textContent,hidden:${$('assist-card')}.hidden,name:${$('assistant_name')}.value,tone:lessonTone}`);
    const expected = structuredClone(SAVED);
    expected.assistant.tone = TONES[1].id;
    expected.steps[0].instructions = '새 안내 ' + XSS;
    expected.steps[1].title = XSS;
    expected.starters = ['첫 질문', '둘째 질문'];
    expected.approval_preset = PRESETS[1].id;
    assert.equal(put.body.expected_revision, 3, `${width}px: expected_revision is the proposal's revision`);
    assert.deepEqual(put.body.content, { ...expected, steps: expected.steps.map((s) => ({ ...s })) }, `${width}px: the saved content is the draft plus exactly the proposed keys`);
    assert.equal(put.revision, 4); assert.equal(put.hidden, true);
    assert.match(put.note, /적용하고 저장했어요 · revision 4/);
    assert.equal(put.name, '제작 파트너'); assert.equal(put.tone, TONES[1].id);
    assert.equal(await ev(`return window.__xss||0`), 0, `${width}px: the applied HTML-looking text never ran`);
    checks += 7;

    // 6. 429 and a flag turned off while open.
    await ev(`window.__prop={status:429,body:{error:'daily assistant budget used up; try again tomorrow',reason:'daily_cap'}};return 0`);
    await sendRequest('말투');
    assert.deepEqual(await ev(`return {note:${$('assist-note')}.textContent,card:${$('assist-card')}.hidden,hid:${$('assist')}.hidden}`), { note: '오늘 AI 제안 한도를 다 썼어요. 내일 다시 부탁해 주세요.', card: true, hid: false }, `${width}px: 429 copy`);
    await ev(`window.__prop={status:200,body:{revision:4,proposals:[],dropped:2,cost:{}}};return 0`);
    await sendRequest('말투');
    assert.match(await ev(`return ${$('assist-note')}.textContent`), /바꿀 만한 설정을 찾지 못했어요/, `${width}px: no proposal is explained calmly`);
    await ev(`window.__prop={status:502,body:{error:'assistant failed; nothing was changed'}};return 0`);
    await sendRequest('말투');
    assert.match(await ev(`return ${$('assist-note')}.textContent`), /아무것도 바뀌지 않았어요/, `${width}px: a failure is calm`);
    await ev(`window.__prop=null;window.__flag='off';return 0`);
    await sendRequest('말투');
    assert.equal(await ev(`return ${$('assist')}.hidden`), true, `${width}px: 404 on send hides the box`);
    await ev(`window.__flag='on';assistAvail.clear();controls();return 0`);
    await openDraft();
    await until(`return !${$('assist')}.hidden`, 'the box to come back');
    checks += 5;

    // 7. A frozen version being shown, or unsaved edits, disable the box.
    await ev(`${$('version')}.value='m1';${$('version-load')}.click();return 0`);
    await until(`return !${$('ai-preview-frozen')}.hidden`, 'the frozen summary');
    const frozen = await ev(`return {text:${$('assist-text')}.disabled,send:${$('assist-send')}.disabled,hint:${$('assist-hint')}.textContent,apply:${$('assist-apply')}.disabled}`);
    assert.deepEqual({ t: frozen.text, s: frozen.send, a: frozen.apply }, { t: true, s: true, a: true }, `${width}px: frozen version → box disabled`);
    assert.match(frozen.hint, /고정된 버전/);
    await openDraft();
    assert.equal(await ev(`return ${$('assist-text')}.disabled`), false, `${width}px: opening the draft again re-enables it`);
    await ev(`{const e=${$('title')};e.value='고친 제목';e.dispatchEvent(new Event('input',{bubbles:true}));}return 0`);
    const edited = await ev(`return {text:${$('assist-text')}.disabled,hint:${$('assist-hint')}.textContent}`);
    assert.equal(edited.text, true, `${width}px: unsaved edits disable the box`);
    assert.match(edited.hint, /저장하지 않은 편집/);
    checks += 5;
  }
  console.log(`PASS authoring-assistant.browser: ${checks} checks — flag off hides, one 300-char field, proposal card (field / 이전 / 새 값, values as text), Apply saves only proposed keys with expected_revision, 409 and 429 copy, 버리기 writes nothing, frozen/unsaved disables, 375/1280 layout`);
} finally {
  await b.close?.();
  server.close();
}
