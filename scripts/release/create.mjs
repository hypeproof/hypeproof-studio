#!/usr/bin/env node
// Creates what release-cut planned (#1608 follow-up). Run by release-cut.yml with mode=create.
//
//   node scripts/release/create.mjs --plan DIR/plan.json [--accept-not-run] [--managed-draft]
//
// smoke FAIL    → the smoke-failure issue of this version: a new one, or a comment on the open one. No tag, no PR.
// smoke NOT_RUN → stop, unless --accept-not-run (the release PR then says NOT_RUN in its smoke section).
// smoke PASS    → rc tag on the candidate (its annotation makes the builds embed the final version, #3172), the rc builds, branch release/<version> adding
//                 releases/<version>.md, and the release PR (or, for a later rc of the same version,
//                 the existing PR updated with a comment). Then the open smoke-failure issues of this
//                 version or lower are closed with a link to the release PR. A failed close is a warning.
// A trial plan (--since) is never created: its baseline is not a release.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {assertManagedCandidateSupport, buildDispatches, buildTagMessage} from './build-contract.mjs';

// The title release-cut.mjs gives the smoke-failure issue. Matched exactly: other issues are not ours to close.
const SMOKE_ISSUE_TITLE = /^Smoke failed — release (v\d{4}\.\d+\.\d+) stopped$/;

export function actions(plan, {acceptNotRun = false} = {}) {
  if (plan.schema !== 'hps-release-plan/0') return {stop: `unknown plan schema ${plan.schema}`};
  if (plan.trial) return {stop: 'a trial plan (--since) is never created: its baseline is not a release'};
  if (plan.mode !== 'create') return {stop: 'the plan was cut as a dry-run'};
  if (plan.smoke === 'FAIL') return {steps: ['issue']};
  if (plan.smoke === 'NOT_RUN' && !acceptNotRun) return {stop: 'smoke NOT_RUN; rerun with accept_not_run to cut anyway'};
  if (plan.smoke !== 'PASS' && plan.smoke !== 'NOT_RUN') return {stop: `unknown smoke result ${plan.smoke}`};
  // Old smoke-failure issues close only on a PASS. A NOT_RUN cut the manager accepted leaves them open.
  const steps = ['tag', 'builds', 'branch', 'pr'];
  return {steps: plan.smoke === 'PASS' ? [...steps, 'close-smoke-issues'] : steps};
}

