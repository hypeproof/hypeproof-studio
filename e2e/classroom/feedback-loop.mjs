// #1013 feedback-loop — the whole loop in the real pages: a learner's share gets a person's feedback, the learner answers it
// on /sharing (revise/keep/hold + why) and the instructor sees that answer on /manage, the instructor writes a retrospective
// of the version that ran on /authoring (07) from the shares they received, a withdrawn share drops out of it, the
// retrospective starts the next draft from that version, and the next candidate and its learner-condition rehearsal show up
// as the retrospective's "next".
//
// Real here: the Chalk /sharing, /manage and /authoring pages in Chromium (clicks and typing), Chalk's forwarder, the Service
// router and SQLite. Synthetic: every account and share; the learner's share and the instructor's feedback are written
// through the Service API (the help-request and feedback screens have their own suites); the learner codes are issued by the
// existing 학생 초대 route, so each share records the version it was sent under. No model, no Studio window, no real person.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { localOps, OPS_ALL } from '../../worker/test/harness/classroom-ops.mjs';
import { makeCtx, TEST_SECRET } from '../../worker/test/harness/index.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), out = path.join(repo, 'e2e/test-results/classroom-feedback-loop'); mkdirSync(out, { recursive: true });
const local = await localOps(), { default: chalk } = await import('../../chalk/src/index.ts'), { setRoster } = await import('../../worker/src/lib/kv.ts');
const { issueIssuer } = await import('../../worker/src/lib/tokens.ts');
local.env.HPS_FEEDBACK_LOOP = 'enabled';
const realFetch = globalThis.fetch, toService = (url, init) => local.app.fetch(new Request(url, init), local.env, makeCtx());
globalThis.fetch = (url, init) => String(url).startsWith('https://service.test') ? toService(url, init) : realFetch(url, init);
const chalkServer = createServer(async (req, res) => { try { const parts = []; for await (const p of req) parts.push(p); const body = Buffer.concat(parts); const r = await chalk.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), { ...local.env, HPS_SERVICE_ORIGIN: 'https://service.test' }, {}); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); } catch (e) { res.writeHead(500); res.end(String(e)); } });
chalkServer.listen(0, '127.0.0.1'); await once(chalkServer, 'listening');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); }; let browser; const results = {};
const one = (sql, ...a) => { const r = local.db.prepare(sql).get(...a); return r ? { ...r } : r; };
const FEEDBACK = '모바일에서 토요일 진료시간이 두 줄로 갈립니다. 표 대신 목록이 어떨까요?', REASON = '목록으로 바꾸고 390px에서 다시 보겠습니다';
try {
  const course = local.lesson.course_id, V1 = local.lesson.version, V2 = 'm2026.10.05-7';
  await local.freeze(course, V1, ['intro', 'build', 'review']);
  const teacher = await local.teacher('teacher-a');
  // Learner codes bound to the version that runs, from the existing 학생 초대 route (a 12-hour instructor code: the route
  // refuses a learner code that would outlive the instructor's own).
  const teacher12 = (await issueIssuer({ issuer: 'teacher-a', scopes: [{ cohort: local.cohort, profiles: [local.profile], ops: OPS_ALL }] }, 12, TEST_SECRET)).token;
  const invite = async (user) => { const r = await local.request(`/admin/cohorts/${local.cohort}/authoring/${course}/versions/${V1}/participants`, 'POST', { user, hours: 2 }, teacher12); assert.equal(r.status, 200, r.raw); return r.json.token; };
  const studentA = await invite('student-a'), studentB = await invite('student-b');
  const api = (p, method, body, token) => local.request(p, method, body, token);
  assert.equal((await api('/v1/classroom/shares', 'POST', { id: 'share-a', recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { prompt: '진료시간을 바꿔줘', response: 'AI가 쓴 답: 줄바꿈을 넣었습니다', verification: '390px에서 줄바꿈이 깨지는지 직접 봤다' } }, studentA)).status, 201);
  assert.equal((await api('/v1/classroom/shares', 'POST', { id: 'share-b', recipient_id: 'teacher-a', kind: 'help', consent: true, duration_minutes: 60, content: { question: '토요일 진료시간을 어디에 적어야 할지 모르겠어요' } }, studentB)).status, 201);
  assert.equal((await api('/v1/classroom/shares', 'POST', { id: 'share-rev', recipient_id: 'teacher-a', kind: 'help', consent: true, duration_minutes: 60, content: { question: '예약 버튼 위치가 맞나요?' } }, studentA)).status, 201);
  assert.equal((await api(`/admin/cohorts/${local.cohort}/classroom/shares/share-a`, 'PUT', { expected_revision: 1, status: 'answered', feedback: FEEDBACK, next_action: '모바일에서 다시 확인' }, teacher)).status, 200);
  // /manage saves "검토 중" by default: the learner sees this text, but it is not yet an answer to decide on.
  assert.equal((await api(`/admin/cohorts/${local.cohort}/classroom/shares/share-rev`, 'PUT', { expected_revision: 1, status: 'reviewing', feedback: '아직 작성 중인 피드백입니다', next_action: '조금만 기다려 주세요' }, teacher)).status, 200);
  // An answer the instructor takes back to "검토 중" while the learner's page still shows it (the race the page must name).
  const FLIP = '버튼 문구를 다시 볼게요';
  assert.equal((await api('/v1/classroom/shares', 'POST', { id: 'share-flip', recipient_id: 'teacher-a', kind: 'help', consent: true, duration_minutes: 60, content: { question: '버튼 문구가 괜찮나요?' } }, studentA)).status, 201);
  assert.equal((await api(`/admin/cohorts/${local.cohort}/classroom/shares/share-flip`, 'PUT', { expected_revision: 1, status: 'answered', feedback: FLIP, next_action: '기다려 주세요' }, teacher)).status, 200);

  browser = await chromium.launch(); const origin = 'http://127.0.0.1:' + chalkServer.address().port, errors = [];
  const open = async (url, viewport) => { const p = await browser.newPage({ viewport }); p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept()); await p.goto(origin + url); return p; };
  const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // ── 1. the learner answers the person's feedback on /sharing, at phone width ──
  const learner = await open('/sharing', { width: 390, height: 844 });
  await learner.locator('#token').fill(studentA); await learner.locator('#login button').first().click();
  const card = learner.locator('#records article').filter({ hasText: '결과물 제출' }); await card.waitFor();
  assert.match(await card.innerText(), new RegExp(FEEDBACK.slice(0, 20)));
  const pending = learner.locator('#records article').filter({ hasText: '아직 작성 중인 피드백입니다' }); await pending.waitFor();
  assert.equal(await pending.locator('.decision form').count(), 0, 'feedback still under review offers no decision form (the Service would refuse it)');
  const form = card.locator('.decision form'); await form.waitFor();
  assert.equal(await form.locator('input[type=radio]:checked').count(), 0, 'nothing is pre-selected');
  await form.locator('label.choice', { hasText: '고치기' }).click(); await form.locator('textarea').fill(REASON); await form.locator('button').click();
  await learner.locator('#status').filter({ hasText: '결정을 남겼습니다' }).waitFor();
  assert.match(await card.locator('.decision').innerText(), new RegExp('내 결정: 고치기 — ' + REASON));
  assert.equal(await card.locator('.decision form').count(), 0, 'one answer per feedback text');
  assert.ok(await noOverflow(learner), 'no horizontal scroll at 390px');
  await card.scrollIntoViewIfNeeded(); await learner.screenshot({ path: path.join(out, 'fl-01-learner-decision-390.png') });
  assert.deepEqual([one('SELECT decision, reason FROM classroom_share_responses WHERE share_id=?', 'share-a')].map((r) => [r.decision, r.reason]), [['revise', REASON]]);
  // The instructor takes the other answer back to "검토 중" after the page drew its form: the refusal is named, the input kept.
  const flip = learner.locator('#records article').filter({ hasText: FLIP }), flipForm = flip.locator('.decision form'); await flipForm.waitFor();
  assert.equal((await api(`/admin/cohorts/${local.cohort}/classroom/shares/share-flip`, 'PUT', { expected_revision: 2, status: 'reviewing', feedback: FLIP, next_action: '기다려 주세요' }, teacher)).status, 200);
  await flipForm.locator('label.choice', { hasText: '보류' }).click(); await flipForm.locator('textarea').fill('답변을 기다리겠습니다'); await flipForm.locator('button').click();
  await learner.locator('#status').filter({ hasText: '강사가 아직 답변을 마치지 않았습니다' }).waitFor();
  assert.match(await learner.locator('#status').innerText(), /입력 내용은 유지됩니다/);
  assert.equal(await flipForm.locator('textarea').inputValue(), '답변을 기다리겠습니다');
  assert.equal(one("SELECT count(*) AS n FROM classroom_share_responses WHERE share_id='share-flip'").n, 0);
  ok('learner: after a person\'s feedback, revise/keep/hold + why on /sharing (optional, nothing pre-selected, stored once); no form while the feedback is still under review, and a named refusal if it went back under review');

  // ── 1b. the instructor sees that answer on the /manage share detail where they wrote the feedback ──
  const board = await open('/manage', { width: 1280, height: 720 });
  await board.locator('#token').fill(teacher); await board.locator('#cohort').fill(local.cohort); await board.locator('#connect button').first().click();
  await board.locator('#status').filter({ hasText: '연결됨' }).waitFor();
  // The share list sits in the board's folded "공유 기록" section; open it the way the instructor does.
  await board.locator('#legacy-wrap > summary').click();
  const shareRow = board.locator('#shares article').filter({ hasText: 'student-a · 결과물 제출' });
  await shareRow.locator('button', { hasText: '공유 기록 열기' }).click();
  await board.locator('#content').filter({ hasText: '피드백에 대한 학생의 결정' }).waitFor();
  assert.match(await board.locator('#content').innerText(), new RegExp('피드백에 대한 학생의 결정\\s*\\n\\s*고치기 — ' + REASON));
  await board.close();
  ok('instructor: the learner\'s decision shows in the /manage share detail, under the content they chose to send');

  // ── 2. the instructor: open the course, load the retrospective section and the shares they may cite ──
  const page = await open('/authoring', { width: 1280, height: 720 });
  const waitStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source);
  const retroStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('retro-status').textContent), re.source, { timeout: 8000 })
    .catch(async (e) => { throw Error('retro-status: expected ' + re + ', shows: ' + await page.locator('#retro-status').innerText() + ' | ' + e.message); });
  const viewShows = (re) => page.waitForFunction((src) => { const t = document.getElementById('retro-view').innerText; return new RegExp(src).test(t) && !document.getElementById('retro-load').disabled && t; }, re.source, { timeout: 8000 })
    .then((h) => h.jsonValue(), async (e) => { throw Error('retro-view: expected ' + re + ', shows: ' + await page.locator('#retro-view').innerText() + ' | ' + e.message); });
  // Section 07 exists only where the Service has the loop on: with the switch off, connecting hides it (and its link).
  local.env.HPS_FEEDBACK_LOOP = undefined;
  await page.locator('#token').fill(teacher); await page.locator('#connect').click(); await page.locator('#connection-status').filter({ hasText: '연결되었습니다' }).waitFor();
  await page.locator('#retro').waitFor({ state: 'hidden' }); assert.equal(await page.locator('.page-help a[href="#retro"]').isHidden(), true);
  local.env.HPS_FEEDBACK_LOOP = 'enabled';
  await page.locator('#connect').click(); await page.locator('#retro').waitFor({ state: 'visible' }); await page.locator('#connection-status').filter({ hasText: '연결되었습니다' }).waitFor();
  await page.locator('summary', { hasText: '저장한 강의 열기' }).click(); await page.locator('#course').fill(course); await page.locator('#load').click(); await waitStatus(/저장본을 열었습니다/);
  await page.locator('#retro-load').click(); await retroStatus(/근거로 쓸 수 있는 공유 기록 4개/);
  const sourcesText = await page.locator('#retro-sources').innerText(); results.sources = sourcesText;
  assert.match(sourcesText, /student-a · 결과물 제출 .* · 버전 m2026\.09\.18-1 — .*AI 응답\(AI 응답\).*강사 피드백\(사람의 피드백\).*피드백에 대한 학생의 결정\(학생이 쓴 말\)/);
  assert.ok(!sourcesText.includes('버전 기록 없음'), 'every share here was sent under a recorded version');
  assert.ok(!sourcesText.includes('390px에서 줄바꿈이'), 'the list carries no learner content');
  const audits = one('SELECT count(*) AS n FROM classroom_share_audit WHERE share_id=?', 'share-a').n;
  await page.locator('#retro-sources li', { hasText: 'student-a · 결과물 제출' }).locator('button').click();
  await page.locator('#retro-source-view pre').first().waitFor();
  const content = await page.locator('#retro-source-view').innerText(); results.source_view = content;
  assert.match(content, /AI 응답 · AI 응답\s*\n\s*AI가 쓴 답/); assert.match(content, /강사 피드백 · 사람의 피드백\s*\n\s*모바일에서/); assert.match(content, /피드백에 대한 학생의 결정 · 학생이 쓴 말\s*\n\s*고치기 — 목록으로/);
  assert.equal(one('SELECT count(*) AS n FROM classroom_share_audit WHERE share_id=?', 'share-a').n, audits + 1, 'reading the content is an audited view the learner can see');
  ok('instructor: 07 hidden while the Service switch is off; only shares sent to them for this class are offered, with the version each was sent under and whose words each part is; reading one is audited');

  // ── 3. write the retrospective: hypothesis, three findings, two decisions ──
  await page.locator('#retro-base').selectOption(V1); await retroStatus(/버전 m2026\.09\.18-1 · 도움 조건/);
  await page.locator('#retro-hypothesis').fill('확인 기준을 먼저 적게 하면 모바일 줄바꿈 같은 문제를 학생이 스스로 찾는다');
  const finding = async (text, sources, assisted) => { await page.locator('#retro-finding-add').click(); const li = page.locator('#retro-findings > li').last(); await li.locator('[data-retro-text]').fill(text);
    for (const v of sources) await li.locator(`[data-retro-source][value="${v}"]`).check(); if (assisted) await li.locator('[data-retro-assist]').selectOption('assisted'); };
  await finding('학생이 390px에서 직접 확인했고, 사람의 피드백 뒤 목록으로 고치기로 했다', ['share-a|verification', 'share-a|feedback', 'share-a|learner_response']);
  await finding('AI는 줄바꿈을 넣었다고 답했다', ['share-a|response']);
  await finding('토요일 시간을 어디에 적을지 도움을 요청했다', ['share-b|question'], true);
  await finding('내 피드백과 AI 답만 보고 판단했다', ['share-a|response', 'share-a|feedback']);
  const decision = async (target, action, reason, refs) => { await page.locator('#retro-decision-add').click(); const li = page.locator('#retro-decisions > li').last();
    await li.locator('[data-retro-target]').selectOption(target); await li.locator('[data-retro-action]').selectOption(action); await li.locator('[data-retro-reason]').fill(reason); for (const r of refs) await li.locator('.retro-refs label', { hasText: r }).locator('input').check(); };
  await decision('build', 'revise', '모바일 확인을 단계 안에 넣는다', ['관찰 1']);
  await decision('lesson', 'hold', '도움 방식은 한 번 더 보고 정한다', ['관찰 3']);
  // A decision without a reason is refused in the instructor's words before anything is sent.
  await page.locator('#retro-decisions > li').last().locator('[data-retro-reason]').fill(' '); await page.locator('#retro-save').click(); await retroStatus(/결정마다 이유를 적으세요/);
  assert.equal(one('SELECT count(*) AS n FROM lesson_retrospectives').n, 0);
  await page.locator('#retro-decisions > li').last().locator('[data-retro-reason]').fill('도움 방식은 한 번 더 보고 정한다');
  await page.locator('#retro-save').click(); await retroStatus(/돌아보기를 저장했습니다/);
  const view1 = await viewShows(/관찰 3 · 관찰됨/); results.view_saved = view1;
  assert.match(view1, /관찰 1 · 관찰됨 — 학생이 쓴 말이 근거입니다 · 사람의 피드백 있음/);
  assert.match(view1, /관찰 2 · 미관찰 — 학생이 쓴 말이 근거에 없습니다 — AI 응답·실행 기록·결과물 주소나 강사 피드백만으로는 학생을 관찰한 것이 되지 않습니다 · 사람의 피드백 미관찰/);
  assert.match(view1, /관찰 3 · 관찰됨 — 학생이 쓴 말이 근거입니다 · 사람의 피드백 미관찰 · 도움을 받음/);
  // The instructor's own feedback beside the AI answer fills the feedback axis, never an observation of the learner.
  assert.match(view1, /관찰 4 · 미관찰 — 학생이 쓴 말이 근거에 없습니다 — .* · 사람의 피드백 있음/);
  assert.ok(!view1.includes('확인되지 않음') && !view1.includes('버전 기록 없음'), 'every cited share was sent under this version');
  assert.match(view1, /지금 명단 4명 중 근거가 있는 학생 2명 · 나머지 2명은 이 돌아보기에서 관찰하지 않았습니다/);
  assert.match(view1, /도움 사용과 중간에 멈춤은 Service 기록으로 확인할 수 없습니다\(미관찰\)/);
  assert.match(view1, /결정: 단계 ‘build’ 수정 · 수업 전체 보류/);
  await page.locator('#retro').scrollIntoViewIfNeeded(); await page.locator('#retro-view').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'fl-02-retrospective-saved-1280.png') });
  ok('retrospective: the Service marks each finding — the learner\'s own words observed, an AI answer alone unobserved, help only on a help request — and states the denominator');

  // ── 4. the help request is withdrawn: its finding falls back, and the retrospective cannot start a draft on it ──
  assert.equal((await api('/v1/classroom/shares/share-b', 'DELETE', undefined, studentB)).status, 200);
  await page.locator('#retro-load').click(); await retroStatus(/공유 기록 3개/);
  const id = one('SELECT retro_id FROM lesson_retrospectives').retro_id; await page.locator('#retro-pick').selectOption(id); await retroStatus(/돌아보기를 열었습니다/);
  const view2 = await viewShows(/관찰 3 · 미관찰/); results.view_withdrawn = view2;
  assert.match(view2, /관찰 3 · 미관찰 — 근거였던 공유가 철회되었거나 만료되어 볼 수 없습니다 · 사람의 피드백 미관찰 · 도움 여부 모름 \(근거였던 도움 요청을 지금 볼 수 없음\)/);
  assert.match(view2, /학생이 쓴 질문 \(학생이 쓴 말\) — 철회·만료되어 볼 수 없음/);
  assert.ok(!view2.includes('student-b'), 'nothing about the withdrawn share is shown');
  const draftRev = (await api(`/admin/cohorts/${local.cohort}/authoring/${course}`, 'GET', undefined, teacher)).json.revision;
  await page.locator('#retro-next').click(); await retroStatus(/근거로 고른 공유 기록 중 지금 볼 수 없는 것이 있습니다/);
  assert.equal((await api(`/admin/cohorts/${local.cohort}/authoring/${course}`, 'GET', undefined, teacher)).json.revision, draftRev, 'nothing was written');
  const gone = page.locator('#retro-findings > li').nth(2); assert.match(await gone.innerText(), /지금 볼 수 없는 공유 share-b/);
  await gone.locator('[data-retro-source][value="share-b|question"]').uncheck(); await gone.locator('[data-retro-assist]').selectOption('unknown');
  await page.locator('#retro-save').click(); await retroStatus(/revision 2/);
  assert.match(await viewShows(/관찰 3 · 미관찰 — 근거로 고른 기록이 없습니다/), /관찰 3 · 미관찰 — 근거로 고른 기록이 없습니다/);
  await page.locator('#retro-view').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'fl-03-withdrawn-source-1280.png') });
  ok('withdrawal reaches the retrospective: the finding falls back to unobserved, the withdrawn share cannot start a draft, the instructor removes it on purpose');

  // ── 5. start the next draft from the version that ran, even though the saved draft drifted ──
  await page.locator('#title').fill('수업과 무관하게 바뀐 초안 제목'); await page.locator('#save').click(); await waitStatus(/저장했습니다/);
  const v1Before = one('SELECT module_json FROM authoring_versions WHERE course_id=? AND version=?', course, V1).module_json;
  assert.equal(await page.locator('#retro-next').isDisabled(), false, await page.locator('#retro-next-note').innerText());
  await page.locator('#retro-next').click(); await waitStatus(/다음 초안을 시작했습니다/);
  assert.equal(await page.locator('#title').inputValue(), '합성 수업', 'the editor now holds the version that ran, not the drifted title');
  const view3 = await viewShows(/다음 초안 revision/); results.view_applied = view3;
  assert.match(view3, /다음 초안 revision \d+ \(버전 m2026\.09\.18-1 내용에서 시작\) → 아직 이 초안으로 후보를 고정하지 않았습니다/);
  assert.equal(await page.locator('#retro-save').isDisabled(), true, 'an applied retrospective is not edited');
  assert.equal(one('SELECT module_json FROM authoring_versions WHERE course_id=? AND version=?', course, V1).module_json, v1Before, 'the version that ran is byte-identical');
  ok('next draft: starts from the version that ran (the drifted draft is replaced only on the instructor\'s confirm), the run version untouched, the retrospective closed');

  // ── 6. revise per the decision, freeze the next candidate, rehearse it: the retrospective names that chain ──
  await page.locator('.step').nth(1).locator('[data-field="acceptance"]').fill('390px와 1280px에서 진료시간이 한 줄씩 보인다'); await page.locator('#save').click(); await waitStatus(/저장했습니다/);
  await page.locator('#version').evaluate((e) => { e.closest('details').open = true; }); await page.locator('#version').fill(V2);
  await page.locator('#freeze').click(); await page.locator('#completion').filter({ hasText: V2 }).waitFor();
  await setRoster(local.env.HPS_KV, local.cohort, ['student-a', 'student-b', 'student-c', 'legacy-test-seat', 'rehearsal-t1']);
  await page.locator('#rehearsal-learner').fill('rehearsal-t1'); await page.locator('#rehearsal-issue').click();
  await page.waitForFunction(() => document.getElementById('rehearsal-token').value.length > 20);
  await page.locator('#retro-pick').selectOption(''); await page.locator('#retro-pick').selectOption(id);
  const view4 = await viewShows(new RegExp('다음 후보 ' + V2.replace(/\./g, '\\.') + ' · 리허설: 리허설 중')); results.view_next = view4;
  await page.locator('#retro-view').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'fl-04-next-candidate-rehearsal-1280.png') });
  assert.equal(one('SELECT count(*) AS n FROM authoring_confirmations').n, 0, 'nothing was confirmed automatically');
  ok('next rehearsal: the candidate frozen from the next draft and its learner-condition rehearsal are shown as this retrospective\'s next step; nothing auto-confirmed');

  // ── 7. the section at phone width: readable, no horizontal scroll ──
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#retro').scrollIntoViewIfNeeded();
  assert.ok(await noOverflow(page), 'no horizontal scroll at 390px'); await page.screenshot({ path: path.join(out, 'fl-05-retrospective-390.png') });
  assert.deepEqual(errors, [], 'no page errors');
  ok('layout: the retrospective section and the learner card fit 390px without horizontal scroll; no page errors');

  // ── 8. a course with more retrospectives than the list holds (50 about one version, one about the next): the page says so ──
  const CC = 'cap-ui-course', ca = `/admin/cohorts/${local.cohort}/authoring/${CC}`, CV1 = 'm2026.10.06-5', CV2 = 'm2026.10.06-6';
  await local.freeze(CC, CV1, ['intro', 'build', 'review']);
  const ccur = (await api(ca, 'GET', undefined, teacher)).json;
  const csaved = await api(ca, 'PUT', { profile_id: local.profile, request_id: crypto.randomUUID(), expected_revision: ccur.revision, content: { ...ccur.content, title: ccur.content.title + ' · 2주차' } }, teacher); assert.equal(csaved.status, 200, csaved.raw);
  assert.equal((await api(`${ca}/versions/${CV2}`, 'PUT', { expected_revision: csaved.json.revision }, teacher)).status, 200);
  const rdoc = { hypothesis: '근거 확인', findings: [{ id: 'f1', text: '근거', sources: [] }], decisions: [{ id: 'd1', target: 'lesson', action: 'keep', reason: '유지' }] };
  for (let i = 0; i < 51; i++) { const r = await api(`${ca}/retrospectives`, 'POST', { request_id: crypto.randomUUID(), base_version: i < 50 ? CV1 : CV2, doc: rdoc }, teacher); assert.equal(r.status, 201, r.raw); }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#course').evaluate((e) => { const d = e.closest('details'); if (d) d.open = true; });
  await page.locator('#course').fill(CC); await page.locator('#load').click(); await waitStatus(/저장본을 열었습니다/);
  await page.locator('#retro-load').click(); await retroStatus(/^돌아보기 50개\(최근 50개만\) · /);
  assert.deepEqual(errors, [], 'no page errors');
  ok('list: a course with more retrospectives than the list holds says it shows only the newest 50');
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: n, ...results }, null, 2));
} finally { await browser?.close(); chalkServer.close(); globalThis.fetch = realFetch; local.close(); }
console.log(`${n} feedback-loop browser checks passed`);
