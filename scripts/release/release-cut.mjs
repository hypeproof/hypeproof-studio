#!/usr/bin/env node
// Release cut, dry-run only (#1608). Writes what a release would create; creates nothing on GitHub.
//
//   node scripts/release/release-cut.mjs                         # candidate = origin/main
//   node scripts/release/release-cut.mjs --candidate v0.1.56     # skip case (no commits)
//   node scripts/release/release-cut.mjs --service-url https://example.invalid   # smoke failure case
//   node scripts/release/release-cut.mjs --since "7 days ago"    # trial: pretend the last release was a week ago
//
// Steps: baseline (last stable v tag) → candidate → range → smoke → failure issue body | rc tag + release PR body.
// Exit: 0 PASS or skipped, 1 smoke FAIL, 2 smoke NOT_RUN (a real cut would stop there).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {classify, fetchPrs, render} from './checklist.mjs';
import {exitCode, printSmoke, runSmoke} from './smoke/smoke.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const REPO = 'hypeproof/hypeproof-studio';
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const git = (...a) => execFileSync('git', ['-C', root, ...a], {encoding: 'utf8'}).trim();
const out = path.resolve(arg('--out', path.join(os.tmpdir(), 'hps-release-cut')));
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});

// 1. Baseline: the last stable v tag. Tags with a suffix (-rc.N) are candidates, not releases.
if (!args.includes('--no-fetch')) git('fetch', '-q', 'origin', 'main', '--tags');
let baseline = git('tag', '-l', 'v*', '--sort=-v:refname').split('\n').find(t => t && !t.includes('-'));
if (arg('--since')) {
  const base = git('rev-list', '-1', `--before=${arg('--since')}`, 'origin/main');
  console.log(`(trial) baseline replaced by the last main commit before "${arg('--since')}": ${git('log', '-1', '--format=%h %ci %s', base)}`);
  baseline = base.slice(0, 8);
}

// 2. Candidate: fixed at cut time. Later merges go to the next cycle.
const candidate = git('rev-parse', `${arg('--candidate', 'origin/main')}^{commit}`);
const short = candidate.slice(0, 8);

// 3. Range. PR numbers come from squash-merge subjects "... (#N)". Never search PRs by date:
// the tag time (KST) and a date search (UTC) disagree and drop PRs.
const subjects = git('log', '--format=%s', `${baseline}..${candidate}`).split('\n').filter(Boolean);
console.log(`\n[1] baseline ${baseline}  [2] candidate ${short}  [3] range ${subjects.length} commits`);
if (subjects.length === 0) {
  console.log('\n→ no commits since the baseline. Skip this cycle (no tag, PR or issue).\n');
  process.exit(0);
}
const prNumbers = subjects.map(s => s.match(/\(#(\d+)\)$/)?.[1]).filter(Boolean).map(Number);
const withoutPr = subjects.length - prNumbers.length;

// 4. Date version. A second cut on the same day gets the next rc number.
const day = arg('--date', new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'}));
const [y, m, d] = day.split('-').map(Number);
const version = `v${y}.${m}.${d}`;
const rcTag = `${version}-rc.${git('tag', '-l', `${version}-rc.*`).split('\n').filter(Boolean).length + 1}`;

// 5. Smoke on the candidate.
console.log(`[4] smoke on ${short}`);
const smoke = await runSmoke({
  sha: candidate, out,
  serviceUrl: arg('--service-url', 'https://api.hypeproof-ai.xyz'),
  chalkUrl: arg('--chalk-url', 'https://chalk.hypeproof-ai.xyz'),
});
printSmoke(smoke);
const smokeRows = smoke.checks.map(c => `| ${c.id} ${c.name} | ${c.result} | ${String(c.detail).replace(/\|/g, '\\|')} |`).join('\n');

// 6. PRs in range.
console.log(`[5] reading ${prNumbers.length} PRs`);
const {groups, authors} = classify(fetchPrs(REPO, prNumbers));
const rendered = render({groups});

const fill = (name, values) => fs.readFileSync(path.join(here, 'templates', name), 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);
const common = {
  DRY_RUN_BANNER: `> **DRY-RUN** — generated ${new Date().toISOString()}. Nothing was created.\n`,
  VERSION: version, CANDIDATE_SHA: candidate, CANDIDATE_SHORT: short, BASELINE: baseline,
  PR_COUNT: String(prNumbers.length) + (withoutPr ? ` (+${withoutPr} commits without a PR number)` : ''),
  SMOKE_ROWS: smokeRows, RELEASE_MANAGER: '(assignment not decided yet)',
};

// 7. Branch on the smoke verdict.
if (smoke.result === 'FAIL') {
  fs.writeFileSync(path.join(out, 'smoke-failure-issue.md'), fill('smoke-failure-issue.md', {
    ...common, AUTHORS: authors.map(a => `- @${a}`).join('\n') || 'None.',
  }));
  console.log(`\n→ smoke FAIL. A real cut would create:`);
  console.log(`   · issue "smoke failed — release ${version} stopped"  (${path.join(out, 'smoke-failure-issue.md')})`);
  console.log(`   · a Discord notification`);
  console.log(`   · no rc tag and no release PR\n`);
  process.exit(1);
}

fs.writeFileSync(path.join(out, 'release-pr.md'), fill('release-pr.md', {
  ...common,
  RC_TAG: rcTag, FINAL_TAG: version,
  RC_BUILD_LINK: '(prerelease link, created when the rc tag is pushed)',
  SERVICE_VERSION: smoke.service_version ?? 'unknown', CHALK_VERSION: smoke.chalk_version ?? 'unknown',
  SMOKE_RESULT: smoke.result,
  DEPENDENCY_ITEMS: rendered.dependency, FEATURE_ITEMS: rendered.features, AUTOMATIC_ITEMS: rendered.automatic,
  SMOKE_MISSING: 'No baseline commit for smoke declarations yet. Listed from the baseline onward.',
  ROLLBACK: 'Not decided yet. Until it is, a broken release is replaced by the next version as a hotfix.',
}));

console.log(`\n→ smoke ${smoke.result}. A real cut would create:`);
if (smoke.result !== 'PASS') console.log('   ⚠ a check is NOT_RUN. A real cut stops here; the rest is a preview.');
console.log(`   · tag ${rcTag} on ${short} (starts build-mac, build-windows and the automatic E2E)`);
console.log(`   · branch release/${day} adding releases/${day}.md`);
console.log(`   · release PR "release: ${version}"  (${path.join(out, 'release-pr.md')})`);
console.log(`     ${groups.features.length} feature checks · ${groups.dependency.length} dependency/deploy · ${groups.automatic.length} automatic\n`);
process.exit(exitCode(smoke.result));
