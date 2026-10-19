#!/usr/bin/env node
// Publish gate: may this tag's draft release become public?
//
//   node scripts/release/publish-gate.mjs --tag v2026.1013.0 [--repo owner/name]
//
// Exit 0 allows publication, exit 1 keeps the release a draft. A stable tag passes when
//   (approval) a `release` PR from `release/<tag>` has an Approve from a repository writer, as that
//              reviewer's latest review and given on the PR's current head (a later rc moves the branch,
//              so an approval of an earlier candidate does not count), and an `<tag>-rc.N` tag points at
//              the same commit as the tag; or
//   (hotfix)   every first-parent commit since the last published stable release is the merge
//              commit of a `hotfix`-labelled PR whose base is a `hotfix/*` branch.
// A prerelease tag (-rc.N) is not gated: the in-app updater ignores prereleases.
// Pushing a tag cannot be prevented on this plan (GitHub Free, private), so the check sits here.
// Any lookup error refuses: a draft is the safe state.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const APP_STABLE = /^v\d+\.\d+\.\d+$/;

export function latestReviewStates(reviews, head) {
  const latest = new Map();
  for (const r of reviews) {
    if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user, r.state === 'APPROVED' && head && r.commit !== head ? 'STALE' : r.state);
  }
  return latest;
}

// Pure decision. Every input is already fetched.
//   releasePrs: [{number, labels, head, reviews: [{user, state, commit}]}] in review order
//   writers:    Set of logins with write access (only reviewers need to be in it)
//   rangePrs:   [{sha, prs: [{number, labels, base, mergeCommit}]}]; rangeTooLong: commit count when not read
export function decide({tag, tagSha, rcTags = [], releasePrs = [], writers = new Set(), previous, rangePrs = [], rangeTooLong}) {
  if (tag.includes('-')) return {allow: true, route: 'prerelease', reasons: ['prerelease tag; the in-app updater ignores it']};
  const reasons = [];

  const rcAtTag = rcTags.filter(t => t.sha === tagSha).map(t => t.name);
  for (const pr of releasePrs) {
    if (!pr.labels.includes('release')) { reasons.push(`#${pr.number}: no release label`); continue; }
    const states = latestReviewStates(pr.reviews, pr.head);
    const approvers = [...states].filter(([, s]) => s === 'APPROVED').map(([u]) => u);
    const stale = [...states].filter(([, s]) => s === 'STALE').map(([u]) => u);
    const writerApprovers = approvers.filter(u => writers.has(u));
    if (!writerApprovers.length) {
      reasons.push(`#${pr.number}: no current approval from a writer${approvers.length ? ` (approved by ${approvers.join(', ')})` : ''}`
        + (stale.length ? `; ${stale.join(', ')} approved an earlier candidate` : ''));
      continue;
    }
    if (!rcAtTag.length) { reasons.push(`#${pr.number}: approved, but no ${tag}-rc.N tag points at ${tagSha.slice(0, 8)}`); continue; }
    return {allow: true, route: 'approval', reasons: [`#${pr.number} approved by ${writerApprovers.join(', ')}; ${rcAtTag.join(', ')} at the same commit`]};
  }
  if (!releasePrs.length) reasons.push(`approval: no PR from release/${tag}`);

  if (!previous) {
    reasons.push('hotfix: no published stable release to compare against');
  } else if (rangeTooLong) {
    reasons.push(`hotfix: ${rangeTooLong} commits since ${previous}; a hotfix range is short, so this is not one`);
  } else if (!rangePrs.length) {
    reasons.push(`hotfix: no commits since ${previous}`);
  } else {
    const bad = [];
    for (const {sha, prs} of rangePrs) {
      const ok = prs.some(p => p.mergeCommit === sha && p.labels.includes('hotfix') && p.base.startsWith('hotfix/'));
      if (!ok) bad.push(`${sha.slice(0, 8)}${prs.length ? ` (#${prs.map(p => p.number).join(', #')})` : ' (no PR)'}`);
    }
    if (!bad.length) return {allow: true, route: 'hotfix', reasons: [`${rangePrs.length} commit(s) since ${previous}, all hotfix PRs into hotfix/*`]};
    reasons.push(`hotfix: ${bad.length} of ${rangePrs.length} commit(s) since ${previous} are not hotfix PRs into hotfix/*: ${bad.join(', ')}`);
  }
  return {allow: false, route: 'none', reasons};
}

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path], {encoding: 'utf8', maxBuffer: 64 << 20})).flat();
}
const git = (...a) => execFileSync('git', a, {encoding: 'utf8'}).trim();

