// REQ-I14 — a non-member update check points to the homepage download.
//
// Bundles the real updateChecker.ts (+ updateTransport.ts) with a recording
// `vscode` stub, then runs:
//   positive: no member credential (no env token, no `gh` on PATH) and a
//             logged-in non-member (token present, private mirror 404)
//   control:  member credential, 200 from the release API — unchanged copy
// No network: fetch is stubbed. No window: the stub only records calls.
//
// Run: node test/update-access-copy.smoke.mjs

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Module from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const calls = [];
let nextChoice;
const stub = {
  window: {
    showInformationMessage: async (text, ...items) => { calls.push({ kind: 'info', text, items }); return nextChoice; },
    showWarningMessage: async (text, ...items) => { calls.push({ kind: 'warning', text, items }); return undefined; },
    showErrorMessage: async (text, ...items) => { calls.push({ kind: 'error', text, items }); return undefined; },
    setStatusBarMessage: (text) => { calls.push({ kind: 'statusbar', text }); return { dispose() {} }; },
  },
  env: { openExternal: async (uri) => { calls.push({ kind: 'open', url: uri.toString() }); return true; } },
  Uri: { parse: (value) => ({ toString: () => value }), file: (p) => ({ fsPath: p }) },
  ProgressLocation: { Notification: 15 },
  commands: {},
};
globalThis.__vscodeStub = stub;

const bundle = await build({
  entryPoints: [resolve('src/updateChecker.ts')], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'vscode-test-host', setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = globalThis.__vscodeStub', loader: 'js' }));
  } }],
});
const mod = new Module(resolve('test/update-access-host.cjs'));
mod.filename = resolve('test/update-access-host.cjs');
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(bundle.outputFiles[0].text, mod.filename);
const { checkForUpdates, scheduleUpdateChecks, reportManualUpdateCheckFailure } = mod.exports;
assert.equal(typeof reportManualUpdateCheckFailure, 'function', 'the manual-check failure copy lives in updateChecker.ts');

const FORBIDDEN = [/gh auth login/, /HPS_RELEASE_TOKEN/, /GitHub CLI/, /잠시 후 다시 시도/];
const HOMEPAGE = 'https://hypeproof-ai.xyz/download';
const userText = () => calls.filter(c => c.kind !== 'open').map(c => [c.text, ...(c.items ?? [])].join(' ')).join('\n');
const flush = () => new Promise(r => setImmediate(r));

