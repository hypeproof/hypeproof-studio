import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {digest} from '../engine/core.mjs';
import {engineEnabled,guardedEffect,workflowCaller,executionBody} from '../cloud-executor/workflow-gate.mjs';
import {finalPromotion} from '../cloud-executor/build-preflight.mjs';
import {canonicalReport,evidenceContext,submitEvidence} from '../cloud-executor/evidence-client.mjs';
const env={RELEASE_ENGINE_ENABLED:'true',RELEASE_ENGINE_URL:'https://release-engine.hypeproof-ai.xyz',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'hypeproof/hypeproof-studio',GITHUB_REPOSITORY_ID:'1239447574',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',GITHUB_SHA:'a'.repeat(40),GITHUB_WORKFLOW_REF:'hypeproof/hypeproof-studio/.github/workflows/verify-unified-release.yml@refs/heads/main',GITHUB_WORKFLOW_SHA:'c'.repeat(40),ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/idtoken',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fixture',HPS_EVIDENCE_ARTIFACT_ID:'567'};
const paths=['build-mac:build','build-win:build','build-mac:draft-assets','build-win:draft-assets','build-mac:acceptance-dispatch','build-win:acceptance-dispatch','verify-unified:publish','verify-unified:mirror-dispatch','mirror:release-create-edit-upload','mirror:install-bundle-upload','release-cut:tag-create','installed:mac','installed:win-user','installed:win-system'];
const body=path=>executionBody({path,identity:{sourceSha:'a'.repeat(40),rcTag:'v1.2.3-rc.1'},effect:{kind:'fixture'}},env);
const fakeProvider=({stale=false,perform=false}={})=>async(url,options)=>{
 const u=new URL(url);assert.equal(options.redirect,'error');
 if(u.hostname.endsWith('.actions.githubusercontent.com'))return Response.json({value:'fixture-oidc'});
 const input=JSON.parse(options.body);assert.equal(options.headers.authorization,'Bearer fixture-oidc');
 if(u.pathname.endsWith('/authorize'))return Response.json({status:'AUTHORIZED',requestDigest:stale?'bad':digest(input),fence:3,operationId:'reserved-op',expiresAt:new Date(Date.now()+30000).toISOString()});
 assert.ok(perform);assert.equal(u.pathname,'/v1/execution/perform');const {authorizationRef,...request}=input;assert.equal(authorizationRef.operationId,'reserved-op');return Response.json({status:'SUCCEEDED',requestDigest:digest(request)});
};
test('every workflow mutation path produces zero local effects for missing/stale authority',async()=>{
 for(const path of paths){let effects=0;const run=()=>effects++;
  await assert.rejects(guardedEffect({body:body(path),perform:true},{env:{...env,RELEASE_ENGINE_URL:''},run}),/unconfigured/);
  await assert.rejects(guardedEffect({body:body(path),perform:true},{env,run,fetchImpl:fakeProvider({stale:true})}),/stale/);assert.equal(effects,0);
 }
});
test('controlled effects delegate to server and never call runner GitHub CLI; legacy remains compatible',async()=>{
 let effects=0;const run=()=>effects++;
 const result=await guardedEffect({body:body('verify-unified:publish'),perform:true},{env,run,fetchImpl:fakeProvider({perform:true})});assert.equal(result.status,'SUCCEEDED');assert.equal(effects,0);
 await guardedEffect({command:'gh',args:['release','edit']},{env:{},run});assert.equal(effects,1);
 await assert.rejects(guardedEffect({managed:true,command:'gh'},{env:{},run}),/requires/);assert.equal(effects,1);
});
test('malformed mode and spoofed caller fail before any authority call',()=>{
 assert.throws(()=>engineEnabled({RELEASE_ENGINE_ENABLED:'TRUE'}),/invalid/);assert.throws(()=>workflowCaller({...env,GITHUB_REPOSITORY_ID:'9'}),/untrusted/);
});
test('exact final promotion markers skip builders; corrupt/misbound markers block',()=>{
 const marker={candidate:'a'.repeat(40),intentDigest:'b'.repeat(64),releaseId:9},input={tag:'v1.2.3',sourceSha:marker.candidate,tagObjectType:'tag',message:'hps-same-byte-promotion/1\n'+JSON.stringify(marker)};
 assert.equal(finalPromotion(input),true);assert.equal(finalPromotion({...input,message:'ordinary legacy tag'}),false);
 for(const change of [{sourceSha:'c'.repeat(40)},{tagObjectType:'commit'},{tag:'v1.2.3-rc.1'},{message:'hps-same-byte-promotion/1 broken'}])assert.throws(()=>finalPromotion({...input,...change}),/BLOCKED/);
});
test('all actual gh release and acceptance/mirror dispatch writes have a direct preceding legacy gate',()=>{
 for(const name of ['build-mac.yml','build-windows.yml','verify-unified-release.yml','mirror-release.yml']){
  const source=fs.readFileSync('.github/workflows/'+name,'utf8'),lines=source.split('\n');let writes=0;
  for(let i=0;i<lines.length;i++)if(/^\s+gh (?:release (?:create|edit|upload)|workflow run)/.test(lines[i])){writes++;assert.match(lines[i-1],/workflow-gate\.mjs legacy-only/,`${name}:${i+1} unguarded`);}
  assert.ok(writes>0);assert.match(source,/RELEASE_ENGINE_ENABLED: \$\{\{ vars\.RELEASE_ENGINE_ENABLED \}\}/);assert.match(source,/RELEASE_ENGINE_URL: \$\{\{ vars\.RELEASE_ENGINE_URL \}\}/);
 }
});
test('both native builders depend on Ubuntu final-marker preflight and reservation before expensive work',()=>{
 for(const name of ['build-mac.yml','build-windows.yml']){const source=fs.readFileSync('.github/workflows/'+name,'utf8');assert.match(source,/needs: engine-preflight\n    if: needs.engine-preflight.outputs.skip_build != 'true'/);assert.ok(source.indexOf('workflow-gate.mjs authorize')<source.indexOf('Restore npm download cache'));assert.match(source,/runner-upload\.mjs build-(mac|win):draft-assets dist/);}
});
test('controlled legacy CLI refuses all direct write paths before commands',()=>{
 for(const path of paths){const result=spawnSync(process.execPath,['scripts/release/cloud-executor/workflow-gate.mjs','legacy-only',path,'fixture'],{env:{...process.env,RELEASE_ENGINE_ENABLED:'true'},encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/legacy mutation disabled/);}
});
test('evidence context uses verifier audience; reports bind actual run attempt and immutable artifact',async()=>{
 const context={candidateId:'candidate',manifestDigest:'b'.repeat(64),reporterId:'native-mac',serviceSha:'d'.repeat(40),testRevision:env.GITHUB_WORKFLOW_SHA,rubricRevision:'e'.repeat(40),policy:{fixture:'only'}};
 let audience;
 const fetched=await evidenceContext({target:'mac'},{env,fetchImpl:async(url,options)=>{const u=new URL(url);if(u.hostname.endsWith('.actions.githubusercontent.com')){audience=u.searchParams.get('audience');return Response.json({value:'fixture'});}assert.equal(u.pathname,'/v1/evidence/context');return Response.json(context);}});assert.equal(audience,'hypeproof-release-verifier');assert.deepEqual(fetched,context);
 const raw={testId:'INSTALL-MAC',...{serviceSha:context.serviceSha,testRevision:context.testRevision,rubricRevision:context.rubricRevision},file:{path:'/temporary/INSTALL-MAC.json',size:3,sha256:'f'.repeat(64)},verdict:'BLOCKED',startedAt:new Date().toISOString(),endedAt:new Date().toISOString()};
 const canonical=canonicalReport(raw,context,'mac',env);assert.equal(canonical.provider.artifactId,567);assert.equal(canonical.provider.runAttempt,2);assert.equal(canonical.file.path,'github-run:1239447574:123:2/artifact-567/INSTALL-MAC.json');assert.equal(canonical.verdict,'BLOCKED');
 assert.throws(()=>canonicalReport(raw,context,'mac',{...env,HPS_EVIDENCE_ARTIFACT_ID:''}),/artifact ID/);
 await assert.rejects(submitEvidence({reports:[raw],context,target:'mac'},{env,fetchImpl:async(url)=>new URL(url).hostname.endsWith('.actions.githubusercontent.com')?Response.json({value:'fixture'}):Response.json({status:'BLOCKED'},{status:409})}),/refused/);
});
test('artifact upload always paths cannot bypass current independent storage reservation',()=>{
 for(const file of ['build-mac.yml','build-windows.yml','verify-unified-release.yml','release-cut.yml']){
  const source=fs.readFileSync('.github/workflows/'+file,'utf8');
  for(const block of source.split(/(?=      - )/).filter(b=>b.includes('uses: actions/upload-artifact@'))){assert.match(block,/if: (?:always\(\) && )?steps\.artifact-budget-[0-9]+\.outcome == 'success'/);}
  assert.match(source,/workflow-gate\.mjs authorize [a-z-]+:artifact-store artifact-store/);
 }
});
test('actual publisher and mirror shell blocks stop before any gh mutation with missing engine URL',()=>{
 const extract=(file,step)=>{const source=fs.readFileSync(file,'utf8');const result=spawnSync('python3',['-c',"import json,sys,yaml; d=yaml.safe_load(open(sys.argv[1])); print(json.dumps(next(s['run'] for j in d['jobs'].values() for s in j['steps'] if s.get('name')==sys.argv[2])))",file,step],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
 for(const [file,step] of [['build-mac.yml','Upload draft candidate (tag builds only)'],['build-windows.yml','Upload draft candidate (tag builds only)'],['verify-unified-release.yml','Publish and dispatch the public mirror'],['mirror-release.yml','Mirror assets']]){
  let script=extract('.github/workflows/'+file,step).replace(/\$\{\{[^}]+\}\}/g,'fixture');
  // Read-only GH view/fetch are harmless synthetic observations; writes are fatal
  // sentinels. No real GitHub or git network command is executed.
  script='gh(){ if [[ "$1 $2" == "release view" ]]; then echo true; else echo UNAUTHORIZED_GH_EFFECT >&2; return 77; fi; }\ngit(){ return 0; }\n'+script;
  const result=spawnSync('bash',['-e','-c',script],{encoding:'utf8',env:{...process.env,RELEASE_ENGINE_ENABLED:'true',RELEASE_ENGINE_URL:'',HPS_MANAGED_DRAFT:'false',GITHUB_REF:'refs/tags/v1.2.3',TAG:'v1.2.3',GH_TOKEN:'fixture',SOURCE_REPO:'hypeproof/hypeproof-studio'}});
  assert.notEqual(result.status,0,step);assert.doesNotMatch(result.stderr,/UNAUTHORIZED_GH_EFFECT/,step);
 }
});
