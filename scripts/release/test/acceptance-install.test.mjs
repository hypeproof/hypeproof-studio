// Controls for the install-path acceptance (#4074). No network, no installer is executed: the installer
// run and the renderer are injected, and the App/SDK trees are synthetic fixtures.
//   node --test scripts/release/test/acceptance-install.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installedAppPath, installerInvocation, previousStable, upgradeInstall, verifyInstalled, freshInstall, NOT_RUN_EXIT} from '../acceptance-install.mjs';

const MIN = 150 * 1024 * 1024; // sdk-seed.mjs sanity floor; sparse files keep this free
const SDK = '0.3.299';

// A synthetic installed Mac App (product.json + vendored SDK manifest) under a temp HOME.
function fixture({productVersion = '2026.1114.0', sdkVersion = SDK, seed = 'ok'} = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-acc-install-'));
  const app = installedAppPath('darwin-arm64', {home});
  const res = path.join(app, 'Contents/Resources/app');
  fs.mkdirSync(path.join(res, 'extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk'), {recursive: true});
  fs.writeFileSync(path.join(res, 'product.json'), JSON.stringify({version: productVersion}));
  fs.writeFileSync(path.join(res, 'extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk/package.json'), JSON.stringify({version: sdkVersion}));
  const dir = path.join(home, 'Library/Application Support/HypeProof-Studio/sdk', sdkVersion);
  if (seed !== 'absent') {
    fs.mkdirSync(dir, {recursive: true});
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '');
    fs.truncateSync(bin, seed === 'small' ? 1024 : MIN + 1);
    fs.chmodSync(bin, seed === 'not-executable' ? 0o644 : 0o755);
    const size = fs.statSync(bin).size;
    fs.writeFileSync(`${bin}.verified.json`, JSON.stringify({tarballSha512: 'sha512-AAAA', sdkVersion: seed === 'wrong-marker' ? '0.0.1' : sdkVersion, size}));
  }
  return {home, app, cleanup: () => fs.rmSync(home, {recursive: true, force: true})};
}

test('verifyInstalled: an installed App with its trusted SDK passes', () => {
  const f = fixture();
  try {
    const r = verifyInstalled({platform: 'darwin-arm64', app: f.app, productVersion: '2026.1114.0', sdkVersion: SDK, home: f.home});
    assert.deepEqual([r.ok, r.reasons], [true, []]);
    assert.equal(r.evidence.sdk.version, SDK);
  } finally { f.cleanup(); }
});

// The #3865 control: the installer put the App in place and exited 0, but nothing seeded the SDK.
test('verifyInstalled: an App installed without its SDK fails, whatever the installer exit code was', () => {
  for (const seed of ['absent', 'small', 'not-executable', 'wrong-marker']) {
    const f = fixture({seed});
    try {
      const r = verifyInstalled({platform: 'darwin-arm64', app: f.app, productVersion: '2026.1114.0', sdkVersion: SDK, home: f.home});
      assert.equal(r.ok, false, seed);
      assert.match(r.reasons.join('\n'), /Agent SDK not usable after install/, seed);
    } finally { f.cleanup(); }
  }
});

test('verifyInstalled: wrong App version, a seed for another SDK version, an unreadable App', () => {
  const f = fixture();
  try {
    assert.match(verifyInstalled({platform: 'darwin-arm64', app: f.app, productVersion: '2026.1113.0', home: f.home}).reasons.join(), /installed App is 2026\.1114\.0, expected 2026\.1113\.0/);
    assert.match(verifyInstalled({platform: 'darwin-arm64', app: f.app, productVersion: '2026.1114.0', sdkVersion: '0.3.300', home: f.home}).reasons.join(), /release seeds 0\.3\.300/);
    assert.match(verifyInstalled({platform: 'darwin-arm64', app: path.join(f.home, 'nope'), productVersion: 'x', home: f.home}).reasons.join(), /no readable product\.json/);
  } finally { f.cleanup(); }
});

