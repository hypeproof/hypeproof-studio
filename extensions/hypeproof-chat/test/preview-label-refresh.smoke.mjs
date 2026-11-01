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
let shellWrites = 0, shellHtml = "";
const messages = [];
const vscode = {
  EventEmitter: class { event() {} fire() {} }, ViewColumn: { Beside: 2 },
  workspace: { workspaceFolders: [] },
  window: { createWebviewPanel: () => panel = { reveal() {}, onDidDispose: f => { dispose = f; }, webview: {
    cspSource: 'https://test.invalid', get html() { return shellHtml; }, set html(value) { shellWrites++; shellHtml = value; }, asWebviewUri: u => u.fsPath,
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
const writesAfterRefresh = shellWrites;
preview.setLabels({...labels});
assert.equal(shellWrites,writesAfterRefresh,'identical labels must not recreate the interactive page');
preview.setLabels({...labels,title:'Title only'});
assert.equal(panel.title,'Title only');
assert.equal(shellWrites,writesAfterRefresh,'title-only change must preserve the interactive page');
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

// Exercise the real shell in Chromium, with host transport delivered by its parent frame.
const { findChromium, launch } = await import('./lib/headless-chromium.mjs');
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) throw new Error('Chromium required');
  console.log('preview label browser NOT RUN: Chromium unavailable');
} else {
  const browser = await launch(bin);
  const settle = () => new Promise(r => setTimeout(r, 100));
  const inner = expression => browser.evaluate(`(()=>{const D=document.getElementById('shell').contentDocument;return ${expression};})()`);
  const loadShell = async () => {
    // Only the outer API shim needs CSP removal. The rendered page retains its actual inner CSP.
    const html = panel.webview.html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '')
      .replace('<head>', '<head><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m)});</script>');
    await browser.evaluate(`document.getElementById('shell').srcdoc=${JSON.stringify(html)};true`);
    let ready = false;
    for (let i=0;i<50&&!ready;i++) {
      await settle();
      ready = await inner(`!!D?.defaultView?.posted?.some(m=>m.type==='previewReady')`);
    }
    assert.ok(ready,'replacement shell actually boots');
    assert.notEqual(await inner(`D.querySelector('#placeholder').style.display`),'none','new shell begins with placeholder');
    const offset = messages.length;
    receive({type:'previewReady'});
    const delivered = messages.slice(offset);
    assert.equal(delivered.filter(m=>m.type==='renderPreview').length,1,'host replays one document');
    for (const m of delivered) await browser.evaluate(`document.getElementById('shell').contentWindow.postMessage(${JSON.stringify(m)},'*');true`);
    await settle();
    assert.equal(await inner(`D.querySelector('#placeholder').style.display`),'none','render hides placeholder');
    assert.match(await inner(`D.querySelector('iframe').srcdoc`),/visible-page/);
    return delivered.find(m=>m.type==='renderPreview');
  };
  try {
    for (const width of [390, 1000]) {
      dispose();
      await preview.show('<!doctype html><h1 id="visible-page">Rendered page survives profile refresh</h1><p>Page content stays here.</p>');
      await browser.load('<html><body style="margin:0"><iframe id="shell" style="border:0;width:100vw;height:100vh"></iframe></body></html>',{width,height:700});
      const before = await loadShell();
      preview.setLabels({...labels,title:`Refreshed ${width}`,placeholder:`Updated placeholder ${width}`});
      const after = await loadShell();
      assert.equal(after.html,before.html,'browser reload receives identical checked HTML');
      assert.equal(after.revision,before.revision,'browser reload keeps document revision');
      if (process.env.PREVIEW_LABEL_EVIDENCE) {
        const {mkdirSync,writeFileSync} = await import('node:fs');
        mkdirSync(process.env.PREVIEW_LABEL_EVIDENCE,{recursive:true});
        writeFileSync(`${process.env.PREVIEW_LABEL_EVIDENCE}/${width}.png`,Buffer.from((await browser.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      }
      console.log(`PASS real Chromium shell replacement ${width}px: placeholder hidden, exact page replayed`);
    }
  } finally { await browser.close(); }
}