// vYYYY.MMDD.N → [YYYY, MMDD, N] as numbers, or null. Format: version.mjs.
export function parseReleaseVersion(version) {
  const m = /^v(\d{4})\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Compares as numbers, never as strings: v2026.105.0 is older than v2026.1013.0.
export function compareReleaseVersions(a, b) {
  const pa = parseReleaseVersion(a);
  const pb = parseReleaseVersion(b);
  if (!pa) throw new Error(`not a release version: ${a}`);
  if (!pb) throw new Error(`not a release version: ${b}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// The version a smoke-failure issue title names, or null for any other title.
export function smokeIssueVersion(title) {
  return SMOKE_ISSUE_TITLE.exec(title)?.[1] ?? null;
}

// Open smoke-failure issues that a passing cut of `version` supersedes: the same version or a lower one.
export function smokeIssuesToClose(openIssues, version) {
  return openIssues.filter(issue => {
    const issueVersion = smokeIssueVersion(issue.title);
    return issueVersion !== null && compareReleaseVersions(issueVersion, version) <= 0;
  });
}

// On smoke FAIL: the open issue of this same version to comment on, or null to open a new one.
export function smokeFailureTarget(openIssues, version) {
  return openIssues.find(issue => smokeIssueVersion(issue.title) === version) ?? null;
}

// The comment left on a superseded smoke-failure issue before it is closed.
export function supersededComment({rcTag, candidate, version, prUrl}) {
  return `Superseded by ${version}: release candidate ${rcTag} on ${candidate.slice(0, 8)} passed smoke. ` +
    `Release PR: ${prUrl}. Closing this smoke-failure record.`;
}

// Open issues whose title contains "Smoke failed"; the exact title is checked by the pure functions above.
function openSmokeIssues(run, repo) {
  return JSON.parse(run('gh', 'issue', 'list', '--repo', repo, '--state', 'open',
    '--search', 'Smoke failed in:title', '--limit', '200', '--json', 'number,title,url'));
}

// The workflow token cannot open pull requests while "Allow GitHub Actions to create and
// approve pull requests" is off, and that switch would also let workflows approve them.
// The PR step therefore uses a separate token (the org bot App in release-cut.yml). A PR
// opened by an App also starts pull_request workflows; one opened by the workflow token does not.
// The release branch push uses it too (branchPushEnv), so a later rc's checks also run.
export function prToken(steps, env) {
  if (!steps.includes('pr')) return null;
  const token = env.RELEASE_PR_TOKEN;
  if (!token) throw new Error('RELEASE_PR_TOKEN is required to open the release PR; refusing before any tag or branch is pushed');
  return token;
}

// The release branch is pushed with the same token, through the environment so it never
// appears in argv or the remote URL. actions/checkout persisted the workflow token as an
// extraheader; an empty value resets that list, then the App credential is the only header.
// A push by the workflow token attributes the PR's synchronize event to github-actions[bot],
// whose pull_request runs this repo holds as action_required (#1973).
export function branchPushEnv(token, env = {}, origin = 'https://github.com/') {
  if (!token) return env;
  const key = `http.${origin}.extraheader`;
  const base = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...env,
    GIT_CONFIG_COUNT: String(base + 2),
    [`GIT_CONFIG_KEY_${base}`]: key,
    [`GIT_CONFIG_VALUE_${base}`]: '',
    [`GIT_CONFIG_KEY_${base + 1}`]: key,
    [`GIT_CONFIG_VALUE_${base + 1}`]: `AUTHORIZATION: basic ${auth}`,
  };
}

function main() {
  const {values} = parseArgs({options: {plan: {type: 'string'}, 'accept-not-run': {type: 'boolean'}, 'managed-draft': {type: 'boolean'}}});
  if (!values.plan) throw new Error('--plan is required');
  const planPath = path.resolve(values.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const dir = path.dirname(planPath);
  const repo = process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio';
  const run = (cmd, ...a) => execFileSync(cmd, a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim();
  let pr = null;
  const summary = [];
  const say = line => { console.log(line); summary.push(line); };

  const decision = actions(plan, {acceptNotRun: values['accept-not-run']});
  if (decision.stop) {
    say(`Nothing created: ${decision.stop}.`);
    finish(summary);
    process.exit(1);
  }

  // Reject invalid identities and a missing PR token before creating a tag or making any GitHub writes.
  const dispatches = decision.steps.includes('builds') ? buildDispatches(plan, {managedDraft: values['managed-draft'] ?? false}) : [];
  if (dispatches.length && values['managed-draft']) assertManagedCandidateSupport(plan.candidate);
  const releasePrToken = prToken(decision.steps, process.env);
  if (releasePrToken) {
    pr = (...a) => execFileSync('gh', a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, GH_TOKEN: releasePrToken}}).trim();
  }
  let prBodyFile = plan.prBody ? path.join(dir, plan.prBody) : null;
  if (dispatches.length && values['managed-draft']) {
    const original = fs.readFileSync(prBodyFile, 'utf8');
    prBodyFile = path.join(dir, 'managed-draft-pr.md');
    fs.writeFileSync(prBodyFile, `> **Managed draft only.** ${plan.rcTag} fixes source ${plan.candidate} and embeds final version ${plan.version}. ` +
      `The builders stop after immutable draft upload. Black-box acceptance, manager approval and channel promotion remain NOT_RUN; this PR is not publication authority.\n\n${original}`);
  }

  let releasePrUrl = null;
  for (const step of decision.steps) {
    if (step === 'issue') {
      const target = smokeFailureTarget(openSmokeIssues(run, repo), plan.version);
      if (target) {
        run('gh', 'issue', 'comment', String(target.number), '--repo', repo, '--body-file', path.join(dir, plan.issueBody));
        say(`Smoke FAIL: commented on open ${target.url}. No rc tag and no release PR.`);
      } else {
        const url = run('gh', 'issue', 'create', '--repo', repo, '--title', plan.issueTitle,
          '--body-file', path.join(dir, plan.issueBody));
        say(`Smoke FAIL: opened ${url}. No rc tag and no release PR.`);
      }
    }
    if (step === 'tag') {
      if (run('git', 'ls-remote', '--tags', 'origin', `refs/tags/${plan.rcTag}`)) throw new Error(`${plan.rcTag} already exists`);
      run('git', 'tag', '-a', plan.rcTag, plan.candidate, '-m', buildTagMessage(plan, {managedDraft: values['managed-draft'] ?? false}));
      run('git', 'push', 'origin', `refs/tags/${plan.rcTag}`);
      say(`Tagged ${plan.rcTag} on ${plan.candidate.slice(0, 8)}.`);
    }
    if (step === 'builds') {
      // A tag pushed with the workflow token starts no workflow; a dispatch does.
      for (const dispatch of dispatches) {
        const inputs = Object.entries(dispatch.inputs).flatMap(([name, value]) => ['-f', `${name}=${value}`]);
        run('gh', 'workflow', 'run', dispatch.workflow, '--repo', repo, '--ref', dispatch.ref, ...inputs);
      }
      say(values['managed-draft']
        ? `Started managed builds of ${plan.candidate} for ${plan.rcTag}, embedding ${plan.version}; draft upload only. Acceptance and promotion remain NOT_RUN.`
        : `Started ${dispatches.map(d => d.workflow).join(' and ')} on ${plan.rcTag}, embedding ${plan.version}; they run the automatic E2E and publish a prerelease that release-promote turns into ${plan.version} on approval.`);
    }
    if (step === 'branch') {
      run('git', 'checkout', '-q', '-B', plan.branch, plan.candidate);
      const record = path.join('releases', `${plan.version}.md`);
      fs.mkdirSync('releases', {recursive: true});
      fs.copyFileSync(prBodyFile, record);
      run('git', 'add', record);
      run('git', 'commit', '-q', '-m', `release: record ${plan.rcTag}`);
      // A later rc of the same version moves the branch to its own candidate.
      const push = env => execFileSync('git', ['push', '-q', '--force', 'origin', `HEAD:refs/heads/${plan.branch}`],
        {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env});
      try {
        push(branchPushEnv(releasePrToken, process.env));
        say(`Pushed ${plan.branch} with ${record}.`);
      } catch (error) {
        if (!releasePrToken) throw error;
        // e.g. an App without the workflows permission cannot push workflow changes. The workflow
        // token still moves the branch; the PR's checks then wait for approval (action_required).
        push(process.env);
        say(`Pushed ${plan.branch} with ${record} using the workflow token: the release PR token push failed, so the PR's checks need approval to run.`);
      }
    }
    if (step === 'pr') {
      try { pr('label', 'create', 'release', '--repo', repo, '--color', '0E8A16', '--description', 'Release PR (release-cut); the black-box pre-tester watches this label'); } catch { /* exists */ }
      const open = JSON.parse(pr('pr', 'list', '--repo', repo, '--head', plan.branch, '--state', 'open', '--json', 'number,url'));
      const body = prBodyFile;
      if (open.length) {
        // The label is what the agent pre-tester watches (docs/operations/release-casebook/pre-tester-prompt.md).
        pr('pr', 'edit', String(open[0].number), '--repo', repo, '--body-file', body, '--add-label', 'release');
        pr('pr', 'comment', String(open[0].number), '--repo', repo, '--body',
          `New candidate ${plan.rcTag} at ${plan.candidate.slice(0, 8)}. Approvals given before this comment were for an earlier candidate; review again.`);
        releasePrUrl = open[0].url;
        say(`Updated ${open[0].url} for ${plan.rcTag}.`);
      } else {
        const url = pr('pr', 'create', '--repo', repo, '--base', 'main', '--head', plan.branch,
          '--title', plan.title, '--body-file', body, '--label', 'release');
        releasePrUrl = url;
        say(`Opened ${url}.`);
      }
    }
    // Runs after the tag and the PR exist, so a failure here cannot stop the release. Each close is independent.
    if (step === 'close-smoke-issues') {
      try {
        const targets = smokeIssuesToClose(openSmokeIssues(run, repo), plan.version);
        if (!targets.length) say(`No open smoke-failure issue of ${plan.version} or lower to close.`);
        for (const issue of targets) {
          try {
            run('gh', 'issue', 'comment', String(issue.number), '--repo', repo, '--body',
              supersededComment({rcTag: plan.rcTag, candidate: plan.candidate, version: plan.version, prUrl: releasePrUrl ?? plan.branch}));
            run('gh', 'issue', 'close', String(issue.number), '--repo', repo);
            say(`Closed ${issue.url}: superseded by ${plan.version}.`);
          } catch (error) {
            say(`WARNING: could not close ${issue.url}: ${String(error.message).split('\n')[0]}. Close it by hand.`);
          }
        }
      } catch (error) {
        say(`WARNING: could not list smoke-failure issues: ${String(error.message).split('\n')[0]}. Close them by hand.`);
      }
    }
  }
  finish(summary);
}

function finish(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Release cut — create\n\n${lines.map(l => `- ${l}`).join('\n')}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === new URL(import.meta.url).pathname) main();
