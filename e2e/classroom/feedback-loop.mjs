// #1013 feedback-loop — the whole loop in the real pages: a learner's share gets a person's feedback, the learner answers it
// on /sharing (revise/keep/hold + why), the instructor writes a retrospective of the version that ran on /authoring (07) from
// the shares they received, a withdrawn share drops out of it, the retrospective starts the next draft from that version,
// and the next candidate and its learner-condition rehearsal show up as the retrospective's "next".
//
// Real here: the Chalk /sharing and /authoring pages in Chromium (clicks and typing), Chalk's forwarder, the Service router
// and SQLite. Synthetic: every account and share; the learner's share and the instructor's feedback are written through the
// Service API (the help-request and feedback screens have their own suites). No model, no Studio window, no real person.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { localOps } from '../../worker/test/harness/classroom-ops.mjs';
import { makeCtx } from '../../worker/test/harness/index.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), out = path.join(repo, 'e2e/test-results/classroom-feedback-loop'); mkdirSync(out, { recursive: true });
const local = await localOps(), { default: chalk } = await import('../../chalk/src/index.ts'), { setRoster } = await import('../../worker/src/lib/kv.ts');
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
  const teacher = await local.teacher('teacher-a'), studentA = await local.student('student-a'), studentB = await local.student('student-b');
  const api = (p, method, body, token) => local.request(p, method, body, token);
  assert.equal((await api('/v1/classroom/shares', 'POST', { id: 'share-a', recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { prompt: '진료시간을 바꿔줘', response: 'AI가 쓴 답: 줄바꿈을 넣었습니다', verification: '390px에서 줄바꿈이 깨지는지 직접 봤다' } }, studentA)).status, 201);
  assert.equal((await api('/v1/classroom/shares', 'POST', { id: 'share-b', recipient_id: 'teacher-a', kind: 'help', consent: true, duration_minutes: 60, content: { question: '토요일 진료시간을 어디에 적어야 할지 모르겠어요' } }, studentB)).status, 201);
  assert.equal((await api(`/admin/cohorts/${local.cohort}/classroom/shares/share-a`, 'PUT', { expected_revision: 1, status: 'answered', feedback: FEEDBACK, next_action: '모바일에서 다시 확인' }, teacher)).status, 200);

  browser = await chromium.launch(); const origin = 'http://127.0.0.1:' + chalkServer.address().port, errors = [];
  const open = async (url, viewport) => { const p = await browser.newPage({ viewport }); p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept()); await p.goto(origin + url); return p; };
  const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // ── 1. the learner answers the person's feedback on /sharing, at phone width ──
  const learner = await open('/sharing', { width: 390, height: 844 });
  await learner.locator('#token').fill(studentA); await learner.locator('#login button').first().click();
  const card = learner.locator('#records article').filter({ hasText: '결과물 제출' }); await card.waitFor();
  assert.match(await card.innerText(), new RegExp(FEEDBACK.slice(0, 20)));
  const form = card.locator('.decision form'); await form.waitFor();
  assert.equal(await form.locator('input[type=radio]:checked').count(), 0, 'nothing is pre-selected');
  await form.locator('label.choice', { hasText: '고치기' }).click(); await form.locator('textarea').fill(REASON); await form.locator('button').click();
  await learner.locator('#status').filter({ hasText: '결정을 남겼습니다' }).waitFor();
  assert.match(await card.locator('.decision').innerText(), new RegExp('내 결정: 고치기 — ' + REASON));
  assert.equal(await card.locator('.decision form').count(), 0, 'one answer per feedback text');
  assert.ok(await noOverflow(learner), 'no horizontal scroll at 390px');
  await card.scrollIntoViewIfNeeded(); await learner.screenshot({ path: path.join(out, 'fl-01-learner-decision-390.png') });
  assert.deepEqual([one('SELECT decision, reason FROM classroom_share_responses WHERE share_id=?', 'share-a')].map((r) => [r.decision, r.reason]), [['revise', REASON]]);
  ok('learner: after a person\'s feedback, revise/keep/hold + why on /sharing (optional, nothing pre-selected, stored once)');

  // ── 2. the instructor: open the course, load the retrospective section and the shares they may cite ──
  const page = await open('/authoring', { width: 1280, height: 720 });
  const waitStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status').textContent), re.source);
  const retroStatus = (re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('retro-status').textContent), re.source, { timeout: 8000 })
    .catch(async (e) => { throw Error('retro-status: expected ' + re + ', shows: ' + await page.locator('#retro-status').innerText() + ' | ' + e.message); });
  const viewShows = (re) => page.waitForFunction((src) => { const t = document.getElementById('retro-view').innerText; return new RegExp(src).test(t) && !document.getElementById('retro-load').disabled && t; }, re.source, { timeout: 8000 })
    .then((h) => h.jsonValue(), async (e) => { throw Error('retro-view: expected ' + re + ', shows: ' + await page.locator('#retro-view').innerText() + ' | ' + e.message); });
  await page.locator('#token').fill(teacher); await page.locator('#connect').click(); await page.locator('#connection-status').filter({ hasText: '연결되었습니다' }).waitFor();
  await page.locator('summary', { hasText: '저장한 강의 열기' }).click(); await page.locator('#course').fill(course); await page.locator('#load').click(); await waitStatus(/저장본을 열었습니다/);
  await page.locator('#retro-load').click(); await retroStatus(/근거로 쓸 수 있는 공유 기록 2개/);
  const sourcesText = await page.locator('#retro-sources').innerText(); results.sources = sourcesText;
  assert.match(sourcesText, /student-a · 결과물 제출 .*AI 응답\(AI 응답\).*강사 피드백\(사람의 피드백\).*피드백에 대한 학생의 결정\(학생이 쓴 말\)/);
  assert.ok(!sourcesText.includes('390px에서 줄바꿈이'), 'the list carries no learner content');
  const audits = one('SELECT count(*) AS n FROM classroom_share_audit WHERE share_id=?', 'share-a').n;
  await page.locator('#retro-sources li', { hasText: 'student-a' }).locator('button').click();
  await page.locator('#retro-source-view pre').first().waitFor();
  const content = await page.locator('#retro-source-view').innerText(); results.source_view = content;
  assert.match(content, /AI 응답 · AI 응답\s*\n\s*AI가 쓴 답/); assert.match(content, /강사 피드백 · 사람의 피드백\s*\n\s*모바일에서/); assert.match(content, /피드백에 대한 학생의 결정 · 학생이 쓴 말\s*\n\s*고치기 — 목록으로/);
  assert.equal(one('SELECT count(*) AS n FROM classroom_share_audit WHERE share_id=?', 'share-a').n, audits + 1, 'reading the content is an audited view the learner can see');
  ok('instructor: only shares sent to them for this class are offered, with whose words each part is; reading one is audited');

  // ── 3. write the retrospective: hypothesis, three findings, two decisions ──
  await page.locator('#retro-base').selectOption(V1); await retroStatus(/버전 m2026\.09\.18-1 · 도움 조건/);
  await page.locator('#retro-hypothesis').fill('확인 기준을 먼저 적게 하면 모바일 줄바꿈 같은 문제를 학생이 스스로 찾는다');
  const finding = async (text, sources, assisted) => { await page.locator('#retro-finding-add').click(); const li = page.locator('#retro-findings > li').last(); await li.locator('[data-retro-text]').fill(text);
    for (const v of sources) await li.locator(`[data-retro-source][value="${v}"]`).check(); if (assisted) await li.locator('[data-retro-assist]').selectOption('assisted'); };
  await finding('학생이 390px에서 직접 확인했고, 사람의 피드백 뒤 목록으로 고치기로 했다', ['share-a|verification', 'share-a|feedback', 'share-a|learner_response']);
  await finding('AI는 줄바꿈을 넣었다고 답했다', ['share-a|response']);
  await finding('토요일 시간을 어디에 적을지 도움을 요청했다', ['share-b|question'], true);
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
  assert.match(view1, /관찰 1 · 관찰됨 — 사람의 근거가 있습니다 · 사람의 피드백 있음/);
  assert.match(view1, /관찰 2 · 미관찰 — AI 응답·실행 기록·결과물 주소만으로는 사람의 관찰이 되지 않습니다 · 사람의 피드백 미관찰/);
  assert.match(view1, /관찰 3 · 관찰됨 — 사람의 근거가 있습니다 · 사람의 피드백 미관찰 · 도움을 받음/);
  assert.match(view1, /지금 명단 4명 중 근거가 있는 학생 2명 · 나머지 2명은 이 돌아보기에서 관찰하지 않았습니다/);
  assert.match(view1, /도움 사용과 중간에 멈춤은 Service 기록으로 확인할 수 없습니다\(미관찰\)/);
  assert.match(view1, /결정: 단계 ‘build’ 수정 · 수업 전체 보류/);
  await page.locator('#retro').scrollIntoViewIfNeeded(); await page.locator('#retro-view').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'fl-02-retrospective-saved-1280.png') });
  ok('retrospective: the Service marks each finding — a person\'s words observed, an AI answer alone unobserved, help only on a help request — and states the denominator');

  // ── 4. the help request is withdrawn: its finding falls back, and the retrospective cannot start a draft on it ──
  assert.equal((await api('/v1/classroom/shares/share-b', 'DELETE', undefined, studentB)).status, 200);
  await page.locator('#retro-load').click(); await retroStatus(/공유 기록 1개/);
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
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: n, ...results }, null, 2));
} finally { await browser?.close(); chalkServer.close(); globalThis.fetch = realFetch; local.close(); }
console.log(`${n} feedback-loop browser checks passed`);
