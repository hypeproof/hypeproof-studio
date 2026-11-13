// CGP-ART-R-005 (REQ-ART-05), Chalk side: an instructor leaves a comment on one learner's approved page version from /manage.
// Run on the REAL served /manage page in headless Chromium through the page's own render functions and its own fetch calls,
// with fetch stubbed inside the page (no Service, no OS input, no visible window).
// Designed behavior:
//   (a) a verified collection item lists each approved version (fingerprint) with "의견 남기기"; a seat without approved
//       versions, an unverified item, or a run without the question switch gets no such button;
//   (b) the composer names the one learner and the version, offers nine 44px regions of the page and a 500-character field,
//       and says it reaches this learner only, never the coach, and that addresses stay text;
//   (c) sending saves ONE `comment` content object with anchor {artifact_sha256, rect in permille} and distributes it to
//       exactly that seat; an empty comment sends nothing;
//   (d) the sent list shows it as 의견 with the learner's reply and handled state from the answers view, actors apart.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('artifact-comment.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  artifact-comment.browser (no headless Chromium)');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const SHA = 'ab'.repeat(32), OBJ = '88888888-8888-4888-8888-888888888888';
// The page's own fetch calls are answered here and recorded in window.__req.
const SHIM = `<script>if (!crypto.randomUUID) { let n = 0; crypto.randomUUID = () => "00000000-0000-4000-8000-" + String(++n).padStart(12, "0"); }
window.__req = [];
window.fetch = async (url, init = {}) => {
  const u = String(url), body = init.body ? JSON.parse(init.body) : null, method = init.method || 'GET';
  window.__req.push({ path: new URL(u, 'https://chalk.test').pathname, method, body });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'POST' && u.endsWith('/contents')) return json({ object_id: '${OBJ}', revision: 1, kind: 'comment', content_hash: '${'e'.repeat(64)}', title: body.title }, 201);
  if (method === 'POST' && u.endsWith('/distributions')) return json({ distribution: { id: 'dist-1' } }, 201);
  if (u.endsWith('/contents')) return json({ contents: [{ object_id: '${OBJ}', kind: 'comment', title: '강사 의견', latest_revision: 1, retired: false }], next_cursor: null });
  if (u.includes('/questions/')) return json({ question: { object_id: '${OBJ}', revision: 1, latest_revision: 1, retired: false, kind: 'comment', title: '강사 의견', body: window.__sentBody || '', form: null, anchor: { artifact_sha256: '${SHA}', rect: { x: 333, y: 0, w: 333, h: 333 } }, content_hash: '${'e'.repeat(64)}' },
    roster_revision: 3, now: Date.now(), summary: { total: 1, not_delivered: 0, delivered: 0, answered: 1, skipped: 0 },
    seats: [{ seat_id: 'A1', student_id: 'student-a', connected: true, status: 'answered', delivery: { state: 'reflected', result_code: '', withdrawn: false }, answer: { handled: true, reply: '버튼 색도 바꿨어요', answered_at: 1, updated_at: 1, answer_revision: 2 } }] });
  return json({});
};</script>`;
const served = await (await app.fetch(new Request('https://chalk.test/manage'), { ENVIRONMENT: 'test' })).text();
const html = served.replace(/<head\b[^>]*>/i, (m) => m + SHIM);

let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };
const settle = () => new Promise((r) => setTimeout(r, 120));
const verified = { phase: 'verified', active: false, retryable: false, may_change: false, partial: false };
const BATCH = { batch: { id: 'B1', kinds: ['artifacts'], upload_until: Date.now() + 600000, upload_open: true, new_request_allowed: true }, observed_at: Date.now(), summary: { not_selected: 0 },
  items: [
    { seat_id: 'A1', student_id: 'student-a', state: 'verified', coverage: 'complete', status: verified, extent: { kinds: ['artifacts'], sessions: 1, parts: [], received: {}, not_sent: {}, reasons: [], approved_versions: [SHA] } },
    { seat_id: 'A2', student_id: 'student-b', state: 'verified', coverage: 'complete', status: verified, extent: { kinds: ['artifacts'], sessions: 1, parts: [], received: {}, not_sent: {}, reasons: [], approved_versions: [] } },
    { seat_id: 'A3', student_id: 'student-c', state: 'uploading', status: { phase: 'transferring', active: true, retryable: false, may_change: true, partial: false }, extent: { approved_versions: ['cd'.repeat(32)] } },
  ] };
const setup = (questions) => `(() => {
  connected = true; cohort = 'c1';
  board = { session: { session_id: 'K1' }, roster: { rendered: 3 }, now: new Date().toISOString(), seats: [] };
  opsData = { seats: [{ seat_id: 'A1', student_id: 'student-a', attention: 'ok', connection: { state: 'active' } }, { seat_id: 'A2', student_id: 'student-b', attention: 'ok' }, { seat_id: 'A3', student_id: 'student-c', attention: 'ok' }],
    counts: { total: 3, runtime_ready: 3 }, run: { class_run_id: 'R1', roster_revision: 3, flags: { ops_questions: ${questions}, ops_distribute: true } }, actions: [], distribution: { enabled: true, held: true } };
  renderSummary(opsData); renderSeats(opsData); renderSelection();
  renderPick(${JSON.stringify(BATCH)});
  return true;
})()`;
const buttons = `[...document.querySelectorAll('[data-cm-version]')].map((b) => ({ seat: b.dataset.cmSeat, version: b.dataset.cmVersion, text: b.textContent }))`;

