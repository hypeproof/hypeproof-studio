import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
import {findChromium, launch} from './lib/headless-chromium.mjs';
const source=new URL('../../../scripts/patches/core/preview-recovery-src/vs/workbench/contrib/browserView/electron-browser/hpsPreviewRecovery.ts',import.meta.url);
const css=readFileSync(new URL(source.href.replace(/\.ts$/,'.css')),'utf8');
const bundle=await build({entryPoints:[source.pathname],bundle:true,format:'iife',globalName:'Recovery',write:false});
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('browser required');console.log('NOT RUN: browser unavailable');process.exit(0);}
const browser=await launch(bin);
try {
 for(const width of [320,800,1420]) for(const dark of [false,true]) {
  await browser.load(`<!doctype html><style>body{margin:0;min-height:100vh;background:${dark?'#1e1e1e':'#fff'};--vscode-editor-background:${dark?'#1e1e1e':'#fff'};--vscode-editor-foreground:${dark?'#fff':'#222'};--vscode-font-family:Arial;--vscode-button-background:#0063ad;--vscode-button-foreground:#fff;--vscode-focusBorder:#007acc}main{height:100vh;display:flex}.browser-error-container{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;padding:80px 40px;overflow-y:auto;background:var(--vscode-editor-background)}${css}</style><main class="browser-error-container"></main><script>${bundle.outputFiles[0].text}</script>`,{width,dark});
  await browser.evaluate(`window.calls=[];window.view={requestId:'0123456789abcdef',url:'http://localhost:8000/',text:'미리보기 서버가 꺼져 있어요',action:'restart_preview',actionLabel:'다시 켜기',detail:'<img src=x onerror=alert(1)>'};window.dispose=Recovery.renderHpsPreviewRecovery(document.querySelector('main'),view,(...a)=>{calls.push(a);return new Promise(r=>window.resolveAction=r)});`);
  const state=await browser.evaluate(`(()=>{const b=document.querySelector('button'),p=document.querySelector('.hps-preview-error-cause');return {focus:document.activeElement===b,font:getComputedStyle(p).fontSize,height:b.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth,details:document.querySelector('details').open,buttons:document.querySelectorAll('button').length,injected:document.querySelector('code img')!==null}})()`);
  assert.deepEqual(state,{focus:true,font:'16px',height:44,overflow:false,details:false,buttons:1,injected:false});
  assert.equal(await browser.evaluate(`Recovery.parseHpsPreviewRecovery(view,'http://localhost:9000/')===undefined`),true);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('main')).backgroundColor`),dark?'rgb(30, 30, 30)':'rgb(255, 255, 255)');
  if(process.env.HPS_PREVIEW_EVIDENCE){mkdirSync(process.env.HPS_PREVIEW_EVIDENCE,{recursive:true});const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.HPS_PREVIEW_EVIDENCE}/preview-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
  if(width===320){await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});assert.notEqual(await browser.evaluate(`getComputedStyle(document.querySelector('button')).borderStyle`),'none');}
  await browser.evaluate(`document.querySelector('button').click();document.querySelector('button').click()`);
  assert.equal(await browser.evaluate('calls.length'),1);
  await browser.evaluate('resolveAction(false)');
  assert.match(await browser.evaluate(`document.querySelector('[role=status]').textContent`),/상태가 바뀌/);
  await browser.evaluate('dispose()');
  assert.equal(await browser.evaluate(`document.querySelectorAll('.hps-preview-error').length`),0);
 }
 console.log('PASS preview error renderer: six width/theme cases, focus, folded technical text, duplicate action, stale URL');
} finally { await browser.close(); }
