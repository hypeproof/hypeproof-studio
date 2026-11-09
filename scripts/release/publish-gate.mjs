#!/usr/bin/env node
// Publish gate: may this tag's draft release become public?
//
//   node scripts/release/publish-gate.mjs --tag v2026.1013.0 [--repo owner/name]
//
// Exit 0 allows publication, exit 1 keeps the release a draft. A stable tag passes when
//   (approval) a `release` PR from `release/<tag>` has an Approve from a repository writer, as that
//              reviewer's latest review and given on the PR's current head (a later rc moves the branch,
//              so an approval of an earlier candidate does not count), an `<tag>-rc.N` tag points at
//              the same commit as the tag, and the release casebook was run (#3429): an
//              `hps-blackbox-run/1` result comment at the PR head gives PASS for every P0 case of the
//              tag's casebook, or Jay or an approving writer posted a comment starting
//              "Release manager override" with a reason after the head commit; or
//   (hotfix)   every first-parent commit since the last published stable release is the merge
//              commit of a `hotfix`-labelled PR whose base is a `hotfix/*` branch.
// A prerelease tag (-rc.N) is not gated: the in-app updater ignores prereleases. It still gets a
// notes line, because the publish job requires one for every release it publishes; the casebook
// (P0 run or override) is checked when the stable tag is published.
// Pushing a tag cannot be prevented on this plan (GitHub Free, private), so the check sits here.
// Any lookup error refuses: a draft is the safe state.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {parseYaml} from './casebook.mjs';
import {SCHEMA, extractRun, validateRun} from './validate-blackbox-run.mjs';
import {automationConfig, CONFIG} from './machine-publication.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const APP_STABLE = /^v\d+\.\d+\.\d+$/;

export function latestReviewStates(reviews, head) {
  const latest = new Map();
  for (const r of reviews) {
    if (!r.user || r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user, r.state === 'APPROVED' && head && r.commit !== head ? 'STALE' : r.state);
  }
  return latest;
}

export const CASEBOOK = 'docs/operations/release-casebook/cases.yaml';
export const OVERRIDE_OWNER = 'jayleekr';
// Who may post a run result: members and collaborators, or the org's own bots. Studio is public,
// so anyone can comment; a stranger's PASS is not evidence.
const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const TRUSTED_BOTS = ['hypeproof-agent[bot]', 'hypeproof-org-lab-bot[bot]'];
const OVERRIDE = /^\s*Release manager override\b[\s:.,;—–-]*([\s\S]*)$/i;
const MIN_REASON = 10;

// P0 cases a stable release must have run: every P0 of the tag's own casebook that CI does not
// already run (select-cases.mjs selects each of them with reason p0).
export function p0CaseIds(cases = []) {
  return cases.filter(c => c.priority === 'P0' && c.status !== '자동화됨').map(c => c.id);
}

