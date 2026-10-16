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
import {createHash} from 'node:crypto';
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
const calls=[];let blockedOutbound=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(['127.0.0.1','localhost'].includes(u.hostname))return originalFetch(input,init);blockedOutbound++;throw Error('Provider/outbound network disabled in metadata-only native fixture');};
const server=createServer(async(req,res)=>{try{const parts=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>1024*1024)throw Error('request too large');parts.push(b);}const ctx=makeCtx();const response=await app.fetch(new Request('https://synthetic.test'+req.url,{method:req.method,headers:req.headers,...(bytes?{body:Buffer.concat(parts)}:{})}),env,ctx);calls.push({method:req.method,path:req.url.split('?')[0],status:response.status});res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const part of response.body)res.write(part);res.end();await ctx.settle();}catch{if(!res.headersSent)res.writeHead(500);res.end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const sourceFiles=git('ls-files','worker/src','worker/schema.sql','worker/test/harness').split('\n').filter(Boolean).sort();const hash=createHash('sha256');for(const file of sourceFiles)hash.update(file+'\0').update(fs.readFileSync(path.join(root,file)));
const manifest={schema:'hps-feedback-service/1',origin,source:{repository:'hypeproof/hypeproof-service',directory:root,sha:git('rev-parse','HEAD'),sha256:hash.digest('hex'),dirty:false},runtime:'actual source Hono router, token verifier, SQLite schema; synthetic KV/D1 adapter/session/roster',profile,token_a_file:tokenFiles[0],token_b_file:tokenFiles[1],provider:'disabled; metadata/auth/workspace UI only',evidence_level:'synthetic-local-Service-not-production'};
fs.writeFileSync(path.join(out,'service.json'),JSON.stringify(manifest,null,2));
const stop=async()=>{fs.writeFileSync(path.join(out,'requests.json'),JSON.stringify({calls,blocked_outbound:blockedOutbound,provider_called:false},null,2));await new Promise(resolve=>server.close(resolve));harness.close();};
if(process.argv.includes('--probe')){for(const file of tokenFiles){const token=fs.readFileSync(file,'utf8');const response=await originalFetch(origin+'/v1/profile',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,200,await response.text());const activity=await originalFetch(origin+'/v1/activity',{headers:{authorization:'Bearer '+token}});assert.equal(activity.status,200,await activity.text());}await stop();console.log(JSON.stringify({status:'PASS',actual_service_source:manifest.source,profile_and_activity:2,provider_called:false,manifest:path.join(out,'service.json')}));}
else{console.log(JSON.stringify({manifest:path.join(out,'service.json'),origin,provider:'disabled',tokens:'private files; never printed'}));let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await stop();process.exit(0);});}
