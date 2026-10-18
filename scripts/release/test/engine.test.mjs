import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateKeyPairSync, sign} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {canonical, digest, signedPayloadDigest, readiness, approvalRequest, manifestFor, validateIntent} from '../engine/core.mjs';
import {inspectFile, checkFile, ingest, readState} from '../engine/store.mjs';

const cli = fileURLToPath(new URL('../engine/cli.mjs', import.meta.url));
const storeModule = new URL('../engine/store.mjs', import.meta.url).href;
const keypair = () => generateKeyPairSync('ed25519');
const pem = key => key.export({format: 'pem', type: 'spki'});
const envelope = (body, key) => ({body, signature: sign(null, Buffer.from(canonical(body)), key).toString('base64')});

// All reports below are protocol fixtures. They prove engine decisions, not an installed App.
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-engine-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const directory = path.join(root, 'ledger');
  const manager = keypair();
  const runner = keypair();
  let now = Date.now() - 120000;
  let serial = 0;
  const policy = {
    schema: 'hps-release-policy/1', revision: 'tests-only-1',
    requiredArtifacts: [{id: 'mac', target: 'darwin-arm64'}, {id: 'win', target: 'win32-x64'}],
    requiredTests: ['INSTALL-MAC', 'UPDATE-MAC', 'INSTALL-WIN', 'UPDATE-WIN'].map(id => ({
      id, artifactId: id.endsWith('MAC') ? 'mac' : 'win', requirementId: 'REQ-I4', expected: 'Installed version starts; project and login persist.', environment: 'installed-app', reporterIds: ['test-runner'],
    })),
    reporters: [{id: 'test-runner', publicKey: pem(runner.publicKey)}], quotaMaxAgeSeconds: 600,
    requiredWork: [{id: 'build', resourceId: 'local-builder'}], fixResourceId: 'local-builder',
    maxAttemptsPerStage: 2, maxFixAttempts: 1,
    managerRoster: {revision: 'rotation-1', terms: [{actor: 'jayleekr', publicKey: pem(manager.publicKey), startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 86400000).toISOString()}]},
  };
  const policyFile = path.join(root, 'policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy));
  const emit = (type, data, id = `event-${++serial}`) => ingest(directory, {id, type, data}, policy, {now});
  const plan = sha => ({schema: 'hps-release-plan/0', mode: 'dry-run', trial: false, candidate: sha, version: 'v2026.1018.0', rcTag: 'v2026.1018.0-rc.1', smoke: 'PASS'});
  const inputs = sequence => ({serviceSha: 'b'.repeat(40), testRevision: 'c'.repeat(40), rubricRevision: 'd'.repeat(40), sequence});
  const create = (sha = 'a'.repeat(40), sequence = 1) => {
    const result = emit('candidate.requested', {plan: plan(sha), inputs: inputs(sequence)});
    assert.equal(result.status, 'CANDIDATE_PINNED', result.reason);
    return result.candidateId;
  };
  const artifact = (candidateId, id) => {
    const file = path.join(root, `${candidateId}-${id}.bin`);
    fs.writeFileSync(file, `fixture package for ${id}: ${candidateId}`);
    const record = {id, target: policy.requiredArtifacts.find(a => a.id === id).target, ...inspectFile(file)};
    assert.equal(emit('artifact.recorded', {candidateId, artifact: record}).status, 'ARTIFACT_RECORDED');
    return record;
  };
  const quota = (remainingUnits = 60, resourceId = 'local-builder') => emit('quota.observed', {
    resourceId, periodId: 'period-1', remainingUnits, protectedUnits: 0,
    startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 86400000).toISOString(), observedAt: new Date(now).toISOString(),
    status: 'confirmed', incrementalUnitCost: 0, paidFallback: false, evidenceUri: 'local:test-fixture-only',
  });
  const reserve = (candidateId, units = 30, stage = 'build', attempt = 1) => emit('work.reserved', {candidateId, stage, attempt, resourceId: 'local-builder', units});
  const settle = (candidateId, reservationId, extra = {}) => emit('work.settled', {candidateId, reservationId, actualUnits: 20, incrementalCost: 0, outcome: 'success', ...extra});
  const report = (candidateId, testId, overrides = {}) => {
    now += 10;
    const item = readState(directory).candidates[candidateId];
    const check = policy.requiredTests.find(c => c.id === testId);
    const file = path.join(root, `${testId}-${serial++}.json`);
    fs.writeFileSync(file, JSON.stringify({scope: 'engine-test-fixture', testId}));
    const body = {schema: 'hps-black-box-evidence/1', candidateId, manifestDigest: digest(manifestFor(item, policy)), testId,
      reporterId: 'test-runner', artifactDigest: item.artifacts[check.artifactId].sha256, requirementId: check.requirementId,
      expected: check.expected, observed: 'Protocol fixture, not product acceptance.', verdict: 'PASS',
      execution: 'observed', serviceSha: item.input.serviceSha,
      environment: {kind: 'installed-app', target: item.artifacts[check.artifactId].target, runnerId: 'test-fixture'},
      testRevision: item.input.testRevision, rubricRevision: item.input.rubricRevision,
      startedAt: new Date(now - 1).toISOString(), endedAt: new Date(now).toISOString(), file: inspectFile(file), ...overrides};
    return envelope(body, runner.privateKey);
  };
  const prepare = candidateId => {
    artifact(candidateId, 'win'); artifact(candidateId, 'mac');
    quota();
    const reservation = reserve(candidateId);
    assert.equal(reservation.status, 'WORK_RESERVED', reservation.reason);
    assert.equal(settle(candidateId, reservation.reservationId).status, 'WORK_SETTLED');
    for (const check of policy.requiredTests) assert.equal(emit('evidence.recorded', {candidateId, envelope: report(candidateId, check.id)}).status, 'EVIDENCE_RECORDED');
  };
  const approve = candidateId => {
    const body = approvalRequest(readState(directory), candidateId, policy, new Date(now + 300000).toISOString(), now, checkFile);
    const approval = envelope(body, manager.privateKey);
    assert.equal(emit('approval.recorded', {candidateId, envelope: approval}, `approval-${digest(approval)}`).status, 'APPROVED');
    return approval;
  };
  const runCli = args => spawnSync(process.execPath, [cli, ...args, '--store', directory, '--policy', policyFile], {encoding: 'utf8'});
  return {root, directory, policy, policyFile, manager, runner, emit, plan, inputs, create, artifact, quota, reserve, settle, report, prepare, approve, runCli,
    now: () => now, advance: ms => { now += ms; }};
}

