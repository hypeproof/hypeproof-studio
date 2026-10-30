import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chatConfig} from './sx-screen-fixtures.mjs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'probe-assets',write:false,metafile:true,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,js=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const bin=findChromium();assert.ok(bin,'Chromium required');const b=await launch(bin);
const evidence=process.env.ACCESS_EVIDENCE??mkdtempSync(path.join(tmpdir(),'send-contrast-'));mkdirSync(evidence,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
writeFileSync(`${evidence}/app.js`,js);writeFileSync(`${evidence}/app.css`,css);
writeFileSync(`${evidence}/runtime.json`,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,browser:await b.send('Browser.getVersion'),binary:bin,js:hash(js),css:hash(css),inputs:Object.fromEntries(Object.keys(app.metafile.inputs).map(f=>[path.resolve(f),hash(readFileSync(f))]))},null,2));
const settle=()=>new Promise(r=>setTimeout(r,100));
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle()};
const workspace={scope:'access-test',revision:1,activeTaskId:'t1',sourceSelection:null,tasks:[{id:'t1',title:'고양이 페이지',createdAt:1,updatedAt:1,messageCount:1},{id:'t2',title:'다른 작업',createdAt:1,updatedAt:1,messageCount:0}]};
const config=chatConfig(3,{activity:{...chatConfig().activity,id:'access-test',kind:'personal'},profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},taskWorkspace:workspace});

const results=[];
const ratio=(a,b)=>{const lum=c=>{const x=c.slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4});return x[0]*0.2126+x[1]*0.7152+x[2]*0.0722};const l=[lum(a),lum(b)].sort((a,b)=>b-a);return(l[0]+0.05)/(l[1]+0.05)};
try{
for(const dark of [true,false])for(const personal of [true,false])for(const forced of [false,true]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}.hps-btn-send:hover,.hps-msg-run:hover{--probe-hover:yes}.hps-btn-send:active,.hps-msg-run:active{--probe-active:yes}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}})</script><script>${js}</script>`,{width:personal?390:1420,height:1600,dark});
 await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:forced?'active':'none'},{name:'prefers-color-scheme',value:dark?'dark':'light'}]});
 await settle();await send({type:'config',config:personal?config:chatConfig()});
 await send({type:'history',messages:[{id:'a',role:'assistant',content:'```html\n<!doctype html><html><body><h1>미리보기</h1></body></html>\n```',createdAt:1}]});
 await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.insertText',{text:'이 페이지를 확인해 주세요'});await settle();
 for(const selector of ['.hps-btn-send',...(personal?[]:['.hps-msg-run'])]){
 for(const state of ['normal','hover','pressed','keyboard']){
 await b.evaluate(`document.querySelector('${selector}').scrollIntoView({block:'nearest'})`);
 await settle();
 const rect=await b.evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const {root}=await b.send('DOM.getDocument',{depth:0});
 const {nodeId}=await b.send('DOM.querySelector',{nodeId:root.nodeId,selector});
 await b.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:state==='hover'?['hover']:state==='pressed'?['hover','active']:[]});
 if(state==='keyboard'){
 for(let i=0;i<80;i++){
 await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 if(await b.evaluate(`document.activeElement===document.querySelector('${selector}')`))break;
 }
 assert.ok(await b.evaluate(`document.activeElement===document.querySelector('${selector}')`),'Tab reaches target');
 }
 await settle();
 const m=await b.evaluate(String.raw`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const rgba=s=>{const values=(s.match(/[\d.]+/g)||[]).map(Number);if(s.startsWith('color(srgb '))return values.map((v,i)=>i<3?v*255:v);if(s.startsWith('rgb'))return values;throw Error('Unsupported computed color '+s)};const over=(a,b)=>{const t=a[3]??1;return a.slice(0,3).map((v,i)=>v*t+b[i]*(1-t))};const surface=n=>{if(!n)return [255,255,255];const st=getComputedStyle(n);let bg=over(rgba(st.backgroundColor),surface(n.parentElement));if(st.backgroundImage!=='none'){const stops=st.backgroundImage.match(/rgba?\([^)]+\)/g)||[];if(stops.length!==2||stops[0]!==stops[1])throw Error('Unsupported gradient '+st.backgroundImage);bg=over(rgba(stops[0]),bg)}return bg};const cs=getComputedStyle(e),bg=surface(e),adjacent=surface(e.parentElement),r=e.getBoundingClientRect();return{hover:cs.getPropertyValue('--probe-hover').trim()==='yes',active:cs.getPropertyValue('--probe-active').trim()==='yes',focusVisible:e.matches(':focus-visible'),outline:cs.outline,backgroundImage:cs.backgroundImage,rawColor:cs.color,rawBackground:cs.backgroundColor,ancestorOpacity:[...function*(n){while(n){yield getComputedStyle(n).opacity;n=n.parentElement}}(e)],color:over(rgba(cs.color),bg),bg,adjacent,border:over(rgba(cs.borderTopColor),adjacent),borderWidth:cs.borderTopWidth,text:e.textContent.trim(),disabled:e.disabled,opacity:cs.opacity,visible:r.width>0&&r.height>0}})()`);
 assert.ok(m&&m.visible&&!m.disabled,'measure enabled visible control '+selector);assert.equal(m.opacity,'1','enabled control opacity');
 const foreground=ratio(m.color,m.bg),boundary=Math.max(ratio(m.bg,m.adjacent),parseFloat(m.borderWidth)>0?ratio(m.border,m.adjacent):1);
 assert.ok(Number.isFinite(foreground)&&Number.isFinite(boundary),'computed ratios must be finite');
 const hit=await b.evaluate(`document.elementFromPoint(${rect.x},${rect.y})?.outerHTML`);
 const reachable=await b.evaluate(`document.querySelector('${selector}').contains(document.elementFromPoint(${rect.x},${rect.y}))`);
 assert.ok(reachable,'control center must not be occluded: '+selector);
 results.push({width:personal?390:1420,height:1600,reachable,inputMethod:state==='keyboard'?'CDP Tab input':state==='normal'?'unforced CSS':'CDP forced CSS pseudo state',dark,personal,forced,state,selector,rect,hit,...m,foreground,boundary,required:m.text?4.5:3});

 assert.ok(m.ancestorOpacity.every(v=>v==='1'),'opacity composition assumption');
 writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));
 writeFileSync(`${evidence}/${dark?'dark':'light'}-${personal?'personal':'classroom'}-${forced}-${selector.slice(1)}-${state}.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.ok(state==='normal'||(state==='hover'?m.hover:state==='pressed'?m.active:m.focusVisible),'applied CSS state '+state);
 await b.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
 }
 }
 writeFileSync(`${evidence}/${dark?'dark':'light'}-${personal?'personal':'classroom'}.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
}
writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
assert.ok(results.every(r=>r.foreground>=r.required&&r.boundary>=3),'enabled button foreground and boundary contrast');
console.log('PASS normal/forced CSS hover/pressed and actual Tab contrast, hit-test visible, sRGB alpha composed');
}finally{await b.close()}
