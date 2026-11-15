// CGP-SHELL-R-030 — the request-more form when the Service serves a request policy:
//   node scripts/run-tsx-tests.mjs budget-request-policy
// A minor seat picks one fixed reason and has no text field at all; an adult may pick, write, both or neither;
// the form sits only inside the low-allowance notice (DES-SHELL-29); a cooldown disables the button and says when;
// a malformed policy offers nothing (never the free-text fallback).
import {mountPoint} from './fixtures/mini-dom.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import assert from 'node:assert/strict';
import {AccessControl,lowAllowance} from '../webview-ui/src/AccessControl';
import type {ChatConfig} from '../src/protocol';
const act=(React as any).act;
const proto=Object.getPrototypeOf(mountPoint());
if(!('type' in proto))Object.defineProperty(proto,'type',{get(){return this.getAttribute('type')??'text';},set(v){this.setAttribute('type',v);}});
if(!('options' in proto))Object.defineProperty(proto,'options',{get(){return this.findAll((e:any)=>e.localName==='option');}});
const host=mountPoint() as any, root=createRoot(host);let posted:any[]=[];
const REASONS=[{id:'finish_work',label:'하던 작업을 마무리하고 싶어요'},{id:'fix_problem',label:'문제를 고치는 중이에요'},{id:'check_again',label:'결과를 한 번 더 확인하고 싶어요'}];
const res=(remaining:number,limit=100)=>[{meter:'requests:count',limit,remaining,held:0,spent:limit-remaining,unresolved:0,overrun:0,shared:true}];
const make=(policy:any,over:any={})=>({access:{status:'ready',selected:'class-1',view:{schema:'hps-access-view/1',configured:true,as_of:'2026-11-15T00:00:00Z',choices:[{id:'class-1',label:'수업',source_kind:'cohort',mode:'included',active:true,available:true,state:'ready',ends_at:1,can_request:true,allowed:{models:[],efforts:[],features:[],runtimes:[]},resources:res(5),request_policy:policy,...over}]}}});
const MINOR={reasons:REASONS,note:false,note_max:280,cooldown_until:null},ADULT={...MINOR,note:true};
const fire=(target:any,type:string,extra:any={})=>{const event={type,bubbles:true,cancelable:true,defaultPrevented:false,timeStamp:Date.now(),...extra,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};target.dispatchEvent(event);return event;};
// Assertions on DOM nodes use ok(!x): equal(node, null) would make node:assert inspect a whole mini-dom tree.
const render=(config:any)=>act(async()=>root.render(<AccessControl config={structuredClone(config) as ChatConfig} streaming={false} post={m=>posted.push(m)} defaultOpen/>));
const form=()=>host.querySelector('form'),button=()=>form()?.querySelector('button');
const radios=()=>host.findAll((e:any)=>e.localName==='input'&&e.getAttribute('type')==='radio');
const texts=()=>host.findAll((e:any)=>e.localName==='input'&&(e.getAttribute('type')??'text')==='text');
const pick=async(i:number)=>act(async()=>{const r=radios()[i];r.checked=true;fire(r,'click');fire(r,'input');fire(r,'change');});
const submit=()=>act(async()=>fire(form(),'submit'));
// Each check starts from an empty tree: the form is keyed by the choice, so its draft would carry over otherwise.
let passed=0;const check=async(name:string,fn:()=>Promise<void>)=>{posted=[];await act(async()=>root.render(<></>));await fn();passed++;console.log('PASS '+name);};
async function main(){
 await check('minor seat: three fixed reasons, no text field anywhere, the button waits for a pick, only the reason id is posted',async()=>{
  await render(make(MINOR));
  assert.deepEqual(radios().map((r:any)=>r.value??r.getAttribute('value')),REASONS.map(r=>r.id));
  for(const r of REASONS)assert.ok(host.textContent.includes(r.label));
  assert.equal(texts().length,0,'no free-text input on a minor seat');
  assert.equal(host.querySelector('legend').textContent,'요청 이유','required: no (선택)');
  assert.ok(button().hasAttribute('disabled'));await submit();assert.equal(posted.length,0);
  await pick(1);assert.ok(!button().hasAttribute('disabled'));
  await submit();assert.deepEqual(posted,[{type:'requestBudget',reason:'fix_problem'}]);
 });
 await check('adult seat: reason and note are optional; neither, note only, and both are posted as written',async()=>{
  await render(make(ADULT));
  assert.equal(texts().length,1);assert.ok(host.querySelector('legend').textContent.includes('(선택)'));
  assert.ok(host.textContent.includes('0 / 280자'));
  assert.ok(!button().hasAttribute('disabled'));await submit();assert.deepEqual(posted.at(-1),{type:'requestBudget'});
  await act(async()=>{texts()[0].value='발표 전에 한 번 더';fire(texts()[0],'input',{data:'더'});});
  await submit();assert.deepEqual(posted.at(-1),{type:'requestBudget',note:'발표 전에 한 번 더'});
  await pick(0);await submit();assert.deepEqual(posted.at(-1),{type:'requestBudget',reason:'finish_work',note:'발표 전에 한 번 더'});
  await act(async()=>{texts()[0].value='   ';fire(texts()[0],'input',{data:' '});});
  await submit();assert.deepEqual(posted.at(-1),{type:'requestBudget',reason:'finish_work'},'whitespace is not a note');
  await act(async()=>fire(texts()[0],'compositionstart',{data:''}));await submit();assert.equal(posted.length,4,'IME composition blocks submit');
 });
 await check('cooldown: the button is disabled and the time of the next request is stated; a past cooldown is no cooldown',async()=>{
  await render(make({...MINOR,cooldown_until:Date.now()+5*60_000}));await pick(0);
  assert.ok(button().hasAttribute('disabled'));
  const s=host.findAll((e:any)=>e.getAttribute('role')==='status'&&e.textContent.includes('이후에 다시 요청할 수 있어요'))[0];assert.ok(s,host.textContent);
  assert.equal(button().getAttribute('aria-describedby'),s.getAttribute('id'));
  await submit();assert.equal(posted.length,0);
  await render(make({...MINOR,cooldown_until:Date.now()-1}));await pick(0);assert.ok(!button().hasAttribute('disabled'));assert.ok(!host.textContent.includes('이후에 다시 요청할 수 있어요'));
 });
 await check('DES-SHELL-29: the form appears only inside the low-allowance notice; exhausted counts; 11% does not',async()=>{
  await render(make(MINOR,{resources:res(11)}));assert.ok(!form(),"no form");assert.ok(!host.textContent.includes('남은 사용량이 부족해요'));
  await render(make(MINOR,{resources:res(10)}));assert.ok(form());
  await render(make(MINOR,{resources:res(50),state:'exhausted'}));assert.ok(form());
  assert.equal(lowAllowance({state:'ready',resources:[{meter:'currency:USD:micro',limit:1000,remaining:100}]} as any),true,'any metered allowance');
  assert.equal(lowAllowance({state:'ready',resources:[{meter:'currency:USD:micro',limit:0,remaining:0}]} as any),false,'no limit, no ratio');
 });
 await check('a malformed policy (parsed to null) offers no form, never the free-text fallback; a pending request hides the form',async()=>{
  await render(make(null));assert.ok(!form(),"no form");assert.equal(texts().length,0);
  await render(make(MINOR,{pending_request:{id:'r',state:'pending',note:'문제를 고치는 중이에요'}}));assert.ok(!form(),"no form");assert.ok(host.textContent.includes('요청함'));
 });
 await act(async()=>root.unmount());console.log(`budget-request-policy: ${passed} passed`);
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
