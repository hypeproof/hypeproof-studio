// Controls for the per-release Mac installer and Test Kit (scripts/release/install-kit.mjs).
//   node --test scripts/release/test/install-kit.test.mjs
// No network. The install runs (macOS only) use a synthetic app zip, a scratch HOME and
// the HPS_INSTALL_ASSET_DIR seam, so they never touch a real ~/Applications or /Applications.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  KIT_ZIP_RE, isFreeStart, kitDirName, kitZipName, notesSection, oneLiner, renderInstaller, renderReadme,
  renderStart, withInstallSection, writeKit,
} from '../install-kit.mjs';
import {isAppPackage} from '../../../e2e/unified-release/artifact.mjs';

const SRC = 'd37a2d7b5ad08101a745f7d351b065018f89b20d';
const H = c => c.repeat(64);
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const base = {tag: 'v2026.1020.0', sourceSha: SRC, zipSha256: H('a')};

test('the tag, source commit and checksums are baked in', () => {
  const script = renderInstaller({...base, seedName: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', seedSha256: H('b'), seederSha256: H('c')});
  assert.match(script, /^HPS_TAG="v2026\.1020\.0"$/m);
  assert.match(script, /^HPS_VERSION="2026\.1020\.0"$/m);
  assert.match(script, new RegExp(`^HPS_SOURCE_SHA="${SRC}"$`, 'm'));
  assert.match(script, new RegExp(`^HPS_ZIP_SHA256="${H('a')}"$`, 'm'));
  assert.match(script, /^HPS_SEED_VERSION="0\.3\.299"$/m);
  assert.match(script, new RegExp(`^HPS_SEEDER_SHA256="${H('c')}"$`, 'm'));
  assert.match(script, /^HPS_PRERELEASE="0"$/m);
  assert.match(script, /^HPS_FREE_START="1"$/m);
  assert.ok(script.includes(oneLiner('v2026.1020.0')));
  assert.ok(!script.includes('@@'));
  // The START script is embedded verbatim, so the one-liner and the kit write the same file.
  assert.ok(script.includes(renderStart('v2026.1020.0').trimEnd()));
});

test('malformed inputs never render a script', () => {
  for (const bad of [{tag: '2026.1020.0'}, {tag: 'v2026.1020'}, {sourceSha: 'abc'}, {zipSha256: H('A')}, {zipSha256: 'a'.repeat(63)},
    {seedName: 'claude-agent-sdk-win32-x64-0.3.299.tgz', seedSha256: H('b'), seederSha256: H('c')},
    {seedName: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', seedSha256: H('b')}]) {
    assert.throws(() => renderInstaller({...base, ...bad}), JSON.stringify(bad));
  }
});

test('free start wording follows the version', () => {
  assert.equal(isFreeStart('v2026.1020.0'), true);
  assert.equal(isFreeStart('v2026.1020.0-rc.3'), true);
  assert.equal(isFreeStart('v2026.1101.2'), true);
  assert.equal(isFreeStart('v2026.1019.9'), false);
  assert.equal(isFreeStart('v0.1.56'), false);
  assert.match(renderReadme(base), /참여 코드 없이/);
  assert.doesNotMatch(renderReadme(base), /참여 코드를 붙여넣/);
  assert.match(renderReadme({...base, tag: 'v0.1.56'}), /참여 코드를 붙여넣/);
});

test('START keeps secrets in the keychain unless asked otherwise', () => {
  const start = renderStart('v2026.1020.0-rc.3');
  assert.ok(start.includes('$HOME/Applications/HypeProof-RC-2026.1020.0-rc.3/HypeProof Studio.app'));
  assert.ok(start.includes('$HOME/Library/Application Support/HPS-$VERSION'));
  const exec = start.split('\n').find(l => l.startsWith('exec '));
  assert.ok(!exec.includes('--use-inmemory-secretstorage'), 'never unconditional');
  assert.match(start, /HPS_KIT_INMEMORY_SECRETS:-0\}" == 1 \]\]; then EXTRA\+=\(--use-inmemory-secretstorage\)/);
});

test('layout names and the kit asset name', () => {
  assert.equal(kitDirName('v2026.1020.0-rc.3'), 'HypeProof-RC-2026.1020.0-rc.3');
  assert.equal(kitDirName('v2026.1020.0'), 'HypeProof-2026.1020.0');
  assert.match(renderInstaller({...base, tag: 'v2026.1020.0-rc.3'}), /^HPS_PRERELEASE="1"$/m);
  // The release gate must not count the kit as an App package, and only the kit.
  assert.ok(KIT_ZIP_RE.test(kitZipName('v2026.1020.0-rc.3')));
  assert.equal(isAppPackage(kitZipName('v2026.1020.0')), false);
  assert.equal(isAppPackage('HypeProof-Studio-darwin-arm64.zip'), true);
  assert.equal(isAppPackage('HypeProof-v2026.1020.0-Extra.zip'), true);
});

test('release notes gain the one-liner once', () => {
  const once = withInstallSection('## What changed\n- x\n', 'v2026.1020.0');
  assert.ok(once.startsWith('<!-- hps-install-mac:v1 -->'));
  assert.ok(once.includes(oneLiner('v2026.1020.0')));
  assert.ok(once.includes('## What changed'));
  assert.equal(withInstallSection(once, 'v2026.1020.0'), once);
  assert.match(notesSection('v2026.1020.0-rc.1'), /HypeProof-RC-2026\.1020\.0-rc\.1/);
});

// ── Install runs: macOS only (ditto, PlistBuddy) ────────────────────────────
const mac = process.platform === 'darwin';

function fakeAppZip(dir, {version, bundleId = 'ai.hypeproof.studio'}) {
  const app = path.join(dir, 'src', 'HypeProof Studio.app');
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), {recursive: true});
  fs.writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>HypeProof Studio</string>
</dict></plist>
`);
  fs.writeFileSync(path.join(app, 'Contents/MacOS/HypeProof Studio'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets, {recursive: true});
  const zip = path.join(assets, 'HypeProof-Studio-darwin-arm64.zip');
  fs.rmSync(zip, {force: true});
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip]);
  fs.rmSync(path.join(dir, 'src'), {recursive: true, force: true});
  return {assets, sha: sha256(zip)};
}

function install(dir, opts, args = [], env = {}) {
  const out = path.join(dir, 'out');
  fs.rmSync(out, {recursive: true, force: true});
  writeKit({sourceSha: SRC, ...opts}, out);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, {recursive: true});
  const r = spawnSync('/bin/bash', [path.join(out, 'install-mac.sh'), '--no-seed', ...args], {
    encoding: 'utf8', env: {PATH: process.env.PATH, HOME: home, HPS_INSTALL_ASSET_DIR: opts.assets, ...env},
  });
  return {...r, home, out};
}
const plistValue = (app, key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, path.join(app, 'Contents/Info.plist')], {encoding: 'utf8'}).trim();

test('right sha installs the stable build into ~/Applications; a wrong sha aborts', {skip: !mac}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    // Negative control first: one wrong digit, nothing installed.
    const wrong = sha.slice(0, -1) + (sha.endsWith('0') ? '1' : '0');
    const bad = install(dir, {tag: 'v2026.1020.0', zipSha256: wrong, assets});
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /SHA-256 불일치/);
    assert.equal(fs.existsSync(path.join(bad.home, 'Applications/HypeProof Studio.app')), false);
    // Positive control: the right sha installs that exact version.
    const good = install(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets});
    assert.equal(good.status, 0, good.stderr);
    const app = path.join(good.home, 'Applications/HypeProof Studio.app');
    assert.equal(plistValue(app, 'CFBundleShortVersionString'), '2026.1020.0');
    assert.match(good.stdout, /참여 코드는 필요 없습니다/);
    assert.equal(fs.readdirSync(path.join(good.home, 'Applications')).filter(n => n.startsWith('.hps-')).length, 0);
    // Replacing a previous HypeProof Studio is fine; replacing someone else's app is not.
    const next = fakeAppZip(dir, {version: '2026.1021.0'});
    const upgraded = install(dir, {tag: 'v2026.1021.0', zipSha256: next.sha, assets: next.assets});
    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.equal(plistValue(app, 'CFBundleShortVersionString'), '2026.1021.0');
    fs.writeFileSync(path.join(app, 'Contents/Info.plist'), fs.readFileSync(path.join(app, 'Contents/Info.plist'), 'utf8').replace('ai.hypeproof.studio', 'com.example.other'));
    const foreign = install(dir, {tag: 'v2026.1021.0', zipSha256: next.sha, assets: next.assets});
    assert.notEqual(foreign.status, 0);
    assert.match(foreign.stderr, /HypeProof Studio가 아닌 것 같아/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('an -rc tag installs side by side with its own profile and START script', {skip: !mac}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const tag = 'v2026.1020.0-rc.3', v = '2026.1020.0-rc.3';
    const {assets, sha} = fakeAppZip(dir, {version: v});
    const r = install(dir, {tag, zipSha256: sha, assets});
    assert.equal(r.status, 0, r.stderr);
    const root = path.join(r.home, 'Applications', `HypeProof-RC-${v}`);
    const state = path.join(r.home, 'Library/Application Support', `HPS-${v}`);
    assert.equal(plistValue(path.join(root, 'HypeProof Studio.app'), 'CFBundleShortVersionString'), v);
    assert.ok(fs.existsSync(path.join(root, `.hps-kit-${v}`)));
    assert.ok(fs.existsSync(path.join(state, `.hps-kit-${v}`)));
    assert.equal(fs.statSync(state).mode & 0o777, 0o700);
    assert.equal(fs.readFileSync(path.join(root, `START-${v}.command`), 'utf8'), renderStart(tag));
    assert.equal(fs.existsSync(path.join(r.home, 'Applications/HypeProof Studio.app')), false, 'the main install is untouched');
    // Re-running over its own kit is allowed.
    assert.equal(install(dir, {tag, zipSha256: sha, assets}).status, 0);
    // A folder the kit did not make is never overwritten.
    const other = tmp('hps-install-kit-');
    try {
      fs.mkdirSync(path.join(other, 'home/Applications', `HypeProof-RC-${v}`), {recursive: true});
      const refused = install(other, {tag, zipSha256: sha, assets});
      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /같은 이름의 다른 폴더/);
    } finally { fs.rmSync(other, {recursive: true, force: true}); }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('refuses an Intel Mac, a mismatched app version and a stray option', {skip: !mac}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1019.0'});
    const intel = install(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], {HPS_INSTALL_UNAME_M: 'x86_64'});
    assert.notEqual(intel.status, 0);
    assert.match(intel.stderr, /Apple 칩\(M1 이후\) Mac만/);
    const version = install(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets});
    assert.notEqual(version.status, 0);
    assert.match(version.stderr, /앱 버전이 맞지 않습니다/);
    assert.equal(fs.existsSync(path.join(version.home, 'Applications/HypeProof Studio.app')), false);
    const option = install(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, ['--bogus']);
    assert.notEqual(option.status, 0);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a failed seed names the exact recovery, never an in-app offer that is off by default', {skip: !mac}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    // The asset folder has no seeder and no seed tarball, so the seed step fails after the app is installed.
    const seeded = {tag: 'v2026.1020.0', zipSha256: sha, assets, seedName: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', seedSha256: H('b'), seederSha256: H('c')};
    const run = (args) => {
      const out = path.join(dir, 'out');
      fs.rmSync(out, {recursive: true, force: true});
      writeKit({sourceSha: SRC, ...seeded}, out);
      const home = path.join(dir, 'home');
      fs.mkdirSync(home, {recursive: true});
      return spawnSync('/bin/bash', [path.join(out, 'install-mac.sh'), ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: home, HPS_INSTALL_ASSET_DIR: assets}});
    };
    const oneLiner = 'curl -fsSL https://github.com/hypeproof/hypeproof-studio/releases/download/v2026.1020.0/install-mac.sh | bash';
    const plain = run([]);
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stderr, /AI 코치 실행 파일을 준비하지 못했습니다/);
    assert.ok(plain.stderr.includes(`이 명령을 한 번 더 실행하세요: ${oneLiner}\n`), plain.stderr);
    assert.doesNotMatch(plain.stderr, /받을지 묻습니다|Studio가 받/, 'REQ-M46 is off by default: no promise of an in-app offer');
    // Options given are repeated, so the retry installs the same way.
    const kit = run(['--layout', 'kit']);
    assert.equal(kit.status, 0, kit.stderr);
    assert.ok(kit.stderr.includes(`${oneLiner} -s -- --layout kit`), kit.stderr);
    // The Test Kit's double-click path names its own file, not a terminal command.
    const cmd = run(['--from-command']);
    assert.equal(cmd.status, 0, cmd.stderr);
    assert.match(cmd.stderr, /INSTALL-2026\.1020\.0\.command 를 한 번 더 여세요/);
    // Negative control: a skipped seed says nothing about it.
    const skipped = run(['--no-seed']);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.doesNotMatch(skipped.stderr, /AI 코치 실행 파일/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('generated scripts pass shellcheck', {skip: spawnSync('shellcheck', ['--version']).status !== 0}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const tag = 'v2026.1020.0-rc.3';
    writeKit({...base, tag, seedName: 'claude-agent-sdk-darwin-arm64-0.3.299.tgz', seedSha256: H('b'), seederSha256: H('c')}, dir);
    execFileSync('unzip', ['-q', path.join(dir, kitZipName(tag)), '-d', dir]);
    const kit = path.join(dir, kitZipName(tag).replace(/\.zip$/, ''));
    const files = [path.join(dir, 'install-mac.sh'), ...fs.readdirSync(kit).filter(n => n.endsWith('.command') || n.endsWith('.sh')).map(n => path.join(kit, n))];
    assert.equal(files.length, 4);
    const r = spawnSync('shellcheck', ['-s', 'bash', ...files], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of files) assert.equal(fs.statSync(f).mode & 0o111, 0o111, `${f} is executable`);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
