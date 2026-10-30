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
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'probe-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,js=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const bin=findChromium();assert.ok(bin,'Chromium required');const b=await launch(bin);
const evidence=process.env.ACCESS_EVIDENCE??mkdtempSync(path.join(tmpdir(),'send-contrast-'));mkdirSync(evidence,{recursive:true});
const settle=()=>new Promise(r=>setTimeout(r,100));
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle()};
const workspace={scope:'access-test',revision:1,activeTaskId:'t1',sourceSelection:null,tasks:[{id:'t1',title:'고양이 페이지',createdAt:1,updatedAt:1,messageCount:1},{id:'t2',title:'다른 작업',createdAt:1,updatedAt:1,messageCount:0}]};
const config=chatConfig(3,{activity:{...chatConfig().activity,id:'access-test',kind:'personal'},profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},taskWorkspace:workspace});

const results=[];
const ratio=(a,b)=>{const lum=c=>{const x=c.slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4});return x[0]*0.2126+x[1]*0.7152+x[2]*0.0722};const l=[lum(a),lum(b)].sort((a,b)=>b-a);return(l[0]+0.05)/(l[1]+0.05)};
try{
for(const dark of [true,false])for(const personal of [true,false]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}})</script><script>${js}</script>`,{width:1420,height:900,dark});
 await settle();await send({type:'config',config:personal?config:chatConfig()});
 await send({type:'history',messages:[{id:'a',role:'assistant',content:'```html\n<!doctype html><html><body><h1>미리보기</h1></body></html>\n```',createdAt:1}]});
 await b.evaluate(`document.querySelector('.hps-input textarea').focus()`);await b.send('Input.insertText',{text:'이 페이지를 확인해 주세요'});await settle();
 for(const selector of ['.hps-btn-send',...(personal?[]:['.hps-msg-run'])]){
 const m=await b.evaluate(String.raw`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const rgba=s=>(s.match(/[\d.]+/g)||[]).map(Number);const over=(a,b)=>{const t=a[3]??1;return a.slice(0,3).map((v,i)=>v*t+b[i]*(1-t))};const surface=n=>{if(!n)return [255,255,255];return over(rgba(getComputedStyle(n).backgroundColor),surface(n.parentElement))};const cs=getComputedStyle(e),bg=surface(e),adjacent=surface(e.parentElement),r=e.getBoundingClientRect();return{color:over(rgba(cs.color),bg),bg,adjacent,border:over(rgba(cs.borderTopColor),adjacent),borderWidth:cs.borderTopWidth,text:e.textContent.trim(),disabled:e.disabled,opacity:cs.opacity,visible:r.width>0&&r.height>0}})()`);
 assert.ok(m&&m.visible&&!m.disabled,'measure enabled visible control '+selector);assert.equal(m.opacity,'1','enabled control opacity');
 const foreground=ratio(m.color,m.bg),boundary=Math.max(ratio(m.bg,m.adjacent),parseFloat(m.borderWidth)>0?ratio(m.border,m.adjacent):1);
 assert.ok(Number.isFinite(foreground)&&Number.isFinite(boundary),'computed ratios must be finite');
 results.push({dark,personal,selector,...m,foreground,boundary,required:m.text?4.5:3});
 }
 writeFileSync(`${evidence}/${dark?'dark':'light'}-${personal?'personal':'classroom'}.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
}
writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
assert.ok(results.every(r=>r.foreground>=r.required&&r.boundary>=3),'enabled button foreground and boundary contrast');
console.log('PASS actual enabled control contrast');
}finally{await b.close()}
