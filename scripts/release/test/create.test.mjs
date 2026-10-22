// Controls for release naming and the create decision. No GitHub or git calls.
//   node --test scripts/release/test/create.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile, execFileSync} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  actions, branchPushEnv, compareReleaseVersions, prToken, smokeFailureTarget, smokeIssueVersion,
  smokeIssuesToClose, supersededComment,
} from '../create.mjs';
import {nextRcTag, versionFor} from '../version.mjs';

test('versionFor: v<year>.<month*100+day>.<n>, no leading zero, next n after a release that day', () => {
  assert.equal(versionFor('2026-10-13', ['v0.1.56']), 'v2026.1013.0');
  assert.equal(versionFor('2026-01-05', []), 'v2026.105.0');
  assert.equal(versionFor('2026-10-13', ['v2026.1013.0']), 'v2026.1013.1');
  assert.equal(versionFor('2026-10-13', ['v2026.1013.0', 'v2026.1013.1']), 'v2026.1013.2');
  // another day's release and an unrelated prefix do not count
  assert.equal(versionFor('2026-10-13', ['v2026.1012.0', 'v2026.10130.0']), 'v2026.1013.0');
  assert.throws(() => versionFor('13/10/2026', []));
});

test('every version passes the app updater and the build version check', () => {
  // isUpdateVersion (updateCheckerHelpers.ts) and resolve-version.sh, copied as regexes
  const updater = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const build = /^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$/;
  for (const day of ['2026-01-01', '2026-01-09', '2026-09-30', '2026-10-13', '2026-12-31']) {
    const v = versionFor(day, []);
    assert.match(v, updater, v);
    assert.match(v.slice(1), build, v);
    assert.match(nextRcTag(v, []), updater);
  }
  // negative control: the leading-zero form the updater would reject
  assert.doesNotMatch('v2026.0105.0', updater);
});

test('nextRcTag counts only rc tags of the same version', () => {
  assert.equal(nextRcTag('v2026.1013.0', []), 'v2026.1013.0-rc.1');
  assert.equal(nextRcTag('v2026.1013.0', ['v2026.1013.0-rc.1', 'v2026.1013.0-rc.2', 'v2026.1013.1-rc.7', 'v2026.1013.0']), 'v2026.1013.0-rc.3');
});

test('actions: create only from a non-trial create plan, by smoke verdict', () => {
  const plan = {schema: 'hps-release-plan/0', mode: 'create', trial: false};
  assert.deepEqual(actions({...plan, smoke: 'PASS'}).steps, ['tag', 'builds', 'branch', 'pr', 'close-smoke-issues']);
  assert.deepEqual(actions({...plan, smoke: 'FAIL'}).steps, ['issue']);
  assert.match(actions({...plan, smoke: 'NOT_RUN'}).stop, /NOT_RUN/);
  assert.deepEqual(actions({...plan, smoke: 'NOT_RUN'}, {acceptNotRun: true}).steps, ['tag', 'builds', 'branch', 'pr']);
  // negative controls: a trial or dry-run plan never creates, even with PASS
  assert.ok(actions({...plan, trial: true, smoke: 'PASS'}).stop);
  assert.ok(actions({...plan, mode: 'dry-run', smoke: 'PASS'}).stop);
  assert.ok(actions({...plan, schema: 'x', smoke: 'PASS'}).stop);
});

test('actions: a dry-run or NOT_RUN cut never reaches the issue-closing step', () => {
  const plan = {schema: 'hps-release-plan/0', mode: 'create', trial: false};
  for (const decision of [
    actions({...plan, mode: 'dry-run', smoke: 'PASS'}),
    actions({...plan, smoke: 'NOT_RUN'}),
    actions({...plan, trial: true, smoke: 'PASS'}),
  ]) {
    assert.equal(decision.steps, undefined);
    assert.ok(decision.stop);
  }
  // an accepted NOT_RUN cut does create the release, but it leaves smoke-failure issues open
  const accepted = actions({...plan, smoke: 'NOT_RUN'}, {acceptNotRun: true});
  assert.ok(accepted.steps.includes('pr'));
  assert.ok(!accepted.steps.includes('close-smoke-issues'));
});

test('compareReleaseVersions: numeric, so 105 < 1013 and 1013.10 never sorts before 1013.9', () => {
  assert.ok(compareReleaseVersions('v2026.105.0', 'v2026.1013.0') < 0);
  assert.ok(compareReleaseVersions('v2026.1013.0', 'v2026.105.0') > 0);
  assert.ok(compareReleaseVersions('v2026.1013.10', 'v2026.1013.9') > 0);
  assert.ok(compareReleaseVersions('v2025.1231.0', 'v2026.101.0') < 0);
  assert.equal(compareReleaseVersions('v2026.1013.0', 'v2026.1013.0'), 0);
  assert.throws(() => compareReleaseVersions('v2026.1013.0-rc.1', 'v2026.1013.0'), /not a release version/);
});

test('smokeIssueVersion: only the exact release-cut title names a version', () => {
  assert.equal(smokeIssueVersion('Smoke failed — release v2026.1013.0 stopped'), 'v2026.1013.0');
  // negative controls: other titles, a different dash, a suffix, or a prefix are not ours
  assert.equal(smokeIssueVersion('Smoke failed - release v2026.1013.0 stopped'), null);
  assert.equal(smokeIssueVersion('Smoke failed — release v2026.1013.0 stopped (rerun)'), null);
  assert.equal(smokeIssueVersion('[bug] Smoke failed — release v2026.1013.0 stopped'), null);
  assert.equal(smokeIssueVersion('Smoke failed — release v2026.1013.0-rc.1 stopped'), null);
  // the pre-2026 v0.1.x format has no date version; it is not matched
  assert.equal(smokeIssueVersion('Smoke failed — release v0.1.56 stopped'), null);
});

