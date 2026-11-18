#!/usr/bin/env node
// Automatic release: promote the open release PR's rc to stable with no human approval, only when every
// gate passes on that exact candidate (Jay 2026-11-16; hypeprooflab docs/decisions/2026-11-16-studio-auto-release.md).
//
//   node scripts/release/auto-release.mjs run [--pr N] [--out DIR]     (release-auto.yml)
//
// Gates (REQUIRED_GATES in auto-release-record.mjs), all on the release PR head and its rc candidate:
//   kill-switch   repository variable RELEASE_AUTO is "on"
//   release-pr    release/vX.Y.Z head, one record commit on the candidate, rc tag on the candidate, rc published
//   required-ci   mergeStateStatus CLEAN (main's required checks green on the head)
//   acceptance    unified-acceptance.json on the rc: PASS for every configured platform at the candidate
//   notarization  the Mac signing receipt says notarization Accepted (when darwin-arm64 ships)
//   blockers      no open `release-blocker` issue in Studio, Service or Lab (release-blockers.mjs)
//   blackbox-kit  hps-blackbox-kit/1 result for the candidate, every required scenario PASS
//   casebook      every `gate: auto` P0 case of the casebook has its evidence (acceptance, kit or a run at the
//                 head) and no P0 case FAILed at the head (casebook-gate.mjs). after-publish and human cases
//                 do not hold it: after publication they are the "v<version> 출시 후 점검" issue (2026-11-18)
//   holds         no unhidden comment outside the release machinery, no changes-requested review
//   release-deps  hps-release-deps/1 result for the candidate with verdict PASS
//   freeze        no live class (check-live-sessions.mjs decision `proceed`)
// Outcome:
//   PASS  post the hps-auto-release/1 record as the pipeline identity, then promote.mjs run (v tag, v draft,
//         squash-merge of the release PR, verify-unified-release for the v tag, whose publish gate checks
//         the record again).
//   WAIT  something is not there yet (CI running, kit not run, freeze). Nothing is written; the next run retries.
//   FAIL  a gate observed a failure. One comment on the release PR (updated in place), one open
//         `release-blocker` issue in Studio (stops every later cut and promotion until closed), #alerts.
//         The job itself succeeds: the stop is reported, not a machinery error (#4315).
// Off (RELEASE_AUTO not "on") does nothing at all: releases stay manual (release-promote on approval).
// After publication: the SDK seed check and "출시됨 vX", then one "vX 출시 후 점검" issue listing the release's
// after-publish and human P0 cases for the team. Every run labels such an issue `release-blocker` when a
// trusted hps-blackbox-run/1 comment on it reports a FAIL, which stops the next release.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {AUTO_SCHEMA, REQUIRED_GATES, depsEvidence, holds, kitEvidence} from './auto-release-record.mjs';
import {checkBlockers} from './release-blockers.mjs';
import {PUBLISHED_SCHEMA, alreadyAsked, askBody, askReason, publishChecks, publishedBody} from './release-ask.mjs';
import {gatherPromotion, promotionDecision} from './promote.mjs';
import {CASEBOOK, p0CaseIds} from './publish-gate.mjs';
import {loadCasebook, parseYaml} from './casebook.mjs';
import {CHECKLIST_SUFFIX, autoCasebook, checklistBody, checklistFailures, checklistTitle, splitByGate} from './casebook-gate.mjs';
import {releasePlatforms} from './platforms.mjs';
import {MAC_RECEIPT} from './macos-signing-receipt.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ACCEPTANCE = 'unified-acceptance.json';
const MARKER = '<!-- hps-auto-release-status -->';

export function loadPolicy(file = path.join(scriptDir, '..', '..', 'config', 'release-auto.json')) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (p.version !== 1 || !p.pipeline?.length || !p.evidenceReporters?.length || !p.blackboxKit?.requiredScenarios?.length
    || !p.releaseApprovers?.length || !p.team?.length || !(p.askAfterHours > 0)) {
    throw new Error('config/release-auto.json is incomplete');
  }
  return p;
}

const gate = (id, status, detail) => ({id, status, detail});

