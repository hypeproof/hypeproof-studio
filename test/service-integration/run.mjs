// Studio-owned cross-product regressions. The reference Service is installed
// from the public, integrity-pinned testkit; no private server checkout is read.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const requirements = new Map([
  ['browser-contract.test', 'App browser tools remain accepted by the Service contract'],
  ['measurement-core.test', 'App and Service accept the released measurement contract and reject unsupported versions'],
  ['native-observation.test', 'Observation judgment, consent and App wire compatibility remain intact'],
  ['classroom-ops-snapshot-device.test', 'Actual App snapshots upload/seal with learner, consent, revision and recovery isolation'],
  ['classroom-ops-staging-config.test', 'Service resources remain isolated and Chalk carries no Service storage bindings'],
]);
const all = process.argv.includes('--all');
if (process.argv.slice(2).some(arg => arg !== '--all')) throw new Error('Usage: node test/service-integration/run.mjs [--all]');
const selected = manifest.tests.filter(test => all || requirements.has(test.id));
if (!all && selected.length !== requirements.size) throw new Error('Required consumer regression is missing from the inventory');
const evidence = join(root, '.evidence');
mkdirSync(evidence, { recursive: true });
const receipt = { schema: 'hps-studio-service-integration-execution/1', mode: all ? 'all-preserved-commands' : 'core-requirements', tests: [], notRun: manifest.tests.filter(test => !selected.includes(test)).map(test => test.id) };
for (const test of selected) {
  console.log('RUN: ' + test.id + ' — ' + (requirements.get(test.id) || 'preserved compatibility regression'));
  const started = Date.now();
  const args = ['--import', '@hypeproof/service-testkit/test/harness/loader.mjs', ...test.args];
  const run = spawnSync(process.execPath, args, { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const log = join(evidence, test.id + '.log');
  writeFileSync(log, (run.stdout || '') + (run.stderr || '') + (run.error?.message || ''));
  const passed = !run.error && run.status === 0;
  receipt.tests.push({ id: test.id, requirement: requirements.get(test.id), command: [process.execPath, ...args], status: passed ? 'pass' : 'fail', exitCode: run.status, durationMs: Date.now() - started, log });
  writeFileSync(join(evidence, 'execution.json'), JSON.stringify(receipt, null, 2) + '\n');
  if (!passed) { console.error('FAIL: ' + test.id + '; evidence: ' + log); process.exit(1); }
  console.log('PASS: ' + test.id);
}
receipt.status = 'pass';
writeFileSync(join(evidence, 'execution.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('Consumer integration PASS. Preserved but not executed in this run: ' + receipt.notRun.length + '; evidence: ' + join(evidence, 'execution.json'));
