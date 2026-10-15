// Controls for the release-cut dry-run (#1608). No GitHub or production calls.
//   node --test scripts/release/test/release-cut.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {classify, howToCheck, parseTitle, render} from '../checklist.mjs';
import s1 from '../smoke/checks/s1-service-health.mjs';
import s3 from '../smoke/checks/s3-cohort-token.mjs';
import s4 from '../smoke/checks/s4-chat-api.mjs';

const pr = (number, title, files = [], extra = {}) => ({
  number, title, body: '', author: {login: 'dev'},
  files: {nodes: files.map(path => ({path}))}, closingIssuesReferences: {nodes: []}, ...extra,
});

test('parseTitle reads type and scope; a non-conventional title is "other"', () => {
  assert.deepEqual(parseTitle('feat(start): buy a pass (REQ-L12)'), {type: 'feat', scope: 'start', text: 'buy a pass (REQ-L12)'});
  assert.deepEqual(parseTitle('refactor: split worker'), {type: 'refactor', scope: '', text: 'split worker'});
  assert.equal(parseTitle('Update README').type, 'other');
});

test('howToCheck: the untouched template placeholder is not a check', () => {
  // negative control: the PR template's own placeholder line
  assert.equal(howToCheck('- [ ] manual: <!-- what you clicked through -->'), null);
  assert.equal(howToCheck(''), null);
  // positive controls
  assert.equal(howToCheck('- [x] manual: opened the start page, pressed 이용권으로 시작하기'), 'opened the start page, pressed 이용권으로 시작하기');
  assert.equal(howToCheck('## What\nx\n\n## Release check\nOpen Chalk, create a track plan\n\n## Tested\n- y'), 'Open Chalk, create a track plan');
});

test('classify: dependency/deploy wins over feature; ci/build scopes are automatic', () => {
  const {groups, authors} = classify([
    pr(1, 'feat(start): buy a pass'),
    pr(2, 'chore(deploy): pin the Service', ['.github/workflows/deploy-worker.yml']),
    pr(3, 'feat(chalk): ops plan', ['worker/migrations/0040-x.sql']),
    pr(4, 'fix(ci): run macOS after merge'),
    pr(5, 'chore(deps): bump qs', ['package-lock.json'], {author: {login: 'app/dependabot'}}),
    pr(6, 'fix(updates): restore access', ['extensions/hypeproof-chat/src/updateChecker.ts']),
  ]);
  assert.deepEqual(groups.dependency.map(p => p.number), [2, 3]);
  assert.deepEqual(groups.features.map(p => p.number), [1, 6]);
  assert.deepEqual(groups.automatic.map(p => p.number), [4, 5]);
  assert.deepEqual(authors, ['dev']);
});

test('render folds features by scope and marks a missing author check', () => {
  const {groups} = classify([pr(1, 'feat(start): buy a pass'), pr(2, 'feat(start): pass list')]);
  const {features, dependency, automatic} = render({groups});
  assert.match(features, /<b>start<\/b> — 2/);
  assert.match(features, /how to check: _not given by the author_/);
  assert.equal(dependency, 'None.');
  assert.equal(automatic, 'None.');
});

async function withHealth(body, fn) {
  const server = http.createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('S1 passes a healthy versioned Service and fails the rest', async () => {
  const ok = await withHealth({ok: true, service: 'api', version: 'w1.0.0', env: 'production'}, url => s1.run({serviceUrl: url}));
  assert.equal(ok.result, 'PASS');
  assert.equal(ok.version, 'w1.0.0');
  assert.equal((await withHealth({ok: false, version: 'w1'}, url => s1.run({serviceUrl: url}))).result, 'FAIL');
  assert.equal((await withHealth({ok: true, version: 'unknown'}, url => s1.run({serviceUrl: url}))).result, 'FAIL');
});

test('S3 and S4 are NOT_RUN without their scoped credential, even with the admin password', async () => {
  const env = {HPS_ADMIN_PASSWORD: 'x'};
  assert.equal((await s3.run({env})).result, 'NOT_RUN');
  assert.equal((await s4.run({env, studioDir: '.', serviceUrl: 'http://127.0.0.1:1'})).result, 'NOT_RUN');
});