// Pure. facts: everything already read; policy: config/release-auto.json.
//   facts: {enabled, promotion: promotionDecision facts, structural: promotionDecision result (approval-free),
//           acceptance: {receipts} | null, platforms: [..], macReceipt: {notarization} | null,
//           blockers: blockerDecision result, live: 'proceed'|'blocked'|'',
//           casebookCases: the current casebook's cases (their gate fields)}
export function autoGates(facts, policy) {
  const g = [];
  const {pr, mergeState} = facts.promotion;
  const candidate = facts.candidate;
  g.push(facts.enabled ? gate('kill-switch', 'PASS', 'RELEASE_AUTO=on') : gate('kill-switch', 'OFF', 'RELEASE_AUTO is not "on"; releases stay manual'));

  const s = facts.structural;
  if (s.allow) g.push(gate('release-pr', 'PASS', `${s.rcTag} on ${candidate.slice(0, 8)}, record-only head`));
  else {
    const waiting = s.reasons.some(r => /still a draft|has not uploaded|not green yet|UNKNOWN|unread/.test(r));
    g.push(gate('release-pr', waiting ? 'WAIT' : 'FAIL', s.reasons.join('; ')));
  }

  if (mergeState === 'CLEAN') g.push(gate('required-ci', 'PASS', 'mergeStateStatus CLEAN'));
  else g.push(gate('required-ci', ['BLOCKED', 'UNKNOWN', 'BEHIND', ''].includes(mergeState) ? 'WAIT' : 'FAIL', `mergeStateStatus ${mergeState || 'unread'}`));

  const receipts = facts.acceptance?.receipts;
  if (!Array.isArray(receipts)) g.push(gate('acceptance', 'WAIT', `${ACCEPTANCE} not on the rc yet`));
  else {
    const bad = facts.platforms.filter(p => !receipts.some(r => r.platform === p && r.status === 'PASS' && r.sourceSha === candidate));
    const failed = receipts.filter(r => r.status === 'FAIL').map(r => r.platform);
    if (failed.length) g.push(gate('acceptance', 'FAIL', `acceptance FAIL on ${failed.join(', ')}`));
    else if (bad.length) g.push(gate('acceptance', 'WAIT', `no PASS receipt at ${candidate.slice(0, 8)} for ${bad.join(', ')}`));
    else g.push(gate('acceptance', 'PASS', `${facts.platforms.join(' + ')} PASS at ${candidate.slice(0, 8)}`));
  }

  if (!facts.platforms.includes('darwin-arm64')) g.push(gate('notarization', 'PASS', 'no Mac package in this release'));
  else if (!facts.macReceipt) g.push(gate('notarization', 'WAIT', `${MAC_RECEIPT} not on the rc yet`));
  else if (facts.macReceipt.notarization?.status === 'Accepted') g.push(gate('notarization', 'PASS', `notarization Accepted (${facts.macReceipt.notarization.submission_id})`));
  else g.push(gate('notarization', 'FAIL', `notarization ${facts.macReceipt.notarization?.status ?? 'missing'}`));

  const b = facts.blockers;
  if (b.allow) g.push(gate('blockers', 'PASS', 'no open release-blocker issue'));
  else g.push(gate('blockers', b.blockers.length ? 'FAIL' : 'WAIT', b.reasons.join('; ')));

  const kit = kitEvidence({pr, candidate, reporters: policy.evidenceReporters, required: policy.blackboxKit.requiredScenarios});
  g.push(gate('blackbox-kit', kit.status, kit.detail));

  if (!Array.isArray(facts.promotion.p0)) g.push(gate('casebook', 'FAIL', 'the casebook P0 list was not read'));
  else if (!Array.isArray(facts.casebookCases)) g.push(gate('casebook', 'FAIL', 'the casebook gate fields were not read'));
  else {
    const cb = autoCasebook({number: pr.number, head: pr.head, headDate: pr.headDate, candidate, p0: facts.promotion.p0,
      cases: facts.casebookCases, comments: pr.comments ?? [], receipts: facts.acceptance?.receipts ?? null,
      platforms: facts.platforms, reporters: policy.evidenceReporters});
    g.push(gate('casebook', cb.status, cb.reasons.join('; ')));
  }

  const h = holds({comments: facts.comments, reviews: pr.reviews}, policy.machinery);
  if (!h.open.length && !h.changes.length) g.push(gate('holds', 'PASS', 'no unresolved comment or change request'));
  else g.push(gate('holds', 'FAIL', [...h.open.map(c => `unresolved comment by ${c.user}: ${c.url} (hide it as Resolved when handled)`),
    ...h.changes.map(u => `changes requested by ${u}`)].join('; ')));

  const deps = depsEvidence({pr, candidate, reporters: policy.evidenceReporters});
  g.push(gate('release-deps', deps.status, deps.detail));

  if (facts.live === 'proceed') g.push(gate('freeze', 'PASS', 'no live class'));
  else g.push(gate('freeze', 'WAIT', facts.live === 'blocked' ? 'a class is live' : 'live-class check did not answer'));

  for (const id of REQUIRED_GATES) if (!g.some(x => x.id === id)) g.push(gate(id, 'FAIL', 'gate not evaluated'));
  const verdict = g[0].status === 'OFF' ? 'OFF'
    : g.some(x => x.status === 'FAIL') ? 'FAIL'
      : g.every(x => x.status === 'PASS') ? 'PASS' : 'WAIT';
  return {verdict, gates: g};
}

