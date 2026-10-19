#!/usr/bin/env node
// Drive the packaged App; never build, inject, re-sign or seed credentials in it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {appIdentity,treeHash,sha256,assertReceipt} from './artifact.mjs';
import {checkSeededSdk} from './sdk-seed.mjs';
import {candidateService,assertCandidateServiceUnchanged,redactEvidence,assertServiceActivity} from './candidate-service.mjs';
import {compatibilityEnvironment,assertCompatibilityOutputBound} from './output-bound.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [appDirectory,assetDirectory,outputDirectory,sourceSha,version,publicAppSha]=process.argv.slice(2);
const serviceOnly=!!publicAppSha;
const platform=process.platform==='darwin'?'darwin-arm64':process.platform==='win32'?'win32-x64':null;
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const command=(exe,args,options={})=>new Promise((resolve,reject)=>{
 const child=spawn(exe,args,{cwd:root,stdio:'inherit',...options});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Acceptance process failed: '+code)));
});
let temporary,gateway,log;
let activeEvidence,activeLog;
function preserveGatewayLog(){
 if(!activeEvidence||!activeLog||!fs.existsSync(activeLog))return;
 const secrets=Object.entries(process.env).filter(([name])=>/KEY|SECRET|TOKEN|PASSWORD/.test(name)).map(([,value])=>value);
 for(const name of fs.readdirSync(temporary))if(name.includes('-token'))secrets.push(fs.readFileSync(path.join(temporary,name),'utf8'));
 fs.writeFileSync(path.join(activeEvidence,'gateway.log'),redactEvidence(fs.readFileSync(activeLog,'utf8'),secrets),{mode:0o600});
}
try{
 if(!platform||!appDirectory||!assetDirectory||!outputDirectory||!sourceSha||!version)throw Error('Usage: run.mjs APP ASSETS OUTPUT SOURCE_SHA VERSION (Mac/Windows only)');
 fs.rmSync(path.join(outputDirectory,'receipt.json'),{force:true});
 if(!process.env.ANTHROPIC_API_KEY)throw Error('BLOCKED: acceptance model credential missing; no skipped PASS');
 if(git('rev-parse','HEAD')!==sourceSha||git('status','--porcelain','--untracked-files=no'))throw Error('Acceptance requires clean pinned source');
 for(const flag of ['HPS_NATIVE_ISOLATED_KEYCHAIN','HPS_CODEX_REHEARSAL','HPS_MODEL_REHEARSAL'])if(process.env[flag])throw Error('Incompatible acceptance override: '+flag);
 const app=appIdentity(appDirectory),before=treeHash(appDirectory);
 if(app.sha!==(publicAppSha??sourceSha)||app.version!==version||app.extensionVersion!==version||app.name!=='HypeProof Studio')throw Error('Candidate identity mismatch');
 // Without the per-user SDK binary the trial silently runs on the proxy and the Service refuses it (hypeproof/hypeprooflab#997).
 const sdk=checkSeededSdk(appDirectory);
 if(!sdk.ok)throw Error(`BLOCKED: Agent SDK ${sdk.version} binary not seeded for this user (${sdk.reason}: ${sdk.binary}); run scripts/seed-sdk-binary first`);
 const assets=Object.fromEntries(fs.readdirSync(assetDirectory).filter(n=>/\.(zip|exe)$/.test(n)).map(n=>[n,sha256(path.join(assetDirectory,n))]));
 fs.mkdirSync(outputDirectory,{recursive:true});
 temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hps-unified-acceptance-'));
 // App acceptance must exercise the same Service implementation as deployment,
 // too. The published testkit predates native request admission serialization.
 const servicePin=JSON.parse(fs.readFileSync(path.join(root,'config/service-deployment.json'),'utf8'));
 const candidate=candidateService(process.env.HPS_SERVICE_SOURCE,servicePin);
 const activities=[],servicePackage=candidate.manifest;
 const outputPolicy=Object.fromEntries(['output-bound.mjs','output-bound-preload.mjs'].map(name=>[name,sha256(fileURLToPath(new URL('./'+name,import.meta.url)))]));
 fs.writeFileSync(path.join(outputDirectory,'service-source.json'),JSON.stringify(servicePackage,null,2));
 for(const kind of ['trial','classroom']){
  const evidence=path.resolve(outputDirectory,kind);fs.mkdirSync(evidence,{recursive:true});
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const token=path.join(temporary,kind+'-token');
  const env={...compatibilityEnvironment(process.env),HPS_APP_PATH:path.resolve(appDirectory),HPS_E2E_TOKEN_FILE:token,HPS_E2E_PROXY_URL:`http://127.0.0.1:${port}/v1`,HPS_NATIVE_PORT:String(port),HPS_NATIVE_EVIDENCE_DIR:evidence,HPS_UNIFIED_SWITCH:serviceOnly?'0':'1',HPS_SERVICE_ACCEPTANCE:serviceOnly?'1':'0',HPS_UNIFIED_LIVE:'1',HPS_NATIVE_LIVE:'1',HPS_NATIVE_MANAGED:kind==='trial'?'1':'0',HPS_TEST_REAL_WORKSPACE:'1',HPS_QUIET:'1',HPS_QUIET_NO_HIDE:'1'};
  activeEvidence=evidence;activeLog=path.join(temporary,kind+'-gateway.log');
  log=fs.openSync(activeLog,'w',0o600);
  assertCandidateServiceUnchanged(process.env.HPS_SERVICE_SOURCE,servicePin,servicePackage);
  gateway=spawn(process.execPath,['--experimental-strip-types','--import',pathToFileURL(candidate.loader).href,'--import',new URL('./output-bound-preload.mjs',import.meta.url).href,candidate.gateway],{cwd:path.join(root,'e2e'),env:{...env,HPS_CODEX_ADAPTER_MODULE:new URL('../../scripts/lib/codex-local-client.mjs',import.meta.url).href},stdio:['ignore',log,log]});
  let launchError;gateway.on('error',error=>{launchError=error;});
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
   if(launchError||gateway.exitCode!==null)break;
   try{ready=(await fetch(env.HPS_E2E_PROXY_URL+'/health',{signal:AbortSignal.timeout(500)})).ok;}catch{}
   if(ready)break;await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready)throw Error('BLOCKED: synthetic gateway failed to start');
  // Do not pass provider keys to Electron. Only the synthetic gateway has them.
  const appEnv={...env};for(const name of Object.keys(appEnv))if(/API_KEY|ADMIN_PASSWORD|TOKEN$/.test(name))delete appEnv[name];
  await command(process.execPath,['node_modules/@playwright/test/cli.js','test','--config=native-trial.config.ts','--workers=1','--retries=0'],{cwd:path.join(root,'e2e'),env:appEnv});
  const result=JSON.parse(fs.readFileSync(path.join(evidence,serviceOnly?'result.json':'unified-switch.json'),'utf8'));
  // Both isolated Anthropic paths enforce the same output cap and independent
  // all-fetch reservation ceiling. Public Service canaries run in public.mjs.
  const api=JSON.parse(fs.readFileSync(path.join(evidence,'api-evidence.json'),'utf8'));
  const outputBound=JSON.parse(fs.readFileSync(path.join(evidence,'compatibility-output-guard.json'),'utf8'));
  if(outputBound.request_limit!==12||outputBound.exhausted!==false||!Number.isSafeInteger(outputBound.attempts)||outputBound.attempts!==outputBound.forwarded||api.calls?.length!==outputBound.forwarded||(api.attempts!==undefined&&api.attempts!==outputBound.attempts)||(api.failures!==undefined&&(!Array.isArray(api.failures)||api.failures.length)))throw Error('Synthetic Anthropic reservation proof incomplete');
  // Older pinned testkits have a stricter in-memory eight-call ceiling and no
  // persisted attempt fields. Attribute the new counter to this preload only.
  assertCompatibilityOutputBound(outputBound,serviceOnly?api:{...api,request_limit:outputBound.request_limit,attempts:outputBound.attempts});
  for(const [name,hash]of Object.entries(outputPolicy))if(sha256(fileURLToPath(new URL('./'+name,import.meta.url)))!==hash)throw Error('Compatibility output policy changed during activity');
  const boundReceipt={cap:outputBound.output_cap,forwarded:outputBound.forwarded,rejected:outputBound.rejected,requestLimit:outputBound.request_limit,attempts:outputBound.attempts,counterSource:'isolated-gateway-output-preload',sdk_env:env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,sdk_max_retries:env.CLAUDE_CODE_MAX_RETRIES,guard_sha256:outputPolicy['output-bound-preload.mjs'],policy_sha256:outputPolicy['output-bound.mjs']};
  assertCandidateServiceUnchanged(process.env.HPS_SERVICE_SOURCE,servicePin,servicePackage);
  if(serviceOnly){
   const {calls}=api;
   assertServiceActivity(result,api);
   // serviceSha is the legacy release gate's acceptance-driver SHA; servicePackage.commit identifies the deployed Service implementation.
   activities.push({kind,serviceSha:sourceSha,servicePackage,result,modelCalls:calls.length,requestLimit:api.request_limit,attempts:api.attempts,outputBound:boundReceipt});
  }else{
   const turns=JSON.parse(fs.readFileSync(path.join(evidence,'unified-live-turns.json'),'utf8'));
   activities.push({kind,serviceSha:sourceSha,servicePackage,payloadIsolation:turns.payload_isolation===true,result,outputBound:boundReceipt});
  }
  const stopped=new Promise(resolve=>gateway.once('exit',resolve));gateway.kill();await stopped;gateway=null;fs.closeSync(log);log=undefined;preserveGatewayLog();
 }
 const receipt={schema:'hps-unified-acceptance/1',status:'PASS',sourceSha,sourceDirty:false,platform,mode:'candidate-unmodified',app,assets,treeBefore:before,treeAfter:treeHash(appDirectory),activities};
 if(platform==='win32-x64'&&!serviceOnly){
  const installers=JSON.parse(fs.readFileSync(path.join(assetDirectory,'installer-verification.json'),'utf8'));
  receipt.installerPayloadsVerified=installers.portableTree===before&&Object.entries(assets).filter(([n])=>/Setup.*\.exe$/.test(n)).every(([n,digest])=>installers.installers?.some(row=>row.name===n&&row.sha256===digest&&row.payloadMatches===true));
 }
 if(serviceOnly){
  if(before!==receipt.treeAfter)throw Error('Public App modified');
  assertCandidateServiceUnchanged(process.env.HPS_SERVICE_SOURCE,servicePin,servicePackage);
  receipt.schema='hps-service-compatibility/1';receipt.mode='public-app-unmodified';
 }else assertReceipt(receipt,{sha:sourceSha,version,platform,assets,requirePublic:false});
 fs.writeFileSync(path.join(outputDirectory,'receipt.json'),JSON.stringify(receipt,null,2));
 console.log('PASS untouched candidate: both activities; '+platform);
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 if(gateway){const stopped=new Promise(resolve=>gateway.once('exit',resolve));gateway.kill();await Promise.race([stopped,new Promise(resolve=>setTimeout(resolve,3000))]);}
 if(log!==undefined)fs.closeSync(log);
 if(temporary){
  preserveGatewayLog();
  fs.rmSync(temporary,{recursive:true,force:true});
 }
}
