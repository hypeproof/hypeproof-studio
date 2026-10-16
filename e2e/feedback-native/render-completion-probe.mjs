#!/usr/bin/env node
// Real SDK/Service/BrowserControl and durable guard; scripted responses, provider zero.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {runtimeEnvironment} from './hosted-shell.mjs';
import {sourceSnapshot,sha256} from './safety.mjs';
import {compatibilityEnvironment} from '../unified-release/output-bound.mjs';
import {startRenderHost,renderProfile,screenshotReservationClient} from '../feedback-live/render-host.mjs';
import {createCompletionSession,completionDecision,completionFeedback,completionHoldClient} from '../feedback-live/render-completion.mjs';
import {PINNED_APP_BUNDLES} from '../feedback-live/trace.mjs';
import {digest} from '../feedback-live/guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),[evidence,binary,onlyMode]=process.argv.slice(2);
assert(path.isAbsolute(evidence??'')&&path.isAbsolute(binary??''));assert(!fs.existsSync(evidence));fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-completion-proof-')),dependencyRoot=path.join(root,'extensions/hypeproof-chat');
const require=createRequire(path.join(dependencyRoot,'package.json')),esbuild=require('esbuild'),sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);
const fixtureFiles=['e2e/feedback-live/guard.mjs','e2e/feedback-live/render-completion.mjs','e2e/feedback-live/render-host.mjs','e2e/feedback-native/service.mjs','e2e/feedback-native/completion-upstream.mjs','e2e/feedback-native/render-completion-probe.mjs'];
const report={fixture_sha256:Object.fromEntries(fixtureFiles.map(f=>[f,sha256(path.join(root,f))])),schema:'hps-render-completion-probe/1',status:'RUNNING',source:sourceSnapshot(root),provider_called:false,native_ui:'NOT_RUN',sdk_binary_sha256:sha256(binary),cases:[]};
const save=()=>fs.writeFileSync(path.join(evidence,'probe.json'),JSON.stringify(report,null,2));save();
const env=compatibilityEnvironment({...runtimeEnvironment(process.env),APPDATA:path.join(base,'app-data'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
const wait=async(fn,label)=>{const end=Date.now()+30000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out '+label);};
fs.symlinkSync(path.join(dependencyRoot,'node_modules'),path.join(base,'node_modules'),'dir');
await esbuild.build({absWorkingDir:root,entryPoints:Object.fromEntries([['sdk','sdkCoach.ts'],['proxy','proxyClient.ts'],['skills','externalInstructionSkills.ts'],['reference','referenceImages.ts'],['brief','referenceDesign.ts'],['policy','sdkCoachHelpers.ts']].map(([name,file])=>[name,path.join(root,'extensions/hypeproof-chat/src',file)])),outdir:base,bundle:true,platform:'node',format:'cjs',external:['@anthropic-ai/claude-agent-sdk','zod'],nodePaths:[path.join(dependencyRoot,'node_modules')],logLevel:'silent',plugins:[{name:'vscode-host-only-stub',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};',loader:'js'}));}}]});
report.app_bundles=Object.fromEntries(Object.keys(PINNED_APP_BUNDLES).map(n=>[n,sha256(path.join(base,n+'.js'))]));assert.deepEqual(report.app_bundles,PINNED_APP_BUNDLES);
const {runSdkCoach}=require(path.join(base,'sdk.js'));
try{
 for(const mode of (onlyMode?[onlyMode]:['positive','browser-error','builtin-error','denial','policy-denial','provider-error'])){
  assert(['positive','browser-error','builtin-error','denial','policy-denial','provider-error'].includes(mode));
  const caseDir=path.join(base,mode),workspace=path.join(caseDir,'work'),temp=path.join(caseDir,'runtime'),serviceDir=path.join(caseDir,'service'),out=path.join(evidence,mode);
  for(const p of[workspace,temp,serviceDir,out])fs.mkdirSync(p,{recursive:true,mode:0o700});
  fs.copyFileSync(path.join(root,'extensions/hypeproof-chat/test/fixtures/reference-design/keyboard.html'),path.join(workspace,'keyboard.html'));const sourceSha=sha256(path.join(workspace,'keyboard.html'));
  const activityId='synthetic-completion-'+mode,repetitionId='hps-render-20261016-r3-'+digest(mode).slice(0,32),session=createCompletionSession({hold:async()=>completionHoldClient({guard:{origin:manifest.scripted.origin,id:(await(await fetch(manifest.scripted.origin+'/__feedback/guard')).json()).guard_id,controlKeyFile:path.join(serviceDir,'completion-control')},activityId,repetitionId})()});let manifest,service,host,controller;
  const row={mode,status:'RUNNING',segments:[]};report.cases.push(row);save();
  try{
   host=await startRenderHost({root,workspace,evidence:out,temp,dependencyRoot,browserDependencyRoot:path.join(root,'e2e'),fatalToolErrors:true,onFatal:reason=>{controller?.abort();return session.fail(reason);},reserveScreenshot:async()=>screenshotReservationClient({guard:{origin:manifest.scripted.origin,id:(await state()).guard_id,controlKeyFile:path.join(serviceDir,'completion-control')},activityId,repetitionId})()});
   const view=host.setCandidate(['keyboard.html']);
   fs.writeFileSync(path.join(serviceDir,'render-config.json'),JSON.stringify({completion:true,origin:host.origin,workspace,activityId,repetitionId}));
   service=spawn(process.execPath,['--experimental-strip-types','--experimental-sqlite',path.join(root,'e2e/feedback-native/service.mjs'),serviceDir,'--scripted-render'],{cwd:root,env,stdio:['ignore','ignore','pipe']});const errors=[];service.stderr.on('data',b=>errors.push(b));
   await wait(()=>{assert(service.exitCode===null,'Service exited');return fs.existsSync(path.join(serviceDir,'service.json'));},'isolated Service');manifest=JSON.parse(fs.readFileSync(path.join(serviceDir,'service.json')));row.service=manifest.source;
   async function state(){return(await fetch(manifest.scripted.origin+'/__feedback/guard')).json();}
   const token=fs.readFileSync(manifest.token_a_file,'utf8'),headers={authorization:'Bearer '+token},profile=await(await fetch(manifest.origin+'/v1/profile',{headers})).json();
   let guard=await state();const proof=await fetch(manifest.origin+'/v1/messages/count_tokens',{method:'POST',headers:{...headers,'content-type':'application/json','anthropic-beta':'hps-feedback-route-proof-'+guard.route_nonce},body:JSON.stringify({model:'hypeproof-fast',messages:[{role:'user',content:'Owned route proof'}]})});assert.equal(proof.status,200);
   const armed=await fetch(manifest.scripted.origin+'/__feedback/arm',{method:'POST',headers:{'x-hps-guard-control':fs.readFileSync(path.join(serviceDir,'completion-control'),'utf8')},body:JSON.stringify({guard_id:guard.guard_id,activity_sha256:digest(activityId),nonce:guard.route_nonce})});assert.equal(armed.status,200);
   const deadline=Date.now()+90000;let feedback='HPS_COMPLETION_PROOF:'+mode;
   for(let segment=0;segment<2;segment++){
    guard=await state();const claim=await fetch(manifest.scripted.origin+'/__feedback/attempt',{method:'POST',body:JSON.stringify({guard_id:guard.guard_id,activity_sha256:digest(activityId)})});assert.equal(claim.status,200);
    controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));let answer='',error;
    try{const restricted=renderProfile(profile);if(segment)restricted.sdk_tools.write=false;
     await runSdkCoach({sdk:session.wrap(sdk,{resume:segment>0}),gatewayUrl:manifest.origin+'/v1',token,model:'hypeproof-fast',profile:restricted,browserHost:host.host,systemPrompt:'',history:[],userText:feedback,signal:controller.signal,cwd:workspace,binaryPathSetting:binary,turnId:'completion_'+mode+'_'+segment,stallTimeoutMs:30000,onDelta:x=>answer+=x,onCitations:()=>{},onAssetScore:()=>{},requestApproval:async action=>mode==='browser-error'?action.toolName==='mcp__hypeproof__browser_click':host.approveViewportClick(action)});
    }catch(e){error=e.name;}finally{clearTimeout(timer);await session.settle();}
    const after=await state(),captures=host.state.captures.map(c=>({...c,upstream_pixel_delivery:after.rows.some(r=>r.phase==='complete'&&r.status===200&&r.tool_result_image_sha256.includes(c.sha256))?'OBSERVED':'NOT_OBSERVED'}));
    row.actual_upstream_forward_calls=after.attempts;row.local_guard_held_rejections=after.completion?.blocked_requests??0;row.guard=after;row.observations=JSON.parse(fs.readFileSync(path.join(serviceDir,'completion-observations.json')));
    const decision=completionDecision({session:session.snapshot(),guard:after,host:host.state,captures,sourceSha,wrapperUrl:view.wrapperUrl,deadline});row.segments.push({error,session:session.snapshot(),decision,guard_attempts:after.attempts,candidate_claims:after.candidate_attempts,captures});save();
    assert.equal(sha256(path.join(workspace,'keyboard.html')),sourceSha);
    if(mode!=='positive'){
     assert(error||controller.signal.aborted||session.snapshot().fatal);assert.equal(decision.status,'STOP_HOLD');assert.equal(after.attempts,mode==='browser-error'?2:1,'No provider request after the failed/denied tool');assert.equal(after.candidate_attempts,1);break;
    }
    assert(!error);if(segment===0){assert.equal(decision.status,'INCOMPLETE_EVIDENCE');assert.deepEqual(decision.missing,[1280]);feedback=completionFeedback(decision,sourceSha);}else{assert.equal(decision.status,'COMPLETE');assert.equal(after.candidate_attempts,2);assert.equal(after.attempts,7);assert.equal(after.render_screenshot_attempts,2);}
   }
   row.guard=await state();assert(row.guard.attempts<=12&&row.guard.rows.every(r=>r.max_tokens<=4096));row.observations=JSON.parse(fs.readFileSync(path.join(serviceDir,'completion-observations.json')));if(mode==='positive'){const resumed=row.observations.filter(r=>r.resumed);assert(resumed.length&&resumed.every(r=>r.prior_user_present&&r.prior_image_hashes.length));assert(resumed.every(r=>!r.advertised_tools.includes('Write')));}
   const requests=await(await fetch(manifest.origin+'/__feedback-native/requests')).json();assert.equal(requests.blocked_outbound,0);row.blocked_outbound=requests.blocked_outbound;row.service_inbound_requests=requests.rows?.length??null;row.status='PASS';
  }finally{
   controller?.abort();await host?.close();row.cleanup=host?.state.cleanup;
   if(service&&service.exitCode===null){service.kill();await Promise.race([once(service,'exit'),new Promise(r=>setTimeout(r,5000))]);assert(service.exitCode!==null||service.signalCode!==null,'Service cleanup failed');}
   assert.equal(row.cleanup?.status,'PASS');save();
  }
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error={name:error.name,message:String(error.message).slice(0,300)};process.exitCode=1;}
finally{save();fs.rmSync(base,{recursive:true,force:true});}
console.log(JSON.stringify({status:report.status,evidence,provider_called:false}));
