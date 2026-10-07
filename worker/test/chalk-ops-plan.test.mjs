// #1467 (E3-1) — ops plan brief, skeleton, parser, and PUT /plan tests.
// OP-01~OP-17: time_spec blocks, break_min, family session, parser, violations.
import './harness/loader.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { bootApp, createMockEnv, makeCtx, TEST_SECRET, COHORT } from './harness/index.mjs';

const { issueIssuer } = await import('../src/lib/tokens.ts');
const { listProfiles } = await import('../src/profiles/index.ts');
const { parsePlan } = await import('../src/lib/chalk-plan/parser.ts');

const app = await bootApp();

// ── Schema ────────────────────────────────────────────────────────────────────
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
const AUTHORING_SCHEMA = readFileSync(new URL('../migrations/0002-chalk-authoring.sql', import.meta.url), 'utf8');
const PLAN_SCHEMA = readFileSync(new URL('../migrations/0031-chalk-plan-files.sql', import.meta.url), 'utf8');
const TIER_DURATION_SCHEMA = readFileSync(new URL('../migrations/0035-chalk-course-inputs-tier-duration.sql', import.meta.url), 'utf8');
const FEEDBACK_SCHEMA = readFileSync(new URL('../migrations/0036-chalk-feedback.sql', import.meta.url), 'utf8');
const JUDGEMENTS_SCHEMA = readFileSync(new URL('../migrations/0037-chalk-judgements.sql', import.meta.url), 'utf8');

const GOAL_VOCAB = ['inquiry-skills', 'observation', 'creative-thinking'];
const COND_VOCAB = ['single-session', 'novice-learners'];
const PRIOR_VOCAB = ['novice', 'intermediate', 'any'];
const BASE_METHODS = [
  { id: 'm-discovery', best_for: ['inquiry-skills', 'observation'], weak_for: [], avoid_when: [], prior_knowledge: 'any', requires_guidance: false },
];

const profileId = listProfiles().find(p => p.session.cohort_id === COHORT)?.id;
assert.ok(profileId, 'profile not found for COHORT');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(KB_SCHEMA);
  db.exec(AUTHORING_SCHEMA);
  db.exec(PLAN_SCHEMA);
  db.exec(TIER_DURATION_SCHEMA);
  db.exec(FEEDBACK_SCHEMA);
  db.exec(JUDGEMENTS_SCHEMA);
  db.prepare(`INSERT INTO chalk_knowledge_versions VALUES(1,NULL,'vault-import',NULL,NULL,'test','tester',0,${BASE_METHODS.length + 3},'digest0')`).run();
  db.prepare('INSERT INTO chalk_knowledge_docs VALUES(?,?,?,?,?,?)').run(1, 'vocab:goal', 'vocab', JSON.stringify({ keys: GOAL_VOCAB.map(k => ({ key: k, label: k })) }), '', null);
  db.prepare('INSERT INTO chalk_knowledge_docs VALUES(?,?,?,?,?,?)').run(1, 'vocab:condition', 'vocab', JSON.stringify({ keys: COND_VOCAB.map(k => ({ key: k, label: k })) }), '', null);
  db.prepare('INSERT INTO chalk_knowledge_docs VALUES(?,?,?,?,?,?)').run(1, 'vocab:prior', 'vocab', JSON.stringify({ keys: PRIOR_VOCAB.map(k => ({ key: k, label: k })) }), '', null);
  for (const m of BASE_METHODS) {
    db.prepare('INSERT INTO chalk_knowledge_docs VALUES(?,?,?,?,?,?)').run(1, `method:${m.id}`, 'method', JSON.stringify(m), '', null);
  }
  return db;
}

function makeEnv(db) {
  const env = createMockEnv({ withSession: false });
  function makeStmt(sql) {
    let bindings = [];
    const stmt = {
      get _sql() { return sql; },
      get _bindings() { return bindings; },
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
        try {
          const r = db.prepare(stmt._sql).run(...stmt._bindings);
          results.push({ success: true, results: [], meta: { changes: Number(r.changes) } });
        } catch (e) {
          results.push({ success: false, error: String(e) });
        }
      }
      return results;
    },
  };
  return env;
}

const issuerTok = async () =>
  (await issueIssuer({ issuer: 'tester', scopes: [{ cohort: COHORT, profiles: [profileId] }] }, 4, TEST_SECRET)).token;

const base = `/admin/chalk/cohorts/${COHORT}/courses/test-course`;

async function req(method, path, body, credential, db) {
  const env = makeEnv(db ?? makeDb());
  const headers = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
  const init = body !== null ? { method, headers, body: JSON.stringify(body) } : { method, headers };
  const res = await app.fetch(
    new Request('https://service.test' + path, init),
    env, makeCtx(),
  );
  let json; try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

function seedDraft(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO authoring_drafts (cohort_id,course_id,owner_id,profile_id,revision,content_json,request_id,request_hash,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    COHORT, 'test-course', 'tester', '', 1,
    '{"schema":"hps-session-design/1","title":"","audience":"","duration_minutes":120,"objective":"","prerequisites":"","starter":"","steps":[]}',
    'req-seed-initial', 'hash-seed-initial', now,
  );
}

const VALID_INPUTS_WORKSHOP = {
  audience: '초등학교 3-4학년',
  assets: ['INTENT', 'VERIFY'],
  teaching_style: '탐구 기반',
  requirements: '',
  format: 'workshop',
  family_session: false,
  vocab: {
    goals: ['inquiry-skills', 'observation'],
    conditions: ['single-session'],
    learner_level: 'novice',
    has_guidance: false,
  },
  expected_revision: 1,
  request_id: 'req-inputs-workshop',
  profile_id: '',
};

const VALID_INPUTS_TRACK = {
  ...VALID_INPUTS_WORKSHOP,
  format: 'track',
  request_id: 'req-inputs-track',
};

let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

// ── OP-01 / OP-17: workshop brief without duration_min → blocks 5개, total_min=240 ──
await check('OP-01/OP-17 workshop brief no duration_min → 5 blocks in time_spec, total_min=240', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  const putR = await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_WORKSHOP, request_id: 'req-op01-inputs' }, tok, db);
  assert.equal(putR.status, 200, JSON.stringify(putR.json));

  const briefR = await req('GET', `${base}/brief?file=ops`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const ts = briefR.json.time_spec;
  assert.equal(ts.format, 'workshop', 'time_spec.format must be workshop');
  assert.equal(ts.total_min, 240, 'total_min must be 240 (default)');
  assert.ok(Array.isArray(ts.blocks) && ts.blocks.length === 5, `must have 5 blocks, got: ${JSON.stringify(ts.blocks)}`);
  assert.ok(Array.isArray(ts.core) && ts.core.length === 5, 'workshop core must have 5 entries');
  // Verify core and blocks have same keys
  const coreKeys = ts.core;
  const blockKeys = ts.blocks.map(b => b.key);
  assert.deepEqual(coreKeys, blockKeys, 'core keys must match blocks keys');
});

