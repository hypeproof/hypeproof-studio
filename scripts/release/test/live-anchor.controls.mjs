import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from '../engine/core.mjs';
import {inspectFile} from '../engine/store.mjs';
import {attest, verifyHarness} from '../native-producer.mjs';
import {typedDigest, validateAnchor, readLiveAnchor} from '../publisher-anchor.mjs';
import {fixture as nativeFixture} from './native-producer.controls.mjs';
const privatePem = key => key.export({format: 'pem', type: 'pkcs8'});
function fixture(t) {
  const f = nativeFixture(t), op = f.input.state.operations.publish;
  op.request.dispatchKey = 'd'.repeat(64); op.requestDigest = digest({kind: 'publish-pass', request: op.request});
  op.quote.requestDigest = op.requestDigest; f.anchor(); return f;
}
test('typed-double-v1 agrees with independent Python double bits and UTF8 key order', () => {
  const vectors = [null, true, '한글😀', {z: 1.0, '𐀀': 1e-7, '': [0, 1e10, 0.5]}, [1e-300, -4.25e12]];
  const code = `import sys,json,struct,hashlib
def n(v):
 if v is None:return ['z']
 if type(v) is bool:return ['b',v]
 if type(v) is str:return ['s',v]
 if type(v) in (int,float):return ['n',struct.pack('>d',float(v)).hex()]
 if type(v) is list:return ['a',[n(x) for x in v]]
 return ['o',[[k,n(v[k])] for k in sorted(v,key=lambda k:k.encode('utf-8'))]]
for v in json.load(sys.stdin):print(hashlib.sha256(json.dumps(n(v),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())`;
  const expected = execFileSync('python3', ['-c', code], {input: JSON.stringify(vectors), encoding: 'utf8'}).trim().split('\n');
  assert.deepEqual(vectors.map(typedDigest), expected); assert.notEqual(typedDigest(-0), typedDigest(0));
  for (const value of [Infinity, NaN, 9007199254740992, undefined]) assert.throws(() => typedDigest(value));
  assert.throws(() => typedDigest(String.fromCharCode(0xD800)));
});
test('live full CAS rejects same-candidate FAIL and every semantic drift while accepting only own settlement bookkeeping', t => {
  const f = fixture(t), receipt = {bundleDigest: '2'.repeat(64), evidenceCommit: '3'.repeat(40), dispatchKey: 'd'.repeat(64)};
  f.input.state.operations.publish.result = {...receipt};
  assert.equal(validateAnchor(f.input.anchor, f.input.state, f.input.registry, f.context.contract, receipt).status, 'UNKNOWN');
  const done = structuredClone(f.input.state); done.revision++; done.operations.publish.status = 'DONE'; done.operations.publish.finishedAt = new Date().toISOString();
  assert.equal(validateAnchor(f.input.anchor, done, f.input.registry, f.context.contract, receipt).status, 'DONE');
  for (const mutate of [s => { Object.values(s.checks)[0].verdict = 'FAIL'; }, s => { s.supersededBy = 'new'; }, s => { s.costs.push({amountUsd: '0.2'}); },
    s => { s.publicationCapacity.events[0].data.remainingUnits = 0; }, s => { s.owner = 'new-human'; }, s => { s.tokenUsage.push({inputTokens: 1}); },
    s => { s.operations.other = {kind: 'unobserved-work'}; }]) {
    const changed = structuredClone(f.input.state); mutate(changed);
    assert.throws(() => validateAnchor(f.input.anchor, changed, f.input.registry, f.context.contract, receipt), /CAS changed/);
  }
  for (const mutate of [j => { j.policySnapshot.routing.resolvers = ['other']; }, j => { j.resolutions.current = {verdict: 'FAIL', reason: 'new human evidence'}; },
    j => { j.failures.global = {attempts: 3}; }, j => { j.policySnapshot.newBudget = '0'; }]) {
    const registry = structuredClone(f.input.registry); mutate(registry.candidates[f.input.state.candidateDigest]);
    assert.throws(() => validateAnchor(f.input.anchor, f.input.state, registry, f.context.contract, receipt), /CAS changed/);
  }
  const failed = structuredClone(done); failed.operations.publish.status = 'FAILED';
  assert.throws(() => validateAnchor(f.input.anchor, failed, f.input.registry, f.context.contract, receipt), /reserved/);
  for (const mutate of [s => { s.operations.publish.result.evidenceCommit = '0'.repeat(40); }, s => { s.operations.publish.result.dispatchKey = '0'.repeat(64); }]) {
    const changed = structuredClone(done); mutate(changed);
    assert.throws(() => validateAnchor(f.input.anchor, changed, f.input.registry, f.context.contract, receipt), /receipt/);
  }
});
test('live reader derives product-only branches and reads immutable exact commit bytes', t => {
  const f = fixture(t), receipt = {bundleDigest: '2'.repeat(64), evidenceCommit: '3'.repeat(40), dispatchKey: 'd'.repeat(64)};
  f.input.state.operations.publish.result = {...receipt};
  const calls = [], get = endpoint => {
    calls.push(endpoint);
    if (endpoint.includes('/git/ref/')) return {object: {type: 'commit', sha: endpoint.endsWith(f.input.anchor.candidateBranch) ? '4'.repeat(40) : '5'.repeat(40)}};
    const value = endpoint.endsWith('4'.repeat(40)) ? f.input.state : f.input.registry;
    return {encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64')};
  };
  readLiveAnchor(f.input.anchor, f.context.contract, receipt, get);
  assert.throws(() => readLiveAnchor(f.input.anchor, {...f.context.contract, repository: 'other/private'}, receipt, () => assert.fail('foreign read')), /fixed Studio/);
  assert.equal(calls.length, 4); assert.ok(calls.every(c => c.startsWith('repos/hypeproof/hypeproof-studio/')));
  assert.ok(calls[1].endsWith('4'.repeat(40))); assert.ok(calls[3].endsWith('5'.repeat(40)));
  assert.throws(() => readLiveAnchor({...f.input.anchor, candidateBranch: 'https://untrusted.example'}, f.context.contract, receipt, get), /branch mismatch/);
  assert.ok(calls.every(c => !c.includes('untrusted')));
  assert.throws(() => validateAnchor(f.input.anchor, f.input.state, f.input.registry, f.context.contract, {...receipt, dispatchKey: ''}), /receipt/);
});
test('native source/role guards refuse cross-platform signing, changed validator and missing structured human proof', t => {
  const f = fixture(t), run = f.runs['win32-x64'];
  const args = {input: f.input, context: f.context, harness: f.harness, target: 'darwin-arm64', host: 'win32-x64', reporterId: 'win32-x64',
    privateKey: privatePem(f.keys['win32-x64'].privateKey), snapshotFile: path.join(run.directory, 'snapshot.json'), runDirectory: run.directory, evidenceRoot: f.root, out: path.join(f.root,'bad')};
  assert.throws(() => attest(args), /actual native host/);
  assert.throws(() => attest({...args, target: 'win32-x64', reporterId: 'darwin-arm64'}), /reviewed for this platform/);
  fs.appendFileSync(path.join(f.harness, 'scripts/hype-release/core.py'), '# changed'); assert.throws(() => verifyHarness(f.harness, f.context.config), /source changed/);
  const g = fixture(t), row = g.input.effective[0], resolution = {questionId: 'question-control', actor: 'human-owner',
    observationDigest: row.observationDigest, execution: 'human-observed', verdict: 'PASS', reason: 'Human protocol control.', evidence: 'protocol:manual', recordedAt: new Date(g.now).toISOString()};
  row.observation.verdict = 'BLOCKED'; row.resolution = resolution; g.input.registry.candidates[g.input.state.candidateDigest].resolutions[resolution.questionId] = resolution;
  assert.throws(() => g.makePacket('win32-x64'), /structured attributable/);
  const native = g.runs['win32-x64'];
  resolution.proof = {schema: 'hps-native-human-proof/1', actor: resolution.actor, caseId: 'BB-004', platform: 'win32-x64',
    identity: row.required.identity, execution: 'human-observed', cleanup: {status: 'PASS'}, service: {base: g.context.contract.service.base, version: g.context.contract.service.version},
    startedAt: new Date(g.now - 9000).toISOString(), endedAt: new Date(g.now - 8000).toISOString(),
    files: ['capture.png','capture.json'].map(name => ({...inspectFile(path.join(native.directory,name)), path: path.relative(g.root,path.join(native.directory,name))}))};
  const packetDir = g.makePacket('win32-x64'); assert.ok(packetDir);
  fs.rmSync(packetDir, {recursive: true}); row.observation.verdict = 'FAIL';
  assert.throws(() => g.makePacket('win32-x64'), /cannot override/);
});
