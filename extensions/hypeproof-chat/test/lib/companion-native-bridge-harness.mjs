// Source integration harness: native APIs are fixture-owned; production account/profile/preparation/dispatcher code runs.
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { AccountSession, ACCOUNT_SECRET_KEY } from '../../src/accountSession.ts';
import { TaskWorkspaceStore } from '../../src/taskWorkspaceStore.ts';
import { companionHostId, companionKey, companionScope } from '../../src/companionWorkspace.ts';
const require=createRequire(import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
let bundle;
export async function nativeBridgeFixture(options={}) {
 bundle??=await build({entryPoints:[fileURLToPath(new URL('../../src/companionHostBridgeNative.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
 const temporary=await mkdtemp(join(tmpdir(),'hps-companion-native-')),base=await realpath(temporary),root=join(base,'work'),state=join(base,'state');await mkdir(root);await mkdir(state);
 const file=join(root,'index.html'),text='<html><button id="quiz">합성 퀴즈</button></html>';await writeFile(file,text);
 const global=new Map(),secrets=new Map(),dialogs=[],calls=[],service=options.service??'http://127.0.0.1:44321/v1';
 const sessionId=options.sessionId??'host-session',accountId=options.accountId??'account',activityId=options.activityId??'a'.repeat(64),passId=options.passId??'pass';
 const active={id:'local-activity',name:'Synthetic activity',serverId:activityId,workspace:root,ref:'binding',accountPass:{sessionId,passId}};
 const connections={current:active,matchesService:true,forWorkspace:async p=>p===root?connections.current:undefined};
 const scope={activityId:active.id,workspace:root,hostId:companionHostId('test-owned-machine')};
 const preparation={version:1,scope:companionScope(scope),workspace:root,projectId:hash(companionScope(scope)),activityId:active.id,hostId:scope.hostId,preparedAt:1};global.set(companionKey(scope),preparation);
 let profile={profile_id:'synthetic-profile',activity_id:activityId,activity_kind:'trial',sdk_tools:{read:true},minor_cohort:false,game:{template_tier:'website'},pass:{request_limit:10,requests_used:0,expires_at:Math.floor(Date.now()/1000)+3600},workspace_root:root};
 let pair={schema:'hps-companion-pairing-preview/2',id:'ci_fixture',status:'paired',account_id:accountId,host_session_id:sessionId,device_session_id:'device-session',host_id:scope.hostId,device_id:'phone',workspace_id:hash('hps-companion-workspace/1:'+preparation.scope),project_id:preparation.projectId,invitation_digest:'a'.repeat(64),claim_digest:'b'.repeat(64),grant_expires_at:Math.floor(Date.now()/1000)+900,capability:'preview.read',execution_authorized:false};
 const store=new TaskWorkspaceStore(state,preparation.scope);await store.initialize([]);
 let epoch=1,approved=true,onConfirm=async()=>{},onFetch=async()=>{},onPaired=async()=>{};
 const fetcher=async(input,init={})=>{
  const url=String(input);calls.push({path:new URL(url).pathname,authorization:init.headers?.authorization});
  await onFetch(url,init);
  if(options.fetch)return options.fetch(input,init);
  let body;if(url.endsWith('/me'))body={account:{id:accountId},session_id:sessionId};else if(url.endsWith('/activate'))body={access_token:'fixture-pass-token',expires_in:3600};else if(url.endsWith('/profile'))body=profile;else if(url.endsWith('/activity'))body={activity_id:activityId};else throw Error('unexpected fixture path');
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
 };
 secrets.set(ACCOUNT_SECRET_KEY,JSON.stringify({service,sessionId,accessToken:'fixture-product-token',refreshToken:'fixture-refresh-token',expiresAt:Date.now()+3600_000}));
 const secretStore={get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)};
 const accounts=new AccountSession({service,site:'http://127.0.0.1:44321',secrets:secretStore,label:'test-owned synthetic host',openBrowser:async()=>{},fetch:fetcher});
 const document={uri:{scheme:'file',fsPath:file},isDirty:false,isUntitled:false,version:1,getText:()=>text};
 const vscode={ExtensionMode:{Development:2,Production:1},env:{machineId:'test-owned-machine',remoteName:undefined},workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:root}}],getConfiguration:()=>({get:()=>service})},window:{activeTextEditor:{document},showInformationMessage:async(message,opts,action)=>{dialogs.push({message,opts,action});await onConfirm();return approved?action:undefined;}}};
 const context={extensionMode:2,subscriptions:[],globalState:{get:k=>global.get(k),update:async(k,v)=>global.set(k,v)}};
 let journal=null;
 const diskJournal={async load(){return journal?structuredClone(journal):null;},async save(s){await writeFile(join(state,'journal.json'),JSON.stringify(s));journal=structuredClone(s);}};
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?vscode:require(id),process,Buffer,console,fetch:fetcher,URL,Response,AbortSignal,AbortController,TextEncoder,TextDecoder,performance,structuredClone,setTimeout,clearTimeout});
 const bridge=module.exports.createDevCompanionHostBridge({context,connections,accounts,paired:async()=>{await onPaired();return options.paired?options.paired():pair;},taskView:()=>store.getView(),epoch:()=>epoch,journal:diskJournal});await bridge.recover();
 const message=async(requestId='native-request')=>{const request=await bridge.describe(requestId);if(!request)return null;return {sender:'device',invitationId:pair.id,invitationDigest:pair.invitation_digest,claimDigest:pair.claim_digest,messageId:requestId,text:JSON.stringify(request)};};
 return {root,state,file,text,bridge,accounts,store,connections,context,vscode,document,global,secrets,dialogs,calls,preparation,scope,fetcher,message,get pair(){return pair;},set pair(v){pair=v;},get profile(){return profile;},set profile(v){profile=v;},set approved(v){approved=v;},set onConfirm(v){onConfirm=v;},set onFetch(v){onFetch=v;},set onPaired(v){onPaired=v;},set epoch(v){epoch=v;},journal:diskJournal,cleanup:async()=>{accounts.dispose();await rm(temporary,{recursive:true,force:true});}};
}
