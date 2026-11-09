import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {initialState, applyEvent, canonical, digest, manifestFor} from '../engine/core.mjs';
import {automationConfig, policyFor, signMachineBundle, verifyMachineBundle, releaseContract, resolveServiceProof} from '../machine-publication.mjs';
import {fetchEvidence} from '../machine-evidence.mjs';

// Protocol keys/bytes below are not installed-App observations or production credentials.
export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-publication-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const packages = path.join(root, 'packages'), evidence = path.join(root, 'evidence');
  fs.mkdirSync(packages); fs.mkdirSync(path.join(evidence, 'blobs'), {recursive: true});
  const record = (folder, name, bytes) => {
    fs.writeFileSync(path.join(folder, name), bytes);
    return {path: path.join(folder, name), sha256: createHash('sha256').update(bytes).digest('hex'), size: Buffer.byteLength(bytes)};
  };
  const key = generateKeyPairSync('ed25519'), pem = key.publicKey.export({format: 'pem', type: 'spki'});
  const config = {schema: 'hps-release-automation/1', repository: 'hypeproof/hypeproof-studio', revision: 'control', mode: 'active',
    evidenceRepository: 'hypeproof/hypeproof-studio-releases', maxAgeSeconds: 3600, harnessRevision: 'c'.repeat(40), harnessTestRevision: 'd'.repeat(64),
    attestors: [{id: 'control', publicKey: pem}], engine: {reporters: [{id: 'runner', publicKey: pem, targets: ['win32-x64','darwin-arm64']}],
      requiredWork: [{id: 'desktop', resourceId: 'included'}], fixResourceId: 'included', quotaMaxAgeSeconds: 600,
      maxAttemptsPerStage: 2, maxFixAttempts: 1, managerRoster: {revision: 'no-manager', terms: []}}};
  const candidate = 'a'.repeat(40), head = 'b'.repeat(40), rcTag = 'v2026.1109.0-rc.1', version = 'v2026.1109.0';
  const artifacts = ['win32-x64','darwin-arm64'].map(target => {
    const name = target === 'win32-x64' ? 'HypeProof.Studio-win32-x64-control.zip' : 'HypeProof-Studio-darwin-arm64.zip';
    return {id: target, target, name, ...record(packages, name, `Protocol package ${target}`)};
  });
  const contract = {schema: 'hps-machine-contract/1', repository: config.repository, releasePr: 33, releaseHead: head, candidate,
    rcTag, version, platforms: artifacts.map(a => a.target), artifacts: artifacts.map(({path: _path, ...a}) => a), serviceSha: 'e'.repeat(40),
    dependencyServiceSha: '0'.repeat(40), service: {schema: 'hps-service-deployment-proof/1', repository: 'hypeproof/hypeproof-service',
      base: 'https://api.hypeproof-ai.xyz/v1', version: 'service-v2026.11.09-1+eeeeeeee', tag: 'service-v2026.11.09-1', tagObject: '1'.repeat(40), commit: 'e'.repeat(40)},
    checklist: {checklistRevision: 'f'.repeat(64), cases: [{id: 'BB-004', expect: ['Installed start appears.']}]}};
  let state = initialState(), serial = 0, now = Date.now();
  const policy = policyFor(config, contract), emit = (type, data) => {
    const result = applyEvent(state, {id: `event-${++serial}`, type, data}, policy, {now, checkFile: f => {
      const actual = fs.readFileSync(f.path);
      assert.equal(createHash('sha256').update(actual).digest('hex'), f.sha256); assert.equal(actual.length, f.size);
    }}); state = result.state; assert.notEqual(result.result.status, 'BLOCKED', result.result.reason); return result.result;
  };
  const id = emit('candidate.requested', {plan: {schema: 'hps-release-plan/0', trial: false, candidate, version, rcTag},
    inputs: {serviceSha: contract.serviceSha, testRevision: config.harnessRevision, rubricRevision: candidate, sequence: 1}}).candidateId;
  for (const a of artifacts) emit('artifact.recorded', {candidateId: id, artifact: a});
  emit('quota.observed', {resourceId: 'included', periodId: 'control', startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 3600000).toISOString(),
    observedAt: new Date(now).toISOString(), remainingUnits: 20, protectedUnits: 0, status: 'confirmed', incrementalUnitCost: 0, paidFallback: false, evidenceUri: 'control:included'});
  const reservation = emit('work.reserved', {candidateId: id, stage: 'desktop', resourceId: 'included', attempt: 1, units: 2});
  emit('work.settled', {candidateId: id, reservationId: reservation.reservationId, actualUnits: 2, incrementalCost: 0, outcome: 'success'});
  for (const check of policy.requiredTests) {
    const original = record(root, `report-${serial}.json`, `Protocol report ${check.id}`);
    fs.copyFileSync(original.path, path.join(evidence, 'blobs', original.sha256));
    const body = {schema: 'hps-black-box-evidence/1', candidateId: id, manifestDigest: digest(manifestFor(state.candidates[id], policy)),
      testId: check.id, reporterId: 'runner', artifactDigest: artifacts.find(a => a.id === check.artifactId).sha256,
      serviceSha: contract.serviceSha, testRevision: config.harnessRevision, rubricRevision: candidate,
      requirementId: check.requirementId, expected: check.expected, observed: 'Protocol control, not App evidence.', verdict: 'PASS', execution: 'observed',
      environment: {kind: 'installed-app', target: check.artifactId, runnerId: 'control'}, startedAt: new Date(now).toISOString(), endedAt: new Date(now).toISOString(), file: original};
    emit('evidence.recorded', {candidateId: id, envelope: {body, signature: sign(null, Buffer.from(canonical(body)), key.privateKey).toString('base64')}});
  }
  const {intent} = emit('promotion.requested', {candidateId: id});
  const signed = (extra = {}) => signMachineBundle({state, policy, intent, contract, attestorId: 'control', privateKey: key.privateKey.export({format: 'pem', type: 'pkcs8'}), now, ...extra});
  const bundle = signed();
  return {root, config, contract, bundle, policy, state, intent, signed, evidence, packages, now,
    verify: (extra = {}) => verifyMachineBundle({bundle, config, contract, packageDirectory: packages, evidenceDirectory: evidence, serviceVersion: contract.service.version, now, ...extra})};
}

