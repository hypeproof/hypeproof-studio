import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DELAYED_STAGES,EXPIRY_MESSAGE,delayedPrerequisite,stageObservation,checkExpiredActivation} from './delayed-activation.mjs';
test('expiry failure preserves exact UI facts and sanitized request boundaries before the unchanged gate rejects',()=>{
 const baseline=[{seq:1,method:'GET',path:'/v1/profile',subject:'A',status:200}],read={seq:2,method:'GET',path:'/v1/profile',subject:'A',status:200,request_id:'synthetic-request',authorization:'never-record',body:'never-record'};
 const observed={notification:EXPIRY_MESSAGE,startVisible:true,chatVisible:false,uiTimes:{notification:610120,start:610130,chat_probe_started:610140,chat_probe_finished:610180,privateText:'never-record'},callsAtPause:baseline,callsAfter:[...baseline,read],baselineAt:100,releasedAt:610100,observedAt:610200};
 for(const delta of [{},{notification:'wrong notification'},{startVisible:false},{chatVisible:true}]){
  const item={status:'RUNNING'},snapshots=[];
  assert.throws(()=>checkExpiredActivation(item,{...observed,...delta},()=>snapshots.push(structuredClone(item))));
  assert.equal(snapshots.length,1,'Failure must retain the observation before an assertion throws');assert.equal(snapshots[0].status,'RUNNING','Recording observations must not claim acceptance');
  assert.equal(snapshots[0].request_boundary.baseline_last_seq,1);assert.equal(snapshots[0].request_boundary.snapshot_last_seq,2);assert.equal(snapshots[0].request_boundary.released_at_ms,610100);assert.equal(snapshots[0].request_boundary.observed_at_ms,610200);
  assert.deepEqual(snapshots[0].ui_observed_at_ms,{notification:610120,start:610130,chat_probe_started:610140,chat_probe_finished:610180});
  assert.equal(snapshots[0].no_automatic_profile_connection,false);assert.equal(snapshots[0].expiry_notification,delta.notification??EXPIRY_MESSAGE);assert.equal(snapshots[0].start_visible,delta.startVisible??true);assert.equal(snapshots[0].no_automatic_chat,!(delta.chatVisible??false));
  assert.deepEqual(snapshots[0].activation_requests,[{seq:2,method:'GET',path:'/v1/profile',subject:'A',status:200,request_id:'synthetic-request'}]);assert(!JSON.stringify(snapshots).includes('never-record'));
 }
 const item={};checkExpiredActivation(item,{...observed,callsAfter:[...baseline,{seq:2,method:'GET',path:'/v1/purchase/products',subject:'unknown',status:404}]},()=>{});assert.equal(item.no_automatic_profile_connection,true,'Existing baseline profile read is outside the new activation window');
 assert.equal(item.activation_requests.length,1);assert.equal(item.no_automatic_chat,true);assert.equal(item.start_visible,true);
});
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
