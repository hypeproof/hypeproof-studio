import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {delayedFailure,DELAYED_STAGES,EXPIRY_MESSAGE,delayedPrerequisite,delayedHistoryPrerequisite,stageObservation,checkExpiredActivation,checkDelayedDestination} from './delayed-activation.mjs';
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


test('configured history chain must complete before any delayed inspector or UI admission',()=>{
 const ids=['T03-native-scripted-history-persistence','T06-native-stream-block-and-stop','T06-native-stream-normal-quit-recovery','T06-native-stream-direct-file-open','T06-native-revoked-credential-no-auto-execution'];const complete=ids.map(id=>({id,status:'PASS'})),config={scenarios:['history-streaming']};let entered=0;
 const admission=tests=>{delayedHistoryPrerequisite(config,tests);entered++;};
 for(const id of ids)for(const status of ['FAIL','BLOCKED','NOT_RUN','missing']){const tests=complete.filter(t=>t.id!==id);if(status!=='missing')tests.push({id,status});const before=JSON.stringify(tests);assert.throws(()=>admission(tests),error=>error.blocked===true&&error.message.includes(id));assert.equal(JSON.stringify(tests),before);}
 assert.equal(entered,0,'No inspector or UI continuation on any incomplete prerequisite');admission(complete);assert.equal(entered,1);assert.equal(delayedHistoryPrerequisite({scenarios:['folders']},[]),undefined,'Unconfigured history is not invented');
 const source=fs.readFileSync(new URL('./run.mjs',import.meta.url),'utf8'),section=source.slice(source.indexOf("await step('T05-owned-delayed-activation-and-real-expiry'"));assert(section.indexOf('delayedHistoryPrerequisite(c,report.tests)')<section.indexOf('await ui.assertNoDirtyEditors()'));assert(section.indexOf('delayedHistoryPrerequisite(c,report.tests)')<section.indexOf('await runDelayedActivation('));
});


test('passive expiry retains exact bytes; explicit recovery permits only a valid ref rotation with identical binding identity and files',()=>{
 const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'delayed-binding-'))),root=path.join(base,'owned'),directory=path.join(base,'bindings');fs.mkdirSync(root);fs.mkdirSync(directory);
 const hash=value=>createHash('sha256').update(value).digest('hex'),service='http://127.0.0.1:9888/v1',activityId='a'.repeat(64),file=path.join(directory,hash(root)+'.json');
 const original={version:1,id:hash(JSON.stringify([service,activityId])),ref:'hps.activity.credential.'+randomUUID()},write=record=>fs.writeFileSync(file,JSON.stringify(record));write(original);
 const binding={file,sha256:hash(fs.readFileSync(file))},workspaceFiles=folder=>Object.fromEntries(fs.readdirSync(folder).map(name=>[name,hash(fs.readFileSync(path.join(folder,name)))])),options={directory,root,service,activityId,binding,files:{},workspaceFiles};
 try{
  assert.equal(checkDelayedDestination(options),binding.sha256);
  const recovered={...original,ref:'hps.activity.credential.'+randomUUID()};write(recovered);
  assert.throws(()=>checkDelayedDestination(options),/before explicit recovery/,'No ref change may precede explicit admission');const changed=checkDelayedDestination({...options,explicitRecovery:true});assert.notEqual(changed,binding.sha256);
  for(const delta of [{id:'b'.repeat(64)},{version:0},{ref:'hps.activity.credential.not-a-uuid'},{ref:'hps.activity.credential.'},{ref:'private-invalid-ref'}]){write({...recovered,...delta});assert.throws(()=>checkDelayedDestination({...options,explicitRecovery:true}));assert.throws(()=>checkDelayedDestination(options));}
  write(recovered);for(const delta of [{service:'http://127.0.0.1:9889/v1'},{activityId:'b'.repeat(64)},{binding:{...binding,file:path.join(directory,'another.json')}}])assert.throws(()=>checkDelayedDestination({...options,...delta,explicitRecovery:true}));
  const otherRoot=path.join(base,'other');fs.mkdirSync(otherRoot);fs.writeFileSync(path.join(directory,hash(otherRoot)+'.json'),JSON.stringify(recovered));assert.throws(()=>checkDelayedDestination({...options,root:otherRoot,explicitRecovery:true}),/binding path/);
  fs.writeFileSync(path.join(root,'unexpected'),'changed');for(const explicitRecovery of [false,true]){write(original);assert.throws(()=>checkDelayedDestination({...options,explicitRecovery}),/Destination files preserved/);}fs.rmSync(path.join(root,'unexpected'));
  const outside=path.join(base,'outside-binding');fs.renameSync(file,outside);fs.symlinkSync(outside,file);for(const explicitRecovery of [false,true])assert.throws(()=>checkDelayedDestination({...options,explicitRecovery}),/non-linked/);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
 const source=fs.readFileSync(new URL('./delayed-activation.mjs',import.meta.url),'utf8'),section=source.slice(source.indexOf("if(stage.name==='real-expiry'){",source.indexOf('runDelayedActivation')));
 assert(section.indexOf('item.binding_sha256=checkDelayedDestination')<section.indexOf('await ui.savedActivity'));
 assert(section.indexOf('item.recovered_binding_sha256=checkDelayedDestination')>section.indexOf("await ui.press(view,'.studio-primary')"));
});

test('early ownership failure stays primary when restart observation also fails',()=>{
 const proof={},ownership=Error('Cannot establish inspector listener ownership'),restart=Error('private restored UI timeout');
 assert.equal(delayedFailure(proof,restart,ownership),ownership);
 assert.deepEqual(proof.secondary_failure,{phase:'startup_restart_observation',error_type:'Error',message_sha256:createHash('sha256').update(restart.message).digest('hex')});
 assert(!JSON.stringify(proof).includes('private'));
 for(const [p,caught,gate] of [[{},restart,null],[{},ownership,ownership],[{initial_owned_startup:true},restart,ownership]]){
  assert.equal(delayedFailure(p,caught,gate),caught);assert(!p.secondary_failure);
 }
});