test('private portable machine bundle revalidates actual files and complete policy without human approval', t => {
  const f = fixture(t), result = f.verify();
  assert.equal(result.allow, true); assert.equal(result.status, 'READY_FOR_PUBLISHER');
  assert.equal(Object.hasOwn(f.intent, 'approval'), false);
  assert.equal(f.verify({config: {...f.config, mode: 'shadow'}}).allow, false);
  assert.throws(() => f.verify({serviceVersion: '0'.repeat(7)}), /Service/);
  assert.throws(() => f.verify({contract: {...f.contract, releaseHead: '0'.repeat(40)}}), /contract is stale/);
  assert.throws(() => f.verify({now: f.now + 3600001}), /stale/);
  const changed = structuredClone(f.bundle); changed.body.intent.version = 'v2026.1109.9';
  assert.throws(() => f.verify({bundle: changed}), /signature failed/);
  const subset = {...f.policy, requiredTests: f.policy.requiredTests.slice(0, 1)};
  assert.throws(() => f.verify({bundle: f.signed({policy: subset})}), /trusted policy/);
  const artifact = f.contract.artifacts[0]; fs.appendFileSync(path.join(f.packages, artifact.name), 'changed');
  assert.throws(() => f.verify(), /digest\/size mismatch/);
});

test('immutable private transport is bounded, verified and absent in shadow mode', t => {
  const f = fixture(t), out = path.join(f.root, 'fetched');
  const bundleBytes = Buffer.from(JSON.stringify(f.bundle));
  const reads = [], get = name => {
    reads.push(name); return name === 'bundle.json' ? bundleBytes : fs.readFileSync(path.join(f.evidence, name));
  };
  assert.equal(fetchEvidence({pr: 33, commit: '1'.repeat(40), out, cfg: {...f.config, mode: 'shadow'}, get: () => assert.fail('unexpected network')}).status, 'NOT_APPLICABLE');
  assert.equal(fs.existsSync(out), false);
  assert.equal(fetchEvidence({pr: 33, commit: '1'.repeat(40), out, cfg: f.config, get}).status, 'FETCHED');
  assert.equal(reads.length, 1 + f.policy.requiredTests.length);
  assert.equal(f.verify({evidenceDirectory: out}).allow, true);
  assert.throws(() => fetchEvidence({pr: 34, commit: '1'.repeat(40), out: path.join(f.root, 'foreign'), cfg: f.config, get}), /another release/);
  assert.throws(() => fetchEvidence({pr: 33, commit: 'main', out: path.join(f.root, 'mutable'), cfg: f.config, get}), /immutable/);
  assert.throws(() => automationConfig({...f.config, harnessRevision: null}), /Harness/);
});

