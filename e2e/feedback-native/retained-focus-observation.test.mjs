import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {beginRetainedFocusObservation} from './retained-focus-observation.mjs';
function fixture(){
 const listeners=new Map(),calls=[],input={isConnected:true,disabled:false,get value(){throw Error('content forbidden');},get selectionStart(){throw Error('selection forbidden');},focus(){assert.fail('no focus input');},getBoundingClientRect:()=>({width:10,height:10})};
 const doc={body:{},documentElement:{},activeElement:input,hasFocus:()=>true,visibilityState:'visible',querySelector:()=>input},win={};
 const add=kind=>(name,fn)=>{const key=kind+name;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);},remove=kind=>(name,fn)=>listeners.get(kind+name)?.delete(fn);
 doc.addEventListener=add('d');doc.removeEventListener=remove('d');win.addEventListener=add('w');win.removeEventListener=remove('w');const context=vm.createContext({document:doc,window:win});
 let loader='L';const target={info:{id:'T'},ownedWorkbenchId:'W',ownedFrameId:'F',ownedLoaderId:'L',contextId:5,send:async(method,args)=>{calls.push({method,context:args.contextId});if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'F',loaderId:loader}}};assert.equal(method,'Runtime.evaluate');assert.equal(args.contextId,5,'original context retained');return{result:{value:vm.runInContext(args.expression,context)}};}};
 return{ui:{workbenchId:'W'},target,doc,win,input,calls,listeners,event:key=>{for(const fn of listeners.get(key)??[])fn({target:doc.activeElement});},replace:()=>{loader='REPLACED';}};
}
test('same retained document records pre-switch, transition and refusal without draft/selection or focus actions',async()=>{
 const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target);
 const before=await observer.snapshot('before_secondary');assert.equal(before.state.textarea_focused,true);
 f.doc.hasFocus=()=>false;f.event('wblur');f.doc.activeElement=f.doc.body;f.event('dfocusout');
 assert.equal((await observer.snapshot('before_switch')).state.document_focused,false);
 f.target.contextId=999;f.doc.hasFocus=()=>true;f.event('wfocus');
 const after=await observer.snapshot('switch_refused');assert.equal(after.status,'OBSERVED');assert.equal(after.state.active_kind,'body');assert.equal(after.state.document_focused,true);assert.equal(after.state.textarea_focused,false);
 assert.deepEqual(Array.from(after.events,e=>e.phase),['observer_started','window_blur','focus_out','window_focus']);
 assert(!JSON.stringify(after).includes('selection'));assert.equal((await observer.finish()).listeners_removed,true);assert([...f.listeners.values()].every(set=>set.size===0));
 assert.equal((await observer.finish()).status,'ALREADY_STOPPED');assert.equal(Object.keys(f.win).filter(k=>k.startsWith('__hpsRetainedFocus')).length,0);
});
test('replacement loader/window cannot adopt diagnostic state, and scope loss remains explicit',async()=>{
 for(const change of[f=>f.replace(),f=>f.ui.workbenchId='FOREIGN']){
  const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target);change(f);const before=f.calls.length;
  assert.equal((await observer.snapshot('after_switch')).status,'UNAVAILABLE');assert(!f.calls.slice(before).some(c=>c.method==='Runtime.evaluate'));
  assert.equal((await observer.finish()).listeners_removed,false);
 }
 const missing=await beginRetainedFocusObservation({workbenchId:'W'},null);assert.equal((await missing.snapshot('before_secondary')).status,'UNAVAILABLE');
});
test('focus event buffer is bounded and other interactive focus is distinguished without identifiers',async()=>{
 const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target);f.doc.activeElement={id:'PRIVATE_CONTROL',textContent:'PRIVATE_TEXT'};
 for(let i=0;i<100;i++)f.event('dfocusin');const result=await observer.snapshot('after_switch');assert.equal(result.events.length,64);assert.equal(result.capped,true);assert.equal(result.state.active_kind,'other');assert(!JSON.stringify(result).includes('PRIVATE'));await observer.finish();
});
