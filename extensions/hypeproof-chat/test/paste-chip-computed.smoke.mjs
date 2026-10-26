// CGP-CHAT-D-017 (DES CGP-CHAT-D07): the long-paste chip is the D06 file-chip family with the label
// "붙여넣은 글 · N줄", and expanding opens an inline editor that stops at 240px and scrolls itself.
// Computed on the real ChatPanel in headless Chromium: both seats, dark/light, 320/800/1420, forced colours.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatPanelProps,chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN paste chip: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'esm',outdir:'paste-chip-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text;
const js=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from './src/ChatPanel';createRoot(document.getElementById('root')).render(<ChatPanel {...window.fixture} fileAttachment={window.file} onAttachFile={()=>{}} onRemoveFileAttachment={()=>{}} onSend={()=>{window.sent++;return true}}/>);`,resolveDir:dir,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
const evidence=process.env.PASTE_CHIP_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const pause=(ms=120)=>new Promise(r=>setTimeout(r,ms));
const pasted='첫 줄 <b>그대로</b>\n'+'붙여넣은 긴 글의 한 줄이에요\n'.repeat(119)+'끝';// 121 lines
const lum=c=>{const m=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2]};
const b=await launch(bin);let runs=0;
try{for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420])for(const forcedColors of [false,true]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 const config=chatConfig(3,{fileAttach:true,activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{tasks:[],sources:[]}:undefined});
 const file={path:'메모.md',bytes:2048,text:'자료'};
 await b.load(`<!doctype html><html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div class="${seat==='personal'?'tw-workspace':''}" style="display:block;height:900px"><div id="root"></div></div><script>window.file=${JSON.stringify(file)};window.sent=0;window.fixture=${JSON.stringify(chatPanelProps({config,messages:[]})).replaceAll('<','\\u003c')};window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${js.outputFiles[0].text}</script></body></html>`,{width,height:1000,dark,forcedColors});await pause();
 const prevented=await b.evaluate(`(()=>{const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});e.clipboardData.setData('text/plain',${JSON.stringify(pasted)});document.querySelector('.hps-input textarea').dispatchEvent(e);return e.defaultPrevented})()`);await pause();
 assert.equal(prevented,true,'a 121-line paste folds into a chip');
 const tag=`${seat} ${width} ${dark?'dark':'light'}${forcedColors?' forced':''}`;
 const chip=await b.evaluate(`(()=>{const c=document.querySelector('.hps-pasted-chip'),f=document.querySelector('[data-testid="file-attachment"]');const toggle=c.querySelector('.hps-pasted-toggle'),rm=c.querySelector('.hps-file-context-remove'),fname=f.querySelector('.hps-file-context-name'),frm=f.querySelector('.hps-file-context-remove');const st=(el,ks)=>Object.fromEntries(ks.map(k=>[k,getComputedStyle(el)[k]]));const keys=['fontSize','fontFamily','borderTopWidth','borderTopStyle','borderTopColor','color','backgroundColor'];const box=el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,r:r.right}};return {family:c.classList.contains('hps-file-context'),role:c.getAttribute('role'),label:toggle.querySelector('span').textContent,labelClipped:toggle.querySelector('span').scrollWidth>toggle.querySelector('span').clientWidth+0.5||toggle.querySelector('span').getBoundingClientRect().right>toggle.getBoundingClientRect().right+0.5,expanded:toggle.getAttribute('aria-expanded'),icon:!!toggle.querySelector('svg[data-icon="copy"][aria-hidden="true"]'),close:!!rm.querySelector('svg[data-icon="close"]'),rmLabel:rm.getAttribute('aria-label'),rmText:rm.textContent,toggleStyle:st(toggle,keys),fileStyle:st(fname,keys),rmStyle:st(rm,keys),fileRmStyle:st(frm,keys),rmBox:box(rm),fileRmBox:box(frm),buttons:[...c.querySelectorAll('button')].map(x=>({...box(x),font:parseFloat(getComputedStyle(x).fontSize)})),chipScroll:c.scrollWidth,chipClient:c.clientWidth,pageWidth:document.documentElement.scrollWidth,cardHeight:document.querySelector('.hps-input').getBoundingClientRect().height}})()`);
 assert.ok(chip.family&&chip.role==='group',`chip uses the D06 family class: ${tag}`);
 assert.equal(chip.label,'붙여넣은 글 · 121줄',`label: ${tag}`);assert.equal(chip.labelClipped,false,`the line count stays visible, never ellipsized: ${tag}`);assert.equal(chip.expanded,'false');
 assert.ok(chip.icon&&chip.close,`decorative icon and close glyph are ChatIcons: ${tag}`);assert.equal(chip.rmLabel,'붙여넣은 글 빼기');assert.equal(chip.rmText,'','× is an icon, not a text glyph');
 assert.deepEqual(chip.toggleStyle,chip.fileStyle,`label button matches the file chip name button: ${tag}`);
 assert.deepEqual(chip.rmStyle,chip.fileRmStyle,`× matches the file chip ×: ${tag}`);
 assert.ok(Math.abs(chip.rmBox.w-chip.fileRmBox.w)<0.5&&Math.abs(chip.rmBox.h-chip.fileRmBox.h)<0.5&&chip.rmBox.w>=44&&chip.rmBox.h>=44,`× is the same 44px target: ${JSON.stringify(chip.rmBox)}`);
 for(const x of chip.buttons){assert.ok(x.w>=44&&x.h>=44,`44px target ${JSON.stringify(x)} ${tag}`);assert.ok(x.font>=14,`>=14px text ${x.font} ${tag}`);assert.ok(x.l>=-0.5&&x.r<=width+0.5,`inside viewport ${tag}`);}
 assert.ok(chip.pageWidth<=width+1&&chip.chipScroll<=chip.chipClient+1,`no horizontal overflow: ${tag}`);
 assert.ok(chip.cardHeight<=193,`composer card keeps its 192px cap: ${chip.cardHeight}`);
 const ink=await b.evaluate(`(()=>{const c=document.querySelector('.hps-pasted-chip');const probe=document.createElement('i');probe.style.background='Canvas';document.body.appendChild(probe);const canvas=getComputedStyle(probe).backgroundColor;probe.remove();const bgOf=el=>{for(let n=el;n;n=n.parentElement){const k=getComputedStyle(n).backgroundColor;if(k&&!/^rgba\\(.*, 0\\)$|^transparent$/.test(k))return k}return canvas};return [c.querySelector('.hps-pasted-toggle span'),c.querySelector('.hps-pasted-inline'),c.querySelector('.hps-file-context-remove svg')].map(el=>({color:getComputedStyle(el).color,bg:bgOf(el)}))})()`);
 for(const l of ink){const [hi,lo]=[lum(l.color),lum(l.bg)].sort((x,y)=>y-x);assert.ok((hi+0.05)/(lo+0.05)>=(forcedColors?7:4.5),`chip text contrast ${l.color} on ${l.bg} ${tag}`);}
 const ring=await b.focusVisibleStyle('.hps-pasted-chip .hps-file-context-remove');assert.ok(parseFloat(ring['outline-width'])>0&&ring['outline-style']!=='none',`× focus ring ${tag}`);
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/chip-${seat}-${width}-${dark?'dark':'light'}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 await b.evaluate(`document.querySelector('.hps-pasted-toggle').click()`);await pause(200);
 const ed=await b.evaluate(`(()=>{const c=document.querySelector('.hps-pasted-chip'),t=c.querySelector('.hps-pasted-editor'),r=t.getBoundingClientRect(),cr=c.getBoundingClientRect(),list=document.querySelector('.hps-pasted-list'),lr=list.getBoundingClientRect();const before=t.scrollTop;t.scrollTop=120;const moved=t.scrollTop>before;t.scrollTop=0;return {expanded:c.querySelector('.hps-pasted-toggle').getAttribute('aria-expanded'),inChip:c.contains(t),focused:document.activeElement===t,h:r.height,w:r.width,top:r.top,chipLeft:cr.left,chipRight:cr.right,l:r.left,rr:r.right,scroll:t.scrollHeight,client:t.clientHeight,overflowY:getComputedStyle(t).overflowY,moved,value:t.value,font:parseFloat(getComputedStyle(t).fontSize),listTop:lr.top,listBottom:lr.bottom,pageWidth:document.documentElement.scrollWidth,cardHeight:document.querySelector('.hps-input').getBoundingClientRect().height}})()`);
 assert.equal(ed.expanded,'true');assert.ok(ed.inChip,'editor is inline inside the chip');assert.ok(ed.focused,'expand moves focus into the editor');
 assert.equal(ed.value,pasted,'the editor holds the exact pasted text');
 assert.ok(ed.h<=240.5,`editor stops at 240px: ${ed.h} ${tag}`);assert.ok(ed.h>=200,`a 121-line paste fills the 240px editor: ${ed.h} ${tag}`);
 assert.ok(['auto','scroll'].includes(ed.overflowY)&&ed.scroll>ed.client&&ed.moved,`editor scrolls on its own: ${JSON.stringify(ed)}`);
 assert.ok(ed.l>=ed.chipLeft-0.5&&ed.rr<=ed.chipRight+0.5&&ed.pageWidth<=width+1,`editor fits the chip and viewport: ${tag}`);
 assert.ok(ed.font>=14,`editor text ${ed.font}px`);assert.ok(ed.cardHeight<=193,`expanded paste does not grow the composer card: ${ed.cardHeight}`);
 if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/expanded-${seat}-${width}-${dark?'dark':'light'}-${forcedColors?'forced':'normal'}.png`,Buffer.from(shot.data,'base64'));}
 assert.equal(await b.evaluate('window.sent'),0,'nothing is sent');
 runs++;console.log('PASS',tag);
}}finally{await b.close()}
assert.equal(runs,24);
console.log('PASS paste chip: D06 family, "붙여넣은 글 · N줄", 44px ×, inline 240px self-scrolling editor (24 states)');
