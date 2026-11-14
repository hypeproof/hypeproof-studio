// CGP-AGENT-R-020 (Jay, 2026-11-14) — learner skill cards in Chalk authoring ("학생 스킬 카드"). Measured on the REAL served
// /authoring page in headless Chromium (CDP) at 1280 and 375 px, with the Service stubbed behind window.fetch:
//   1. the section sits after 시작 문장 with its nav link; the limits come from the features read (maxlength, counters, row count);
//   2. a card is saved only with all three fields; empty rows are dropped; the save carries `skill_cards` and re-opening reads it back;
//   3. a half-filled card, a link, a duplicate name, too many lines or a line with surrounding spaces blocks the save with a Korean message;
//   4. the preview, the rehearsal read and the impact lines show the cards; the frozen summary does not follow later edits;
//   5. no cards sends no key (never []); an older Service without `skill_cards` on the features read hides the section and sends none;
//   6. 44px targets and no horizontal scroll at both widths.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { TEST_CONNECT_SECRET, sessionCookie } from './harness/connect.mjs';
import { readFileSync } from 'node:fs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const PRESETS = JSON.parse(readFileSync(new URL('./fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const TONES = JSON.parse(readFileSync(new URL('./fixtures/assistant-tone-catalog.json', import.meta.url), 'utf8'));
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('skill-cards.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  skill-cards.browser (no headless Chromium)');
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
const LIMITS = { max_count: 6, name_max: 30, summary_max: 80, prompt_max: 300, prompt_max_lines: 6 };
const MODELS = { default: 'sonnet', choices: [{ alias: 'sonnet', label: 'Sonnet' }], effort: { default: 'medium', allowed: ['medium'] } };
const FEATURES = { choices: [{ key: 'read', label: '읽기' }], approval_presets: PRESETS, assistant_tones: TONES, skill_cards: LIMITS };
const OLD_FEATURES = { choices: FEATURES.choices, approval_presets: PRESETS, assistant_tones: TONES };
const FROZEN_CARDS = [{ name: '고정 카드', summary: '고정 설명', prompt: '고정 프롬프트' }];
const FROZEN = { schema: 'hps-session-design/1', steps: [{ id: 's1', instructions: 'a' }], skill_cards: FROZEN_CARDS };
const stub = `window.__puts=[];window.__saved=null;window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.includes('/models/'))return json(${JSON.stringify(MODELS)});
  if(p.includes('/features/'))return json(window.__old?${JSON.stringify(OLD_FEATURES)}:window.__limits?{...${JSON.stringify(FEATURES)},skill_cards:window.__limits}:${JSON.stringify(FEATURES)});
  if(p.includes('/versions/'))return json({module:{content:${JSON.stringify(FROZEN)}},source_revision:1,rehearsal:'passed',activated:false});
  if(m==='PUT'){const body=JSON.parse(init.body);window.__puts.push(body);window.__saved=body.content;return json({revision:body.expected_revision+1});}
  if(m==='GET'&&window.__saved)return json({profile_id:'p1',revision:1,content:window.__saved});
  return json({});};
  for(const [k,v] of [['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;return 0`;
