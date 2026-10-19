import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../engine/core.mjs';
import {transferDraft} from '../cloud-executor/runner-upload.mjs';
import {registerCollection} from '../cloud-executor/evidence-client.mjs';
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'hypeproof/hypeproof-studio',GITHUB_REPOSITORY_ID:'1239447574',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),GITHUB_WORKFLOW_REF:'hypeproof/hypeproof-studio/.github/workflows/build-mac.yml@refs/tags/v1.2.3-rc.1',GITHUB_WORKFLOW_SHA:'a'.repeat(40),GH_TOKEN:'fixture-only'};
const identity={repository:env.GITHUB_REPOSITORY,repositoryId:1239447574,sourceSha:env.GITHUB_SHA,version:'v1.2.3',rcTag:'v1.2.3-rc.1'};
async function fixture(t,{lost=false,stale=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'runner-stream-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 // File is streamed in chunks and never sent to the Service request body.
 const bytes=Buffer.alloc(1024*1024+17,19);fs.writeFileSync(path.join(directory,'app.zip'),bytes);let writes=0,permitted=false,uploaded=false,completes=0;const calls=[];
 const request=async(endpoint,body)=>{
  calls.push([endpoint,body]);assert.ok(!JSON.stringify(body).includes(bytes.subarray(0,100).toString('base64')));
  const {authorizationRef,receipt,...original}=body,key=digest(original);
  if(endpoint.endsWith('/authorize'))return {status:'AUTHORIZED',requestDigest:key,fence:1,operationId:'op-'+original.effect.kind,expiresAt:new Date(Date.now()+(stale?-1:30000)).toISOString()};
  if(endpoint.endsWith('/perform')){if(original.effect.kind==='draft-release-create')return {status:'SUCCEEDED',requestDigest:key,receipt:{releaseId:99}};permitted=true;return {status:'RUNNER_PERMITTED',requestDigest:key,operationId:'op-draft-asset-upload',fence:1,releaseId:99,expiresAt:new Date(Date.now()+30000).toISOString()};}
  assert.equal(endpoint,'/v1/execution/complete');completes++;assert.equal(uploaded,true,'only independent observation can complete');return {status:'SUCCEEDED',requestDigest:key,receipt:{assetId:333,releaseId:99,name:'app.zip',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
 };
 const fetchImpl=async(url,options)=>{assert.equal(permitted,true);writes++;assert.equal(new URL(url).origin,'https://uploads.github.com');assert.match(new URL(url).pathname,/\/releases\/99\/assets$/);assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer fixture-only');const hash=createHash('sha256');let size=0,chunks=0;for await(const chunk of options.body){size+=chunk.length;chunks++;hash.update(chunk);}assert.equal(size,bytes.length);assert.ok(chunks>1);assert.equal(hash.digest('hex'),createHash('sha256').update(bytes).digest('hex'));uploaded=true;if(lost)throw Error('lost accepted response');return Response.json({id:333});};
 return {directory,request,fetchImpl,calls,writes:()=>writes,completes:()=>completes};
}
test('original runner streams exact numeric draft bytes only after current journaled permit and completes by provider read',async t=>{
 const f=await fixture(t);const result=await transferDraft({identity,effectPath:'build-mac:draft-assets',directory:f.directory},{env,request:f.request,fetchImpl:f.fetchImpl});assert.equal(result.releaseId,99);assert.equal(f.writes(),1);assert.equal(f.completes(),1);assert.deepEqual(f.calls.map(c=>c[0]),['/v1/execution/authorize','/v1/execution/perform','/v1/execution/authorize','/v1/execution/perform','/v1/execution/complete']);
});
test('lost upload response reconciles existing bytes once and never retries transfer',async t=>{
 const f=await fixture(t,{lost:true});await transferDraft({identity,effectPath:'build-mac:draft-assets',directory:f.directory},{env,request:f.request,fetchImpl:f.fetchImpl});assert.equal(f.writes(),1);assert.equal(f.completes(),1);
});
test('stale authorization and rejected journal permit produce zero binary writes',async t=>{
 const f=await fixture(t,{stale:true});await assert.rejects(transferDraft({identity,effectPath:'build-mac:draft-assets',directory:f.directory},{env,request:f.request,fetchImpl:f.fetchImpl}),/fresh/);assert.equal(f.writes(),0);
});
test('collection registration is an actual verifier OIDC POST with canonical caller',async()=>{
 const input={identity},calls=[];const localEnv={...env,RELEASE_ENGINE_ENABLED:'true',RELEASE_ENGINE_URL:'https://release-engine.hypeproof-ai.xyz',ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/idtoken',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture'};
 const result=await registerCollection(input,{env:localEnv,fetchImpl:async(url,options)=>{const parsed=new URL(url);calls.push(parsed.pathname);if(parsed.hostname.endsWith('.actions.githubusercontent.com')){assert.equal(parsed.searchParams.get('audience'),'hypeproof-release-verifier');return Response.json({value:'fixture'});}assert.equal(parsed.pathname,'/v1/evidence/collection');const body=JSON.parse(options.body);assert.deepEqual(body.collection,input);assert.equal(body.caller.runId,123);return Response.json({status:'ARTIFACTS_RECORDED',candidateId:'fixture'});}});assert.equal(result.status,'ARTIFACTS_RECORDED');assert.equal(calls.length,2);
});
