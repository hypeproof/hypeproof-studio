#!/usr/bin/env node
// Publish gate: may this tag's draft release become public?
//
//   node scripts/release/publish-gate.mjs --tag v2026.1013.0 [--repo owner/name] [--summary gate.json]
//
// Exit 0 allows publication, exit 1 keeps the release a draft. A stable tag passes when
//   (approval) a `release` PR from `release/<tag>` has an Approve from a repository writer, as that
//              reviewer's latest review and given on the PR's current head (a later rc moves the branch,
//              so an approval of an earlier candidate does not count), an `<tag>-rc.N` tag points at
//              the same commit as the tag, and the release casebook was run (#3429): an
//              `hps-blackbox-run/1` result comment at the PR head gives PASS for every P0 case of the
//              tag's casebook, or Jay or an approving writer posted a comment starting
//              "Release manager override" with a reason after the head commit and an
//              `hps-release-override/1` block listing every non-PASS P0 case it waives (BLOCKED or not
//              run). A P0 FAIL at the head is never waived: the gate refuses and names the cases; or
//   (hotfix)   every first-parent commit since the last published stable release is the merge
//              commit of a `hotfix`-labelled PR whose base is a `hotfix/*` branch.
// A prerelease tag (-rc.N) is not gated: the in-app updater ignores prereleases. It still gets a
// notes line, because the publish job requires one for every release it publishes; the casebook
// (P0 run or override) is checked when the stable tag is published.
// Pushing a tag cannot be prevented on this plan (GitHub Free, private), so the check sits here.
// Any lookup error refuses: a draft is the safe state.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {appliesToTarget, parseYaml, validateTarget} from './casebook.mjs';
import {OVERRIDE_SCHEMA, SCHEMA, extractOverride, extractRun, validateOverride, validateRun} from './validate-blackbox-run.mjs';
import {autoAuthority} from './auto-release-record.mjs';

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

// This publisher releases desktop tags. Share target applicability with the selector;
// native cases do not become desktop requirements merely by being P0 or recently escaped.
export function p0CaseIds(cases = [], {target = 'desktop'} = {}) {
  validateTarget(target);
  return cases.filter(c => appliesToTarget(c, target) && c.priority === 'P0' && c.status !== '자동화됨').map(c => c.id);
}

export const GATE_SCHEMA = 'hps-publish-gate/1';

