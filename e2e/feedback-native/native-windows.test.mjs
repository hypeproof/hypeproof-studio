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
