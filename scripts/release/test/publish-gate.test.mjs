// Controls for the publish gate. Pure decisions; no GitHub or git calls.
//   node --test scripts/release/test/publish-gate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
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
// An override comment as the policy requires it: a reason plus the hps-release-override/1 block.
const block = (blocked = [], notRun = []) => ['```json', JSON.stringify({schema: 'hps-release-override/1', waives: {blocked, not_run: notRun}}), '```'].join('\n');
const waiver = (user, reason, blocked, notRun, at) => override(user, `Release manager override: ${reason}\n\n${block(blocked, notRun)}`, at);
const NONE_RUN = waiver('jayleekr', 'P0 run on rc.2; rc.3 only fixes the publish gate', [], P0);
const releasePr = (reviews, labels = ['release'], comments = [runComment()]) => [{number: 9, labels, head: HEAD, headDate: '2026-10-21T09:00:00Z', comments, reviews: reviews.map(r => ({commit: HEAD, ...r}))}];
const hotfixPr = (sha, extra = {}) => ({number: 7, labels: ['hotfix'], base: 'hotfix/v2026.1006.0', mergeCommit: sha, ...extra});

test('a prerelease tag is not gated', () => {
  assert.equal(decide({tag: `${TAG}-rc.1`, tagSha: SHA}).allow, true);
});

// The publish job refuses to publish without a notes line, so an rc must get one (rc.3 of
// v2026.1105.0 stayed a draft because it did not), while a stable tag still needs the casebook.
test('rc prerelease passes with a notes line; a stable tag without a run or override does not', () => {
  const rcVerdict = decide({tag: 'v2026.1105.0-rc.3'});
  assert.deepEqual([rcVerdict.allow, rcVerdict.route], [true, 'prerelease']);
  assert.match(rcVerdict.notesLine, /^Release casebook: rc prerelease; the casebook gate .* applies when the stable tag is published\.$/);
  const bare = decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}], ['release'], [])});
  assert.equal(bare.allow, false);
  assert.equal(bare.notesLine, undefined);
  const overridden = decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}], ['release'],
    [NONE_RUN])});
  assert.deepEqual([overridden.allow, overridden.casebook], [true, 'override']);
  assert.match(overridden.notesLine, /^Release casebook: release manager override by jayleekr on #9 waived 2 P0 case\(s\) \(0 BLOCKED; 2 not run: BB-001, BB-005\); 0 PASS: P0 run on rc\.2/);
});

