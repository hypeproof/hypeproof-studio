// CGP-ART-R-003 — the leave gate on the REAL wiring of ChatPanelProvider (constructed for real, bundled with esbuild,
// only VS Code I/O scripted). The helper-level cases live in annotation-provider.test.tsx; these guard what the
// verifier's mutations removed unnoticed:
//   W1  the constructor subscribes to onDidCloseBrowserTab and a closed preview tab holding captured marks asks first
//   W2  the real capture handler (pickElement) records the tab; closing an unrelated tab asks nothing
//   W3  opsFreezeInput never prompts (classroom ops freeze must not pop a discard modal)
//   W4  switchProject asks before the clone/pull and the window reload; keep = nothing moves, discard = it proceeds
//   W5  the real repickTaskFolder asks before carrying the task store and reloading; keep = nothing moves + the exact keep note
//   W6  the real handleTaskMessage: taskCreate / taskSelect ask first (keep = no store mutation), taskRecoverDraft never asks
//   W7  a closed tab of another scope does not rebind or prompt; a scope change is synced before the leave check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ext = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({
  stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider.ts';", resolveDir: ext, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});
const inert = { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : new Proxy(function () {}, inert)), apply: () => new Proxy(function () {}, inert), construct: () => new Proxy({}, inert) };
const prompts = [];
let answer;
const closeListeners = [];
const pickedDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'annotation-leave-')));
const previewTab = { url: 'http://127.0.0.1:5173/index.html', title: 'Preview' };
const vscode = new Proxy({
  window: {
    showOpenDialog: async () => [{ fsPath: pickedDir }],
    showWarningMessage: async (...args) => { prompts.push(args); return answer; },
    createOutputChannel: () => ({ appendLine() {} }),
    tabGroups: { all: [{ tabs: [{ label: 'Preview', input: undefined, isActive: true }] }] },
    onDidCloseBrowserTab: f => { closeListeners.push(f); return { dispose() {} }; },
  },
  workspace: { getConfiguration: () => ({ get: (k, fallback) => (k === 'annotationBatchEnabled' ? true : fallback) }), workspaceFolders: [] },
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
  URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, structuredClone, performance,
});
const { ChatPanelProvider } = mod.exports;
const memento = () => ({ get: () => undefined, update: async () => {}, keys: () => [] });
const context = {
  subscriptions: [], extensionUri: { fsPath: '/ext' }, extensionPath: '/ext', extension: { packageJSON: {} },
  globalState: memento(), workspaceState: memento(), globalStorageUri: { fsPath: '/tmp/hps-none' }, storageUri: { fsPath: '/tmp/hps-none' },
  secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
};
const crop = { mimeType: 'image/png', data: 'UE5H', clip: { x: 1, y: 2, width: 3, height: 4 } };
const element = { ref: 'e1', backendNodeId: 1, tag: 'button', text: '시작', snippet: '<button>시작</button>', snippetTruncated: false, style: {}, crop, source: 'unmapped', url: previewTab.url, route: '/index.html', documentGeneration: 'g1', artifact: { id: 'v1', entry: 'index.html', files: [] }, captureMs: 1 };

let currentScope = 'activity:task';
const provider = new ChatPanelProvider(context, {}, {});
Object.assign(provider, {
  pendingSends: 0, getHistory: () => [], post: async () => true, postPageNotice() {},
  annotationScope: () => currentScope, isCurriculumRuntimeEnabled: () => true, isImagePasteEnabled: () => true,
  annotationRuntimeAvailable: () => true, cachedProfile: { activity_kind: 'personal' },
  mcpBrowser: {
    annotationIdentity: async () => ({ generation: 'g1', artifactId: 'v1' }), annotationRefsValid: () => true,
    clearAnnotationMarkers: async () => {}, annotationMarker: async () => {}, pickElement: async () => element,
    currentTab: () => previewTab, setTargetTab() {},
  },
  liveServer: { currentUrl: () => 'http://127.0.0.1:5173/', currentRoot: () => null },
  revealBrowserTab: async () => {}, coachBrowserTabs: () => [],
});

// W1 + W2: the subscription exists and the real capture path feeds it.
assert.ok(closeListeners.length >= 2, 'the constructor subscribes to onDidCloseBrowserTab (preview recovery and the annotation gate)');
const fireClose = tab => Promise.all(closeListeners.map(f => f(tab))).then(() => new Promise(r => setImmediate(r)));
provider.syncAnnotationScope();
await provider.pickElement('element');
assert.equal(provider.annotationBatch.size, 1, 'the real handler captured one mark');
answer = undefined;
await fireClose({ url: 'http://127.0.0.1:9999/other.html', title: 'Other' });
assert.equal(prompts.length, 0, 'closing an unrelated tab asks nothing');
await fireClose(previewTab);
assert.equal(prompts.length, 1, 'closing the captured preview tab asks first');
assert.equal(prompts[0][0], '보내지 않은 표시가 1개 있어요');
assert.equal(provider.annotationBatch.size, 1, 'a dismissed dialog keeps the draft');
prompts.length = 0;

// W3: the classroom ops freeze is not a leave.
await provider.opsFreezeInput(true);
assert.equal(prompts.length, 0, 'opsFreezeInput does not ask');
assert.equal(provider.annotationBatch.size, 1, 'opsFreezeInput keeps the draft');

