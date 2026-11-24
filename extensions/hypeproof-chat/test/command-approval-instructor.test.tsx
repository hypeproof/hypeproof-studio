// #4191: the instructor always sees the full command warning, even with a compact coach_layout profile.
import {document as doc,mountPoint} from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '../webview-ui/src/App';
import {compactDestructiveNote} from '../src/commandApprovalPrompt';
for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
void doc;
const act=(React as any).act;
const UX={
  coach:{naming_mode:'fixed',fallback_name:'HypeProof',naming_prompt_md:'',personality_prompt_md:''},
  suggestions:{initial:[],follow_up:[]},
  hints:{short_input:{enabled:false,min_chars:0,message_md:''},roll_input_button:{enabled:false,label:'',probe_md:''}},
  retry_button:{enabled:false,show_counter:false},
};
const FULL_TITLE='코치가 위험한 명령을 실행하려고 해요',COMPACT_TITLE='이 명령을 실행할까요?';
const command='rm -rf build';
const prompt:any={id:'danger',purpose:'destructive',command,destructive:true,rememberAllowed:false};
const configFor=(isInstructor:boolean,ux:any)=>({
  model:'claude-sonnet-5',hasToken:true,proxyUrl:'http://localhost:8787',isInstructor,
  coach:{name:'HypeProof',personality:'',configured:true},
  profile:{profile_id:'class-a',activity_kind:'classroom',observation:null,lesson:null,rehearsal:null,welcome:{greeting_md:'안녕하세요'},model_selection:null,ux},
  activity:{id:'a1',name:'수업',kind:'classroom',workspace:'/tmp/w',verified:true},
});
async function show(isInstructor:boolean,layout:string|undefined){
  const host:any=mountPoint(),root=createRoot(host);
  await act(async()=>{root.render(<App/>);});
  const send=async(data:any)=>act(async()=>{(globalThis.window as any).dispatchEvent({type:'message',data});});
  await send({type:'config',config:configFor(isInstructor,layout===undefined?UX:{...UX,coach_layout:layout})});
  await send({type:'commandApprovalPrompt',prompt});
  const out={title:host.querySelector('h2')?.textContent,text:host.textContent as string,warning:host.querySelector('.hps-command-warning'),compactWarning:host.querySelector('.hps-command-warning-compact')};
  await act(async()=>root.unmount());
  return out;
}
async function test_tc_0006_instructor_with_compact_profile_sees_full_warning(){
  const r=await show(true,'compact');
  assert.equal(r.title,FULL_TITLE);assert.match(r.text,/되돌릴 수 없어요/);assert.equal(r.compactWarning,null);assert.ok(!r.text.includes(compactDestructiveNote(command)));
}
async function test_tc_0007_student_with_compact_profile_sees_compact_note(){
  const r=await show(false,'compact');
  assert.equal(r.title,COMPACT_TITLE);assert.ok(r.compactWarning);assert.equal(r.warning.textContent,compactDestructiveNote(command));assert.ok(!r.text.includes('되돌릴 수 없어요'));
}
async function test_tc_0008_non_compact_layouts_see_full_warning_for_both_roles(){
  for(const isInstructor of [true,false])for(const layout of [undefined,'standard']){
    const r=await show(isInstructor,layout),label=`${isInstructor?'instructor':'student'}/${layout}`;
    assert.equal(r.title,FULL_TITLE,label);assert.match(r.text,/되돌릴 수 없어요/,label);assert.equal(r.compactWarning,null,label);
  }
}
void (async()=>{await test_tc_0006_instructor_with_compact_profile_sees_full_warning();await test_tc_0007_student_with_compact_profile_sees_compact_note();await test_tc_0008_non_compact_layouts_see_full_warning_for_both_roles();console.log('PASS command approval compact layout by role (TC-0006, TC-0007, TC-0008)');})().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
