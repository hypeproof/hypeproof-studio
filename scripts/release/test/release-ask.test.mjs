// Controls for asking the whole team, the post-publish SDK seed check and "first answer wins".
//   node --test scripts/release/test/release-ask.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {ASK_SCHEMA, PUBLISHED_SCHEMA, alreadyAsked, askBody, askReason, publishChecks, publishedBody} from '../release-ask.mjs';
import {decide, firstDecisive} from '../publish-gate.mjs';
import {loadPolicy} from '../auto-release.mjs';

const policy = loadPolicy();
const HEAD = 'a'.repeat(40);
const CAND = 'c'.repeat(40);
const json = body => JSON.parse(body.split('```json\n')[1].split('\n```')[0]);

test('policy: approvers mirror the authority table and are part of the team; s16 and s17 are required', () => {
  assert.deepEqual(policy.releaseApprovers, ['JeHyeong2', 'ico1036', 'jayleekr']);
  assert.equal(policy.team.length, 8);
  for (const a of policy.releaseApprovers) assert.ok(policy.team.includes(a), a);
  assert.ok(policy.blackboxKit.requiredScenarios.includes('s16') && policy.blackboxKit.requiredScenarios.includes('s17'));
});

test('askReason: fail and off ask at once, a wait asks only after askAfterHours, pass never', () => {
  const headDate = '2026-11-16T00:00:00Z';
  const at = h => Date.parse(headDate) + h * 3600 * 1000;
  assert.equal(askReason({verdict: 'FAIL', headDate, now: at(0), askAfterHours: 6}), 'fail');
  assert.equal(askReason({verdict: 'OFF', headDate, now: at(0), askAfterHours: 6}), 'auto_off');
  assert.equal(askReason({verdict: 'WAIT', headDate, now: at(5.9), askAfterHours: 6}), null);
  assert.equal(askReason({verdict: 'WAIT', headDate, now: at(6), askAfterHours: 6}), 'uncertain');
  assert.equal(askReason({verdict: 'PASS', headDate, now: at(99), askAfterHours: 6}), null);
});

test('the ask mentions the whole team, names the approvers, binds the head and is posted once per head', () => {
  const gates = [{id: 'blackbox-kit', status: 'FAIL', detail: 'black-box kit FAIL: s16'}, {id: 'freeze', status: 'PASS', detail: 'ok'}];
  const body = askBody({pr: {number: 4280, head: HEAD}, candidate: CAND, rcTag: 'v2026.1116.1-rc.1', version: 'v2026.1116.1',
    reason: 'fail', gates, approvers: policy.releaseApprovers, team: policy.team, runUrl: 'https://run'});
  for (const t of policy.team) assert.ok(body.includes(`@${t}`), t);
  assert.ok(body.includes('blackbox-kit') && !body.includes('`freeze`'), 'only gates that did not pass are listed');
  const r = json(body);
  assert.equal(r.schema, ASK_SCHEMA);
  assert.equal(r.head_sha, HEAD);
  assert.deepEqual(r.approvers, policy.releaseApprovers);
  const comment = {user: 'hypeproof-org-lab-bot[bot]', body};
  assert.equal(alreadyAsked([comment], policy.pipeline, HEAD), true);
  assert.equal(alreadyAsked([comment], policy.pipeline, 'b'.repeat(40)), false, 'a new head is asked again');
  assert.equal(alreadyAsked([{...comment, user: 'someone'}], policy.pipeline, HEAD), false);
});

test('post-publish: the seed must answer 200 and every listed tarball must be on the release with its size', () => {
  const seed = {schema: 'hps-sdk-seed/1', seeds: [{name: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', size: 10}]};
  const assets = [{name: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', size: 10}];
  assert.equal(publishChecks({tag: 'v1.2.3', seedStatus: 200, seed, assets}).ok, true);
  assert.match(publishChecks({tag: 'v1.2.3', seedStatus: 404, seed: null, assets}).problems[0], /sdk-seed\.json answered HTTP 404/);
  assert.match(publishChecks({tag: 'v1.2.3', seedStatus: 200, seed, assets: []}).problems[0], /does not carry/);
  assert.match(publishChecks({tag: 'v1.2.3', seedStatus: 200, seed, assets: [{...assets[0], size: 9}]}).problems[0], /9 bytes/);
  assert.equal(publishChecks({tag: 'v1.2.3', seedStatus: 200, seed: {schema: 'x'}, assets}).ok, false);
  const ok = publishedBody({tag: 'v1.2.3', pr: 1, ok: true, problems: [], team: policy.team, runUrl: 'r'});
  assert.ok(ok.startsWith('**출시됨 v1.2.3**'));
  assert.equal(json(ok).schema, PUBLISHED_SCHEMA);
  assert.equal(json(publishedBody({tag: 'v1.2.3', pr: 1, ok: false, problems: ['p'], team: policy.team, runUrl: 'r'})).verdict, 'FAIL');
});

test('first answer wins among release approvers; answers on an older head or by others do not count', () => {
  const allowed = new Set(policy.releaseApprovers);
  const old = 'b'.repeat(40);
  assert.equal(firstDecisive([{user: 'TJ-kr', state: 'APPROVED', commit: HEAD}], HEAD, allowed), null);
  assert.equal(firstDecisive([{user: 'jayleekr', state: 'APPROVED', commit: old}], HEAD, allowed), null);
  assert.equal(firstDecisive([{user: 'ico1036', state: 'COMMENTED', commit: HEAD}, {user: 'jayleekr', state: 'APPROVED', commit: HEAD}], HEAD, allowed).user, 'jayleekr');

  const base = {tag: 'v2026.1116.1', tagSha: CAND, rcTags: [{name: 'v2026.1116.1-rc.1', sha: CAND}], p0: [],
    writers: new Set(['jayleekr', 'JeHyeong2', 'TJ-kr']), auto: {enabled: false, pipeline: policy.pipeline, approvers: policy.releaseApprovers}};
  const pr = reviews => ({number: 9, labels: ['release'], head: HEAD, headDate: '2026-11-16T00:00:00Z', comments: [], reviews});
  // an approver approves first: released
  assert.equal(decide({...base, releasePrs: [pr([{user: 'jayleekr', state: 'APPROVED', commit: HEAD}])]}).route, 'approval');
  // an approver holds first: a later approval does not release
  const held = decide({...base, releasePrs: [pr([{user: 'JeHyeong2', state: 'CHANGES_REQUESTED', commit: HEAD}, {user: 'jayleekr', state: 'APPROVED', commit: HEAD}])]});
  assert.equal(held.allow, false);
  assert.match(held.reasons.join('; '), /held by JeHyeong2/);
  // a writer who is not a release approver does not count
  assert.equal(decide({...base, releasePrs: [pr([{user: 'TJ-kr', state: 'APPROVED', commit: HEAD}])]}).allow, false);
  // an approval of an older head is void
  assert.equal(decide({...base, releasePrs: [pr([{user: 'jayleekr', state: 'APPROVED', commit: 'b'.repeat(40)}])]}).allow, false);
});
