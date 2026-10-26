// REQ-CGP-DS-27: real components, deferred clipboard writes and a deterministic feedback clock.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN copy feedback: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CopyAnswer} from './src/ChatDetails';import {CodeBlockTools} from './src/CodeBlock';import {CopyFeedbackRegion,CopyFeedbackOutlet} from './src/CopyFeedback';const root=createRoot(document.getElementById('root'));window.paint=(text)=>root.render(<CopyFeedbackRegion><section id="answer"><CopyAnswer content={text}/></section><section id="code"><CodeBlockTools code={text} wrap={false} onToggleWrap={()=>{}}/></section><CopyFeedbackOutlet/></CopyFeedbackRegion>);window.paint('처음 내용');window.clearPrimary=()=>root.unmount();createRoot(document.getElementById('other')).render(<CopyFeedbackRegion><CopyAnswer content="다른 창"/><CopyFeedbackOutlet/></CopyFeedbackRegion>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const clock=`(()=>{let now=0,id=100000;const timers=new Map(),original=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>{if(ms>=1000&&ms<=10000){const key=++id;timers.set(key,{at:now+ms,fn:()=>fn(...args)});return key}return original(fn,ms,...args)};window.clearTimeout=key=>{timers.delete(key);clear(key)};window.advance=ms=>{now+=ms;for(const [key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn()}};window.pending=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>new Promise((resolve,reject)=>pending.push({text,resolve,reject}))}})})();`;
const b=await launch(bin);const wait=()=>new Promise(r=>setTimeout(r,30));const act=async js=>{await b.evaluate(js);await wait()};
try{
 await b.load(`<div id="root"></div><div id="other"></div><script>${clock}</script><script>${bundle.outputFiles[0].text}</script>`);
 assert.equal(await b.evaluate(`(window.liveNodes=[...document.querySelectorAll('#root .hps-copy-live')]).map(n=>n.getAttribute('role')+':'+n.getAttribute('aria-live')+':'+n.textContent).join('|')`),'status:polite:|null:assertive:','live regions are mounted and empty before any notice');
 assert.equal(await b.evaluate(`document.querySelector('#root .hps-copy-toasts')`),null,'no visual toast node while idle');
 for(const kind of ['answer','code']){
  const button=`#${kind} button`;const status=kind==='code'?'#root .hps-copy-toasts .hps-codeblock-status':'#root .hps-copy-toasts .hps-copy-status:not(.hps-codeblock-status)';const text=()=>b.evaluate(`document.querySelector('${status}')?.textContent??''`);const live=kind=>b.evaluate(`document.querySelector('#root .hps-copy-live[aria-live=${kind==='alert'?'assertive':'polite'}]').textContent`);
  await act(`document.querySelector('${button}').click()`);assert.equal(await text(),'','no success before actual clipboard completion');
  await act(`pending.at(-1).resolve()`);assert.match(await text(),/복사했습니다/);
  assert.equal(await b.evaluate(`document.querySelector('#root .hps-copy-toasts').getAttribute('aria-hidden')`),'true','the visual toast is hidden from AT so the text is announced once, by the live region');
  assert.match(await live('status'),/복사했습니다/,'success is written into the always-mounted polite region');assert.equal(await live('alert'),'');
  await act(`advance(3999)`);assert.match(await text(),/복사했습니다/,'success must survive at least four seconds');
  await act(`advance(1)`);assert.equal(await text(),'');
  await act(`document.querySelector('${button}').click()`);await act(`pending.at(-1).reject(new Error('denied'))`);
  assert.match(await live('alert'),/복사하지 못했습니다/,'failure is written into the always-mounted alert region');assert.equal(await live('status'),'');
  await act(`advance(20000)`);assert.match(await text(),/복사하지 못했습니다/,'error never auto-dismisses');
  await act(`document.querySelector('${button}').click()`);await act(`pending.at(-1).resolve()`);await act(`advance(3000)`);
  await act(`document.querySelector('${button}').click()`);await act(`pending.at(-1).resolve()`);await act(`advance(3999)`);assert.match(await text(),/복사했습니다/,'repeated success gets a fresh four seconds');await act(`advance(1)`);assert.equal(await text(),'');
  await act(`document.querySelector('${button}').click();window.old=pending.at(-1);document.querySelector('${button}').click()`);await act(`pending.at(-1).reject(new Error('latest fails'));old.resolve()`);assert.match(await text(),/복사하지 못했습니다/,'older completion cannot replace latest result');
  await act(`document.querySelector('${button}').click();window.stale=pending.at(-1);paint('변경된 내용 '+${JSON.stringify(kind)})`);await act(`stale.resolve()`);assert.equal(await text(),'','changed content invalidates old feedback');
 }
 assert.equal(await b.evaluate(`liveNodes.every(n=>n.isConnected)&&[...document.querySelectorAll('#root .hps-copy-live')].every((n,i)=>n===liveNodes[i])`),true,'live regions are never remounted, so announcements are not lost');
 assert.equal(await b.evaluate(`document.querySelector('#other .hps-copy-feedback').textContent`),'','feedback cannot leak into another pane');
 await act(`document.querySelector('#other button').click()`);await act(`pending.at(-1).reject(new Error('other pane failure'))`);
 await act(`document.querySelector('#answer button').click();window.detached=pending.at(-1);clearPrimary()`);await act(`detached.resolve()`);
 assert.equal(await b.evaluate(`document.querySelector('#root').textContent`),'','unmounted tool cannot leave a stale toast');
 assert.match(await b.evaluate(`document.querySelector('#other .hps-copy-feedback').textContent`),/복사하지 못했습니다/,'unmounting one pane must preserve another pane error');
 console.log('PASS copy live roles, four-second success, persistent error, fresh repeat timer, latest-attempt and content identity');
}finally{await b.close();}
