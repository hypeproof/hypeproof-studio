// The visible code-copy failure on real ChatPanel markup, not just the hook fixture.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN copy feedback visual: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'copy-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paintCopy=(props)=>root.render(React.createElement(ChatPanel,props));window.paintCopy(window.__copyProps);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const b=await launch(bin);const evidence=process.env.COPY_FEEDBACK_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
  const props=chatPanelProps({config,messages:[{id:'copy-answer',role:'assistant',createdAt:1,content:'코드를 확인해 주세요.\n\n    const answer = 42;'}]});
  await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:800px"><div id="root"></div></div><script>window.__copyProps=${JSON.stringify(props)};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('synthetic denied')}}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:900,dark});
  // Force the failure path: headless clipboard access differs by platform (denied on macOS, granted on Linux CI).
  await b.evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})`);
  await b.evaluate(`document.querySelector('[aria-label="코드 복사"]').focus();document.querySelector('[aria-label="코드 복사"]').click()`);await new Promise(r=>setTimeout(r,40));
  const state=await b.evaluate(`(()=>{const e=document.querySelector('.hps-codeblock-status');const r=e.getBoundingClientRect(),outlet=e.closest('.hps-copy-toasts'),footer=e.closest('footer'),input=document.querySelector('textarea');return {width:r.width,font:getComputedStyle(e).fontSize,icon:!!e.querySelector('[data-icon=alert]'),bottom:r.bottom,footerBottom:footer?.getBoundingClientRect().bottom,outlet:!!outlet,inputBottom:input?.getBoundingClientRect().bottom,focus:document.activeElement?.getAttribute('aria-label'),role:document.querySelector('.hps-copy-live[aria-live=assertive]').textContent?'alert':'',liveEmptyPolite:document.querySelector('.hps-copy-live[aria-live=polite]').textContent==='',hiddenFromAT:outlet.getAttribute('aria-hidden')==='true',text:e.textContent,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth}})()`);
  assert.equal(state.role,'alert','failure is announced through the always-mounted alert region');assert.ok(state.liveEmptyPolite);assert.equal(state.hiddenFromAT,true,'the visual copy is not announced twice');assert.match(state.text,/복사하지 못했습니다/);assert.equal(state.visible,true);assert.equal(state.outlet,true);assert.ok(state.width<=360.1);assert.equal(state.font,'14px');assert.equal(state.icon,true);assert.ok(state.bottom<=state.footerBottom);assert.ok(state.bottom<=900);assert.ok(state.inputBottom<=state.bottom);assert.equal(state.focus,'코드 복사','feedback must not steal focus');
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/studio-${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
  if(width>=800){
   // Measured cap: a long string must wrap at the 360px token, not stretch to the pane width.
   const capped=await b.evaluate(`(()=>{const e=document.querySelector('.hps-codeblock-status');e.querySelector('span').textContent+=' '+'긴 문장 '.repeat(80);const r=e.getBoundingClientRect();return {width:r.width,pane:e.closest('footer').getBoundingClientRect().width}})()`);
   assert.ok(capped.pane>400,'pane must be wider than the cap for this measurement to mean anything');assert.ok(capped.width>=359 && capped.width<=360.1,`long toast must sit at the 360px cap, got ${capped.width}`);
  }
  if(seat==='personal' && width===320 && !dark){
   await b.evaluate(`paintCopy({...window.__copyProps,messages:Array.from({length:20},(_,i)=>({id:'many-'+i,role:'assistant',createdAt:i+1,content:'복사 대상 '+i}))})`);await new Promise(r=>setTimeout(r,40));
   await b.evaluate(`document.querySelectorAll('[aria-label="답변 복사"]').forEach(button=>button.click())`);await new Promise(r=>setTimeout(r,60));
   const stacked=await b.evaluate(`(()=>{const outlet=document.querySelector('.hps-copy-toasts'),r=outlet.getBoundingClientRect(),input=document.querySelector('textarea').getBoundingClientRect();return {errors:Math.min(outlet.querySelectorAll('.hps-copy-toast').length,document.querySelectorAll('.hps-copy-live[aria-live=assertive] > span').length),height:r.height,scroll:outlet.scrollHeight,inputTop:input.top,inputBottom:input.bottom}})()`);
   assert.equal(stacked.errors,20,'concurrent persistent errors are retained');assert.ok(stacked.height<=225.1 && stacked.scroll>stacked.height,'many errors scroll within a bounded outlet');assert.ok(stacked.inputTop>=0 && stacked.inputBottom<=900,'many errors cannot displace input offscreen');
   await b.evaluate(`paintCopy({...window.__copyProps,messages:[]})`);await new Promise(r=>setTimeout(r,40));assert.equal(await b.evaluate(`document.querySelector('.hps-copy-feedback').textContent`),'','removed messages remove their notices');
  }
 }
 console.log('PASS real ChatPanel copy failure visibility/alert, pane-bottom geometry, icon, 14px, width cap and focus in both seats/themes at320/800/1420');
}finally{await b.close()}
