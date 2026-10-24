import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chatConfig} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const asset=await build({entryPoints:[root+'/webview-ui/src/main.tsx'],bundle:true,write:false,outdir:'out',format:'iife',loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=asset.outputFiles.find(f=>f.path.endsWith('.css')).text,js=asset.outputFiles.find(f=>f.path.endsWith('.js')).text;
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN annotation leave: Chromium missing');process.exit(0);}
const browser=await launch(bin),evidence=process.env.ANNOTATION_LEAVE_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
const delay=(ms=100)=>new Promise(r=>setTimeout(r,ms));
const key=async(key,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await browser.send('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:{Tab:9,Escape:27,Enter:13}[key],modifiers,...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})});};
try{
for(const seat of ['personal','classroom'])for(const dark of [false,true])for(const width of [320,800,1420]){
 const config=chatConfig(3,{profile:{...chatConfig().profile,lesson:null,activity_kind:seat},activity:{id:'a1',name:'작업',kind:seat,workspace:'/w',verified:true},...(seat==='personal'?{taskWorkspace:{scope:'a',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}}:{})});
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await browser.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}});</script><script>${js}</script></body></html>`,{width,height:800,dark});await delay();
 await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}))`);await delay();
 const open=async id=>{await browser.evaluate(`posted.length=0;window.dispatchEvent(new MessageEvent('message',{data:{type:'annotationLeavePrompt',prompt:{id:${JSON.stringify(id)},count:10}}}))`);await delay();};
 const answered=async(id,discard)=>{await delay(250);assert.deepEqual(await browser.evaluate(`posted.filter(m=>m.type==='annotationLeaveAnswer')`),[{type:'annotationLeaveAnswer',id,discard,activityId:'a1',...(seat==='personal'?{taskId:'t1'}:{})}]);assert.equal(await browser.evaluate(`!!document.querySelector('.hps-annotation-leave')`),false);};
 await open('enter');
 const m=await browser.evaluate(`(()=>{const d=document.querySelector('.hps-annotation-leave');if(!d)return {found:false};const h=d.querySelector('h2'),r=d.getBoundingClientRect();return{found:true,modal:d.matches(':modal'),buttons:[...d.querySelectorAll('button')].map(b=>({label:b.textContent,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,font:parseFloat(getComputedStyle(b).fontSize)})),focus:document.activeElement.textContent,lines:h.getBoundingClientRect().height/parseFloat(getComputedStyle(h).lineHeight),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:d.scrollWidth>d.clientWidth}})()`);
 assert.equal(m.found,true);assert.equal(m.modal,true);assert.equal(m.focus,'계속 고치기');assert.ok(m.lines<=2.05);assert.equal(m.fits,true);assert.equal(m.overflow,false);assert.deepEqual(m.buttons.map(b=>b.label),['계속 고치기','버리기']);assert.ok(m.buttons.every(b=>b.w>=44&&b.h>=44&&b.font>=14));
 await key('Tab');assert.equal(await browser.evaluate('document.activeElement.textContent'),'버리기');await key('Tab');assert.equal(await browser.evaluate('document.activeElement.textContent'),'계속 고치기');assert.ok(await browser.evaluate('parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2'));
 if(width===320){await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]});assert.ok(await browser.evaluate('parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2'));await browser.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'}]});}
 await delay(250);assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.hps-annotation-leave')).opacity`),'1');
 if(evidence){const shot=await browser.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));}
 await key('Enter');await answered('enter',false);
 await open('esc');await key('Escape');await answered('esc',false);
 await open('backdrop');for(const type of ['mousePressed','mouseReleased'])await browser.send('Input.dispatchMouseEvent',{type,x:1,y:1,button:'left',clickCount:1});await answered('backdrop',false);
 await open('ime');await browser.evaluate(`(()=>{const d=document.querySelector('.hps-annotation-leave');d.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));d.dispatchEvent(new Event('cancel',{cancelable:true}));})()`);await delay(300);assert.equal(await browser.evaluate(`posted.filter(m=>m.type==='annotationLeaveAnswer').length`),0);await browser.evaluate(`document.querySelector('.hps-annotation-leave').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);await key('Escape');await answered('ime',false);
 await open('discard');await browser.evaluate(`document.querySelectorAll('.hps-annotation-leave button')[1].click();document.querySelectorAll('.hps-annotation-leave button')[1].click()`);await answered('discard',true);
}
console.log('PASS annotation leave App: 12 seat/theme/width cases, two-line title, targets, focus/Tab, Enter/Esc/backdrop keep, explicit discard once');
}finally{await browser.close();}