export function recordBody({pr, candidate, rcTag, version, gates, runUrl}) {
  const record = {schema: AUTO_SCHEMA, pr: pr.number, head_sha: pr.head, candidate, rc_tag: rcTag, version,
    gates: gates.map(({id, status}) => ({id, status})), run: runUrl};
  return [`Automatic release: every gate passed on ${rcTag} (${candidate.slice(0, 8)}). Promoting to ${version}.`, '',
    ...gates.map(x => `- \`${x.id}\` ${x.status}: ${x.detail}`), '', '```json', JSON.stringify(record, null, 2), '```'].join('\n');
}

export function statusBody({gates, rcTag, runUrl}) {
  const failing = gates.filter(x => x.status === 'FAIL');
  return [MARKER, `**Automatic release stopped** for ${rcTag}: ${failing.map(x => `\`${x.id}\``).join(', ')}.`, '',
    ...gates.map(x => `- \`${x.id}\` ${x.status}: ${x.detail}`), '',
    `Run: ${runUrl}`, '',
    'Fix the cause, close the release-blocker issue, and cut a new rc (or rerun release-auto). Releases are never promoted while a gate fails.',
  ].join('\n');
}

export function blockerTitle(version, gates) {
  return `Auto-release stopped: ${version} (${gates.filter(x => x.status === 'FAIL').map(x => x.id).join(', ')})`;
}

// ---- I/O ---------------------------------------------------------------------------------------------

const gh = (args, token) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'],
  env: token ? {...process.env, GH_TOKEN: token} : process.env}).trim();

function openReleasePr(repo) {
  const list = JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'open', '--label', 'release', '--json', 'number,headRefName']));
  const prs = list.filter(p => /^release\/v\d+\.\d+\.\d+$/.test(p.headRefName));
  return prs.length === 1 ? prs[0].number : null;
}

// Comments with GitHub's "hidden" state, which the REST API does not return.
function commentsWithState(repo, number) {
  const [owner, name] = repo.split('/');
  const q = 'query($o:String!,$n:String!,$p:Int!,$c:String){repository(owner:$o,name:$n){pullRequest(number:$p){comments(first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{author{login} createdAt body url isMinimized}}}}}';
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const args = ['api', 'graphql', '-f', `query=${q}`, '-f', `o=${owner}`, '-f', `n=${name}`, '-F', `p=${number}`];
    if (cursor) args.push('-f', `c=${cursor}`);
    const c = JSON.parse(gh(args)).data.repository.pullRequest.comments;
    for (const n of c.nodes) {
      const login = n.author?.login ?? 'ghost';
      // GraphQL drops the [bot] suffix that REST uses for Apps.
      const user = /^(hypeproof-org-lab-bot|hypeproof-agent|github-actions)$/.test(login) ? `${login}[bot]` : login;
      out.push({user, created_at: n.createdAt, body: n.body, url: n.url, minimized: n.isMinimized});
    }
    if (!c.pageInfo.hasNextPage) return out;
    cursor = c.pageInfo.endCursor;
  }
  throw new Error('more than 2000 comments on the release PR');
}

function rcAsset(repo, rcTag, name, dir) {
  try {
    gh(['release', 'download', rcTag, '--repo', repo, '--pattern', name, '--dir', dir, '--clobber']);
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  } catch { return null; }
}

