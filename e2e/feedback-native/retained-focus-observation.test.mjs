import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
import {beginRetainedFocusObservation} from './retained-focus-observation.mjs';
function fixture(){
 const listeners=new Map(),calls=[],input={isConnected:true,disabled:false,readOnly:false,get value(){throw Error('content forbidden');},get selectionStart(){throw Error('selection forbidden');},focus(){assert.fail('no focus input');},getBoundingClientRect:()=>({width:10,height:10})};
 let currentInput=input,modal=false;const doc={body:{},documentElement:{},activeElement:input,hasFocus:()=>true,visibilityState:'visible',querySelector:()=>currentInput,querySelectorAll:()=>modal?[{getClientRects:()=>[{}]}]:[]},win={};
 const add=kind=>(name,fn)=>{const key=kind+name;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);},remove=kind=>(name,fn)=>listeners.get(kind+name)?.delete(fn);
 doc.addEventListener=add('d');doc.removeEventListener=remove('d');win.addEventListener=add('w');win.removeEventListener=remove('w');const style=()=>({display:'block',visibility:'visible'}),context=vm.createContext({document:doc,window:win,getComputedStyle:style});
 let loader='L';const target={info:{id:'T',url:'https://owned.invalid/hypeproof-chat?id=owned-frame'},ownedWorkbenchId:'W',ownedFrameId:'F',ownedLoaderId:'L',contextId:5,send:async(method,args)=>{calls.push({surface:'inner',method,context:args.contextId});if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'F',loaderId:loader}}};assert.equal(method,'Runtime.evaluate');assert.equal(args.contextId,5,'original context retained');return{result:{value:vm.runInContext(args.expression,context)}};}};
 const iframe={name:'owned-frame',getBoundingClientRect:()=>({width:100,height:100})},quick={getBoundingClientRect:()=>({width:0,height:0}),closest:()=>true};
 const hostDoc={body:{},documentElement:{},activeElement:iframe,hasFocus:()=>true,visibilityState:'visible',querySelectorAll:()=>[iframe],querySelector:()=>quick},hostWin={};
 hostDoc.addEventListener=add('hd');hostDoc.removeEventListener=remove('hd');hostWin.addEventListener=add('hw');hostWin.removeEventListener=remove('hw');const hostContext=vm.createContext({document:hostDoc,window:hostWin,getComputedStyle:style});let hostLoader='HL';
 const host={info:{id:'W'},send:async(method,args)=>{calls.push({surface:'host',method});if(method==='Page.getFrameTree')return{frameTree:{frame:{id:'HF',loaderId:hostLoader}}};if(method==='Page.createIsolatedWorld')return{executionContextId:7};assert.equal(method,'Runtime.evaluate');assert.equal(args.contextId,7,'captured host context retained');return{result:{value:vm.runInContext(args.expression,hostContext)}};}};
 return{ui:{workbenchId:'W',targets:new Map([['W',host]])},target,doc,win,input,calls,listeners,hostDoc,hostWin,iframe,quick,event:(key,event)=>{for(const fn of listeners.get(key)??[])fn(event??{target:doc.activeElement});},replace:()=>{loader='REPLACED';},replaceHost:()=>{hostLoader='REPLACED';},replaceInput:()=>{currentInput=Object.create(input);},showModal:()=>{modal=true;}};
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
  assert.equal((await observer.snapshot('after_switch')).status,'UNAVAILABLE');assert(!f.calls.slice(before).some(c=>c.method==='Runtime.evaluate'&&c.surface==='inner'));
  assert.equal((await observer.finish()).listeners_removed,false);
 }
 const missing=await beginRetainedFocusObservation({workbenchId:'W'},null);assert.equal((await missing.snapshot('before_secondary')).status,'UNAVAILABLE');
});
test('focus event buffer is bounded and other interactive focus is distinguished without identifiers',async()=>{
 const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target);f.doc.activeElement={id:'PRIVATE_CONTROL',textContent:'PRIVATE_TEXT'};
 for(let i=0;i<100;i++){f.event('dfocusin');f.event('hdfocusin',{target:f.doc.activeElement});}const result=await observer.snapshot('after_switch');assert.equal(result.events.length,64);assert.equal(result.capped,true);assert.equal(result.host.events.length,64);assert.equal(result.host.capped,true);assert.equal(result.state.active_kind,'other');assert(!JSON.stringify(result).includes('PRIVATE'));await observer.finish();
});

