import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export * from './src/startPage.ts';export * from './src/accountSession.ts';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const secrets=new Map(),journal=new Map(),calls=[],states=[];
const service='http://127.0.0.1:8793/v1',site='http://localhost:3193';let currentSession='session-a',currentAccount='account-a',postFail=true,availability='ready';
const now=Date.now()/1000;
const card={id:'card-1',request_digest:'d'.repeat(64),source:{repo:'hypeproof/hypeproof-studio',pr:3788,head:'a'.repeat(40),base:'b'.repeat(40),policy_digest:'b'.repeat(64),evidence_digest:'c'.repeat(64),context_digest:'e'.repeat(64)},reviewer:'reviewer',brief:{authored:['Change'],verified:['Proof']},state:'pending',created_at:now-60,expires_at:now+2000,lease_expires_at:now+50,can_decide:true,unavailable_reason:null,decision:null,review:null};
const ctx={globalStorageUri:{fsPath:'/tmp/synthetic-approval-unused'},globalState:{keys:()=>[...journal.keys()],get:k=>journal.get(k),update:async(k,v)=>v===undefined?journal.delete(k):journal.set(k,v)},workspaceState:{keys:()=>[],get:()=>undefined},secrets:{get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)},extension:{packageJSON:{version:'test'}},subscriptions:[]};
const vscode={workspace:{workspaceFolders:[],getConfiguration:()=>({get:(k,d)=>k==='proxyUrl'?service:k==='siteBase'?site:d})},window:{},Uri:{parse:u=>u},env:{}};
const fetch=async(url,init={})=>{const path=new URL(url).pathname;calls.push({path,body:init.body,auth:new Headers(init.headers).get('authorization')});assert.equal(init.redirect,'error');
 let response;
 if(path==='/v1/me')response={account:{id:currentAccount,status:'active',email:'safe@example.test',display_name:'Member'},session_id:currentSession};
 else if(path.endsWith('/decisions')){const body=JSON.parse(init.body);assert.ok([...journal.values()].some(p=>p.id===body.id&&p.sessionID===currentSession));assert.deepEqual(Object.keys(body).sort(),['choice','id','request_digest']);if(postFail)throw Error('synthetic lost response');response={...card,state:'submitting',can_decide:false,decision:{...body,status:'awaiting_processing',created_at:now}}}
 else if(path==='/v1/me/passes')response={passes:[]};
 else if(path==='/v1/me/approval-inbox')response={schema:'hps-member-approval-inbox/1',availability,cards:availability==='ready'?[card]:[]};
 else if(path==='/v1/me/approval-inbox/card-1')response=card;
 else throw Error('Unexpected '+path);
 return new Response(JSON.stringify(response),{status:200});};
const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),fetch,console,Buffer,process,URL,AbortSignal,TextEncoder,structuredClone,Date,JSON,setTimeout,clearTimeout});
const {StartPage,AccountSession,ACCOUNT_SECRET_KEY}=module.exports;
function credentials(){secrets.set(ACCOUNT_SECRET_KEY,JSON.stringify({service,accessToken:'synthetic-bearer',refreshToken:'synthetic-refresh',sessionId:currentSession,expiresAt:Date.now()+3600000}))}
credentials();
const account=new AccountSession({service,site,secrets:ctx.secrets,label:'test',fetch,openBrowser:async()=>true});
const page=new StartPage(ctx,{onAvailableUpdateChanged:()=>{},ensureProfile:async()=>null,profileFailure:()=>undefined},async()=>false,undefined,account);
// Read the production controller's public host projection without exercising unrelated entry/profile reads.
page.refresh=async()=>states.push(page.memberApprovals.view());page.panel={};
await page.handle({type:'memberApprovalRefresh'});assert.equal(page.memberApprovals.view().status,'ready');
await page.handle({type:'memberApprovalDecision',id:'card-1',requestDigest:card.request_digest,choice:'approve'});
assert.equal(calls.filter(c=>c.path.endsWith('/decisions')).length,1);assert.equal(journal.size,1);
await page.handle({type:'memberApprovalRefresh'});assert.ok(calls.some(c=>c.path.endsWith('/card-1')));
await page.handle({type:'memberApprovalDecision',id:'card-1',requestDigest:card.request_digest,choice:'reject'});assert.equal(calls.filter(c=>c.path.endsWith('/decisions')).length,1);
const projection=JSON.stringify(states);for(const secret of ['synthetic-bearer','synthetic-refresh','session-a','account-a'])assert.equal(projection.includes(secret),false);
currentSession='session-b';currentAccount='account-b';credentials();page.accountChanged();assert.equal(page.memberApprovals.view().cards.length,0);
await assert.rejects(()=>account.approvalRequest({accountID:'account-a',sessionID:'session-a'},'card-1',{id:'x',request_digest:card.request_digest,choice:'approve'}));assert.equal(calls.filter(c=>c.path.endsWith('/decisions')).length,1);
// A pre-logout start-page render delayed in settings must project only the new empty inbox.
currentSession='session-a';currentAccount='account-a';credentials();await page.memberApprovals.refresh();
let releaseSettings,enteredSettings;const entered=new Promise(r=>enteredSettings=r),held=new Promise(r=>releaseSettings=r);
page.settingsView=async()=>{enteredSettings();await held;return {}};page.maybeRefill=()=>{};
const renders=[];page.panel={webview:{postMessage:async message=>renders.push(message)}};
const delayed=StartPage.prototype.refresh.call(page,null);await entered;
page.memberApprovals.invalidate();releaseSettings();await delayed;
assert.equal(renders.at(-1).state.memberApprovals.cards.length,0);
// Real account adoption probes once; repeated account view updates do not poll the inbox.
page.panel=undefined;
await account.refreshView();
const listCount=()=>calls.filter(c=>c.path==='/v1/me/approval-inbox').length;
const settle=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setImmediate(r))}assert.fail('adoption probe did not settle')};
const beforeProbe=listCount();page.accountChanged();await settle(()=>page.memberApprovals.view().entryVisible&&!page.memberApprovals.view().busy);
assert.equal(listCount(),beforeProbe+1);
page.accountChanged();page.accountChanged();await new Promise(r=>setImmediate(r));assert.equal(listCount(),beforeProbe+1);
currentSession='session-new';credentials();await account.refreshView();page.accountChanged();await settle(()=>listCount()===beforeProbe+2&&!page.memberApprovals.view().busy);
currentAccount='ordinary-account';currentSession='ordinary-session';availability='not_enrolled';credentials();await account.refreshView();page.accountChanged();assert.equal(page.memberApprovals.view().entryVisible,false);
await settle(()=>page.memberApprovals.view().status==='not_enrolled'&&!page.memberApprovals.view().busy);
assert.equal(listCount(),beforeProbe+3);assert.equal(calls.filter(c=>c.path.endsWith('/decisions')).length,1);
account.dispose();console.log('PASS existing StartPage → AccountSession → synthetic Service, durable journal, private projection, uncertain reconciliation and account fence');
