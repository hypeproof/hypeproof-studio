// Controls for the automatic route's casebook gate (casebook-gate.mjs, owner decision 2026-11-18:
// only automatic items gate). No GitHub or git calls.
//   node --test scripts/release/test/casebook-gate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {KIT_SCHEMA} from '../auto-release-record.mjs';
import {autoGates, loadPolicy} from '../auto-release.mjs';
import {loadCasebook, validateCasebook} from '../casebook.mjs';
import {ACCEPTANCE_CHECKS, autoCasebook, checklistBody, checklistFailures, checklistTitle, gateProblems, parseEvidence, splitByGate} from '../casebook-gate.mjs';
import {decide, p0CaseIds} from '../publish-gate.mjs';

const CAND = 'c'.repeat(40);
const HEAD = 'a'.repeat(40);
const HEAD_DATE = '2026-11-18T07:48:00Z';
const PLATFORMS = ['darwin-arm64', 'win32-x64'];
const policy = loadPolicy();

const c = (id, gate, extra = {}) => ({id, priority: 'P0', title: `${id} title`, ...(gate ? {gate} : {}), ...extra});
const CASES = [
  c('BB-017', 'auto', {gate_evidence: ['acceptance:public-classroom']}),
  c('BB-016', 'auto', {gate_evidence: ['kit:s16']}),
  c('BB-022', 'after-publish'),
  c('BB-013', 'human'),
];
// The receipt shape of unified-acceptance.json on v2026.1118.0-rc.1 (hps-unified-acceptance/1), trimmed.
const receipt = (platform, over = {}) => ({schema: 'hps-unified-acceptance/1', status: 'PASS', sourceSha: CAND, platform,
  activities: [{kind: 'trial', result: {status: 'PASS'}}, {kind: 'classroom', result: {status: 'PASS'}}],
  publicService: {status: 'PASS', activities: [{kind: 'trial', status: 'PASS', fileOperations: true}, {kind: 'classroom', status: 'PASS', fileOperations: true}]},
  ...over});
const RECEIPTS = PLATFORMS.map(p => receipt(p));
const kit = (scenarios, candidate = CAND, user = 'hypeproof-agent[bot]') => ({user, created_at: '2026-11-18T09:00:00Z', url: 'k',
  body: '```json\n' + JSON.stringify({schema: KIT_SCHEMA, candidate, scenarios}) + '\n```'});
const run = (rows, {head = HEAD, pr = 4339, user = 'hypeproof-agent[bot]', association = 'NONE'} = {}) => ({user, association, created_at: '2026-11-18T10:00:00Z', url: 'r',
  body: '```json\n' + JSON.stringify({schema: 'hps-blackbox-run/1', pr, head_sha: head, rc_tag: 'v2026.1118.0-rc.1', tester: {kind: 'human', name: 't'},
    started_at: '2026-11-18T19:00:00+09:00', finished_at: '2026-11-18T19:30:00+09:00',
    cases: rows.map(r => ({priority: 'P0', attempts: r.result === 'FAIL' ? 2 : 1, ...(r.result === 'BLOCKED' ? {} : {screenshot: `${r.id}.png`}), ...(r.result === 'PASS' ? {} : {note: 'seen'}), ...r})),
    p0_verdict: rows.some(r => r.result === 'FAIL') ? '승인 보류 권장' : 'P0 실패 없음'}) + '\n```'});
const P0 = CASES.map(x => x.id);
const gate = (over = {}) => autoCasebook({number: 4339, head: HEAD, headDate: HEAD_DATE, candidate: CAND, p0: P0, cases: CASES,
  comments: [kit({s16: 'PASS'})], receipts: RECEIPTS, platforms: PLATFORMS, reporters: policy.evidenceReporters, ...over});

test('positive control: every auto case has its evidence; after-publish and human cases do not hold', () => {
  const v = gate();
  assert.equal(v.status, 'PASS', v.reasons.join('; '));
  assert.deepEqual(v.summary.auto, ['BB-017', 'BB-016']);
  assert.deepEqual(v.summary.after_publish, ['BB-022']);
  assert.deepEqual(v.summary.human, ['BB-013']);
  assert.match(v.line, /1 after-publish and 1 human case\(s\) go to the post-release checklist/);
});