test('smokeIssuesToClose: same or lower version closes; higher version and other titles stay open', () => {
  const issue = (number, title) => ({number, title, url: `https://example.invalid/issues/${number}`});
  const open = [
    issue(1, 'Smoke failed — release v2026.1013.0 stopped'),  // same version
    issue(2, 'Smoke failed — release v2026.105.0 stopped'),   // lower (Jan 5 < Oct 13): numeric, not string
    issue(3, 'Smoke failed — release v2026.1014.0 stopped'),  // higher day
    issue(4, 'Smoke failed — release v2026.1013.1 stopped'),  // higher n
    issue(5, 'Smoke failed — release v2026.1013.0 stopped (rerun)'), // other title format
    issue(6, 'Release notes for v2026.1013.0'),
  ];
  assert.deepEqual(smokeIssuesToClose(open, 'v2026.1013.0').map(i => i.number), [1, 2]);
  assert.deepEqual(smokeIssuesToClose([], 'v2026.1013.0'), []);
});

test('smokeFailureTarget: comment on an open issue of the same version, else open a new one', () => {
  const issue = (number, title) => ({number, title, url: `u/${number}`});
  const open = [issue(7, 'Smoke failed — release v2026.1013.0 stopped'), issue(8, 'Smoke failed — release v2026.1013.1 stopped')];
  assert.equal(smokeFailureTarget(open, 'v2026.1013.0').number, 7);
  assert.equal(smokeFailureTarget(open, 'v2026.1013.1').number, 8);
  // a different version does not match: a new issue is opened
  assert.equal(smokeFailureTarget(open, 'v2026.1014.0'), null);
  assert.equal(smokeFailureTarget([issue(9, 'Smoke failed — release v2026.1013.0 stopped (rerun)')], 'v2026.1013.0'), null);
  assert.equal(smokeFailureTarget([], 'v2026.1013.0'), null);
});

test('supersededComment: names the rc tag, the candidate and the release PR', () => {
  const text = supersededComment({rcTag: 'v2026.1013.0-rc.2', candidate: 'abcdef0123456789', version: 'v2026.1013.0',
    prUrl: 'https://github.com/hypeproof/hypeproof-studio/pull/9999'});
  assert.match(text, /v2026\.1013\.0-rc\.2/);
  assert.match(text, /abcdef01/);
  assert.match(text, /https:\/\/github\.com\/hypeproof\/hypeproof-studio\/pull\/9999/);
  assert.doesNotMatch(text, /abcdef0123456789/);
});

test('prToken: the PR step needs its own token, checked before any write', () => {
  const steps = ['tag', 'builds', 'branch', 'pr'];
  assert.equal(prToken(steps, {RELEASE_PR_TOKEN: 'app'}), 'app');
  // the workflow token alone is not enough: Actions may not open PRs in this org
  assert.throws(() => prToken(steps, {GH_TOKEN: 'workflow'}), /RELEASE_PR_TOKEN is required/);
  assert.throws(() => prToken(steps, {RELEASE_PR_TOKEN: ''}), /RELEASE_PR_TOKEN is required/);
  // a smoke-failure issue opens no PR and needs no PR token
  assert.equal(prToken(['issue'], {}), null);
});

// Runs `git ls-remote` against a local server and returns the Authorization headers git sent.
async function sentAuth(dir, env) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const raw = req.rawHeaders;
    for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === 'authorization') seen.push(raw[i + 1]);
    res.statusCode = 404; res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const run = env => new Promise(resolve => execFile('git', ['-C', dir, 'ls-remote', `${url}repo.git`], {env}, () => resolve()));
    await run(env(url));
  } finally {
    server.close();
  }
  return seen;
}

test('branchPushEnv: the release branch push sends only the App credential (#1973)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-push-env-'));
  const workflow = 'AUTHORIZATION: basic d29ya2Zsb3c=';
  const app = `basic ${Buffer.from('x-access-token:app-token').toString('base64')}`;
  const clean = {...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG_'))),
    GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'false'};
  try {
    execFileSync('git', ['init', '-q', dir]);
    // what actions/checkout persists for the origin: the workflow token as an extraheader
    // (--replace-all: each call gets a fresh server port, so a fresh origin)
    const withPersisted = make => url => {
      execFileSync('git', ['-C', dir, 'config', '--local', '--replace-all', `http.${url}.extraheader`, workflow]);
      return make(url);
    };
    assert.deepEqual(await sentAuth(dir, withPersisted(url => branchPushEnv('app-token', clean, url))), [app]);
    // negative control: without the token git sends the workflow header
    assert.deepEqual(await sentAuth(dir, withPersisted(() => branchPushEnv(null, clean))), ['basic d29ya2Zsb3c=']);
    // negative control: the App header without the reset sends both
    assert.equal((await sentAuth(dir, withPersisted(url => ({...clean, GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `http.${url}.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: ${app}`})))).length, 2);
    // existing GIT_CONFIG_* entries are kept, and ours follow them
    const kept = branchPushEnv('app-token', {...clean, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.abbrev', GIT_CONFIG_VALUE_0: '12'});
    assert.equal(kept.GIT_CONFIG_COUNT, '3');
    assert.equal(kept.GIT_CONFIG_KEY_0, 'core.abbrev');
    assert.equal(kept.GIT_CONFIG_KEY_1, 'http.https://github.com/.extraheader');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
