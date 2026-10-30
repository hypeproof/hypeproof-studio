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
const evidence=process.env.ACCESS_EVIDENCE??mkdtempSync(path.join(tmpdir(),'task-rename-layout-'));mkdirSync(evidence,{recursive:true});
const settle=()=>new Promise(r=>setTimeout(r,100));
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle()};
const workspace={scope:'access-test',revision:1,activeTaskId:'t1',sourceSelection:null,tasks:[{id:'t1',title:'이미 하고 있는 작업의 이름을 길게 바꾸어 봅니다',createdAt:1,updatedAt:1,messageCount:1},{id:'t2',title:'다른 작업',createdAt:1,updatedAt:1,messageCount:0}]};
const config=chatConfig(3,{activity:{...chatConfig().activity,id:'access-test',kind:'personal',name:'내 삶에 AI 더하기',free:true,trial:{request_limit:10,requests_used:10,state:'exhausted'}},profile:{...chatConfig().profile,lesson:null,activity_kind:'personal'},taskWorkspace:workspace});

const results=[];
const click=async sel=>{const p=await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await b.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await settle()};
try{
for(const dark of [true,false])for(const width of [320,390,500,700,800]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}})</script><script>${js}</script>`,{width,height:900,dark});
 await settle();await send({type:'config',config});await send({type:'history',messages:[]});
 const before=await b.evaluate(`document.querySelector('.tw-heading').getBoundingClientRect().height`);
 await b.evaluate(`document.querySelector('.tw-title-button').click()`);await settle();
 const geometry=await b.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};const input=document.querySelector('.tw-rename input'),buttons=[...document.querySelectorAll('.tw-rename button')];return{heading:rect(document.querySelector('.tw-heading')),input:rect(input),buttons:buttons.map(rect),title:input.value,headerText:document.querySelector('.tw-heading').textContent,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
 const hits=await b.evaluate(`[...document.querySelectorAll('.tw-rename button')].map(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})`);
 const usable=geometry.input.width>=160&&Math.abs(geometry.buttons[0].y-geometry.buttons[1].y)<2&&geometry.buttons.every(r=>r.right<=width&&r.x>=0)&&geometry.heading.height<=before+52&&!geometry.overflow;
 results.push({width,dark,before,geometry,hits,usable});
 writeFileSync(`${evidence}/${dark?'dark':'light'}-${width}.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await click('.tw-rename button[type=button]');
 assert.ok(await b.evaluate(`!!document.querySelector('.tw-title-button')`),'cancel restores normal header');
 assert.equal(await b.evaluate(`posted.filter(m=>m.type==='taskRename').length`),0,'cancel sends no rename');
 await click('.tw-title-button');
 await b.evaluate(`document.querySelector('.tw-rename input').select()`);
 await b.send('Input.insertText',{text:'새 작업 이름'});await settle();
 await click('.tw-rename button:not([type])');
 const saved=await b.evaluate(`posted.filter(m=>m.type==='taskRename').at(-1)`);
 assert.equal(saved?.title,'새 작업 이름','pointer save submits edited title');
 assert.ok(saved.requestId,'rename request has identity');
 results.at(-1).pointerSave=true;

}
writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
assert.ok(results.every(r=>r.usable&&r.hits.every(Boolean)),'rename needs >=160px editable input, aligned save/cancel, <=one extra row and no horizontal overflow');
console.log('PASS full App rename geometry and pointer hit targets');
}finally{await b.close()}
