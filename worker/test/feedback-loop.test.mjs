// #1013 feedback-loop — a person's feedback → the learner's own answer (AE-43) → the instructor's retrospective of the
// version that ran → the next draft and its next rehearsal (AE-42, CH-05). Real Service routing, real token verifier and
// SQLite (schema.sql carries migration 0039); every account and share is synthetic. No model is called.
// Says nothing about a real class, a real person's feedback or an installed Studio: those stay NOT RUN.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localOps, OPS_ALL } from './harness/classroom-ops.mjs';

const L = await import('../src/lib/feedback-loop.ts');
const { isHumanEvidence, forbidPersonalMetrics } = await import('../src/lib/measurement-core/learning-events.ts');
const { HELP_MODES } = await import('../src/lib/lesson-help-mode.ts');
const { readLesson } = await import('../src/lib/lesson-delivery.ts');
const { makeModuleDoc } = await import('../src/lib/modules.ts');
const { setRoster } = await import('../src/lib/kv.ts');
const { issue, issueIssuer } = await import('../src/lib/tokens.ts');
const { TEST_SECRET } = await import('./harness/index.mjs');
const MIGRATION = readFileSync(new URL('../migrations/0039-feedback-loop.sql', import.meta.url), 'utf8');
let passed = 0; const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const KEY = () => crypto.randomUUID();