test('release-cut → persisted events → exact approved intent works across CLI restarts without publishing', t => {
  const f = setup(t);
  const planFile = path.join(f.root, 'plan.json');
  const inputFile = path.join(f.root, 'inputs.json');
  fs.writeFileSync(planFile, JSON.stringify(f.plan('a'.repeat(40))));
  fs.writeFileSync(inputFile, JSON.stringify(f.inputs(1)));
  // Init is clock-independent, so use the helper clock for execution timestamps afterwards.
  const candidateId = f.create();
  const result = f.runCli(['init', '--plan', planFile, '--inputs', inputFile]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).candidateId, candidateId);
  assert.equal(Object.keys(readState(f.directory).candidates).length, 1);
  assert.match(f.runCli(['status', '--candidate', candidateId]).stdout, /NOT_RUN/);
  f.prepare(candidateId); f.approve(candidateId);
  const promoted = f.runCli(['promote-intent', '--candidate', candidateId, '--event', 'publish-intent-1']);
  assert.equal(promoted.status, 0, promoted.stderr + promoted.stdout);
  const intent = JSON.parse(promoted.stdout).intent;
  assert.equal(intent.candidate, f.plan('a'.repeat(40)).candidate);
  assert.equal(intent.manifest.artifacts.length, 2);
  const intentFile = path.join(f.root, 'intent.json');
  fs.writeFileSync(intentFile, JSON.stringify(intent));
  const checked = f.runCli(['check-intent', '--intent', intentFile, '--tag', intent.version, '--sha', intent.candidate]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(f.runCli(['check-intent', '--intent', intentFile, '--tag', 'v2026.1018.1', '--sha', intent.candidate]).status, 2);
  const state = readState(f.directory);
  assert.equal(state.promotions.stable.status, 'READY_FOR_PUBLISHER');
  assert.equal(state.published, undefined);
  assert.equal(fs.statSync(path.join(f.directory, 'ledger.json')).mode & 0o777, 0o600);
});

