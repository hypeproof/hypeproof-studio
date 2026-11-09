#!/usr/bin/env node
// Promote an approved release candidate to its v release without a rebuild (#3172).
//
//   node scripts/release/promote.mjs run --pr N [--out DIR]
//       (release-promote.yml, on an approval of the release PR) checks the approval on the PR's
//       current head, finds the rc the PR records, checks that the rc's accepted packages carry
//       the final version, then: v tag on the rc commit, v draft with the rc's packages and
//       acceptance receipts (same bytes), squash-merge of the release PR, verify-unified-release
//       dispatched for the v tag. Every step is idempotent, so a rerun continues a failed run.
//       The release PR runs studio-pr-ci like any PR, and main's protection requires its checks,
//       `extension / smoke` included (#3512). A release PR that main would refuse is refused here,
//       before the v tag, instead of failing at the merge after tagging.
//   node scripts/release/promote.mjs reuse-acceptance --tag T --sha S --version V --dir D
//       (verify-unified-release.yml) prints accepted=true when D, the downloaded v draft, holds the
//       acceptance receipts of a published rc at the same commit and they still hold for these bytes
//       and for the current public Service. Anything else prints accepted=false and acceptance runs.
//
// The v tag is pushed with the workflow token, which starts no workflow: build-mac.yml and
// build-windows.yml never run for a promoted tag. The publish gate (publish-gate.mjs) still decides
// publication in verify-unified-release.yml; promotion only prepares the draft.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {isAppPackage, sha256} from '../../e2e/unified-release/artifact.mjs';
import {CASEBOOK, decide, p0CaseIds} from './publish-gate.mjs';
import {parseYaml} from './casebook.mjs';
import {pickRelease} from './release-draft.mjs';
import {automationConfig, CONFIG, releaseContract, verifyBundleSignature, verifyMachineBundle} from './machine-publication.mjs';
import {readLiveAnchor, publicationWorkflowHead} from './publisher-anchor.mjs';
import {digest} from './engine/core.mjs';
import {readCanonicalMergeAuthority, machineReviewHolds, validateMachineChecks, readMachineCheckSnapshot} from './merge-authority.mjs';

const ACCEPTANCE = 'unified-acceptance.json';
const VERSION = /^v\d+\.\d+\.\d+$/;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// release/vX.Y.Z → vX.Y.Z, or null.
export function branchVersion(ref) {
  const version = /^release\/(v\d+\.\d+\.\d+)$/.exec(ref ?? '')?.[1];
  return version ?? null;
}

// The rc a release branch head records (create.mjs commits "release: record <rcTag>"), or null.
export function recordedRcTag(message, version) {
  const tag = /^release: record (v\d+\.\d+\.\d+-rc\.[1-9]\d*)$/.exec((message ?? '').split('\n')[0])?.[1];
  return tag && tag.startsWith(`${version}-rc.`) ? tag : null;
}

// GitHub's mergeStateStatus values under which main's protection accepts the squash-merge.
// BLOCKED: a required check (e.g. `extension / smoke`, about 14 min) is pending, failed or absent.
const MERGEABLE_STATES = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS']);