// Pure. Has the release PR's casebook been run on its current head, or overridden?
//   comments: [{user, association, created_at, body, url}]; approvers: writers approving the head
export function casebookEvidence({number, head, headDate, p0 = [], comments = [], approvers = []}) {
  const notes = [];
  const latest = new Map();
  const rcs = new Set();
  const ordered = [...comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const c of ordered) {
    if (!String(c.body ?? '').includes(SCHEMA)) continue;
    if (!TRUSTED_ASSOCIATIONS.includes(c.association) && !TRUSTED_BOTS.includes(c.user)) { notes.push(`run by ${c.user} ignored: not a member or org bot`); continue; }
    let run;
    try { run = extractRun(c.body); } catch (error) { notes.push(`run by ${c.user}: ${error.message}`); continue; }
    const problems = validateRun(run);
    if (problems.length) { notes.push(`run by ${c.user} is invalid: ${problems[0]}`); continue; }
    if (run.pr !== number) { notes.push(`run by ${c.user} is for #${run.pr}`); continue; }
    if (run.head_sha !== head) { notes.push(`run by ${c.user} tested ${run.head_sha.slice(0, 8)}, not the head ${String(head).slice(0, 8)}`); continue; }
    rcs.add(run.rc_tag);
    for (const row of run.cases) latest.set(row.id, row.result);
  }
  const missing = p0.filter(id => latest.get(id) !== 'PASS');
  if (!missing.length && (rcs.size || !p0.length)) {
    return {ok: true, path: 'blackbox-run', reasons: [`casebook: ${p0.length} P0 case(s) PASS at ${String(head).slice(0, 8)}`],
      line: p0.length
        ? `Release casebook: ${SCHEMA} result on #${number} (${[...rcs].join(', ')}) passed all ${p0.length} P0 cases.`
        : `Release casebook: the casebook has no P0 case to run.`};
  }
  const allowed = new Set([OVERRIDE_OWNER, ...approvers]);
  for (const c of ordered.reverse()) {
    const m = String(c.body ?? '').match(OVERRIDE);
    if (!m || !allowed.has(c.user)) continue;
    const reason = m[1].trim();
    if (reason.replace(/\s/g, '').length < MIN_REASON) { notes.push(`override by ${c.user} has no reason`); continue; }
    if (headDate && String(c.created_at) < String(headDate)) { notes.push(`override by ${c.user} predates the head commit`); continue; }
    const first = reason.split('\n')[0].trim();
    return {ok: true, path: 'override', reasons: [`casebook: release manager override by ${c.user}`],
      line: `Release casebook: not run; release manager override by ${c.user} on #${number}: ${first.length > 200 ? `${first.slice(0, 197)}...` : first}`};
  }
  const shown = missing.slice(0, 8).join(', ') + (missing.length > 8 ? ` (+${missing.length - 8})` : '');
  return {ok: false, reasons: [`#${number}: casebook not run at the head: no ${SCHEMA} PASS for P0 ${shown}, and no "Release manager override" comment with a reason from ${[...allowed].join(' or ')}`
    + (notes.length ? ` [${notes.slice(-3).join('; ')}]` : '')]};
}

