import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tooling = join(repo, 'scripts/service-tooling.mjs');
const reviewScript = join(repo, 'scripts/review-pr.sh');

// A fake installed package plus a symlinked path to it. macOS $TMPDIR sits under
// /var, which links to /private/var; the symlink reproduces that on any OS.
async function fixture(t, { withPackage = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'service-tooling-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const real = join(base, 'real');
  await mkdir(join(real, 'scripts'), { recursive: true });
  await copyFile(tooling, join(real, 'scripts/service-tooling.mjs'));
  const pkg = join(real, 'node_modules/@hypeproof/service-testkit');
  if (withPackage) {
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@hypeproof/service-testkit', version: '0.0.0-test' }));
    await writeFile(join(pkg, 'wrangler.toml'), 'name = "fixture"\n');
  }
  const link = join(base, 'link');
  await symlink(real, link, 'dir');
  return { base, real, pkg, linkScript: join(link, 'scripts/service-tooling.mjs'), realScript: join(real, 'scripts/service-tooling.mjs') };
}

test('symlinked path prints the package root, not an empty line', async (t) => {
  const f = await fixture(t);
  const { stdout } = await run(process.execPath, [f.linkScript]);
  assert.equal(stdout.trim(), await realpath(f.pkg));
});

test('symlinked path prints the configured dev-vars path for --dev-vars', async (t) => {
  const f = await fixture(t);
  const devVars = join(f.base, 'state', 'service.dev.vars');
  const { stdout } = await run(process.execPath, [f.linkScript, '--dev-vars'], { env: { ...process.env, HPS_SERVICE_DEV_VARS: devVars } });
  assert.equal(stdout.trim(), devVars);
});

test('real path still prints the package root (no regression)', async (t) => {
  const f = await fixture(t);
  const { stdout } = await run(process.execPath, [await realpath(f.realScript)]);
  assert.equal(stdout.trim(), await realpath(f.pkg));
});

test('importing the module prints nothing (negative control)', async (t) => {
  const f = await fixture(t);
  const probe = `import(${JSON.stringify(pathToFileURL(f.linkScript).href)}).then(m => console.log(typeof m.serviceWorkerRoot));`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', probe]);
  assert.equal(stdout.trim(), 'string');
});

test('missing package fails loudly instead of printing nothing (negative control)', async (t) => {
  const f = await fixture(t, { withPackage: false });
  await assert.rejects(
    run(process.execPath, [f.linkScript]),
    (error) => error.code !== 0 && /ERR_MODULE_NOT_FOUND|Cannot find package/.test(error.stderr),
  );
});

test('review-pr.sh stops when service-tooling returns no directory', async () => {
  const script = await readFile(reviewScript, 'utf8');
  const line = script.indexOf('WORKER_DIR="$(node "$WORKTREE_DIR/scripts/service-tooling.mjs")"');
  const guard = script.indexOf('if [[ -z "$WORKER_DIR" || ! -d "$WORKER_DIR" ]]; then');
  assert.ok(line >= 0, 'WORKER_DIR assignment not found');
  assert.ok(guard > line, 'guard must follow the WORKER_DIR assignment');
  const guardBlock = script.slice(guard, script.indexOf('\nfi\n', guard));
  assert.match(guardBlock, /service-tooling\.mjs returned no Service package directory/);
  assert.match(guardBlock, /exit 1/);
  await run('/bin/bash', ['-n', reviewScript]);
});
