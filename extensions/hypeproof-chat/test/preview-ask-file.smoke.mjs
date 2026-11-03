// CGP-KNOW-D-015: real preview host, shell and composer; no native desktop input.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { chatConfig, chatPanelProps } from './sx-screen-fixtures.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
let receive, save, dispose, panel;
const messages = [];
const vscode = {
  EventEmitter: class { event() {} fire() {} },
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: (u) => u },
  workspace: { workspaceFolders: [], onDidSaveTextDocument: f => { save = f; return { dispose() {} }; } },
  window: { createWebviewPanel: () => panel = { reveal() {}, onDidDispose: f => { dispose = f; }, webview: {
    cspSource: 'https://test.invalid', html: '', asWebviewUri: u => u.fsPath,
    onDidReceiveMessage: f => { receive = f; }, postMessage: m => { messages.push(m); },
  } } },
};
const bundled = await build({entryPoints:[`${root}/src/previewProvider.ts`],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const mod = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), Buffer, console });
const preview = new mod.exports.PreviewProvider({});
let asked = 0, release;
const action = async () => { asked++; await new Promise(r => { release = r; }); };
assert.equal(typeof preview.setAskAboutFileEnabled, 'function', 'preview exposes the file-attach grant');
preview.setAskAboutFileEnabled(true);
await preview.show('<p>file one</p>', undefined, action);
receive({type:'previewReady'});
const state = () => messages.filter(m => m.type === 'previewAskState').at(-1);
assert.equal(state().enabled, true);
const revision = state().revision;
receive({type:'preview_ask_file', revision: revision - 1}); assert.equal(asked, 0);
receive({type:'preview_ask_file', revision}); receive({type:'preview_ask_file', revision});
assert.equal(asked, 1, 'double activation single flight');
release(); await new Promise(r => setTimeout(r, 0));
preview.setAskAboutFileEnabled(false);
receive({type:'preview_ask_file', revision}); assert.equal(asked, 1, 'revoked grant');
preview.setAskAboutFileEnabled(true);
let finishRead;
preview.watchForReload({fsPath:'/one'}, () => new Promise(r => { finishRead = r; }));
const pendingSave = save({uri:{fsPath:'/one'}});
await preview.show('<p>generated</p>');
finishRead('<p>stale one</p>'); await pendingSave;
assert.equal(state().enabled, false, 'generated has no file action');
assert.ok(!messages.some(m => m.type === 'renderPreview' && m.html.includes('stale one')), 'old save cannot replace new preview');
receive({type:'preview_ask_file', revision}); assert.equal(asked, 1);
await preview.show('<p>two</p>', undefined, async () => { asked += 10; });
preview.watchForReload({fsPath:'/two'}, async () => '<p>saved two</p>');
await save({uri:{fsPath:'/two'}});
assert.equal(state().enabled, true, 'save retains exact file callback');
receive({type:'preview_ask_file', revision:state().revision});
await new Promise(r => setTimeout(r, 0)); assert.equal(asked, 11);
const shell = panel.webview.html;
dispose(); receive({type:'preview_ask_file', revision:state().revision}); assert.equal(asked, 11);
console.log('preview ask host PASS: grant/revision/single-flight/unbound/save race/dispose');
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw new Error('no Chromium'); console.log('preview ask browser NOT RUN'); process.exit(0); }
const browser = await launch(bin);
const artifact = process.env.PREVIEW_ASK_ARTIFACT_DIR;
if (artifact) mkdirSync(artifact, {recursive:true});
// The shell runs inside an outer page, as in VS Code, where the outer webview frame
// delivers host messages with iframe.contentWindow.postMessage (ev.source === parent).
const settle = () => new Promise(r => setTimeout(r, 120));
const inShell = expr => browser.evaluate(`(()=>{const S=document.getElementById('shell').contentWindow;const D=S.document;return (${expr});})()`);
const send = async data => { await browser.evaluate(`document.getElementById('shell').contentWindow.postMessage(${JSON.stringify(data)},'*')`); await settle(); };
const hidden = () => inShell(`D.querySelector('#preview-header').hidden`);
const findFrameDoc = (node) => {
  if (node.nodeName === 'IFRAME' && node.attributes?.includes('shell')) return node.contentDocument;
  for (const c of node.children ?? []) { const hit = findFrameDoc(c); if (hit) return hit; }
  return null;
};
const shellFocusVisible = async (selector) => {
  const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true });
  const doc = findFrameDoc(root); if (!doc) throw new Error('shell document not found');
  const { nodeId } = await browser.send('DOM.querySelector', { nodeId: doc.nodeId, selector });
  await browser.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
  const { object } = await browser.send('DOM.resolveNode', { nodeId });
  const r = await browser.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
    functionDeclaration: `function(){const s=getComputedStyle(this);return {'outline-style':s.outlineStyle,'outline-width':s.outlineWidth};}` });
  await browser.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  return r.result.value;
};
// Hostile preview pages: the framed page itself, and a frame nested inside it.
const hostileInner = `<p>미리보기 내용</p><script>parent.postMessage({type:'previewAskState',enabled:false,revision:99},'*');parent.postMessage({type:'renderPreview',revision:99,html:'<p id=hijack>x</p>'},'*');<\/script>`;
const hostileNested = `<p>미리보기 내용</p><iframe srcdoc="<script>parent.parent.postMessage({type:'previewAskState',enabled:false,revision:98},'*');parent.parent.postMessage({type:'renderPreview',revision:98,html:'nested-hijack'},'*');<\/script>"></iframe>`;
// Detached nested frame: the nested frame asks its parent to remove it, then posts to
// parent.parent after it is detached (its parent is null when the shell receives it).
const hostileDetached = `<p>미리보기 내용</p><script>addEventListener('message',e=>{if(e.data==='kill'){document.querySelector('iframe').remove();}})<\/script><iframe srcdoc="<script>parent.postMessage('kill','*');const t=Date.now();while(Date.now()-t<400);parent.parent.postMessage({type:'previewAskState',enabled:false,revision:97},'*');parent.parent.postMessage({type:'renderPreview',revision:97,html:'detached-hijack'},'*');<\/script>"></iframe>`;
try {
  for (const width of [320,800,1420]) for (const theme of ['Dark+', 'Light+']) for (const forcedColors of [false,true]) {
    const vars = Object.entries(THEMES[theme]).filter(([,v]) => typeof v === 'string' && v.startsWith('#')).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
    // CSP is removed only for this test's API shim; production CSP is covered by csp-sandbox.
    const html = shell.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '').replace('<head>', `<head><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m)});</script><style>:root{${vars}}</style>`);
    await browser.load(`<!doctype html><html><head><style>html,body{margin:0;height:100%}#shell{width:100vw;height:100vh;border:0;display:block}</style></head><body><iframe id="shell"></iframe></body></html>`, {width, forcedColors, dark:theme==='Dark+'});
    await browser.evaluate(`document.getElementById('shell').srcdoc=${JSON.stringify(html)};true`);
    for (let i = 0; i < 50 && !(await inShell(`Array.isArray(S.posted)&&D.readyState==='complete'`)); i++) await settle();
    assert.equal(await inShell(`S.posted.some(m=>m.type==='previewReady')`), true, 'shell booted');
    assert.equal(await hidden(), true);
    await send({type:'previewAskState',revision:7,enabled:true});
    assert.equal(await hidden(),true,'new identity waits for its render');
    await send({type:'renderPreview',revision:7,html:hostileInner});
    assert.equal(await inShell(`D.querySelector('#placeholder').style.display`), 'none', 'parent-posted renderPreview renders the preview');
    assert.equal(await inShell(`D.querySelector('iframe').srcdoc`), hostileInner, 'framed page cannot replace the rendered preview');
    assert.equal(await hidden(),false,'parent-posted previewAskState shows the header; framed page cannot hide it');
    await send({type:'renderPreview',revision:7,html:hostileNested});
    await settle();
    assert.equal(await inShell(`D.querySelector('iframe').srcdoc`), hostileNested, 'nested frame cannot replace the rendered preview');
    assert.equal(await hidden(),false,'nested frame cannot alter header identity');
    await send({type:'renderPreview',revision:7,html:hostileDetached});
    await new Promise(r => setTimeout(r, 900));
    assert.equal(await inShell(`D.querySelector('iframe').srcdoc`), hostileDetached, 'detached nested frame cannot replace the rendered preview');
    assert.equal(await hidden(),false,'detached nested frame cannot hide the header');
    const geometry = await inShell(`(()=>{const b=D.querySelector('#ask-file'),r=b.getBoundingClientRect(),f=D.querySelector('iframe').getBoundingClientRect();return {width:r.width,height:r.height,font:parseFloat(S.getComputedStyle(b).fontSize),label:b.textContent,frameY:f.y,frameBottom:f.bottom,buttonBottom:r.bottom}})()`);
    assert.ok(geometry.width>=44 && geometry.height>=44 && geometry.font>=14, JSON.stringify({width,theme,forcedColors,geometry}));
    assert.equal(geometry.label,'이 파일에 대해 묻기');
    assert.ok(geometry.frameY>=geometry.buttonBottom && geometry.frameBottom<=801, 'header does not cover or overflow preview');
    const focus = await shellFocusVisible('#ask-file'); assert.equal(focus['outline-style'],'solid'); assert.equal(focus['outline-width'],'2px');
    await inShell(`(D.querySelector('#ask-file').focus(),D.querySelector('#ask-file').click(),D.querySelector('#ask-file').click(),true)`);
    assert.deepEqual(await inShell(`S.posted.filter(m=>m.type==='preview_ask_file')`),[{type:'preview_ask_file',revision:7}]);
    if (artifact) { const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${artifact}/preview-${width}-${theme.replace('+','')}-${forcedColors}.png`,Buffer.from(shot.data,'base64')); }
    // Only a literal true enables the header; a truthy non-boolean keeps it hidden.
    await send({type:'previewAskState',revision:7,enabled:'yes'});
    assert.equal(await hidden(),true,'enabled must be exactly true');
    // A hidden header's button is disabled and posts nothing, even if its disabled state desyncs.
    assert.equal(await inShell(`D.querySelector('#ask-file').disabled`),true,'hidden header button is disabled');
    await inShell(`(D.querySelector('#ask-file').click(),true)`);
    await inShell(`(D.querySelector('#ask-file').disabled=false,D.querySelector('#ask-file').click(),true)`);
    assert.equal(await inShell(`S.posted.filter(m=>m.type==='preview_ask_file').length`),1,'hidden header click posts nothing');
  }
  console.log('preview shell PASS: 12 computed configurations, parent-posted host messages, framed, nested and detached page ignored, hidden button inert, exact revision');
  const cssBundle = await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'/tmp/preview-ask-css',loader:{'.svg':'dataurl'},logLevel:'silent'});
  const css = cssBundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  for (const seat of ['personal','classroom']) {
    const config = chatConfig(3,{fileAttach:true,activityDraft:{text:'남겨 둔 질문',images:[],queued:null}});
    if(seat==='personal') { config.profile.lesson=null; config.profile.activity_kind='personal';config.activity.kind='personal';config.activity.name='내 작업';config.taskWorkspace={scope:'s',revision:1,activeTaskId:'a',tasks:[],sourceSelection:null}; }
    const props = chatPanelProps({config});
    const script = await build({stdin:{resolveDir:`${root}/webview-ui`,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const props=${JSON.stringify(props)};for(const k of ${JSON.stringify(Object.keys(chatPanelProps()).filter(k=>k.startsWith('on')))})props[k]=()=>{};window.removed=0;window.sent=0;props.onSend=()=>window.sent++;function Fixture(){const [file,setFile]=React.useState({path:'notes/plan.md',text:'자료',bytes:6});return <ChatPanel {...props} fileAttachment={file} onAttachFile={()=>{}} onRemoveFileAttachment={()=>{window.removed++;setFile(null)}}/>}createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,loader:{'.svg':'dataurl','.css':'empty'},logLevel:'silent'});
    for (const width of [800,1420]) for (const dark of [false,true]) {
      const vars = Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([,v]) => typeof v === 'string' && v.startsWith('#')).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
      await browser.load(`<!doctype html><html class="${dark?'vscode-dark':'vscode-light'}"><head><style>${css}</style><style>:root{${vars}}</style></head><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>null,setState:()=>{}})</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,dark});
      await new Promise(r=>setTimeout(r,80));
      assert.equal(await browser.evaluate(`!!document.querySelector('textarea[aria-label="코치에게 보낼 메시지"]')`),true);
      const removeBox = await browser.evaluate(`(()=>{const b=document.querySelector('[data-testid="file-attachment"] .hps-page-attachment-remove');const r=b.getBoundingClientRect();return {width:r.width,height:r.height};})()`);
      assert.ok(removeBox.width>=44 && removeBox.height>=44,'separate remove target');
      // The chip is visible in the viewport, directly above the textarea (classroom 800 was offscreen on base).
      const place = await browser.evaluate(`(()=>{const c=document.querySelector('[data-testid="file-attachment"]').getBoundingClientRect(),t=document.querySelector('textarea[aria-label="코치에게 보낼 메시지"]').getBoundingClientRect();return {top:c.top,bottom:c.bottom,textTop:t.top,viewport:innerHeight};})()`);
      assert.ok(place.top>=0 && place.bottom<=place.viewport && place.bottom<=place.textTop+1 && place.textTop-place.bottom<=24, JSON.stringify({seat,width,dark,place}));
      if(artifact) { writeFileSync(`${artifact}/composer-${seat}-${width}-${dark}.json`,JSON.stringify(await browser.evaluate(`(()=>{const r=document.querySelector('[data-testid="file-attachment"]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight};})()`))); const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${artifact}/composer-${seat}-${width}-${dark}.png`,Buffer.from(shot.data,'base64')); }
      const key = async (start,end,extra={}) => browser.evaluate(`(()=>{const t=document.querySelector('textarea[aria-label="코치에게 보낼 메시지"]');t.focus();t.setSelectionRange(${start},${end});return t.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',keyCode:8,bubbles:true,cancelable:true,...${JSON.stringify(extra)}}));})()`);
      await key(2,2); await key(0,2);await key(0,0,{isComposing:true});await key(0,0,{ctrlKey:true});
      assert.equal(await browser.evaluate('removed'),0,'selection/middle/IME/modifier leave file');
      assert.equal(await key(0,0),false,'caret-start removal consumes key');
      await new Promise(r=>setTimeout(r,20));
      assert.equal(await browser.evaluate('removed'),1);
      assert.equal(await browser.evaluate(`document.querySelector('textarea[aria-label="코치에게 보낼 메시지"]').value`),'남겨 둔 질문');
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('textarea[aria-label="코치에게 보낼 메시지"]')`),true);
      assert.equal(await browser.evaluate('sent'),0);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid="file-attachment"]')`),false);
    }
  }
  console.log('composer PASS: personal/classroom dark/light 800/1420; start/selection/IME/modifier/focus/draft/no send');
} finally { await browser.close(); }
