// CGP-LEARN-R-015 / REQ-CGP-LEARN-15 — Chalk's completion checklist helper produces observable "무엇을 만들면 끝인가"
// items and never points or grade levels (OUT-05, SX-35).
//   1. the kit: positive controls pass (ordinary words that contain 점), negative controls fail (점수, 10점, 등급, 우수,
//      미흡, SX-35 labels), invisible/bidi/fullwidth tricks cannot split a word past the check;
//   2. the helper sentence: "첫 화면 시안 1개" becomes "첫 화면 시안 1개를 만들면 끝"; a clause is refused, not glued;
//   3. Chalk's forwarder refuses a draft PUT whose completion item carries a grading word (422, nothing reaches the
//      Service) and forwards a clean draft untouched;
//   4. the served /authoring page, in headless Chromium: the save check refuses a grading word and names the field, the
//      helper button rewrites the row. Without a browser this part prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 fails instead.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const { completionChecklistKit, completionProblems, COMPLETION_CHECKLIST_SCRIPT } = await import('../src/lib/completion-checklist.ts');
const { default: chalk } = await import('../src/index.ts');
const kit = completionChecklistKit();
let n = 0;
const ok = (name) => { n++; console.log('PASS ' + name); };

// ---------- 1. grading words ----------
const CLEAN = [
  '첫 화면 시안 1개를 만들면 끝',
  '두 안의 차이점 2개를 적으면 끝',
  '장점과 단점을 한 줄씩 적은 메모를 만들면 끝',
  '버튼 3개를 점검한 목록을 만들면 끝',
  '점선으로 나눈 화면 1개를 만들면 끝',
  '추가 점검 메모를 만들면 끝',
  '추가점검 메모를 만들면 끝',
  '내 관점을 적은 소개 문단을 만들면 끝',
];
for (const t of CLEAN) assert.equal(kit.gradingWord(t), null, 'positive control must pass: ' + t);
ok('ordinary observable sentences, including words with 점 (차이점·점검·점선·관점), pass');

const GRADED = [
  ['10점 이상 받으면 끝', '점'], ['3 점짜리 화면', '점'], ['１０점', '점'], ['점수가 80 넘으면 끝', '점수'], ['만점 받기', '만점'],
  ['B등급 이상', '등급'], ['우수한 결과물을 만들면 끝', '우수'], ['미흡하면 다시', '미흡'], ['개선 필요 없음', '개선 필요'],
  ['완성도 높음', '높음'], ['상위 10% 안에 들기', '상위 N%'], ['역량부족 없이', '역량 부족'], ['ai 활용 고수 되기', 'AI 활용 고수'],
  ['채점 기준표 만들기', '채점'], ['총점 확인', '총점'],
  // Invisible and bidi characters are removed before matching, so they cannot split a word.
  ['등\u200B급 매기기', '등급'], ['우\u2066수\u2069', '우수'], ['미\u00AD흡', '미흡'], ['점\u2028수', '점수'],
];
for (const [t, w] of GRADED) assert.equal(kit.gradingWord(t), w, `negative control must fail with ${w}: ${JSON.stringify(t)}`);
assert.match(kit.itemProblem('B등급 이상'), /‘등급’ 같은 점수·등급 말은 넣지 않습니다/);
assert.equal(kit.itemProblem(CLEAN[0]), null);
assert.match(kit.itemProblem('우수한 결과물 10점'), /‘10점’ 같은/, 'the refusal quotes the words found, not the rule name');
ok('points, grade levels and SX-35 labels are refused, also through invisible, bidi and fullwidth characters');

// Structural: whitespace inside a word never hides it (the check also runs on the text with ALL whitespace removed).
const SPACED = [
  ['만 점', '만점'], ['만\u3000점', '만점'], ['등 급', '등급'], ['점 수', '점수'], ['우 수', '우수'], ['미 흡', '미흡'],
  ['총 점', '총점'], ['배 점', '배점'], ['감 점', '감점'], ['가 점', '가점'], ['득 점', '득점'], ['평 점', '평점'], ['채 점', '채점'],
  ['낮 음', '낮음'], ['높\t음', '높음'], ['등 \u200B 급', '등급'], ['점\n수', '점수'], ['성 장 점 수', '점수'], ['성장점수', '성장 점수'],
  ['개 선 필 요', '개선 필요'], ['역 량 부 족', '역량 부족'], ['상 위 1 0 %', '상위 N%'], ['A I 활 용 고 수', 'AI 활용 고수'],
];
for (const [t, w] of SPACED) assert.equal(kit.gradingWord(t), w, `spaced word must be refused as ${w}: ${JSON.stringify(t)}`);
ok('a space, tab, newline or ideographic space inside a grading word does not hide it');

