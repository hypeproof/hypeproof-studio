// Controls for the public native SDK seed (studio-public-sdk-seed, US-01).
//   node --test scripts/release/test/sdk-seed-assets.test.mjs
// No network: the seeder is pointed at a local fixture registry, and the
// verify-branding controls run against a synthetic .app tree.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  SEED_MANIFEST_NAME, checkSeedDirectory, expectedSeedAssets, parseSeedPlatforms, parseSha256File, seedAssetName,
  seedAssetProblems, vendoredSdkVersion,
} from '../sdk-seed-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SEEDER = path.join(ROOT, 'scripts/seed-sdk-binary.sh');
const CLI = path.join(ROOT, 'scripts/release/sdk-seed-assets.mjs');
const VERIFY = path.join(ROOT, 'scripts/verify-branding.sh');
const V = '9.9.9'; // never a pinned version: the seeder takes integrity from the fixture registry
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sri = buf => `sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`;

/** A real gzip tarball holding package/<entry>, made with the system tar. */
function makeTarball(entry, dir) {
  const src = path.join(dir, `src-${entry}`);
  fs.mkdirSync(path.join(src, 'package'), {recursive: true});
  fs.writeFileSync(path.join(src, 'package', entry), `synthetic native ${entry}`);
  const out = path.join(dir, `${entry}.tgz`);
  assert.equal(spawnSync('tar', ['-czf', out, '-C', src, 'package'], {stdio: 'ignore'}).status, 0);
  return fs.readFileSync(out);
}

/** Serves `/<pkg>/<v>` metadata and `/<pkg>/-/<file>.tgz` for each platform. */
async function fixtureRegistry(tarballs, integrityOverride = {}) {
  const server = http.createServer((req, res) => {
    for (const [platform, buf] of Object.entries(tarballs)) {
      const pkg = `/@anthropic-ai/claude-agent-sdk-${platform}`;
      if (req.url === `${pkg}/${V}`) {
        res.end(JSON.stringify({version: V, dist: {integrity: integrityOverride[platform] ?? sri(buf)}}));
        return;
      }
      if (req.url === `${pkg}/-/${seedAssetName(platform, V)}`) { res.end(buf); return; }
    }
    res.statusCode = 404; res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r))};
}

/** Runs the seeder asynchronously so the in-process fixture server can answer. */
function seed(args, env) {
  return new Promise(resolve => {
    const child = spawn('bash', [SEEDER, ...args], {env: {...process.env, ...env}});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', status => resolve({status, out}));
  });
}

test('asset-list judge: the full set passes; missing, stale and malformed versions are reported', () => {
  const good = expectedSeedAssets(V);
  assert.deepEqual(good.sort(), [
    'claude-agent-sdk-darwin-arm64-9.9.9.tgz', 'claude-agent-sdk-darwin-arm64-9.9.9.tgz.sha256',
    'claude-agent-sdk-win32-x64-9.9.9.tgz', 'claude-agent-sdk-win32-x64-9.9.9.tgz.sha256', SEED_MANIFEST_NAME,
  ].sort());
  const appAssets = ['HypeProof-Studio-darwin-arm64.zip', 'HypeProof.Studio-win32-x64-1.2.3.zip', 'unified-acceptance.json'];
  assert.deepEqual(seedAssetProblems([...appAssets, ...good], V), [], 'positive control');
  // Negative controls: a release from before this change, a dropped checksum, a stale seed.
  assert.equal(seedAssetProblems(appAssets, V).length, 5);
  assert.deepEqual(seedAssetProblems(good.filter(n => !n.endsWith('win32-x64-9.9.9.tgz.sha256')), V), ['missing claude-agent-sdk-win32-x64-9.9.9.tgz.sha256']);
  assert.deepEqual(seedAssetProblems([...good, 'claude-agent-sdk-darwin-arm64-0.3.1.tgz'], V), ['claude-agent-sdk-darwin-arm64-0.3.1.tgz is for SDK 0.3.1, the App ships 9.9.9']);
  assert.deepEqual(seedAssetProblems(good, ''), ['not an SDK version: ']);
});

test('sha256 line parser accepts sha256sum output only', () => {
  const hex = 'a'.repeat(64);
  assert.deepEqual(parseSha256File(`${hex}  x.tgz\n`), {sha256: hex, name: 'x.tgz'});
  assert.equal(parseSha256File(`${hex.slice(1)}  x.tgz\n`), null);
  assert.equal(parseSha256File('sha512-abc  x.tgz\n'), null);
});

test('vendored SDK version: both zips must agree', () => {
  const pkg = v => JSON.stringify({name: '@anthropic-ai/claude-agent-sdk', version: v});
  assert.equal(vendoredSdkVersion(pkg('0.3.299'), pkg('0.3.299')), '0.3.299');
  assert.throws(() => vendoredSdkVersion(pkg('0.3.299'), pkg('0.3.300')), /different Agent SDK versions/);
  assert.throws(() => vendoredSdkVersion('not json'), /no readable/);
  assert.throws(() => vendoredSdkVersion(), /no readable/);
});