// ── OP-02: track brief → blocks=[block-1(110), break(20,kind:break), block-2(110)], total_min=240 ──
await check('OP-02 track brief → 3 blocks with correct min values, total_min=240', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  const putR = await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op02-inputs' }, tok, db);
  assert.equal(putR.status, 200, JSON.stringify(putR.json));

  const briefR = await req('GET', `${base}/brief?file=ops`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const ts = briefR.json.time_spec;
  assert.equal(ts.format, 'track');
  assert.equal(ts.total_min, 240);
  assert.equal(ts.blocks.length, 3, `must have 3 blocks: ${JSON.stringify(ts.blocks)}`);
  assert.equal(ts.blocks[0].key, 'block-1');
  assert.equal(ts.blocks[0].min, 110);
  assert.equal(ts.blocks[1].key, 'break');
  assert.equal(ts.blocks[1].min, 20);
  assert.equal(ts.blocks[1].kind, 'break');
  assert.equal(ts.blocks[2].key, 'block-2');
  assert.equal(ts.blocks[2].min, 110);
});

// ── OP-03: track + break_min=30 → break.min=30, total_min=250 ──
await check('OP-03 track brief with break_min=30 → break block min=30, total_min=250', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  const putR = await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op03-inputs' }, tok, db);
  assert.equal(putR.status, 200, JSON.stringify(putR.json));

  const briefR = await req('GET', `${base}/brief?file=ops&break_min=30`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const ts = briefR.json.time_spec;
  assert.equal(ts.blocks[1].min, 30, 'break block min must be 30');
  assert.equal(ts.total_min, 250, 'total_min must be 110+30+110=250');
});

// ── OP-04: break_min=4 → 400 ─────────────────────────────────────────────────
await check('OP-04 track brief with break_min=4 → 400 invalid_request', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op04-inputs' }, tok, db);

  const r = await req('GET', `${base}/brief?file=ops&break_min=4`, null, tok, db);
  assert.equal(r.status, 400, `must be 400, got ${r.status}: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.code, 'invalid_request');
});

// ── OP-05: break_min=61 → 400 ────────────────────────────────────────────────
await check('OP-05 track brief with break_min=61 → 400 invalid_request', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op05-inputs' }, tok, db);

  const r = await req('GET', `${base}/brief?file=ops&break_min=61`, null, tok, db);
  assert.equal(r.status, 400, `must be 400: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.code, 'invalid_request');
});