export function gatherAuto({number, repo, out, env = process.env}) {
  const policy = loadPolicy();
  const promotion = gatherPromotion(number, repo);
  // Structural checks only: the same decision with an approval-free authority. Its reasons say what is
  // missing besides the approval, which this pipeline replaces.
  const structural = promotionDecision({...promotion, auto: {enabled: true, pipeline: ['__structural__']}});
  const structuralOk = structural.allow || structural.reasons.every(r => /no current approval|no hps-auto-release\/1 record/.test(r));
  const commit = promotion.commit;
  const candidate = commit.parents.length === 1 ? commit.parents[0] : '';
  const rcTag = /^release: record (v\d+\.\d+\.\d+-rc\.[1-9]\d*)$/.exec(commit.message.split('\n')[0])?.[1] ?? '';
  const dir = path.resolve(out, `auto-${rcTag || 'none'}`);
  fs.mkdirSync(dir, {recursive: true});
  const platforms = candidate ? releasePlatforms(candidate) : [];
  return {
    policy,
    facts: {
      enabled: env.RELEASE_AUTO === 'on', candidate, promotion, rcTag,
      structural: structuralOk ? {allow: true, rcTag} : structural,
      acceptance: rcTag ? rcAsset(repo, rcTag, ACCEPTANCE, dir) : null,
      macReceipt: rcTag ? rcAsset(repo, rcTag, MAC_RECEIPT, dir) : null,
      platforms, blockers: checkBlockers(), live: env.LIVE_DECISION ?? '',
      comments: commentsWithState(repo, number), casebookCases: loadCasebook().cases,
    },
  };
}

function alert(text) {
  const hook = process.env.DISCORD_WEBHOOK_ALERTS;
  if (!hook) { console.log('DISCORD_WEBHOOK_ALERTS not set; no #alerts post'); return; }
  spawnSync('curl', ['-fsS', '-H', 'Content-Type: application/json', '-d', JSON.stringify({content: text.slice(0, 1900)}), hook], {stdio: 'inherit'});
}

// The latest public stable release, when it is recent and its release PR has no published record yet.
function unpublishedRelease(repo, policy, now) {
  const list = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=20`]));
  const r = list.filter(x => !x.draft && !x.prerelease && /^v\d+\.\d+\.\d+$/.test(x.tag_name))
    .sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  if (!r || now - Date.parse(r.published_at) > 72 * 3600 * 1000) return null;
  const prs = JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'merged', '--head', `release/${r.tag_name}`, '--json', 'number']));
  if (prs.length !== 1) return null;
  const number = prs[0].number;
  const done = commentsWithState(repo, number).some(c => policy.pipeline.includes(c.user) && c.body.includes(PUBLISHED_SCHEMA));
  return done ? null : {tag: r.tag_name, number, assets: r.assets.map(a => ({name: a.name, size: a.size}))};
}

function seedOf(repo, tag) {
  const url = `https://github.com/${repo}/releases/download/${tag}/sdk-seed.json`;
  const out = spawnSync('curl', ['-sL', '-o', '-', '-w', '\n%{http_code}', url], {encoding: 'utf8'});
  const lines = String(out.stdout ?? '').trimEnd().split('\n');
  const status = Number(lines.pop());
  let seed = null;
  try { seed = JSON.parse(lines.join('\n')); } catch { seed = null; }
  return {status: Number.isFinite(status) ? status : 0, seed};
}

// Post-publish: the seed the App asks for exists, then "출시됨 vX" to the whole team.
function postPublish({repo, policy, out, runUrl, say, pipelineToken}) {
  const r = unpublishedRelease(repo, policy, Date.now());
  if (!r) return;
  const {status, seed} = seedOf(repo, r.tag);
  const check = publishChecks({tag: r.tag, seedStatus: status, seed, assets: r.assets});
  // Before "출시됨": a failure here throws, nothing is posted, and the next run tries both again.
  openChecklist({repo, policy, release: r, out, runUrl, say});
  const file = path.join(out, 'published.md');
  fs.writeFileSync(file, publishedBody({tag: r.tag, pr: r.number, ok: check.ok, problems: check.problems, team: policy.team, runUrl}));
  gh(['pr', 'comment', String(r.number), '--repo', repo, '--body-file', file], pipelineToken);
  if (check.ok) {
    say(`${r.tag} is public and its SDK seed is in place; announced on #${r.number}.`);
    return;
  }
  const issue = gh(['issue', 'create', '--repo', repo, '--title', `Post-publish check failed: ${r.tag} (sdk-seed)`, '--label', 'release-blocker', '--body-file', file]).split('\n').pop();
  say(`${r.tag} post-publish check failed: ${check.problems.join('; ')}. ${issue}`);
  alert(`Studio ${r.tag} is public but its post-publish check failed (${check.problems[0]}). ${issue} ${runUrl}`);
}

