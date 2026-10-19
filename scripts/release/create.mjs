#!/usr/bin/env node
// Creates what release-cut planned (#1608 follow-up). Run by release-cut.yml with mode=create.
//
//   node scripts/release/create.mjs --plan DIR/plan.json [--accept-not-run] [--managed-draft]
//
// smoke FAIL    → the smoke-failure issue. No tag, no PR.
// smoke NOT_RUN → stop, unless --accept-not-run (the release PR then says NOT_RUN in its smoke section).
// smoke PASS    → rc tag on the candidate, the rc builds, branch release/<version> adding
//                 releases/<version>.md, and the release PR (or, for a later rc of the same version,
//                 the existing PR updated with a comment).
// A trial plan (--since) is never created: its baseline is not a release.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {assertManagedCandidateSupport, buildDispatches, buildTagMessage} from './build-contract.mjs';
import {engineEnabled,executionBody,guardedEffect} from './cloud-executor/workflow-gate.mjs';

export function actions(plan, {acceptNotRun = false} = {}) {
  if (plan.schema !== 'hps-release-plan/0') return {stop: `unknown plan schema ${plan.schema}`};
  if (plan.trial) return {stop: 'a trial plan (--since) is never created: its baseline is not a release'};
  if (plan.mode !== 'create') return {stop: 'the plan was cut as a dry-run'};
  if (plan.smoke === 'FAIL') return {steps: ['issue']};
  if (plan.smoke === 'NOT_RUN' && !acceptNotRun) return {stop: 'smoke NOT_RUN; rerun with accept_not_run to cut anyway'};
  if (plan.smoke !== 'PASS' && plan.smoke !== 'NOT_RUN') return {stop: `unknown smoke result ${plan.smoke}`};
  return {steps: ['tag', 'builds', 'branch', 'pr']};
}

async function main() {
  const {values} = parseArgs({options: {plan: {type: 'string'}, 'accept-not-run': {type: 'boolean'}, 'managed-draft': {type: 'boolean'}}});
  if (!values.plan) throw new Error('--plan is required');
  const planPath = path.resolve(values.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const dir = path.dirname(planPath);
  const repo = process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio';
  const run = (cmd, ...a) => execFileSync(cmd, a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']}).trim();
  const summary = [];
  const say = line => { console.log(line); summary.push(line); };

  const decision = actions(plan, {acceptNotRun: values['accept-not-run']});
  if (decision.stop) {
    say(`Nothing created: ${decision.stop}.`);
    finish(summary);
    process.exit(1);
  }

  // Reject invalid identities before creating a tag or making any GitHub writes.
  const dispatches = decision.steps.includes('builds') ? buildDispatches(plan, {managedDraft: values['managed-draft'] ?? false}) : [];
  if (dispatches.length && values['managed-draft']) assertManagedCandidateSupport(plan.candidate);
  const controlled=engineEnabled();
  if(controlled&&!values['managed-draft'])throw Error('BLOCKED engine mode requires a managed reserved candidate');
  let prBodyFile = plan.prBody ? path.join(dir, plan.prBody) : null;
  if (dispatches.length && values['managed-draft']) {
    const original = fs.readFileSync(prBodyFile, 'utf8');
    prBodyFile = path.join(dir, 'managed-draft-pr.md');
    fs.writeFileSync(prBodyFile, `> **Managed draft only.** ${plan.rcTag} fixes source ${plan.candidate} and embeds final version ${plan.version}. ` +
      `The builders stop after immutable draft upload. Black-box acceptance, manager approval and channel promotion remain NOT_RUN; this PR is not publication authority.\n\n${original}`);
  }

  for (const step of decision.steps) {
    if (step === 'issue') {
      const url = run('gh', 'issue', 'create', '--repo', repo, '--title', plan.issueTitle,
        '--body-file', path.join(dir, plan.issueBody));
      say(`Smoke FAIL: opened ${url}. No rc tag and no release PR.`);
    }
    if (step === 'tag' && controlled) {
      const identity={repository:repo,repositoryId:Number(process.env.GITHUB_REPOSITORY_ID),sourceSha:plan.candidate,rcTag:plan.rcTag,version:plan.version};
      await guardedEffect({body:executionBody({path:'release-cut:tag-create',identity,effect:{kind:'managed-tag',tagMessage:buildTagMessage(plan,{managedDraft:true})}}),managed:true,perform:true});
      say('Service created the reserved managed tag; builder execution is tag-push only.');
    }
    if (step === 'tag' && !controlled) {
      if (run('git', 'ls-remote', '--tags', 'origin', `refs/tags/${plan.rcTag}`)) throw new Error(`${plan.rcTag} already exists`);
      run('git', 'tag', '-a', plan.rcTag, plan.candidate, '-m', buildTagMessage(plan, {managedDraft: values['managed-draft'] ?? false}));
      run('git', 'push', 'origin', `refs/tags/${plan.rcTag}`);
      say(`Tagged ${plan.rcTag} on ${plan.candidate.slice(0, 8)}.`);
    }
    if (step === 'builds' && !controlled) {
      // A tag pushed with the workflow token starts no workflow; a dispatch does.
      for (const dispatch of dispatches) {
        const inputs = Object.entries(dispatch.inputs).flatMap(([name, value]) => ['-f', `${name}=${value}`]);
        run('gh', 'workflow', 'run', dispatch.workflow, '--repo', repo, '--ref', dispatch.ref, ...inputs);
      }
      say(values['managed-draft']
        ? `Started managed builds of ${plan.candidate} for ${plan.rcTag}, embedding ${plan.version}; draft upload only. Acceptance and promotion remain NOT_RUN.`
        : `Started build-mac and build-windows on ${plan.rcTag}; they run the automatic E2E and publish a prerelease.`);
    }
    if (step === 'branch') {
      run('git', 'checkout', '-q', '-B', plan.branch, plan.candidate);
      const record = path.join('releases', `${plan.version}.md`);
      fs.mkdirSync('releases', {recursive: true});
      fs.copyFileSync(prBodyFile, record);
      run('git', 'add', record);
      run('git', 'commit', '-q', '-m', `release: record ${plan.rcTag}`);
      // A later rc of the same version moves the branch to its own candidate.
      run('git', 'push', '-q', '--force', 'origin', `HEAD:refs/heads/${plan.branch}`);
      say(`Pushed ${plan.branch} with ${record}.`);
    }
    if (step === 'pr') {
      try { run('gh', 'label', 'create', 'release', '--repo', repo, '--color', '0E8A16', '--description', 'Weekly release PR (release-cut)'); } catch { /* exists */ }
      const open = JSON.parse(run('gh', 'pr', 'list', '--repo', repo, '--head', plan.branch, '--state', 'open', '--json', 'number,url'));
      const body = prBodyFile;
      if (open.length) {
        run('gh', 'pr', 'edit', String(open[0].number), '--repo', repo, '--body-file', body);
        run('gh', 'pr', 'comment', String(open[0].number), '--repo', repo, '--body',
          `New candidate ${plan.rcTag} at ${plan.candidate.slice(0, 8)}. Approvals given before this comment were for an earlier candidate; review again.`);
        say(`Updated ${open[0].url} for ${plan.rcTag}.`);
      } else {
        const url = run('gh', 'pr', 'create', '--repo', repo, '--base', 'main', '--head', plan.branch,
          '--title', plan.title, '--body-file', body, '--label', 'release');
        say(`Opened ${url}.`);
      }
    }
  }
  finish(summary);
}

function finish(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Release cut — create\n\n${lines.map(l => `- ${l}`).join('\n')}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === new URL(import.meta.url).pathname) await main();
