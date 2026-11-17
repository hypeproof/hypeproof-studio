// Controls for the release-blocker gate. No GitHub calls: readBlockers gets a fake runner.
//   node --test scripts/release/test/release-blockers.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BLOCKER_LABEL, BLOCKER_REPOS, blockerDecision, checkBlockers, readBlockers} from '../release-blockers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, '..', name), 'utf8');
const none = BLOCKER_REPOS.map(repo => ({repo, issues: []}));

test('no open blocker in any of the three repos allows the release (positive control)', () => {
  assert.deepEqual(BLOCKER_REPOS, ['hypeproof/hypeproof-studio', 'hypeproof/hypeproof-service', 'hypeproof/hypeprooflab']);
  const v = blockerDecision(none);
  assert.equal(v.allow, true);
  assert.deepEqual(v.reasons, []);
});

test('an open blocker in any repo refuses and names it', () => {
  for (const repo of BLOCKER_REPOS) {
    const results = none.map(r => r.repo === repo
      ? {repo, issues: [{number: 7, title: 'Black-box FAIL: s3', url: `https://github.com/${repo}/issues/7`}]} : r);
    const v = blockerDecision(results);
    assert.equal(v.allow, false, repo);
    assert.equal(v.blockers.length, 1);
    assert.match(v.reasons[0], new RegExp(`open ${BLOCKER_LABEL}: https://github.com/${repo}/issues/7 — Black-box FAIL: s3`));
  }
});

test('an unreadable or missing repo refuses (fail closed)', () => {
  const v = blockerDecision(none.map(r => r.repo === 'hypeproof/hypeproof-service' ? {repo: r.repo, error: 'HTTP 403'} : r));
  assert.equal(v.allow, false);
  assert.match(v.reasons[0], /cannot read release-blocker issues in hypeproof\/hypeproof-service \(HTTP 403\)/);
  assert.equal(blockerDecision(none.slice(0, 2)).allow, false);
  assert.equal(blockerDecision([]).allow, false);
});

test('readBlockers asks each repo for open issues with the label, with the blocker token', () => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({cmd, args, token: opts.env.GH_TOKEN});
    return args.includes('hypeproof/hypeprooflab') ? JSON.stringify([{number: 1, title: 't', url: 'u'}]) : '[]';
  };
  const v = checkBlockers({env: {RELEASE_BLOCKER_TOKEN: 'blocker', GH_TOKEN: 'workflow'}, run});
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.cmd, 'gh');
    assert.equal(c.token, 'blocker');
    assert.deepEqual(c.args.slice(0, 2), ['issue', 'list']);
    assert.ok(c.args.includes('--state') && c.args[c.args.indexOf('--state') + 1] === 'open');
    assert.ok(c.args[c.args.indexOf('--label') + 1] === BLOCKER_LABEL);
  }
  assert.equal(v.allow, false);
  assert.equal(v.blockers[0].repo, 'hypeproof/hypeprooflab');
});

test('a failed read, a non-list answer or no token refuses', () => {
  const fail = () => { const e = new Error('x'); e.stderr = 'HTTP 404: Not Found'; throw e; };
  assert.equal(checkBlockers({env: {RELEASE_BLOCKER_TOKEN: 't'}, run: fail}).allow, false);
  assert.equal(checkBlockers({env: {RELEASE_BLOCKER_TOKEN: 't'}, run: () => '{}'}).allow, false);
  const results = readBlockers({env: {}, run: () => '[]'});
  assert.ok(results.every(r => r.error));
});

test('create.mjs checks blockers before the rc tag; promote.mjs before the v tag', () => {
  const create = read('create.mjs');
  assert.ok(create.indexOf('checkBlockers()') > 0);
  assert.ok(create.indexOf('checkBlockers()') < create.indexOf("run('git', 'tag', '-a', plan.rcTag"));
  const promote = read('promote.mjs');
  assert.ok(promote.indexOf('checkBlockers()') > 0);
  assert.ok(promote.indexOf('checkBlockers()') < promote.indexOf("git('tag', '-a', version"));
});

test('both workflows pass an org token that covers the three repos', () => {
  for (const wf of ['release-cut.yml', 'release-promote.yml']) {
    const text = fs.readFileSync(path.join(here, '..', '..', '..', '.github', 'workflows', wf), 'utf8');
    assert.match(text, /repositories: hypeproof-studio,hypeproof-service,hypeprooflab/, wf);
    assert.match(text, /RELEASE_BLOCKER_TOKEN: \$\{\{ steps\.blockers\.outputs\.token \}\}/, wf);
  }
});