test('installedAppPath and installerInvocation: per-user locations, the outcome ping is always off', () => {
  assert.equal(installedAppPath('darwin-arm64', {home: '/h'}), path.join('/h', 'Applications', 'HypeProof Studio.app'));
  assert.equal(installedAppPath('win32-x64', {env: {LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local'}}), path.join('C:\\Users\\u\\AppData\\Local', 'Programs', 'HypeProof Studio'));
  assert.throws(() => installedAppPath('win32-x64', {env: {}}), /LOCALAPPDATA/);
  assert.throws(() => installedAppPath('linux-x64'), /unknown platform/);
  const mac = installerInvocation({platform: 'darwin-arm64', script: '/w/install-mac.sh', assetDir: '/w/assets'});
  assert.deepEqual([mac.command, mac.args], ['bash', ['/w/install-mac.sh', '--layout', 'app']]);
  assert.deepEqual(mac.env, {HPS_NO_INSTALL_PING: '1', HPS_INSTALL_ASSET_DIR: '/w/assets'});
  const win = installerInvocation({platform: 'win32-x64', script: 'C:\\w\\update-windows.cmd', assetDir: 'C:\\w\\assets'});
  assert.deepEqual([win.command, win.args[0]], ['cmd.exe', '/c']);
  assert.equal(win.env.HPS_NO_PAUSE, '1');
  // a previous release's own public command has no asset-dir seam: it downloads from its release URL
  assert.equal('HPS_INSTALL_ASSET_DIR' in installerInvocation({platform: 'darwin-arm64', script: '/p/install-mac.sh'}).env, false);
});

test('previousStable: latest published stable App release other than the candidate', () => {
  const r = (tag_name, published_at, extra = {}) => ({tag_name, published_at, draft: false, prerelease: false, ...extra});
  const list = [r('v2026.1109.0', '2026-11-09T00:00:00Z'), r('v2026.1112.0', '2026-11-12T00:00:00Z'), r('v2026.1113.0', '2026-11-13T00:00:00Z', {draft: true}),
    r('v2026.1113.0-rc.1', '2026-11-13T00:00:00Z', {prerelease: true}), r('measurement-v0.3.1', '2026-11-14T00:00:00Z'), r('v2026.1114.0', '2026-11-14T00:00:00Z')];
  assert.equal(previousStable(list, 'v2026.1114.0'), 'v2026.1112.0');
  assert.equal(previousStable(list, 'v2026.1112.0'), 'v2026.1114.0', 'the candidate itself is excluded, not "the latest"');
  assert.equal(previousStable([], 'v1.0.0'), null);
});

const opts = home => ({platform: 'darwin-arm64', tag: 'v2026.1114.0', sourceSha: 'a'.repeat(40), productVersion: '2026.1114.0', assets: '/a', seedDir: '/s', sdkVersion: SDK, work: fs.mkdtempSync(path.join(os.tmpdir(), 'hps-acc-work-')), repo: 'o/r', home});

test('freshInstall: renders first, runs the installer, then verifies; an installer that skips the SDK fails verification', () => {
  const f = fixture({seed: 'absent'});
  const calls = [];
  try {
    const deps = {render: () => { calls.push('render'); return {script: '/x/install-mac.sh', assetDir: '/x/assets'}; }, run: inv => { calls.push(`run:${inv.args.join(' ')}`); }, paths: {home: f.home}};
    const r = freshInstall(opts(f.home), deps);
    assert.deepEqual(calls, ['render', 'run:/x/install-mac.sh --layout app']);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(), /seeded binary not found/);
    // installer failure itself propagates (never reported as a pass)
    assert.throws(() => freshInstall(opts(f.home), {...deps, run: () => { throw Error('installer exited 1'); }}), /installer exited 1/);
  } finally { f.cleanup(); }
});

test('upgradeInstall: previous stable -> candidate, version must move; missing previous installer is NOT RUN, not a pass', () => {
  const f = fixture();
  const base = {paths: {home: f.home}, render: () => ({script: '/x/install-mac.sh', assetDir: '/x'})};
  try {
    // previous stable's install leaves an App at its version, then the candidate installer replaces it
    let step = 0;
    const setVersion = v => fs.writeFileSync(path.join(f.app, 'Contents/Resources/app/product.json'), JSON.stringify({version: v}));
    const run = () => { step++; setVersion(step === 1 ? '2026.1112.0' : '2026.1114.0'); };
    const ok = upgradeInstall(opts(f.home), {...base, run, previous: () => 'v2026.1112.0', download: () => true});
    assert.deepEqual([ok.state, ok.previous, ok.evidence.previous.productVersion, ok.evidence.candidate.productVersion], ['PASS', 'v2026.1112.0', '2026.1112.0', '2026.1114.0']);
    // the candidate installer did not move the version
    const stuck = upgradeInstall(opts(f.home), {...base, run: () => setVersion('2026.1112.0'), previous: () => 'v2026.1112.0', download: () => true});
    assert.equal(stuck.state, 'FAIL');
    assert.match(stuck.reasons.join(), /expected 2026\.1114\.0|version did not move/);
    // previous stable's own install left a wrong version
    const wrong = upgradeInstall(opts(f.home), {...base, run: () => setVersion('2026.1100.0'), previous: () => 'v2026.1112.0', download: () => true});
    assert.equal(wrong.state, 'FAIL');
    assert.match(wrong.stage, /previous v2026\.1112\.0/);
    // NOT RUN cases
    assert.deepEqual(upgradeInstall(opts(f.home), {...base, run, previous: () => 'v2026.1112.0', download: () => false}),
      {state: 'NOT_RUN', reason: 'v2026.1112.0 carries no install-mac.sh'});
    assert.equal(upgradeInstall(opts(f.home), {...base, run, previous: () => null}).state, 'NOT_RUN');
    assert.equal(NOT_RUN_EXIT, 3);
  } finally { f.cleanup(); }
});

// Workflow shape (#4074): acceptance installs through the real installer and no longer seeds the SDK
// itself; the visual review can never gate publish.
test('verify-unified-release.yml: no self-seeding in acceptance, real install steps present, review job outside publish', () => {
  const wf = fs.readFileSync(new URL('../../../.github/workflows/verify-unified-release.yml', import.meta.url), 'utf8');
  const jobs = Object.fromEntries([...wf.matchAll(/^  ([a-z-]+):\n([\s\S]*?)(?=^  [a-z#-]|\n?$(?![\s\S]))/gm)].map(m => [m[1], m[2]]));
  const acceptance = wf.slice(wf.indexOf('\n  acceptance:'), wf.indexOf('\n  screenshot-review:'));
  assert.ok(acceptance.length > 1000, 'found the acceptance job');
  assert.doesNotMatch(acceptance, /Seed the Agent SDK binary/);
  assert.doesNotMatch(acceptance, /seed-sdk-binary\.(sh|ps1)[^\n]*--version[^\n]*(?<!--download-only[^\n]*)\n/, 'only --download-only may touch the seeder in acceptance');
  assert.match(acceptance, /acceptance-install\.mjs install /);
  assert.match(acceptance, /acceptance-install\.mjs upgrade /);
  // the SDK check must run before the activities that need the binary
  assert.ok(acceptance.indexOf('acceptance-install.mjs install') < acceptance.indexOf('e2e/unified-release/run.mjs'));
  const publish = wf.slice(wf.indexOf('\n  publish:'));
  assert.match(publish.slice(0, 200), /needs: \[candidate, acceptance\]/);
  assert.doesNotMatch(publish.slice(0, 400), /screenshot-review/);
  const review = wf.slice(wf.indexOf('\n  screenshot-review:'), wf.indexOf('\n  publish:'));
  assert.match(review, /continue-on-error: true/);
  assert.match(review, /secrets\.HPS_ACCEPTANCE_ANTHROPIC_API_KEY/);
  assert.equal(jobs.publish === undefined, false);
});
