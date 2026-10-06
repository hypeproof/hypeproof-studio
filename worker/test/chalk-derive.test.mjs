// #1469 (E3-3) — deriveRunbook / deriveHandout pure functions + POST /derive + GET /plan?file=runbook|handout
// DR-01~DR-16
import './harness/loader.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { bootApp, createMockEnv, makeCtx, TEST_SECRET, COHORT } from './harness/index.mjs';

const { issueIssuer } = await import('../src/lib/tokens.ts');
const { listProfiles } = await import('../src/profiles/index.ts');
const { deriveRunbook, deriveHandout } = await import('../src/lib/chalk-derive.ts');
const { sha256Hex } = await import('../src/lib/modules.ts');
const { generateOpsSkeleton } = await import('../src/routes/chalk-courses.ts');

const app = await bootApp();

const AUTHORING_SCHEMA = readFileSync(new URL('../migrations/0002-chalk-authoring.sql', import.meta.url), 'utf8');
const PLAN_SCHEMA = readFileSync(new URL('../migrations/0031-chalk-plan-files.sql', import.meta.url), 'utf8');
const TIER_DURATION_SCHEMA = readFileSync(new URL('../migrations/0035-chalk-course-inputs-tier-duration.sql', import.meta.url), 'utf8');
const FEEDBACK_SCHEMA = readFileSync(new URL('../migrations/0036-chalk-feedback.sql', import.meta.url), 'utf8');
const JUDGEMENTS_SCHEMA = readFileSync(new URL('../migrations/0037-chalk-judgements.sql', import.meta.url), 'utf8');
const KB_SCHEMA = `
CREATE TABLE IF NOT EXISTS chalk_knowledge_versions (
  version INTEGER PRIMARY KEY, parent_version INTEGER,
  origin TEXT NOT NULL, source_repo TEXT, source_commit TEXT,
  note TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  doc_count INTEGER NOT NULL, digest TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chalk_knowledge_docs (
  version INTEGER NOT NULL REFERENCES chalk_knowledge_versions(version),
  doc_id TEXT NOT NULL, kind TEXT NOT NULL, fields_json TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '', source_path TEXT,
  PRIMARY KEY (version, doc_id)
);
`;

const profileId = listProfiles().find(p => p.session.cohort_id === COHORT)?.id;
assert.ok(profileId, 'profile not found for COHORT');

