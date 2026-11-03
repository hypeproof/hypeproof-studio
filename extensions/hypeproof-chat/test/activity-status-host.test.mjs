import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
async function harness(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'activity-status-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const f=await createTaskHarness(root); f.h.loadAccess=async()=>{};
 f.vscode.window.showInformationMessage=async()=>{}; f.vscode.window.showWarningMessage=async()=>{}; return f;
}
test('host keeps typed failures and classroom identity without auth modal or purchase',async t=>{
 const f=await harness(t); const {ProxyAuthError,ProxyTransportError}=f.internals;
 for(const [status,code,cause] of [[401,undefined,'auth'],[401,'expired','expired'],[403,'session_window','ended'],[403,'cohort_paused','paused'],[429,'budget_exhausted','exhausted'],[429,undefined,'limited'],[503,undefined,'outage']]) {
  const e=status<429?new ProxyAuthError(status===401?'missing':'other','trial_exhausted'):new ProxyTransportError('trial_exhausted'); e.evidence={status,code};
  await f.h.handleSendError(e,'turn',{profile:{activity_kind:'classroom'},proxyUrl:'http://127.0.0.1/v1'});
  const m=f.posts.at(-1);assert.equal(m.type,'streamError'); assert.equal(m.activityUnavailable.cause,cause);assert.equal(m.activityUnavailable.audience,'classroom');assert.equal(m.trialEndCard,undefined);
 }
 assert.equal(f.browserState.commands.length,0);
 await f.handle(f.scoped({type:'ready'}));assert.equal(f.posts.filter(m=>m.activityUnavailable).at(-1).activityUnavailable.cause,'outage');
 await f.handle(f.scoped({type:'refreshAccess'}));assert.equal(f.h.lastActivityStatus,undefined);
});
test('local files work while paused without token; stale picker and double press do not copy',async t=>{
 const f=await harness(t);f.h.opsHold='paused';
 const uri=p=>({scheme:'file',fsPath:p,toString:()=>`file:${p}`});
 const source=uri(path.join(f.activity.workspace,'mine.txt')),dest=uri(path.join(f.activity.workspace,'export.txt'));fs.writeFileSync(source.fsPath,'my saved work');
 f.vscode.window.showOpenDialog=async()=>[source];f.vscode.window.showSaveDialog=async()=>dest;
 let copies=0;f.vscode.workspace.fs.copy=async(a,b,options)=>{assert.equal(options.overwrite,false);copies++;fs.copyFileSync(a.fsPath,b.fsPath,fs.constants.COPYFILE_EXCL);};
 await f.handle(f.scoped({type:'activityLocalFile',action:'open'}));assert.equal(f.browserState.commands.at(-1),'vscode.open');
 await f.handle(f.scoped({type:'activityLocalFile',action:'export'}));assert.equal(fs.readFileSync(dest.fsPath,'utf8'),'my saved work');
 let resolvePick;f.vscode.window.showOpenDialog=()=>new Promise(resolve=>{resolvePick=resolve;});
 const pending=f.handle(f.scoped({type:'activityLocalFile',action:'export'}));await f.handle(f.scoped({type:'activityLocalFile',action:'export'}));
 f.connections.active={...f.activity,id:'different-activity'};resolvePick([source]);await pending;assert.equal(copies,1);
});

// ── Fix round 1 (verify FAIL): every loss-of-AI path must be pinned at the host, not only the transport matrix. ──
import http from 'node:http';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const lastStream=f=>f.posts.filter(m=>m.type==='streamError').at(-1);
async function fail(f,err,profile,{proxyUrl='http://127.0.0.1:1/v1'}={}){
 f.posts.length=0; await f.h.handleSendError(err,'turn',{profile,proxyUrl,token:'t'}); return lastStream(f);
}
const transport=(f,status,code)=>{const e=new f.internals.ProxyTransportError('x');e.evidence={status,code};return e;};

test('offline (fetch TypeError) is an outage; any other unexplained error stays unknown',async t=>{
 const f=await harness(t);
 // The provider runs in its own realm; build the error there so `instanceof TypeError` is what production sees.
 const RealmTypeError=f.internals.ProxyTransportError.constructor('return TypeError')();
 const off=await fail(f,new RealmTypeError('fetch failed'),{activity_kind:'personal'});
 assert.deepEqual(off.activityUnavailable,{cause:'outage',audience:'solo'});
 const other=await fail(f,new Error('boom'),{activity_kind:'personal'});
 assert.deepEqual(other.activityUnavailable,{cause:'unknown',audience:'solo'});
});

