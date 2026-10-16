import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export * from './src/previewProvider.ts'; export * from './src/chatPanelProvider.ts'; export * from './src/startPage.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const panels = [];
const vscode = {
  ViewColumn: { One: 1, Two: 2, Beside: -2 },
  Uri: { joinPath: (...parts) => parts.join('/') },
  commands: { executeCommand: async () => {} },
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
  workspace: { workspaceFolders: [] },
  window: { createWebviewPanel(_type, title, options) {
    let html = '', updates = 0, receive;
    const disposals = [];
    const panel = { title, viewColumn: options.viewColumn, options, reveals: [], messages: [],
      webview: { cspSource: 'vscode-webview://test', get html() { return html; }, set html(value) { html = value; updates++; },
        postMessage(message) { panel.messages.push(message); }, onDidReceiveMessage(fn) { receive = fn; } },
      onDidDispose(fn) { disposals.push(fn); }, dispose() { this.disposed = true; for (const fn of disposals) fn(); }, reveal(column, preserveFocus) { this.viewColumn = column; this.reveals.push({ column, preserveFocus }); },
      ready() { receive({ type: 'previewReady' }); }, get updates() { return updates; } };
    panels.push(panel); return panel;
  } },
};
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer });
const { PreviewProvider, ChatPanelProvider, StartPage } = module.exports;
let welcomeColumn = 1;
const preview = new PreviewProvider({}, () => { const column = welcomeColumn; welcomeColumn = undefined; return column; });
const labels = { title: '자동화 진행', placeholder: '대화에서 원하는 업무를 알려 주세요', emoji: '◇' };
preview.setLabels(labels);
await preview.showAutomation('<p>First step</p>');
assert.equal(panels.length, 1);
assert.equal(panels[0].options.viewColumn, 1, 'automation takes the released welcome column');
assert.equal(panels[0].options.preserveFocus, true);
panels[0].ready();
assert.match(panels[0].messages.at(-1).html, /First step/);
preview.setLabels(labels);
await preview.showAutomation('<p>Completed step</p>');
assert.equal(panels.length, 1, 'progress reuses the existing panel');
assert.equal(panels[0].updates, 1, 'identical labels do not restart the shell during each progress update');
assert.equal(panels[0].reveals.at(-1).column, 1);
assert.equal(panels[0].reveals.at(-1).preserveFocus, true);
assert.match(panels[0].messages.at(-1).html, /Completed step/, 'ready panel gets fresh progress without another handshake');
// An existing preview is moved into the released welcome column without disposing it.
const legacy = new PreviewProvider({}, () => 1);
await legacy.show('<p>Existing preview</p>');
assert.equal(panels[1].viewColumn, -2);
await legacy.showAutomation('<p>Automation</p>');
assert.equal(panels.length, 2);
assert.equal(panels[1].viewColumn, 1);
const noWelcome = new PreviewProvider({});
await noWelcome.showAutomation('<p>Own canvas</p>');
assert.equal(panels[2].viewColumn, 1, 'no welcome and no preview defaults to the main editor group');
console.log('PASS automation preview: main canvas reuse, focus preserved, live progress, no extra editor split');

// Exercise the first-activity handoff that differs from an existing sidebar chat.
const chat = Object.create(ChatPanelProvider.prototype);
chat.context = { extensionUri: '/synthetic-extension' };
chat.activeStreams = new Map();
chat.renderHtml = () => '<html>Conversation</html>';
chat.refreshConfig = () => {};
const startPage = new StartPage({}, chat, async () => true);
const ownedEntry = vscode.window.createWebviewPanel('hypeproof.start', 'Start', { viewColumn: 1 });
startPage.panel = ownedEntry;
await startPage.openChat();
assert.equal(ownedEntry.title, 'AI와 작업');
assert.equal(startPage.panel, undefined, 'the start surface transfers ownership to editor chat');
const simultaneous = new PreviewProvider({}, () => {
  startPage.closeForAutomationPreview();
  return chat.automationPreviewColumn();
});
await simultaneous.showAutomation('<p>Imported skill</p>');
const graph = panels.at(-1), count = panels.length;
assert.equal(ownedEntry.viewColumn, 1);
assert.equal(ownedEntry.disposed, undefined, 'graph updates must not close the transferred conversation');
assert.equal(graph.viewColumn, 2, 'first activity graph is beside the conversation, not over it');
graph.ready();
await simultaneous.showAutomation('<p>Preview completed</p>');
assert.equal(panels.length, count, 'progress does not create a third editor group');
assert.equal(graph.reveals.at(-1).column, 2);
assert.equal(graph.reveals.at(-1).preserveFocus, true);
assert.match(graph.messages.at(-1).html, /Preview completed/);
// Returning to sidebar mode reuses the same graph in One, disposing only a
// separately owned startup entry (never another user editor).
ownedEntry.dispose();
const secondEntry = vscode.window.createWebviewPanel('hypeproof.start', 'Start', { viewColumn: 2 });
startPage.panel = secondEntry;
await simultaneous.showAutomation('<p>Sidebar continuation</p>');
assert.equal(secondEntry.disposed, true);
assert.equal(graph.viewColumn, 1);
assert.equal(panels.length, count + 1, 'only the fixture entry was added; graph panel is reused');
console.log('PASS first-activity editor chat stays visible beside graph; sidebar recovery reuses One and releases only startup entry');
