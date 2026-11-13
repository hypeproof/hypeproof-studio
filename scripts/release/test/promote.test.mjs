// Controls for release promotion (#3172). Pure decisions plus the workflow wiring; no GitHub calls.
//   node --test scripts/release/test/promote.test.mjs
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture as machineFixture} from './machine-publication.controls.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {acceptanceSource, branchVersion, promotionDecision, recordedRcTag, uploadPlan, rcTagsOf, readAcceptedReceipt} from '../promote.mjs';
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
// The release casebook (#3429): the candidate's P0 cases and the release PR's comments since the head.
const P0 = ['BB-001', 'BB-005'];
const HEAD_DATE = '2026-10-29T10:00:00Z';
const comment = (user, body, at = '2026-10-29T11:00:00Z', association = 'MEMBER') => ({user, association, created_at: at, body, url: 'u'});
const OVERRIDE = comment('jayleekr', 'Release manager override: P0 run by hand on the pre-tester Mac; results in the thread');
const good = () => ({
  pr: {number: 3159, state: 'open', merged: false, labels: ['release'], base: 'main', headRef: `release/${V}`, head: HEAD,
    headRepository: 'hypeproof/hypeproof-studio', baseRepository: 'hypeproof/hypeproof-studio',
    headDate: HEAD_DATE, comments: [OVERRIDE], reviews: [{user: 'minhan', state: 'APPROVED', commit: HEAD}]},
  p0: P0,
  commit: {sha: HEAD, parents: [CAND], message: `release: record ${RC}`, files: [`releases/${V}.md`]},
  rcTags: [{name: `${V}-rc.1`, sha: OTHER}, {name: RC, sha: CAND}],
  writers: new Set(['minhan']), vTagSha: '',
  rcRelease: {isDraft: false, assets: rcAssets}, mergeState: 'CLEAN',
});
const with_ = (patch) => { const f = good(); for (const [k, v] of Object.entries(patch)) f[k] = typeof v === 'function' ? v(f[k]) : v; return f; };

test('RC reads use current remote refs and peel annotated tags without a cached checkout list', () => {
  let phase = 1;
  const read = (...args) => {
    assert.deepEqual(args, ['ls-remote','--tags','origin',`refs/tags/${V}-rc.*`]);
    return `${OTHER}\trefs/tags/${V}-rc.1\n${CAND}\trefs/tags/${V}-rc.1^{}\n` +
      (phase === 2 ? `${HEAD}\trefs/tags/${V}-rc.2\n` : '');
  };
  assert.deepEqual(rcTagsOf(V, read), [{name: `${V}-rc.1`, sha: CAND}]);
  phase = 2;
  assert.equal(rcTagsOf(V, read).length, 2);
});

test('verified complete machine PASS promotes without human review; invalid machine evidence never falls back to approval', t => {
  const f = machineFixture(t), c = f.contract, authority = f.verify();
  const facts = good();
  facts.pr = {...facts.pr, number: c.releasePr, head: c.releaseHead, headRef: `release/${c.version}`, reviews: [], comments: []};
  facts.commit = {...facts.commit, sha: c.releaseHead, parents: [c.candidate], message: `release: record ${c.rcTag}`, files: [`releases/${c.version}.md`]};
  facts.rcTags = [{name: c.rcTag, sha: c.candidate}];
  facts.rcRelease.assets = [...c.artifacts.map(a => ({name: a.name, digest: 'sha256:' + a.sha256})), {name: 'unified-acceptance.json'}];
  facts.writers = new Set();
  assert.equal(promotionDecision(facts).allow, false);
  assert.equal(promotionDecision({...facts, machineAuthority: authority}).allow, true);
  for (const label of ['blocked', 'hold', 'do-not-merge', 'human-needed']) {
    facts.pr.labels.push(label); assert.equal(promotionDecision({...facts, machineAuthority: authority}).allow, false); facts.pr.labels.pop();
  }
  facts.pr.headRepository = 'other/hypeproof-studio';
  assert.equal(promotionDecision({...facts, machineAuthority: authority}).allow, false);
  facts.pr.headRepository = 'hypeproof/hypeproof-studio';
  facts.pr.reviews = [{user: 'reviewer', state: 'CHANGES_REQUESTED', commit: OTHER}];
  assert.equal(promotionDecision({...facts, machineAuthority: authority}).allow, false);
  facts.pr.reviews = [{user: 'minhan', state: 'APPROVED', commit: c.releaseHead}];
  facts.pr.comments = [OVERRIDE]; facts.writers.add('minhan');
  for (const change of [{allow: false}, {candidate: OTHER}, {releaseHead: OTHER}, {tag: 'v2026.1109.9'}, {status: 'READY'}]) {
    assert.equal(promotionDecision({...facts, machineAuthority: {...authority, ...change}}).allow, false);
  }
});

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
    'required check (extension / smoke) pending or failed': {mergeState: 'BLOCKED'},
    'merge state unread': {mergeState: ''},
    'merge state still unknown': {mergeState: 'UNKNOWN'},
    'conflicting release branch': {mergeState: 'DIRTY'},
    // #3513: the casebook gate of #3429 applies at promotion too, not only at publication.
    'casebook P0 list not read': {p0: undefined},
    'casebook neither run nor overridden': {pr: pr => ({...pr, comments: []})},
    'override without a reason': {pr: pr => ({...pr, comments: [comment('jayleekr', 'Release manager override')]})},
    'override by a non-approving writer': {pr: pr => ({...pr, comments: [comment('otherwriter', OVERRIDE.body)]})},
    'override older than the head commit': {pr: pr => ({...pr, comments: [{...OVERRIDE, created_at: '2026-10-29T09:00:00Z'}]})},
  };
  for (const [name, patch] of Object.entries(cases)) {
    const v = promotionDecision(with_(patch));
    assert.equal(v.allow, false, name);
    assert.ok(v.reasons.length, `${name}: a refusal names its reason`);
  }
});

