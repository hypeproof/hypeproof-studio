// CGP-KNOW-D-006 — the real ChatPanelProvider as the R-006 presenter, in the shape of write-approval-paths'
// "real host presentation requires a visible surface" test. The provider and confirmOutbound are bundled together
// (one module instance) with a scripted `vscode`, and the provider is constructed for real, so its own
// setOutboundPresenter registration is what routes confirmOutbound to the panel.
//   H1  no visible panel: the dialog is never posted and the R-006 VS Code modal asks
//   H2  a visible sidebar or editor chat gets the dialog, the modal is not asked, and `outboundAnswer` sends
//   H3  a panel reload (`ready`), a disposed sidebar or editor chat, invalidateProfile and a token change each deny an
//       open prompt at once, without waiting for the timeout
// Run: node --experimental-strip-types --test test/outbound-approval-host.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider.ts'; export { confirmOutbound } from './src/outboundConsentHost.ts';", resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
// Anything else the provider touches is an inert, chainable stand-in (the bundle copies only the keys listed here).
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
const modals = [];
const vscode = new Proxy({
  window: { showWarningMessage: async (message, options, ...actions) => { modals.push({ message, options, actions }); return undefined; } },
  workspace: { getConfiguration: () => ({ get: (_k, fallback) => fallback }), workspaceFolders: [] },
  Uri: { joinPath: () => ({ fsPath: '/ext' }), file: p => ({ fsPath: p }) },
  ViewColumn: { One: 1 },
  commands: { executeCommand: async () => undefined, registerCommand: () => ({ dispose() {} }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
}, inert);
const unref = fn => (...a) => { const t = fn(...a); t?.unref?.(); return t; };
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: id => (id === 'vscode' ? vscode : require(id)), console, Buffer, process,
  setTimeout: unref(setTimeout), clearTimeout, setInterval: unref(setInterval), clearInterval, AbortSignal, AbortController,
  URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone,
});
const { ChatPanelProvider, confirmOutbound } = mod.exports;

const listeners = {};
const memento = () => ({ get: () => undefined, update: async () => {}, keys: () => [] });
const context = {
  subscriptions: [], extensionUri: { fsPath: '/ext' }, extensionPath: '/ext', extension: { packageJSON: {} },
  globalState: memento(), workspaceState: memento(), globalStorageUri: { fsPath: '/tmp/hps-none' }, storageUri: { fsPath: '/tmp/hps-none' },
  secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: f => { listeners.secret = f; return { dispose() {} }; } },
};
const provider = new ChatPanelProvider(context, {}, {});
const posted = [];
provider.post = async msg => { posted.push(msg); return true; };
const manifest = () => ({ recipient: '갤러리 · site.invalid', items: [{ name: 'index.html', bytes: 12 }], also: [{ recipient: '활동 기록 서버 · service.invalid', items: [{ name: 'events.jsonl', bytes: 30 }] }] });
const prompts = () => posted.filter(m => m.type === 'outboundPrompt' && m.prompt);
const tick = () => new Promise(r => setImmediate(r));
/** Open one prompt on a visible panel; `ended` flips the moment it is answered. */
async function openPrompt() {
  const before = prompts().length, modalsBefore = modals.length, state = { ended: false };
  state.result = confirmOutbound(manifest()).then(v => { state.ended = true; return v; });
  await tick();
  assert.equal(prompts().length, before + 1, 'the visible panel receives the dialog');
  assert.equal(modals.length, modalsBefore, 'the modal is not asked while the dialog is open');
  state.prompt = prompts().at(-1).prompt;
  return state;
}

