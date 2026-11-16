// Controls for the automatic release gates and the hps-auto-release/1 authority. No GitHub or git calls.
//   node --test scripts/release/test/auto-release.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AUTO_SCHEMA, DEPS_SCHEMA, KIT_SCHEMA, REQUIRED_GATES, autoAuthority, depsEvidence, holds, kitEvidence} from '../auto-release-record.mjs';
import {autoGates, blockerTitle, loadPolicy, recordBody} from '../auto-release.mjs';
import {decide} from '../publish-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = loadPolicy();
const CAND = 'c'.repeat(40);
const HEAD = 'h'.repeat(40).replace(/h/g, 'a');
const HEAD_DATE = '2026-11-16T02:00:00Z';
const SCEN = policy.blackboxKit.requiredScenarios;
const block = obj => '```json\n' + JSON.stringify(obj) + '\n```';
const at = (min) => `2026-11-16T0${2 + Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}:00Z`;

function kitComment(over = {}, user = 'hypeproof-agent[bot]', minute = 10) {
  return {user, created_at: at(minute), url: 'https://x/kit', minimized: false,
    body: block({schema: KIT_SCHEMA, candidate: CAND, service: 's'.repeat(40), lab: 'l'.repeat(40),
      scenarios: Object.fromEntries(SCEN.map(s => [s, 'PASS'])), ...over})};
}
const depsComment = (verdict = 'PASS', user = 'hypeproof-agent[bot]') => ({user, created_at: at(11), url: 'https://x/deps', minimized: false,
  body: block({schema: DEPS_SCHEMA, candidate: CAND, verdict, registry_digest: 'abc123def456aa'})});

function facts(over = {}) {
  const {promotion: promo, ...rest} = over;
  const comments = over.comments ?? [kitComment(), depsComment()];
  const pr = {number: 4254, head: HEAD, headDate: HEAD_DATE, headRef: 'release/v2026.1116.0', labels: ['release'], reviews: [], comments};
  return {
    enabled: true, candidate: CAND, rcTag: 'v2026.1116.0-rc.1',
    promotion: {pr, mergeState: 'CLEAN', p0: [], ...(promo ?? {})},
    structural: {allow: true, rcTag: 'v2026.1116.0-rc.1'},
    acceptance: {receipts: [{platform: 'darwin-arm64', status: 'PASS', sourceSha: CAND}, {platform: 'win32-x64', status: 'PASS', sourceSha: CAND}]},
    platforms: ['darwin-arm64', 'win32-x64'],
    macReceipt: {notarization: {status: 'Accepted', submission_id: 'id-1'}},
    blockers: {allow: true, blockers: [], reasons: []},
    live: 'proceed', comments,
    ...rest,
  };
}
const status = (v, id) => v.gates.find(g => g.id === id).status;

test('every gate PASS on the exact candidate gives PASS (positive control)', () => {
  const v = autoGates(facts(), policy);
  assert.equal(v.verdict, 'PASS', JSON.stringify(v.gates));
  assert.deepEqual(v.gates.map(g => g.id).sort(), [...REQUIRED_GATES].sort());
});

test('the kill switch off does nothing', () => {
  assert.equal(autoGates(facts({enabled: false}), policy).verdict, 'OFF');
});

test('each failing gate stops the release (FAIL)', () => {
  const cases = [
    ['acceptance', facts({acceptance: {receipts: [{platform: 'darwin-arm64', status: 'FAIL', sourceSha: CAND}]}})],
    ['notarization', facts({macReceipt: {notarization: {status: 'Invalid'}}})],
    ['blockers', facts({blockers: {allow: false, blockers: [{url: 'u'}], reasons: ['open release-blocker: u']}})],
    ['blackbox-kit', facts({comments: [kitComment({scenarios: {...Object.fromEntries(SCEN.map(s => [s, 'PASS'])), s3: 'FAIL'}}), depsComment()]})],
    ['release-deps', facts({comments: [kitComment(), depsComment('FAIL')]})],
    ['holds', facts({comments: [kitComment(), depsComment(), {user: 'hypeproof-agent[bot]', created_at: at(5), body: 'Heads-up before approving: #4204 is missing', url: 'https://x/warn', minimized: false}]})],
    ['release-pr', facts({structural: {allow: false, reasons: ['#4254: head commit changes a.js, not only releases/v.md']}})],
    ['required-ci', facts({promotion: {mergeState: 'DIRTY'}})],
  ];
  for (const [id, f] of cases) {
    const v = autoGates(f, policy);
    assert.equal(v.verdict, 'FAIL', id);
    assert.equal(status(v, id), 'FAIL', id);
  }
});

