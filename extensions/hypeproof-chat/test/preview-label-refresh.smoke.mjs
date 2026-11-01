// #3232: a profile-label refresh must not replace the current page with a placeholder.
// Real PreviewProvider; only the VS Code webview transport is simulated.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
let receive, dispose, panel;
const messages = [];
const vscode = {
  EventEmitter: class { event() {} fire() {} }, ViewColumn: { Beside: 2 },
  workspace: { workspaceFolders: [] },
  window: { createWebviewPanel: () => panel = { reveal() {}, onDidDispose: f => { dispose = f; }, webview: {
    cspSource: 'https://test.invalid', html: '', asWebviewUri: u => u.fsPath,
    onDidReceiveMessage: f => { receive = f; }, postMessage: m => { messages.push(m); },
  } } },
};
const source = process.env.PREVIEW_LABEL_SOURCE ?? `${root}/src/previewProvider.ts`;
const bundled = await build({entryPoints:[source],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const mod = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, { module:mod, exports:mod.exports, require:id=>id==='vscode'?vscode:require(id), Buffer, console });
const preview = new mod.exports.PreviewProvider({});
const renders = () => messages.filter(m => m.type === 'renderPreview');
const labels = { title:'웹사이트', placeholder:'웹사이트가 여기에 나와요', emoji:'🌐' };
await preview.show('<h1 id="page-a">My page</h1>', {fsPath:'https://test.invalid/work/'});
receive({type:'previewReady'});
assert.equal(renders().length,1);
const first = renders()[0];
assert.match(first.html,/page-a/);
assert.match(first.html,/Content-Security-Policy/);
preview.setLabels(labels);
assert.equal(renders().length,1,'wait for replacement shell readiness');
receive({type:'previewReady'});
assert.equal(renders().length,2,'label refresh must replay the rendered page');
assert.equal(renders()[1].html,first.html,'retain exact CSP/base-injected document');
assert.equal(renders()[1].revision,first.revision,'labels do not change document identity');
// A new document while the shell is loading supersedes the old replay.
preview.setLabels({...labels,title:'New title'});
await preview.show('<p id="page-b">new page</p>');
receive({type:'previewReady'});
assert.match(renders().at(-1).html,/page-b/);
assert.doesNotMatch(renders().at(-1).html,/page-a/);
// Closing/reopening must not revive the previous panel's content.
dispose();
preview.setLabels(labels);
await preview.show('<p id="page-c">reopened</p>');
preview.setLabels({...labels,title:'Reopened title'});
receive({type:'previewReady'});
assert.match(renders().at(-1).html,/page-c/);
assert.doesNotMatch(renders().at(-1).html,/page-[ab]/);
console.log('PASS label refresh replays exact rendered HTML; latest pending page wins; dispose/reopen isolates content');