// ── OP-06: workshop + break_min → 400 break_min_track_only (correction #2) ──
await check('OP-06 workshop brief with break_min → 400 break_min_track_only', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_WORKSHOP, request_id: 'req-op06-inputs' }, tok, db);

  const r = await req('GET', `${base}/brief?file=ops&break_min=20`, null, tok, db);
  assert.equal(r.status, 400, `must be 400: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.code, 'break_min_track_only', `must be break_min_track_only: ${JSON.stringify(r.json)}`);
});

// ── OP-07: file=ops brief → data-chalk-kind="ops", 8 sections, 3 block rows (track) ──
await check('OP-07 ops brief skeleton_html: data-chalk-kind=ops, 8 sections, 3 blocks (track)', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op07-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const html = briefR.json.skeleton_html;
  assert.ok(html.includes('data-chalk-kind="ops"'), 'skeleton must have data-chalk-kind="ops"');
  const sectionMatches = [...html.matchAll(/data-chalk-section="/g)];
  assert.equal(sectionMatches.length, 8, `must have 8 sections, got ${sectionMatches.length}`);
  const blockMatches = [...html.matchAll(/data-chalk-block="/g)];
  assert.equal(blockMatches.length, 3, `track must have 3 block rows, got ${blockMatches.length}`);
});

// ── OP-08~OP-14: parsePlan direct tests (no DB/HTTP) ─────────────────────────

// Shared ops HTML samples
const OPS_TRACK_HTML = `<!DOCTYPE html>
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
        <td data-chalk-field="activity">탐구</td>
        <td data-chalk-field="asset">키트</td>
        <td data-chalk-field="artifact">노트</td>
        <td data-chalk-role="facilitator">진행</td>
        <td data-chalk-role="learner">활동</td>
        <td data-chalk-field="exit-criteria">완료</td>
        <td data-chalk-field="if-stuck">힌트</td>
      </tr>
      <tr data-chalk-block="break" data-chalk-block-kind="break" data-start="10:50" data-duration-min="20">
        <td data-chalk-field="activity">휴식</td>
      </tr>
      <tr data-chalk-block="block-2" data-chalk-step-ref="s-3" data-start="11:10" data-duration-min="110">
        <td data-chalk-field="activity">심화</td>
        <td data-chalk-field="asset">카드</td>
        <td data-chalk-field="artifact">발표지</td>
        <td data-chalk-role="facilitator">심화 진행</td>
        <td data-chalk-role="learner">심화 활동</td>
        <td data-chalk-field="exit-criteria">발표</td>
        <td data-chalk-field="if-stuck">질문</td>
      </tr>
    </table>
  </section>
  <section data-chalk-section="materials"><ul></ul></section>
  <section data-chalk-section="risks">
    <ul>
      <li data-chalk-risk="ai-latency"><span data-chalk-field="first-line">AI 응답 지연 시 대처</span></li>
      <li data-chalk-risk="content-guard"><span data-chalk-field="first-line">부적절 콘텐츠 차단</span></li>
      <li data-chalk-risk="pace-gap"><span data-chalk-field="first-line">속도 차이 대처</span></li>
      <li data-chalk-risk="parent-overreach"><span data-chalk-field="first-line">부모 과잉 개입 대처</span></li>
      <li data-chalk-risk="overtime"><span data-chalk-field="first-line">시간 초과 대처</span></li>
    </ul>
  </section>
  <section data-chalk-section="consent"><ul></ul></section>
  <section data-chalk-section="post-deliverables"><ul></ul></section>
</body>
</html>`;

// ops HTML with family_session=true (parent cells added)
const OPS_FAMILY_HTML = OPS_TRACK_HTML
  .replace('data-chalk-kind="ops"', 'data-chalk-kind="ops"')
  .replace('<meta name="chalk:family-session" content="false">', '<meta name="chalk:family-session" content="true">')
  .replace(
    /<tr data-chalk-block="block-1"[\s\S]*?<\/tr>/,
    `<tr data-chalk-block="block-1" data-chalk-step-ref="s-1" data-start="" data-duration-min="110">
        <td data-chalk-field="activity">탐구</td>
        <td data-chalk-field="asset">키트</td>
        <td data-chalk-field="artifact">노트</td>
        <td data-chalk-role="facilitator">진행</td>
        <td data-chalk-role="learner">활동</td>
        <td data-chalk-role="parent" data-chalk-parent-role="관찰자"></td>
        <td data-chalk-field="exit-criteria">완료</td>
        <td data-chalk-field="if-stuck">힌트</td>
      </tr>`,
  );

// ── OP-08: parsePlan ops HTML → blocks[] 3개, risks[] 5개 ────────────────────
await check('OP-08 parsePlan(ops) → blocks.length=3, risks.length=5', () => {
  const result = parsePlan(OPS_TRACK_HTML, 'ops');
  assert.ok(Array.isArray(result.blocks), 'blocks must be array');
  assert.equal(result.blocks.length, 3, `blocks must have 3 items: ${JSON.stringify(result.blocks?.map(b => b.key))}`);
  assert.ok(Array.isArray(result.risks), 'risks must be array');
  assert.equal(result.risks.length, 5, `risks must have 5 items: ${JSON.stringify(result.risks?.map(r => r.key))}`);
});

// ── OP-09: blocks 구조 — key/kind/durationMin/stepRefs/roles 확인 ─────────────
await check('OP-09 parsePlan(ops) block fields: key, kind, durationMin, stepRefs, roles', () => {
  const result = parsePlan(OPS_TRACK_HTML, 'ops');
  const b1 = result.blocks?.find(b => b.key === 'block-1');
  const brk = result.blocks?.find(b => b.key === 'break');
  const b2 = result.blocks?.find(b => b.key === 'block-2');

  assert.ok(b1, 'block-1 must exist');
  assert.equal(b1.kind, 'normal', 'block-1 kind must be normal');
  assert.equal(b1.durationMin, 110, 'block-1 durationMin must be 110');
  assert.deepEqual(b1.stepRefs, ['s-1', 's-2'], 'block-1 stepRefs must be [s-1, s-2]');
  assert.ok(b1.roles.facilitator !== undefined, 'block-1 must have facilitator');
  assert.ok(b1.roles.learner !== undefined, 'block-1 must have learner');

  assert.ok(brk, 'break block must exist');
  assert.equal(brk.kind, 'break', 'break kind must be break');
  assert.equal(brk.durationMin, 20, 'break durationMin must be 20');

  assert.ok(b2, 'block-2 must exist');
  assert.deepEqual(b2.stepRefs, ['s-3'], 'block-2 stepRefs must be [s-3]');
});

// ── OP-10: risks — 5 keys, firstLine 추출 ────────────────────────────────────
await check('OP-10 parsePlan(ops) risks: 5 keys, firstLine extracted', () => {
  const result = parsePlan(OPS_TRACK_HTML, 'ops');
  const riskKeys = result.risks?.map(r => r.key) ?? [];
  assert.deepEqual(
    riskKeys.sort(),
    ['ai-latency', 'content-guard', 'overtime', 'pace-gap', 'parent-overreach'],
    `risk keys mismatch: ${JSON.stringify(riskKeys)}`,
  );
  const aiRisk = result.risks?.find(r => r.key === 'ai-latency');
  assert.ok(aiRisk?.firstLine && aiRisk.firstLine.length > 0, 'ai-latency risk firstLine must be extracted');
});

// ── OP-11: missing risk key → spec.risk_missing ───────────────────────────────
await check('OP-11 parsePlan(ops) missing risk key → spec.risk_missing violation', () => {
  const htmlMissingRisk = OPS_TRACK_HTML.replace(
    '<li data-chalk-risk="overtime"><span data-chalk-field="first-line">시간 초과 대처</span></li>',
    '',
  );
  const result = parsePlan(htmlMissingRisk, 'ops');
  const v = result.violations.find(v => v.item === 'spec.risk_missing');
  assert.ok(v, `spec.risk_missing must be emitted, violations: ${JSON.stringify(result.violations.map(v => v.item))}`);
  assert.ok(v?.at?.field === 'overtime', `violation must point to overtime key, got: ${v?.at?.field}`);
});

// ── OP-12: no buffer block → spec.buffer_missing ──────────────────────────────
await check('OP-12 parsePlan(ops) no buffer block → spec.buffer_missing; adding buffer clears it', () => {
  // No buffer → violation
  const result = parsePlan(OPS_TRACK_HTML, 'ops');
  const v = result.violations.find(v => v.item === 'spec.buffer_missing');
  assert.ok(v, `spec.buffer_missing must be emitted when no buffer block, violations: ${JSON.stringify(result.violations.map(v => v.item))}`);

  // Adding a buffer block → no spec.buffer_missing
  const htmlWithBuffer = OPS_TRACK_HTML.replace(
    '</table>',
    `  <tr data-chalk-block="buffer" data-chalk-block-kind="buffer" data-start="" data-duration-min="10">
        <td data-chalk-field="activity">여유</td>
        <td data-chalk-role="facilitator"></td>
      </tr>
    </table>`,
  );
  const result2 = parsePlan(htmlWithBuffer, 'ops');
  const v2 = result2.violations.find(v => v.item === 'spec.buffer_missing');
  assert.ok(!v2, 'spec.buffer_missing must NOT be emitted when buffer block exists');
});

// ── OP-13: normal block with empty step-ref → spec.block_step_unlinked ────────
await check('OP-13 parsePlan(ops) normal block empty step-ref → spec.block_step_unlinked', () => {
  const htmlEmptyRef = OPS_TRACK_HTML
    .replace('data-chalk-step-ref="s-1 s-2"', 'data-chalk-step-ref=""')
    .replace('data-chalk-step-ref="s-3"', 'data-chalk-step-ref=""');
  const result = parsePlan(htmlEmptyRef, 'ops');
  const vs = result.violations.filter(v => v.item === 'spec.block_step_unlinked');
  assert.ok(vs.length >= 2, `both normal blocks with empty step-ref must emit spec.block_step_unlinked, got ${vs.length}: ${JSON.stringify(vs.map(v => v.at))}`);
});

// ── OP-14: family session skeleton has parent cell; non-family does not ────────
// (correction #4) — verified via parsePlan: parent role present ↔ family_session=true
await check('OP-14 family_session=true → parent role in blocks; false → no parent role', () => {
  // family = true → parent present in block-1
  const familyResult = parsePlan(OPS_FAMILY_HTML, 'ops');
  const fb1 = familyResult.blocks?.find(b => b.key === 'block-1');
  assert.ok(fb1?.roles.parent !== undefined, 'family session block must have parent role');

  // family = false → no parent in block
  const nonFamilyResult = parsePlan(OPS_TRACK_HTML, 'ops');
  const nfb1 = nonFamilyResult.blocks?.find(b => b.key === 'block-1');
  assert.ok(nfb1?.roles.parent === undefined, 'non-family block must NOT have parent role');
});

// ── OP-15: PUT /plan file=ops → no spec.section_missing in findings ───────────
// ops files don't have lesson sections (flow/support/etc.) — parser must not flag them
await check('OP-15 PUT /plan file=ops → no spec.section_missing in findings', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  const inputsR = await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op15-inputs' }, tok, db);
  assert.equal(inputsR.status, 200, `PUT /inputs must succeed: ${JSON.stringify(inputsR.json)}`);
  const revision = inputsR.json.revision;

  const putR = await req('PUT', `${base}/plan`, {
    html: OPS_TRACK_HTML,
    file: 'ops',
    knowledge_version: 1,
    expected_revision: revision,
    request_id: 'req-op15-plan',
  }, tok, db);
  assert.equal(putR.status, 200, `PUT /plan must succeed: ${JSON.stringify(putR.json)}`);
  const findings = putR.json.findings ?? [];
  const sectionMissing = findings.filter(f => f.item === 'spec.section_missing');
  assert.equal(sectionMissing.length, 0, `ops plan must not have spec.section_missing violations, got: ${JSON.stringify(sectionMissing)}`);
});

// ── OP-16: PUT /plan file=ops, no lesson row → skipped finding (correction #5) ──
await check('OP-16 PUT /plan file=ops with no lesson → skipped info finding emitted', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  const inputsR = await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op16-inputs' }, tok, db);
  assert.equal(inputsR.status, 200, `PUT /inputs must succeed: ${JSON.stringify(inputsR.json)}`);
  const revision = inputsR.json.revision;

  const putR = await req('PUT', `${base}/plan`, {
    html: OPS_TRACK_HTML,
    file: 'ops',
    knowledge_version: 1,
    expected_revision: revision,
    request_id: 'req-op16-plan',
  }, tok, db);
  assert.equal(putR.status, 200, `PUT /plan must succeed: ${JSON.stringify(putR.json)}`);
  const findings = putR.json.findings ?? [];
  const skipped = findings.find(f => f.skipped === true);
  assert.ok(skipped, `must include a skipped finding when no lesson exists, findings: ${JSON.stringify(findings)}`);
});

// ── OP-17: brief(file=ops) no profile_id → auto_materials=[] ─────────────────
await check('OP-17 brief(file=ops) no profile_id → auto_materials empty array', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, profile_id: '', request_id: 'req-op17-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  assert.ok(Array.isArray(briefR.json.auto_materials), 'auto_materials must be array');
  assert.equal(briefR.json.auto_materials.length, 0, `no profile → auto_materials must be empty, got: ${JSON.stringify(briefR.json.auto_materials)}`);
});

// ── OP-18: new skeleton has 8 h2 elements ────────────────────────────────────
await check('OP-18 ops brief skeleton_html: 8 h2 elements', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op18-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops&break_min=15`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const html = briefR.json.skeleton_html;
  const h2Matches = [...html.matchAll(/<h2[^>]*>/g)];
  assert.equal(h2Matches.length, 8, `must have 8 h2 elements, got ${h2Matches.length}`);
});

