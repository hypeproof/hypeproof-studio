import {click,mountPoint} from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../webview-ui/src/App';
import {outboundPrompt} from '../src/outboundApproval';
for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
const act=(React as any).act;
let clock=1700000000000;
const realNow=Date.now,realSet=globalThis.setInterval,realClear=globalThis.clearInterval;
Date.now=()=>clock;
let seq=0;const timers=new Map<number,{fn:()=>void,ms:number}>();
globalThis.setInterval=((fn:()=>void,ms:number)=>{const id=++seq;timers.set(id,{fn,ms});return id}) as any;
globalThis.clearInterval=((id:number)=>timers.delete(id)) as any;
const host:any=mountPoint(),root=createRoot(host);
const send=(data:any)=>act(async()=>{(globalThis.window as any).dispatchEvent({type:'message',data,bubbles:false})});
const advance=(ms:number)=>act(async()=>{clock+=ms;for(const timer of [...timers.values()])if(timer.ms===1000)timer.fn()});
const hint=()=>host.querySelector('.hps-long-step');
const UX = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = { model: 'claude-sonnet-5', hasToken: true, proxyUrl: 'http://localhost:8787', coach: { name: 'HypeProof', personality: '', configured: true },
  profile: { profile_id: 'p', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/tmp/p', verified: true } };

async function main(){
 try{
  await act(async()=>root.render(<App/>));await send({type:'config',config});
  await send({type:'streamStart',streamId:'s',messageId:'a'});
  await advance(19999);assert.equal(hint(),null);
  await advance(1);assert.match(hint().textContent,/평소보다 오래/);
  await act(async()=>click(host.querySelector('.hps-long-step-stop')));
  assert.deepEqual((globalThis as any).__posted.filter((m:any)=>m.type==='cancelStream').map((m:any)=>m.streamId),['s']);
  await send({type:'streamChunk',streamId:'s',delta:'진행'});assert.equal(hint(),null);
  await advance(20000);assert.ok(hint());
  await send({type:'streamChunk',streamId:'foreign',delta:'wrong'});assert.ok(hint(),'foreign event cannot reset this turn');
  await send({type:'streamChunk',streamId:'s',delta:''});assert.ok(hint(),'empty delta is not visible progress');
  const tool={type:'toolLog',streamId:'s',id:'tool',icon:'',label:'work',state:'running',step:'파일을 살펴보는 중',since:clock};
  await send(tool);assert.equal(hint(),null);await advance(20000);assert.ok(hint());
  await send(tool);assert.equal(hint(),null,'identical tool event resets quiet time');
  await advance(60000);assert.match(hint().textContent,/파일을 살펴보는 중/);
  await send({type:'approvalWait',streamId:'s',waiting:true});assert.equal(hint(),null);await advance(90000);assert.equal(hint(),null);
  await send({type:'approvalWait',streamId:'s',waiting:false});assert.equal(hint(),null);await advance(20000);assert.ok(hint());
  // In-webview approval dialogs (write and outbound) hide the hint while open and restart the quiet clock when answered.
  await send({type:'writeApprovalPrompt',prompt:{id:'w1',title:'파일을 저장할까요?',verb:'저장',files:['a.txt']}});assert.equal(hint(),null,'write dialog open: no hint');await advance(90000);assert.equal(hint(),null,'write dialog open: still no hint after 90 s');
  await act(async()=>click(host.querySelector('[data-write-deny]')));assert.equal(host.querySelector('.hps-write-approval'),null);assert.equal(hint(),null,'answering the write dialog restarts the clock');await advance(19999);assert.equal(hint(),null);await advance(1);assert.ok(hint());
  await send({type:'outboundPrompt',prompt:outboundPrompt('o1',{recipient:'갤러리 · site.invalid',items:[{name:'index.html',bytes:1200}]})});assert.equal(hint(),null,'outbound dialog open: no hint');await advance(90000);assert.equal(hint(),null,'outbound dialog open: still no hint after 90 s');
  await act(async()=>click(host.querySelector('[data-outbound-cancel]')));assert.equal(host.querySelector('.hps-outbound'),null);assert.equal(hint(),null,'answering the outbound dialog restarts the clock');await advance(19999);assert.equal(hint(),null);await advance(1);assert.ok(hint());
  // Two running tools: the 60 s phrase names the oldest outstanding one.
  await send({type:'toolLog',streamId:'s',id:'older',icon:'',label:'a',state:'running',step:'파일을 살펴보는 중',since:clock-5000});
  await send({type:'toolLog',streamId:'s',id:'newer',icon:'',label:'b',state:'running',step:'명령을 실행하는 중',since:clock});
  await advance(60000);assert.match(hint().textContent,/파일을 살펴보는 중/);assert.doesNotMatch(hint().textContent,/명령을 실행하는 중/,'oldest running tool supplies the phrase');
  await send({type:'streamStopped',streamId:'s'});assert.equal(hint(),null);
  await send({type:'streamStart',streamId:'next',messageId:'b'});assert.equal(hint(),null);await advance(20000);assert.ok(hint());
  await send({type:'config',config:{...config,activity:{...config.activity,id:'p2'}}});assert.equal(hint(),null,'activity switch clears old progress');
  console.log('PASS real App idle progress: text/tool reset, repeated tool event, empty/foreign exclusions, approval pause/resume, exact Stop, end/new turn/activity');
 }finally{await act(async()=>root.unmount());Date.now=realNow;globalThis.setInterval=realSet;globalThis.clearInterval=realClear;}
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
