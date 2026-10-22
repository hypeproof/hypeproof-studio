#!/usr/bin/env node
// Selects the black-box cases a release candidate must run (REQ-STUDIO-RELEASE-CASEBOOK).
// Process: docs/operations/release-casebook/README.md.
//
//   node scripts/release/select-cases.mjs                                  # last stable v tag..origin/main
//   node scripts/release/select-cases.mjs --baseline v2026.1020.1 --candidate origin/main
//   node scripts/release/select-cases.mjs --out DIR                        # writes DIR/cases.md and DIR/cases.json
//   node scripts/release/select-cases.mjs --today 2026-10-20               # fixes the escaped-bug window
//   node scripts/release/select-cases.mjs --pr 2210 --json                 # range from a release PR body
//
// A case is selected when any of these holds (reasons are recorded per case):
//   p0        its priority is P0 (every journey)
//   touched   it links a requirement id that the range touched: an id in a commit subject or body
//             (squash merges carry the PR title and body), or on a changed line of a requirement doc
//   escaped   its origin is escaped-bug dated within the last 14 days
// A case marked 자동화됨 is never selected: CI runs it.
// The range is read from local git. The only GitHub call is `gh pr view` under --pr.
// --pr takes "Candidate commit" and "Range" from the release PR body (templates/release-pr.md, section 1).
// It cannot be combined with --baseline or --candidate. Unknown options and bad values stop the run.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {REQ_ID, loadCasebook} from './casebook.mjs';

export const ESCAPED_WINDOW_DAYS = 14;
export const REQUIREMENT_DOCS = ['docs/studio-requirements.md', 'docs/requirements/', 'docs/dev/04-requirements.md'];

// Requirement ids mentioned in a piece of text, deduplicated, in order of appearance.
export function requirementIds(text = '') {
  return [...new Set(text.match(REQ_ID) ?? [])];
}

// Ids on added or removed lines of a unified diff (context lines and headers do not count).
export function idsFromDiff(diff = '') {
  const changed = diff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)( |$)/.test(l));
  return requirementIds(changed.join('\n'));
}

// A touched id reaches a case when it is the case's id or a child of it
// (touched REQ-L12-14 reaches a case linking REQ-L12). A parent never reaches a child.
export function linkedTouched(caseIds, touched) {
  const set = touched instanceof Set ? touched : new Set(touched);
  return caseIds.filter(id => set.has(id) || [...set].some(t => t.startsWith(`${id}-`)));
}

const DAY = 86_400_000;
export function isRecentEscape(c, today, days = ESCAPED_WINDOW_DAYS) {
  if (c.origin?.kind !== 'escaped-bug' || !c.origin.date) return false;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${c.origin.date}T00:00:00Z`)) / DAY;
  return age >= 0 && age < days;
}

export function selectCases({cases}, {touched = [], today}) {
  if (!today) throw new Error('today is required');
  const touchedSet = new Set(touched);
  const selected = [];
  for (const c of cases) {
    if (c.status === '자동화됨') continue;
    const reasons = [];
    if (c.priority === 'P0') reasons.push('p0');
    const hit = linkedTouched(c.requirements ?? [], touchedSet);
    if (hit.length) reasons.push(`touched:${hit.join(',')}`);
    if (isRecentEscape(c, today)) reasons.push(`escaped:${c.origin.date}`);
    if (reasons.length) selected.push({...c, reasons});
  }
  return selected;
}

const REASON_LABEL = r => r === 'p0' ? 'P0' : r.startsWith('touched:') ? `변경 ${r.slice(8)}` : `유출 버그 ${r.slice(8)}`;

export function renderMarkdown({journeys}, selected, {touched = [], baseline, candidate} = {}) {
  const lines = [];
  const p0 = selected.filter(c => c.priority === 'P0').length;
  lines.push(`블랙박스 케이스 ${selected.length}건 (P0 ${p0}건) — \`docs/operations/release-casebook/\`. P0 하나라도 FAIL 이면 승인하지 않습니다.`);
  if (baseline || candidate) lines.push(`범위 \`${baseline ?? '?'}..${candidate ?? '?'}\``);
  lines.push('');
  for (const j of journeys) {
    const mine = selected.filter(c => c.journey === j.id);
    if (!mine.length) continue;
    lines.push(`**${j.id} ${j.title}**`, '');
    for (const c of mine) {
      const why = c.reasons.map(REASON_LABEL).join(' · ');
      lines.push(`- [ ] **${c.id}** ${c.priority} ${c.title} — _${why}_ — PASS / FAIL / BLOCKED`);
    }
    lines.push('');
  }
  lines.push('<details><summary>이번 범위에서 바뀐 요구사항</summary>', '');
  lines.push(touched.length ? touched.map(t => `\`${t}\``).join(' ') : '없음 (커밋 본문과 요구사항 문서 diff 에서 찾은 id 기준)');
  lines.push('', '</details>');
  return lines.join('\n');
}