// Pure decision. Every input is already fetched.
//   pr:      {number, state, merged, labels, base, headRef, head, headDate, reviews: [{user, state, commit}],
//            comments: [{user, association, created_at, body, url}]}
//   p0:      P0 case ids of the candidate's casebook (publish-gate p0CaseIds); undefined refuses
//   mergeState: the release PR's mergeStateStatus ('' when unread); ignored once it is merged
//   commit:  the PR head commit {sha, parents: [sha], message, files: [path]}
//   rcTags:  [{name, sha}] for <version>-rc.*; vTagSha: the v tag's commit, or '' when absent
//   rcRelease: {isDraft, assets: [{name, digest}]} of the recorded rc, or null
export function promotionInputs({pr, commit, rcTags = [], vTagSha = '', rcRelease = null, mergeState = ''}) {
  const refuse = reason => ({allow: false, reasons: [reason]});
  const version = branchVersion(pr.headRef);
  if (!version) return refuse(`#${pr.number}: head ${pr.headRef} is not release/vX.Y.Z`);
  if (pr.base !== 'main') return refuse(`#${pr.number}: base is ${pr.base}, not main`);
  if (!pr.labels.includes('release')) return refuse(`#${pr.number}: no release label`);
  if (pr.state !== 'open' && !pr.merged) return refuse(`#${pr.number}: closed without merge`);
  if (commit.sha !== pr.head) return refuse(`#${pr.number}: head commit lookup returned another commit`);
  if (!pr.merged && !MERGEABLE_STATES.has(mergeState)) {
    return refuse(mergeState === 'BLOCKED'
      ? `#${pr.number}: a required check on the release PR head is not green yet (extension / smoke takes about 14 min). Wait for it, or rerun the failed check, then rerun release-promote`
      : `#${pr.number}: main would not accept the merge (mergeStateStatus ${mergeState || 'unread'}). Rerun release-promote once the PR is mergeable`);
  }
  // The release branch is the candidate plus one commit that adds the release record. Anything
  // else on it would ship code the rc never built.
  if (commit.parents.length !== 1) return refuse(`#${pr.number}: head is not a single commit on the candidate`);
  const record = `releases/${version}.md`;
  if (commit.files.length !== 1 || commit.files[0] !== record) return refuse(`#${pr.number}: head commit changes ${commit.files.join(', ') || 'nothing'}, not only ${record}`);
  const rcTag = recordedRcTag(commit.message, version);
  if (!rcTag) return refuse(`#${pr.number}: head commit does not record a ${version}-rc.N`);
  const candidate = commit.parents[0];
  const rc = rcTags.find(t => t.name === rcTag);
  if (!rc) return refuse(`${rcTag} does not exist`);
  if (rc.sha !== candidate) return refuse(`${rcTag} is on ${rc.sha.slice(0, 8)}, the release branch on ${candidate.slice(0, 8)}`);
  if (vTagSha && vTagSha !== candidate) return refuse(`${version} already exists on ${vTagSha.slice(0, 8)}, not on the rc commit ${candidate.slice(0, 8)}`);
  if (!rcRelease) return refuse(`${rcTag} has no release: its builds have not uploaded`);
  if (rcRelease.isDraft) return refuse(`${rcTag} is still a draft: its acceptance has not passed yet. Rerun release-promote after it publishes`);
  const assets = rcRelease.assets.filter(a => isAppPackage(a.name) || a.name === ACCEPTANCE);
  if (!assets.some(a => a.name === ACCEPTANCE)) return refuse(`${rcTag} has no ${ACCEPTANCE}`);
  if (!assets.some(a => isAppPackage(a.name))) return refuse(`${rcTag} has no App package`);
  return {allow: true, version, rcTag, candidate, assets: assets.map(a => a.name), reasons: []};
}

export function promotionDecision(facts) {
  const inputs = promotionInputs(facts);
  if (!inputs.allow) return inputs;
  const {pr, rcTags, writers, p0, machineAuthority} = facts;
  if (machineAuthority) {
    const holds = machineReviewHolds(pr);
    if (holds.length) return {allow: false, reasons: holds};
    const match = machineAuthority.allow === true && machineAuthority.status === 'READY_FOR_PUBLISHER' &&
      machineAuthority.candidate === inputs.candidate && machineAuthority.tag === inputs.version &&
      machineAuthority.rcTag === inputs.rcTag && machineAuthority.releasePr === pr.number && machineAuthority.releaseHead === pr.head;
    return match ? {...inputs, reasons: ['Complete signed machine PASS; no per-candidate human approval']}
      : {allow: false, reasons: ['Machine authority is missing, stale or belongs to another release']};
  }
  const gate = decide({tag: inputs.version, tagSha: inputs.candidate, rcTags, writers, p0,
    releasePrs: [{number: pr.number, labels: pr.labels, head: pr.head, headDate: pr.headDate, comments: pr.comments ?? [], reviews: pr.reviews}]});
  return gate.route === 'approval' ? {...inputs, reasons: gate.reasons}
    : {allow: false, reasons: gate.reasons.filter(r => !r.startsWith('hotfix:'))};
}

// Which promoted files still need uploading to the v draft. A same-named asset with other bytes,
// or an App package that is not the rc's, means the draft was built some other way: refuse rather
// than mix packages (the acceptance receipts name the exact artifact set).
//   existing: [{name, digest: 'sha256:...'|null}]   wanted: [{name, sha256}]
export function uploadPlan(existing, wanted) {
  const want = new Map(wanted.map(w => [w.name, w.sha256]));
  const problems = [], upload = [];
  for (const asset of existing) {
    if (want.has(asset.name)) {
      if (asset.digest !== `sha256:${want.get(asset.name)}`) problems.push(`${asset.name} differs from the rc's bytes`);
    } else if (isAppPackage(asset.name)) problems.push(`${asset.name} is not an rc package`);
  }
  for (const [name] of want) if (!existing.some(a => a.name === name)) upload.push(name);
  return {upload, problems};
}

