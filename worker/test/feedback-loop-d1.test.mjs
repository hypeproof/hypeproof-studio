// #1013 feedback-loop on actual local workerd/D1 (Miniflare): migration 0039 applies twice over 0002/0003/0026, and the
// statements SQLite cannot vouch for run on D1 itself — json_each source lookup, the guarded INSERT … SELECT … ON CONFLICT
// of the learner's answer and of the share's lesson record, the next-draft batch whose second UPDATE only lands with its
// own draft write, and the ON DELETE CASCADE that withdrawal relies on; on a second database with the whole schema, the lesson
// record of a share sent from an enforced lesson setting. Synthetic accounts; no model, no production database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMiniflare } from './harness/miniflare.mjs';
import { localOps, OPS_ALL } from './harness/classroom-ops.mjs';
import { TEST_SECRET } from './harness/index.mjs';
const { issue } = await import('../src/lib/tokens.ts');
const { readLesson } = await import('../src/lib/lesson-delivery.ts');

const compatibilityDate = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1];
// HPS_DB: the migrations this slice builds on, remote operations off. HPS_DB_OPS: the whole schema, remote operations and
// enforced lesson settings on (review round 2: the lesson a share records when its sender was switched by a setting).
const mf = createMiniflare({ modules: true, script: 'export default {fetch(){return new Response("local test")}}', compatibilityDate, d1Databases: ['HPS_DB', 'HPS_DB_OPS'] });
let f, g;
try {
  const db = await mf.getD1Database('HPS_DB');
  const apply = async () => {
    for (const file of ['0002-chalk-authoring.sql', '0003-classroom-sharing.sql', '0026-authoring-rehearsal.sql', '0039-feedback-loop.sql']) {
      const sql = readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8').replace(/^--.*$/gm, '');
      for (const s of sql.split(';').map((x) => x.trim()).filter(Boolean)) await db.prepare(s).run();
    }
  };
  await apply(); await apply();
  // Remote operations off: the web share path then needs no class-run tables (the routes under test do not either).
  f = await localOps({ binding: db, enabled: false }); f.env.HPS_FEEDBACK_LOOP = 'enabled';
  const course = f.lesson.course_id, V1 = f.lesson.version, authoring = `/admin/cohorts/${f.cohort}/authoring/${course}`, retros = authoring + '/retrospectives';
  await f.freeze(course, V1, ['intro', 'build', 'review']);
  const v1 = await readLesson(f.env, f.cohort, course, V1, f.profile), n = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()).n;
  const learner = (await issue({ u: 'student-a', c: f.cohort, p: f.profile, lesson: { course_id: course, version: V1, sha256: v1.sha256 } }, 2, TEST_SECRET)).token;
  assert.equal((await f.request('/v1/classroom/shares', 'POST', { id: 'd1-share', recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { verification: '390px에서 직접 확인했다', response: 'AI의 답' } }, learner)).status, 201);
  // The lesson record is written on D1 by its guarded INSERT … SELECT … ON CONFLICT, once.
  assert.deepEqual({ ...(await db.prepare('SELECT course_id, version, lesson_sha256, source FROM classroom_share_lessons WHERE share_id=?').bind('d1-share').first()) }, { course_id: course, version: V1, lesson_sha256: v1.sha256, source: 'token' });
  assert.equal((await f.request(`/admin/cohorts/${f.cohort}/classroom/shares/d1-share`, 'PUT', { expected_revision: 1, status: 'answered', feedback: '토요일 시간이 두 줄로 갈립니다', next_action: '다시 확인' })).status, 200);
  const answer = { expected_revision: 2, decision: 'revise', reason: '목록으로 바꾸겠습니다' };
  const answers = await Promise.all([f.request('/v1/classroom/shares/d1-share/response', 'POST', answer, learner), f.request('/v1/classroom/shares/d1-share/response', 'POST', answer, learner)]);
  assert.deepEqual(answers.map((r) => r.status).sort(), [200, 201], 'two copies of one answer: one write, one replay');
  assert.equal(await n('SELECT count(*) AS n FROM classroom_share_responses'), 1);

  const doc = { hypothesis: '기준을 먼저 적으면 스스로 찾는다', findings: [{ id: 'f1', text: '직접 확인했고 사람의 피드백 뒤 고치기로 했다', sources: [{ share_id: 'd1-share', part: 'verification' }, { share_id: 'd1-share', part: 'feedback' }, { share_id: 'd1-share', part: 'learner_response' }] }], decisions: [{ id: 'd1', target: 'build', action: 'revise', reason: '모바일 확인을 넣는다', findings: ['f1'] }] };
  const created = await f.request(retros, 'POST', { request_id: 'd1-retro', base_version: V1, doc }); assert.equal(created.status, 201, created.raw);
  assert.deepEqual([created.json.findings[0].status, created.json.findings[0].human_feedback, created.json.findings[0].sources.map((s) => s.lesson)], ['observed', 'present', ['this_version', 'this_version', 'this_version']]);
  assert.deepEqual(await f.request(retros, 'POST', { request_id: 'd1-other', base_version: V1, doc: { ...doc, findings: [{ ...doc.findings[0], sources: [{ share_id: 'no-such', part: 'verification' }] }] } }).then((r) => [r.status, r.json.reason]), [409, 'source_unavailable']);

  // Two different starts race on one draft revision: exactly one batch lands, both of its writes or neither.
  const rev = (await f.request(authoring)).json.revision, id = created.json.id;
  const raced = await Promise.all(['d1-a', 'd1-b'].map((rq) => f.request(`${retros}/${id}/next-draft`, 'POST', { request_id: rq, expected_draft_revision: rev })));
  assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409], raced.map((r) => r.raw).join('\n'));
  const winner = raced.find((r) => r.status === 201).json, after = await db.prepare('SELECT revision, request_id FROM authoring_drafts WHERE course_id=?').bind(course).first();
  assert.equal(after.revision, rev + 1, 'the draft moved exactly once');
  const marked = await db.prepare('SELECT applied_draft_revision, applied_request_id FROM lesson_retrospectives WHERE retro_id=?').bind(id).first();
  assert.deepEqual([marked.applied_draft_revision, marked.applied_request_id], [rev + 1, after.request_id], 'marked by the write that moved the draft, and only by it');
  assert.equal(winner.draft.revision, rev + 1);

  // Withdrawal: the learner's answer goes with the share (D1 enforces the cascade); the retrospective keeps only a dead reference.
  assert.equal((await f.request('/v1/classroom/shares/d1-share', 'DELETE', undefined, learner)).status, 200);
  assert.equal(await n('SELECT count(*) AS n FROM classroom_share_responses'), 0);
  assert.equal(await n('SELECT count(*) AS n FROM classroom_share_lessons'), 0, 'the lesson record goes with the share');
  const v = (await f.request(`${retros}/${id}`)).json;
  assert.deepEqual([v.findings[0].status, v.findings[0].unobserved_reason], ['unobserved', 'sources_unavailable']);
  await apply();
  assert.equal(await n('SELECT count(*) AS n FROM lesson_retrospectives'), 1, 're-applying the migration over data changes nothing');
  console.log('PASS actual local workerd/D1: idempotent 0039, guarded learner answer and lesson record, json_each sources, one-batch next draft under a race, cascade on withdrawal');

  // Slice 2 review r1 — what a task record says about help is read only after THIS instructor opened the share through the
  // audited view: the `view` row lookup (json_each, actor, action) on D1 itself. Before that: a named refusal, no basis.
  assert.equal((await f.request('/v1/classroom/shares', 'POST', { id: 'd1-task', recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { verification: '시연과 다른 날짜로 바꿨다', independent_task: { task: '시연과 다른 날짜의 휴진 공지', help: ['ai_made'] } } }, learner)).status, 201);
  const helped = { hypothesis: '받은 도움을 스스로 적는다', findings: [{ id: 'f1', text: 'AI가 대신 만들었다고 적었다', sources: [{ share_id: 'd1-task', part: 'independent_task' }], assistance: 'assisted' }], decisions: [{ id: 'd1', target: 'lesson', action: 'hold', reason: '더 본다' }] };
  assert.deepEqual(await f.request(retros, 'POST', { request_id: 'd1-unopened', base_version: V1, doc: helped }).then((r) => [r.status, r.json.reason]), [409, 'record_not_opened']);
  assert.equal(await n("SELECT count(*) AS n FROM classroom_share_audit WHERE share_id='d1-task'"), 0, 'the refusal wrote no audit row');
  assert.equal((await f.request(`/admin/cohorts/${f.cohort}/classroom/shares/d1-task`)).status, 200, 'the instructor opens it (audited)');
  const opened = await f.request(retros, 'POST', { request_id: 'd1-opened', base_version: V1, doc: helped }); assert.equal(opened.status, 201, opened.raw);
  assert.deepEqual([opened.json.findings[0].assistance_basis, opened.json.findings[0].sources[0].self_reported_help, opened.json.coverage.help_reported], [['learner_report'], 'help', { source_state: 'self_reported', with_help: 1, no_help: 0, not_opened: 0 }]);
  console.log('PASS actual local workerd/D1: a task record\'s reported help is read only after the instructor\'s audited view of that share');

  // Review round 2 — where lesson settings are enforced, the gate's binding read and the guarded lesson-record INSERT on D1
  // itself: a learner switched to S2 by a setting (saved, sent, held by the device, switched through the existing routes)
  // shares, and the share records S2 with source `setting`; a V1 retrospective refuses it, an S2 one takes it as this version.
  const ops = await mf.getD1Database('HPS_DB_OPS');
  for (const s of readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean)) await ops.prepare(s).run();
  g = await localOps({ binding: ops }); g.env.HPS_LESSON_BINDINGS = 'enforce'; g.env.HPS_FEEDBACK_LOOP = 'enabled';
  // localOps writes these two rows itself only into its own SQLite; production has them for every class run.
  await ops.prepare('INSERT OR IGNORE INTO cohorts(id,display_name) VALUES(?,?)').bind(g.cohort, g.cohort).run();
  await ops.prepare('INSERT OR IGNORE INTO sessions(id,cohort_id,profile_id,starts_at,ends_at) VALUES(?,?,?,?,?)').bind(g.run, g.cohort, g.profile, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 3600000).toISOString()).run();
  const gc = g.lesson.course_id, S1 = g.lesson.version, S2 = 'm2026.09.18-2', ga = `/admin/cohorts/${g.cohort}/authoring/${gc}`, KEY = () => crypto.randomUUID();
  await g.freeze(gc, S1, ['intro', 'build', 'review']);
  const cur = (await g.request(ga)).json, next = await g.request(ga, 'PUT', { profile_id: g.profile, request_id: KEY(), expected_revision: cur.revision, content: { ...cur.content, title: '합성 수업 v2' } });
  assert.equal(next.status, 200, next.raw); assert.equal((await g.request(`${ga}/versions/${S2}`, 'PUT', { expected_revision: next.json.revision })).status, 200);
  const sha = {}; for (const v of [S1, S2]) sha[v] = (await readLesson(g.env, g.cohort, gc, v, g.profile)).sha256;
  assert.equal((await g.configure([{ seat_id: 'A1', student_id: 'student-a' }], 0, { flags: { ops_observe: true, ops_commands: true, ops_distribute: true, ops_lesson_settings: true } })).status, 201);
  const a1 = (await g.pair('A1', 1, 1, ['observe', 'commands', 'distribution_inbox', 'inbox_prompt', 'lesson_binding'])).conn.json;
  const tokenA = (await issue({ u: 'student-a', c: g.cohort, p: g.profile, lesson: { course_id: gc, version: S1, sha256: sha[S1] } }, 2, TEST_SECRET)).token;
  const L = await g.teacher('teacher-l', [...OPS_ALL, 'distribute', 'lesson_settings']);
  const setting = await g.request(g.base + '/contents', 'POST', { idempotency_key: KEY(), kind: 'setting', title: '2번째 판', body: '다음 질문부터 새 단계로 진행합니다.', lesson: { course_id: gc, version: S2, sha256: sha[S2] } }, L); assert.equal(setting.status, 201, setting.raw);
  const sent = await g.request(g.base + '/distributions', 'POST', { idempotency_key: KEY(), expected_roster_revision: 1, object_id: setting.json.object_id, revision: setting.json.revision, content_hash: setting.json.content_hash, targets: ['A1'] }, L); assert.ok(sent.json?.distribution, sent.raw);
  await ops.prepare('UPDATE classroom_distribution_targets SET next_offer_at=0').run();
  const [item] = (await g.sync(a1.credential, [], 1)).json.distribution?.items ?? []; assert.ok(item, 'the device holds the setting');
  const receipt = (stage) => ({ offer_key: item.offer_key, distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, seq: item.seq, stage, result_code: '', observed_at: Date.now() });
  assert.ok((await g.sync(a1.credential, [], 1, { distribution: { receipts: [receipt('received'), receipt('reflected')] } })).json.distribution.receipt_acks.every((x) => x.recorded));
  const sw = await g.request('/v1/classroom/ops/lesson-binding', 'POST', { app_instance_id: g.instance(1).app_instance_id, boot_id: g.instance(1).boot_id, offer_key: item.offer_key, distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, base_lesson_sha256: sha[S1], learner_token: tokenA }, a1.credential);
  assert.equal(sw.status, 201, sw.raw);
  const recipient = (await g.request('/v1/classroom/help-recipient', 'GET', undefined, tokenA)).json.recipient_id;
  assert.equal((await g.request('/v1/classroom/shares', 'POST', { id: 'd1-switched', recipient_id: recipient, kind: 'submission', consent: true, duration_minutes: 60, content: { verification: '바뀐 단계에서 직접 확인했다' } }, tokenA)).status, 201);
  assert.deepEqual({ ...(await ops.prepare('SELECT course_id, version, lesson_sha256, source FROM classroom_share_lessons WHERE share_id=?').bind('d1-switched').first()) }, { course_id: gc, version: S2, lesson_sha256: sha[S2], source: 'setting' });
  const cite = (version) => g.request(`${ga}/retrospectives`, 'POST', { request_id: KEY(), base_version: version, doc: { hypothesis: '바뀐 단계가 확인을 돕는다', findings: [{ id: 'f1', text: '직접 확인했다', sources: [{ share_id: 'd1-switched', part: 'verification' }] }], decisions: [{ id: 'd1', target: 'lesson', action: 'keep', reason: '유지' }] } });
  assert.deepEqual(await cite(S1).then((r) => [r.status, r.json.reason]), [409, 'source_other_lesson']);
  const taken = await cite(S2); assert.equal(taken.status, 201, taken.raw); assert.equal(taken.json.findings[0].sources[0].lesson, 'this_version');
  console.log('PASS actual local workerd/D1: under enforced lesson settings a share records the setting its sender was switched to (source setting); only that version\'s retrospective takes it');
} finally { f?.close(); g?.close(); await mf.dispose(); }
