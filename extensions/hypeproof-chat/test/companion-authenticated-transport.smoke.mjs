import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { AccountSession, ACCOUNT_SECRET_KEY } from '../src/accountSession.ts';
import { CompanionTransportBudget } from '../src/companionTransportBudget.ts';
const require=createRequire(import.meta.url),pairId='ci_'+'a'.repeat(32);
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/companionAuthenticatedTransport.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const module={exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?{ExtensionMode:{Development:2,Production:1}}:require(id),URL,Response,AbortController,TextDecoder,setTimeout,clearTimeout,Buffer});
const {createCompanionAuthenticatedTransport}=module.exports;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const normal={invitation:{schema:'hps-companion-pairing-preview/2',id:pairId,account_id:'account',host_session_id:'session'},execution_authorized:false,scope_authority:'authenticated_declaration'};
function fixture(options={}){
 let config={service:'http://127.0.0.1:44321/v1',site:'http://localhost:3193'},token='synthetic-token',sessionId='session';const calls=[];let handler=options.handler;
 const context={extensionMode:2},accounts={matches:(s,t)=>s==='http://127.0.0.1:44321/v1'&&t==='http://localhost:3193',accessToken:async()=>token,sessionIdentity:async()=>token?{service:'http://127.0.0.1:44321/v1',sessionId}:undefined};
 const dispatch=async(url,init)=>{calls.push({url,init});if(handler)return handler(url,init);return json(url.endsWith('/me')?{account:{id:'account'},session_id:'session'}:normal);};
 const api=createCompanionAuthenticatedTransport({context,accounts,configured:()=>config,identity:{accountId:'account',sessionId:'session'},role:'host',dispatch,timeoutMs:options.timeoutMs});
 return{api,calls,context,accounts,set config(v){config=v;},set token(v){token=v;},set sessionId(v){sessionId=v;},set handler(v){handler=v;}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{resolve,promise};};

test('explicit identity resolution only once; each operation dispatches one native HTTP request with no Origin/redirect credentials',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);await f.api.resolveIdentity();assert.equal(f.calls.length,1);await f.api.pairing('host',pairId,'status',{});await f.api.pairing('host',pairId,'status',{});assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(c=>new URL(c.url).pathname),['/v1/me','/v1/companion/invitations/'+pairId+'/status','/v1/companion/invitations/'+pairId+'/status']);
 for(const c of f.calls){assert.equal(c.init.headers.authorization,'Bearer synthetic-token');assert.equal(new Headers(c.init.headers).has('origin'),false);assert.equal(c.init.redirect,'error');assert.equal(c.init.credentials,'omit');assert.ok(c.init.signal);}
 await assert.rejects(()=>f.api.resolveIdentity(),/already_resolved/);
});

test('unsafe mode/config/role/path/body and missing identity/token fail before protocol dispatch',async()=>{
 for(const mutate of [f=>f.context.extensionMode=1,f=>f.config={service:'https://api.hypeproof-ai.xyz/v1',site:'https://hypeproof-ai.xyz'},f=>f.config={service:'http://127.0.0.1:44321/v1?query',site:'http://localhost:3193'},f=>f.token=undefined]){const f=fixture();mutate(f);await assert.rejects(()=>f.api.resolveIdentity());assert.equal(f.calls.length,0);}
 const f=fixture();await assert.rejects(()=>f.api.pairing('host',pairId,'status',{}),/identity_required/);assert.equal(f.calls.length,0);await f.api.resolveIdentity();
 for(const call of [()=>f.api.pairing('host','https://elsewhere.test','status',{}),()=>f.api.pairing('device',pairId,'claim',{}),()=>f.api.pairing('host',pairId,'inspect',{}),()=>f.api.relay('host',pairId,'execute','{}'),()=>f.api.relay('host',pairId,'send','['),()=>f.api.relay('host',pairId,'send',JSON.stringify({text:'x'.repeat(8192)}))])await assert.rejects(call,/invalid_request/);assert.equal(f.calls.length,1);
});

test('configuration, session, token and account changes terminally invalidate, never publish late receipts or resend',async()=>{
 for(const mutate of [f=>f.config={service:'http://127.0.0.1:44322/v1',site:'http://localhost:3193'},f=>f.sessionId='other',f=>f.token=undefined,f=>f.token='rotated']){
  const f=fixture();await f.api.resolveIdentity();const entered=deferred(),release=deferred();f.handler=async()=>{entered.resolve();await release.promise;return json(normal);};const pending=f.api.pairing('host',pairId,'status',{});await entered.promise;mutate(f);release.resolve();await assert.rejects(()=>pending,/binding_changed/);await assert.rejects(()=>f.api.pairing('host',pairId,'status',{}),/binding_changed/);assert.equal(f.calls.length,2);
 }
 const f=fixture({handler:async()=>json({account:{id:'other'},session_id:'session'})});await assert.rejects(()=>f.api.resolveIdentity(),/binding_changed/);await assert.rejects(()=>f.api.resolveIdentity(),/binding_changed/);assert.equal(f.calls.length,1);
});

