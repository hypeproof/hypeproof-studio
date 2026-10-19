import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CloudExecutor,GitHubTransport,hashBytes} from '../cloud-executor/provider.mjs';
import {collectAssets,installedPlan,runInstalledPlan,fileVerifier,cacheIdentity} from '../cloud-executor/evidence.mjs';
import {buildTagMessage} from '../build-contract.mjs';
const sourceSha='a'.repeat(40),tagObject='b'.repeat(40),now=Date.parse('2026-10-19T00:00:00Z');
const id={repository:'hypeproof/hypeproof-studio',repositoryId:123,sourceSha,tagObject,rcTag:'v2026.1019.0-rc.1',version:'v2026.1019.0',runs:{'build-mac.yml':{id:10,attempt:1},'build-windows.yml':{id:20,attempt:2}}};
const names={'mac-zip':'HypeProof-Studio-darwin-arm64.zip','win-portable':'HypeProof.Studio-win32-x64-1.zip','win-user':'HypeProof.StudioUserSetup-x64-1.exe','win-system':'HypeProof.StudioSetup-x64-1.exe'};
function fixture() {
 const downloaded={},assets=Object.entries(names).map(([role,name],index)=>{
  const bytes=Buffer.from(role);downloaded[role]={assetId:100+index,bytes}; return {id:100+index,name,size:bytes.length,digest:`sha256:${hashBytes(bytes)}`,state:'uploaded'};
 });
 const runs=Object.entries(id.runs).map(([workflow,run])=>({id:run.id,run_attempt:run.attempt,path:`.github/workflows/${workflow}`,repository:{id:123},head_sha:sourceSha,head_branch:id.rcTag,status:'completed',conclusion:'success',event:'push'}));
 const releases=[{id:99,tag_name:id.rcTag,draft:true}];
 const transport=new GitHubTransport({token:'secret-do-not-print',fetchImpl:async(url,options)=>{
  assert.equal(url.origin,'https://api.github.com');assert.equal(options.method,'GET');
  const p=url.pathname;let result;
  if(p.endsWith('/hypeproof-studio'))result={id:123,full_name:id.repository};
  else if(p.includes('/git/ref/'))result={object:{type:'tag',sha:tagObject}};
  else if(p.includes('/git/tags/'))result={tag:id.rcTag,object:{type:'commit',sha:sourceSha},message:buildTagMessage({candidate:sourceSha,rcTag:id.rcTag,version:id.version},{managedDraft:true})};
  else if(p.endsWith('/assets'))result=assets;
  else if(p.endsWith('/runs'))result={workflow_runs:runs};
  else result=releases;
  return new Response(JSON.stringify(result));
 }});
 const receipts=['darwin-arm64','win32-x64'].map((platform,i)=>({schema:'hps-draft-build/1',sourceSha,publicationTagObject:tagObject,publicationTag:id.rcTag,releaseVersion:id.version.slice(1),managedDraft:true,autoAcceptance:false,acceptance:'NOT_RUN',promotion:'NOT_AUTHORIZED',platform,provider:{repository:id.repository,repositoryId:123,runId:i?20:10,runAttempt:i?2:1},assets:assets.filter(a=>i?!a.name.includes('darwin'):a.name.includes('darwin')).map(a=>({id:Object.keys(downloaded).find(r=>downloaded[r].assetId===a.id),name:a.name,size:a.size,sha256:a.digest.slice(7)}))}));
 return {transport,downloaded,assets,runs,releases,receipts};
}
test('actual HTTP parser binds repository, managed tag, numeric draft, runs, receipt and untouched bytes',async()=>{
 const f=fixture(), observation=await new CloudExecutor({transport:f.transport,now:()=>now}).observe(id);
 const collection=collectAssets(observation,f.receipts,f.downloaded,{now});assert.equal(collection.assets.length,4);assert.equal(collection.acceptance,'NOT_RUN');
 f.downloaded['win-user'].bytes=Buffer.from('tampered');assert.throws(()=>collectAssets(observation,f.receipts,f.downloaded,{now}),/digest/);
});
test('empty same-tag duplicate draft and duplicate builds block, never select arbitrary result',async()=>{
 for(const kind of ['release','run']) {
  const f=fixture();if(kind==='release')f.releases.push({id:101,tag_name:id.rcTag,draft:true});else f.runs.push({...f.runs[0],id:31});
  await assert.rejects(new CloudExecutor({transport:f.transport}).observe(id),/ambiguous|duplicate/);
 }
});
test('attempt changes, missing assets, old observations and receipt run mismatches fail closed',async()=>{
 const f=fixture();f.runs[1].run_attempt=3;await assert.rejects(new CloudExecutor({transport:f.transport}).observe(id),/runAttempt/);f.runs[1].run_attempt=2;
 const obs=await new CloudExecutor({transport:f.transport,now:()=>now}).observe(id);
 assert.throws(()=>collectAssets(obs,f.receipts,f.downloaded,{now:now+300001}),/stale/);
 f.receipts[1].provider.runAttempt=1;assert.throws(()=>collectAssets(obs,f.receipts,f.downloaded,{now}),/runAttempt/);f.receipts[1].provider.runAttempt=2;
 obs.assets.pop();assert.throws(()=>collectAssets(obs,f.receipts,f.downloaded,{now}),/missing/);
});
test('upload timeout persists UNKNOWN, blocks retry; fresh fence checked immediately before side effect',async()=>{
 const records=new Map();let writes=0,reservations=0,authorizations=0;
 const executor=new CloudExecutor({transport:{execute:async()=>{writes++;throw Error('private token timeout');}},authorize:async()=>{authorizations++;return true;},reserve:async()=>{reservations++;return true;},journal:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)}});
 const req={operationId:'report-1',kind:'upload-support',identity:id,asset:{name:'report.json',sha256:'c'.repeat(64),size:2},releaseId:99};
 assert.equal((await executor.mutate(req)).status,'UNKNOWN');await assert.rejects(executor.mutate(req),/observe/);await assert.rejects(executor.mutate({...req,releaseId:100}),/changed request/);assert.equal(writes,1);assert.equal(reservations,1);assert.equal(authorizations,2);
 const blocked=new CloudExecutor({transport:{execute:async()=>{writes++;}},authorize:async()=>++authorizations<4,reserve:async()=>true,journal:{get:async()=>null,put:async()=>{}}});
 assert.equal((await blocked.mutate(req)).status,'UNKNOWN');assert.equal(writes,1);
});
test('trusted synchronous verifier rejects swapped bytes, stale and foreign runs',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-evidence-'));try{
 fs.writeFileSync(path.join(root,'proof'),'actual evidence');const entry={uri:'proof',sha256:hashBytes(Buffer.from('actual evidence')),size:15,sourceSha,repositoryId:123,tagObject,runId:10,runAttempt:1,observedAt:new Date(now).toISOString()};
 const verify=fileVerifier({root,files:[entry],source:id,now});assert.equal(verify({path:path.join(root,'proof'),sha256:entry.sha256,size:15}),true);
 assert.throws(()=>fileVerifier({root,files:[{...entry,runAttempt:8}],source:id,now}),/identity/);
 assert.throws(()=>fileVerifier({root,files:[entry],source:id,now:now+300001}),/stale/);
 fs.writeFileSync(path.join(root,'proof'),'edited evidence');assert.throws(()=>verify(entry),/changed/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('eight installed checks stay NOT_RUN separately from smoke and optional UX; cache pins invalidate',async()=>{
 const f=fixture(),obs=await new CloudExecutor({transport:f.transport,now:()=>now}).observe(id),collection=collectAssets(obs,f.receipts,f.downloaded,{now});
 const policy=JSON.parse(fs.readFileSync(new URL('../engine/policy.example.json',import.meta.url)));
 const pins={serviceSha:sourceSha,testRevision:tagObject,rubricRevision:sourceSha};
 const plan=installedPlan(policy,collection,pins), result=await runInstalledPlan(plan);
 assert.equal(result.checks.length,8);assert.equal(result.verdict,'NOT_RUN');assert.equal(result.smoke.ids.length,6);assert.equal(result.promotion,'NOT_AUTHORIZED');
 await assert.rejects(runInstalledPlan(plan,async c=>({testId:c.id,verdict:'PASS',artifactDigest:c.artifact.sha256,environment:{kind:'browser-fixture'}})),/identity/);
 const cache={sourceSha,serviceSha:tagObject,lockDigest:'c'.repeat(64),seedScriptDigest:'d'.repeat(64),buildContractDigest:'e'.repeat(64),platform:'darwin',architecture:'arm64',nodeVersion:'22.22.1',sdkVersion:'1.2.3'};
 assert.notEqual(cacheIdentity(cache).key,cacheIdentity({...cache,sdkVersion:'1.2.4'}).key);
});
