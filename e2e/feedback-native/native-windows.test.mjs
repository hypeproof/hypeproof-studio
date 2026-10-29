import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {NativeUI} from './native-ui.mjs';
import {setShellLocale,shellLocale} from '../fixtures/shell-labels.mjs';
import {ownedWindowPrerequisite,newOwnedWorkbench} from './native-windows.mjs';
test('two-window ownership refuses local/attach/wrong receipt/linked roots before any input',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-window-guards-'));
 try{const data=path.join(dir,'profile'),workspace=Object.fromEntries(['a','b','c'].map(n=>[n,path.join(dir,n)]));for(const p of[data,...Object.values(workspace)])fs.mkdirSync(p);
 const c={attach:false,userDataDir:data,workspace,candidate:{receipt:path.join(dir,'receipt')}};const marker={schema:'hps-feedback-owned-profile/1',receipt:c.candidate.receipt,workspaces:workspace};fs.writeFileSync(path.join(data,'feedback-owner.json'),JSON.stringify(marker));const env={GITHUB_ACTIONS:'true',RUNNER_TEMP:dir};assert.deepEqual(ownedWindowPrerequisite(c,env),{hosted:true,owned:true});
 assert.throws(()=>ownedWindowPrerequisite(c,{}),/hosted/);assert.throws(()=>ownedWindowPrerequisite({...c,attach:true},env),/hosted/);assert.throws(()=>ownedWindowPrerequisite({...c,candidate:{receipt:'wrong'}},env));
 const alias=path.join(dir,'alias');fs.symlinkSync(workspace.a,alias,process.platform==='win32'?'junction':'dir');marker.workspaces={...workspace,c:alias};fs.writeFileSync(path.join(data,'feedback-owner.json'),JSON.stringify(marker));assert.throws(()=>ownedWindowPrerequisite({...c,workspace:marker.workspaces},env),/distinct physical/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('new window must be one newly observed workbench and preserve original ID',()=>{
 const w=id=>({id,type:'page',url:'vscode-file://workbench.html'});assert.equal(newOwnedWorkbench(['A'],[w('B'),w('A')]).id,'B');
 for(const pages of [[w('A')],[w('B'),w('C')],[w('A'),w('B'),w('C')],[w('A'),{...w('B'),type:'iframe'}]])assert.throws(()=>newOwnedWorkbench(['A'],pages));
});
test('other-window observation rejects wrong frame/root/draft/binding/files rather than counting presence',async()=>{
 const {assertUnchangedOtherWindow}=await import('./native-windows.mjs');
 const expected={workbenchId:'C-window',frameId:'C-chat',draft:'independent-B',bindingHash:'binding-original',files:[['original.txt','hash']]};
 const actual={...expected,inExpectedRoot:true};assertUnchangedOtherWindow(expected,actual);
 for(const changed of [{workbenchId:'A-window'},{frameId:'new-chat'},{draft:'A-draft'},{bindingHash:'changed'},{files:[]},{inExpectedRoot:false}])assert.throws(()=>assertUnchangedOtherWindow(expected,{...actual,...changed}));
});
test('public Switch Window starts in focused owner and selects complete observed destination title',async()=>{
 const {switchOwnedWindow}=await import('./native-windows.mjs');const events=[];let sourceFocus=true,targetFocus=false;
 const from={workbenchId:'C',endpoint:'http://127.0.0.1:9777',workbench:async()=>({evaluate:async()=>sourceFocus}),palette:async title=>events.push(['palette',title]),quick:async title=>{events.push(['quick',title]);targetFocus=true;sourceFocus=false;}};
 const to={workbenchId:'A',endpoint:from.endpoint,workbench:async()=>({evaluate:async expression=>expression==='document.title'?'[DEV] Chat — A 전체 경로':targetFocus})};
 const previous=shellLocale();
 try{
  for(const [locale,label]of [['ko','창 전환'],['en','Switch Window...']]){
   setShellLocale(locale);sourceFocus=true;targetFocus=false;events.length=0;
   await switchOwnedWindow(from,to);assert.deepEqual(events,[['palette',label],['quick','[DEV] Chat — A 전체 경로']]);
  }
 }finally{setShellLocale(previous);}
 events.length=0;await switchOwnedWindow(from,to);assert.deepEqual(events,[],'already focused target is observation only');
 targetFocus=false;await assert.rejects(switchOwnedWindow(from,to),/actually focused/);assert.deepEqual(events,[]);
 await assert.rejects(switchOwnedWindow(from,{...to,workbenchId:'C'}),/distinct/);
 await assert.rejects(switchOwnedWindow(from,{...to,endpoint:'http://127.0.0.1:9999'}),/distinct/);
});
test('diagnostics precede cleanup; cleanup and screenshot failure cannot mask first failure',async()=>{
 const {finishOwnedWindows}=await import('./native-windows.mjs');const events=[],proof={},primary=Error('original focus failure');
 await assert.rejects(finishOwnedWindows({primary,proof,observe:async()=>{events.push('capture');throw Error('screenshot unavailable');},cleanup:async()=>{events.push('cleanup');throw Error('secondary close failed');},persist:()=>events.push('persist')}),error=>error===primary);
 assert.deepEqual(events,['capture','cleanup','persist']);assert.equal(proof.diagnostic_error,'screenshot unavailable');assert.equal(proof.cleanup_error,'secondary close failed');
 await assert.rejects(finishOwnedWindows({proof:{},observe:async()=>{},cleanup:async()=>{throw Error('cleanup only');},persist:()=>{}}),/cleanup only/);
 let cleaned=false;await finishOwnedWindows({proof:{},observe:async()=>{},cleanup:async()=>{cleaned=true;},persist:()=>{}});assert.equal(cleaned,true);
});
test('existing binding selection permits only drive-letter spelling and verifies actual Service/activity identity',async()=>{
 const {selectOwnedBinding}=await import('./native-windows.mjs');const {createHash}=await import('node:crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-binding-')),activity='b'.repeat(64),service='http://127.0.0.1:9888/v1';
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const record={version:1,id:hash(JSON.stringify([service,activity])),ref:'hps.activity.credential.existing-synthetic'};
 const upper='D:\\owned\\C',lower='d:\\owned\\C',file=root=>path.join(dir,hash(root)+'.json');
 const write=(root,value=record)=>fs.writeFileSync(file(root),JSON.stringify(value));
 try{
  write(lower);const bytes=fs.readFileSync(file(lower));
  for(const root of [upper,lower,'D:/owned/C'])assert.deepEqual(selectOwnedBinding(dir,root,service+'/',activity,'win32'),{file:file(lower),sha256:hash(bytes)});
  assert.deepEqual(fs.readFileSync(file(lower)),bytes,'read-only selection preserves original bytes');
  for(const root of ['E:\\owned\\C','D:\\owned','D:\\owned\\C-child','D:\\owned\\c','C'])assert.throws(()=>selectOwnedBinding(dir,root,service,activity,'win32'));
  for(const [wrongService,wrongActivity]of [[service,'a'.repeat(64)],['http://127.0.0.1:9889/v1',activity]])assert.throws(()=>selectOwnedBinding(dir,upper,wrongService,wrongActivity,'win32'),/Service and activity/);
  for(const invalid of [{...record,version:0},{...record,ref:'not-a-credential'},{...record,ref:'hps.activity.credential.'},{...record,ref:'hps.activity.credential.bad ref'}]){write(lower,invalid);assert.throws(()=>selectOwnedBinding(dir,upper,service,activity,'win32'));}
  write(lower);write(upper);assert.throws(()=>selectOwnedBinding(dir,upper,service,activity,'win32'),/Exactly one/);fs.rmSync(file(upper));
  fs.rmSync(file(lower));const target=path.join(dir,'outside-record');fs.writeFileSync(target,JSON.stringify(record));fs.symlinkSync(target,file(lower));assert.throws(()=>selectOwnedBinding(dir,upper,service,activity,'win32'),/non-linked/);fs.rmSync(file(lower));
  fs.mkdirSync(file(lower));assert.throws(()=>selectOwnedBinding(dir,upper,service,activity,'win32'),/non-linked/);fs.rmdirSync(file(lower));
  const real=path.join(dir,'physical');fs.mkdirSync(real);const physical=fs.realpathSync(real);write(physical);assert.equal(selectOwnedBinding(dir,physical,service,activity).file,file(physical));
  assert.throws(()=>selectOwnedBinding(dir,path.dirname(real),service,activity),/Exactly one/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('switch before a chat command waits for actual retained composer focus, including already focused host; refusal sends no next command',async()=>{
 const {switchOwnedWindow}=await import('./native-windows.mjs');const events=[];let focused=false,release,observed;const observing=new Promise(resolve=>{observed=resolve;});
 const from={workbenchId:'C',endpoint:'http://127.0.0.1:9777',workbench:async()=>({evaluate:async()=>true}),palette:async()=>events.push('switch'),quick:async()=>{focused=true;}};
 const to={workbenchId:'A',endpoint:from.endpoint,workbench:async()=>({evaluate:async expression=>expression==='document.title'?'complete observed A title':focused}),restoredFocus:async()=>{events.push('observe-composer');observed();await new Promise(resolve=>{release=resolve;});}};
 const pending=switchOwnedWindow(from,to,{observeChatFocus:true}).then(()=>events.push('next-command-admitted'));
 await Promise.race([observing,pending.then(()=>assert.fail('next command admitted without observing composer'))]);
 assert.deepEqual(events,['switch','observe-composer'],'host focus alone cannot admit the next F1');release();await pending;
 assert.deepEqual(events,['switch','observe-composer','next-command-admitted']);
 events.length=0;to.restoredFocus=async()=>{events.push('refused-composer');throw Error('retained composer not focused');};
 await assert.rejects(switchOwnedWindow(from,to,{observeChatFocus:true}),/retained composer not focused/);
 assert.deepEqual(events,['refused-composer'],'already focused host cannot bypass the observation or issue another switch');
});

function secondaryReturnFixture(){
 const ui=new NativeUI('http://127.0.0.1:9777','A'),events=[],retained={workbench:'A',target:'A-chat',frame:'A-frame',loader:'A-loader'};
 let restored=false,hidden=false,foreign=false,closed=false;
 const info={id:retained.target,type:'iframe',url:'https://owned.invalid/hypeproof-chat?id=A-owned'};
 const chat={info,send:async()=>({frameTree:{frame:{id:retained.frame,loaderId:retained.loader}}}),evaluate:async()=>({present:true,connected:true,enabled:true,visible:!hidden,documentFocused:restored,inputFocused:restored})};
 ui.targets.set(info.id,chat);ui.list=async()=>[info];ui.workbench=async()=>({info:{id:foreign?'foreign':retained.workbench},evaluate:async()=>({sameOwner:true,visible:!hidden,focused:restored})});
 // Drive the real palette sequence; the injected native return collapses its
 // already-ready input before typing, matching the observed readiness transition.
 let quick={visible:false};ui.focusWorkbench=async()=>{};ui.quickState=async()=>quick;
 ui.key=async(_target,key)=>{assert.equal(key,'F1');events.push('F1');quick={visible:true,ready:true,mode:'command',value:'>'};};
 ui.input=async(_target,_selector,value)=>{if(!restored){quick={visible:false};throw Error('native return closed the newly opened palette before typing');}events.push('query');quick.value=value;};
 ui.choiceSelector=async()=>'.exact';ui.press=async()=>{quick={visible:false};};
 const other={workbenchId:'C',endpoint:ui.endpoint,closeOwnedWindow:async()=>{assert(!closed,'close once');closed=true;events.push('secondary-closed');restored=false;}};
 return{ui,other,retained,events,chat,ready(){restored=true;},hide(){hidden=true;},foreign(){foreign=true;},get closed(){return closed;}};
}
test('secondary close waits for the exact delayed native return before the next single F1',async()=>{
 const {closeSecondaryAndObserveOriginal}=await import('./native-windows.mjs');
 const old=secondaryReturnFixture();await old.other.closeOwnedWindow();await assert.rejects(old.ui.palette(),/native return closed/,'old immediate next command reproduces readiness failure');
 const f=secondaryReturnFixture();let sampled;const first=new Promise(r=>sampled=r),evaluate=f.chat.evaluate;f.chat.evaluate=async()=>{const value=await evaluate();sampled();return value;};
 const pending=(async()=>{const proof=await closeSecondaryAndObserveOriginal(f.ui,f.other,f.retained);await f.ui.palette();return proof;})();
 await first;assert.deepEqual(f.events,['secondary-closed']);f.ready();const proof=await pending;assert.equal(proof.original_return_observed,true);assert.equal(proof.focus_repaired,false);assert.deepEqual(f.events,['secondary-closed','F1','query']);
});
test('secondary return handles ready focus and refuses foreign/hidden/deadline without another input',async()=>{
 const {closeSecondaryAndObserveOriginal}=await import('./native-windows.mjs');
 const ready=secondaryReturnFixture(),close=ready.other.closeOwnedWindow;ready.other.closeOwnedWindow=async()=>{await close();ready.ready();};await closeSecondaryAndObserveOriginal(ready.ui,ready.other,ready.retained);await ready.ui.palette();assert.deepEqual(ready.events,['secondary-closed','F1','query']);
 for(const change of ['foreign','hide','pending']){
  const f=secondaryReturnFixture();const close=f.other.closeOwnedWindow;f.other.closeOwnedWindow=async()=>{await close();if(change!=='pending')f.ready();if(change!=='pending')f[change]();};
  await assert.rejects(closeSecondaryAndObserveOriginal(f.ui,f.other,f.retained,{timeout:25}),/Retained sidebar return readiness failed/);assert.deepEqual(f.events,['secondary-closed']);
 }
 const foreign=secondaryReturnFixture();await assert.rejects(closeSecondaryAndObserveOriginal(foreign.ui,foreign.other,{...foreign.retained,workbench:'foreign'}),/exact owned window/);assert.deepEqual(foreign.events,[]);
 const stalled=secondaryReturnFixture();stalled.ui.list=()=>new Promise(()=>{});const began=Date.now();await assert.rejects(closeSecondaryAndObserveOriginal(stalled.ui,stalled.other,stalled.retained,{timeout:25}),/Retained sidebar return readiness failed/);assert(Date.now()-began<300);assert.deepEqual(stalled.events,['secondary-closed']);
});
test('failed main path closes the owned secondary without claiming an unobserved original return',async()=>{
 const {closeSecondaryAndObserveOriginal}=await import('./native-windows.mjs');const f=secondaryReturnFixture();assert.deepEqual(await closeSecondaryAndObserveOriginal(f.ui,f.other,undefined),{secondary_closed:true,original_return_observed:false});assert.deepEqual(f.events,['secondary-closed']);
 const source=fs.readFileSync(new URL('./native-windows.mjs',import.meta.url),'utf8');assert(source.includes('await ui.restoredDraft(draft);await observeOther();returnChat=await ui.chatDocumentIdentity()'));assert(source.includes('closeSecondaryAndObserveOriginal(ui,other,returnChat'));
});
