// Controls for release promotion (#3172). Pure decisions plus the workflow wiring; no GitHub calls.
//   node --test scripts/release/test/promote.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {acceptanceSource, branchVersion, promotionDecision, recordedRcTag, uploadPlan} from '../promote.mjs';
import {buildTagMessage, expectedAppVersion, resolveBuildContract} from '../build-contract.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const V = 'v2026.1029.0', RC = `${V}-rc.2`;
const CAND = 'a'.repeat(40), HEAD = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const digest = c => `sha256:${c.repeat(64)}`;
const rcAssets = [
  {name: 'HypeProof-Studio-darwin-arm64.zip', digest: digest('1')},
  {name: 'HypeProof.StudioSetup-x64-1.116.07246.exe', digest: digest('2')},
  {name: 'unified-acceptance.json', digest: digest('3')},
  {name: 'install-mac.sh', digest: digest('4')},
  {name: `HypeProof-${RC}-Test-Kit.zip`, digest: digest('5')},
  {name: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', digest: digest('6')},
];
const good = () => ({
  pr: {number: 3159, state: 'open', merged: false, labels: ['release'], base: 'main', headRef: `release/${V}`, head: HEAD,
    reviews: [{user: 'minhan', state: 'APPROVED', commit: HEAD}]},
  commit: {sha: HEAD, parents: [CAND], message: `release: record ${RC}`, files: [`releases/${V}.md`]},
  rcTags: [{name: `${V}-rc.1`, sha: OTHER}, {name: RC, sha: CAND}],
  writers: new Set(['minhan']), vTagSha: '',
  rcRelease: {isDraft: false, assets: rcAssets},
});
const with_ = (patch) => { const f = good(); for (const [k, v] of Object.entries(patch)) f[k] = typeof v === 'function' ? v(f[k]) : v; return f; };

test('branch and record parsing', () => {
  assert.equal(branchVersion(`release/${V}`), V);
  for (const ref of ['release/v2026.1029', `release/${V}-rc.1`, `hotfix/${V}`, `release/${V}/x`, '']) assert.equal(branchVersion(ref), null);
  assert.equal(recordedRcTag(`release: record ${RC}\n\nbody`, V), RC);
  assert.equal(recordedRcTag(`release: record v2026.1028.0-rc.1`, V), null, 'another version');
  assert.equal(recordedRcTag(`release: record ${V}-rc.0`, V), null);
  assert.equal(recordedRcTag(`chore: record ${RC}`, V), null);
});

test('positive control: a writer approval on the head of a release-record commit promotes the recorded rc', () => {
  const v = promotionDecision(good());
  assert.equal(v.allow, true, v.reasons.join('\n'));
  assert.deepEqual([v.version, v.rcTag, v.candidate], [V, RC, CAND]);
  // App packages and the receipts only: per-tag files (installer, Test Kit, SDK seed) are regenerated for the v tag.
  assert.deepEqual(v.assets, ['HypeProof-Studio-darwin-arm64.zip', 'HypeProof.StudioSetup-x64-1.116.07246.exe', 'unified-acceptance.json']);
  // A rerun after the merge, with the v tag already on the rc commit, still passes.
  assert.equal(promotionDecision(with_({pr: pr => ({...pr, state: 'closed', merged: true}), vTagSha: CAND})).allow, true);
});

test('negative controls: every way the approval, the branch or the rc can be wrong is refused', () => {
  const cases = {
    'not a release branch': {pr: pr => ({...pr, headRef: 'feat/x'})},
    'base not main': {pr: pr => ({...pr, base: 'hotfix/v2026.1028.0'})},
    'no release label': {pr: pr => ({...pr, labels: []})},
    'closed unmerged': {pr: pr => ({...pr, state: 'closed'})},
    'stale approval (earlier candidate)': {pr: pr => ({...pr, reviews: [{user: 'minhan', state: 'APPROVED', commit: OTHER}]})},
    'non-writer approval': {pr: pr => ({...pr, reviews: [{user: 'outsider', state: 'APPROVED', commit: HEAD}]})},
    'approval withdrawn': {pr: pr => ({...pr, reviews: [{user: 'minhan', state: 'APPROVED', commit: HEAD}, {user: 'minhan', state: 'CHANGES_REQUESTED', commit: HEAD}]})},
    'extra file on the release branch': {commit: c => ({...c, files: [`releases/${V}.md`, 'scripts/release/promote.mjs']})},
    'merge commit head': {commit: c => ({...c, parents: [CAND, OTHER]})},
    'head lookup mismatch': {commit: c => ({...c, sha: OTHER})},
    'no rc recorded': {commit: c => ({...c, message: 'release: notes'})},
    'recorded rc missing': {rcTags: [{name: `${V}-rc.1`, sha: OTHER}]},
    'rc on another commit': {rcTags: [{name: RC, sha: OTHER}]},
    'v tag elsewhere': {vTagSha: OTHER},
    'rc not uploaded': {rcRelease: null},
    'rc still draft (not accepted)': {rcRelease: r => ({...r, isDraft: true})},
    'rc without receipts': {rcRelease: r => ({...r, assets: r.assets.filter(a => a.name !== 'unified-acceptance.json')})},
    'rc without packages': {rcRelease: r => ({...r, assets: r.assets.filter(a => a.name === 'unified-acceptance.json')})},
  };
  for (const [name, patch] of Object.entries(cases)) {
    const v = promotionDecision(with_(patch));
    assert.equal(v.allow, false, name);
    assert.ok(v.reasons.length, `${name}: a refusal names its reason`);
  }
});

test('upload plan: missing files upload, same bytes skip, other bytes or foreign packages refuse', () => {
  const wanted = [{name: 'a.zip', sha256: '1'.repeat(64)}, {name: 'unified-acceptance.json', sha256: '3'.repeat(64)}];
  assert.deepEqual(uploadPlan([], wanted), {upload: ['a.zip', 'unified-acceptance.json'], problems: []});
  assert.deepEqual(uploadPlan([{name: 'a.zip', digest: digest('1')}, {name: 'install-mac.sh', digest: digest('9')}], wanted),
    {upload: ['unified-acceptance.json'], problems: []});
  // 2026-10-29: the hand-pushed v2026.1029.0 draft holds a 4-min repack, not the rc's zip.
  assert.equal(uploadPlan([{name: 'a.zip', digest: digest('7')}], wanted).problems.length, 1);
  assert.equal(uploadPlan([{name: 'a.zip', digest: null}], wanted).problems.length, 1, 'an unknown digest is not a match');
  assert.equal(uploadPlan([{name: 'HypeProof.StudioSetup-x64-9.exe', digest: digest('8')}], wanted).problems.length, 1);
});

test('acceptance reuse: only the receipt of a published rc at the same commit', () => {
  const hash = '3'.repeat(64);
  const rc = {tag: RC, sha: CAND, isDraft: false, assets: [{name: 'unified-acceptance.json', digest: `sha256:${hash}`}]};
  assert.equal(acceptanceSource({tag: V, tagSha: CAND, acceptanceSha256: hash, rcReleases: [rc]}).reuse, true);
  for (const [name, input] of Object.entries({
    'rc tag': {tag: RC},
    'no receipt on the draft': {acceptanceSha256: ''},
    'different receipt bytes': {acceptanceSha256: '4'.repeat(64)},
    'rc still draft': {rcReleases: [{...rc, isDraft: true}]},
    'rc on another commit': {rcReleases: [{...rc, sha: OTHER}]},
    'rc of another version': {rcReleases: [{...rc, tag: 'v2026.1028.0-rc.1'}]},
  })) assert.equal(acceptanceSource({tag: V, tagSha: CAND, acceptanceSha256: hash, rcReleases: [rc], ...input}).reuse, false, name);
});

test('release-cut rcs carry final-version bytes; older rcs keep their rc version', () => {
  const plan = {candidate: CAND, version: V, rcTag: RC};
  const message = buildTagMessage(plan);
  assert.match(message, /^hps-release-candidate\/1\n/);
  assert.equal(expectedAppVersion(RC, message), '2026.1029.0');
  assert.equal(expectedAppVersion(RC, `${V} candidate (release-cut)`), '2026.1029.0-rc.2', 'an rc cut before #3172');
  assert.equal(expectedAppVersion(V, ''), '2026.1029.0');
  assert.equal(expectedAppVersion(RC, buildTagMessage(plan, {managedDraft: true})), '2026.1029.0');
  const request = {eventName: 'workflow_dispatch', githubRef: `refs/tags/${RC}`, githubSha: CAND, head: CAND, tagCommit: CAND,
    tagObject: OTHER, tagMessage: message, inputs: {ref: CAND}};
  const contract = resolveBuildContract(request);
  assert.equal(contract.releaseVersion, '2026.1029.0');
  assert.equal(contract.managedDraft, false);
  assert.equal(contract.autoAcceptance, true, 'the rc is still accepted and published as a prerelease');
  // A marker for another commit, another tag or a malformed one fails before any build step.
  for (const tagMessage of [buildTagMessage({...plan, candidate: OTHER}), buildTagMessage({...plan, rcTag: `${V}-rc.3`}),
    'hps-release-candidate/1', 'hps-release-candidate/1\n{}', 'HPS-RELEASE-CANDIDATE/2\n{}']) {
    assert.throws(() => resolveBuildContract({...request, tagMessage}), /Build contract:/, tagMessage);
  }
  assert.throws(() => expectedAppVersion('main', ''), /Build contract:/);
});

function workflow(name) {
  return JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',
    `${root}.github/workflows/${name}`], {encoding: 'utf8'}));
}