export function renderJson(selected, {touched = [], baseline, candidate, today}) {
  return {
    schema: 'hps-release-cases/1', baseline: baseline ?? null, candidate: candidate ?? null, today,
    touched_requirements: touched,
    cases: selected.map(c => ({id: c.id, journey: c.journey, priority: c.priority, title: c.title,
      requirements: c.requirements, reasons: c.reasons})),
  };
}

// Requirement ids the range touched, from local git only.
export function touchedRequirements(git, baseline, candidate) {
  const range = `${baseline}..${candidate}`;
  const log = git('log', '--format=%s%n%b', range);
  const diff = git('diff', '--unified=0', range, '--', ...REQUIREMENT_DOCS);
  return [...new Set([...requirementIds(log), ...idsFromDiff(diff)])].sort();
}

export function lastStableTag(git) {
  return git('tag', '-l', 'v*', '--sort=-v:refname').split('\n').find(t => t && !t.includes('-')) ?? null;
}

export function run({root, baseline, candidate = 'origin/main', today, out, dir}) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).trim();
  const base = baseline ?? lastStableTag(git);
  if (!base) throw new Error('no stable v tag to compare against; pass --baseline');
  const cand = git('rev-parse', `${candidate}^{commit}`);
  const touched = touchedRequirements(git, base, cand);
  const book = loadCasebook(dir);
  const day = today ?? new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'});
  const selected = selectCases(book, {touched, today: day});
  const meta = {touched, baseline: base, candidate: cand.slice(0, 8), today: day};
  const markdown = renderMarkdown(book, selected, meta);
  const json = renderJson(selected, meta);
  if (out) {
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'cases.md'), `${markdown}\n`);
    fs.writeFileSync(path.join(out, 'cases.json'), `${JSON.stringify(json, null, 2)}\n`);
  }
  return {markdown, json};
}

export const RELEASE_REPO = 'hypeproof/hypeproof-studio';

// Candidate commit and baseline of a release PR body: section 1 of templates/release-pr.md.
// Any other shape throws. Nothing falls back to a default range.
export function parseReleasePrBody(body = '') {
  const cand = body.match(/^\|\s*Candidate commit\s*\|\s*`([0-9a-f]{40})`\s*\|/m);
  if (!cand) throw new Error('release PR body has no "Candidate commit" row with a full 40-character sha');
  // A tag name: dot-separated segments, no "..", no trailing dot.
  const range = body.match(/^\|\s*Range\s*\|\s*`(\w[\w-]*(?:\.[\w-]+)*)\.\.([0-9a-f]{7,40})`/m);
  if (!range) throw new Error('release PR body has no "Range" row of the form `<baseline>..<candidate>`');
  const [, baseline, shortSha] = range;
  const candidate = cand[1];
  if (!candidate.startsWith(shortSha)) throw new Error(`release PR Range ${shortSha} does not match Candidate commit ${candidate}`);
  return {baseline, candidate};
}

const CLI_OPTIONS = {
  pr: {type: 'string'}, baseline: {type: 'string'}, candidate: {type: 'string'},
  today: {type: 'string'}, out: {type: 'string'}, json: {type: 'boolean'},
};

// Strict: an unknown option, a stray argument or a missing value throws instead of being ignored.
export function parseCliArgs(argv) {
  const {values} = parseArgs({args: argv, options: CLI_OPTIONS, strict: true, allowPositionals: false});
  if (values.pr !== undefined) {
    if (!/^[1-9]\d*$/.test(values.pr)) throw new Error(`--pr needs a PR number, got "${values.pr}"`);
    if (values.baseline !== undefined || values.candidate !== undefined) {
      throw new Error('--pr already sets --baseline and --candidate; do not pass them together');
    }
  }
  return {...values};
}

// The only gh call in this script. It is injectable so tests stay offline.
export function ghReleasePrBody(pr, exec = execFileSync) {
  return exec('gh', ['pr', 'view', String(pr), '--repo', RELEASE_REPO, '--json', 'body', '--jq', '.body'],
    {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
}

export function rangeForPr(pr, fetchBody = ghReleasePrBody) {
  return parseReleasePrBody(fetchBody(pr));
}

function main() {
  try {
    const opts = parseCliArgs(process.argv.slice(2));
    const range = opts.pr !== undefined ? rangeForPr(opts.pr) : {baseline: opts.baseline, candidate: opts.candidate};
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const {markdown, json} = run({root, ...range, today: opts.today, out: opts.out});
    if (opts.json) console.log(JSON.stringify(json, null, 2));
    else console.log(markdown);
  } catch (e) {
    console.error(`select-cases: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