test('negative control: an auto case without evidence still waits', () => {
  for (const [why, over] of [
    ['no acceptance at all', {receipts: null}],
    ['acceptance for another candidate', {receipts: PLATFORMS.map(p => receipt(p, {sourceSha: 'd'.repeat(40)}))}],
    ['one platform missing', {receipts: [receipt('darwin-arm64')]}],
    ['receipt without the classroom activity', {receipts: PLATFORMS.map(p => receipt(p, {publicService: {activities: [{kind: 'trial', status: 'PASS'}]}}))}],
    ['no kit record', {comments: []}],
    ['kit record for another candidate', {comments: [kit({s16: 'PASS'}, 'd'.repeat(40))]}],
    ['kit record from an untrusted reporter', {comments: [kit({s16: 'PASS'}, CAND, 'someone')]}],
    ['kit record without the scenario', {comments: [kit({s1: 'PASS'})]}],
  ]) {
    const v = gate(over);
    assert.equal(v.status, 'WAIT', why);
    assert.equal(v.ok, false, why);
    assert.match(v.reasons.join(';'), /no evidence yet for auto/, why);
  }
});

test('an auto case declared with no usable evidence waits forever, never passes', () => {
  const cases = [c('BB-017', 'auto', {gate_evidence: []})];
  assert.equal(autoCasebook({number: 4339, head: HEAD, candidate: CAND, p0: ['BB-017'], cases, receipts: RECEIPTS, platforms: PLATFORMS}).status, 'WAIT');
});

test('an observed failure is FAIL: acceptance, kit, or any P0 FAIL row at the head whatever its gate', () => {
  assert.equal(gate({receipts: [receipt('darwin-arm64', {status: 'FAIL'}), receipt('win32-x64')]}).status, 'FAIL');
  assert.equal(gate({comments: [kit({s16: 'FAIL'})]}).status, 'FAIL');
  const human = gate({comments: [kit({s16: 'PASS'}), run([{id: 'BB-013', result: 'FAIL'}])]});
  assert.equal(human.status, 'FAIL');
  assert.deepEqual(human.summary.fail_ids, ['BB-013']);
  // a FAIL row for another head or from a stranger is not evidence (and so not a FAIL)
  assert.equal(gate({comments: [kit({s16: 'PASS'}), run([{id: 'BB-013', result: 'FAIL'}], {head: 'e'.repeat(40)})]}).status, 'PASS');
  assert.equal(gate({comments: [kit({s16: 'PASS'}), run([{id: 'BB-013', result: 'FAIL'}], {user: 'stranger'})]}).status, 'PASS');
});

test('a trusted run PASS at the head covers an auto case; BLOCKED does not', () => {
  assert.equal(gate({receipts: null, comments: [kit({s16: 'PASS'}), run([{id: 'BB-017', result: 'PASS'}])]}).status, 'PASS');
  assert.equal(gate({receipts: null, comments: [kit({s16: 'PASS'}), run([{id: 'BB-017', result: 'BLOCKED'}])]}).status, 'WAIT');
});

test('a P0 case the current casebook does not classify holds the release (fail closed)', () => {
  const v = gate({p0: [...P0, 'BB-999']});
  assert.equal(v.status, 'WAIT');
  assert.match(v.reasons.join(';'), /no gate in the current casebook for BB-999/);
});

test('gate fields are validated; every desktop P0 needs one', () => {
  assert.match(gateProblems(c('BB-001'), true).join(), /needs gate/);
  assert.deepEqual(gateProblems(c('BB-001'), false), []);
  assert.match(gateProblems(c('BB-001', 'sometimes'), true).join(), /gate must be one of/);
  assert.match(gateProblems(c('BB-001', 'auto'), true).join(), /needs gate_evidence/);
  assert.match(gateProblems(c('BB-001', 'auto', {gate_evidence: ['acceptance:unknown']}), true).join(), /unknown gate_evidence/);
  assert.match(gateProblems(c('BB-001', 'human', {gate_evidence: ['run']}), true).join(), /only for gate auto/);
  assert.deepEqual(gateProblems(c('BB-001', 'auto', {gate_evidence: ['acceptance:public-classroom', 'kit:s16', 'run']}), true), []);
  assert.deepEqual(parseEvidence('kit:s16'), {kind: 'kit', scenario: 's16'});
  assert.equal(parseEvidence('kit:16'), null);
  assert.deepEqual(Object.keys(ACCEPTANCE_CHECKS).sort(), ['activity-classroom', 'activity-trial', 'public-classroom', 'public-trial']);
});