// ── OP-19: new skeleton schedule thead has 7 th columns ──────────────────────
await check('OP-19 ops brief skeleton_html: schedule thead has 7 th columns', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op19-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops&break_min=15`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const html = briefR.json.skeleton_html;
  const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/);
  assert.ok(theadMatch, 'skeleton must have a thead');
  const thMatches = [...theadMatch[1].matchAll(/<th>/g)];
  assert.equal(thMatches.length, 7, `thead must have 7 th columns, got ${thMatches.length}`);
});

// ── OP-20: parsePlan on new skeleton (empty) → buffer_missing + step_unlinked, no block_field_missing ─
// Correction (리드 승인: chalk-engineer, 단언 약화가 아니라 기대 정정):
// Previously passed because HTML comments in if-ahead/if-behind cells were read as values
// (suppressing buffer_missing). After fix to cleanText(), comments are stripped → cells are
// empty → buffer_missing fires. block_field_missing still must NOT fire (td elements exist).
await check('OP-20 빈 뼈대에서는 buffer_missing + step_unlinked 경고가 나온다', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, request_id: 'req-op20-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops&break_min=15`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const html = briefR.json.skeleton_html;

  const result = parsePlan(html, 'ops');
  const fieldMissing = result.violations.filter(v => v.item === 'spec.block_field_missing');
  assert.equal(fieldMissing.length, 0,
    `new skeleton must have no spec.block_field_missing, got: ${JSON.stringify(fieldMissing)}`);
  const unlinked = result.violations.filter(v => v.item === 'spec.block_step_unlinked');
  assert.ok(unlinked.length >= 2, `new skeleton must emit spec.block_step_unlinked for blank step-refs, got ${unlinked.length}`);
  // After fix: HTML comments in if-ahead/if-behind stripped → buffer_missing must fire
  const bufMissing = result.violations.filter(v => v.item === 'spec.buffer_missing');
  assert.ok(bufMissing.length > 0,
    `empty skeleton (comments stripped) must emit spec.buffer_missing, got: ${JSON.stringify(result.violations.map(v => v.item))}`);
});