test('CLI: an rc tag writes notes_line to GITHUB_OUTPUT without any GitHub lookup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-gate-'));
  const out = path.join(dir, 'output');
  fs.writeFileSync(out, '');
  const script = fileURLToPath(new URL('../publish-gate.mjs', import.meta.url));
  // An unusable gh on PATH proves the rc path makes no lookup.
  const env = {...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '', PATH: dir, GH_TOKEN: ''};
  const r = spawnSync(process.execPath, [script, '--tag', 'v2026.1105.0-rc.3'], {env, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /^notes_line=Release casebook: rc prerelease; .+\n$/);
  fs.rmSync(dir, {recursive: true, force: true});
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

test('override: Jay or the approving writer, with a reason and the waived list, after the head commit', () => {
  const ok = gate([waiver('jayleekr', '(Jay 2026-11-03: ship it; P0 run on rc.2, rc.3 only adds #3454)', [], P0)]);
  assert.deepEqual([ok.allow, ok.casebook], [true, 'override']);
  assert.match(ok.notesLine, /^Release casebook: release manager override by jayleekr on #9 waived 2 P0 case\(s\).*: \(Jay 2026-11-03/);
  assert.equal(gate([waiver('minhan', 'pre-tester Mac is down; ran BB-001 by hand', [], P0)]).allow, true);
  // negative: no reason, a writer who did not approve, a stranger, a phrase not at the start, before the head commit
  assert.equal(gate([override('jayleekr', `Release manager override\n\n${block([], P0)}`)]).allow, false);
  assert.equal(gate([waiver('otherwriter', 'because I said so, long enough', [], P0)]).allow, false);
  assert.equal(gate([waiver('drive-by', 'trust me, this is fine really', [], P0)]).allow, false);
  assert.equal(gate([override('jayleekr', `Note: Release manager override: reason that is long enough\n${block([], P0)}`)]).allow, false);
  assert.match(gate([waiver('jayleekr', 'an earlier candidate reason', [], P0, '2026-10-21T08:00:00Z')]).reasons.join('\n'), /predates the head/);
});

// The owner-approved policy (#3462): an override waives BLOCKED or not-run P0 cases, never a P0 FAIL, and
// must say which ones.
test('override policy: a P0 FAIL is never waived and the gate names the failing cases', () => {
  const failing = runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'FAIL'}]});
  for (const o of [waiver('jayleekr', 'ship it anyway, the failure is cosmetic', [], []), waiver('jayleekr', 'ship it anyway, the failure is cosmetic', [], ['BB-005']),
    waiver('jayleekr', 'ship it anyway, the failure is cosmetic', ['BB-005'], [])]) {
    const v = gate([failing, o]);
    assert.equal(v.allow, false);
    assert.match(v.reasons.join('\n'), /P0 FAIL at the head: BB-005; a release manager override cannot waive a P0 FAIL/);
  }
  // FAIL beside a BLOCKED case: the override still cannot open it, even when it lists the BLOCKED one
  const mixed = runComment({rows: [{id: 'BB-001', result: 'BLOCKED'}, {id: 'BB-005', result: 'FAIL'}]});
  const v = gate([mixed, waiver('minhan', 'blocked case waived, fail is not', ['BB-001'], [])]);
  assert.equal(v.allow, false);
  assert.match(v.reasons.join('\n'), /BB-005/);
  assert.doesNotMatch(v.reasons.join('\n'), /BB-001/);
  // a later run that PASSes the case at the same head replaces the FAIL (existing rule), then no override is needed
  const fixed = runComment({rows: [{id: 'BB-005', result: 'PASS'}], at: '2026-10-21T11:00:00Z'});
  assert.equal(gate([failing, fixed, waiver('jayleekr', 'BB-001 only, the rest ran', [], [])]).allow, true);
});

test('override policy: the waived list must cover every non-PASS P0 case under its status', () => {
  const blockedRun = runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'BLOCKED'}]});
  const why = 'Google login blocks BB-005 on the pre-tester Mac';
  const ok = gate([blockedRun, waiver('jayleekr', why, ['BB-005'], [])]);
  assert.deepEqual([ok.allow, ok.casebook], [true, 'override']);
  assert.deepEqual(ok.summary.override, {used: true, by: 'jayleekr', url: 'u', waived_blocked: ['BB-005'], waived_not_run: []});
  assert.deepEqual(ok.summary.counts, {pass: 1, fail: 0, blocked: 1, not_run: 0});
  // an override without the block, with an empty list, or under the wrong status does not cover it
  const refusals = {
    'no block': override('jayleekr', `Release manager override: ${why}`),
    'empty list': waiver('jayleekr', why, [], []),
    'wrong status': waiver('jayleekr', why, [], ['BB-005']),
    'another case': waiver('jayleekr', why, ['BB-001'], []),
    'not a P0 case of the casebook': waiver('jayleekr', why, ['BB-005', 'BB-999'], []),
    'malformed block': override('jayleekr', `Release manager override: ${why}\n\n\`\`\`json\n{"schema": "hps-release-override/1", "waives": ["BB-005"]}\n\`\`\``),
    'unparseable block': override('jayleekr', `Release manager override: ${why}\n\n\`\`\`json\n{"schema": "hps-release-override/1", \n\`\`\``),
    'wrong schema': override('jayleekr', `Release manager override: ${why}\n\n${block(['BB-005'], []).replace('override/1', 'override/2')}`),
  };
  for (const [name, o] of Object.entries(refusals)) {
    const v = gate([blockedRun, o]);
    assert.equal(v.allow, false, name);
    assert.match(v.reasons.join('\n'), /casebook not run at the head: no hps-blackbox-run\/1 PASS for P0 BB-005.*waiving every one of them/, name);
  }
  // the list is the record of what was waived: a PASS case listed as waived is a mismatch, not a waiver
  const extra = gate([blockedRun, waiver('jayleekr', why, ['BB-005', 'BB-001'], [])]);
  assert.equal(extra.allow, false);
  assert.match(extra.reasons.join('\n'), /BB-001 is PASS, not BLOCKED/);
});

