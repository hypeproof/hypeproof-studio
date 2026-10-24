// CGP-CHAT-D-005: real answer actions and controlled local verdict state, with built CSS.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN verdict controls: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'verdict-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const script=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';function Fixture(){const [verdicts,setVerdicts]=useState({});window.__hostVerdict=(id,next)=>setVerdicts(v=>({...v,[id]:next}));return <ChatPanel {...window.__verdictProps} verdicts={verdicts} onVerdict={(id,next)=>{window.__verdictCalls.push({id,next});setVerdicts(v=>({...v,[id]:next}));}}/>}createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const b=await launch(bin),evidence=process.env.VERDICT_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const settle=()=>new Promise(r=>setTimeout(r,200));
const click=async(sel)=>{await b.evaluate(`{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center'});e.focus();e.click();}`);await settle();};
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const mode of ['motion','reduced','forced']){
  const reduced=mode==='reduced',forcedColors=mode==='forced';
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
  const props=chatPanelProps({config,messages:[{id:'prompt-1',role:'user',createdAt:1,content:'설명해 주세요'},{id:'answer-1',role:'assistant',createdAt:2,content:'이 답변을 확인해 주세요.'}]});
  await b.load(`<html style="${vars}" data-reduced-motion="${reduced}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:800px"><div id="root"></div></div><input id="outside" aria-label="outside"><script>window.__verdictProps=${JSON.stringify(props)};window.__verdictCalls=[];</script><script>${script.outputFiles[0].text}</script></body></html>`,{width,height:900,dark,forcedColors});
  if(seat==='classroom'){assert.equal(await b.evaluate(`document.querySelectorAll('.hps-verdict').length`),0,'DEC-09 classroom remains excluded');continue;}
  const before=await b.evaluate(`[...document.querySelectorAll('.hps-verdict')].map(e=>({icon:e.querySelector('svg')?.dataset.icon,size:e.querySelector('svg')?.getBoundingClientRect().width,h:e.getBoundingClientRect().height,border:getComputedStyle(e).borderWidth,pressed:e.getAttribute('aria-pressed'),bg:getComputedStyle(e).backgroundColor}))`);
  assert.equal(before.length,2);assert.deepEqual(before.map(x=>x.icon),['square','pencil']);for(const x of before){assert.equal(x.size,16);assert.ok(x.h>=44);assert.equal(x.border,forcedColors?'1px':'0px');assert.equal(x.pressed,'false');}
  await click('.hps-verdict-fix');
  const selected=await b.evaluate(`(()=>{const e=document.querySelector('.hps-verdict-fix');return {icon:e.querySelector('svg').dataset.icon,bg:getComputedStyle(e).backgroundColor,pressed:e.getAttribute('aria-pressed')}})()`);
  assert.equal(selected.icon,'check');assert.equal(selected.pressed,'true');if(!forcedColors)assert.notEqual(selected.bg,before[1].bg);
  const open=await b.evaluate(`(()=>{const e=document.querySelector('.hps-verdict-reason-disclosure');return {height:e.getBoundingClientRect().height,duration:getComputedStyle(e).transitionDuration}})()`);
  assert.ok(open.height>=44);assert.equal(open.duration,reduced?'0s':'0.16s, 0.16s');
  await click('.hps-verdict-reason');
  const collapsed=await b.evaluate(`(()=>{const e=document.querySelector('.hps-verdict-reason-disclosure'),t=document.querySelector('.hps-verdict-reason-toggle');return {height:e.getBoundingClientRect().height,inert:e.inert,hidden:e.getAttribute('aria-hidden'),expanded:t.getAttribute('aria-expanded'),text:t.textContent,focus:document.activeElement===t,note:(()=>{const n=document.querySelector('.hps-verdict-note textarea');if(!n)return null;const r=n.getBoundingClientRect(),c=getComputedStyle(n);return {display:c.display,visibility:c.visibility,w:r.width,h:r.height}})()}})()`);
  assert.equal(collapsed.height,0);assert.equal(collapsed.inert,true);assert.equal(collapsed.hidden,'true');assert.equal(collapsed.expanded,'false');assert.match(collapsed.text,/틀렸어요/);assert.equal(collapsed.focus,true);assert.ok(collapsed.note,'note editor stays available');assert.notEqual(collapsed.note.display,'none');assert.notEqual(collapsed.note.visibility,'hidden');assert.ok(collapsed.note.w>0&&collapsed.note.h>0,'note editor has a box while the reasons are collapsed');
  // A collapsed reason cannot take keyboard focus; the visible summary can reopen it.
  assert.equal(await b.evaluate(`{document.querySelector('.hps-verdict-reason').focus();}document.activeElement.classList.contains('hps-verdict-reason-toggle')`),true);
  await click('.hps-verdict-reason-toggle');assert.equal(await b.evaluate(`document.querySelector('.hps-verdict-reason-disclosure').inert`),false);
  // Clicking the selected reason clears it, preserving the existing toggle semantics.
  await click('.hps-verdict-reason');assert.equal(await b.evaluate(`document.querySelectorAll('.hps-verdict-note').length`),0);
  await click('.hps-verdict-reason:nth-child(4)');
  await b.evaluate(`{const e=document.querySelector('.hps-verdict-note textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'내용 <script>는 글자예요');e.dispatchEvent(new Event('input',{bubbles:true}));}`);await settle();
  await click('.hps-verdict-note-actions button');
  const calls=await b.evaluate(`window.__verdictCalls`);assert.equal(calls.at(-1).id,'answer-1');assert.equal(calls.at(-1).next.note,'내용 <script>는 글자예요');
  await click('.hps-verdict-reason-toggle');await click('.hps-verdict-reason:nth-child(2)');
  assert.equal(await b.evaluate(`document.querySelector('.hps-verdict-note textarea').value`),'내용 <script>는 글자예요','saved note survives reason change');
  if(forcedColors){
   const colors=await b.evaluate(`(()=>{const p=document.createElement('div');p.style.cssText='color:CanvasText;background:Canvas';document.body.append(p);const expected=getComputedStyle(p),actual=getComputedStyle(document.querySelector('.hps-verdict-fix'));const result={foreground:actual.color,background:actual.backgroundColor,canvas:expected.backgroundColor,text:expected.color};p.remove();return result})()`);
   assert.equal(colors.foreground,colors.text);assert.equal(colors.background,colors.canvas,'avoid forced-color text backplate');assert.notEqual(colors.foreground,colors.background);
  }
  const geometry=await b.evaluate(`(()=>{document.querySelector('.hps-verdict-reason-toggle').scrollIntoView({block:'center'});return [...document.querySelectorAll('.hps-verdict,.hps-verdict-reason-toggle')].map(e=>{const r=e.getBoundingClientRect();return {h:r.height,left:r.left,right:r.right,font:parseFloat(getComputedStyle(e).fontSize)}})})()`);
  for(const x of geometry){assert.ok(x.h>=44);assert.ok(x.left>=0&&x.right<=width);assert.ok(x.font>=14);}
  if(!forcedColors){
   const hover=await b.focusVisibleStyle('.hps-verdict-reason-toggle',['background-color'],['hover'],false);
   const pressed=await b.focusVisibleStyle('.hps-verdict-reason-toggle',['background-color'],['hover','active'],false);
   assert.notEqual(pressed['background-color'],hover['background-color'],'pressed fill must differ from hover');
  }
  const focus=await b.focusVisibleStyle('.hps-verdict-reason-toggle');assert.equal(focus['outline-width'],'2px');assert.equal(focus['outline-style'],'solid');
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/verdict-${width}-${dark?'dark':'light'}-${mode}.png`,Buffer.from(shot.data,'base64'));}
  // A host-driven reason change (another window, a restore) must never move focus off where the learner left it.
  await b.evaluate(`document.getElementById('outside').focus()`);
  await b.evaluate(`window.__hostVerdict('answer-1',{verdict:'fix',reason:'too_hard'})`);await settle();
  assert.equal(await b.evaluate(`document.querySelector('.hps-verdict-reason[aria-pressed="true"]').textContent`).then(t=>t.length>0),true,'host reason applied');
  assert.equal(await b.evaluate(`document.activeElement&&document.activeElement.id`),'outside','host reason change keeps focus');
  await click('.hps-verdict-fix');assert.equal(await b.evaluate(`document.querySelectorAll('.hps-verdict-reasons').length`),0);
 }
 console.log('PASS verdict controls: real personal ChatPanel, classroom exclusion, icons/fill/44px/320px, 160ms/reduced motion/forced colors, collapse/inert/focus/reopen/clear and saved note');
}finally{await b.close()}
