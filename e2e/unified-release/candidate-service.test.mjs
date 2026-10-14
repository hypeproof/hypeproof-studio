// No provider/App calls: genuine git/source fixtures and an actually launched server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {deploymentServicePin,candidateServiceSource,candidateGatewayLaunch,assertCandidateServiceUnchanged,assertCandidateServiceReceipt} from './candidate-service.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hps-candidate-service-'));
const studio=path.join(tmp,'studio'),candidate=path.join(tmp,'Service spaces # percent% 한글');
const git=(...args)=>execFileSync('git',args,{cwd:candidate,encoding:'utf8'}).trim();
const pin=sha=>fs.writeFileSync(path.join(studio,'.github/workflows/deploy-worker.yml'),'steps:\n  - repository: hypeproof/hypeproof-service\n    ref: '+sha+'\n');
try{
 fs.mkdirSync(path.join(studio,'.github/workflows'),{recursive:true});
 fs.mkdirSync(path.join(candidate,'worker/test/harness'),{recursive:true});
 fs.writeFileSync(path.join(candidate,'worker/test/harness/loader.mjs'),"process.env.CANDIDATE_LOADER_MARKER='exact-loader';\n");
 fs.writeFileSync(path.join(candidate,'worker/test/native-trial-live-server.mjs'),"console.log(JSON.stringify({loader:process.env.CANDIDATE_LOADER_MARKER,server:'exact-candidate'}));\n");
 git('init','-q');git('add','.');git('-c','user.name=Control','-c','user.email=control@example.invalid','commit','-qm','candidate control');
 const sha=git('rev-parse','HEAD');pin(sha);
 assert.equal(deploymentServicePin(studio),sha);
 const source=candidateServiceSource(studio,candidate),launch=candidateGatewayLaunch(source);
 const child=spawnSync(process.execPath,launch.args,{cwd:launch.cwd,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{loader:'exact-loader',server:'exact-candidate'});
 assert.equal(assertCandidateServiceUnchanged(studio,source),true);
 const good={schema:'hps-service-compatibility/1',status:'PASS',candidateService:source,activities:['trial','classroom'].map(kind=>({kind,serviceSha:sha,result:{status:'PASS'}}))};
 assert.equal(assertCandidateServiceReceipt(good,sha),true);
 for(const mutate of [r=>r.candidateService.commit='a'.repeat(40),r=>r.candidateService.repository='other/repo',r=>delete r.candidateService,r=>r.candidateService.source_sha256='old',r=>r.activities[0].serviceSha='a'.repeat(40),r=>r.activities.pop(),r=>r.activities[0].result.status='FAIL']){
  const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertCandidateServiceReceipt(bad,sha));
 }
 assert.throws(()=>candidateServiceSource(studio,undefined),/checkout required/);
 pin('a'.repeat(40));assert.throws(()=>candidateServiceSource(studio,candidate),/does not match/);pin(sha);
 for(const flag of ['assume-unchanged','skip-worktree']){
  git('update-index','--'+flag,'worker/test/native-trial-live-server.mjs');
  // Reject the flag even before mutation, as well as concealed changed bytes.
  assert.throws(()=>candidateServiceSource(studio,candidate),/index conceals/);
  fs.writeFileSync(source.server,"console.log('MUTATED concealed server');\n");
  assert.equal(git('status','--porcelain','--untracked-files=normal'),'');
  assert.throws(()=>candidateServiceSource(studio,candidate),/index conceals/);
  assert.throws(()=>assertCandidateServiceUnchanged(studio,source),/index conceals/);
  git('update-index','--no-'+flag,'worker/test/native-trial-live-server.mjs');git('checkout','--','.');
 }
 fs.appendFileSync(source.server,'// contaminated source\n');assert.throws(()=>candidateServiceSource(studio,candidate),/modified/);assert.throws(()=>assertCandidateServiceUnchanged(studio,source),/modified/);git('checkout','--','.');
 fs.writeFileSync(path.join(candidate,'worker/untracked.mjs'),'// importable untracked source');assert.throws(()=>candidateServiceSource(studio,candidate),/modified/);fs.unlinkSync(path.join(candidate,'worker/untracked.mjs'));
 fs.appendFileSync(source.server,'// different committed candidate\n');git('add','.');git('-c','user.name=Control','-c','user.email=control@example.invalid','commit','-qm','different source');
 assert.throws(()=>candidateServiceSource(studio,candidate),/does not match/);
 pin(git('rev-parse','HEAD'));assert.throws(()=>assertCandidateServiceUnchanged(studio,source),/changed during acceptance/);
 pin('main');assert.throws(()=>deploymentServicePin(studio),/immutable/);
 const cli=()=>spawnSync(process.execPath,[fileURLToPath(new URL('./candidate-service.mjs',import.meta.url)),'pin',studio],{encoding:'utf8'});
 assert.notEqual(cli().status,0);pin(sha);assert.equal(cli().status,0);assert.equal(cli().stdout.trim(),sha);
 console.log('PASS candidate provenance: actual loader/server launch, exact clean checkout, mismatched/missing/dirty/untracked/changed provenance rejected; no provider call');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
