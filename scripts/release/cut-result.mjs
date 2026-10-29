// Distinguish a completed smoke verdict from an infrastructure crash (#3177).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function cutResult({code, mode, directory}) {
  if (![0, 1, 2].includes(code)) throw Error(`Release cut exited unexpectedly (${code})`);
  const file = path.join(directory, 'plan.json');
  if (!fs.existsSync(file)) {
    if (code === 0) {
      const skip = JSON.parse(fs.readFileSync(path.join(directory, 'skipped.json'), 'utf8'));
      if (skip.schema === 'hps-release-skip/1' && skip.reason === 'no-commits' &&
          /^[a-f0-9]{40}$/.test(skip.candidate) && typeof skip.baseline === 'string' && skip.baseline) return 'skipped';
    }
    throw Error(`Release cut exited ${code} without a plan`);
  }
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const verdict = ['PASS', 'FAIL', 'NOT_RUN'][code];
  if (plan.schema !== 'hps-release-plan/0' || plan.mode !== mode || plan.smoke !== verdict) {
    throw Error(`Release cut exit ${code} does not match its plan`);
  }
  const body = code === 1 ? 'smoke-failure-issue.md' : 'release-pr.md';
  if (plan[code === 1 ? 'issueBody' : 'prBody'] !== body ||
      !fs.readFileSync(path.join(directory, body), 'utf8').trim()) {
    throw Error('Release cut plan has no complete result body');
  }
  if (code === 1 && mode !== 'create') throw Error('Release smoke failed');
  return 'planned';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = cutResult({code: Number(process.argv[2]), mode: process.argv[3], directory: process.argv[4]});
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`);
    console.log(`Release cut result: ${result}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
