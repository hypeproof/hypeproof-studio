// Built-in copies contain bundled output, not the source node_modules tree.
// Exercise the same dependency enumeration used by vscode-min-prepack.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const directory = mkdtempSync(join(tmpdir(), 'hps-builtin-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const inspect = () => spawnSync(npm, ['list', '--production', '--parseable', '--depth=99999', '--loglevel=error'], { cwd: directory, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, npm_config_offline: 'true', npm_config_update_notifier: 'false' } });
try {
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  const packaged = inspect();
  assert.equal(packaged.status, 0, `Injected extension dependency scan failed: ${packaged.stderr}`);
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], 'Bundled dependencies belong in devDependencies');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ ...manifest, dependencies: { 'hps-missing-runtime-control': '1.0.0' } }));
  const missing = inspect();
  assert.notEqual(missing.status, 0, 'Negative control must reject a missing production dependency');
  assert.match(missing.stderr, /ELSPROBLEMS/);
  console.log('PASS built-in package enumeration; missing-runtime negative control rejected');
} finally { rmSync(directory, { recursive: true, force: true }); }