const b = await launch(bin);
try {
  await b.load(html, { width: 1420, height: 900 });
  // (a) without the question switch: no comment button at all
  await b.evaluate(setup(false)); await settle();
  check((await b.evaluate(buttons)).length === 0, 'no comment without the run switch');
  // (a) with it: exactly A1's one approved version
  await b.evaluate(setup(true)); await settle();
  const found = await b.evaluate(buttons);
  check(JSON.stringify(found) === JSON.stringify([{ seat: 'A1', version: SHA, text: '지문 abababab 판에 의견 남기기' }]), 'only a verified seat with an approved version: ' + JSON.stringify(found));

  // (b) the composer
  await b.evaluate(`document.querySelector('[data-cm-version]').click()`); await settle();
  const comp = await b.evaluate(`(() => { const c = document.getElementById('ops-cm'); const labels = [...c.querySelectorAll('.cm-grid label')];
    return { hidden: c.hidden, target: document.getElementById('ops-cm-target').textContent, note: c.querySelector('p.muted').textContent,
      regions: labels.map((l) => l.textContent), minH: Math.min(...labels.map((l) => l.getBoundingClientRect().height)), max: document.getElementById('ops-cm-body').maxLength,
      font: Math.min(...[...c.querySelectorAll('label, p, button, legend')].map((n) => parseFloat(getComputedStyle(n).fontSize))), focus: document.activeElement?.id }; })()`);
  check(!comp.hidden && comp.target.includes('A1') && comp.target.includes('student-a') && comp.target.includes('지문 abababab'), 'composer names the learner and version: ' + comp.target);
  check(comp.note.includes('이 학생 한 명') && comp.note.includes('AI 코치에게도 가지 않습니다') && comp.note.includes('눌리는 링크가 되지 않습니다'), 'scope said in words');
  check(comp.regions.length === 9 && comp.regions[0] === '페이지 위쪽 왼쪽' && comp.regions[4] === '페이지 가운데' && comp.regions[8] === '페이지 아래쪽 오른쪽', 'nine regions: ' + comp.regions.join(','));
  check(comp.minH >= 44, 'regions are 44px targets: ' + comp.minH);
  check(comp.max === 500 && comp.font >= 14, 'length cap 500 and text ≥ 14px: ' + comp.font);
  check(comp.focus === 'ops-cm-title', 'focus moves to the composer heading');

  // (c) empty → nothing; then a real send to that one seat
  await b.evaluate(`document.getElementById('ops-cm-send').click()`); await settle();
  check((await b.evaluate(`window.__req.filter((r) => r.method === 'POST').length`)) === 0, 'an empty comment sends nothing');
  await b.evaluate(`(() => { const t = document.getElementById('ops-cm-body'); t.value = '제목 색이 배경과 잘 구분돼요. https://example.com 도 참고'; window.__sentBody = t.value; t.dispatchEvent(new Event('input'));
    document.querySelector('input[name="ops-cm-region"][value="1"]').click(); document.getElementById('ops-cm-send').click(); return 0; })()`);
  await settle(); await settle();
  const posts = await b.evaluate(`window.__req.filter((r) => r.method === 'POST')`);
  check(posts.length === 2 && posts[0].path.endsWith('/contents'), 'first POST saves the content: ' + JSON.stringify(posts.map((p) => p.path)));
  const saved = posts[0].body, sent = posts[1].body;
  check(saved.kind === 'comment' && saved.title === '강사 의견' && saved.body.startsWith('제목 색이') && JSON.stringify(saved.anchor) === JSON.stringify({ artifact_sha256: SHA, rect: { x: 333, y: 0, w: 333, h: 333 } }), 'comment content with the anchor: ' + JSON.stringify(saved));
  check(Object.keys(saved).sort().join() === 'anchor,body,idempotency_key,kind,title', 'nothing else in the content request');
  check(posts[1].path.endsWith('/distributions') && JSON.stringify(sent.targets) === '["A1"]' && sent.object_id === OBJ && sent.expected_roster_revision === 3 && sent.dry_run === false, 'distributed to exactly that seat: ' + JSON.stringify(sent));
  const after = await b.evaluate(`({ state: document.getElementById('ops-cm-state').textContent, formHidden: document.getElementById('ops-cm-form').hidden })`);
  check(after.state.startsWith('보냈습니다 · A1') && after.formHidden, 'sent is said once the Service answered: ' + after.state);

  // (d) the sent list: 의견, anchor in words, the instructor's text, the learner's reply and handled state
  await settle(); await settle();
  const list = await b.evaluate(`({ buttons: [...document.querySelectorAll('#ops-qc-list button')].map((x) => x.textContent), view: document.getElementById('ops-qc-view').textContent, state: document.getElementById('ops-qc-state').textContent, reqs: window.__req.map((r) => r.method + ' ' + r.path) })`);
  check(list.buttons[0] === '의견 · 강사 의견', 'listed as a comment: ' + JSON.stringify(list.buttons));
  check(list.view.includes('승인한 판 지문 abababab · 페이지 위쪽 가운데') && list.view.includes('강사(나)의 의견') && list.view.includes('확인함 · 학생 답글: 버튼 색도 바꿨어요'), 'anchor, actors and reply: ' + JSON.stringify(list));
  check(list.state.startsWith('A1 학생 한 명 · 답함'), 'one learner, not the whole roster: ' + list.state);
  check(!/<a\b/.test(await b.evaluate(`document.getElementById('ops-qc-view').innerHTML`)), 'no live link in the instructor view');
  console.log(`PASS artifact-comment.browser: ${checks} checks (approved versions → composer → one-seat send → reply view)`);
} finally { await b.close(); }
