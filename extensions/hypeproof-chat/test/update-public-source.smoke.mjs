// REQ-I15 (D19) — a non-member update check reads the public release the Lab
// download serves, behind `hypeproofChat.publicUpdates` (default off) or the
// registered free-start signal. Members keep the private mirror.
//
// Bundles the real updateChecker.ts (+ updateTransport.ts) with a recording
// `vscode` stub. No network: fetch is stubbed and every request is recorded.
//
//   negative controls: setting off → no fetch at all (REQ-I14 unchanged);
//                      member token → private mirror only, public never asked;
//                      a public release whose asset points at the private mirror
//                      (and the reverse) is refused
//   positive:          no credential / refused token + setting on → one anonymous
//                      public read, banner, anonymous verified download;
//                      403/429 → "check later" (silent automatic, calm manual);
//                      public 404 → homepage copy; free-start signal alone turns it on
//
// Run: node test/update-public-source.smoke.mjs

import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Module from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PRIVATE_API = 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/latest';
const PUBLIC_API = 'https://api.github.com/repos/hypeproof/hypeproof-studio/releases/latest';
const PRIVATE_ASSET = 'https://api.github.com/repos/hypeproof/hypeproof-studio-releases/releases/assets/123';
const PUBLIC_ASSET = 'https://api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/456';
const HOMEPAGE = 'https://hypeproof-ai.xyz/download';
const FORBIDDEN = [/gh auth login/, /HPS_RELEASE_TOKEN/, /GitHub CLI/, /체험/, /토큰/];

const calls = [];
let setting = false;
const stub = {
  window: {
    showInformationMessage: async (text, ...items) => { calls.push({ kind: 'info', text, items }); return undefined; },
    showWarningMessage: async (text, ...items) => { calls.push({ kind: 'warning', text, items }); return undefined; },
    showErrorMessage: async (text, ...items) => { calls.push({ kind: 'error', text, items }); return undefined; },
  },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => (section === 'hypeproofChat' && key === 'publicUpdates' ? setting : fallback),
    }),
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
const mod = new Module(resolve('test/update-public-host.cjs'));
mod.filename = resolve('test/update-public-host.cjs');
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(bundle.outputFiles[0].text, mod.filename);
const { checkForUpdates, scheduleUpdateChecks, reportManualUpdateCheckFailure, registerPublicUpdateSignal, publicUpdatesEnabled } = mod.exports;
const { downloadVerifiedUpdate, trustedUpdateUrl, updateUrlSource } = await import('../src/updateTransport.ts');

const data = Buffer.from('public release bytes');
const digest = `sha256:${createHash('sha256').update(data).digest('hex')}`;
const releaseWith = (assetUrl, repo) => ({
  tag_name: 'v0.1.60', html_url: `https://github.com/${repo}/releases/tag/v0.1.60`,
  assets: [{ url: assetUrl, name: 'HypeProof-Studio-darwin-arm64.zip', size: data.length, digest }],
});
const PUBLIC_RELEASE = releaseWith(PUBLIC_ASSET, 'hypeproof/hypeproof-studio');
const PRIVATE_RELEASE = releaseWith(PRIVATE_ASSET, 'hypeproof/hypeproof-studio-releases');