// W4: switchProject asks before anything is cloned, pulled or reopened.
const calls = [];
provider.sitePublisher = () => ({ switchProject: async () => { calls.push('switchProject'); return { action: 'open', repo: 'r', folder: '/tmp/r' }; } });
provider.projectOpener = async folder => { calls.push('open:' + folder); };
provider.postAppReply = async () => {};
answer = { title: '계속 고치기' };
await provider.switchProject();
assert.deepEqual(calls, [], 'keep: no clone/pull and no window reload');
assert.equal(provider.annotationBatch.size, 1);
assert.equal(prompts.length, 1);
answer = { title: '버리기' };
await provider.switchProject();
assert.deepEqual(calls, ['switchProject', 'open:/tmp/r'], 'discard: the move proceeds');
assert.equal(provider.annotationBatch.size, 0);

// W5: the real repickTaskFolder (re-pick reloads the window through projectOpener) asks first.
const KEEP_NOTE = '표시를 그대로 두었어요. 계속 고친 뒤 다시 활동을 바꿔 주세요.';
const notes = [];
calls.length = 0; prompts.length = 0;
await provider.pickElement('element');
assert.equal(provider.annotationBatch.size, 1, 'a fresh unsent mark before the re-pick');
Object.assign(provider, {
  cachedProfile: { activity_kind: 'classroom' }, // folder consent does not ask for this seat, so the leave gate is the only question
  missingTaskFolderPath: async () => '/gone/folder',
  carryTaskStoreTo: async folder => { calls.push('carry:' + folder); return true; },
  postMissingTaskFolder: async note => { notes.push(note); },
});
answer = { title: '계속 고치기' };
await provider.repickTaskFolder();
assert.equal(prompts.length, 1, 're-pick asks about the unsent marks');
assert.equal(prompts[0][0], '보내지 않은 표시가 1개 있어요');
assert.deepEqual(calls, [], 'keep: the task store is not carried and the window does not reload');
assert.deepEqual(notes, [KEEP_NOTE], 'keep: the re-pick refusal shows the exact keep message');
assert.equal(provider.annotationBatch.size, 1, 'keep: the draft stays');
prompts.length = 0; notes.length = 0;
answer = { title: '버리기' };
await provider.repickTaskFolder();
assert.equal(prompts.length, 1);
assert.deepEqual(calls, ['carry:' + pickedDir, 'open:' + pickedDir], 'discard: carry then reload through the project opener');
assert.deepEqual(notes, [undefined], 'discard: no refusal note');
assert.equal(provider.annotationBatch.size, 0);
provider.cachedProfile = { activity_kind: 'personal' };

// W6: the real task message handler. A fake task store records every mutation.
const mutations = [];
const view = { activeTaskId: 'task', revision: 1, tasks: [], error: undefined };
const store = {
  getView: () => view, getHistory: () => [], getDraft: () => ({}),
  create: async () => { mutations.push('create'); }, select: async () => { mutations.push('select'); },
  recoverDraft: async () => { mutations.push('recoverDraft'); }, rename: async () => { mutations.push('rename'); },
};
Object.assign(provider, {
  currentTaskStore: () => store, retryInterruptedHistory: async () => {}, postConfig: async () => {}, postHistory: async () => {},
  endTaskCommandAllows() {}, clearPageAttachment() {}, clearFileAttachment() {},
});
for (const type of ['taskCreate', 'taskSelect']) {
  calls.length = 0; prompts.length = 0; mutations.length = 0;
  await provider.pickElement('element');
  assert.equal(provider.annotationBatch.size, 1);
  answer = { title: '계속 고치기' };
  await provider.handleTaskMessage({ type, taskId: 'task', id: 'task2' });
  assert.equal(prompts.length, 1, type + ' asks about the unsent marks');
  assert.deepEqual(mutations, [], type + ' keep: the task store is not touched');
  assert.equal(provider.annotationBatch.size, 1, type + ' keep: the draft stays');
  assert.equal(provider.connectionChanging, false, type + ' keep: the freeze is released');
  answer = { title: '버리기' };
  await provider.handleTaskMessage({ type, taskId: 'task', id: 'task2' });
  assert.deepEqual(mutations, [type === 'taskCreate' ? 'create' : 'select'], type + ' discard: the move proceeds');
  assert.equal(provider.annotationBatch.size, 0);
}
// taskRecoverDraft restores a saved input; it is not a leave and never asks.
prompts.length = 0; mutations.length = 0;
await provider.pickElement('element');
await provider.handleTaskMessage({ type: 'taskRecoverDraft', taskId: 'task' });
assert.equal(prompts.length, 0, 'taskRecoverDraft does not ask');
assert.equal(provider.annotationBatch.size, 1, 'taskRecoverDraft keeps the draft');
assert.equal(provider.connectionChanging, false);

// W7: scope handling.
// A closed tab that belongs to another scope neither prompts nor rebinds the draft.
prompts.length = 0;
assert.equal(provider.annotationBoundScope, 'activity:task');
currentScope = 'activity:other';
await fireClose(previewTab);
assert.equal(prompts.length, 0, 'a tab captured under another scope asks nothing');
assert.equal(provider.annotationBoundScope, 'activity:task', 'and does not rebind the draft on its own');
// A scope change is synced before the leave check, so the parked draft of the old task is not asked about.
assert.equal(await provider.confirmAnnotationLeave(), true, 'the new scope holds no marks, so leaving is free');
assert.equal(prompts.length, 0, 'no prompt for marks that belong to another task');
assert.equal(provider.annotationBoundScope, 'activity:other');
currentScope = 'activity:task';
provider.syncAnnotationScope();
assert.equal(provider.annotationBatch.size, 1, 'the old task still holds its parked marks');
console.log('PASS annotation leave wiring: close subscription, capture records the tab, ops freeze no prompt, switchProject, re-pick, task create/select, scope sync');
process.exit(0);