test('missing evidence waits instead of failing', () => {
  const cases = [
    ['blackbox-kit', facts({comments: [depsComment()]})],
    ['release-deps', facts({comments: [kitComment()]})],
    ['acceptance', facts({acceptance: null})],
    ['notarization', facts({macReceipt: null})],
    ['freeze', facts({live: 'blocked'})],
    ['freeze', facts({live: ''})],
    ['required-ci', facts({promotion: {mergeState: 'BLOCKED'}})],
    ['blockers', facts({blockers: {allow: false, blockers: [], reasons: ['cannot read']}})],
  ];
  for (const [id, f] of cases) {
    const v = autoGates(f, policy);
    assert.equal(v.verdict, 'WAIT', id);
    assert.equal(status(v, id), 'WAIT', id);
  }
});

test('evidence from an untrusted reporter, another candidate or before the head commit does not count', () => {
  const pr = {number: 1, head: HEAD, headDate: HEAD_DATE};
  assert.equal(kitEvidence({pr: {...pr, comments: [kitComment({}, 'someone')]}, candidate: CAND, reporters: policy.evidenceReporters, required: SCEN}).status, 'WAIT');
  assert.equal(kitEvidence({pr: {...pr, comments: [kitComment({candidate: 'd'.repeat(40)})]}, candidate: CAND, reporters: policy.evidenceReporters, required: SCEN}).status, 'WAIT');
  const early = {...kitComment(), created_at: '2026-11-16T01:00:00Z'};
  assert.equal(kitEvidence({pr: {...pr, comments: [early]}, candidate: CAND, reporters: policy.evidenceReporters, required: SCEN}).status, 'WAIT');
  // a scenario added to the required list (e.g. concept conformance) waits until the kit reports it
  assert.equal(kitEvidence({pr: {...pr, comments: [kitComment()]}, candidate: CAND, reporters: policy.evidenceReporters, required: [...SCEN, 's16']}).status, 'WAIT');
  assert.equal(depsEvidence({pr: {...pr, comments: [depsComment('PASS', 'someone')]}, candidate: CAND, reporters: policy.evidenceReporters}).status, 'WAIT');
});

test('holds: a hidden comment, machinery comments and evidence records do not hold; a change request does', () => {
  const warn = {user: 'TJ-kr', body: 'please wait', url: 'u', minimized: false};
  assert.equal(holds({comments: [warn]}, policy.machinery).open.length, 1);
  assert.equal(holds({comments: [{...warn, minimized: true}]}, policy.machinery).open.length, 0);
  assert.equal(holds({comments: [{...warn, user: 'hypeproof-org-lab-bot[bot]'}]}, policy.machinery).open.length, 0);
  assert.equal(holds({comments: [kitComment()]}, policy.machinery).open.length, 0);
  assert.deepEqual(holds({reviews: [{user: 'a', state: 'CHANGES_REQUESTED'}]}, policy.machinery).changes, ['a']);
  assert.deepEqual(holds({reviews: [{user: 'a', state: 'CHANGES_REQUESTED'}, {user: 'a', state: 'APPROVED'}]}, policy.machinery).changes, []);
});

