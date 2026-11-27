// Pinned Chalk release (config/chalk-release.json) controls. Synthetic vsix only, no network.
// Positive control first (a verified vsix is accepted and installed), then the negative
// controls: sha256, size, version inside the vsix, asset name, missing asset, download
// errors that carry a secret, ship=false (no download), and the post-build check 8c.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChalkRelease, loadManifest } from '../fetch-chalk-release.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Build a synthetic vsix: a zip whose top folder is extension/, like vsce output.
async function makeVsix(t, { version = '0.1.0' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalk-release-src-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'extension/dist'), { recursive: true });
  await writeFile(join(dir, 'extension/package.json'), JSON.stringify({ name: 'hypeproof-chalk', publisher: 'hypeproof', version }));
  await writeFile(join(dir, 'extension/dist/extension.js'), `// synthetic ${version}\n`);
  const out = join(dir, 'out.vsix');
  await run('zip', ['-qr', out, 'extension'], { cwd: dir });
  return readFile(out);
}

function manifestFor(bytes, overrides = {}) {
  const release = {
    tag: 'chalk-v0.1.0', version: '0.1.0', asset: 'hypeproof-chalk-0.1.0.vsix',
    sha256: digest(bytes), size: bytes.length,
  };
  return { version: 1, repository: 'hypeproof/hypeproof-chalk', ship: true, ...overrides, release: { ...release, ...(overrides.release ?? {}) } };
}

async function fixture(t, manifest) {
  const dir = await mkdtemp(join(tmpdir(), 'chalk-release-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifestPath = join(dir, 'chalk-release.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { dir, manifestPath, cacheDir: join(dir, '.private-chalk-cache') };
}

// A download double that places `bytes` under the requested asset name.
const serving = (bytes, calls = { n: 0 }) => async ({ asset, dir }) => { calls.n++; await writeFile(join(dir, asset), bytes); };

test('positive control: a verified vsix is accepted, cached, and reused without a download', async t => {
  const bytes = await makeVsix(t);
  const f = await fixture(t, manifestFor(bytes));
  const calls = { n: 0 };
  const first = await fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: serving(bytes, calls) });
  assert.equal(first.ship, true);
  assert.equal(calls.n, 1);
  assert.deepEqual(await readFile(first.vsixPath), bytes);
  const second = await fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: async () => assert.fail('cached vsix must not be downloaded again') });
  assert.equal(second.vsixPath, first.vsixPath);
});

test('ship=false: nothing is downloaded and no cache is created', async t => {
  const bytes = await makeVsix(t);
  const f = await fixture(t, manifestFor(bytes, { ship: false }));
  const result = await fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: async () => assert.fail('ship=false must not download') });
  assert.deepEqual(result, { ship: false });
  await assert.rejects(readdir(f.cacheDir), { code: 'ENOENT' });
});

test('negative: sha256 mismatch is rejected and nothing is cached', async t => {
  const bytes = await makeVsix(t);
  const manifest = manifestFor(bytes); manifest.release.sha256 = '0'.repeat(64);
  const f = await fixture(t, manifest);
  await assert.rejects(fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: serving(bytes) }), /SHA256 mismatch/);
  assert.deepEqual(await readdir(f.cacheDir), []);
});

test('negative: size mismatch is rejected before the hash', async t => {
  const bytes = await makeVsix(t);
  const manifest = manifestFor(bytes); manifest.release.size = bytes.length + 1;
  const f = await fixture(t, manifest);
  await assert.rejects(fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: serving(bytes) }), /size mismatch/);
  assert.deepEqual(await readdir(f.cacheDir), []);
});

test('negative: a vsix whose own version differs from the pin is rejected', async t => {
  const bytes = await makeVsix(t, { version: '0.1.1' });
  const f = await fixture(t, manifestFor(bytes));
  await assert.rejects(fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: serving(bytes) }), /version mismatch/);
  assert.deepEqual(await readdir(f.cacheDir), []);
});

test('negative: an asset name outside the pattern is rejected before any download', async t => {
  const bytes = await makeVsix(t);
  for (const asset of ['../hypeproof-chalk-0.1.0.vsix', 'hypeproof-chalk-0.1.0.zip', '--repo=other']) {
    const manifest = manifestFor(bytes); manifest.release.asset = asset;
    const f = await fixture(t, manifest);
    await assert.rejects(fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: async () => assert.fail('must not download') }), /Invalid Chalk release manifest/, asset);
  }
});