// ── Sample ops HTML ───────────────────────────────────────────────────────────
const SAMPLE_OPS_HTML = `<!DOCTYPE html>
<html lang="ko" data-chalk-plan="1" data-chalk-kind="ops">
<head>
  <meta charset="utf-8">
  <meta name="chalk:course" content="test-course">
  <meta name="chalk:knowledge-version" content="1">
  <meta name="chalk:format" content="track">
  <meta name="chalk:audience-tier" content="lv1">
  <meta name="chalk:family-session" content="false">
  <meta name="chalk:duration-min" content="240">
</head>
<body>
  <section data-chalk-section="schedule">
    <table>
      <tr data-chalk-block="block-1" data-chalk-step-ref="s-1 s-2" data-start="09:00" data-duration-min="110">
        <td data-chalk-field="activity">탐구 활동</td>
        <td data-chalk-field="asset">탐구 키트</td>
        <td data-chalk-field="artifact">탐구 노트</td>
        <td data-chalk-role="facilitator">진행자 안내</td>
        <td data-chalk-role="assistant">보조 지원</td>
        <td data-chalk-role="learner">탐구 수행</td>
        <td data-chalk-field="exit-criteria">노트 완성</td>
        <td data-chalk-field="if-stuck">힌트 제공</td>
      </tr>
      <tr data-chalk-block="break" data-chalk-block-kind="break" data-start="10:50" data-duration-min="20">
        <td data-chalk-field="activity">쉬는 시간</td>
      </tr>
      <tr data-chalk-block="buffer" data-chalk-block-kind="buffer" data-start="11:10" data-duration-min="10">
        <td data-chalk-field="activity">여유 시간</td>
        <td data-chalk-role="facilitator">조율</td>
        <td data-chalk-role="learner">자유</td>
        <td data-chalk-field="if-ahead">일찍 끝나면 심화</td>
        <td data-chalk-field="if-behind">늦으면 축소</td>
      </tr>
      <tr data-chalk-block="block-2" data-chalk-step-ref="s-3" data-start="11:20" data-duration-min="100">
        <td data-chalk-field="activity">심화 탐구</td>
        <td data-chalk-field="asset">발표 카드</td>
        <td data-chalk-field="artifact">발표 자료</td>
        <td data-chalk-role="facilitator">심화 진행</td>
        <td data-chalk-role="learner">심화 활동</td>
        <td data-chalk-field="exit-criteria">발표 완료</td>
        <td data-chalk-field="if-stuck">질문 유도</td>
      </tr>
    </table>
  </section>
  <section data-chalk-section="materials">
    <ul>
      <li data-owner="learner">탐구 키트 (학생용)</li>
      <li data-owner="instructor">진행자 매뉴얼</li>
      <li data-owner="parent">학부모 안내문</li>
    </ul>
  </section>
  <section data-chalk-section="risks">
    <ul>
      <li data-chalk-risk="ai-latency"><span data-chalk-field="first-line">AI 응답 지연</span></li>
      <li data-chalk-risk="content-guard"><span data-chalk-field="first-line">부적절 콘텐츠 차단</span></li>
      <li data-chalk-risk="pace-gap"><span data-chalk-field="first-line">속도 차이</span></li>
      <li data-chalk-risk="parent-overreach"><span data-chalk-field="first-line">보호자 과잉 개입</span></li>
      <li data-chalk-risk="overtime"><span data-chalk-field="first-line">시간 초과</span></li>
    </ul>
  </section>
  <section data-chalk-section="consent"><ul><li>동의 항목</li></ul></section>
  <section data-chalk-section="post-deliverables"><ul><li>사후 제출물</li></ul></section>
</body>
</html>`;

