// CGP-CHAT-R-015: actual App bridge and clock, never a timer/prose estimate.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {THEMES} from './lib/vscode-default-themes.mjs';
import {chatConfig} from './sx-screen-fixtures.mjs';
import {findChromium,launch} from './lib/headless-chromium.mjs';
const bin=findChromium();if(!bin){if(process.env.FOCUS_REQUIRE_BROWSER==='1')throw Error('Chromium required');console.log('NOT RUN elapsed App: no Chromium');process.exit(0);}
const dir=fileURLToPath(new URL('../webview-ui/',import.meta.url));
const app=await build({entryPoints:[dir+'src/main.tsx'],bundle:true,platform:'browser',format:'iife',outdir:'elapsed-assets',write:false,loader:{'.svg':'dataurl'},logLevel:'silent'});
const css=app.outputFiles.find(f=>f.path.endsWith('.css')).text,script=app.outputFiles.find(f=>f.path.endsWith('.js')).text;
const b=await launch(bin),evidence=process.env.ELAPSED_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});const settle=()=>new Promise(r=>setTimeout(r,50));
const send=async(data,clock)=>{await b.evaluate(`${clock===undefined?'':`window.__clock=${clock};`}window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`);await settle()};
const labels=()=>b.evaluate(`[...document.querySelectorAll('.hps-turn-elapsed')].map(e=>e.textContent)`);
try{
 for(const seat of ['personal','classroom'])for(const dark of [true,false])for(const width of [320,800,1420]){
  const vars=Object.entries(THEMES[dark?'Dark+':'Light+']).filter(([k,v])=>typeof v==='string'&&!['kind','file'].includes(k)).map(([k,v])=>`--vscode-${k.replaceAll('.','-')}:${v}`).join(';');
  await b.load(`<html style="${vars}"><style>${css}</style><body class="${dark?'vscode-dark':'vscode-light'}"><div id="root"></div><script>window.__clock=0;Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__clock});window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`,{width,height:1000,dark});
  const config=chatConfig(3,{activity:{...chatConfig().activity,kind:seat},profile:{...chatConfig().profile,lesson:null},taskWorkspace:seat==='personal'?{scope:'elapsed-test',revision:1,activeTaskId:'task',tasks:[{id:'task',title:'시간 확인',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}:undefined});
  await send({type:'config',config});await send({type:'history',messages:[]});assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`),seat==='personal','actual requested seat branch is mounted');
  // CGP-CHAT-D-015: secondary text at the END of the turn's status line. In personal chat the answer
  // action row is that line; with no row (classroom, no-answer stop) the receipt is the line itself.
  const placeAt=async(expectInRow)=>{const place=await b.evaluate(`[...document.querySelectorAll('.hps-turn-elapsed')].map(e=>{const row=e.closest('.hps-answer-actions'),r=e.getBoundingClientRect(),c=getComputedStyle(e),body=document.querySelector('.hps-msg-assistant .hps-msg-body');
    const kids=row?[...row.children].filter(k=>{const q=k.getBoundingClientRect();return q.width>0&&q.height>0&&k!==e}):[];const rr=row?.getBoundingClientRect();
    return {text:e.textContent,inRow:!!row,controls:row?row.querySelectorAll('button').length:0,rows:row?row.querySelectorAll('.hps-turn-elapsed').length:0,font:parseFloat(c.fontSize),color:c.color,bodyColor:body?getComputedStyle(body).color:'',weight:c.fontWeight,
      inside:rr?r.left>=rr.left-1&&r.right<=rr.right+1:true,last:kids.every(k=>{const q=k.getBoundingClientRect();return q.bottom<=r.top+1||q.right<=r.left+1}),tag:e.tagName}})`);
  assert.deepEqual(place.map(p=>p.inRow),expectInRow,`${seat}: receipts sit in the answer action row only when the row exists`);
  for(const p of place){assert.ok(p.font>=14,'receipt text >=14px');assert.notEqual(p.color,p.bodyColor,'receipt uses secondary, not answer, text colour');assert.ok(Number(p.weight)<600,'receipt is not emphasised');
    if(p.inRow){assert.equal(p.rows,1,'one receipt per row');assert.equal(p.tag,'SPAN');assert.ok(p.inside,`${width}px: receipt stays inside the row`);assert.ok(p.last,`${width}px: no control follows the receipt (same line or wrapped below)`);}}return place;};
  await send({type:'streamStart',streamId:'one',messageId:'answer'},1000);
  const dots=await b.evaluate(`[...document.querySelectorAll('.hps-response-dots i')].map(e=>{const c=getComputedStyle(e),t=v=>v.split(',').map(x=>x.trim().endsWith('ms')?parseFloat(x)/1000:parseFloat(x));const n=c.animationIterationCount==='infinite'?1e9:parseFloat(c.animationIterationCount);return t(c.animationDelay)[0]+t(c.animationDuration)[0]*n})`);
  if(seat==='personal')assert.ok(dots.length>0,'personal pending dots are on screen before the first chunk');
  for(const end of dots)assert.ok(Number.isFinite(end)&&end<=3.8+1e-6,`pending dots end by 3.8s (got ${end})`);
  await send({type:'streamChunk',streamId:'one',delta:'골라 주세요.\n1. 첫 번째\n2. 두 번째'});assert.deepEqual(await labels(),[],'running turn never predicts duration');
  // CGP-CHAT-D-015: no live ticking counter. Advancing the clock mid-run changes no visible text,
  // and nothing time-shaped appears (the dots rule is measured above).
  const runText=()=>b.evaluate(`document.querySelector('.hps-messages')?.innerText ?? ''`);const before=await runText();await b.evaluate('window.__clock=31000');await new Promise(r=>setTimeout(r,1200));
  assert.equal(await runText(),before,'running turn text does not tick');assert.doesNotMatch(before,/\d+\s*(초|분)/,'no elapsed estimate while running');
  await send({type:'streamStart',streamId:'one',messageId:'answer'},3000); // duplicate start cannot reset the clock
  await send({type:'streamEnd',streamId:'wrong'},5000);assert.deepEqual(await labels(),[],'another stream cannot terminate this turn');
  await send({type:'streamEnd',streamId:'one'},62500);assert.deepEqual(await labels(),['1분 1초 동안 작업했어요']);
  {const [first]=await placeAt([seat==='personal']);if(seat==='personal')assert.ok(first.controls>1,'latest answer row carries verdicts, so the receipt is checked after more than one control');}
  if(seat==='personal')assert.ok(await b.evaluate(`document.body.textContent.includes('첫 번째') && !!document.querySelector('.hps-reply-choices')`),'completion receipt preserves quick reply choices');
  await send({type:'streamEnd',streamId:'one'},90000);assert.equal((await labels()).length,1);
  await send({type:'history',messages:[{id:'answer',role:'assistant',content:'골라 주세요.\n1. 첫 번째\n2. 두 번째',createdAt:1}]});assert.equal((await labels()).length,1,'same-view history refresh keeps observed timing');
  await send({type:'streamStart',streamId:'two',messageId:'partial'},100000);await send({type:'streamChunk',streamId:'two',delta:'부분 답변'});await send({type:'streamStopped',streamId:'two'},105000);assert.deepEqual(await labels(),['1분 1초 동안 작업했어요','5초 뒤 멈췄어요']);
  await send({type:'streamStart',streamId:'error',messageId:'failed'},110000);await send({type:'streamChunk',streamId:'error',delta:'완료되지 않은 답변'});await send({type:'streamError',streamId:'error',error:'실패'},115000);assert.equal((await labels()).length,2,'error is not completion');
  await send({type:'streamStart',streamId:'failed-end',messageId:'failed-end'},120000);await send({type:'streamEnd',streamId:'failed-end',failed:true},125000);assert.equal((await labels()).length,2);
  await send({type:'streamStart',streamId:'empty',messageId:'empty'},130000);await send({type:'streamStopped',streamId:'empty',by:'instructor'},135000);assert.deepEqual(await labels(),['1분 1초 동안 작업했어요','5초 뒤 멈췄어요','5초 뒤 멈췄어요 · 답변 없음']);
  assert.equal(await b.evaluate(`[...document.querySelectorAll('.hps-msg-body')].filter(e=>!e.textContent.trim()).length`),0,'a no-answer stop receipt must not add an empty spoken message row');
  await placeAt(seat==='personal'?[true,true,false]:[false,false,false]);
  const status=await b.evaluate(`(()=>{const e=document.querySelector('.hps-turn-elapsed');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {font:parseFloat(getComputedStyle(e).fontSize),visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth,role:e.getAttribute('role')}})()`);assert.ok(status.font>=14);assert.equal(status.visible,true);assert.equal(status.role,'status');
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
  await send({type:'config',config:{...config,activity:{...config.activity,id:'another-scope'}}});assert.deepEqual(await labels(),[],'scope switch clears receipts');
  await send({type:'history',messages:[{id:'legacy',role:'assistant',content:'기존 답변',createdAt:1}]});assert.deepEqual(await labels(),[],'legacy history never invents elapsed time');
 }
 console.log('PASS actual App elapsed events and CGP-CHAT-D-015 placement (row end, secondary, no ticking) in12 states: completion, stop, duplicate/stale terminal, failures, empty stop, history refresh, scope reset and legacy history');
}finally{await b.close()}