test('malformed, denied, oversized and stalled responses are bounded; cancellation suppresses a late result',async()=>{
 for(const response of [()=>new Response('not JSON',{headers:{'content-type':'application/json'}}),()=>json({...normal,execution_authorized:true}),()=>json({error:'session_revoked'},401),()=>json({padding:'x'.repeat(65536)})]){const f=fixture();await f.api.resolveIdentity();f.handler=async()=>response();await assert.rejects(()=>f.api.pairing('host',pairId,'status',{}));assert.equal(f.calls.length,2);}
 const streaming=fixture();await streaming.api.resolveIdentity();streaming.handler=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));}}),{headers:{'content-type':'application/json'}});await assert.rejects(()=>streaming.api.pairing('host',pairId,'status',{}),/response_too_large/);
 const stalled=fixture({timeoutMs:20});await stalled.api.resolveIdentity();stalled.handler=()=>new Promise(()=>{});await assert.rejects(()=>stalled.api.pairing('host',pairId,'status',{}),/timeout/);
 const f=fixture();await f.api.resolveIdentity();const entered=deferred(),release=deferred(),abort=new AbortController();f.handler=async()=>{entered.resolve();await release.promise;return json(normal);};const work=f.api.pairing('host',pairId,'status',{},abort.signal);await entered.promise;abort.abort();await assert.rejects(()=>work,/cancelled/);release.resolve();assert.equal(f.calls.length,2);
});

test('raw dispatch failures never echo a credential/body; malformed relay success cannot publish',async()=>{
 const f=fixture();await f.api.resolveIdentity();f.handler=async()=>{throw Error('raw secret-token body');};await assert.rejects(()=>f.api.pairing('host',pairId,'status',{}),error=>error.message==='companion_authenticated_unavailable');
 f.handler=async()=>json({schema:'hps-companion-relay-dev/1',execution_authorized:false,scope_authority:'authenticated_declaration',transport_only:true,host_durable_accepted:false});await assert.rejects(()=>f.api.relay('host',pairId,'receive','{}'),/invalid_response/);
});

test('rejected response headers cancel the live body before the bounded operation ends',async()=>{
 for(const headers of [{ 'content-type':'text/html' },{}, { 'content-type':'application/json', 'content-length':'65537' }]){
  const f=fixture();await f.api.resolveIdentity();let cancelled=0;
  f.handler=async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{headers});
  await assert.rejects(()=>f.api.pairing('host',pairId,'status',{}),/invalid_response|response_too_large/);
  assert.equal(cancelled,1,'rejected live response must release its body');
  assert.equal(f.calls.length,2,'cleanup must not retry the operation');
 }
 const f=fixture();await f.api.resolveIdentity();let cancelled=0;
 f.handler=async()=>{const response=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});Object.defineProperty(response,'redirected',{value:true});return response;};
 await assert.rejects(()=>f.api.pairing('host',pairId,'status',{}),/invalid_response/);
 assert.equal(cancelled,1,'a rejected redirected response must release its body');
});

test('relay receive permits a real eight-message-sized envelope under64KiB; caller admits actual HTTP exactly once',async()=>{
 const f=fixture();let admissions=0;const budget=new CompanionTransportBudget();const api=createCompanionAuthenticatedTransport({context:f.context,accounts:f.accounts,configured:()=>({service:'http://127.0.0.1:44321/v1',site:'http://localhost:3193'}),identity:{accountId:'account',sessionId:'session'},role:'host',dispatch:(url,init)=>budget.run(async()=>{admissions++;return url.endsWith('/me')?json({account:{id:'account'},session_id:'session'}):json({schema:'hps-companion-relay-dev/1',execution_authorized:false,scope_authority:'authenticated_declaration',transport_only:true,host_durable_accepted:false,messages:Array.from({length:8},()=>({ciphertext:'a'.repeat(4096),proof:'b'.repeat(128),metadata:'x'.repeat(350)}))});},init?.signal)});
 await api.resolveIdentity();const received=await api.relay('host',pairId,'receive','{}');assert.equal(received.messages.length,8);assert.equal(admissions,2);budget.dispose();
});

test('AccountSession readonly identity accessor neither discloses credentials nor refreshes/stores/network',async()=>{
 const store=new Map([[ACCOUNT_SECRET_KEY,JSON.stringify({service:'http://localhost:8787/v1',sessionId:'stored-session',accessToken:'never-return',refreshToken:'never-return',expiresAt:0})]]);let network=0,writes=0;
 const account=new AccountSession({service:'http://localhost:8787/v1',site:'http://localhost:3193',secrets:{get:async k=>store.get(k),store:async()=>{writes++;},delete:async()=>{writes++;}},label:'fixture',openBrowser:async()=>false,fetch:async()=>{network++;throw Error('must not refresh');}});
 assert.deepEqual(await account.sessionIdentity(),{service:'http://localhost:8787/v1',sessionId:'stored-session'});assert.equal(network,0);assert.equal(writes,0);store.clear();assert.equal(await account.sessionIdentity(),undefined);account.dispose();
});