const SAMPLE_OPS_SHA = 'test-ops-sha-abc123';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(KB_SCHEMA);
  db.exec(AUTHORING_SCHEMA);
  db.exec(PLAN_SCHEMA);
  db.exec(TIER_DURATION_SCHEMA);
  db.exec(FEEDBACK_SCHEMA);
  db.exec(JUDGEMENTS_SCHEMA);
  db.prepare(`INSERT INTO chalk_knowledge_versions VALUES(1,NULL,'vault-import',NULL,NULL,'test','tester',0,1,'digest0')`).run();
  db.prepare(
    `INSERT INTO authoring_drafts (cohort_id,course_id,owner_id,profile_id,revision,content_json,request_id,request_hash,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    COHORT, 'test-course', 'tester', '', 1,
    '{"schema":"hps-session-design/1","title":"","audience":"","duration_minutes":120,"objective":"","prerequisites":"","starter":"","steps":[]}',
    'req-seed', 'hash-seed', new Date().toISOString(),
  );
  return db;
}

function makeEnv(db) {
  const env = createMockEnv({ withSession: false });
  function makeStmt(sql) {
    let bindings = [];
    const stmt = {
      get _sql() { return sql; },
      bind(...args) { bindings = [...args]; return stmt; },
      async first() { return db.prepare(sql).get(...bindings) ?? null; },
      async run() { const r = db.prepare(sql).run(...bindings); return { success: true, meta: { changes: Number(r.changes) } }; },
      async all() { return { success: true, results: db.prepare(sql).all(...bindings) }; },
    };
    return stmt;
  }
  env.HPS_DB = {
    prepare(sql) { return makeStmt(sql); },
    async batch(stmts) {
      const results = [];
      for (const stmt of stmts) {
        try { results.push(await stmt.run()); } catch { results.push({ success: false }); }
      }
      return results;
    },
  };
  return env;
}

async function makeTok(db) {
  const env = makeEnv(db);
  const tok = (await issueIssuer({ issuer: 'tester', scopes: [{ cohort: COHORT, profiles: [profileId] }] }, 4, TEST_SECRET)).token;
  return { tok, env };
}

async function req(method, path, body, tok, db) {
  const env = makeEnv(db);
  const base = `/admin/chalk/cohorts/${COHORT}/courses/test-course`;
  const fullPath = path.startsWith('/') ? path : `${base}/${path}`;
  const headers = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const init = body !== null ? { method, headers, body: JSON.stringify(body) } : { method, headers };
  const res = await app.fetch(
    new Request('https://service.test' + fullPath, init),
    env, makeCtx(),
  );
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function seedOps(db, sha) {
  const actualSha = sha ?? await sha256Hex(SAMPLE_OPS_HTML);
  db.prepare(
    `INSERT INTO chalk_plan_files (cohort_id,course_id,ref_kind,ref,file,html,sha256,knowledge_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(COHORT, 'test-course', 'draft', '1', 'ops', SAMPLE_OPS_HTML, actualSha, 1, Date.now());
  return actualSha;
}

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

// ── Pure function tests (no HTTP) ─────────────────────────────────────────────

// DR-01: runbook has data-chalk-kind="runbook" and data-chalk-derived-from=sha
await check('DR-01 deriveRunbook → data-chalk-kind="runbook", data-chalk-derived-from=sha', () => {
  const html = deriveRunbook(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  assert.ok(html.includes('data-chalk-kind="runbook"'), 'must have kind=runbook');
  assert.ok(html.includes(`data-chalk-derived-from="${SAMPLE_OPS_SHA}"`), 'must have derived-from sha');
});

// DR-02: handout has data-chalk-kind="handout" and same derived-from
await check('DR-02 deriveHandout → data-chalk-kind="handout", data-chalk-derived-from=sha', () => {
  const html = deriveHandout(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  assert.ok(html.includes('data-chalk-kind="handout"'), 'must have kind=handout');
  assert.ok(html.includes(`data-chalk-derived-from="${SAMPLE_OPS_SHA}"`), 'must have derived-from sha');
});

// DR-03: deterministic — same input → same output
await check('DR-03 deriveRunbook and deriveHandout are deterministic', () => {
  const r1 = deriveRunbook(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  const r2 = deriveRunbook(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  assert.equal(r1, r2, 'runbook must be deterministic');
  const h1 = deriveHandout(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  const h2 = deriveHandout(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  assert.equal(h1, h2, 'handout must be deterministic');
});

// DR-04: handout excludes facilitator, assistant, exit-criteria, if-stuck, if-ahead, buffer blocks, instructor materials
await check('DR-04 handout excludes facilitator/assistant/exit-criteria/if-stuck/if-ahead/buffer/instructor-materials', () => {
  const html = deriveHandout(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  // These should NOT appear in the handout
  assert.ok(!html.includes('진행자 안내'), 'facilitator text must be excluded');
  assert.ok(!html.includes('보조 지원'), 'assistant text must be excluded');
  assert.ok(!html.includes('노트 완성'), 'exit-criteria must be excluded');
  assert.ok(!html.includes('힌트 제공'), 'if-stuck must be excluded');
  assert.ok(!html.includes('일찍 끝나면 심화'), 'if-ahead must be excluded');
  assert.ok(!html.includes('여유 시간'), 'buffer activity must be excluded');
  assert.ok(!html.includes('진행자 매뉴얼'), 'instructor materials must be excluded');
  // These SHOULD appear
  assert.ok(html.includes('탐구 수행'), 'learner role must be included');
  assert.ok(html.includes('탐구 노트'), 'artifact must be included');
  assert.ok(html.includes('탐구 키트 (학생용)'), 'learner materials must be included');
  assert.ok(html.includes('학부모 안내문'), 'parent materials must be included');
});

// DR-05: no <script> and no external URLs in handout
await check('DR-05 handout has no <script> and no external http URLs', () => {
  const html = deriveHandout(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  assert.ok(!/<script/i.test(html), 'must not have <script> tags');
  assert.ok(!/https?:\/\//.test(html), 'must not have external URLs');
  const runbook = deriveRunbook(SAMPLE_OPS_HTML, SAMPLE_OPS_SHA);
  assert.ok(!/<script/i.test(runbook), 'runbook must not have <script> tags');
  assert.ok(!/https?:\/\//.test(runbook), 'runbook must not have external URLs');
});

// ── HTTP tests ────────────────────────────────────────────────────────────────

// DR-06: ops re-save → GET /plan?file=runbook returns stale:true
await check('DR-06 after derive, re-saving ops → GET /plan?file=runbook returns stale:true', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  const opsSha = await seedOps(db);

  // Derive runbook
  const deriveR = await req('POST', 'derive', { file: 'runbook' }, tok, db);
  assert.equal(deriveR.status, 201, `derive must return 201: ${JSON.stringify(deriveR.json)}`);

  // GET runbook before re-save: not stale
  const getR1 = await req('GET', `plan?file=runbook`, null, tok, db);
  assert.equal(getR1.status, 200);
  assert.equal(getR1.json.stale, false, 'runbook should not be stale before ops update');

  // Insert a new ops with different sha to simulate re-save
  db.prepare(
    `INSERT OR REPLACE INTO chalk_plan_files (cohort_id,course_id,ref_kind,ref,file,html,sha256,knowledge_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(COHORT, 'test-course', 'draft', '2', 'ops', SAMPLE_OPS_HTML + '<!-- updated -->', 'new-sha-after-update', 1, Date.now() + 1);

  // GET runbook after re-save: should be stale
  const getR2 = await req('GET', `plan?file=runbook`, null, tok, db);
  assert.equal(getR2.status, 200);
  assert.equal(getR2.json.stale, true, 'runbook should be stale after ops update');
});

// DR-07: ops missing → POST /derive 400 missing_ops
await check('DR-07 ops missing → POST /derive returns 400 missing_ops', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  const r = await req('POST', 'derive', { file: 'runbook' }, tok, db);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'missing_ops');
});

// DR-08: same ops sha → second POST /derive returns 200 (idempotent)
await check('DR-08 same ops sha → second POST /derive returns 200 (idempotent)', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  await seedOps(db);

  const r1 = await req('POST', 'derive', { file: 'handout' }, tok, db);
  assert.equal(r1.status, 201, `first derive must be 201: ${JSON.stringify(r1.json)}`);

  const r2 = await req('POST', 'derive', { file: 'handout' }, tok, db);
  assert.equal(r2.status, 200, `second derive with same sha must be 200: ${JSON.stringify(r2.json)}`);
  assert.equal(r2.json.status, 'unchanged');
});

// DR-09: student token → 401/403; wrong course → 404
await check('DR-09 student token → 401/403; wrong course → 404', async () => {
  const db = makeDb();
  const env = makeEnv(db);
  await seedOps(db);

  // Use student token (plain token, not issuer)
  const studentRes = await app.fetch(
    new Request(`https://service.test/admin/chalk/cohorts/${COHORT}/courses/test-course/derive`, {
      method: 'POST',
      headers: { authorization: 'Bearer student-invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'runbook' }),
    }),
    env, makeCtx(),
  );
  assert.ok([401, 403].includes(studentRes.status), `student token must get 401/403, got ${studentRes.status}`);

  // Wrong course
  const { tok } = await makeTok(db);
  const wrongCourse = await req('POST', `/admin/chalk/cohorts/${COHORT}/courses/nonexistent/derive`, { file: 'runbook' }, tok, db);
  assert.equal(wrongCourse.status, 404, `wrong course must get 404: ${JSON.stringify(wrongCourse.json)}`);
});

// DR-10: chalk_derive propagates missing_ops error to caller
await check('DR-10 derive missing_ops returns {error:"missing_ops"} body, not an exception', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  const r = await req('POST', 'derive', { file: 'runbook' }, tok, db);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'missing_ops', `must return code missing_ops: ${JSON.stringify(r.json)}`);
  assert.ok(typeof r.json.error === 'string', 'must return error message string');
});

// DR-11: PUT /plan file=runbook → 400
await check('DR-11 PUT /plan file=runbook → 400 invalid_request', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  const r = await req('PUT', 'plan', { html: '<html></html>', file: 'runbook', knowledge_version: 1, expected_revision: 1, request_id: 'req-dr11' }, tok, db);
  assert.equal(r.status, 400, `PUT /plan file=runbook must be 400: ${JSON.stringify(r.json)}`);
});

// DR-12: after deriving runbook, re-saving ops → PUT /plan response has derived_stale: ["runbook"]
await check('DR-12 re-saving ops after derive → derived_stale includes derived file names', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  await seedOps(db);

  // Derive runbook
  const deriveR = await req('POST', 'derive', { file: 'runbook' }, tok, db);
  assert.equal(deriveR.status, 201, `derive must succeed: ${JSON.stringify(deriveR.json)}`);

  // Re-save ops with different HTML (new sha)
  const newOpsHtml = SAMPLE_OPS_HTML.replace('탐구 활동', '탐구 활동 수정됨');
  const putR = await req('PUT', 'plan', {
    html: newOpsHtml,
    file: 'ops',
    knowledge_version: 1,
    expected_revision: 1,
    request_id: 'req-dr12-plan',
  }, tok, db);
  assert.equal(putR.status, 200, `PUT /plan ops must succeed: ${JSON.stringify(putR.json)}`);
  const stale = putR.json.derived_stale;
  assert.ok(Array.isArray(stale), `derived_stale must be array, got: ${JSON.stringify(stale)}`);
  assert.ok(stale.includes('runbook'), `derived_stale must include "runbook", got: ${JSON.stringify(stale)}`);
  assert.ok(!stale.includes('handout'), `derived_stale must not include "handout" (not yet derived), got: ${JSON.stringify(stale)}`);
});

// DR-13: no derived files → PUT /plan ops returns derived_stale: []
await check('DR-13 no derived files → PUT /plan ops returns derived_stale: []', async () => {
  const db = makeDb();
  const { tok } = await makeTok(db);
  await seedOps(db);

  // Save ops without any prior derive
  const newOpsHtml = SAMPLE_OPS_HTML.replace('탐구 활동', '탐구 활동 v2');
  const putR = await req('PUT', 'plan', {
    html: newOpsHtml,
    file: 'ops',
    knowledge_version: 1,
    expected_revision: 1,
    request_id: 'req-dr13-plan',
  }, tok, db);
  assert.equal(putR.status, 200, `PUT /plan ops must succeed: ${JSON.stringify(putR.json)}`);
  const stale = putR.json.derived_stale;
  assert.ok(Array.isArray(stale), `derived_stale must be array, got: ${JSON.stringify(stale)}`);
  assert.equal(stale.length, 0, `derived_stale must be empty when no derived files exist, got: ${JSON.stringify(stale)}`);
});

// DR-14: runbook from generateOpsSkeleton — 7-col thead and section h2 titles
await check('DR-14 runbook from generateOpsSkeleton has 7-col thead and h2 section titles', () => {
  const opsHtml = generateOpsSkeleton({
    course_id: 'test-course', knowledge_version: 1, format: 'track',
    family_session: false, duration_min: 240, break_min: 20, audience_tier: 'lv1',
  });
  const html = deriveRunbook(opsHtml, 'sha-dr14');

  // 7-col thead headers
  assert.ok(html.includes('시작–끝'), 'runbook must have 시작–끝 th');
  assert.ok(html.includes('블록'), 'runbook must have 블록 th');
  assert.ok(html.includes('메인 강사 할 일'), 'runbook must have 메인 강사 할 일 th');
  assert.ok(html.includes('학습자 할 일'), 'runbook must have 학습자 할 일 th');
  assert.ok(html.includes('보조 할 일'), 'runbook must have 보조 할 일 th');
  assert.ok(html.includes('의도 한 줄'), 'runbook must have 의도 한 줄 th');
  assert.ok(html.includes('연결 단계'), 'runbook must have 연결 단계 th');

  // Section h2 titles
  assert.ok(html.includes('<h2>운영 계획 개요</h2>'), 'runbook must have h2 운영 계획 개요');
  assert.ok(html.includes('<h2>운영 방식</h2>'), 'runbook must have h2 운영 방식');
  assert.ok(html.includes('<h2>최종 결과물</h2>'), 'runbook must have h2 최종 결과물');
  assert.ok(html.includes('<h2>사전 준비물</h2>'), 'runbook must have h2 사전 준비물');
  assert.ok(html.includes('<h2>진행 큐시트</h2>'), 'runbook must have h2 진행 큐시트');
  assert.ok(html.includes('<h2>위험·문제 대응</h2>'), 'runbook must have h2 위험·문제 대응');
  assert.ok(html.includes('<h2>동의</h2>'), 'runbook must have h2 동의');
  assert.ok(html.includes('<h2>사후 정리</h2>'), 'runbook must have h2 사후 정리');
});

// DR-15: handout from generateOpsSkeleton — no forbidden columns
await check('DR-15 handout from generateOpsSkeleton has no forbidden content', () => {
  const opsHtml = generateOpsSkeleton({
    course_id: 'test-course', knowledge_version: 1, format: 'track',
    family_session: false, duration_min: 240, break_min: 20, audience_tier: 'lv1',
  });
  const html = deriveHandout(opsHtml, 'sha-dr15');

  // Must NOT contain operations section content (배치비율, 운영진)
  assert.ok(!html.includes('data-chalk-section="operations"'), 'handout must not include operations section attribute');
  assert.ok(!html.includes('배치 비율'), 'handout must not include 배치 비율');
  // Must NOT contain facilitator role column
  assert.ok(!html.includes('data-chalk-role="facilitator"'), 'handout must not include facilitator role');
  // Must NOT contain exit-criteria/if-stuck/if-ahead/if-behind spans
  assert.ok(!html.includes('data-chalk-field="exit-criteria"'), 'handout must not include exit-criteria');
  assert.ok(!html.includes('data-chalk-field="if-stuck"'), 'handout must not include if-stuck');
  assert.ok(!html.includes('data-chalk-field="if-ahead"'), 'handout must not include if-ahead');
  assert.ok(!html.includes('data-chalk-field="if-behind"'), 'handout must not include if-behind');
  // Must NOT contain risks section
  assert.ok(!html.includes('data-chalk-section="risks"'), 'handout must not include risks section attribute');
  assert.ok(!html.includes('위험·문제 대응'), 'handout must not include 위험·문제 대응 section');
  // Must NOT contain intent column header
  assert.ok(!html.includes('의도 한 줄'), 'handout must not include 의도 한 줄 th');
  // Must contain learner column
  assert.ok(html.includes('학습자 할 일'), 'handout must include 학습자 할 일 th');
  // Must contain allowed sections
  assert.ok(html.includes('data-chalk-kind="handout"'), 'handout must have data-chalk-kind=handout');
});

// DR-16: no HTML comments, no "고정"/"자율" text, no duplicate h2 — skeleton + r6-style fixture
await check('DR-16 runbook/handout have no HTML comments, no authoring keywords, no duplicate h2', () => {
  // Test with generateOpsSkeleton output (contains authoring comments in ops HTML)
  const opsFromSkeleton = generateOpsSkeleton({
    course_id: 'test-course', knowledge_version: 1, format: 'track',
    family_session: false, duration_min: 240, break_min: 20, audience_tier: 'lv1',
  });
  // Test with an r6-style fixture that already has filled h2 in every section
  const opsR6Style = `<!DOCTYPE html>
<html lang="ko" data-chalk-plan="1" data-chalk-kind="ops">
<head>
  <meta charset="utf-8">
  <meta name="chalk:course" content="dr16-course">
  <meta name="chalk:knowledge-version" content="1">
  <meta name="chalk:format" content="track">
  <meta name="chalk:audience-tier" content="lv1">
  <meta name="chalk:family-session" content="false">
  <meta name="chalk:duration-min" content="235">
</head>
<body>
  <section data-chalk-section="header"><h2 data-chalk-fixed>운영 계획 개요</h2><p>일시: 2026-11-01</p></section>
  <section data-chalk-section="operations"><h2 data-chalk-fixed>운영 방식</h2><p>20명</p></section>
  <section data-chalk-section="outcomes"><h2 data-chalk-fixed>최종 결과물</h2><ol><li data-chalk-field="outcome">산출물</li></ol></section>
  <section data-chalk-section="materials"><h2 data-chalk-fixed>사전 준비물</h2><ol><li data-chalk-material="m-1" data-owner="learner">키트</li></ol></section>
  <section data-chalk-section="schedule">
    <h2 data-chalk-fixed>진행 큐시트</h2>
    <table>
      <thead><tr data-chalk-fixed><th>시작–끝</th><th>블록</th><th>메인 강사 할 일</th><th>학습자 할 일</th><th>보조·부모 할 일</th><th>의도 한 줄</th><th>연결 단계</th></tr></thead>
      <tbody>
        <tr data-chalk-block="block-1" data-chalk-step-ref="s-1" data-start="10:00" data-duration-min="110">
          <td data-chalk-fixed data-chalk-field="time-range">10:00–11:50</td>
          <td><span data-chalk-field="activity">탐구</span></td>
          <td data-chalk-role="facilitator"><span data-chalk-field="exit-criteria">완료</span></td>
          <td data-chalk-role="learner">활동</td>
          <td data-chalk-role="assistant">보조</td>
          <td data-chalk-field="intent">의도</td>
          <td data-chalk-field="step-ref-label">s-1</td>
        </tr>
        <tr data-chalk-block="break" data-chalk-block-kind="break" data-start="11:50" data-duration-min="15" data-chalk-fixed>
          <td data-chalk-fixed data-chalk-field="time-range">11:50–12:05</td>
          <td colspan="6" data-chalk-field="activity">휴식 15분</td>
        </tr>
      </tbody>
    </table>
  </section>
  <section data-chalk-section="risks"><h2 data-chalk-fixed>위험·문제 대응</h2>
    <ul>
      <li data-chalk-risk="ai-latency"><span data-chalk-field="first-line">대처1</span></li>
      <li data-chalk-risk="content-guard"><span data-chalk-field="first-line">대처2</span></li>
      <li data-chalk-risk="pace-gap"><span data-chalk-field="first-line">대처3</span></li>
      <li data-chalk-risk="parent-overreach"><span data-chalk-field="first-line">대처4</span></li>
      <li data-chalk-risk="overtime"><span data-chalk-field="first-line">대처5</span></li>
    </ul>
  </section>
  <section data-chalk-section="consent"><h2 data-chalk-fixed>동의</h2><ul><li>동의</li></ul></section>
  <section data-chalk-section="post-deliverables"><h2 data-chalk-fixed>사후 정리</h2><p>정리</p></section>
</body>
</html>`;

  for (const [label, opsHtml] of [['skeleton', opsFromSkeleton], ['r6-style', opsR6Style]]) {
    const rb = deriveRunbook(opsHtml, `sha-dr16-rb-${label}`);
    const ho = deriveHandout(opsHtml, `sha-dr16-ho-${label}`);

    for (const [kind, html] of [['runbook', rb], ['handout', ho]]) {
      // No HTML comments in derived output
      assert.ok(!html.includes('<!--'), `${label} ${kind} must not contain HTML comments`);
      // No authoring keywords
      assert.ok(!html.includes('고정:'), `${label} ${kind} must not contain "고정:" comment text`);
      assert.ok(!html.includes('자율:'), `${label} ${kind} must not contain "자율:" comment text`);

      // Each h2 title appears exactly once
      const h2Matches = [...html.matchAll(/<h2[^>]*>/gi)];
      const h2Texts = h2Matches.map((m) => {
        const startIdx = html.indexOf(m[0], m.index);
        const endIdx = html.indexOf('</h2>', startIdx);
        return html.slice(startIdx + m[0].length, endIdx);
      });
      const seen = new Set();
      for (const title of h2Texts) {
        const clean = title.replace(/<[^>]*>/g, '').trim();
        assert.ok(!seen.has(clean), `${label} ${kind} h2 "${clean}" must appear only once, got ${h2Texts.length} h2s`);
        seen.add(clean);
      }
    }
  }
});

console.log(`\nAll ${passed} tests passed.`);
