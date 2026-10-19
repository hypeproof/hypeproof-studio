import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {buildTagMessage,workflowProvider} from '../build-contract.mjs';
import {GitHubTransport,hashBytes} from '../cloud-executor/provider.mjs';
import {collectCandidate} from '../cloud-executor/collect-candidate.mjs';
import {previousRelease} from '../cloud-executor/previous-release.mjs';
import {executeInstalledTarget,validatePersistence} from '../cloud-executor/installed-runner.mjs';
import {buildCacheInputs,publicTarballKeys,copyPublicCache} from '../cloud-executor/build-cache.mjs';
const sha='a'.repeat(40),other='b'.repeat(40),now=Date.parse('2026-10-19T00:00:00Z');
const identity={repository:'hypeproof/hypeproof-studio',repositoryId:123,sourceSha:sha,tagObject:other,rcTag:'v2026.1019.0-rc.1',version:'v2026.1019.0'};
const names={'mac-zip':'HypeProof-Studio-darwin-arm64.zip','win-portable':'HypeProof.Studio-win32-x64-1.zip','win-user':'HypeProof.StudioUserSetup-x64-1.exe','win-system':'HypeProof.StudioSetup-x64-1.exe'};
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-wiring-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
function providerFixture() {
 const bytes=new Map(),rows=[],calls=[];
 for(const [index,[role,name]]of Object.entries(Object.entries(names))) {const data=Buffer.from(role),id=100+Number(index);bytes.set(id,data);rows.push({id,name,size:data.length,digest:`sha256:${hashBytes(data)}`,state:'uploaded'});}
 const runs=['build-mac.yml','build-windows.yml'].map((workflow,index)=>({id:10+index,run_attempt:1,repository:{id:123},path:`.github/workflows/${workflow}`,head_sha:sha,head_branch:identity.rcTag,status:'completed',conclusion:'success',event:'push'}));
 for(const [index,platform]of ['darwin-arm64','win32-x64'].entries()) {
  const receipt={schema:'hps-draft-build/1',sourceSha:sha,publicationTagObject:other,publicationTag:identity.rcTag,releaseVersion:identity.version.slice(1),managedDraft:true,autoAcceptance:false,acceptance:'NOT_RUN',promotion:'NOT_AUTHORIZED',platform,provider:{repository:identity.repository,repositoryId:123,runId:10+index,runAttempt:1},assets:rows.filter(row=>index?!row.name.includes('darwin'):row.name.includes('darwin')).map(row=>({id:Object.keys(names).find(role=>names[role]===row.name),name:row.name,sha256:row.digest.slice(7),size:row.size}))};
  const data=Buffer.from(JSON.stringify(receipt)),id=200+index;bytes.set(id,data);rows.push({id,name:`draft-build-${platform}.json`,size:data.length,digest:`sha256:${hashBytes(data)}`,state:'uploaded'});
 }
 const transport={request:async(method,endpoint)=>{
  assert.equal(method,'GET');calls.push(endpoint);
  if(endpoint.endsWith('/hypeproof-studio'))return {id:123,full_name:identity.repository};
  if(endpoint.includes('/git/ref/'))return {object:{type:'tag',sha:other}};
  if(endpoint.includes('/git/tags/'))return {tag:identity.rcTag,object:{type:'commit',sha},message:buildTagMessage({candidate:sha,rcTag:identity.rcTag,version:identity.version},{managedDraft:true})};
  if(endpoint.includes('/actions/runs'))return {workflow_runs:runs};
  if(endpoint.includes('/releases/99/assets'))return rows;
  if(endpoint.includes('/releases?'))return [{id:99,tag_name:identity.rcTag,draft:true}];
  throw Error('unexpected endpoint '+endpoint);
 },downloadAsset:async id=>{calls.push(`download:${id}`);return bytes.get(id);}};
 return {transport,bytes,rows,calls,runs};
}
test('workflow provider context is mandatory in Actions and rejects old owner/missing attempt',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:identity.repository,GITHUB_REPOSITORY_ID:'123',GITHUB_RUN_ID:'10',GITHUB_RUN_ATTEMPT:'2'};
 assert.deepEqual(workflowProvider(env),{repository:identity.repository,repositoryId:123,runId:10,runAttempt:2});
 assert.throws(()=>workflowProvider({...env,GITHUB_RUN_ATTEMPT:''}),/trusted workflow/);
 assert.throws(()=>workflowProvider({...env,GITHUB_REPOSITORY:'old-owner/hypeproof-studio'}),/trusted workflow/);
});
test('numeric collector writes exact package bytes, rereads runs and rejects attempt changes during download',async t=>{
 const dir=temp(t),f=providerFixture();const collection=await collectCandidate(identity,dir,{transport:f.transport,now:()=>now});
 assert.equal(collection.releaseId,99);assert.equal(collection.assets.length,4);assert.equal(fs.readFileSync(path.join(dir,names['win-system']),'utf8'),'win-system');
 assert.ok(f.calls.includes('/repos/hypeproof/hypeproof-studio/releases/99/assets?per_page=100&page=1'));
 assert.equal(f.calls.filter(c=>c.includes('/actions/runs')).length,2);
 const drift=providerFixture(),download=drift.transport.downloadAsset;let count=0;drift.transport.downloadAsset=async id=>{const data=await download(id);if(++count===6)drift.runs[0].run_attempt=2;return data;};
 await assert.rejects(collectCandidate(identity,path.join(dir,'drift'),{transport:drift.transport,now:()=>now}),/runAttempt/);
 assert.equal(fs.existsSync(path.join(dir,'drift/collection.json')),false);
});
test('asset redirect drops authorization and rejects arbitrary host before fetching',async()=>{
 const calls=[];
 const transport=new GitHubTransport({token:'private-token',fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options});
  return calls.length===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/file?signature=opaque'}}):new Response('asset');
 }});
 assert.equal((await transport.downloadAsset(44)).toString(),'asset');assert.equal(calls[0].options.headers.Authorization,'Bearer private-token');assert.equal(calls[1].options.headers,undefined);
 const denied=new GitHubTransport({token:'private-token',fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://attacker.invalid/asset'}})});
 await assert.rejects(denied.downloadAsset(44),/untrusted asset redirect/);
});
test('previous release chooses true highest lower stable version, downloads by numeric identity and verifies bytes',async t=>{
 const dir=temp(t),f=providerFixture();const releases=[{id:1,tag_name:'v2026.1017.0'},{id:2,tag_name:'v2026.1018.0'},{id:3,tag_name:'v2026.1018.1-rc.1',prerelease:true},{id:4,tag_name:'v2026.1020.0'}];
 const calls=[];const transport={downloadAsset:f.transport.downloadAsset,request:async(method,endpoint)=>{calls.push(endpoint);if(endpoint.includes('/releases?'))return releases;if(endpoint.endsWith('/releases/2'))return releases[1];if(endpoint.includes('/git/ref/'))return {object:{type:'commit',sha:other}};if(endpoint.includes('/releases/2/assets'))return f.rows.filter(r=>r.id<200);throw Error('unexpected');}};
 const previous=await previousRelease({identity},dir,{transport});assert.equal(previous.releaseId,2);assert.equal(previous.version,'2026.1018.0');assert.equal(previous.sourceSha,other);assert.ok(calls.some(c=>c.includes('/releases/2/assets')));
 f.bytes.set(100,Buffer.from('tamper'));await assert.rejects(previousRelease({identity},path.join(dir,'bad'),{transport}),/bytes changed/);
});
test('native runner unavailable stays NOT_RUN across all eight IDs; persistence validator rejects changed or no-op updates',async t=>{
 const dir=temp(t),f=providerFixture();const collection=await collectCandidate(identity,path.join(dir,'assets'),{transport:f.transport,now:()=>now});
 const policy=JSON.parse(fs.readFileSync(new URL('../engine/policy.example.json',import.meta.url)));
 const reports=[];const saved=process.env.RUNNER_ENVIRONMENT;process.env.RUNNER_ENVIRONMENT='not-supported';
 try {for(const target of ['mac','win-user','win-system']){const result=await executeInstalledTarget({collection,policy,pins:{serviceSha:sha,testRevision:sha,rubricRevision:other},assetsDirectory:dir,previousDirectory:dir,outputDirectory:path.join(dir,target),target});reports.push(...result.reports);}}
 finally {if(saved===undefined)delete process.env.RUNNER_ENVIRONMENT;else process.env.RUNNER_ENVIRONMENT=saved;}
 assert.equal(reports.length,8);assert.ok(reports.every(r=>r.verdict==='NOT_RUN'));assert.equal(new Set(reports.map(r=>r.testId)).size,8);
 const before={workspace:'x',settings:'s',encryptedFile:'e',account:'release-synthetic-account',version:'1.0.0',sourceSha:sha},after={...before,version:'1.0.1',sourceSha:other};
 assert.equal(validatePersistence(before,after),true);assert.throws(()=>validatePersistence(before,{...after,workspace:'lost'}),/not retained/);assert.throws(()=>validatePersistence(before,before),/no real/);
});
test('public npm cache excludes local/private tarballs and auth metadata; pinned lock and ABI change identity',async t=>{
 const dir=temp(t),npmRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),cacache=createRequire(path.join(npmRoot,'npm/package.json'))('cacache');
 const lock={packages:{public:{resolved:'https://registry.npmjs.org/public/-/public-1.0.0.tgz',integrity:'sha512-AA=='},private:{resolved:'file:../../.private-service-cache/private.tgz',integrity:'sha512-AA=='},credentialed:{resolved:'https://token@registry.npmjs.org/pkg/-/pkg.tgz',integrity:'sha512-AA=='}}};
 const keys=publicTarballKeys([lock]);assert.equal(keys.length,1);const key=keys[0],from=path.join(dir,'from'),to=path.join(dir,'to');
 await cacache.put(from,key,Buffer.from('public archive'),{metadata:{reqHeaders:{authorization:'secret'},resHeaders:{},url:'private-url'}});
 await cacache.put(from,'make-fetch-happen:request-cache:file:/private.tgz',Buffer.from('private source'));
 assert.equal(await copyPublicCache({from,to,keys,cacache}),1);const item=await cacache.get(to,key);assert.deepEqual(item.metadata.reqHeaders,{});assert.equal(item.data.toString(),'public archive');assert.equal(Object.keys(await cacache.ls(to)).length,1);
 await assert.rejects(copyPublicCache({from,to,keys,cacache,integrities:{[key]:'sha512-wrong'}}),/pinned lock/);
 const inputs=buildCacheInputs({read:file=>Buffer.from(file),git:()=>sha,nodeVersion:'22.22.1',abi:'127'});
 assert.notDeepEqual(inputs,buildCacheInputs({read:file=>Buffer.from(file),git:()=>sha,nodeVersion:'22.22.1',abi:'128'}));
});
