import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER){console.error('workspace-file-mentions-browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1');process.exit(1);}console.log('workspace-file-mentions-browser NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'mention-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'}),css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';const root=createRoot(document.getElementById('root'));window.paint=(props=window.__props,key='initial')=>root.render(<ChatPanel key={key} {...props} onAttachFile={()=>{}} onSend={()=>{window.__sent++;return true}}/>);paint();`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
let b;try{b=await launch(bin);}catch(error){if(process.env.FOCUS_REQUIRE_BROWSER)throw error;console.log('workspace-file-mentions-browser NOT RUN: '+error.message);process.exit(0);}
const evidence=process.env.FILE_MENTION_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const settle=()=>new Promise(r=>setTimeout(r,180));
const input=async text=>{await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.insertText',{text});await settle();};
const key=async value=>{await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value,windowsVirtualKeyCode:{Enter:13,Escape:27,ArrowDown:40}[value]});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value});await settle();};
const latest=()=>b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').at(-1)`);
const reply=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle();};
const firstIds=new Set();let pages=0;
const files=[{path:'notes/긴 파일 이름으로 된 작업 자료.txt',bytes:123},{path:'other.md',bytes:20}];
try{
for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{fileMentions:true,fileAttach:true,activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null,minor_cohort:false},taskWorkspace:seat==='personal'?{scope:'mentions',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null}:undefined});
 const props=chatPanelProps({config,messages:[]});
 await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="height:900px"><div id="root"></div></div><script>window.__props=${JSON.stringify(props).replaceAll('<','\\u003c')};window.__sent=0;window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark});await settle();
 assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail="personal"]')`),seat==='personal');
 await input('질문 @no');const request=await latest();assert.equal(request.query,'no');pages++;firstIds.add(request.requestId);assert.match(request.requestId,/^mention-[0-9a-f-]{32,36}$/);assert.equal(firstIds.size,pages,'each fresh panel starts with a unique request id (a per-webview counter repeats mention-1)');await reply({type:'fileMentionResults',requestId:request.requestId,files,limited:true});
 assert.equal(await b.evaluate(`document.querySelectorAll('[role="option"]').length`),2);assert.equal(await b.evaluate('__sent'),0);
 await reply({type:'fileMentionResults',requestId:'old',files:[],limited:false});assert.equal(await b.evaluate(`document.querySelectorAll('[role="option"]').length`),2,'stale response ignored');
 const geometry=await b.evaluate(`[...document.querySelectorAll('.hps-file-mentions button')].map(b=>{const r=b.getBoundingClientRect();return {h:r.height,w:r.width,l:r.left,r:r.right,font:parseFloat(getComputedStyle(b).fontSize)}})`);for(const r of geometry){assert.ok(r.h>=44&&r.w>=44&&r.font>=14);assert.ok(r.l>=0&&r.r<=width);}
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
 await key('Escape');assert.equal(await b.evaluate(`document.querySelector('.hps-input textarea').value`),'질문 @no');assert.equal(await b.evaluate(`!!document.querySelector('.hps-file-mentions')`),false);assert.equal(await b.evaluate(`document.activeElement===document.querySelector('.hps-input textarea')`),true);
 await input('t');const second=await latest();assert.notEqual(second.requestId,request.requestId);await reply({type:'fileMentionResults',requestId:second.requestId,files,limited:false});await key('ArrowDown');assert.ok((await b.evaluate(`document.querySelector('[role=option][aria-selected=true]').textContent`)).startsWith('other.md'));assert.equal(await b.evaluate(`document.querySelector('[role=option][aria-selected=true] svg[data-icon="check"][aria-hidden="true"]')!==null && document.querySelectorAll('[role=option] svg').length===1`),true,'chosen row has the shared stroke check icon (a non-color marker), other rows none');await key('Enter');
 assert.equal(await b.evaluate(`__posted.filter(m=>m.type==='fileMentionPick').at(-1).path`),'other.md');assert.equal(await b.evaluate('__sent'),0);
 await reply({type:'fileMentionPicked',requestId:second.requestId,ok:false});assert.equal(await b.evaluate(`document.querySelector('.hps-input textarea').value`),'질문 @not');
 await key('Enter');await reply({type:'fileMentionPicked',requestId:second.requestId,ok:true});assert.equal(await b.evaluate(`document.querySelector('.hps-input textarea').value`),'질문 ');assert.equal(await b.evaluate('__sent'),0);
 // Same fileAttachment prop used by App displays the unchanged existing removable context chip.
 await b.evaluate(`paint({...__props,fileAttachment:{path:'other.md',text:'파일 내용',bytes:20}})`);await settle();assert.equal(await b.evaluate(`document.querySelector('[data-testid="file-attachment-text"]').textContent`),'파일 내용');
 if(width===320){
  await b.evaluate(`paint(__props,'ime')`);await settle();const before=await b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').length`);
  await b.evaluate(`document.querySelector('.hps-input textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);await input('@');assert.equal(await b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').length`),before);
  await b.evaluate(`document.querySelector('.hps-input textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);await settle();assert.ok(await latest());
  await b.evaluate(`paint({...__props,config:{...__props.config,fileMentions:false}},'disabled')`);await settle();const count=await b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').length`);await input('@');assert.equal(await b.evaluate(`__posted.filter(m=>m.type==='fileMentionSearch').length`),count);
 }
}
console.log('PASS actual ChatPanel file mentions 12 states: query, keyboard/Escape, IME, disabled gate, stale replies, refusal retention, success-only trigger removal, standard chip and44px controls');
}finally{await b.close()}
