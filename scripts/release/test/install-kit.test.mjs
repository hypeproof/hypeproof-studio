// Controls for the per-release Mac installer and Test Kit (scripts/release/install-kit.mjs).
//   node --test scripts/release/test/install-kit.test.mjs
// No network. The install runs (macOS only) use a synthetic app zip, a scratch HOME and
// the HPS_INSTALL_ASSET_DIR seam, so they never touch a real ~/Applications or /Applications.
import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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
  assert.ok(script.includes(renderStart('v2026.1020.0', SRC).trimEnd()));
});

test('malformed inputs never render a script', () => {
  for (const bad of [{tag: '2026.1020.0'}, {tag: 'v2026.1020'}, {sourceSha: 'abc'}, {zipSha256: H('A')}, {zipSha256: 'a'.repeat(63)},
    {appVersion: '2025.1.0'}, {seedName: 'claude-agent-sdk-win32-x64-0.3.299.tgz', seedSha256: H('b'), seederSha256: H('c')},
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

test('START uses durable storage and clears conflicting inherited overrides', () => {
  const start = renderStart('v2026.1020.0-rc.3', SRC);
  assert.ok(start.includes('$HOME/Applications/HypeProof-RC-2026.1020.0-rc.3/HypeProof Studio.app'));
  assert.ok(start.includes('$HOME/Library/Application Support/HPS-$VERSION'));
  const exec = start.split('\n').find(l => l.startsWith('exec '));
  assert.ok(!exec.includes('--use-inmemory-secretstorage'), 'never unconditional');
  assert.match(start, /unset VSCODE_PORTABLE VSCODE_APPDATA VSCODE_DEV VSCODE_CWD HPS_KIT_INMEMORY_SECRETS/);
  assert.match(start, /HPS-RC-Profiles\/\$VERSION/);
  assert.doesNotMatch(start, /EXTRA|--use-inmemory-secretstorage/);
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

function fakeAppZip(dir, {version, bundleId = 'ai.hypeproof.studio', source = SRC}) {
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
  fs.mkdirSync(path.join(app, 'Contents/Resources/app'), {recursive: true});
  fs.writeFileSync(path.join(app, 'Contents/Resources/app/product.json'), JSON.stringify({version, commit: source}));
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
    encoding: 'utf8', env: {PATH: process.env.PATH, HOME: home, HPS_INSTALL_ASSET_DIR: opts.assets, HPS_NO_INSTALL_PING: '1', ...env},
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

test('both installer entry points preserve quarantine and report macOS refusal without a bypass', {skip: !mac}, () => {
  for (const args of [[], ['--from-command']]) {
    const dir = tmp('hps-install-quarantine-');
    try {
      const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      const log = path.join(dir, 'xattr.log');
      const state = path.join(dir, 'synthetic-quarantine');
      const quarantine = '0083;synthetic-download;test-only';
      fs.writeFileSync(state, quarantine);
      // Entirely synthetic xattr: read queries return a modeled attribute; any
      // mutation would change the sentinel and fail this behavioral control.
      fs.writeFileSync(path.join(bin, 'xattr'), `#!/bin/sh
printf '%s\n' "$*" >> "$HPS_TEST_XATTR_LOG"
if [ "$1" = -p ]; then cat "$HPS_TEST_XATTR_STATE"; else printf 'mutated' > "$HPS_TEST_XATTR_STATE"; fi
`, {mode: 0o755});
      const result = install(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, args, {
        PATH: `${bin}:${process.env.PATH}`, HPS_TEST_XATTR_LOG: log, HPS_TEST_XATTR_STATE: state,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(state, 'utf8'), quarantine, 'existing quarantine remains byte-for-byte intact');
      const commands = fs.readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(commands.length, 1);
      assert.ok(commands.every(line => line.startsWith('-p com.apple.quarantine ')), 'only read diagnostics are allowed');
      assert.match(result.stderr, /macOS가 설치나 실행을 막으면 멈추고 오류 문구를 전달/);
      assert.doesNotMatch(result.stderr, /아래 한 줄 설치 명령을 쓰세요|격리.*지우/);
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  }
});

test('distribution instructions separate package verification from Apple launch approval', () => {
  const readme = renderReadme(base);
  const notes = notesSection(base.tag);
  assert.match(readme, /Apple 서명·공증 또는 macOS 실행 허용을 증명하지 않습니다/);
  assert.match(readme, /설치를 멈추고 보이는 오류 문구/);
  assert.match(notes, /do not establish Apple signing, notarization or Gatekeeper acceptance/);
  assert.doesNotMatch(`${readme}\n${notes}`, /macOS가 막지 않습니다|use the one-liner then|curl downloads are not quarantined/);
});

test('an -rc tag installs side by side with its own profile and START script', {skip: !mac}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const tag = 'v2026.1020.0-rc.3', v = '2026.1020.0-rc.3';
    const {assets, sha} = fakeAppZip(dir, {version: v});
    const r = install(dir, {tag, zipSha256: sha, assets});
    assert.equal(r.status, 0, r.stderr);
    const root = path.join(r.home, 'Applications', `HypeProof-RC-${v}`);
    const state = path.join(r.home, 'Library/Application Support', `HPS-RC-Profiles/${v}`);
    assert.equal(plistValue(path.join(root, 'HypeProof Studio.app'), 'CFBundleShortVersionString'), v);
    assert.ok(fs.existsSync(path.join(root, `.hps-kit-${v}`)));
    assert.ok(fs.existsSync(path.join(state, '.hps-rc-profile-v1')));
    assert.equal(fs.statSync(state).mode & 0o777, 0o700);
    assert.match(fs.readFileSync(path.join(state, 'User/settings.json'), 'utf8'), /"telemetry\.telemetryLevel": "off"/, 'VS Code telemetry stays off');
    assert.equal(fs.readFileSync(path.join(root, `START-${v}.command`), 'utf8'), renderStart(tag, SRC));
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

test('managed RC binds candidate tag, embedded app version and source, preserves legacy ciphertext, and launcher clears overrides', {skip: !mac}, () => {
  const dir = tmp('hps-install-rc-profile-');
  try {
    const tag = 'v2026.1024.0-rc.2', candidate = tag.slice(1), appVersion = '2026.1024.0';
    const old = path.join(dir, 'home/Library/Application Support', `HPS-${candidate}`);
    fs.mkdirSync(old, {recursive: true});
    fs.writeFileSync(path.join(old, `.hps-kit-${candidate}`), '');
    fs.writeFileSync(path.join(old, 'state.vscdb'), 'old production-namespace ciphertext');
    const {assets, sha} = fakeAppZip(dir, {version: appVersion});
    const opts = {tag, appVersion, zipSha256: sha, assets};
    const r = install(dir, opts);
    assert.equal(r.status, 0, r.stderr);
    const root = path.join(r.home, 'Applications', `HypeProof-RC-${candidate}`);
    const profile = path.join(r.home, 'Library/Application Support/HPS-RC-Profiles', candidate);
    const app = path.join(root, 'HypeProof Studio.app');
    const marker = ['hps-rc-profile-v1', 'HypeProof Studio RC', candidate, appVersion, SRC, app, profile, ''].join('\n');
    assert.equal(fs.readFileSync(path.join(profile, '.hps-rc-profile-v1'), 'utf8'), marker);
    assert.equal(fs.readFileSync(path.join(root, '.hps-rc-profile-v1'), 'utf8'), marker);
    assert.equal(fs.existsSync(path.join(profile, 'state.vscdb')), false);
    assert.equal(fs.readFileSync(path.join(old, 'state.vscdb'), 'utf8'), 'old production-namespace ciphertext');
    const exe = path.join(app, 'Contents/MacOS/HypeProof Studio');
    fs.writeFileSync(exe, `#!/bin/sh
printf '%s\n' "$@" > "$HOME/launch-args"
printf '%s\n' "\${VSCODE_PORTABLE-unset}" "\${VSCODE_APPDATA-unset}" "\${HPS_KIT_INMEMORY_SECRETS-unset}" > "$HOME/launch-env"
`, {mode: 0o755});
    const launcher = path.join(root, `START-${candidate}.command`);
    const launch = () => spawnSync('/bin/bash', [launcher], {encoding: 'utf8', env: {HOME: r.home, PATH: process.env.PATH, VSCODE_PORTABLE: '/old', VSCODE_APPDATA: '/old', HPS_KIT_INMEMORY_SECRETS: '1'}});
    const started = launch();
    assert.equal(started.status, 0, started.stderr);
    assert.equal(fs.readFileSync(path.join(r.home, 'launch-env'), 'utf8'), 'unset\nunset\nunset\n');
    assert.ok(fs.readFileSync(path.join(r.home, 'launch-args'), 'utf8').includes(`--user-data-dir=${profile}\n`));
    fs.unlinkSync(path.join(r.home, 'launch-args'));
    fs.appendFileSync(path.join(profile, '.hps-rc-profile-v1'), '\n');
    assert.notEqual(launch().status, 0, 'malformed marker does not execute app');
    assert.equal(fs.existsSync(path.join(r.home, 'launch-args')), false);
    assert.notEqual(install(dir, opts).status, 0, 'installer also rejects extra marker lines');
    assert.equal(fs.readFileSync(path.join(old, 'state.vscdb'), 'utf8'), 'old production-namespace ciphertext');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('RC refuses unmarked pre-existing dedicated profile and mismatched source without changing either', {skip: !mac}, () => {
  for (const reason of ['profile', 'source']) {
    const dir = tmp('hps-install-rc-negative-');
    try {
      const tag = 'v2026.1024.0-rc.2', appVersion = '2026.1024.0';
      const {assets, sha} = fakeAppZip(dir, {version: appVersion, source: reason === 'source' ? 'b'.repeat(40) : SRC});
      const profile = path.join(dir, 'home/Library/Application Support/HPS-RC-Profiles', tag.slice(1));
      if (reason === 'profile') {
        fs.mkdirSync(profile, {recursive: true});
        fs.writeFileSync(path.join(profile, 'state.vscdb'), 'existing ciphertext');
      }
      const result = install(dir, {tag, appVersion, zipSha256: sha, assets});
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(path.join(result.home, 'Applications', `HypeProof-RC-${tag.slice(1)}`, 'HypeProof Studio.app')), false);
      if (reason === 'profile') assert.equal(fs.readFileSync(path.join(profile, 'state.vscdb'), 'utf8'), 'existing ciphertext');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  }
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
      return spawnSync('/bin/bash', [path.join(out, 'install-mac.sh'), ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: home, HPS_INSTALL_ASSET_DIR: assets, HPS_NO_INSTALL_PING: '1'}});
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

// ── Install outcome ping (CONV-INSTALL-R-003, PRA-15) ──────────────────────
// A local stub stands in for POST /v1/install/events. The install runs asynchronously so the
// stub can answer while the script waits on it.
const PING_KEYS = ['app_version', 'os', 'result', 'step'];
const FAIL_STEPS = new Set(['preflight', 'dependencies', 'download', 'verify', 'extract', 'place', 'launch', 'other']);

async function pingStub(mode = 204) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      requests.push({method: req.method, url: req.url, type: req.headers['content-type'], body});
      if (mode === 'hang') return; // never answers: the script's own timeout must end the wait
      res.writeHead(mode).end(mode === 204 ? undefined : '{"error":"x"}');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1/install/events`;
  return {requests, url, close: () => { server.closeAllConnections(); return new Promise(r => server.close(r)); }};
}

function installAsync(dir, opts, args = [], env = {}) {
  const out = path.join(dir, 'out');
  fs.rmSync(out, {recursive: true, force: true});
  writeKit({sourceSha: SRC, ...opts}, out);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, {recursive: true});
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [path.join(out, 'install-mac.sh'), '--no-seed', ...args], {
      env: {PATH: process.env.PATH, HOME: home, HPS_INSTALL_ASSET_DIR: opts.assets, ...env},
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', status => resolve({status, stdout, stderr, home, ms: Date.now() - started}));
  });
}

function assertPing(req, result, step, version) {
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/install/events');
  assert.equal(req.type, 'application/json');
  assert.ok(Buffer.byteLength(req.body) <= 256, req.body);
  const body = JSON.parse(req.body);
  assert.deepEqual(Object.keys(body).sort(), PING_KEYS, 'exactly the four allowed fields');
  assert.deepEqual(body, {result, step, os: 'macos', app_version: version});
}

test('the default ping target is production and nothing else is contacted for it', () => {
  const script = renderInstaller(base);
  assert.ok(script.includes('${HPS_INSTALL_PING_URL:-https://api.hypeproof-ai.xyz}'));
  assert.ok(script.includes('*/v1/install/events) ;; *) url="$url/v1/install/events"'), 'a base URL gets the endpoint path');
  assert.match(script, /curl -q /, '-q ignores ~\/.curlrc');
  assert.equal(script.match(/install_ping (ok|fail) /g).length, 3, 'success, fail() and the exit trap');
  assert.match(script, /--max-time 3/);
});

test('one ok ping after a successful install, with only the allowed fields', {skip: !mac}, async () => {
  const dir = tmp('hps-install-ping-');
  const stub = await pingStub(204);
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0-rc.3'});
    const r = await installAsync(dir, {tag: 'v2026.1020.0-rc.3', zipSha256: sha, assets}, ['--layout', 'app'], {HPS_INSTALL_PING_URL: stub.url});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stub.requests.length, 1, JSON.stringify(stub.requests));
    assertPing(stub.requests[0], 'ok', 'done', '2026.1020.0-rc.3');
  } finally { await stub.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a base URL works as well as the full endpoint, and a ~/.curlrc retry adds no request', {skip: !mac}, async () => {
  const dir = tmp('hps-install-ping-');
  const stub = await pingStub(500);
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    const baseUrl = stub.url.replace(/\/v1\/install\/events$/, '/');
    // A retrying ~/.curlrc in the scratch HOME: without -q one 500 would become several POSTs.
    fs.mkdirSync(path.join(dir, 'home'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'home/.curlrc'), 'retry = 3\nretry-all-errors\nretry-delay = 0\n');
    const r = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], {HPS_INSTALL_PING_URL: baseUrl});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stub.requests.length, 1, JSON.stringify(stub.requests));
    assertPing(stub.requests[0], 'ok', 'done', '2026.1020.0');
  } finally { await stub.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('one fail ping naming the step where the install stopped', {skip: !mac}, async () => {
  const dir = tmp('hps-install-ping-');
  const stub = await pingStub(204);
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    const wrong = sha.slice(0, -1) + (sha.endsWith('0') ? '1' : '0');
    const env = {HPS_INSTALL_PING_URL: stub.url};
    const cases = [
      ['verify', () => installAsync(dir, {tag: 'v2026.1020.0', zipSha256: wrong, assets}, [], env)],
      ['download', () => installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets: path.join(dir, 'missing')}, [], env)],
      ['preflight', () => installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], {...env, HPS_INSTALL_UNAME_M: 'x86_64'})],
      ['preflight', () => installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, ['--bogus'], env)],
    ];
    for (const [step, run] of cases) {
      stub.requests.length = 0;
      const r = await run();
      assert.equal(r.status, 1, `${step}: ${r.stderr}`);
      assert.equal(stub.requests.length, 1, `${step}: exactly one ping, got ${JSON.stringify(stub.requests)}`);
      assert.ok(FAIL_STEPS.has(step));
      assertPing(stub.requests[0], 'fail', step, '2026.1020.0');
    }
    // --help is not an install attempt.
    stub.requests.length = 0;
    const help = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, ['--help'], env);
    assert.equal(help.status, 0);
    assert.equal(stub.requests.length, 0);
  } finally { await stub.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('HPS_NO_INSTALL_PING=1 sends nothing, on success or failure', {skip: !mac}, async () => {
  const dir = tmp('hps-install-ping-');
  const stub = await pingStub(204);
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    const env = {HPS_INSTALL_PING_URL: stub.url, HPS_NO_INSTALL_PING: '1'};
    const ok = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], env);
    assert.equal(ok.status, 0, ok.stderr);
    const bad = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: 'f'.repeat(64), assets}, [], env);
    assert.equal(bad.status, 1);
    assert.equal(stub.requests.length, 0, JSON.stringify(stub.requests));
    // Positive control: the same stub, without the switch, does receive the ping.
    const sent = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], {HPS_INSTALL_PING_URL: stub.url});
    assert.equal(sent.status, 0, sent.stderr);
    assert.equal(stub.requests.length, 1, 'the stub is reachable, so zero above means skipped');
  } finally { await stub.close(); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a refused, failing or silent ping never changes the exit code', {skip: !mac}, async () => {
  const dir = tmp('hps-install-ping-');
  try {
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    const wrong = 'f'.repeat(64);
    for (const mode of [404, 500, 'hang']) {
      const stub = await pingStub(mode);
      try {
        const env = {HPS_INSTALL_PING_URL: stub.url};
        const ok = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], env);
        assert.equal(ok.status, 0, `${mode}: ${ok.stderr}`);
        assert.match(ok.stdout, /설치를 마쳤습니다/);
        const bad = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: wrong, assets}, [], env);
        assert.equal(bad.status, 1, `${mode}: ${bad.stderr}`);
        assert.equal(stub.requests.length, 2, `${mode}: one ping per run`);
        if (mode === 'hang') assert.ok(ok.ms < 15000 && bad.ms < 15000, `bounded by --max-time (${ok.ms}, ${bad.ms} ms)`);
      } finally { await stub.close(); }
    }
    // Nothing listening at all.
    const closed = await pingStub(204);
    const url = closed.url;
    await closed.close();
    const r = await installAsync(dir, {tag: 'v2026.1020.0', zipSha256: sha, assets}, [], {HPS_INSTALL_PING_URL: url});
    assert.equal(r.status, 0, r.stderr);
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
