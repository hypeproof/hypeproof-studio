import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = readFileSync(new URL('../../.github/workflows/verify-paid-pass-recovery.yml', import.meta.url), 'utf8');
const hosted = readFileSync(new URL('./hosted-run.sh', import.meta.url), 'utf8');
const keychainCleanup = readFileSync(new URL('./keychain-cleanup.sh', import.meta.url), 'utf8');
const pin = JSON.parse(readFileSync(new URL('./service-harness.json', import.meta.url), 'utf8'));

test('hosted recovery pins canonical Service and gates full observation on preflight', () => {
  assert.equal(pin.repository, 'hypeproof/hypeproof-service');
  assert.match(pin.sha, /^[a-f0-9]{40}$/);
  assert.match(workflow, /runs-on: macos-15/g);
  assert.match(workflow, /full:\n\s+needs: preflight/);
  assert.match(workflow, /timeout-minutes: 70/);
  assert.equal((workflow.match(/ref: \$\{\{ steps\.service\.outputs\.sha \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/path: \.service-harness\n\s+fetch-depth: 0/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /codesign|productsign|HPS_NATIVE_COMPAT_APP/);
});

test('Service pin resolver writes the exact reviewed SHA to the Actions output file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hps-paid-pin-'));
  try {
    const output = join(directory, 'github-output');
    const result = spawnSync(process.execPath, [new URL('./resolve-service.mjs', import.meta.url).pathname, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), `sha=${pin.sha}\n`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('each hosted mode uses and removes an ephemeral default keychain', () => {
  assert.match(hosted, /security create-keychain/);
  assert.match(hosted, /security default-keychain -d user -s "\$keychain"/);
  assert.match(hosted, /trap cleanup EXIT INT TERM/);
  assert.match(hosted, /keychain-cleanup\.sh/);
  assert.match(keychainCleanup, /security delete-keychain "\$keychain"/);
  assert.match(hosted, /node e2e\/paid-pass-recovery\/run\.mjs/);
});
