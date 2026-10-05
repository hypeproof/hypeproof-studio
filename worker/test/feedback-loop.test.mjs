// #1013 feedback-loop — a person's feedback → the learner's own answer (AE-43) → the instructor's retrospective of the
// version that ran → the next draft and its next rehearsal (AE-42, CH-05). Real Service routing, real token verifier and
// SQLite (schema.sql carries migration 0039); every account and share is synthetic. No model is called.
// Says nothing about a real class, a real person's feedback or an installed Studio: those stay NOT RUN.
import assert from 'node:assert/strict';
import { localOps } from './harness/classroom-ops.mjs';

const L = await import('../src/lib/feedback-loop.ts');
const { readLesson } = await import('../src/lib/lesson-delivery.ts');
const { setRoster } = await import('../src/lib/kv.ts');
const { issueIssuer } = await import('../src/lib/tokens.ts');
const { TEST_SECRET } = await import('./harness/index.mjs');
let passed = 0; const check = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name); };
const KEY = () => crypto.randomUUID();

// ── pure rules first: the instrument has to tell the cases apart before the routes are judged with it ─────────────
await check('rules — whose words: an AI answer is never a person, feedback is always the person; findings follow', async () => {
  assert.equal(L.PART_ORIGIN.response, 'ai'); assert.equal(L.PART_ORIGIN.feedback, 'human');
  assert.deepEqual(['question', 'prompt', 'verification', 'learner_response'].map((p) => L.PART_ORIGIN[p]), ['learner', 'learner', 'learner', 'learner']);
  const live = (parts, kind = 'submission') => () => ({ available: true, kind, student_id: 's', parts: new Set(parts) });
  const f = (sources, assistance = 'unknown') => ({ id: 'f', text: 't', sources, assistance });
  // Positive: a learner's words or a person's feedback make it observed.
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'verification' }]), live(['verification'])).status, 'observed');
  const fb = L.findingView(f([{ share_id: 'a', part: 'feedback' }]), live(['feedback']));
  assert.deepEqual([fb.status, fb.human_feedback], ['observed', 'present']);
  // Negative: the AI answer alone, a tool line alone, nothing cited, or a withdrawn share are all unobserved — named.
  const ai = L.findingView(f([{ share_id: 'a', part: 'response' }]), live(['response']));
  assert.deepEqual([ai.status, ai.unobserved_reason, ai.human_feedback], ['unobserved', 'no_person_source', 'unobserved']);
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'tool_summary' }]), live(['tool_summary'])).unobserved_reason, 'no_person_source');
  assert.equal(L.findingView(f([]), live([])).unobserved_reason, 'no_source');
  const gone = L.findingView(f([{ share_id: 'a', part: 'question' }], 'assisted'), () => ({ available: false }));
  assert.deepEqual([gone.status, gone.unobserved_reason, gone.assistance, gone.assistance_basis_unavailable], ['unobserved', 'sources_unavailable', 'unknown', true]);
  assert.equal(L.findingView(f([{ share_id: 'a', part: 'question' }], 'assisted'), live(['question'], 'help')).assistance, 'assisted');
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
  assert.equal(L.parseResponse({ expected_revision: 2, decision: 'agree', reason: 'x' }).code, 'invalid_decision');
  assert.equal(L.parseResponse({ expected_revision: 2, decision: 'keep', reason: '  ' }).code, 'invalid_reason');
  assert.equal(L.parseResponse({ expected_revision: 2, decision: 'keep', reason: 'x', score: 1 }).code, 'unknown_field');
});