// Pure decision. Every input is already fetched.
//   releasePrs: [{number, labels, head, headDate, comments, reviews: [{user, state, commit}]}] in review order
//   p0:         P0 case ids of the tag's casebook (p0CaseIds); undefined refuses the approval route
//   writers:    Set of logins with write access (only reviewers need to be in it)
//   rangePrs:   [{sha, prs: [{number, labels, base, mergeCommit}]}]; rangeTooLong: commit count when not read
export function decide({tag, tagSha, rcTags = [], releasePrs = [], writers = new Set(), p0, previous, rangePrs = [], rangeTooLong}) {
  if (tag.includes('-')) return {allow: true, route: 'prerelease', casebook: 'prerelease',
    notesLine: 'Release casebook: rc prerelease; the casebook gate (P0 run or release manager override) applies when the stable tag is published.',
    reasons: ['prerelease tag; the in-app updater ignores it']};
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
    if (!Array.isArray(p0)) { reasons.push(`#${pr.number}: approved, but the casebook P0 list was not read`); continue; }
    const evidence = casebookEvidence({number: pr.number, head: pr.head, headDate: pr.headDate, p0, comments: pr.comments ?? [], approvers: writerApprovers});
    if (!evidence.ok) { reasons.push(...evidence.reasons); continue; }
    return {allow: true, route: 'approval', casebook: evidence.path, notesLine: evidence.line,
      reasons: [`#${pr.number} approved by ${writerApprovers.join(', ')}; ${rcAtTag.join(', ')} at the same commit`, ...evidence.reasons]};
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
    if (!bad.length) return {allow: true, route: 'hotfix', casebook: 'hotfix', notesLine: `Release casebook: hotfix route (${rangePrs.length} hotfix PR commit(s) since ${previous}); no release PR to run it on.`, reasons: [`${rangePrs.length} commit(s) since ${previous}, all hotfix PRs into hotfix/*`]};
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
      headDate: JSON.parse(execFileSync('gh', ['api', `repos/${repo}/commits/${p.head.sha}`], {encoding: 'utf8', maxBuffer: 64 << 20})).commit.committer.date,
      comments: gh(`repos/${repo}/issues/${p.number}/comments?per_page=100`)
        .map(c => ({user: c.user?.login, association: c.author_association, created_at: c.created_at, body: c.body ?? '', url: c.html_url})),
      reviews: gh(`repos/${repo}/pulls/${p.number}/reviews?per_page=100`).map(r => ({user: r.user?.login, state: r.state, commit: r.commit_id}))}));
  const writers = new Set();
  for (const login of new Set(releasePrs.flatMap(p => p.reviews.map(r => r.user)).filter(Boolean))) {
    const perm = JSON.parse(execFileSync('gh', ['api', `repos/${repo}/collaborators/${login}/permission`], {encoding: 'utf8'})).permission;
    if (perm === 'admin' || perm === 'write') writers.add(login);
  }
  // The tag's own casebook: a P0 added on main after the cut is the next release's.
  const p0 = p0CaseIds(parseYaml(git('show', `${tagSha}:${CASEBOOK}`), CASEBOOK)?.cases ?? []);
  return {tag, tagSha, rcTags, releasePrs, writers, p0};
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

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : fallback; };
  const tag = arg('--tag', process.env.TAG);
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio');
  if (!tag) { console.error('usage: publish-gate.mjs --tag <tag>'); process.exit(2); }
  let verdict;
  try {
    if (tag.includes('-')) {
      verdict = decide({tag});
    } else {
      const approval = gatherApproval({tag, repo});
      const config = automationConfig(JSON.parse(fs.readFileSync(new URL('../../' + CONFIG, import.meta.url), 'utf8')));
      if (config.mode === 'active' && (approval.releasePrs.length || arg('--machine-pr'))) {
        const number = Number(arg('--machine-pr'));
        if (!Number.isSafeInteger(number) || !approval.releasePrs.some(p => p.number === number)) throw Error('Active release requires the exact machine release PR; human approval/override cannot replace its evidence');
        const {currentMachineAuthority} = await import('./promote.mjs');
        const authority = await currentMachineAuthority({number, repo,
          packageDirectory: path.resolve(arg('--package-directory', 'dist')),
          evidenceDirectory: arg('--machine-bundle')});
        const decision = authority.decision;
        if (!decision.allow || decision.version !== tag || decision.candidate !== approval.tagSha) throw Error(decision.reasons.join('; ') || 'Machine tag identity mismatch');
        verdict = {allow: true, route: 'machine', reasons: decision.reasons, notesLine: authority.notesLine};
      } else {
        // The unenrolled/shadow lane and the separately admitted hotfix route retain their gates.
        verdict = config.mode === 'active' ? {allow: false} : decide(approval);
        if (!verdict.allow) verdict = decide({...approval, ...gatherHotfix({tag, tagSha: approval.tagSha, repo})});
      }
    }
  } catch (error) {
    verdict = {allow: false, route: 'error', reasons: [`lookup failed: ${error.message.split('\n')[0]}`]};
  }
  const text = [`## Publish gate — ${tag}`, '', `**${verdict.allow ? 'ALLOW' : 'REFUSE — release stays a draft'}** (${verdict.route})`, '',
    ...verdict.reasons.map(r => `- ${r}`), ''].join('\n');
  console.log(text);
  if (verdict.notesLine) console.log(`notes: ${verdict.notesLine}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  // One line for the release notes (process-notes.mjs): which path let the release out.
  if (verdict.allow && verdict.notesLine && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `notes_line=${verdict.notesLine.replace(/\s+/g, ' ')}\n`);
  process.exit(verdict.allow ? 0 : 1);
}
