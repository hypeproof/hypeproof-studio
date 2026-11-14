// CGP-AGENT-R-031 / CGP-AGENT-D-027 (REQ-CGP-AGENT-66, DES-CGP-AGENT-66): the real mounted ChatPanel with
// the shipped CSS in headless Chromium. While the host says busy, one amber info line sits above the
// composer in personal and classroom chat, light and dark, at 320/800/1420 px:
// - one line of text at least 14px, an icon, and one 44px close with a focus ring (also in forced colours);
// - role=status, no animation or transition, and no provider or cause named;
// - nothing held: the draft stays editable and Enter still sends;
// - the host's `busy:false` removes it, and once closed it stays closed for the session even if busy returns.
// Negative control: with no `serviceStatus` message, or with `busy:false`, there is no banner.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chatConfig,chatPanelProps} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN: busy banner browser unavailable');process.exit(0);}
const props=chatPanelProps(),callbacks=Object.entries(props).filter(([,v])=>typeof v==='function').map(([k])=>`${k}:()=>{}`).join(',');
const asset=await build({entryPoints:[`${root}/webview-ui/src/main.tsx`],bundle:true,write:false,outdir:'out',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ChatPanel}from'./src/ChatPanel';window.mount=(config)=>createRoot(document.getElementById('root')).render(<ChatPanel {...${JSON.stringify(props)}} {...{${callbacks}}} config={config} onSend={(...a)=>window.sent.push(a)}/>);`,resolveDir:root+'/webview-ui',loader:'tsx'},bundle:true,write:false,outdir:'fixture-assets',format:'iife',platform:'browser',loader:{'.svg':'dataurl'},logLevel:'silent'})).outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await launch(bin),evidence=process.env.BUSY_BANNER_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const delay=()=>new Promise(r=>setTimeout(r,80));
const until=async(expr,ms=3000)=>{const end=Date.now()+ms;for(;;){if(await browser.evaluate(`!!(${expr})`))return true;if(Date.now()>end)return false;await new Promise(r=>setTimeout(r,40));}};
const PROVIDER=/anthropic|openai|claude|gpt|gemini|glm|서버 오류|장애|오류 코드/i;
const lum=(c)=>{const m=c.match(/[\d.]+/g).map(Number);const [r,g,b]=m.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b;};
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
const host=(msg)=>browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}))`);
const BANNER='[data-testid=busy-banner]';
const open=async(config,width,dark)=>{
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.sent=[];window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:900,dark});
  await browser.evaluate(`mount(${JSON.stringify(config)})`);await delay();
  await host({type:'config',config});await delay();
};
let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800,1420]){
  const label=`${seat}/${dark?'dark':'light'}/${width}`;
  const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:seat},activity:{id:'a1',name:'작업',kind:seat,workspace:'/w',verified:true},activityDraft:{text:'초안',images:[],queued:null},...(seat==='personal'?{taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}}:{})});
  await open(config,width,dark);
  assert.ok(await browser.evaluate(`posted.some(m=>m.type==='serviceStatusRequest'&&m.mount===true)`),`${label}: the panel asks on mount`);
  assert.equal(await browser.evaluate(`!!document.querySelector('${BANNER}')`),false,`${label}: negative control, no answer yet, no banner`);
  await host({type:'serviceStatus',busy:false});await delay();
  assert.equal(await browser.evaluate(`!!document.querySelector('${BANNER}')`),false,`${label}: negative control, busy:false shows nothing`);
  await host({type:'serviceStatus',busy:true});
  assert.ok(await until(`document.querySelector('${BANNER}')`),`${label}: busy shows the banner`);await delay();
  const m=await browser.evaluate(`(()=>{const el=document.querySelector('${BANNER}');const ta=document.querySelector('.hps-input textarea'),text=el.querySelector('.hps-busy-banner-text'),btns=[...el.querySelectorAll('button,a,[role=button]')],r=el.getBoundingClientRect(),tr=ta.getBoundingClientRect(),ts=getComputedStyle(text),es=getComputedStyle(el),bg=(n)=>{for(let e=n;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;if(!/rgba\\(0, 0, 0, 0\\)|transparent/.test(c))return c}return 'rgb(255,255,255)'};
   return {inFooter:!!el.closest('footer.hps-input-area'),above:r.bottom<=tr.top+0.5,role:el.getAttribute('role'),icon:!!el.querySelector(':scope > svg'),visible:r.width>0&&r.height>0,within:r.left>=0&&r.right<=innerWidth+0.5,overflow:document.documentElement.scrollWidth>innerWidth,
    lines:Math.round(text.getBoundingClientRect().height/parseFloat(ts.lineHeight)),font:parseFloat(ts.fontSize),textContrast:[ts.color,bg(text)],edge:parseFloat(es.borderLeftWidth),edgeColor:es.borderLeftColor,
    motion:[el,...el.querySelectorAll('*')].map(n=>getComputedStyle(n)).filter(s=>s.animationName!=='none'||parseFloat(s.transitionDuration)>0).length,
    buttons:btns.map(b=>({label:b.getAttribute('aria-label'),w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})),allText:el.textContent,readOnly:ta.readOnly,disabled:ta.disabled}})()`);
  assert.equal(m.inFooter,true,`${label}: in the composer footer`);assert.equal(m.above,true,`${label}: above the composer`);
  assert.equal(m.role,'status');assert.equal(m.icon,true,`${label}: text + icon`);
  assert.ok(m.visible&&m.within&&!m.overflow,`${label}: visible, inside the panel, no horizontal scroll`);
  assert.equal(m.lines,1,`${label}: one line (${m.lines})`);assert.ok(m.font>=14,`${label}: text ${m.font}px`);
  assert.ok(contrast(...m.textContrast)>=4.5,`${label}: text contrast ${contrast(...m.textContrast).toFixed(2)}`);
  assert.ok(m.edge>=2,`${label}: the amber edge`);
  assert.equal(m.motion,0,`${label}: no animation or transition`);
  assert.equal(m.allText,'AI가 지금 붐벼요. 답이 늦을 수 있어요.',`${label}: the copy`);assert.doesNotMatch(m.allText,PROVIDER,`${label}: no provider or cause`);
  assert.equal(m.buttons.length,1,`${label}: exactly one control`);assert.equal(m.buttons[0].label,'붐빔 알림 닫기');
  assert.ok(m.buttons[0].w>=44&&m.buttons[0].h>=44,`${label}: close target ${m.buttons[0].w}x${m.buttons[0].h}`);
  assert.equal(m.readOnly,false);assert.equal(m.disabled,false,`${label}: the composer stays editable`);
  if(evidence){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
  // Focus ring on the close, and in forced colours the edge and the ring stay.
  await browser.evaluate(`document.querySelector('.hps-busy-banner-close').focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
  const f=await browser.evaluate(`(()=>{const a=document.activeElement,s=getComputedStyle(a);return {label:a.getAttribute('aria-label'),w:parseFloat(s.outlineWidth),style:s.outlineStyle,off:parseFloat(s.outlineOffset)}})()`);
  assert.equal(f.label,'붐빔 알림 닫기',`${label}: keyboard reaches the close`);assert.ok(f.w>=2&&f.style!=='none'&&f.off<=4,`${label}: focus ring ${JSON.stringify(f)}`);
  if(width===320){
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
   const fc=await browser.evaluate(`(()=>{const a=document.activeElement,s=getComputedStyle(a),bar=getComputedStyle(document.querySelector('${BANNER}'));return {w:parseFloat(s.outlineWidth),style:s.outlineStyle,edge:parseFloat(bar.borderLeftWidth),edgeStyle:bar.borderLeftStyle}})()`);
   assert.ok(fc.w>=2&&fc.style!=='none',`${label}: forced-colours focus ring`);assert.ok(fc.edge>=1&&fc.edgeStyle!=='none',`${label}: forced-colours edge stays`);
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]});
   assert.equal(await browser.evaluate(`[document.querySelector('${BANNER}'),...document.querySelectorAll('${BANNER} *')].filter(n=>{const s=getComputedStyle(n);return s.animationName!=='none'||parseFloat(s.transitionDuration)>0}).length`),0,`${label}: reduced motion, still no motion`);
   await browser.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
  }
  // Nothing is held: Enter in the composer sends while the banner is up.
  await browser.evaluate(`document.querySelector('.hps-input textarea').focus()`);
  await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.ok(await until(`sent.length>0||posted.some(m=>m.type==='sendMessage')`),`${label}: Enter still sends`);
  // Healthy removes it; busy again brings it back.
  await host({type:'serviceStatus',busy:false});
  assert.ok(await until(`!document.querySelector('${BANNER}')`),`${label}: busy:false removes it`);
  await host({type:'serviceStatus',busy:true});
  assert.ok(await until(`document.querySelector('${BANNER}')`),`${label}: busy again shows it again`);
  // Closing holds for the session, even when busy flips back and forth; focus returns to the composer.
  await browser.evaluate(`document.querySelector('.hps-busy-banner-close').click()`);
  assert.ok(await until(`!document.querySelector('${BANNER}')`),`${label}: close hides it`);
  assert.equal(await browser.evaluate(`document.activeElement===document.querySelector('.hps-input textarea')`),true,`${label}: focus returns to the composer`);
  await host({type:'serviceStatus',busy:false});await host({type:'serviceStatus',busy:true});await delay();await delay();
  assert.equal(await browser.evaluate(`!!document.querySelector('${BANNER}')`),false,`${label}: closed stays closed for the session`);
  cases++;
 }
 console.log(`PASS busy-banner: actual ChatPanel, ${cases} seat/theme/width cases`);
}finally{await browser.close();}
