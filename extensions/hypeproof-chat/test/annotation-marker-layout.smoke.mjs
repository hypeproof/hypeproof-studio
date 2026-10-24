// DES-ART-01: actual CDP-injected markers, not a stylesheet/source assertion.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {marker,markerComment,isAnnotationOverlayNode,rectangleValid,dragRectangle} from '../src/annotationCapture.ts';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN annotation-marker: Chromium unavailable');process.exit(0);}
const browser=await launch(bin);
try {
 await browser.load('<!doctype html><style>body{margin:0;min-height:2000px}#picked{position:absolute;left:25%;top:300px;width:120px;height:80px}</style><button id="picked">고른 요소</button>',{width:800,height:600});
 const doc=await browser.send('DOM.getDocument',{});
 const selected=await browser.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#picked'});
 const {node}=await browser.send('DOM.describeNode',{nodeId:selected.nodeId});
 const {frameTree}=await browser.send('Page.getFrameTree',{});
 const options={comment:'여기를 바꿔 주세요 <img src=x>',backendNodeId:node.backendNodeId,documentGeneration:frameTree.frame.loaderId,kind:'element',version:10};
 await marker(browser,1,{x:200,y:300,width:120,height:80},options);
 await browser.send('Accessibility.enable',{});
 const ax=await browser.send('Accessibility.getFullAXTree',{});
 const entry=ax.nodes.find(n=>n.name?.value==='표시 1: 여기를 바꿔 주세요 <img src=x>');
 assert.ok(entry,'marker is accessible with its number and literal comment');
 assert.equal(entry.role?.value,'button','marker is keyboard reachable');
 assert.equal(await isAnnotationOverlayNode(browser,entry.backendDOMNodeId),true,'overlay cannot be recaptured as page content');
 assert.equal(await isAnnotationOverlayNode(browser,node.backendNodeId),false,'ordinary page node remains pickable');
 const measure=()=>browser.evaluate(`(()=>{const host=document.querySelector('[data-hps-annotation-marker="1"]'),b=host.shadowRoot.querySelector('span'),r=b.getBoundingClientRect(),a=document.getElementById('picked').getBoundingClientRect();return {dx:r.left-a.left,dy:r.top-a.top,w:r.width,h:r.height,radius:getComputedStyle(b).borderRadius}})()`);
 const check=async()=>{const m=await measure();assert.ok(Math.abs(m.dx)<=2&&Math.abs(m.dy)<=2,JSON.stringify(m));assert.equal(m.w,24);assert.equal(m.h,24);assert.equal(m.radius,'50%');assert.deepEqual(await browser.evaluate(`(()=>{const r=document.querySelector('[data-hps-annotation-marker="1"]').shadowRoot.querySelector('button').getBoundingClientRect();return [r.width,r.height]})()`),[44,44],'hit target is 44px');};
 await check();
 await browser.evaluate('scrollTo(0,180)');await new Promise(r=>setTimeout(r,60));await check();
 await browser.send('Emulation.setDeviceMetricsOverride',{width:320,height:600,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,60));await check();
 await markerComment(browser,1,'고친 의견',10,2);
 await markerComment(browser,1,'늦은 의견',10,1);
 await markerComment(browser,1,'이전 마커',9,3);
 const updated=await browser.send('Accessibility.getFullAXTree',{});assert.ok(updated.nodes.some(n=>n.name?.value==='표시 1: 고친 의견'));
 await marker(browser,2,{x:40,y:260,width:80,height:40},{kind:'rectangle',comment:'영역'});
 await browser.evaluate(`document.querySelector('[data-hps-annotation-marker="1"]').shadowRoot.querySelector('button').focus()`);
 for(const type of ['keyDown','keyUp'])await browser.send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 assert.equal(await browser.evaluate(`document.activeElement.getAttribute('data-hps-annotation-marker')`),'2','Tab follows numeric marker order');
 assert.deepEqual(await browser.evaluate(`(()=>{const b=document.activeElement.shadowRoot.activeElement,r=b.getBoundingClientRect(),s=getComputedStyle(b);return [r.width,r.height,s.outlineStyle,s.outlineWidth]})()`),[44,44,'solid','2px'],'keyboard-focused marker has a 44px target and a visible 2px ring');
 assert.deepEqual(await browser.evaluate(`(()=>{const r=document.querySelector('[data-hps-annotation-marker="2"]').shadowRoot.querySelector('.region'),s=getComputedStyle(r);return [s.borderTopWidth,s.borderTopStyle]})()`),['2px','dashed']);
 await assert.rejects(marker(browser,3,{x:0,y:0,width:50,height:50},{documentGeneration:'old-document'}),/화면이 바뀌/);
 if(process.env.ANNOTATION_EVIDENCE){mkdirSync(process.env.ANNOTATION_EVIDENCE,{recursive:true});const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(process.env.ANNOTATION_EVIDENCE+'/page-markers-320.png',Buffer.from(shot.data,'base64'));}
 await marker(browser,2,null);
 assert.equal(rectangleValid({x:0,y:0,width:5,height:5}),false,'sub-8px drag is not an annotation');
 assert.equal(rectangleValid({x:0,y:0,width:8,height:8}),true);
 await marker(browser,1,null);
 const after=await browser.send('Accessibility.getFullAXTree',{});
 assert.equal(after.nodes.some(n=>n.name?.value==='표시 1: 고친 의견'),false,'removal removes marker');
 for(const distance of [5,12]){
  const pending=dragRectangle(browser).then(value=>({value}),error=>({error:error.message}));
  for(let i=0;i<40;i++){if(await browser.evaluate(`!!document.querySelector('[aria-label="영역을 끌어서 골라 주세요. Escape로 취소"]')`))break;await new Promise(r=>setTimeout(r,25));}
  await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x:20,y:20,button:'left',buttons:1,clickCount:1});
  await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:20+distance,y:20+distance,button:'left',buttons:1});
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[aria-label="영역을 끌어서 골라 주세요. Escape로 취소"]').firstElementChild).borderStyle`),'dashed');
  await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:20+distance,y:20+distance,button:'left',buttons:0,clickCount:1});
  const outcome=await pending;if(distance===5)assert.match(outcome.error,/취소/);else assert.equal(outcome.value.width,12);
 }
 // Exercise the actual BrowserControl lifecycle against the same isolated browser.
 const require=createRequire(import.meta.url),mod={exports:{}};
 const bundle=await build({stdin:{contents:"export {BrowserControl} from './src/browserControl';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
 vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?{window:{createOutputChannel:()=>({appendLine(){}})}}:require(id),console,Buffer,process,URL,TextEncoder,TextDecoder,AbortSignal,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,performance});
 const control=new mod.exports.BrowserControl();
 let hold=null;
 const cdp={send:async(method,p)=>{if(hold&&method==='Runtime.evaluate'&&p.expression.includes(hold.match)){const h=hold;hold=null;h.entered=true;await h.promise;}return browser.send(method,p);}};
 control.cdp=async()=>cdp;
 const gate=match=>{let release;const h={match,entered:false,promise:new Promise(r=>{release=r;}),release:()=>release()};hold=h;return h;};
 const entered=async h=>{for(let i=0;i<100&&!h.entered;i++)await new Promise(r=>setTimeout(r,10));assert.equal(h.entered,true,'race reached its intended CDP boundary');};
 const has=number=>browser.evaluate(`!!document.querySelector('[data-hps-annotation-marker="${number}"]')`);
 await control.annotationMarker(6,{x:30,y:220,width:40,height:40},{comment:'처음'});
 assert.equal(await has(6),true);await control.annotationMarker(6,null);assert.equal(await has(6),false,'host removal clears its exact marker instance');
 const creation=gate('const number=7,rect={');
 const pendingCreate=control.annotationMarker(7,{x:30,y:220,width:40,height:40});
 await entered(creation);await control.clearAnnotationMarkers();creation.release();await pendingCreate;
 assert.equal(await has(7),false,'clear invalidates an in-flight creation');
 await control.annotationMarker(6,{x:30,y:220,width:40,height:40},{comment:'이전'});
 const clearing=gate('const number=6,rect=null');const pendingClear=control.clearAnnotationMarkers();await entered(clearing);
 await control.annotationMarker(6,{x:30,y:220,width:40,height:40},{comment:'새 작업'});clearing.release();await pendingClear;
 assert.equal(await has(6),true,'old cleanup cannot delete a replacement marker');
 assert.equal(control.annotationMarkers.size,1,'new host marker registration survives old cleanup');
 await control.clearAnnotationMarkers();assert.equal(await has(6),false);
 console.log('PASS annotation-marker: live CDP, 24px circle, 44px hit area, scroll/resize anchor, numeric Tab, comment ordering, overlay exclusion, trusted drag threshold, removal');
}finally{await browser.close();}
