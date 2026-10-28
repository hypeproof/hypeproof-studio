// CGP-AGENT-D-026 (DES-CGP-AGENT-64, REQ-STUDIO-PERF-TRACE): the real mounted ChatPanel with the shipped CSS in
// headless Chromium. While the host reports a 느려요 기록, a red "기록 중 · 멈추기" pill sits above the composer in
// personal, classroom and instructor chat, dark and light, at 320/800/1420 px: a 44px target, text at least 14px,
// ink at least 4.5:1 on a red fill, the fill at least 3:1 against the panel, inside the window, with a focus ring,
// and an edge plus a ring in forced colours. The panel asks for the state on mount; a press sends the recording's
// own id once (a second press waits); the host's "not recording" removes it.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chatConfig,chatPanelProps} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN: perf-trace pill browser unavailable');process.exit(0);}
const props=chatPanelProps(),callbacks=Object.entries(props).filter(([,v])=>typeof v==='function').map(([k])=>`${k}:()=>{}`).join(',');
const asset=await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'out',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';window.mount=(config,instructor)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(props)}} {...{${callbacks}}} config={config} instructor={instructor} onSend={()=>{}}/>);`,resolveDir:root+'/webview-ui',loader:'tsx'},bundle:true,write:false,outdir:'fixture-assets',format:'iife',platform:'browser',loader:{'.svg':'dataurl'},logLevel:'silent'})).outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin),evidence=process.env.PERF_TRACE_PILL_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const until=async(expr,ms=3000)=>{const end=Date.now()+ms;for(;;){if(await browser.evaluate(`!!(${expr})`))return true;if(Date.now()>end)return false;await new Promise(r=>setTimeout(r,40));}};
const delay=()=>new Promise(r=>setTimeout(r,80));
const rgb=(c)=>c.match(/[\d.]+/g).map(Number);
const lum=(c)=>{const [r,g,b]=rgb(c).slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b;};
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const host=(data)=>browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);
const measure=()=>browser.evaluate(`(()=>{const b=document.querySelector('[data-perf-trace-pill]');if(!b)return null;const ta=document.querySelector('.hps-input textarea'),r=b.getBoundingClientRect(),s=getComputedStyle(b),label=b.querySelector('span'),panel=(n)=>{for(let e=n.parentElement;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;if(!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c}return getComputedStyle(document.body).backgroundColor};
  return {tag:b.localName,type:b.type,text:b.textContent,aria:b.getAttribute('aria-label'),inFooter:!!b.closest('footer.hps-input-area'),above:r.bottom<=ta.getBoundingClientRect().top+0.5,w:r.width,h:r.height,left:r.left,right:r.right,overflow:document.documentElement.scrollWidth>innerWidth,
   font:parseFloat(getComputedStyle(label).fontSize),fg:s.color,bg:s.backgroundColor,panel:panel(b),border:parseFloat(s.borderTopWidth),borderStyle:s.borderTopStyle,borderColor:s.borderTopColor,icon:!!b.querySelector('svg[data-icon=stop][aria-hidden=true]')}})()`);
