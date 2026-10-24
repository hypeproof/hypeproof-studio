// Real provider + real disk store; only VS Code APIs and the Service profile are fixtures.
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export {workPower} from './src/workPower'; export {ChatPanelProvider} from './src/chatPanelProvider'; export {ProxyAuthError, ProxyTransportError} from './src/proxyClient'; export {ActivityConnections} from './src/activityConnections'; export {TaskWorkspaceStore} from './src/taskWorkspaceStore';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });

export async function createTaskHarness(root, onMessage = () => {}, { profile = null, turnTools, configExtras = {}, beforeReadDir } = {}) {
  const opened = [], posts = [], state = new Map(), module = { exports: {} };
  const browserState = { failOpen: false, failReturn: false, tabs: [], commands: [] };
  const vscode = { ViewColumn: { One: 1, Two: 2, Beside: 2 }, Uri: { file: fsPath => ({ fsPath, scheme: 'file' }) },
    commands: { executeCommand: async (name, ...args) => { if (browserState.failReturn) throw Error('Synthetic focus failure'); browserState.commands.push(name); browserState.commandArgs = [...(browserState.commandArgs ?? []), [name, ...args]]; } },
    window: { browserTabs: browserState.tabs, openBrowserTab: async (url, options) => {
      if (browserState.beforeOpen) await browserState.beforeOpen();
      if (browserState.failOpen) throw Error('Synthetic browser open failure');
      opened.push({ url, options });
      const tab = { url, title: new URL(url).hostname, close: async () => { const at = browserState.tabs.indexOf(tab); if (at >= 0) browserState.tabs.splice(at, 1); } };
      browserState.tabs.push(tab); return tab;
    } }, workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }), fs: { readFile: async uri => require('node:fs/promises').readFile(uri.fsPath) } } };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : id === 'node:fs/promises' && beforeReadDir ? { ...require(id), readdir: async (...args) => { await beforeReadDir(...args); return require(id).readdir(...args); } } : require(id), console, Buffer, structuredClone, process, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal, URL, fetch, TextEncoder, TextDecoder, crypto: webcrypto });
  const { ChatPanelProvider, ActivityConnections, TaskWorkspaceStore } = module.exports;
  const activity = { id: 'synthetic-personal-a', workspace: root, kind: 'personal', name: '내 작업' };
  const raw = { globalStorageUri: { fsPath: root }, workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) }, secrets: { get: async () => undefined, keys: async () => [] } };
  const connections = new ActivityConnections(raw, () => 'http://127.0.0.1/v1', () => root, async () => ({}));
  connections.active = activity;
  const context = connections.wrap();
  const store = new TaskWorkspaceStore(root, 'synthetic-personal-a');
  await store.initialize();
  const h = Object.create(ChatPanelProvider.prototype);
  Object.assign(h, { context, taskWorkspace: { activityId: activity.id, store }, taskChanging: false, connectionChanging: false, draftWrites: Promise.resolve(), activeStreams: new Map(), delegationControls: new Map(), pendingSends: 0, elementQueue: { queued: null }, aiDisclosure: { noticeForReady: () => null }, postInbox: async () => {}, postLearningState: async () => {},
    // Object.create skips field initializers; the write approval dialog only needs its lifecycle calls here.
    writeApprovalRequest: { cancel() {}, invalidate() {}, respond() {} } });
  const source = { postMessage: async message => { const copy = JSON.parse(JSON.stringify(message)); posts.push(copy); onMessage(copy); return true; } };
  h.editorChat = { webview: source, reveal: () => { if (browserState.failReturn) throw Error('Synthetic focus failure'); browserState.commands.push('editorChat.reveal'); } };
  h.postConfig = async () => {
    // Match production: a recreated UI must read the accepted draft after persistence.
    await h.draftWrites;
    return h.post({ type: 'config', config: {
      proxyUrl: 'http://127.0.0.1/v1', model: 'fixture-no-model', hasToken: true, ...configExtras,
      activity: { ...activity, verified: true }, activityDraft: store.getDraft(), taskWorkspace: store.getView(),
      coach: { name: 'HypeProof', personality: '', configured: true }, profile, turnTools,
    } });
  };
  return { internals: module.exports, h, store, source, opened, posts, connections, activity, browserState, vscode,
    handle: message => h.handleMessage(message, source),
    scoped: message => ({ ...message, activityId: activity.id, taskId: store.getView().activeTaskId }),
  };
}
