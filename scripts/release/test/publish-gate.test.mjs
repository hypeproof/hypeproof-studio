// Controls for the publish gate. Pure decisions; no GitHub or git calls.
//   node --test scripts/release/test/publish-gate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {casebookEvidence, decide, p0CaseIds} from '../publish-gate.mjs';
import {parseYaml} from '../casebook.mjs';

const TAG = 'v2026.1013.0';
const SHA = 'a'.repeat(40);
const rc = [{name: `${TAG}-rc.1`, sha: SHA}];
const writers = new Set(['minhan']);
const HEAD = 'd'.repeat(40);
// An hps-blackbox-run/1 result comment, as the pre-tester posts it (results-schema.md).
const P0 = ['BB-001', 'BB-005'];
const runComment = ({head = HEAD, pr = 9, rows = P0.map(id => ({id, result: 'PASS'})), user = 'hypeproof-agent[bot]', association = 'NONE', at = '2026-10-21T10:00:00Z'} = {}) => ({
  user, association, created_at: at, url: 'u',
  body: ['사전 테스트 결과', '<details>', '', '```json', JSON.stringify({
    schema: 'hps-blackbox-run/1', pr, head_sha: head, rc_tag: 'v2026.1013.0-rc.1', tester: {kind: 'agent', name: 'pre-tester'},
    started_at: '2026-10-21T17:30:00+09:00', finished_at: '2026-10-21T18:05:00+09:00',
    cases: rows.map(r => ({priority: 'P0', attempts: r.result === 'FAIL' ? 2 : 1, ...(r.result === 'BLOCKED' ? {} : {screenshot: `${r.id}.png`}), ...(r.result === 'PASS' ? {} : {note: 'seen'}), ...r})),
    p0_verdict: rows.some(r => r.result === 'FAIL') ? '승인 보류 권장' : 'P0 실패 없음',
  }, null, 2), '```', '</details>'].join('\n'),
});
const override = (user, body, at = '2026-10-21T12:00:00Z') => ({user, association: 'MEMBER', created_at: at, url: 'u', body});
const releasePr = (reviews, labels = ['release'], comments = [runComment()]) => [{number: 9, labels, head: HEAD, headDate: '2026-10-21T09:00:00Z', comments, reviews: reviews.map(r => ({commit: HEAD, ...r}))}];
const hotfixPr = (sha, extra = {}) => ({number: 7, labels: ['hotfix'], base: 'hotfix/v2026.1006.0', mergeCommit: sha, ...extra});

test('a prerelease tag is not gated', () => {
  assert.equal(decide({tag: `${TAG}-rc.1`, tagSha: SHA}).allow, true);
});

test('negative control: a hand-pushed stable tag with no release PR and no hotfix range is refused', () => {
  const v = decide({tag: TAG, tagSha: SHA, previous: 'v0.1.56', rangePrs: [{sha: 'b'.repeat(40), prs: [{number: 1, labels: [], base: 'main', mergeCommit: 'b'.repeat(40)}]}]});
  assert.equal(v.allow, false);
  assert.match(v.reasons.join('\n'), /no PR from release\/v2026\.1013\.0/);
});

test('approval route: a writer approval and an rc tag at the same commit pass', () => {
  const v = decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}])});
  assert.deepEqual([v.allow, v.route, v.casebook], [true, 'approval', 'blackbox-run']);
  assert.match(v.notesLine, /passed all 2 P0 cases/);
});

test('approval route refuses: non-writer, later change request, missing label, rc on another commit', () => {
  const base = {tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0};
  assert.equal(decide({...base, releasePrs: releasePr([{user: 'outsider', state: 'APPROVED'}])}).allow, false);
  assert.equal(decide({...base, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}, {user: 'minhan', state: 'CHANGES_REQUESTED'}])}).allow, false);
  assert.equal(decide({...base, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}], [])}).allow, false);
  assert.equal(decide({...base, rcTags: [{name: `${TAG}-rc.1`, sha: 'c'.repeat(40)}], releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}])}).allow, false);
  // an approval of an earlier candidate (the branch moved for a later rc) does not count
  const stale = decide({...base, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED', commit: 'e'.repeat(40)}])});
  assert.equal(stale.allow, false);
  assert.match(stale.reasons.join('\n'), /approved an earlier candidate/);
  // a comment after the approval does not withdraw it
  assert.equal(decide({...base, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}, {user: 'minhan', state: 'COMMENTED'}])}).allow, true);
});

test('hotfix route: every commit since the last release is a hotfix PR into hotfix/*', () => {
  const s1 = '1'.repeat(40), s2 = '2'.repeat(40);
  const v = decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangePrs: [{sha: s1, prs: [hotfixPr(s1)]}, {sha: s2, prs: [hotfixPr(s2)]}]});
  assert.deepEqual([v.allow, v.route], [true, 'hotfix']);
});