test('override policy: with no run at the head the override must list every P0 case as not run', () => {
  const why = 'no pre-tester run this week; the P0 cases were walked by hand';
  assert.equal(gate([waiver('jayleekr', why, [], P0)]).allow, true);
  assert.equal(gate([waiver('jayleekr', why, [], ['BB-001'])]).allow, false);
  assert.equal(gate([waiver('jayleekr', why, P0, [])]).allow, false, 'declaring them BLOCKED when no run exists is wrong');
  // a run of an earlier candidate does not count as a run at this head
  assert.equal(gate([runComment({head: 'e'.repeat(40)}), waiver('jayleekr', why, [], P0)]).allow, true);
  // partial run: BB-001 PASS, BB-005 never run
  const partial = runComment({rows: [{id: 'BB-001', result: 'PASS'}]});
  assert.equal(gate([partial, waiver('jayleekr', why, [], ['BB-005'])]).allow, true);
  assert.equal(gate([partial, waiver('jayleekr', why, [], P0)]).allow, false);
});

test('override policy: the latest valid override wins over an older invalid one', () => {
  const why = 'Google login blocks BB-005 on the pre-tester Mac';
  const blockedRun = runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'BLOCKED'}]});
  const stale = waiver('jayleekr', why, [], [], '2026-10-21T12:00:00Z');
  const fixed = waiver('jayleekr', why, ['BB-005'], [], '2026-10-21T13:00:00Z');
  assert.equal(gate([blockedRun, stale, fixed]).allow, true);
  assert.equal(gate([blockedRun, fixed, stale]).allow, true, 'order of comments in the list does not matter, created_at does');
});

test('release record: the gate summary carries override use, waived ids and counts', () => {
  const clean = gate([runComment()]);
  assert.deepEqual(clean.summary.override, {used: false, by: null, url: null, waived_blocked: [], waived_not_run: []});
  assert.deepEqual(clean.summary.counts, {pass: 2, fail: 0, blocked: 0, not_run: 0});
  assert.equal(clean.summary.p0_total, 2);
  const failed = gate([runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'FAIL'}]})]);
  assert.equal(failed.allow, false);
  assert.deepEqual(failed.summary.fail_ids, ['BB-005']);
  assert.equal(failed.summary.override.used, false);
});