test('H1 no visible chat panel: the dialog is never posted and the R-006 modal asks', async () => {
  for (const surfaces of [{}, { view: { visible: false } }, { view: { visible: false }, editorChat: { visible: false } }]) {
    provider.view = surfaces.view; provider.editorChat = surfaces.editorChat;
    const before = modals.length, shownBefore = prompts().length;
    assert.equal(await confirmOutbound(manifest()), false, 'a dismissed modal sends nothing');
    assert.equal(modals.length, before + 1, 'the popup asks: ' + JSON.stringify(surfaces));
    assert.equal(modals.at(-1).options.modal, true);
    assert.equal(prompts().length, shownBefore, 'a hidden panel never receives the dialog');
  }
});

test('H2 a visible sidebar or editor chat shows the dialog and its answer is final', async () => {
  for (const surfaces of [{ view: { visible: true } }, { view: { visible: false }, editorChat: { visible: true } }]) {
    provider.view = surfaces.view; provider.editorChat = surfaces.editorChat;
    const open = await openPrompt();
    const ids = [...open.prompt.sections.flatMap(s => s.items.map(i => i.id))];
    assert.equal(JSON.stringify(ids), '["0:0","1:0"]');
    await provider.handleMessage({ type: 'outboundAnswer', id: open.prompt.id, selected: ids });
    assert.equal(await open.result, true, 'the full checklist sends');
    assert.equal(posted.at(-1).prompt, null, 'the dialog is cleared');
    const cancelled = await openPrompt(), modalsBefore = modals.length;
    await provider.handleMessage({ type: 'outboundAnswer', id: cancelled.prompt.id, selected: null });
    assert.equal(await cancelled.result, false, '취소 sends nothing');
    assert.equal(modals.length, modalsBefore, 'a cancelled dialog never falls through to the popup');
  }
});

test('H3 reload, dispose, sign-out and token change deny an open prompt without the timeout', async () => {
  const swallow = async fn => { try { await fn(); } catch { /* only the cancel before the rest of the handler matters */ } };
  const cases = {
    ready: () => swallow(() => provider.handleMessage({ type: 'ready' })),
    invalidateProfile: () => swallow(() => provider.invalidateProfile()),
    tokenChange: () => listeners.secret({ key: 'hypeproofChat.workshopToken' }),
    sidebarDispose: null, // fired through the handler resolveWebviewView registers
    editorDispose: null, // fired through the handler openInEditor registers
  };
  // Capture the real dispose handlers the provider registers on its sidebar view and editor panel.
  const surface = (visible) => {
    const s = { visible, webview: { options: {}, html: '', asWebviewUri: u => u, cspSource: 'x', onDidReceiveMessage() { return { dispose() {} }; }, postMessage: async () => true }, onDidChangeVisibility() { return { dispose() {} }; }, onDidChangeViewState() { return { dispose() {} }; }, reveal() {}, dispose() {} };
    s.onDidDispose = f => { s.fireDispose = f; return { dispose() {} }; };
    return s;
  };
  for (const [name, run] of Object.entries(cases)) {
    let disposeSurface;
    if (name === 'sidebarDispose') {
      provider.editorChat = undefined; disposeSurface = surface(true);
      await swallow(() => provider.resolveWebviewView(disposeSurface));
      assert.equal(typeof disposeSurface.fireDispose, 'function', 'the sidebar registers a dispose handler');
      provider.view = disposeSurface;
    } else if (name === 'editorDispose') {
      provider.view = undefined; provider.editorChat = undefined; disposeSurface = surface(true);
      await swallow(() => provider.openInEditor(disposeSurface));
      assert.equal(typeof disposeSurface.fireDispose, 'function', 'the editor chat registers a dispose handler');
      provider.editorChat = disposeSurface;
    } else { provider.view = { visible: true }; provider.editorChat = undefined; }
    provider.post = async msg => { posted.push(msg); return true; };
    const open = await openPrompt();
    if (disposeSurface) disposeSurface.fireDispose(); else await run();
    await tick();
    assert.equal(open.ended, true, name + ' ends the prompt at once, not after the 3-minute timeout');
    assert.equal(await open.result, false, name + ' denies');
  }
});