test('required evidence cannot be waived, forged, replayed backwards or reused after file changes', t => {
  const f = setup(t);
  const id = f.create();
  f.artifact(id, 'mac');
  assert.throws(() => manifestFor(readState(f.directory).candidates[id], f.policy), /win NOT_RUN/);
  f.artifact(id, 'win'); f.quota();
  const budget = f.reserve(id); f.settle(id, budget.reservationId);
  for (const check of f.policy.requiredTests.slice(0, -1)) f.emit('evidence.recorded', {candidateId: id, envelope: f.report(id, check.id)});
  assert.match(readiness(readState(f.directory), id, f.policy, f.now(), checkFile).reason, /UPDATE-WIN NOT_RUN/);
  const good = f.report(id, 'UPDATE-WIN');
  for (const bad of [
    {...good, body: {...good.body, observed: 'Unsigned mutation'}},
    f.report(id, 'UPDATE-WIN', {fixture: true}),
    f.report(id, 'UPDATE-WIN', {environment: {kind: 'headless-build', target: 'win32-x64', runnerId: 'test-fixture'}}),
    f.report(id, 'UPDATE-WIN', {manifestDigest: '0'.repeat(64)}),
  ]) assert.equal(f.emit('evidence.recorded', {candidateId: id, envelope: bad}).status, 'BLOCKED');
  assert.equal(f.emit('evidence.recorded', {candidateId: id, envelope: good}).status, 'EVIDENCE_RECORDED');
  const notRun = f.report(id, 'UPDATE-WIN', {verdict: 'NOT_RUN'});
  f.emit('evidence.recorded', {candidateId: id, envelope: notRun});
  assert.match(readiness(readState(f.directory), id, f.policy, f.now(), checkFile).reason, /UPDATE-WIN NOT_RUN/);
  assert.equal(f.emit('evidence.recorded', {candidateId: id, envelope: good}).status, 'BLOCKED');
  f.emit('evidence.recorded', {candidateId: id, envelope: f.report(id, 'UPDATE-WIN')});
  const approval = f.approve(id);
  const forged = envelope({...approval.body, actor: 'attacker'}, keypair().privateKey);
  assert.equal(f.emit('approval.recorded', {candidateId: id, envelope: forged}).status, 'BLOCKED');
  const artifact = readState(f.directory).candidates[id].artifacts.mac;
  fs.appendFileSync(artifact.path, 'changed after approval');
  assert.match(f.emit('promotion.requested', {candidateId: id}).reason, /digest\/size mismatch/);
  const changedPolicy = {...f.policy, requiredTests: f.policy.requiredTests.slice(0, 1)};
  assert.match(readiness(readState(f.directory), id, changedPolicy, f.now(), checkFile).reason, /policy changed/);
  assert.equal(readState(f.directory).candidates[id].approval.signature, approval.signature, 'rejected actor must not replace prior approval');
});

test('one local ledger serializes concurrent 40-unit reservations against 60 free units; unknown/stale/cost overruns stay blocked', async t => {
  const f = setup(t);
  const a = f.create();
  const b = f.create('e'.repeat(40), 2);
  assert.match(f.reserve(a, 40).reason, /QUOTA_BLOCKED/);
  f.quota(60);
  const events = [a, b].map((candidateId, i) => ({id: `parallel-${i}`, type: 'work.reserved', data: {candidateId, stage: 'build', attempt: 1, resourceId: 'local-builder', units: 40}}));
  const paths = events.map((event, i) => { const p = path.join(f.root, `event-${i}.json`); fs.writeFileSync(p, JSON.stringify(event)); return p; });
  const children = await Promise.all(paths.map(eventFile => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'ingest', '--event-file', eventFile, '--store', f.directory, '--policy', f.policyFile]);
    let output = ''; child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
    child.on('exit', code => resolve({code, output, eventFile}));
  })));
  for (const child of children) if (child.output.includes('LEDGER_BUSY')) f.runCli(['ingest', '--event-file', child.eventFile]);
  const state = readState(f.directory);
  assert.equal(Object.keys(state.reservations).length, 1);
  assert.equal(state.quotas['local-builder'].availableUnits, 20);
  const reservation = Object.values(state.reservations)[0];
  assert.equal(f.settle(reservation.candidateId, reservation.reservationId, {actualUnits: 41}).status, 'QUOTA_BLOCKED');
  assert.match(f.reserve(reservation.candidateId, 1, 'build', 2).reason, /QUOTA_BLOCKED/);
  assert.equal(Object.values(readState(f.directory).reservations)[0].actualUnits, 41, 'overrun remains in the ledger');
  f.advance(601000);
  const c = f.create('f'.repeat(40), 3);
  assert.match(f.reserve(c, 1).reason, /QUOTA_BLOCKED/);
  assert.match(f.reserve(c, 1, 'build-again').reason, /not authorized/);
  assert.equal(f.emit('quota.observed', {resourceId: 'unpriced', periodId: 'p', remainingUnits: 999}).status, 'BLOCKED');
});

