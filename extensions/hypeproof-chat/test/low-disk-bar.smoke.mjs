// REQ-KNOW-35 / DES-KNOW-35 (CGP-KNOW-R-019): the real mounted ChatPanel with the shipped CSS in headless
// Chromium. The low-disk bar sits above the composer in personal and classroom chat, light and dark, at
// 320/800/1420 px: text at most two lines at 320 px and at least 14px, one 44px "공간 확보 방법" disclosure
// with a focus ring (also in forced colours), no close and no purchase/upgrade control, and nothing held:
// the draft stays editable and Enter still sends. The host's null removes it.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chatConfig,chatPanelProps} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
import {lowDiskNotice} from '../src/lowDisk.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN: low-disk bar browser unavailable');process.exit(0);}
const props=chatPanelProps(),callbacks=Object.entries(props).filter(([,v])=>typeof v==='function').map(([k])=>`${k}:()=>{}`).join(',');
const asset=await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'out',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';window.mount=(config)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(props)}} {...{${callbacks}}} config={config} onSend={(...a)=>window.sent.push(a)}/>);`,resolveDir:root+'/webview-ui',loader:'tsx'},bundle:true,write:false,outdir:'fixture-assets',format:'iife',platform:'browser',loader:{'.svg':'dataurl'},logLevel:'silent'})).outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin),evidence=process.env.LOW_DISK_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const delay=()=>new Promise(r=>setTimeout(r,80));
// Poll a page condition instead of trusting one fixed delay (a loaded machine renders late).
const until=async(expr,ms=3000)=>{const end=Date.now()+ms;for(;;){if(await browser.evaluate(`!!(${expr})`))return true;if(Date.now()>end)return false;await new Promise(r=>setTimeout(r,40));}};
const MB=1024*1024;
const PURCHASE=/구매|결제|업그레이드|요금|플랜|더 받기|용량 추가|upgrade|purchase|buy|get more/i;
const lum=(c)=>{const m=c.match(/[\d.]+/g).map(Number);const [r,g,b]=m.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b;};
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const open=async(config,width,dark,notice)=>{
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.sent=[];window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
  await browser.evaluate(`mount(${JSON.stringify(config)})`);await delay();
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}));window.dispatchEvent(new MessageEvent('message',{data:{type:'lowDisk',notice:${JSON.stringify(notice)}}}));`);await until(`document.querySelector('[data-testid=low-disk-bar]')`);await delay();
};
let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800,1420]){
  const label=`${seat}/${dark?'dark':'light'}/${width}`;
  const notice=lowDiskNotice({free:312*MB,threshold:500*MB,platform:'darwin',classroom:seat==='classroom'});
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:seat},activity:{id:'a1',name:'작업',kind:seat,workspace:'/w',verified:true},activityDraft:{text:'초안',images:[],queued:null},...(seat==='personal'?{taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}}:{})});
  await open(config,width,dark,notice);
  assert.ok(await browser.evaluate(`posted.some(m=>m.type==='lowDiskRequest'&&m.mount===true)`),`${label}: the panel asks on mount`);
  const m=await browser.evaluate(`(()=>{const el=document.querySelector('[data-testid=low-disk-bar]');if(!el)return null;const ta=document.querySelector('.hps-input textarea'),text=el.querySelector('.hps-low-disk-text'),btns=[...el.querySelectorAll('button,a,[role=button]')],r=el.getBoundingClientRect(),tr=ta.getBoundingClientRect(),ts=getComputedStyle(text),bg=(n)=>{for(let e=n;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;if(!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c}return 'rgb(255,255,255)'};
   return {inFooter:!!el.closest('footer.hps-input-area'),above:r.bottom<=tr.top+0.5,role:el.getAttribute('role'),live:el.getAttribute('aria-live'),visible:r.width>0&&r.height>0&&getComputedStyle(el).visibility==='visible',within:r.left>=0&&r.right<=innerWidth+0.5,overflow:document.documentElement.scrollWidth>innerWidth,
    lines:Math.round(text.getBoundingClientRect().height/parseFloat(ts.lineHeight)),font:parseFloat(ts.fontSize),textContrast:[ts.color,bg(text)],
    buttons:btns.map(b=>({text:b.textContent,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,font:parseFloat(getComputedStyle(b).fontSize),expanded:b.getAttribute('aria-expanded'),color:getComputedStyle(b).color,bg:bg(b)})),
    detailShown:el.querySelector('.hps-low-disk-detail').getBoundingClientRect().height>0,allText:el.textContent,readOnly:ta.readOnly,disabled:ta.disabled}})()`);
  assert.ok(m,`${label}: bar shown`);
  assert.equal(m.inFooter,true,`${label}: in the composer footer`);assert.equal(m.above,true,`${label}: above the composer`);
  assert.equal(m.role,'status');assert.equal(m.live,'polite');assert.ok(m.visible&&m.within&&!m.overflow,`${label}: visible, inside the panel, no horizontal scroll`);
  assert.ok(m.font>=14,`${label}: text ${m.font}px`);
  if(width===320)assert.ok(m.lines<=2,`${label}: bar text ${m.lines} lines at 320px`);
  assert.ok(contrast(...m.textContrast)>=4.5,`${label}: text contrast ${contrast(...m.textContrast).toFixed(2)}`);
  assert.deepEqual(m.buttons.map(b=>b.text),['공간 확보 방법'],`${label}: exactly one control, no close, no purchase`);
  const b=m.buttons[0];assert.ok(b.w>=44&&b.h>=44,`${label}: target ${b.w}x${b.h}`);assert.ok(b.font>=14,`${label}: control text ${b.font}px`);assert.equal(b.expanded,'false');
  assert.ok(contrast(b.color,b.bg)>=4.5,`${label}: link contrast ${contrast(b.color,b.bg).toFixed(2)}`);
  assert.equal(m.detailShown,false,`${label}: steps folded until asked`);
  assert.doesNotMatch(m.allText,PURCHASE,`${label}: no purchase wording`);
  assert.equal(m.readOnly,false);assert.equal(m.disabled,false,`${label}: the composer stays editable`);
  // Open the steps; they name the amounts, the seat's steps, and that saved files stay openable.
  await browser.evaluate(`document.querySelector('.hps-low-disk-help').click()`);await until(`document.querySelector('.hps-low-disk-help').getAttribute('aria-expanded')==='true'`);await delay();
  const d=await browser.evaluate(`(()=>{const el=document.querySelector('[data-testid=low-disk-bar]'),det=el.querySelector('.hps-low-disk-detail'),btn=el.querySelector('.hps-low-disk-help');return {expanded:btn.getAttribute('aria-expanded'),controls:btn.getAttribute('aria-controls')===det.id,h:det.getBoundingClientRect().height,text:det.textContent,font:Math.min(...[...det.querySelectorAll('p,li')].map(n=>parseFloat(getComputedStyle(n).fontSize))),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.equal(d.expanded,'true');assert.equal(d.controls,true);assert.ok(d.h>0,`${label}: steps shown`);assert.ok(d.font>=14,`${label}: step text ${d.font}px`);assert.equal(d.overflow,false);
  assert.ok(d.text.includes('남은 공간 312MB')&&d.text.includes('지금 있는 파일은 그대로 열 수 있어요'),`${label}: amounts and the open-files promise`);
  assert.equal(d.text.includes('선생님께'),seat==='classroom',`${label}: class seats ask the teacher`);
  if(evidence){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
  // Keyboard: Tab from the composer backwards reaches the disclosure with a visible ring that hugs it.
  await browser.evaluate(`document.querySelector('.hps-low-disk-help').focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
  const f=await browser.evaluate(`(()=>{const a=document.activeElement,s=getComputedStyle(a);return {text:a.textContent,w:parseFloat(s.outlineWidth),style:s.outlineStyle,off:parseFloat(s.outlineOffset)}})()`);
  assert.equal(f.text,'공간 확보 방법',`${label}: keyboard reaches the disclosure`);assert.ok(f.w>=2&&f.style!=='none'&&f.off<=4,`${label}: focus ring ${JSON.stringify(f)}`);
  if(width===320){
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   const fc=await browser.evaluate(`(()=>{const a=document.activeElement,s=getComputedStyle(a),bar=getComputedStyle(document.querySelector('[data-testid=low-disk-bar]'));return {w:parseFloat(s.outlineWidth),style:s.outlineStyle,edge:parseFloat(bar.borderLeftWidth),edgeStyle:bar.borderLeftStyle}})()`);
   assert.ok(fc.w>=2&&fc.style!=='none',`${label}: forced-colours focus ring`);assert.ok(fc.edge>=1&&fc.edgeStyle!=='none',`${label}: forced-colours edge stays`);
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
  }
  // Nothing is held: Enter in the composer sends while the bar is up.
  await browser.evaluate(`(()=>{const ta=document.querySelector('.hps-input textarea');ta.focus()})()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.ok(await until(`sent.length>0||posted.some(m=>m.type==='sendMessage')`),`${label}: Enter still sends`);
  assert.ok(await browser.evaluate(`!!document.querySelector('[data-testid=low-disk-bar]')`),`${label}: the bar persists after a send`);
  await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'lowDisk',notice:null}}))`);
  assert.ok(await until(`!document.querySelector('[data-testid=low-disk-bar]')`),`${label}: host null removes it`);
  cases++;
 }
 console.log(`PASS low-disk-bar: actual ChatPanel, ${cases} seat/theme/width cases`);
}finally{await browser.close();}
