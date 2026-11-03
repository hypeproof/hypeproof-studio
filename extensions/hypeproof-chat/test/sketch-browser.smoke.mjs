import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin)throw Error('Chromium required');
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'sketch-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'}),css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paint=(props=window.__props,key='initial')=>root.render(<ChatPanel key={key} {...props} onAttachFile={()=>{}} onSend={()=>{window.__sent++;return true}}/>);paint();`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const b=await launch(bin),evidence=process.env.SKETCH_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const settle=()=>new Promise(r=>setTimeout(r,80));
const button=async label=>{await b.evaluate(`(()=>{const el=[...document.querySelectorAll('dialog button')].find(e=>(e.getAttribute('aria-label')??e.textContent)===${JSON.stringify(label)});if(!el)throw Error('button missing');el.click()})()`);await settle();};
const pixel=(x,y)=>b.evaluate(`Array.from(document.querySelector('canvas').getContext('2d').getImageData(${x},${y},1,1).data).slice(0,3)`);
const stroke=async(y,x1=100,x2=250)=>{const box=await b.evaluate(`(()=>{const c=document.querySelector('canvas');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);const p=x=>({x:box.x+x/768*box.w,y:box.y+y/768*box.h});await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...p(x1),button:'left',buttons:1,clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p(x2),button:'left',buttons:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p(x2),button:'left',buttons:0,clickCount:1});await settle();};
const reply=async failures=>{await b.evaluate(`(()=>{const r=__posted.filter(m=>m.type==='prepareAttachments').at(-1);window.dispatchEvent(new MessageEvent('message',{data:{type:'attachmentsPrepared',requestId:r.requestId,failures:${JSON.stringify(failures)}}}))})()`);await settle();};
const key=async(k,code,modifiers=0)=>{await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:code==='KeyZ'?90:0,modifiers});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:code==='KeyZ'?90:0,modifiers:0});await settle();};
const box=sel=>b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {l:r.left,r:r.right,w:r.width}})()`);
const colors=[['검정',[32,32,32]],['빨강',[198,40,40]],['주황',[239,108,0]],['초록',[46,125,50]],['파랑',[21,101,192]],['보라',[106,27,154]]];
try{
for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null,input:{image_paste:true}},taskWorkspace:seat==='personal'?{scope:'sketch',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null}:undefined});
 const props=chatPanelProps({config,messages:[]});
 await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="height:900px"><div id="root"></div></div><script>window.__props=${JSON.stringify(props).replaceAll('<','\\u003c')};window.__nonce=0;Object.defineProperty(crypto,'randomUUID',{configurable:true,value:()=>('00000000-0000-4000-8000-'+String(++window.__nonce).padStart(12,'0'))});window.__sent=0;window.__posted=[];window.__zSeen=0;window.addEventListener('keydown',e=>{if(e.code==='KeyZ')__zSeen++});window.__errors=[];window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));window.addEventListener('error',e=>__errors.push(e.message));window.acquireVsCodeApi=()=>({postMessage:m=>__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark});await settle();
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail="personal"]')`),seat==='personal');
 await b.evaluate(`document.querySelector('.hps-tool-trigger').click()`);await settle();await b.evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('그려서 보여주기')).click()`);await settle();assert.equal(await b.evaluate(`document.querySelector('dialog.hps-sketch').open`),true);
 for(let i=0;i<colors.length;i++){await button(colors[i][0]);await stroke(90+i*85);assert.deepEqual(await pixel(170,90+i*85),colors[i][1]);}
 // CGP-CHAT-D-020: canvas name, modal width, platform undo shortcut.
 assert.equal(await b.evaluate(`document.querySelector('canvas').getAttribute('aria-label')`),'그림판');
 assert.match(await b.evaluate(`document.getElementById(document.querySelector('canvas').getAttribute('aria-describedby')).textContent`),/방향키.*\+Z로 실행 취소/);
 const modal=await box('dialog.hps-sketch'),vw=await b.evaluate('document.documentElement.clientWidth');
 assert.ok(await b.evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth&&document.querySelector('dialog.hps-sketch').scrollWidth<=document.querySelector('dialog.hps-sketch').clientWidth`),`no horizontal overflow at ${width}`);
 if(vw>=352)assert.ok(modal.w>=320,`sketch modal ${modal.w}px wide at ${width}`);else{assert.ok(modal.l>=0&&modal.r<=vw,'modal inside the 320px viewport');
  for(const r of await b.evaluate(`[...document.querySelectorAll('.hps-sketch button, .hps-sketch canvas, .hps-sketch h2, .hps-sketch p')].map(e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right}})`))assert.ok(r.l>=16&&r.r<=vw-16,`16px gutter at 320: ${JSON.stringify(r)}`);}
 const mac=await b.evaluate(`/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent)`),undoMod=mac?4:2,otherMod=mac?2:4,last=[170,90+5*85];
 await key('z','KeyZ',otherMod);assert.deepEqual(await pixel(...last),colors[5][1],'the other platform modifier does not undo');
 await key('Z','KeyZ',undoMod|8);assert.deepEqual(await pixel(...last),colors[5][1],'Shift+Z (redo) does not undo');
 await b.evaluate(`document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',${mac?'metaKey':'ctrlKey'}:true,isComposing:true,bubbles:true,cancelable:true}))`);await settle();assert.deepEqual(await pixel(...last),colors[5][1],'IME composition does not undo');
 const seen=await b.evaluate('__zSeen');await b.evaluate(`document.querySelector('canvas').focus()`);await key('z','KeyZ',undoMod);assert.deepEqual(await pixel(...last),[255,255,255],'platform modifier+Z undoes the last stroke');assert.deepEqual(await pixel(170,90+4*85),colors[4][1],'only the last stroke');
 assert.equal(await b.evaluate('__zSeen'),seen,'undo does not reach the host keybinding layer');assert.equal(await b.evaluate(`document.activeElement.tagName`),'CANVAS');
 await b.evaluate(`[...document.querySelectorAll('dialog button')].find(e=>e.textContent.includes('지우개')).focus()`);await key('ㅋ','KeyZ',undoMod);assert.deepEqual(await pixel(170,90+4*85),[255,255,255],'Korean input source still undoes (physical key) from a tool button');
 for(const i of [4,5]){await button(colors[i][0]);await stroke(90+i*85);assert.deepEqual(await pixel(170,90+i*85),colors[i][1]);}
 {const box=await b.evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`),p=(x,y)=>({x:box.x+x/768*box.w,y:box.y+y/768*box.h});
  await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...p(600,40),button:'left',buttons:1,clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p(700,40),button:'left',buttons:1});
  await key('z','KeyZ',undoMod);assert.deepEqual(await pixel(...last),colors[5][1],'undo waits while a stroke is down');
  await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p(700,40),button:'left',buttons:0,clickCount:1});await settle();assert.deepEqual(await pixel(650,40),colors[5][1],'the stroke that was down is kept');
  await key('z','KeyZ',undoMod);assert.deepEqual(await pixel(650,40),[255,255,255],'undo works again after the stroke ends');assert.deepEqual(await pixel(...last),colors[5][1]);}
 await button('지우개');await stroke(90);assert.deepEqual(await pixel(170,90),[255,255,255]);await button('실행 취소');assert.deepEqual(await pixel(170,90),colors[0][1]);
 const geometry=await b.evaluate(`[...document.querySelectorAll('.hps-sketch button')].map(b=>{const r=b.getBoundingClientRect();return {w:r.width,h:r.height,font:parseFloat(getComputedStyle(b).fontSize)}})`);for(const r of geometry)assert.ok(r.w>=44&&r.h>=44&&r.font>=14);
 if(evidence){await b.evaluate(`document.querySelector('canvas').scrollIntoView({block:'center'})`);const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
 await button('닫기');assert.equal(await b.evaluate(`document.activeElement.textContent`),'계속 그리기');await key('z','KeyZ',undoMod);assert.equal(await b.evaluate(`document.activeElement.textContent`),'계속 그리기');await button('계속 그리기');assert.deepEqual(await pixel(170,90),colors[0][1]);assert.deepEqual(await pixel(...last),colors[5][1],'undo waits while the discard question is open');
 await button('모두 지우기');assert.deepEqual(await pixel(170,90),[255,255,255]);await button('검정');await stroke(384,384,410);assert.deepEqual(await pixel(395,384),[32,32,32],'new stroke after clear');
 await button('그림 붙이기');assert.deepEqual(await b.evaluate('__errors'),[]);assert.equal(await b.evaluate(`__posted.filter(m=>m.type==='prepareAttachments').at(-1).sketch`),true);assert.equal(await b.evaluate(`document.querySelectorAll('.hps-attachment img').length`),0);
 const png=await b.evaluate(`__posted.filter(m=>m.type==='prepareAttachments').at(-1).files[0].dataUrl`);assert.match(png,/^data:image\/png;base64,/);
 await key('z','KeyZ',undoMod);await reply([{id:'sketch',name:'그림',reason:'저장 권한을 확인해 주세요.'}]);assert.equal(await b.evaluate(`document.querySelector('canvas').toDataURL('image/png')`),png);assert.equal(await b.evaluate(`!!document.querySelector('.hps-sketch')`),true);
 await button('그림 붙이기');await reply([]);assert.equal(await b.evaluate(`!!document.querySelector('.hps-sketch')`),false);assert.equal(await b.evaluate(`document.querySelector('.hps-attachment img').getAttribute('src')`),png);assert.equal(await b.evaluate('__sent'),0);assert.equal(await b.evaluate(`document.activeElement===document.body`),false);
 await b.evaluate(`document.querySelector('.hps-attachment-remove').click()`);await settle();assert.equal(await b.evaluate(`document.querySelectorAll('.hps-attachment img').length`),0);
 if(width===320){
  await b.evaluate(`paint(__props,'keyboard')`);await settle();await b.evaluate(`document.querySelector('.hps-tool-trigger').click()`);await settle();await b.evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('그려서 보여주기')).click()`);await settle();
  await b.evaluate(`document.querySelector('canvas').focus()`);await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,modifiers:8});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,modifiers:0});await settle();assert.deepEqual(await pixel(388,384),[32,32,32]);
  await b.evaluate(`document.querySelector('canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true}))`);await settle();assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="그림 버리기 확인"]')`),false);
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await settle();assert.equal(await b.evaluate(`document.activeElement.textContent`),'계속 그리기');await button('계속 그리기');
  await b.evaluate(`paint({...__props,config:{...__props.config,profile:{...__props.config.profile,input:{image_paste:false}}}},'keyboard')`);await settle();assert.deepEqual(await pixel(388,384),[32,32,32]);assert.equal(await b.evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='그림 붙이기').disabled`),true);
  await button('닫기');await button('버리고 닫기');assert.equal(await b.evaluate(`!!document.querySelector('.hps-sketch')`),false);
  await b.evaluate(`document.querySelector('.hps-tool-trigger')?.click()`);await settle();assert.equal(await b.evaluate(`[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent.includes('그려서 보여주기'))`),false);
 }

}
console.log('PASS actual ChatPanel sketch 12 states: 그림판 name, modal >=320px / 16px gutters at 320, platform Cmd/Ctrl+Z undo, six pixel colors, erase/undo/clear, discard cancel, exact PNG, failed-save retention, success-only image staging, no autosend, focus/44px');
}finally{await b.close()}
