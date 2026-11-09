import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {reconcileAutomaticReviews, releaseCopy, candidateNote} from '../release-review-requests.mjs';
const repo = 'hypeproof/hypeproof-studio', head = 'b'.repeat(40);
const plan = {schema: 'hps-release-plan/0', mode: 'create', trial: false, version: 'v2026.1109.0', rcTag: 'v2026.1109.0-rc.1', branch: 'release/v2026.1109.0', candidate: 'a'.repeat(40)};
const user = (id, flag, login) => ({id, asCodeOwner: flag, requestedReviewer: {__typename: 'User', login}});
function fixture(requests) {
  const state = {requests, deletes: [], reads: 0, beforeRead: () => {}, failDelete: false,
    pr: {repository: {nameWithOwner: repo}, headRepository: {nameWithOwner: repo}, baseRefName: 'main', headRefName: plan.branch, headRefOid: head, reviewDecision: 'REVIEW_REQUIRED',
      labels: {totalCount: 1, nodes: [{name: 'release'}]}, files: {totalCount: 1, nodes: [{path: `releases/${plan.version}.md`}]},
      commits: {nodes: [{commit: {oid: head, message: 'release: record ' + plan.rcTag, parents: {totalCount: 1, nodes: [{oid: plan.candidate}]}}}]}}};
  const gh = (...args) => {
    if (args.includes('graphql')) {
      assert.ok(args.includes('--paginate') && args.includes('--slurp'));
      state.beforeRead(++state.reads, state);
      const chunks = state.requests.length ? state.requests.map(row => [row]) : [[]];
      return JSON.stringify(chunks.map((nodes, i) => ({data: {repository: {pullRequest: {...state.pr,
        reviewRequests: {nodes, pageInfo: {hasNextPage: i < chunks.length - 1, endCursor: String(i)}}}}}})));
    }
    assert.deepEqual(args.slice(0, 6), ['api','--hostname','github.com','--method','DELETE',`repos/${repo}/pulls/17/requested_reviewers`]);
    const [field, login] = args[7].split('='); state.deletes.push([field, login]);
    state.requests = state.requests.filter(row => (row.requestedReviewer.login ?? row.requestedReviewer.slug).toLowerCase() !== login);
    if (state.failDelete) { state.failDelete = false; throw Error('uncertain DELETE response'); }
    return '{}';
  };
  return {state, run: (active = true) => reconcileAutomaticReviews({active, plan, number: 17, head, gh})};
}
test('active create/update reconciliation removes only automatic User/Team requests from all pages', () => {
  const manual = user('manual', false, 'manual-owner'), unknown = user('unknown', undefined, 'unknown-owner');
  const f = fixture([user('auto', true, 'Automatic-Owner'), {id:'team', asCodeOwner:true, requestedReviewer:{__typename:'Team',slug:'release-team'}}, manual, unknown]);
  assert.equal(f.run().removed, 2); assert.deepEqual(f.state.requests, [manual, unknown]);
  assert.deepEqual(f.state.deletes, [['reviewers[]','automatic-owner'],['team_reviewers[]','release-team']]);
  assert.equal(f.run().removed, 0, 'an update/retry observes existing manual requests without deleting them');
});
test('manual conversion, explicit duplicate requests, holds and moved scope preserve requests', () => {
  for (const flag of [false, undefined]) {
    const f = fixture([user('auto', true, 'owner')]); f.state.beforeRead = (n, state) => { if (n === 2) state.requests[0].asCodeOwner = flag; };
    assert.equal(f.run().removed, 0); assert.deepEqual(f.state.deletes, []);
  }
  const duplicate = fixture([user('auto', true, 'owner'), user('manual', false, 'Owner')]);
  assert.equal(duplicate.run().removed, 0); assert.equal(duplicate.state.requests.length, 2);
  for (const mutate of [p => { p.labels.nodes.push({name:'human-needed'}); p.labels.totalCount++; }, p => { p.reviewDecision = 'CHANGES_REQUESTED'; }]) {
    const f = fixture([user('auto', true, 'owner')]); mutate(f.state.pr); assert.equal(f.run().status, 'HELD'); assert.deepEqual(f.state.deletes, []);
  }
  for (const mutate of [p => { p.headRepository.nameWithOwner = 'other/fork'; }, p => { p.files.totalCount = 2; }, p => { p.baseRefName = 'other'; }, p => { p.headRefName = 'feat/source'; }, p => { p.headRefOid = 'c'.repeat(40); }]) {
    const f = fixture([user('auto', true, 'owner')]); f.state.beforeRead = (n, state) => { if (n === 2) mutate(state.pr); };
    assert.throws(() => f.run(), /release record/); assert.deepEqual(f.state.deletes, []);
  }
});
test('shadow/unknown enrollment does no reads, and uncertain deletion is reconciled without replay', () => {
  for (const active of [false, undefined, 'shadow']) assert.equal(reconcileAutomaticReviews({active, gh: () => assert.fail('unexpected effect')}).status, 'SHADOW');
  for (const patch of [{mode:'dry-run'},{trial:true}]) assert.throws(() => reconcileAutomaticReviews({active:true, plan:{...plan,...patch}, number:17, head, gh:()=>assert.fail('unexpected effect')}), /non-trial create/);
  const f = fixture([user('auto', true, 'owner')]); f.state.failDelete = true;
  assert.throws(() => f.run(), /uncertain/); assert.equal(f.run().removed, 0); assert.equal(f.state.deletes.length, 1);
});
test('active release copy preserves case procedures and replaces member-review solicitation; shadow is byte-identical', () => {
  const row = '- [ ] **BB-004** P0 Native start — Open';
  const body = fs.readFileSync(new URL('../templates/release-pr.md', import.meta.url), 'utf8').replace('{{BLACKBOX_CASES}}', row);
  assert.equal(releaseCopy(body, false), body);
  const active = releaseCopy(body, true); assert.ok(active.includes(row)); assert.ok(active.includes('## 8. Machine publication')); assert.ok(active.includes('docs/operations/release-casebook/README.md'));
  assert.doesNotMatch(active, /an approving review|every box above ticked|the release manager runs the rest/i);
  assert.doesNotMatch(candidateNote(plan, true), /review again|Approvals given/);
  assert.match(candidateNote(plan, false), /review again/); assert.throws(() => releaseCopy('unknown template', true), /known release template/);
});
