import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {initialState, applyEvent, canonical, digest, manifestFor, readiness, approvalRequest, validateIntent, validatePolicy} from '../engine/core.mjs';

// Imported by engine.test.mjs so the existing mandatory CI command always runs these controls.
// Generated keys and package bytes are protocol controls, never installed-App acceptance.
function fixture(t, authority = 'machine') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-release-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const key = generateKeyPairSync('ed25519');
  const policy = {schema: 'hps-release-policy/1', revision: 'machine-protocol-control',
    ...(authority === 'omitted' ? {} : {publicationAuthority: authority}),
    requiredArtifacts: [{id: 'win', target: 'win32-x64'}, {id: 'mac', target: 'darwin-arm64'}],
    requiredTests: ['win', 'mac'].map(id => ({id: `BB-START-${id}`, artifactId: id, requirementId: 'REQ-I4',
      expected: 'Installed candidate starts.', environment: 'installed-app', reporterIds: ['runner']})),
    reporters: [{id: 'runner', publicKey: key.publicKey.export({format: 'pem', type: 'spki'})}],
    requiredWork: [{id: 'build', resourceId: 'builder'}], fixResourceId: 'builder',
    quotaMaxAgeSeconds: 600, maxAttemptsPerStage: 2, maxFixAttempts: 1,
    managerRoster: {revision: 'no-manager-needed', terms: []}};
  let state = initialState(), serial = 0, now = Date.now();
  const stamp = () => new Date(now).toISOString();
  const record = name => {
    const file = path.join(root, name);
    fs.writeFileSync(file, `Protocol control bytes: ${name}`);
    const bytes = fs.readFileSync(file);
    return {path: file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  };
  const checkFile = file => {
    const bytes = fs.readFileSync(file.path);
    assert.equal(bytes.length, file.size, 'file size mismatch');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, 'file digest mismatch');
  };
  const signed = body => ({body, signature: sign(null, Buffer.from(canonical(body)), key.privateKey).toString('base64')});
  const emit = (type, data, id = `event-${++serial}`) => {
    const result = applyEvent(state, {id, type, data}, policy, {now, checkFile});
    state = result.state; return result.result;
  };
  const id = emit('candidate.requested', {
    plan: {schema: 'hps-release-plan/0', trial: false, candidate: 'a'.repeat(40), version: 'v2026.1109.0', rcTag: 'v2026.1109.0-rc.1'},
    inputs: {serviceSha: 'b'.repeat(40), testRevision: 'c'.repeat(40), rubricRevision: 'd'.repeat(40), sequence: 1}}).candidateId;
  assert.ok(id);
  for (const artifact of policy.requiredArtifacts) assert.equal(emit('artifact.recorded', {
    candidateId: id, artifact: {...artifact, ...record(artifact.id)}}).status, 'ARTIFACT_RECORDED');
  emit('quota.observed', {resourceId: 'builder', periodId: 'included', startsAt: new Date(now - 1000).toISOString(),
    endsAt: new Date(now + 3600000).toISOString(), observedAt: stamp(), remainingUnits: 100, protectedUnits: 0,
    status: 'confirmed', incrementalUnitCost: 0, paidFallback: false, evidenceUri: 'protocol-control:included'});
  const reservation = emit('work.reserved', {candidateId: id, stage: 'build', resourceId: 'builder', attempt: 1, units: 10});
  emit('work.settled', {candidateId: id, reservationId: reservation.reservationId, actualUnits: 10, incrementalCost: 0, outcome: 'success'});
  const report = (testId, overrides = {}) => {
    now++;
    const item = state.candidates[id], check = policy.requiredTests.find(c => c.id === testId);
    return signed({schema: 'hps-black-box-evidence/1', candidateId: id, manifestDigest: digest(manifestFor(item, policy)),
      testId, reporterId: 'runner', artifactDigest: item.artifacts[check.artifactId].sha256,
      serviceSha: item.input.serviceSha, testRevision: item.input.testRevision, rubricRevision: item.input.rubricRevision,
      requirementId: check.requirementId, expected: check.expected, observed: 'Protocol control only.', verdict: 'PASS',
      execution: 'observed', environment: {kind: 'installed-app', target: item.artifacts[check.artifactId].target, runnerId: 'protocol-control'},
      startedAt: stamp(), endedAt: stamp(), file: record(`report-${serial++}.json`), ...overrides});
  };
  for (const check of policy.requiredTests) assert.equal(emit('evidence.recorded', {candidateId: id, envelope: report(check.id)}).status, 'EVIDENCE_RECORDED');
  return {policy, id, emit, report, signed, checkFile, get state() { return state; }, get now() { return now; },
    ready: () => readiness(state, id, policy, now, checkFile), advance: ms => { now += ms; }};
}