// verify-unified-release: may the v draft skip a second acceptance run? Only when its receipts are
// byte for byte the receipts of a published rc at the same commit. The caller then checks the
// receipts against the downloaded packages and the current public Service.
//   rcReleases: [{tag, sha, isDraft, assets: [{name, digest}]}]
export function acceptanceSource({tag, tagSha, acceptanceSha256, rcReleases}) {
  if (!VERSION.test(tag)) return {reuse: false, reason: `${tag} is not a stable tag`};
  if (!acceptanceSha256) return {reuse: false, reason: `the ${tag} draft has no ${ACCEPTANCE}`};
  const match = rcReleases.find(r => r.tag.startsWith(`${tag}-rc.`) && r.sha === tagSha && !r.isDraft
    && r.assets.some(a => a.name === ACCEPTANCE && a.digest === `sha256:${acceptanceSha256}`));
  return match ? {reuse: true, reason: `${ACCEPTANCE} is the accepted receipt of ${match.tag}`}
    : {reuse: false, reason: `${ACCEPTANCE} is not the receipt of a published ${tag}-rc.N at ${tagSha.slice(0, 8)}`};
}

const git = (...a) => execFileSync('git', a, {encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
const gh = (...a) => execFileSync('gh', a, {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'inherit']}).trim();
const ghJson = apiPath => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', apiPath], {encoding: 'utf8', maxBuffer: 64 << 20})).flat();

export function rcTagsOf(version, read = git) {
  if (!VERSION.test(version)) throw Error('exact release version required');
  const refs = new Map();
  for (const line of read('ls-remote', '--tags', 'origin', `refs/tags/${version}-rc.*`).split('\n').filter(Boolean)) {
    const [sha, ref] = line.split(/\s+/);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('remote RC identity is invalid');
    const tail = ref?.slice(`refs/tags/${version}-rc.`.length);
    if (!ref?.startsWith(`refs/tags/${version}-rc.`) || !/^[1-9]\d*(?:\^\{\})?$/.test(tail)) throw Error('remote RC tag is invalid');
    if (refs.has(ref) && refs.get(ref) !== sha) throw Error('conflicting remote RC ref');
    refs.set(ref, sha);
  }
  return [...refs].filter(([ref]) => !ref.endsWith('^{}')).map(([ref, sha]) => ({name: ref.slice(10), sha: refs.get(ref + '^{}') ?? sha}));
}

export function readImmutableSource(repo, revisionPath) {
  if (!/^[a-f0-9]{40}:(?:releases\/v\d+\.\d+\.\d+\.md|docs\/operations\/release-casebook\/cases\.yaml|config\/(?:release-platforms|service-deployment)\.json)$/.test(revisionPath)) throw Error('fixed immutable release source required');
  try { return git('show', revisionPath); } catch {
    // A squash merge can delete the original release branch. The PR's exact
    // immutable commit remains the source; never fall back to main or PR body.
    const [sha, filename] = revisionPath.split(':');
    const value = JSON.parse(gh('api', `repos/${repo}/contents/${filename}?ref=${sha}`));
    if (value.encoding !== 'base64' || typeof value.content !== 'string') throw Error('immutable release source is unavailable');
    return Buffer.from(value.content, 'base64').toString('utf8');
  }
}

export function readAcceptedReceipt(facts, repo, directory) {
  const input = promotionInputs(facts);
  if (!input.allow) throw Error(input.reasons.join('; '));
  let temporary;
  try {
    const folder = directory ?? (temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-rc-receipt-')));
    const file = path.join(folder, ACCEPTANCE);
    if (!directory) gh('release', 'download', input.rcTag, '--repo', repo, '--pattern', ACCEPTANCE, '--dir', folder);
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 2 * 1024 * 1024) throw Error('invalid accepted receipt file');
    const expected = facts.rcRelease.assets.find(a => a.name === ACCEPTANCE)?.digest;
    if (expected !== 'sha256:' + sha256(file)) throw Error('receipt differs from the accepted RC bytes');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } finally {
    if (temporary) {
      if (path.dirname(path.resolve(temporary)) !== fs.realpathSync(os.tmpdir()) ||
          !path.basename(temporary).startsWith('machine-rc-receipt-') || fs.lstatSync(temporary).isSymbolicLink()) throw Error('unsafe receipt cleanup target');
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  }
}

function releaseOf(tag) {
  try { return JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,assets')); } catch { return null; }
}

function remoteTagSha(tag) {
  const lines = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`).split('\n').filter(Boolean);
  const byRef = new Map(lines.map(l => l.split(/\s+/).reverse()));
  return byRef.get(`refs/tags/${tag}^{}`) ?? byRef.get(`refs/tags/${tag}`) ?? '';
}

export function gatherPromotion(number, repo) {
  const p = JSON.parse(gh('api', `repos/${repo}/pulls/${number}`));
  const pr = {number: p.number, state: p.state, merged: Boolean(p.merged_at), labels: p.labels.map(l => l.name),
    base: p.base.ref, headRef: p.head.ref, head: p.head.sha, headRepository: p.head.repo?.full_name, baseRepository: p.base.repo?.full_name,
    reviews: ghJson(`repos/${repo}/pulls/${number}/reviews?per_page=100`).map(r => ({user: r.user?.login, state: r.state, commit: r.commit_id, submittedAt: r.submitted_at}))};
  pr.comments = ghJson(`repos/${repo}/issues/${number}/comments?per_page=100`)
    .map(x => ({user: x.user?.login, association: x.author_association, created_at: x.created_at, body: x.body ?? '', url: x.html_url}));
  const c = JSON.parse(gh('api', `repos/${repo}/commits/${pr.head}`));
  pr.headDate = c.commit.committer.date;
  const commit = {sha: c.sha, parents: c.parents.map(x => x.sha), message: c.commit.message, files: (c.files ?? []).map(f => f.filename)};
  const writers = new Set();
  for (const login of new Set(pr.reviews.map(r => r.user).filter(Boolean))) {
    const perm = JSON.parse(gh('api', `repos/${repo}/collaborators/${login}/permission`)).permission;
    if (perm === 'admin' || perm === 'write') writers.add(login);
  }
  const version = branchVersion(pr.headRef);
  const rcTag = version ? recordedRcTag(commit.message, version) : null;
  // GitHub computes mergeStateStatus lazily: UNKNOWN right after a push or review settles in seconds.
  let mergeState = '';
  for (let i = 0; !pr.merged && i < 5; i++) {
    mergeState = gh('pr', 'view', String(number), '--repo', repo, '--json', 'mergeStateStatus', '--jq', '.mergeStateStatus');
    if (mergeState !== 'UNKNOWN') break;
    execFileSync('sleep', ['3']);
  }
  // The candidate's own casebook, as the publish gate reads it at the v tag (the same commit).
  const candidate = commit.parents.length === 1 ? commit.parents[0] : null;
  // Unreadable leaves p0 undefined, which the gate refuses with "the casebook P0 list was not read".
  let p0;
  try { if (candidate) p0 = p0CaseIds(parseYaml(git('show', `${candidate}:${CASEBOOK}`), CASEBOOK)?.cases ?? []); } catch { p0 = undefined; }
  return {pr, commit, writers, p0, mergeState, rcTags: version ? rcTagsOf(version) : [], vTagSha: version ? remoteTagSha(version) : '',
    rcRelease: rcTag ? releaseOf(rcTag) : null};
}

function draftAssets(repo, tag) {
  const list = () => gh('api', `repos/${repo}/releases`, '--paginate', '--jq', '.[] | {id, tag_name, draft}')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  let pick;
  try { pick = pickRelease(list(), tag); } catch (error) {
    if (/already published/.test(error.message)) return {published: true};
    throw error;
  }
  if (pick.action === 'create') {
    gh('release', 'create', tag, '--draft', '--title', `HypeProof Studio ${tag}`, '--generate-notes', '--verify-tag');
    // The listing can lag the create by a few seconds (v2026.1102.2, 2026-11-02: releases/undefined).
    for (let i = 0; i < 10; i++) {
      pick = pickRelease(list(), tag); // two concurrent runs leave two drafts: stop here
      if (pick.action !== 'create') break;
      execFileSync('sleep', ['3']);
    }
    if (pick.action === 'create') throw new Error(`The ${tag} draft was created but is not listed yet; rerun.`);
  }
  return {published: false, assets: JSON.parse(gh('api', `repos/${repo}/releases/${pick.id}`)).assets.map(a => ({name: a.name, digest: a.digest ?? null}))};
}

export async function currentMachineAuthority({number, repo, packageDirectory, evidenceDirectory, stage = 'parent'}) {
  const config = automationConfig(JSON.parse(fs.readFileSync(path.join(scriptDir, '../..', CONFIG), 'utf8')));
  if (config.mode !== 'active') return null;
  if (repo !== config.repository) throw Error('Fixed Studio machine publication scope required');
  const workflowHead = publicationWorkflowHead({stage, githubSha: process.env.GITHUB_SHA,
    checkoutHead: stage === 'parent' ? execFileSync('git', ['-C', path.join(scriptDir, '../..'), 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() : undefined,
    parentWorkflowHead: process.env.HPS_MACHINE_PARENT_WORKFLOW_HEAD});
  if (!/^[a-f0-9]{64}$/.test(process.env.HPS_MACHINE_DISPATCH_KEY ?? '')) throw Error('Exact reserved machine dispatch key required');
  if (!evidenceDirectory) throw Error('Active machine release requires private signed evidence; manager approval cannot replace it');
  const bundle = JSON.parse(fs.readFileSync(path.join(evidenceDirectory, 'bundle.json'), 'utf8'));
  verifyBundleSignature(bundle, config); // Refuse untrusted provenance before interpreting the ledger.
  const facts = gatherPromotion(number, repo);
  const input = promotionInputs(facts);
  if (!input.allow) throw Error(input.reasons.join('; '));
  const holds = machineReviewHolds(facts.pr);
  if (holds.length) throw Error(holds.join('; '));
  const mergeAuthority = readCanonicalMergeAuthority();
  const checks = readMachineCheckSnapshot({number, repository: repo, head: facts.pr.head});
  validateMachineChecks(checks, facts.pr.head, mergeAuthority.requiredChecks);
  const highestRc = Math.max(...facts.rcTags.map(t => Number(t.name.split('-rc.')[1])));
  if (Number(input.rcTag.split('-rc.')[1]) !== highestRc) throw Error('A replacement RC supersedes this candidate');
  const acceptance = readAcceptedReceipt(facts, repo, packageDirectory);
  const contract = releaseContract({...facts, ...input, assets: facts.rcRelease.assets,
    read: rev => readImmutableSource(repo, rev), acceptance, serviceProof: bundle.body.contract.service});
  // Policy changes during a run require a new reviewed run, never an old cached READY.
  const remote = JSON.parse(gh('api', `repos/${repo}/contents/${CONFIG}?ref=main`));
  if (Buffer.from(remote.content, 'base64').toString('utf8') !== fs.readFileSync(path.join(scriptDir, '../..', CONFIG), 'utf8')) throw Error('Default-branch release policy changed during this run');
  const newer = ghJson(`repos/${repo}/releases?per_page=100`).filter(r => !r.draft && !r.prerelease && VERSION.test(r.tag_name));
  const parts = v => v.slice(1).split('.').map(Number);
  const compare = (a, b) => parts(a).reduce((found, value, i) => found || value - parts(b)[i], 0);
  if (newer.some(r => compare(r.tag_name, input.version) > 0)) throw Error('A newer stable release already exists');
  const response = await fetch('https://api.hypeproof-ai.xyz/v1/health', {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Current public Service is unavailable');
  const serviceVersion = (await response.json()).version;
  readLiveAnchor(bundle.body.publisherAnchor, contract, {bundleDigest: digest(bundle),
    evidenceCommit: process.env.HPS_MACHINE_EVIDENCE_COMMIT, dispatchKey: process.env.HPS_MACHINE_DISPATCH_KEY, workflowHead},
    endpoint => JSON.parse(gh('api', '--method', 'GET', endpoint)));
  const authority = verifyMachineBundle({bundle, config, contract, packageDirectory, evidenceDirectory, serviceVersion});
  return {...authority, mergeAuthority, decision: promotionDecision({...facts, machineAuthority: authority})};
}

async function run({pr: number, out, machineBundle}) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio';
  const summary = [];
  const say = line => { console.log(line); summary.push(line); };
  const finish = code => {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Release promote — #${number}\n\n${summary.map(l => `- ${l}`).join('\n')}\n`);
    process.exit(code);
  };
  const facts = gatherPromotion(number, repo);
  const config = automationConfig(JSON.parse(fs.readFileSync(path.join(scriptDir, '../..', CONFIG), 'utf8')));
  const machine = config.mode === 'active';
  if (machine) {
    if (!machineBundle) throw Error('Active machine release requires a private signed bundle');
    if (!/^[a-f0-9]{40}$/.test(process.env.HPS_MACHINE_EVIDENCE_COMMIT ?? '')) throw Error('Immutable private evidence commit required before promotion');
    const body = verifyBundleSignature(JSON.parse(fs.readFileSync(path.join(machineBundle, 'bundle.json'), 'utf8')), config);
    if (body.contract.releasePr !== number || body.contract.releaseHead !== facts.pr.head) throw Error('Private evidence belongs to another release head');
  }
  // Structural input checks precede the download. Full machine authority is checked against those actual bytes below.
  let verdict = machine ? promotionInputs(facts) : promotionDecision(facts);
  if (!verdict.allow) {
    say('Nothing promoted.');
    verdict.reasons.forEach(say);
    finish(1);
  }
  const {version, rcTag, candidate} = verdict;
  say(`Preparing ${rcTag} (${candidate.slice(0, 8)}) for ${version} without a rebuild; publication gates still apply.`);

  // 1. The rc's accepted bytes, checked against the digests GitHub recorded and against the
  //    acceptance receipts for the FINAL version. An rc cut before #3172 carries its rc version
  //    and fails here: promotion never rebuilds, so such an rc cannot become a v release.
  const dir = path.resolve(out, rcTag);
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  gh('release', 'download', rcTag, '--dir', dir, ...verdict.assets.flatMap(name => ['--pattern', name]));
  const wanted = verdict.assets.map(name => ({name, sha256: sha256(path.join(dir, name))}));
  for (const w of wanted) {
    const recorded = facts.rcRelease.assets.find(a => a.name === w.name)?.digest;
    if (recorded !== `sha256:${w.sha256}`) { say(`${w.name}: downloaded bytes do not match ${rcTag}'s recorded digest.`); finish(1); }
  }
  const check = spawnSync(process.execPath, [path.join(scriptDir, '..', 'check-unified-release.mjs'), dir, candidate, version.slice(1)], {encoding: 'utf8'});
  if (check.status !== 0) {
    say(`${rcTag}'s accepted packages are not the ${version} App: ${(check.stderr || check.stdout).trim()}`);
    say(`An rc cut before #3172 carries its rc version. Cut a new rc (release-cut, mode=create); promotion never rebuilds.`);
    finish(1);
  }
  say(`${rcTag}: ${wanted.length} file(s) carry ${version.slice(1)} and match its acceptance receipts.`);

  const guardMachine = async () => {
    if (!machine) return;
    const authority = await currentMachineAuthority({number, repo, packageDirectory: dir, evidenceDirectory: machineBundle});
    const decision = authority.decision;
    if (!decision.allow || decision.candidate !== candidate || decision.rcTag !== rcTag || authority.releaseHead !== facts.pr.head) throw Error('Machine publication changed: ' + decision.reasons.join('; '));
    verdict = decision;
  };
  await guardMachine();

  // 2. The v tag on the rc commit, pushed with the workflow token (starts no build).
  if (facts.vTagSha) say(`${version} already on ${candidate.slice(0, 8)}.`);
  else {
    git('tag', '-a', version, candidate, '-m', `${version} promoted from ${rcTag} (release-promote, #${number})`);
    git('push', 'origin', `refs/tags/${version}`);
    say(`Tagged ${version} on ${candidate.slice(0, 8)}.`);
  }

  // 3. The v draft with the same bytes.
  await guardMachine();
  const draft = draftAssets(repo, version);
  if (draft.published) say(`${version} is already published; nothing to upload.`);
  else {
    const plan = uploadPlan(draft.assets, wanted);
    if (plan.problems.length) {
      say(`The ${version} draft holds other packages; delete them or the draft, then rerun: ${plan.problems.join('; ')}.`);
      finish(1);
    }
    if (plan.upload.length) gh('release', 'upload', version, ...plan.upload.map(name => path.join(dir, name)));
    say(plan.upload.length ? `Uploaded ${plan.upload.join(', ')} to the ${version} draft.` : `The ${version} draft already holds the rc's files.`);
  }

  // 4. The release PR adds only releases/<version>.md. --match-head-commit refuses a moved branch.
  await guardMachine();
  if (facts.pr.merged) say(`#${number} already merged.`);
  else {
    // The bot App token when set (release-promote.yml), so a protected main accepts the merge.
    execFileSync('gh', ['pr', 'merge', String(number), '--repo', repo, '--squash', '--match-head-commit', facts.pr.head],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
       env: process.env.RELEASE_PR_TOKEN ? {...process.env, GH_TOKEN: process.env.RELEASE_PR_TOKEN} : process.env});
    say(`Merged #${number}.`);
  }

  // 5. The existing verify path: it reuses the rc's receipts, runs the publish gate and publishes.
  if (!draft.published) {
    await guardMachine();
    const machineInputs = machine ? ['-f', `machine_pr=${number}`, '-f', `machine_evidence_commit=${process.env.HPS_MACHINE_EVIDENCE_COMMIT ?? ''}`, '-f', `machine_dispatch_key=${process.env.HPS_MACHINE_DISPATCH_KEY ?? ''}`, '-f', `machine_parent_workflow_head=${process.env.GITHUB_SHA ?? ''}`] : [];
    if (machine && !/^[a-f0-9]{40}$/.test(process.env.HPS_MACHINE_EVIDENCE_COMMIT ?? '')) throw Error('Immutable private evidence commit required for final publication');
    gh('workflow', 'run', 'verify-unified-release.yml', '--repo', repo, '-f', `tag=${version}`, '-f', 'override_live_session=false', ...machineInputs);
    say(`Started verify-unified-release for ${version}.`);
  }
  finish(0);
}