export function gatherApproval({tag, repo}) {
  const tagSha = git('rev-parse', `${tag}^{commit}`);
  const rcTags = git('tag', '--list', `${tag}-rc.*`).split('\n').filter(Boolean)
    .map(name => ({name, sha: git('rev-parse', `${name}^{commit}`)}));

  const releasePrs = gh(`repos/${repo}/pulls?state=all&head=${repo.split('/')[0]}:release/${tag}&per_page=100`)
    .map(p => ({number: p.number, labels: p.labels.map(l => l.name), head: p.head.sha,
      reviews: gh(`repos/${repo}/pulls/${p.number}/reviews?per_page=100`).map(r => ({user: r.user?.login, state: r.state, commit: r.commit_id}))}));
  const writers = new Set();
  for (const login of new Set(releasePrs.flatMap(p => p.reviews.map(r => r.user)).filter(Boolean))) {
    const perm = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/collaborators/${login}/permission`], {encoding: 'utf8'})).permission;
    if (perm === 'admin' || perm === 'write') writers.add(login);
  }
  return {tag, tagSha, rcTags, releasePrs, writers};
}

// Only read when the approval route fails. A hotfix range is a few commits; a longer one is not a
// hotfix, so it is refused without one lookup per commit.
const HOTFIX_MAX = 30;
export function gatherHotfix({tag, tagSha, repo}) {
  // App releases only: the repository also publishes package releases such as measurement-v0.3.1.
  const published = gh(`repos/${repo}/releases?per_page=100`)
    .filter(r => !r.draft && !r.prerelease && r.tag_name !== tag && APP_STABLE.test(r.tag_name))
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  const previous = published[0]?.tag_name;
  if (!previous) return {previous};
  const shas = git('rev-list', '--first-parent', `${previous}..${tagSha}`).split('\n').filter(Boolean);
  if (shas.length > HOTFIX_MAX) return {previous, rangeTooLong: shas.length};
  const rangePrs = shas.map(sha => ({
    sha,
    prs: gh(`repos/${repo}/commits/${sha}/pulls?per_page=100`).filter(p => p.merged_at)
      .map(p => ({number: p.number, labels: p.labels.map(l => l.name), base: p.base.ref, mergeCommit: p.merge_commit_sha})),
  }));
  return {previous, rangePrs};
}

if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : fallback; };
  const tag = arg('--tag', process.env.TAG);
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio');
  if (!tag) { console.error('usage: publish-gate.mjs --tag <tag>'); process.exit(2); }
  let verdict;
  try {
    if (process.env.HPS_RELEASE_ENGINE_ENABLED === 'true') throw Error('engine-controlled publication requires the Service publisher; legacy CLI cannot authorize it');
    if (process.env.HPS_RELEASE_ENGINE_ENABLED && !['true','false'].includes(process.env.HPS_RELEASE_ENGINE_ENABLED)) throw Error('invalid engine mode');
    if (tag.includes('-')) {
      verdict = decide({tag});
    } else {
      const approval = gatherApproval({tag, repo});
      verdict = decide(approval);
      if (!verdict.allow) verdict = decide({...approval, ...gatherHotfix({tag, tagSha: approval.tagSha, repo})});
    }
  } catch (error) {
    verdict = {allow: false, route: 'error', reasons: [`lookup failed: ${error.message.split('\n')[0]}`]};
  }
  const text = [`## Publish gate — ${tag}`, '', `**${verdict.allow ? 'ALLOW' : 'REFUSE — release stays a draft'}** (${verdict.route})`, '',
    ...verdict.reasons.map(r => `- ${r}`), ''].join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exit(verdict.allow ? 0 : 1);
}

import {digest} from './engine/core.mjs';
const require=(ok,message)=>{if(!ok)throw Error('Release publication gate: '+message);};
export const publicationPaths=Object.freeze(['build-mac:release-create-upload','build-windows:release-create-upload','verify-unified:publish','verify-unified:mirror-dispatch','mirror:release-create-edit-upload','mirror:install-bundle-upload','release-cut:tag-create','manual:tag-push','hotfix:tag-push']);
// Call at each write site after the existing legacy PR/tag/hotfix guard.
// Missing engine configuration cannot silently select legacy when enabled.
export async function assertPublicationGate({enabled,managed,path,identity,client,legacyGuard}) {
 require(publicationPaths.includes(path),'unregistered publication path');
 require(typeof legacyGuard==='function','legacy guard required');await legacyGuard();
 require(typeof enabled==='boolean'&&typeof managed==='boolean','explicit engine mode required');
 if(!enabled&&!managed)return {status:'LEGACY_GUARD_PASSED'};
 require(enabled&&managed,'engine controls all writes when enabled; unmanaged write blocked');
 require(client?.authorize,'engine authority unavailable');
 require(identity?.repository==='hypeproof/hypeproof-studio'&&identity.repositoryId===1239447574&&/^[a-f0-9]{40}$/.test(identity.sourceSha)&&/^[a-f0-9]{64}$/.test(identity.intentDigest)&&Number.isSafeInteger(identity.releaseId)&&identity.releaseId>0&&['stable','canary'].includes(identity.channel),'exact engine publication identity required');
 const frozen=structuredClone(identity),response=await client.authorize({path,identity:frozen});
 require(response?.status==='AUTHORIZED'&&response.identityDigest===digest(frozen)&&response.path===path&&Number.isSafeInteger(response.fence)&&response.fence>0,'current engine authorization required');
 return response;
}
