#!/usr/bin/env node
// Promote an approved release candidate to its v release without a rebuild (#3172).
//
//   node scripts/release/promote.mjs run --pr N [--out DIR]
//       (release-promote.yml, on an approval of the release PR) checks the approval on the PR's
//       current head, finds the rc the PR records, checks that the rc's accepted packages carry
//       the final version, then: v tag on the rc commit, v draft with the rc's packages and
//       acceptance receipts (same bytes), squash-merge of the release PR, verify-unified-release
//       dispatched for the v tag. Every step is idempotent, so a rerun continues a failed run.
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
import {execFileSync, spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {isAppPackage, sha256} from '../../e2e/unified-release/artifact.mjs';
import {decide} from './publish-gate.mjs';
import {pickRelease} from './release-draft.mjs';

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

// Pure decision. Every input is already fetched.
//   pr:      {number, state, merged, labels, base, headRef, head, reviews: [{user, state, commit}]}
//   commit:  the PR head commit {sha, parents: [sha], message, files: [path]}
//   rcTags:  [{name, sha}] for <version>-rc.*; vTagSha: the v tag's commit, or '' when absent
//   rcRelease: {isDraft, assets: [{name, digest}]} of the recorded rc, or null
export function promotionDecision({pr, commit, rcTags = [], writers = new Set(), vTagSha = '', rcRelease = null}) {
  const refuse = reason => ({allow: false, reasons: [reason]});
  const version = branchVersion(pr.headRef);
  if (!version) return refuse(`#${pr.number}: head ${pr.headRef} is not release/vX.Y.Z`);
  if (pr.base !== 'main') return refuse(`#${pr.number}: base is ${pr.base}, not main`);
  if (!pr.labels.includes('release')) return refuse(`#${pr.number}: no release label`);
  if (pr.state !== 'open' && !pr.merged) return refuse(`#${pr.number}: closed without merge`);
  if (commit.sha !== pr.head) return refuse(`#${pr.number}: head commit lookup returned another commit`);
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
  // The same rule the publish gate applies later: a writer's approval on the PR's current head.
  const gate = decide({tag: version, tagSha: candidate, rcTags, writers,
    releasePrs: [{number: pr.number, labels: pr.labels, head: pr.head, reviews: pr.reviews}]});
  if (gate.route !== 'approval') return {allow: false, reasons: gate.reasons.filter(r => !r.startsWith('hotfix:'))};
  if (!rcRelease) return refuse(`${rcTag} has no release: its builds have not uploaded`);
  if (rcRelease.isDraft) return refuse(`${rcTag} is still a draft: its acceptance has not passed yet. Rerun release-promote after it publishes`);
  const assets = rcRelease.assets.filter(a => isAppPackage(a.name) || a.name === ACCEPTANCE);
  if (!assets.some(a => a.name === ACCEPTANCE)) return refuse(`${rcTag} has no ${ACCEPTANCE}`);
  if (!assets.some(a => isAppPackage(a.name))) return refuse(`${rcTag} has no App package`);
  return {allow: true, version, rcTag, candidate, assets: assets.map(a => a.name), reasons: gate.reasons};
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

const git = (...a) => execFileSync('git', a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const gh = (...a) => execFileSync('gh', a, {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'inherit']}).trim();
const ghJson = apiPath => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', apiPath], {encoding: 'utf8', maxBuffer: 64 << 20})).flat();

function rcTagsOf(version) {
  return git('tag', '--list', `${version}-rc.*`).split('\n').filter(Boolean)
    .map(name => ({name, sha: git('rev-parse', `${name}^{commit}`)}));
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
    base: p.base.ref, headRef: p.head.ref, head: p.head.sha,
    reviews: ghJson(`repos/${repo}/pulls/${number}/reviews?per_page=100`).map(r => ({user: r.user?.login, state: r.state, commit: r.commit_id}))};
  const c = JSON.parse(gh('api', `repos/${repo}/commits/${pr.head}`));
  const commit = {sha: c.sha, parents: c.parents.map(x => x.sha), message: c.commit.message, files: (c.files ?? []).map(f => f.filename)};
  const writers = new Set();
  for (const login of new Set(pr.reviews.map(r => r.user).filter(Boolean))) {
    const perm = JSON.parse(gh('api', `repos/${repo}/collaborators/${login}/permission`)).permission;
    if (perm === 'admin' || perm === 'write') writers.add(login);
  }
  const version = branchVersion(pr.headRef);
  const rcTag = version ? recordedRcTag(commit.message, version) : null;
  return {pr, commit, writers, rcTags: version ? rcTagsOf(version) : [], vTagSha: version ? remoteTagSha(version) : '',
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
    pick = pickRelease(list(), tag); // two concurrent runs leave two drafts: stop here
  }
  return {published: false, assets: JSON.parse(gh('api', `repos/${repo}/releases/${pick.id}`)).assets.map(a => ({name: a.name, digest: a.digest ?? null}))};
}

function run({pr: number, out}) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio';
  const summary = [];
  const say = line => { console.log(line); summary.push(line); };
  const finish = code => {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Release promote — #${number}\n\n${summary.map(l => `- ${l}`).join('\n')}\n`);
    process.exit(code);
  };
  const facts = gatherPromotion(number, repo);
  const verdict = promotionDecision(facts);
  if (!verdict.allow) {
    say('Nothing promoted.');
    verdict.reasons.forEach(say);
    finish(1);
  }
  const {version, rcTag, candidate} = verdict;
  say(`${verdict.reasons.join('; ')}. Promoting ${rcTag} (${candidate.slice(0, 8)}) to ${version} without a rebuild.`);

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

  // 2. The v tag on the rc commit, pushed with the workflow token (starts no build).
  if (facts.vTagSha) say(`${version} already on ${candidate.slice(0, 8)}.`);
  else {
    git('tag', '-a', version, candidate, '-m', `${version} promoted from ${rcTag} (release-promote, #${number})`);
    git('push', 'origin', `refs/tags/${version}`);
    say(`Tagged ${version} on ${candidate.slice(0, 8)}.`);
  }

  // 3. The v draft with the same bytes.
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
    gh('workflow', 'run', 'verify-unified-release.yml', '--repo', repo, '-f', `tag=${version}`, '-f', 'override_live_session=false');
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
    tag: {type: 'string'}, sha: {type: 'string'}, version: {type: 'string'}, dir: {type: 'string'}}});
  if (command === 'run' && /^[1-9]\d*$/.test(values.pr ?? '')) run({pr: Number(values.pr), out: values.out ?? process.env.RUNNER_TEMP ?? '.'});
  else if (command === 'reuse-acceptance' && values.tag && /^[a-f0-9]{40}$/.test(values.sha ?? '') && values.version && values.dir) await reuseAcceptance(values);
  else {
    console.error('usage: promote.mjs run --pr N [--out DIR] | reuse-acceptance --tag T --sha S --version V --dir D');
    process.exit(2);
  }
}