// ── HTTP: the whole loop on the real routes ────────────────────────────────────────────────────────────────────
const f = await localOps();
const course = f.lesson.course_id, V1 = f.lesson.version, V2 = 'm2026.10.05-2';
const authoring = `/admin/cohorts/${f.cohort}/authoring/${course}`, retros = authoring + '/retrospectives';
const teacherShares = `/admin/cohorts/${f.cohort}/classroom/shares`, studentShares = '/v1/classroom/shares';
const one = (sql, ...a) => { const r = f.db.prepare(sql).get(...a); return r ? { ...r } : r; };
const count = (table) => one(`SELECT count(*) AS n FROM ${table}`).n;
try {
  await f.freeze(course, V1, ['intro', 'build', 'review']);
  const studentA = await f.student('student-a'), studentB = await f.student('student-b');
  const share = (id, patch, token = studentA) => f.request(studentShares, 'POST', { id, recipient_id: 'teacher-a', kind: 'submission', consent: true, duration_minutes: 60, content: { prompt: '진료시간을 바꿔줘', response: 'AI가 쓴 답: 줄바꿈을 넣었습니다', verification: '390px에서 줄바꿈이 깨지는지 직접 봤다' }, ...patch }, token);
  const answer = (id, expected_revision, feedback = '모바일에서 토요일 시간이 두 줄로 갈립니다. 표 대신 목록이 어떨까요?') => f.request(`${teacherShares}/${id}`, 'PUT', { expected_revision, status: 'answered', feedback, next_action: '모바일에서 다시 확인' });
  const respond = (id, body, token = studentA) => f.request(`${studentShares}/${id}/response`, 'POST', body, token);
  assert.equal((await share('share-a')).status, 201);
  assert.equal((await share('share-b', { kind: 'help', content: { question: '토요일 진료시간을 어디에 적어야 할지 모르겠어요' } }, studentB)).status, 201);
  assert.equal((await share('share-other-teacher', { recipient_id: 'teacher-b' })).status, 201);
  // Synthetic rows only the database can produce here: a share of another class of the same cohort (another profile)
  // and an expired one. Copied from a real row; only the named column differs.
  const row = one('SELECT * FROM classroom_shares WHERE id=?', 'share-a'), cols = Object.keys(row);
  const put = (id, over) => f.db.prepare(`INSERT INTO classroom_shares(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((k) => ({ ...row, id, ...over })[k]));
  put('share-other-class', { profile_id: 'boah-dental-teaser-2026-s1' }); put('share-expired', { expires_at: 1 });

  await check('switch off (default): no route answers, no table is read, share reads keep their exact shape', async () => {
    assert.deepEqual(await f.request(retros).then((r) => [r.status, r.json.reason]), [404, 'feedback_loop_unavailable']);
    assert.deepEqual(await respond('share-a', { expected_revision: 1, decision: 'keep', reason: 'x' }).then((r) => [r.status, r.json.reason]), [404, 'feedback_loop_unavailable']);
    const own = (await f.request(studentShares, 'GET', undefined, studentA)).json.shares; assert.ok(own.length && own.every((s) => !('response' in s)));
    assert.equal('response' in (await f.request(`${teacherShares}/share-a`)).json, false);
    f.env.HPS_FEEDBACK_LOOP = 'enabled';
  });

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

  await check('AE-43 a changed feedback text is a new question: the old answer is marked as answering an earlier text', async () => {
    assert.equal((await share('share-c', { content: { verification: '예약 버튼 색을 바꿨다' } })).status, 201);
    assert.equal((await answer('share-c', 1, '버튼이 눈에 안 띕니다')).status, 200);
    assert.equal((await respond('share-c', { expected_revision: 2, decision: 'hold', reason: '원장님께 먼저 물어보겠습니다' })).status, 201);
    assert.equal((await answer('share-c', 2, '버튼 대비를 4.5:1 이상으로 맞춰 보세요')).status, 200);
    const mine = (await f.request(studentShares, 'GET', undefined, studentA)).json.shares.find((s) => s.id === 'share-c');
    assert.deepEqual([mine.response.decision, mine.response.answers_current_feedback], ['hold', false]);
    const again = await respond('share-c', { expected_revision: 3, decision: 'revise', reason: '대비를 맞추겠습니다' }); assert.equal(again.status, 201, again.raw);
    assert.equal(again.json.response.answers_current_feedback, true);
  });

  await check('sources: only shares sent to THIS instructor for THIS course\'s class, unexpired; parts and whose words, never content', async () => {
    const r = await f.request(retros + '/sources'); assert.equal(r.status, 200, r.raw);
    assert.deepEqual(r.json.sources.map((s) => s.id).sort(), ['share-a', 'share-b', 'share-c']);
    const a = r.json.sources.find((s) => s.id === 'share-a');
    assert.deepEqual(a.parts.map((p) => p.part + ':' + p.origin), ['prompt:learner', 'response:ai', 'verification:learner', 'feedback:human', 'learner_response:learner']);
    assert.ok(!r.raw.includes('진료시간을 바꿔줘') && !r.raw.includes('목록으로 바꾸고'), 'metadata only: content is read through the audited share route');
    assert.equal((await f.request(retros + '/sources', 'GET', undefined, await f.teacher('teacher-b'))).status, 404, 'not their course');
  });

  const doc = {
    hypothesis: '확인 기준을 먼저 적게 하면 모바일 줄바꿈 같은 문제를 학생이 스스로 찾는다',
    findings: [
      { id: 'f1', text: '학생이 390px에서 직접 확인했고, 사람의 피드백 뒤 목록으로 고치기로 했다', sources: [{ share_id: 'share-a', part: 'verification' }, { share_id: 'share-a', part: 'feedback' }, { share_id: 'share-a', part: 'learner_response' }] },
      { id: 'f2', text: 'AI는 줄바꿈을 넣었다고 답했다', sources: [{ share_id: 'share-a', part: 'response' }] },
      { id: 'f3', text: '토요일 시간을 어디에 적을지 도움을 요청했다', sources: [{ share_id: 'share-b', part: 'question' }], assistance: 'assisted' },
    ],
    decisions: [
      { id: 'd1', target: 'build', action: 'revise', reason: '모바일 확인을 단계 안에 넣는다', findings: ['f1'] },
      { id: 'd2', target: 'review', action: 'keep', reason: '검토 단계는 그대로 둔다' },
      { id: 'd3', target: 'lesson', action: 'hold', reason: '도움 방식은 한 번 더 보고 정한다', findings: ['f3'] },
    ],
    notes: { no_signal: '두 명은 공유 기록이 없어 이 회고로 판단하지 않는다' },
  };
  let retro;
  await check('AE-42 retrospective: hypothesis, the version and help condition that ran, sourced findings, decisions, the unobserved', async () => {
    const r = await f.request(retros, 'POST', { request_id: 'rq-1', base_version: V1, doc }); assert.equal(r.status, 201, r.raw); retro = r.json;
    const base = await readLesson(f.env, f.cohort, course, V1, f.profile);
    assert.deepEqual([retro.format, retro.base.version, retro.base.lesson_sha256, retro.base.readable], ['hps-lesson-retrospective/1', V1, base.sha256, true]);
    assert.deepEqual(retro.base.steps.map((s) => s.step_id), ['intro', 'build', 'review']);
    const [f1, f2, f3] = retro.findings;
    assert.deepEqual([f1.status, f1.human_feedback, f1.sources.map((s) => s.origin)], ['observed', 'present', ['learner', 'human', 'learner']]);
    assert.deepEqual([f2.status, f2.unobserved_reason, f2.human_feedback], ['unobserved', 'no_person_source', 'unobserved'], 'an AI answer alone is not a person\'s observation');
    assert.deepEqual([f3.status, f3.assistance, f3.human_feedback], ['observed', 'assisted', 'unobserved'], 'no person answered yet: social correction unobserved');
    assert.deepEqual(retro.coverage, { roster: 4, learners_with_sources: 2, learners_without_sources: 2, help_requests_cited: 1, help_use: 'unobserved', stopped: 'unobserved' });
    assert.deepEqual(retro.decisions.map((d) => [d.target, d.action, d.target_title]), [['build', 'revise', 'build'], ['review', 'keep', 'review'], ['lesson', 'hold', '']]);
    assert.equal(retro.applied, null); assert.equal(retro.next, null);
    const stored = one('SELECT doc_json FROM lesson_retrospectives WHERE retro_id=?', retro.id).doc_json;
    assert.ok(!stored.includes('390px에서 줄바꿈이 깨지는지') && !stored.includes('목록으로 바꾸고'), 'the stored record holds references, not the learner\'s content');
    assert.equal((await f.request(retros, 'POST', { request_id: 'rq-1', base_version: V1, doc })).json.id, retro.id, 'a retried create is the same retrospective');
    assert.deepEqual(await f.request(retros, 'POST', { request_id: 'rq-1', base_version: V1, doc: { ...doc, hypothesis: '다른 가설' } }).then((r) => [r.status, r.json.reason]), [409, 'request_id_conflict']);
  });

  await check('negative controls: other instructor\'s, other class\'s, expired or unknown shares, empty parts, unearned claims — nothing written', async () => {
    const before = count('lesson_retrospectives');
    const cite = (sources, assistance) => ({ ...doc, findings: [{ id: 'f1', text: '근거', sources, ...(assistance ? { assistance } : {}) }], decisions: [{ id: 'd1', target: 'lesson', action: 'keep', reason: '유지' }] });
    const post = (d) => f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc: d });
    for (const id of ['share-other-teacher', 'share-other-class', 'share-expired', 'no-such-share'])
      assert.deepEqual(await post(cite([{ share_id: id, part: 'verification' }])).then((r) => [r.status, r.json.reason]), [409, 'source_unavailable'], id);
    assert.deepEqual(await post(cite([{ share_id: 'share-b', part: 'feedback' }])).then((r) => [r.status, r.json.reason]), [409, 'no_human_feedback'], 'no person has answered share-b');
    assert.deepEqual(await post(cite([{ share_id: 'share-b', part: 'learner_response' }])).then((r) => [r.status, r.json.reason]), [409, 'no_learner_response']);
    assert.deepEqual(await post(cite([{ share_id: 'share-b', part: 'prompt' }])).then((r) => [r.status, r.json.reason]), [409, 'source_part_empty']);
    assert.deepEqual(await post(cite([{ share_id: 'share-a', part: 'verification' }], 'assisted')).then((r) => [r.status, r.json.reason]), [400, 'unsupported_assistance'], 'a submission is no record of help');
    assert.deepEqual(await post(cite([{ share_id: 'share-a', part: 'verification' }], 'independent')).then((r) => [r.status, r.json.reason]), [400, 'unsupported_independence'], 'nothing records independent performance');
    assert.deepEqual(await f.request(retros, 'POST', { request_id: KEY(), base_version: 'm2026.01.01-9', doc }).then((r) => [r.status, r.json.reason]), [404, 'version_not_found']);
    assert.equal((await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc }, await f.teacher('teacher-b'))).status, 404, 'another instructor: not their course');
    assert.equal((await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc }, await f.teacher('teacher-a', undefined, 'sk-biopharm-2026-a', ['sk-biopharm-kids-2026-grade-3-4-s1']))).status, 403, 'an instructor of another cohort');
    assert.ok([401, 403].includes((await f.request(retros, 'POST', { request_id: KEY(), base_version: V1, doc }, await f.student('student-a'))).status), 'a learner token');
    assert.equal(count('lesson_retrospectives'), before, 'every refusal wrote nothing');
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
    const v1 = await readLesson(f.env, f.cohort, course, V1, f.profile);
    assert.deepEqual([go.json.draft.revision, go.json.applied.draft_revision, go.json.next.draft_revision, go.json.next.version], [drifted.json.revision + 1, drifted.json.revision + 1, drifted.json.revision + 1, null]);
    assert.deepEqual(go.json.draft.content, v1.content, 'the next draft starts from the version that ran');
    assert.equal((await f.request(authoring)).json.content.title, v1.content.title);
    assert.deepEqual(one('SELECT module_json, source_revision FROM authoring_versions WHERE course_id=? AND version=?', course, V1), v1Before, 'the run version is byte-identical');
    assert.equal(count('authoring_confirmations') + count('authoring_rehearsals'), 0, 'no rehearsal or confirmation was created or touched');
    assert.equal((await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: rq, expected_draft_revision: drifted.json.revision })).status, 200, 'a retried start is the same start');
    assert.deepEqual(await f.request(`${retros}/${retro.id}/next-draft`, 'POST', { request_id: KEY(), expected_draft_revision: drifted.json.revision + 1 }).then((r) => [r.status, r.json.reason]), [409, 'already_applied']);
    assert.deepEqual(await f.request(`${retros}/${retro.id}`, 'PUT', { expected_revision: 2, doc }).then((r) => [r.status, r.json.reason]), [409, 'retrospective_applied'], 'applied = the record of why that draft began');
  });

  await check('AE-42 next rehearsal: the candidate frozen from the next draft and its learner-condition rehearsal are linked back', async () => {
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
    const list = (await f.request(retros)).json.retrospectives; assert.deepEqual(list.map((r) => [r.id, r.applied_draft_revision !== null]), [[retro.id, true]]);
  });

  await check('retention: a withdrawn or purged share takes the learner\'s answers with it', async () => {
    assert.ok(one('SELECT count(*) AS n FROM classroom_share_responses WHERE share_id=?', 'share-c').n >= 1);
    f.db.prepare('UPDATE classroom_shares SET expires_at=0 WHERE id=?').run('share-c');
    const { purgeExpiredClassroomShares } = await import('../src/routes/classroom.ts'); await purgeExpiredClassroomShares(f.env);
    assert.equal(one('SELECT count(*) AS n FROM classroom_share_responses WHERE share_id=?', 'share-c').n, 0);
    assert.equal((await f.request(`${studentShares}/share-a`, 'DELETE', undefined, studentA)).status, 200);
    assert.equal(one('SELECT count(*) AS n FROM classroom_share_responses WHERE share_id=?', 'share-a').n, 0);
    const v = (await f.request(`${retros}/${retro.id}`)).json;
    assert.deepEqual(v.findings.map((x) => x.status), ['unobserved', 'unobserved'], 'nothing the learner withdrew still stands behind a finding');
  });

  console.log(`${passed} feedback-loop checks passed`);
} finally { f.close(); }