// ── OP-21: ops-r4.html backward compat — old 5-section format still parses ───
// Inline copy of ops-r4.html (5-section format, family=false, 3 blocks, 5 risks, no block_field_missing)
const OPS_R4_HTML = `<!DOCTYPE html>
<html lang="ko" data-chalk-plan="1" data-chalk-kind="ops">
<head>
  <meta charset="utf-8">
  <meta name="chalk:course" content="review-1791287636">
  <meta name="chalk:knowledge-version" content="1">
  <meta name="chalk:format" content="track">
  <meta name="chalk:audience-tier" content="lv1">
  <meta name="chalk:family-session" content="false">
  <meta name="chalk:duration-min" content="235">
</head>
<body>
  <section data-chalk-section="schedule">
    <table>
      <tr data-chalk-block="block-1" data-chalk-step-ref="s-1 s-2 s-3 s-4" data-start="00:00" data-duration-min="110">
        <td data-chalk-field="activity">시연 1(흐릿한 요청) → 짝 활동 1(원한 것 적기) → 시연 2(세 칸 요청문) → 짝 활동 2(첫 시도)</td>
        <td data-chalk-field="asset">INTENT</td>
        <td data-chalk-field="artifact">세 칸 요청문 활동지(처음 요청문과 AI 답 붙임)</td>
        <td data-chalk-role="facilitator">시연하고 타이머를 맞춘다. 돌아다니며 질문만 하고 대신 입력하지 않는다.</td>
        <td data-chalk-role="learner">짝과 원하는 것을 적고, 세 칸 요청문을 번갈아 입력해 답을 활동지에 붙인다.</td>
        <td data-chalk-field="exit-criteria">모든 짝이 세 칸을 채운 요청문과 AI 답을 활동지에 붙였다.</td>
        <td data-chalk-field="if-stuck">"짝에게 먼저 말로 해 볼래?"라고 묻고, 그래도 막히면 선택지 두세 개 중에서 고르게 한다.</td>
      </tr>
      <tr data-chalk-block="break" data-chalk-block-kind="break" data-start="01:50" data-duration-min="15">
        <td data-chalk-field="activity">휴식 15분: 물 마시기, 화장실, 쉬기</td>
      </tr>
      <tr data-chalk-block="block-2" data-chalk-step-ref="s-5 s-6 s-7 s-8" data-start="02:05" data-duration-min="110">
        <td data-chalk-field="activity">시연 3(답 확인하기) → 짝 활동 3(확인표 만들기) → 짝 활동 4(고쳐 쓰기) → 나란히 보고 말하기</td>
        <td data-chalk-field="asset">VERIFY</td>
        <td data-chalk-field="artifact">맞음/다름 확인표, 처음과 고친 요청문·답을 나란히 붙인 활동지</td>
        <td data-chalk-role="facilitator">확인 방법을 시연하고, '다름' 칸을 가리키며 "어느 칸을 바꾸면 될까?"라고 묻는다. 열린 질문만 한다.</td>
        <td data-chalk-role="learner">답을 줄마다 맞음/다름으로 표시하고, 다른 칸을 고쳐 다시 입력한 뒤 두 결과를 비교해 짝에게 말한다.</td>
        <td data-chalk-field="exit-criteria">확인표와 나란히 붙인 활동지를 완성해 제출했다.</td>
        <td data-chalk-field="if-stuck">"원한 것과 다른 줄을 다시 읽어 볼까?"라고 묻는다.</td>
      </tr>
    </table>
  </section>
  <section data-chalk-section="materials">
    <ul>
      <li>세 칸 요청문 활동지와 확인표 (10팀 분량), 타이머, 연필</li>
      <li>AI를 입력할 기기와 시연용 화면 (10팀 분량)</li>
    </ul>
  </section>
  <section data-chalk-section="risks">
    <ul>
      <li data-chalk-risk="ai-latency"><span data-chalk-field="first-line">AI 답이 늦으면 기다리는 동안 짝과 다음 칸의 요청문을 먼저 말로 정해 둔다.</span></li>
      <li data-chalk-risk="content-guard"><span data-chalk-field="first-line">부적절한 답이 나오면 화면을 바로 닫고 다른 요청으로 바꾼다.</span></li>
      <li data-chalk-risk="pace-gap"><span data-chalk-field="first-line">빨리 끝낸 짝은 다른 그림 주제로 요청문을 한 번 더 써 보게 하고, 비교하거나 평가하지 않는다.</span></li>
      <li data-chalk-risk="parent-overreach"><span data-chalk-field="first-line">가족 세션이 아니므로 보호자가 들어오면 관찰만 부탁하고 아이 대신 입력하지 않도록 안내한다.</span></li>
      <li data-chalk-risk="overtime"><span data-chalk-field="first-line">단계가 5분 넘게 길어지면 확인표는 첫 세 줄까지만 표시하고 다음 단계로 넘어간다.</span></li>
    </ul>
  </section>
  <section data-chalk-section="consent">
    <ul>
      <li>수업에서 쓴 활동지와 AI 답을 수업 기록으로 보관하는 것에 대해 보호자 동의를 미리 받는다.</li>
    </ul>
  </section>
  <section data-chalk-section="post-deliverables">
    <ul>
      <li>처음 요청문과 고친 요청문, 각 AI 답을 나란히 붙인 활동지 1장</li>
      <li>AI 답에 맞음/다름을 표시한 확인표 1장</li>
    </ul>
  </section>
</body>
</html>`;

