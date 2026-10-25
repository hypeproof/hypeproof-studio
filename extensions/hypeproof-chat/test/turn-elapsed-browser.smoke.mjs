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
  await send({type:'streamStart',streamId:'one',messageId:'answer'},1000);await send({type:'streamChunk',streamId:'one',delta:'골라 주세요.\n1. 첫 번째\n2. 두 번째'});assert.deepEqual(await labels(),[],'running turn never predicts duration');
  await send({type:'streamStart',streamId:'one',messageId:'answer'},3000); // duplicate start cannot reset the clock
  await send({type:'streamEnd',streamId:'wrong'},5000);assert.deepEqual(await labels(),[],'another stream cannot terminate this turn');
  await send({type:'streamEnd',streamId:'one'},62500);assert.deepEqual(await labels(),['1분 1초 동안 작업했어요']);
  if(seat==='personal')assert.ok(await b.evaluate(`document.body.textContent.includes('첫 번째') && !!document.querySelector('.hps-reply-choices')`),'completion receipt preserves quick reply choices');
  await send({type:'streamEnd',streamId:'one'},90000);assert.equal((await labels()).length,1);
  await send({type:'history',messages:[{id:'answer',role:'assistant',content:'골라 주세요.\n1. 첫 번째\n2. 두 번째',createdAt:1}]});assert.equal((await labels()).length,1,'same-view history refresh keeps observed timing');
  await send({type:'streamStart',streamId:'two',messageId:'partial'},100000);await send({type:'streamChunk',streamId:'two',delta:'부분 답변'});await send({type:'streamStopped',streamId:'two'},105000);assert.deepEqual(await labels(),['1분 1초 동안 작업했어요','5초 뒤 멈췄어요']);
  await send({type:'streamStart',streamId:'error',messageId:'failed'},110000);await send({type:'streamChunk',streamId:'error',delta:'완료되지 않은 답변'});await send({type:'streamError',streamId:'error',error:'실패'},115000);assert.equal((await labels()).length,2,'error is not completion');
  await send({type:'streamStart',streamId:'failed-end',messageId:'failed-end'},120000);await send({type:'streamEnd',streamId:'failed-end',failed:true},125000);assert.equal((await labels()).length,2);
  await send({type:'streamStart',streamId:'empty',messageId:'empty'},130000);await send({type:'streamStopped',streamId:'empty',by:'instructor'},135000);assert.deepEqual(await labels(),['1분 1초 동안 작업했어요','5초 뒤 멈췄어요','5초 뒤 멈췄어요 · 답변 없음']);
  assert.equal(await b.evaluate(`[...document.querySelectorAll('.hps-msg-body')].filter(e=>!e.textContent.trim()).length`),0,'a no-answer stop receipt must not add an empty spoken message row');
  const status=await b.evaluate(`(()=>{const e=document.querySelector('.hps-turn-elapsed');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {font:parseFloat(getComputedStyle(e).fontSize),visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth,role:e.getAttribute('role')}})()`);assert.ok(status.font>=14);assert.equal(status.visible,true);assert.equal(status.role,'status');
  if(evidence){const shot=await b.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${evidence}/${seat}-${width}-${dark?'dark':'light'}.png`,Buffer.from(shot.data,'base64'));}
  await send({type:'config',config:{...config,activity:{...config.activity,id:'another-scope'}}});assert.deepEqual(await labels(),[],'scope switch clears receipts');
  await send({type:'history',messages:[{id:'legacy',role:'assistant',content:'기존 답변',createdAt:1}]});assert.deepEqual(await labels(),[],'legacy history never invents elapsed time');
 }
 console.log('PASS actual App elapsed events in12 states: completion, stop, duplicate/stale terminal, failures, empty stop, history refresh, scope reset and legacy history');
}finally{await b.close()}