// Pure. Has the release PR's casebook been run on its current head, or overridden?
//   comments: [{user, association, created_at, body, url}]; approvers: writers approving the head
// Policy (owner-approved): an override may waive a P0 case that is BLOCKED or was not run, never a
// P0 FAIL. It must list every non-PASS P0 case it waives (hps-release-override/1, see
// validate-blackbox-run.mjs). The result carries `summary`, the counts and ids the release record keeps.
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
  // Status of every P0 case at the head: PASS, FAIL, BLOCKED, or NOT_RUN (no row in any valid run).
  const status = id => latest.get(id) ?? 'NOT_RUN';
  const ids = result => p0.filter(id => status(id) === result);
  const [fail, blocked, notRun] = [ids('FAIL'), ids('BLOCKED'), ids('NOT_RUN')];
  const nonPass = [...fail, ...blocked, ...notRun];
  const summary = {schema: GATE_SCHEMA, pr: number, head, p0_total: p0.length,
    counts: {pass: ids('PASS').length, fail: fail.length, blocked: blocked.length, not_run: notRun.length},
    fail_ids: fail, override: {used: false, by: null, url: null, waived_blocked: [], waived_not_run: []}};
  const list = xs => xs.slice(0, 8).join(', ') + (xs.length > 8 ? ` (+${xs.length - 8})` : '');
  const tail = () => (notes.length ? ` [${notes.slice(-3).join('; ')}]` : '');

  // A P0 FAIL is never waived: no override comment is read.
  if (fail.length) {
    return {ok: false, summary, reasons: [`#${number}: P0 FAIL at the head: ${list(fail)}; a release manager override cannot waive a P0 FAIL, fix it and run the casebook on the next rc${tail()}`]};
  }
  if (!nonPass.length && (rcs.size || !p0.length)) {
    return {ok: true, path: 'blackbox-run', summary, reasons: [`casebook: ${p0.length} P0 case(s) PASS at ${String(head).slice(0, 8)}`],
      line: p0.length
        ? `Release casebook: ${SCHEMA} result on #${number} (${[...rcs].join(', ')}) passed all ${p0.length} P0 cases.`
        : `Release casebook: the casebook has no P0 case to run.`};
  }
  const allowed = new Set([OVERRIDE_OWNER, ...approvers]);
  for (const c of ordered.reverse()) {
    const m = String(c.body ?? '').match(OVERRIDE);
    if (!m || !allowed.has(c.user)) continue;
    let block;
    try { block = extractOverride(c.body); } catch (error) { notes.push(`override by ${c.user}: ${error.message}`); continue; }
    const reason = (block ? m[1].replace(block.raw, '') : m[1]).trim();
    if (reason.replace(/\s/g, '').length < MIN_REASON) { notes.push(`override by ${c.user} has no reason`); continue; }
    if (headDate && String(c.created_at) < String(headDate)) { notes.push(`override by ${c.user} predates the head commit`); continue; }
    if (!block) { notes.push(`override by ${c.user} lists no waived P0 cases: add a \`\`\`json block with ${OVERRIDE_SCHEMA}`); continue; }
    const bad = validateOverride(block.value);
    if (bad.length) { notes.push(`override by ${c.user} has an invalid ${OVERRIDE_SCHEMA} block: ${bad[0]}`); continue; }
    const {blocked: wb, not_run: wn} = block.value.waives;
    const unknown = [...wb, ...wn].filter(id => !p0.includes(id));
    if (unknown.length) { notes.push(`override by ${c.user} waives ${list([...new Set(unknown)])}, not a desktop P0 case of this casebook`); continue; }
    const uncovered = [...blocked.filter(id => !wb.includes(id)).map(id => `${id} (BLOCKED)`), ...notRun.filter(id => !wn.includes(id)).map(id => `${id} (not run)`)];
    if (uncovered.length) { notes.push(`override by ${c.user} does not waive ${list(uncovered)}; list every non-PASS P0 case under its status`); continue; }
    // The list is the record of what was waived, so it must be exact: a case listed under a status it
    // does not have at the head (already PASS, or BLOCKED listed as not run) is refused too.
    const inexact = [...wb.filter(id => !blocked.includes(id)).map(id => `${id} is ${status(id)}, not BLOCKED`), ...wn.filter(id => !notRun.includes(id)).map(id => `${id} is ${status(id)}, not not-run`)];
    if (inexact.length) { notes.push(`override by ${c.user} lists a status the head does not have: ${list(inexact)}`); continue; }
    const used = {waived_blocked: blocked, waived_not_run: notRun};
    const first = reason.split('\n')[0].trim();
    return {ok: true, path: 'override', summary: {...summary, override: {used: true, by: c.user, url: c.url ?? null, ...used}},
      reasons: [`casebook: release manager override by ${c.user}`],
      line: `Release casebook: release manager override by ${c.user} on #${number} waived ${nonPass.length} P0 case(s)`
        + ` (${blocked.length} BLOCKED${blocked.length ? `: ${blocked.join(', ')}` : ''}; ${notRun.length} not run${notRun.length ? `: ${notRun.join(', ')}` : ''}); ${summary.counts.pass} PASS: ${first.length > 200 ? `${first.slice(0, 197)}...` : first}`};
  }
  return {ok: false, summary, reasons: [`#${number}: casebook not run at the head: no ${SCHEMA} PASS for P0 ${list(nonPass)}, and no "Release manager override" comment with a reason and an ${OVERRIDE_SCHEMA} block waiving every one of them from ${[...allowed].join(' or ')}`
    + tail()]};
}

// The first APPROVED or CHANGES_REQUESTED review on `head` by someone in `allowed` (all when null).
// Reviews on an earlier head are void: a new candidate needs a new answer.
export function firstDecisive(reviews = [], head, allowed) {
  return reviews.find(r => r.commit === head && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
    && (!allowed || allowed.has(r.user))) ?? null;
}