test('hotfix route refuses: label on a main PR, a direct push, an empty range, no previous release', () => {
  const s1 = '1'.repeat(40), s2 = '2'.repeat(40);
  const one = (prs, sha = s1) => decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangePrs: [{sha, prs}]});
  assert.equal(one([hotfixPr(s1, {base: 'main'})]).allow, false);
  assert.equal(one([]).allow, false);
  assert.equal(one([hotfixPr(s1, {labels: []})]).allow, false);
  // the PR is associated with the commit but did not produce it
  assert.equal(one([hotfixPr(s2)]).allow, false);
  // one hotfix commit and one unlabelled commit: the unlabelled one is not smuggled out
  assert.equal(decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangePrs: [{sha: s1, prs: [hotfixPr(s1)]}, {sha: s2, prs: []}]}).allow, false);
  assert.equal(decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangePrs: []}).allow, false);
  assert.equal(decide({tag: TAG, tagSha: SHA, rangePrs: [{sha: s1, prs: [hotfixPr(s1)]}]}).allow, false);
  assert.equal(decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangeTooLong: 42}).allow, false);
});

// --- Release casebook evidence (#3429) ------------------------------------------------------

const approved = [{user: 'minhan', state: 'APPROVED'}];
const gate = comments => decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr(approved, ['release'], comments)});

test('casebook negative controls: approval alone no longer publishes', () => {
  const none = gate([]);
  assert.equal(none.allow, false);
  assert.match(none.reasons.join('\n'), /casebook not run at the head: no hps-blackbox-run\/1 PASS for P0 BB-001, BB-005/);
  // the P0 list was never read: refuse, do not assume
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, releasePrs: releasePr(approved)}).allow, false);
  // a P0 BLOCKED or FAIL is not a PASS
  assert.equal(gate([runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'BLOCKED'}]})]).allow, false);
  assert.equal(gate([runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'FAIL'}]})]).allow, false);
  // a P0 left out of the run
  assert.equal(gate([runComment({rows: [{id: 'BB-001', result: 'PASS'}]})]).allow, false);
  // a run of an earlier candidate, of another PR, by a stranger, or an invalid run
  assert.match(gate([runComment({head: 'e'.repeat(40)})]).reasons.join('\n'), /not the head/);
  assert.equal(gate([runComment({pr: 8})]).allow, false);
  assert.match(gate([runComment({user: 'drive-by', association: 'NONE'})]).reasons.join('\n'), /not a member or org bot/);
  const broken = runComment();
  broken.body = broken.body.replace('"PASS"', '"OK"');
  assert.equal(gate([broken]).allow, false);
});

test('casebook positive controls: one full run, or partial runs whose latest rows all PASS', () => {
  assert.equal(gate([runComment({association: 'MEMBER', user: 'minhan'})]).allow, true);
  const split = [runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'FAIL'}], at: '2026-10-21T10:00:00Z'}),
    runComment({rows: [{id: 'BB-005', result: 'PASS'}], at: '2026-10-21T11:00:00Z'})];
  assert.equal(gate(split).allow, true);
  // order matters: a later FAIL replaces an earlier PASS
  assert.equal(gate([split[1], {...split[0], created_at: '2026-10-21T12:00:00Z'}]).allow, false);
});

test('override: Jay or the approving writer, with a reason, after the head commit', () => {
  const ok = gate([override('jayleekr', 'Release manager override (Jay 2026-11-03: ship it; P0 run on rc.2, rc.3 only adds #3454)')]);
  assert.deepEqual([ok.allow, ok.casebook], [true, 'override']);
  assert.match(ok.notesLine, /^Release casebook: not run; release manager override by jayleekr on #9: \(Jay 2026-11-03/);
  assert.equal(gate([override('minhan', 'Release manager override: pre-tester Mac is down; ran BB-001 by hand')]).allow, true);
  // negative: no reason, a writer who did not approve, a stranger, a phrase not at the start, before the head commit
  assert.equal(gate([override('jayleekr', 'Release manager override')]).allow, false);
  assert.equal(gate([override('otherwriter', 'Release manager override: because I said so, long enough')]).allow, false);
  assert.equal(gate([override('drive-by', 'Release manager override: trust me, this is fine really')]).allow, false);
  assert.equal(gate([override('jayleekr', 'Note: Release manager override: reason that is long enough')]).allow, false);
  assert.match(gate([override('jayleekr', 'Release manager override: an earlier candidate reason', '2026-10-21T08:00:00Z')]).reasons.join('\n'), /predates the head/);
});

test('hotfix route records its path for the release notes', () => {
  const s1 = '1'.repeat(40);
  const v = decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangePrs: [{sha: s1, prs: [hotfixPr(s1)]}]});
  assert.match(v.notesLine, /^Release casebook: hotfix route/);
});

test('p0CaseIds reads the real casebook: every P0 that CI does not run', () => {
  const file = fileURLToPath(new URL('../../../docs/operations/release-casebook/cases.yaml', import.meta.url));
  const cases = parseYaml(fs.readFileSync(file, 'utf8'), 'cases.yaml').cases;
  const ids = p0CaseIds(cases);
  assert.ok(ids.length > 0);
  assert.ok(ids.includes('BB-001'));
  for (const c of cases) assert.equal(ids.includes(c.id), c.priority === 'P0' && c.status !== '자동화됨');
  assert.equal(casebookEvidence({number: 9, head: HEAD, p0: []}).ok, true);
});
