#!/usr/bin/env node
// Release blockers: an open issue labeled `release-blocker` in Studio, Service or Lab stops the release.
//
//   node scripts/release/release-blockers.mjs check     exit 0 none, 1 blockers (listed), 2 not readable
//
// create.mjs (release-cut, mode=create) checks before the rc tag; promote.mjs (release-promote) checks
// before the v tag. A blocker list that cannot be read in full refuses too (fail closed): Service and Lab are
// private, so the workflows pass RELEASE_BLOCKER_TOKEN, an org bot App token for the three repositories.
// Raise a blocker with Harness scripts/release/flag-blocker.sh; close the issue when it is fixed.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

export const BLOCKER_LABEL = 'release-blocker';
export const BLOCKER_REPOS = ['hypeproof/hypeproof-studio', 'hypeproof/hypeproof-service', 'hypeproof/hypeprooflab'];

// Pure decision. results: [{repo, issues: [{number, title, url}]} | {repo, error}]
export function blockerDecision(results) {
  const reasons = [];
  const read = new Set(results.filter(r => !r.error).map(r => r.repo));
  for (const repo of BLOCKER_REPOS) {
    const r = results.find(x => x.repo === repo);
    if (!r || r.error) reasons.push(`cannot read ${BLOCKER_LABEL} issues in ${repo}${r?.error ? ` (${r.error})` : ''}; refusing (fail closed)`);
  }
  const blockers = results.filter(r => read.has(r.repo)).flatMap(r => (r.issues ?? []).map(i => ({...i, repo: r.repo})));
  for (const b of blockers) reasons.push(`open ${BLOCKER_LABEL}: ${b.url} — ${b.title}`);
  return {allow: reasons.length === 0, blockers, reasons};
}

// Reads open issues (not PRs) with the label. `gh issue list` never returns pull requests.
export function readBlockers({env = process.env, run = execFileSync} = {}) {
  const token = env.RELEASE_BLOCKER_TOKEN || env.GH_TOKEN;
  return BLOCKER_REPOS.map(repo => {
    if (!token) return {repo, error: 'no RELEASE_BLOCKER_TOKEN or GH_TOKEN'};
    try {
      const out = run('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--label', BLOCKER_LABEL,
        '--limit', '200', '--json', 'number,title,url'],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {...env, GH_TOKEN: token}});
      const issues = JSON.parse(out);
      if (!Array.isArray(issues)) return {repo, error: 'unexpected answer'};
      return {repo, issues};
    } catch (error) {
      return {repo, error: String(error.stderr || error.message).trim().split('\n')[0].slice(0, 200)};
    }
  });
}

export function checkBlockers(opts) {
  return blockerDecision(readBlockers(opts));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (process.argv[2] !== 'check') { console.error('usage: release-blockers.mjs check'); process.exit(2); }
  const verdict = checkBlockers();
  if (verdict.allow) { console.log(`No open ${BLOCKER_LABEL} issue in ${BLOCKER_REPOS.join(', ')}.`); process.exit(0); }
  verdict.reasons.forEach(r => console.log(r));
  process.exit(verdict.blockers.length ? 1 : 2);
}
