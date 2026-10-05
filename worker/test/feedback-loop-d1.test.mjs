// #1013 feedback-loop on actual local workerd/D1 (Miniflare): migration 0039 applies twice over 0002/0003/0026, and the
// statements SQLite cannot vouch for run on D1 itself — json_each source lookup, the guarded INSERT … SELECT … ON CONFLICT
// of the learner's answer, the next-draft batch whose second UPDATE only lands with its own draft write, and the
// ON DELETE CASCADE that withdrawal relies on. Synthetic accounts; no model, no production database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMiniflare } from './harness/miniflare.mjs';
import { localOps } from './harness/classroom-ops.mjs';

const compatibilityDate = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1];
const mf = createMiniflare({ modules: true, script: 'export default {fetch(){return new Response("local test")}}', compatibilityDate, d1Databases: ['HPS_DB'] });
let f;
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
  const learner = await f.student('student-a'), n = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()).n;
  assert.equal((await f.request('/v1/classroom/shares', 'POST', { id: 'd1-share', recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { verification: '390px에서 직접 확인했다', response: 'AI의 답' } }, learner)).status, 201);
  assert.equal((await f.request(`/admin/cohorts/${f.cohort}/classroom/shares/d1-share`, 'PUT', { expected_revision: 1, status: 'answered', feedback: '토요일 시간이 두 줄로 갈립니다', next_action: '다시 확인' })).status, 200);
  const answer = { expected_revision: 2, decision: 'revise', reason: '목록으로 바꾸겠습니다' };
  const answers = await Promise.all([f.request('/v1/classroom/shares/d1-share/response', 'POST', answer, learner), f.request('/v1/classroom/shares/d1-share/response', 'POST', answer, learner)]);
  assert.deepEqual(answers.map((r) => r.status).sort(), [200, 201], 'two copies of one answer: one write, one replay');
  assert.equal(await n('SELECT count(*) AS n FROM classroom_share_responses'), 1);

  const doc = { hypothesis: '기준을 먼저 적으면 스스로 찾는다', findings: [{ id: 'f1', text: '직접 확인했고 사람의 피드백 뒤 고치기로 했다', sources: [{ share_id: 'd1-share', part: 'verification' }, { share_id: 'd1-share', part: 'feedback' }, { share_id: 'd1-share', part: 'learner_response' }] }], decisions: [{ id: 'd1', target: 'build', action: 'revise', reason: '모바일 확인을 넣는다', findings: ['f1'] }] };
  const created = await f.request(retros, 'POST', { request_id: 'd1-retro', base_version: V1, doc }); assert.equal(created.status, 201, created.raw);
  assert.deepEqual([created.json.findings[0].status, created.json.findings[0].human_feedback], ['observed', 'present']);
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
  const v = (await f.request(`${retros}/${id}`)).json;
  assert.deepEqual([v.findings[0].status, v.findings[0].unobserved_reason], ['unobserved', 'sources_unavailable']);
  await apply();
  assert.equal(await n('SELECT count(*) AS n FROM lesson_retrospectives'), 1, 're-applying the migration over data changes nothing');
  console.log('PASS actual local workerd/D1: idempotent 0039, guarded learner answer, json_each sources, one-batch next draft under a race, cascade on withdrawal');
} finally { f?.close(); await mf.dispose(); }