const set = (id, v) => `{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}`;
const card = (i, name, summary, prompt) => `${set(`skill-card-${i}-name`, name)}${set(`skill-card-${i}-summary`, summary)}${set(`skill-card-${i}-prompt`, prompt)}`;
const clearCard = (i) => card(i, '', '', '');
async function loadCatalogues() {
  await ev(`document.getElementById('models-load').click();return 0`);
  await until(`return !busy && !document.getElementById('models-fields').disabled`, 'the models read');
  await ev(`document.getElementById('features-load').click();return 0`);
  await until(`return !busy && !document.getElementById('features-fields').disabled`, 'the features read');
}
/** Press save and return the status line when the save is refused (no PUT), or the saved content. */
async function trySave() {
  const before = await ev(`return window.__puts.length`);
  await ev(`document.getElementById('save').click();return 0`);
  await until(`return !busy`, 'the save attempt');
  const after = await ev(`return window.__puts.length`);
  return after > before ? { saved: await ev(`return window.__puts[window.__puts.length-1].content`) } : { refused: await ev(`return document.getElementById('status').textContent`) };
}
let checks = 0;
try {
  for (const width of [1280, 375]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState === 'complete' && typeof render === 'function' && !!document.getElementById('ai-skill-cards') && !!window.chalkConnection?.current?.connected`, '/authoring with the skill-card section');
    await ev(stub);
    await ev(`document.getElementById('new').disabled=false;document.getElementById('new').click();return 0`);
    await until(`return revision===0`, 'the new draft');
    await loadCatalogues();
    await ev(`${set('title', '스킬 수업')}${set('audience', '성인')}${set('objective', '목표')}${set('starter', '예제')}
      {const st=document.querySelector('.step');for(const [f,v] of [['title','1단계'],['instructions','안내'],['acceptance','끝']]){const e=st.querySelector('[data-field='+f+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}}return 0`);

    // 1. Placement, nav and limits.
    const shape = await ev(`const ids=[...document.querySelectorAll('#ai-settings>details.ai-section')].map(d=>d.id);const rows=[...document.querySelectorAll('#skill-cards-list>li')];
      return {after:ids.indexOf('ai-skill-cards')===ids.indexOf('ai-starters')+1,nav:[...document.querySelectorAll('#ai-nav a')].some(a=>a.getAttribute('href')==='#ai-skill-cards'&&a.textContent==='학생 스킬 카드'),
        rows:rows.length,max:[rows[0].querySelector('.skill-name').maxLength,rows[0].querySelector('.skill-summary').maxLength,rows[0].querySelector('.skill-prompt').maxLength],
        labels:[...rows[0].querySelectorAll('label>span')].map(s=>s.textContent),count:document.getElementById('skill-card-1-name-count').textContent,disclosure:document.getElementById('skill-cards-disclosure').textContent}`);
    assert.equal(shape.after, true, `${width}px: 학생 스킬 카드 follows 시작 문장`);
    assert.equal(shape.nav, true, `${width}px: the nav links the section`);
    assert.equal(shape.rows, 6, `${width}px: six card rows from the served limit`);
    assert.deepEqual(shape.max, [30, 80, 300], `${width}px: maxlength from the served limits`);
    assert.deepEqual(shape.labels, ['이름', '한 줄 설명', '시작 프롬프트 (최대 6줄)']);
    assert.equal(shape.count, '0/30');
    assert.match(shape.disclosure, /링크/);
    // A smaller served limit changes the rows and the caps, keeping what was typed.
    await ev(`${card(1, '유지', '설명', '프롬프트')}window.__limits={max_count:3,name_max:20,summary_max:40,prompt_max:120,prompt_max_lines:3};document.getElementById('features-load').click();return 0`);
    await until(`return !busy && document.querySelectorAll('#skill-cards-list>li').length===3`, 'the smaller limits');
    assert.deepEqual(await ev(`return [document.getElementById('skill-card-1-name').value,document.getElementById('skill-card-1-name').maxLength]`), ['유지', 20], `${width}px: re-rendered rows keep the typed card`);
    await ev(`window.__limits=null;document.getElementById('features-load').click();return 0`);
    await until(`return !busy && document.querySelectorAll('#skill-cards-list>li').length===6`, 'the default limits back');
    checks += 9;

    // 2. Round trip: two full cards and an empty row between them; trimmed; empty rows dropped; read back after re-open.
    await ev(`${card(1, '  요약 스킬 ', '긴 글을 세 줄로 줄여요', '아래 글을 세 줄로 요약해 줘.')}${clearCard(2)}${card(3, '질문 만들기', '확인 질문 세 개', '이 내용으로 확인 질문 세 개를 만들어 줘.\\n답은 아직 알려 주지 마.')}return 0`);
    const draft = await ev(`return content().skill_cards`);
    const expected = [{ name: '요약 스킬', summary: '긴 글을 세 줄로 줄여요', prompt: '아래 글을 세 줄로 요약해 줘.' }, { name: '질문 만들기', summary: '확인 질문 세 개', prompt: '이 내용으로 확인 질문 세 개를 만들어 줘.\n답은 아직 알려 주지 마.' }];
    assert.deepEqual(draft, expected, `${width}px: trimmed, empty rows dropped, order kept`);
    const pv = await ev(`return document.getElementById('ai-preview-draft').textContent`);
    assert.ok(pv.includes('1. 요약 스킬 — 긴 글을 세 줄로 줄여요 / 2. 질문 만들기 — 확인 질문 세 개'), `${width}px: the preview lists the cards — got ${pv}`);
    const first = await trySave();
    assert.ok(first.saved, `${width}px: the save went out — ${first.refused}`);
    assert.deepEqual(first.saved.skill_cards, expected, `${width}px: the save carries skill_cards`);
    await ev(`render({steps:[]});return 0`);
    assert.equal(await ev(`return document.getElementById('skill-card-1-name').value`), '', 'the form is empty before the re-open');
    await ev(`document.getElementById('load').click();return 0`);
    await until(`return document.getElementById('skill-card-1-name').value==='요약 스킬'`, 'the re-opened lesson');
    const back = await ev(`return [1,2,3].map(i=>['name','summary','prompt'].map(f=>document.getElementById('skill-card-'+i+'-'+f).value))`);
    assert.deepEqual(back, [[expected[0].name, expected[0].summary, expected[0].prompt], [expected[1].name, expected[1].summary, expected[1].prompt], ['', '', '']], `${width}px: cards read back in order`);
    checks += 6;

    // 3. Blocked saves, each with a Korean message naming the card.
    const blocked = [
      [card(3, '질문 만들기', '', '프롬프트'), /카드 3번의 한 줄 설명을 적어 주세요/],
      [card(3, '질문 만들기', '설명', '자세한 건 https://example.com 참고'), /카드 3번의 시작 프롬프트에는 링크/],
      [card(3, 'javascript:x', '설명', '프롬프트'), /카드 3번의 이름에는 링크/],
      [card(3, '요약 스킬', '설명', '프롬프트'), /카드 3번의 이름이 앞의 카드와 같습니다/],
      [card(3, '줄 많음', '설명', '1\\n2\\n3\\n4\\n5\\n6\\n7'), /6줄 이내/],
      [card(3, '공백 줄', '설명', '첫 줄\\n  들여쓴 줄'), /줄 앞뒤 공백/],
    ];
    for (const [js, re] of blocked) {
      await ev(`${js}return 0`);
      const r = await trySave();
      assert.ok(r.refused, `${width}px: ${re} must block the save`);
      assert.match(r.refused, re, `${width}px: message — got ${r.refused}`);
    }
    const dupWarn = await ev(`${card(3, 'ＳＵＭ', '설명', '프롬프트')}${card(2, 'sum', '설명', '프롬프트')}return document.getElementById('skill-cards-warning').textContent`);
    assert.match(dupWarn, /카드 3번이 앞의 카드와 이름이 같습니다/, `${width}px: a duplicate (NFKC, case-insensitive) is warned live`);
    await ev(`${clearCard(2)}${card(3, '질문 만들기', expected[1].summary, expected[1].prompt)}return 0`);
    checks += blocked.length * 2 + 1;

    // 4. Rehearsal read, impact and the frozen summary.
    await ev(`readiness={version:'m1',state:'not_run',content:${JSON.stringify(FROZEN)}};candidateVersion='m1';renderReadiness();return 0`);
    assert.ok((await ev(`return document.getElementById('readiness').textContent`)).includes('이 후보의 학생 스킬 카드: 1. 고정 카드 — 고정 설명'), `${width}px: the rehearsal read shows the frozen cards`);
    const imp = await ev(`return impactLines({steps:{added:[],removed:[]},skill_cards:{from:null,to:['요약 스킬','질문 만들기']}}).join('|')`);
    assert.ok(imp.includes('학생 스킬 카드: 없음 → 요약 스킬, 질문 만들기'), `${width}px: impact names the cards — got ${imp}`);
    await ev(`document.getElementById('version').value='m1';document.getElementById('version-load').click();return 0`);
    await until(`return !document.getElementById('ai-preview-frozen').hidden`, 'the frozen summary');
    const fz = await ev(`return document.getElementById('ai-preview-frozen-list').textContent`);
    assert.ok(fz.includes('1. 고정 카드 — 고정 설명'), `${width}px: the frozen summary lists its cards — got ${fz}`);
    await ev(`${set('skill-card-1-name', '바뀐 이름')}return 0`);
    assert.equal(await ev(`return document.getElementById('ai-preview-frozen-list').textContent`), fz, `${width}px: the frozen summary does not follow the draft`);
    await ev(`${set('skill-card-1-name', '요약 스킬')}return 0`);
    checks += 4;

    // 6. Targets and overflow.
    const g = await ev(`const q=s=>[...document.querySelectorAll(s)].map(e=>e.getBoundingClientRect());return {h:q('.skill-name,.skill-summary,.skill-prompt').map(r=>r.height),nav:q('#ai-nav-skill-cards a').map(r=>r.height),summ:q('#ai-skill-cards>summary').map(r=>r.height),
      right:Math.max(...q('#ai-skill-cards, #ai-skill-cards *').map(r=>r.right)),overflow:document.scrollingElement.scrollWidth-innerWidth}`);
    for (const h of [...g.h, ...g.nav, ...g.summ]) assert.ok(h >= 43.5, `${width}px: target ${h}px < 44`);
    assert.ok(g.overflow <= 0 && g.right <= width + 0.5, `${width}px: nothing past the viewport (${g.right}, overflow ${g.overflow})`);
    checks += 1 + g.h.length + g.nav.length + g.summ.length;

    // 5a. No cards: no key, never [].
    await ev(`${clearCard(1)}${clearCard(3)}return 0`);
    const none = await trySave();
    assert.ok(none.saved && !('skill_cards' in none.saved), `${width}px: no cards send no skill_cards key`);
    // 5b. An older Service: the section and its nav hide, and no key is sent even with a card typed.
    await ev(`${card(1, '하나', '설명', '프롬프트')}window.__old=true;document.getElementById('features-load').click();return 0`);
    await until(`return !busy && !skillServed()`, 'the older-Service features read');
    const old = await ev(`return {hidden:[document.getElementById('ai-skill-cards').hidden,document.getElementById('ai-nav-skill-cards').hidden],key:'skill_cards' in content(),preview:document.getElementById('ai-preview-draft').textContent}`);
    assert.deepEqual(old.hidden, [true, true], `${width}px: an older Service hides the section and its nav`);
    assert.equal(old.key, false, `${width}px: and sends no skill_cards`);
    assert.ok(!old.preview.includes('학생 스킬 카드'), `${width}px: the preview drops the row`);
    await ev(`window.__old=false;document.getElementById('features-load').click();return 0`);
    await until(`return !busy && skillServed()`, 'the limits to return');
    checks += 4;
  }
  console.log(`PASS skill-cards.browser: ${checks} checks — section after 시작 문장 with served limits, round trip through save and re-open, blocked saves with Korean messages, preview/rehearsal/impact/frozen, omitted when empty, older Service hides it, 44px at 1280 and 375 px`);
} finally {
  await b.close?.();
  server.close();
}
