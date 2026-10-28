// DES-KNOW-35 (CGP-KNOW-D-019): the low-disk bar is "not dismissible while below threshold", has "no
// upgrade/purchase button" and its text is "≤2 lines at 320px". The real mounted ChatPanel with the shipped CSS
// in headless Chromium, personal and classroom, light and dark, 320 and 1420 px. Key events go through the
// DevTools protocol into the page (never the OS). The bar must survive every gesture a learner could try:
// Escape on the disclosure, in the composer and on the page, clicks and a double click on the bar, Delete and
// Backspace on its control, a task switch or config re-post, the panel coming back into view, and a new
// measurement that is still below the threshold. Only the host's null removes it. The browser's own
// accessibility tree inside the bar holds exactly one control (the 공간 확보 방법 disclosure) and no link, close
// or purchase node. Lines are counted from the text's own line boxes, and clipping (ellipsis, line clamp,
// hidden overflow) counts as a failure, so the two-line rule cannot be met by hiding words.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {chatConfig,chatPanelProps} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {lowDiskNotice} from '../src/lowDisk.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN: low-disk bar persistence browser unavailable');process.exit(0);}
const props=chatPanelProps(),callbacks=Object.entries(props).filter(([,v])=>typeof v==='function').map(([k])=>`${k}:()=>{}`).join(',');
const asset=await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'out',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';window.mount=(config)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(props)}} {...{${callbacks}}} config={config} onSend={(...a)=>window.sent.push(a)}/>);`,resolveDir:root+'/webview-ui',loader:'tsx'},bundle:true,write:false,outdir:'fixture-assets',format:'iife',platform:'browser',loader:{'.svg':'dataurl'},logLevel:'silent'})).outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin);
await browser.send('Accessibility.enable');
const pause=(ms=60)=>new Promise(r=>setTimeout(r,ms));
const until=async(expr,ms=3000)=>{const end=Date.now()+ms;for(;;){if(await browser.evaluate(`!!(${expr})`))return true;if(Date.now()>end)return false;await pause(40);}};
const MB=1024*1024;
const PURCHASE=/구매|결제|업그레이드|요금|플랜|더 받기|용량 추가|upgrade|purchase|buy|get more|plan/i;
const CLOSE=/닫기|숨기기|그만 보기|다시 보지|close|dismiss|hide|^\s*[x×✕✖]\s*$/i;
const KEYS={Escape:27,Delete:46,Backspace:8};
const press=async(key)=>{const c={key,code:key,windowsVirtualKeyCode:KEYS[key],nativeVirtualKeyCode:KEYS[key]};await browser.send('Input.dispatchKeyEvent',{type:'rawKeyDown',...c});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',...c});await pause();};
const clickAt=async(x,y,count=1)=>{for(let n=1;n<=count;n++){await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:n});await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:n});}await pause();};
const post=(data)=>browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);
const bars=()=>browser.evaluate(`document.querySelectorAll('[data-testid=low-disk-bar]').length`);
// The bar's text as the browser lays it out: distinct line boxes of the text node, and whether any of it is clipped.
const layout=()=>browser.evaluate(`(()=>{const p=document.querySelector('.hps-low-disk-text'),s=getComputedStyle(p),r=document.createRange();r.selectNodeContents(p);
  const tops=[...new Set([...r.getClientRects()].filter(q=>q.width>0&&q.height>0).map(q=>Math.round(q.top)))];
  const box=p.getBoundingClientRect(),bar=document.querySelector('[data-testid=low-disk-bar]').getBoundingClientRect(),rr=r.getBoundingClientRect();
  return {lines:tops.length,text:p.textContent,clipped:p.scrollHeight>p.clientHeight+1||p.scrollWidth>p.clientWidth+1||s.textOverflow==='ellipsis'||(s.webkitLineClamp&&s.webkitLineClamp!=='none')||rr.bottom>bar.bottom+0.5||rr.right>bar.right+0.5||rr.left<bar.left-0.5,
    font:parseFloat(s.fontSize),width:Math.round(box.width)}})()`);