test('seat audience comes from the turn profile: classroom wins even with a pass, personal and trial are solo',async t=>{
 const f=await harness(t); f.h.cachedProfile={activity_kind:'personal'};
 for(const [profile,audience] of [[{activity_kind:'classroom'},'classroom'],[{activity_kind:'classroom',pass:{request_limit:1}},'classroom'],[{activity_kind:'personal'},'solo'],[{activity_kind:'trial'},'solo'],[{activity_kind:'trial',pass:{request_limit:1}},'solo']]){
  const m=await fail(f,transport(f,503),profile);
  assert.equal(m.activityUnavailable.audience,audience,JSON.stringify(profile));
  assert.equal(m.activityUnavailable.cause,'outage');
 }
 // No turn profile: fall back to the cached one.
 f.posts.length=0; await f.h.handleSendError(transport(f,503),'turn',{profile:null,proxyUrl:'http://127.0.0.1:1/v1'});
 assert.equal(lastStream(f).activityUnavailable.audience,'solo');
});

test('instructor pause and an unconfirmed stop hold a send with a typed status; the draft is handed back',async t=>{
 const f=await harness(t);
 for(const [hold,cause] of [['paused','paused'],['stop_unconfirmed','forbidden']]){
  f.h.opsHold=hold; f.posts.length=0;
  await f.handle(f.scoped({type:'sendMessage',text:'내 질문'}));
  const rejected=f.posts.find(m=>m.type==='inputRejected'); assert.equal(rejected.text,'내 질문');
  assert.deepEqual(lastStream(f).activityUnavailable,{cause,audience:'classroom'},hold);
  assert.equal(lastStream(f).streamId,'connection');
 }
});

test('the trial card names expired and exhausted apart; a free daily cap is exhausted without a card',async t=>{
 const f=await harness(t);
 const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({products:[{id:'pass-lite',label:'라이트',amount:30000,currency:'KRW',duration_hours:720,request_limit:200,recommended:true}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>server.close());
 const proxyUrl=`http://127.0.0.1:${server.address().port}/v1`;
 const open={activity_kind:'trial',profile_id:'studio-open-trial'};
 const expired=await fail(f,new Error('API Error: 403 개인 체험 시간이 끝났습니다. 작업 파일은 그대로 남아 있습니다.'),open,{proxyUrl});
 assert.equal(expired.trialEndCard.ending,'expired'); assert.deepEqual(expired.activityUnavailable,{cause:'expired',audience:'solo'});
 const spent=await fail(f,new Error('API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다.'),open,{proxyUrl});
 assert.equal(spent.trialEndCard.ending,'exhausted'); assert.deepEqual(spent.activityUnavailable,{cause:'exhausted',audience:'solo'});
 const cap=await fail(f,new Error('오늘 준비한 무료 사용량이 모두 소진되었습니다.'),open,{proxyUrl});
 assert.deepEqual(cap.activityUnavailable,{cause:'exhausted',audience:'solo'}); assert.equal(cap.retry,false); assert.equal(cap.trialEndCard,undefined);
 // Negative control: the same sentence on a seat that is not the free allowance is not called a free cap.
 const notFree=await fail(f,new Error('오늘 준비한 무료 사용량이 모두 소진되었습니다.'),{activity_kind:'personal',profile_id:'other'},{proxyUrl});
 assert.equal(notFree.activityUnavailable.cause,'unknown');
});

test('a CLI/SDK refusal carries the Service evidence to the status',async t=>{
 const f=await harness(t);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'activity-status-sdk-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const out=path.join(dir,'sdk.cjs');
 await build({entryPoints:[fileURLToPath(new URL('../src/sdkCoach.ts',import.meta.url))],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent',external:['@anthropic-ai/claude-agent-sdk','zod'],
  plugins:[{name:'vscode-stub',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'module.exports={window:{},workspace:{},Uri:{file:(p)=>({fsPath:p})}};',loader:'js'}));}}]});
 const {runSdkCoach}=createRequire(import.meta.url)(out);
 const refusal=async(status,body)=>{
  const events=[{type:'system',subtype:'api_retry',error_status:status,error:'x'},{type:'assistant',error:'x',message:{id:'e',content:[{type:'text',text:`API Error: ${status} ${body}`}]}}];
  const sdk={query:()=>(async function*(){for(const e of events)yield e;})()};
  try{await runSdkCoach({sdk,binaryResolution:{available:true,reasons:[]},gatewayUrl:'http://127.0.0.1:1/v1',token:'t',model:'m',profile:{},systemPrompt:'',history:[],userText:'q',signal:new AbortController().signal,stallTimeoutMs:0,onDelta:()=>{}});}catch(e){return e;}
  assert.fail('the SDK turn should have failed');
 };
 for(const [status,body,cause] of [[403,'{"error":{"code":"cohort_paused"}}','paused'],[403,'{"error":{"code":"session_window"}}','ended'],[429,'{"error":{"code":"budget_exhausted"}}','exhausted'],[403,'{"error":{"type":"session_inactive"}}','not_started']]){
  const err=await refusal(status,body);
  assert.equal(err.status,status); assert.equal(err.evidence?.code??err.evidence?.type,body.match(/"(?:code|type)":"(\w+)"/)[1],'evidence is attached to the refusal');
  const m=await fail(f,err,{activity_kind:'classroom'});
  assert.deepEqual(m.activityUnavailable,{cause,audience:'classroom'},body);
 }
 // A refusal with no complete JSON body carries a status but no invented code.
 const bare=await refusal(403,'denied');
 assert.deepEqual({...bare.evidence},{status:403,code:undefined,type:undefined});
});

