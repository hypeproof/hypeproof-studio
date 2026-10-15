import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function candidateService(directory, pin) {
  if (pin.repository !== 'hypeproof/hypeproof-service' || !/^[a-f0-9]{40}$/.test(pin.sha)) throw Error('Invalid deployment Service pin');
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== pin.sha || git('status', '--porcelain', '--untracked-files=no')) throw Error('Candidate Service must be clean and match the deployment pin');
  const files = git('ls-files', 'worker/src', 'worker/test', 'worker/migrations', 'worker/schema.sql', 'worker/wrangler.toml').split('\n').filter(Boolean).sort();
  if (!files.includes('worker/src/index.ts') || !files.includes('worker/test/native-trial-live-server.mjs')) throw Error('Incomplete candidate Service checkout');
  const hash = createHash('sha256');
  for (const name of files) hash.update(name + '\0').update(fs.readFileSync(path.join(directory, name)));
  return {
    loader: path.resolve(directory, 'worker/test/harness/loader.mjs'),
    gateway: path.resolve(directory, 'worker/test/native-trial-live-server.mjs'),
    manifest: { repository: pin.repository, commit: pin.sha, source_files: files, source_sha256: hash.digest('hex'), scope: 'Clean pinned deployment Service checkout; synthetic bindings, real upstream.' },
  };
}

export function redactEvidence(text, secrets) {
  let result = text;
  for (const secret of secrets.filter(Boolean).sort((a,b) => b.length-a.length)) result = result.split(secret).join('[REDACTED]');
  return result.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').replace(/sk-ant-[\w-]+/g, '[REDACTED]');
}

export function assertServiceActivity(result, api) {
  const { calls } = api;
  if (api.request_limit !== 12 || !Number.isInteger(api.attempts) || !Array.isArray(calls) || api.attempts !== calls.length || api.attempts > 12 || !Array.isArray(api.failures) || api.failures.length) throw Error('Candidate Service budget or transport failure');
  if (result.status !== 'PASS' || result.initial_file_created !== true || result.revised_file_created !== true || result.original_preserved !== true || !calls.length || calls.some(call => call.status !== 200)) throw Error('Service compatibility acceptance failed');
}