// The release's after-publish and human P0 cases, as one issue for the team. Idempotent by title.
function openChecklist({repo, policy, release, out, runUrl, say}) {
  const title = checklistTitle(release.tag);
  const existing = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', `"${title}" in:title`, '--json', 'number,title,url']));
  const found = existing.find(i => i.title === title);
  if (found) { say(`Post-release checklist already open: ${found.url}`); return; }
  const tagSha = execFileSync('git', ['rev-parse', `${release.tag}^{commit}`], {encoding: 'utf8'}).trim();
  const p0 = p0CaseIds(parseYaml(execFileSync('git', ['show', `${tagSha}:${CASEBOOK}`], {encoding: 'utf8', maxBuffer: 16 << 20}), CASEBOOK)?.cases ?? []);
  const cases = loadCasebook().cases;
  const split = splitByGate(p0, cases);
  const file = path.join(out, 'checklist.md');
  fs.writeFileSync(file, checklistBody({tag: release.tag, pr: release.number, candidate: tagSha, cases, split, team: policy.team, runUrl}));
  const url = gh(['issue', 'create', '--repo', repo, '--title', title, '--body-file', file]).split('\n').pop();
  say(`Post-release checklist (${split.afterPublish.length} after-publish, ${split.human.length} human): ${url}`);
}

// A FAIL reported on an open post-release checklist stops the next release: the issue becomes a release-blocker.
function sweepChecklists({repo, say}) {
  const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `"${CHECKLIST_SUFFIX}" in:title`, '--json', 'number,title,labels,body']));
  for (const issue of open.filter(i => i.title.endsWith(` ${CHECKLIST_SUFFIX}`))) {
    if (issue.labels.some(l => l.name === 'release-blocker')) continue;
    const pr = /"pr": (\d+)/.exec(issue.body ?? '')?.[1];
    if (!pr) continue;
    const comments = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/issues/${issue.number}/comments?per_page=100`])).flat()
      .map(c => ({user: c.user?.login, association: c.author_association, created_at: c.created_at, body: c.body ?? '', url: c.html_url}));
    const failed = checklistFailures({pr: Number(pr), comments});
    if (!failed.length) continue;
    gh(['issue', 'edit', String(issue.number), '--repo', repo, '--add-label', 'release-blocker']);
    gh(['issue', 'comment', String(issue.number), '--repo', repo, '--body',
      `출시 후 점검에서 FAIL: ${failed.join(', ')}. 이 이슈를 release-blocker 로 바꿨어요. 고친 뒤 라벨을 떼거나 이슈를 닫기 전까지 다음 출시는 멈춰요.`]);
    alert(`Studio post-release check FAIL (${failed.join(', ')}): ${issue.title} is now a release-blocker. https://github.com/${repo}/issues/${issue.number}`);
    say(`${issue.title}: FAIL ${failed.join(', ')} -> release-blocker`);
  }
}

// Ask the whole team on the release PR, once per head.
function askTeam({repo, number, facts, policy, version, gates, reason, out, runUrl, say, pipelineToken}) {
  const pr = facts.promotion.pr;
  if (alreadyAsked(facts.comments, policy.pipeline, pr.head)) { say(`Already asked the team about ${pr.head.slice(0, 8)}.`); return; }
  const file = path.join(out, 'ask.md');
  fs.writeFileSync(file, askBody({pr, candidate: facts.candidate, rcTag: facts.rcTag, version, reason, gates,
    approvers: policy.releaseApprovers, team: policy.team, runUrl}));
  gh(['pr', 'comment', String(number), '--repo', repo, '--body-file', file], pipelineToken);
  // A review request is what GitHub emails as "review requested"; the approvers answer with a review.
  try {
    gh(['pr', 'edit', String(number), '--repo', repo, ...policy.releaseApprovers.flatMap(a => ['--add-reviewer', a])], pipelineToken);
  } catch (error) {
    say(`WARNING: review request failed: ${String(error.stderr || error.message).split('\n')[0]}`);
  }
  say(`Asked the team (${reason}) on #${number}; release approvers: ${policy.releaseApprovers.join(', ')}.`);
}

