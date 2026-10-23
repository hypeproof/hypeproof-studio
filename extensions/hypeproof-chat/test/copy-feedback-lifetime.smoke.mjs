// REQ-CGP-DS-27: real components, deferred clipboard writes and a deterministic feedback clock.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN copy feedback: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CopyAnswer} from './src/ChatDetails';import {CodeBlockTools} from './src/CodeBlock';const root=createRoot(document.getElementById('root'));window.paint=(text)=>root.render(<><section id="answer"><CopyAnswer content={text}/></section><section id="code"><CodeBlockTools code={text} wrap={false} onToggleWrap={()=>{}}/></section></>);window.paint('처음 내용');`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const clock=`(()=>{let now=0,id=100000;const timers=new Map(),original=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>{if(ms>=1000&&ms<=10000){const key=++id;timers.set(key,{at:now+ms,fn:()=>fn(...args)});return key}return original(fn,ms,...args)};window.clearTimeout=key=>{timers.delete(key);clear(key)};window.advance=ms=>{now+=ms;for(const [key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn()}};window.pending=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>new Promise((resolve,reject)=>pending.push({text,resolve,reject}))}})})();`;
const b=await launch(bin);const wait=()=>new Promise(r=>setTimeout(r,30));const act=async js=>{await b.evaluate(js);await wait()};
try{
 await b.load(`<div id="root"></div><script>${clock}</script><script>${bundle.outputFiles[0].text}</script>`);
 for(const kind of ['answer','code']){
  const button=`#${kind} button`;const text=()=>b.evaluate(`document.querySelector('#${kind} .hps-copy-status').textContent`);
  await act(`document.querySelector('${button}').click()`);assert.equal(await text(),'','no success before actual clipboard completion');
  await act(`pending.at(-1).resolve()`);assert.match(await text(),/복사했습니다/);
  assert.equal(await b.evaluate(`document.querySelector('#${kind} .hps-copy-status').getAttribute('role')`),'status');
  await act(`advance(3999)`);assert.match(await text(),/복사했습니다/,'success must survive at least four seconds');
  await act(`advance(1)`);assert.equal(await text(),'');
  await act(`document.querySelector('${button}').click()`);await act(`pending.at(-1).reject(new Error('denied'))`);
  assert.equal(await b.evaluate(`document.querySelector('#${kind} .hps-copy-status').getAttribute('role')`),'alert');
  await act(`advance(20000)`);assert.match(await text(),/복사하지 못했습니다/,'error never auto-dismisses');
  await act(`document.querySelector('${button}').click()`);await act(`pending.at(-1).resolve()`);await act(`advance(3000)`);
  await act(`document.querySelector('${button}').click()`);await act(`pending.at(-1).resolve()`);await act(`advance(3999)`);assert.match(await text(),/복사했습니다/,'repeated success gets a fresh four seconds');await act(`advance(1)`);assert.equal(await text(),'');
  await act(`document.querySelector('${button}').click();window.old=pending.at(-1);document.querySelector('${button}').click()`);await act(`pending.at(-1).reject(new Error('latest fails'));old.resolve()`);assert.match(await text(),/복사하지 못했습니다/,'older completion cannot replace latest result');
  await act(`document.querySelector('${button}').click();window.stale=pending.at(-1);paint('변경된 내용 '+${JSON.stringify(kind)})`);await act(`stale.resolve()`);assert.equal(await text(),'','changed content invalidates old feedback');
 }
 console.log('PASS copy live roles, four-second success, persistent error, fresh repeat timer, latest-attempt and content identity');
}finally{await b.close();}
