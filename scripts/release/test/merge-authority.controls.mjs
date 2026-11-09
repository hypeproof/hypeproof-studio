import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {MERGE_POLICY_REPOSITORY, MERGE_POLICY_PATH, MERGE_POLICY_INDEX, MERGE_POLICY_SHA256,
  readCanonicalMergeAuthority, validateMergeAuthority, validateMergeIndex, validateMachineChecks, machineReviewHolds, readMachineCheckSnapshot} from '../merge-authority.mjs';
const rule = fs.readFileSync(new URL('./fixtures/release-merge-authority.approved.json', import.meta.url));
const index = fs.readFileSync(new URL('./fixtures/release-merge-index.approved.yaml', import.meta.url));
const sameRepo = {headRepository: 'hypeproof/hypeproof-studio', baseRepository: 'hypeproof/hypeproof-studio'};
const head = 'a'.repeat(40), required = validateMergeIndex(index).required_status_checks;
const check = (name, conclusion = 'SUCCESS', at = '2026-11-09T01:00:00Z') => ({__typename: 'CheckRun', name,
  workflowName: 'studio-pr-ci', conclusion, status: conclusion ? 'COMPLETED' : 'IN_PROGRESS', completedAt: at});
const snapshot = () => ({headRefOid: head, isDraft: false, reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: required.map(name => check(name))});
test('canonical delegation reads current main and both fixed files at its immutable SHA through a separate read token', () => {
  let current = 'b'.repeat(40), revoked = false; const calls = [];
  const get = (endpoint, token) => {
    calls.push(endpoint); assert.equal(token, 'generated-read-capability');
    if (endpoint.endsWith('/git/ref/heads/main')) return {ref: 'refs/heads/main', object: {type: 'commit', sha: current}};
    assert.ok(endpoint.endsWith('?ref=' + current));
    const name = endpoint.includes('/contents/' + MERGE_POLICY_INDEX + '?') ? MERGE_POLICY_INDEX : MERGE_POLICY_PATH;
    const bytes = name === MERGE_POLICY_INDEX ? index : revoked ? Buffer.from('{}') : rule;
    return {type: 'file', path: name, encoding: 'base64', content: bytes.toString('base64')};
  };
  const first = readCanonicalMergeAuthority({token: 'generated-read-capability', get});
  assert.equal(first.sha256, MERGE_POLICY_SHA256); assert.deepEqual(first.requiredChecks, required);
  current = 'c'.repeat(40); assert.equal(readCanonicalMergeAuthority({token: 'generated-read-capability', get}).commit, current);
  assert.ok(calls.every(endpoint => endpoint.startsWith('repos/' + MERGE_POLICY_REPOSITORY + '/')));
  revoked = true; assert.throws(() => readCanonicalMergeAuthority({token: 'generated-read-capability', get}), /changed or revoked/);
  assert.throws(() => readCanonicalMergeAuthority({token: '', get: () => assert.fail('unexpected read')}), /separate Harness/);
  assert.throws(() => readCanonicalMergeAuthority({token: 'generated', get: () => { throw Error('unavailable'); }}), /unavailable/);
  assert.equal(validateMergeAuthority(rule).authority, 'trusted-machine-publisher');
  assert.throws(() => validateMergeAuthority(Buffer.from(rule.toString().replace('trusted-machine-publisher', 'revoked'))), /changed or revoked/);
});
test('canonical index unlink, retirement, duplicate and unsupported records revoke delegation', () => {
  const text = index.toString();
  for (const changed of [text.replace('    release_record_merge_policy: ' + MERGE_POLICY_PATH + '\n', ''),
    text.replace(MERGE_POLICY_PATH, 'policy/other.json'), text.replace('lifecycle: product', 'lifecycle: retired'),
    text.replace('profile: public-product', 'profile: archive'), text.replace('profile: public-product', 'profile: public-product\n      unexpected: scalar'), text.replace('default_branch: main', 'default_branch: other'),
    text + text.slice(text.indexOf('  - owner:')), text.replace('    name:', '    owner: duplicate\n    name:'),
    text.replace('repositories:', 'repositories: []'), text.replace('    required_status_checks:', '    required_status_checks: []')]) {
    assert.throws(() => validateMergeIndex(Buffer.from(changed)));
  }
  assert.equal(validateMergeIndex(index).name, 'hypeproof-studio');
});
test('machine CI requires the current head and every canonical name, with canonical green rerun semantics', () => {
  assert.equal(validateMachineChecks(snapshot(), head, required).status, 'CURRENT_CHECKS_PASS');
  const acceptable = snapshot(); acceptable.statusCheckRollup[0].conclusion = 'NEUTRAL'; acceptable.statusCheckRollup[1].conclusion = 'SKIPPED';
  assert.equal(validateMachineChecks(acceptable, head, required).status, 'CURRENT_CHECKS_PASS');
  for (const mutate of [s => { s.headRefOid = 'f'.repeat(40); }, s => { s.statusCheckRollup.pop(); },
    s => { s.statusCheckRollup = []; }, s => { s.statusCheckRollup[0] = check(required[0], null); },
    s => { s.statusCheckRollup[0].conclusion = 'FAILURE'; }, s => { s.statusCheckRollup.push(check('extra current job', 'FAILURE')); },
    s => { s.statusCheckRollup.push({__typename: 'Unknown'}); }, s => { s.statusCheckRollup.push({__typename: 'StatusContext', context: '', state: 'SUCCESS'}); }, s => { s.isDraft = true; }, s => { s.reviewDecision = 'CHANGES_REQUESTED'; }]) {
    const changed = snapshot(); mutate(changed); assert.throws(() => validateMachineChecks(changed, head, required));
  }
  const rerun = snapshot(); rerun.statusCheckRollup.push(check(required[0], 'FAILURE', '2026-11-09T00:00:00Z'));
  assert.equal(validateMachineChecks(rerun, head, required).status, 'CURRENT_CHECKS_PASS');
  rerun.statusCheckRollup.push(check(required[0], 'FAILURE', '2026-11-09T02:00:00Z'));
  assert.throws(() => validateMachineChecks(rerun, head, required), /current checks/);
  const unordered = snapshot(); unordered.statusCheckRollup.push({...check(required[0], 'FAILURE'), completedAt: ''});
  assert.throws(() => validateMachineChecks(unordered, head, required), /current checks/);
  const gate = snapshot(); gate.statusCheckRollup.push(check('control-plane (human gate)', 'FAILURE', '2026-11-09T00:00:00Z'), check('control-plane (human gate)', 'SUCCESS'));
  assert.equal(validateMachineChecks(gate, head, required).status, 'CURRENT_CHECKS_PASS');
  gate.statusCheckRollup.push(check('control-plane (human gate)', 'SKIPPED', '2026-11-09T02:00:00Z'));
  assert.throws(() => validateMachineChecks(gate, head, required), /control-plane/);
});
test('machine holds include every blocking label and current substantive changes-requested reviewer', () => {
  for (const label of ['blocked','hold','do-not-merge','human-needed','Human Needed']) assert.ok(machineReviewHolds({...sameRepo, labels: ['release', label], reviews: []}).length);
  const pr = {...sameRepo, labels: ['release'], reviews: [{user: 'reviewer', state: 'CHANGES_REQUESTED'}, {user: 'reviewer', state: 'COMMENTED'}]};
  assert.ok(machineReviewHolds(pr).length); pr.reviews.push({user: 'reviewer', state: 'APPROVED'}); assert.deepEqual(machineReviewHolds(pr), []);
  assert.deepEqual(machineReviewHolds({...sameRepo, labels: ['release'], reviews: []}), [], 'machine delegation adds no per-RC approval count');
});
test('parent and child mint only Harness contents-read tokens and pass them to effect gates', () => {
  for (const name of ['release-promote.yml','verify-unified-release.yml']) {
    const filename = fileURLToPath(new URL('../../../.github/workflows/' + name, import.meta.url));
    const doc = JSON.parse(execFileSync('python3', ['-c', 'import yaml,json,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', filename], {encoding: 'utf8'}));
    assert.equal(doc.permissions.checks, 'read'); assert.equal(doc.permissions.statuses, 'read');
    const steps = (doc.jobs.promote ?? doc.jobs.publish).steps, token = steps.find(step => step.id === 'merge-policy');
    assert.equal(token.with.repositories, 'hypeproof-harness'); assert.equal(token.with['permission-contents'], 'read');
    assert.deepEqual(Object.keys(token.with).sort(), ['app-id','permission-contents','private-key','repositories']);
    assert.equal(steps.filter(step => step.env?.HPS_MERGE_POLICY_READ_TOKEN === '${{ steps.merge-policy.outputs.token }}').length, name === 'release-promote.yml' ? 1 : 2);
  }
});

test('machine checks consume all context pages and reject partial pages or a moved PR head', () => {
  const page = (nodes, more, cursor) => ({data: {repository: {pullRequest: {headRefOid: head, isDraft: false,
    reviewDecision: 'REVIEW_REQUIRED', commits: {nodes: [{commit: {oid: head, statusCheckRollup: {
      contexts: {nodes, pageInfo: {hasNextPage: more, endCursor: cursor}}}}}]}}}}});
  const pages = [page(required.slice(0, 2).map(name => check(name)), true, 'cursor-1'), page(required.slice(2).map(name => check(name)), false, null)];
  const read = value => readMachineCheckSnapshot({number: 33, repository: 'hypeproof/hypeproof-studio', head, get: () => value});
  assert.equal(validateMachineChecks(read(pages), head, required).status, 'CURRENT_CHECKS_PASS');
  assert.throws(() => read(pages.slice(0, 1)), /pagination/);
  const red = structuredClone(pages); red[1].data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].conclusion = 'FAILURE';
  assert.throws(() => validateMachineChecks(read(red), head, required), /current checks/);
  const moved = structuredClone(pages); moved[1].data.repository.pullRequest.headRefOid = 'b'.repeat(40); assert.throws(() => read(moved), /head changed/);
});