await check('OP-21 ops-r4.html backward compat: parsePlan → 3 blocks, 5 risks, no spec.block_field_missing', () => {
  const result = parsePlan(OPS_R4_HTML, 'ops');
  assert.equal(result.blocks?.length, 3, `r4 must have 3 blocks: ${JSON.stringify(result.blocks?.map(b => b.key))}`);
  assert.equal(result.risks?.length, 5, `r4 must have 5 risks: ${JSON.stringify(result.risks?.map(r => r.key))}`);
  const fieldMissing = result.violations.filter(v => v.item === 'spec.block_field_missing');
  assert.equal(fieldMissing.length, 0,
    `r4 must have no spec.block_field_missing, got: ${JSON.stringify(fieldMissing)}`);
});

// ── ops-r6.html inline fixture (comma step-refs, new 8-section format, break=15) ─
// Inline copy for backward-compat + comma step-ref tests (OP-22~25).
const OPS_R6_HTML = `<!DOCTYPE html>
<html lang="ko" data-chalk-plan="1" data-chalk-kind="ops">
<head>
  <meta charset="utf-8">
  <meta name="chalk:course" content="review-1791290281">
  <meta name="chalk:knowledge-version" content="1">
  <meta name="chalk:format" content="track">
  <meta name="chalk:audience-tier" content="lv1">
  <meta name="chalk:family-session" content="false">
  <meta name="chalk:duration-min" content="235">
</head>
<body>
  <section data-chalk-section="header"><h2 data-chalk-fixed>운영 계획 개요</h2></section>
  <section data-chalk-section="operations"><h2 data-chalk-fixed>운영 방식</h2></section>
  <section data-chalk-section="outcomes"><h2 data-chalk-fixed>최종 결과물</h2><ol></ol></section>
  <section data-chalk-section="materials"><h2 data-chalk-fixed>사전 준비물</h2><ol></ol></section>
  <section data-chalk-section="schedule">
    <h2 data-chalk-fixed>진행 큐시트</h2>
    <table>
      <thead><tr data-chalk-fixed><th>시작–끝</th><th>블록</th><th>메인 강사 할 일</th><th>학습자 할 일</th><th>보조·부모 할 일</th><th>의도 한 줄</th><th>연결 단계</th></tr></thead>
      <tbody>
        <tr data-chalk-block="block-1" data-chalk-step-ref="s-1, s-2, s-3, s-4, s-5" data-start="10:00" data-duration-min="110">
          <td data-chalk-fixed data-chalk-field="time-range">10:00–11:50</td>
          <td><strong>활동</strong> <span data-chalk-field="activity">목표 확인, 시연 1·2, 짝 활동 1·2</span></td>
          <td data-chalk-role="facilitator">진행
            <br><strong>종료 판정</strong> <span data-chalk-field="exit-criteria">완료</span>
            <br><strong>막힐 때</strong> <span data-chalk-field="if-stuck">힌트</span>
            <br><strong>시간이 남으면</strong> <span data-chalk-field="if-ahead"></span>
            <br><strong>시간이 모자라면</strong> <span data-chalk-field="if-behind"></span>
          </td>
          <td data-chalk-role="learner">활동</td>
          <td data-chalk-role="assistant">보조</td>
          <td data-chalk-field="intent">의도</td>
          <td data-chalk-field="step-ref-label">s-1, s-2, s-3, s-4, s-5</td>
        </tr>
        <tr data-chalk-block="break" data-chalk-block-kind="break" data-start="11:50" data-duration-min="15" data-chalk-fixed>
          <td data-chalk-fixed data-chalk-field="time-range">11:50–12:05</td>
          <td colspan="6" data-chalk-field="activity">휴식 15분</td>
        </tr>
        <tr data-chalk-block="block-2" data-chalk-step-ref="s-6, s-7, s-8, s-9, s-10" data-start="12:05" data-duration-min="110">
          <td data-chalk-fixed data-chalk-field="time-range">12:05–13:55</td>
          <td><strong>활동</strong> <span data-chalk-field="activity">심화</span></td>
          <td data-chalk-role="facilitator">심화 진행
            <br><strong>종료 판정</strong> <span data-chalk-field="exit-criteria">발표</span>
            <br><strong>막힐 때</strong> <span data-chalk-field="if-stuck">질문</span>
            <br><strong>시간이 남으면</strong> <span data-chalk-field="if-ahead"></span>
            <br><strong>시간이 모자라면</strong> <span data-chalk-field="if-behind"></span>
          </td>
          <td data-chalk-role="learner">활동</td>
          <td data-chalk-role="assistant">보조</td>
          <td data-chalk-field="intent">의도</td>
          <td data-chalk-field="step-ref-label">s-6, s-7, s-8, s-9, s-10</td>
        </tr>
      </tbody>
    </table>
  </section>
  <section data-chalk-section="risks">
    <h2 data-chalk-fixed>위험·문제 대응</h2>
    <ul>
      <li data-chalk-risk="ai-latency"><span data-chalk-field="first-line">대처</span></li>
      <li data-chalk-risk="content-guard"><span data-chalk-field="first-line">대처</span></li>
      <li data-chalk-risk="pace-gap"><span data-chalk-field="first-line">대처</span></li>
      <li data-chalk-risk="parent-overreach"><span data-chalk-field="first-line">대처</span></li>
      <li data-chalk-risk="overtime"><span data-chalk-field="first-line">대처</span></li>
    </ul>
  </section>
  <section data-chalk-section="consent"><h2 data-chalk-fixed>동의</h2><ul></ul></section>
  <section data-chalk-section="post-deliverables"><h2 data-chalk-fixed>사후 정리</h2></section>
</body>
</html>`;

