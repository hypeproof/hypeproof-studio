// Real pinned Service/Hono/SQLite; synthetic local protocol only, no SDK/App/provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {initializeAccounting,settledUsage,accountingSummary,ATTRIBUTION_MIGRATION} from './service-accounting.mjs';
import {scriptedEvents} from './scripted-upstream.mjs';
const studio=fileURLToPath(new URL('../../',import.meta.url));
const source=process.env.HPS_SERVICE_SOURCE??path.join(studio,'feedback-service');
const sha=process.env.HPS_SERVICE_SHA??JSON.parse(fs.readFileSync(path.join(studio,'config/service-deployment.json'))).sha;
// No initialization or test fallback may use the network; only the child origin observed below is allowed.
const networkFetch=globalThis.fetch,ownedOrigins=new Set();
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert(ownedOrigins.has(url.origin),'Unowned test network request refused');return networkFetch(input,init);};
const available=fs.existsSync(source),options={skip:available?false:'Pinned Service checkout required (HPS_SERVICE_SOURCE/HPS_SERVICE_SHA)',timeout:30000};
function fixtureTermination(platform,code,signal){
 if(code===0&&signal===null)return 'graceful_exit_0';
 if(platform==='win32'&&code===null&&signal==='SIGTERM')return 'windows_forced_SIGTERM';
 throw Error('Unexpected owned fixture termination');
}
test('termination labels do not confuse Windows forced exit with graceful cleanup',()=>{
 assert.equal(fixtureTermination('darwin',0,null),'graceful_exit_0');assert.equal(fixtureTermination('win32',0,null),'graceful_exit_0');assert.equal(fixtureTermination('win32',null,'SIGTERM'),'windows_forced_SIGTERM');
 for(const tuple of [['darwin',null,'SIGTERM'],['win32',1,null],['win32',null,'SIGKILL'],['win32',null,null]])assert.throws(()=>fixtureTermination(...tuple));
});
let modules;
async function actual(){
 if(modules)return modules;
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),sha);
 assert.equal(execFileSync('git',['status','--porcelain','--','worker/src','worker/schema.sql','worker/test/harness',ATTRIBUTION_MIGRATION],{cwd:source,encoding:'utf8'}).trim(),'');
 await import(pathToFileURL(path.join(source,'worker/test/harness/loader.mjs')));
 const access=await import(pathToFileURL(path.join(source,'worker/test/harness/access.mjs'))),base=await import(pathToFileURL(path.join(source,'worker/test/harness/index.mjs'))),tokens=await import(pathToFileURL(path.join(source,'worker/src/lib/tokens.ts'))),kv=await import(pathToFileURL(path.join(source,'worker/src/lib/kv.ts'))),analytics=await import(pathToFileURL(path.join(source,'worker/src/lib/analytics.ts')));
 return modules={...access,...base,...tokens,...kv,...analytics};
}
const cohort='synthetic-release-acceptance',profile=cohort,session='synthetic-feedback-native',user='synthetic-feedback-A';
async function fixture(){const m=await actual(),h=await m.accessHarness();delete h.env.HPS_ACCESS_CONTRACTS;await m.setRoster(h.env.HPS_KV,cohort,[user]);await initializeAccounting({root:source,harness:h,cohort,profile,session:{session_id:session,starts_at:new Date(Date.now()-1000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()}});return{m,h};}
test('real admin mirror + canonical0044: actual two dispatches, same-ID persistence replay adds no row/tokens',options,async()=>{
 const{m,h}=await fixture();try{
  const token=(await m.issue({u:user,c:cohort,p:profile},1,m.TEST_SECRET)).token;h.env.ANTHROPIC_API_KEY='synthetic-no-provider';
  const request=()=>new Request('https://synthetic.test/v1/messages',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-hps-turn-id':'same-native-test-turn'},body:JSON.stringify({model:'hypeproof-default',max_tokens:4096,stream:true,messages:[{role:'user',content:'HPS_NATIVE_A1'}]})});
  let dispatched=0;const logs=[],old=console.error;console.error=(...x)=>logs.push(x.map(String).join(' '));
  try{await m.withMockUpstream((_url,init)=>{assert.equal(new URL(_url).origin,'https://api.anthropic.com');assert.equal(new URL(_url).pathname,'/v1/messages');dispatched++;const b=JSON.parse(init.body),s=scriptedEvents('A1',b.model);return new Response(s.prefix+s.tail,{headers:{'content-type':'text/event-stream'}});},async()=>{
   const app=await m.bootApp(),ctx=m.makeCtx(),r=await app.fetch(request(),h.env,ctx);assert.equal(r.status,200);await r.text();await ctx.settle();
   const [stored]=h.db.prepare('SELECT r.request_id,u.* FROM usage_request_rows r JOIN usage_log u ON u.id=r.usage_row_id').all();assert(stored);assert.equal(stored.session_id,session);assert.equal(stored.tokens_in,11);assert.equal(stored.tokens_out,7);
   assert.equal(settledUsage(h.db,stored.request_id,session).session_matches,true);
   const before=accountingSummary(h.db);await m.persistUsage(h.env,{...stored,request_id:stored.request_id,cache_create:stored.cache_write});assert.deepEqual(accountingSummary(h.db),before);assert.equal(h.db.prepare('SELECT sum(tokens_in) AS n FROM usage_log').get().n,11);
   const next=m.makeCtx(),r2=await app.fetch(request(),h.env,next);assert.equal(r2.status,200);await r2.text();await next.settle();assert.equal(dispatched,2);
   const summary=accountingSummary(h.db);assert.equal(summary.usage_rows,2);assert.equal(summary.request_links,2);assert.equal(summary.attempts,2);assert.equal(summary.evidence,2);assert.equal(summary.null_session_rows,0);assert.equal(summary.unlinked_rows,0);assert.equal(h.db.prepare('SELECT count(DISTINCT request_id) AS n FROM usage_request_rows').get().n,2);assert.equal(h.db.prepare('SELECT sum(tokens_in) AS n FROM usage_log').get().n,22);
  });}finally{console.error=old;}
  assert(!logs.some(x=>/persistUsage:|usage_coverage_gap/.test(x)),'No accounting fallback or lost-evidence logs');console.log(JSON.stringify({proof:'actual_Hono_SQLite',dispatches:2,usage_rows:2,request_links:2,attempts:2,evidence:2,same_id_persistence_replay_added_rows:0,session_attributed:2,provider_calls:0}));
 }finally{h.close();}
});
test('missing mirror or linkage is observed as failure, not masked by observer',options,async()=>{
 const{m,h}=await fixture();try{
  // The initializer must detect a canonical admin route whose durable mirror was lost.
  h.db.prepare('DELETE FROM sessions WHERE id=?').run(session);
  await assert.rejects(initializeAccounting({root:source,harness:{...h,request:async()=>({status:200})},cohort,profile,session:{session_id:session}}),/D1 mirror missing/);
  await m.persistUsage(h.env,{session_id:null,request_id:'synthetic-missing-attribution',cohort_id:cohort,user_id:user,profile_id:profile,model:'synthetic-model',tokens_in:1,tokens_out:1,cache_read:0,cache_create:0,latency_ms:1,status:200});
  assert.equal(settledUsage(h.db,'synthetic-missing-attribution',session).session_matches,false);assert.equal(accountingSummary(h.db).null_session_rows,1);
  h.db.exec('DROP TABLE usage_request_rows');assert.throws(()=>settledUsage(h.db,'synthetic-missing-attribution',session),/no such table/);
 }finally{h.close();}
});
async function until(fn,ms=10000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,25));}throw Error('Owned fixture deadline exceeded');}
test('actual native fixture bridges completed + cancelled usage and preserves metadata/session-end contracts',options,async()=>{
 await actual();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hps-native-accounting-'));const childEnv=Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot','WINDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(childEnv,{HPS_SERVICE_SOURCE:source,HPS_SERVICE_SHA:sha});
 const child=spawn(process.execPath,[fileURLToPath(new URL('./service.mjs',import.meta.url)),dir,'--scripted-upstream'],{env:childEnv,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);const exited=once(child,'exit');let passed=false,origin;
 try{
  await until(()=>{if(child.exitCode!==null)throw Error('Fixture exited before readiness');return fs.existsSync(path.join(dir,'service.json'));});const manifest=JSON.parse(fs.readFileSync(path.join(dir,'service.json')));origin=manifest.origin;assert.equal(new URL(origin).hostname,'127.0.0.1');ownedOrigins.add(origin);assert.equal(manifest.accounting.migration.path,ATTRIBUTION_MIGRATION);assert.equal(manifest.accounting.session_parent_verified,true);const hash=value=>createHash('sha256').update(value).digest('hex');assert.equal(manifest.accounting.helper_sha256,hash(fs.readFileSync(new URL('./service-accounting.mjs',import.meta.url))));assert.equal(manifest.accounting.migration.sha256,hash(fs.readFileSync(path.join(source,ATTRIBUTION_MIGRATION))));const sourceHash=createHash('sha256');for(const file of execFileSync('git',['ls-files','worker/src','worker/schema.sql','worker/test/harness',ATTRIBUTION_MIGRATION],{cwd:source,encoding:'utf8'}).trim().split('\n').sort())sourceHash.update(file+'\0').update(fs.readFileSync(path.join(source,file)));assert.equal(manifest.source.sha256,sourceHash.digest('hex'));
  const token=fs.readFileSync(manifest.token_a_file,'utf8');const send=marker=>fetch(manifest.origin+'/v1/messages',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model:'hypeproof-default',max_tokens:4096,stream:true,messages:[{role:'user',content:marker}]})});
  const complete=await send('HPS_NATIVE_A1');assert.equal(complete.status,200);await complete.text();
  const partial=await send('HPS_NATIVE_STOP_HOLD');assert.equal(partial.status,200);const reader=partial.body.getReader();await reader.read();await reader.cancel();
  const result=await until(async()=>{const state=await(await fetch(manifest.origin+'/__feedback-native/requests')).json();return state.calls.filter(r=>r.ledger_request_id&&r.context_settled&&r.usage).length===2&&state;});
  const rows=result.calls.filter(r=>r.usage);for(const row of rows){assert.equal(row.usage.linked_rows,1);assert.equal(row.usage.session_matches,true);assert.equal(row.usage.rows[0].request_id,row.ledger.request_id);assert.equal(row.ledger.evidence_version,1);}
  assert.equal(rows[0].ledger.execution_state,'ended');assert.equal(rows[1].ledger.execution_state,'unknown');assert.equal(rows[1].service_body_cancelled,true);assert.equal(result.accounting.usage_rows,2);assert.equal(result.accounting.request_links,2);assert.equal(result.accounting.null_session_rows,0);assert.equal(result.accounting.unlinked_rows,0);assert.equal(result.blocked_outbound,0);assert.equal(result.provider_called,false);
  const {endSyntheticSession}=await import('./session-control.mjs');const ended=await endSyntheticSession({manifestFile:path.join(dir,'service.json'),origin:manifest.origin,expectedSource:manifest.source,token});assert.equal(ended.error_type,'session_inactive');
  assert(!/persistUsage:|usage_coverage_gap/.test(output));console.log(JSON.stringify({proof:'actual_native_fixture_HTTP',completed:1,cancelled:1,accounting:result.accounting,canonical_session_end_denied:true,provider_calls:0}));passed=true;
 }finally{
  if(child.exitCode===null)child.kill('SIGTERM');const [exitCode,exitSignal]=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Owned fixture did not exit')),5000).unref())]);
  const termination=fixtureTermination(process.platform,exitCode,exitSignal);
  if(origin){await assert.rejects(fetch(origin+'/__feedback-native/identity',{signal:AbortSignal.timeout(1000)}),error=>error.cause?.code==='ECONNREFUSED','Owned listener must be closed, not merely exit requested');ownedOrigins.delete(origin);}
  console.log(JSON.stringify({proof:'owned_fixture_cleanup',process_exit_observed:true,listener_refused:!!origin,termination,native_ui:false}));if(passed)await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:process.platform==='win32'?3:0,retryDelay:100});else{fs.writeFileSync(path.join(dir,'failure.log'),output,{mode:0o600});console.error('Retained failed owned fixture: '+dir);}
 }
});
