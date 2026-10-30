import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {nativeBridgeFixture} from './lib/companion-native-bridge-harness.mjs';
import {CompanionTransportBudget} from '../src/companionTransportBudget.ts';

const require=createRequire(import.meta.url);
class Disposable{constructor(fn){this.fn=fn;}dispose(){this.fn?.();this.fn=undefined;}}
class EventEmitter{listeners=new Set();event=fn=>{this.listeners.add(fn);return new Disposable(()=>this.listeners.delete(fn));};fire(){for(const fn of this.listeners)fn();}dispose(){this.listeners.clear();}}
const compiled=await build({entryPoints:[fileURLToPath(new URL('../src/companionDevHostEntry.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,
 plugins:[{name:'scheduler-clock-only',setup(api){api.onResolve({filter:/companionTransportBudget$/},()=>({path:'clocked-budget',namespace:'clock'}));api.onLoad({filter:/.*/,namespace:'clock'},()=>({contents:'export const CompanionTransportBudget=globalThis.__ClockedBudget;',loader:'js'}));}}]});

test('activated native entry paces actual HTTP and retains the same session budget across owner replacement',async()=>{
 let now=0,sessionId='host-session',row,handler,control,registration;
 const admissions=[],budgets=[];
 class ClockedBudget extends CompanionTransportBudget{
  constructor(options){super({...options,now:()=>now,sleep:async(ms,signal)=>{if(signal.aborted)throw Error('cancelled');now+=ms;}});this.wasDisposed=false;budgets.push(this);}
  dispose(){this.wasDisposed=true;super.dispose();}
 }
 const native=await nativeBridgeFixture({fetch:async input=>{
  admissions.push({time:now,path:new URL(input).pathname,sessionId});
  const value=String(input).endsWith('/me')?{account:{id:'account'},session_id:sessionId}:{invitation:row,execution_authorized:false,scope_authority:'authenticated_declaration'};
  return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 }});
 try{
  native.context.globalStorageUri={fsPath:native.state};native.accounts.view=()=>({status:'signedIn',account:{id:'account'}});
  const vscode={...native.vscode,Disposable,EventEmitter,commands:{registerCommand:(_id,fn)=>{handler=fn;return new Disposable(()=>{});}},ProgressLocation:{Notification:15}};
  vscode.window.showQuickPick=async items=>items.find(item=>item.action==='prepare');
  vscode.window.withProgress=async(_options,work)=>work({}, {onCancellationRequested:()=>new Disposable(()=>{})});
  vscode.window.showInformationMessage=async()=>{};vscode.window.showErrorMessage=async()=>assert.fail('normal explicit invitation must succeed');
  const module={exports:{}};
  vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,__ClockedBudget:ClockedBudget,require:id=>id==='vscode'?vscode:require(id),process,Buffer,console,URL,Response,AbortController,AbortSignal,TextDecoder,TextEncoder,performance,crypto,btoa,atob,fetch:native.fetcher,setTimeout,clearTimeout,structuredClone});
  control=module.exports.createCompanionDevHostEntry(native.context,{accounts:native.accounts,connections:native.connections,configured:()=>({service:'http://127.0.0.1:44321/v1',site:'http://127.0.0.1:44321'}),taskView:()=>native.store.getView(),epoch:()=>1});
  registration=control.api.registerClients({pairing({transport}){return{invitation:null,async start(scope){
   row={...native.pair,...scope,id:'ci_'+'a'.repeat(32),host_session_id:sessionId,status:'open'};this.invitation=row;
   await transport('host',null,null,{});await transport('host',row.id,'status',{});
   return{schema:row.schema,id:row.id,invite_secret:'fixture-only',host_key:'fixture-public',invitation_digest:row.invitation_digest,host_invite_proof:'fixture-proof',challenge_expires_at:Math.floor(Date.now()/1000)+60};
  },async refresh(){return this.invitation;},async approve(){},async revoke(){}};},relay(){assert.fail('no implicit cipher operation');}});
  assert.equal(admissions.length,0,'registration must not admit HTTP');
  await handler();assert.deepEqual(admissions.map(x=>x.time),[0,1200,2400]);assert.equal(budgets.length,1);
  control.invalidate();assert.equal(budgets[0].wasDisposed,false,'closing one owner must preserve its caller session budget');
  await handler();assert.equal(budgets.length,1,'replacement owner of same authenticated session shares budget');
  assert.deepEqual(admissions.map(x=>x.time),[0,1200,2400,3600,4800,6000],'new owner must not reset the previous admission or burst');
  control.invalidate();sessionId='replacement-session';native.connections.current={...native.connections.current,accountPass:{...native.connections.current.accountPass,sessionId}};
  const secret=JSON.parse(native.secrets.get('hypeproofChat.personalAccount.v1'));secret.sessionId=sessionId;native.secrets.set('hypeproofChat.personalAccount.v1',JSON.stringify(secret));
  await handler();assert.equal(budgets.length,2);assert.equal(budgets[0].wasDisposed,true,'different session replaces the old session budget');
  assert.deepEqual(admissions.slice(6).map(x=>x.time),[6000,7200,8400]);
  assert.equal(admissions.filter(x=>x.path==='/v1/me').length,3,'one identity HTTP per explicitly created owner, without retry');
 }finally{registration?.dispose();control?.dispose();await native.cleanup();}
});
