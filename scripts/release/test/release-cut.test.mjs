// Controls for the release-cut dry-run (#1608). No GitHub or production calls.
//   node --test scripts/release/test/release-cut.test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {classify, howToCheck, parseTitle, render, smokeOf} from '../checklist.mjs';
import s1 from '../smoke/checks/s1-service-health.mjs';
import s3 from '../smoke/checks/s3-cohort-token.mjs';
import s4 from '../smoke/checks/s4-chat-api.mjs';
import {judge} from '../smoke/checks/s5-candidate-ci.mjs';
import {runSmokeChecks} from '../smoke/smoke.mjs';

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

const TEMPLATE = `## Release check

How to verify: <where> → <what to click or run> → <expected result>
Smoke: <yes|no> — <reason>
Smoke check: <scripts/release/smoke/checks/sN-*.mjs, or #follow-up-issue; only when the answer is yes>

<!--
Answer yes for Smoke when this adds a dependency on another repository or a server.
-->

## Checklist
- [ ] x`;

const FILLED = `## Release check

How to verify: Chalk → create a track plan → the plan lists three sessions
Smoke: yes — calls the Chalk server for the plan
Smoke check: scripts/release/smoke/checks/s2-chalk-health.mjs

## Checklist`;

test('howToCheck: the Release check first line drops its label; the unfilled template is not a check', () => {
  assert.equal(howToCheck(FILLED), 'Chalk → create a track plan → the plan lists three sessions');
  assert.equal(howToCheck(TEMPLATE), null);
});

test('smokeOf: reads the answer, reason and check; null for the unfilled template', () => {
  assert.deepEqual(smokeOf(FILLED), {answer: 'yes', reason: 'calls the Chalk server for the plan',
    check: 'scripts/release/smoke/checks/s2-chalk-health.mjs'});
  assert.deepEqual(smokeOf('## Release check\nHow to verify: a → b → c\nSmoke: no — UI copy only, nothing external\n'),
    {answer: 'no', reason: 'UI copy only, nothing external', check: null});
  assert.equal(smokeOf(TEMPLATE), null);
  assert.equal(smokeOf(''), null);
});

