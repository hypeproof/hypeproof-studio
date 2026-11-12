#!/usr/bin/env node
// PR check `process / escaped-bug-case` (#3429): the escaped-bug rule of
// docs/operations/release-casebook/README.md ("유출 버그 규칙") as a machine check.
//
//   node scripts/release/escaped-bug-case.mjs --pr 3500 [--repo owner/name]
//
// A PR that closes an issue labelled `escaped-bug`, or `member-report` with kind bug
// (`bug` / `type:bug`, the same reading as the Service process sentinel), must add or change
// a case in cases.yaml whose
//   - origin.ref names the PR or the closed issue (#N), or
//   - automated_by names a test file this PR adds.
// Escape hatch: the label `no-casebook-needed` together with a body line
// `No casebook: <reason>`. Its use is logged (annotation + job summary).
// PRs are merged by a bot with no human reviewer, so this check is the reviewer.
// Exit 0 pass, 1 fail, 2 usage or lookup error (also red).
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseYaml} from './casebook.mjs';

export const CASEBOOK = 'docs/operations/release-casebook/cases.yaml';
export const ESCAPE_LABEL = 'no-casebook-needed';
export const RULE_URL = 'https://github.com/hypeproof/hypeproof-studio/blob/main/docs/operations/release-casebook/README.md#유출-버그-규칙';
const BUG_LABELS = ['bug', 'type:bug'];

// Issue numbers a PR body closes in its own repository: "Closes #12", "fixes: #3",
// "Resolves hypeproof/hypeproof-studio#4". References to another repository are ignored.
export function closingRefs(body = '', repo = '') {
  const out = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#(\d+))/gi;
  for (const m of String(body).matchAll(re)) {
    const full = m[1];
    if (full.includes('/') && full.split('#')[0].toLowerCase() !== repo.toLowerCase()) continue;
    out.add(Number(m[2]));
  }
  return [...out];
}

export function isEscaped(labels = []) {
  return labels.includes('escaped-bug') || (labels.includes('member-report') && labels.some(l => BUG_LABELS.includes(l)));
}

export function escapeReason(body = '') {
  const m = String(body).match(/^\s*No casebook:\s*(\S.*?)\s*$/im);
  return m && m[1].replace(/<!--.*?-->/g, '').trim().length >= 5 ? m[1].trim() : null;
}

// Cases that are new at head or differ from the merge base.
export function changedCases(baseCases = [], headCases = []) {
  const before = new Map(baseCases.map(c => [c.id, JSON.stringify(c)]));
  return headCases.filter(c => before.get(c.id) !== JSON.stringify(c));
}