let cases=0;
try{
 for(const seat of ['personal','classroom','instructor'])for(const dark of [false,true])for(const width of [320,800,1420]){
  const label=`${seat}/${dark?'dark':'light'}/${width}`;
  const kind=seat==='personal'?'personal':'classroom';
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:kind},activity:{id:'a1',name:'작업',kind,workspace:'/w',verified:true},...(seat==='instructor'?{isInstructor:true}:{}),...(seat==='personal'?{taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}}:{})});
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}" style="background:var(--vscode-sideBar-background)"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
  await browser.evaluate(`mount(${JSON.stringify(config)},${seat==='instructor'})`);await delay();
  await host({type:'config',config});await delay();
  assert.ok(await browser.evaluate(`posted.some(m=>m.type==='perfTraceStateRequest')`),`${label}: the panel asks for the state on mount`);
  assert.equal(await measure(),null,`${label}: no pill without a recording`);
  await host({type:'perfTraceState',recording:false,id:null});await delay();
  assert.equal(await measure(),null,`${label}: no pill when the host says not recording`);
  // The state is machine-wide: it carries no activity or task id, and a stamped message for another task is still not needed.
  await host({type:'perfTraceState',recording:true,id:'perf-1'});
  assert.ok(await until(`document.querySelector('[data-perf-trace-pill]')`),`${label}: pill shown while recording`);await delay();
  const m=await measure();
  assert.equal(m.tag,'button');assert.equal(m.type,'button');assert.equal(m.text,'기록 중 · 멈추기');assert.equal(m.aria,'느려요 기록 중. 누르면 기록을 멈춰요.');assert.ok(m.icon,`${label}: decorative stop icon`);
  assert.ok(m.inFooter&&m.above,`${label}: in the footer above the composer`);
  assert.ok(m.w>=44&&m.h>=44,`${label}: target ${m.w}x${m.h}`);assert.ok(m.font>=14,`${label}: text ${m.font}px`);
  assert.ok(m.left>=0&&m.right<=width+0.5&&!m.overflow,`${label}: inside the window, no horizontal scroll`);
  const [r,g,b]=rgb(m.bg);assert.ok(r>=180&&r-g>=60&&r-b>=60,`${label}: red fill ${m.bg}`);
  assert.ok(contrast(m.fg,m.bg)>=4.5,`${label}: ink ${contrast(m.fg,m.bg).toFixed(2)}:1 on the fill`);
  assert.ok(contrast(m.bg,m.panel)>=3,`${label}: fill ${contrast(m.bg,m.panel).toFixed(2)}:1 against the panel ${m.panel}`);
  assert.ok(m.border>=1&&m.borderStyle==='solid',`${label}: pill has an edge`);
  const ring=await browser.focusVisibleStyle('[data-perf-trace-pill]',['outline-width','outline-style','outline-offset']);
  assert.ok(parseFloat(ring['outline-width'])>=2&&ring['outline-style']!=='none'&&parseFloat(ring['outline-offset'])<=4,`${label}: focus ring ${JSON.stringify(ring)}`);
  if(evidence){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
  if(width===320){
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   const fc=await measure();const fring=await browser.focusVisibleStyle('[data-perf-trace-pill]',['outline-width','outline-style']);
   assert.ok(fc.border>=1&&fc.borderStyle!=='none',`${label}: forced-colours edge`);assert.ok(parseFloat(fring['outline-width'])>=2&&fring['outline-style']!=='none',`${label}: forced-colours focus ring`);
   assert.ok(contrast(fc.fg,fc.bg)>=4.5,`${label}: forced-colours text ${fc.fg} on ${fc.bg}`);
   if(evidence){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}-forced.png`,Buffer.from(shot.data,'base64'));}
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
  }
  // Keyboard: Enter on the focused pill presses it once and sends the recording's id; a second press waits.
  await browser.evaluate(`document.querySelector('[data-perf-trace-pill]').focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.ok(await until(`posted.some(m=>m.type==='perfTraceStop')`),`${label}: the press reaches the host`);
  await browser.evaluate(`document.querySelector('[data-perf-trace-pill]').click()`);await delay();
  assert.deepEqual(await browser.evaluate(`posted.filter(m=>m.type==='perfTraceStop').map(m=>m.id)`),['perf-1'],`${label}: one stop with the pill's own id`);
  assert.equal(await browser.evaluate(`document.querySelector('[data-perf-trace-pill]').getAttribute('aria-disabled')`),'true',`${label}: pending press is marked`);
  // A new recording (the host corrected a stale pill) presses with its own id.
  await host({type:'perfTraceState',recording:true,id:'perf-2'});await delay();
  await browser.evaluate(`document.querySelector('[data-perf-trace-pill]').click()`);await delay();
  assert.deepEqual(await browser.evaluate(`posted.filter(m=>m.type==='perfTraceStop').map(m=>m.id)`),['perf-1','perf-2'],`${label}: a new recording's pill presses with its own id`);
  await host({type:'perfTraceState',recording:false,id:null});
  assert.ok(await until(`!document.querySelector('[data-perf-trace-pill]')`),`${label}: the host's stop removes the pill`);
  cases++;
 }
 console.log(`PASS perf-trace-pill: actual ChatPanel, ${cases} seat/theme/width cases`);
}finally{await browser.close();}