test('render shows the linked issue and the smoke decision for features and dependency PRs', () => {
  const closes = {closingIssuesReferences: {nodes: [{number: 77}]}};
  const {groups} = classify([
    pr(1, 'feat(chalk): plan', [], {body: FILLED, ...closes}),
    pr(2, 'feat(start): copy'),
    pr(3, 'chore(deploy): pin', ['.github/workflows/deploy-worker.yml'], {body: FILLED, ...closes}),
  ]);
  const {features, dependency} = render({groups});
  assert.match(features, /#1 feat\(chalk\): plan — @dev · closes #77/);
  assert.match(features, /smoke: yes — calls the Chalk server for the plan \(check: scripts\/release\/smoke\/checks\/s2-chalk-health\.mjs\)/);
  assert.match(features, /#2 feat\(start\): copy — @dev · _no linked issue_/);
  assert.match(features, /smoke: _not given by the author_/);
  assert.match(dependency, /#3 chore\(deploy\): pin — @dev · closes #77/);
  assert.match(dependency, /how to check: Chalk → create a track plan/);
  assert.match(dependency, /smoke: yes —/);
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

test('S5 leaves out the release-cut run itself, and only that run', () => {
  const run = (name, status, conclusion, id) => ({name, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}/job/1`});
  const done = run('build', 'completed', 'success', 100);
  const self = run('cut', 'in_progress', '', 200);
  // the bug: our own job counted as still running
  assert.equal(judge([done, self], undefined).result, 'NOT_RUN');
  assert.equal(judge([done, self], '200').result, 'PASS');
  // negative control: another run still in progress keeps NOT_RUN
  assert.equal(judge([done, self, run('macos', 'in_progress', '', 300)], '200').result, 'NOT_RUN');
  assert.equal(judge([run('test', 'completed', 'failure', 100), self], '200').result, 'FAIL');
  // a run id that is a prefix of another run id does not match it
  assert.equal(judge([done, run('lint', 'in_progress', '', 2001)], '200').result, 'NOT_RUN');
});

test('S3 and S4 are NOT_RUN without their scoped credential, even with the admin password', async () => {
  const env = {HPS_ADMIN_PASSWORD: 'x'};
  assert.equal((await s3.run({env})).result, 'NOT_RUN');
  assert.equal((await s4.run({env, studioDir: '.', serviceUrl: 'http://127.0.0.1:1'})).result, 'NOT_RUN');
});

test('S5 supersedes only the same workflow/job, using run order, not completion order', () => {
  const run = (workflowId, runNumber, conclusion, extra = {}) => ({id: runNumber, workflowId, runNumber,
    runAttempt: 1, name: 'deploy', status: 'completed', conclusion, url: `https://github.com/o/r/actions/runs/${runNumber}/job/1`, ...extra});
  const old = run(1, 10, 'failure'), current = run(1, 11, 'success');
  assert.equal(judge([current, old]).result, 'PASS');
  assert.equal(judge([old, current]).result, 'PASS');
  assert.equal(judge([old, {...current, status: 'in_progress', conclusion: ''}]).result, 'NOT_RUN');
  assert.equal(judge([old, current, run(2, 9, 'failure')]).result, 'FAIL');
  assert.equal(judge([current, run(1, 9, 'failure', {name: 'macOS'})]).result, 'FAIL');
  assert.equal(judge([current, run(undefined, 9, 'failure')]).result, 'FAIL');
  assert.equal(judge([current, {...current, id: 12, runAttempt: 2, conclusion: 'failure'}]).result, 'FAIL');
  // without the workflow id, leaving out only the current run keeps the older run of that job
  assert.equal(judge([old, current], '11').result, 'FAIL');
});

test('S5 leaves out earlier runs of the release-cut workflow itself (#1845)', () => {
  const run = (workflowId, runNumber, name, conclusion, status = 'completed') => ({id: runNumber, workflowId, runNumber,
    runAttempt: 1, name, status, conclusion, url: `https://github.com/o/r/actions/runs/${runNumber}/job/1`});
  const build = run(5, 3, 'build', 'success');
  const failedCut = run(7, 6, 'create', 'failure');
  const self = run(7, 7, 'create', '', 'in_progress');
  // the bug: run 6 of the same release-cut workflow stayed the latest 'create' after run 7 was left out
  assert.equal(judge([build, failedCut, self], '7').result, 'FAIL');
  assert.equal(judge([build, failedCut, self], '7', 7).result, 'PASS');
  // negative controls: other workflows still block, failed or pending
  assert.equal(judge([build, failedCut, self, run(5, 2, 'test', 'failure')], '7', 7).result, 'FAIL');
  assert.equal(judge([build, failedCut, self, run(9, 1, 'macos', '', 'in_progress')], '7', 7).result, 'NOT_RUN');
  // a check-run without a workflow id is never matched by the workflow filter
  assert.equal(judge([build, {...failedCut, workflowId: undefined}], '7', 7).result, 'FAIL');
});

test('S3 binds a fresh synthetic token and requires successful cleanup, without admin or force', async () => {
  const {checkCohort} = await import('../smoke/checks/s3-cohort-token.mjs');
  async function probe({wrongProfile = false, closeFailure = false, busy = false, delayed = false} = {}) {
    const calls = []; let polls = 0;
    const result = await checkCohort({env: {HPS_ACCEPTANCE_ISSUER: 'scoped-secret', HPS_ADMIN_PASSWORD: 'admin-secret'},
      serviceUrl: 'https://example.invalid', sleep: async () => {}, fetchImpl: async (url, init) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({url, body, auth: init.headers.authorization});
        if (url.endsWith('/session/open')) {
          assert.equal(body.force, false);
          assert.equal(body.profile_id, 'synthetic-release-acceptance');
          assert.match(body.user, /^synthetic-smoke-/);
          return Response.json(busy ? {} : {token: 'student-secret', jti: 'test-jti', exp: 2000000000,
            cohort: body.profile_id, profile: body.profile_id, user: body.user}, {status: busy ? 409 : 200});
        }
        if (url.endsWith('/v1/profile')) {
          assert.equal(init.headers.authorization, 'Bearer student-secret');
          if (delayed && ++polls === 1) return Response.json({}, {status: 403});
          return Response.json({profile_id: wrongProfile ? 'wrong' : 'synthetic-release-acceptance', activity_kind: 'classroom', activity_id: 'activity'});
        }
        assert.ok(url.endsWith('/session/close'));
        assert.equal(body.jti, 'test-jti');
        return Response.json({ok: true, revoked: closeFailure ? null : body.jti});
      }});
    assert.doesNotMatch(JSON.stringify(result), /scoped-secret|student-secret|admin-secret/);
    assert.ok(calls.every(c => c.auth !== 'Basic admin-secret'));
    return {result, calls};
  }
  assert.equal((await probe({delayed: true})).result.result, 'PASS');
  const wrong = await probe({wrongProfile: true});
  assert.equal(wrong.result.result, 'FAIL');
  assert.ok(wrong.calls.at(-1).url.endsWith('/session/close'));
  assert.equal((await probe({closeFailure: true})).result.result, 'FAIL');
  const busy = await probe({busy: true});
  assert.equal(busy.result.result, 'FAIL');
  assert.equal(busy.calls.length, 1); // An existing session is neither replaced nor closed.
  const transport = await checkCohort({env: {HPS_ACCEPTANCE_ISSUER: 'secret'}, serviceUrl: 'https://example.invalid',
    fetchImpl: async () => { throw Error('secret'); }});
  assert.equal(transport.result, 'FAIL');
  assert.doesNotMatch(transport.detail, /secret/);
});

// Stub check factory for smoke order tests.
const stub = (id, result, detail = '') => ({id, name: id, run: async () => ({result, detail})});
const ctx = {};

test('smoke runs read-only checks (S1, S2, S5) before session-opening checks (S3, S4)', async () => {
  const order = [];
  const tracked = id => ({id, name: id, run: async () => { order.push(id); return {result: 'PASS', detail: ''}; }});
  await runSmokeChecks([tracked('S4'), tracked('S3'), tracked('S5'), tracked('S2'), tracked('S1')], ctx);
  assert.deepEqual(order.slice(0, 3).sort(), ['S1', 'S2', 'S5']);
  assert.deepEqual(order.slice(3).sort(), ['S3', 'S4']);
});

test('smoke skips S3 and S4 with NOT_RUN when S1 fails', async () => {
  const checks = await runSmokeChecks([stub('S1', 'FAIL'), stub('S2', 'PASS'), stub('S3', 'PASS'), stub('S4', 'PASS'), stub('S5', 'PASS')], ctx);
  const byId = Object.fromEntries(checks.map(c => [c.id, c]));
  assert.equal(byId.S3.result, 'NOT_RUN');
  assert.equal(byId.S4.result, 'NOT_RUN');
  assert.match(byId.S3.detail, /skipped: S1 failed/);
  assert.match(byId.S4.detail, /skipped: S1 failed/);
});

test('smoke skips S3 and S4 with NOT_RUN when S5 fails', async () => {
  const checks = await runSmokeChecks([stub('S1', 'PASS'), stub('S2', 'PASS'), stub('S3', 'PASS'), stub('S4', 'PASS'), stub('S5', 'FAIL')], ctx);
  const byId = Object.fromEntries(checks.map(c => [c.id, c]));
  assert.equal(byId.S3.result, 'NOT_RUN');
  assert.equal(byId.S4.result, 'NOT_RUN');
  assert.match(byId.S3.detail, /skipped: S5 failed/);
  assert.match(byId.S4.detail, /skipped: S5 failed/);
});

test('smoke does not skip S3 and S4 when only S2 fails', async () => {
  const checks = await runSmokeChecks([stub('S1', 'PASS'), stub('S2', 'FAIL'), stub('S3', 'PASS'), stub('S4', 'PASS'), stub('S5', 'PASS')], ctx);
  const byId = Object.fromEntries(checks.map(c => [c.id, c]));
  assert.equal(byId.S3.result, 'PASS');
  assert.equal(byId.S4.result, 'PASS');
});
