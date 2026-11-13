#!/usr/bin/env node
// Native role signs observations; the existing engine grants intent.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {canonical, digest, applyEvent, manifestFor, validateIntent} from './engine/core.mjs';
import {inspectFile, checkFile, transact} from './engine/store.mjs';
import {automationConfig, policyFor, signMachineBundle, verifyMachineBundle} from './machine-publication.mjs';
import {typedDigest, viewDigest} from './publisher-anchor.mjs';
const require = (ok, reason) => { if (!ok) throw Error(reason); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const same = (a, b) => typedDigest(a) === typedDigest(b);
const MAX_FILE = 25 * 1024 * 1024, MAX_TOTAL = 100 * 1024 * 1024;
const signed = (body, privateKey) => {
  const key = createPrivateKey(privateKey); require(key.asymmetricKeyType === 'ed25519', 'Ed25519 native role key required');
  return {body, signature: sign(null, Buffer.from(canonical(body)), key).toString('base64')};
};
function owned(root, filename) {
  const base = path.resolve(root), absolute = path.resolve(filename), relative = path.relative(base, absolute);
  require(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'evidence is outside owned root');
  for (let current = absolute;; current = path.dirname(current)) {
    require(!fs.lstatSync(current).isSymbolicLink(), 'linked evidence refused');
    if (current === base) break;
  }
  const record = inspectFile(absolute); require(record.size <= MAX_FILE, 'evidence exceeds file cap'); return record;
}
function copyFiles(files, out) {
  const unique = new Map(files.map(f => [f.sha256, f]));
  require([...unique.values()].reduce((n, f) => n + f.size, 0) <= MAX_TOTAL, 'evidence exceeds total cap');
  fs.mkdirSync(path.join(out, 'blobs'), {recursive: true, mode: 0o700});
  for (const file of unique.values()) {
    checkFile(file); const target = path.join(out, 'blobs', file.sha256);
    if (!fs.existsSync(target)) fs.copyFileSync(file.path, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
  return [...unique.values()];
}
function sourceBinding(input) {
  return typedDigest({candidate: input.candidate, contract: input.contract, effective: input.effective,
    policy: input.registry.candidates[input.state.candidateDigest].policySnapshot});
}
export function publisherInput(input, context) {
  require(input?.schema === 'hype-release-publisher-input/1' && input.state?.schema === 'hype-release-state/1' && input.registry?.schema === 'hype-release-routing/1', 'canonical publisher input required');
  require(same(input.candidate, input.state.candidate) && input.candidate.repository === context.contract.repository && input.candidate.sourceSha === context.contract.candidate && input.candidate.tag === context.contract.rcTag, 'publisher candidate differs from product contract');
  const journal = input.registry.candidates?.[input.state.candidateDigest];
  require(journal?.policySnapshot && journal.policyDigest === input.state.policyDigest && same(journal.policySnapshot.routing.contract, input.contract), 'operator policy snapshot differs from candidate');
  require(Array.isArray(input.effective) && input.effective.length === context.policy.requiredTests.length, 'complete effective matrix required');
  const keys = new Set();
  for (const row of input.effective) {
    const required = row.required, key = `${required.id}:${required.platform}`;
    require(!keys.has(key), 'duplicate effective row'); keys.add(key);
    const test = context.policy.requiredTests.find(t => t.id === key);
    require(test && required.expected === test.expected && same(required, input.contract.required.find(r => r.checkId === required.checkId)), 'routing and product acceptance matrix differ');
    require(required.identity?.sourceSha === context.contract.candidate && required.identity.os + '-' + required.identity.arch === required.platform && required.identity.testRevision === context.config.harnessTestRevision && required.identity.acceptanceRevision === context.contract.checklist.checklistRevision, 'native source/tool/checklist binding differs');
    require(required.identity.artifactSha256 === context.contract.artifacts.find(a => a.target === required.platform)?.sha256, 'native package binding differs');
    require(same(row.observation, input.state.checks?.[required.checkId] ?? null), 'original observation changed');
    if (row.resolution) require(journal.policySnapshot.routing.resolvers.includes(row.resolution.actor) && row.resolution.execution === 'human-observed' && row.resolution.observationDigest === row.observationDigest && same(row.resolution, journal.resolutions?.[row.resolution.questionId]), 'current attributable human resolution required');
  }
  return journal;
}
function emit(state, event, policy, now) {
  const outcome = applyEvent(state, event, policy, {now, checkFile});
  require(!['BLOCKED', 'QUOTA_BLOCKED'].includes(outcome.result.status), outcome.result.reason ?? outcome.result.status);
  return outcome;
}
export function prepareContext({input, product, packages, store, now = Date.now()}) {
  automationConfig(product.config);
  const policy = policyFor(product.config, product.contract), base = {...product, policy};
  publisherInput(input, base);
  require(Number.isSafeInteger(product.sequence) && product.sequence === input.channelSequence && product.sequence > 0, 'explicit monotonic release sequence required');
  const created = Date.parse(input.state.createdAt); require(Number.isFinite(created) && created <= now, 'original candidate creation time required');
  return transact(store, original => {
    let state = original;
    const send = (type, data, at = now) => {
      const event = {id: 'native-' + digest({type, data}), type, data};
      const outcome = emit(state, event, policy, at); state = outcome.state; return outcome.result;
    };
    const {candidateId} = send('candidate.requested', {plan: {schema: 'hps-release-plan/0', trial: false, candidate: product.contract.candidate,
      rcTag: product.contract.rcTag, version: product.contract.version}, inputs: {serviceSha: product.contract.serviceSha,
      testRevision: product.config.harnessRevision, rubricRevision: product.contract.candidate, sequence: product.sequence}}, created);
    for (const artifact of product.contract.artifacts) {
      const file = owned(packages, path.join(packages, artifact.name));
      require(file.sha256 === artifact.sha256 && file.size === artifact.size, 'actual RC package differs');
      send('artifact.recorded', {candidateId, artifact: {...artifact, ...file}});
    }
    const manifest = manifestFor(state.candidates[candidateId], policy);
    return {state, result: {schema: 'hps-native-context/1', config: product.config, contract: product.contract, policy, candidateId,
      sequence: product.sequence, manifest, manifestDigest: digest(manifest),
      reservationIds: Object.fromEntries(policy.requiredWork.map(work => [work.id, `reservation-${digest({candidateId, stage: work.id, attempt: 1})}`]))}};
  });
}
export function verifyHarness(harness, config) {
  const git = (...args) => execFileSync('git', ['-C', harness, ...args], {encoding: 'utf8', timeout: 15000}).trim();
  require(['https://github.com/hypeproof/hypeproof-harness.git', 'git@github.com:hypeproof/hypeproof-harness.git'].includes(git('remote', 'get-url', 'origin')), 'official Harness origin required');
  require(git('rev-parse', 'HEAD') === config.harnessRevision, 'Harness is not the exact reviewed revision');
  const prefix = 'scripts/hype-release/', directory = path.join(harness, prefix, 'desktop_check');
  const names = [...fs.readdirSync(directory).filter(n => n.endsWith('.py')).map(n => 'desktop_check/' + n), 'core.py', 'transport.py', 'desktop_cli.py'].sort();
  const files = {};
  for (const name of names) {
    const filename = path.join(harness, prefix, name); owned(harness, filename);
    const bytes = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
    require(execFileSync('git', ['-C', harness, 'show', `${config.harnessRevision}:${prefix}${name}`], {encoding: 'utf8'}).replace(/\r\n/g, '\n') === bytes, 'reviewed Harness tool source changed');
    files[name] = bytes;
  }
  require(digest(files) === config.harnessTestRevision, 'complete Harness desktop tool digest differs');
  return path.join(harness, prefix, 'desktop_cli.py');
}
// The CLI always uses the real native host. Explicit platform injection is only for generated protocol controls.
export function attest({input, context, harness, snapshotFile, runDirectory, evidenceRoot, target, reporterId, privateKey, out,
  host = `${process.platform}-${process.arch}`, validateNative, now = Date.now()}) {
  publisherInput(input, context);
  require(['win32-x64', 'darwin-arm64'].includes(target) && host === target, 'requested platform differs from actual native host');
  const reporter = context.policy.reporters.find(r => r.id === reporterId && r.targets?.includes(target));
  require(reporter, 'reporter is not reviewed for this platform');
  require(createPublicKey(privateKey).export({format: 'pem', type: 'spki'}) === reporter.publicKey, 'native private key differs from reviewed platform role');
  const cli = verifyHarness(harness, context.config);
  require(!fs.existsSync(out), 'preserve existing native packet');
  owned(evidenceRoot, snapshotFile); owned(evidenceRoot, path.join(runDirectory, 'report.json'));
  const snapshot = json(snapshotFile), report = json(path.join(runDirectory, 'report.json'));
  require(snapshot.platform === target && snapshot.candidate === context.contract.candidate && snapshot.prHead === context.contract.releaseHead && snapshot.pr === context.contract.releasePr && snapshot.rcTag === context.contract.rcTag && same(snapshot.checklist, context.contract.checklist) && snapshot.testRevision === context.config.harnessTestRevision, 'native snapshot differs from current product contract');
  require(snapshot.artifact.sha256 === context.contract.artifacts.find(a => a.target === target)?.sha256 && snapshot.service.base === context.contract.service.base && snapshot.service.version === context.contract.service.version, 'snapshot package/accepted Service differs');
  const exports = fs.mkdtempSync(path.join(os.tmpdir(), 'native-export-'));
  // The pinned exporter reuses validate_report and validates every raw capture/file record.
  const exported = path.join(exports, 'checks');
  try {
    (validateNative ?? ((command, args) => execFileSync(command, args, {encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024})))('python3', [cli, 'export', '--event', 'release-candidate-ready', '--snapshot', snapshotFile, '--run-directory', runDirectory, '--output', exported]);
    require(fs.existsSync(exported), 'native validator did not export original observations');
    require(report.cleanup?.status === 'PASS' && report.cleanup.runnerQuarantined !== true, 'native cleanup is incomplete');
    const owner = json(path.join(runDirectory, 'owner.json'));
    require(owner.runKey === report.runKey && path.basename(runDirectory) === report.runKey && Number.isSafeInteger(owner.session), 'original owned native run required');
    require(Number.isFinite(report.startedAt) && Number.isFinite(report.finishedAt) && report.startedAt <= report.finishedAt && report.finishedAt * 1000 <= now, 'observed native execution time required');
    const envelopes = [], files = [owned(evidenceRoot, snapshotFile), owned(evidenceRoot, path.join(runDirectory, 'report.json')), owned(evidenceRoot, path.join(runDirectory, 'owner.json'))];
    for (const row of input.effective.filter(r => r.required.platform === target)) {
      const raw = json(path.join(exported, row.required.id + '.json'));
      require(row.observation ? ['id','verdict','expected','observed','evidence','identity'].every(k => same(raw[k], row.observation[k])) : row.resolution && raw.verdict === 'BLOCKED', 'original exported observation differs from current CAS check');
      const nativeCase = report.cases.find(c => c.id === row.required.id);
      require(nativeCase && same(report.identity, row.required.identity), 'original native case/identity differs');
      const attachments = files.slice(0, 3).concat(nativeCase.files.map(f => {
        const record = owned(runDirectory, path.join(runDirectory, f.path));
        require(record.sha256 === f.sha256 && record.size === f.size, 'original capture changed'); return record;
      }));
      let verdict = row.observation?.verdict ?? 'BLOCKED', observed = row.observation?.observed ?? raw.observed, startedAt = report.startedAt * 1000, endedAt = report.finishedAt * 1000;
      if (row.resolution) {
        require(!row.observation || ['BLOCKED', 'NOT_RUN'].includes(row.observation.verdict), 'human resolution cannot override an observed PASS or FAIL');
        const resolution = row.resolution, proof = resolution.proof;
        require(proof?.schema === 'hps-native-human-proof/1' && proof.actor === resolution.actor && proof.caseId === row.required.id && proof.platform === target && same(proof.identity, row.required.identity) && proof.execution === 'human-observed' && proof.cleanup?.status === 'PASS' && same(proof.service, {base: context.contract.service.base, version: context.contract.service.version}), 'structured attributable native human proof required');
        require(Array.isArray(proof.files) && proof.files.some(f => f.path.endsWith('.png')) && proof.files.some(f => f.path.endsWith('.json')), 'manual PNG and AX JSON captures required');
        for (const file of proof.files) {
          const actual = owned(evidenceRoot, path.join(evidenceRoot, file.path));
          require(actual.sha256 === file.sha256 && actual.size === file.size, 'manual capture changed');
          if (file.path.endsWith('.png')) require(fs.readFileSync(actual.path).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'manual screenshot is not PNG');
          if (file.path.endsWith('.json')) {
            const ax = json(actual.path); require(ax && typeof ax === 'object' && !Array.isArray(ax) && Object.keys(ax).length > 0, 'manual accessibility JSON is empty');
          }
          attachments.push(actual);
        }
        verdict = resolution.verdict; observed = resolution.reason;
        startedAt = Date.parse(proof.startedAt); endedAt = Date.parse(proof.endedAt);
        require(Number.isFinite(startedAt) && Number.isFinite(endedAt) && startedAt <= endedAt && endedAt <= now && Date.parse(resolution.recordedAt) >= endedAt, 'current human observed execution time required');
      } else require(report.acceptanceServiceMatches === true && same(report.serviceObserved, {base: context.contract.service.base, version: context.contract.service.version}), 'original native run did not observe accepted Service');
      require(verdict !== 'PASS' || row.resolution || nativeCase.result === 'PASS', 'PASS requires an original observed native run');
      const proofBody = {schema: 'hps-native-record/1', required: row.required, observation: row.observation, rawObservation: raw, observationDigest: row.observationDigest,
        resolution: row.resolution ?? null, resolutionDigest: row.resolutionDigest ?? null, attachments};
      fs.mkdirSync(out, {recursive: true, mode: 0o700});
      const proofPath = path.join(out, row.required.id + '.json'); fs.writeFileSync(proofPath, JSON.stringify(proofBody), {flag: 'wx', mode: 0o600});
      const file = inspectFile(proofPath), test = context.policy.requiredTests.find(t => t.id === row.required.id + ':' + target);
      files.push(...attachments, file);
      envelopes.push(signed({schema: 'hps-black-box-evidence/1', candidateId: context.candidateId, manifestDigest: context.manifestDigest,
        testId: test.id, reporterId, artifactDigest: row.required.identity.artifactSha256, serviceSha: context.contract.serviceSha,
        testRevision: context.config.harnessRevision, rubricRevision: context.contract.candidate, requirementId: test.requirementId,
        expected: test.expected, observed, verdict, execution: 'observed', environment: {kind: 'installed-app', target, runnerId: report.runKey},
        startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(), file, native: proofBody}, privateKey));
    }
    require(envelopes.length > 0, 'no native rows for target');
    const attachments = copyFiles(files, out);
    const packet = signed({schema: 'hps-native-packet/1', target, reporterId, candidateId: context.candidateId,
      manifestDigest: context.manifestDigest, policyDigest: digest(context.policy), sourceBinding: sourceBinding(input), envelopes, attachments}, privateKey);
    fs.writeFileSync(path.join(out, 'packet.json'), JSON.stringify(packet), {flag: 'wx', mode: 0o600});
    return {status: 'ATTESTED', target, candidateId: context.candidateId, packetDigest: digest(packet), files: attachments.length, publication: 'NOT_RUN'};
  } finally { fs.rmSync(exports, {recursive: true, force: true}); }
}
export function assemble({input, context, packets, packages, store, attestorId, privateKey, out, now = Date.now()}) {
  const journal = publisherInput(input, context);
  require(input.plan.status === 'READY' && input.anchor?.status === 'READY' && !input.state.supersededBy && Object.keys(journal.failures ?? {}).length === 0, 'current complete PASS without candidate failure required');
  require(input.state.operations?.[input.anchor.operationId]?.kind === 'publish-pass' && ['UNKNOWN','DONE'].includes(input.state.operations[input.anchor.operationId].status), 'reserved publish-pass operation required');
  require(input.anchor.viewDigest === viewDigest(input.state, input.registry, input.anchor.operationId), 'publisher input anchor changed');
  require(!fs.existsSync(out), 'preserve existing assembled bundle');
  const rows = new Map(), attachments = [], files = [];
  for (const directory of packets) {
    const packet = json(path.join(directory, 'packet.json')), body = packet.body;
    const reporter = context.policy.reporters.find(r => r.id === body?.reporterId && r.targets?.includes(body.target));
    require(reporter && body.schema === 'hps-native-packet/1' && verify(null, Buffer.from(canonical(body)), createPublicKey(reporter.publicKey), Buffer.from(packet.signature, 'base64')), 'native packet signature/role failed');
    require(body.candidateId === context.candidateId && body.manifestDigest === context.manifestDigest && body.policyDigest === digest(context.policy) && body.sourceBinding === sourceBinding(input), 'native packet is stale for current source/resolutions');
    for (const record of body.attachments) {
      const actual = owned(directory, path.join(directory, 'blobs', record.sha256));
      require(actual.sha256 === record.sha256 && actual.size === record.size, 'native packet attachment changed');
      attachments.push(record); files.push(actual);
    }
    for (const envelope of body.envelopes) {
      const b = envelope.body, required = context.policy.requiredTests.find(t => t.id === b.testId);
      require(required && required.artifactId === body.target && b.reporterId === body.reporterId && !rows.has(b.testId), 'native row is duplicate or outside role');
      require(b.verdict === 'PASS', 'non-PASS native packet cannot assemble');
      const effective = input.effective.find(r => r.required.id + ':' + r.required.platform === b.testId);
      require(effective && same(b.native.observation, effective.observation) && same(b.native.resolution, effective.resolution ?? null), 'current effective evidence differs');
      rows.set(b.testId, envelope);
    }
  }
  require(rows.size === context.policy.requiredTests.length, 'complete native packet matrix required');
  fs.mkdirSync(out, {recursive: true, mode: 0o700}); copyFiles(files, out);
  const outcome = transact(store, original => {
    require(original.candidates?.[context.candidateId] && digest(manifestFor(original.candidates[context.candidateId], context.policy)) === context.manifestDigest, 'persistent engine candidate/manifest missing or changed');
    let state = original;
    const verifier = record => {
      const artifact = context.contract.artifacts.find(a => a.sha256 === record.sha256);
      const actual = inspectFile(artifact ? path.join(packages, artifact.name) : path.join(out, 'blobs', record.sha256));
      require(actual.sha256 === record.sha256 && actual.size === record.size, 'assembled actual file differs');
    };
    const send = event => {
      const at = event.at ? Date.parse(event.at) : now;
      require(Number.isFinite(at) && at <= now, 'actual event time required');
      const result = applyEvent(state, event, context.policy, {now: at, checkFile: verifier}); state = result.state;
      require(!['BLOCKED', 'QUOTA_BLOCKED'].includes(result.result.status), result.result.reason ?? result.result.status); return result.result;
    };
    try {
    require(input.state.publicationCapacity?.schema === 'hps-release-capacity/1' && input.state.publicationCapacity.events?.length, 'actual included capacity events required');
    for (const originalEvent of input.state.publicationCapacity.events) {
      const event = structuredClone(originalEvent);
      require(['quota.observed','work.reserved','work.settled'].includes(event.type) && typeof event.at === 'string', 'only original capacity events accepted');
      if (event.type !== 'quota.observed') {
        require([context.candidateId, input.state.candidateDigest, '@candidate'].includes(event.data.candidateId), 'capacity event belongs to another candidate'); event.data.candidateId = context.candidateId;
      }
      send(event);
    }
    for (const envelope of rows.values()) send({id: 'native-evidence-' + digest(envelope), type: 'evidence.recorded', data: {candidateId: context.candidateId, envelope}});
    const {intent} = send({id: 'native-intent-' + input.anchor.viewDigest, type: 'promotion.requested', data: {candidateId: context.candidateId}});
    validateIntent(state, intent, context.policy, now, verifier);
    const bundle = signMachineBundle({state, policy: context.policy, intent, contract: context.contract, attestorId, privateKey, now,
      publisherAnchor: {...input.anchor, readinessDigest: input.plan.readinessDigest}, attachments});
    verifyMachineBundle({bundle, config: context.config, contract: context.contract, packageDirectory: packages, evidenceDirectory: out,
      serviceVersion: context.contract.service.version, now});
    fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify(bundle), {flag: 'wx', mode: 0o600});
    return {state, result: {status: 'ASSEMBLED', candidateId: context.candidateId, bundleDigest: digest(bundle), files: attachments.length,
      authority: context.config.mode === 'active' ? 'publisher-live-revalidation-required' : 'shadow', publication: 'NOT_RUN'}};
    } catch (error) { return {state, result: {status: 'BLOCKED', reason: error.message}}; }
  });
  require(outcome.status !== 'BLOCKED', outcome.reason);
  return outcome;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const {values} = parseArgs({args, options: Object.fromEntries(['input','context','packages','store','out','harness','snapshot','run-directory','evidence-root','target','reporter','key','packets','attestor'].map(n => [n, {type: 'string'}]))});
    const input = json(values.input), product = json(values.context);
    let result;
    if (command === 'context') {
      result = prepareContext({input, product, packages: values.packages, store: values.store});
      fs.writeFileSync(values.out, JSON.stringify(result), {flag: 'wx', mode: 0o600});
    } else if (command === 'attest') result = attest({input, context: product, harness: values.harness, snapshotFile: values.snapshot,
      runDirectory: values['run-directory'], evidenceRoot: values['evidence-root'], target: values.target, reporterId: values.reporter,
      privateKey: fs.readFileSync(values.key, 'utf8'), out: values.out});
    else if (command === 'assemble') result = assemble({input, context: product, packets: json(values.packets), packages: values.packages,
      store: values.store, attestorId: values.attestor, privateKey: fs.readFileSync(values.key, 'utf8'), out: values.out});
    else throw Error('usage: native-producer.mjs context|attest|assemble with explicit private input/context/root/key paths');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(JSON.stringify({status: 'BLOCKED', reason: error.message})); process.exitCode = 2; }
}