test('the record the pipeline writes is the authority the publish gate accepts', () => {
  const f = facts();
  const v = autoGates(f, policy);
  const body = recordBody({pr: f.promotion.pr, candidate: CAND, rcTag: f.rcTag, version: 'v2026.1116.0', gates: v.gates, runUrl: 'https://run'});
  const record = {user: 'hypeproof-org-lab-bot[bot]', created_at: at(30), body, url: 'https://x/rec'};
  const pr = {number: 4254, head: HEAD, headDate: HEAD_DATE, comments: [record]};
  assert.equal(autoAuthority({pr, candidate: CAND, pipeline: policy.pipeline}).ok, true);
  // negative controls: another author, another head, another candidate, a gate not PASS
  assert.equal(autoAuthority({pr: {...pr, comments: [{...record, user: 'hypeproof-agent[bot]'}]}, candidate: CAND, pipeline: policy.pipeline}).ok, false);
  assert.equal(autoAuthority({pr: {...pr, head: 'b'.repeat(40)}, candidate: CAND, pipeline: policy.pipeline}).ok, false);
  assert.equal(autoAuthority({pr, candidate: 'd'.repeat(40), pipeline: policy.pipeline}).ok, false);
  const partial = body.replace('"status": "PASS"', '"status": "WAIT"');
  assert.equal(autoAuthority({pr: {...pr, comments: [{...record, body: partial}]}, candidate: CAND, pipeline: policy.pipeline}).ok, false);
});

test('publish gate: the auto route needs RELEASE_AUTO on and a valid record; approval still works', () => {
  const v = autoGates(facts(), policy);
  const body = recordBody({pr: facts().promotion.pr, candidate: CAND, rcTag: 'v2026.1116.0-rc.1', version: 'v2026.1116.0', gates: v.gates, runUrl: 'r'});
  const releasePr = {number: 4254, labels: ['release'], head: HEAD, headDate: HEAD_DATE, reviews: [],
    comments: [{user: 'hypeproof-org-lab-bot[bot]', association: 'NONE', created_at: at(30), body, url: 'u'}]};
  const base = {tag: 'v2026.1116.0', tagSha: CAND, rcTags: [{name: 'v2026.1116.0-rc.1', sha: CAND}], releasePrs: [releasePr], p0: []};
  const on = decide({...base, auto: {enabled: true, pipeline: policy.pipeline}});
  assert.equal(on.allow, true, on.reasons.join('; '));
  assert.equal(on.route, 'auto');
  const off = decide({...base, auto: {enabled: false, pipeline: policy.pipeline}});
  assert.equal(off.allow, false);
  assert.match(off.reasons.join('; '), /automatic release is off/);
  assert.equal(decide({...base, releasePrs: [{...releasePr, comments: []}], auto: {enabled: true, pipeline: policy.pipeline}}).allow, false);
  const approved = decide({...base, writers: new Set(['jayleekr']), releasePrs: [{...releasePr, comments: [], reviews: [{user: 'jayleekr', state: 'APPROVED', commit: HEAD}]}]});
  assert.equal(approved.route, 'approval');
});

test('policy, workflow and blocker title', () => {
  assert.deepEqual(policy.pipeline, ['hypeproof-org-lab-bot[bot]']);
  assert.ok(!policy.evidenceReporters.some(r => policy.pipeline.includes(r)), 'evidence reporters must not hold the pipeline authority');
  const wf = fs.readFileSync(path.join(here, '..', '..', '..', '.github', 'workflows', 'release-auto.yml'), 'utf8');
  assert.match(wf, /if: vars\.RELEASE_AUTO == 'on'/);
  assert.match(wf, /RELEASE_AUTO: \$\{\{ vars\.RELEASE_AUTO \}\}/);
  assert.match(wf, /LIVE_DECISION: \$\{\{ steps\.live\.outputs\.decision \}\}/);
  for (const name of ['verify-unified-release.yml', 'release-promote.yml']) {
    assert.match(fs.readFileSync(path.join(here, '..', '..', '..', '.github', 'workflows', name), 'utf8'), /RELEASE_AUTO: \$\{\{ vars\.RELEASE_AUTO \}\}/, name);
  }
  const t = blockerTitle('v2026.1116.0', [{id: 'holds', status: 'FAIL'}, {id: 'freeze', status: 'WAIT'}]);
  assert.equal(t, 'Auto-release stopped: v2026.1116.0 (holds)');
});
