import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DELAYED_STAGES,EXPIRY_MESSAGE,delayedPrerequisite,stageObservation} from './delayed-activation.mjs';
test('reviewed stages require actual2s/61s/610s and exact expiry notification, Start and no automatic chat',()=>{
 assert.deepEqual(DELAYED_STAGES.map(s=>s.holdMs),[2000,61000,610000]);
 stageObservation(DELAYED_STAGES[1],{draft:'actual',expectedDraft:'actual'});assert.throws(()=>stageObservation(DELAYED_STAGES[1],{draft:'',expectedDraft:'actual'}));
 const observed={notification:EXPIRY_MESSAGE,startVisible:true,chatVisible:false};stageObservation(DELAYED_STAGES[2],observed);
 for(const delta of[{notification:'some expired message'},{notification:'prefix '+EXPIRY_MESSAGE},{startVisible:false},{chatVisible:true}])assert.throws(()=>stageObservation(DELAYED_STAGES[2],{...observed,...delta}));
});
test('delayed gate defaults off and refuses local/attach/inmemory/nonfresh or wrong ownership',()=>{
 assert.equal(delayedPrerequisite({}),false);const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'delayed-owner-')));
 try{
  const c={candidate:{app:path.join(dir,'app'),receipt:path.join(dir,'receipt.json')},userDataDir:path.join(dir,'data'),workspace:Object.fromEntries(['a','b','c','d','e','f','g'].map(k=>[k,path.join(dir,k)])),scenarios:['folders','session-ended'],secretStorage:'os-keychain',delayedActivation:{enabled:true,inspectorPort:9788}};
  for(const p of[c.candidate.app,c.userDataDir,...Object.values(c.workspace)])fs.mkdirSync(p);fs.writeFileSync(path.join(c.userDataDir,'feedback-owner.json'),JSON.stringify({receipt:c.candidate.receipt,workspaces:c.workspace}));
  const env={GITHUB_ACTIONS:'true',RUNNER_TEMP:dir};assert.equal(delayedPrerequisite(c,env),true);
  for(const delta of[{attach:true},{secretStorage:'inmemory'},{delayedActivation:{enabled:true,inspectorPort:9229}}])assert.throws(()=>delayedPrerequisite({...c,...delta},env));assert.throws(()=>delayedPrerequisite(c,{}));
  fs.writeFileSync(path.join(c.workspace.e,'already-used'),'original');assert.throws(()=>delayedPrerequisite(c,env),/initially empty/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
