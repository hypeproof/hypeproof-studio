// Actual pinned Worker/D1. Synthetic identity approval is runner-armed, never native credential injection.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {randomBytes,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApprovalSequence,publicRoute,accountId,recordDenial} from './auth-contract.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function startAuthService({source,expectedSha}){
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
 assert(/^[a-f0-9]{40}$/.test(expectedSha)&&git('rev-parse','HEAD')===expectedSha,'service_pin');
 assert.equal(git('status','--porcelain','--','worker/src','worker/schema.sql','worker/migrations'),'','service_dirty');
 const require=createRequire(join(source,'worker/package.json'));
 const {build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare');
 const files=['schema.sql','migrations/0004-native-trials.sql','migrations/0007-access-contracts.sql','migrations/0043-purchase-orders.sql','migrations/0047-personal-accounts.sql','migrations/0048-account-operations.sql','migrations/0049-native-grant-purpose.sql'];
 const built=await build({entryPoints:[join(source,'worker/src/index.ts')],bundle:true,write:false,platform:'browser',target:'es2022',format:'esm',external:['node:*','cloudflare:*'],loader:{'.md':'text','.html':'text','.yaml':'text'},logLevel:'silent'});
 const bridge=randomBytes(32).toString('hex'),signing=randomBytes(32).toString('hex');
 const sequence=new ApprovalSequence,requests=[],denied=[],approvals=[];let origin,db,account,closed=false,outbound=0,failure=null,requestAttempts=0,nativeSession=null;
 const server=createServer(async(req,res)=>{
  const send=(status,v)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(v));};
  try{
   assert(++requestAttempts<=80&&typeof req.url==='string'&&req.url.length<=512,'fixture_attempt_bound');
   assert(req.headers.host===new URL(origin).host&&['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress),'loopback_only');
   if(!publicRoute(req.method,req.url)){recordDenial(denied,{method:req.method,pathHash:hash(req.url),category:req.url.startsWith('/v1/companion/')?'companion':req.url.startsWith('/v1/messages')||req.url.startsWith('/v1/chat/')?'model':'other'});return send(403,{error:'fixture_route_denied'});}
   assert(requests.length<40,'request_bound');let raw='';for await(const chunk of req){raw+=chunk;assert(Buffer.byteLength(raw)<=8192,'body_bound');}
   const response=await mf.dispatchFetch('http://fixture.invalid'+req.url,{method:req.method,headers:{...req.headers,'cf-connecting-ip':'127.0.0.1'},...(req.method==='GET'?{}:{body:raw})});
   const value=await response.json();requests.push({method:req.method,path:req.url,status:response.status,bearer:!!req.headers.authorization});
   if(req.url==='/v1/auth/device/start'&&response.status===200)sequence.started(value);
   if(req.url==='/v1/auth/device/poll'&&response.status===202){sequence.pending();const code=sequence.approval();const approved=await internal('device/approve',{user_code:code,account_id:account,approve:true});assert.equal(approved.status,'approved');approvals.push({phase:sequence.active.phase,synthetic:true,pendingObserved:true});}
   if(req.url==='/v1/auth/device/poll'&&response.status===200){assert.equal(value.account.id,account);assert(typeof value.session_id==='string');nativeSession=value.session_id;sequence.consumed();}
   if(req.url==='/v1/me'&&response.status===200){assert.equal(value.account.id,account);assert.equal(value.account.status,'active');assert.equal(value.session_id,nativeSession);sequence.me();}
   send(response.status,value);
  }catch(error){failure=error?.code==='ERR_ASSERTION'?'fixture_contract':'fixture_request';if(!res.headersSent)send(503,{error:failure});else res.end();}
 });
 server.requestTimeout=15000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});origin='http://127.0.0.1:'+server.address().port;
 let mf;
 try{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],log:new Log(LogLevel.NONE),d1Databases:{HPS_DB:'synthetic-android-ui'},kvNamespaces:['HPS_KV'],bindings:{ENVIRONMENT:'development',HPS_ACCOUNTS:'enabled',HPS_ACCOUNT_LAB_KEY:bridge,HPS_ACCOUNT_LAB_ORIGIN:origin,HPS_SIGNING_SECRET:signing},outboundService:()=>{outbound++;return new Response('disabled',{status:403});}}));
 }catch(error){server.closeAllConnections();server.close();throw error;}
 async function internal(path,value){const r=await mf.dispatchFetch('http://fixture.invalid/v1/internal/accounts/'+path,{method:'POST',headers:{'content-type':'application/json','x-hps-account-key':bridge,'cf-connecting-ip':'127.0.0.1'},body:JSON.stringify(value)});assert.equal(r.status,200,'actual_internal_account');return r.json();}
 try{
  db=await mf.getD1Database('HPS_DB');
  for(const file of files){const sql=readFileSync(join(source,'worker',file),'utf8').replace(/--[^\n]*/g,''),triggers=[...sql.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(m=>m[0]);for(const statement of [...sql.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(x=>x.trim()),...triggers])await db.prepare(statement).run();}
  const created=await internal('upsert',{provider:'google',subject:'synthetic-android-'+randomBytes(12).toString('hex'),email:'android@synthetic.invalid',email_verified:true,display_name:'Synthetic Android',age_band:'14+',consents:['terms','privacy','overseas_transfer'].map(kind=>({kind,version:'2026-10-15',granted:true}))});
  account=accountId(created.account.id);
  // No returned signup credential is given to Android; native start/poll creates its own session.
  const receipt={sourceSha:expectedSha,workerBundleSha256:hash(built.outputFiles[0].contents),migrations:files.map(file=>({file,sha256:hash(readFileSync(join(source,'worker',file)))}))};
  return{origin,account,receipt,arm(phase){assert(!failure,'fixture_failed');sequence.arm(phase);},async snapshot(complete=false){if(complete)sequence.complete();assert(!failure,'fixture_failed');const passCount=await db.prepare('SELECT COUNT(*) AS n FROM purchase_orders').first();return{requests,approvals,outbound,denied,complete,modelConfigured:false,paidPassCreated:false,purchaseOrders:passCount.n};},async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(r=>server.close(r));await mf.dispose();}};
 }catch(error){server.closeAllConnections();server.close();await mf.dispose();throw error;}
}
async function cli(){
 assert(process.argv.slice(2).join(' ')==='--run'&&process.env.HPS_ANDROID_OWNED_HOSTED==='1','explicit_owned_mode');
 const pin=JSON.parse(readFileSync(new URL('../../config/service-deployment.json',import.meta.url)));
 assert.equal(pin.sha,process.env.HPS_SERVICE_SHA);assert.equal(pin.repository,'hypeproof/hypeproof-service');
 const runtime=await startAuthService({source:resolve(process.env.HPS_SERVICE_SOURCE),expectedSha:pin.sha});
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;try{await runtime.close();}finally{process.exitCode=1;process.stdin.destroy();}};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 const emit=v=>process.stdout.write(JSON.stringify(v)+'\n');emit({kind:'ready',origin:runtime.origin,account:runtime.account,receipt:runtime.receipt});
 const input=createInterface({input:process.stdin,crlfDelay:Infinity});try{for await(const line of input){assert(line.length<=256);const q=JSON.parse(line);if(q.kind==='arm'){assert.deepEqual(Object.keys(q).sort(),['kind','phase']);runtime.arm(q.phase);emit({kind:'armed',phase:q.phase});}else if(q.kind==='snapshot'){assert.deepEqual(Object.keys(q).sort(),['complete','kind']);emit({kind:'snapshot',value:await runtime.snapshot(q.complete===true)});}else if(q.kind==='stop'){await runtime.close();emit({kind:'closed'});return;}else throw Error('control');}}finally{input.close();process.stdin.pause();await runtime.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await cli().catch(()=>{process.stderr.write('authenticated_fixture_failed\n');process.exitCode=1;});
