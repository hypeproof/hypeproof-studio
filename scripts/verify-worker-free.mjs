// Worker separation acceptance gate. Copies consumer files only; all Service
// reference implementation comes from a pinned public package, never siblings.
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isolated = mkdtempSync(join(tmpdir(), 'hypeproof-studio-worker-free-'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const relative of new Set(files)) {
  if (relative === 'worker' || relative.startsWith('worker/') || relative.split('/').includes('node_modules')) continue;
  const from = join(source, relative);
  if (!existsSync(from) || lstatSync(from).isDirectory()) continue; // Git submodule shell is out of this consumer boundary.
  if (lstatSync(from).isSymbolicLink()) throw new Error('Acceptance copy refuses source symlinks: ' + relative);
  mkdirSync(dirname(join(isolated, relative)), { recursive: true });
  cpSync(from, join(isolated, relative));
}
if (existsSync(join(isolated, 'worker'))) throw new Error('Worker source leaked into the acceptance checkout');
execFileSync('git', ['init', '-q'], { cwd: isolated });
execFileSync('git', ['add', '.'], { cwd: isolated });
execFileSync('git', ['-c', 'user.name=Worker separation acceptance', '-c', 'user.email=acceptance@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Isolated consumer acceptance snapshot'], { cwd: isolated });
const receipt = { schema: 'hps-worker-separation-acceptance/1', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: source, encoding: 'utf8' }).trim(), checkout: isolated, workerExcluded: true, siblingSourceUsed: false, productionDeployed: false, checks: [] };
const env = { ...process.env, HYPEPROOF_HARNESS: '', NODE_PATH: '', npm_config_cache: process.env.npm_config_cache || '/tmp/hypeproof-public-npm-cache' };
const steps = [
  ['tooling install', '.', 'npm', ['ci', '--ignore-scripts']],
  ['App install', 'extensions/hypeproof-chat', 'npm', ['ci']],
  ['webview install', 'extensions/hypeproof-chat/webview-ui', 'npm', ['ci']],
  ['Chalk install', 'chalk', 'npm', ['ci']],
  ['integration install', 'e2e', 'npm', ['ci']],
  ['App typecheck', 'extensions/hypeproof-chat', 'npm', ['run', 'typecheck']],
  ['App production bundle', 'extensions/hypeproof-chat', 'npm', ['run', 'build:extension']],
  ['webview production build', 'extensions/hypeproof-chat/webview-ui', 'npm', ['run', 'build']],
  ['Chalk typecheck', 'chalk', 'npm', ['run', 'typecheck']],
  ['Chalk production bundle', 'chalk', 'npm', ['exec', '--', 'wrangler', 'deploy', '--dry-run', '--outdir', 'dist']],
  ['App feature and failure regression', 'extensions/hypeproof-chat', 'npm', ['test']],
  ['Chalk authorization, reads and transport', 'chalk', 'npm', ['test']],
  ['App to Service contracts, measurements, snapshots and deployment boundaries', '.', 'npm', ['run', 'test:service-integration']],
  ['launcher isolation and subscription lifecycle', '.', 'python3', ['scripts/test-studio-dev.py']],
  ['Chromium install', 'e2e', 'npm', ['exec', '--', 'playwright', 'install', 'chromium']],
  ['App to Service classroom results', 'e2e', 'npm', ['run', 'test:classroom-ops-results']],
  ['published runtime in real Chromium', 'e2e', 'npm', ['run', 'test:cr-publish']],
  ['participant evidence in real Chromium', 'e2e', 'npm', ['run', 'test:cr-evidence']],
  ['budget isolation in real Chromium', 'e2e', 'npm', ['run', 'test:budgets:browser']],
  ['API gateway and SDK credential isolation', 'e2e', 'npm', ['run', 'test:budgets:sdk']],
  ['published classroom flows and App results', 'e2e', 'npm', ['run', 'test:trial-ux']],
];
console.log('Acceptance checkout (Worker absent, siblings absent): ' + isolated);
for (const [name, directory, command, args] of steps) {
  console.log('RUN: ' + name);
  const start = Date.now();
  const run = spawnSync(command, args, { cwd: join(isolated, directory), env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const log = join(isolated, 'acceptance-' + receipt.checks.length + '.log');
  writeFileSync(log, (run.stdout || '') + (run.stderr || '') + (run.error?.message || ''));
  const passed = !run.error && run.status === 0;
  receipt.checks.push({ name, command: [command, ...args], directory, status: passed ? 'pass' : 'fail', exitCode: run.status, durationMs: Date.now() - start, log });
  writeFileSync(join(isolated, 'worker-separation-acceptance.json'), JSON.stringify(receipt, null, 2) + '\n');
  if (!passed) { console.error('FAIL: ' + name + '; evidence: ' + log); process.exit(1); }
  console.log('PASS: ' + name);
}
receipt.status = 'pass';
writeFileSync(join(isolated, 'worker-separation-acceptance.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('Worker separation acceptance PASS: ' + join(isolated, 'worker-separation-acceptance.json'));
