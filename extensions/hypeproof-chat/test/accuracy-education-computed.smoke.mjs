import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('accuracy-education-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('accuracy-education-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = process.env.HPS_WEBVIEW_SRC ? path.resolve(process.env.HPS_WEBVIEW_SRC) : path.join(webview, 'src');
const temp = mkdtempSync(path.join(tmpdir(), 'hps-accuracy-education-'));
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
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true },
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : '내 작업', kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } }),
});

const history=[{id:'a1',role:'assistant',content:Array.from({length:40},(_,i)=>`${i+1}번째 줄: 첫 AI 결과를 직접 비교해요.`).join('\n'),createdAt:1}];
let b;
try {
 try { b=await launch(bin); } catch(error) {
  if(process.env.FOCUS_REQUIRE_BROWSER)throw error;
  server.close();rmSync(temp,{recursive:true,force:true});
  console.log('accuracy-education-computed NOT RUN: '+error.message);process.exit(0);
 }
 for(const surface of ['personal','classroom']) for(const theme of ['dark','light']) for(const width of [1420,800,320]) for(const forced of [false,true]) {
  await b.send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:forced?'active':'none'}]});
  const {identifier}=await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.sent=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.sent.push(m),getState:()=>undefined,setState(){}});document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.cssText=${JSON.stringify(THEMES[theme])};document.body.classList.add('vscode-${theme}');});`});
  try {
   await b.send('Page.navigate',{url:base});
   for(let i=0;i<100&&!await b.evaluate(`window.sent?.some(m=>m.type==='ready')`).catch(()=>false);i++)await new Promise(r=>setTimeout(r,50));
   await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config(surface))}}}));`);
   await new Promise(r=>setTimeout(r,100));
   await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'history',messages:${JSON.stringify(history)}}}));`);
   await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'accuracyEducation',requestId:window.sent.filter(m=>m.type==='accuracyEducationRequest').at(-1).requestId,offer:{scope:'s',messageId:'a1'}}}));`);
   await new Promise(r=>setTimeout(r,100));
   for(const state of ['card','checking']) {
    if(state==='checking') {await b.evaluate(`document.querySelector('.hps-accuracy-card button').click()`);await new Promise(r=>setTimeout(r,50));}
    const result=await b.evaluate(`(()=>{const c=document.querySelector('.hps-accuracy-card');if(!c)return null;const r=c.getBoundingClientRect(),p=c.parentElement.getBoundingClientRect();const style=getComputedStyle(c);return {fg:style.color,bg:style.backgroundColor,width:r.width,left:r.left,right:r.right,parentLeft:p.left,parentRight:p.right,scroll:c.scrollWidth,client:c.clientWidth,buttons:[...c.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {w:r.width,h:r.height,font:parseFloat(s.fontSize),scroll:e.scrollWidth,client:e.clientWidth}})}})()`);
    assert.ok(result,'card mounted');
    const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
    const fg=luminance(result.fg),bg=luminance(result.bg);assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,'text contrast 4.5:1');assert.ok(result.width>0&&result.left>=result.parentLeft&&result.right<=result.parentRight+1,'inside chat column');
    assert.ok(result.scroll<=result.client+1,'no horizontal card overflow');
    for(const x of result.buttons){assert.ok(x.w>=44&&x.h>=44,'44px target');assert.ok(x.font>=14,'14px text');assert.ok(x.scroll<=x.client+1,'whole Korean labels');}
    if(state==='checking') {
     const answer=await b.evaluate(`(()=>{const a=document.querySelector('.hps-accuracy-card .hps-accuracy-answer');if(!a)return null;const s=getComputedStyle(a),r=a.getBoundingClientRect(),c=a.parentElement.getBoundingClientRect();a.focus();const focused=document.activeElement===a;const bs=[...document.querySelectorAll('.hps-accuracy-card button')].map(e=>{const q=e.getBoundingClientRect();return {l:q.left,r:q.right,t:q.top,b:q.bottom,disabled:e.disabled}});return {font:parseFloat(s.fontSize),overflowY:s.overflowY,whiteSpace:s.whiteSpace,height:r.height,left:r.left,right:r.right,cLeft:c.left,cRight:c.right,scrollW:a.scrollWidth,clientW:a.clientWidth,scrollH:a.scrollHeight,clientH:a.clientHeight,tabIndex:a.tabIndex,focused,bs}})()`);
     assert.ok(answer,'answer mounted');
     assert.ok(answer.font>=14,'answer text is at least 14px');
     assert.ok(/^(auto|scroll)$/.test(answer.overflowY),'answer scrolls instead of growing');
     assert.ok(answer.height<=44*6+1,'answer height is bounded to six control heights');
     assert.ok(answer.scrollH>answer.clientH,'a long answer scrolls inside its box');
     assert.ok(answer.whiteSpace==='pre-wrap','answer keeps the AI line breaks');
     assert.ok(answer.left>=answer.cLeft&&answer.right<=answer.cRight+1&&answer.scrollW<=answer.clientW+1,'answer inside the column without horizontal overflow');
     assert.ok(answer.tabIndex>=0&&answer.focused,'answer is keyboard focusable');
     const answerRing=await b.focusVisibleStyle('.hps-accuracy-answer');assert.equal(answerRing['outline-width'],'2px');assert.equal(answerRing['outline-style'],'solid');
     for(let i=1;i<answer.bs.length;i++){const p=answer.bs[i-1],n=answer.bs[i],sameRow=Math.abs(n.t-p.t)<2;assert.ok(sameRow?n.l-p.r>=4:n.t-p.b>=4,'buttons are separated by a gap');}
     assert.equal(answer.bs[0].disabled,false,'the comparison toggle is enabled');assert.equal(answer.bs[1].disabled,true,'the finish button stays disabled until the learner compares');
    }
    const ring=await b.focusVisibleStyle('.hps-accuracy-card button');assert.equal(ring['outline-width'],'2px');assert.equal(ring['outline-style'],'solid');
    if(process.env.ACCURACY_SCREENSHOTS){mkdirSync(process.env.ACCURACY_SCREENSHOTS,{recursive:true});const png=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(process.env.ACCURACY_SCREENSHOTS,`${surface}-${theme}-${width}-${forced}-${state}.png`),Buffer.from(png.data,'base64'));}
   }
  } finally {await b.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
 }
 console.log('PASS accuracy computed geometry: real built webview, 24 seat/theme/width/forced-color states');
} finally {if(b)await b.close();server.close();rmSync(temp,{recursive:true,force:true});}