test('manager rotation, revocation, expiry and a newer channel intent invalidate old promotion replay', t => {
  const f = setup(t);
  const id = f.create(); f.prepare(id);
  const approval = f.approve(id);
  const promoted = f.emit('promotion.requested', {candidateId: id}, 'intent-before-revoke');
  assert.equal(promoted.status, 'PROMOTION_INTENT');
  const rotated = structuredClone(f.policy); rotated.managerRoster.revision = 'rotation-2';
  assert.throws(() => validateIntent(readState(f.directory), promoted.intent, rotated, f.now(), checkFile), /manager changed/);
  const revocation = envelope({schema: 'hps-release-revocation/1', candidateId: id, actor: 'jayleekr', roleRevision: f.policy.managerRoster.revision,
    approvalDigest: signedPayloadDigest(approval), revokedAt: new Date(f.now()).toISOString()}, f.manager.privateKey);
  f.emit('approval.revoked', {candidateId: id, envelope: revocation});
  assert.equal(f.emit('promotion.requested', {candidateId: id}, 'intent-before-revoke').status, 'BLOCKED', 'duplicate event cannot revive revoked authority');
  assert.equal(f.emit('approval.recorded', {candidateId: id, envelope: approval}, `approval-${digest(approval)}`).status, 'BLOCKED');
  assert.equal(f.emit('approval.recorded', {candidateId: id, envelope: approval}).status, 'BLOCKED');
  f.advance(1); f.approve(id);
  assert.throws(() => validateIntent(readState(f.directory), promoted.intent, f.policy, f.now(), checkFile), /superseded/);
  const fresh = f.emit('promotion.requested', {candidateId: id}, 'fresh-intent');
  assert.equal(fresh.status, 'PROMOTION_INTENT');
  f.advance(300001);
  assert.match(f.emit('promotion.requested', {candidateId: id}, 'fresh-intent').reason, /expired/);
  f.approve(id);
  f.emit('promotion.requested', {candidateId: id}, 'renewed-intent');
  const newer = f.create('f'.repeat(40), 2); f.prepare(newer); f.approve(newer);
  assert.equal(f.emit('promotion.requested', {candidateId: newer}).status, 'PROMOTION_INTENT');
  assert.equal(f.emit('promotion.requested', {candidateId: id}, 'renewed-intent').status, 'BLOCKED');
  assert.match(f.emit('promotion.requested', {candidateId: id}).reason, /newer channel/);
});

test('failure triage deduplicates ticket intents, preserves unpaid attempts across retries and cannot reset by a new run id', t => {
  const f = setup(t);
  const id = f.create(); f.quota();
  const observation = {candidateId: id, kind: 'product', checkId: 'UPDATE-WIN', signature: 'installer-exit-5', evidenceUri: 'local:redacted-run-log'};
  const first = f.emit('failure.observed', observation, 'failure-event-1');
  f.emit('failure.observed', observation, 'failure-event-2'); f.emit('failure.observed', observation, 'failure-event-3');
  assert.equal(f.emit('failure.observed', observation, 'failure-event-1').duplicate, true);
  assert.equal(Object.keys(readState(f.directory).failures).length, 1);
  assert.equal(readState(f.directory).failures[first.failureId].observations.length, 3);
  const anotherCandidate = f.create('e'.repeat(40), 2);
  assert.equal(f.emit('failure.observed', {...observation, candidateId: anotherCandidate}).failureId, first.failureId, 'the same regression across candidates updates one ticket intent');
  const reservation = f.reserve(id, 10, `fix:${first.failureId}`);
  assert.equal(f.emit('fix.requested', {candidateId: id, failureId: first.failureId, reservationId: reservation.reservationId}).status, 'FIX_INTENT');
  assert.match(f.emit('fix.requested', {candidateId: id, failureId: first.failureId, reservationId: reservation.reservationId}).reason, /limit/);
  assert.match(f.reserve(id, 10, `fix:${first.failureId}`, 2).reason, /settled/);
  f.settle(id, reservation.reservationId, {actualUnits: 10, outcome: 'timeout'});
  const newerRun = f.emit('candidate.requested', {plan: {...f.plan('a'.repeat(40)), version: 'v2026.1018.1', rcTag: 'v2026.1018.1-rc.1'}, inputs: f.inputs(50)});
  assert.match(newerRun.reason, /already pinned/);
  assert.match(readiness(readState(f.directory), id, f.policy, f.now(), checkFile).reason, /recorded failure/);
  const contract = f.emit('failure.observed', {...observation, kind: 'test-contract'});
  assert.match(f.emit('fix.requested', {candidateId: id, failureId: contract.failureId, reservationId: reservation.reservationId}).reason, /only product/);
});

