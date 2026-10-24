import {mountPoint,click} from './fixtures/mini-dom.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import assert from 'node:assert/strict';
import {GoalStatusBar,lessonBudgetMeter} from '../webview-ui/src/GoalStatusBar';
const act=(React as any).act;
const config:any={activity:{id:'a',kind:'classroom'},profile:{profile_id:'p'},textSize:'base',access:{status:'ready',selected:'class',view:{configured:true,as_of:'2026-10-24T00:00:00Z',choices:[{id:'class',active:true,available:true,source_kind:'cohort',state:'ready',resources:[{meter:'requests:count',limit:100,remaining:62,unresolved:0,shared:true}]}]}}};
const initial:any={lesson:{course_id:'c',version:'v',sha256:'a'.repeat(64)},activity:'a',goal:'예약 버튼',criteria:['직접 확인'],revision:1,saved_at:1,status:'active'};
const fire=(el:any,type:string,extra={})=>el.dispatchEvent({type,bubbles:true,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this._stopped=true},...extra});
async function main(){
 assert.equal(lessonBudgetMeter(config).percent,62);
 for(const change of [(m:any)=>m.limit=0,(m:any)=>m.limit=-1,(m:any)=>m.limit=61,(m:any)=>m.limit=undefined,(m:any)=>m.remaining=-1,(m:any)=>m.unresolved=1]){
  const cfg=structuredClone(config);change(cfg.access.view.choices[0].resources[0]);assert.equal(lessonBudgetMeter(cfg).percent,null);
 }
 const noAllowance=structuredClone(config);Object.assign(noAllowance.access.view.choices[0].resources[0],{limit:0,remaining:0});assert.equal(lessonBudgetMeter(noAllowance).percent,null,'zero denominator remains unknown even when remaining is zero');
 const zero=structuredClone(config);zero.access.view.choices[0].resources[0].remaining=0;assert.equal(lessonBudgetMeter(zero).percent,0);
 const host:any=mountPoint(),root=createRoot(host),saves:any[]=[];
 const render=async(view:any)=>act(async()=>root.render(<GoalStatusBar config={config} view={view} pending={false} onSave={r=>saves.push(r)}/>));
 await render(initial);assert.ok(!host.querySelector('textarea'));assert.ok(host.textContent.includes('남은 사용량 62%'));
 await act(async()=>click(host.querySelector('.hps-goal-strip')));let textarea=host.querySelector('textarea');
 assert.ok(textarea);assert.equal(textarea.value,'예약 버튼');
 await act(async()=>fire(textarea,'compositionstart'));
 textarea.value='한';await act(async()=>fire(textarea,'input',{data:'한',isComposing:true}));
 const newer={...initial,revision:2,goal:'다른 화면의 목표',criteria:['새 기준']};await render(newer);assert.equal(host.querySelector('textarea').value,'한','host update preserves first composing syllable');
 await act(async()=>fire(host.querySelector('form'),'submit'));assert.equal(saves.length,0,'IME cannot submit');
 textarea=host.querySelector('textarea');textarea.value='한글 목표';await act(async()=>fire(textarea,'compositionend',{data:'한글 목표'}));
 assert.equal(host.querySelector('textarea').value,'한글 목표');
 await act(async()=>fire(host.querySelector('form'),'submit'));assert.equal(saves.length,1);assert.equal(saves[0].goal,'한글 목표');assert.equal(saves[0].base,2);assert.deepEqual(saves[0].criteria,['새 기준']);
 await act(async()=>click(host.querySelector('.hps-goal-strip')));assert.ok(!host.querySelector('textarea'));
 await act(async()=>click(host.querySelector('.hps-goal-strip')));assert.equal(host.querySelector('textarea').value,'한글 목표','collapse preserves draft');
 await render({...initial,activity:'b'});assert.ok(!host.querySelector('textarea'),'new scope closes editor');
 await act(async()=>root.unmount());console.log('PASS goal strip: confirmed percentage and unknowns, inline draft, IME submit guard, host revision merge, collapse and scope isolation');
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
