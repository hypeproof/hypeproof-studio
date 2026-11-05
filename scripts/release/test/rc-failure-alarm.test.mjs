import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from '../rc-failure-alarm.mjs';

// Candidate unit checks only. External CLI/sandbox receipts remain authoritative.
const repository = 'hypeproof/hypeproof-studio';
const schema = 'hps-rc-build-alarm-intent/1';
const expected = (decision, reason) => ({schema, decision, reason});
function input(overrides = {}) {
  return {repository: {full_name: repository}, workflow_run: {
    repository: {full_name: repository}, head_repository: {full_name: repository},
    id: 41863405602, run_attempt: 1,
    head_sha: '84fce87af0106f96495c0c940f62144ecaec6c4e',
    html_url: `https://github.com/${repository}/actions/runs/41863405602`,
    path: '.github/workflows/build-mac.yml', event: 'workflow_dispatch',
    head_branch: 'v2026.1105.0-rc.1', status: 'completed', conclusion: 'failure',
    ...overrides,
  }};
}

test('observed Mac failure and derived Windows control retain exact projection', () => {
  for (const [platform, workflow] of [['darwin-arm64', 'build-mac.yml'], ['win32-x64', 'build-windows.yml']]) {
    assert.deepEqual(classify(input({path: `.github/workflows/${workflow}`, extra: 'never forwarded'})), {
      ...expected('ALARM', 'rc_build_failure'), repository, platform,
      run: {id: 41863405602, attempt: 1,
        workflowHeadSha: '84fce87af0106f96495c0c940f62144ecaec6c4e',
        tag: 'v2026.1105.0-rc.1', url: `https://github.com/${repository}/actions/runs/41863405602`},
      alarm: {title: 'Daily release cut skipped: needs attention',
        dedupeKey: `${repository}:workflow-run:41863405602:attempt:1`},
    });
  }
});

test('success and out-of-scope runs have explicit minimal ignore results', () => {
  const cases = [
    [{id: 41560611200, html_url: `https://github.com/${repository}/actions/runs/41560611200`,
      head_sha: 'fb5542e74d8cee445ca24ec1549eeecdc733771a', head_branch: 'v2026.1103.0-rc.3',
      conclusion: 'success'}, 'successful_build'],
    [{path: '.github/workflows/unified-release.yml'}, 'out_of_scope_workflow'],
    [{event: 'pull_request'}, 'out_of_scope_event'],
    [{status: 'in_progress', conclusion: null}, 'not_completed'],
    [{head_branch: 'main'}, 'not_rc_tag'],
  ];
  for (const [changes, reason] of cases) assert.deepEqual(classify(input(changes)), expected('IGNORE', reason));
});

test('malformed structures, foreign repositories and inconsistent identities reject', () => {
  for (const value of [null, [], {}, input({path: 7}), input({conclusion: null})]) {
    assert.deepEqual(classify(value), expected('REJECT', 'invalid_input'));
  }
  for (const field of ['repository', 'head_repository']) {
    assert.deepEqual(classify(input({[field]: {full_name: 'foreign/repository'}})), expected('REJECT', 'repository_mismatch'));
  }
  const foreign = input();
  foreign.repository.full_name = 'foreign/repository';
  assert.deepEqual(classify(foreign), expected('REJECT', 'repository_mismatch'));
  for (const changes of [{id: 0}, {run_attempt: 1.5}, {id: Number.MAX_SAFE_INTEGER + 1},
    {head_sha: 'A'.repeat(40)}, {html_url: `https://github.com/${repository}/actions/runs/41863405602?x=1`}]) {
    assert.deepEqual(classify(input(changes)), expected('REJECT', 'invalid_run_identity'));
  }
  for (const head_branch of ['v2026.1105.0-rc.0', 'v2026.1105.0-rc.1-extra', 'junk-rc.1']) {
    assert.deepEqual(classify(input({head_branch})), expected('REJECT', 'invalid_rc_contract'));
  }
});

test('repeat classification is deterministic and attempt keys distinguish attempts', () => {
  const value = input();
  const before = JSON.stringify(value);
  assert.deepEqual(classify(value), classify(value));
  assert.equal(JSON.stringify(value), before);
  assert.equal(classify(input({run_attempt: 2})).alarm.dedupeKey,
    `${repository}:workflow-run:41863405602:attempt:2`);
});

test('unclassified terminal conclusions stay undetermined', () => {
  for (const conclusion of ['cancelled', 'timed_out', 'neutral', 'skipped', 'unknown']) {
    assert.deepEqual(classify(input({conclusion})), expected('UNDETERMINED', 'unclassified_conclusion'));
  }
});
