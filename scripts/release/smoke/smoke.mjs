#!/usr/bin/env node
// Release smoke runner (#1608).
// Runs every checks/*.mjs in name order. A new check is one new file that
// default-exports {id, name, run(ctx)} and returns {result, detail}.
//
//   node scripts/release/smoke/smoke.mjs --sha <candidate> [--out DIR]
//   node scripts/release/smoke/smoke.mjs --service-url https://example.invalid   # forced failure
//
// Verdict per check: PASS / FAIL / NOT_RUN. Overall: any FAIL → FAIL (exit 1),
// else any NOT_RUN → NOT_RUN (exit 2), else PASS (exit 0).
// Every check runs even after an earlier one fails, so one failure does not hide another.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

export async function runSmoke({sha, out, serviceUrl, chalkUrl, repo = 'hypeproof/hypeproof-studio', env = process.env}) {
  const ctx = {sha, repo, studioDir: root, serviceUrl, chalkUrl, env};
  const checkDir = path.join(here, 'checks');
  const files = fs.readdirSync(checkDir).filter(f => f.endsWith('.mjs')).sort();
  const checks = [];
  for (const file of files) {
    const check = (await import(pathToFileURL(path.join(checkDir, file)).href)).default;
    const started = Date.now();
    let result;
    try {
      result = await check.run(ctx);
    } catch (error) {
      result = {result: 'FAIL', detail: String(error?.message ?? error)};
    }
    checks.push({id: check.id, name: check.name, ...result, ms: Date.now() - started});
  }
  const overall = checks.some(c => c.result === 'FAIL') ? 'FAIL'
    : checks.some(c => c.result === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  const report = {
    schema: 'hps-smoke/0',
    candidate: {repo, sha},
    service_version: checks.find(c => c.id === 'S1')?.version ?? null,
    chalk_version: checks.find(c => c.id === 'S2')?.version ?? null,
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
    chalkUrl: arg('--chalk-url', 'https://chalk.hypeproof-ai.xyz'),
  });
  printSmoke(report);
  process.exit(exitCode(report.result));
}
