import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrapServicePackages } from '../bootstrap-service-packages.mjs';
const names = ['measurement-core-0.1.0', 'service-contracts-0.1.0', 'service-contracts-0.1.1', 'measurement-0.3.5', 'service-testkit-0.1.2'];
const bytes = asset => Buffer.from('synthetic fixture ' + asset);
const digest = b => createHash('sha256').update(b).digest('hex');
const pins = () => ({ version: 1, repository: 'hypeproof/hypeproof-service', packages: names.map(name => {
  const asset = 'hypeproof-' + name + '.tgz'; return { asset, tag: 'private-fixture-v1', sha256: digest(bytes(asset)) };
}) });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'private-service-bootstrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const download = async (spec, stage) => { calls++; await writeFile(join(stage, spec.asset), bytes(spec.asset)); };
  return { root, download, calls: () => calls };
}
test('verified acquisition is atomic, cache reuse requires no credential or network', async t => {
  const f = await fixture(t);
  assert.equal(await bootstrapServicePackages({ root: f.root, manifest: pins(), download: f.download }), 5);
  assert.equal(f.calls(), 5);
  assert.equal(await bootstrapServicePackages({ root: f.root, manifest: pins(), download: async () => assert.fail('must not download verified cache') }), 5);
  assert.equal((await readdir(join(f.root, '.private-service-cache'))).length, 5);
});
test('corrupt cached package fails closed without network or silent replacement', async t => {
  const f = await fixture(t); await bootstrapServicePackages({ root: f.root, manifest: pins(), download: f.download });
  await writeFile(join(f.root, '.private-service-cache', pins().packages[0].asset), 'corrupt bytes');
  await assert.rejects(bootstrapServicePackages({ root: f.root, manifest: pins(), download: async () => assert.fail('must not download') }), /SHA256 mismatch/);
});
test('downloaded hash mismatch is rejected and staging never becomes installed cache', async t => {
  const f = await fixture(t);
  await assert.rejects(bootstrapServicePackages({ root: f.root, manifest: pins(), download: async (spec, stage) => writeFile(join(stage, spec.asset), 'tampered') }), /SHA256 mismatch/);
  assert.deepEqual(await readdir(join(f.root, '.private-service-cache')), []);
});
for (const [label, mutate] of [
  ['old repository alias', x => { x.repository = 'jayleekr/hypeproof-service'; }],
  ['path traversal', x => { x.packages[0].asset = '../steal.tgz'; }],
  ['option injection', x => { x.packages[0].tag = '--repo=other'; }],
  ['invalid digest', x => { x.packages[0].sha256 = 'unknown'; }],
  ['duplicate asset', x => { x.packages[1] = x.packages[0]; }],
]) test(`reject ${label} before acquisition`, async t => {
  const f = await fixture(t); const manifest = pins(); mutate(manifest);
  await assert.rejects(bootstrapServicePackages({ root: f.root, manifest, download: async () => assert.fail('must not download') }), /Invalid private Service package/);
});
test('all consumer package inputs point into ignored cache with matching immutable pins', async () => {
  const root = new URL('../../', import.meta.url).pathname;
  const manifest = JSON.parse(await readFile(join(root, 'config/service-packages.json'), 'utf8'));
  const assets = new Set(manifest.packages.map(spec => spec.asset));
  for (const path of ['package.json', 'packages/measurement/package.json', 'extensions/hypeproof-chat/package.json', 'extensions/hypeproof-chat/webview-ui/package.json', 'chalk/package.json', 'e2e/package.json']) {
    const pkg = JSON.parse(await readFile(join(root, path), 'utf8'));
    for (const deps of [pkg.dependencies, pkg.devDependencies]) for (const [name, value] of Object.entries(deps ?? {})) if (name.startsWith('@hypeproof/')) {
      assert.ok(value.startsWith('file:'), name);
      const absolute = resolve(join(root, path, '..'), value.slice(5));
      assert.equal(absolute, join(root, '.private-service-cache', absolute.split('/').at(-1)));
      assert.ok(assets.has(absolute.split('/').at(-1)));
    }
  }
  assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /^\.private-service-cache\/$/m);
});


test('cache directory symlink is rejected before acquisition', async t => {
  const f = await fixture(t); const outside = join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, join(f.root, '.private-service-cache'));
  await assert.rejects(bootstrapServicePackages({ root: f.root, manifest: pins(), download: async () => assert.fail('must not download') }), /regular directory/);
});
test('cached artifact symlink is rejected even when target bytes have the expected digest', async t => {
  const f = await fixture(t); const cache = join(f.root, '.private-service-cache'); await mkdir(cache);
  const asset = pins().packages[0].asset; const outside = join(f.root, 'outside.tgz'); await writeFile(outside, bytes(asset));
  await symlink(outside, join(cache, asset));
  await assert.rejects(bootstrapServicePackages({ root: f.root, manifest: pins(), download: async () => assert.fail('must not download') }), /regular file/);
});
test('download failure is sanitized, removes staging and never falls back', async t => {
  const f = await fixture(t); let attempts = 0;
  await assert.rejects(bootstrapServicePackages({ root: f.root, manifest: pins(), download: async () => { attempts++; throw new Error('GH_TOKEN-fixture-sensitive'); } }), error => /download failed/.test(error.message) && !error.message.includes('fixture-sensitive'));
  assert.equal(attempts, 1); assert.deepEqual(await readdir(join(f.root, '.private-service-cache')), []);
});

test('optional sixth companion DEV archive uses the same verified bootstrap and corrupt bytes fail closed', async t => {
  const f = await fixture(t), manifest = pins(), asset = 'hypeproof-companion-client-0.1.0.tgz';
  manifest.packages.push({asset, tag: 'companion-client-v0.1.0-dev.1', sha256: digest(bytes(asset)), sourceCommit: 'a'.repeat(40)});
  assert.equal(await bootstrapServicePackages({root: f.root, manifest, download: f.download}), 6);
  await writeFile(join(f.root, '.private-service-cache', asset), 'tampered');
  await assert.rejects(bootstrapServicePackages({root:f.root, manifest, download:async()=>assert.fail('must not redownload corruption')}), /SHA256 mismatch/);
});
