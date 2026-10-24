// The fixture clips the page (overflow:hidden) as the host webview does: macOS headless hides page scrollbars, Linux CI draws a 15px classic one, and the transcript's absolutely positioned sr-only rows grow the document.
// DES-CGP-DS-36: actual transcript geometry and painted scrollbar interaction.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN transcript scrollbar: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'scroll-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paintScroll=(props)=>root.render(React.createElement(ChatPanel,props));paintScroll(window.__scrollProps);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const evidence=process.env.SCROLLBAR_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const b=await launch(bin),results=[];const settle=()=>new Promise(r=>setTimeout(r,60));
const geometry=()=>b.evaluate(`(()=>{const e=document.querySelector('.hps-messages'),r=e.getBoundingClientRect(),m=e.querySelector('.hps-msg').getBoundingClientRect();return {client:e.clientWidth,width:r.width,left:r.left,right:r.right,top:r.top,height:r.height,overflow:e.scrollHeight>e.clientHeight,gutter:getComputedStyle(e).scrollbarGutter,pageBar:innerWidth-document.documentElement.clientWidth,messageLeft:m.left,messageWidth:m.width}})()`);
const pixel=async(x,y)=>{const shot=await b.send('Page.captureScreenshot',{format:'png'});const result=await b.send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`new Promise(resolve=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);resolve([...ctx.getImageData(${x},${y},1,1).data])};img.src='data:image/png;base64,${shot.data}'})`});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
  const props=chatPanelProps({config,messages:[{id:'first',role:'assistant',createdAt:1,content:'첫 답변'}]});
  await b.load(`<html style="overflow:hidden;${vars};--vscode-scrollbarSlider-background:#657585;--vscode-scrollbarSlider-hoverBackground:#486888;--vscode-scrollbarSlider-activeBackground:#2b4b6b"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:800px"><div id="root"></div></div><script>window.__scrollProps=${JSON.stringify(props)};</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:900,dark});
  await settle();const before=await geometry();assert.equal(before.overflow,false);assert.equal(before.gutter,'stable');
  await b.evaluate(`paintScroll({...__scrollProps,messages:[...__scrollProps.messages,...Array.from({length:30},(_,i)=>({id:'long-'+i,role:'assistant',createdAt:i+2,content:'길어진 답변 '+i}))]})`);await settle();const after=await geometry();
  assert.equal(after.overflow,true);assert.equal(after.client,before.client);assert.ok(Math.abs(after.messageLeft-before.messageLeft)<.1 && Math.abs(after.messageWidth-before.messageWidth)<.1,'overflow cannot move or resize the reading column');assert.equal(after.pageBar,0,'the page itself never grows a scrollbar: Linux classic page bars (15px) would otherwise shift the column; sr-only rows sit outside the scroller');assert.ok(after.width-after.client>0 && after.width-after.client<=10,'thin scrollbar reserves real space');
  await b.evaluate(`document.querySelector('.hps-messages').scrollTop=0`);await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});await settle();
  const x=Math.floor(after.right-5),y=Math.ceil(after.top+8);
  assert.deepEqual(await pixel(x,y),[101,117,133,255],'default thumb paints host background');
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await settle();assert.deepEqual(await pixel(x,y),[72,104,136,255],'hover thumb paints host hoverBackground');
  await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await settle();assert.deepEqual(await pixel(x,y),[43,75,107,255],'pressed thumb paints host activeBackground');
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:y+30,button:'left',buttons:1});await settle();assert.ok(await b.evaluate(`document.querySelector('.hps-messages').scrollTop`)>0,'dragging the thumb scrolls the transcript');
  await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:y+30,button:'left',clickCount:1});
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
  await b.evaluate(`paintScroll(__scrollProps)`);await settle();const restored=await geometry();assert.equal(restored.overflow,false);assert.equal(restored.client,before.client,'removing overflow keeps the gutter');
  results.push({seat,dark,width,before,after,restored});
 }
 await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
 await b.evaluate(`paintScroll({...__scrollProps,messages:Array.from({length:30},(_,i)=>({id:'forced-'+i,role:'assistant',createdAt:i+1,content:'고대비 답변 '+i}))})`);await settle();
 await b.evaluate(`document.querySelector('.hps-messages').scrollTop=0`);await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});await settle();
 const forced=await geometry();assert.equal(forced.gutter,'stable');const ink=await pixel(Math.floor(forced.right-5),Math.ceil(forced.top+8));const want=await b.evaluate(`(()=>{const p=document.createElement('i');p.style.color='CanvasText';document.body.append(p);const c=getComputedStyle(p).color.match(/\\d+/g).slice(0,3).map(Number);p.remove();return c})()`);assert.deepEqual(ink.slice(0,3),want,`forced-colors thumb paints CanvasText exactly: ${ink} vs ${want}`);
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/forced-colors.png`,Buffer.from(shot.data,'base64'));}
 console.log('PASS transcript stable geometry before/during/after overflow and painted default/hover/pressed host colors in12 actual ChatPanel states');
}finally{try{if(evidence)writeFileSync(`${evidence}/geometry.json`,JSON.stringify(results,null,2));}finally{await b.close();}}
