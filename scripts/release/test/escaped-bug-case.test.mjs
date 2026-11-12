// Controls for the PR check `process / escaped-bug-case` (#3429). Pure decisions; no GitHub calls.
//   node --test scripts/release/test/escaped-bug-case.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {ESCAPE_LABEL, RULE_URL, changedCases, closingRefs, decide, escapeReason, isEscaped} from '../escaped-bug-case.mjs';

const REPO = 'hypeproof/hypeproof-studio';
const kase = (id, extra = {}) => ({id, journey: 'CUJ-5', priority: 'P1', title: id, requirements: ['REQ-A1'], steps: ['s'], expect: ['e'],
  origin: {kind: 'design'}, ...extra});
const escapedIssue = (number = 3425, labels = ['escaped-bug', 'member-report']) => ({number, labels, isPr: false});

test('closingRefs: same-repo closing keywords only', () => {
  assert.deepEqual(closingRefs('Closes #3429\nfixes: #12, resolves hypeproof/hypeproof-studio#7', REPO), [3429, 12, 7]);
  assert.deepEqual(closingRefs('Refs #5. Closes hypeproof/hypeproof-service#311', REPO), []);
  assert.deepEqual(closingRefs('Fixed #1 and Resolved #2', REPO), [1, 2]);
});

test('isEscaped follows the Service sentinel: escaped-bug, or member-report with kind bug', () => {
  assert.equal(isEscaped(['escaped-bug']), true);
  assert.equal(isEscaped(['member-report', 'bug']), true);
  assert.equal(isEscaped(['member-report', 'type:bug']), true);
  assert.equal(isEscaped(['member-report', 'enhancement']), false);
  assert.equal(isEscaped(['bug']), false);
  assert.equal(isEscaped(['process']), false);
});

test('positive control: an issue that is not an escaped bug passes without a case (this PR, #3429 labelled process)', () => {
  const v = decide({pr: 3460, issues: [{number: 3429, labels: ['process'], isPr: false}]});
  assert.deepEqual([v.ok, v.route], [true, 'not-escaped']);
  assert.equal(decide({pr: 3460, issues: []}).ok, true);
});

test('negative control: the #3399 / #3432 shape fails with the Korean and English rule and its link', () => {
  const v = decide({pr: 3432, issues: [escapedIssue(3426)], changed: [], addedFiles: ['extensions/hypeproof-chat/test/x.smoke.mjs']});
  assert.equal(v.ok, false);
  const text = v.reasons.join('\n');
  assert.match(text, /#3426 is an escaped bug/);
  assert.match(text, /유출 버그를 고치는 PR/);
  assert.ok(text.includes(RULE_URL));
  assert.ok(RULE_URL.endsWith('#유출-버그-규칙'));
});

test('a changed case passes when origin.ref names the PR or the issue', () => {
  const byPr = kase('BB-031', {origin: {kind: 'escaped-bug', date: '2026-11-03', ref: '#3432'}});
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [byPr]}).route, 'case');
  const byIssue = kase('BB-031', {origin: {kind: 'escaped-bug', date: '2026-11-03', ref: '#3426'}});
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [byIssue]}).ok, true);
  const multi = kase('BB-031', {origin: {kind: 'escaped-bug', date: '2026-11-03', ref: '#3425, #3426'}});
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [multi]}).ok, true);
  // a case naming another PR does not count, and #34260 is not #3426
  const other = kase('BB-031', {origin: {kind: 'escaped-bug', date: '2026-11-03', ref: '#3399'}});
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [other]}).ok, false);
  const longer = kase('BB-031', {origin: {kind: 'escaped-bug', date: '2026-11-03', ref: '#34260'}});
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [longer]}).ok, false);
});

test('a changed case passes when automated_by names a test file this PR adds', () => {
  const auto = kase('BB-012', {status: '자동화됨', automated_by: 'extensions/hypeproof-chat/test/report-log.smoke.mjs'});
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [auto], addedFiles: ['extensions/hypeproof-chat/test/report-log.smoke.mjs']}).ok, true);
  // the test already existed: not added here
  assert.equal(decide({pr: 3432, issues: [escapedIssue(3426)], changed: [auto], addedFiles: []}).ok, false);
});

test('every escaped issue needs its case when the case names only the issue', () => {
  const one = kase('BB-031', {origin: {kind: 'escaped-bug', date: '2026-11-03', ref: '#3425'}});
  const v = decide({pr: 3431, issues: [escapedIssue(3425), escapedIssue(3426)], changed: [one]});
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /#3426 is an escaped bug/);
});

test('escape hatch: label plus a "No casebook:" reason; the label alone fails', () => {
  const issues = [escapedIssue(3426)];
  const ok = decide({pr: 3432, issues, labels: [ESCAPE_LABEL], body: 'Closes #3426\n\nNo casebook: log noise is not visible in the app; the report test covers it'});
  assert.deepEqual([ok.ok, ok.route], [true, 'escape-hatch']);
  assert.match(ok.reasons[0], /log noise is not visible/);
  assert.equal(decide({pr: 3432, issues, labels: [ESCAPE_LABEL], body: 'Closes #3426'}).ok, false);
  assert.equal(decide({pr: 3432, issues, labels: [ESCAPE_LABEL], body: 'No casebook: n/a'}).ok, false);
  // the reason line without the label is not enough
  assert.equal(decide({pr: 3432, issues, labels: [], body: 'No casebook: a perfectly good reason here'}).ok, false);
  assert.equal(escapeReason('x\n  no casebook:   cannot reproduce by hand  \n'), 'cannot reproduce by hand');
});

test('a closed PR reference is not an issue', () => {
  assert.equal(decide({pr: 3432, issues: [{number: 3399, labels: ['escaped-bug'], isPr: true}]}).ok, true);
});

test('changedCases: new and edited cases, not unchanged ones', () => {
  const a = kase('BB-001'), b = kase('BB-002');
  const b2 = kase('BB-002', {title: 'edited'});
  const c = kase('BB-031');
  assert.deepEqual(changedCases([a, b], [a, b2, c]).map(x => x.id), ['BB-002', 'BB-031']);
  assert.deepEqual(changedCases([a, b], [a, b]), []);
});
