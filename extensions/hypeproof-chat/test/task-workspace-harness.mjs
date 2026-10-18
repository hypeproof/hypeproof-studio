// Real provider + real disk store; only VS Code APIs and the Service profile are fixtures.
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider'; export {ActivityConnections} from './src/activityConnections'; export {TaskWorkspaceStore} from './src/taskWorkspaceStore';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });

export async function createTaskHarness(root, onMessage = () => {}, { profile = null } = {}) {
  const opened = [], posts = [], state = new Map(), module = { exports: {} };
  const vscode = { ViewColumn: { Beside: 2 }, window: { openBrowserTab: async (url, options) => opened.push({ url, options }) }, workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) } };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto });
  const { ChatPanelProvider, ActivityConnections, TaskWorkspaceStore } = module.exports;
  const activity = { id: 'synthetic-personal-a', workspace: root, kind: 'personal', name: '내 작업' };
  const raw = { globalStorageUri: { fsPath: root }, workspaceState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => state.set(key, value) }, secrets: { get: async () => undefined, keys: async () => [] } };
  const connections = new ActivityConnections(raw, () => 'http://127.0.0.1/v1', () => root, async () => ({}));
  connections.active = activity;
  const context = connections.wrap();
  const store = new TaskWorkspaceStore(root, 'synthetic-personal-a');
  await store.initialize();
  const h = Object.create(ChatPanelProvider.prototype);
  Object.assign(h, { context, taskWorkspace: { activityId: activity.id, store }, taskChanging: false, connectionChanging: false, draftWrites: Promise.resolve(), activeStreams: new Map(), pendingSends: 0, elementQueue: { queued: null }, aiDisclosure: { noticeForReady: () => null }, postInbox: async () => {}, postLearningState: async () => {} });
  const source = { postMessage: async message => { const copy = JSON.parse(JSON.stringify(message)); posts.push(copy); onMessage(copy); return true; } };
  h.editorChat = { webview: source };
  h.postConfig = async () => h.post({ type: 'config', config: {
    proxyUrl: 'http://127.0.0.1/v1', model: 'fixture-no-model', hasToken: true,
    activity: { ...activity, verified: true }, activityDraft: store.getDraft(), taskWorkspace: store.getView(),
    coach: { name: 'HypeProof', personality: '', configured: true }, profile,
  } });
  return { h, store, source, opened, posts, connections, activity,
    handle: message => h.handleMessage(message, source),
    scoped: message => ({ ...message, activityId: activity.id, taskId: store.getView().activeTaskId }),
  };
}