test('machine PASS creates an explicit intent without a manager or fabricated approval', t => {
  const f = fixture(t);
  assert.equal(f.ready().status, 'MACHINE_READY');
  assert.throws(() => approvalRequest(f.state, f.id, f.policy, '', f.now, f.checkFile), /does not request/);
  assert.equal(f.emit('approval.recorded', {candidateId: f.id, envelope: {}}).status, 'BLOCKED');
  const {intent, status} = f.emit('promotion.requested', {candidateId: f.id}, 'promote');
  assert.equal(status, 'PROMOTION_INTENT');
  assert.equal(Object.hasOwn(intent, 'approval'), false);
  assert.equal(intent.authority.schema, 'hps-machine-publication/1');
  assert.equal(validateIntent(f.state, intent, f.policy, f.now, f.checkFile).status, 'READY_FOR_PUBLISHER');
  assert.equal(f.emit('promotion.requested', {candidateId: f.id}, 'promote').duplicate, true);
  f.advance(600001);
  assert.equal(f.emit('promotion.requested', {candidateId: f.id}, 'promote').status, 'BLOCKED');
});

for (const verdict of ['FAIL', 'BLOCKED', 'NOT_RUN']) test(`${verdict} never becomes machine readiness`, t => {
  const f = fixture(t), check = f.policy.requiredTests[0];
  f.emit('evidence.recorded', {candidateId: f.id, envelope: f.report(check.id, {verdict})});
  assert.equal(f.ready().status, 'BLOCKED');
  assert.equal(f.emit('promotion.requested', {candidateId: f.id}).status, 'BLOCKED');
});

for (const change of ['missing', 'signature', 'candidate', 'service', 'execution', 'target', 'time', 'contract', 'artifact']) {
  test(`readiness revalidates imported evidence: ${change}`, t => {
    const f = fixture(t), check = f.policy.requiredTests[0], item = f.state.candidates[f.id];
    const overrides = {candidate: {candidateId: 'other'}, service: {serviceSha: 'e'.repeat(40)}, execution: {fixture: true},
      target: {environment: {kind: 'headless-build', target: 'win32-x64', runnerId: 'control'}},
      time: {endedAt: '2100-01-01T00:00:00Z'}, contract: {expected: 'Unreviewed replacement'}};
    if (change === 'missing') delete item.evidence[check.id];
    else if (change === 'artifact') item.artifacts.win.target = 'linux-x64';
    else if (change === 'signature') item.evidence[check.id].body.observed = 'unsigned replacement';
    else item.evidence[check.id] = f.report(check.id, overrides[change]);
    assert.equal(f.ready().status, 'BLOCKED');
  });
}

test('publisher rejects changed bytes, missing verifier, mixed authority and policy downgrade', t => {
  const f = fixture(t), {intent} = f.emit('promotion.requested', {candidateId: f.id});
  assert.throws(() => validateIntent(f.state, {...intent, approval: null}, f.policy, f.now, f.checkFile), /authority mismatch/);
  assert.throws(() => validateIntent(f.state, intent, {...f.policy, publicationAuthority: 'manager'}, f.now, f.checkFile), /policy changed/);
  assert.throws(() => validateIntent(f.state, intent, f.policy, f.now), /file verifier/);
  fs.appendFileSync(f.state.candidates[f.id].artifacts.win.path, 'changed');
  assert.equal(f.ready().status, 'BLOCKED');
  assert.throws(() => validateIntent(f.state, intent, f.policy, f.now, f.checkFile), /mismatch/);
});

test('omitted authority retains manager approval and invalid authorities refuse policy', t => {
  const f = fixture(t, 'omitted');
  assert.equal(f.ready().status, 'AWAITING_APPROVAL');
  assert.equal(f.emit('promotion.requested', {candidateId: f.id}).status, 'BLOCKED');
  for (const value of [null, false, 'auto', '']) {
    assert.throws(() => validatePolicy({...f.policy, publicationAuthority: value}), /invalid publication authority/);
  }
});
