import '@hypeproof/service-testkit/test/harness/loader.mjs';
// E5 #3775 — an instructor (not Jay) opens and operates a class from Chalk /manage. Designed behaviour, in a real browser:
//  - the run configuration shows the four instructor toggles (관측 · 학생에게 보내기 · 질문 카드 · 기록 회수) and saves them;
//    question cards travel the sending channel, so turning them on turns sending on (and sending off turns them off);
//  - the run is operated by its assigned instructors only: the instructor who configured it is its owner, an unassigned
//    instructor sees why nothing is shown and their own id to hand over, the owner adds and removes co-instructors, a
//    co-instructor may leave, and an override viewer is told the view is audited;
//  - every seat shows its participation consent (동의함 / 동의 전) and no seat is hidden for lacking it.
// Real here: Chalk /manage and its script in Chromium, the Chalk worker and forwarder, the Service router + SQLite (strict
// ownership: the fixture assigns nobody). Synthetic accounts; no Studio app (the consent is recorded with the seat's own
// operations credential, as the app does).
import assert from 'node:assert/strict';
import { e5Stack, OPS_ALL, until } from './e5-chalk.mjs';

const S = await e5Stack({ ownership: 'strict' }), { local } = S;
const { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
const { CLASS_DATA_POLICY } = await import('@hypeproof/service-testkit/src/lib/class-data-policy.ts');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };
const T = (page, id) => page.locator('#' + id).innerText();
const flags = () => JSON.parse(local.db.prepare('SELECT flags_json FROM class_run_ops WHERE class_run_id=?').get(local.run).flags_json);
const team = () => local.db.prepare('SELECT instructor_id,role,removed_at FROM class_run_instructors WHERE class_run_id=? ORDER BY instructor_id').all(local.run).map((r) => [r.instructor_id, r.role, r.removed_at === null ? 'active' : 'removed']);
const openTeam = async (page) => { if (!(await page.locator('#ops-team').evaluate((d) => d.open))) await page.locator('#ops-team-sum').click(); };
try {
  await setRoster(local.env.HPS_KV, local.cohort, ['student-a', 'student-b', 'student-c']);
  const A = local.teacherToken; // teacher-a: holds every capability, assigned to nothing yet
  const B = await local.teacher('teacher-b', [...OPS_ALL, 'distribute']), O = await local.teacher('teacher-o', [...OPS_ALL, 'override']);

  // ── the owner opens the run with the four toggles ──
  const a = await S.instructor(A); await a.locator('#ops-state').filter({ hasText: '운영 명단이 아직 없습니다' }).waitFor();
  for (const id of ['ops-observe', 'ops-distribute', 'ops-questions', 'ops-collect']) assert.equal(await a.locator('#' + id).isVisible(), true, id + ' is shown in the run configuration');
  assert.match(await T(a, 'ops-toggles'), /관측[\s\S]*학생에게 보내기[\s\S]*질문 카드[\s\S]*기록 회수/);
  await a.locator('#ops-roster').fill('A1,student-a\nA2,student-b\nA3,student-c');
  await a.locator('#ops-observe').check(); await a.locator('#ops-questions').check();
  assert.equal(await a.locator('#ops-distribute').isChecked(), true, 'question cards turn the sending channel on');
  assert.match(await T(a, 'ops-toggles-note'), /학생에게 보내기 통로로 전달되므로 학생에게 보내기도 켰습니다/);
  await a.locator('#ops-collect').check();
  await a.getByRole('button', { name: '명단·설정 저장' }).click(); await a.locator('#ops-seats .ops-seat[data-seat="A3"]').waitFor();
  const f = flags(); assert.deepEqual([f.ops_observe, f.ops_distribute, f.ops_questions, f.ops_collect], [true, true, true, true], 'all four toggles are saved: ' + JSON.stringify(f));
  assert.deepEqual(team(), [['teacher-a', 'owner', 'active']], 'the instructor who configured the run owns it');
  // Sending off takes question cards with it (not saved here); the board then shows what is stored.
  await a.locator('#ops-distribute').uncheck(); assert.equal(await a.locator('#ops-questions').isChecked(), false); assert.match(await T(a, 'ops-toggles-note'), /질문 카드도 꺼집니다/);
  await a.locator('#refresh').click(); await until(a, async () => (await a.locator('#ops-distribute').isChecked()) && (await a.locator('#ops-questions').isChecked()), 'stored flags shown again');
  ok('the four instructor toggles are visible and saved; question cards imply sending, and the page says so');

  await openTeam(a);
  assert.match(await T(a, 'ops-team-sum'), /teacher-a 담당 · 나: 담당 강사\(owner\)/);
  assert.equal(await T(a, 'ops-team-me'), 'teacher-a');
  await a.locator('#ops-team-copy').click(); await a.locator('#ops-team-copied').filter({ hasText: '복사했어요' }).waitFor();
  assert.equal(await a.evaluate(() => navigator.clipboard.readText()), 'teacher-a', 'the copy button copies the instructor id itself');
  assert.equal(await a.locator('#ops-team-add').isVisible(), true); assert.equal(await a.locator('#ops-team-leave').isVisible(), false, 'the owner cannot leave');
  ok('the owner sees who operates the run, their role and their own id with a copy button');

  // ── another instructor of the same cohort, with every capability, is not assigned ──
  const b = await S.instructor(B); await b.locator('#ops-state').filter({ hasText: '배정된 강사만 운영합니다' }).waitFor();
  assert.equal(await T(b, 'ops-state'), '이 수업은 배정된 강사만 운영합니다. 담당 강사(owner)에게 공동 강사 추가를 요청하세요. 담당 강사: teacher-a');
  assert.equal(await b.locator('#ops-seats .ops-seat').count(), 0, 'no learner is shown to an unassigned instructor');
  assert.equal(await b.locator('#ops-team-denied').isVisible(), true); assert.equal(await T(b, 'ops-team-me'), 'teacher-b', 'the refused instructor still sees the id to hand over');
  assert.equal(await b.locator('#ops-setup').isVisible(), false, 'no run setup form is drawn for a run the caller cannot operate (dev host E5 finding)');
  ok('an unassigned instructor sees the not_run_instructor copy, the owner and their own id — and no learner');

  // ── the owner adds the colleague; the colleague operates as co-instructor ──
  await a.locator('#ops-team-handle').fill('teacher-b'); await a.getByRole('button', { name: '공동 강사로 추가' }).click();
  await a.locator('#ops-team-state').filter({ hasText: 'teacher-b을(를) 공동 강사로 추가했습니다.' }).waitFor();
  await until(a, async () => /teacher-b\s*공동 강사/.test(await T(a, 'ops-team-list')), 'co-instructor listed');
  await until(b, async () => (await b.locator('#ops-seats .ops-seat').count()) === 3, 'co-instructor sees the roster');
  await openTeam(b); assert.match(await T(b, 'ops-team-sum'), /teacher-a 담당 · 공동 1명 · 나: 공동 강사/);
  assert.deepEqual([await b.locator('#ops-team-add').isVisible(), await b.locator('#ops-team-leave').isVisible(), await b.locator('#ops-team-list button').count()], [false, true, 0], 'a co-instructor neither adds nor removes others, and may leave');
  // A page that still offers the add form (stale) is answered with the owner_only copy; nothing changes.
  await b.evaluate(() => { document.getElementById('ops-team-add').hidden = false; }); await b.locator('#ops-team-handle').fill('teacher-z'); await b.getByRole('button', { name: '공동 강사로 추가' }).click();
  await b.locator('#ops-team-state').filter({ hasText: '담당 강사(owner)만 공동 강사를 추가하거나 다른 강사를 뺄 수 있습니다.' }).waitFor();
  assert.ok(!team().some(([who]) => who === 'teacher-z'));
  ok('the owner adds a co-instructor by id; the co-instructor operates the run; owner_only is explained');

  await b.locator('#ops-team-leave').click(); await b.locator('#ops-state').filter({ hasText: '배정된 강사만 운영합니다' }).waitFor();
  assert.deepEqual(team().find(([w]) => w === 'teacher-b'), ['teacher-b', 'co', 'removed']);
  await a.locator('#ops-team-handle').fill('teacher-b'); await a.getByRole('button', { name: '공동 강사로 추가' }).click(); await a.locator('#ops-team-state').filter({ hasText: '추가했습니다' }).waitFor();
  await until(a, async () => (await a.locator('#ops-team-list button').count()) === 1, 'remove button');
  await a.getByRole('button', { name: 'teacher-b 공동 강사에서 빼기' }).click(); await a.locator('#ops-team-state').filter({ hasText: '뺐습니다' }).waitFor();
  await until(a, async () => !/teacher-b/.test(await T(a, 'ops-team-list')), 'removed from the list');
  assert.deepEqual(team().find(([w]) => w === 'teacher-b'), ['teacher-b', 'co', 'removed']);
  ok('a co-instructor leaves; the owner re-adds and removes one');

  // ── an override viewer: allowed, told that it is audited ──
  const o = await S.instructor(O, '#ops-seats .ops-seat[data-seat="A1"]');
  await until(o, async () => /관리자 열람 — 기록이 남습니다/.test(await o.locator('#ops-state').textContent()), 'override noted');
  await openTeam(o); assert.equal(await o.locator('#ops-team-override').isVisible(), true); assert.match(await T(o, 'ops-team-sum'), /나: 관리자 열람/);
  assert.ok(local.db.prepare("SELECT COUNT(*) AS n FROM ops_audit WHERE action='instructor_override' AND actor_id='teacher-o'").get().n > 0, 'the override view is audited');
  ok('an override viewer sees the board with “관리자 열람 — 기록이 남습니다”, and the Service audits it');

  // ── participation consent per seat, without hiding anyone ──
  const conn = (await local.pair('A1', 1, 1, ['observe', 'distribution_inbox', 'inbox_question'])).conn.json;
  const given = await local.request('/v1/classroom/ops/participation/consent', 'POST', { consent: true, notice_version: CLASS_DATA_POLICY.notice_version }, conn.credential); assert.equal(given.status, 201, given.raw);
  const consentOf = async (seat) => (await a.locator(`#ops-seats .ops-seat[data-seat="${seat}"] .consent`).textContent())?.trim();
  await until(a, async () => (await consentOf('A1')) === '동의함', 'A1 consent shown');
  assert.deepEqual([await consentOf('A1'), await consentOf('A2'), await consentOf('A3')], ['동의함', '동의 전', '동의 전']);
  assert.equal(await a.locator('#ops-seats .ops-seat:not([hidden])').count(), 3, 'a seat without consent is still on the board');
  ok('each seat shows 동의함 / 동의 전 and no seat is hidden');

  assert.deepEqual(S.errors, [], 'no script error on the instructor pages'); console.log(`\n${n} run-team browser checks passed`);
} finally { await S.close(); }