// Pure decision. Every input is already fetched.
//   releasePrs: [{number, labels, head, headDate, comments, reviews: [{user, state, commit}]}] in review order
//   p0:         P0 case ids of the tag's casebook (p0CaseIds); undefined refuses the approval route
//   writers:    Set of logins with write access (only reviewers need to be in it)
//   rangePrs:   [{sha, prs: [{number, labels, base, mergeCommit}]}]; rangeTooLong: commit count when not read
//   auto:       {enabled, pipeline: [login]}: with RELEASE_AUTO=on, an hps-auto-release/1 record from the
//               pipeline identity at the PR head (every gate PASS on this candidate) stands in for the
//               approval (route `auto`). The casebook rule still applies.
export function decide({tag, tagSha, rcTags = [], releasePrs = [], writers = new Set(), p0, previous, rangePrs = [], rangeTooLong, auto}) {
  if (tag.includes('-')) return {allow: true, route: 'prerelease', casebook: 'prerelease',
    notesLine: 'Release casebook: rc prerelease; the casebook gate (P0 run or release manager override) applies when the stable tag is published.',
    reasons: ['prerelease tag; the in-app updater ignores it']};
  const reasons = [];
  let summary; // the casebook counts of the last release PR read, kept for a refusal too

  const rcAtTag = rcTags.filter(t => t.sha === tagSha).map(t => t.name);
  for (const pr of releasePrs) {
    if (!pr.labels.includes('release')) { reasons.push(`#${pr.number}: no release label`); continue; }
    const states = latestReviewStates(pr.reviews, pr.head);
    const approvers = [...states].filter(([, s]) => s === 'APPROVED').map(([u]) => u);
    const stale = [...states].filter(([, s]) => s === 'STALE').map(([u]) => u);
    // Only the release approvers' answers count (config/release-auto.json releaseApprovers; canon: Harness
    // policy/authority.yaml area studio-desktop-release). The first decisive answer on the current head wins:
    // a "Request changes" before any approval holds the release even if someone approves later.
    const allowed = auto?.approvers?.length ? new Set(auto.approvers) : null;
    const first = firstDecisive(pr.reviews, pr.head, allowed ?? writers);
    if (first?.state === 'CHANGES_REQUESTED') {
      reasons.push(`#${pr.number}: held by ${first.user} (Request changes on the current head; first answer wins)`);
      continue;
    }
    const writerApprovers = approvers.filter(u => writers.has(u) && (!allowed || allowed.has(u)));
    let route = writerApprovers.length ? 'approval' : null;
    let authorityReason = writerApprovers.length ? `#${pr.number} approved by ${writerApprovers.join(', ')}` : '';
    if (!route && auto?.enabled) {
      const a = autoAuthority({pr, candidate: tagSha, pipeline: auto.pipeline ?? []});
      if (a.ok) { route = 'auto'; authorityReason = a.reason; } else reasons.push(a.reason);
    }
    if (!route) {
      reasons.push(`#${pr.number}: no current approval from a writer${approvers.length ? ` (approved by ${approvers.join(', ')})` : ''}`
        + (stale.length ? `; ${stale.join(', ')} approved an earlier candidate` : '')
        + (auto?.enabled ? '' : '; automatic release is off (RELEASE_AUTO)'));
      continue;
    }
    if (!rcAtTag.length) { reasons.push(`#${pr.number}: approved, but no ${tag}-rc.N tag points at ${tagSha.slice(0, 8)}`); continue; }
    if (!Array.isArray(p0)) { reasons.push(`#${pr.number}: approved, but the casebook P0 list was not read`); continue; }
    const evidence = casebookEvidence({number: pr.number, head: pr.head, headDate: pr.headDate, p0, comments: pr.comments ?? [], approvers: writerApprovers});
    summary = evidence.summary;
    if (!evidence.ok) { reasons.push(...evidence.reasons); continue; }
    return {allow: true, route, casebook: evidence.path, notesLine: evidence.line, summary,
      reasons: [`${authorityReason}; ${rcAtTag.join(', ')} at the same commit`, ...evidence.reasons]};
  }
  if (!releasePrs.length) reasons.push(`approval: no PR from release/${tag}`);

  // A P0 FAIL at a release PR's head blocks the hotfix route too (#3462): the override rule is not
  // sidestepped by falling through to it. A hotfix with no run at the head is unaffected.
  const failed = Array.isArray(p0) ? releasePrs.map(pr => ({pr, ids: casebookEvidence({number: pr.number, head: pr.head, headDate: pr.headDate, p0, comments: pr.comments ?? []}).summary.fail_ids})).filter(f => f.ids.length) : [];
  if (failed.length) {
    summary ??= casebookEvidence({number: failed[0].pr.number, head: failed[0].pr.head, p0, comments: failed[0].pr.comments ?? []}).summary;
    reasons.push(...failed.map(f => `hotfix: refused, #${f.pr.number} has a P0 FAIL at its head: ${f.ids.join(', ')}`));
    return {allow: false, route: 'none', summary, reasons};
  }

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
    if (!bad.length) return {allow: true, route: 'hotfix', casebook: 'hotfix', summary, notesLine: `Release casebook: hotfix route (${rangePrs.length} hotfix PR commit(s) since ${previous}); no release PR to run it on.`, reasons: [`${rangePrs.length} commit(s) since ${previous}, all hotfix PRs into hotfix/*`]};
    reasons.push(`hotfix: ${bad.length} of ${rangePrs.length} commit(s) since ${previous} are not hotfix PRs into hotfix/*: ${bad.join(', ')}`);
  }
  return {allow: false, route: 'none', summary, reasons};
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
  return {tag, tagSha, rcTags, releasePrs, writers, p0, auto: autoSetting()};
}