// ── pure rules first: the instrument has to tell the cases apart before the routes are judged with it ─────────────
await check('rules — whose words: only the learner\'s own words make a finding observed; the instructor\'s feedback is the feedback axis only', async () => {
  assert.equal(L.PART_ORIGIN.response, 'ai'); assert.equal(L.PART_ORIGIN.feedback, 'human');
  assert.deepEqual(['question', 'prompt', 'verification', 'learner_response'].map((p) => L.PART_ORIGIN[p]), ['learner', 'learner', 'learner', 'learner']);
  // One definition (SX-48): the measurement core's predicate decides for every origin. Feedback is written by the share's
  // recipient, an instructor, and `teacher` is never human evidence there.
  for (const [origin, event] of Object.entries(L.ORIGIN_EVENT)) assert.equal(L.isLearnerEvidence(origin), isHumanEvidence(event), origin);
  assert.deepEqual(Object.keys(L.ORIGIN_EVENT).filter((o) => L.isLearnerEvidence(o)), ['learner']);
  assert.equal(L.ORIGIN_EVENT.human.actor, 'teacher');
  const live = (parts, kind = 'submission') => () => ({ available: true, kind, student_id: 's', parts: new Set(parts), lesson: 'this_version', response_current: true });
  const f = (sources, assistance = 'unknown') => ({ id: 'f', text: 't', sources, assistance });
  // Positive: the learner's own words, with or without the feedback that came with them.
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'verification' }]), live(['verification'])).status, 'observed');
  const both = L.findingView(f([{ share_id: 'a', part: 'verification' }, { share_id: 'a', part: 'feedback' }]), live(['verification', 'feedback']));
  assert.deepEqual([both.status, both.human_feedback], ['observed', 'present']);
  // Negative: the instructor's own feedback (alone or beside the AI answer) fills only the feedback axis.
  const fb = L.findingView(f([{ share_id: 'a', part: 'response' }, { share_id: 'a', part: 'feedback' }]), live(['response', 'feedback']));
  assert.deepEqual([fb.status, fb.unobserved_reason, fb.human_feedback], ['unobserved', 'no_person_source', 'present']);
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'feedback' }]), live(['feedback'])).status, 'unobserved');
  // Negative: the AI answer alone, a tool line alone, nothing cited, or a withdrawn share are all unobserved — named.
  const ai = L.findingView(f([{ share_id: 'a', part: 'response' }]), live(['response']));
  assert.deepEqual([ai.status, ai.unobserved_reason, ai.human_feedback], ['unobserved', 'no_person_source', 'unobserved']);
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'tool_summary' }]), live(['tool_summary'])).unobserved_reason, 'no_person_source');
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'artifact_url' }]), live(['artifact_url'])).unobserved_reason, 'no_person_source');
  assert.equal(L.findingView(f([]), live([])).unobserved_reason, 'no_source');
  const gone = L.findingView(f([{ share_id: 'a', part: 'question' }], 'assisted'), () => ({ available: false }));
  assert.deepEqual([gone.status, gone.unobserved_reason, gone.assistance, gone.assistance_basis_unavailable], ['unobserved', 'sources_unavailable', 'unknown', true]);
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'question' }], 'assisted'), live(['question'], 'help')).assistance, 'assisted');
});
await check('rules — which version: after the freeze, and under that course and version where the Service recorded it; otherwise "unknown"', async () => {
  const base = { course_id: 'c', version: 'v2', frozen_at: 100 };
  assert.equal(L.lessonRefusal({ created_at: 99 }, null, base), 'source_before_version');
  assert.equal(L.lessonRefusal({ created_at: 99 }, { course_id: 'c', version: 'v2' }, base), 'source_before_version');
  assert.equal(L.lessonRefusal({ created_at: 100 }, null, base), '');
  assert.equal(L.lessonRefusal({ created_at: 200 }, { course_id: 'other', version: 'v2' }, base), 'source_other_lesson');
  assert.equal(L.lessonRefusal({ created_at: 200 }, { course_id: 'c', version: 'v1' }, base), 'source_other_lesson');
  assert.equal(L.lessonRefusal({ created_at: 200 }, { course_id: 'c', version: 'v2' }, base), '');
  assert.equal(L.lessonRefusal({ created_at: 200 }, null, { ...base, frozen_at: null }), 'source_before_version', 'an unreadable freeze time refuses, never guesses');
  assert.deepEqual([L.lessonAttribution(null), L.lessonAttribution({ course_id: 'c', version: 'v2' })], ['unknown', 'this_version']);
  // The view says what it does not know: an unrecorded lesson, a decision about edited feedback, a part that is empty now.
  const f = { id: 'f', text: 't', sources: [{ share_id: 'a', part: 'question' }, { share_id: 'a', part: 'learner_response' }, { share_id: 'a', part: 'feedback' }], assistance: 'unknown' };
  const v = L.findingView(f, () => ({ available: true, kind: 'help', student_id: 's', parts: new Set(['question', 'learner_response']), lesson: 'unknown', response_current: false }));
  assert.deepEqual([v.status, v.lesson_unconfirmed, v.stale_learner_response, v.human_feedback], ['observed', true, true, 'unobserved']);
  assert.deepEqual(v.sources.map((s) => [s.part, s.available, s.lesson, s.answers_current_feedback, s.part_empty]),
    [['question', true, 'unknown', undefined, undefined], ['learner_response', true, 'unknown', false, undefined], ['feedback', false, undefined, undefined, true]]);
  const known = L.findingView({ ...f, sources: f.sources.slice(0, 2) }, () => ({ available: true, kind: 'help', student_id: 's', parts: new Set(['question', 'learner_response']), lesson: 'this_version', response_current: true }));
  assert.deepEqual(['lesson_unconfirmed' in known, 'stale_learner_response' in known], [false, false]);
  assert.equal(L.answerRefusal({ part: 'learner_response' }, { response_current: false }), 'learner_response_stale');
  assert.equal(L.answerRefusal({ part: 'learner_response' }, { response_current: true }), '');
  assert.equal(L.answerRefusal({ part: 'question' }, { response_current: false }), '');
});
await check('rules — which answer a reader sees (review round 2): the one bound to the feedback as it reads now, else the newest; whatever the status', async () => {
  const A = { share_id: 's', feedback_sha256: 'a', feedback_revision: 2, decision: 'keep', reason: 'A', created_at: 100 };
  const B = { ...A, feedback_sha256: 'b', feedback_revision: 3, decision: 'revise', reason: 'B', created_at: 200 };
  for (const rows of [[A, B], [B, A]]) {
    assert.equal(L.responseFor(rows, 'a'), A, 'feedback back to text A: the answer to A, not the newer answer to B');
    assert.equal(L.responseFor(rows, 'b'), B);
    assert.equal(L.responseFor(rows, 'c'), B, 'no answer to the current text: the newest');
    assert.equal(L.responseFor(rows, null), B);
  }
  const sameSecond = { ...B, created_at: A.created_at };
  for (const rows of [[A, sameSecond], [sameSecond, A]]) assert.equal(L.responseFor(rows, 'c'), sameSecond, 'written in the same second: the later feedback revision');
  assert.equal(L.responseFor([], 'a'), null);
  // The text an answer is compared with is the stored text; "검토 중" or not is the route's question of whether a NEW answer may be written.
  assert.deepEqual([L.storedFeedback({ feedback: '피드백' }), L.storedFeedback({ feedback: '  ' }), L.storedFeedback({ feedback: undefined })], ['피드백', null, null]);
});
await check('rules — the doc: exact keys, named refusals, no independence and no score', async () => {
  const doc = { hypothesis: '힌트 방식이면 스스로 기준을 세운다', findings: [{ id: 'f1', text: '기준을 적었다', sources: [{ share_id: 's1', part: 'verification' }] }], decisions: [{ id: 'd1', target: 'build', action: 'revise', reason: '예시를 줄인다', findings: ['f1'] }] };
  const ok = L.validateRetrospectiveDoc(doc, ['intro', 'build']); assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.doc.findings[0].assistance, 'unknown', 'no record → unknown, never filled in');
  const bad = (patch, code) => assert.equal(L.validateRetrospectiveDoc({ ...doc, ...patch }, ['intro', 'build']).code, code, code);
  bad({ hypothesis: ' ' }, 'invalid_hypothesis');
  bad({ findings: [] }, 'invalid_findings');
  bad({ findings: [{ ...doc.findings[0], assistance: 'independent' }] }, 'unsupported_independence');
  bad({ findings: [{ ...doc.findings[0], sources: [{ share_id: 's1', part: 'everything' }] }] }, 'invalid_source');
  bad({ findings: [{ ...doc.findings[0], sources: [doc.findings[0].sources[0], doc.findings[0].sources[0]] }] }, 'duplicate_source');
  bad({ decisions: [{ ...doc.decisions[0], target: 'not-a-step' }] }, 'unknown_step');
  bad({ decisions: [{ ...doc.decisions[0], findings: ['nope'] }] }, 'unknown_finding');
  bad({ decisions: [{ ...doc.decisions[0], action: 'delete' }] }, 'invalid_decision');
  bad({ findings: [{ ...doc.findings[0], score: 3 }] }, 'unsupported_score');
  bad({ extra: 1 }, 'invalid_retrospective');
  bad({ notes: { mood: 'x' } }, 'invalid_notes');
  // Review round 2: a part is one of the eight names, never a name the object inherits.
  for (const part of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) bad({ findings: [{ ...doc.findings[0], sources: [{ share_id: 's1', part }] }] }, 'invalid_source');
  assert.equal(L.parseResponse({ expected_revision: 2, decision: 'agree', reason: 'x' }).code, 'invalid_decision');
  assert.equal(L.parseResponse({ expected_revision: 2, decision: 'keep', reason: '  ' }).code, 'invalid_reason');
  assert.equal(L.parseResponse({ expected_revision: 2, decision: 'keep', reason: 'x', score: 1 }).code, 'unknown_field');
});
await check('rules — the learner\'s records (EDU-04/05): exact keys, named refusals, "no help" stands alone, help in a fixed order, no score, only on a submission', async () => {
  // The AI help a learner may name is the lesson's own help vocabulary, without `independent` (a strategy, not help).
  assert.deepEqual(L.TASK_HELP.filter((h) => HELP_MODES.includes(h)), HELP_MODES.filter((m) => m !== 'independent'));
  assert.deepEqual(L.TASK_HELP.filter((h) => !HELP_MODES.includes(h)), ['none', 'ai_made', 'person']);
  const task = { task: '시연은 10월 9일 휴진 공지, 나는 10월 16일로 바꾸고 다른 문구가 그대로인지 봤다', help: ['person', 'hint'], help_note: '줄바꿈 위치만 물었다' };
  const items = [{ work: '휴진 공지 문구 수정', how: 'direct' }, { work: '도메인 연결', how: 'expert', note: '업체에 맡긴다' }];
  const ok = L.parseShareRecords({ verification: 'x', independent_task: task, self_reliance: items }, 'submission');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.records.independent_task, { ...task, help: ['hint', 'person'] }, 'the same choice is the same stored record, whatever order it was ticked in');
  assert.deepEqual(ok.records.self_reliance, items);
  assert.deepEqual(L.parseShareRecords({ verification: 'x' }, 'submission'), { ok: true, records: {} }, 'no record: nothing is filled in for the learner');
  assert.deepEqual(L.parseShareRecords({ independent_task: { ...task, help_note: '  ' } }, 'submission').records.independent_task, { task: task.task, help: ['hint', 'person'] }, 'an empty note is not stored');
  const bad = (content, code, kind = 'submission') => assert.equal(L.parseShareRecords(content, kind).code, code, code + ' ← ' + JSON.stringify(content).slice(0, 80));
  bad({ independent_task: task }, 'record_needs_submission', 'help');
  bad({ self_reliance: items }, 'record_needs_submission', 'help');
  bad({ independent_task: { ...task, help: ['none', 'hint'] } }, 'help_none_with_other');
  for (const help of [[], ['independent'], ['hint', 'hint'], 'hint', ['constructor']]) bad({ independent_task: { ...task, help } }, 'invalid_help');
  bad({ independent_task: { ...task, task: '  ' } }, 'invalid_task');
  bad({ independent_task: { ...task, task: '가'.repeat(L.RECORD_LIMITS.task + 1) } }, 'invalid_task');
  bad({ independent_task: { ...task, help_note: 3 } }, 'invalid_help_note');
  bad({ independent_task: { ...task, grade: 'A' } }, 'unsupported_score');
  bad({ independent_task: { ...task, independent: true } }, 'invalid_independent_task');
  bad({ independent_task: 'did it' }, 'invalid_independent_task');
  bad({ self_reliance: [] }, 'invalid_self_reliance');
  bad({ self_reliance: items[0] }, 'invalid_self_reliance');
  bad({ self_reliance: Array.from({ length: L.RECORD_LIMITS.items + 1 }, () => items[0]) }, 'invalid_self_reliance');
  bad({ self_reliance: [{ ...items[0], how: 'independent' }] }, 'invalid_how');
  bad({ self_reliance: [{ ...items[0], work: '' }] }, 'invalid_work');
  bad({ self_reliance: [{ ...items[0], level: 3 }] }, 'unsupported_score');
  bad({ self_reliance: [{ ...items[0], note: 'x'.repeat(L.RECORD_LIMITS.note + 1) }] }, 'invalid_reliance_note');
  // Masking reaches every learner-written string and nothing else.
  const masked = L.maskRecords(ok.records, (s) => '<' + s + '>');
  assert.deepEqual([masked.independent_task.task, masked.independent_task.help_note, masked.independent_task.help, masked.self_reliance.map((i) => [i.work, i.how, i.note])],
    ['<' + task.task + '>', '<' + task.help_note + '>', ['hint', 'person'], [['<휴진 공지 문구 수정>', 'direct', undefined], ['<도메인 연결>', 'expert', '<업체에 맡긴다>']]]);
  // Whose words: both records are the learner's own; the part names come from PART_ORIGIN like every other part.
  assert.deepEqual([L.PART_ORIGIN.independent_task, L.PART_ORIGIN.self_reliance], ['learner', 'learner']);
  // What a task record says about help, as a category: help named → help; only "none" → no_help; no record → null (unknown).
  const as = (c) => L.reportedHelpOf({ content_json: JSON.stringify(c) });
  assert.deepEqual([as({ independent_task: task }), as({ independent_task: { ...task, help: ['none'] } }), as({ verification: 'x' }), as({ self_reliance: items })], ['help', 'no_help', null, null]);
  const row = (content) => ({ id: 's', content_json: JSON.stringify(content), status: 'received', feedback: '' });
  assert.deepEqual(L.shareParts(row({ verification: 'x', independent_task: task, self_reliance: items }), false).map((p) => p.part + ':' + p.origin), ['verification:learner', 'independent_task:learner', 'self_reliance:learner']);
  assert.deepEqual(L.shareParts(row({ verification: 'x', self_reliance: [] }), false).map((p) => p.part), ['verification'], 'an empty list is no part');
});
await check('rules — help in a finding (EDU-04, T-44): `assisted` stands on a help request or on the learner\'s own record naming help; "no help" is a self-report, never independence; reported help is counted apart', async () => {
  const live = (over = {}) => () => ({ available: true, kind: 'submission', student_id: 's1', parts: new Set(['independent_task', 'self_reliance', 'verification']), lesson: 'this_version', response_current: true, ...over });
  const f = (sources, assistance = 'unknown') => ({ id: 'f', text: 't', sources, assistance });
  const helped = L.findingView(f([{ share_id: 'a', part: 'independent_task' }], 'assisted'), live({ reported_help: 'help' }));
  assert.deepEqual([helped.status, helped.assistance, helped.assistance_basis, helped.sources[0].self_reported_help], ['observed', 'assisted', ['learner_report'], 'help']);
  const none = L.findingView(f([{ share_id: 'a', part: 'independent_task' }]), live({ reported_help: 'no_help' }));
  assert.deepEqual([none.status, none.assistance, 'assistance_basis' in none, none.sources[0].self_reported_help], ['observed', 'unknown', false, 'no_help'], '"no help" is the learner\'s words, not a finding of independence');
  // The basis is the record part itself: another part of the same share does not carry it.
  const other = L.findingView(f([{ share_id: 'a', part: 'verification' }], 'assisted'), live({ reported_help: 'help' }));
  assert.deepEqual([other.assistance, other.assistance_basis_unavailable, 'self_reported_help' in other.sources[0]], ['unknown', true, false]);
  // The learner's sorting of their own scope is their words; nothing about help or independence is derived from it.
  const scope = L.findingView(f([{ share_id: 'a', part: 'self_reliance' }]), live({ reported_help: 'help' }));
  assert.deepEqual([scope.status, scope.assistance, 'self_reported_help' in scope.sources[0]], ['observed', 'unknown', false]);
  const both = L.findingView(f([{ share_id: 'a', part: 'independent_task' }, { share_id: 'b', part: 'question' }], 'assisted'),
    (id) => (id === 'a' ? live({ reported_help: 'help' })() : { ...live()(), kind: 'help', parts: new Set(['question']) }));
  assert.deepEqual(both.assistance_basis, ['help_request', 'learner_report']);
  const gone = L.findingView(f([{ share_id: 'a', part: 'independent_task' }], 'assisted'), () => ({ available: false }));
  assert.deepEqual([gone.status, gone.assistance, gone.assistance_basis_unavailable], ['unobserved', 'unknown', true], 'a withdrawn record carries no basis');
  // Written: the same bases decide.
  const refusal = (sources, shares) => L.assistanceRefusal(f(sources, 'assisted'), (id) => shares[id]);
  assert.equal(refusal([{ share_id: 'a', part: 'independent_task' }], { a: { kind: 'submission', reported_help: 'help' } }), '');
  assert.equal(refusal([{ share_id: 'a', part: 'independent_task' }], { a: { kind: 'submission', reported_help: 'no_help' } }), 'unsupported_assistance');
  assert.equal(refusal([{ share_id: 'a', part: 'verification' }], { a: { kind: 'submission', reported_help: 'help' } }), 'unsupported_assistance');
  assert.equal(refusal([{ share_id: 'b', part: 'question' }], { b: { kind: 'help', reported_help: null } }), '');
  assert.equal(refusal([{ share_id: 'x', part: 'independent_task' }], {}), 'unsupported_assistance', 'an unreadable share is no basis');
  // The denominator: per learner, self-reported; a learner with any record naming help counts once, as with_help; no record → neither.
  const cov = L.coverageOf(['s1', 's2', 's3'], [
    L.findingView(f([{ share_id: 'a', part: 'independent_task' }]), live({ reported_help: 'help' })),
    L.findingView(f([{ share_id: 'a2', part: 'independent_task' }]), live({ reported_help: 'no_help' })),
    L.findingView(f([{ share_id: 'c', part: 'independent_task' }]), () => ({ ...live({ reported_help: 'no_help' })(), student_id: 's2' })),
    L.findingView(f([{ share_id: 'd', part: 'verification' }]), () => ({ ...live()(), student_id: 's3' })),
  ]);
  assert.deepEqual([cov.help_use, cov.help_reported, cov.learners_with_sources], ['unobserved', { source_state: 'self_reported', with_help: 1, no_help: 1 }, 3]);
});

