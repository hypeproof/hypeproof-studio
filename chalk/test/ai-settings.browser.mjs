// CGP-AGENT-R-015 / CGP-AGENT-D-013 — one "수업 AI 설정" page in Chalk authoring. Measured on the REAL served /authoring
// page in headless Chromium (CDP) at 1280 and 375 px, with the Service stubbed behind window.fetch:
//   1. the six sections come in the D-013 order (정체성 → 지시문 → 모델·처리 수준 → 기능·승인 → 시작 문장 → 미리보기) and the section nav
//      lists the same order (DEC-30: role and tone live in 정체성, starters in 시작 문장, tones come from the served catalog);
//   2. every field round-trips: edited through the page's own controls, sent by the page's own 초안 저장 as the existing
//      hps-session-design/1 keys, and shown again after the page re-opens the saved lesson;
//   3. the preview is a read-only summary (no controls) that follows the draft;
//   4. a loaded frozen version is shown as text only and does not follow later draft edits;
//   5. 44px targets, no horizontal scroll, no overlapping sections at both widths;
//   6. DEC-30: role/tone/starters round-trip, an unset tone and empty starters send no key, duplicates are warned and block the save,
//      the preview, the rehearsal read and the frozen summary show the starters, the Service's 400 gets a Korean hint, and a Service
//      that serves no tone catalog (older build) hides the three inputs and sends none of them.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const PRESETS = JSON.parse(readFileSync(new URL('./fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const TONES = JSON.parse(readFileSync(new URL('./fixtures/assistant-tone-catalog.json', import.meta.url), 'utf8'));
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
const FEATURES = { choices: [{ key: 'read', label: '읽기' }, { key: 'write', label: '쓰기' }, { key: 'web_search', label: '웹 검색' }], approval_presets: PRESETS, assistant_tones: TONES };
const OLD_FEATURES = { choices: FEATURES.choices, approval_presets: PRESETS };
const FROZEN = { schema: 'hps-session-design/1', assistant: { display_name: '고정된 이름', role: '고정 역할', tone: TONES[1].id }, starters: ['고정 시작 하나', '고정 시작 둘'], steps: [{ id: 's1', instructions: 'a' }], model: { default: 'haiku', allowed: ['haiku'] }, features: { allowed: ['read'] }, approval_preset: 'always_ask' };
// Service stub: models/features reads, a saved draft that PUT writes and GET returns, and a frozen version.
const stub = `window.__puts=[];window.__saved=null;window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';if(window.__hold&&m==='GET'&&!p.includes('/models/')&&!p.includes('/features/')&&!p.includes('/versions/'))await window.__hold;
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.includes('/models/'))return json(${JSON.stringify(MODELS)});
  if(p.includes('/features/'))return json(window.__old?${JSON.stringify(OLD_FEATURES)}:${JSON.stringify(FEATURES)});
  if(p.includes('/versions/'))return json({module:{content:${JSON.stringify(FROZEN)}},source_revision:1,rehearsal:'passed',activated:false});
  if(m==='PUT'&&window.__fail){window.__puts.push(JSON.parse(init.body));return json({error:window.__fail},400);}
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
    assert.deepEqual(order.names, ['정체성', '지시문', '모델·처리 수준', '기능·승인', '시작 문장', '미리보기'], `${width}px: section order`);
    assert.deepEqual(order.nav, order.names.map((n, i) => [n, '#' + order.ids[i]]), `${width}px: nav follows the same order and targets the sections`);
    assert.equal(order.legend, '수업 AI 설정');
    // Each field sits in its section.
    const where = await ev(`const inS=(id,sel)=>!!document.querySelector('#'+id+' '+sel);return [['ai-identity','#assistant_name'],['ai-instructions','#steps'],['ai-model','#model-mode'],['ai-model','#effort-mode'],['ai-features','#feature-mode'],['ai-features','#approval-choices'],['ai-identity','#assistant_role'],['ai-identity','#tone-choices'],['ai-starters','#ai-starter-4'],['ai-preview','#ai-preview-draft']].map(([i,s])=>inS(i,s))`);
    assert.deepEqual(where, where.map(() => true), `${width}px: each control lives in its section`);
    checks += 12;

    // 2. Round trip through the page's own controls, save, and re-open.
    await ev(`document.getElementById('new').disabled=false;document.getElementById('new').click();return 0`);
    await until(`return document.querySelectorAll('.step').length===1 && !!revision===false || revision===0`, 'the new draft');
    await loadCatalogues();
    const set = (id, v) => `{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}`;
    await ev(`${set('title', '첫 수업')}${set('audience', '초등')}${set('objective', '목표')}${set('starter', '예제')}${set('assistant_name', '제작 파트너')}${set('assistant_role', '글쓰기 코치')}${set('ai-starter-1', '  첫 문장을 같이 써 줘 ')}${set('ai-starter-3', '다음 단계가 뭐야?')}
      {const st=document.querySelector('.step');for(const [f,v] of [['title','1단계'],['instructions','이렇게 도와 주세요'],['hint','힌트'],['acceptance','끝']]){const e=st.querySelector('[data-field='+f+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}}
      ${set('model-mode', 'choice')}${set('model-default', 'haiku')}
      for(const i of document.querySelectorAll('#model-allowed input'))i.checked=true;document.getElementById('model-allowed').dispatchEvent(new Event('change',{bubbles:true}));
      ${set('effort-mode', 'fixed')}${set('effort-default', 'high')}
      ${set('feature-mode', 'narrow')}
      for(const i of document.querySelectorAll('#feature-allowed input'))i.checked=i.value!=='write';document.getElementById('feature-allowed').dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('#approval-choices input[value=before_changes]').click();document.querySelector('#tone-choices input[value=playful]').click();return 0`);
    const draft = await ev(`return content()`);
    assert.equal(draft.assistant.display_name, '제작 파트너');
    assert.equal(draft.steps[0].instructions, '이렇게 도와 주세요');
    assert.deepEqual(draft.model, { default: 'haiku', allowed: ['sonnet', 'haiku'], effort: { default: 'high', allowed: ['high'] } });
    assert.deepEqual(draft.features, { allowed: ['read', 'web_search'] });
    assert.equal(draft.approval_preset, 'before_changes');
    assert.deepEqual(draft.assistant, { display_name: '제작 파트너', role: '글쓰기 코치', tone: 'playful' }, `${width}px: role and tone ride inside assistant`);
    assert.deepEqual(draft.starters, ['첫 문장을 같이 써 줘', '다음 단계가 뭐야?'], `${width}px: starters are trimmed, empty rows dropped, order kept`);
    // 3. The preview mirrors the draft, as text, with no controls.
    const pv = await ev(`const l=document.getElementById('ai-preview-draft');return {text:l.textContent,controls:document.querySelectorAll('#ai-preview input,#ai-preview select,#ai-preview textarea,#ai-preview button').length}`);
    for (const piece of ['제작 파트너', '안내를 쓴 단계 1개', 'Haiku 기본', 'High (고정)', '읽기, 웹 검색', '바꾸기 전에 묻기', '글쓰기 코치', TONES[2].label, '1. 첫 문장을 같이 써 줘 / 2. 다음 단계가 뭐야?']) assert.ok(pv.text.includes(piece), `${width}px: preview shows ${piece} — got ${pv.text}`);
    assert.equal(pv.controls, 0, `${width}px: the preview has no controls`);
    // Save with the page's own button; the body carries the existing keys.
    await ev(`document.getElementById('save').click();return 0`);
    await until(`return window.__puts.length===1 && dirty===false`, 'the draft save');
    const sent = await ev(`return window.__puts[0]`);
    assert.equal(sent.content.schema, 'hps-session-design/1');
    assert.deepEqual({ a: sent.content.assistant, m: sent.content.model, f: sent.content.features, p: sent.content.approval_preset, i: sent.content.steps[0].instructions }, { a: draft.assistant, m: draft.model, f: draft.features, p: draft.approval_preset, i: '이렇게 도와 주세요' }, `${width}px: the save carries every AI setting under its existing key`);
    assert.deepEqual(sent.content.starters, draft.starters, `${width}px: the save carries the starters under the top-level starters key`);
    assert.deepEqual(Object.keys(sent.content).filter((k) => /starter_prompts|conversation|tone|role/.test(k)), [], `${width}px: no invented contract key (role and tone live inside assistant)`);
    // Re-open: wipe the form, load the saved lesson, and read the controls back.
    await ev(`render({steps:[]});for(const id of ['assistant_name','title'])document.getElementById(id).value='';return 0`);
    assert.equal(await ev(`return document.getElementById('assistant_name').value`), '', `${width}px: the form is empty before the re-open`);
    // While a job is in progress (the load request is held open) every AI setting is locked; it unlocks when the job ends.
    await ev(`window.__hold=new Promise(r=>{window.__release=r});document.getElementById('load').click();return 0`);
    await until(`return busy===true`, 'the load to be in progress');
    const locked = await ev(`return {fieldset:document.getElementById('ai-settings').disabled,controls:['assistant_name','model-mode','feature-mode','add','save'].map(id=>document.getElementById(id).matches(':disabled')),step:document.querySelectorAll('#steps :is(input,textarea,select,button)').length>=0&&[...document.querySelectorAll('#steps :is(input,textarea,select,button)')].every(e=>e.matches(':disabled'))}`);
    assert.equal(locked.fieldset, true, `${width}px: the AI settings fieldset is locked while a job runs`);
    assert.deepEqual(locked.controls, [true, true, true, true, true], `${width}px: AI controls are disabled while a job runs`);
    assert.equal(locked.step, true, `${width}px: the step editor is locked too`);
    await ev(`window.__hold=null;window.__release();return 0`);
    await until(`return busy===false && !document.getElementById('ai-settings').disabled`, 'the lock to release');
    checks += 4;
    await until(`return document.getElementById('assistant_name').value==='제작 파트너'`, 'the re-opened lesson');
    await loadCatalogues();
    const back = await ev(`return {role:assistant_role.value,tone:document.querySelector('#tone-choices input:checked').value,st:[...document.querySelectorAll('.ai-starter')].map(e=>e.value),name:assistant_name.value,instr:document.querySelector('.step [data-field=instructions]').value,mode:document.getElementById('model-mode').value,def:document.getElementById('model-default').value,
      em:document.getElementById('effort-mode').value,ed:document.getElementById('effort-default').value,fm:document.getElementById('feature-mode').value,
      fs:[...document.querySelectorAll('#feature-allowed input:checked')].map(i=>i.value),ap:document.querySelector('#approval-choices input:checked').value}`);
    assert.deepEqual(back, { role: '글쓰기 코치', tone: 'playful', st: ['첫 문장을 같이 써 줘', '다음 단계가 뭐야?', '', ''], name: '제작 파트너', instr: '이렇게 도와 주세요', mode: 'choice', def: 'haiku', em: 'fixed', ed: 'high', fm: 'narrow', fs: ['read', 'web_search'], ap: 'before_changes' }, `${width}px: every setting reads back from the saved lesson`);
    checks += 17;

    // 4. A frozen version is text only and does not follow later edits.
    await ev(`document.getElementById('version').value='m1';document.getElementById('version-load').click();return 0`);
    await until(`return !document.getElementById('ai-preview-frozen').hidden`, 'the frozen summary');
    const fz = await ev(`const box=document.getElementById('ai-preview-frozen');return {title:document.getElementById('ai-preview-frozen-title').textContent,text:document.getElementById('ai-preview-frozen-list').textContent,controls:box.querySelectorAll('input,select,textarea,button,[contenteditable]').length}`);
    assert.match(fz.title, /고정된 버전 m1 — 읽기 전용/);
    for (const piece of ['고정된 이름', 'Haiku (고정)', '읽기', '항상 묻기', '고정 역할', TONES[1].label, '1. 고정 시작 하나 / 2. 고정 시작 둘']) assert.ok(fz.text.includes(piece), `${width}px: frozen shows ${piece} — got ${fz.text}`);
    assert.equal(fz.controls, 0, `${width}px: a frozen version has no controls`);
    await ev(`${set('assistant_name', '다음 초안 이름')}return 0`);
    const after = await ev(`return {frozen:document.getElementById('ai-preview-frozen-list').textContent,draft:document.getElementById('ai-preview-draft').textContent}`);
    assert.equal(after.frozen, fz.text, `${width}px: editing the draft leaves the frozen summary alone`);
    assert.ok(after.draft.includes('다음 초안 이름'), `${width}px: the draft preview follows the edit`);
    checks += 8;

    // 6a. Rehearsal read: the frozen candidate's starters are shown (the Service sends the full content with the read).
    await ev(`readiness={version:'m1',state:'not_run',content:${JSON.stringify(FROZEN)}};candidateVersion='m1';renderReadiness();return 0`);
    const rh = await ev(`return document.getElementById('readiness').textContent`);
    assert.ok(rh.includes('이 후보의 시작 문장: 1. 고정 시작 하나 / 2. 고정 시작 둘'), `${width}px: rehearsal read shows starters — got ${rh}`);
    assert.ok(rh.includes('고정 역할') && rh.includes(TONES[1].label), `${width}px: rehearsal read shows role and tone`);
    // The impact list names the three changes.
    const imp = await ev(`return impactLines({steps:{added:[],removed:[]},assistant_role:{from:null,to:'코치'},assistant_tone:{from:null,to:'calm'},starters:{from:null,to:['가','나']}}).join('|')`);
    assert.match(imp, /AI 역할: 없음 → 코치\|AI 말투: 코호트 기본 → 차분하게\|시작 문장: 없음 → 1\. 가 \/ 2\. 나/, `${width}px: impact lines`);
    checks += 3;

    // 6b. Minor lesson note, counters, duplicate warning blocks the save, 400 hint, then unset sends no key.
    await ev(`${set('audience_tier', 'lv1')}return 0`);
    const note = await ev(`return {status:document.getElementById('tone-status').textContent,rows:[...document.querySelectorAll('#tone-choices label')].map(l=>l.textContent)}`);
    assert.match(note.status, /미성년자 대상이라 이 말투는 학생에게 적용되지 않고/, `${width}px: minor lesson + non-minor-safe tone is flagged — got ${note.status}`);
    assert.ok(note.rows.filter((t) => t.includes('미성년자 수업')).length === 2, `${width}px: exactly the two non-minor-safe rows carry the minor note`);
    assert.equal(note.rows[0].startsWith('코호트 기본'), true, `${width}px: unset is the first choice`);
    await ev(`${set('audience_tier', '')}return 0`);
    await ev(`${set('ai-starter-2', 'ＡＢＣ')}${set('ai-starter-4', 'abc')}return 0`);
    const dup = await ev(`return {w:document.getElementById('starters-warning').textContent,c:document.getElementById('ai-starter-2-count').textContent,r:document.getElementById('assistant_role-count').textContent}`);
    assert.match(dup.w, /시작 문장 4번이 앞의 문장과 같습니다/, `${width}px: duplicate (NFKC, case-insensitive) is warned — got ${dup.w}`);
    assert.equal(dup.c, '3/80'); assert.equal(dup.r, '6/80');
    const putsBefore = await ev(`return window.__puts.length`);
    await ev(`document.getElementById('save').click();return 0`);
    await until(`return !busy && /같은 문장|앞의 문장/.test(document.getElementById('status').textContent)`, 'the duplicate refusal');
    assert.equal(await ev(`return window.__puts.length`), putsBefore, `${width}px: a duplicate blocks the save before any request`);
    await ev(`${set('ai-starter-4', '')}return 0`);
    {
      await ev(`window.__fail='starters[1] duplicates an earlier starter';document.getElementById('save').click();return 0`);
      await until(`return !busy && /HTTP 400/.test(document.getElementById('status').textContent)`, 'the 400');
      const st = await ev(`return document.getElementById('status').textContent`);
      assert.match(st, /시작 문장을 확인하세요/, `${width}px: the Service 400 gets a Korean starters hint — got ${st}`);
      await ev(`window.__fail='assistant.role must be at most 80 characters';document.getElementById('save').click();return 0`);
      await until(`return !busy && /assistant\\.role/.test(document.getElementById('status').textContent)`, 'the role 400');
      assert.match(await ev(`return document.getElementById('status').textContent`), /AI 역할을 확인하세요/);
      await ev(`window.__fail='invalid session-design fields';document.getElementById('save').click();return 0`);
      await until(`return !busy && /invalid session-design fields/.test(document.getElementById('status').textContent)`, 'the old-Service 400');
      assert.match(await ev(`return document.getElementById('status').textContent`), /아직 받지 않습니다/, `${width}px: an older Service gets the hint`);
      await ev(`window.__fail=null;return 0`);
    }
    // Unset: clear role, tone (pick 코호트 기본) and every starter; the next save carries none of the three keys.
    await ev(`${set('assistant_role', '')}${set('ai-starter-1', '')}${set('ai-starter-2', '')}${set('ai-starter-3', '')}[...document.querySelectorAll('#tone-choices input')].find(i=>i.value==='').click();document.getElementById('save').click();return 0`);
    await until(`return window.__puts.length>=${putsBefore + 4} && !busy`, 'the unset save');
    const unset = await ev(`return window.__puts[window.__puts.length-1].content`);
    assert.deepEqual(unset.assistant, { display_name: '다음 초안 이름' }, `${width}px: unset role and tone send no key`);
    assert.ok(!('starters' in unset), `${width}px: empty starters are omitted, never []`);
    checks += 12;

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
    // DEC-30 targets: the role input, every starter input, every tone row and the 시작 문장 nav link are 44px, and nothing is wider than the viewport.
    const hs = await ev(`const q=s=>[...document.querySelectorAll(s)].map(e=>e.getBoundingClientRect());return {role:q('#assistant_role').map(r=>r.height),st:q('.ai-starter').map(r=>r.height),tone:q('#tone-choices label').map(r=>r.height),nav:q('#ai-nav-starters a').map(r=>r.height),right:Math.max(...q('#assistant_role, .ai-starter, #tone-choices label, #starters-warning, #starters-disclosure, .counter').map(r=>r.right))}`);
    for (const h of [...hs.role, ...hs.st, ...hs.tone, ...hs.nav]) assert.ok(h >= 43.5, `${width}px: DEC-30 target ${h}px < 44`);
    assert.equal(hs.st.length, 4); assert.equal(hs.tone.length, 5);
    assert.ok(hs.right <= width + 0.5, `${width}px: a DEC-30 element reaches ${hs.right}px`);
    checks += 3 + hs.role.length + hs.st.length + hs.tone.length + hs.nav.length;

    // 7. An older Service serves no tone catalog: the three inputs hide and none of the three keys is sent.
    await ev(`${set('assistant_role', '글쓰기 코치')}${set('ai-starter-1', '하나')}window.__old=true;document.getElementById('features-load').click();return 0`);
    await until(`return !busy && !styleServed()`, 'the older-Service features read');
    const old = await ev(`const c=content();return {hidden:[document.getElementById('style-identity').hidden,document.getElementById('ai-starters').hidden,document.getElementById('ai-nav-starters').hidden],sections:[...document.querySelectorAll('#ai-settings>details.ai-section')].filter(d=>d.getBoundingClientRect().height>0).length,keys:Object.keys(c).filter(k=>k==='starters'),a:c.assistant,preview:document.getElementById('ai-preview-draft').textContent}`);
    assert.deepEqual(old.hidden, [true, true, true], `${width}px: older Service hides role/tone, 시작 문장 and its nav link`);
    assert.equal(old.sections, 5); assert.deepEqual(old.keys, []);
    assert.deepEqual(old.a, { display_name: '다음 초안 이름' }, `${width}px: older Service gets no role/tone`);
    assert.ok(!old.preview.includes('시작 문장'), `${width}px: the preview drops the rows too`);
    await ev(`window.__old=false;document.getElementById('features-load').click();return 0`);
    await until(`return !busy && styleServed() && !!toneCatalog()`, 'the catalog to return');
    checks += 6;
  }
  console.log(`PASS ai-settings.browser: ${checks} checks — D-013 section order and nav, every setting round-trips through save and re-open, read-only preview, frozen version as text, DEC-30 role/tone/starters (round trip, unset, duplicates, 400 hint, preview/rehearsal/frozen, older Service), 44px/no overlap at 375 and 1280`);
} finally {
  await b.close?.();
  server.close();
}
