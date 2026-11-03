// CH-01 first-run audience (CGP-LEARN-R-014, DES-CGP-LEARN-14): Chalk asks the instructor once for grade band and subject and pre-fills
// a NEW lesson's 대상 and audience_tier. Behaviour and computed geometry of the REAL served /authoring page in headless
// Chromium (CDP). The page is served from a local http origin so localStorage behaves as in a browser (persistence
// across reloads is what "asked once" means). Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI)
// a missing browser fails. Never opens a window or sends OS input: clicks are DOM clicks inside the headless page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('first-run-audience.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  first-run-audience.browser (no headless Chromium)');
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function go(width = 1280) {
  await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: origin + '/authoring' });
  for (let i = 0; i < 100; i++) { await wait(50); if (await b.evaluate(`document.readyState==='complete'&&!!document.getElementById('first-run')`).catch(() => false)) break; }
  await b.evaluate(`window.confirm=()=>true;0`);
}
const ev = (js) => b.evaluate(`(() => { ${js} })()`);
const visible = () => ev(`return !document.getElementById('first-run').hidden && document.getElementById('first-run').getBoundingClientRect().height > 0`);
// A new lesson the way an instructor makes one: connection fields filled, then the page's own 새 강의 만들기 button.
const newLesson = () => ev(`for (const [k,v] of [['token','t'],['cohort','c1'],['profile','p1']]) document.getElementById(k).value=v;
  document.getElementById('new').click(); return null;`).then(() => wait(50)).then(() => ev(`const c=content(); return { audience: document.getElementById('audience').value, tier: document.getElementById('audience_tier').value, contentAudience: c.audience, hasTier: 'audience_tier' in c, contentTier: c.audience_tier ?? null, status: document.getElementById('status').textContent };`));