const NUMERALS = [
  '백점', '백 점', '일백점', '일백 점', '십점', '십 점', '이십점', '열 점', '스무 점', '스물다섯 점', '오점', '문서 오점',
  '100 점', '1 0 점', '①0점', '１００점', 'A학점', '학점 받기', '3 학 점',
  '100 pts', '100pt', '1 0 p t s', '10 points of credit', '10 point', '10 points 받기', '10 Points', '１０ ＰＴＳ', '100点', '五十点', '100點',
];
for (const t of NUMERALS) assert.notEqual(kit.gradingWord(t), null, 'must be refused: ' + JSON.stringify(t));
ok('Korean-numeral + 점, 학점, pts/point(s) and 点 forms are refused');

const STILL_CLEAN = [
  '차이점 2개를 적으면 끝', '차이점 수를 적으면 끝', '차이 점검표 1개를 만들면 끝', '점검표 1개', '관점 3개', '장점 2개 적기',
  '관 점 3개 적기', '장 점 과 단 점', '추 가 점검 메모', '추가점 2개', '추가점 수 적기', '추 가점 2개 적기', '만 점검표 1개', '총 점검 목록 만들기', '3 점검 항목 적기',
  '3 점선 화면', '시점 3개 적기', '통일점 1개 적기', '이점 2개 적기', '문제점 3개 적기', 'point of view 한 줄 적기',
  '공통점 3개를 적으면 끝', '💯', '★★★★★',
];
for (const t of STILL_CLEAN) assert.equal(kit.gradingWord(t), null, 'positive control must pass (collapsing must not refuse it): ' + JSON.stringify(t));
ok('allowed words (차이점, 점검, 관점, 장점 …) stay allowed, also when spaced or next to another word');

// ---------- 2. the helper sentence ----------
assert.deepEqual(kit.doneSentence('첫 화면 시안 1개'), { ok: true, text: '첫 화면 시안 1개를 만들면 끝' });
assert.deepEqual(kit.doneSentence('  소개 문단  '), { ok: true, text: '소개 문단을 만들면 끝' });
assert.deepEqual(kit.doneSentence('index.html'), { ok: true, text: 'index.html을(를) 만들면 끝' });
assert.deepEqual(kit.doneSentence('첫 화면 시안 1개를 만들면 끝.'), { ok: true, text: '첫 화면 시안 1개를 만들면 끝' });
assert.deepEqual(kit.doneSentence('버튼 색을 바꾼다'), { ok: false, reason: 'clause' });
assert.deepEqual(kit.doneSentence('   '), { ok: false, reason: 'empty' });
ok('the helper writes "…을/를 만들면 끝" with the right particle and refuses to glue a clause');