const refNumbers = ref => [...String(ref ?? '').matchAll(/#(\d+)/g)].map(m => Number(m[1]));

// Pure decision. Every input is already fetched.
//   issues: [{number, labels, isPr}] closed by the PR; changed: changedCases(); addedFiles: paths the PR adds
export function decide({pr, body = '', labels = [], issues = [], changed = [], addedFiles = []}) {
  const escaped = issues.filter(i => !i.isPr && isEscaped(i.labels));
  if (!escaped.length) {
    return {ok: true, route: 'not-escaped', reasons: [issues.length
      ? `closes ${issues.map(i => `#${i.number}`).join(', ')}; none is labelled escaped-bug or member-report + bug`
      : 'closes no issue of this repository']};
  }
  const added = new Set(addedFiles);
  const missing = [];
  const hits = [];
  for (const issue of escaped) {
    const byRef = changed.filter(c => refNumbers(c.origin?.ref).some(n => n === issue.number || n === pr));
    const byTest = changed.filter(c => c.automated_by && added.has(String(c.automated_by).trim()));
    if (byRef.length) hits.push(`#${issue.number}: ${byRef.map(c => c.id).join(', ')} (origin.ref ${byRef.map(c => c.origin.ref).join(', ')})`);
    else if (byTest.length) hits.push(`#${issue.number}: ${byTest.map(c => c.id).join(', ')} (automated_by ${byTest.map(c => c.automated_by).join(', ')}, added here)`);
    else missing.push(issue.number);
  }
  if (!missing.length) return {ok: true, route: 'case', reasons: hits};
  if (labels.includes(ESCAPE_LABEL)) {
    const reason = escapeReason(body);
    if (reason) return {ok: true, route: 'escape-hatch', reasons: [`${ESCAPE_LABEL} on #${pr} for ${missing.map(n => `#${n}`).join(', ')}: ${reason}`]};
    return {ok: false, route: 'none', reasons: [`label ${ESCAPE_LABEL} needs a body line "No casebook: <reason>"`]};
  }
  return {ok: false, route: 'none', reasons: [
    `${missing.map(n => `#${n}`).join(', ')} ${missing.length > 1 ? 'are' : 'is an'} escaped bug${missing.length > 1 ? 's' : ''}, and ${CASEBOOK} has no added or changed case for ${missing.length > 1 ? 'them' : 'it'}.`,
    `유출 버그를 고치는 PR 은 ${CASEBOOK} 에 케이스를 추가하거나 고칩니다: origin.ref 에 "#${pr}" 또는 "#${missing[0]}" 를 적거나, 이 PR 이 추가하는 테스트 파일을 automated_by 에 적으세요.`,
    `An escaped-bug fix adds or changes a case whose origin.ref names #${pr} or the issue, or whose automated_by names a test file this PR adds.`,
    `Rule / 규칙: ${RULE_URL}`,
    `Escape hatch: label ${ESCAPE_LABEL} plus a body line "No casebook: <reason>" (logged).`,
  ]};
}

// --- GitHub lookups ----------------------------------------------------------------------

function gh(args, opts = {}) {
  return execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20, ...opts});
}
const api = path => JSON.parse(gh(['api', '--paginate', '--slurp', path])).flat();
const one = path => JSON.parse(gh(['api', path]));

function casesAt(repo, ref) {
  let text;
  try {
    text = gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${CASEBOOK}?ref=${ref}`]);
  } catch {
    return [];
  }
  return parseYaml(text, CASEBOOK)?.cases ?? [];
}

export function gather({repo, pr}) {
  const p = one(`repos/${repo}/pulls/${pr}`);
  const [owner, name] = repo.split('/');
  const query = 'query($o:String!,$n:String!,$pr:Int!){repository(owner:$o,name:$n){pullRequest(number:$pr){closingIssuesReferences(first:50){nodes{number repository{nameWithOwner}}}}}}';
  const linked = JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`, '-F', `o=${owner}`, '-F', `n=${name}`, '-F', `pr=${pr}`]))
    .data.repository.pullRequest.closingIssuesReferences.nodes
    .filter(n => n.repository.nameWithOwner.toLowerCase() === repo.toLowerCase()).map(n => n.number);
  const numbers = [...new Set([...closingRefs(p.body ?? '', repo), ...linked])].filter(n => n !== pr);
  const issues = numbers.map(n => {
    const i = one(`repos/${repo}/issues/${n}`);
    return {number: n, labels: i.labels.map(l => l.name), isPr: Boolean(i.pull_request)};
  });
  const files = api(`repos/${repo}/pulls/${pr}/files?per_page=100`);
  const addedFiles = files.filter(f => f.status === 'added').map(f => f.filename);
  let changed = [];
  if (files.some(f => f.filename === CASEBOOK)) {
    const mergeBase = one(`repos/${repo}/compare/${p.base.sha}...${p.head.sha}`).merge_base_commit.sha;
    changed = changedCases(casesAt(repo, mergeBase), casesAt(repo, p.head.sha));
  }
  return {pr, body: p.body ?? '', labels: p.labels.map(l => l.name), issues, changed, addedFiles};
}

function main() {
  const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : fallback; };
  const pr = Number(arg('--pr', process.env.PR_NUMBER));
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY ?? 'hypeproof/hypeproof-studio');
  if (!Number.isInteger(pr) || pr <= 0) { console.error('usage: escaped-bug-case.mjs --pr <number> [--repo owner/name]'); process.exit(2); }
  let verdict;
  try {
    verdict = decide(gather({repo, pr}));
  } catch (error) {
    verdict = {ok: false, route: 'error', reasons: [`lookup failed: ${String(error.message).split('\n')[0]}`], code: 2};
  }
  const text = [`## process / escaped-bug-case — #${pr}`, '', `**${verdict.ok ? 'PASS' : 'FAIL'}** (${verdict.route})`, '',
    ...verdict.reasons.map(r => `- ${r}`), ''].join('\n');
  console.log(text);
  if (verdict.route === 'escape-hatch') console.log(`::notice title=${ESCAPE_LABEL} used::${verdict.reasons[0]}`);
  if (!verdict.ok) console.log(`::error title=escaped-bug rule (유출 버그 규칙)::${verdict.reasons[0]} ${RULE_URL}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exit(verdict.ok ? 0 : (verdict.code ?? 1));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