test('SIGKILL preserves the ledger and the next start recovers only a dead same-host writer; event ids cannot change payload', t => {
  const f = setup(t);
  const id = f.create(); f.quota();
  const before = fs.readFileSync(path.join(f.directory, 'ledger.json'), 'utf8');
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {transact} from ${JSON.stringify(storeModule)}; transact(process.argv[1], state => { state.revision += 99; process.kill(process.pid, 'SIGKILL'); });`, f.directory]);
  assert.equal(killed.signal, 'SIGKILL');
  assert.equal(fs.readFileSync(path.join(f.directory, 'ledger.json'), 'utf8'), before);
  const lockPath = path.join(f.directory, fs.readdirSync(f.directory).find(name => name.endsWith('.claim.json')));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.throws(() => process.kill(lock.pid, 0), {code: 'ESRCH'});
  const event = {id: 'reservation-replayed', type: 'work.reserved', data: {candidateId: id, stage: 'build', attempt: 1, resourceId: 'local-builder', units: 30}};
  const reserved = ingest(f.directory, event, f.policy, {now: f.now()});
  const duplicate = ingest(f.directory, event, f.policy, {now: f.now()});
  assert.equal(duplicate.reservationId, reserved.reservationId);
  assert.equal(Object.keys(readState(f.directory).reservations).length, 1);
  assert.throws(() => ingest(f.directory, {...event, data: {...event.data, units: 1}}, f.policy, {now: f.now()}), /reused/);
  assert.equal(fs.existsSync(lockPath), false);
  const livePath = path.join(f.directory, 'writer-00000000-0000-0000-0000-000000000000.claim.json');
  fs.writeFileSync(livePath, JSON.stringify({pid: process.pid, hostname: os.hostname(), ticket: 1}));
  assert.throws(() => f.reserve(id, 1, 'verify'), /LEDGER_BUSY/);
  assert.equal(fs.existsSync(livePath), true, 'a live owner must never be stolen');
  fs.writeFileSync(livePath, JSON.stringify({pid: 99999999, hostname: 'another-host', ticket: 1}));
  assert.throws(() => f.reserve(id, 1, 'verify'), /foreign/);
  fs.unlinkSync(livePath);
  fs.writeFileSync(path.join(f.directory, 'ledger.json'), '{truncated');
  assert.throws(() => f.reserve(id, 1, 'test'), SyntaxError);
});

test('revocation binds the signed body: unsigned wrappers and equivalent base64 padding cannot revive it', t => {
  const f = setup(t);
  const id = f.create(); f.prepare(id);
  const approval = f.approve(id);
  const promoted = f.emit('promotion.requested', {candidateId: id});
  assert.equal(promoted.status, 'PROMOTION_INTENT');
  const revoke = targetDigest => envelope({schema: 'hps-release-revocation/1', candidateId: id, actor: 'jayleekr', roleRevision: f.policy.managerRoster.revision,
    approvalDigest: targetDigest, revokedAt: new Date(f.now()).toISOString()}, f.manager.privateKey);
  assert.equal(f.emit('approval.revoked', {candidateId: id, envelope: revoke(signedPayloadDigest(approval))}).status, 'APPROVAL_REVOKED');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const position = approval.signature.length - 3;
  const alternateSignature = approval.signature.slice(0, position) + chars[chars.indexOf(approval.signature[position]) + 1] + approval.signature.slice(position + 1);
  assert(Buffer.from(alternateSignature, 'base64').equals(Buffer.from(approval.signature, 'base64')), 'attack must preserve signature bytes');
  const variants = [{...approval, transportMetadata: 'unsigned'}, {body: approval.body, signature: alternateSignature}];
  for (const variant of variants) {
    assert.equal(signedPayloadDigest(variant), signedPayloadDigest(approval), 'transport spelling does not create new authority');
    assert.equal(f.emit('approval.recorded', {candidateId: id, envelope: variant}).status, 'BLOCKED');
    assert.equal(f.emit('promotion.requested', {candidateId: id}).status, 'BLOCKED');
    assert.throws(() => validateIntent(readState(f.directory), {...promoted.intent, approval: variant}, f.policy, f.now(), checkFile), /revoked/);
  }
  assert.equal(readState(f.directory).candidates[id].approval.signature, approval.signature, 'failed replay must not change stored approval');

  // Older local clients/ledgers used canonical-envelope digests. Their explicit
  // revocations must remain effective after upgrading to signed-payload identity.
  f.advance(1);
  const fresh = f.approve(id);
  assert.equal(f.emit('approval.revoked', {candidateId: id, envelope: revoke(digest(fresh))}).status, 'APPROVAL_REVOKED');
  assert(readState(f.directory).candidates[id].revokedApprovalDigests.includes(signedPayloadDigest(fresh)));
  assert.equal(f.emit('approval.recorded', {candidateId: id, envelope: fresh}).status, 'BLOCKED');
  f.advance(1);
  const replacement = f.approve(id);
  const legacy = readState(f.directory);
  legacy.candidates[id].revokedApprovalDigests.push(digest(replacement));
  fs.writeFileSync(path.join(f.directory, 'ledger.json'), JSON.stringify(legacy));
  assert.equal(f.emit('promotion.requested', {candidateId: id}).status, 'BLOCKED', 'pre-upgrade stored revocations remain enforced');
});

test('fresh provider allowance subtracts pending commitments and protected units before any new reservation', t => {
  const f = setup(t);
  const a = f.create(); const b = f.create('e'.repeat(40), 2); const c = f.create('f'.repeat(40), 3);
  f.quota(100);
  assert.equal(f.reserve(a, 60).status, 'WORK_RESERVED');
  const refresh = (remainingUnits, protectedUnits = 0) => {
    f.advance(1);
    const previous = readState(f.directory).quotas['local-builder'];
    return f.emit('quota.observed', {...previous, remainingUnits, protectedUnits, observedAt: new Date(f.now()).toISOString()});
  };
  const sufficient = refresh(90, 10);
  assert.equal(sufficient.availableUnits, 20, '90 remaining minus 10 protected minus 60 pending');
  assert.equal(f.reserve(b, 20).status, 'WORK_RESERVED', 'only the uncommitted balance may be reserved');
  assert.equal(refresh(90, 10).availableUnits, 0, 'refresh must not release earlier reservations');
  assert.equal(f.reserve(c, 1).status, 'BLOCKED');
  const shortage = refresh(50);
  const state = readState(f.directory);
  assert.equal(shortage.availableUnits, 0);
  assert.equal(state.quotas['local-builder'].underfunded, true);
  assert.equal(state.quotas['local-builder'].pendingUnitsAtObservation, 80);
  assert.equal(f.reserve(c, 40).status, 'BLOCKED');
  assert.equal(Object.values(state.reservations).filter(r => r.status === 'reserved').reduce((total, r) => total + r.units, 0), 80, 'refresh cannot erase pending consumption');

  const exact = setup(t);
  const x = exact.create(); const y = exact.create('e'.repeat(40), 2);
  exact.quota(100); const pending = exact.reserve(x, 60);
  exact.advance(1);
  const previous = readState(exact.directory).quotas['local-builder'];
  const dropped = exact.emit('quota.observed', {...previous, remainingUnits: 50, observedAt: new Date(exact.now()).toISOString()});
  assert.equal(dropped.availableUnits, 0, 'independent review counterexample: 100 → reserve 60 → fresh 50');
  assert.equal(exact.reserve(y, 40).status, 'BLOCKED');
  exact.settle(x, pending.reservationId, {actualUnits: 20});
  assert.equal(exact.reserve(y, 1).status, 'BLOCKED', 'uncertain provider reconciliation never refunds capacity implicitly');
});
