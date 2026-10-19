// One input contract for the existing Mac and Windows builders (#1758).
// A managed candidate embeds its final version, but remains an RC draft.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {appIdentity, sha256} from '../../e2e/unified-release/artifact.mjs';

const shaPattern = /^[a-f0-9]{40}$/;
const stablePattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const tagPattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const fail = reason => { throw new Error(`Build contract: ${reason}`); };
const requireSha = value => { if (typeof value !== 'string' || value.length !== 40 || !shaPattern.test(value)) fail('candidate must be a full lowercase commit SHA'); };
const isReleaseTag = value => typeof value === 'string' && value === value.trim() && tagPattern.test(value);
const marker = 'hps-managed-draft/1';
const repository = fileURLToPath(new URL('../../', import.meta.url));
export const contractSources = ['scripts/release/build-contract.mjs', 'e2e/unified-release/artifact.mjs',
  '.github/workflows/build-mac.yml', '.github/workflows/build-windows.yml',
  'scripts/release/cloud-executor/build-cache.mjs', 'scripts/release/cloud-executor/provider.mjs',
  'scripts/release/engine/core.mjs'];

// An old candidate would execute its old workflows, ignoring every new safety input.
// Require the exact reviewed contract revision before the first remote mutation.
export function assertManagedCandidateSupport(candidate, readCandidate = file =>
  execFileSync('git', ['show', `${candidate}:${file}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})) {
  requireSha(candidate);
  for (const file of contractSources) {
    let source;
    try { source = readCandidate(file); } catch { fail(`candidate lacks managed draft support: ${file}`); }
    if (source !== fs.readFileSync(path.join(repository, file), 'utf8')) fail(`candidate has a different build contract: ${file}`);
  }
}

function requireCandidateTag(tag, version) {
  if (typeof version !== 'string' || version !== version.trim() || !stablePattern.test(version)) fail('release_version must be a final vX.Y.Z version');
  if (!isReleaseTag(tag)) fail('invalid candidate tag');
  const suffix = tag?.startsWith(`${version}-rc.`) ? tag.slice(version.length + 4) : '';
  if (!/^[1-9]\d*$/.test(suffix)) fail('candidate tag must be release_version followed by -rc.N');
}

export function buildDispatches(plan, {managedDraft = false} = {}) {
  requireSha(plan.candidate);
  requireCandidateTag(plan.rcTag, plan.version);
  if (typeof managedDraft !== 'boolean') fail('managedDraft must be a boolean');
  // The original workflows already accept ref. Keep legacy cuts compatible
  // with older candidate workflows that do not declare the new inputs.
  const inputs = {ref: plan.candidate};
  if (managedDraft) Object.assign(inputs, {candidate_sha: plan.candidate, managed_draft: 'true', release_version: plan.version});
  return ['build-mac.yml', 'build-windows.yml'].map(workflow => ({workflow, ref: plan.rcTag, inputs}));
}

export function buildTagMessage(plan, {managedDraft = false} = {}) {
  buildDispatches(plan, {managedDraft});
  return managedDraft ? `${marker}\n${JSON.stringify({schema: marker, sourceSha: plan.candidate,
    publicationTag: plan.rcTag, releaseVersion: plan.version})}` : `${plan.version} candidate (release-cut)`;
}

function managedTag(message, tag) {
  if (!/hps-managed/i.test(message)) return null;
  if (!message.startsWith(`${marker}\n`)) fail('malformed managed draft marker');
  let data;
  try { data = JSON.parse(message.slice(marker.length + 1)); } catch { fail('malformed managed draft marker'); }
  if (data?.schema !== marker || Object.keys(data).sort().join(',') !== 'publicationTag,releaseVersion,schema,sourceSha') fail('malformed managed draft marker');
  requireSha(data.sourceSha);
  requireCandidateTag(data.publicationTag, data.releaseVersion);
  if (data.publicationTag !== tag) fail('managed draft marker names another tag');
  return data;
}

export function resolveBuildContract({eventName, githubRef, githubSha, head, tagCommit, tagObject = '', tagMessage = '', inputs = {}}) {
  const {ref = '', candidate_sha: declared = '', release_version: version = '', managed_draft: mode = ''} = inputs;
  const expected = declared || (shaPattern.test(ref) ? ref : '');
  if (![true, false, 'true', 'false', ''].includes(mode)) fail('managed_draft must be a boolean');
  const requested = mode === true || mode === 'true';
  requireSha(head);
  if (expected) {
    requireSha(expected);
    if (ref !== expected || head !== expected) fail('checkout does not match explicit candidate SHA');
  }
  const publicationTag = githubRef?.startsWith('refs/tags/') ? githubRef.slice(10) : '';
  const annotation = managedTag(tagMessage, publicationTag);
  const managed = Boolean(annotation);
  if (publicationTag) {
    if (!isReleaseTag(publicationTag)) fail('invalid release tag');
    if (head !== tagCommit || head !== githubSha) fail('candidate, workflow ref and publication tag disagree');
  }
  if (requested && !managed) fail('managed draft requires a persistent candidate tag marker');
  if (managed) {
    if (!['workflow_dispatch', 'push'].includes(eventName)) fail('unexpected managed draft event');
    requireSha(tagObject);
    if (head !== annotation.sourceSha || (ref && ref !== annotation.sourceSha) || (version && version !== annotation.releaseVersion)) fail('managed draft inputs disagree with the tag marker');
  } else if (version) fail('release_version is only allowed for managed drafts');
  return {
    schema: 'hps-build-contract/1', sourceSha: head, publicationTag, publicationTagObject: tagObject,
    releaseVersion: managed ? annotation.releaseVersion.slice(1) : publicationTag.slice(1),
    managedDraft: managed, autoAcceptance: Boolean(publicationTag) && !managed,
  };
}

// Exactly the customer packages produced by this platform; no partial Windows draft.
export function packageAssets(dist, platform) {
  const patterns = platform === 'darwin-arm64'
    ? [['mac-zip', /^HypeProof-Studio-darwin-arm64\.zip$/]]
    : platform === 'win32-x64'
      ? [['win-portable', /win32-x64[^/\\\r\n]*\.zip$/], ['win-user', /UserSetup-x64[^/\\\r\n]*\.exe$/], ['win-system', /(?<!User)Setup-x64[^/\\\r\n]*\.exe$/]]
      : fail('unsupported package platform');
  const files = fs.readdirSync(dist).filter(name => /\.(zip|exe)$/.test(name)).sort();
  if (files.length !== patterns.length) fail('missing or unexpected package assets');
  if (files.some(name => /[^\w .+-]/.test(name))) fail('unsafe package name');
  const assets = patterns.map(([id, pattern]) => {
    const matches = files.filter(name => pattern.test(name));
    if (matches.length !== 1) fail(`missing or ambiguous ${id} asset`);
    const name = matches[0], file = path.join(dist, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || !stat.size) fail(`invalid package ${name}`);
    return {id, name, size: stat.size, sha256: sha256(file)};
  });
  // Each uploaded file must represent exactly one role. A crafted installer
  // name can match both suffix patterns while another executable goes unlisted.
  if (new Set(assets.map(asset => asset.name)).size !== files.length) fail('package roles must cover distinct files');
  return assets;
}

export function workflowProvider(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return undefined;
  const provider = {repository: env.GITHUB_REPOSITORY, repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT)};
  if (provider.repository !== 'hypeproof/hypeproof-studio' || !['repositoryId', 'runId', 'runAttempt'].every(key => Number.isSafeInteger(provider[key]) && provider[key] > 0)) fail('trusted workflow repository/run identity required');
  return provider;
}

export function draftIdentity(contract, {dist, platform, app, provider = workflowProvider()}) {
  // This is a build inventory, never a signed black-box acceptance or approval.
  requireSha(contract.sourceSha);
  requireCandidateTag(contract.publicationTag, `v${contract.releaseVersion}`);
  requireSha(contract.publicationTagObject);
  if (contract.schema !== 'hps-build-contract/1' || contract.managedDraft !== true || contract.autoAcceptance !== false) fail('not a managed draft contract');
  const identity = appIdentity(app, platform === 'darwin-arm64' ? 'darwin' : 'win32');
  if (identity.sha !== contract.sourceSha || identity.version !== contract.releaseVersion || identity.extensionVersion !== contract.releaseVersion || identity.name !== 'HypeProof Studio') fail('packaged App identity differs from the build contract');
  return {...contract, schema: 'hps-draft-build/1', platform, app: identity,
    ...(provider ? {provider} : {}), assets: packageAssets(dist, platform), acceptance: 'NOT_RUN', promotion: 'NOT_AUTHORIZED'};
}

export function assertRemoteCandidate(output, contract) {
  const ref = `refs/tags/${contract.publicationTag}`;
  // Pin both the annotation object and its peeled commit; dropping the marker
  // while keeping the same source SHA must not turn this into a legacy release.
  const byRef = new Map(output.trim().split('\n').filter(Boolean).map(line => {
    const [sha, name] = line.split(/\s+/); return [name, sha];
  }));
  if (byRef.get(ref) !== contract.publicationTagObject || byRef.get(`${ref}^{}`) !== contract.sourceSha) fail('remote candidate tag moved or is missing');
}

function main() {
  const [command, contractPath, ...args] = process.argv.slice(2);
  if (!contractPath) fail('usage: build-contract.mjs preflight|record|check-upload CONTRACT [PLATFORM DIST APP]');
  const git = (...values) => execFileSync('git', values, {encoding: 'utf8'}).trim();
  if (command === 'preflight') {
    const githubRef = process.env.GITHUB_REF ?? '';
    // Validate before handing a ref to git or writing any workflow environment file.
    if (githubRef.startsWith('refs/tags/') && !isReleaseTag(githubRef.slice(10))) fail('invalid release tag');
    const tagged = githubRef.startsWith('refs/tags/');
    const contract = resolveBuildContract({eventName: process.env.GITHUB_EVENT_NAME, githubRef,
      githubSha: process.env.GITHUB_SHA, head: git('rev-parse', '--verify', 'HEAD^{commit}'),
      tagCommit: tagged ? git('rev-parse', '--verify', `${githubRef}^{commit}`) : '',
      tagObject: tagged ? git('rev-parse', '--verify', githubRef) : '',
      tagMessage: tagged && git('cat-file', '-t', githubRef) === 'tag' ? git('for-each-ref', '--format=%(contents)', githubRef) : '',
      inputs: {ref: process.env.HPS_BUILD_REF, candidate_sha: process.env.HPS_CANDIDATE_SHA,
        release_version: process.env.HPS_RELEASE_VERSION, managed_draft: process.env.HPS_MANAGED_DRAFT}});
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + '\n');
    fs.appendFileSync(process.env.GITHUB_ENV, `BUILD_SOURCEVERSION=${contract.sourceSha}\nHPS_VERSION=${contract.releaseVersion}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `auto_acceptance=${contract.autoAcceptance}\nmanaged_draft=${contract.managedDraft}\npublication_tag=${contract.publicationTag}\n`);
    console.log(JSON.stringify(contract));
    return;
  }
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const [platform, dist, app] = args;
  const receiptPath = path.join(dist, `draft-build-${platform}.json`);
  const receipt = draftIdentity(contract, {dist, platform, app});
  if (command === 'record') fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  else if (command === 'check-upload') {
    if (JSON.stringify(JSON.parse(fs.readFileSync(receiptPath, 'utf8'))) !== JSON.stringify(receipt)) fail('draft assets or build identity changed after recording');
    const ref = `refs/tags/${contract.publicationTag}`;
    assertRemoteCandidate(git('ls-remote', 'origin', ref, `${ref}^{}`), contract);
  } else fail('unknown command');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
