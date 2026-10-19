import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import * as local from '../engine/core.mjs';
import {ingest, readState} from '../engine/store.mjs';

const engine = fileURLToPath(new URL('../engine/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const now = Date.parse('2026-10-19T00:00:00Z');
const bytes = 'FIN02 protocol fixture bytes; not installed-App evidence';
function fixture(filePath = 'fixture:bytes') {
  const key = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const publicKey = key.publicKey.export({format: 'pem', type: 'spki'});
  const policy = {
    schema: 'hps-release-policy/1', revision: 'fin02-fixture-1',
    requiredArtifacts: [{id: 'mac', target: 'darwin-arm64'}],
    requiredTests: [{id: 'INSTALL-MAC', artifactId: 'mac', requirementId: 'REQ-I4', expected: 'Fixture starts.', environment: 'installed-app', reporterIds: ['runner']}],
    reporters: [{id: 'runner', publicKey}], requiredWork: [{id: 'build', resourceId: 'builder'}], fixResourceId: 'builder',
    quotaMaxAgeSeconds: 600, maxAttemptsPerStage: 2, maxFixAttempts: 1,
    managerRoster: {revision: 'fixture-rotation', terms: [{actor: 'manager', publicKey, startsAt: '2026-10-18T00:00:00Z', endsAt: '2026-10-20T00:00:00Z'}]},
  };
  const signed = (body, privateKey = key.privateKey) => ({body, signature: sign(null, Buffer.from(local.canonical(body)), privateKey).toString('base64')});
  let state = local.initialState();
  let serial = 0;
  const events = [];
  const emit = (type, data) => {
    const event = {id: `fixture-${++serial}`, type, data}; events.push(event);
    const result = local.applyEvent(state, event, policy, {now, checkFile: () => {}}); state = result.state; return result.result;
  };
  const id = emit('candidate.requested', {
    plan: {schema: 'hps-release-plan/0', trial: false, candidate: 'a'.repeat(40), version: 'v2026.1019.0', rcTag: 'v2026.1019.0-rc.1'},
    inputs: {serviceSha: 'b'.repeat(40), testRevision: 'c'.repeat(40), rubricRevision: 'd'.repeat(40), sequence: 1},
  }).candidateId;
  const file = {path: filePath, sha256: hash(bytes), size: Buffer.byteLength(bytes)};
  emit('artifact.recorded', {candidateId: id, artifact: {id: 'mac', target: 'darwin-arm64', ...file}});
  emit('quota.observed', {resourceId: 'builder', periodId: 'fixture-period', startsAt: '2026-10-18T00:00:00Z', endsAt: '2026-10-20T00:00:00Z', observedAt: new Date(now).toISOString(), remainingUnits: 10, protectedUnits: 0, status: 'confirmed', incrementalUnitCost: 0, paidFallback: false, evidenceUri: 'fixture:quota'});
  const reservation = emit('work.reserved', {candidateId: id, stage: 'build', resourceId: 'builder', attempt: 1, units: 2});
  emit('work.settled', {candidateId: id, reservationId: reservation.reservationId, actualUnits: 2, incrementalCost: 0, outcome: 'success'});
  const body = {
    schema: 'hps-black-box-evidence/1', candidateId: id, manifestDigest: local.digest(local.manifestFor(state.candidates[id], policy)),
    testId: 'INSTALL-MAC', reporterId: 'runner', artifactDigest: file.sha256, serviceSha: 'b'.repeat(40), testRevision: 'c'.repeat(40), rubricRevision: 'd'.repeat(40),
    requirementId: 'REQ-I4', expected: 'Fixture starts.', observed: 'Synthetic protocol execution only.', verdict: 'PASS', execution: 'observed',
    environment: {kind: 'installed-app', target: 'darwin-arm64', runnerId: 'protocol-fixture'}, startedAt: new Date(now).toISOString(), endedAt: new Date(now).toISOString(), file,
  };
  const evidence = signed(body);
  emit('evidence.recorded', {candidateId: id, envelope: evidence});
  const approval = signed(local.approvalRequest(state, id, policy, '2026-10-19T00:05:00Z', now, () => {}));
  emit('approval.recorded', {candidateId: id, envelope: approval});
  emit('promotion.requested', {candidateId: id});
  return {policy, events, candidateId: id, now, bytes, evidence, wrongKey: signed(body, other.privateKey)};
}

// This exact replay runs against the installed tarball and workerd; no second engine.
function replay(core, f) {
  let state = core.initialState();
  const results = [];
  const checkFile = file => {
    const actual = Buffer.from(f.bytes);
    // Digest of bytes, not the canonical-JSON digest exported by the core.
    if (file.size !== actual.length || file.sha256 !== coreByteHash(actual)) throw new Error('file digest/size mismatch');
  };
  // Inject the host's synchronous byte hasher into each runtime below.
  const coreByteHash = data => globalThis.fixtureHash(data);
  for (const event of f.events) {
    const out = core.applyEvent(state, event, f.policy, {now: f.now, checkFile}); state = out.state; results.push(out.result);
  }
  const item = state.candidates[f.candidateId];
  const intent = state.promotions.stable;
  const status = core.validateIntent(state, intent, f.policy, f.now, checkFile);
  const attack = envelope => core.applyEvent(state, {id: 'attack', type: 'evidence.recorded', data: {candidateId: f.candidateId, envelope}}, f.policy, {now: f.now, checkFile}).result;
  const tampered = attack({...f.evidence, body: {...f.evidence.body, observed: 'unsigned mutation'}});
  const wrongKey = attack(f.wrongKey);
  const changedBytes = core.readiness(state, item.id, f.policy, f.now, file => checkFile({...file, size: file.size + 1}));
  const missingVerifier = core.readiness(state, item.id, f.policy, f.now);
  const asyncVerifier = core.readiness(state, item.id, f.policy, f.now, async () => {});
  const asyncRejectVerifier = core.readiness(state, item.id, f.policy, f.now, async () => {throw new Error('async verifier rejected');});
  const promiseRejectVerifier = core.readiness(state, item.id, f.policy, f.now, () => Promise.reject(new Error('ordinary verifier rejected')));
  const falseVerifier = core.readiness(state, item.id, f.policy, f.now, () => false);
  const thenableVerifier = core.readiness(state, item.id, f.policy, f.now, () => ({then() {}}));
  const artifactBase = core.applyEvent(core.initialState(), f.events[0], f.policy, {now: f.now}).state;
  const refusedArtifact = [undefined, () => false, async () => {}, async () => {throw new Error('async verifier rejected');}, () => Promise.reject(new Error('ordinary verifier rejected')), () => ({then() {}})].map(verifier => {
    const outcome = core.applyEvent(artifactBase, f.events[1], f.policy, {now: f.now, checkFile: verifier});
    return {result: outcome.result, artifactCount: Object.keys(outcome.state.candidates[f.candidateId].artifacts).length};
  });
  return {results, refusedArtifact, stateDigest: core.digest(state), canonical: core.canonical({z: [3, 2], a: '한글'}), status, tampered, wrongKey, changedBytes, missingVerifier, asyncVerifier, asyncRejectVerifier, promiseRejectVerifier, falseVerifier, thenableVerifier};
}
function assertReplay(result) {
  assert.equal(result.status.status, 'READY_FOR_PUBLISHER');
  assert.equal(result.results.at(-1).status, 'PROMOTION_INTENT');
  for (const refused of result.refusedArtifact) { assert.equal(refused.result.status, 'BLOCKED'); assert.equal(refused.artifactCount, 0); }
  for (const name of ['tampered', 'wrongKey', 'changedBytes', 'missingVerifier', 'asyncVerifier', 'asyncRejectVerifier', 'promiseRejectVerifier', 'falseVerifier', 'thenableVerifier']) assert.equal(result[name].status, 'BLOCKED', name);
  assert.match(result.tampered.reason, /signature verification/);
  assert.match(result.wrongKey.reason, /signature verification/);
  assert.match(result.changedBytes.reason, /digest\/size mismatch/);
}

function packed(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-core-consumer-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const run = (cmd, args) => {
    const out = spawnSync(cmd, args, {cwd: root, encoding: 'utf8'});
    assert.equal(out.status, 0, out.stderr + out.stdout); return out.stdout;
  };
  const info = JSON.parse(run('npm', ['pack', engine, '--json', '--ignore-scripts', '--pack-destination', root]))[0];
  assert.deepEqual(info.files.map(file => file.path).sort(), ['README.md', 'core.mjs', 'package.json', 'provenance.json']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'isolated-release-core-consumer', private: true, type: 'module'}));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', path.join(root, info.filename)]);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.equal(lock.packages['node_modules/@hypeproof/release-engine-core'].version, '0.1.0');
  assert.equal(lock.packages['node_modules/@hypeproof/release-engine-core'].integrity, info.integrity);
  const packageRoot = path.join(root, 'node_modules/@hypeproof/release-engine-core');
  assert.equal(fs.lstatSync(packageRoot).isSymbolicLink(), false);
  const provenance = JSON.parse(fs.readFileSync(path.join(packageRoot, 'provenance.json')));
  assert.equal(provenance.sourceSha256, hash(fs.readFileSync(path.join(packageRoot, 'core.mjs'))));
  return {root, run, packageRoot};
}

