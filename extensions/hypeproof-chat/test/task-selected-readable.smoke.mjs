// #2973: real webview cascade, selected task text in normal and forced-colour themes.
// Scripted config/VS Code bridge; no installed-app or human acceptance claim.
// TASK_READABLE_SHOTS saves rendered evidence. FOCUS_REQUIRE_BROWSER=1 refuses skips.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('task-menu-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('task-menu-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');

const temp = mkdtempSync(path.join(tmpdir(), 'hps-task-menu-computed-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const LONG = '그림'.repeat(40) + 'x'.repeat(60);
const MOVES = {
  personal: { allowed: true, destinations: [{ ref: 'ref-b', name: '그림 연습' }, { ref: 'ref-c', name: LONG }] },
  class: { allowed: false, reason: '수업 작업은 이 수업 활동 안에만 둘 수 있어요. 다른 활동으로 옮길 수 없어요.' },
};
const config = (seat) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + seat, name: '내 작업', kind: 'personal', workspace: '/synthetic', verified: true },
  taskWorkspace: { scope: 's-' + seat, revision: 1, activeTaskId: 't1', sourceSelection: null, tasks: [
    { id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 2, messageCount: 2 },
    { id: 't2', title: '둘째 작업', createdAt: 1, updatedAt: 1, messageCount: 0 },
  ] },
  taskMove: MOVES[seat],
});


const b = await launch(bin);
try {
 for (const forced of [false,true]) for (const theme of ['dark','light']) for (const width of [800,1420]) {
  await b.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:forced?'active':'none'},{name:'prefers-color-scheme',value:theme}]});
  const {identifier}=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>sent.push(m),getState:()=>undefined,setState:()=>{}});document.addEventListener('DOMContentLoaded',()=>{document.documentElement.setAttribute('style',${JSON.stringify(THEMES[theme])});document.body.classList.add('vscode-${theme}');});`});
  await b.send('Page.navigate',{url:base});
  for(let i=0;i<100 && !(await b.evaluate(`window.sent?.some(m=>m.type==='ready')`).catch(()=>false));i++)await new Promise(r=>setTimeout(r,50));
  await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config('personal'))}}}))`);
  for(let i=0;i<100 && !(await b.evaluate(`!!document.querySelector('.tw-task[aria-current="page"]')`));i++)await new Promise(r=>setTimeout(r,50));
  const result=await b.evaluate(`(()=>{const row=document.querySelector('.tw-task[aria-current="page"]'),title=row.querySelector('.tw-task-title');const rs=getComputedStyle(row),ts=getComputedStyle(title);return {text:title.textContent,color:ts.color,background:rs.backgroundColor,titleBackground:ts.backgroundColor,border:rs.borderColor};})()`);
  console.log(JSON.stringify({forced,theme,width,...result}));
  const pixels=await b.evaluate(`(()=>{const row=document.querySelector('.tw-task[aria-current="page"]'),title=row.querySelector('.tw-task-title');const ctx=document.createElement('canvas').getContext('2d');const rgb=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};const chain=[];for(let e=row;e;e=e.parentElement)chain.unshift(e);let bg=[255,255,255];for(const e of chain){const c=rgb(getComputedStyle(e).backgroundColor),a=c[3]/255;bg=bg.map((v,i)=>v*(1-a)+c[i]*a);}return {foreground:rgb(getComputedStyle(title).color).slice(0,3),background:bg};})()`);
  const palette=await b.evaluate(`(()=>{const p=document.createElement('span');p.style.cssText='color:CanvasText;background:Canvas;border:1px solid Highlight';document.body.append(p);const s=getComputedStyle(p),r={color:s.color,background:s.backgroundColor,border:s.borderColor};p.remove();return r;})()`);
  assert.ok(result.text.trim(), 'selected title exists');
  if(forced) {
    assert.equal(result.color,palette.color,'selected text uses system canvas text');
    assert.equal(result.background,palette.background,'selected row avoids filled text backplates');
    assert.equal(result.border,palette.border,'system Highlight border still identifies selection');
  } else {
    const luminance=color=>{const c=color.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
    const a=luminance(pixels.foreground),z=luminance(pixels.background);
    assert.ok((Math.max(a,z)+.05)/(Math.min(a,z)+.05)>=4.5,'selected title contrast is at least4.5');
  }
  if(process.env.TASK_READABLE_SHOTS){mkdirSync(process.env.TASK_READABLE_SHOTS,{recursive:true});const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(process.env.TASK_READABLE_SHOTS,`${theme}-${forced}-${width}.png`),Buffer.from(shot.data,'base64'));}
  await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
 }
} finally {await b.close();server.close();rmSync(temp,{recursive:true,force:true});}

console.log("PASS selected task readability: eight full-cascade cases");
