#!/usr/bin/env node
// Actual Service source router/token verifier/SQLite, with explicitly synthetic bindings. No model provider is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {AsyncLocalStorage} from 'node:async_hooks';
import {startScriptedUpstream} from './scripted-upstream.mjs';
import {createHash,randomBytes} from 'node:crypto';
const source=process.env.HPS_SERVICE_SOURCE;
if(!source)throw Error('HPS_SERVICE_SOURCE must name the actual candidate hypeproof-service checkout');
const expectedSha=process.env.HPS_SERVICE_SHA;
if(!/^[a-f0-9]{40}$/.test(expectedSha??''))throw Error('HPS_SERVICE_SHA must explicitly pin the intended Service checkout');
const root=fs.realpathSync(source),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==expectedSha)throw Error('Service checkout HEAD differs from explicit HPS_SERVICE_SHA');
const dirty=git('status','--porcelain','--','worker/src','worker/test/harness','worker/schema.sql');
if(dirty)throw Error('Candidate Service source is dirty; freeze it before this acceptance run');
const out=path.resolve(process.argv.find((arg,i)=>i>1&&!arg.startsWith('--'))||fs.mkdtempSync(path.join(os.tmpdir(),'hps-feedback-service-')));
fs.mkdirSync(out,{recursive:true,mode:0o700});
if(fs.existsSync(path.join(out,'service.json')))throw Error('Refusing to reuse a previous Service fixture directory');
await import(pathToFileURL(path.join(root,'worker/test/harness/loader.mjs')));
const {accessHarness}=await import(pathToFileURL(path.join(root,'worker/test/harness/access.mjs')));
const {makeCtx,TEST_SECRET}=await import(pathToFileURL(path.join(root,'worker/test/harness/index.mjs')));
const {issue}=await import(pathToFileURL(path.join(root,'worker/src/lib/tokens.ts')));
const {setRoster,startSession}=await import(pathToFileURL(path.join(root,'worker/src/lib/kv.ts')));
const app=await (await import(pathToFileURL(path.join(root,'worker/test/harness/index.mjs')))).bootApp();
const harness=await accessHarness(),env=harness.env;
delete env.HPS_ACCESS_CONTRACTS;delete env.OPENAI_API_KEY;delete env.ANTHROPIC_API_KEY;delete env.HPS_IMAGE_EDIT_PROVIDER_KEY;
const cohort='synthetic-release-acceptance',profile='synthetic-release-acceptance',users=['synthetic-feedback-A','synthetic-feedback-B'];
await setRoster(env.HPS_KV,cohort,users);
await startSession(env.HPS_KV,cohort,{session_id:'synthetic-feedback-native',profile_id:profile,starts_at:new Date(Date.now()-60_000).toISOString(),ends_at:new Date(Date.now()+4*3600_000).toISOString()});
const tokenFiles=[];for(const [i,user]of users.entries()){const token=(await issue({u:user,c:cohort,p:profile},4,TEST_SECRET)).token;const file=path.join(out,`token-${i===0?'a':'b'}`);fs.writeFileSync(file,token,{mode:0o600});tokenFiles.push(file);}
const fixtureHash=createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),instance=randomBytes(32).toString('hex');
const adminFile=path.join(out,'admin-control');fs.writeFileSync(adminFile,env.HPS_ADMIN_PASSWORD,{mode:0o600});
const identity={schema:'hps-feedback-native-session-control/1',instance,pid:process.pid,fixture_sha256:fixtureHash,source_sha:expectedSha,cohort,provider_called:false};
const calls=[],context=new AsyncLocalStorage();let blockedOutbound=0;const originalFetch=globalThis.fetch;
const policyMode=process.argv.includes('--scripted-policy'),renderMode=process.argv.includes('--scripted-render');
if([policyMode,renderMode,process.argv.includes('--scripted-upstream')].filter(Boolean).length>1)throw Error('Choose one owned scripted scenario');
if(policyMode&&process.argv.includes('--scripted-upstream'))throw Error('Choose one owned scripted scenario');
const scripted=process.argv.includes('--scripted-upstream')||policyMode||renderMode?await startScriptedUpstream({ledgerFile:path.join(out,'scripted-ledger.json'),controlSecret:env.HPS_ADMIN_PASSWORD,...(renderMode?{renderConfig:JSON.parse(fs.readFileSync(path.join(out,'render-config.json'),'utf8'))}:{}),...(policyMode?{policyRoot:fs.realpathSync(fs.readFileSync(path.join(out,'policy-root'),'utf8'))}:{})}):null;
if(scripted){Object.assign(identity,{scripted_origin:scripted.origin,scripted_mode:renderMode?'owned-render-feedback':'native-history-text',scripted_module_sha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(new URL('./scripted-upstream.mjs',import.meta.url)))).digest('hex')});env.ANTHROPIC_API_KEY=env.HPS_ADMIN_PASSWORD;env.ANTHROPIC_PROXY_URL=scripted.origin+'/v1/messages';}
globalThis.fetch=async(input,init)=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(scripted&&u.origin===scripted.origin&&u.pathname.startsWith('/v1/messages')){
  const row=context.getStore();if(!row)throw Error('Scripted upstream requires actual Service dispatch linkage');
  row.scripted_dispatches=(row.scripted_dispatches??0)+1;
  if(row.ledger_registration_id&&harness.db?.prepare('SELECT request_id FROM usage_attempt_costs WHERE request_id=?').get(row.ledger_registration_id))row.ledger_request_id=row.ledger_registration_id;
  const headers=new Headers(init?.headers);headers.set('x-hps-native-subject',row.subject);headers.set('x-hps-native-service-seq',String(row.seq));
  return originalFetch(input,{...init,headers,redirect:'error'});
 }
 if(['127.0.0.1','localhost'].includes(u.hostname))return originalFetch(input,init);
 blockedOutbound++;throw Error('External provider/outbound network disabled in native fixture');
};
// Observe only the existing typed accounting registration; execute its SQL/bindings unchanged.
const originalDb=env.HPS_DB;
env.HPS_DB={...originalDb,prepare(sql){const statement=originalDb.prepare(sql),bind=statement.bind;statement.bind=function(...args){
 if(/INSERT(?: OR IGNORE)? INTO usage_attempt_costs/i.test(sql)){const row=context.getStore();if(row)for(const value of args)if(typeof value==='string'&&value.startsWith('{')){try{const document=JSON.parse(value);if(typeof document.request_id==='string'&&document.observation?.parent_request_id){row.ledger_registration_id=document.request_id;row.parent_request_id=document.observation.parent_request_id;row.ledger_request_class=document.observation.request_class;}}catch{}}}
 return bind.apply(statement,args);
};return statement;}};
const server=createServer(async(req,res)=>{
 let reader,row,cancellation;
 const cancelReader=()=>{if(reader&&!cancellation){row.reader_cancel_calls=(row.reader_cancel_calls??0)+1;cancellation=reader.cancel().then(()=>{row.service_body_cancelled=true;});void cancellation.catch(()=>{});}return cancellation;};
 try{
  if(req.method==='GET'&&req.url==='/__feedback-native/requests'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({calls,blocked_outbound:blockedOutbound,provider_called:false}));return;}
  if(req.method==='GET'&&req.url==='/__feedback-native/identity'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(identity));return;}
  const parts=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>1024*1024)throw Error('request too large');parts.push(b);}
  const auth=req.headers.authorization,subject=tokenFiles.findIndex(file=>auth==='Bearer '+fs.readFileSync(file,'utf8'));
  const requestClass=req.headers['x-claude-code-request-class'];
  row={seq:calls.length+1,method:req.method,path:req.url.split('?')[0],subject:subject===0?'A':subject===1?'B':'unknown',turn_sha256:typeof req.headers['x-hps-turn-id']==='string'?createHash('sha256').update(req.headers['x-hps-turn-id']).digest('hex'):null,request_class:typeof requestClass==='string'&&/^[a-zA-Z0-9_:-]{1,64}$/.test(requestClass)?requestClass:null,status:null,client_closed:false,service_body_cancelled:false};calls.push(row);
  if(scripted&&req.method==='POST'&&row.path==='/v1/chat/completions')throw Error('Proxy fallback cannot establish actual SDK readiness');
  const ctrl=new AbortController();req.once('aborted',()=>ctrl.abort());
  res.once('close',()=>{if(!res.writableEnded){row.client_closed=true;ctrl.abort();cancelReader();}});
  const ctx=makeCtx();
  const response=await context.run(row,()=>app.fetch(new Request('https://synthetic.test'+req.url,{method:req.method,headers:req.headers,signal:ctrl.signal,...(bytes?{body:Buffer.concat(parts)}:{})}),env,ctx));
  row.status=response.status;row.request_id=response.headers.get('x-request-id');row.usage_request_id=response.headers.get('x-hps-usage-request-id');
  res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body){reader=response.body.getReader();if(res.destroyed)cancelReader();try{for(;;){const next=await reader.read();if(next.done||res.destroyed)break;if(!res.write(next.value))await new Promise(resolve=>{res.once('drain',resolve);res.once('close',resolve);});}}finally{await cancellation;reader.releaseLock();}}
  if(!res.destroyed)res.end();await cancellation;await ctx.settle();row.context_settled=true;
  if(row.ledger_request_id)row.ledger=harness.db?.prepare('SELECT request_id,evidence_version,execution_state,pricing_state,amount_micro,currency FROM usage_attempt_costs WHERE request_id=?').get(row.ledger_request_id)??null;
 }catch{if(row)row.bridge_error=true;if(!res.headersSent)res.writeHead(500);if(!res.destroyed)res.end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const sourceFiles=git('ls-files','worker/src','worker/schema.sql','worker/test/harness').split('\n').filter(Boolean).sort();const hash=createHash('sha256');for(const file of sourceFiles)hash.update(file+'\0').update(fs.readFileSync(path.join(root,file)));
const manifest={schema:'hps-feedback-service/1',origin,source:{repository:'hypeproof/hypeproof-service',directory:root,sha:git('rev-parse','HEAD'),sha256:hash.digest('hex'),dirty:false},runtime:'actual source Hono router, token verifier, SQLite schema; synthetic KV/D1 adapter/session/roster',profile,...(scripted?{scripted:{schema:'hps-native-scripted-upstream/1',mode:identity.scripted_mode,source_sha256:identity.scripted_module_sha256,origin:scripted.origin,ledger:path.join(out,'scripted-ledger.json'),request_limit:12,output_cap:4096}}:{}),session_control:{schema:identity.schema,instance,pid:process.pid,cohort,fixture_sha256:fixtureHash,admin_file:adminFile,admin_sha256:createHash('sha256').update(env.HPS_ADMIN_PASSWORD).digest('hex')},token_a_file:tokenFiles[0],token_b_file:tokenFiles[1],provider:scripted?(renderMode?'scripted loopback render-feedback; external providers disabled':policyMode?'scripted loopback tool-use policy; external providers disabled':'scripted loopback text only; external providers disabled'):'disabled; metadata/auth/workspace UI only',evidence_level:'synthetic-local-Service-not-production'};
fs.writeFileSync(path.join(out,'service.json'),JSON.stringify(manifest,null,2));
const stop=async()=>{fs.writeFileSync(path.join(out,'requests.json'),JSON.stringify({calls,blocked_outbound:blockedOutbound,provider_called:false},null,2));await scripted?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));harness.close();};
if(process.argv.includes('--probe')||process.argv.includes('--probe-session-ended')){for(const file of tokenFiles){const token=fs.readFileSync(file,'utf8');const response=await originalFetch(origin+'/v1/profile',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200,await response.text());const activity=await originalFetch(origin+'/v1/activity',{headers:{authorization:'Bearer '+token}});assert.equal(activity.status,200,await activity.text());}let sessionControl;if(process.argv.includes('--probe-session-ended')){const {endSyntheticSession}=await import('./session-control.mjs');sessionControl=await endSyntheticSession({manifestFile:path.join(out,'service.json'),origin,expectedSource:manifest.source,token:fs.readFileSync(tokenFiles[0],'utf8')});}await stop();console.log(JSON.stringify({status:'PASS',session_control:sessionControl,actual_service_source:manifest.source,profile_and_activity:2,provider_called:false,manifest:path.join(out,'service.json')}));}
else{console.log(JSON.stringify({manifest:path.join(out,'service.json'),origin,provider:'disabled',tokens:'private files; never printed'}));let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await stop();process.exit(0);});}
