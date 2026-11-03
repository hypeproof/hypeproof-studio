// REQ-STUDIO-START-UPDATE-NOTICE (Jay 2026-10-29, issue #3207) — the start page shows the update the
// chat banner offers. Pure: the notice view and copy. Host: the real StartPage (src/startPage.ts) over a
// stub chat provider. Positive: an offer is shown and redrawn when it changes; its buttons run the chat
// banner's commands. Negatives: no offer (current version), a dismissed version (the scheduler clears it),
// and a class seat (status line, no button).
//
// Run: node --experimental-strip-types test/start-update-notice.smoke.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;

// ── Pure ──────────────────────────────────────────────────────────────────────────────────────
const pure = await build({ entryPoints: [root + 'src/startUpdateNotice.ts'], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'error' });
const { START_UPDATE_COPY, startUpdateNotice } = await import(`data:text/javascript;base64,${Buffer.from(pure.outputFiles[0].text).toString('base64')}`);
assert.deepEqual(startUpdateNotice({ version: '2026.1029.0' }), { version: 'v2026.1029.0', held: false });
assert.deepEqual(startUpdateNotice({ version: 'v2026.1029.0', heldForClass: true }), { version: 'v2026.1029.0', held: true });
for (const none of [undefined, null, {}, { version: '' }, { version: 3 }]) assert.equal(startUpdateNotice(none), null, `no notice for ${JSON.stringify(none)}`);
assert.equal(START_UPDATE_COPY.install, '업데이트', 'the same verb as the chat banner');
assert.equal(START_UPDATE_COPY.later, '나중에', 'the same dismissal as the chat banner');
for (const line of Object.values(START_UPDATE_COPY)) assert.ok(!/체험|해요$/.test(line), `start-page register: ${line}`);

// ── Host ──────────────────────────────────────────────────────────────────────────────────────
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });

function harness({ offer = null, held = false } = {}) {
  const world = { states: [], commands: [], listeners: [], offer, held };
  const ctx = {
    workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    globalState: { get: (_k, d) => d, update: async () => {} },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    extension: { packageJSON: { version: '2026.1020.2' } }, subscriptions: [],
  };
  const chat = {
    ensureProfile: async () => null, profileFailure: () => null, invalidateProfile() {}, refreshConfig() {},
    hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => '코치', coachNameIsChosen: () => true, funnelEmit() {},
    getAvailableUpdate: () => world.offer, isClassUpdateHeld: () => world.held,
    onAvailableUpdateChanged: fn => { world.listeners.push(fn); return () => {}; },
  };
  // The scheduler's real path: setAvailableUpdate stores the offer and notifies the listeners.
  world.setAvailableUpdate = info => { world.offer = info; for (const l of world.listeners) l(); };
  const vscode = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? 'http://127.0.0.1:9/v1' : key === 'freeStart' ? 'off' : fallback }) },
    window: {}, commands: { executeCommand: async (id, ...args) => { world.commands.push([id, ...args]); if (id === 'hypeproof-chat.dismissUpdate') world.setAvailableUpdate(null); } }, Uri: { parse: s => s }, env: {} };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder,
    fetch: async () => new Response('{}', { status: 404 }), Response, Headers, Date, JSON, setTimeout: () => 0, clearTimeout: () => {} });
  const page = new module.exports.StartPage(ctx, chat, async () => false);
  page.panel = { webview: { postMessage: async msg => world.states.push(msg) } };
  const state = () => world.states.at(-1).state;
  const settle = () => new Promise(r => setTimeout(r, 30));
  return { world, page, state, settle };
}
const OFFER = { version: '2026.1029.0', notes: '', releaseUrl: 'https://github.com/hypeproof/hypeproof-studio-releases/releases/tag/v2026.1029.0', sizeBytes: 172837932 };

// Negative: no offer (the check found the installed version current, or has not finished yet).
let h = harness();
await h.page.handle({ type: 'startReady' }); await h.settle();
assert.equal(h.state().update, undefined, 'no offer: no notice');
assert.equal(h.world.listeners.length, 1, 'the start page listens for offer changes');

// Positive, first launch: the first check finishes after the page is drawn → the open page redraws with it.
h.world.setAvailableUpdate(OFFER); await h.settle();
assert.deepEqual({ ...h.state().update }, { version: '2026.1029.0' }, 'a found update reaches the open start page');
assert.ok(!JSON.stringify(h.state().update).includes('releaseUrl'), 'only the version reaches the start page');

// Positive: an offer present before the page opens is drawn on the first paint.
h = harness({ offer: OFFER });
await h.page.handle({ type: 'startReady' }); await h.settle();
assert.equal(h.state().update.version, '2026.1029.0');
assert.equal(h.state().update.heldForClass, undefined);

// The buttons run the chat banner's commands.
await h.page.handle({ type: 'startUpdateInstall' });
assert.deepEqual(h.world.commands.at(-1), ['hypeproof-chat.installUpdate']);
await h.page.handle({ type: 'startUpdateDismiss', version: '2026.1029.0' }); await h.settle();
assert.deepEqual(h.world.commands.at(-1), ['hypeproof-chat.dismissUpdate', '2026.1029.0'], 'the same per-version dismissal');
assert.equal(h.state().update, undefined, 'dismissed: the notice is gone (and the chat banner with it)');
const before = h.world.commands.length;
await h.page.handle({ type: 'startUpdateDismiss', version: '' }); await h.page.handle({ type: 'startUpdateDismiss' });
assert.equal(h.world.commands.length, before, 'a dismissal without a version runs nothing');

// Class seat: the notice says when; the view gets the hold, and the webview draws no button.
h = harness({ offer: OFFER, held: true });
await h.page.handle({ type: 'startReady' }); await h.settle();
assert.deepEqual({ ...h.state().update }, { version: '2026.1029.0', heldForClass: true });
assert.deepEqual(startUpdateNotice(h.state().update), { version: 'v2026.1029.0', held: true });

// Dismissed earlier (the scheduler applies shouldShowBanner and pushes null): nothing on the page.
h = harness({ offer: null });
await h.page.handle({ type: 'startReady' }); await h.settle();
assert.equal(h.state().update, undefined, 'a dismissed version is never offered');

console.log('PASS start-page update notice: pure view + copy, host shows when newer (first paint and late check), hidden when none/dismissed, class hold, install/dismiss commands');