test('seeder --download-only stages verified tarballs; manifest/check CLI pass, tampering fails', async () => {
  const dir = tmp('hps-seed-ok-');
  const tarballs = {'darwin-arm64': makeTarball('claude', dir), 'win32-x64': makeTarball('claude.exe', dir)};
  const registry = await fixtureRegistry(tarballs);
  try {
    const out = path.join(dir, 'seed');
    const home = path.join(dir, 'home');
    for (const platform of Object.keys(tarballs)) {
      const r = await seed(['--platform', platform, '--version', V, '--download-only', out], {HPS_NPM_REGISTRY: registry.url, HOME: home});
      assert.equal(r.status, 0, r.out);
    }
    assert.equal(fs.existsSync(home), false, 'release mode installs nothing');
    const staged = fs.readFileSync(path.join(out, seedAssetName('win32-x64', V)));
    assert.ok(staged.equals(tarballs['win32-x64']), 'the staged tarball is byte-identical to the registry one');
    const shaLine = fs.readFileSync(path.join(out, `${seedAssetName('win32-x64', V)}.sha256`), 'utf8');
    assert.equal(parseSha256File(shaLine).sha256, crypto.createHash('sha256').update(staged).digest('hex'));

    const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8'});
    assert.equal(cli('manifest', out, V).status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, SEED_MANIFEST_NAME), 'utf8'));
    assert.equal(manifest.sdkVersion, V);
    assert.equal(manifest.seeds.find(s => s.platform === 'darwin-arm64').npmIntegrity, sri(tarballs['darwin-arm64']));
    assert.deepEqual(checkSeedDirectory(out, V), []);
    assert.equal(cli('check', out, V).status, 0);
    assert.notEqual(cli('check', out, '9.9.8').status, 0, 'a seed for another SDK version fails');

    // Negative control: bytes changed after the checksum was written.
    fs.appendFileSync(path.join(out, seedAssetName('darwin-arm64', V)), 'x');
    assert.deepEqual(checkSeedDirectory(out, V), [
      `${seedAssetName('darwin-arm64', V)}.sha256 does not match the tarball bytes`,
      `${SEED_MANIFEST_NAME} darwin-arm64 entry does not match the tarball`,
    ]);
    assert.notEqual(cli('check', out, V).status, 0);
  } finally {
    await registry.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('seeder --download-only refuses a wrong hash or a tarball without the platform binary', async () => {
  const dir = tmp('hps-seed-bad-');
  const darwin = makeTarball('claude', dir);
  // win32 tarball that carries package/claude, not package/claude.exe.
  const registry = await fixtureRegistry({'darwin-arm64': darwin, 'win32-x64': darwin}, {});
  const lying = await fixtureRegistry({'darwin-arm64': darwin}, {'darwin-arm64': sri(Buffer.from('other bytes'))});
  try {
    const out = path.join(dir, 'seed');
    const env = {HOME: path.join(dir, 'home')};
    const wrongHash = await seed(['--platform', 'darwin-arm64', '--version', V, '--download-only', out], {...env, HPS_NPM_REGISTRY: lying.url});
    assert.notEqual(wrongHash.status, 0);
    assert.match(wrongHash.out, /sha512 mismatch/);
    const wrongEntry = await seed(['--platform', 'win32-x64', '--version', V, '--download-only', out], {...env, HPS_NPM_REGISTRY: registry.url});
    assert.notEqual(wrongEntry.status, 0);
    assert.match(wrongEntry.out, /no package\/claude\.exe/);
    // A pinned version checks the pinned table, whatever the tarball claims to be.
    const fake = path.join(dir, 'claude.tgz');
    fs.writeFileSync(fake, darwin);
    const pinned = await seed(['--platform', 'darwin-arm64', '--tarball', fake, '--download-only', out], env);
    assert.notEqual(pinned.status, 0);
    assert.match(pinned.out, /sha512 mismatch/);
    assert.equal(fs.existsSync(out) && fs.readdirSync(out).length > 0, false, 'nothing is staged after a refusal');
  } finally {
    await registry.close();
    await lying.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('list CLI reads `gh release view --json assets` output', () => {
  const run = names => spawnSync(process.execPath, [CLI, 'list', V], {input: JSON.stringify({assets: names.map(name => ({name}))}), encoding: 'utf8'});
  assert.equal(run(['HypeProof-Studio-darwin-arm64.zip', ...expectedSeedAssets(V)]).status, 0);
  const missing = run(['HypeProof-Studio-darwin-arm64.zip']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing claude-agent-sdk-darwin-arm64-9\.9\.9\.tgz/);
});

const MAC_ONLY = JSON.stringify(['darwin-arm64']);

test('seed platforms: omitted means every platform; unknown, empty or duplicate lists are refused', () => {
  assert.deepEqual(parseSeedPlatforms(undefined), ['darwin-arm64', 'win32-x64']);
  assert.deepEqual(parseSeedPlatforms(MAC_ONLY), ['darwin-arm64']);
  assert.deepEqual(parseSeedPlatforms('["win32-x64","darwin-arm64"]'), ['darwin-arm64', 'win32-x64']);
  for (const bad of ['[]', '["linux-x64"]', '["darwin-arm64","darwin-arm64"]', '"darwin-arm64"', 'darwin-arm64']) {
    assert.throws(() => parseSeedPlatforms(bad), undefined, bad);
  }
});

test('a Mac-only release: manifest/check/list pass for its platforms and fail against both (control)', async () => {
  const dir = tmp('hps-seed-mac-');
  const tarballs = {'darwin-arm64': makeTarball('claude', dir)};
  const registry = await fixtureRegistry(tarballs);
  try {
    const out = path.join(dir, 'seed');
    const r = await seed(['--platform', 'darwin-arm64', '--version', V, '--download-only', out], {HPS_NPM_REGISTRY: registry.url, HOME: path.join(dir, 'home')});
    assert.equal(r.status, 0, r.out);
    const cli = (args, input) => spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8', input});

    // Negative control first: today's both-platform default refuses a Mac-only stage.
    const both = cli(['manifest', out, V]);
    assert.notEqual(both.status, 0);
    assert.match(both.stderr, /missing claude-agent-sdk-win32-x64-9\.9\.9\.tgz/);

    assert.equal(cli(['manifest', out, V, MAC_ONLY]).status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, SEED_MANIFEST_NAME), 'utf8'));
    assert.deepEqual(manifest.seeds.map(s => s.platform), ['darwin-arm64']);
    assert.equal(cli(['check', out, V, MAC_ONLY]).status, 0);
    assert.notEqual(cli(['check', out, V]).status, 0, 'the mirror check without platforms still requires both');
    assert.notEqual(cli(['check', out, V, '["linux-x64"]']).status, 0, 'an unknown platform is refused');

    const assets = JSON.stringify({assets: ['HypeProof-Studio-darwin-arm64.zip', ...expectedSeedAssets(V, ['darwin-arm64'])].map(name => ({name}))});
    assert.equal(cli(['list', V, MAC_ONLY], assets).status, 0);
    assert.notEqual(cli(['list', V], assets).status, 0);
  } finally {
    await registry.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

// verify-branding.sh runs every branding check; a synthetic tree fails the
// others (no Info.plist, no product.json). These controls read only the SDK
// vendor lines, which is the verdict this change must keep.
function syntheticApp(dir, leak) {
  const app = path.join(dir, 'HypeProof Studio.app');
  const ext = path.join(app, 'Contents/Resources/app/extensions/hypeproof-chat');
  const sdk = path.join(ext, 'dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk');
  fs.mkdirSync(sdk, {recursive: true});
  fs.writeFileSync(path.join(sdk, 'sdk.mjs'), 'export {};');
  fs.writeFileSync(path.join(ext, 'package.json'), JSON.stringify({version: '1.0.0', devDependencies: {'@anthropic-ai/claude-agent-sdk': '0.3.299'}}));
  leak?.(ext);
  return app;
}
function verifySdkLines(app) {
  const r = spawnSync('bash', [VERIFY, app], {encoding: 'utf8', env: {...process.env, REQUIRE_SDK_VENDOR: '1', HOME: path.dirname(app)}});
  return (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
}

test('verify-branding: clean vendor tree passes the native-package check (positive control)', () => {
  const dir = tmp('hps-brand-ok-');
  try {
    const out = verifySdkLines(syntheticApp(dir));
    assert.match(out, /✓ Vendored SDK entrypoint shipped/);
    assert.match(out, /✓ No per-platform SDK binary package or native seed in the shipped extension/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('verify-branding: a native package or a release seed inside the App fails (negative controls)', () => {
  for (const [label, leak] of [
    ['npm platform package', ext => fs.mkdirSync(path.join(ext, 'dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64'), {recursive: true})],
    ['release seed tarball', ext => fs.writeFileSync(path.join(ext, 'dist', 'claude-agent-sdk-darwin-arm64-0.3.299.tgz'), 'seed')],
  ]) {
    const dir = tmp('hps-brand-leak-');
    try {
      const out = verifySdkLines(syntheticApp(dir, leak));
      assert.match(out, /✗ Per-platform SDK binary package\(s\) or native seed\(s\) inside the shipped extension/, label);
      assert.doesNotMatch(out, /✓ No per-platform SDK binary package/, label);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  }
});