// ---------- 3. Chalk's forwarder ----------
const ORIGIN = 'https://service.stub';
const env = { HPS_SIGNING_SECRET: 'test-secret-0123456789abcdef', ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: ORIGIN };
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.origin !== ORIGIN) return realFetch(url, init);
  seen.push({ path: u.pathname, method: init?.method, body: init?.body ? new TextDecoder().decode(init.body) : null });
  return new Response(JSON.stringify({ revision: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const draft = (texts) => ({ expected_revision: 1, profile_id: 'p1', content: { schema: 'hps-session-design/1', learning: { week: 1, mission: '내 첫 홈페이지', completion: texts.map((text, i) => ({ id: 'c' + i, text, event: 'test_observed' })) } } });
const put = (body, path = '/admin/cohorts/cohort-1/authoring/course-1') => chalk.fetch(new Request('https://chalk.test' + path, { method: 'PUT', headers: { authorization: 'Bearer instructor', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {});

let r = await put(draft(['첫 화면 시안 1개를 만들면 끝', '미흡한 부분 고치기']));
assert.equal(r.status, 422);
const j = await r.json();
assert.equal(j.error.type, 'validation');
assert.equal(j.error.field, 'content.learning.completion[1].text');
assert.match(j.error.message, /‘미흡’/);
assert.equal(seen.length, 0, 'a refused draft never reaches the Service');
for (const bad of ['만 점', '등\u3000급', '우 수', '백점', '100 pts', 'A학점', '100点']) {
  seen.length = 0;
  r = await put(draft(['첫 화면 시안 1개를 만들면 끝', bad + ' 받기']));
  assert.equal(r.status, 422, 'forwarder refuses ' + JSON.stringify(bad));
  assert.equal((await r.json()).error.field, 'content.learning.completion[1].text');
  assert.equal(seen.length, 0, 'Service gets 0 calls for ' + JSON.stringify(bad));
}
r = await put(draft(['첫 화면 시안 1개를 만들면 끝', '차이점 2개를 적으면 끝']));
assert.equal(r.status, 200);
assert.equal(seen.length, 1);
assert.deepEqual(JSON.parse(seen[0].body), draft(['첫 화면 시안 1개를 만들면 끝', '차이점 2개를 적으면 끝']), 'a clean draft is forwarded byte-for-byte');
r = await chalk.fetch(new Request('https://chalk.test/admin/cohorts/cohort-1/authoring/course-1', { method: 'PUT', headers: { authorization: 'Bearer instructor', 'content-type': 'application/json' }, body: '{not json' }), env, {});
assert.equal(seen.length, 2, 'a body that is not JSON is left to the Service validator');
assert.deepEqual(completionProblems(null), []);
assert.deepEqual(completionProblems({ learning: { completion: [{ text: 42 }, null, { text: '등급' }] } }).map(([i]) => i), [2]);
globalThis.fetch = realFetch;
ok('the forwarder refuses a graded completion item with 422 before the Service and forwards a clean draft unchanged');

// ---------- served page ----------
const html = await (await chalk.fetch(new Request('https://chalk.test/authoring'), env, {})).text();
assert.ok(!html.includes('/*@completion-checklist*/'), 'the marker is replaced by the kit');
assert.ok(html.includes(COMPLETION_CHECKLIST_SCRIPT), 'the page inlines exactly the tested kit');
ok('the served /authoring page inlines the tested kit');

// ---------- 4. the real page in headless Chromium ----------
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('completion-checklist: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  completion-checklist browser part (no headless Chromium)');
} else {
  // Served over http://127.0.0.1 (a secure context: the page's crypto.randomUUID needs one), straight from chalk.fetch.
  const server = createServer(async (req, res) => {
    const r = await chalk.fetch(new Request('http://localhost' + req.url), env, {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const b = await launch(bin);
  try {
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1420, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = b.waitForEvent((m) => m.method === 'Page.loadEventFired', 'authoring load');
    await b.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/authoring' });
    await loaded;
    const res = await b.evaluate(`(() => {
      const $ = (id) => document.getElementById(id);
      $('learning-on').checked = true; $('learning-on').onchange();
      $('learning-week').value = '1'; $('learning-mission').value = '내 첫 홈페이지';
      $('completion-add').click();
      const li = $('learning-completion').lastElementChild, t = li.querySelector('[data-completion-text]'), e = li.querySelector('[data-completion-event]');
      e.value = 'test_observed';
      const check = () => { try { learningCheck(); return null; } catch (x) { return { message: x.message, field: x.field === t }; } };
      const out = { label: li.querySelector('label').textContent, placeholder: t.placeholder };
      t.value = '우수한 결과물 10점'; out.graded = check();
      out.spaced = ['만 점', '등 급', '점 수', '우 수', '백점', '100 pts', 'A학점'].map((v) => { t.value = v + ' 받기'; return !!check(); });
      t.value = '차이점 수를 적으면 끝'; out.allowedSpaced = check();
      t.value = '첫 화면 시안 1개를 만들면 끝'; out.clean = check();
      t.value = '첫 화면 시안 1개'; out.before = check();
      return out;
    })()`);
    assert.equal(res.label, '완료 조건 — 무엇을 만들면 끝인가요?');
    assert.equal(res.placeholder, '예: 첫 화면 시안 1개를 만들면 끝');
    assert.ok(res.graded && res.graded.field, 'the save check refuses a graded item and names its field');
    assert.match(res.graded.message, /점수·등급 말은 넣지 않습니다/);
    assert.deepEqual(res.spaced, [true, true, true, true, true, true, true], 'the page refuses spaced and numeral forms on save');
    assert.equal(res.allowedSpaced, null, 'the page keeps 차이점 수 allowed');
    assert.equal(res.clean, null, 'a "만들면 끝" item passes the save check');
    // The helper button runs through the page's own run() lock; wait for it to settle.
    await b.evaluate(`document.querySelector('#learning-completion [data-completion-done]').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const after = await b.evaluate(`({ text: document.querySelector('#learning-completion [data-completion-text]').value, status: document.getElementById('status').textContent })`);
    assert.equal(after.text, '첫 화면 시안 1개를 만들면 끝', 'the helper button writes the "만들면 끝" sentence into the row');
    await b.evaluate(`document.querySelector('#learning-completion [data-completion-text]').value = '버튼 색을 바꾼다'; document.querySelector('#learning-completion [data-completion-done]').click()`);
    await new Promise((r) => setTimeout(r, 100));
    const clause = await b.evaluate(`({ text: document.querySelector('#learning-completion [data-completion-text]').value, status: document.getElementById('status').textContent })`);
    assert.equal(clause.text, '버튼 색을 바꾼다', 'a clause is not rewritten');
    assert.match(clause.status, /이미 문장입니다/);
    ok('the real /authoring page refuses a graded item on save and the helper button writes the sentence (headless Chromium)');
  } finally { await b.close(); server.close(); }
}
console.log(`PASS completion-checklist: ${n} checks`);
