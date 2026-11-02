import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {cutResult} from '../cut-result.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-result-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
  const plan = (smoke, mode = 'create') => {
    const failed = smoke === 'FAIL', body = failed ? 'smoke-failure-issue.md' : 'release-pr.md';
    write(body, 'A completed release result');
    write('plan.json', {schema: 'hps-release-plan/0', mode, smoke, [failed ? 'issueBody' : 'prBody']: body});
  };
  return {directory, write, plan, judge: (code, mode = 'create') => cutResult({code, mode, directory})};
}

test('a GitHub exception or signal without a plan is a failed CLI, never a skip', t => {
  const f = fixture(t);
  for (const code of [0, 1, 2, 137]) {
    const result = spawnSync(process.execPath, [new URL('../cut-result.mjs', import.meta.url).pathname, String(code), 'create', f.directory], {encoding: 'utf8'});
    assert.equal(result.status, 1, `exit ${code} without completed evidence must fail`);
    assert.match(result.stderr, /::error::/);
    assert.doesNotMatch(result.stdout, /skipped|planned/);
  }
});

test('only the explicit no-commit record permits a missing plan', t => {
  const f = fixture(t);
  f.write('skipped.json', {schema: 'hps-release-skip/1', reason: 'no-commits', candidate: 'a'.repeat(40), baseline: 'v2026.1029.0'});
  assert.equal(f.judge(0), 'skipped');
  assert.throws(() => f.judge(1));
  f.write('skipped.json', {schema: 'hps-release-skip/1', reason: 'unknown'});
  assert.throws(() => f.judge(0));
});

test('completed smoke verdicts retain create policy and dry-run FAIL stays red', t => {
  const f = fixture(t);
  for (const [code, verdict] of [[0, 'PASS'], [1, 'FAIL'], [2, 'NOT_RUN']]) {
    f.plan(verdict);
    assert.equal(f.judge(code), 'planned');
    f.plan(verdict, 'dry-run');
    if (code === 1) assert.throws(() => f.judge(code, 'dry-run'), /smoke failed/);
    else assert.equal(f.judge(code, 'dry-run'), 'planned');
  }
});

test('malformed, inconsistent and unfinished plans cannot authorize creation', t => {
  const f = fixture(t);
  f.write('plan.json', '{');
  assert.throws(() => f.judge(0));
  f.plan('PASS');
  assert.throws(() => f.judge(1), /does not match/);
  assert.throws(() => f.judge(0, 'dry-run'), /does not match/);
  f.write('release-pr.md', '');
  assert.throws(() => f.judge(0), /complete result body/);
  fs.unlinkSync(path.join(f.directory, 'release-pr.md'));
  assert.throws(() => f.judge(0));
});

test('the actual workflow shell propagates crashes and preserves completed outcomes', t => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/release-cut.yml', import.meta.url), 'utf8');
  const step = workflow.split('      - name: Release cut\n')[1].split('\n      # Safety net')[0];
  const shell = step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  for (const [code, completed, expected] of [[1, false, 1], [137, false, 1], [0, false, 1], [0, true, 0], [1, true, 0], [2, true, 0]]) {
    const f = fixture(t);
    if (completed) f.plan(['PASS', 'FAIL', 'NOT_RUN'][code]);
    const project = path.join(f.directory, 'project');
    fs.mkdirSync(path.join(project, 'scripts/release'), {recursive: true});
    fs.copyFileSync(new URL('../cut-result.mjs', import.meta.url), path.join(project, 'scripts/release/cut-result.mjs'));
    fs.writeFileSync(path.join(project, 'scripts/release/release-cut.mjs'), `process.exit(${code});`);
    const temp = path.join(f.directory, 'runner');
    fs.mkdirSync(temp);
    fs.mkdirSync(path.join(temp, 'release-cut'));
    if (completed) for (const name of ['plan.json', code === 1 ? 'smoke-failure-issue.md' : 'release-pr.md']) {
      fs.copyFileSync(path.join(f.directory, name), path.join(temp, 'release-cut', name));
    }
    const result = spawnSync('bash', ['-e', '-c', shell], {cwd: project, encoding: 'utf8', env: {...process.env,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, MODE: 'create', SINCE: '', CANDIDATE: 'origin/main',
      RUNNER_TEMP: temp, GITHUB_OUTPUT: path.join(temp, 'output'), GITHUB_STEP_SUMMARY: path.join(temp, 'summary')}});
    assert.equal(result.status, expected, `code=${code} completed=${completed}: ${result.stderr}`);
  }
});
