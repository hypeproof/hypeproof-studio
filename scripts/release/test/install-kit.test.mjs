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
import test, {after} from 'node:test';
import {
  KIT_ZIP_RE, isFreeStart, kitDirName, kitZipName, notesSection, oneLiner, renderInstaller, renderReadme,
  renderStart, withInstallSection, writeKit, verifyMacArchive,
  WINDOWS_UPDATER_NAME, announcement, installProblems, renderWindowsUpdater, windowsNotesSection, windowsOneLiner,
  writeWindowsUpdater,
} from '../install-kit.mjs';
import {expectedAppVersion, buildTagMessage} from '../build-contract.mjs';
import {isAppPackage} from '../../../e2e/unified-release/artifact.mjs';

// Candidate-policy fixtures must work in CI's shallow checkout without remote refs.
const policyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-policy-git-'));
const policyGit = (...args) => execFileSync('git', ['-C', policyRepo, ...args], {encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
policyGit('init', '-q');
policyGit('config', 'user.name', 'Installer fixture');
policyGit('config', 'user.email', 'installer-fixture@example.invalid');
policyGit('commit', '--allow-empty', '-qm', 'legacy candidate');
const SRC = policyGit('rev-parse', 'HEAD');
fs.mkdirSync(path.join(policyRepo, 'config'));
fs.copyFileSync(new URL('../../../config/macos-distribution.json', import.meta.url), path.join(policyRepo, 'config/macos-distribution.json'));
policyGit('add', 'config/macos-distribution.json');
policyGit('commit', '-qm', 'official candidate');
const officialSource = policyGit('rev-parse', 'HEAD');
const savedGitEnv = {GIT_DIR:process.env.GIT_DIR, GIT_WORK_TREE:process.env.GIT_WORK_TREE};
process.env.GIT_DIR = path.join(policyRepo, '.git');
process.env.GIT_WORK_TREE = policyRepo;
after(() => {
  for (const [key,value] of Object.entries(savedGitEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  fs.rmSync(policyRepo, {recursive:true, force:true});
});
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

function fakeAppZip(dir, {version, bundleId = 'ai.hypeproof.studio', commit = SRC}) {
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
  fs.writeFileSync(path.join(app, 'Contents/Resources/app/product.json'), JSON.stringify({version, commit, quality: 'stable'}));
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

test('an -rc tag installs side by side with its own profile and START script', {skip: !mac}, () => {
  const dir = tmp('hps-install-kit-');
  try {
    const tag = 'v2026.1020.0-rc.3', v = '2026.1020.0-rc.3';
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    const r = install(dir, {tag, productVersion: '2026.1020.0', zipSha256: sha, assets});
    assert.equal(r.status, 0, r.stderr);
    const root = path.join(r.home, 'Applications', `HypeProof-RC-${v}`);
    const state = path.join(r.home, 'Library/Application Support', `HPS-${v}`);
    assert.equal(plistValue(path.join(root, 'HypeProof Studio.app'), 'CFBundleShortVersionString'), '2026.1020.0');
    assert.ok(fs.existsSync(path.join(root, `.hps-kit-${v}`)));
    assert.ok(fs.existsSync(path.join(state, `.hps-kit-${v}`)));
    assert.equal(fs.statSync(state).mode & 0o777, 0o700);
    assert.match(fs.readFileSync(path.join(state, 'User/settings.json'), 'utf8'), /"telemetry\.telemetryLevel": "off"/, 'VS Code telemetry stays off');
    assert.equal(fs.readFileSync(path.join(root, `START-${v}.command`), 'utf8'), renderStart(tag));
    assert.equal(fs.existsSync(path.join(r.home, 'Applications/HypeProof Studio.app')), false, 'the main install is untouched');
    // Re-running over its own kit is allowed.
    assert.equal(install(dir, {tag, productVersion: '2026.1020.0', zipSha256: sha, assets}).status, 0);
    // A folder the kit did not make is never overwritten.
    const other = tmp('hps-install-kit-');
    try {
      fs.mkdirSync(path.join(other, 'home/Applications', `HypeProof-RC-${v}`), {recursive: true});
      const refused = install(other, {tag, productVersion: '2026.1020.0', zipSha256: sha, assets});
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
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1020.0'});
    const r = await installAsync(dir, {tag: 'v2026.1020.0-rc.3', productVersion: '2026.1020.0', zipSha256: sha, assets}, ['--layout', 'app'], {HPS_INSTALL_PING_URL: stub.url});
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


test('RC kit accepts the promotable base-version app and rejects a different source commit', {skip: !mac}, () => {
  const dir = tmp('hps-rc-product-contract-');
  try {
    const tag = 'v2026.1101.0-rc.1';
    const {assets, sha} = fakeAppZip(dir, {version: '2026.1101.0'});
    const good = install(dir, {tag, productVersion: '2026.1101.0', zipSha256: sha, assets});
    assert.equal(good.status, 0, good.stderr);
    const app = path.join(good.home, 'Applications/HypeProof-RC-2026.1101.0-rc.1/HypeProof Studio.app');
    assert.equal(plistValue(app, 'CFBundleShortVersionString'), '2026.1101.0');
    const foreign = fakeAppZip(dir, {version: '2026.1101.0', commit: 'f'.repeat(40)});
    const bad = install(dir, {tag, productVersion: '2026.1101.0', zipSha256: foreign.sha, assets: foreign.assets});
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /소스 커밋/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/app/product.json'), 'utf8')).commit, SRC);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});


function portableMacZip(dir, identity = {}) {
  const zip = path.join(dir, 'portable-mac.zip');
  execFileSync('python3', ['-c', `
import json, plistlib, sys, zipfile
p = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('HypeProof Studio.app/Contents/Info.plist', plistlib.dumps({'CFBundleIdentifier': p['bundleId'], 'CFBundleShortVersionString': p['plistVersion']}))
    z.writestr('HypeProof Studio.app/Contents/Resources/app/product.json', json.dumps({'version': p['productVersion'], 'commit': p['sourceSha']}))
`, zip, JSON.stringify({bundleId: 'ai.hypeproof.studio', plistVersion: '2026.1101.0', productVersion: '2026.1101.0', sourceSha: SRC, ...identity})]);
  return {zip, opts: {tag: 'v2026.1101.0-rc.1', productVersion: '2026.1101.0', sourceSha: SRC, zipSha256: sha256(zip)}};
}

test('accepted archive identity is checked on Linux too: RC base version, source, bundle and digest', () => {
  const dir = tmp('hps-portable-mac-identity-');
  try {
    let fixture = portableMacZip(dir);
    assert.equal(verifyMacArchive(fixture.opts, fixture.zip).plistVersion, '2026.1101.0');
    assert.equal(verifyMacArchive({...fixture.opts, tag: 'v2026.1101.0'}, fixture.zip).sourceSha, SRC);
    assert.throws(() => verifyMacArchive({...fixture.opts, zipSha256: H('f')}, fixture.zip), /SHA-256/);
    for (const identity of [{plistVersion:'2026.1101.0-rc.1'}, {productVersion:'2026.1030.0'}, {sourceSha:'f'.repeat(40)}, {bundleId:'com.example.foreign'}]) {
      fixture = portableMacZip(dir, identity);
      const output = path.join(dir, 'refused-kit');
      assert.throws(() => writeKit({...fixture.opts, macZip:fixture.zip}, output), /product identity/);
      assert.equal(fs.existsSync(output), false, 'no installer is generated for mismatched accepted bytes');
    }
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('public render command requires an accepted archive before writing an installer', () => {
  const dir = tmp('hps-render-requires-archive-');
  try {
    const fixture = portableMacZip(dir), out = path.join(dir, 'out');
    const args = [new URL('../install-kit.mjs', import.meta.url).pathname, 'render', '--tag', fixture.opts.tag, '--product-version', fixture.opts.productVersion, '--source-sha', SRC, '--zip-sha256', fixture.opts.zipSha256, '--out', out];
    const missing = spawnSync(process.execPath, args, {encoding:'utf8'});
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /--mac-zip is required/); assert.equal(fs.existsSync(out), false);
    const good = spawnSync(process.execPath, [...args, '--mac-zip', fixture.zip], {encoding:'utf8'});
    assert.equal(good.status, 0, good.stderr); assert.ok(fs.existsSync(path.join(out, 'install-mac.sh')));
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});


test('renderer follows the existing build contract for marked and legacy RCs', () => {
  const dir = tmp('hps-kit-build-contract-');
  try {
    const tag = 'v2026.1101.0-rc.1';
    const plan = {candidate:SRC, rcTag:tag, version:'v2026.1101.0'};
    const cases = [
      {message:'', version:'2026.1101.0-rc.1'},
      {message:buildTagMessage(plan), version:'2026.1101.0'},
      {message:buildTagMessage(plan,{managedDraft:true}), version:'2026.1101.0'},
    ];
    for (const {message, version} of cases) {
      const productVersion = expectedAppVersion(tag, message);
      assert.equal(productVersion, version);
      const fixture = portableMacZip(dir, {plistVersion:version, productVersion:version});
      const opts = {...fixture.opts, productVersion};
      assert.equal(verifyMacArchive(opts, fixture.zip).productVersion, version);
      assert.ok(renderInstaller(opts).includes(`HPS_PRODUCT_VERSION="${version}"`));
    }
    assert.throws(()=>renderInstaller({...base,productVersion:'2026.1102.0'}), /does not belong/);
    const script = renderInstaller({...base,tag});
    assert.ok(script.includes('HPS_PRODUCT_VERSION="2026.1101.0-rc.1"'), 'programmatic legacy default remains compatible');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// ── Windows update command (update-windows.cmd, 2026-11-02) ─────────────────
const EXE = 'HypeProof.StudioUserSetup-x64-1.116.07355.exe';
const winBase = {tag: 'v2026.1102.3', exeName: EXE, exeSha256: H('d')};
const PS_TAIL = /\r?\n#PS#\r?\n/;

test('update-windows.cmd is CRLF, pinned to the tag and exe SHA-256, and splits once at the marker', () => {
  const cmd = renderWindowsUpdater(winBase);
  assert.ok(!cmd.includes('@@'));
  assert.equal(cmd.replace(/\r\n/g, '').includes('\n'), false, 'every line ends in CRLF');
  assert.match(cmd, /^\$Tag = 'v2026\.1102\.3'\r$/m);
  assert.match(cmd, new RegExp(`^\\$Exe = '${EXE.replaceAll('.', '\\.')}'\\r$`, 'm'));
  assert.match(cmd, new RegExp(`^\\$Sha = '${H('d')}'\\r$`, 'm'));
  assert.ok(cmd.includes('/VERYSILENT') && cmd.includes('/MERGETASKS=!runcode'));
  // #3412 split at the first "#PS#", which a comment also contained, and ran the cmd header as PowerShell.
  const parts = cmd.split(PS_TAIL);
  assert.equal(parts.length, 2, 'exactly one marker line');
  assert.ok(parts[1].startsWith('[Console]::OutputEncoding'));
  assert.ok(parts[0].includes("-split '\\r?\\n#PS#\\r?\\n', 2"), 'the cmd header splits on the line-anchored marker');
  assert.throws(() => renderWindowsUpdater({...winBase, exeName: "HypeProof.StudioUserSetup-x64-1'; calc.exe"}), /per-user installer/);
  assert.throws(() => renderWindowsUpdater({...winBase, exeName: 'HypeProof.StudioSetup-x64-1.116.07355.exe'}), /per-user installer/);
  assert.throws(() => renderWindowsUpdater({...winBase, exeSha256: 'abc'}), /sha256/);
  assert.throws(() => renderWindowsUpdater({...winBase, tag: 'latest'}), /release tag/);
});

test('render-windows hashes the accepted installer it is given', () => {
  const dir = tmp('hps-win-kit-');
  try {
    const exe = path.join(dir, EXE);
    fs.writeFileSync(exe, 'accepted installer bytes');
    assert.deepEqual(writeWindowsUpdater({tag: 'v2026.1102.3', userSetup: exe}, path.join(dir, 'out')), [WINDOWS_UPDATER_NAME]);
    const cmd = fs.readFileSync(path.join(dir, 'out', WINDOWS_UPDATER_NAME), 'utf8');
    assert.ok(cmd.includes(`$Sha = '${sha256(exe)}'`));
    assert.equal(isAppPackage(WINDOWS_UPDATER_NAME), false, 'the acceptance receipts never count the updater');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// The section Jay added by hand to v2026.1102.2 (2026-11-02): the generated one keeps its markers,
// asset name and PowerShell form, and replaces it instead of duplicating it.
const HAND_MADE = [
  '<!-- hps-install-windows:v1 -->', '## Install or update on Windows (x64)', '',
  'Double-click [`update-windows.cmd`](https://github.com/hypeproof/hypeproof-studio/releases/download/v2026.1102.3/update-windows.cmd)', '',
  '```powershell', 'irm https://github.com/hypeproof/hypeproof-studio/releases/download/v2026.1102.3/update-windows.cmd -OutFile "$env:TEMP\\hps-update.cmd"; & "$env:TEMP\\hps-update.cmd"', '```',
  '<!-- /hps-install-windows:v1 -->',
].join('\n');

test('release notes carry the Mac and Windows commands once, Mac first', () => {
  const tag = 'v2026.1102.3';
  assert.equal(windowsOneLiner(tag), HAND_MADE.split('\n')[6]);
  const both = withInstallSection(`${HAND_MADE}\n\n## What's Changed\n- x\n`, tag, {mac: true, windows: true});
  assert.ok(both.startsWith('<!-- hps-install-mac:v1 -->'));
  assert.equal(both.split('<!-- hps-install-windows:v1 -->').length, 2);
  assert.ok(both.indexOf('hps-install-mac:v1') < both.indexOf('hps-install-windows:v1'));
  assert.ok(both.indexOf('<!-- /hps-install-windows:v1 -->') < both.indexOf("## What's Changed"));
  assert.ok(both.includes(windowsOneLiner(tag)) && both.includes(oneLiner(tag)));
  assert.equal(withInstallSection(both, tag, {mac: true, windows: true}), both);
  const winOnly = withInstallSection(both, tag, {mac: false, windows: true});
  assert.ok(winOnly.startsWith('<!-- hps-install-windows:v1 -->') && !winOnly.includes('hps-install-mac'));
  assert.match(windowsNotesSection('v2026.1102.3-rc.1'), /over the installed HypeProof Studio/);
});

test('a release whose platform lacks its installer or notes command cannot publish', () => {
  const tag = 'v2026.1102.3';
  const body = withInstallSection('## What changed\n', tag, {mac: true, windows: true});
  const assets = [{name: 'install-mac.sh'}, {name: WINDOWS_UPDATER_NAME}];
  const both = ['darwin-arm64', 'win32-x64'];
  assert.deepEqual(installProblems({tag, platforms: both, body, assets}), []);
  assert.match(installProblems({tag, platforms: both, body, assets: assets.slice(0, 1)}).join('\n'), /Windows: release asset update-windows\.cmd is missing/);
  assert.match(installProblems({tag, platforms: both, body: withInstallSection(body, tag), assets}).join('\n'), /Windows: the release notes lack/);
  assert.match(installProblems({tag, platforms: both, body: withInstallSection(body, tag, {mac: false, windows: true}), assets}).join('\n'), /macOS: the release notes lack/);
  assert.deepEqual(installProblems({tag, platforms: ['darwin-arm64'], body: withInstallSection('', tag), assets: assets.slice(0, 1)}), []);
  // A section pinned to another tag does not count.
  assert.match(installProblems({tag: 'v2026.1102.4', platforms: both, body, assets}).join('\n'), /lack/);
});

test('the announcement leads with both commands', () => {
  const tag = 'v2026.1102.3';
  const text = announcement(withInstallSection("## What's Changed\n* a\n", tag, {mac: true, windows: true}), tag);
  const lines = text.split('\n');
  assert.equal(lines[0], `Install / update ${tag}`);
  assert.equal(lines[2], oneLiner(tag));
  assert.equal(lines[4], windowsOneLiner(tag));
  assert.ok(!text.includes('<!--') && text.includes("## What's Changed"));
  assert.ok(lines.slice(0, 5).join('\n').length < 700, 'survives the 800-character Discord template truncation');
  assert.equal(announcement('## Notes\n', tag), '## Notes\n');
});

// Runs the PowerShell part the way the .cmd does, with the asset-dir seam and dry run, so it never
// closes or installs anything. Skipped where pwsh is absent; GitHub's Ubuntu and macOS images have it.
const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], {encoding: 'utf8'}).status === 0;
test('update-windows.cmd verifies the pinned installer before running it', {skip: !pwsh && 'pwsh not installed'}, () => {
  const dir = tmp('hps-win-run-');
  try {
    const assets = path.join(dir, 'assets');
    fs.mkdirSync(assets);
    const exe = path.join(assets, EXE);
    fs.writeFileSync(exe, 'accepted installer bytes');
    writeWindowsUpdater({tag: 'v2026.1102.3', userSetup: exe}, dir);
    const run = () => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      "$s = [IO.File]::ReadAllText($env:HPS_SELF, [Text.Encoding]::UTF8); iex ($s -split '\\r?\\n#PS#\\r?\\n', 2)[1]"], {
      encoding: 'utf8', env: {...process.env, HPS_SELF: path.join(dir, WINDOWS_UPDATER_NAME), HPS_INSTALL_ASSET_DIR: assets, HPS_INSTALL_DRY_RUN: '1', TMPDIR: dir, TEMP: dir},
    });
    const good = run();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /DRY RUN: .*HypeProof\.StudioUserSetup-x64-1\.116\.07355\.exe \/VERYSILENT \/SUPPRESSMSGBOXES \/NORESTART \/MERGETASKS=!runcode/);
    fs.writeFileSync(exe, 'tampered bytes');
    const bad = run();
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /SHA-256 불일치/);
    assert.doesNotMatch(bad.stdout, /DRY RUN/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('release workflows render, check and announce the Windows command', () => {
  const read = name => fs.readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');
  const verify = read('verify-unified-release.yml');
  assert.match(verify, /install-kit\.mjs render-windows --tag "\$TAG" --user-setup/);
  assert.match(verify, /install-kit\.mjs notes --tag "\$TAG" "\$\{sections\[@\]\}"/);
  // The check runs before the draft is published.
  const publish = verify.indexOf('--draft=false');
  const check = verify.indexOf('install-kit.mjs check --tag "$TAG"');
  assert.ok(check > 0 && check < publish, 'install command check precedes publication');
  assert.match(read('notify-release-published.yml'), /install-kit\.mjs announce --tag "\$TAG"/);
  assert.match(read('mirror-release.yml'), /dist\/update-windows\.cmd/);
});

// Real Bash/filesystem controls with explicit Apple/transport fixture doubles.
// These prove refusal/placement, never actual signed-app acceptance.
const root = new URL('../../../', import.meta.url);
const sourceSha = officialSource;
const legacySha = SRC;
const version = '2026.1112.0';
const opts = {tag:`v${version}`, sourceSha, zipSha256:'a'.repeat(64)};

test('candidate policy is baked in, cannot be disabled by options, and unreadable source fails closed', () => {
  assert.match(renderInstaller({...opts, officialSigning:false}), /^HPS_OFFICIAL_SIGNING="1"$/m);
  assert.match(renderInstaller({...opts, sourceSha:legacySha}), /^HPS_OFFICIAL_SIGNING="0"$/m);
  assert.throws(() => renderInstaller({...opts, sourceSha:'f'.repeat(40)}));
  for (const script of [renderInstaller(opts), fs.readFileSync(new URL('scripts/install-mac.sh',root),'utf8')]) {
    assert.doesNotMatch(script, /xattr\s+-[a-z]*d/);
    assert.equal(spawnSync('bash',['-n'],{input:script}).status,0);
  }
});

const tool = String.raw`#!/usr/bin/env python3
import hashlib,json,os,pathlib,plistlib,shutil,subprocess,sys,zipfile
name=pathlib.Path(sys.argv[0]).name; a=sys.argv[1:]; base=pathlib.Path(os.environ['FIXTURE'])
def event(s):
 with (base/'events').open('a') as f: f.write(s+'\n')
def trust(app): return json.loads((pathlib.Path(app)/'Contents/trust.json').read_text())
def corrupt(dest):
 p=pathlib.Path(dest)
 if os.environ.get('TAMPER_STAGE')=='1' and '.hps-install' in str(p):
  j=p/'Contents/trust.json'
  if j.exists(): d=json.loads(j.read_text());d['signature']=False;j.write_text(json.dumps(d))
if name=='uname': print('Darwin' if '-s' in a else 'arm64')
elif name=='id': print('1000')
elif name=='pgrep': sys.exit(1)
elif name=='PlistBuddy':
 d=plistlib.loads(pathlib.Path(a[-1]).read_bytes());print(d[a[1].split()[-1].lstrip(':')])
elif name=='plutil': print(json.loads(pathlib.Path(a[-1]).read_text())[a[1]])
elif name=='codesign':
 event('codesign '+a[-1]);d=trust(a[-1]);ok=d.get('signature',True)
 if any(v.startswith('-R=') for v in a):
  req=next(v for v in a if v.startswith('-R='))
  ok=ok and all(v in req for v in ['ai.hypeproof.studio','RZBNT9ZB67','anchor apple generic','1.2.840.113635.100.6.2.6','1.2.840.113635.100.6.1.13']) and d['team']=='RZBNT9ZB67' and d['developer_id']
 assert '--strict' in a and '--all-architectures' in a
 sys.exit(0 if ok else 1)
elif name=='spctl':
 event('spctl '+a[-1]);mode=trust(a[-1]).get('assessment','notarized')
 if mode=='rejected': print('rejected',file=sys.stderr);sys.exit(1)
 if mode=='notarized': print('accepted\nsource=Notarized Developer ID',file=sys.stderr)
 elif mode=='spoof': print('source=Notarized Developer ID\nsource=Developer ID',file=sys.stderr)
 elif mode=='disabled': print('assessments disabled',file=sys.stderr)
 else: print('accepted\nsource=Developer ID',file=sys.stderr)
elif name=='ditto':
 if a[0]=='-xk':
  with zipfile.ZipFile(a[1]) as z:z.extractall(a[2])
 else: shutil.copytree(a[0],a[1]);corrupt(a[1])
elif name=='cp':
 r=subprocess.run(['/bin/cp',*a]);
 if r.returncode:sys.exit(r.returncode)
 corrupt(a[-1])
elif name=='mv':
 event('mv '+a[0]+' -> '+a[1])
 if os.environ.get('FAIL_SWAP')=='1' and '.hps-install' in a[0] and not a[0].endswith('/previous.app') and a[1].endswith('/HypeProof Studio.app'):sys.exit(1)
 sys.exit(subprocess.run(['/bin/mv',*a]).returncode)
elif name=='gh':
 if a[0]=='api':
  if '.tag_name' in a: print('v2026.1112.0')
  else:
   z=base/'assets/HypeProof-Studio-darwin-arm64.zip';print(z.name+'\tsha256:'+hashlib.sha256(z.read_bytes()).hexdigest())
 else:shutil.copy(base/'assets/HypeProof-Studio-darwin-arm64.zip',a[a.index('--dir')+1])
elif name=='open':event('open '+a[0])
elif name=='xattr':event('QUARANTINE MODIFIED');sys.exit(99)
else:raise RuntimeError(name)
`;

function scenario(kind, change={}, env={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mac-installer-signing-'));
  try {
    const home=path.join(dir,'home'), bin=path.join(dir,'bin'), assets=path.join(dir,'assets');
    for(const p of [home,bin,assets])fs.mkdirSync(p,{recursive:true});
    const payload={bundle:'ai.hypeproof.studio',signature:true,team:'RZBNT9ZB67',developer_id:true,assessment:'notarized',...change};
    const zip=path.join(assets,'HypeProof-Studio-darwin-arm64.zip');
    execFileSync('python3',['-c',String.raw`
import json,plistlib,sys,zipfile
p=json.loads(sys.argv[2]);v=sys.argv[3];sha=sys.argv[4];prefix='HypeProof Studio.app/Contents/'
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr(prefix+'Info.plist',plistlib.dumps({'CFBundleIdentifier':p['bundle'],'CFBundleShortVersionString':v}))
 z.writestr(prefix+'Resources/app/product.json',json.dumps({'version':v,'commit':sha}))
 z.writestr(prefix+'trust.json',json.dumps(p));z.writestr(prefix+'new.txt','new payload')
`,zip,JSON.stringify(payload),version,sourceSha]);
    for(const name of ['uname','id','pgrep','PlistBuddy','plutil','codesign','spctl','ditto','cp','mv','gh','open','xattr'])fs.writeFileSync(path.join(bin,name),tool,{mode:0o755});
    const system=path.join(dir,'Applications');fs.mkdirSync(system);
    const target=path.join(kind==='bootstrap'?system:path.join(home,'Applications'),'HypeProof Studio.app');
    fs.mkdirSync(path.join(target,'Contents'),{recursive:true});
    fs.writeFileSync(path.join(target,'old.txt'),'preserve old');
    execFileSync('python3',['-c','import plistlib,sys;open(sys.argv[1],"wb").write(plistlib.dumps({"CFBundleIdentifier":"ai.hypeproof.studio"}))',path.join(target,'Contents/Info.plist')]);
    const digest=execFileSync('shasum',['-a','256',zip],{encoding:'utf8'}).split(' ')[0];
    let script=kind==='bootstrap'?fs.readFileSync(new URL('scripts/install-mac.sh',root),'utf8'):renderInstaller({...opts,zipSha256:digest});
    for(const [original,name] of [['/usr/libexec/PlistBuddy','PlistBuddy'],['/usr/bin/plutil','plutil'],['/usr/bin/codesign','codesign'],['/usr/sbin/spctl','spctl']])script=script.replaceAll(original,path.join(bin,name));
    if(kind==='bootstrap')script=script.replaceAll('/Applications',system);
    const entry=path.join(dir,'install.sh');fs.writeFileSync(entry,script);
    const run=spawnSync('/bin/bash',[entry,...(kind==='bootstrap'?[]:['--no-seed'])],{encoding:'utf8',env:{PATH:bin+':'+process.env.PATH,HOME:home,FIXTURE:dir,HPS_INSTALL_ASSET_DIR:assets,HPS_NO_INSTALL_PING:'1',...env}});
    const events=fs.existsSync(path.join(dir,'events'))?fs.readFileSync(path.join(dir,'events'),'utf8'):'';
    assert.doesNotMatch(events,/QUARANTINE MODIFIED/);
    return {status:run.status,output:run.stdout+run.stderr,old:fs.existsSync(path.join(target,'old.txt')),fresh:fs.existsSync(path.join(target,'Contents/new.txt')),events};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

for(const kind of ['bootstrap','tagged']) {
  test(`${kind}: only valid official identity reaches replacement; security failures preserve old app`,()=>{
    const good=scenario(kind);
    assert.equal(good.status,0,good.output);assert.equal(good.old,false);assert.equal(good.fresh,true);
    assert.equal((good.events.match(/^spctl /gm)||[]).length,2,'extracted and final staged copy assessed');
    for(const change of [{signature:false},{team:'OTHERTEAM1'},{developer_id:false},{bundle:'com.other.app'},{assessment:'rejected'},{assessment:'unnotarized'},{assessment:'disabled'},{assessment:'spoof'}]) {
      const bad=scenario(kind,change);
      assert.notEqual(bad.status,0,JSON.stringify(change));assert.equal(bad.old,true);assert.equal(bad.fresh,false);
      assert.doesNotMatch(bad.events,/^mv .*\.app(?: |$)|^open /m);
    }
  });
  test(`${kind}: staged tampering and swap failure preserve old app`,()=>{
    for(const env of [{TAMPER_STAGE:'1'},{FAIL_SWAP:'1'}]) {
      const bad=scenario(kind,{},env);
      assert.notEqual(bad.status,0,bad.output);assert.equal(bad.old,true,bad.output);assert.equal(bad.fresh,false);
      assert.doesNotMatch(bad.events,/^open /m);
    }
  });
}
