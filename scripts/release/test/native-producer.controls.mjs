import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {digest} from '../engine/core.mjs';
import {inspectFile, readState} from '../engine/store.mjs';
import {prepareContext, attest, assemble} from '../native-producer.mjs';
import {viewDigest, stateBranch} from '../publisher-anchor.mjs';
import {verifyMachineBundle} from '../machine-publication.mjs';
import {evidenceRecords, fetchEvidence} from '../machine-evidence.mjs';
const pem = key => key.export({format: 'pem', type: 'spki'});
const privatePem = key => key.export({format: 'pem', type: 'pkcs8'});
export function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-protocol-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const packages = path.join(root, 'packages'), store = path.join(root, 'ledger'), harness = path.join(root, 'harness');
  fs.mkdirSync(packages); fs.mkdirSync(path.join(harness, 'scripts/hype-release/desktop_check'), {recursive: true});
  // Generated source pins; known exporter output is supplied below.
  const sources = {'desktop_cli.py': '# generated protocol control\n', 'core.py': '# protocol core\n', 'transport.py': '# protocol transport\n', 'desktop_check/__init__.py': '# protocol package\n'};
  for (const [name, bytes] of Object.entries(sources)) fs.writeFileSync(path.join(harness, 'scripts/hype-release', name), bytes);
  const git = (...args) => execFileSync('git', ['-C', harness, ...args], {encoding: 'utf8', stdio: ['ignore','pipe','pipe']}).trim();
  git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/hypeproof/hypeproof-harness.git'); git('add', '.');
  git('-c','user.name=Protocol Control','-c','user.email=control@example.invalid','commit','-qm','Generated test source');
  const keys = Object.fromEntries(['win32-x64','darwin-arm64','coordinator'].map(id => [id, generateKeyPairSync('ed25519')]));
  const now = Date.now(), createdAt = new Date(now - 30000).toISOString();
  const config = {schema: 'hps-release-automation/1', repository: 'hypeproof/hypeproof-studio', revision: 'native-control', mode: 'active',
    evidenceRepository: 'hypeproof/hypeproof-studio-releases', maxAgeSeconds: 3600, harnessRevision: git('rev-parse', 'HEAD'), harnessTestRevision: digest(sources),
    attestors: [{id: 'coordinator', publicKey: pem(keys.coordinator.publicKey)}], engine: {
      reporters: ['win32-x64','darwin-arm64'].map(id => ({id, targets: [id], publicKey: pem(keys[id].publicKey)})),
      requiredWork: [{id: 'desktop', resourceId: 'included'}], fixResourceId: 'included', quotaMaxAgeSeconds: 600,
      maxAttemptsPerStage: 2, maxFixAttempts: 1, managerRoster: {revision: 'none', terms: []}}};
  const artifacts = ['win32-x64','darwin-arm64'].map(target => {
    const name = target + '.zip', file = path.join(packages, name); fs.writeFileSync(file, `Generated package: ${target}`);
    const {path: _, ...record} = inspectFile(file); return {id: target, target, name, ...record};
  });
  const contract = {schema: 'hps-machine-contract/1', repository: config.repository, releasePr: 33, releaseHead: 'b'.repeat(40),
    candidate: 'a'.repeat(40), rcTag: 'v2026.1109.0-rc.1', version: 'v2026.1109.0', platforms: artifacts.map(a => a.target), artifacts,
    serviceSha: 'e'.repeat(40), service: {schema: 'hps-service-deployment-proof/1', repository: 'hypeproof/hypeproof-service',
      base: 'https://api.hypeproof-ai.xyz/v1', version: 'e'.repeat(40), tag: null, tagObject: null, commit: 'e'.repeat(40)},
    checklist: {checklistRevision: 'f'.repeat(64), cases: [{id: 'BB-004', expect: ['Visible native start.'], contractDigest: '8'.repeat(64)}]}};
  const candidate = {repository: config.repository, sourceSha: contract.candidate, tag: contract.rcTag, version: contract.version};
  const required = artifacts.map(a => ({id: 'BB-004', platform: a.target, checkId: 'desktop:BB-004:' + a.target, expected: 'Visible native start.',
    identity: {kind: 'installed-app', repository: config.repository, sourceSha: contract.candidate, artifactSha256: a.sha256,
      os: a.target.split('-')[0], arch: a.target.split('-')[1], testRevision: config.harnessTestRevision,
      acceptanceRevision: contract.checklist.checklistRevision, environmentRevision: 'owned-control', serviceRevision: 'service-control'}}));
  const routingContract = {repository: config.repository, releasePr: 33, required};
  const policySnapshot = {routing: {contract: routingContract, resolvers: ['human-owner']}};
  const input = {schema: 'hype-release-publisher-input/1', candidate, channelSequence: 1,
    state: {schema: 'hype-release-state/1', revision: 1, candidate, candidateDigest: digest(candidate), policyDigest: digest(policySnapshot), createdAt,
      checks: {}, operations: {}, costs: [], tokenUsage: []}, registry: {schema: 'hype-release-routing/1', revision: 1, candidates: {}, tasks: {}},
    contract: routingContract, plan: {status: 'READY', readinessDigest: '6'.repeat(64)}, effective: []};
  input.registry.candidates[input.state.candidateDigest] = {policySnapshot, policyDigest: input.state.policyDigest, failures: {}, resolutions: {}};
  const runs = {};
  for (const row of required) {
    const runKey = digest(row), directory = path.join(root, runKey); fs.mkdirSync(directory);
    const snapshot = {platform: row.platform, candidate: contract.candidate, prHead: contract.releaseHead, pr: 33, rcTag: contract.rcTag,
      checklist: contract.checklist, testRevision: config.harnessTestRevision, artifact: artifacts.find(a => a.target === row.platform),
      service: {base: contract.service.base, version: contract.service.version}};
    const png = path.join(directory, 'capture.png'), ax = path.join(directory, 'capture.json');
    fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a00000000','hex')); fs.writeFileSync(ax, JSON.stringify({role: 'window', name: 'Generated protocol'}));
    const files = [png, ax].map(file => ({...inspectFile(file), path: path.basename(file)}));
    const report = {runKey, identity: row.identity, startedAt: (now - 20000) / 1000, finishedAt: (now - 10000) / 1000,
      cleanup: {status: 'PASS'}, serviceObserved: snapshot.service, acceptanceServiceMatches: true,
      cases: [{id: row.id, result: 'PASS', files}]};
    fs.writeFileSync(path.join(directory, 'snapshot.json'), JSON.stringify(snapshot)); fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report));
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({runKey, session: 1}));
    const observation = {id: row.checkId, verdict: 'PASS', expected: row.expected, observed: 'Generated native-role protocol control.', evidence: 'sha256:' + digest(report) + '#' + row.id, identity: row.identity};
    input.state.checks[row.checkId] = observation;
    input.effective.push({required: row, observation, observationDigest: digest({required: row, check: observation}), resolution: null, resolutionDigest: null});
    runs[row.platform] = {directory, observation};
  }
  const context = prepareContext({input, product: {config, contract, sequence: 1}, packages, store, now});
  const capacityAt = new Date(now - 5000).toISOString();
  input.state.publicationCapacity = {schema: 'hps-release-capacity/1', events: [
    {id: 'included-quota', type: 'quota.observed', at: capacityAt, data: {resourceId: 'included', periodId: 'generated', startsAt: createdAt,
      endsAt: new Date(now + 3600000).toISOString(), observedAt: capacityAt, remainingUnits: 10, protectedUnits: 0,
      status: 'confirmed', incrementalUnitCost: 0, paidFallback: false, evidenceUri: 'protocol-control:provider-allowance'}},
    {id: 'included-reservation', type: 'work.reserved', at: capacityAt, data: {candidateId: '@candidate', stage: 'desktop', resourceId: 'included', attempt: 1, units: 2}},
    {id: 'included-settlement', type: 'work.settled', at: capacityAt, data: {candidateId: '@candidate', reservationId: context.reservationIds.desktop, actualUnits: 2, incrementalCost: 0, outcome: 'success'}}]};
  const request = {repository: contract.repository, releasePr: 33, releaseHead: contract.releaseHead, candidateSha: contract.candidate, rcTag: contract.rcTag,
    contractDigest: digest(contract), readinessDigest: input.plan.readinessDigest, workflowHead: '9'.repeat(40), workflow: 'release-promote.yml', dispatchKey: 'unique-control'};
  const requestDigest = digest({kind: 'publish-pass', request});
  input.state.operations.publish = {kind: 'publish-pass', status: 'UNKNOWN', request, requestDigest, reservedUsd: '0', startedAt: capacityAt,
    quote: {status: 'CONFIRMED', kind: 'publish-pass', candidateDigest: input.state.candidateDigest, requestDigest, upperBoundUsd: '0', paidFallback: false,
      evidence: 'protocol-control:provider-bounds', observedAt: createdAt, expiresAt: new Date(now + 60000).toISOString()}};
  const anchor = () => { input.anchor = {schema: 'hps-publisher-anchor/1', algorithm: 'typed-double-v1', repository: config.repository,
    candidateDigest: input.state.candidateDigest, operationId: 'publish', candidateBranch: stateBranch(config.repository, contract.rcTag),
    registryBranch: stateBranch(config.repository, 'release-result-routing-v1'), status: 'READY', readinessDigest: input.plan.readinessDigest,
    viewDigest: viewDigest(input.state, input.registry, 'publish')}; };
  anchor();
  const packets = [];
  const makePacket = target => {
    const run = runs[target], out = path.join(root, 'packet-' + target);
    const result = attest({input, context, harness, snapshotFile: path.join(run.directory, 'snapshot.json'), runDirectory: run.directory,
      evidenceRoot: root, target, reporterId: target, privateKey: privatePem(keys[target].privateKey), out, host: target, now,
      validateNative: (_command, args) => {
        // Generated exporter output; production invokes pinned validation.
        const output = args[args.indexOf('--output') + 1]; fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'BB-004.json'), JSON.stringify(run.observation));
      }});
    assert.equal(result.status, 'ATTESTED'); packets.push(out); return out;
  };
  const build = out => assemble({input, context, packets, packages, store, attestorId: 'coordinator', privateKey: privatePem(keys.coordinator.privateKey), out, now});
  return {root, packages, store, harness, input, context, keys, runs, packets, now, makePacket, build, anchor};
}
test('native platform roles assemble complete signed bytes through persistent engine and portable private fetch', t => {
  const f = fixture(t); f.makePacket('win32-x64'); f.makePacket('darwin-arm64');
  const out = path.join(f.root, 'assembled'); const result = f.build(out); assert.equal(result.status, 'ASSEMBLED');
  const bundle = JSON.parse(fs.readFileSync(path.join(out, 'bundle.json')));
  assert.equal(Object.hasOwn(bundle.body.intent, 'approval'), false);
  assert.equal(evidenceRecords(bundle.body).length, new Set(bundle.body.attachments.map(f => f.sha256)).size);
  const state = readState(f.store); assert.equal(state.quotas.included.availableUnits, 8); assert.equal(Object.keys(state.reservations).length, 1);
  const again = path.join(f.root, 'again'); f.build(again); assert.equal(readState(f.store).quotas.included.availableUnits, 8);
  const fetched = path.join(f.root, 'fetched');
  assert.equal(fetchEvidence({pr: 33, commit: '7'.repeat(40), cfg: f.context.config, out: fetched, get: name => fs.readFileSync(path.join(out, name))}).status, 'FETCHED');
  const verify = () => verifyMachineBundle({bundle, config: f.context.config, contract: f.context.contract, packageDirectory: f.packages,
    evidenceDirectory: fetched, serviceVersion: f.context.contract.service.version, now: f.now});
  assert.equal(verify().allow, true);
  const capture = bundle.body.attachments.find(record => record.path.endsWith('.png'));
  fs.appendFileSync(path.join(fetched, 'blobs', capture.sha256), 'changed'); assert.throws(verify, /digest\/size mismatch/);
});
test('native attestation refuses signing on a different actual platform', t => {
  const f = fixture(t);
  assert.throws(() => attest({input: f.input, context: f.context, target: 'darwin-arm64', host: 'win32-x64'}), /actual native host/);
});
test('assembly refuses missing capacity, stale effective evidence, original FAIL and incomplete/changed attachments', t => {
  const f = fixture(t); f.makePacket('win32-x64'); f.makePacket('darwin-arm64');
  const capacity = f.input.state.publicationCapacity; delete f.input.state.publicationCapacity; f.anchor();
  assert.throws(() => f.build(path.join(f.root, 'no-capacity')), /included capacity/);
  f.input.state.publicationCapacity = capacity; f.anchor();
  const journal = f.input.registry.candidates[f.input.state.candidateDigest]; journal.failures['original-failure'] = {verdict: 'FAIL'};
  assert.throws(() => f.build(path.join(f.root, 'failed')), /without candidate failure/); delete journal.failures['original-failure'];
  f.input.effective[0].observation.observed = 'Changed effective source'; f.anchor();
  assert.throws(() => f.build(path.join(f.root,'stale')), /stale/);
  f.input.effective[0].observation.observed = 'Generated native-role protocol control.'; f.anchor();
  const packetFile = path.join(f.packets[0], 'packet.json'), packet = JSON.parse(fs.readFileSync(packetFile));
  const png = packet.body.attachments.find(file => file.path.endsWith('.png')); fs.unlinkSync(path.join(f.packets[0], 'blobs', png.sha256));
  assert.throws(() => f.build(path.join(f.root,'missing-attachment')), /ENOENT/);
});

test('overrun capacity settlement remains durable when bundle assembly refuses publication', t => {
  const f = fixture(t); f.makePacket('win32-x64'); f.makePacket('darwin-arm64');
  f.input.state.publicationCapacity.events[2].data.actualUnits = 12; f.anchor();
  assert.throws(() => f.build(path.join(f.root, 'overrun')), /QUOTA_BLOCKED/);
  const state = readState(f.store); assert.equal(state.quotas.included.overrun, true);
  assert.equal(state.reservations[f.context.reservationIds.desktop].actualUnits, 12);
  assert.equal(state.reservations[f.context.reservationIds.desktop].status, 'settled');
});
