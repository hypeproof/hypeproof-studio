// CGP-CHAT-R-004 / CGP-CHAT-D-004 — "먼저 계획 보기" on the real App in headless Chromium: the chip (aria-pressed,
// posts the switch), the plan card (named region, numbered steps, 이대로 진행 / 수정 / 다시 계획 / 그만두기 each
// posting the learner's decision), the send button reading "계획 승인 기다리는 중" and disabled while the plan waits,
// the card hidden while a turn runs; computed geometry for personal and classroom seats, dark and light, at 320,
// 480 and 800 px: no horizontal scroll, no overlapping controls, 44px targets, >= 14px text, card above the composer.
// Not run without Chromium (FOCUS_REQUIRE_BROWSER=1 makes that a failure).
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();
if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN plan-first layout: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'plan-first-assets',write:false,loader:{'.svg':'dataurl','.png':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,script=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const b=await launch(bin);
const settle=(ms=80)=>new Promise(r=>setTimeout(r,ms));
const send=async data=>{await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle();};
const shim=`window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});`;
const page=(vars,dark)=>`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>${shim}</script><script>${script.replaceAll('</script','<\\/script')}</script></body></html>`;
const workspace={scope:'plan-first',revision:1,activeTaskId:'task',tasks:[{id:'task',title:'고양이 페이지',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null};
const configFor=seat=>chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?workspace:undefined,access:seat==='classroom'?{status:'unavailable'}:undefined});
const posts=async()=>JSON.parse(await b.evaluate('JSON.stringify(window.__posts)'));
const lastPost=async type=>(await posts()).filter(m=>m.type===type).at(-1);
const vars=theme=>Object.entries(THEMES[theme]).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
const PLAN={id:'p1',text:'1. 고양이 사진을 넣을 index.html 파일을 새로 만들어요\n2. 제목과 소개 글을 한국어로 써요\n3. 미리보기에서 눈으로 확인해 보고 어색한 곳을 알려 드려요'};
const open=async(seat,{dark=true,width=800}={})=>{await b.send('Page.navigate',{url:'about:blank'});await b.load(page(vars(dark?'Dark+':'Light+'),dark),{width,height:900,dark});await send({type:'config',config:configFor(seat)});await send({type:'history',messages:[]});};
const clickText=async t=>{await b.evaluate(`[...document.querySelectorAll('.hps-plan-card button')].find(e=>e.textContent==${JSON.stringify(t)}).click()`);await settle();};
const click=async sel=>{await b.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);await settle();};
const geometry=()=>b.evaluate(`(()=>{
  const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:r.width,h:r.height};};
  const card=document.querySelector('.hps-plan-card'),input=document.querySelector('.hps-input');
  const controls=[...document.querySelectorAll('.hps-plan-card button,.hps-plan-card textarea,.hps-selected-plan,.hps-plan-chip,.hps-input button,.hps-input textarea')].filter(vis).map(e=>({name:(e.getAttribute('aria-label')||e.textContent||e.className).trim().slice(0,24),...rect(e)}));
  const texts=[...card.querySelectorAll('h2,li,p,button,textarea')].filter(vis).map(e=>({t:e.textContent.slice(0,20),px:parseFloat(getComputedStyle(e).fontSize)}));
  return {scrollW:document.documentElement.scrollWidth,innerW:innerWidth,card:rect(card),input:rect(input),controls,texts,
    buttons:[...card.querySelectorAll('button')].filter(vis).map(e=>({name:e.textContent,...rect(e)})),
    chip:(()=>{const c=document.querySelector('.hps-plan-chip');return c&&{...rect(c),px:parseFloat(getComputedStyle(c).fontSize)};})()}})()`);
