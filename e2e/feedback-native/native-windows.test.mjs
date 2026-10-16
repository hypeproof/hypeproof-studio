import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
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
 await switchOwnedWindow(from,to);assert.deepEqual(events,[['palette','Switch Window...'],['quick','[DEV] Chat — A 전체 경로']]);
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
