// The existing engine decides; this adapter binds a portable private snapshot to live publisher inputs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, createPublicKey, createPrivateKey, sign, verify} from 'node:crypto';
import {canonical, digest, validatePolicy, validateIntent} from './engine/core.mjs';
import {parseYaml} from './casebook.mjs';
import {parsePlatforms} from './platforms.mjs';

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const require = (value, reason) => { if (!value) throw Error(reason); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SERVICE_VERSION = /^(service-v\d{4}\.\d{2}\.\d{2}-\d+)\+([a-f0-9]{7,40})$/;
export const CONFIG = 'config/release-automation.json';
export const EVIDENCE_REPOSITORY = 'hypeproof/hypeproof-studio-releases';

export function validateServiceProof(proof, version) {
  require(proof?.schema === 'hps-service-deployment-proof/1' && proof.repository === 'hypeproof/hypeproof-service' &&
    proof.base === 'https://api.hypeproof-ai.xyz/v1' && proof.version === version && SHA.test(proof.commit), 'accepted Service source proof required');
  const tagged = SERVICE_VERSION.exec(version ?? '');
  if (tagged) require(proof.tag === tagged[1] && SHA.test(proof.tagObject) && proof.commit.startsWith(tagged[2]), 'Service tag object/source binding differs');
  else require(/^[a-f0-9]{7,40}$/.test(version ?? '') && proof.tag === null && proof.tagObject === null && proof.commit.startsWith(version), 'unsupported Service deployment identity');
  return proof;
}

// The trusted coordinator performs these fixed private Service reads. The
// product publisher verifies its attestation without expanding its own token.
export function resolveServiceProof(version, get) {
  const tagged = SERVICE_VERSION.exec(version ?? '');
  let commit, tag = null, tagObject = null;
  if (tagged) {
    tag = tagged[1];
    const ref = get(`repos/hypeproof/hypeproof-service/git/ref/tags/${tag}`);
    require(ref.object?.type === 'tag' && SHA.test(ref.object.sha), 'annotated Service deployment tag required');
    tagObject = ref.object.sha;
    const object = get(`repos/hypeproof/hypeproof-service/git/tags/${tagObject}`);
    require(object.sha === tagObject && object.tag === tag && object.object?.type === 'commit', 'Service tag identity changed');
    commit = object.object.sha;
  } else {
    require(/^[a-f0-9]{7,40}$/.test(version ?? ''), 'unsupported Service deployment version');
    commit = get(`repos/hypeproof/hypeproof-service/commits/${version}`).sha;
  }
  return validateServiceProof({schema: 'hps-service-deployment-proof/1', repository: 'hypeproof/hypeproof-service',
    base: 'https://api.hypeproof-ai.xyz/v1', version, tag, tagObject, commit}, version);
}

export function automationConfig(config) {
  require(config?.schema === 'hps-release-automation/1' && config.repository === 'hypeproof/hypeproof-studio', 'unsupported release automation configuration');
  require(['shadow', 'active'].includes(config.mode) && config.evidenceRepository === EVIDENCE_REPOSITORY, 'invalid automation mode/evidence repository');
  require(Number.isSafeInteger(config.maxAgeSeconds) && config.maxAgeSeconds > 0 && config.maxAgeSeconds <= 86400, 'bounded bundle freshness required');
  if (config.mode === 'active') {
    require(SHA.test(config.harnessRevision) && HASH.test(config.harnessTestRevision), 'reviewed Harness commit and complete tool digest required');
    require(config.attestors?.length > 0 && config.engine?.reporters?.length > 0, 'machine attestor/reporter keys are not configured');
    require(new Set(config.attestors.map(a => a.id)).size === config.attestors.length, 'duplicate bundle attestor');
    for (const attestor of config.attestors) {
      require(/^[A-Za-z0-9._:-]+$/.test(attestor.id), 'invalid bundle attestor');
      publicKey(attestor.publicKey);
    }
    for (const reporter of config.engine.reporters) require(Array.isArray(reporter.targets) && reporter.targets.length > 0 &&
      reporter.targets.every(t => ['darwin-arm64','win32-x64'].includes(t)) && new Set(reporter.targets).size === reporter.targets.length, 'reviewed reporter targets required');
  }
  return config;
}

// Read the committed release record, not an editable PR comment, to freeze every checkbox.
export function releaseContract({pr, commit, rcTag, candidate, version, assets, read, acceptance, serviceProof}) {
  require(Number.isSafeInteger(pr.number) && SHA.test(pr.head) && commit.sha === pr.head && commit.parents.length === 1 && commit.parents[0] === candidate, 'release record identity mismatch');
  require(commit.files.length === 1 && commit.files[0] === `releases/${version}.md` && commit.message.split('\n')[0] === `release: record ${rcTag}`, 'release branch contains untested changes');
  const record = read(`${pr.head}:releases/${version}.md`);
  const sections = record.split(/^### Black-box cases\s*$/m);
  require(sections.length === 2, 'one frozen black-box checklist is required');
  const markdown = sections[1].split(/^#{1,3} /m)[0].trim();
  const book = parseYaml(read(`${candidate}:docs/operations/release-casebook/cases.yaml`));
  const cases = markdown.split('\n').filter(line => /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) &&
    (/\[[ xX]\]/.test(line) || /\bBB-\d{3}\b/.test(line))).map(line => {
    const match = /^- \[[ xX]\] \*\*(BB-\d{3})\*\* (P[012]) (.+)$/.exec(line.trim());
    require(match, 'unrecognized checklist row; never drop a checkbox');
    const item = book.cases.find(c => c.id === match[1]);
    require(item && item.priority === match[2] && match[3].startsWith(item.title + ' —') && item.steps?.length && item.expect?.length, 'frozen checklist differs from candidate casebook');
    return {id: item.id, priority: item.priority, title: item.title, original: line,
      steps: item.steps, expect: item.expect, contractDigest: digest(item)};
  });
  require(cases.length > 0 && new Set(cases.map(c => c.id)).size === cases.length, 'empty or duplicate frozen checklist');
  require(book.cases.filter(c => c.priority === 'P0' && c.status !== '자동화됨').every(c => cases.some(row => row.id === c.id)), 'frozen checklist omitted a required P0 case');
  const platforms = parsePlatforms(read(`${candidate}:config/release-platforms.json`));
  const artifacts = platforms.map(target => {
    const matches = assets.filter(a => a.name.endsWith('.zip') && (target === 'darwin-arm64' ? a.name === 'HypeProof-Studio-darwin-arm64.zip' : /^HypeProof\.Studio-win32-x64-.*\.zip$/.test(a.name)));
    require(matches.length === 1 && /^sha256:[a-f0-9]{64}$/.test(matches[0].digest) && Number.isSafeInteger(matches[0].size) && matches[0].size > 0, 'one immutable accepted package per configured platform required');
    return {id: target, target, name: matches[0].name, sha256: matches[0].digest.slice(7), size: matches[0].size};
  });
  const checklist = {schema: 'hype-desktop-checklist/1', repository: 'hypeproof/hypeproof-studio', pr: pr.number,
    prHead: pr.head, candidate, rcTag, markdown, cases, checklistRevision: digest({markdown, cases})};
  const service = JSON.parse(read(`${candidate}:config/service-deployment.json`));
  require(service.repository === 'hypeproof/hypeproof-service' && SHA.test(service.sha), 'full pinned Service revision required');
  require(acceptance?.schema === 'hps-unified-release/1' && Array.isArray(acceptance.receipts) && acceptance.receipts.length === platforms.length &&
    new Set(acceptance.receipts.map(r => r.platform)).size === platforms.length && acceptance.receipts.every(r => platforms.includes(r.platform) &&
      r.status === 'PASS' && r.sourceSha === candidate && r.publicService?.status === 'PASS' && r.publicService.base === 'https://api.hypeproof-ai.xyz/v1' &&
      artifacts.every(a => r.assets?.[a.name] === a.sha256)), 'accepted RC Service/package receipt identity required');
  const acceptedVersions = [...new Set(acceptance.receipts.map(r => r.publicService.version))];
  require(acceptedVersions.length === 1, 'RC platforms accepted different Service deployments');
  validateServiceProof(serviceProof, acceptedVersions[0]);
  return {schema: 'hps-machine-contract/1', repository: checklist.repository, releasePr: pr.number,
    releaseHead: pr.head, candidate, rcTag, version, checklist, platforms, artifacts,
    dependencyServiceSha: service.sha, serviceSha: serviceProof.commit, service: serviceProof};
}

export function policyFor(config, contract) {
  automationConfig(config);
  const engine = config.engine;
  require(engine && SHA.test(config.harnessRevision) && HASH.test(config.harnessTestRevision), 'reviewed machine engine/tool policy is missing');
  const requiredTests = contract.checklist.cases.flatMap(item => {
    const applicable = config.casePlatforms?.[item.id] ?? contract.platforms;
    require(Array.isArray(applicable) && applicable.length > 0 && applicable.every(p => contract.platforms.includes(p)) && new Set(applicable).size === applicable.length, 'invalid reviewed case applicability');
    return applicable.map(target => ({id: item.id + ':' + target, artifactId: target,
      requirementId: item.id, expected: item.expect.join('\n'), environment: 'installed-app',
      reporterIds: engine.reporters.filter(r => r.targets?.includes(target)).map(r => r.id)}));
  });
  require(contract.platforms.every(p => requiredTests.some(t => t.artifactId === p)), 'a configured platform was omitted');
  return validatePolicy({...engine, schema: 'hps-release-policy/1', publicationAuthority: 'machine',
    revision: config.revision, requiredArtifacts: contract.artifacts.map(({id, target}) => ({id, target})), requiredTests,
    desktopContract: {checklistRevision: contract.checklist.checklistRevision, harnessRevision: config.harnessRevision,
      harnessTestRevision: config.harnessTestRevision, releaseHead: contract.releaseHead}});
}

function publicKey(pem) {
  const key = createPublicKey(pem);
  require(key.asymmetricKeyType === 'ed25519', 'only Ed25519 bundle keys are supported');
  return key;
}

export function verifyBundleSignature(bundle, config, now = Date.now()) {
  automationConfig(config);
  require(bundle?.body && typeof bundle.signature === 'string' && Object.keys(bundle).length === 2, 'signed machine bundle required');
  const body = bundle.body, key = config.attestors?.find(k => k.id === body.attestorId);
  require(key && /^[A-Za-z0-9+/]{86}==$/.test(bundle.signature), 'untrusted bundle attestor or signature encoding');
  const bytes = Buffer.from(bundle.signature, 'base64');
  require(bytes.toString('base64') === bundle.signature && verify(null, Buffer.from(canonical(body)), publicKey(key.publicKey), bytes), 'machine bundle signature failed');
  const at = Date.parse(body.createdAt);
  require(body.schema === 'hps-machine-bundle/1' && Number.isFinite(at) && at <= now && now - at <= config.maxAgeSeconds * 1000, 'machine bundle is stale or from the future');
  return body;
}

function regularFile(root, name) {
  const base = path.resolve(root), result = path.resolve(base, name);
  require(result.startsWith(base + path.sep) && !path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'unsafe private evidence path');
  let current = result;
  while (true) {
    require(!fs.lstatSync(current).isSymbolicLink(), 'linked private evidence is refused');
    if (current === base) break;
    current = path.dirname(current);
  }
  require(fs.statSync(result).isFile(), 'regular private evidence required');
  return result;
}

export function bundleFileVerifier(contract, packageDirectory, evidenceDirectory) {
  return record => {
    require(HASH.test(record?.sha256) && Number.isSafeInteger(record.size) && record.size > 0, 'invalid file digest/size');
    const artifact = contract.artifacts.find(a => a.sha256 === record.sha256);
    const file = artifact ? regularFile(packageDirectory, artifact.name) : regularFile(evidenceDirectory, `blobs/${record.sha256}`);
    const stat = fs.statSync(file);
    require(stat.size === record.size && hash(fs.readFileSync(file)) === record.sha256, 'machine evidence digest/size mismatch');
  };
}

export function verifyMachineSource({bundle, config, contract, now = Date.now()}) {
  const body = verifyBundleSignature(bundle, config, now);
  require(digest(body.contract) === digest(contract), 'bundle release/checklist/package contract is stale');
  const policy = policyFor(config, contract);
  validateServiceProof(contract.service, contract.service?.version);
  require(contract.serviceSha === contract.service.commit, 'runtime Service source differs from its deployment proof');
  require(digest(body.policy) === digest(policy), 'bundle policy differs from current trusted policy');
  const item = body.state?.candidates?.[body.intent?.candidateId];
  require(item && item.input.channel === 'stable' && item.input.repository === contract.repository && item.input.candidate === contract.candidate &&
    item.input.rcTag === contract.rcTag && item.input.version === contract.version && item.input.serviceSha === contract.serviceSha &&
    item.input.testRevision === config.harnessRevision && item.input.rubricRevision === contract.candidate, 'bundle pinned inputs differ from current publisher inputs');
  for (const artifact of contract.artifacts) {
    const recorded = item.artifacts[artifact.id];
    require(recorded?.sha256 === artifact.sha256 && recorded.size === artifact.size, 'bundle artifact differs from current RC');
  }
  return {body, policy};
}

export function verifyMachineBundle({bundle, config, contract, packageDirectory, evidenceDirectory, serviceVersion, now = Date.now()}) {
  const {body, policy} = verifyMachineSource({bundle, config, contract, now});
  require(serviceVersion === contract.service.version, 'public Service no longer matches the exact accepted deployment');
  const result = validateIntent(body.state, body.intent, policy, now, bundleFileVerifier(contract, packageDirectory, evidenceDirectory));
  return {...result, allow: config.mode === 'active', route: 'machine', releasePr: contract.releasePr, releaseHead: contract.releaseHead,
    rcTag: contract.rcTag, policyDigest: digest(policy), bundleDigest: digest(bundle),
    notesLine: `Release casebook: complete machine PASS at ${contract.releaseHead}; private signed evidence ${digest(bundle)}.`};
}

// The caller has already built a complete engine ledger from actual signed observations.
// This signs transport provenance, never manufactures a missing case report or an approval.
export function signMachineBundle({state, policy, intent, contract, attestorId, privateKey, now = Date.now()}) {
  const key = createPrivateKey(privateKey);
  require(key.asymmetricKeyType === 'ed25519', 'only Ed25519 bundle keys are supported');
  const body = {schema: 'hps-machine-bundle/1', attestorId, createdAt: new Date(now).toISOString(), contract, state, policy, intent};
  return {body, signature: sign(null, Buffer.from(canonical(body)), key).toString('base64')};
}