const overlap=(a,c)=>a.left<c.right-.5&&c.left<a.right-.5&&a.top<c.bottom-.5&&c.top<a.bottom-.5;
let cases=0;
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,480,800]){
  const label=`${seat}/${dark?'dark':'light'}/${width}`;
  await open(seat,{dark,width});
  assert.ok(await lastPost('planFirstRequest'),`${label}: the webview asks the host for its state`);
  // Switch: a chip in the composer row on a classroom seat, an item in the tools menu on a personal seat (no extra row).
  await send({type:'planFirstState',on:false,plan:null});
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-card')`),false,`${label}: no card without a plan`);
  if(seat==='classroom'){
   assert.equal(await b.evaluate(`document.querySelector('.hps-plan-chip').getAttribute('aria-pressed')`),'false',`${label}: chip off`);
   await click('.hps-plan-chip');
  }else{
   assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-chip')`),false,`${label}: no chip row on a personal seat`);
   await click('.hps-tool-trigger');
   assert.equal(await b.evaluate(`document.querySelector('[role=menuitemcheckbox]:not([aria-disabled=true])').getAttribute('aria-checked')`),'false');
   await b.evaluate(`[...document.querySelectorAll('[role=menuitemcheckbox]')].find(e=>e.textContent.includes('계획 먼저')).click()`);await settle();
  }
  assert.deepEqual({on:(await lastPost('planFirstSet')).on},{on:true},`${label}: the switch posts`);
  await send({type:'planFirstState',on:true,plan:null});
  if(seat==='classroom')assert.equal(await b.evaluate(`document.querySelector('.hps-plan-chip').getAttribute('aria-pressed')`),'true',`${label}: chip on`);
  else assert.equal(await b.evaluate(`!!document.querySelector('.hps-selected-plan')`),true,`${label}: selected pill while on`);
  // The plan waits: the card, the disabled send button with its reason.
  await send({type:'planFirstState',on:true,plan:PLAN});
  assert.equal(await b.evaluate(`document.querySelectorAll('.hps-plan-steps li').length`),3,`${label}: three numbered steps`);
  assert.equal(await b.evaluate(`document.querySelector('.hps-plan-card').getAttribute('role')`),'region');
  const sendState=await b.evaluate(`(()=>{const s=document.querySelector('.hps-btn-send');return {disabled:s.disabled,label:s.getAttribute('aria-label')||s.textContent.trim()}})()`);
  assert.equal(sendState.disabled,true,`${label}: send disabled while the plan waits`);assert.equal(sendState.label,'계획 승인 기다리는 중',`${label}: send names the reason`);
  const g=await geometry();
  assert.ok(g.scrollW<=g.innerW,`${label}: no horizontal scroll (${g.scrollW} > ${g.innerW})`);
  assert.ok(g.card.right<=g.innerW+.5&&g.card.left>=-.5,`${label}: card inside the viewport`);
  assert.ok(g.card.bottom<=g.input.top+.5,`${label}: the card sits above the composer, not over it`);
  for(const x of g.buttons)assert.ok(x.h>=44-.5&&x.w>=44-.5,`${label}: ${x.name} is a 44px target (${x.w}x${x.h})`);
  assert.deepEqual(g.buttons.map(x=>x.name),['이대로 진행','수정','다시 계획','그만두기']);
  for(let i=0;i<g.controls.length;i++)for(let j=i+1;j<g.controls.length;j++)assert.ok(!overlap(g.controls[i],g.controls[j]),`${label}: ${g.controls[i].name} overlaps ${g.controls[j].name}`);
  for(const x of g.texts)assert.ok(x.px>=14,`${label}: "${x.t}" is ${x.px}px`);
  const sw=await b.evaluate(`(()=>{const e=document.querySelector('.hps-plan-chip')||document.querySelector('.hps-selected-plan');const r=e.getBoundingClientRect();return {h:r.height,w:r.width,px:parseFloat(getComputedStyle(e).fontSize)}})()`);
  assert.ok(sw.h>=44-.5&&sw.w>=44-.5&&sw.px>=14,`${label}: the switch is a 44px target with >= 14px text (${JSON.stringify(sw)})`);
  // Decisions post the plan id; edited text rides along.
  await clickText('수정');
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-edit')`),true,`${label}: 수정 opens the edit box`);
  await b.evaluate(`(()=>{const t=document.querySelector('.hps-plan-edit');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'1. 고친 계획');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
  await click('.hps-plan-approve');
  assert.deepEqual(await lastPost('planFirstApprove').then(m=>({planId:m.planId,text:m.text})),{planId:'p1',text:'1. 고친 계획'},`${label}: approve posts the edited text`);
  await clickText('다시 계획');assert.equal((await lastPost('planFirstRedo')).planId,'p1',`${label}: 다시 계획`);
  await clickText('그만두기');assert.equal((await lastPost('planFirstDecline')).planId,'p1',`${label}: 그만두기`);
  // Hidden while a turn runs.
  await send({type:'streamStart',streamId:'s1',messageId:'m1'});
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-card')`),false,`${label}: no card during a turn`);
  await send({type:'streamEnd',streamId:'s1',messageId:'m1'});
  cases++;
 }
 // DEC-10 — a class that switched the mode off: no chip, no menu item, no pill, one status line; absent keeps the switch.
 for(const seat of ['personal','classroom']){
  await open(seat);
  await send({type:'planFirstState',on:true,plan:null});
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-chip,.hps-selected-plan')`),true,`${seat}: the switch shows while the class has not turned it off`);
  await send({type:'planFirstState',on:false,plan:null,available:false,switchedOff:true});
  assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-chip,.hps-selected-plan,.hps-plan-card')`),false,`${seat}: switched off hides chip, pill and card`);
  assert.equal(await b.evaluate(`document.querySelector('[data-testid=plan-switched-off]')?.getAttribute('role')`),'status',`${seat}: the learner is told, as a status line`);
  assert.match(await b.evaluate(`document.querySelector('[data-testid=plan-switched-off]').textContent`),/쓰지 않아요/,`${seat}: the notice says why`);
  if(seat==='personal'){
   await click('.hps-tool-trigger');
   assert.equal(await b.evaluate(`[...document.querySelectorAll('[role=menuitemcheckbox]')].some(e=>e.textContent.includes('계획 먼저'))`),false,`${seat}: no 계획 먼저 item in the tools menu`);
   await click('.hps-tool-trigger');
  }
  await send({type:'planFirstState',on:false,plan:null,available:false});
  assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=plan-switched-off]')`),true,`${seat}: the notice stays until the task changes`);
  const g=await b.evaluate(`({scrollW:document.documentElement.scrollWidth,innerW:innerWidth})`);
  assert.ok(g.scrollW<=g.innerW,`${seat}: no horizontal scroll with the notice`);
  // The class switches it back on (the served field is gone): the switch returns, unchanged.
  await send({type:'planFirstState',on:false,plan:null});
  if(seat==='classroom')assert.equal(await b.evaluate(`!!document.querySelector('.hps-plan-chip')`),true,`${seat}: absent means the chip is back`);
  else{await click('.hps-tool-trigger');assert.equal(await b.evaluate(`[...document.querySelectorAll('[role=menuitemcheckbox]')].some(e=>e.textContent.includes('계획 먼저'))`),true,`${seat}: absent means the menu item is back`);}
  cases++;
 }
 // Without a plan the send button is the ordinary one.
 await open('personal');await send({type:'planFirstState',on:true,plan:null});
 assert.notEqual(await b.evaluate(`document.querySelector('.hps-btn-send').getAttribute('aria-label')`),'계획 승인 기다리는 중');
 console.log(`PASS plan-first actual App: ${cases} cases (chip, card, decisions, disabled send with reason, hidden during a turn, geometry at 320/480/800 both seats and themes)`);
}finally{await b.close();}