// ── OP-22: ops-r6.html 쉼표 구분 step-ref → spec.block_step_unlinked 0건 ──────
await check('OP-22 parsePlan(ops-r6) comma step-refs → no spec.block_step_unlinked', () => {
  const result = parsePlan(OPS_R6_HTML, 'ops');
  const unlinked = result.violations.filter(v => v.item === 'spec.block_step_unlinked');
  assert.equal(unlinked.length, 0,
    `comma-separated step-refs must be parsed: ${JSON.stringify(unlinked)}`);
  // Verify step refs were actually parsed
  const b1 = result.blocks?.find(b => b.key === 'block-1');
  assert.deepEqual(b1?.stepRefs, ['s-1', 's-2', 's-3', 's-4', 's-5'],
    `block-1 stepRefs must be 5 items: ${JSON.stringify(b1?.stepRefs)}`);
});

// ── OP-23: ops-r6.html with no buffer (if-ahead/behind empty) → spec.buffer_missing ─
await check('OP-23 parsePlan(ops-r6 no buffer, empty if-ahead/behind) → spec.buffer_missing', () => {
  const result = parsePlan(OPS_R6_HTML, 'ops');
  const bufMissing = result.violations.filter(v => v.item === 'spec.buffer_missing');
  assert.equal(bufMissing.length, 1,
    `ops-r6 with empty if-ahead/behind must emit spec.buffer_missing, got: ${JSON.stringify(bufMissing)}`);
});

// ── OP-24: if-ahead filled in one block → no spec.buffer_missing ──────────────
await check('OP-24 parsePlan with if-ahead filled → no spec.buffer_missing', () => {
  const htmlWithBuffer = OPS_R6_HTML.replace(
    '<span data-chalk-field="if-ahead"></span>\n            <br><strong>시간이 모자라면</strong> <span data-chalk-field="if-behind"></span>\n          </td>\n          <td data-chalk-role="learner">활동</td>\n          <td data-chalk-role="assistant">보조</td>\n          <td data-chalk-field="intent">의도</td>\n          <td data-chalk-field="step-ref-label">s-1',
    '<span data-chalk-field="if-ahead">빨리 끝나면 두 번째 주제로 해 보기</span>\n            <br><strong>시간이 모자라면</strong> <span data-chalk-field="if-behind"></span>\n          </td>\n          <td data-chalk-role="learner">활동</td>\n          <td data-chalk-role="assistant">보조</td>\n          <td data-chalk-field="intent">의도</td>\n          <td data-chalk-field="step-ref-label">s-1',
  );
  const result = parsePlan(htmlWithBuffer, 'ops');
  const bufMissing = result.violations.filter(v => v.item === 'spec.buffer_missing');
  assert.equal(bufMissing.length, 0,
    `if-ahead filled → spec.buffer_missing must NOT fire: ${JSON.stringify(bufMissing)}`);
});

// ── OP-25: buffer block present → no spec.buffer_missing ──────────────────────
await check('OP-25 parsePlan with buffer block → no spec.buffer_missing', () => {
  const htmlWithBufferBlock = OPS_R6_HTML.replace(
    '</tbody>',
    `  <tr data-chalk-block="buffer" data-chalk-block-kind="buffer" data-start="" data-duration-min="5">
        <td data-chalk-role="facilitator">여유</td>
      </tr>
    </tbody>`,
  );
  const result = parsePlan(htmlWithBufferBlock, 'ops');
  const bufMissing = result.violations.filter(v => v.item === 'spec.buffer_missing');
  assert.equal(bufMissing.length, 0,
    `buffer block present → spec.buffer_missing must NOT fire: ${JSON.stringify(bufMissing)}`);
});

// ── OP-12 회귀: 기존 OP-12 buffer_missing 단언이 약해지지 않음 (⑭) ──────────────
// OPS_TRACK_HTML에는 if-ahead/if-behind 칸이 없으므로 buffer_missing 이 그대로 발생해야 한다.
await check('OP-12b OP-12 regression: OPS_TRACK_HTML no if-ahead/behind → spec.buffer_missing still fires', () => {
  const result = parsePlan(OPS_TRACK_HTML, 'ops');
  const bufMissing = result.violations.filter(v => v.item === 'spec.buffer_missing');
  assert.equal(bufMissing.length, 1,
    `OPS_TRACK_HTML still must emit spec.buffer_missing (⑭): ${JSON.stringify(bufMissing)}`);
});

// ── OP-26: brief(file=ops) with profile_id → auto_materials has auto-token + auto-studio ──
await check('OP-26 brief(file=ops) with profile_id → auto_materials includes auto-token and auto-studio', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, profile_id: profileId, request_id: 'req-op26-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const ams = briefR.json.auto_materials;
  assert.ok(Array.isArray(ams) && ams.length > 0, `auto_materials must be non-empty with a profile, got: ${JSON.stringify(ams)}`);
  assert.ok(ams.some(m => m.id === 'auto-token'), `auto-token must be present, got ids: ${JSON.stringify(ams.map(m => m.id))}`);
  assert.ok(ams.some(m => m.id === 'auto-studio'), `auto-studio must be present, got ids: ${JSON.stringify(ams.map(m => m.id))}`);
});

// ── OP-27: brief(file=ops) no profile_id → all 4 keys in consent_pending ────
await check('OP-27 brief(file=ops) no profile_id → consent_pending has all 4 keys', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, profile_id: '', request_id: 'req-op27-inputs' }, tok, db);

  const briefR = await req('GET', `${base}/brief?file=ops`, null, tok, db);
  assert.equal(briefR.status, 200, JSON.stringify(briefR.json));
  const pending = briefR.json.consent_pending;
  assert.ok(Array.isArray(pending), 'consent_pending must be array');
  const REQUIRED = ['model', 'account', 'log-collection', 'publishing'];
  for (const key of REQUIRED) {
    assert.ok(pending.includes(key), `consent_pending must include ${key}, got: ${JSON.stringify(pending)}`);
  }
});

