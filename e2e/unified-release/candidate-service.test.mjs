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

// Background-only transport controls; no App, SDK binary or provider is started.
import {compatibilityEnvironment,compatibilityOutputGuard,assertCompatibilityOutputBound} from './output-bound.mjs';
test('isolated compatibility SDK env sets supported output and retry bounds without changing the parent',()=>{
 const before={HOME:'/same',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'32000',CLAUDE_CODE_MAX_RETRIES:'10',CLAUDE_CODE_RETRY_WATCHDOG:'1'};
 const env=compatibilityEnvironment(before);assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'4096');assert.equal(env.CLAUDE_CODE_MAX_RETRIES,'0');assert.equal(env.CLAUDE_CODE_RETRY_WATCHDOG,undefined);assert.equal(env.HOME,before.HOME);assert.equal(before.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'32000');
});
test('bounded generation passes unchanged and count_tokens is explicitly not output generation',async()=>{
 const calls=[],saved=[],response=new Response('streamed-result');
 const guard=compatibilityOutputGuard(async(input,init)=>{calls.push({input,init});return response;},v=>saved.push(v));
 const init={method:'POST',headers:{'x-api-key':'synthetic-secret'},body:JSON.stringify({max_tokens:4096,messages:[{content:'synthetic prompt never recorded'}]})};
 assert.equal(await guard.fetch('https://api.anthropic.com/v1/messages?beta=true',init),response);
 assert.equal(calls[0].init,init);assert.equal(calls[0].init.body,init.body);assert.equal(await response.text(),'streamed-result');
 await guard.fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',body:JSON.stringify({messages:[],max_tokens:999999})});
 assert.equal(guard.snapshot().forwarded,2);assert.equal(guard.snapshot().calls[1].kind,'count_tokens');assert.equal(guard.snapshot().calls[1].max_tokens,null);
 const evidence=JSON.stringify(saved);for(const value of ['synthetic-secret','synthetic prompt never recorded','messages','x-api-key','beta=true'])assert(!evidence.includes(value));
});
test('oversized, missing, invalid and malformed generation bodies are rejected before any network delegation',async()=>{
 let delegated=0;const guard=compatibilityOutputGuard(async()=>{delegated++;throw Error('must not dispatch');});
 for(const max_tokens of [4097,0,-1,1.5,'4096',null,undefined])await assert.rejects(guard.fetch('https://api.anthropic.com/v1/messages',{method:'POST',body:JSON.stringify({max_tokens})}),/before network/);
 for(const body of ['{',JSON.stringify([]),JSON.stringify(null),new Uint8Array([255])])await assert.rejects(guard.fetch('https://api.anthropic.com/v1/messages',{method:'POST',body}),/before network/);
 for(const [url,method]of [['https://unrelated.invalid/v1/messages','POST'],['https://api.anthropic.com/v1/messages','GET']])await assert.rejects(guard.fetch(url,{method,body:'{}'}),/before network/);
 assert.equal(delegated,0);assert.equal(guard.snapshot().forwarded,0);assert.equal(guard.snapshot().rejected,13);
});
test('Request clone, Buffer and offset typed-array reads preserve the original transport body',async()=>{
 const consumed=[],guard=compatibilityOutputGuard(async(input,init)=>{if(input instanceof Request){assert.equal(input.bodyUsed,false);consumed.push(await input.text());}else consumed.push(Buffer.from(init.body).toString());return new Response('ok');});
 const body=JSON.stringify({max_tokens:123});const request=new Request('https://api.anthropic.com/v1/messages',{method:'POST',body});await guard.fetch(request);assert.equal(request.bodyUsed,true);
 const buffer=Buffer.from(body);await guard.fetch('https://api.anthropic.com/v1/messages',{method:'POST',body:buffer});
 const padded=Buffer.from('xx'+body+'yy'),view=new Uint8Array(padded.buffer,padded.byteOffset+2,Buffer.byteLength(body));await guard.fetch('https://api.anthropic.com/v1/messages',{method:'POST',body:view});
 assert.deepEqual(consumed,[body,body,body]);assert.equal(guard.snapshot().forwarded,3);
});
test('transport errors never retry and cannot produce a valid bound receipt',async()=>{
 let calls=0;const guard=compatibilityOutputGuard(async()=>{calls++;throw Error('sensitive remote prose');});
 await assert.rejects(guard.fetch('https://api.anthropic.com/v1/messages',{method:'POST',body:'{"max_tokens":64}'}),error=>/no automatic retry/.test(error.message)&&!error.message.includes('sensitive'));
 assert.equal(calls,1);assert.equal(guard.snapshot().transport_errors,1);assert.throws(()=>assertCompatibilityOutputBound(guard.snapshot(),{attempts:1,request_limit:12}));
});
test('transport diagnostics distinguish aborted and network requests without retaining sensitive error fields',async()=>{
 const controller=new AbortController();controller.abort('private abort reason');
 for(const [error,signal,expected]of [
  [new DOMException('private abort message','AbortError'),controller.signal,{error_class:'AbortError',error_code:null,cause_code:null,signal_aborted:true}],
  [new TypeError('private network URL',{cause:{code:'ECONNRESET',message:'private cause'}}),undefined,{error_class:'TypeError',error_code:null,cause_code:'ECONNRESET',signal_aborted:false}],
  [{name:'private name',message:'private message',stack:'private stack',code:'private code',cause:{code:'private cause'}},undefined,{error_class:'unknown',error_code:null,cause_code:null,signal_aborted:false}],
 ]){
  let attempts=0;const guard=compatibilityOutputGuard(async()=>{attempts++;throw error;});
  const request=new Request('https://api.anthropic.com/v1/messages',{method:'POST',body:'{"max_tokens":64}',...(signal?{signal}:{})});
  await assert.rejects(guard.fetch(request),/no automatic retry/);
  assert.equal(attempts,1);assert.deepEqual(guard.snapshot().calls[0].transport,expected);
  assert(!JSON.stringify(guard.snapshot()).includes('private'));
  assert.throws(()=>assertCompatibilityOutputBound(guard.snapshot(),{attempts:1,request_limit:12}));
 }
});
test('metadata verifies normal, repeated-generation and count_tokens attempts against all-fetch counts and actual saved request caps',async()=>{
 const guard=compatibilityOutputGuard(async()=>new Response('ok')),api={request_limit:12,attempts:3,calls:[]};
 for(const [endpoint,body]of [['messages',{max_tokens:64}],['messages',{max_tokens:64}],['messages/count_tokens',{}]]){
  await guard.fetch('https://api.anthropic.com/v1/'+endpoint,{method:'POST',body:JSON.stringify(body)});api.calls.push({path:'/v1/'+endpoint,status:200,request:body});
 }
 const proof=guard.snapshot();assert.doesNotThrow(()=>assertCompatibilityOutputBound(proof,api));
 for(const bad of [{...proof,rejected:1},{...proof,forwarded:2},{...proof,output_cap:8192},{...proof,calls:proof.calls.map((c,i)=>i?c:{...c,max_tokens:8192})}])assert.throws(()=>assertCompatibilityOutputBound(bad,api));
 assert.throws(()=>assertCompatibilityOutputBound(proof,{...api,attempts:2}),'repeated/SDK retry attempts cannot disappear');
 assert.throws(()=>assertCompatibilityOutputBound(proof,{...api,attempts:13}));
 assert.throws(()=>assertCompatibilityOutputBound(proof,{...api,calls:api.calls.map((c,i)=>i?c:{...c,request:{max_tokens:8192}})}),'bounded metadata cannot conceal actual oversized bytes');
});
test('explicit gateway preload persists only bounded metadata and refuses oversized requests with no delegate call',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hps-compatibility-output-'));
 try{
  const fake='data:text/javascript,'+encodeURIComponent('globalThis.__delegates=0;globalThis.fetch=async()=>{globalThis.__delegates++;return new Response("ok")};');
  const preload=new URL('./output-bound-preload.mjs',import.meta.url).href;
  const script='await fetch("https://api.anthropic.com/v1/messages",{method:"POST",body:Buffer.from(JSON.stringify({max_tokens:4097,messages:[{content:"never store me"}]}))}).then(()=>{throw Error("unexpected success")},()=>{});console.log(globalThis.__delegates)';
  const env={PATH:process.env.PATH,HPS_SERVICE_ACCEPTANCE:'1',HPS_UNIFIED_LIVE:'1',HPS_NATIVE_EVIDENCE_DIR:directory};
  const output=execFileSync(process.execPath,['--import',fake,'--import',preload,'--input-type=module','-e',script],{env,encoding:'utf8'}).trim();assert.equal(output,'0');
  const raw=fs.readFileSync(path.join(directory,'compatibility-output-guard.json'),'utf8'),proof=JSON.parse(raw);assert.equal(proof.rejected,1);assert.equal(proof.forwarded,0);assert(!raw.includes('never store me'));
  assert.throws(()=>execFileSync(process.execPath,['--import',preload,'-e',''],{env,stdio:'pipe'}),/Command failed/,'existing proof cannot reset');
  assert.throws(()=>execFileSync(process.execPath,['--import',preload,'-e',''],{env:{PATH:process.env.PATH},stdio:'pipe'}),/Command failed/,'no implicit preloading outside isolated compatibility');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('normal RC preload persists twelve concurrent reservations including auxiliary requests and refuses the thirteenth before delegation',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hps-rc-output-'));
 try{
  const fake='data:text/javascript,'+encodeURIComponent('globalThis.__delegates=0;globalThis.fetch=async()=>{globalThis.__delegates++;await new Promise(r=>setTimeout(r,5));return new Response("ok")};');
  const preload=new URL('./output-bound-preload.mjs',import.meta.url).href;
  const script=`const calls=Array.from({length:13},(_,i)=>fetch('https://api.anthropic.com/v1/'+(i%2?'messages/count_tokens':'messages'),{method:'POST',body:JSON.stringify(i%2?{}:{max_tokens:4096})}));const results=await Promise.allSettled(calls);console.log(JSON.stringify({delegates:globalThis.__delegates,failed:results.filter(r=>r.status==='rejected').length}));`;
  const env={PATH:process.env.PATH,HPS_SERVICE_ACCEPTANCE:'0',HPS_UNIFIED_SWITCH:'1',HPS_UNIFIED_LIVE:'1',HPS_NATIVE_EVIDENCE_DIR:directory};
  const result=JSON.parse(execFileSync(process.execPath,['--import',fake,'--import',preload,'--input-type=module','-e',script],{env,encoding:'utf8'}));
  assert.deepEqual(result,{delegates:12,failed:1});
  const proof=JSON.parse(fs.readFileSync(path.join(directory,'compatibility-output-guard.json'),'utf8'));assert.equal(proof.attempts,13);assert.equal(proof.forwarded,12);assert.equal(proof.request_limit,12);assert.equal(proof.exhausted,true);assert.equal(proof.calls.filter(c=>c.kind==='count_tokens').length,6);
  assert.throws(()=>assertCompatibilityOutputBound(proof,{request_limit:12,attempts:13,calls:[]}),/mismatched/);
  assert.throws(()=>execFileSync(process.execPath,['--import',preload,'-e',''],{env,stdio:'pipe'}),/Command failed/,'same activity cannot reset the persisted counter');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('preload records the reservation on disk before each bounded delegation and never rewrites body bytes',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hps-rc-order-'));
 try{
  const fake='data:text/javascript,'+encodeURIComponent(`import fs from 'node:fs';globalThis.fetch=async(input,init)=>{const p=JSON.parse(fs.readFileSync(process.env.HPS_NATIVE_EVIDENCE_DIR+'/compatibility-output-guard.json','utf8'));if(p.attempts!==1||p.forwarded!==1||p.calls[0].state!=='dispatching'||init.body!=='{"max_tokens":17}')throw Error('bad reservation or mutation');return new Response('ok')};`);
  const env={PATH:process.env.PATH,HPS_UNIFIED_SWITCH:'1',HPS_UNIFIED_LIVE:'1',HPS_NATIVE_EVIDENCE_DIR:directory};
  execFileSync(process.execPath,['--import',fake,'--import',new URL('./output-bound-preload.mjs',import.meta.url).href,'--input-type=module','-e',`await fetch('https://api.anthropic.com/v1/messages',{method:'POST',body:'{"max_tokens":17}'});`],{env,stdio:'pipe'});
  const proof=JSON.parse(fs.readFileSync(path.join(directory,'compatibility-output-guard.json'),'utf8'));assert.equal(proof.attempts,1);assert.equal(proof.calls[0].status,200);
  // Old pinned gateways lack attempt fields: the source of this independent
  // reservation is explicitly the preload, while actual request rows must match.
  const legacy={calls:[{path:'/v1/messages',status:200,request:{max_tokens:17}}]};
  assert.doesNotThrow(()=>assertCompatibilityOutputBound(proof,{...legacy,request_limit:proof.request_limit,attempts:proof.attempts}));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('Anthropic RC guard stays explicit and refuses incompatible rehearsal/public modes without installing itself there',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hps-rc-scope-'));
 try{
  const preload=new URL('./output-bound-preload.mjs',import.meta.url).href;
  for(const flag of ['HPS_CODEX_REHEARSAL','HPS_MODEL_REHEARSAL','HPS_PUBLIC_ACTIVITY'])assert.throws(()=>execFileSync(process.execPath,['--import',preload,'-e',''],{env:{PATH:process.env.PATH,HPS_UNIFIED_SWITCH:'1',HPS_UNIFIED_LIVE:'1',HPS_NATIVE_EVIDENCE_DIR:directory,[flag]:'1'},stdio:'pipe'}),/Command failed/);
  assert(!fs.existsSync(path.join(directory,'compatibility-output-guard.json')));
  const run=fs.readFileSync(new URL('./run.mjs',import.meta.url),'utf8');assert(run.includes('...compatibilityEnvironment(process.env)'));assert(!run.includes("serviceOnly?['--import',new URL('./output-bound-preload.mjs'"));
  const publicRun=fs.readFileSync(new URL('./public.mjs',import.meta.url),'utf8');assert(!publicRun.includes('output-bound-preload'));assert(!publicRun.includes('compatibilityEnvironment'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