// Every accessibility node inside the bar, as the browser computes them.
async function axInBar(){
  const {result}=await browser.send('Runtime.evaluate',{expression:`document.querySelector('[data-testid=low-disk-bar]')`});
  const {nodes}=await browser.send('Accessibility.queryAXTree',{objectId:result.objectId});
  return nodes.filter(n=>!n.ignored).map(n=>({role:n.role?.value,name:n.name?.value??''}));
}
const open=async(config,width,dark,notice)=>{
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.sent=[];window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
  await browser.evaluate(`mount(${JSON.stringify(config)})`);await pause(80);
  await post({type:'config',config});await post({type:'lowDisk',notice});
  assert.ok(await until(`document.querySelector('[data-testid=low-disk-bar]')`),'bar shown');await pause(80);
};
let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,1420]){
  const label=`${seat}/${dark?'dark':'light'}/${width}`,classroom=seat==='classroom';
  const notice=lowDiskNotice({free:312*MB,threshold:500*MB,platform:'darwin',classroom});
  const tasks=[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0},{id:'t2',title:'둘째',createdAt:1,updatedAt:1,messageCount:0}];
  const cfg=(active)=>chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:seat},activity:{id:'a1',name:'작업',kind:seat,workspace:'/w',verified:true},activityDraft:{text:'초안',images:[],queued:null},...(classroom?{}:{taskWorkspace:{scope:'a',revision:active==='t1'?1:2,activeTaskId:active,tasks,sourceSelection:null}})});
  await open(cfg('t1'),width,dark,notice);
  // ≤2 lines at 320 px, counted from line boxes, nothing clipped, all words present (DES-KNOW-35).
  const l=await layout();
  assert.equal(l.text,notice.text,`${label}: the whole sentence is in the bar`);
  assert.equal(l.clipped,false,`${label}: bar text is not clipped ${JSON.stringify(l)}`);
  assert.ok(l.font>=14,`${label}: text ${l.font}px`);
  if(width===320)assert.ok(l.lines>=1&&l.lines<=2,`${label}: bar text ${l.lines} lines at 320px (width ${l.width})`);
  // The accessibility tree in the bar: one disclosure button, no link, no close, no purchase.
  const ax=await axInBar(),controls=ax.filter(n=>/button|link|menuitem|checkbox|switch/.test(n.role));
  assert.deepEqual(controls.map(n=>`${n.role}:${n.name}`),['button:공간 확보 방법'],`${label}: the only control ${JSON.stringify(controls)}`);
  for(const n of ax){assert.doesNotMatch(n.name,PURCHASE,`${label}: no purchase in ${n.role} "${n.name}"`);if(n.role==='button')assert.doesNotMatch(n.name,CLOSE,`${label}: no close control`);}
  // Every dismiss gesture a learner could try; the bar stays, exactly once.
  const stays=async(what)=>{assert.equal(await bars(),1,`${label}: still one bar after ${what}`);};
  await browser.evaluate(`document.querySelector('.hps-low-disk-help').focus()`);
  await press('Escape');await stays('Escape on the disclosure');
  await press('Delete');await press('Backspace');await stays('Delete/Backspace on the disclosure');
  await browser.evaluate(`document.querySelector('.hps-low-disk-help').click()`);assert.ok(await until(`document.querySelector('.hps-low-disk-help').getAttribute('aria-expanded')==='true'`));
  await press('Escape');await stays('Escape with the steps open');
  await browser.evaluate(`document.querySelector('.hps-input textarea').focus()`);await press('Escape');await press('Escape');await stays('Escape in the composer');
  await browser.evaluate(`document.activeElement.blur()`);await press('Escape');await stays('Escape on the page');
  const pt=await browser.evaluate(`(()=>{const t=document.querySelector('.hps-low-disk-text').getBoundingClientRect(),b=document.querySelector('[data-testid=low-disk-bar]').getBoundingClientRect();return {tx:t.left+4,ty:t.top+t.height/2,bx:b.left+2,by:b.top+2}})()`);
  await clickAt(pt.tx,pt.ty);await clickAt(pt.bx,pt.by);await clickAt(pt.tx,pt.ty,2);await stays('clicks and a double click on the bar');
  await clickAt(Math.floor(width/2),40);await stays('a click elsewhere in the panel');
  // A task switch or a config re-post re-renders the panel; the bar is the host's state, not the task's.
  await post({type:'config',config:cfg(classroom?'t1':'t2')});await pause(120);await stays('a task switch / config re-post');
  // Coming back into view asks the host again; until it answers, the bar stays.
  const asked=await browser.evaluate(`posted.filter(m=>m.type==='lowDiskRequest').length`);
  await browser.evaluate(`window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))`);await pause(120);
  assert.ok(await browser.evaluate(`posted.filter(m=>m.type==='lowDiskRequest').length`)>asked,`${label}: the panel asks the host again`);
  await stays('the panel coming back into view');
  // A new measurement still below the threshold replaces the amounts in the same single bar.
  const lower=lowDiskNotice({free:120*MB,threshold:500*MB,platform:'darwin',classroom});
  await post({type:'lowDisk',notice:lower});await pause(120);await stays('a new measurement below the threshold');
  assert.ok(await browser.evaluate(`document.querySelector('.hps-low-disk-amounts').textContent`)===lower.amounts,`${label}: the new amounts are shown`);
  // Only the host's null (enough space measured) removes it, and the next low measurement brings it back.
  await post({type:'lowDisk',notice:null});assert.ok(await until(`!document.querySelector('[data-testid=low-disk-bar]')`),`${label}: host null removes it`);
  await post({type:'lowDisk',notice});assert.ok(await until(`document.querySelectorAll('[data-testid=low-disk-bar]').length===1`),`${label}: a new low measurement shows it again`);
  cases++;
 }
 console.log(`PASS low-disk-bar-persist: actual ChatPanel, ${cases} seat/theme/width cases`);
}finally{await browser.close();}