// ── OP-28: PUT /plan ops with stale auto materials → spec.auto_material_stale warn ──
await check('OP-28 PUT /plan ops stale auto materials → spec.auto_material_stale warning', async () => {
  const db = makeDb();
  seedDraft(db);
  const tok = await issuerTok();
  const inputsR = await req('PUT', `${base}/inputs`, { ...VALID_INPUTS_TRACK, profile_id: profileId, request_id: 'req-op28-inputs' }, tok, db);
  assert.equal(inputsR.status, 200, `PUT /inputs must succeed: ${JSON.stringify(inputsR.json)}`);
  const revision = inputsR.json.revision;

  // Replace the empty materials section with a stale set: extra auto-skill-quiz
  // that the real profile (no skills) would not produce → diffAutoMaterials returns true.
  const staleHtml = OPS_TRACK_HTML.replace(
    '<section data-chalk-section="materials"><ul></ul></section>',
    `<section data-chalk-section="materials"><ul>
      <li data-chalk-material="auto-token" data-kind="account" data-owner="instructor" data-auto="true">학생 토큰</li>
      <li data-chalk-material="auto-skill-quiz" data-kind="digital" data-owner="instructor" data-auto="true">스킬 quiz</li>
      <li data-chalk-material="auto-studio" data-kind="account" data-owner="learner" data-auto="true">Studio 설치</li>
    </ul></section>`,
  );

  const putR = await req('PUT', `${base}/plan`, {
    html: staleHtml,
    file: 'ops',
    knowledge_version: 1,
    expected_revision: revision,
    request_id: 'req-op28-plan',
  }, tok, db);
  assert.equal(putR.status, 200, `PUT /plan must succeed: ${JSON.stringify(putR.json)}`);
  const findings = putR.json.findings ?? [];
  const stale = findings.find(f => f.item === 'spec.auto_material_stale');
  assert.ok(stale, `spec.auto_material_stale must be emitted when stored auto ids differ from live, findings: ${JSON.stringify(findings.map(f => f.item))}`);
  assert.equal(stale.severity, 'warn', 'spec.auto_material_stale must be warn severity');
});

// ── OP-29: parsePlan material missing kind/owner → violations ─────────────────
await check('OP-29 parsePlan ops material missing kind/owner → spec.material_kind_missing + spec.material_owner_missing', () => {
  const htmlBadMaterial = OPS_TRACK_HTML.replace(
    '<section data-chalk-section="materials"><ul></ul></section>',
    `<section data-chalk-section="materials"><ul>
      <li data-chalk-material="m-bad">준비물 (kind/owner 없음)</li>
    </ul></section>`,
  );
  const result = parsePlan(htmlBadMaterial, 'ops');
  const kindV = result.violations.find(v => v.item === 'spec.material_kind_missing');
  const ownerV = result.violations.find(v => v.item === 'spec.material_owner_missing');
  assert.ok(kindV, `spec.material_kind_missing must be emitted, violations: ${JSON.stringify(result.violations.map(v => v.item))}`);
  assert.ok(ownerV, `spec.material_owner_missing must be emitted, violations: ${JSON.stringify(result.violations.map(v => v.item))}`);
});

// ── Helper: build consent section html with given keys present ─────────────────
const ALL_CONSENT_KEYS = ['model', 'account', 'log-collection', 'publishing'];
function consentSectionWith(keys) {
  const lis = keys.map(k => `<li data-chalk-consent="${k}">동의 텍스트 ${k}</li>`).join('\n      ');
  return `<section data-chalk-section="consent"><ul>\n      ${lis}\n    </ul></section>`;
}
function opsHtmlWithConsent(keys) {
  return OPS_TRACK_HTML.replace(
    '<section data-chalk-section="consent"><ul></ul></section>',
    consentSectionWith(keys),
  );
}

// ── OP-30: each required key missing one at a time → exactly that key spec.consent_missing ──
for (const missingKey of ALL_CONSENT_KEYS) {
  const presentKeys = ALL_CONSENT_KEYS.filter(k => k !== missingKey);
  await check(`OP-30 parsePlan ops consent missing ${missingKey} → spec.consent_missing for ${missingKey} only`, () => {
    const result = parsePlan(opsHtmlWithConsent(presentKeys), 'ops');
    const consentViolations = result.violations.filter(v => v.item === 'spec.consent_missing');
    assert.strictEqual(consentViolations.length, 1,
      `must emit exactly 1 spec.consent_missing for missing ${missingKey}, got ${consentViolations.length}: ${JSON.stringify(consentViolations)}`);
    assert.strictEqual(consentViolations[0].at?.field, missingKey,
      `violation must name ${missingKey}, got: ${JSON.stringify(consentViolations[0].at)}`);
  });
}

// ── OP-31: all four keys present → no spec.consent_missing ─────────────────────
await check('OP-31 parsePlan ops consent all four keys present → no spec.consent_missing', () => {
  const result = parsePlan(opsHtmlWithConsent(ALL_CONSENT_KEYS), 'ops');
  const consentViolations = result.violations.filter(v => v.item === 'spec.consent_missing');
  assert.strictEqual(consentViolations.length, 0,
    `must emit 0 spec.consent_missing when all four keys present, got: ${JSON.stringify(consentViolations)}`);
});

// ── OP-32: pending li counts as present (no consent_missing), but consent_pending fires ──
await check('OP-32 parsePlan ops consent pending li → no consent_missing, consent_pending emitted', () => {
  const pendingHtml = OPS_TRACK_HTML.replace(
    '<section data-chalk-section="consent"><ul></ul></section>',
    `<section data-chalk-section="consent"><ul>
      <li data-chalk-consent="model" data-auto="pending"></li>
      <li data-chalk-consent="account">계정 동의</li>
      <li data-chalk-consent="log-collection">기록 수집 동의</li>
      <li data-chalk-consent="publishing">결과물 공개 동의</li>
    </ul></section>`,
  );
  const result = parsePlan(pendingHtml, 'ops');
  const consentMissing = result.violations.filter(v => v.item === 'spec.consent_missing');
  assert.strictEqual(consentMissing.length, 0,
    `pending li must not trigger spec.consent_missing, got: ${JSON.stringify(consentMissing)}`);
  const consentItems = result.consentItems ?? [];
  const pendingItem = consentItems.find(i => i.key === 'model');
  assert.ok(pendingItem, 'model consent item must exist');
  assert.strictEqual(pendingItem.auto, true, 'pending item must have auto=true');
  assert.strictEqual(pendingItem.text, null, 'pending item text must be null');
});

console.log(`\n${passed} tests passed`);