const saved = {
  env: { HPS_RELEASE_TOKEN: process.env.HPS_RELEASE_TOKEN, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, PATH: process.env.PATH },
  fetch: globalThis.fetch,
  platform: Object.getOwnPropertyDescriptor(process, 'platform'),
  arch: Object.getOwnPropertyDescriptor(process, 'arch'),
  setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval,
};
const emptyBin = await mkdtemp(join(tmpdir(), 'hps-no-gh-'));
const setCreds = (token) => {
  for (const k of ['HPS_RELEASE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) delete process.env[k];
  if (token) process.env.HPS_RELEASE_TOKEN = token;
  process.env.PATH = emptyBin; // `gh` cannot be found
};
const release = {
  tag_name: 'v0.1.51', html_url: 'https://github.com/hypeproof/hypeproof-studio-releases/releases/tag/v0.1.51',
  assets: [{ url: 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/123', name: 'HypeProof-Studio-darwin-arm64.zip', size: 100, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/hypeproof/hypeproof-studio-releases/releases/download/v0.1.51/HypeProof-Studio-darwin-arm64.zip' }],
};

/** Drive the real scheduler once per call; returns the banner pushes. */
function makeScheduler(currentVersion, state) {
  const callbacks = [];
  globalThis.setTimeout = (fn, ms) => { callbacks.push({ fn, ms }); return 0; };
  globalThis.setInterval = (fn, ms) => { callbacks.push({ fn, ms }); return 0; };
  const banners = [];
  const context = { globalState: { get: (k, d) => (k in state ? state[k] : d), update: async (k, v) => { state[k] = v; } } };
  const scheduler = scheduleUpdateChecks({ currentVersion, context, pushUpdateBanner: b => banners.push(b) });
  globalThis.setTimeout = saved.setTimeout; globalThis.setInterval = saved.setInterval;
  return {
    banners,
    async tick() { (callbacks[1] ?? callbacks[0]).fn(); await flush(); await flush(); },
    async first() {
      // The first run arms the 24h interval; record it instead of a real timer.
      globalThis.setInterval = (fn, ms) => { callbacks.push({ fn, ms }); return 0; };
      try { callbacks[0].fn(); } finally { globalThis.setInterval = saved.setInterval; }
      await flush(); await flush();
    },
    dispose: () => scheduler.dispose(),
  };
}

try {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });

  // ── positive A: no member credential at all ──────────────────────────
  setCreds(null);
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return Response.json(release); };
  let error;
  try { await checkForUpdates('0.1.50'); } catch (e) { error = e; }
  assert.ok(error, 'no credential → the check fails (the private mirror is not readable)');
  assert.equal(fetched, 0, 'no anonymous call to the private mirror');

  calls.length = 0;
  nextChoice = undefined;
  await reportManualUpdateCheckFailure(error);
  assert.equal(calls.length, 1, 'one message');
  assert.equal(calls[0].kind, 'info', 'not a warning: nothing is broken and retrying will not help');
  assert.match(calls[0].text, /홈페이지/);
  for (const f of FORBIDDEN) assert.doesNotMatch(userText(), f);
  assert.ok(calls[0].items.includes('홈페이지 열기'));

  calls.length = 0;
  nextChoice = '홈페이지 열기';
  await reportManualUpdateCheckFailure(error);
  assert.deepEqual(calls.at(-1), { kind: 'open', url: HOMEPAGE }, 'the button opens the homepage download');
  nextChoice = undefined;
  console.log('PASS manual check without credential → homepage copy, no gh/token/retry');

  // ── positive A: automatic check — one passive line per app version ───
  const state = {};
  calls.length = 0;
  let s = makeScheduler('0.1.50', state);
  await s.first();
  assert.equal(calls.filter(c => c.kind === 'info').length, 1, 'automatic failure is not silent');
  assert.match(calls[0].text, /새 버전은 홈페이지에서 받을 수 있어요/);
  for (const f of FORBIDDEN) assert.doesNotMatch(userText(), f);
  assert.deepEqual(s.banners, [], 'no banner claim, no banner cleared');
  await s.tick();
  await s.tick();
  assert.equal(calls.filter(c => c.kind === 'info').length, 1, 'once per version, not every 24h');
  s.dispose();
  s = makeScheduler('0.1.50', state); // restart, same version
  await s.first();
  assert.equal(calls.filter(c => c.kind === 'info').length, 1, 'restart on the same version stays quiet');
  s.dispose();
  s = makeScheduler('0.1.51', state); // installed a newer build from the homepage
  await s.first();
  assert.equal(calls.filter(c => c.kind === 'info').length, 2, 'a new app version gets the line once more');
  s.dispose();
  console.log('PASS automatic check without credential → one passive line per version');

  // ── positive B: logged-in non-member (token present, private mirror 404) ──
  setCreds('non-member-token');
  globalThis.fetch = async () => Response.json({ message: 'Not Found' }, { status: 404 });
  error = undefined;
  try { await checkForUpdates('0.1.50'); } catch (e) { error = e; }
  assert.ok(error);
  calls.length = 0;
  await reportManualUpdateCheckFailure(error);
  assert.match(calls[0].text, /홈페이지/);
  for (const f of FORBIDDEN) assert.doesNotMatch(userText(), f);
  console.log('PASS token without release access (404) → homepage copy');

  // ── control: member credential — path unchanged ──────────────────────
  setCreds('member-token');
  let auth;
  globalThis.fetch = async (_url, init) => { auth = init.headers.authorization; return Response.json(release); };
  const info = await checkForUpdates('0.1.50');
  assert.equal(auth, 'Bearer member-token');
  assert.equal(info.available, true);
  assert.equal(info.version, '0.1.51');
  calls.length = 0;
  const memberState = {};
  s = makeScheduler('0.1.50', memberState);
  await s.first();
  assert.equal(s.banners.at(-1)?.version, '0.1.51', 'member gets the banner');
  assert.equal(calls.length, 0, 'member sees no homepage line');
  s.dispose();

  // Transient member failure keeps the retry copy (it is true there).
  globalThis.fetch = async () => new Response('', { status: 503 });
  error = undefined;
  try { await checkForUpdates('0.1.50'); } catch (e) { error = e; }
  calls.length = 0;
  await reportManualUpdateCheckFailure(error);
  assert.equal(calls[0].kind, 'warning');
  assert.match(calls[0].text, /업데이트를 확인하지 못했습니다\. 잠시 후 다시 시도해주세요\..*503/);
  assert.doesNotMatch(calls[0].text, /홈페이지/);
  s = makeScheduler('0.1.50', {});
  calls.length = 0;
  await s.first();
  assert.equal(calls.length, 0, 'a transient automatic failure stays silent (REQ-I11)');
  assert.deepEqual(s.banners, []);
  s.dispose();
  console.log('PASS member control: banner, retry copy on 503, no homepage line');
} finally {
  for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  globalThis.fetch = saved.fetch;
  globalThis.setTimeout = saved.setTimeout; globalThis.setInterval = saved.setInterval;
  Object.defineProperty(process, 'platform', saved.platform);
  Object.defineProperty(process, 'arch', saved.arch);
  await rm(emptyBin, { recursive: true, force: true });
}