// ── HTTP: the whole loop on the real routes ────────────────────────────────────────────────────────────────────
const f = await localOps();
// V3 sorts before V2 by name but is frozen after it, from a later draft revision (the "first candidate" check below).
const course = f.lesson.course_id, V1 = f.lesson.version, V2 = 'm2026.10.05-2', V3 = 'm2026.10.05-1', OTHER = 'other-course', OV = 'm2026.10.01-1';
const authoring = `/admin/cohorts/${f.cohort}/authoring/${course}`, retros = authoring + '/retrospectives', otherRetros = `/admin/cohorts/${f.cohort}/authoring/${OTHER}/retrospectives`;
const teacherShares = `/admin/cohorts/${f.cohort}/classroom/shares`, studentShares = '/v1/classroom/shares';
const one = (sql, ...a) => { const r = f.db.prepare(sql).get(...a); return r ? { ...r } : r; };
const count = (table) => one(`SELECT count(*) AS n FROM ${table}`).n;
const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
try {
  await f.freeze(course, V1, ['intro', 'build', 'review']);
  // Another course of the same instructor on the same profile, frozen before any share below is sent.
  await f.freeze(OTHER, OV, ['intro', 'build', 'review']);
  const v1 = await readLesson(f.env, f.cohort, course, V1, f.profile);
  // A learner code bound to the version that runs, through the existing 학생 초대 route (a 12-hour instructor code, since
  // the route refuses a learner code that would outlive the instructor's own).
  const teacher12 = (await issueIssuer({ issuer: 'teacher-a', scopes: [{ cohort: f.cohort, profiles: [f.profile], ops: OPS_ALL }] }, 12, TEST_SECRET)).token;
  const invited = await f.request(`${authoring}/versions/${V1}/participants`, 'POST', { user: 'student-a', hours: 2 }, teacher12); assert.equal(invited.status, 200, invited.raw);
  const studentA = invited.json.token;
  const studentB = (await issue({ u: 'student-b', c: f.cohort, p: f.profile, lesson: { course_id: course, version: V1, sha256: v1.sha256 } }, 2, TEST_SECRET)).token;
  const studentC = await f.student('student-c'); // a code that names no lesson
  const share = (id, patch, token = studentA) => f.request(studentShares, 'POST', { id, recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { prompt: '진료시간을 바꿔줘', response: 'AI가 쓴 답: 줄바꿈을 넣었습니다', verification: '390px에서 줄바꿈이 깨지는지 직접 봤다' }, ...patch }, token);
  const answer = (id, expected_revision, feedback = '모바일에서 토요일 시간이 두 줄로 갈립니다. 표 대신 목록이 어떨까요?', status = 'answered') => f.request(`${teacherShares}/${id}`, 'PUT', { expected_revision, status, feedback, next_action: '모바일에서 다시 확인' });
  const respond = (id, body, token = studentA) => f.request(`${studentShares}/${id}/response`, 'POST', body, token);
  const retroDoc = (sources, extra = {}) => ({ hypothesis: '근거 확인', findings: [{ id: 'f1', text: '근거', sources, ...extra }], decisions: [{ id: 'd1', target: 'lesson', action: 'keep', reason: '유지' }] });

  await check('switch off (default), on a database WITHOUT migration 0039: no route answers, a share is stored as before, reads keep their exact shape', async () => {
    // The case the switch exists for: a production D1 the migration has not reached. Any read or write of a 0039 table fails here.
    for (const t of ['classroom_share_responses', 'classroom_share_lessons', 'lesson_retrospectives']) f.db.exec(`DROP TABLE ${t}`);
    const logged = [], origError = console.error; console.error = (...a) => { logged.push(a.map(String).join(' ')); };
    try {
      assert.equal((await share('share-before')).status, 201, 'a learner with a lesson-bound code shares as before');
      assert.deepEqual(await f.request(retros).then((r) => [r.status, r.json.reason]), [404, 'feedback_loop_unavailable']);
      assert.deepEqual(await f.request(retros + '/sources').then((r) => [r.status, r.json.reason]), [404, 'feedback_loop_unavailable']);
      assert.deepEqual(await respond('share-before', { expected_revision: 1, decision: 'keep', reason: 'x' }).then((r) => [r.status, r.json.reason]), [404, 'feedback_loop_unavailable']);
      const own = await f.request(studentShares, 'GET', undefined, studentA); assert.equal(own.status, 200, own.raw);
      const SHAPE = ['content', 'created_at', 'expires_at', 'feedback', 'id', 'kind', 'next_action', 'profile_id', 'recipient_id', 'revision', 'session_id', 'status', 'student_id'];
      assert.ok(own.json.shares.length); for (const s of own.json.shares) assert.deepEqual(Object.keys(s).sort(), SHAPE);
      const detail = await f.request(`${teacherShares}/share-before`); assert.equal(detail.status, 200, detail.raw);
      assert.deepEqual(Object.keys(detail.json).sort(), SHAPE);
      assert.equal((await answer('share-before', 1)).status, 200, 'the instructor answers as before');
      // EDU-04/05: with the switch off the learner's records are no content field — refused exactly as an unknown field, the
      // list names no records, and the body cap is the one it always was.
      const recOff = await share('rec-off', { content: { verification: 'x', independent_task: { task: '시연과 다른 과제', help: ['none'] } } });
      assert.deepEqual([recOff.status, recOff.json.error], [400, 'select supported content fields']);
      assert.equal(one("SELECT count(*) AS n FROM classroom_shares WHERE id='rec-off'").n, 0);
      assert.deepEqual(Object.keys(own.json).sort(), ['filter', 'limit', 'shares'], 'no share_records key while the switch is off');
      const overOld = await share('rec-off-big', { pad: 'x'.repeat(6 * 8000 * 6 + 8192) });
      assert.deepEqual([overOld.status, overOld.json.reason], [413, 'too_large'], 'the cap only widens while the switch is on');
    } finally { console.error = origError; }
    assert.deepEqual(logged, [], 'nothing tried to reach a 0039 table: ' + logged.join(' | '));
    f.db.exec(MIGRATION); f.env.HPS_FEEDBACK_LOOP = 'enabled';
    assert.equal(count('classroom_share_lessons'), 0, 'a share sent while the switch was off carries no lesson record');
  });

  await check('switch on: each share records the lesson its sender was executing (the gate\'s own resolver); a code without a lesson records nothing', async () => {
    assert.equal((await share('share-a')).status, 201);
    assert.equal((await share('share-b', { kind: 'help', content: { question: '토요일 진료시간을 어디에 적어야 할지 모르겠어요' } }, studentB)).status, 201);
    assert.equal((await share('share-other-teacher', { recipient_id: 'teacher-b' })).status, 201);
    assert.equal((await share('share-unpinned', { content: { verification: '예약 버튼을 직접 눌러 봤다' } }, studentC)).status, 201);
    assert.deepEqual(one('SELECT course_id, version, lesson_sha256, source FROM classroom_share_lessons WHERE share_id=?', 'share-a'), { course_id: course, version: V1, lesson_sha256: v1.sha256, source: 'token' });
    assert.equal(one('SELECT version FROM classroom_share_lessons WHERE share_id=?', 'share-b').version, V1);
    assert.equal(one("SELECT count(*) AS n FROM classroom_share_lessons WHERE share_id IN ('share-unpinned','share-before')").n, 0);
    assert.equal((await share('share-a')).status, 200, 'a retried share is the same share');
    assert.equal(one("SELECT count(*) AS n FROM classroom_share_lessons WHERE share_id='share-a'").n, 1, 'and records nothing twice');
  });
  // Synthetic rows only the database can produce here: a share of another class of the same cohort (another profile), an
  // expired one, and one sent long before any version was frozen. Copied from a real row; only the named columns differ.
  const row = one('SELECT * FROM classroom_shares WHERE id=?', 'share-a'), cols = Object.keys(row);
  const put = (id, over) => f.db.prepare(`INSERT INTO classroom_shares(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((k) => ({ ...row, id, ...over })[k]));
  put('share-other-class', { profile_id: 'boah-dental-teaser-2026-s1' }); put('share-expired', { expires_at: 1 }); put('share-early', { created_at: 1 });

  await check('AE-43 learner answer: refused until a person has answered; then revise/keep/hold with a reason, once per feedback text', async () => {
    assert.deepEqual(await respond('share-a', { expected_revision: 1, decision: 'revise', reason: '고칠게요' }).then((r) => [r.status, r.json.reason]), [409, 'no_human_feedback'], 'no answer from a person yet');
    assert.equal((await answer('share-a', 1)).status, 200);
    for (const [body, code] of [[{ expected_revision: 2, decision: 'agree', reason: 'x' }, 'invalid_decision'], [{ expected_revision: 2, decision: 'keep', reason: '' }, 'invalid_reason'], [{ decision: 'keep', reason: 'x' }, 'revision_required']])
      assert.deepEqual(await respond('share-a', body).then((r) => [r.status, r.json.reason]), [400, code]);
    assert.deepEqual(await respond('share-a', { expected_revision: 1, decision: 'revise', reason: 'x' }).then((r) => [r.status, r.json.reason]), [409, 'share_changed'], 'a stale read is refused');
    assert.equal((await respond('share-a', { expected_revision: 2, decision: 'revise', reason: 'x' }, studentB)).status, 404, 'another learner cannot answer for them');
    assert.equal((await respond('share-a', { expected_revision: 2, decision: 'revise', reason: 'x' }, f.teacherToken)).status, 403, 'an instructor cannot answer as the learner');
    const body = { expected_revision: 2, decision: 'revise', reason: '목록으로 바꾸고 390px에서 다시 보겠습니다' };
    const first = await respond('share-a', body); assert.equal(first.status, 201, first.raw);
    assert.deepEqual([first.json.response.decision, first.json.response.answers_current_feedback, first.json.status, first.json.revision], ['revise', true, 'answered', 2], 'the share itself is untouched');
    assert.equal((await respond('share-a', body)).status, 200, 'a retried answer is the same answer');
    assert.deepEqual(await respond('share-a', { ...body, decision: 'keep' }).then((r) => [r.status, r.json.reason]), [409, 'already_answered'], 'not an edit');
    assert.deepEqual((await f.request(studentShares, 'GET', undefined, studentA)).json.shares.find((s) => s.id === 'share-a').response.decision, 'revise');
    const auditBefore = count('classroom_share_audit'), detail = await f.request(`${teacherShares}/share-a`);
    assert.deepEqual([detail.json.response.decision, detail.json.response.reason], ['revise', body.reason]); assert.equal(count('classroom_share_audit'), auditBefore + 1, 'reading it is an audited view');
    assert.equal((await f.request(`${studentShares}/share-a/confirm`, 'POST', { expected_revision: 2 }, studentA)).status, 200, 'resolving stays the learner\'s separate confirmation');
  });

  await check('AE-43 boundaries: feedback saved while still under review is not an answer; an expired share takes no answer; a secret-shaped reason is masked', async () => {
    // /manage saves "검토 중" by default: the learner sees that text, but there is nothing to decide on until it is an answer.
    assert.equal((await share('share-rev', { content: { verification: '예약 버튼 위치를 옮겼다' } })).status, 201);
    assert.equal((await answer('share-rev', 1, '아직 작성 중인 피드백', 'reviewing')).status, 200);
    const seen = (await f.request(studentShares, 'GET', undefined, studentA)).json.shares.find((s) => s.id === 'share-rev');
    assert.deepEqual([seen.status, seen.feedback, seen.response], ['reviewing', '아직 작성 중인 피드백', null]);
    assert.deepEqual(await respond('share-rev', { expected_revision: 2, decision: 'keep', reason: '그대로 둘게요' }).then((r) => [r.status, r.json.reason]), [409, 'no_human_feedback']);
    assert.equal(one("SELECT count(*) AS n FROM classroom_share_responses WHERE share_id='share-rev'").n, 0);
    // Expiry ends every answer, exactly like the share's other learner routes.
    assert.equal((await share('share-exp', { content: { verification: '버튼 색을 바꿨다' } })).status, 201);
    assert.equal((await answer('share-exp', 1, '대비가 낮습니다')).status, 200);
    f.db.prepare("UPDATE classroom_shares SET expires_at=? WHERE id='share-exp'").run(Math.floor(Date.now() / 1000) - 1);
    assert.equal((await respond('share-exp', { expected_revision: 2, decision: 'revise', reason: '대비를 높이겠습니다' })).status, 404);
    assert.equal(one("SELECT count(*) AS n FROM classroom_share_responses WHERE share_id='share-exp'").n, 0);
  });

  await check('AE-43 a changed feedback text is a new question: the old answer is marked as answering an earlier text', async () => {
    assert.equal((await share('share-c', { content: { verification: '예약 버튼 색을 바꿨다' } })).status, 201);
    assert.equal((await answer('share-c', 1, '버튼이 눈에 안 띕니다')).status, 200);
    const held = await respond('share-c', { expected_revision: 2, decision: 'hold', reason: '원장님께 먼저 물어보겠습니다 ' + SECRET }); assert.equal(held.status, 201, held.raw);
    assert.ok(!held.json.response.reason.includes(SECRET) && held.json.response.reason.includes('가려짐'), 'a credential pasted into the reason is masked before storage');
    assert.ok(!one("SELECT reason FROM classroom_share_responses WHERE share_id='share-c'").reason.includes(SECRET));
    assert.equal((await answer('share-c', 2, '버튼 대비를 4.5:1 이상으로 맞춰 보세요')).status, 200);
    const mine = (await f.request(studentShares, 'GET', undefined, studentA)).json.shares.find((s) => s.id === 'share-c');
    assert.deepEqual([mine.response.decision, mine.response.answers_current_feedback], ['hold', false]);
    const again = await respond('share-c', { expected_revision: 3, decision: 'revise', reason: '대비를 맞추겠습니다' }); assert.equal(again.status, 201, again.raw);
    assert.equal(again.json.response.answers_current_feedback, true);
  });

  await check('AE-43 which answer is shown (review round 2): the one bound to the feedback as it reads now, not the newest; a return to "검토 중" with the same text is not a new question', async () => {
    const TA = '버튼 문구가 너무 깁니다', TB = '버튼 색이 배경과 비슷합니다', TC = '버튼을 화면 위쪽으로 옮겨 보세요';
    const mine = async () => (await f.request(studentShares, 'GET', undefined, studentA)).json.shares.find((s) => s.id === 'share-e').response;
    const managed = async () => (await f.request(`${teacherShares}/share-e`)).json.response;
    const citeAnswer = () => f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: retroDoc([{ share_id: 'share-e', part: 'learner_response' }]) });
    assert.equal((await share('share-e', { content: { verification: '예약 버튼 문구를 줄였다' } })).status, 201);
    assert.equal((await answer('share-e', 1, TA)).status, 200);
    assert.equal((await respond('share-e', { expected_revision: 2, decision: 'keep', reason: 'A에 대한 답' })).status, 201);
    assert.equal((await answer('share-e', 2, TB)).status, 200);
    assert.equal((await respond('share-e', { expected_revision: 3, decision: 'revise', reason: 'B에 대한 답' })).status, 201);
    assert.deepEqual(await mine().then((r) => [r.reason, r.answers_current_feedback]), ['B에 대한 답', true], 'positive control: the answer to text B while B is the feedback');
    // A → B → A: the learner already answered text A. That answer is the current one on /sharing and /manage, though B's is newer.
    assert.equal((await answer('share-e', 3, TA)).status, 200);
    assert.deepEqual(await mine().then((r) => [r.decision, r.reason, r.answers_current_feedback]), ['keep', 'A에 대한 답', true]);
    assert.deepEqual(await managed().then((r) => [r.reason, r.answers_current_feedback]), ['A에 대한 답', true]);
    assert.equal((await respond('share-e', { expected_revision: 4, decision: 'keep', reason: 'A에 대한 답' })).status, 200, 'the same answer again is a replay of the answer the page shows');
    const other = await respond('share-e', { expected_revision: 4, decision: 'hold', reason: '다시 생각해 보겠습니다' });
    assert.deepEqual([other.status, other.json.reason, other.json.response.reason, other.json.response.answers_current_feedback], [409, 'already_answered', 'A에 대한 답', true], 'a conflict names the answer the page shows');
    const cited = await citeAnswer(); assert.equal(cited.status, 201, cited.raw);
    assert.deepEqual([cited.json.findings[0].sources[0].answers_current_feedback, 'stale_learner_response' in cited.json.findings[0]], [true, false], 'a retrospective cites the answer to the text as it reads now');
    // Back to "검토 중" with the SAME text: the learner still sees that text, so their answer still answers it. Only a NEW answer waits.
    assert.equal((await answer('share-e', 4, TA, 'reviewing')).status, 200);
    assert.deepEqual(await mine().then((r) => [r.reason, r.answers_current_feedback]), ['A에 대한 답', true]);
    assert.deepEqual(await managed().then((r) => [r.reason, r.answers_current_feedback]), ['A에 대한 답', true]);
    assert.deepEqual(await respond('share-e', { expected_revision: 5, decision: 'hold', reason: '기다리겠습니다' }).then((r) => [r.status, r.json.reason]), [409, 'no_human_feedback']);
    assert.equal((await citeAnswer()).status, 201, 'the retrospective reads the same answer as current');
    // A third text nobody answered yet: the newest answer is shown, marked as answering an earlier feedback; citing it now is refused.
    assert.equal((await answer('share-e', 5, TC, 'reviewing')).status, 200);
    assert.deepEqual(await mine().then((r) => [r.reason, r.answers_current_feedback]), ['B에 대한 답', false]);
    assert.deepEqual(await citeAnswer().then((r) => [r.status, r.json.reason]), [409, 'learner_response_stale']);
    const marked = (await f.request(`${retros}/${cited.json.id}`)).json.findings[0];
    assert.deepEqual([marked.stale_learner_response, marked.sources[0].answers_current_feedback], [true, false], 'the written retrospective marks it');
    assert.equal(one("SELECT count(*) AS n FROM classroom_share_responses WHERE share_id='share-e'").n, 2, 'both answers are kept; only which one is shown changed');
  });

  await check('sources: only this instructor\'s, this class\'s, unexpired shares, never one recorded under another course; parts, whose words and the lesson, never content', async () => {
    const r = await f.request(retros + '/sources'); assert.equal(r.status, 200, r.raw);
    const ids = r.json.sources.map((s) => s.id);
    for (const id of ['share-a', 'share-b', 'share-c', 'share-unpinned', 'share-before']) assert.ok(ids.includes(id), id);
    for (const id of ['share-other-teacher', 'share-other-class', 'share-expired', 'share-exp']) assert.ok(!ids.includes(id), id);
    const a = r.json.sources.find((s) => s.id === 'share-a');
    assert.deepEqual(a.parts.map((p) => p.part + ':' + p.origin), ['prompt:learner', 'response:ai', 'verification:learner', 'feedback:human', 'learner_response:learner']);
    assert.deepEqual([a.lesson, r.json.sources.find((s) => s.id === 'share-unpinned').lesson], [{ course_id: course, version: V1 }, null]);
    assert.ok(!r.raw.includes('진료시간을 바꿔줘') && !r.raw.includes('목록으로 바꾸고'), 'metadata only: content is read through the audited share route');
    assert.equal((await f.request(retros + '/sources', 'GET', undefined, await f.teacher('teacher-b'))).status, 404, 'not their course');
    // The other course of the same instructor and profile: shares recorded under this course are not offered there.
    const other = (await f.request(otherRetros + '/sources')).json.sources.map((s) => s.id);
    assert.ok(!other.includes('share-a') && !other.includes('share-b') && other.includes('share-unpinned'), other.join(','));
  });

  const doc = {
    hypothesis: '확인 기준을 먼저 적게 하면 모바일 줄바꿈 같은 문제를 학생이 스스로 찾는다 (붙여 넣은 키 ' + SECRET + ')',
    findings: [
      { id: 'f1', text: '학생이 390px에서 직접 확인했고, 사람의 피드백 뒤 목록으로 고치기로 했다', sources: [{ share_id: 'share-a', part: 'verification' }, { share_id: 'share-a', part: 'feedback' }, { share_id: 'share-a', part: 'learner_response' }] },
      { id: 'f2', text: 'AI는 줄바꿈을 넣었다고 답했다 ' + SECRET, sources: [{ share_id: 'share-a', part: 'response' }] },
      { id: 'f3', text: '토요일 시간을 어디에 적을지 도움을 요청했다', sources: [{ share_id: 'share-b', part: 'question' }], assistance: 'assisted' },
    ],
    decisions: [
      { id: 'd1', target: 'build', action: 'revise', reason: '모바일 확인을 단계 안에 넣는다', findings: ['f1'] },
      { id: 'd2', target: 'review', action: 'keep', reason: '검토 단계는 그대로 둔다 ' + SECRET },
      { id: 'd3', target: 'lesson', action: 'hold', reason: '도움 방식은 한 번 더 보고 정한다', findings: ['f3'] },
    ],
    notes: { no_signal: '두 명은 공유 기록이 없어 이 회고로 판단하지 않는다 (메모에 붙인 키 ' + SECRET + ')' },
  };
  let retro;
  await check('AE-42 retrospective: hypothesis, the version and help condition that ran, sourced findings, decisions, the unobserved', async () => {
    const r = await f.request(retros, 'POST', { request_id: 'rq-1', base_version: V1, doc }); assert.equal(r.status, 201, r.raw); retro = r.json;
    assert.deepEqual([retro.format, retro.base.version, retro.base.lesson_sha256, retro.base.readable], ['hps-lesson-retrospective/1', V1, v1.sha256, true]);
    assert.deepEqual(retro.base.steps.map((s) => s.step_id), ['intro', 'build', 'review']);
    const [f1, f2, f3] = retro.findings;
    assert.deepEqual([f1.status, f1.human_feedback, f1.sources.map((s) => s.origin), f1.sources.map((s) => s.lesson)], ['observed', 'present', ['learner', 'human', 'learner'], ['this_version', 'this_version', 'this_version']]);
    assert.deepEqual(['lesson_unconfirmed' in f1, 'stale_learner_response' in f1, f1.sources[2].answers_current_feedback], [false, false, true]);
    assert.deepEqual([f2.status, f2.unobserved_reason, f2.human_feedback], ['unobserved', 'no_person_source', 'unobserved'], 'an AI answer alone is not a person\'s observation');
    assert.deepEqual([f3.status, f3.assistance, f3.human_feedback], ['observed', 'assisted', 'unobserved'], 'no person answered yet: social correction unobserved');
    assert.deepEqual(retro.coverage, { roster: 4, learners_with_sources: 2, learners_without_sources: 2, help_requests_cited: 1, help_use: 'unobserved', help_reported: { source_state: 'self_reported', with_help: 0, no_help: 0 }, stopped: 'unobserved' });
    assert.deepEqual(retro.decisions.map((d) => [d.target, d.action, d.target_title]), [['build', 'revise', 'build'], ['review', 'keep', 'review'], ['lesson', 'hold', '']]);
    assert.equal(retro.applied, null); assert.equal(retro.next, null);
    const stored = one('SELECT doc_json FROM lesson_retrospectives WHERE retro_id=?', retro.id).doc_json;
    assert.ok(!stored.includes('390px에서 줄바꿈이 깨지는지') && !stored.includes('목록으로 바꾸고'), 'the stored record holds references, not the learner\'s content');
    assert.ok(!stored.includes(SECRET) && !JSON.stringify(retro).includes(SECRET), 'a credential in the instructor\'s own text is masked before storage');
    assert.equal((await f.request(retros, 'POST', { request_id: 'rq-1', base_version: V1, doc })).json.id, retro.id, 'a retried create is the same retrospective');
    assert.deepEqual(await f.request(retros, 'POST', { request_id: 'rq-1', base_version: V1, doc: { ...doc, hypothesis: '다른 가설' } }).then((r) => [r.status, r.json.reason]), [409, 'request_id_conflict']);
  });

  await check('negative control (review F1): an AI answer plus the instructor\'s own feedback is never an observation of the learner', async () => {
    assert.equal((await share('ai-only', { content: { response: 'AI가 만든 답' } })).status, 201);
    assert.equal((await answer('ai-only', 1, '이 답을 그대로 쓰지 말고 직접 확인해 보세요')).status, 200);
    for (const sources of [[{ share_id: 'ai-only', part: 'feedback' }], [{ share_id: 'ai-only', part: 'response' }, { share_id: 'ai-only', part: 'feedback' }]]) {
      const r = await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: retroDoc(sources) }); assert.equal(r.status, 201, r.raw);
      const [x] = r.json.findings;
      assert.deepEqual([x.status, x.unobserved_reason, x.human_feedback], ['unobserved', 'no_person_source', 'present'], sources.map((s) => s.part).join('+'));
    }
  });

  await check('negative controls: other instructor\'s, other class\'s, expired, earlier or other-lesson shares, empty parts, unearned claims — nothing written', async () => {
    const before = count('lesson_retrospectives');
    const post = (d, path = retros, version = V1) => f.request(path, 'POST', { request_id: KEY(), base_version: version, doc: d });
    for (const id of ['share-other-teacher', 'share-other-class', 'share-expired', 'no-such-share'])
      assert.deepEqual(await post(retroDoc([{ share_id: id, part: 'verification' }])).then((r) => [r.status, r.json.reason]), [409, 'source_unavailable'], id);
    // Review F2: a share sent before the version was frozen, and one recorded under another course, are not evidence about it.
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-early', part: 'verification' }])).then((r) => [r.status, r.json.reason]), [409, 'source_before_version'], 'sent before the version existed');
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-a', part: 'verification' }]), otherRetros, OV).then((r) => [r.status, r.json.reason]), [409, 'source_other_lesson'], 'recorded under another course of the same profile');
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-b', part: 'feedback' }])).then((r) => [r.status, r.json.reason]), [409, 'no_human_feedback'], 'no person has answered share-b');
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-b', part: 'learner_response' }])).then((r) => [r.status, r.json.reason]), [409, 'no_learner_response']);
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-b', part: 'prompt' }])).then((r) => [r.status, r.json.reason]), [409, 'source_part_empty']);
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-a', part: 'verification' }], { assistance: 'assisted' })).then((r) => [r.status, r.json.reason]), [400, 'unsupported_assistance'], 'a submission is no record of help');
    assert.deepEqual(await post(retroDoc([{ share_id: 'share-a', part: 'verification' }], { assistance: 'independent' })).then((r) => [r.status, r.json.reason]), [400, 'unsupported_independence'], 'nothing records independent performance');
    assert.deepEqual(await f.request(retros, 'POST', { request_id: KEY(), base_version: 'm2026.01.01-9', doc }).then((r) => [r.status, r.json.reason]), [404, 'version_not_found']);
    assert.equal((await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc }, await f.teacher('teacher-b'))).status, 404, 'another instructor: not their course');
    assert.equal((await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc }, await f.teacher('teacher-a', undefined, 'sk-biopharm-2026-a', ['sk-biopharm-kids-2026-grade-3-4-s1']))).status, 403, 'an instructor of another cohort');
    assert.ok([401, 403].includes((await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc }, await f.student('student-a'))).status), 'a learner token');
    assert.equal(count('lesson_retrospectives'), before, 'every refusal wrote nothing');
  });

  await check('a share whose lesson was not recorded is citable after the freeze, and reads "lesson unknown", never "this version"', async () => {
    const r = await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: retroDoc([{ share_id: 'share-unpinned', part: 'verification' }]) }); assert.equal(r.status, 201, r.raw);
    const [x] = r.json.findings;
    assert.deepEqual([x.status, x.lesson_unconfirmed, x.sources[0].lesson], ['observed', true, 'unknown']);
  });

  // ── slice 2: the learner's own records on a submission (EDU-04, EDU-05) and what a retrospective may read from them ──
  const TASK = { task: '시연은 10월 9일 휴진 공지, 나는 10월 16일로 바꾸고 다른 문구가 그대로인지 확인했다', help: ['person', 'hint'], help_note: '줄바꿈 위치만 강사님께 물었다 ' + SECRET };
  const RELY = [{ work: '휴진 공지 문구 수정', how: 'direct' }, { work: '사진 교체', how: 'helped', note: 'AI에게 크기 조절을 묻는다' }, { work: '도메인 연결', how: 'expert', note: '업체에 맡긴다 ' + SECRET }];
  const taskShare = { content: { artifact_url: 'https://clinic.example.test/notice', verification: '390px에서 휴진 공지가 한 줄로 보이는지 직접 확인했다', independent_task: TASK, self_reliance: RELY } };
  await check('EDU-04/05 the learner\'s records on a submission: stored in their words (credentials masked, help in a fixed order), read back by them and, audited, by the instructor; refusals named, nothing written', async () => {
    const r = await share('share-task', taskShare); assert.equal(r.status, 201, r.raw);
    const stored = JSON.parse(one('SELECT content_json FROM classroom_shares WHERE id=?', 'share-task').content_json);
    assert.deepEqual(Object.keys(stored), ['prompt', 'response', 'tool_summary', 'artifact_url', 'verification', 'independent_task', 'self_reliance'], 'the six fields as before, then the records');
    assert.deepEqual([stored.independent_task.task, stored.independent_task.help, stored.self_reliance.map((i) => [i.work, i.how])], [TASK.task, ['hint', 'person'], RELY.map((i) => [i.work, i.how])]);
    assert.ok(!JSON.stringify(stored).includes(SECRET) && stored.independent_task.help_note.includes('가려짐') && stored.self_reliance[2].note.includes('가려짐'), 'a credential in a record is masked before storage');
    assert.equal((await share('share-task', taskShare)).status, 200, 'a retried share with the same records is the same share');
    assert.equal((await share('share-task', { content: { ...taskShare.content, independent_task: { ...TASK, help: ['hint', 'person'] } } })).status, 200, 'and so is the same help ticked in another order');
    assert.deepEqual(await share('share-task', { content: { ...taskShare.content, self_reliance: RELY.slice(0, 1) } }).then((x) => [x.status, x.json.reason]), [409, 'request_id_conflict'], 'other records under the same id are a conflict');
    const mine = (await f.request(studentShares, 'GET', undefined, studentA)).json;
    assert.deepEqual(mine.share_records, ['independent_task', 'self_reliance'], 'the list names the records this Service accepts');
    assert.deepEqual(mine.shares.find((s) => s.id === 'share-task').content.self_reliance.map((i) => i.how), ['direct', 'helped', 'expert']);
    const audits = count('classroom_share_audit'), detail = await f.request(`${teacherShares}/share-task`);
    assert.equal(detail.status, 200, detail.raw); assert.deepEqual(detail.json.content.independent_task.help, ['hint', 'person']);
    assert.equal(count('classroom_share_audit'), audits + 1, 'the instructor reads the records only through the audited view');
    const listed = (await f.request(teacherShares)).json; assert.ok(!JSON.stringify(listed).includes('휴진 공지 문구 수정'), 'the instructor list stays metadata');
    const before = count('classroom_shares');
    for (const [id, patch, code] of [
      ['rec-help', { kind: 'help', content: { question: '도와주세요', independent_task: TASK } }, 'record_needs_submission'],
      ['rec-none', { content: { verification: 'x', independent_task: { ...TASK, help: ['none', 'hint'] } } }, 'help_none_with_other'],
      ['rec-how', { content: { verification: 'x', self_reliance: [{ work: '도메인 연결', how: 'independent' }] } }, 'invalid_how'],
      ['rec-score', { content: { verification: 'x', self_reliance: [{ work: '도메인 연결', how: 'expert', score: 3 }] } }, 'unsupported_score'],
    ]) assert.deepEqual(await share(id, patch).then((x) => [x.status, x.json.reason]), [400, code], code);
    assert.equal(count('classroom_shares'), before, 'every refusal wrote nothing');
    // The learner's sorting of their own scope is something to share on its own (L5's "운영 판단 메모").
    assert.equal((await share('share-scope-only', { content: { self_reliance: RELY.slice(2) } })).status, 201);
  });

  await check('EDU-04/05 in the retrospective (T-20, T-44, AE-42): the records are the learner\'s words; `assisted` stands on a record naming help; "no help" is a self-report, never independence; reported help is counted apart from what the Service observed', async () => {
    assert.equal((await share('share-nohelp', { content: { verification: '혼자 10월 16일 공지로 바꿨다', independent_task: { task: '시연과 다른 날짜의 휴진 공지', help: ['none'] } } }, studentB)).status, 201);
    // The same learner as share-task, on another task, without help: counted once, under with_help, while share-task stands.
    assert.equal((await share('share-nohelp-a', { content: { verification: '사진 설명을 혼자 고쳤다', independent_task: { task: '시연과 다른 사진 설명', help: ['none'] } } })).status, 201);
    const src = (await f.request(retros + '/sources')).json.sources;
    assert.deepEqual(src.find((s) => s.id === 'share-task').parts.map((p) => p.part + ':' + p.origin), ['artifact_url:artifact', 'verification:learner', 'independent_task:learner', 'self_reliance:learner']);
    assert.ok(!JSON.stringify(src).includes('휴진 공지 문구 수정'), 'sources stay metadata: the records\' content is read through the audited share route');
    const post = (findings) => f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: { hypothesis: '독립 과제에서 받은 도움을 스스로 적는다', findings, decisions: [{ id: 'd1', target: 'lesson', action: 'keep', reason: '유지' }] } });
    const r = await post([
      { id: 'f1', text: '힌트와 사람의 도움을 받았다고 적었다', sources: [{ share_id: 'share-task', part: 'independent_task' }], assistance: 'assisted' },
      { id: 'f2', text: '도메인 연결은 전문가에게 맡긴다고 나눴다', sources: [{ share_id: 'share-task', part: 'self_reliance' }] },
      { id: 'f3', text: '도움 없이 했다고 적었다', sources: [{ share_id: 'share-nohelp', part: 'independent_task' }] },
      { id: 'f4', text: '다른 과제는 도움 없이 했다고 적었다', sources: [{ share_id: 'share-nohelp-a', part: 'independent_task' }] },
    ]);
    assert.equal(r.status, 201, r.raw);
    const [f1, f2, f3] = r.json.findings;
    assert.deepEqual([f1.status, f1.assistance, f1.assistance_basis, f1.sources[0].self_reported_help], ['observed', 'assisted', ['learner_report'], 'help']);
    assert.deepEqual([f2.status, f2.assistance, 'self_reported_help' in f2.sources[0]], ['observed', 'unknown', false], 'the self-reliance list says nothing about help');
    assert.deepEqual([f3.status, f3.assistance, 'assistance_basis' in f3, f3.sources[0].self_reported_help], ['observed', 'unknown', false, 'no_help']);
    assert.deepEqual([r.json.coverage.help_use, r.json.coverage.help_reported], ['unobserved', { source_state: 'self_reported', with_help: 1, no_help: 1 }], 'what the Service observed of help use stays unobserved; what learners wrote is counted apart, each learner once');
    assert.doesNotThrow(() => forbidPersonalMetrics(r.json), 'no score, level or grade anywhere in the view');
    assert.ok(!JSON.stringify(r.json).includes('휴진 공지 문구 수정') && !JSON.stringify(r.json).includes('강사님께'), 'the view carries no record content');
    // Negative controls: "no help" supports neither `assisted` nor `independent`; the basis is the record part itself; a share
    // without a record has no record part.
    for (const [finding, status, code] of [
      [{ id: 'f', text: 't', sources: [{ share_id: 'share-nohelp', part: 'independent_task' }], assistance: 'assisted' }, 400, 'unsupported_assistance'],
      [{ id: 'f', text: 't', sources: [{ share_id: 'share-nohelp', part: 'independent_task' }], assistance: 'independent' }, 400, 'unsupported_independence'],
      [{ id: 'f', text: 't', sources: [{ share_id: 'share-task', part: 'verification' }], assistance: 'assisted' }, 400, 'unsupported_assistance'],
      [{ id: 'f', text: 't', sources: [{ share_id: 'share-a', part: 'independent_task' }] }, 409, 'source_part_empty'],
    ]) assert.deepEqual(await post([finding]).then((x) => [x.status, x.json.reason]), [status, code], code);
    // Withdrawal reaches it: the records go with the share, the finding falls back and the count drops.
    assert.equal((await f.request(`${studentShares}/share-task`, 'DELETE', undefined, studentA)).status, 200);
    const v = (await f.request(`${retros}/${r.json.id}`)).json;
    assert.deepEqual([v.findings[0].status, v.findings[0].assistance, v.findings[0].assistance_basis_unavailable, v.findings[1].status], ['unobserved', 'unknown', true, 'unobserved']);
    assert.deepEqual(v.coverage.help_reported, { source_state: 'self_reported', with_help: 0, no_help: 2 }, 'student-a\'s remaining record says "no help"');
  });

  await check('share body with records (EDU-04/05): every field and record at its limit, as escaped control characters, is accepted; past the widened cap is refused by name', async () => {
    const u = '\u0001', big = { question: u.repeat(8000), prompt: u.repeat(8000), response: u.repeat(8000), tool_summary: u.repeat(8000), verification: u.repeat(8000),
      independent_task: { task: u.repeat(L.RECORD_LIMITS.task), help: L.TASK_HELP.filter((h) => h !== 'none'), help_note: u.repeat(L.RECORD_LIMITS.help_note) },
      self_reliance: Array.from({ length: L.RECORD_LIMITS.items }, () => ({ work: u.repeat(L.RECORD_LIMITS.work), how: 'helped', note: u.repeat(L.RECORD_LIMITS.note) })) };
    const body = { id: 'share-big', recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: big };
    assert.ok(Buffer.byteLength(JSON.stringify(body)) > 6 * 8000 * 6 + 8192, 'positive control: larger than the cap without records');
    const ok = await f.request(studentShares, 'POST', body, studentA); assert.equal(ok.status, 201, ok.raw.slice(0, 200));
    const tooBig = await f.request(studentShares, 'POST', { ...body, id: 'share-too-big', pad: 'x'.repeat(L.RECORDS_BODY_MAX) }, studentA);
    assert.deepEqual([tooBig.status, tooBig.json.reason], [413, 'too_large']);
    assert.equal((await f.request(`${studentShares}/share-big`, 'DELETE', undefined, studentA)).status, 200);
  });

  await check('AE-43 a cited decision about feedback that changed later is marked, and a new citation of it is refused (review probe P4)', async () => {
    assert.equal((await share('share-d', { content: { verification: '휴진 공지를 맨 위로 올렸다' } })).status, 201);
    assert.equal((await answer('share-d', 1, '공지가 메뉴에 가립니다')).status, 200);
    assert.equal((await respond('share-d', { expected_revision: 2, decision: 'keep', reason: '메뉴는 그대로 두겠습니다' })).status, 201);
    const cites = [{ share_id: 'share-d', part: 'verification' }, { share_id: 'share-d', part: 'learner_response' }, { share_id: 'share-d', part: 'feedback' }];
    const made = await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: retroDoc(cites) }); assert.equal(made.status, 201, made.raw);
    assert.equal('stale_learner_response' in made.json.findings[0], false);
    assert.equal((await answer('share-d', 2, '', 'reviewing')).status, 200, 'the instructor withdraws the feedback text to rework it');
    const x = (await f.request(`${retros}/${made.json.id}`)).json.findings[0];
    assert.deepEqual([x.status, x.stale_learner_response, x.human_feedback], ['observed', true, 'unobserved']);
    assert.deepEqual(x.sources.map((s) => [s.part, s.available, s.answers_current_feedback, s.part_empty]), [['verification', true, undefined, undefined], ['learner_response', true, false, undefined], ['feedback', false, undefined, true]]);
    assert.deepEqual(await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: retroDoc(cites.slice(0, 2)) }).then((r) => [r.status, r.json.reason]), [409, 'learner_response_stale']);
  });

  await check('withdrawal and expiry reach a written retrospective: the source reads unavailable and the claims built on it fall back', async () => {
    assert.equal((await f.request(`${studentShares}/share-b`, 'DELETE', undefined, studentB)).status, 200);
    const v = (await f.request(`${retros}/${retro.id}`)).json, f3 = v.findings.find((x) => x.id === 'f3');
    assert.deepEqual([f3.status, f3.unobserved_reason, f3.assistance, f3.assistance_basis_unavailable, f3.sources[0].available], ['unobserved', 'sources_unavailable', 'unknown', true, false]);
    assert.equal('student_id' in f3.sources[0], false, 'nothing about a withdrawn share is shown');
    assert.deepEqual([v.coverage.learners_with_sources, v.coverage.help_requests_cited], [1, 0]);
    const draftBefore = (await f.request(authoring)).json.revision;
    const blocked = await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: draftBefore });
    assert.deepEqual([blocked.status, blocked.json.reason, blocked.json.share_ids], [409, 'source_unavailable', ['share-b']], 'a withdrawn share cannot start the next draft');
    assert.equal((await f.request(authoring)).json.revision, draftBefore, 'and nothing was written');
    const edited = { ...doc, findings: doc.findings.filter((x) => x.id !== 'f3'), decisions: doc.decisions.map((d) => ({ ...d, findings: (d.findings ?? []).filter((x) => x !== 'f3') })) };
    assert.deepEqual(await f.request(`${retros}/${retro.id}`, 'PUT', { expected_revision: 0, doc: edited }).then((r) => [r.status, r.json.reason]), [409, 'revision_conflict']);
    const saved = await f.request(`${retros}/${retro.id}`, 'PUT', { expected_revision: 1, doc: edited }); assert.equal(saved.status, 200, saved.raw);
    assert.deepEqual([saved.json.revision, saved.json.findings.map((x) => x.id)], [2, ['f1', 'f2']]);
  });

  await check('CH-05/AE-42 next draft: written from the version that ran, never from the drifted draft; the run version and its records untouched', async () => {
    const v1Before = one('SELECT module_json, source_revision FROM authoring_versions WHERE course_id=? AND version=?', course, V1);
    const cur = (await f.request(authoring)).json;
    const drifted = await f.request(authoring, 'PUT', { profile_id: f.profile, request_id: KEY(), expected_revision: cur.revision, content: { ...cur.content, title: '수업과 무관하게 바뀐 초안' } });
    assert.equal(drifted.status, 200, drifted.raw);
    const stale = await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: cur.revision });
    assert.deepEqual([stale.status, stale.json.reason], [409, 'draft_changed'], 'a stale draft revision changes nothing');
    assert.equal(one('SELECT applied_draft_revision AS a FROM lesson_retrospectives WHERE retro_id=?', retro.id).a, null);
    const rq = KEY(), go = await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: rq, expected_draft_revision: drifted.json.revision });
    assert.equal(go.status, 201, go.raw);
    assert.deepEqual([go.json.draft.revision, go.json.applied.draft_revision, go.json.next.draft_revision, go.json.next.version], [drifted.json.revision + 1, drifted.json.revision + 1, drifted.json.revision + 1, null]);
    assert.deepEqual(go.json.draft.content, v1.content, 'the next draft starts from the version that ran');
    assert.equal((await f.request(authoring)).json.content.title, v1.content.title);
    assert.deepEqual(one('SELECT module_json, source_revision FROM authoring_versions WHERE course_id=? AND version=?', course, V1), v1Before, 'the run version is byte-identical');
    assert.equal(count('authoring_confirmations') + count('authoring_rehearsals'), 0, 'no rehearsal or confirmation was created or touched');
    assert.equal((await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: rq, expected_draft_revision: drifted.json.revision })).status, 200, 'a retried start is the same start');
    assert.deepEqual(await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: drifted.json.revision + 1 }).then((r) => [r.status, r.json.reason]), [409, 'already_applied']);
    assert.deepEqual(await f.request(`${retros}/${retro.id}`, 'PUT', { expected_revision: 2, doc }).then((r) => [r.status, r.json.reason]), [409, 'retrospective_applied'], 'applied = the record of why that draft began');
  });

  await check('AE-42 next rehearsal: the candidate frozen from the next draft and its learner-condition rehearsal are linked back; shares from before it are not its evidence', async () => {
    const cur = (await f.request(authoring)).json;
    const edited = { ...cur.content, steps: cur.content.steps.map((s) => s.id === 'build' ? { ...s, acceptance: '390px와 1280px에서 진료시간이 한 줄씩 보인다' } : s) };
    const saved = await f.request(authoring, 'PUT', { profile_id: f.profile, request_id: KEY(), expected_revision: cur.revision, content: edited }); assert.equal(saved.status, 200, saved.raw);
    const frozen = await f.request(`${authoring}/versions/${V2}`, 'PUT', { expected_revision: saved.json.revision }); assert.equal(frozen.status, 200, frozen.raw);
    let v = (await f.request(`${retros}/${retro.id}`)).json;
    assert.deepEqual([v.next.version, v.next.rehearsal.state, v.next.confirmed], [V2, 'not_run', false]);
    await setRoster(f.env.HPS_KV, f.cohort, ['student-a', 'student-b', 'student-c', 'legacy-test-seat', 'rehearsal-t1']);
    const code = await f.request(`${authoring}/versions/${V2}/rehearsals`, 'POST', { learner: 'rehearsal-t1', request_id: KEY() }); assert.equal(code.status, 200, code.raw);
    v = (await f.request(`${retros}/${retro.id}`)).json;
    assert.deepEqual([v.next.version, v.next.rehearsal.state, v.next.rehearsal.id], [V2, 'running', code.json.rehearsal_id]);
    assert.equal(v.coverage.roster, 5, 'the denominator is the roster as it is now, rehearsal IDs included — not a claim about who attended');
    const list = (await f.request(retros)).json.retrospectives; assert.equal(list.find((r) => r.id === retro.id).applied_draft_revision !== null, true);
    // Review round 2: "next" is the FIRST candidate frozen from the next draft onward. A later one, frozen from a later
    // revision (and named so it sorts first), does not take its place.
    const later = (await f.request(authoring)).json;
    const resaved = await f.request(authoring, 'PUT', { profile_id: f.profile, request_id: KEY(), expected_revision: later.revision, content: { ...later.content, title: later.content.title + ' · 다음 판' } }); assert.equal(resaved.status, 200, resaved.raw);
    const frozen3 = await f.request(`${authoring}/versions/${V3}`, 'PUT', { expected_revision: resaved.json.revision }); assert.equal(frozen3.status, 200, frozen3.raw);
    v = (await f.request(`${retros}/${retro.id}`)).json;
    assert.deepEqual([v.next.version, v.next.rehearsal.state, v.next.rehearsal.id], [V2, 'running', code.json.rehearsal_id], 'the first candidate and its rehearsal, not the newest');
    // Review probe P2: share-a ran under V1 and was sent before V2 existed — it is no evidence about V2, whichever rule says so first.
    const p2 = await f.request(retros, 'POST', { request_id: KEY(), base_version: V2, doc: retroDoc([{ share_id: 'share-a', part: 'verification' }]) });
    assert.equal(p2.status, 409, p2.raw); assert.ok(['source_before_version', 'source_other_lesson'].includes(p2.json.reason), p2.json.reason);
  });

  await check('next draft from a version with a feature policy: the Service binding is stripped and the draft saves; an unreviewed independent template is refused', async () => {
    const FC = 'feature-course', FV = 'm2026.10.02-1', fa = `/admin/cohorts/${f.cohort}/authoring/${FC}`;
    const { model: _m, features: _f, ...plain } = v1.content;
    assert.equal((await f.request(fa, 'PUT', { profile_id: f.profile, request_id: KEY(), expected_revision: 0, content: { ...plain, title: '읽기만 하는 수업', features: { allowed: ['read'] } } })).status, 200);
    const frozen = await f.request(`${fa}/versions/${FV}`, 'PUT', { expected_revision: 1 }); assert.equal(frozen.status, 200, frozen.raw);
    const fv = await readLesson(f.env, f.cohort, FC, FV, f.profile);
    assert.ok(fv.content.features.binding, 'positive control: the frozen version carries a Service binding to strip');
    const made = await f.request(`${fa}/retrospectives`, 'POST', { request_id: KEY(), base_version: FV, doc: retroDoc([]) }); assert.equal(made.status, 201, made.raw);
    const go = await f.request(`${fa}/retrospectives/${made.json.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: 1 }); assert.equal(go.status, 201, go.raw);
    assert.deepEqual([go.json.draft.content.features.binding, go.json.draft.content.features.allowed], [undefined, ['read']]);
    const resaved = await f.request(fa, 'PUT', { profile_id: f.profile, request_id: KEY(), expected_revision: go.json.draft.revision, content: go.json.draft.content });
    assert.equal(resaved.status, 200, 'the next draft is an ordinary draft body: the instructor saves it as is — ' + resaved.raw);
    // An independent course whose execution template is not reviewed (now) starts no draft, exactly as an ordinary save would refuse.
    f.db.prepare('INSERT INTO authoring_independent_courses(cohort_id,course_id) VALUES(?,?)').run(f.cohort, FC);
    const again = await f.request(`${fa}/retrospectives`, 'POST', { request_id: KEY(), base_version: FV, doc: retroDoc([]) }); assert.equal(again.status, 201, again.raw);
    const refused = await f.request(`${fa}/retrospectives/${again.json.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: resaved.json.revision });
    assert.deepEqual([refused.status, refused.json.reason], [403, 'template_not_reviewed']);
    assert.equal((await f.request(fa)).json.revision, resaved.json.revision, 'nothing was written');
  });

  await check('the version a retrospective is about must still read the same: a changed document leaves it unreadable for view, edit and next draft', async () => {
    const TC = 'tamper-course', TV = 'm2026.10.03-1', ta = `/admin/cohorts/${f.cohort}/authoring/${TC}`;
    await f.freeze(TC, TV, ['intro', 'build', 'review']);
    const made = await f.request(`${ta}/retrospectives`, 'POST', { request_id: KEY(), base_version: TV, doc: retroDoc([]) }); assert.equal(made.status, 201, made.raw);
    assert.equal(made.json.base.readable, true);
    const tv = await readLesson(f.env, f.cohort, TC, TV, f.profile);
    const swapped = await makeModuleDoc({ kind: 'session-design', profileId: f.profile, version: TV, content: { ...tv.content, title: '고정 뒤에 바뀐 제목' } });
    f.db.prepare('UPDATE authoring_versions SET module_json=? WHERE cohort_id=? AND course_id=? AND version=?').run(JSON.stringify(swapped), f.cohort, TC, TV);
    const seen = (await f.request(`${ta}/retrospectives/${made.json.id}`)).json;
    assert.deepEqual([seen.base.readable, seen.base.title, seen.base.steps], [false, '', []]);
    assert.deepEqual(await f.request(`${ta}/retrospectives/${made.json.id}`, 'PUT', { expected_revision: 1, doc: retroDoc([]) }).then((r) => [r.status, r.json.reason]), [409, 'lesson_unavailable']);
    assert.deepEqual(await f.request(`${ta}/retrospectives/${made.json.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: 1 }).then((r) => [r.status, r.json.reason]), [409, 'lesson_unavailable']);
  });

  await check('the course moved to another profile after the retrospective (review round 2): no next draft, no edit, no new one — refused by name, nothing written', async () => {
    const PC = 'profile-course', PV = 'm2026.10.06-1', pa = `/admin/cohorts/${f.cohort}/authoring/${PC}`, MOVED_TO = 'boah-dental-teaser-2026-s1';
    await f.freeze(PC, PV, ['intro', 'build', 'review']);
    const made = await f.request(`${pa}/retrospectives`, 'POST', { request_id: KEY(), base_version: PV, doc: retroDoc([]) }); assert.equal(made.status, 201, made.raw);
    // The same instructor holds both classes of the cohort and moves the course's draft to the other one (an ordinary save).
    const both = await f.teacher('teacher-a', OPS_ALL, f.cohort, [f.profile, MOVED_TO]);
    const cur = (await f.request(pa, 'GET', undefined, both)).json;
    const moved = await f.request(pa, 'PUT', { profile_id: MOVED_TO, request_id: KEY(), expected_revision: cur.revision, content: cur.content }, both); assert.equal(moved.status, 200, moved.raw);
    const go = await f.request(`${pa}/retrospectives/${made.json.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: moved.json.revision }, both);
    assert.deepEqual([go.status, go.json.reason], [409, 'profile_changed'], go.raw);
    assert.deepEqual([(await f.request(pa, 'GET', undefined, both)).json.revision, one('SELECT applied_draft_revision AS a FROM lesson_retrospectives WHERE retro_id=?', made.json.id).a], [moved.json.revision, null], 'nothing was written');
    assert.deepEqual(await f.request(`${pa}/retrospectives/${made.json.id}`, 'PUT', { expected_revision: 1, doc: retroDoc([]) }, both).then((r) => [r.status, r.json.reason]), [409, 'profile_changed']);
    assert.deepEqual(await f.request(`${pa}/retrospectives`, 'POST', { request_id: KEY(), base_version: PV, doc: retroDoc([]) }, both).then((r) => [r.status, r.json.reason]), [409, 'profile_changed']);
  });

  await check('retrospective limit (review round 2): 50 about one version, then limit_reached; another version of the course still takes one; the list says when it shows only the newest 50', async () => {
    const CC = 'cap-course', CV1 = 'm2026.10.06-2', CV2 = 'm2026.10.06-3', ca = `/admin/cohorts/${f.cohort}/authoring/${CC}`;
    await f.freeze(CC, CV1, ['intro', 'build', 'review']);
    const cur = (await f.request(ca)).json;
    const saved = await f.request(ca, 'PUT', { profile_id: f.profile, request_id: KEY(), expected_revision: cur.revision, content: { ...cur.content, title: cur.content.title + ' · 2주차' } }); assert.equal(saved.status, 200, saved.raw);
    assert.equal((await f.request(`${ca}/versions/${CV2}`, 'PUT', { expected_revision: saved.json.revision })).status, 200);
    const post = (version) => f.request(`${ca}/retrospectives`, 'POST', { request_id: KEY(), base_version: version, doc: retroDoc([]) });
    for (let i = 0; i < 50; i++) { const r = await post(CV1); assert.equal(r.status, 201, r.raw); }
    assert.deepEqual(await post(CV1).then((r) => [r.status, r.json.reason]), [429, 'limit_reached'], 'the 51st about one version');
    const next = await post(CV2); assert.equal(next.status, 201, 'the history of one version does not close the course: ' + next.raw);
    const list = (await f.request(`${ca}/retrospectives`)).json;
    assert.deepEqual([list.retrospectives.length, list.has_more, list.retrospectives.some((r) => r.id === next.json.id)], [50, true, true], 'the newest 50, and a flag that there are more');
    assert.equal((await f.request(retros)).json.has_more, false, 'a course with fewer says so');
    assert.equal(one('SELECT count(*) AS n FROM lesson_retrospectives WHERE course_id=?', CC).n, 51);
  });

  await check('body size (review F8): a doc at every field limit in Korean is accepted; a body past RETRO_BODY_MAX is refused by name', async () => {
    const ta = `/admin/cohorts/${f.cohort}/authoring/size-course`, SV = 'm2026.10.04-1';
    await f.freeze('size-course', SV, ['intro', 'build', 'review']);
    const big = { hypothesis: '가'.repeat(L.LIMITS.hypothesis),
      findings: Array.from({ length: L.LIMITS.findings }, (_, i) => ({ id: 'f' + i, text: '가'.repeat(L.LIMITS.finding_text), sources: [] })),
      decisions: Array.from({ length: L.LIMITS.decisions }, (_, i) => ({ id: 'd' + i, target: 'lesson', action: 'hold', reason: '가'.repeat(L.LIMITS.decision_reason) })),
      notes: Object.fromEntries(L.NOTE_KEYS.map((k) => [k, '가'.repeat(L.LIMITS.note)])) };
    const body = { request_id: KEY(), base_version: SV, doc: big };
    assert.ok(Buffer.byteLength(JSON.stringify(body)) > 64 * 1024, 'positive control: larger than the old 64 KiB cap');
    const ok = await f.request(`${ta}/retrospectives`, 'POST', body); assert.equal(ok.status, 201, ok.raw.slice(0, 200));
    const tooBig = await f.request(`${ta}/retrospectives`, 'POST', { ...body, request_id: KEY(), pad: 'x'.repeat(L.RETRO_BODY_MAX) });
    assert.deepEqual([tooBig.status, tooBig.json.reason], [413, 'too_large']);
  });

  await check('retention: a withdrawn or purged share takes the learner\'s answers and its lesson record with it', async () => {
    assert.ok(one('SELECT count(*) AS n FROM classroom_share_responses WHERE share_id=?', 'share-c').n >= 1);
    f.db.prepare('UPDATE classroom_shares SET expires_at=0 WHERE id=?').run('share-c');
    const { purgeExpiredClassroomShares } = await import('../src/routes/classroom.ts'); await purgeExpiredClassroomShares(f.env);
    assert.equal(one('SELECT count(*) AS n FROM classroom_share_responses WHERE share_id=?', 'share-c').n, 0);
    assert.equal(one('SELECT count(*) AS n FROM classroom_share_lessons WHERE share_id=?', 'share-c').n, 0);
    assert.equal((await f.request(`${studentShares}/share-a`, 'DELETE', undefined, studentA)).status, 200);
    assert.equal(one('SELECT count(*) AS n FROM classroom_share_responses WHERE share_id=?', 'share-a').n, 0);
    assert.equal(one('SELECT count(*) AS n FROM classroom_share_lessons WHERE share_id=?', 'share-a').n, 0);
    const v = (await f.request(`${retros}/${retro.id}`)).json;
    assert.deepEqual(v.findings.map((x) => x.status), ['unobserved', 'unobserved'], 'nothing the learner withdrew still stands behind a finding');
  });

  // ── review round 2: which lesson a share records where lesson settings are ENFORCED. Its own fixture: a class run with
  // remote operations and lesson settings on, and the switch made the way classroom-ops-lesson-settings makes it — a setting
  // saved and sent by an instructor who may send settings, held by the learner's device, switched through the lesson-binding route.
  const g = await localOps(); g.env.HPS_LESSON_BINDINGS = 'enforce'; g.env.HPS_FEEDBACK_LOOP = 'enabled';
  try {
    await check('lesson of a share where settings are enforced (review round 2): a learner switched to S2 records S2 (`setting`), an unswitched one S1 (`token`); each is evidence about that version only', async () => {
      const gc = g.lesson.course_id, S1 = g.lesson.version, S2 = 'm2026.09.18-2', ga = `/admin/cohorts/${g.cohort}/authoring/${gc}`, gr = ga + '/retrospectives';
      await g.freeze(gc, S1, ['intro', 'build', 'review']);
      const cur = (await g.request(ga)).json;
      const v2 = await g.request(ga, 'PUT', { profile_id: g.profile, request_id: KEY(), expected_revision: cur.revision, content: { ...cur.content, title: '합성 수업 v2' } }); assert.equal(v2.status, 200, v2.raw);
      assert.equal((await g.request(`${ga}/versions/${S2}`, 'PUT', { expected_revision: v2.json.revision })).status, 200);
      const sha = {}; for (const v of [S1, S2]) sha[v] = (await readLesson(g.env, g.cohort, gc, v, g.profile)).sha256;
      assert.equal((await g.configure([{ seat_id: 'A1', student_id: 'student-a' }, { seat_id: 'A2', student_id: 'student-b' }], 0, { flags: { ops_observe: true, ops_commands: true, ops_distribute: true, ops_lesson_settings: true } })).status, 201);
      const CAPS = ['observe', 'commands', 'distribution_inbox', 'inbox_prompt', 'lesson_binding'];
      const a1 = (await g.pair('A1', 1, 1, CAPS)).conn.json; assert.equal((await g.pair('A2', 1, 2, CAPS)).conn.status, 201);
      const code = async (u) => (await issue({ u, c: g.cohort, p: g.profile, lesson: { course_id: gc, version: S1, sha256: sha[S1] } }, 2, TEST_SECRET)).token;
      const tokenA = await code('student-a'), tokenB = await code('student-b');
      const L = await g.teacher('teacher-l', [...OPS_ALL, 'distribute', 'lesson_settings']);
      const setting = await g.request(g.base + '/contents', 'POST', { idempotency_key: KEY(), kind: 'setting', title: '2번째 판', body: '다음 질문부터 새 단계로 진행합니다.', lesson: { course_id: gc, version: S2, sha256: sha[S2] } }, L); assert.equal(setting.status, 201, setting.raw);
      const sent = await g.request(g.base + '/distributions', 'POST', { idempotency_key: KEY(), expected_roster_revision: 1, object_id: setting.json.object_id, revision: setting.json.revision, content_hash: setting.json.content_hash, targets: ['A1'] }, L); assert.ok(sent.json?.distribution, sent.raw);
      g.db.prepare('UPDATE classroom_distribution_targets SET next_offer_at=0').run();
      const [item] = (await g.sync(a1.credential, [], 1)).json.distribution?.items ?? []; assert.ok(item, 'positive control: the device holds the setting');
      const receipt = (stage) => ({ offer_key: item.offer_key, distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, seq: item.seq, stage, result_code: '', observed_at: Date.now() });
      const held = await g.sync(a1.credential, [], 1, { distribution: { receipts: [receipt('received'), receipt('reflected')] } }); assert.ok(held.json.distribution.receipt_acks.every((x) => x.recorded), held.raw);
      const sw = await g.request('/v1/classroom/ops/lesson-binding', 'POST', { app_instance_id: g.instance(1).app_instance_id, boot_id: g.instance(1).boot_id, offer_key: item.offer_key, distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, base_lesson_sha256: sha[S1], learner_token: tokenA }, a1.credential);
      assert.equal(sw.status, 201, sw.raw); assert.deepEqual([sw.json.binding.source, sw.json.binding.version], ['setting', S2]);
      // Both learners share with the instructor their class assigns them (the help route names who that is).
      const recipient = (await g.request('/v1/classroom/help-recipient', 'GET', undefined, tokenA)).json.recipient_id;
      const send = (id, token) => g.request(studentShares, 'POST', { id, recipient_id: recipient, kind: 'submission', consent: true, duration_minutes: 60, content: { verification: '바뀐 단계에서 직접 확인했다' } }, token);
      assert.equal((await send('share-switched', tokenA)).status, 201); assert.equal((await send('share-unswitched', tokenB)).status, 201);
      const rec = (id) => ({ ...g.db.prepare('SELECT course_id, version, lesson_sha256, source FROM classroom_share_lessons WHERE share_id=?').get(id) });
      assert.deepEqual(rec('share-switched'), { course_id: gc, version: S2, lesson_sha256: sha[S2], source: 'setting' }, 'the setting the learner runs, not the version on their code');
      assert.deepEqual(rec('share-unswitched'), { course_id: gc, version: S1, lesson_sha256: sha[S1], source: 'token' });
      const cite = (version, id) => g.request(gr, 'POST', { request_id: KEY(), base_version: version, doc: retroDoc([{ share_id: id, part: 'verification' }]) });
      assert.deepEqual(await cite(S1, 'share-switched').then((r) => [r.status, r.json.reason]), [409, 'source_other_lesson'], 'sent under S2: no evidence about S1');
      assert.deepEqual(await cite(S2, 'share-unswitched').then((r) => [r.status, r.json.reason]), [409, 'source_other_lesson'], 'sent under S1: no evidence about S2');
      for (const [version, id] of [[S2, 'share-switched'], [S1, 'share-unswitched']]) {
        const r = await cite(version, id); assert.equal(r.status, 201, r.raw);
        const [x] = r.json.findings; assert.deepEqual([x.status, x.sources[0].lesson, 'lesson_unconfirmed' in x], ['observed', 'this_version', false], version + ' ← ' + id);
      }
    });
  } finally { g.close(); }

  console.log(`${passed} feedback-loop checks passed`);
} finally { f.close(); }