test('FIN02 installed tarball replays signed release decisions in an isolated consumer', t => {
  const consumer = packed(t);
  const filePath = path.join(consumer.root, 'fixture-bytes');
  fs.writeFileSync(filePath, bytes);
  const f = fixture(filePath);
  fs.writeFileSync(path.join(consumer.root, 'fixture.json'), JSON.stringify(f));
  fs.writeFileSync(path.join(consumer.root, 'consumer.mjs'), `import * as core from '@hypeproof/release-engine-core'; import assert from 'node:assert/strict'; import {createHash} from 'node:crypto'; import fs from 'node:fs'; globalThis.fixtureHash = data => createHash('sha256').update(data).digest('hex'); for (const name of ['store.mjs', 'cli.mjs', 'core.mjs', 'provenance.json']) { await assert.rejects(import('@hypeproof/release-engine-core/' + name), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'}); } assert.deepEqual(await import('@hypeproof/release-engine-core/core'), core); console.log(JSON.stringify((${replay.toString()})(core, JSON.parse(fs.readFileSync('fixture.json')))));`);
  const result = JSON.parse(consumer.run(process.execPath, ['consumer.mjs']));
  assertReplay(result);
  // The CLI's actual filesystem adapter replays the same records and bytes.
  const ledger = path.join(consumer.root, 'cli-ledger');
  const results = f.events.map(event => ingest(ledger, event, f.policy, {now: f.now}));
  assert.deepEqual(results, result.results);
  assert.equal(local.digest(readState(ledger)), result.stateDigest);
  // A refused async verifier must not crash the host on the next event-loop turn.
  fs.writeFileSync(path.join(consumer.root, 'rejected-verifier.mjs'), `
import * as core from '@hypeproof/release-engine-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setImmediate} from 'node:timers/promises';
const f = JSON.parse(fs.readFileSync('fixture.json'));
const state = core.applyEvent(core.initialState(), f.events[0], f.policy, {now: f.now}).state;
for (const checkFile of [async () => {throw new Error('async verifier rejected');}, () => Promise.reject(new Error('ordinary verifier rejected'))]) {
  const out = core.applyEvent(state, f.events[1], f.policy, {now: f.now, checkFile});
  assert.equal(out.result.status, 'BLOCKED');
  assert.match(out.result.reason, /must be synchronous/);
  assert.deepEqual(out.state.candidates[f.candidateId].artifacts, {});
  await setImmediate();
}
console.log('Rejected async and ordinary Promise verifiers blocked; process survived.');
`);
  assert.match(consumer.run(process.execPath, ['--unhandled-rejections=strict', 'rejected-verifier.mjs']), /process survived/);
});

