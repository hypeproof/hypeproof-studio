import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const require=createRequire(import.meta.url);
let panel;
const vscode={ViewColumn:{Beside:2},window:{createWebviewPanel(...args){let received,closed;panel={args,webview:{html:'',onDidReceiveMessage(fn){received=fn;return {dispose(){}};}},onDidDispose(fn){closed=fn;return {dispose(){}};},dispose(){closed?.();},send(m){received(m);}};return panel;}}};
const built=await build({entryPoints:['src/workTakeawayPanel.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['vscode']});
const mod={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(id=>id==='vscode'?vscode:require(id),mod,mod.exports);
const {workTakeawayHtml,showWorkTakeawayPanel}=mod.exports;
const model={destination:'/사본/'+ 'longfolder'.repeat(15),items:[{label:'<img src=x onerror=alert(1)>',category:'파일',bytes:Buffer.from('secret bytes never serialized'),reason:'선택한 파일의 사본이에요.'},{label:'강사 메모',category:'남는 것',reason:'활동에 남겨요.'}],results:[{label:'성공 파일',status:'옮김',reason:'원본은 그대로 있어요.',directory:'/사본/완료'},{label:'실패 파일',status:'실패',reason:'권한을 확인해 주세요.',directory:'/사본/실패폴더'},{label:'강사 메모',status:'제외',reason:'활동에 남겨요.',directory:'/사본/제외폴더'}]};
for(const results of [undefined,model.results]){
 let done=false;const pending=showWorkTakeawayPanel({...model,results}).then(a=>(done=true,a));
 const p=panel,nonce=/<script nonce="([a-f0-9]+)"/.exec(p.webview.html)[1];
 assert.deepEqual(p.args[3].localResourceRoots,[]);assert.ok(!p.webview.html.includes('secret bytes never serialized'));
 p.send({action:'confirm',nonce:'wrong'});p.send({action:'retry',nonce,index:0});p.send({action:'retry',nonce,index:-1});p.send({action:'retry',nonce,index:1.5});p.send({action:'retry',nonce,index:'1'});
 if(results)p.send({action:'confirm',nonce});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false,'invalid/foreign actions cannot settle');
 p.send(results?{action:'retry',index:1,nonce}:{action:'confirm',nonce});
 assert.deepEqual(await pending,results?{action:'retry',index:1}:{action:'confirm'});
}
{const pending=showWorkTakeawayPanel(model);panel.dispose();assert.deepEqual(await pending,{action:'close'});}
{const real=globalThis.setTimeout;let timeout;globalThis.setTimeout=(fn,ms,...rest)=>ms===5*60_000?(timeout=fn,0):real(fn,ms,...rest);try{const pending=showWorkTakeawayPanel(model);assert.equal(typeof timeout,'function');timeout();assert.deepEqual(await pending,{action:'close'});}finally{globalThis.setTimeout=real;}}
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Browser required');console.log('NOT RUN takeaway panel layout');}
else{
 const browser=await launch(bin);let cases=0;
 try{
 for(const dark of [true,false])for(const width of [320,600,601,800,1420])for(const result of [false,true]){
  const html=workTakeawayHtml({...model,results:result?model.results:undefined},'testnonce').replace('const api=acquireVsCodeApi()', 'const api={postMessage:m=>(window.posts??=[]).push(m)}').replace('<style>',`<style>:root{--vscode-foreground:${dark?'#eee':'#111'};--vscode-editor-background:${dark?'#181818':'#fff'};--vscode-panel-border:#777;--vscode-focusBorder:#007acc;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:${dark?'#333':'#ddd'};--vscode-button-secondaryForeground:${dark?'#fff':'#111'}}`);
  await browser.send('Page.navigate',{url:'about:blank'});
  await browser.load(html,{width,height:1000,dark});
  await browser.evaluate('window.posts=[]');
  const m=await browser.evaluate(`(()=>{const a=document.querySelectorAll('.group'),x=a[0].getBoundingClientRect(),y=a[1].getBoundingClientRect();return {x:{top:x.top,right:x.right,bottom:x.bottom},y:{top:y.top,left:y.left},overflow:document.documentElement.scrollWidth>innerWidth,font:getComputedStyle(document.body).fontSize,headings:[...document.querySelectorAll('.group h2')].map(e=>e.textContent),images:document.images.length,retries:document.querySelectorAll('[data-retry]').length}})()`);
  const shown=await browser.evaluate('document.body.innerText');assert.equal(shown.includes('사본 위치: /사본/완료'),result,'only a successful row names its copy directory');assert.ok(!shown.includes('/사본/실패폴더')&&!shown.includes('/사본/제외폴더'),'failed and excluded rows name no copy directory');
  assert.deepEqual(m.headings,['가져가는 것','남는 것']);assert.equal(m.overflow,false);assert.equal(m.font,'14px');assert.equal(m.images,0,'filename is text');assert.equal(m.retries,result?1:0);
  if(width<=600)assert.ok(m.y.top>=m.x.bottom,'one column at <=600');else assert.ok(Math.abs(m.y.top-m.x.top)<1&&m.y.left>m.x.right,'two columns above 600');
  for(const selector of result?['#close','[data-retry]']:['#close','#confirm']){
   assert.ok(await browser.evaluate(`document.querySelector('${selector}').getBoundingClientRect().height>=44`));
   const ring=await browser.focusVisibleStyle(selector);assert.equal(ring['outline-width'],'2px');assert.equal(ring['outline-style'],'solid');
  }
  if(process.env.TAKEAWAY_SCREENSHOTS){mkdirSync(process.env.TAKEAWAY_SCREENSHOTS,{recursive:true});await browser.evaluate('window.scrollTo(0,0)');const shot=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(`${process.env.TAKEAWAY_SCREENSHOTS}/${dark?'dark':'light'}-${width}-${result?'result':'review'}.png`,Buffer.from(shot.data,'base64'));}
  await browser.evaluate(result?`document.querySelector('[data-retry]').click();document.querySelector('[data-retry]').click()`:`document.getElementById('confirm').click();document.getElementById('confirm').click()`);
  assert.deepEqual(await browser.evaluate('window.posts'),[result?{action:'retry',index:1,nonce:'testnonce'}:{action:'confirm',nonce:'testnonce'}],'one bound action per view');cases++;
 }
 await browser.load(workTakeawayHtml(model,'testnonce').replace('const api=acquireVsCodeApi()', 'const api={postMessage:m=>window.answer=m}'),{width:800,height:900,forcedColors:true});
 assert.equal(await browser.evaluate('matchMedia("(forced-colors: active)").matches'),true);
 const ring=await browser.focusVisibleStyle('[data-retry]');assert.equal(ring['outline-width'],'2px');
 await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");assert.deepEqual(await browser.evaluate('window.answer'),{action:'close',nonce:'testnonce'});
 console.log(`PASS takeaway panel: ${cases} layouts, breakpoint 600/601, escaped filenames, per-item status/retry, 44px, focus, forced colours, Escape, nonce/action validation`);
 }finally{await browser.close();}
}
