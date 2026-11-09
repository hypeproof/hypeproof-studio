#!/usr/bin/env node
// Fixed private-repository transport; it cannot publish, create keys or turn routing READY into evidence.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {CONFIG, EVIDENCE_REPOSITORY, automationConfig, releaseContract, policyFor, verifyBundleSignature,
  verifyMachineBundle, signMachineBundle} from './machine-publication.mjs';
import {verifyMachineSource, resolveServiceProof} from './machine-publication.mjs';
import {digest} from './engine/core.mjs';
import {readState} from './engine/store.mjs';
import {gatherPromotion, promotionInputs, readAcceptedReceipt, readImmutableSource} from './promote.mjs';

const HASH = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const require = (ok, reason) => { if (!ok) throw Error(reason); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 25 * 1024 * 1024, MAX_TOTAL = 100 * 1024 * 1024;
const config = () => automationConfig(JSON.parse(fs.readFileSync(new URL('../../' + CONFIG, import.meta.url), 'utf8')));

function records(body) {
  const item = body.state?.candidates?.[body.intent?.candidateId];
  require(item && body.policy.requiredTests.length > 0, 'complete engine candidate required');
  const files = new Map();
  for (const check of body.policy.requiredTests) {
    const file = item.evidence?.[check.id]?.body?.file;
    require(HASH.test(file?.sha256) && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= MAX_FILE, 'missing or oversized evidence record');
    require(!files.has(file.sha256) || files.get(file.sha256).size === file.size, 'conflicting evidence size');
    files.set(file.sha256, file);
  }
  require([...files.values()].reduce((sum, f) => sum + f.size, 0) <= MAX_TOTAL, 'private evidence exceeds the bounded transfer cap');
  return [...files.values()];
}

export function fetchEvidence({pr, commit, out, cfg = config(), get}) {
  automationConfig(cfg);
  if (cfg.mode !== 'active') return {status: 'NOT_APPLICABLE', reason: 'Product is not actively enrolled; no output or network access.'};
  require(Number.isSafeInteger(pr) && pr > 0 && SHA.test(commit), 'exact release PR and immutable private commit required');
  require(typeof out === 'string' && out.length > 0, 'new private output directory required');
  require(!fs.existsSync(out), 'preserve existing evidence output; use a new directory');
  const prefix = `blackbox/machine/${pr}/`;
  const read = get ?? ((name, limit) => {
    require(process.env.HPS_EVIDENCE_READ_TOKEN, 'repository-scoped private evidence read capability is missing');
    return execFileSync('gh', ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github.raw+json',
      `repos/${EVIDENCE_REPOSITORY}/contents/${prefix}${name}?ref=${commit}`], {
      env: {...process.env, GH_TOKEN: process.env.HPS_EVIDENCE_READ_TOKEN}, maxBuffer: limit, timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe']});
  });
  const bytes = read('bundle.json', 5 * 1024 * 1024);
  require(bytes.length <= 5 * 1024 * 1024, 'private bundle is too large');
  const bundle = JSON.parse(bytes.toString('utf8'));
  const body = verifyBundleSignature(bundle, cfg);
  require(body.contract?.releasePr === pr && body.contract.repository === cfg.repository, 'private bundle belongs to another release');
  const files = records(body);
  fs.mkdirSync(path.join(out, 'blobs'), {recursive: true, mode: 0o700});
  fs.writeFileSync(path.join(out, 'bundle.json'), bytes, {mode: 0o600, flag: 'wx'});
  for (const file of files) {
    const blob = read(`blobs/${file.sha256}`, MAX_FILE);
    require(blob.length === file.size && hash(blob) === file.sha256, 'private capture bytes do not match signed records');
    fs.writeFileSync(path.join(out, 'blobs', file.sha256), blob, {mode: 0o600, flag: 'wx'});
  }
  return {status: 'FETCHED', repository: EVIDENCE_REPOSITORY, commit, bundleDigest: digest(bundle), files: files.length};
}

function exportEvidence(values) {
  const cfg = config(), repo = cfg.repository;
  const facts = gatherPromotion(Number(values.pr), repo), inputs = promotionInputs(facts);
  require(inputs.allow, inputs.reasons.join('; '));
  const acceptance = readAcceptedReceipt(facts, repo, values.packages);
  const version = acceptance.receipts?.[0]?.publicService?.version;
  const serviceProof = resolveServiceProof(version, endpoint => {
    // Only fixed Service GETs use a separate read capability/member login.
    // Product/evidence writes retain their App identity and are never performed here.
    const env = {...process.env};
    for (const name of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) delete env[name];
    if (process.env.HPS_SERVICE_READ_TOKEN) env.GH_TOKEN = process.env.HPS_SERVICE_READ_TOKEN;
    return JSON.parse(execFileSync('gh', ['api', '--method', 'GET', endpoint], {env, encoding: 'utf8', timeout: 30000}));
  });
  const contract = releaseContract({...facts, ...inputs, assets: facts.rcRelease.assets, acceptance, serviceProof,
    read: rev => readImmutableSource(repo, rev)});
  const policy = JSON.parse(fs.readFileSync(values.policy, 'utf8'));
  require(digest(policy) === digest(policyFor(cfg, contract)), 'ledger policy differs from reviewed frozen-checklist policy');
  const state = readState(values.store), saved = JSON.parse(fs.readFileSync(values.intent, 'utf8'));
  const intent = saved.intent ?? saved;
  const bundle = signMachineBundle({state, policy, intent, contract, attestorId: values.attestor,
    privateKey: fs.readFileSync(values.key, 'utf8')});
  verifyBundleSignature(bundle, cfg);
  require(!fs.existsSync(values.out), 'preserve existing private export');
  fs.mkdirSync(path.join(values.out, 'blobs'), {recursive: true, mode: 0o700});
  const root = fs.realpathSync(values['source-evidence']);
  for (const file of records(bundle.body)) {
    const resolved = fs.realpathSync(file.path), relative = path.relative(root, resolved);
    require(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'original evidence is outside the explicitly owned evidence root');
    let cursor = path.resolve(file.path);
    while (cursor !== root) {
      require(!fs.lstatSync(cursor).isSymbolicLink(), 'linked source evidence refused');
      const parent = path.dirname(cursor);
      require(parent !== cursor, 'evidence root mismatch');
      cursor = parent;
    }
    const bytes = fs.readFileSync(resolved);
    require(bytes.length === file.size && hash(bytes) === file.sha256, 'original evidence changed');
    fs.writeFileSync(path.join(values.out, 'blobs', file.sha256), bytes, {mode: 0o600, flag: 'wx'});
  }
  // Explicit full Service version comes from the existing accepted snapshot, never from a truncated hash.
  const serviceVersion = values['service-version'];
  const result = verifyMachineBundle({bundle, config: cfg, contract, packageDirectory: values.packages,
    evidenceDirectory: values.out, serviceVersion});
  fs.writeFileSync(path.join(values.out, 'bundle.json'), JSON.stringify(bundle), {mode: 0o600, flag: 'wx'});
  return {status: 'EXPORTED', authority: result.allow ? 'machine-publisher-revalidation-required' : 'shadow',
    files: records(bundle.body).length, bundleDigest: digest(bundle), publication: 'NOT_RUN'};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const {values} = parseArgs({args, options: Object.fromEntries(['pr', 'commit', 'out', 'store', 'policy', 'intent', 'attestor',
      'key', 'packages', 'source-evidence', 'service-version', 'bundle', 'tag'].map(name => [name, {type: 'string'}]))});
    let result;
    if (command === 'fetch') result = fetchEvidence({pr: Number(values.pr), commit: values.commit, out: values.out});
    else if (command === 'request') {
      const cfg = config();
      require(cfg.mode === 'active' && values.bundle && values.tag && values.pr, 'active release source inputs required');
      const facts = gatherPromotion(Number(values.pr), cfg.repository), inputs = promotionInputs(facts);
      require(inputs.allow && inputs.version === values.tag, 'request does not identify this release');
      const contract = releaseContract({...facts, ...inputs, assets: facts.rcRelease.assets,
        acceptance: readAcceptedReceipt(facts, cfg.repository),
        serviceProof: verifyBundleSignature(JSON.parse(fs.readFileSync(path.join(values.bundle, 'bundle.json'), 'utf8')), cfg).contract.service,
        read: rev => readImmutableSource(cfg.repository, rev)});
      verifyMachineSource({bundle: JSON.parse(fs.readFileSync(path.join(values.bundle, 'bundle.json'), 'utf8')), config: cfg, contract});
      const response = await fetch('https://api.hypeproof-ai.xyz/v1/health', {signal: AbortSignal.timeout(15000)});
      const current = response.ok ? (await response.json()).version : '';
      require(current === contract.service.version, 'public Service changed before acceptance wait');
      result = {status: 'AUTHENTICATED_SOURCE', publication: 'NOT_RUN', reason: 'Actual package bytes, live Service and complete engine gates still require publisher validation.'};
    }
    else if (command === 'export') {
      require(['pr','out','store','policy','intent','attestor','key','packages','source-evidence','service-version'].every(k => values[k]), 'complete explicit engine/export inputs required');
      result = exportEvidence(values);
    } else throw Error('usage: machine-evidence.mjs fetch|export (see docs/dev/release-machine.md)');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(JSON.stringify({status: 'BLOCKED', reason: error.message})); process.exitCode = 2; }
}
