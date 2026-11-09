import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {reconcileAutomaticReviews, releaseCopy, candidateNote} from '../release-review-requests.mjs';
const repo = 'hypeproof/hypeproof-studio', head = 'b'.repeat(40);
const plan = {schema: 'hps-release-plan/0', mode: 'create', trial: false, version: 'v2026.1109.0', rcTag: 'v2026.1109.0-rc.1', branch: 'release/v2026.1109.0', candidate: 'a'.repeat(40)};
const user = (id, flag, login) => ({id, asCodeOwner: flag, requestedReviewer: {__typename: 'User', login}});
function fixture(requests) {
  const state = {requests, reviews: [], deletes: [], reads: 0, historyReads: 0, beforeRead: () => {}, beforeHistoryRead: () => {}, editHistoryPages: pages => pages, failDelete: false,
    pr: {repository: {nameWithOwner: repo}, headRepository: {nameWithOwner: repo}, baseRefName: 'main', headRefName: plan.branch, headRefOid: head, reviewDecision: 'REVIEW_REQUIRED',
      labels: {totalCount: 1, nodes: [{name: 'release'}]}, files: {totalCount: 1, nodes: [{path: `releases/${plan.version}.md`}]},
      commits: {nodes: [{commit: {oid: head, message: 'release: record ' + plan.rcTag, parents: {totalCount: 1, nodes: [{oid: plan.candidate}]}}}]}}};
  const gh = (...args) => {
    if (args.includes('graphql')) {
      assert.ok(args.includes('--paginate') && args.includes('--slurp'));
      const query = args.find(arg => arg.startsWith('query='));
      if (query.includes('reviews(first:')) {
        state.beforeHistoryRead(++state.historyReads, state);
        const chunks = state.reviews.length ? state.reviews.map(row => [row]) : [[]];
        const pages = chunks.map((nodes, i) => ({data: {repository: {pullRequest: {headRefOid: state.pr.headRefOid,
          reviews: {totalCount: state.reviews.length, nodes, pageInfo: {hasNextPage: i < chunks.length - 1, endCursor: nodes.length ? String(i) : null}}}}}}));
        return JSON.stringify(state.editHistoryPages(pages));
      }
      assert.ok(query.includes('reviewRequests(first:'));
      state.beforeRead(++state.reads, state);
      const chunks = state.requests.length ? state.requests.map(row => [row]) : [[]];
      return JSON.stringify(chunks.map((nodes, i) => ({data: {repository: {pullRequest: {...state.pr,
        reviewRequests: {totalCount: state.requests.length, nodes, pageInfo: {hasNextPage: i < chunks.length - 1, endCursor: nodes.length ? String(i) : null}}}}}})));
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
    assert.throws(() => f.run(), /release record|unchanged release head/); assert.deepEqual(f.state.deletes, []);
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

const review = (id, state, submittedAt, login = 'human-owner') => ({id, state, submittedAt, author: {login}});
const change = () => review('change', 'CHANGES_REQUESTED', '2026-11-09T12:00:00Z');
test('unprotected aggregate-empty records preserve substantive human holds across every review page', () => {
  const f = fixture([user('auto', true, 'owner')]); f.state.pr.reviewDecision = '';
  f.state.reviews = [change(), review('comment', 'COMMENTED', '2026-11-09T12:01:00Z')];
  assert.equal(f.run().status, 'HELD'); assert.deepEqual(f.state.deletes, []);
  assert.equal(f.state.historyReads, 1, 'initial complete paginated history prevents cleanup');
  for (const state of ['APPROVED', 'DISMISSED']) {
    const cleared = fixture([user('auto', true, 'owner')]); cleared.state.pr.reviewDecision = '';
    // Order of pages is not authority; only a proven later substantive state can clear a hold.
    cleared.state.reviews = [review('clear', state, '2026-11-09T12:02:00Z', 'Human-Owner'), change(), review('comment', 'COMMENTED', '2026-11-09T12:03:00Z')];
    assert.equal(cleared.run().removed, 1); assert.equal(cleared.state.deletes.length, 1);
  }
  const other = fixture([user('auto', true, 'owner')]); other.state.pr.reviewDecision = '';
  other.state.reviews = [change(), review('other', 'APPROVED', '2026-11-09T12:02:00Z', 'someone-else')];
  assert.equal(other.run().status, 'HELD'); assert.deepEqual(other.state.deletes, []);
});
test('every DELETE revalidates full substantive review history and fails closed when it is unavailable', () => {
  const f = fixture([user('auto', true, 'owner')]); f.state.pr.reviewDecision = '';
  f.state.beforeHistoryRead = (n, state) => { if (n === 2) state.reviews = [change(), review('comment', 'COMMENTED', '2026-11-09T12:01:00Z')]; };
  assert.equal(f.run().status, 'HELD'); assert.deepEqual(f.state.deletes, []);
  const unavailable = fixture([user('auto', true, 'owner')]);
  unavailable.state.beforeHistoryRead = n => { if (n === 2) throw Error('history unavailable'); };
  assert.throws(() => unavailable.run(), /unavailable/); assert.deepEqual(unavailable.state.deletes, []);
});
test('partial, changed, repeated or unattributed review history never authorizes request deletion', () => {
  for (const edit of [
    pages => pages.slice(0, 1),
    pages => { pages[0].data.repository.pullRequest.reviews.totalCount++; return pages; },
    pages => { pages[1].data.repository.pullRequest.reviews.totalCount++; return pages; },
    pages => { pages[1].data.repository.pullRequest.reviews.pageInfo.endCursor = '0'; return pages; },
    pages => { pages[1].data.repository.pullRequest.headRefOid = 'c'.repeat(40); return pages; },
    pages => { pages[1].data.repository.pullRequest.reviews.nodes[0].id = 'change'; return pages; },
    pages => { pages[0].errors = [{message:'partial'}]; return pages; },
    pages => { pages[0].data.repository.pullRequest.reviews.nodes[0].author = null; return pages; },
    pages => { pages[0].data.repository.pullRequest.reviews.nodes[0].state = 'UNKNOWN'; return pages; },
    pages => { pages[0].data.repository.pullRequest.reviews.nodes[0].submittedAt = null; return pages; }
  ]) {
    const f = fixture([user('auto', true, 'owner')]); f.state.pr.reviewDecision = '';
    f.state.reviews = [change(), review('clear', 'APPROVED', '2026-11-09T12:02:00Z')]; f.state.editHistoryPages = edit;
    assert.throws(() => f.run(), /review|pagination/); assert.deepEqual(f.state.deletes, []);
  }
});
test('review chronology preserves tied or unknown holds and compares sub-millisecond timestamps exactly', () => {
  for (const at of ['2026-11-09T12:00:00Z', null, 'invalid', '2026-02-30T12:00:00Z']) {
    const f = fixture([user('auto', true, 'owner')]); f.state.pr.reviewDecision = '';
    f.state.reviews = [change(), review('clear', 'APPROVED', at)];
    assert.throws(() => f.run(), /chronology/); assert.deepEqual(f.state.deletes, []);
  }
  for (const newerGreen of [true, false]) {
    const f = fixture([user('auto', true, 'owner')]); f.state.pr.reviewDecision = '';
    f.state.reviews = [review('clear', 'APPROVED', `2026-11-09T12:00:00.00000000${newerGreen ? 2 : 1}Z`),
      review('change', 'CHANGES_REQUESTED', `2026-11-09T12:00:00.00000000${newerGreen ? 1 : 2}Z`)];
    const result = f.run(); assert.equal(result.removed, newerGreen ? 1 : 0);
    assert.equal(result.status, newerGreen ? 'RECONCILED' : 'HELD');
  }
});