const saved = {
  env: { HPS_RELEASE_TOKEN: process.env.HPS_RELEASE_TOKEN, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN, PATH: process.env.PATH },
  fetch: globalThis.fetch,
  platform: Object.getOwnPropertyDescriptor(process, 'platform'),
  arch: Object.getOwnPropertyDescriptor(process, 'arch'),
  setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval,
};
const emptyBin = await mkdtemp(join(tmpdir(), 'hps-no-gh-'));
const root = await mkdtemp(join(tmpdir(), 'hps-public-update-'));
const setCreds = (token) => {
  for (const k of ['HPS_RELEASE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) delete process.env[k];
  if (token) process.env.HPS_RELEASE_TOKEN = token;
  process.env.PATH = emptyBin; // `gh` cannot be found
};
/** Route stubbed fetches by URL and record each request. */
let requests = [];
const serve = (routes) => {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), auth: init.headers?.authorization });
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected request ${url}`);
    return route();
  };
};
const userText = () => calls.filter(c => c.kind !== 'open').map(c => [c.text, ...(c.items ?? [])].join(' ')).join('\n');
const flush = () => new Promise(r => setImmediate(r));
async function checkError(options) {
  try { await checkForUpdates('0.1.50', options); } catch (e) { return e; }
  assert.fail('expected the check to fail');
}
function runScheduler(state) {
  const callbacks = [];
  globalThis.setTimeout = (fn, ms) => { callbacks.push({ fn, ms }); return 0; };
  const banners = [];
  const context = { globalState: { get: (k, d) => (k in state ? state[k] : d), update: async (k, v) => { state[k] = v; } } };
  const scheduler = scheduleUpdateChecks({ currentVersion: '0.1.50', context, pushUpdateBanner: b => banners.push(b) });
  globalThis.setTimeout = saved.setTimeout;
  return {
    banners,
    async first() {
      globalThis.setInterval = () => 0;
      try { callbacks[0].fn(); } finally { globalThis.setInterval = saved.setInterval; }
      await flush(); await flush(); await flush();
    },
    dispose: () => scheduler.dispose(),
  };
}

try {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });

  // ── URL trust is per source ────────────────────────────────────────────
  assert.equal(trustedUpdateUrl(PUBLIC_ASSET, 'public'), true);
  assert.equal(trustedUpdateUrl(PUBLIC_ASSET, 'member'), false);
  assert.equal(trustedUpdateUrl(PRIVATE_ASSET, 'member'), true);
  assert.equal(trustedUpdateUrl(PRIVATE_ASSET, 'public'), false);
  assert.equal(updateUrlSource(PUBLIC_ASSET), 'public');
  assert.equal(updateUrlSource(PRIVATE_ASSET), 'member');
  for (const bad of ['https://api.github.com/repos/hypeproof/hypeproof-studio-evil/releases/assets/1',
    'https://api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/1?x=1',
    'https://api.github.com/repos/jayleekr/hypeproof-studio/releases/assets/1',
    'https://u@api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/1']) {
    assert.equal(updateUrlSource(bad), null, bad);
  }
  console.log('PASS asset trust is bound to the repository it came from');

  // ── negative control: setting off, no credential → today (REQ-I14) ────
  setting = false;
  assert.equal(publicUpdatesEnabled(), false, 'default off');
  setCreds(null);
  serve({});
  let error = await checkError();
  assert.equal(error.code, 'update_access_unavailable');
  assert.equal(requests.length, 0, 'no anonymous call to either repository while off');
  console.log('PASS setting off → no request, UpdateAccessError as today');

  // ── positive: setting on, no credential → one anonymous public read ───
  setting = true;
  assert.equal(publicUpdatesEnabled(), true);
  serve({ [PUBLIC_API]: () => Response.json(PUBLIC_RELEASE) });
  let info = await checkForUpdates('0.1.50');
  assert.deepEqual(requests, [{ url: PUBLIC_API, auth: undefined }], 'one anonymous public read; the private mirror is never called anonymously');
  assert.equal(info.available, true);
  assert.equal(info.version, '0.1.60');
  assert.equal(info.source, 'public');
  assert.equal(info.downloadUrl, PUBLIC_ASSET);
  serve({ [PUBLIC_API]: () => Response.json({ ...PUBLIC_RELEASE, tag_name: 'v0.1.50' }) });
  assert.equal((await checkForUpdates('0.1.50')).available, false, 'same version → up to date');
  console.log('PASS setting on without credential → anonymous public release');

  // Scheduler: banner for the public release, no homepage line.
  calls.length = 0;
  serve({ [PUBLIC_API]: () => Response.json(PUBLIC_RELEASE) });
  let s = runScheduler({});
  await s.first();
  assert.equal(s.banners.at(-1)?.version, '0.1.60', 'non-member gets the in-app banner');
  assert.equal(calls.length, 0, 'no homepage line when the public release answers');
  s.dispose();

  // Download from the public release is anonymous even when a token exists.
  setCreds('member-token-that-must-not-leave');
  requests = [];
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), auth: init.headers?.authorization });
    if (++n === 1) {
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/a?signed=1' } });
    }
    return new Response(data);
  };
  const dest = join(root, 'public.zip');
  await downloadVerifiedUpdate({ downloadUrl: PUBLIC_ASSET, sizeBytes: data.length, digest }, dest);
  assert.deepEqual(await readFile(dest), data);
  assert.equal(requests[0].auth, undefined, 'no credential sent for a public asset');
  // Control: a private mirror asset still carries the member token.
  requests = []; n = 0;
  await downloadVerifiedUpdate({ downloadUrl: PRIVATE_ASSET, sizeBytes: data.length, digest }, join(root, 'private.zip'));
  assert.equal(requests[0].auth, 'Bearer member-token-that-must-not-leave');
  console.log('PASS public asset download is anonymous; mirror asset keeps the member token');

  // ── negative control: member token → private mirror only ──────────────
  setCreds('member-token');
  serve({ [PRIVATE_API]: () => Response.json(PRIVATE_RELEASE), [PUBLIC_API]: () => assert.fail('member must not read the public release') });
  info = await checkForUpdates('0.1.50');
  assert.deepEqual(requests, [{ url: PRIVATE_API, auth: 'Bearer member-token' }]);
  assert.equal(info.source, 'member');
  assert.equal(info.downloadUrl, PRIVATE_ASSET);
  // Member transient failure is not turned into a public read.
  serve({ [PRIVATE_API]: () => new Response('', { status: 503 }), [PUBLIC_API]: () => assert.fail('no fallback on 503') });
  error = await checkError();
  assert.match(error.message, /503/);
  console.log('PASS member path unchanged with the setting on (mirror only, 503 not rerouted)');

  // ── positive: token the mirror refuses (logged-in non-member) ─────────
  setCreds('non-member-token');
  serve({ [PRIVATE_API]: () => Response.json({ message: 'Not Found' }, { status: 404 }), [PUBLIC_API]: () => Response.json(PUBLIC_RELEASE) });
  info = await checkForUpdates('0.1.50');
  assert.deepEqual(requests, [{ url: PRIVATE_API, auth: 'Bearer non-member-token' }, { url: PUBLIC_API, auth: undefined }]);
  assert.equal(info.source, 'public');
  // Same refusal with the setting off → REQ-I14, no public read.
  setting = false;
  serve({ [PRIVATE_API]: () => Response.json({ message: 'Not Found' }, { status: 404 }) });
  error = await checkError();
  assert.equal(error.code, 'update_access_unavailable');
  assert.equal(requests.length, 1);
  setting = true;
  console.log('PASS refused token → public release only while the setting is on');

  // ── negative control: an asset from the other repository is refused ──
  setCreds(null);
  serve({ [PUBLIC_API]: () => Response.json(releaseWith(PRIVATE_ASSET, 'hypeproof/hypeproof-studio')) });
  error = await checkError();
  assert.match(error.message, /출처 또는 검증 정보/);
  setCreds('member-token');
  serve({ [PRIVATE_API]: () => Response.json(releaseWith(PUBLIC_ASSET, 'hypeproof/hypeproof-studio-releases')) });
  error = await checkError();
  assert.match(error.message, /출처 또는 검증 정보/);
  console.log('PASS a release pointing at the other repository is refused');

  // ── positive: rate limit → check later ─────────────────────────────────
  setCreds(null);
  for (const status of [403, 429]) {
    serve({ [PUBLIC_API]: () => Response.json({ message: 'API rate limit exceeded' }, { status }) });
    error = await checkError();
    assert.equal(error.code, 'update_check_deferred', `HTTP ${status}`);
    calls.length = 0;
    await reportManualUpdateCheckFailure(error);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, 'info', 'not a warning or error');
    assert.equal(calls[0].text, '지금은 새 버전을 확인할 수 없어요. 한 시간쯤 뒤에 다시 확인해 주세요.');
    for (const f of FORBIDDEN) assert.doesNotMatch(userText(), f);
    // Automatic check: silent, and it neither pushes nor clears a banner.
    const state = {};
    calls.length = 0;
    s = runScheduler(state);
    await s.first();
    assert.equal(calls.length, 0, `automatic ${status} stays silent`);
    assert.deepEqual(s.banners, [], 'a deferred check keeps the existing banner');
    assert.equal(state['hypeproofChat.updateAccessNotice'], undefined, 'no homepage notice recorded');
    s.dispose();
  }
  console.log('PASS 403/429 → check later (calm manual copy, silent automatic, banner kept)');

  // ── positive: no public release yet → homepage copy ───────────────────
  serve({ [PUBLIC_API]: () => Response.json({ message: 'Not Found' }, { status: 404 }) });
  error = await checkError();
  assert.equal(error.code, 'update_access_unavailable');
  calls.length = 0;
  await reportManualUpdateCheckFailure(error);
  assert.match(calls[0].text, /홈페이지/);
  assert.ok(calls[0].items.includes('홈페이지 열기'));
  for (const f of FORBIDDEN) assert.doesNotMatch(userText(), f);
  console.log('PASS public 404 → homepage copy');

  // ── the free-start signal alone turns it on; a throwing signal does not ─
  setting = false;
  registerPublicUpdateSignal(() => true);
  assert.equal(publicUpdatesEnabled(), true);
  serve({ [PUBLIC_API]: () => Response.json(PUBLIC_RELEASE) });
  assert.equal((await checkForUpdates('0.1.50')).source, 'public');
  registerPublicUpdateSignal(() => { throw new Error('offer unavailable'); });
  assert.equal(publicUpdatesEnabled(), false);
  registerPublicUpdateSignal(() => false);
  assert.equal(publicUpdatesEnabled(), false);
  registerPublicUpdateSignal(null);
  assert.equal(publicUpdatesEnabled(), false);
  console.log('PASS free-start signal enables public updates; failing or false signal does not');
} finally {
  for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  globalThis.fetch = saved.fetch;
  globalThis.setTimeout = saved.setTimeout; globalThis.setInterval = saved.setInterval;
  Object.defineProperty(process, 'platform', saved.platform);
  Object.defineProperty(process, 'arch', saved.arch);
  await rm(emptyBin, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}