test('release-promote runs main\'s code on an approval and never on another review', () => {
  const doc = workflow('release-promote.yml'), job = doc.jobs.promote;
  assert.deepEqual(doc[true].pull_request_review.types, ['submitted']);
  assert.match(job.if, /github\.event\.review\.state == 'approved'/);
  assert.match(job.if, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'release'\)/);
  assert.equal(job.steps[0].with.ref, '${{ github.event.repository.default_branch }}');
  for (const step of job.steps) assert.doesNotMatch(step.run ?? '', /\$\{\{/, 'values enter the shell through env');
  const promote = job.steps.find(s => s.name === 'Promote the approved rc');
  assert.equal(promote.env.GH_TOKEN, '${{ github.token }}', 'the workflow token: its tag push starts no build');
});

test('verify-unified-release: a promoted release skips acceptance only on reusable receipts and still passes the gate', () => {
  const doc = workflow('verify-unified-release.yml');
  const text = fs.readFileSync(`${root}.github/workflows/verify-unified-release.yml`, 'utf8');
  assert.doesNotMatch(text, /TAG#v/, 'the expected App version comes from build-contract.mjs app-version');
  assert.match(doc.jobs.acceptance.if, /needs\.candidate\.outputs\.accepted != 'true'/);
  assert.match(doc.jobs.publish.if, /needs\.acceptance\.result == 'skipped' && needs\.candidate\.outputs\.accepted == 'true'/);
  assert.match(doc.jobs.publish.if, /needs\.candidate\.result == 'success'/);
  const names = doc.jobs.publish.steps.map(s => s.name);
  for (const name of ['Confirm the public Service still matches acceptance', 'Live-session freeze immediately before publication',
    'Publish gate — approved release PR or hotfix']) assert.ok(names.includes(name), name);
});