function run({pr: requested, out}) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio';
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? 'local'}`;
  const summary = [];
  const say = line => { console.log(line); summary.push(line); };
  const finish = code => {
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Automatic release\n\n${summary.map(l => `- ${l}`).join('\n')}\n`);
    process.exit(code);
  };
  const pipelineToken = process.env.RELEASE_PR_TOKEN;
  try { postPublish({repo, policy: loadPolicy(), out, runUrl, say, pipelineToken}); } catch (error) {
    say(`WARNING: post-publish check could not run: ${String(error.stderr || error.message).split('\n')[0]}`);
  }
  try { sweepChecklists({repo, say}); } catch (error) {
    say(`WARNING: post-release checklist sweep could not run: ${String(error.stderr || error.message).split('\n')[0]}`);
  }
  const number = requested ?? openReleasePr(repo);
  if (!number) { say('No single open release PR (label release, head release/vX.Y.Z): nothing to promote.'); finish(0); }
  const {policy, facts} = gatherAuto({number, repo, out});
  const {verdict, gates} = autoGates(facts, policy);
  const version = facts.promotion.pr.headRef.replace(/^release\//, '');
  say(`#${number} ${facts.rcTag} (${facts.candidate.slice(0, 8)}): ${verdict}`);
  gates.forEach(x => say(`${x.id} ${x.status}: ${x.detail}`));

  // Not every gate passed (or automatic release is off): ask the whole team once per head. A WAIT asks only
  // after askAfterHours; before that the next run may still find the evidence.
  const reason = askReason({verdict, headDate: facts.promotion.pr.headDate, now: Date.now(), askAfterHours: policy.askAfterHours});
  if (reason) askTeam({repo, number, facts, policy, version, gates, reason, out, runUrl, say, pipelineToken});
  if (verdict === 'WAIT' || verdict === 'OFF') finish(0);
  if (verdict === 'FAIL') {
    const body = statusBody({gates, rcTag: facts.rcTag, runUrl});
    const mine = facts.comments.filter(c => policy.pipeline.includes(c.user) && c.body.includes(MARKER)).pop();
    const file = path.join(out, 'auto-status.md');
    fs.writeFileSync(file, body);
    const id = mine ? /issuecomment-(\d+)/.exec(mine.url)?.[1] : null;
    if (id) gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${id}`, '-F', `body=@${file}`], pipelineToken);
    else gh(['pr', 'comment', String(number), '--repo', repo, '--body-file', file], pipelineToken);
    // The release-blocker rule: a failed gate is a blocker until someone fixes and closes it. Studio is
    // public, so the issue carries only gate names and links, never member data.
    const title = blockerTitle(version, gates);
    const open = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--label', 'release-blocker', '--json', 'title,url']));
    let issue = open.find(i => i.title === title)?.url;
    // One #alerts post per new stop; a later run that finds the same open issue stays quiet.
    if (!issue) {
      issue = gh(['issue', 'create', '--repo', repo, '--title', title, '--label', 'release-blocker', '--body-file', file]).split('\n').pop();
      alert(`Studio auto-release stopped: ${version} ${facts.rcTag} — ${gates.filter(x => x.status === 'FAIL').map(x => x.id).join(', ')}. ${issue} ${runUrl}`);
    }
    say(`Stopped. ${issue}`);
    // The stop is reported (release PR comment, release-blocker issue, #alerts). A red job would only repeat
    // it as a failed check-run on main's head, which turned the next candidate red (#4315). Machinery errors
    // (an exception, a failed promotion) still fail the job.
    finish(0);
  }

  // PASS: write the authority record, then promote. promote.mjs and the publish gate both re-check it.
  const recordFile = path.join(out, 'auto-record.md');
  fs.writeFileSync(recordFile, recordBody({pr: facts.promotion.pr, candidate: facts.candidate, rcTag: facts.rcTag, version, gates, runUrl}));
  gh(['pr', 'comment', String(number), '--repo', repo, '--body-file', recordFile], pipelineToken);
  say(`Recorded ${AUTO_SCHEMA} on #${number}; promoting.`);
  const p = spawnSync(process.execPath, [path.join(scriptDir, 'promote.mjs'), 'run', '--pr', String(number), '--out', out], {stdio: 'inherit', env: process.env});
  if (p.status !== 0) {
    alert(`Studio auto-release: every gate passed for ${version}, but promotion failed. ${runUrl}`);
    say('promote.mjs failed; see its summary. The record stays; rerun release-auto once fixed.');
    finish(1);
  }
  alert(`Studio auto-release: ${version} promoted from ${facts.rcTag} (${facts.candidate.slice(0, 8)}); the publish gate publishes it. ${runUrl}`);
  finish(0);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  const {values} = parseArgs({args: process.argv.slice(3), options: {pr: {type: 'string'}, out: {type: 'string'}}});
  if (command !== 'run' || (values.pr && !/^[1-9]\d*$/.test(values.pr))) {
    console.error('usage: auto-release.mjs run [--pr N] [--out DIR]');
    process.exit(2);
  }
  run({pr: values.pr ? Number(values.pr) : null, out: values.out ?? process.env.RUNNER_TEMP ?? '.'});
}