test('frozen checklist parser refuses missing P0, changed case text and unrecognized checkboxes', () => {
  const candidate = 'a'.repeat(40), head = 'b'.repeat(40), version = 'v2026.1109.0';
  const book = 'cases:\n  - id: BB-004\n    priority: P0\n    title: Starts\n    steps: [Open]\n    expect: [Visible]\n';
  const record = '### Black-box cases\n- [ ] **BB-004** P0 Starts — Open\n## 5. Automatic\n';
  const args = {pr: {number: 33, head}, commit: {sha: head, parents: [candidate], files: [`releases/${version}.md`], message: `release: record ${version}-rc.1`},
    candidate, version, rcTag: `${version}-rc.1`, assets: [{name: 'HypeProof-Studio-darwin-arm64.zip', digest: 'sha256:' + 'c'.repeat(64), size: 10}],
    acceptance: {schema: 'hps-unified-release/1', receipts: [{platform: 'darwin-arm64', status: 'PASS', sourceSha: candidate,
      assets: {'HypeProof-Studio-darwin-arm64.zip': 'c'.repeat(64)}, publicService: {status: 'PASS', base: 'https://api.hypeproof-ai.xyz/v1', version: 'd'.repeat(40)}}]},
    serviceProof: {schema: 'hps-service-deployment-proof/1', repository: 'hypeproof/hypeproof-service', base: 'https://api.hypeproof-ai.xyz/v1', version: 'd'.repeat(40), tag: null, tagObject: null, commit: 'd'.repeat(40)}};
  const read = text => text.includes('releases/') ? record : text.endsWith('cases.yaml') ? book : text.endsWith('release-platforms.json') ? '{"version":1,"platforms":["darwin-arm64"]}' : '{"repository":"hypeproof/hypeproof-service","sha":"' + 'd'.repeat(40) + '"}';
  assert.equal(releaseContract({...args, read}).checklist.cases.length, 1);
  assert.throws(() => releaseContract({...args, read: rev => rev.includes('releases/') ? record.replace('Starts —', 'Other —') : read(rev)}), /differs/);
  assert.throws(() => releaseContract({...args, read: rev => rev.includes('releases/') ? record.replace('- [ ]', '- [ ] unparsed') : read(rev)}), /unrecognized/);
  assert.throws(() => releaseContract({...args, read: rev => rev.endsWith('cases.yaml') ? book + '  - id: BB-005\n    priority: P0\n' : read(rev)}), /omitted a required P0/);
  for (const marker of ['*', '+', '1.', '2)']) {
    assert.throws(() => releaseContract({...args, read: rev => rev.includes('releases/') ?
      record.replace('## 5.', `${marker} [ ] **BB-005** P1 Stops — Close\n## 5.`) : read(rev)}), /unrecognized/);
  }
});

test('actual Service deployment version resolves to full annotated source independently of a dependency pin', () => {
  const full = 'd95f0ea5d234f593b74984440ab6ce59f25a6f20', tagObject = '6a38d72f09c84c3142fd14214ce8e4dcca696345';
  const calls = [], get = endpoint => {
    calls.push(endpoint);
    return endpoint.includes('/git/ref/') ? {object: {type: 'tag', sha: tagObject}}
      : {sha: tagObject, tag: 'service-v2026.11.08-1', object: {type: 'commit', sha: full}};
  };
  const proof = resolveServiceProof('service-v2026.11.08-1+d95f0ea5', get);
  assert.equal(proof.commit, full); assert.equal(proof.tagObject, tagObject);
  assert.equal(calls.length, 2); assert.ok(calls.every(p => p.startsWith('repos/hypeproof/hypeproof-service/')));
  assert.throws(() => resolveServiceProof('service-v2026.11.08-1+04cd2b4a', get), /binding differs/);
});
