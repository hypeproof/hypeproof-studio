#!/usr/bin/env node
// Validates an hps-blackbox-run/1 result (docs/operations/release-casebook/results-schema.md).
//
//   node scripts/release/validate-blackbox-run.mjs run.json
//   node scripts/release/validate-blackbox-run.mjs comment.md --selected cases.json   # JSON inside the PR comment
//
// --selected (select-cases.mjs --out DIR → DIR/cases.json) also checks that every selected case has a
// row: a pre-test never skips a case silently. Exit 0 valid, 1 invalid, 2 usage.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

export const SCHEMA = 'hps-blackbox-run/1';
export const RESULTS = ['PASS', 'FAIL', 'BLOCKED'];
export const HOLD = '승인 보류 권장';
export const CLEAR = 'P0 실패 없음';
const SHA = /^[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// The JSON block of a pre-tester comment: the fenced ```json block that declares the schema.
export function extractRun(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const m of text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    if (m[1].includes(SCHEMA)) return JSON.parse(m[1]);
  }
  throw new Error(`no \`\`\`json block declaring ${SCHEMA}`);
}

export function validateRun(run, {selected} = {}) {
  const p = [];
  if (!run || typeof run !== 'object') return ['result is not an object'];
  if (run.schema !== SCHEMA) p.push(`schema must be ${SCHEMA}`);
  if (!Number.isInteger(run.pr) || run.pr <= 0) p.push('pr must be a positive integer');
  if (!SHA.test(run.head_sha ?? '')) p.push('head_sha must be the full 40-character head commit');
  if (!/^v\d+\.\d+\.\d+-rc\.\d+$/.test(run.rc_tag ?? '')) p.push('rc_tag must be an rc tag (vX.Y.Z-rc.N)');
  if (!['agent', 'human'].includes(run.tester?.kind)) p.push('tester.kind must be agent or human');
  if (!run.tester?.name) p.push('tester.name is required');
  for (const f of ['started_at', 'finished_at']) if (!ISO.test(run[f] ?? '')) p.push(`${f} must be an ISO 8601 time with a zone`);
  if (!Array.isArray(run.cases) || run.cases.length === 0) p.push('cases must list at least one case');
  const seen = new Set();
  let p0Fail = false;
  for (const c of run.cases ?? []) {
    const at = `case ${c?.id}`;
    if (!/^BB-\d{3}$/.test(c?.id ?? '')) p.push(`${at}: id must be BB-<nnn>`);
    if (seen.has(c.id)) p.push(`${at}: listed twice`);
    seen.add(c.id);
    if (!['P0', 'P1', 'P2'].includes(c.priority)) p.push(`${at}: priority must be P0, P1 or P2`);
    if (!RESULTS.includes(c.result)) p.push(`${at}: result must be PASS, FAIL or BLOCKED`);
    if (!Number.isInteger(c.attempts) || c.attempts < 1 || c.attempts > 2) p.push(`${at}: attempts must be 1 or 2`);
    if ((c.result === 'PASS' || c.result === 'FAIL') && !c.screenshot) p.push(`${at}: ${c.result} needs a screenshot`);
    if (c.result === 'FAIL' && c.attempts !== 2) p.push(`${at}: FAIL needs one retry from a clean profile (attempts 2)`);
    if (c.result !== 'PASS' && !c.note) p.push(`${at}: ${c.result} needs a note saying what was seen or what blocked it`);
    if (c.result === 'FAIL' && c.priority === 'P0') p0Fail = true;
  }
  if (run.p0_verdict !== HOLD && run.p0_verdict !== CLEAR) p.push(`p0_verdict must be "${HOLD}" or "${CLEAR}"`);
  else if (p0Fail && run.p0_verdict !== HOLD) p.push(`a P0 case failed, so p0_verdict must be "${HOLD}"`);
  else if (!p0Fail && run.p0_verdict === HOLD) p.push(`no P0 case failed, so p0_verdict must be "${CLEAR}"`);
  if (run.suggested_cases !== undefined) {
    if (!Array.isArray(run.suggested_cases)) p.push('suggested_cases must be a list');
    for (const s of run.suggested_cases ?? []) if (!s?.title || !s?.journey || !s?.why) p.push('suggested_cases entries need title, journey and why');
  }
  if (selected) {
    for (const c of selected.cases ?? []) if (!seen.has(c.id)) p.push(`selected case ${c.id} has no row (never skip silently; use BLOCKED with a note)`);
  }
  return p;
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--selected');
  if (!file) { console.error('usage: validate-blackbox-run.mjs <run.json|comment.md> [--selected cases.json]'); process.exit(2); }
  const si = args.indexOf('--selected');
  const selected = si >= 0 ? JSON.parse(fs.readFileSync(args[si + 1], 'utf8')) : undefined;
  let problems;
  try {
    problems = validateRun(extractRun(fs.readFileSync(file, 'utf8')), {selected});
  } catch (error) {
    problems = [error.message];
  }
  if (problems.length) {
    console.error(`invalid ${SCHEMA}:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`valid ${SCHEMA}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
