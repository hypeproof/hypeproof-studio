import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
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

const hash=x=>createHash('sha256').update(x).digest('hex');
writeFileSync(`${evidence}/bundle.js`,js);writeFileSync(`${evidence}/bundle.css`,css);
writeFileSync(`${evidence}/runtime.json`,JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,nodePath:process.execPath,nodeSHA256:hash(readFileSync(process.execPath)),chromium:bin,chromiumSHA256:hash(readFileSync(bin)),jsSHA256:hash(js),cssSHA256:hash(css)},null,2));
const results=[];
const click=async sel=>{const p=await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await b.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await settle()};
try{
for(const dark of [true,false])for(const forced of [false,true])for(const width of [320,800]){
 const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
 await b.load(`<html style="${vars}"><style>${css}</style><style>html,body,#root{height:100%}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>posted.push(m),getState:()=>({}),setState:()=>{}})</script><script>${js}</script>`,{width,height:900,dark});
 await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:forced?'active':'none'}]});
 await settle();await send({type:'config',config});await send({type:'history',messages:[]});
 const before=await b.evaluate(`document.querySelector('.tw-heading').getBoundingClientRect().height`);
 await b.evaluate(`document.querySelector('.tw-title-button').click()`);await settle();
 const geometry=await b.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};const input=document.querySelector('.tw-rename input'),buttons=[...document.querySelectorAll('.tw-rename button')];return{heading:rect(document.querySelector('.tw-heading')),input:rect(input),buttons:buttons.map(rect),title:input.value,headerText:document.querySelector('.tw-heading').textContent,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
 const hits=await b.evaluate(`[...document.querySelectorAll('.tw-rename button')].map(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})`);
 const usable=geometry.input.width>=160&&Math.abs(geometry.buttons[0].y-geometry.buttons[1].y)<2&&geometry.buttons.every(r=>r.right<=width&&r.x>=0)&&geometry.heading.height<=before+52&&!geometry.overflow;
 results.push({width,dark,forced,before,geometry,hits,usable});
 writeFileSync(`${evidence}/${dark?'dark':'light'}-${forced?'forced':'normal'}-${width}.png`,Buffer.from((await b.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 const key=async(key,code,n,text)=>{await b.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:n,...(text?{text}:{})});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n});await settle()};
 await key('Escape','Escape',27);
 assert.ok(await b.evaluate(`document.activeElement===document.querySelector('.tw-title-button')`),'Escape restores title focus');
 assert.equal(await b.evaluate(`posted.filter(m=>m.type==='taskRename').length`),0);
 await key('Enter','Enter',13,'\r');
 assert.ok(await b.evaluate(`document.activeElement===document.querySelector('.tw-rename input')`),'keyboard opens editor and focuses input');
 await b.evaluate(`document.querySelector('.tw-rename input').select()`);
 await b.send('Input.insertText',{text:'키보드 이름'});await settle();
 await key('Tab','Tab',9);
 const focus=await b.evaluate(`(()=>{const e=document.activeElement,s=getComputedStyle(e);return {text:e.textContent,outline:s.outlineStyle,width:s.outlineWidth,visible:e.matches(':focus-visible')}})()`);
 assert.equal(focus.text,'저장');assert.ok(focus.visible&&focus.outline!=='none'&&focus.width!=='0px','keyboard Save has focus cue');
 await key('Enter','Enter',13,'\r');
 const request=await b.evaluate(`posted.filter(m=>m.type==='taskRename').at(-1)`);assert.equal(request.title,'키보드 이름');
 assert.ok(await b.evaluate(`document.activeElement===document.querySelector('.tw-rename button[aria-busy=true]')`),'pending Save retains focus');
 await key('Enter','Enter',13,'\r');
 assert.equal(await b.evaluate(`posted.filter(m=>m.type==='taskRename').length`),1,'pending Save does not duplicate request');
 await send({type:'taskRenameResult',requestId:'unrelated',saved:true});
 assert.ok(await b.evaluate(`document.querySelector('.tw-rename input').readOnly`),'foreign ack cannot finish pending save');
 await send({type:'taskRenameResult',requestId:request.requestId,saved:false});
 assert.equal(await b.evaluate(`document.querySelector('.tw-rename input').value`),'키보드 이름','refusal retains draft');
 const refusalFocus=await b.evaluate(`({onInput:document.activeElement===document.querySelector('.tw-rename input'),tag:document.activeElement?.tagName,className:document.activeElement?.className})`);
 assert.ok(refusalFocus.onInput,'refusal restores input focus without diagnostic intervention');
 await key('Enter','Enter',13,'\r');
 const retry=await b.evaluate(`posted.filter(m=>m.type==='taskRename').at(-1)`);assert.notEqual(retry.requestId,request.requestId);
 await send({type:'taskRenameResult',requestId:retry.requestId,saved:true});
 assert.ok(await b.evaluate(`!document.querySelector('.tw-rename')&&document.activeElement===document.querySelector('.tw-title-button')`),'matching saved ack closes and restores title focus');
 const restored=await b.evaluate(`document.querySelector('.tw-heading').getBoundingClientRect().height`);assert.equal(restored,before,'normal header layout restored');
 results.at(-1).keyboard={refusalFocus,foreignAckIgnored:true,refusalRetained:true,retrySaved:true,restored};
 const ownership=[];
 for(const outcome of ['success','failure'])for(const origin of ['input','save','outside','cancel','scope']){
  await b.evaluate(`document.querySelector('.tw-title-button').click()`);await settle();
  await b.evaluate(`document.querySelector('.tw-rename input').select()`);await b.send('Input.insertText',{text:'소유권 '+origin});await settle();
  if(origin!=='input')await key('Tab','Tab',9);
  await key('Enter','Enter',13,'\r');
  const pending=await b.evaluate(`posted.filter(m=>m.type==='taskRename').at(-1)`);
  if(origin==='outside')await b.evaluate(`(()=>{const e=document.createElement('button');e.id='external-focus';e.textContent='external focus fixture';document.body.appendChild(e);e.focus()})()`);
  if(origin==='cancel')await click('.tw-rename button[type=button]');
  if(origin==='scope')await send({type:'config',config:{...config,taskWorkspace:{...workspace,scope:'other-scope',activeTaskId:'t2',revision:2}}});
  const beforeAck=await b.evaluate(`({tag:document.activeElement?.tagName,cls:document.activeElement?.className})`);
  await send({type:'taskRenameResult',requestId:pending.requestId,saved:outcome==='success'});
  const after=await b.evaluate(`({tag:document.activeElement?.tagName,cls:document.activeElement?.className,input:document.activeElement===document.querySelector('.tw-rename input'),title:document.activeElement===document.querySelector('.tw-title-button'),editing:!!document.querySelector('.tw-rename')})`);
  if(origin==='outside'){assert.equal(await b.evaluate(`document.activeElement?.id`),'external-focus');await b.evaluate(`document.getElementById('external-focus').remove()`);assert.equal(after.cls,beforeAck.cls,'external focus is not stolen');assert.equal(after.tag,beforeAck.tag);}
  else if(origin==='cancel'||origin==='scope'){assert.equal(after.editing,false,'late ack cannot reopen cancelled/changed editor');}
  else assert.ok(outcome==='success'?after.title:after.input,origin+' response restores appropriate focus');
  ownership.push({outcome,origin,beforeAck,after});
  if(after.editing){await b.evaluate(`document.querySelector('.tw-rename button[type=button]').click()`);await settle()}
  if(origin==='scope')await send({type:'config',config});
 }
 results.at(-1).ownership=ownership;


}
writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
assert.ok(results.every(r=>r.usable&&r.hits.every(Boolean)),'rename needs >=160px editable input, aligned save/cancel, <=one extra row and no horizontal overflow');
assert.ok(results.every(r=>r.keyboard.refusalFocus.onInput),'refusal must return keyboard focus to the retained title input');
console.log('PASS keyboard lifecycle and forced-colors');
}finally{await b.close()}