test('paired host/inner snapshots distinguish picker focus from a retained inner BODY loss',async()=>{
 const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target);
 f.doc.hasFocus=()=>false;f.doc.activeElement=f.doc.body;f.event('wblur');
 f.hostDoc.activeElement=f.quick;f.quick.getBoundingClientRect=()=>({width:100,height:30});f.event('hdfocusin',{target:f.quick,relatedTarget:f.iframe});
 let result=await observer.snapshot('before_switch');assert.equal(result.host.status,'OBSERVED');assert.equal(result.host.state.active_kind,'quick_input');assert.equal(result.host.state.quick_input_visible,true);assert.equal(result.state.document_focused,false);
 f.hostDoc.activeElement=f.iframe;f.quick.getBoundingClientRect=()=>({width:0,height:0});f.event('hdfocusin',{target:f.iframe,relatedTarget:f.quick});result=await observer.snapshot('switch_refused');assert.equal(result.host.state.active_kind,'owned_iframe');assert.equal(result.host.state.document_focused,true);assert.equal(result.state.active_kind,'body');assert.equal(result.state.document_focused,false);assert.equal(result.guard_eligibility,'NOT_OBSERVED; signals are DOM events, not internal owner/epoch state');
 const cleanup=await observer.finish();assert.equal(cleanup.listeners_removed,true);assert.equal(cleanup.host_cleanup.listeners_removed,true);assert([...f.listeners.values()].every(s=>s.size===0));
});
test('guard event categories and input replacement are metadata only, never key or content capture',async()=>{
 const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target),other={id:'SECRET_ID',textContent:'SECRET_TEXT'};
 f.event('dfocusout',{target:f.input,relatedTarget:other});f.event('dpointerdown',{target:other});f.event('dkeydown',{target:f.input,key:'Tab'});f.event('dkeydown',{target:f.input,key:'Escape'});f.event('dkeydown',{target:f.input,key:'SECRET_TYPED_KEY'});f.input.readOnly=true;f.replaceInput();f.showModal();
 const result=await observer.snapshot('switch_refused');assert.equal(result.state.current_input_is_captured,false);assert.equal(result.state.captured_input_connected,true);assert.equal(result.state.input_readonly,true);assert.equal(result.state.modal_visible,true);assert.deepEqual(Array.from(result.events,e=>e.owner_revocation_signal),['none','focus_to_other','pointer_other','tab','escape']);assert(!JSON.stringify(result).includes('SECRET'));assert(!JSON.stringify(result).includes('selection'));
 await observer.finish();
});
test('host diagnostic scope loss cannot adopt a new page or change retained inner observation',async()=>{
 const f=fixture(),observer=await beginRetainedFocusObservation(f.ui,f.target);f.replaceHost();const before=f.calls.length,result=await observer.snapshot('after_switch');assert.equal(result.status,'OBSERVED');assert.equal(result.host.status,'UNAVAILABLE');assert(!f.calls.slice(before).some(c=>c.surface==='host'&&c.method==='Runtime.evaluate'));const cleanup=await observer.finish();assert.equal(cleanup.listeners_removed,true);assert.equal(cleanup.host_cleanup.listeners_removed,false);
});
test('actual b28 one-return-then-blur sequence does not invent a second inner focus event',()=>{
 const source=readFileSync(new URL('../../extensions/hypeproof-chat/webview-ui/src/retainedComposerFocus.ts',import.meta.url),'utf8');
 const code=stripTypeScriptTypes(source).replace('export function bindRetainedComposerFocus','function bindRetainedComposerFocus')+'\nthis.bind=bindRetainedComposerFocus;';
 const listeners=new Map(),frames=new Map();let seq=0,foreground=true,focuses=0;
 const events=owner=>({addEventListener(type,fn){const k=owner+type;if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(fn);},removeEventListener(type,fn){listeners.get(owner+type)?.delete(fn);}});
 const win={...events('w'),requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame(id){frames.delete(id);}},doc={...events('d'),body:{},documentElement:{},defaultView:win,visibilityState:'visible',hasFocus:()=>foreground,querySelectorAll:()=>[]};
 const input={ownerDocument:doc,isConnected:true,disabled:false,readOnly:false,getClientRects:()=>[{}],focus(){focuses++;doc.activeElement=input;}};doc.activeElement=input;const context=vm.createContext({});vm.runInContext(code,context);const stop=context.bind(input,()=>true),emit=(key,event={})=>{for(const fn of listeners.get(key)??[])fn(event);},flush=()=>{const work=[...frames.values()];frames.clear();for(const fn of work)fn();};
 foreground=false;emit('wblur');foreground=true;emit('wfocus');flush();assert.equal(doc.activeElement,input);doc.activeElement=doc.body;emit('dfocusout',{target:input,relatedTarget:null});foreground=false;emit('wblur');flush();assert.equal(focuses,0);assert.equal(doc.activeElement,doc.body);assert.equal(foreground,false,'a foreground host does not imply inner document focus');
 foreground=true;emit('wfocus');flush();assert.equal(focuses,1,'only a later eligible inner return can restore the retained composer');stop();assert([...listeners.values()].every(s=>s.size===0));assert.equal(frames.size,0);
});