test('the real casebook: every desktop P0 has a gate, and the mapping is the reviewed one', () => {
  const {cases, journeys} = loadCasebook();
  assert.deepEqual(validateCasebook({cases, journeys}), []);
  const p0 = p0CaseIds(cases);
  const split = splitByGate(p0, cases);
  assert.deepEqual(split.unclassified, []);
  assert.deepEqual(split.auto.map(a => a.id), ['BB-017']);
  assert.deepEqual(split.afterPublish.sort(), ['BB-022', 'BB-028', 'BB-040']);
  assert.equal(split.human.length, p0.length - 4);
  // A missing gate on a desktop P0 is a casebook error, so a new P0 case cannot silently skip the decision.
  const broken = cases.map(x => (x.id === 'BB-017' ? {...x, gate: undefined, gate_evidence: undefined} : x));
  assert.match(validateCasebook({cases: broken, journeys}).join(), /BB-017: a desktop P0 case needs gate/);
  // The v2026.1118.0-rc.1 receipts (both platforms PASS, classroom on the public Service) satisfy BB-017.
  const v = autoCasebook({number: 4339, head: HEAD, headDate: HEAD_DATE, candidate: CAND, p0, cases, receipts: RECEIPTS, platforms: PLATFORMS, reporters: policy.evidenceReporters});
  assert.equal(v.status, 'PASS', v.reasons.join('; '));
});

test('publish gate: the auto route applies the auto casebook; the approval route still needs every P0 case', () => {
  const record = autoGates({
    enabled: true, candidate: CAND, rcTag: 'v2026.1118.0-rc.1',
    promotion: {pr: {number: 4339, head: HEAD, headDate: HEAD_DATE, headRef: 'release/v2026.1118.0', labels: ['release'], reviews: [], comments: []}, mergeState: 'CLEAN', p0: []},
    structural: {allow: true, rcTag: 'v2026.1118.0-rc.1'}, acceptance: {receipts: RECEIPTS}, platforms: PLATFORMS,
    macReceipt: {notarization: {status: 'Accepted', submission_id: 'x'}}, blockers: {allow: true, blockers: [], reasons: []},
    live: 'proceed', comments: [], casebookCases: CASES,
  }, policy);
  const gates = record.gates.map(({id}) => ({id, status: 'PASS'}));
  const body = '```json\n' + JSON.stringify({schema: 'hps-auto-release/1', pr: 4339, head_sha: HEAD, candidate: CAND, gates}) + '\n```';
  const auto = {user: 'hypeproof-org-lab-bot[bot]', association: 'NONE', created_at: '2026-11-18T11:00:00Z', body, url: 'a'};
  const pr = comments => ({number: 4339, labels: ['release'], head: HEAD, headDate: HEAD_DATE, reviews: [], comments});
  const base = {tag: 'v2026.1118.0', tagSha: CAND, rcTags: [{name: 'v2026.1118.0-rc.1', sha: CAND}], p0: P0, auto: {enabled: true, pipeline: policy.pipeline}};
  const inputs = {cases: CASES, receipts: RECEIPTS, platforms: PLATFORMS, reporters: policy.evidenceReporters};
  const ok = decide({...base, releasePrs: [pr([auto, kit({s16: 'PASS'})])], autoCasebook: inputs});
  assert.equal(ok.allow, true, ok.reasons.join('; '));
  assert.equal(ok.route, 'auto');
  assert.match(ok.notesLine, /automatic route; 2 auto P0 case\(s\) PASS/);
  // negative controls: no evidence for an auto case, the inputs not read, a human P0 FAIL at the head
  assert.equal(decide({...base, releasePrs: [pr([auto])], autoCasebook: inputs}).allow, false);
  const unread = decide({...base, releasePrs: [pr([auto, kit({s16: 'PASS'})])]});
  assert.equal(unread.allow, false);
  assert.match(unread.reasons.join(';'), /casebook gate fields were not read/);
  assert.equal(decide({...base, releasePrs: [pr([auto, kit({s16: 'PASS'}), run([{id: 'BB-013', result: 'FAIL'}])])], autoCasebook: inputs}).allow, false);
  // the approval route is unchanged: a writer's approval with no casebook run is refused
  const approved = decide({...base, auto: {enabled: false, pipeline: policy.pipeline}, writers: new Set(['jayleekr']),
    releasePrs: [{...pr([kit({s16: 'PASS'})]), reviews: [{user: 'jayleekr', state: 'APPROVED', commit: HEAD}]}], autoCasebook: inputs});
  assert.equal(approved.allow, false);
  assert.match(approved.reasons.join(';'), /casebook not run at the head/);
});