test('CLI: --summary writes one JSON record and the step summary carries it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-gate-summary-'));
  const file = path.join(dir, 'nested', 'gate.json');
  const script = fileURLToPath(new URL('../publish-gate.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--tag', 'v2026.1105.0-rc.3', '--summary', file], {env: {...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', PATH: dir, GH_TOKEN: ''}, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([record.schema, record.tag, record.allow, record.route], ['hps-publish-gate/1', 'v2026.1105.0-rc.3', true, 'prerelease']);
  assert.match(r.stdout, /```json\n\{"schema":"hps-publish-gate\/1"/);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('hotfix route records its path for the release notes', () => {
  const s1 = '1'.repeat(40);
  const v = decide({tag: TAG, tagSha: SHA, previous: 'v2026.1006.0', rangePrs: [{sha: s1, prs: [hotfixPr(s1)]}]});
  assert.match(v.notesLine, /^Release casebook: hotfix route/);
});

test('p0CaseIds reads the real casebook: every active desktop P0, leaving iPhone evidence separate', () => {
  const file = fileURLToPath(new URL('../../../docs/operations/release-casebook/cases.yaml', import.meta.url));
  const cases = parseYaml(fs.readFileSync(file, 'utf8'), 'cases.yaml').cases;
  const ids = p0CaseIds(cases);
  assert.ok(ids.length > 0);
  assert.ok(ids.includes('BB-001'));
  for (const c of cases) assert.equal(ids.includes(c.id), (c.targets ?? ['desktop']).includes('desktop') && c.priority === 'P0' && c.status !== '자동화됨');
  assert.deepEqual(p0CaseIds(cases, {target: 'ios'}), ['BB-033', 'BB-034', 'BB-035', 'BB-036', 'BB-037', 'BB-039']);
  assert.equal(casebookEvidence({number: 9, head: HEAD, p0: []}).ok, true);
});

test('native P0 cases do not change desktop approval requirements; malformed targets still refuse', () => {
  const cases = [
    {id: 'BB-001', priority: 'P0'},
    {id: 'BB-005', priority: 'P0', targets: ['desktop', 'ios']},
    {id: 'BB-033', priority: 'P0', targets: ['ios']},
    {id: 'BB-034', priority: 'P0', targets: ['ios'], status: '자동화됨'},
  ];
  const desktop = p0CaseIds(cases);
  assert.deepEqual(desktop, P0);
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: desktop, releasePrs: releasePr(approved)}).allow, true);
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: desktop,
    releasePrs: releasePr(approved, ['release'], [runComment({rows: [{id: 'BB-033', result: 'PASS'}]})])}).allow, false);
  assert.deepEqual(p0CaseIds(cases, {target: 'ios'}), ['BB-005', 'BB-033']);
  for (const targets of [[], null, 'ios', ['watchos'], ['ios', 'ios']]) {
    // Invalid non-P0 metadata cannot disappear before validation either.
    assert.throws(() => p0CaseIds([...cases, {id: 'BB-035', priority: 'P1', targets}]), /targets/);
  }
  assert.throws(() => p0CaseIds([], {target: 'watchos'}), /target must/);
});

// The record carries internal override/waiver data; mirror-release.yml copies every release asset to the
// public mirror, so the workflow must keep it as an artifact and job summary only.
test('the gate record is never uploaded as a release asset', () => {
  const wf = fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/verify-unified-release.yml', import.meta.url)), 'utf8');
  assert.match(wf, /publish-gate\.mjs --tag "\$TAG" --summary dist\/publish-gate\.json/);
  assert.match(wf, /uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: publish-gate/);
  for (const line of wf.split('\n').filter(l => /gh release (upload|create|edit)/.test(l))) assert.doesNotMatch(line, /publish-gate/);
});

// Owner decision (#3462): the hotfix route must not pass a release that has a P0 FAIL at its head.
test('hotfix route: a P0 FAIL on the release PR head blocks it; no run keeps today\'s behaviour', () => {
  const s1 = '1'.repeat(40);
  const hotfix = {previous: 'v2026.1006.0', rangePrs: [{sha: s1, prs: [hotfixPr(s1)]}]};
  const failing = runComment({rows: [{id: 'BB-001', result: 'PASS'}, {id: 'BB-005', result: 'FAIL'}]});
  // not even approved: the PR still has a P0 FAIL, so the fall-through to hotfix is refused
  const v = decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([], ['release'], [failing]), ...hotfix});
  assert.deepEqual([v.allow, v.route], [false, 'none']);
  assert.match(v.reasons.join('\n'), /hotfix: refused, #9 has a P0 FAIL at its head: BB-005/);
  assert.deepEqual(v.summary.fail_ids, ['BB-005']);
  // approved with an override that cannot waive the FAIL, then hotfix range: still refused
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr(approved, ['release'], [failing, waiver('jayleekr', 'ship it anyway, cosmetic', [], [])]), ...hotfix}).allow, false);
  // a later PASS for the case at the same head clears the FAIL: hotfix route works again
  const fixed = runComment({rows: [{id: 'BB-005', result: 'PASS'}], at: '2026-10-21T11:00:00Z'});
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([], ['release'], [failing, fixed]), ...hotfix}).route, 'hotfix');
  // no blackbox run at all, with or without a release PR: today's behaviour
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([], ['release'], []), ...hotfix}).route, 'hotfix');
  assert.equal(decide({tag: TAG, tagSha: SHA, ...hotfix}).route, 'hotfix');
  // a run of an earlier candidate is not a run at this head
  assert.equal(decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, p0: P0, releasePrs: releasePr([], ['release'], [runComment({head: 'e'.repeat(40), rows: [{id: 'BB-005', result: 'FAIL'}]})]), ...hotfix}).route, 'hotfix');
});
