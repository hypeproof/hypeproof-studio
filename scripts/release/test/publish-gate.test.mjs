// Controls for the publish gate. Pure decisions; no GitHub or git calls.
//   node --test scripts/release/test/publish-gate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {decide} from '../publish-gate.mjs';

const TAG = 'v2026.1013.0';
const SHA = 'a'.repeat(40);
const rc = [{name: `${TAG}-rc.1`, sha: SHA}];
const writers = new Set(['minhan']);
const HEAD = 'd'.repeat(40);
const releasePr = (reviews, labels = ['release']) => [{number: 9, labels, head: HEAD, reviews: reviews.map(r => ({commit: HEAD, ...r}))}];
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
  const v = decide({tag: TAG, tagSha: SHA, rcTags: rc, writers, releasePrs: releasePr([{user: 'minhan', state: 'APPROVED'}])});
  assert.deepEqual([v.allow, v.route], [true, 'approval']);
});

test('approval route refuses: non-writer, later change request, missing label, rc on another commit', () => {
  const base = {tag: TAG, tagSha: SHA, rcTags: rc, writers};
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
