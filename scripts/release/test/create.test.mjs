// Controls for release naming and the create decision. No GitHub or git calls.
//   node --test scripts/release/test/create.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {actions, prToken} from '../create.mjs';
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
  assert.deepEqual(actions({...plan, smoke: 'PASS'}).steps, ['tag', 'builds', 'branch', 'pr']);
  assert.deepEqual(actions({...plan, smoke: 'FAIL'}).steps, ['issue']);
  assert.match(actions({...plan, smoke: 'NOT_RUN'}).stop, /NOT_RUN/);
  assert.deepEqual(actions({...plan, smoke: 'NOT_RUN'}, {acceptNotRun: true}).steps, ['tag', 'builds', 'branch', 'pr']);
  // negative controls: a trial or dry-run plan never creates, even with PASS
  assert.ok(actions({...plan, trial: true, smoke: 'PASS'}).stop);
  assert.ok(actions({...plan, mode: 'dry-run', smoke: 'PASS'}).stop);
  assert.ok(actions({...plan, schema: 'x', smoke: 'PASS'}).stop);
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