let checks = 0;
try {
  // 1. First run: the question is on the page, seven grade bands in order, an editable subject list.
  await go();
  await ev(`localStorage.clear(); return 0`);
  await go();
  assert.equal(await visible(), true, 'first visit shows the first-run question');
  const grades = await ev(`return [...document.querySelectorAll('#fr-grade input[type=radio]')].map(i=>i.value)`);
  assert.deepEqual(grades, ['유아', '초 1–2', '초 3–4', '초 5–6', '중', '고', '성인'], 'grade band options (a)');
  assert.ok((await ev(`return document.querySelectorAll('#fr-subjects input[type=checkbox]').length`)) >= 9, 'preset subjects are listed');
  checks += 3;

  // 2. Geometry (DES-CGP-LEARN-14): chips and buttons >= 44px, chip text >= 14px, no horizontal scroll at 375 and 1280.
  for (const width of [1280, 375]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(50);
    const g = await ev(`const box=document.getElementById('first-run');
      return { overflow: document.scrollingElement.scrollWidth - innerWidth, boxRight: box.getBoundingClientRect().right - innerWidth,
        targets: [...box.querySelectorAll('.fr-chips label, button')].map(e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return { name: e.textContent.trim(), h: r.height, w: r.width, right: r.right, font: parseFloat(s.fontSize), chip: e.tagName==='LABEL', bg: s.backgroundColor, clipped: e.scrollWidth > e.clientWidth + 1 }; }) }`);
    assert.ok(g.overflow <= 0, `${width}px: page scrolls horizontally by ${g.overflow}px`);
    assert.ok(g.boxRight <= 0, `${width}px: first-run panel overflows the viewport`);
    assert.ok(g.targets.length >= 18, `${width}px: chips and buttons are measured (${g.targets.length})`);
    for (const t of g.targets) {
      assert.ok(t.h >= 43.5, `${width}px ${t.name}: target ${t.h}px < 44`);
      assert.ok(t.right <= width + 0.5, `${width}px ${t.name}: past the viewport`);
      assert.ok(!t.clipped, `${width}px ${t.name}: label clipped`);
      if (t.chip) assert.ok(t.font >= 14, `${width}px ${t.name}: chip text ${t.font}px < 14`);
    }
    const later = g.targets.find((t) => t.name === '나중에');
    assert.ok(later && /rgba\(0, 0, 0, 0\)|transparent/.test(later.bg), `${width}px: 나중에 is a quiet text button, not a filled one (${later?.bg})`);
    checks += g.targets.length + 3;

    // DES-CGP-LEARN-14 (CGP-LEARN-D-014): one screen with exactly two questions, all on view together with no step,
    // 다음 or dialog; 나중에 is a text button (no fill, no visible border) next to the filled 저장; a chip shows a focus ring.
    const s = await ev(`const box=document.getElementById('first-run'), shown=e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden';};
      const qs=[...box.querySelectorAll('fieldset')], later=getComputedStyle(document.getElementById('fr-later')), save=getComputedStyle(document.getElementById('fr-save'));
      const chip=box.querySelector('.fr-chips input'); chip.focus(); const f=getComputedStyle(chip);
      return { questions: qs.map(q=>q.querySelector('legend').textContent.split(' — ')[0]), allShown: [...qs,document.getElementById('fr-save'),document.getElementById('fr-later')].every(shown),
        hiddenParts: [...box.querySelectorAll('section,fieldset,div')].filter(e=>e.hidden).length, buttons: [...box.querySelectorAll('button')].map(e=>e.textContent.trim()),
        dialog: box.matches('dialog,[role=dialog],[aria-modal]')||getComputedStyle(box).position==='fixed',
        later: [later.backgroundColor, later.borderTopColor, later.borderBottomColor], save: save.backgroundColor,
        focus: [f.outlineStyle, parseFloat(f.outlineWidth)] };`);
    assert.deepEqual(s.questions, ['학년대', '과목'], `${width}px: exactly two questions (grade band, subject)`);
    assert.ok(s.allShown, `${width}px: both questions, 저장 and 나중에 are on view together (one screen)`);
    assert.equal(s.hiddenParts, 0, `${width}px: no hidden step inside the first-run panel`);
    assert.deepEqual(s.buttons.filter((t) => t !== '빼기'), ['과목 목록에 추가', '저장', '나중에'], `${width}px: no 다음/step buttons`);
    assert.equal(s.dialog, false, `${width}px: inline section, not a modal`);
    for (const c of s.later.slice(1)) assert.match(c, /rgba\(\d+, \d+, \d+, 0\)|transparent/, `${width}px: 나중에 has no visible border (${c})`);
    assert.doesNotMatch(s.save, /rgba\(\d+, \d+, \d+, 0\)|transparent/, `${width}px: 저장 stays the filled primary`);
    assert.ok(s.focus[0] !== 'none' && s.focus[1] >= 2, `${width}px: a focused chip shows a ≥2px focus ring (${s.focus})`);
    checks += 8;
  }
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 3. Skip (c): 나중에 records the answer, the question does not come back, and a new lesson stays empty.
  await ev(`document.getElementById('fr-later').click(); return 0`);
  assert.equal(await visible(), false, '나중에 closes the question');
  await go();
  assert.equal(await visible(), false, 'a skipped first run is not asked again after reload (asked once)');
  let n = await newLesson();
  assert.deepEqual([n.audience, n.tier, n.hasTier], ['', '', false], 'skip leaves 대상 and audience_tier empty, not defaulted (c)');
  assert.equal(n.contentAudience, '', 'the saved body carries an empty 대상');
  assert.match(await ev(`return document.getElementById('fr-summary').textContent`), /기본 대상 없음/);
  checks += 5;

  // 4. Answer (b): grade + preset + a typed subject (hostile characters stripped), saved once, pre-filled into a new lesson.
  await ev(`localStorage.clear(); return 0`);
  await go();
  assert.equal(await visible(), true, 'cleared storage asks again');
  await ev(`document.querySelector('#fr-grade input[value="초 3–4"]').click();
    document.querySelector('#fr-subjects input[value="과학"]').click();
    document.getElementById('fr-subject-new').value='  코딩\\u202E\\u200B\\u2028 ';
    document.getElementById('fr-subject-add').click();
    document.getElementById('fr-subject-new').value='과학';
    document.getElementById('fr-subject-add').click();
    return 0`);
  const listed = await ev(`return [...document.querySelectorAll('#fr-subjects input')].map(i=>[i.value,i.checked])`);
  assert.deepEqual(listed.filter(([, c]) => c).map(([v]) => v), ['과학', '코딩'], 'typed subject is cleaned, added once and chosen; a duplicate is not added');
  assert.equal(listed.filter(([v]) => v === '과학').length, 1, 'duplicate subject is not listed twice');
  // The custom subject can be removed from the list again (editable list), then re-added.
  await ev(`document.querySelector('#fr-subjects .fr-custom button').click(); return 0`);
  assert.equal(await ev(`return [...document.querySelectorAll('#fr-subjects input')].some(i=>i.value==='코딩')`), false, '빼기 removes a typed subject');
  await ev(`document.getElementById('fr-subject-new').value='코딩'; document.getElementById('fr-subject-add').click(); document.getElementById('fr-save').click(); return 0`);
  assert.equal(await visible(), false, '저장 closes the question');
  const stored = JSON.parse(await ev(`return localStorage.getItem('chalk.instructor-defaults/1')`));
  assert.deepEqual(stored, { v: 1, skipped: false, grade: '초 3–4', subjects: ['과학', '코딩'], custom: ['코딩'] }, 'only the answer is stored');
  await go();
  assert.equal(await visible(), false, 'an answered first run is not asked again after reload');
  n = await newLesson();
  assert.equal(n.audience, '초 3–4 · 과학, 코딩', '대상 (CH-01) is pre-filled from grade band and subjects');
  assert.equal(n.tier, 'lv1', 'audience_tier is pre-filled from the grade band');
  assert.equal(n.contentTier, 'lv1', 'the saved body carries audience_tier');
  assert.match(n.status, /기본 대상으로/, 'the page says what it filled');
  // Editable per lesson: the instructor changes both; the body follows the form, and clearing the tier drops the key.
  n = await ev(`document.getElementById('audience').value='중 2 · 과학 동아리'; document.getElementById('audience_tier').value=''; const c=content(); return { a: c.audience, has: 'audience_tier' in c };`);
  assert.deepEqual(n, { a: '중 2 · 과학 동아리', has: false }, 'pre-filled values are editable per lesson');
  checks += 10;

  // 5. Only a NEW lesson is pre-filled: an opened draft keeps its own values, an unknown tier is kept and named.
  n = await ev(`render({steps:[]}); const e=content(); return [document.getElementById('audience').value, 'audience_tier' in e];`);
  assert.deepEqual(n, ['', false], 'an opened draft with an empty 대상 and no tier is not pre-filled either');
  n = await ev(`render({audience:'기존 대상',steps:[]}); const a=content(); render({audience:'성인반',audience_tier:'lv2',steps:[]}); const b=content(); render({audience:'x',audience_tier:'pro',steps:[]}); const c=content();
    return { a: [a.audience, 'audience_tier' in a], b: [b.audience, b.audience_tier], c: c.audience_tier, kept: document.getElementById('audience_tier').selectedOptions[0].textContent };`);
  assert.deepEqual(n.a, ['기존 대상', false], 'an opened draft without a tier is not pre-filled');
  assert.deepEqual(n.b, ['성인반', 'lv2'], 'an opened draft keeps its tier');
  assert.equal(n.c, 'pro', 'an unknown stored tier is preserved, never silently replaced');
  assert.match(n.kept, /지원 전 값 유지: pro/);
  checks += 5;

  // 6. Grade → tier for every band; 유아 has no tier in the Service vocabulary and stays empty.
  for (const [grade, tier] of [['유아', ''], ['초 1–2', 'lv1'], ['초 5–6', 'lv1'], ['중', 'lv2'], ['고', 'lv2'], ['성인', 'adult']]) {
    await ev(`localStorage.setItem('chalk.instructor-defaults/1', JSON.stringify({v:1,skipped:false,grade:${JSON.stringify(grade)},subjects:[],custom:[]})); return 0`);
    n = await newLesson();
    assert.deepEqual([n.audience, n.tier], [grade, tier], `${grade} → ${tier || '(none)'}`);
    checks++;
  }
  // Stored junk is not trusted: an unknown grade or subject is dropped, corrupt JSON asks again.
  await ev(`localStorage.setItem('chalk.instructor-defaults/1', JSON.stringify({v:1,skipped:false,grade:'대학원',subjects:['<b>x</b>'],custom:[]})); return 0`);
  n = await newLesson();
  assert.deepEqual([n.audience, n.tier], ['', ''], 'unknown stored values pre-fill nothing');
  await ev(`localStorage.setItem('chalk.instructor-defaults/1', '{'); return 0`);
  await go();
  assert.equal(await visible(), true, 'corrupt storage asks again');
  checks += 2;

  // 7. Reopen: 기본 대상 바꾸기 shows the saved answer; 나중에 then changes nothing.
  await ev(`localStorage.setItem('chalk.instructor-defaults/1', JSON.stringify({v:1,skipped:false,grade:'고',subjects:['정보'],custom:[]})); return 0`);
  await go();
  await ev(`document.getElementById('fr-open').click(); return 0`);
  assert.equal(await visible(), true);
  assert.deepEqual(await ev(`return [...document.querySelectorAll('#first-run input:checked')].map(i=>i.value)`), ['고', '정보'], 'reopened question shows the saved answer');
  await ev(`document.querySelector('#fr-grade input[value="중"]').click(); document.getElementById('fr-later').click(); return 0`);
  assert.equal(JSON.parse(await ev(`return localStorage.getItem('chalk.instructor-defaults/1')`)).grade, '고', '나중에 on a reopened question keeps the saved answer');
  checks += 3;
} finally {
  await b.close();
  server.close();
}

// 8. No storage (opaque origin): the page still asks, and skipping works in memory without throwing.
{
  const c = await launch(bin);
  try {
    const { default: app2 } = await import('../src/index.ts');
    const html = await (await app2.fetch(new Request('https://chalk.test/authoring'), { ENVIRONMENT: 'test' })).text();
    await c.load(html, { width: 1280, height: 900 });
    assert.equal(await c.evaluate(`(() => { try { localStorage.length; return 'storage'; } catch { return 'no-storage'; } })()`), 'no-storage', 'about:blank has no storage');
    assert.equal(await c.evaluate(`!document.getElementById('first-run').hidden`), true, 'no storage: the question is shown');
    await c.evaluate(`document.getElementById('fr-later').click();0`);
    assert.equal(await c.evaluate(`document.getElementById('first-run').hidden`), true, 'no storage: 나중에 still closes it');
    checks += 3;
  } finally { await c.close(); }
}
console.log(`PASS first-run-audience.browser: ${checks} checks — asked once, skip leaves fields empty, answer pre-fills 대상 and audience_tier of a new lesson only, 44px/14px at 375 and 1280`);