async function reuseAcceptance({tag, sha, version, dir}) {
  const output = text => {
    console.log(text);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${text.split('\n')[0]}\n`);
  };
  const no = reason => { output(`accepted=false\n${reason}; acceptance runs.`); };
  try {
    const file = path.join(dir, ACCEPTANCE);
    const rcReleases = VERSION.test(tag) ? rcTagsOf(tag).filter(t => t.sha === sha)
      .map(t => ({tag: t.name, sha: t.sha, ...(releaseOf(t.name) ?? {isDraft: true, assets: []})})) : [];
    const source = acceptanceSource({tag, tagSha: sha, acceptanceSha256: fs.existsSync(file) ? sha256(file) : '', rcReleases});
    if (!source.reuse) return no(source.reason);
    const check = spawnSync(process.execPath, [path.join(scriptDir, '..', 'check-unified-release.mjs'), dir, sha, version], {encoding: 'utf8'});
    if (check.status !== 0) return no(`the rc receipts do not hold for these bytes: ${(check.stderr || check.stdout).trim()}`);
    const expected = JSON.parse(fs.readFileSync(file, 'utf8')).receipts[0].publicService;
    const response = await fetch(`${expected.base}/health`, {signal: AbortSignal.timeout(15000)});
    const current = response.ok ? (await response.json()).version : `HTTP ${response.status}`;
    if (current !== expected.version) return no(`the public Service is ${current}, the rc was accepted against ${expected.version}`);
    output(`accepted=true\n${source.reason}; packages unchanged; public Service still ${current}.`);
  } catch (error) {
    no(`reuse check failed: ${String(error.message).split('\n')[0]}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [command, ...rest] = process.argv.slice(2);
  const {values} = parseArgs({args: rest, options: {pr: {type: 'string'}, out: {type: 'string'},
    'machine-bundle': {type: 'string'},
    tag: {type: 'string'}, sha: {type: 'string'}, version: {type: 'string'}, dir: {type: 'string'}}});
  if (command === 'run' && /^[1-9]\d*$/.test(values.pr ?? '')) await run({pr: Number(values.pr), out: values.out ?? process.env.RUNNER_TEMP ?? '.', machineBundle: values['machine-bundle']});
  else if (command === 'reuse-acceptance' && values.tag && /^[a-f0-9]{40}$/.test(values.sha ?? '') && values.version && values.dir) await reuseAcceptance(values);
  else {
    console.error('usage: promote.mjs run --pr N [--out DIR] | reuse-acceptance --tag T --sha S --version V --dir D');
    process.exit(2);
  }
}
