#!/usr/bin/env node
// Real SDK + actual pinned Service + owned scripted loopback. No desktop/provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {runtimeEnvironment} from './hosted-shell.mjs';
import {compatibilityEnvironment} from '../unified-release/output-bound.mjs';
import {sha256,sourceSnapshot} from './safety.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),[evidence,binary]=process.argv.slice(2);
assert(path.isAbsolute(evidence??'')&&path.isAbsolute(binary??''),'Explicit evidence and actual SDK binary required');
assert(!fs.existsSync(evidence),'New immutable evidence directory required');fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const privateDir=fs.mkdtempSync(path.join(os.tmpdir(),'hps-scripted-sdk-')),serviceDir=path.join(privateDir,'service'),workspace=path.join(privateDir,'work');fs.mkdirSync(workspace);
const env=compatibilityEnvironment({...runtimeEnvironment(process.env),APPDATA:path.join(privateDir,'app-data'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
const require=createRequire(path.join(root,'extensions/hypeproof-chat/package.json')),esbuild=require('esbuild'),version=JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),'package.json'),'utf8')).version;
fs.symlinkSync(path.join(root,'extensions/hypeproof-chat/node_modules'),path.join(privateDir,'node_modules'),process.platform==='win32'?'junction':'dir');
const verified=JSON.parse(fs.readFileSync(binary+'.verified.json','utf8'));assert.equal(verified.sdkVersion,version,'Real SDK binary must match actual SDK module');assert.equal(verified.size,fs.statSync(binary).size);assert(fs.statSync(binary).size>=150*1024*1024&&verified.tarballSha512?.startsWith('sha512-'),'Verified seed prerequisite');
const report={studio_source_sha:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),studio_dirty:sourceSnapshot(root).dirty,studio_source_binding:sourceSnapshot(root),fixture_hashes:Object.fromEntries(['service.mjs','scripted-upstream.mjs','scripted-sdk-probe.mjs','session-control.mjs'].map(file=>[file,sha256(path.join(root,'e2e/feedback-native',file))])),schema:'hps-native-scripted-sdk-probe/1',source_sha:process.env.HPS_SERVICE_SHA,sdk_version:version,sdk_binary_sha256:sha256(binary),provider_called:false,native_ui:'NOT_RUN',turns:[],status:'RUNNING'};
const controllers=new Set();
const save=()=>fs.writeFileSync(path.join(evidence,'probe.json'),JSON.stringify(report,null,2));save();
const service=spawn(process.execPath,['--experimental-strip-types','--experimental-sqlite',path.join(root,'e2e/feedback-native/service.mjs'),serviceDir,'--scripted-upstream'],{cwd:root,env,stdio:['ignore','ignore','pipe']});service.stderr.resume();
const wait=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;if(service.exitCode!==null)throw Error('Owned Service exited');await new Promise(r=>setTimeout(r,100));}throw Error('Timed out '+label);};
try{
 await wait(()=>fs.existsSync(path.join(serviceDir,'service.json')),'actual Service startup');const manifest=JSON.parse(fs.readFileSync(path.join(serviceDir,'service.json'))),token=fs.readFileSync(manifest.token_a_file,'utf8');
 report.service=manifest.source;assert.equal(manifest.source.sha,process.env.HPS_SERVICE_SHA);
 await esbuild.build({entryPoints:[path.join(root,'extensions/hypeproof-chat/src/sdkCoach.ts')],outfile:path.join(privateDir,'sdk.cjs'),bundle:true,platform:'node',format:'cjs',external:['@anthropic-ai/claude-agent-sdk','zod'],nodePaths:[path.join(root,'extensions/hypeproof-chat/node_modules')],logLevel:'silent',plugins:[{name:'host-only',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:p=>({fsPath:p})}};',loader:'js'}));}}]});
 const {runSdkCoach}=require(path.join(privateDir,'sdk.cjs')),response=await fetch(manifest.origin+'/v1/profile',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200);const profile=await response.json();assert.equal(profile.coach_runtime,'agent-sdk');
 const history=[];
 for(const marker of ['A1','D2']){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);timer.unref();controllers.add(controller);let answer='';
  const result=await runSdkCoach({gatewayUrl:manifest.origin+'/v1',token,model:'hypeproof-fast',profile,systemPrompt:'',history,userText:'HPS_NATIVE_'+marker,signal:controller.signal,cwd:workspace,binaryPathSetting:binary,turnId:'native_probe_'+marker,stallTimeoutMs:30000,onDelta:x=>answer+=x,onCitations:()=>{},onAssetScore:()=>{},requestApproval:async()=>false});clearTimeout(timer);
  assert.equal(result.failed,false);assert(answer.includes('HPS_NATIVE_REPLY_'+marker),'Actual SDK must consume scripted SSE');
  history.push({role:'user',content:'HPS_NATIVE_'+marker},{role:'assistant',content:answer});report.turns.push({marker,response_sha256:sha256Text(answer),completed:true});save();
 }
 for(const marker of ['STOP_HOLD','QUIT_HOLD','FILE_HOLD']){
  const controller=new AbortController();controllers.add(controller);let deltaObserved=false;
  const task=runSdkCoach({gatewayUrl:manifest.origin+'/v1',token,model:'hypeproof-fast',profile,systemPrompt:'',history,userText:'HPS_NATIVE_'+marker,signal:controller.signal,cwd:workspace,binaryPathSetting:binary,turnId:'native_probe_'+marker,stallTimeoutMs:30000,onDelta:()=>{deltaObserved=true;},onCitations:()=>{},onAssetScore:()=>{},requestApproval:async()=>false});
  const settled=task.then(()=>({result:'returned'}),error=>({result:'rejected',error_class:error.name}));
  await wait(async()=>{const state=await(await fetch(manifest.scripted.origin+'/__scripted/state')).json();return state.rows.some(row=>row.marker===marker&&row.state==='streaming');},'actual held SDK upstream stream',30000);
  const active=(await(await fetch(manifest.scripted.origin+'/__scripted/state')).json()).rows.find(row=>row.marker===marker);assert(active);
  controller.abort();const terminal=await settled;
  await wait(async()=>{const data=await(await fetch(manifest.origin+'/__feedback-native/requests')).json();return data.calls.some(row=>row.seq===active.service_seq&&row.client_closed&&row.service_body_cancelled);},'exact linked client cancellation',10000);
  const cancelDeadline=Date.now()+3000;while(Date.now()<cancelDeadline){const rows=(await(await fetch(manifest.scripted.origin+'/__scripted/state')).json()).rows;if(rows.find(row=>row.service_seq===active.service_seq)?.client_closed)break;await new Promise(r=>setTimeout(r,100));}
  const beforeRelease=await(await fetch(manifest.scripted.origin+'/__scripted/state')).json();
  const linked=await(await fetch(manifest.origin+'/__feedback-native/requests')).json();const upstream=beforeRelease.rows.find(row=>row.marker===marker);assert(upstream);
  const serviceRow=linked.calls.find(row=>row.seq===upstream.service_seq);assert(serviceRow);
  report.turns.push({marker,sdk_delta_observed:deltaObserved,active_upstream_stream_observed:true,sdk_abort:terminal,client_closed:serviceRow.client_closed,service_body_cancelled:serviceRow.service_body_cancelled,upstream_socket_closed:upstream.client_closed===true,upstream_state_before_cleanup:upstream.state,cleanup_is_not_cancel_proof:true});save();
  if(!upstream.client_closed){const secret=fs.readFileSync(path.join(serviceDir,'admin-control'),'utf8');const release=await fetch(manifest.scripted.origin+'/__scripted/release',{method:'POST',headers:{'x-hps-native-control':secret},body:JSON.stringify({name:marker})});assert.equal(release.status,200);}
 }
 report.upstream=await(await fetch(manifest.scripted.origin+'/__scripted/state')).json();report.service_requests=await(await fetch(manifest.origin+'/__feedback-native/requests')).json();
 assert(report.upstream.rows.some(r=>r.marker==='D2'&&r.markers.A1&&r.markers.D2),'Actual SDK prompt must include history');assert(report.upstream.rows.every(r=>r.attempt<=12&&(!r.max_tokens||r.max_tokens<=4096)));assert.equal(report.service_requests.blocked_outbound,0);assert(report.service_requests.calls.some(r=>r.path==='/v1/messages'&&r.scripted_dispatches>0));for(const upstream of report.upstream.rows){const linked=report.service_requests.calls.find(row=>row.seq===upstream.service_seq);assert(linked?.ledger_request_id&&linked.parent_request_id,'Every actual upstream dispatch requires an existing SQLite attempt and parent linkage');assert.equal(linked.ledger?.request_id,linked.ledger_request_id,'Actual settled ledger row must exist');assert.equal(linked.context_settled,true,'HTTP bridge must settle context after reader cancellation');assert(linked.ledger.evidence_version>=1,'Settled response must retain actual cost evidence, including cancellation');if(upstream.client_closed){assert.equal(linked.reader_cancel_calls,1,'Response reader cancellation must be once-only');assert.equal(linked.service_body_cancelled,true);}}report.protocol_readiness='PASS_REAL_SDK_SCRIPTED_PROTOCOL';report.cancellation_verdict=report.turns.filter(row=>row.active_upstream_stream_observed).every(row=>row.upstream_socket_closed)?'PASS_ALL_LAYERS':'FAIL_NOT_PROPAGATED';report.status=report.cancellation_verdict==='PASS_ALL_LAYERS'?'PASS':'FAIL_UPSTREAM_CANCEL_NOT_PROPAGATED';if(report.status!=='PASS')process.exitCode=1;
}catch(error){report.status='FAIL';report.error_class=error.name;report.error=String(error.message).slice(0,500);process.exitCode=1;}
finally{for(const controller of controllers)controller.abort();service.kill();await Promise.race([once(service,'exit'),new Promise(r=>setTimeout(r,5000))]);const ledger=path.join(serviceDir,'scripted-ledger.json');if(fs.existsSync(ledger))report.upstream=JSON.parse(fs.readFileSync(ledger));save();}
function sha256Text(value){return require('node:crypto').createHash('sha256').update(value).digest('hex');}
