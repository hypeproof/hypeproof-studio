// CGP-DS-R-007: changing prose must not change its code toolbar or code glyphs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { renderComponent } from './sx-render.mjs';
import { chatPanelProps, chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const SANS='-apple-system, system-ui, sans-serif'; // shipped ui + content role (--ds-p-136)
const MONO='ui-monospace, Menlo, monospace'; // shipped code role (--ds-p-184)
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN font roles: no Chromium'); process.exit(0); }
const src = new URL('../webview-ui/src/', import.meta.url);
const appBundle=await build({entryPoints:[fileURLToPath(new URL('main.tsx',src))],bundle:true,platform:'browser',format:'esm',outdir:'font-test-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=appBundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text; assert.ok(css,'built webview CSS');
const browser = await launch(bin);
const evidence=process.env.FONT_ROLES_EVIDENCE; if(evidence) mkdirSync(evidence,{recursive:true});
try {
  for (const seat of ['personal','classroom']) {
    // Only a taskWorkspace makes ChatPanel take its personal branch (personalWorkspace = !!taskWorkspace && !lesson).
    const taskWorkspace=seat==='personal'?{scope:'s',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'글꼴 확인',createdAt:1,updatedAt:1,messageCount:1}],sourceSelection:null}:undefined;
    const config=chatConfig(3,{ profile:{...chatConfig().profile,lesson:null}, activity:{id:'font-test',name:'글꼴 확인',kind:seat,workspace:'/w',verified:true}, ...(taskWorkspace?{taskWorkspace}:{}) });
    const markup=await renderComponent('ChatPanel',chatPanelProps({config,messages:[{id:'answer',role:'assistant',createdAt:1,content:'본문 글꼴 확인과 `inlineCode`입니다.\n\n~~~js\nconst value = 42;\n~~~'}]}));
    assert.equal(markup.includes('data-chat-detail="personal"'),seat==='personal',`ChatPanel must render the ${seat} branch for real`);
    for(const dark of [false,true]) for(const width of [800,1420]) {
      const theme=THEMES[dark?'Dark+':'Light+']; const vars=Object.entries(theme).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
      await browser.load(`<html style="${vars}"><head><style>${css}</style></head><body class="${dark?'vscode-dark':'vscode-light'}"><div class="hps-shell" data-chat-detail="${seat}">${markup}</div></body></html>`,{width,dark});
      // Shipped defaults first: no host font variable, no component override. Kills a swapped default role.
      const readAll=()=>browser.evaluate(`(() => {const font=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).fontFamily:null};const tools=[...document.querySelectorAll('.hps-codeblock-tools *')].map(e=>getComputedStyle(e).fontFamily);return {prose:font('.hps-prose p'),inline:font('.hps-prose p code'),block:font('.hps-codeblock pre code'),toolbar:font('.hps-codeblock button'),header:font('.hps-header button'),tools};})()`);
      assert.equal(await browser.evaluate(`getComputedStyle(document.body).getPropertyValue('--vscode-font-family')+getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family')`),'','default pass needs host font variables unset');
      const defaults=await readAll(); const tag=`${seat}/${dark}/${width}`;
      assert.equal(defaults.prose,SANS,`default content role: ${tag}`);assert.equal(defaults.header,SANS,`default UI role: ${tag}`);
      assert.equal(defaults.toolbar,SANS,`default code toolbar is UI: ${tag}`);
      assert.equal(defaults.inline,MONO,`default inline code role: ${tag}`);assert.equal(defaults.block,MONO,`default fenced code role: ${tag}`);
      assert.ok(defaults.tools.length>0&&defaults.tools.every(f=>f===SANS),`every code toolbar child keeps the UI role: ${tag} ${JSON.stringify(defaults.tools)}`);
      // Use distinct installed generic families; no external font request or invented screenshot labels.
      await browser.evaluate(`document.body.style.setProperty('--vscode-font-family','sans-serif');document.body.style.setProperty('--vscode-editor-font-family','monospace');document.body.style.setProperty('--ds-c-typography-content','serif');`);
      const read=()=>browser.evaluate(`(() => {const font=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).fontFamily:null};return {prose:font('.hps-prose p'),inline:font('.hps-prose p code'),block:font('.hps-codeblock pre code'),toolbar:font('.hps-codeblock button'),header:font('.hps-header button')};})()`);
      if(evidence) {await browser.evaluate(`document.querySelector('.hps-messages')?.scrollTo(0,100000)`);const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
      await browser.evaluate(`for(const name of ['hp-inbox-link-url','hp-materials-detail','hps-page-context-origin','hps-outbound-destination']){const e=document.createElement('span');e.className=name;e.textContent='https://example.invalid/resource';e.style.position='absolute';e.style.left='-10000px';document.body.appendChild(e)}`);
      const metadata=()=>browser.evaluate(`[...document.querySelectorAll('.hp-inbox-link-url,.hp-materials-detail,.hps-page-context-origin,.hps-outbound-destination')].map(e=>getComputedStyle(e).fontFamily)`);
      const fixedMetadata=await metadata();
      const before=await read();
      assert.equal(before.prose,'serif',`content token must govern prose: ${seat}/${dark}/${width} ${JSON.stringify(before)}`);
      assert.equal(before.inline,'monospace');assert.equal(before.block,'monospace');
      assert.equal(before.toolbar,'sans-serif','nested code controls remain UI');assert.equal(before.header,'sans-serif');
      assert.ok((await readAll()).tools.every(f=>f==='sans-serif'),'toolbar children remain UI');
      await browser.evaluate(`document.body.style.setProperty('--vscode-editor-font-family','cursive')`);
      assert.deepEqual(await metadata(),fixedMetadata,'technical metadata must ignore editor font');
      const after=await read();assert.deepEqual(after,{...before,inline:'cursive',block:'cursive'},'editor font changes only code');
      await browser.evaluate(`document.body.style.setProperty('--ds-c-typography-content','fantasy')`);
      assert.deepEqual(await read(),{...after,prose:'fantasy'},'prose font changes only prose');
    }
  }
  console.log('PASS actual chat font-role isolation across seats/themes/widths');
  // Open the real fenced-code disclosure, then measure its mounted code and UI tools.
  const mountedProps=chatPanelProps({messages:[{id:'fence',role:'assistant',createdAt:1,content:'설명\n\n```js\nconst answer = 42;\n```'}]});
  const mounted=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';createRoot(document.getElementById('root')).render(React.createElement(ChatPanel,${JSON.stringify(mountedProps)}));`,resolveDir:fileURLToPath(new URL('../webview-ui/',import.meta.url)),loader:'tsx'},bundle:true,format:'iife',platform:'browser',write:false,loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
  await browser.load(`<style>${css}</style><body><div id="root" class="hps-shell"></div><script>${mounted.outputFiles[0].text}</script></body>`);
  await browser.evaluate(`document.querySelector('.hps-codepill-toggle').click()`);
  await new Promise(r=>setTimeout(r,50));
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-codepill-body')).fontFamily`),MONO,'default mounted fenced code role');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-codepill .hps-codeblock-tool')).fontFamily`),SANS,'default mounted code controls role');
  await browser.evaluate(`document.body.style.setProperty('--vscode-editor-font-family','cursive');document.body.style.setProperty('--ds-c-typography-content','serif');document.body.style.setProperty('--vscode-font-family','sans-serif')`);
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-codepill-body')).fontFamily`),'cursive');
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-codepill .hps-codeblock-tool')).fontFamily`),'sans-serif');
  console.log('PASS mounted fenced-code disclosure follows editor font, its buttons keep UI font');
  const { withDesignTokens } = await import('../../../chalk/src/lib/design-tokens.ts');
  const ui = new URL('../../../chalk/src/ui/',import.meta.url);
  for(const file of readdirSync(ui).filter(f=>f.endsWith('.html'))) {
    // No network or actions: only the real page's rendered static controls and prose.
    const html=withDesignTokens(readFileSync(new URL(file,ui),'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    await browser.load(html,{width:1280});
    // Controls the page may not contain still take the UI role from the shared rule, not the UA default.
    await browser.evaluate(`for(const t of ['button','input','select','textarea']){const e=document.createElement(t);e.setAttribute('data-font-probe','');document.body.appendChild(e)}`);
    const probes=()=>browser.evaluate(`[...document.querySelectorAll('[data-font-probe]')].map(e=>getComputedStyle(e).fontFamily)`);
    const d=await browser.evaluate(`(() => {const f=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).fontFamily:null};return {ui:f('button')??f('body'),prose:f('p'),code:f('pre,code')};})()`);
    assert.equal(d.ui,SANS,file+' default UI role');
    if(d.prose!==null)assert.equal(d.prose,SANS,file+' default content role');
    if(d.code!==null)assert.equal(d.code,MONO,file+' default code role');
    assert.deepEqual(await probes(),[SANS,SANS,SANS,SANS],file+' default UI role on controls');
    await browser.evaluate(`document.body.style.setProperty('--ds-c-typography-ui','sans-serif');document.body.style.setProperty('--ds-c-typography-content','serif');document.body.style.setProperty('--ds-c-typography-code','monospace')`);
    const measure=()=>browser.evaluate(`(() => {const f=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).fontFamily:null};return {ui:f('button')??f('body'),prose:f('p'),code:f('pre,code')};})()`);
    const before=await measure();
    assert.equal(before.ui,'sans-serif',file+' UI');
    assert.deepEqual(await probes(),Array(4).fill('sans-serif'),file+' controls follow the UI token');
    if(before.prose!==null)assert.equal(before.prose,'serif',file+' prose');
    if(before.code!==null)assert.equal(before.code,'monospace',file+' code');
    await browser.evaluate(`document.body.style.setProperty('--ds-c-typography-content','fantasy')`);
    assert.deepEqual(await measure(),{...before,prose:before.prose===null?null:'fantasy'},file+' content isolation');
    await browser.evaluate(`document.body.style.setProperty('--ds-c-typography-code','cursive')`);
    assert.deepEqual(await measure(),{...before,prose:before.prose===null?null:'fantasy',code:before.code===null?null:'cursive'},file+' code isolation');
  }
  console.log('PASS Chalk actual page UI/prose/code roles and isolated token changes (all nine pages)');
} finally { await browser.close(); }
