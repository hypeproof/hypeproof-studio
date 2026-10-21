#!/usr/bin/env node
// Release smoke runner (#1608).
// Runs read-only checks first (S1, S5), then session-opening checks (S3, S4), then the rest.
// A new check is one new file that default-exports {id, name, run(ctx)} and returns {result, detail}.
//
//   node scripts/release/smoke/smoke.mjs --sha <candidate> [--out DIR]
//   node scripts/release/smoke/smoke.mjs --service-url https://example.invalid   # forced failure
//
// Verdict per check: PASS / FAIL / NOT_RUN. Overall: any FAIL → FAIL (exit 1),
// else any NOT_RUN → NOT_RUN (exit 2), else PASS (exit 0).
// If S1 or S5 fails, S3 and S4 are marked NOT_RUN and do not open a session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

// S1 and S5 are read-only and must pass before session-opening checks run.
const READ_ONLY_FIRST = new Set(['S1', 'S5']);
const SESSION_CHECKS = new Set(['S3', 'S4']);
const SKIP_TRIGGERS = new Set(['S1', 'S5']);

function phaseOf(id) {
  return READ_ONLY_FIRST.has(id) ? 0 : SESSION_CHECKS.has(id) ? 1 : 2;
}

// Exported so tests can inject stub check objects without file I/O.
export async function runSmokeChecks(checkModules, ctx) {
  const sorted = [...checkModules].sort((a, b) => phaseOf(a.id) - phaseOf(b.id));
  const results = [];
  const failedTriggers = [];
  for (const check of sorted) {
    if (SESSION_CHECKS.has(check.id) && failedTriggers.length > 0) {
      results.push({id: check.id, name: check.name, result: 'NOT_RUN', detail: `skipped: ${failedTriggers[0]} failed`, ms: 0});
      continue;
    }
    const started = Date.now();
    let result;
    try {
      result = await check.run(ctx);
    } catch (error) {
      result = {result: 'FAIL', detail: String(error?.message ?? error)};
    }
    results.push({id: check.id, name: check.name, ...result, ms: Date.now() - started});
    if (SKIP_TRIGGERS.has(check.id) && result.result === 'FAIL') failedTriggers.push(check.id);
  }
  return results;
}

export async function runSmoke({sha, out, serviceUrl, repo = 'hypeproof/hypeproof-studio', env = process.env}) {
  const ctx = {sha, repo, studioDir: root, serviceUrl, env};
  const checkDir = path.join(here, 'checks');
  const files = fs.readdirSync(checkDir).filter(f => f.endsWith('.mjs')).sort();
  const checkModules = [];
  for (const file of files) {
    checkModules.push((await import(pathToFileURL(path.join(checkDir, file)).href)).default);
  }
  const checks = await runSmokeChecks(checkModules, ctx);
  const overall = checks.some(c => c.result === 'FAIL') ? 'FAIL'
    : checks.some(c => c.result === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  const report = {
    schema: 'hps-smoke/0',
    candidate: {repo, sha},
    service_version: checks.find(c => c.id === 'S1')?.version ?? null,
    result: overall,
    checks,
    finished_at: new Date().toISOString(),
  };
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'smoke.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

export function printSmoke(report) {
  console.log(`\ncandidate ${report.candidate.repo} @ ${report.candidate.sha.slice(0, 8)}\n`);
  for (const c of report.checks) {
    console.log(`${c.result.padEnd(8)} ${c.id}  ${c.name.padEnd(20)} ${String(c.ms).padStart(6)}ms  ${c.detail}`);
  }
  console.log(`\noverall: ${report.result}\n`);
}

export const exitCode = result => (result === 'PASS' ? 0 : result === 'FAIL' ? 1 : 2);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const sha = arg('--sha', null) ?? execFileSync('git', ['-C', root, 'rev-parse', 'origin/main'], {encoding: 'utf8'}).trim();
  const report = await runSmoke({
    sha,
    out: arg('--out', path.join(os.tmpdir(), 'hps-release-cut')),
    serviceUrl: arg('--service-url', 'https://api.hypeproof-ai.xyz'),
  });
  printSmoke(report);
  process.exit(exitCode(report.result));
}
