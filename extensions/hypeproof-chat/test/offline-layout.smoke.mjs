// DES-SHELL-10: real chat placement/geometry, readability and status lifecycle.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN offline layout: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const assets=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',outdir:'offline-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=assets.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';import {PROPS,classroom,personal} from '../test/lib/offline-fixture';
Object.defineProperty(navigator,'onLine',{get:()=>window.online,configurable:true});window.online=false;
window.renderChat=(seat,size='base')=>root.render(<ChatPanel {...PROPS} config={{...(seat==='personal'?personal:classroom),textSize:size}} instructor={false}/>);
const root=createRoot(document.getElementById('mount'));window.renderChat(window.seat);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,format:'iife',loader:{'.svg':'dataurl','.css':'empty'},logLevel:'silent'})).outputFiles[0].text;
const b=await launch(bin),evidence=process.env.OFFLINE_EVIDENCE,results=[];
if(evidence)mkdirSync(evidence,{recursive:true});
const wait=()=>new Promise(r=>setTimeout(r,80));
const measure=()=>b.evaluate(`(()=>{const e=document.querySelector('.hps-offline-banner');if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect(),shell=e.closest('.hps-shell').getBoundingClientRect(),messages=document.querySelector('.hps-messages').getBoundingClientRect();const rgb=v=>v.match(/[\\d.]+/g).slice(0,3).map(Number);const lum=v=>rgb(v).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);const a=lum(s.color),z=lum(s.backgroundColor);return {height:r.height,width:r.width,top:r.top,shellTop:shell.top,within:r.left>=shell.left&&r.right<=shell.right,above:messages.top>=r.bottom,font:parseFloat(s.fontSize),border:parseFloat(s.borderLeftWidth),contrast:(Math.max(a,z)+.05)/(Math.min(a,z)+.05),icon:!!e.querySelector('svg[aria-hidden="true"]'),role:e.getAttribute('role'),atomic:e.getAttribute('aria-atomic'),count:document.querySelectorAll('.hps-offline-banner').length,overflow:e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth,text:e.textContent}})()`);
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="mount" style="height:800px"></div><script>window.seat=${JSON.stringify(seat)};${script}</script>`,{width,height:800,dark});await wait();
  const m=await measure(),label=`${seat}/${dark?'dark':'light'}/${width}`;
  assert.ok(m,`${label}: offline banner`);assert.ok(m.height<=48,`${label}: height ${m.height}`);assert.ok(m.within&&m.above&&!m.overflow,`${label}: fits without covering messages`);assert.equal(m.top,m.shellTop,`${label}: at panel top`);assert.ok(m.font>=14&&m.contrast>=4.5,`${label}: readable ${JSON.stringify(m)}`);assert.equal(m.border,4);assert.ok(m.icon);assert.equal(m.count,1);assert.equal(m.role,'status');assert.equal(m.atomic,'true');
  assert.ok(m.text.includes('파일')&&m.text.includes('쓰던 글')&&m.text.includes('연결되면'),`${label}: preserved explanation`);results.push({seat,dark,width,...m});
  if(evidence&&width===320){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
  // Same-state events and unrelated re-renders must not churn the live status node.
  await b.evaluate(`window.banner=document.querySelector('.hps-offline-banner');window.changes=0;window.observer=new MutationObserver(items=>window.changes+=items.length);window.observer.observe(window.banner,{childList:true,characterData:true,subtree:true});dispatchEvent(new Event('offline'));dispatchEvent(new Event('offline'));window.renderChat(window.seat);`);await wait();
  assert.equal(await b.evaluate(`window.banner===document.querySelector('.hps-offline-banner')&&window.changes===0`),true,`${label}: no repeated status mutation`);
  await b.evaluate(`window.observer.disconnect();window.online=true;dispatchEvent(new Event('online'))`);await wait();assert.equal(await measure(),null,`${label}: reconnect clears banner`);
  await b.evaluate(`window.online=false;dispatchEvent(new Event('offline'))`);await wait();assert.equal((await measure()).count,1);
  if(seat==='personal'){
   await b.evaluate(`window.renderChat('personal','large')`);await wait();const large=await measure();assert.ok(large.font>m.font&&!large.overflow&&large.within&&large.above,`${label}: large text grows safely ${JSON.stringify(large)}`);
  }
 }
 if(evidence)writeFileSync(`${evidence}/layout.json`,JSON.stringify(results,null,2));
 console.log('PASS offline layout: top/48px/icon/14px/contrast, unchanged content, reconnect and stable live region; personal large text remains unclipped');
}finally{await b.close();}
