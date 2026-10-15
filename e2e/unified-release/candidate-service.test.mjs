import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { candidateService, assertCandidateServiceUnchanged, redactEvidence } from './candidate-service.mjs';

test('candidate provenance rejects wrong or dirty implementation and hashes exact source', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hps-candidate-control-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  try {
    git('init','-q');git('config','user.email','synthetic@example.invalid');git('config','user.name','Synthetic');
    for(const name of ['src/index.ts','test/native-trial-live-server.mjs','test/harness/loader.mjs']){
      const file=path.join(root,'worker',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'// synthetic\n');
    }
    git('add','.');git('commit','-qm','synthetic');
    const pin={repository:'hypeproof/hypeproof-service',sha:git('rev-parse','HEAD')};
    const result=candidateService(root,pin);
    assert.equal(result.manifest.commit,pin.sha);assert.match(result.manifest.source_sha256,/^[a-f0-9]{64}$/);
    assert.equal(result.gateway,path.join(root,'worker/test/native-trial-live-server.mjs'));
    assert.throws(()=>candidateService(root,{...pin,sha:'0'.repeat(40)}),/match/);
    for(const flag of ['assume-unchanged','skip-worktree']){
      git('update-index','--'+flag,'worker/src/index.ts');
      assert.throws(()=>candidateService(root,pin),/index conceals/);
      fs.appendFileSync(path.join(root,'worker/src/index.ts'),'// concealed dirty');
      assert.equal(git('status','--porcelain','--untracked-files=normal'),'');
      assert.throws(()=>candidateService(root,pin),/index conceals/);
      git('update-index','--no-'+flag,'worker/src/index.ts');git('checkout','--','.');
    }
    fs.appendFileSync(path.join(root,'worker/src/index.ts'),'// dirty');
    assert.throws(()=>candidateService(root,pin),/clean/);
    assert.throws(()=>assertCandidateServiceUnchanged(root,pin,result.manifest),/clean/);
    git('checkout','--','.');
    fs.writeFileSync(path.join(root,'worker/untracked.mjs'),'// untracked candidate source');
    assert.throws(()=>candidateService(root,pin),/clean/);
    fs.unlinkSync(path.join(root,'worker/untracked.mjs'));
    assert.equal(assertCandidateServiceUnchanged(root,pin,result.manifest),true);
    assert.throws(()=>candidateService(root,{...pin,repository:'unrelated/repo'}),/Invalid/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('failure logs remove known provider keys, participant tokens and bearer headers',()=>{
  const safe=redactEvidence('error budget 8; synthetic-key; token-value; Bearer unlisted-token; sk-ant-example-value',['synthetic-key','token-value','']);
  assert.match(safe,/budget 8/);
  for(const secret of ['synthetic-key','token-value','unlisted-token','sk-ant-example-value'])assert.ok(!safe.includes(secret));
});

test('compatibility and deployment consume one immutable Service pin and do not skip either OS',()=>{
  const root=new URL('../../',import.meta.url);
  const workflow=name=>fs.readFileSync(new URL('.github/workflows/'+name,root),'utf8');
  for(const name of ['deploy-worker.yml','verify-service-activities.yml']){
    assert.match(workflow(name),/config\/service-deployment\.json/);
    assert.match(workflow(name),/ref: \$\{\{ steps.service.outputs.sha \}\}/);
  }
  assert.match(workflow('verify-service-activities.yml'),/os: \[macos-15, windows-latest\]/);
  const pin=JSON.parse(fs.readFileSync(new URL('config/service-deployment.json',root),'utf8'));
  assert.equal(pin.repository,'hypeproof/hypeproof-service');assert.match(pin.sha,/^[a-f0-9]{40}$/);
});

test('HTTP 200 cannot replace completed work or conceal failed, missing or over-budget attempts',async()=>{
  const {assertServiceActivity}=await import('./candidate-service.mjs');
  const result={status:'PASS',initial_file_created:true,revised_file_created:true,original_preserved:true};
  const api={request_limit:12,attempts:10,calls:Array.from({length:10},()=>({status:200})),failures:[]};
  assert.doesNotThrow(()=>assertServiceActivity(result,api));
  for(const field of Object.keys(result))assert.throws(()=>assertServiceActivity({...result,[field]:false},api));
  for(const bad of [
    {...api,request_limit:24}, {...api,request_limit:undefined}, {...api,attempts:undefined},
    {...api,attempts:13,calls:[...api.calls,{status:200},{status:200}]},
    {...api,attempts:13,calls:[...api.calls,{status:200},{status:200},{status:200}]},
    {...api,failures:[{kind:'stream_error'}]}, {...api,failures:undefined},
    {...api,calls:api.calls.map((c,i)=>i?c:{status:500})}, {...api,attempts:0,calls:[]},
  ])assert.throws(()=>assertServiceActivity(result,bad));
});