// Always exercise workerd: install the pinned runtime with npm ci --prefix scripts/release/engine.
test('FIN02 workerd nodejs_compat matches the installed Node consumer', async t => {
  const consumer = packed(t);
  const requireEngine = createRequire(new URL('../engine/package.json', import.meta.url));
  const modulePath = process.env.RELEASE_ENGINE_MINIFLARE_MODULE || requireEngine.resolve('miniflare');
  const {Miniflare} = await import(pathToFileURL(modulePath));
  const f = fixture();
  globalThis.fixtureHash = data => hash(data);
  const expected = replay(local, f); assertReplay(expected);
  const script = `import * as core from './core.mjs'; import {createHash} from 'node:crypto'; globalThis.fixtureHash=data=>createHash('sha256').update(data).digest('hex'); export default {async fetch(request){return Response.json((${replay.toString()})(core,await request.json()));}}`;
  const mf = new Miniflare({workers: [{config: {name: 'release-core-fixture', compatibilityDate: '2026-10-06', compatibilityFlags: ['nodejs_compat'], manifest: {mainModule: 'worker.mjs', modules: {'worker.mjs': {type: 'esm', contents: script}, 'core.mjs': {type: 'esm', contents: fs.readFileSync(path.join(consumer.packageRoot, 'core.mjs'), 'utf8')}}}}}]});
  try {
    const response = await mf.dispatchFetch('http://release-core.test', {method: 'POST', body: JSON.stringify(f)});
    assert.equal(response.status, 200, await response.clone().text());
    const actual = await response.json(); assertReplay(actual); assert.deepEqual(actual, expected);
  } finally { await mf.dispose(); }
});
