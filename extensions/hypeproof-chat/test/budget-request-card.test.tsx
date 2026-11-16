// CGP-SHELL-R-030 (Jay, 2026-11-16) — the request-more card in the chat:
//   node scripts/run-tsx-tests.mjs budget-request-card
// It appears only when the class allowance has run out or is at 10% or less, and only with a Service request policy. 요청하기
// opens the fixed reasons (a minor seat has no text field; an adult keeps the optional note). The pending, cooldown and
// answered states read in words. The card shows no meter figure and no number but a clock time (the browser smoke runs the
// SX audit on the rendered card). The usage panel hides token and
// meter figures from a minor seat and keeps them for an adult.
import {mountPoint} from './fixtures/mini-dom.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import assert from 'node:assert/strict';
import {BudgetRequestCard} from '../webview-ui/src/BudgetRequestCard';
import {AccessControl} from '../webview-ui/src/AccessControl';
import type {ChatConfig} from '../src/protocol';
const act=(React as any).act;
const proto=Object.getPrototypeOf(mountPoint());
if(!('type' in proto))Object.defineProperty(proto,'type',{get(){return this.getAttribute('type')??'text';},set(v){this.setAttribute('type',v);}});
if(!('options' in proto))Object.defineProperty(proto,'options',{get(){return this.findAll((e:any)=>e.localName==='option');}});
const host=mountPoint() as any, root=createRoot(host);let posted:any[]=[];
const REASONS=[{id:'finish_work',label:'하던 작업을 마무리하고 싶어요'},{id:'fix_problem',label:'문제를 고치는 중이에요'},{id:'check_again',label:'결과를 한 번 더 확인하고 싶어요'}];
const MINOR={reasons:REASONS,note:false,note_max:200,cooldown_until:null},ADULT={...MINOR,note:true};
const res=(remaining:number,limit=1000000,meter='currency:USD:micro')=>[{meter,limit,remaining,held:0,spent:limit-remaining,unresolved:0,overrun:0,shared:true}];
const make=(policy:any,over:any={},profile:any={})=>({profile,access:{status:'ready',selected:'class-1',view:{schema:'hps-access-view/1',configured:true,as_of:'2026-11-16T00:00:00Z',choices:[{id:'class-1',label:'수업',source_kind:'cohort',mode:'included',active:true,available:true,state:'ready',ends_at:1,can_request:true,allowed:{models:[],efforts:[],features:[],runtimes:[]},resources:res(50000),request_policy:policy,...over}]}}});
const fire=(target:any,type:string,extra:any={})=>{const event={type,bubbles:true,cancelable:true,defaultPrevented:false,timeStamp:Date.now(),...extra,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};target.dispatchEvent(event);return event;};
// Assertions on DOM nodes use ok(!x): equal(node, null) would make node:assert inspect a whole mini-dom tree.
const card=()=>host.querySelector('[data-request-card]');
const render=(config:any)=>act(async()=>root.render(<BudgetRequestCard config={structuredClone(config) as ChatConfig} post={m=>posted.push(m)}/>));
const radios=()=>host.findAll((e:any)=>e.localName==='input'&&e.getAttribute('type')==='radio');
const texts=()=>host.findAll((e:any)=>e.localName==='input'&&(e.getAttribute('type')??'text')==='text');
const click=(sel:string)=>act(async()=>{const b=host.querySelector(sel);fire(b,'click');});
const pick=async(i:number)=>act(async()=>{const r=radios()[i];r.checked=true;fire(r,'click');fire(r,'input');fire(r,'change');});
const state=()=>host.querySelector('[data-request-state]')?.textContent??'';
let passed=0;const check=async(name:string,fn:()=>Promise<void>)=>{posted=[];await act(async()=>root.render(<></>));await fn();passed++;console.log('PASS '+name);};
async function main(){
 await check('shown only when the allowance ran out or is at 10% or less, and only with a request policy',async()=>{
  await render(make(MINOR,{resources:res(110000)}));assert.ok(!card(),'11%: no card');
  await render(make(MINOR,{resources:res(100000)}));assert.ok(card(),'10%: card');
  await render(make(MINOR,{state:'exhausted',resources:res(500000)}));assert.ok(card(),'exhausted: card');
  await render(make(undefined));assert.ok(!card(),'an older Service (no policy): no card');
  await render(make(null));assert.ok(!card(),'a malformed policy: no card');
  await render(make(MINOR,{can_request:false}));assert.ok(!card(),'not requestable: no card');
  await render({...make(MINOR),access:{...make(MINOR).access,status:'unknown'}});assert.ok(!card(),'unknown usage: no card');
 });
 await check('minor seat: the plain title, a large 요청하기, then the three reasons only; 보내기 posts the reason id; 취소 closes',async()=>{
  await render(make(MINOR));
  assert.equal(host.querySelector('h3').textContent,'AI를 더 쓰려면 선생님께 요청할 수 있어요');
  assert.ok(host.querySelector('[data-request-open]'));assert.equal(radios().length,0,'the reasons wait behind 요청하기');
  await click('[data-request-open]');
  assert.equal(radios().length,3);assert.equal(texts().length,0,'no free-text field on a minor seat');
  const submit=()=>host.findAll((e:any)=>e.localName==='button'&&e.textContent==='보내기')[0];
  assert.ok(submit().hasAttribute('disabled'),'waits for a pick');
  await pick(2);await act(async()=>fire(host.querySelector('form'),'submit'));
  assert.deepEqual(posted,[{type:'requestBudget',reason:'check_again'}]);
  await act(async()=>{const b=host.findAll((e:any)=>e.localName==='button'&&e.textContent==='취소')[0];fire(b,'click');});
  assert.equal(radios().length,0,'취소 closes the picker');assert.ok(host.querySelector('[data-request-open]'));
 });
 await check('adult seat: the optional note of at most 200 is there; nothing or a note alone may be sent',async()=>{
  await render(make(ADULT));await click('[data-request-open]');
  assert.equal(texts().length,1);assert.ok(host.textContent.includes('0 / 200자'));
  await act(async()=>fire(host.querySelector('form'),'submit'));assert.deepEqual(posted.at(-1),{type:'requestBudget'});
 });
 await check('pending, cooldown and answered states read in words in the same card',async()=>{
  await render(make(MINOR,{pending_request:{id:'r',state:'pending',note:'문제를 고치는 중이에요'}}));
  assert.equal(state(),'요청했어요 · 선생님 확인 기다리는 중');assert.ok(!host.querySelector('[data-request-open]'),'no second request while pending');
  await render(make({...MINOR,cooldown_until:Date.now()+5*60_000},{pending_request:{id:'r',state:'resolved',note:'x',resolution:'조금 더 쓸 수 있게 했어요'}}));
  assert.match(state(),/^방금 요청했어요\. (?:오전|오후) \d{2}:\d{2} 이후에 다시 요청할 수 있어요\.$/);assert.ok(!host.querySelector('[data-request-open]'));
  assert.equal(host.querySelector('[data-request-answer]').textContent,'선생님이 확인했어요: 조금 더 쓸 수 있게 했어요');
  await render(make({...MINOR,cooldown_until:Date.now()-1},{pending_request:{id:'r',state:'resolved',note:'x',resolution:null}}));
  assert.equal(state(),'');assert.ok(host.querySelector('[data-request-open]'),'after the block, 요청하기 again');
  assert.equal(host.querySelector('[data-request-answer]').textContent,'선생님이 확인했어요.');
  assert.equal(host.querySelector('[data-request-state]').getAttribute('role'),'status');
 });
 await check('the card shows no meter figure and no number but a clock time, in every state',async()=>{
  for(const c of [make(MINOR),make(MINOR,{state:'exhausted'}),make(MINOR,{pending_request:{id:'r',state:'pending',note:'x'}}),make({...MINOR,cooldown_until:Date.now()+60_000})]){
   await render(c);if(host.querySelector('[data-request-open]'))await click('[data-request-open]');
   const text=card().textContent;
   assert.ok(!/토큰|정산|USD|micro|\d+\s*남음/.test(text),text);
   assert.ok(!/\d/.test(text.replace(/(?:오전|오후)?\s*\d{1,2}:\d{2}/g,'')),`no number but a clock time: ${text}`);
  }
 });
 await check('usage panel: a minor seat sees no token or meter figures; an adult still does',async()=>{
  const panel=(config:any)=>act(async()=>root.render(<AccessControl config={structuredClone(config) as ChatConfig} streaming={false} post={m=>posted.push(m)} defaultOpen/>));
  await panel(make(MINOR,{},{minor_cohort:true}));
  assert.ok(!host.querySelector('.hps-access-resource'),'no meter rows');assert.ok(!/정산 기준|USD|micro|토큰/.test(host.textContent),host.textContent);
  assert.ok(host.querySelector('[data-minor-usage]'),'the state in words');
  await panel(make({...ADULT,note:false},{},{}));assert.ok(!host.querySelector('.hps-access-resource'),'a policy without notes is a minor seat too');
  await panel(make(ADULT,{},{minor_cohort:false}));assert.ok(host.querySelector('.hps-access-resource'),'an adult keeps the meter rows');
 });
 await act(async()=>root.unmount());console.log(`budget-request-card: ${passed} passed`);
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
