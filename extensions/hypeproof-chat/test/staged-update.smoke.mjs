import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import vm from 'node:vm';
import { StagedUpdate, updateInstallAllowed, HANDOFF_LEASE_MS } from '../src/stagedUpdate.ts';
import { hpsInstallOnQuit, hpsRunQuitGuard } from '../../../scripts/patches/core/src/vs/workbench/contrib/hpsQuitGuard/common/hpsQuitGuardCore.ts';
import { quitGuardPrompt } from '../src/quitGuardHelpers.ts';

for (const turn of [false, true]) for (const held of [false, true]) {
  assert.equal(updateInstallAllowed({ hasActiveStream: () => turn, isClassUpdateHeld: () => held }), !turn && !held);
}
// Execute the production registration callback and restart policy expression from
// the TypeScript AST; test the wiring without activating unrelated host services.
const sourceFile = ts.createSourceFile('extension.ts', fs.readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const registrations = [], restartPolicies = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.arguments[0]?.getText(sourceFile) === 'INSTALL_STAGED_UPDATE_COMMAND') registrations.push(node.arguments[1]);
  if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === 'canInstall') restartPolicies.push(node.initializer);
  ts.forEachChild(node, visit);
}
visit(sourceFile);
assert.equal(registrations.length, 1); assert.equal(restartPolicies.length, 1);
for (const turn of [false, true]) for (const held of [false, true]) {
  const context = {}, provider = { hasActiveStream: () => turn, isClassUpdateHeld: () => held };
  const sandbox = { context, provider, updateInstallAllowed, installStagedUpdate: (received, allowed) => { assert.equal(received, context); return allowed(); } };
  for (const callback of [...registrations, ...restartPolicies]) {
    assert.equal(vm.runInNewContext(`(${callback.getText(sourceFile)})()`, sandbox), !turn && !held, 'production host gates');
  }
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-staged-test-'));
try {
  const script = path.join(root, 'installer.sh'), app = path.join(root, 'new.app');
  fs.writeFileSync(script, '#!/bin/sh\nexit 0\n');
  fs.mkdirSync(app); fs.writeFileSync(path.join(app, 'version'), '0.1.51');
  const store = new StagedUpdate(path.join(root, 'state'));
  const stage = () => store.stage('darwin', script, [app], '0.1.51');
  const launched = [];
  const install = (allowed = () => true, newer = () => true) => store.install(allowed, newer, async (...args) => { launched.push(args); return 2147483647; });
  assert.equal(await install(), false, 'no verified stage does nothing');
  stage();
  assert.equal(await install(() => false), false, 'active turn/class holds the record');
  for (const reason of [1, 3, 4]) await hpsInstallOnQuit(reason, install);
  // Window close that does not end the app: macOS (any count), Windows with another window open.
  await hpsInstallOnQuit(1, install, true, async () => 1);
  await hpsInstallOnQuit(1, install, false, async () => 2);
  for (const reason of [3, 4]) await hpsInstallOnQuit(reason, install, false, async () => 1);
  await hpsInstallOnQuit(1, install, false, async () => { throw new Error('ipc gone'); });
  assert.deepEqual(launched, [], 'close/reload/workspace switch do not install');
  let veto = await hpsRunQuitGuard(2, {
    queryPrompt: async () => quitGuardPrompt({ turnRunning: true, queuedUnsent: false }),
    timeout: () => new Promise(() => {}),
    showMessageBox: async () => ({ response: 0 }),
  });
  if (!veto) await hpsInstallOnQuit(2, install);
  assert.equal(veto, true); assert.deepEqual(launched, [], 'cancel never launches');
  await hpsInstallOnQuit(2, install);
  assert.deepEqual(launched, [['darwin', script]], 'eligible committed quit consumes the stage');
  assert.equal(await install(), false, 'a repeated quit cannot install twice');
  // Windows: closing the last window (X / Alt+F4) is the app exit and installs.
  fs.rmSync(path.join(root, 'state/handoff/installer-pid.json'), { force: true });
  stage(); await hpsInstallOnQuit(1, install, false, async () => 1);
  assert.equal(launched.length, 2, 'Windows last-window close consumes the stage');
  fs.rmSync(path.join(root, 'state/handoff/installer-pid.json'), { force: true });
  stage();
  // Persistence: reconstructing the store (extension reload) retains verified artifacts.
  const other = new StagedUpdate(path.join(root, 'state'));
  const results = await Promise.all([install(), other.install(() => true, () => true, async (...args) => { launched.push(args); return 2147483647; })]);
  assert.deepEqual(results, [true, false], 'two windows consume once');
  const parallel = new StagedUpdate(path.join(root, 'parallel'));
  const parallelResult = await Promise.all([
    parallel.handoff(async () => { await new Promise(resolve => setTimeout(resolve, 40)); return process.pid; }),
    parallel.handoff(async () => { throw new Error('concurrent handoff entered'); }),
  ]);
  assert.deepEqual(parallelResult, ['started', 'busy'], 'different records still serialize installer launch');
  // Lease bound: a live pid (possibly reused by another process) blocks only until expiry.
  const leased = new StagedUpdate(path.join(root, 'leased')); let clock = 1_000_000;
  assert.equal(await leased.handoff(async () => process.pid, () => clock), 'started');
  clock += HANDOFF_LEASE_MS - 1;
  assert.equal(await leased.handoff(async () => { throw new Error('inside lease'); }, () => clock), 'busy');
  clock += 1;
  assert.equal(await leased.handoff(async () => 2147483647, () => clock), 'started', 'expired lease no longer blocks');
  assert.equal(await leased.handoff(async () => 2147483647, () => clock), 'started', 'finished installer lease is dropped');
  assert.equal(await leased.handoff(async () => undefined, () => clock), 'held');
  const leaseFile = path.join(root, 'leased/handoff/installer-pid.json');
  assert.equal(fs.existsSync(leaseFile), false, 'dead-process lease deleted, none written when held');
  for (const bad of ['{', JSON.stringify({ pid: process.pid }), JSON.stringify({ pid: process.pid, nonce: 'x', startedAt: clock }),
    JSON.stringify({ pid: process.pid, nonce: '00000000-0000-4000-8000-000000000000', startedAt: clock + 120_000 })]) {
    fs.mkdirSync(path.dirname(leaseFile), { recursive: true }); fs.writeFileSync(leaseFile, bad);
    assert.equal(await leased.handoff(async () => 2147483647, () => clock), 'started', 'legacy, partial or future lease does not block: ' + bad);
  }
  // A live detached installer excludes another prepared version in any window.
  stage(); const countBefore = launched.length;
  assert.equal(await store.handoff(async () => process.pid), 'started');
  assert.equal(await install(), false); assert.equal(launched.length, countBefore);
  assert.equal(await other.handoff(async () => { throw new Error('must not start twice'); }), 'busy');
  fs.writeFileSync(path.join(root, 'state/handoff/installer-pid.json'), JSON.stringify({ pid: 2147483647, nonce: '00000000-0000-4000-8000-000000000000', startedAt: Date.now() }));
  assert.equal(await install(), true, 'pending newer update retained until previous installer exits');
  stage(); let checks = 0;
  assert.equal(await install(() => ++checks === 1), false, 'turn starts during handoff: recheck holds');
  assert.equal(await install(), true, 'held record is still available');
  stage(); let lateChecks = 0;
  assert.equal(await install(() => ++lateChecks < 3), false, 'eligibility rechecked inside shared handoff lock');
  assert.equal(await install(), true, 'late-held record retained');
  stage();
  assert.equal(await install(() => true, () => false), false, 'already updated or downgrade is discarded');
  assert.equal(await install(), false);
  const oldId = stage(); const newerId = stage(); store.clear(oldId);
  assert.equal(await install(), true, 'old modal cannot erase newer stage');
  stage(); store.clear(newerId);
  assert.equal(await install(), true, 'wrong id cannot clear');
  const currentId = stage(); store.clear(currentId);
  assert.equal(await install(), false, 'immediate restart clears its own pending stage');
  for (const file of [script, path.join(app, 'version')]) {
    stage(); const before = fs.readFileSync(file); fs.appendFileSync(file, 'changed');
    const count = launched.length;
    await assert.rejects(install(), /changed/); assert.equal(launched.length, count);
    fs.writeFileSync(file, before);
  }
  stage(); fs.symlinkSync('version', path.join(app, 'link')); // new entry invalidates the fingerprint
  await assert.rejects(install(), /changed/);
  stage(); fs.unlinkSync(path.join(app, 'link')); fs.symlinkSync('other', path.join(app, 'link'));
  await assert.rejects(install(), /changed/);
  fs.unlinkSync(path.join(app, 'link'));
  // Same bytes under another name, and the same file with another mode, are changes.
  stage(); fs.renameSync(path.join(app, 'version'), path.join(app, 'version2'));
  await assert.rejects(install(), /changed/);
  fs.renameSync(path.join(app, 'version2'), path.join(app, 'version'));
  stage(); fs.chmodSync(path.join(app, 'version'), 0o755);
  await assert.rejects(install(), /changed/);
  fs.chmodSync(path.join(app, 'version'), 0o644);
  // Malformed disk records never become an executable launch request.
  for (const corrupt of [r => { r.version = 'bad'; }, r => { r.platform = 'linux'; },
    r => { r.artifacts = []; }, r => { r.fingerprints = []; },
    r => { r.script = '/not-the-script'; }, r => { r.artifacts[1] = 'relative'; }]) {
    stage(); const pending = path.join(root, 'state/pending-update.json');
    const record = JSON.parse(fs.readFileSync(pending, 'utf8')); corrupt(record);
    fs.writeFileSync(pending, JSON.stringify(record)); await assert.rejects(install());
  }
  stage(); fs.unlinkSync(script); await assert.rejects(install(), /ENOENT/);
  await hpsInstallOnQuit(2, async () => { throw new Error('spawn failed'); });
  console.log('PASS staged update: quit/cancel/reload, persistence, races, guards, changed artifacts, failure');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