// RELEASE_AUTO (repository variable, passed as env by the workflows) is the kill switch: only "on" enables it.
export function autoSetting(env = process.env) {
  let pipeline = [], approvers = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(new URL('../../config/release-auto.json', import.meta.url), 'utf8'));
    pipeline = cfg.pipeline ?? []; approvers = cfg.releaseApprovers ?? [];
  } catch { pipeline = []; approvers = []; }
  return {enabled: env.RELEASE_AUTO === 'on' && pipeline.length > 0, pipeline, approvers};
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
  // The release record of the gate (#3462): path, override use, waived case ids and P0 counts, one JSON
  // object, so the override rate can be measured across releases. --summary FILE writes it; the workflow
  // attaches it to the release and to the run.
  const record = {schema: GATE_SCHEMA, tag, repo, at: new Date().toISOString(), allow: verdict.allow, route: verdict.route,
    casebook: verdict.casebook ?? null, ...(verdict.summary ? {pr: verdict.summary.pr, head: verdict.summary.head, p0_total: verdict.summary.p0_total, counts: verdict.summary.counts,
      fail_ids: verdict.summary.fail_ids, override: verdict.summary.override} : {})};
  const summaryFile = arg('--summary', process.env.PUBLISH_GATE_SUMMARY);
  if (summaryFile) { fs.mkdirSync(path.dirname(path.resolve(summaryFile)), {recursive: true}); fs.writeFileSync(summaryFile, `${JSON.stringify(record, null, 2)}\n`); }
  const text = [`## Publish gate — ${tag}`, '', `**${verdict.allow ? 'ALLOW' : 'REFUSE — release stays a draft'}** (${verdict.route})`, '',
    ...verdict.reasons.map(r => `- ${r}`), '', '```json', JSON.stringify(record), '```', ''].join('\n');
  console.log(text);
  if (verdict.notesLine) console.log(`notes: ${verdict.notesLine}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  // One line for the release notes (process-notes.mjs): which path let the release out.
  if (verdict.allow && verdict.notesLine && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `notes_line=${verdict.notesLine.replace(/\s+/g, ' ')}\n`);
  process.exit(verdict.allow ? 0 : 1);
}
