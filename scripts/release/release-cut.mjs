#!/usr/bin/env node
// Release cut (#1608). Computes and writes what a release creates, plus plan.json; creates nothing on
// GitHub itself. scripts/release/create.mjs reads plan.json and creates it (release-cut.yml, mode=create).
//
//   node scripts/release/release-cut.mjs                         # candidate = origin/main
//   node scripts/release/release-cut.mjs --candidate v0.1.56     # skip case (no commits)
//   node scripts/release/release-cut.mjs --service-url https://example.invalid   # smoke failure case
//   node scripts/release/release-cut.mjs --since "7 days ago"    # trial: pretend the last release was a week ago
//   node scripts/release/release-cut.mjs --mode create           # body without the DRY-RUN banner
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
import {nextRcTag, versionFor} from './version.mjs';
import {oneLiner} from './install-kit.mjs';
import {run as selectCases} from './select-cases.mjs';

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

// 4. Date version (version.mjs). A second cut on the same day gets the next rc number of the same
// version until that version is released; after that the day's next version.
const day = arg('--date', new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'}));
const allTags = git('tag', '-l', 'v*').split('\n').filter(Boolean);
const version = versionFor(day, allTags.filter(t => !t.includes('-')));
const rcTag = nextRcTag(version, allTags);
const branch = `release/${version}`;
const mode = arg('--mode', 'dry-run');
const trial = Boolean(arg('--since'));

// 5. Smoke on the candidate.
console.log(`[4] smoke on ${short}`);
const smoke = await runSmoke({
  sha: candidate, out,
  serviceUrl: arg('--service-url', 'https://api.hypeproof-ai.xyz'),
});
printSmoke(smoke);
const smokeRows = smoke.checks.map(c => `| ${c.id} ${c.name} | ${c.result} | ${String(c.detail).replace(/\|/g, '\\|')} |`).join('\n');

// 6. PRs in range.
console.log(`[5] reading ${prNumbers.length} PRs`);
const {groups, authors} = classify(fetchPrs(REPO, prNumbers));
const rendered = render({groups});

// 7. Black-box cases for the release manager (docs/operations/release-casebook/README.md).
// A broken casebook does not stop the cut; the PR body says so and the manager runs every P0 case.
let cases = {markdown: '', json: null};
let changedRequirements = '';
try {
  cases = selectCases({root, baseline, candidate, today: day, out});
  changedRequirements = cases.json.touched_requirements.length
    ? cases.json.touched_requirements.map(id => `\`${id}\``).join(' ')
    : 'None found in commit messages or requirement-doc diffs.';
  console.log(`[6] black-box cases: ${cases.json.cases.length} selected, ${cases.json.touched_requirements.length} requirement ids touched`);
} catch (error) {
  console.log(`[6] black-box case selection failed: ${error.message}`);
  cases.markdown = `> **케이스 선택 실패** — \`${String(error.message).split('\n')[0]}\`. 릴리스 관리자는 \`docs/operations/release-casebook/cases.yaml\` 의 P0 케이스를 모두 실행합니다.`;
  changedRequirements = '_not computed: case selection failed_';
}

const fill = (name, values) => fs.readFileSync(path.join(here, 'templates', name), 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? `{{${k}}}`);
const common = {
  DRY_RUN_BANNER: mode === 'create' ? '' : `> **DRY-RUN** — generated ${new Date().toISOString()}. Nothing was created.\n`,
  VERSION: version, CANDIDATE_SHA: candidate, CANDIDATE_SHORT: short, BASELINE: baseline,
  PR_COUNT: String(prNumbers.length) + (withoutPr ? ` (+${withoutPr} commits without a PR number)` : ''),
  SMOKE_ROWS: smokeRows, RELEASE_MANAGER: 'any member with write access; the team decides who checks this week',
};
const plan = {
  schema: 'hps-release-plan/0', mode, trial, version, rcTag, branch, candidate, baseline,
  smoke: smoke.result, title: `release: ${version}`, prBody: null, issueBody: null,
  issueTitle: `Smoke failed — release ${version} stopped`,
};
const writePlan = () => fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));

// 8. Branch on the smoke verdict.
if (smoke.result === 'FAIL') {
  fs.writeFileSync(path.join(out, 'smoke-failure-issue.md'), fill('smoke-failure-issue.md', {
    ...common, AUTHORS: authors.map(a => `- @${a}`).join('\n') || 'None.',
  }));
  plan.issueBody = 'smoke-failure-issue.md';
  writePlan();
  console.log(`\n→ smoke FAIL. A real cut would create:`);
  console.log(`   · issue "smoke failed — release ${version} stopped"  (${path.join(out, 'smoke-failure-issue.md')})`);
  console.log(`   · a Discord notification`);
  console.log(`   · no rc tag and no release PR\n`);
  process.exit(1);
}

fs.writeFileSync(path.join(out, 'release-pr.md'), fill('release-pr.md', {
  ...common,
  RC_TAG: rcTag, FINAL_TAG: version,
  INSTALL_ONELINER: oneLiner(rcTag),
  BLACKBOX_CASES: cases.markdown, CHANGED_REQUIREMENTS: changedRequirements,
  RC_BUILD_LINK: `https://github.com/${REPO}/releases/tag/${rcTag}`,
  SERVICE_VERSION: smoke.service_version ?? 'unknown',
  SMOKE_RESULT: smoke.result,
  DEPENDENCY_ITEMS: rendered.dependency, FEATURE_ITEMS: rendered.features, AUTOMATIC_ITEMS: rendered.automatic,
  SMOKE_MISSING: 'No baseline commit for smoke declarations yet. Listed from the baseline onward.',
  ROLLBACK: 'Turn the broken release back into a draft or prerelease so no new download gets it, revert the cause on main, and ship the fix through the hotfix route.',
}));
plan.prBody = 'release-pr.md';
writePlan();

console.log(`\n→ smoke ${smoke.result}. A real cut would create:`);
if (smoke.result !== 'PASS') console.log('   ⚠ a check is NOT_RUN. A real cut stops here; the rest is a preview.');
console.log(`   · tag ${rcTag} on ${short} (starts the configured platform builds and the automatic E2E)`);
console.log(`   · branch ${branch} adding releases/${version}.md`);
console.log(`   · release PR "${plan.title}"  (${path.join(out, 'release-pr.md')})`);
console.log(`     ${groups.features.length} feature checks · ${groups.dependency.length} dependency/deploy · ${groups.automatic.length} automatic\n`);
process.exit(exitCode(smoke.result));