test('negative: an asset the download did not produce is rejected', async t => {
  const bytes = await makeVsix(t);
  const f = await fixture(t, manifestFor(bytes));
  await assert.rejects(fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: async () => {} }), /was not downloaded/);
  assert.deepEqual(await readdir(f.cacheDir), []);
});

test('negative: download errors are sanitized and do not echo the secret', async t => {
  const bytes = await makeVsix(t);
  const f = await fixture(t, manifestFor(bytes));
  await assert.rejects(
    fetchChalkRelease({ manifestPath: f.manifestPath, cacheDir: f.cacheDir, download: async () => { throw new Error('GH_TOKEN-fixture-sensitive'); } }),
    error => /download failed/.test(error.message) && !error.message.includes('fixture-sensitive'),
  );
});

test('manifest must be exact: repository, ship type, and tag/version/asset agreement', async t => {
  const bytes = await makeVsix(t);
  const bad = [
    m => { m.repository = 'jayleekr/hypeproof-chalk'; },
    m => { m.ship = 'true'; },
    m => { m.release.tag = 'chalk-v0.1.1'; },
    m => { m.release.sha256 = 'unknown'; },
  ];
  for (const mutate of bad) {
    const manifest = manifestFor(bytes); mutate(manifest);
    const f = await fixture(t, manifest);
    await assert.rejects(loadManifest(f.manifestPath), /Invalid Chalk release manifest/);
  }
});

test('the committed pin is well formed and ships nothing yet', async () => {
  const pin = await loadManifest(join(root, 'config/chalk-release.json'));
  assert.equal(pin.ship, false);
  assert.equal(pin.repository, 'hypeproof/hypeproof-chalk');
  assert.equal(pin.version, '0.1.0');
});

// ── install + post-build check 8c, with a synthetic app and a pre-verified cache (no network) ──
async function syntheticApp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'chalk-release-app-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const app = join(dir, 'HypeProof Studio.app');
  await mkdir(join(app, 'Contents/Resources/app/extensions'), { recursive: true });
  await writeFile(join(app, 'Contents/Resources/app/product.json'), '{}');
  return app;
}
const sh = (script, args, env) => run('bash', [join(root, 'scripts', script), ...args], { env: { ...process.env, ...env } }).then(
  () => 0, error => error.code ?? 1,
);

test('install + check 8c: installs the verified tree, detects tamper, removes it for ship=false, and flags a leftover', async t => {
  const bytes = await makeVsix(t);
  const f = await fixture(t, manifestFor(bytes));
  await mkdir(f.cacheDir, { recursive: true });
  await writeFile(join(f.cacheDir, 'hypeproof-chalk-0.1.0.vsix'), bytes);
  const env = { CHALK_RELEASE_MANIFEST: f.manifestPath, CHALK_CACHE_DIR: f.cacheDir };
  const app = await syntheticApp(t);
  const target = join(app, 'Contents/Resources/app/extensions/hypeproof-chalk');

  // positive control: install then check passes
  assert.equal(await sh('install-chalk-extension.sh', [app], env), 0);
  assert.equal(await readFile(join(target, 'package.json'), 'utf8').then(s => JSON.parse(s).version), '0.1.0');
  assert.equal(await sh('check-chalk-release-installed.sh', [app], env), 0, 'positive control: clean install passes 8c');

  // negative: a changed installed file fails 8c
  await writeFile(join(target, 'dist/extension.js'), '// tampered\n');
  assert.equal(await sh('check-chalk-release-installed.sh', [app], env), 1, 'tampered install fails 8c');

  // negative: ship=false removes the copy, and 8c fails if a copy is still there
  await writeFile(f.manifestPath, JSON.stringify(manifestFor(bytes, { ship: false })));
  assert.equal(await sh('install-chalk-extension.sh', [app], env), 0);
  await assert.rejects(readdir(target), { code: 'ENOENT' }, 'ship=false install removes the old copy');
  assert.equal(await sh('check-chalk-release-installed.sh', [app], env), 0, 'ship=false with nothing installed passes 8c');
  await mkdir(join(target, 'dist'), { recursive: true });
  assert.equal(await sh('check-chalk-release-installed.sh', [app], env), 1, 'a leftover copy with ship=false fails 8c');
});