test('reload restores the last status for the same activity and task only, and never during a stream',async t=>{
 const f=await harness(t);
 await fail(f,transport(f,503),{activity_kind:'personal'});
 const ready=async()=>{f.posts.length=0;await f.handle({type:'ready',activityId:f.connections.active.id,taskId:f.store.getView().activeTaskId});return f.posts.filter(m=>m.type==='streamError');};
 let again=await ready(); assert.equal(again.length,1); assert.equal(again[0].streamId,'activity'); assert.deepEqual(again[0].activityUnavailable,{cause:'outage',audience:'solo'});
 // A new stream starting clears it.
 await f.h.post({type:'streamStart',streamId:'s1'}); assert.equal((await ready()).length,0);
 // Another activity's status is not shown here.
 await fail(f,transport(f,503),{activity_kind:'personal'}); f.connections.active={...f.activity,id:'other-activity'};
 assert.equal((await ready()).length,0,'a different activity does not inherit the status'); f.connections.active=f.activity;
 // A live stream keeps the restore quiet.
 f.h.activeStreams.set('live',{});
 assert.equal((await ready()).length,0); f.h.activeStreams.clear();
 assert.equal((await ready()).length,1,'positive control: restored again once the stream is gone');
 // The recover press forgets it.
 await f.handle(f.scoped({type:'refreshAccess'})); assert.equal((await ready()).length,0);
});

test('stale picker: a switch while a dialog is open stops the open and the export at the right step',async t=>{
 const f=await harness(t);
 const uri=p=>({scheme:'file',fsPath:p,toString:()=>`file:${p}`});
 const source=uri(path.join(f.activity.workspace,'mine.txt')),dest=uri(path.join(f.activity.workspace,'export.txt'));fs.writeFileSync(source.fsPath,'my saved work');
 let copies=0,saves=0;f.vscode.workspace.fs.copy=async()=>{copies++;};
 f.vscode.window.showSaveDialog=async()=>{saves++;return dest;};
 const waiting=()=>{let release;const p=new Promise(r=>{release=r;});return {p,release};};
 // 1) switch while the source picker is open: neither the save dialog nor the copy runs.
 let w=waiting(); f.vscode.window.showOpenDialog=()=>w.p;
 let pending=f.handle(f.scoped({type:'activityLocalFile',action:'export'}));
 f.connections.active={...f.activity,id:'switched-1'}; w.release([source]); await pending;
 assert.equal(saves,0,'no save dialog for a stale source pick'); assert.equal(copies,0);
 // 2) switch while the save dialog is open: nothing is copied.
 f.connections.active=f.activity; f.vscode.window.showOpenDialog=async()=>[source];
 w=waiting(); f.vscode.window.showSaveDialog=()=>{saves++;return w.p;};
 pending=f.handle(f.scoped({type:'activityLocalFile',action:'export'})); await new Promise(r=>setTimeout(r,20));
 f.connections.active={...f.activity,id:'switched-2'}; w.release(dest); await pending;
 assert.equal(copies,0,'no copy for a stale destination');
 // 3) a task switch is a switch too: open does not run.
 f.connections.active=f.activity; const before=f.browserState.commands.length;
 w=waiting(); f.vscode.window.showOpenDialog=()=>w.p;
 pending=f.handle(f.scoped({type:'activityLocalFile',action:'open'}));
 f.connections.active={...f.activity,id:'switched-3'}; w.release([source]); await pending;
 assert.equal(f.browserState.commands.length,before,'no open for a stale pick');
 // Positive control: nothing switched, the same open runs.
 f.connections.active=f.activity; f.vscode.window.showOpenDialog=async()=>[source];
 await f.handle(f.scoped({type:'activityLocalFile',action:'open'})); assert.equal(f.browserState.commands.at(-1),'vscode.open');
});