test('autoGates: the casebook gate follows the auto casebook', () => {
  const f = (over = {}) => ({
    enabled: true, candidate: CAND, rcTag: 'v2026.1118.0-rc.1',
    promotion: {pr: {number: 4339, head: HEAD, headDate: HEAD_DATE, headRef: 'release/v2026.1118.0', labels: ['release'], reviews: [], comments: over.comments ?? [kit({s16: 'PASS'})]}, mergeState: 'CLEAN', p0: P0},
    structural: {allow: true, rcTag: 'v2026.1118.0-rc.1'}, acceptance: {receipts: RECEIPTS}, platforms: PLATFORMS,
    macReceipt: {notarization: {status: 'Accepted', submission_id: 'x'}}, blockers: {allow: true, blockers: [], reasons: []},
    live: 'proceed', comments: [], casebookCases: CASES, ...over,
  });
  const st = v => v.gates.find(g => g.id === 'casebook').status;
  assert.equal(st(autoGates(f(), policy)), 'PASS');
  assert.equal(st(autoGates(f({acceptance: null}), policy)), 'WAIT');
  assert.equal(st(autoGates(f({comments: [kit({s16: 'PASS'}), run([{id: 'BB-022', result: 'FAIL'}])]}), policy)), 'FAIL');
  assert.equal(st(autoGates(f({casebookCases: undefined}), policy)), 'FAIL');
});

test('post-release checklist: title, body and FAIL detection', () => {
  assert.equal(checklistTitle('v2026.1118.0'), 'v2026.1118.0 출시 후 점검');
  const split = splitByGate(P0, CASES);
  const body = checklistBody({tag: 'v2026.1118.0', pr: 4339, candidate: CAND, cases: CASES, split, team: ['jayleekr', 'TJ-kr'], runUrl: 'r'});
  assert.match(body, /- \[ \] BB-022 — BB-022 title/);
  assert.match(body, /- \[ \] BB-013 — BB-013 title/);
  assert.doesNotMatch(body, /BB-017/);
  assert.match(body, /@jayleekr @TJ-kr/);
  assert.match(body, /"schema": "hps-release-checklist\/1"/);
  assert.match(body, /"pr": 4339/);
  // a trusted run on the published release (any head) with a FAIL row is reported; a stranger's is not
  assert.deepEqual(checklistFailures({pr: 4339, comments: [run([{id: 'BB-022', result: 'FAIL'}, {id: 'BB-013', result: 'PASS'}], {head: 'f'.repeat(40)})]}), ['BB-022']);
  assert.deepEqual(checklistFailures({pr: 4339, comments: [run([{id: 'BB-022', result: 'FAIL'}], {user: 'stranger'})]}), []);
  assert.deepEqual(checklistFailures({pr: 4339, comments: [run([{id: 'BB-022', result: 'PASS'}])]}), []);
  assert.deepEqual(checklistFailures({pr: 4339, comments: [run([{id: 'BB-022', result: 'FAIL'}], {pr: 1})]}), []);
});
