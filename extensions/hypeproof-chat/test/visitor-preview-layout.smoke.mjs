// REQ-KNOW-63: computed checks of the visitor preview panel in real headless Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { startVisitorSnapshot, visitorPreviewHtml } from '../src/visitorPreview.ts';
const bin=findChromium();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw new Error('Browser required');console.log('NOT RUN visitor preview layout: browser unavailable');}
else {
 let outsideRequests=0;const outsidePaths=[];const outside=createServer((req,res)=>{outsideRequests++;outsidePaths.push(req.url);res.setHeader('Access-Control-Allow-Origin','*');res.end('outside')});await new Promise(r=>outside.listen(0,'127.0.0.1',r));
 const outsideUrl=`http://127.0.0.1:${outside.address().port}/probe`;
 // A server that accepts and never answers: the frame never loads (fallback case).
 const hanging=createServer(()=>{});await new Promise(r=>hanging.listen(0,'127.0.0.1',r));
 const hangingUrl=`http://127.0.0.1:${hanging.address().port}/index.html`;
 // The framed page tries the network, a nested outside frame and a popup, runs a module script,
 // and spoofs the host's "served" signal.
 const snapshot={entry:'index.html',audience:'인터넷의 누구나 · gallery.invalid',files:[
  {path:'index.html',data:Buffer.from(`<html lang="ko"><h1>내가 만든 정원</h1><p>이 파일만 공개돼요.</p><script type="module" src="app.mjs"></script><script>parent.postMessage({type:'served',nonce:'testnonce'},'*');fetch('${outsideUrl}').then(()=>document.body.dataset.network='allowed',()=>document.body.dataset.network='blocked');const nested=document.createElement('iframe');nested.src='${outsideUrl}?nested';document.body.append(nested);let popup;try{popup=window.open('${outsideUrl}?popup')}catch{}document.body.dataset.popup=popup?'opened':'blocked'</script></html>`)},
  {path:'app.mjs',data:Buffer.from(`document.body.dataset.module='ok';`)}]};
 const server=await startVisitorSnapshot(snapshot);let browser;
 const render=(url,{dark=true,fallbackMs,audience=snapshot.audience}={})=>visitorPreviewHtml({...snapshot,audience},url,'testnonce',fallbackMs)
  .replace('const api=acquireVsCodeApi();','const api={postMessage:m=>window.lastMessage=m};')
  .replace('<style>',`<style>:root{--vscode-foreground:${dark?'#eee':'#111'};--vscode-editor-background:${dark?'#181818':'#fff'};--vscode-focusBorder:#007acc;--vscode-panel-border:#777;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff}`);
 // Page.setDocumentContent reuses the Document, so an earlier case's meta CSP and frames survive
 // into the next one. Each case instead navigates to a fresh document served over HTTP, like a
 // real webview document.
 let panelHtml='';const panelHost=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(panelHtml)});await new Promise(r=>panelHost.listen(0,'127.0.0.1',r));
 let visit=0;
 const fresh=async(html,{width=1420,height=900,dark=true,forcedColors=false}={})=>{
  panelHtml=html;
  await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:forcedColors?'active':'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
  await browser.send('Page.navigate',{url:`http://127.0.0.1:${panelHost.address().port}/panel?${++visit}`});
  for(let i=0;i<50;i++){try{if(await browser.evaluate('!!document.getElementById("next")&&location.search==="?'+visit+'"'))break}catch{}await wait(50)}
 };
 const disabled=()=>browser.evaluate('document.getElementById("next").disabled');
 const hostServed=nonce=>browser.evaluate(`window.postMessage({type:'served',nonce:${JSON.stringify(nonce)}},'*')`);
 const frameValue=async expression=>{const {frameTree}=await browser.send('Page.getFrameTree');const frame=(frameTree.childFrames??[]).map(c=>c.frame).find(f=>f.url.startsWith(new URL(server.url).origin+'/'));if(!frame)return undefined;const world=await browser.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'verification'});return (await browser.send('Runtime.evaluate',{expression,contextId:world.executionContextId,returnByValue:true})).result.value;};
 const shot=async name=>{if(!process.env.VISITOR_SCREENSHOTS)return;mkdirSync(process.env.VISITOR_SCREENSHOTS,{recursive:true});const png=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.VISITOR_SCREENSHOTS}/${name}.png`,Buffer.from(png.data,'base64'));};
 try{
  browser=await launch(bin);
  // 1. Fallback: a frame that never loads does not block forever and says so honestly.
  await fresh(render(hangingUrl,{fallbackMs:600}),{width:800,height:900});
  await hostServed('testnonce');await wait(150);
  assert.equal(await disabled(),true,'served alone (frame not loaded) keeps next disabled before the fallback');
  for(let i=0;i<30&&await disabled();i++)await wait(100);
  const fb=await browser.evaluate('({d:document.getElementById("next").disabled,label:document.getElementById("next").textContent,open:document.querySelector("details").open,status:document.getElementById("status").textContent})');
  assert.deepEqual({d:fb.d,label:fb.label,open:fb.open},{d:false,label:'화면 없이 목록 확인 · 다음',open:true},'fallback opens the file list and relabels next');
  assert.match(fb.status,/미리보기 화면을 열지 못했어요/);
  assert.equal(await browser.evaluate('window.lastMessage'),undefined,'the fallback never approves by itself');
  await shot('fallback-dark-800');

  // 1b. M25: the shipped default delay (no override) does not unlock Next early.
  await fresh(render(hangingUrl),{width:800,height:900});
  await hostServed('testnonce');await wait(1500);
  assert.equal(await disabled(),true,'with the shipped default delay, next stays disabled after 1.5 s without a loaded frame');

  // 2. Next stays disabled while the frame loads, and after it loads until the host reports
  //    the entry was served; the framed page's own spoofed signal is ignored.
  await fresh(render(server.url,{fallbackMs:60_000}),{width:1420,height:900});
  assert.equal(await disabled(),true,'next disabled before the frame loads');
  for(let i=0;i<30&&await frameValue('document.body?.dataset.network')!=='blocked';i++)await wait(100);
  await wait(300);
  assert.equal(await disabled(),true,'frame load plus a spoofed message from the framed page does not enable next');
  await hostServed('wrong');await wait(100);assert.equal(await disabled(),true,'host signal with the wrong nonce is ignored');
  // Snapshot fidelity and isolation inside the frame.
  assert.equal(await frameValue('document.body.dataset.network'),'blocked','actual external fetch blocked');assert.equal(outsideRequests,0,`framed page reached no outside origin (fetch, nested frame, popup): ${outsidePaths}`);
  assert.equal(await frameValue('document.body.dataset.module'),'ok','module script (.mjs) runs in the preview');
  // M28: the frame's sandbox is exactly scripts + same-origin (no popups, no top navigation,
  // no forms, no modals), and a nested outside frame or popup from the page reaches nothing.
  const sandbox=await browser.evaluate('[...document.querySelector("iframe").sandbox].sort()');
  assert.deepEqual(sandbox,['allow-same-origin','allow-scripts'],'iframe sandbox tokens are exactly allow-scripts allow-same-origin');
  assert.equal(await browser.evaluate('document.querySelector("iframe").getAttribute("referrerpolicy")'),'no-referrer');
  assert.equal(await frameValue('document.body.dataset.popup'),'blocked','framed page cannot open a popup');
  await wait(800);assert.deepEqual(outsidePaths,[],'no nested frame, popup or fetch reached an outside origin');
  // 3. The parent may frame only the snapshot origin.
  const csp=await browser.evaluate('document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\').content');
  const frameSrc=csp.split(';').map(d=>d.trim()).filter(d=>d.startsWith('frame-src '));
  assert.deepEqual(frameSrc,[`frame-src ${new URL(server.url).origin}`],'parent frame-src is exactly the snapshot origin');
  await browser.evaluate(`(()=>{const f=document.createElement('iframe');f.src=${JSON.stringify(outsideUrl)};document.body.append(f)})()`);
  await wait(800);assert.equal(outsideRequests,0,'parent cannot frame an outside origin');
  await browser.evaluate('document.querySelectorAll("iframe")[1].remove()');
  // 4. Host signal with this nonce unlocks next.
  await hostServed('testnonce');for(let i=0;i<20&&await disabled();i++)await wait(50);
  assert.equal(await disabled(),false,'next enabled after load and served');
  assert.equal(await browser.evaluate('document.getElementById("status").textContent'),'공개할 화면과 범위를 확인해 주세요.');
  await browser.evaluate('document.getElementById("next").click()');assert.deepEqual(await browser.evaluate('window.lastMessage'),{action:'next',nonce:'testnonce'});

  // 5. Layout, targets and focus rings: dark/light, 320/800/1420, plus forced colours.
  const passes=[...[true,false].flatMap(dark=>[320,800,1420].map(width=>({dark,width,forced:false}))),{dark:true,width:1420,forced:true},{dark:false,width:800,forced:true}];
  for(const {dark,width,forced} of passes){
   const audience = snapshot.audience + ' · https://' + 'longprojectname'.repeat(8) + '.invalid';
   await fresh(render(server.url,{dark,fallbackMs:60_000,audience}),{width,height:900,dark,forcedColors:forced});
   for(let i=0;i<30&&await frameValue('document.body?.dataset.network')!=='blocked';i++)await wait(100);
   await hostServed('testnonce');for(let i=0;i<20&&await disabled();i++)await wait(50);
   assert.equal(await disabled(),false);
   assert.equal(await browser.evaluate('matchMedia("(forced-colors: active)").matches'),forced);
   if(!forced)assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("iframe")).backgroundColor'),'rgb(255, 255, 255)','transparent pages keep the browser white canvas in dark Studio');
   for(const sel of ['#next','#cancel','summary']){
    const r=await browser.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {h:b.height,w:b.width}})()`);
    assert.ok(r.h>=44&&r.w>=44,`${sel} target >= 44px (${JSON.stringify(r)}) dark=${dark} width=${width} forced=${forced}`);
    const focus=await browser.focusVisibleStyle(sel,['outline-width','outline-style']);
    assert.deepEqual(focus,{'outline-width':'2px','outline-style':'solid'},`${sel} focus ring dark=${dark} width=${width} forced=${forced}`);
   }
   const box=await browser.evaluate('({size:getComputedStyle(document.body).fontSize,overflow:document.documentElement.scrollWidth>innerWidth,text:document.querySelector("h1").textContent})');
   assert.equal(await browser.evaluate('document.querySelector("h1").textContent'), '방문자에게 이렇게 보여요 · 공개 범위: ' + audience, 'audience remains complete');
   // The text being in the DOM is not enough: an ellipsis or a clipped box would hide it. The banner
   // must not clip its own content, must stay inside the viewport and must wrap onto several lines at 320px.
   const banner=await browser.evaluate('(()=>{const h=document.querySelector("h1"),r=h.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(h);const tops=new Set([...range.getClientRects()].map(x=>Math.round(x.top)));return {clipX:h.scrollWidth>h.clientWidth,clipY:h.scrollHeight>h.clientHeight,right:r.right,lines:tops.size}})()');
   assert.equal(banner.clipX,false,`banner clips horizontally width=${width}`);
   assert.equal(banner.clipY,false,`banner clips vertically width=${width}`);
   assert.ok(banner.right<=width,`banner stays inside the viewport width=${width}`);
   if(width===320)assert.ok(banner.lines>1,`banner wraps at 320px (lines=${banner.lines})`);
   assert.equal(box.size,'14px');assert.equal(box.overflow,false);assert.match(box.text,/방문자에게 이렇게 보여요 · 공개 범위: 인터넷의 누구나/);
   await browser.evaluate('document.querySelector("details").open=true; window.scrollTo(0,0)');
   await shot(`${forced?'forced-':''}${dark?'dark':'light'}-${width}`);
  }
  console.log('PASS visitor preview: next waits for load+served (spoof ignored), fallback, frame-src, .mjs, 44px next/cancel/summary, focus rings, forced colours, 320/800/1420 dark/light, unbroken audience wraps');
 }finally{await browser?.close();server.close();outside.closeAllConnections();outside.close();hanging.closeAllConnections();hanging.close();panelHost.close()}
}