test('#3513: the casebook evidence the publish gate needs reaches it from promotion', () => {
  const v = promotionDecision(good());
  assert.match(v.reasons.join('\n'), /casebook: release manager override by jayleekr/);
  // The approving writer may override too, and an empty P0 list needs neither run nor override.
  assert.equal(promotionDecision(with_({pr: pr => ({...pr, comments: [comment('minhan', OVERRIDE.body)]})})).allow, true);
  assert.equal(promotionDecision(with_({p0: [], pr: pr => ({...pr, comments: []})})).allow, true);
  const refused = promotionDecision(with_({pr: pr => ({...pr, comments: []})}));
  assert.match(refused.reasons.join('\n'), /casebook not run at the head: no hps-blackbox-run\/1 PASS for P0 BB-001, BB-005/);
  assert.doesNotMatch(refused.reasons.join('\n'), /^hotfix:/m, 'promotion names only the approval route');
  assert.match(promotionDecision(with_({p0: undefined})).reasons.join('\n'), /casebook P0 list was not read/);
});

test('#3512: a release PR whose required checks are not green is refused before the v tag', () => {
  const mergeReason = facts => promotionDecision(facts).reasons.find(r => /required check|would not accept the merge/.test(r));
  const blocked = promotionDecision(with_({mergeState: 'BLOCKED'}));
  assert.equal(blocked.allow, false);
  assert.match(blocked.reasons[0], /required check on the release PR head is not green yet \(extension \/ smoke/);
  for (const state of ['', 'UNKNOWN', 'DIRTY', 'DRAFT']) assert.match(mergeReason(with_({mergeState: state})), /would not accept the merge/, state);
  // A failing check main does not require leaves the merge to GitHub, as do CLEAN and HAS_HOOKS.
  for (const state of ['CLEAN', 'UNSTABLE', 'HAS_HOOKS']) assert.equal(mergeReason(with_({mergeState: state})), undefined, state);
  // After the merge the state no longer matters, so a rerun still finishes the release.
  assert.equal(mergeReason(with_({pr: pr => ({...pr, state: 'closed', merged: true}), vTagSha: CAND, mergeState: ''})), undefined);
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
  assert.equal(job.steps[0].with.ref, "${{ github.event_name == 'workflow_dispatch' && github.sha || github.event.repository.default_branch }}",
    'dispatch source is immutable; approvals keep the default-branch policy');
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

test('#3513: studio-pr-ci runs every release control, so a change that breaks one fails its PR', () => {
  const text = fs.readFileSync(`${root}.github/workflows/pr-ci.yml`, 'utf8');
  const files = fs.readdirSync(`${root}scripts/release/test`).filter(f => f.endsWith('.test.mjs'));
  const missing = files.filter(f => !text.includes(`scripts/release/test/${f}`));
  assert.deepEqual(missing, [], 'add these to a `node --test` line in .github/workflows/pr-ci.yml');
  // release-promote's own Controls step runs these two before it touches a tag.
  assert.match(fs.readFileSync(`${root}.github/workflows/release-promote.yml`, 'utf8'), /node --test scripts\/release\/test\/promote\.test\.mjs scripts\/release\/test\/publish-gate\.test\.mjs/);
});

test('actual final publication block refuses failed machine/freeze gates and observes publication before dispatch', {skip: process.platform === 'win32'}, t => {
  const doc = workflow('verify-unified-release.yml'), steps = doc.jobs.publish.steps;
  assert.equal(steps[0].with.ref, '${{ github.event.repository.default_branch }}');
  const final = steps.find(s => s.name === 'Publish and dispatch the public mirror');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-publish-boundary-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  fs.mkdirSync(path.join(temp, 'dist'));
  fs.writeFileSync(path.join(temp, 'dist/unified-acceptance.json'), '{}');
  const stub = `#!/usr/bin/python3
import json, os, pathlib, sys
name=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
def record(value):
    with open(os.environ['BOUNDARY_LOG'], 'a') as f: f.write(value+'\\n')
if name=='gh':
    if args[:2]==['release','view']:
        print('true' if 'isDraft' in args else '{}')
    elif args[:2]==['release','upload']: record('UPLOAD')
    elif args[:2]==['release','edit'] and '--draft=false' in args: record('PUBLISH')
    elif args and args[0]=='api':
        record('OBSERVE'); print(json.dumps({'draft':os.environ.get('FAIL_OBSERVATION')=='1','prerelease':False,'tag_name':os.environ['TAG']}))
    elif args[:2]==['workflow','run']: record('DISPATCH')
    else: raise SystemExit('unexpected gh operation')
elif name=='node':
    if args[0]=='--input-type=module': os.execv(os.environ['REAL_NODE'], [os.environ['REAL_NODE'], *args])
    elif args[0].endswith('/platforms.mjs'): print('["darwin-arm64"]')
    elif args[0].endswith('/install-kit.mjs'): sys.stdin.read()
    elif args[0].endswith('/publish-gate.mjs'):
        record('MACHINE'); raise SystemExit(int(os.environ.get('FAIL_MACHINE','0')))
    else: raise SystemExit('unexpected node operation')
elif name=='bash' and args[0].endswith('/release-freeze-gate.sh'):
    assert os.environ.get('HPS_FREEZE_OVERRIDE')=='false'
    record('FREEZE'); raise SystemExit(int(os.environ.get('FAIL_FREEZE','0')))
else: raise SystemExit('unexpected executable')
`;
  for (const name of ['gh','node','bash']) fs.writeFileSync(path.join(temp, name), stub, {mode: 0o755});
  for (const [label, extra] of Object.entries({pass: {}, machine: {FAIL_MACHINE: '1'}, freeze: {FAIL_FREEZE: '1'}, uncertain: {FAIL_OBSERVATION: '1'}})) {
    const log = path.join(temp, label + '.log');
    const run = spawnSync('/bin/bash', ['-c', final.run], {cwd: temp, encoding: 'utf8', env: {...process.env,
      PATH: temp + ':' + process.env.PATH, BOUNDARY_LOG: log, REAL_NODE: process.execPath,
      TAG: V, MACHINE_PR: '33', SOURCE_SHA: CAND, GITHUB_REPOSITORY: 'hypeproof/hypeproof-studio', RUNNER_TEMP: temp,
      FAIL_MACHINE: '0', FAIL_FREEZE: '0', FAIL_OBSERVATION: '0', ...extra}});
    const events = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    if (label === 'pass') {
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(events, ['UPLOAD','MACHINE','FREEZE','PUBLISH','OBSERVE','DISPATCH','DISPATCH']);
    } else {
      assert.notEqual(run.status, 0, label);
      assert.equal(events.includes('DISPATCH'), false, label);
      assert.equal(events.includes('PUBLISH'), label === 'uncertain', label);
    }
  }
});

test('machine evidence capabilities are read-only and scoped to one fixed private repository', () => {
  for (const name of ['release-promote.yml','verify-unified-release.yml']) {
    const doc = workflow(name);
    const readers = Object.values(doc.jobs).flatMap(job => job.steps ?? []).filter(s => s.with?.repositories === 'hypeproof-studio-releases');
    assert.ok(readers.length > 0);
    for (const step of readers) assert.equal(step.with['permission-contents'], 'read');
  }
});

test('accepted receipt byte reader remains independent of active publication authority and holds', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-reader-control-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const value = {schema: 'hps-unified-release/1', control: 'transport bytes only'}, bytes = JSON.stringify(value);
  fs.writeFileSync(path.join(directory, 'unified-acceptance.json'), bytes);
  const facts = good(); facts.pr.labels.push('hold');
  facts.rcRelease.assets = facts.rcRelease.assets.map(asset => asset.name === 'unified-acceptance.json'
    ? {...asset, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')} : asset);
  assert.deepEqual(readAcceptedReceipt(facts, 'hypeproof/hypeproof-studio', directory), value);
});
