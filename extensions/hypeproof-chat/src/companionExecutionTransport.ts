/** Native DEV-only execution-lease HTTP boundary. No signing, storage, retries, SDK dispatch or browser port. */
import {ExtensionMode} from 'vscode';
import {Buffer} from 'node:buffer';
import {accountPreviewEnabled} from './accountSession.ts';
import {createCompanionAuthenticatedTransport,type CompanionAuthenticatedTransportPorts} from './companionAuthenticatedTransport.ts';

export interface CompanionExecutionModelIdentity {model_session_id:string;model_token_jti:string;model_profile_id:string}
export interface CompanionExecutionTransportRequest {action:'issue'|'get'|'reserve'|'complete'|'revoke';pairingId:string;grantId:string;turnId:string|null;body:string|null}
export interface CompanionExecutionTransportPorts extends Omit<CompanionAuthenticatedTransportPorts,'role'|'dispatch'> {
 /** Raw fetch only. This boundary admits each actual HTTP operation through the shared owner exactly once. */
 fetch:typeof fetch;
 budget:{run<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>};
 /** Native-only activated model bearer; never taken from a phone packet or webview. */
 currentModel():{token:string}|undefined|Promise<{token:string}|undefined>;
}
export interface CompanionExecutionTransport {
 resolveIdentity(signal?:AbortSignal):Promise<Readonly<{accountId:string;sessionId:string}>>;
 resolveModel(signal?:AbortSignal):Promise<Readonly<CompanionExecutionModelIdentity>>;
 native(request:Readonly<CompanionExecutionTransportRequest>,signal?:AbortSignal):Promise<Record<string,unknown>>;
 model(request:Readonly<CompanionExecutionTransportRequest>,signal?:AbortSignal):Promise<Record<string,unknown>>;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(v);
class Failure extends Error {}
function fail(code:string):never{throw new Failure('companion_execution_transport_'+code);}
const REQUEST_BYTES=8192,RESPONSE_BYTES=64*1024;

export function createCompanionExecutionTransport(ports:CompanionExecutionTransportPorts):CompanionExecutionTransport {
 const expected=Object.freeze({...ports.identity}),timeout=ports.timeoutMs??12000;
 if(!Number.isSafeInteger(timeout)||timeout<1||timeout>12000)fail('invalid_bounds');
 let resolved=false,dead=false,configBinding:{service:string;site:string}|undefined;
 let modelBinding:{token:string;identity:Readonly<CompanionExecutionModelIdentity>}|undefined;
 const invalidate=():never=>{dead=true;return fail('binding_changed');};
 const config=()=>{
  if(dead)fail('binding_changed');const c=ports.configured();
  if(ports.context.extensionMode!==ExtensionMode.Development||!c||!ports.accounts.matches(c.service,c.site)||!accountPreviewEnabled(true,c.service,c.site)
   ||!/^\/v1\/?$/.test(new URL(c.service).pathname)||new URL(c.site).pathname!=='/'||!expected.accountId||!expected.sessionId)return invalidate();
  if(configBinding&&(configBinding.service!==c.service||configBinding.site!==c.site))return invalidate();
  return {service:c.service,site:c.site};
 };
 async function nativeScope(){const c=config(),token=await ports.accounts.accessToken(),identity=await ports.accounts.sessionIdentity();config();
  if(!token||!identity||identity.sessionId!==expected.sessionId||identity.service!==c.service)return invalidate();return {config:c,token};}
 async function checkNative(scope:Awaited<ReturnType<typeof nativeScope>>){const live=await nativeScope();if(live.token!==scope.token||live.config.service!==scope.config.service||live.config.site!==scope.config.site)return invalidate();}
 // Reuse the existing authenticated /me resolver and gates; no parallel identity authority.
 const base=createCompanionAuthenticatedTransport({...ports,role:'host',dispatch:(url,init)=>ports.budget.run(async()=>{
  if(init?.signal?.aborted)fail('cancelled');const scope=await nativeScope();
  if(new Headers(init?.headers).get('authorization')!=='Bearer '+scope.token)return invalidate();
  if(init?.signal?.aborted)fail('cancelled');return ports.fetch(url,init);
 },init?.signal??undefined)});
 const modelToken=async()=>{const value=await ports.currentModel();return value?.token;};
 function claims(token:string):Record<string,unknown>{
  try{if(token.length>16384)fail('model_identity_required');const parts=token.split('.');if(parts.length!==3||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))fail('model_identity_required');
   const value:unknown=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
   if(!object(value)||value.native_trial!==true||value.personal_account!==expected.accountId||value.account_session!==expected.sessionId||!id(value.jti)||!id(value.p)||!Number.isSafeInteger(value.exp)||Number(value.exp)<=Date.now()/1000)fail('model_identity_required');return value;
  }catch{return fail('model_identity_required');}
 }
 async function operation<T>(signal:AbortSignal|undefined,work:(scope:{request(path:string,raw:string|null,bearerToken:string):Promise<Record<string,unknown>>;model:string|undefined;native:string})=>Promise<T>):Promise<T>{
  const controller=new AbortController(),abort=()=>controller.abort(new Failure('companion_execution_transport_cancelled'));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Failure('companion_execution_transport_timeout')),timeout);
  let stopped!:()=>void;const stop=new Promise<never>((_,reject)=>{stopped=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',stopped,{once:true});});
  const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
  const wait=async<V>(p:PromiseLike<V>):Promise<V>=>{check();return Promise.race([Promise.resolve(p),stop]);};
  try{
   check();if(!resolved)fail('identity_required');const scope=await wait(nativeScope()),capturedModel=await wait(modelToken());check();
   const fresh=async()=>{check();await wait(checkNative(scope));if(await wait(modelToken())!==capturedModel)fail('model_changed');check();};
   const request=async(path:string,raw:string|null,bearerToken:string)=>{
    const requestFresh=async()=>{await fresh();if(bearerToken===capturedModel)claims(bearerToken);};await requestFresh();const dispatched=ports.budget.run(async()=>{await requestFresh();check();return ports.fetch(scope.config.service.replace(/\/+$/,'')+path,{method:raw===null?'GET':'POST',headers:{accept:'application/json',authorization:'Bearer '+bearerToken,...(raw===null?{}:{'content-type':'application/json'})},...(raw===null?{}:{body:raw}),redirect:'error',credentials:'omit',signal:controller.signal});},controller.signal);
    void dispatched.then(r=>{if(controller.signal.aborted)void r.body?.cancel().catch(()=>{});},()=>{});
    const response=await wait(dispatched);
    const rejectBody=(code:string):never=>{void response.body?.cancel().catch(()=>{});return fail(code);};
    if(response.redirected||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))return rejectBody('invalid_response');
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>RESPONSE_BYTES))return rejectBody('response_too_large');
    const reader=response.body?.getReader();if(!reader)fail('invalid_response');let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    try{for(;;){const chunk=await wait(reader.read());if(chunk.done)break;size+=chunk.value.byteLength;if(size>RESPONSE_BYTES)fail('response_too_large');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    let value:unknown;try{value=JSON.parse(text);}catch{return fail('invalid_response');}await requestFresh();
    if(!object(value))fail('invalid_response');if(!response.ok||value.error!==undefined)fail('denied');return value;
   };
   return await work({request,model:capturedModel,native:scope.token});
  }catch(error){if(error instanceof Failure)throw error;return fail('unavailable');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stopped);}
 }
 function descriptor(value:Readonly<CompanionExecutionTransportRequest>,model:boolean){
  if(!object(value)||!exact(value,['action','pairingId','grantId','turnId','body'])||!/^ci_[a-f0-9]{32}$/.test(value.pairingId)||!/^ceg_[a-f0-9]{32}$/.test(value.grantId)
   ||!(model?value.action==='reserve':['issue','get','complete','revoke'].includes(value.action)))fail('invalid_request');
  if(['reserve','complete'].includes(value.action)?!id(value.turnId):value.turnId!==null)fail('invalid_request');
  let fields:Record<string,unknown>|undefined;
  if(value.action==='get'){if(value.body!==null)fail('invalid_request');}
  else{if(typeof value.body!=='string'||Buffer.byteLength(value.body,'utf8')>REQUEST_BYTES)fail('invalid_request');let parsed:unknown;try{parsed=JSON.parse(value.body);}catch{return fail('invalid_request');}if(!object(parsed))fail('invalid_request');fields=parsed;}
  const allowed={issue:['grant_id','capability','task_id','artifact_id','epoch','consent_revision','selection_hash','max_turns','max_calls_per_turn','expires_at','host_proof'],reserve:['turn_id','request_id','request_hash','selection_hash','task_id','epoch','consent_revision','host_proof'],complete:['request_id','request_hash','selection_hash','task_id','epoch','consent_revision','state','result_hash','host_proof'],revoke:['host_proof']};
  if(fields&&(!exact(fields,allowed[value.action as keyof typeof allowed])||(value.action==='issue'&&fields.grant_id!==value.grantId)||(value.action==='reserve'&&fields.turn_id!==value.turnId)))fail('invalid_request');
  const root='/companion/invitations/'+value.pairingId+'/execution-grants';return value.action==='issue'?root:root+'/'+value.grantId+(value.action==='reserve'?'/turns':value.action==='complete'?'/turns/'+value.turnId+'/complete':value.action==='revoke'?'/revoke':'');
 }
 async function protocol(input:Readonly<CompanionExecutionTransportRequest>,model:boolean,signal?:AbortSignal){
  // Freeze descriptor bytes before any account/model/budget await.
  let request:CompanionExecutionTransportRequest,path:string;try{request={...input};path=descriptor(request,model);}catch{return fail('invalid_request');}
  return operation(signal,async scope=>{
   let token:string;if(model){if(!modelBinding||scope.model!==modelBinding.token)fail('model_identity_required');claims(modelBinding.token);token=modelBinding.token;}else token=scope.native;
   const value=await scope.request(path,request.body,token);
   if(value.schema!=='hps-companion-selected-html-execution/1'||value.capability!=='authoring.selected-html'||value.scope_authority!=='authenticated_host_lease'||value.dispatch_requires_live_validation!==true
    ||!object(value.grant)||value.grant.id!==request.grantId||value.grant.pairing_id!==request.pairingId||value.grant.account_id!==expected.accountId||value.grant.host_session_id!==expected.sessionId)fail('invalid_response');
   const turn=value.turn;if(model&&(!object(turn)||turn.turn_id!==request.turnId||!modelBinding||Object.entries(modelBinding.identity).some(([k,v])=>turn[k]!==v)))fail('invalid_response');
   return value;
  });
 }
 return {
  async resolveIdentity(signal){const identity=await base.resolveIdentity(signal);configBinding=config();resolved=true;return identity;},
  resolveModel(signal){return operation(signal,async scope=>{if(modelBinding)fail('already_resolved');if(!scope.model)fail('model_identity_required');const payload=claims(scope.model),v=await scope.request('/companion/execution-context',null,scope.model);
   if(!exact(v,['schema','account_id','host_session_id','model_session_id','model_token_jti','model_profile_id'])||v.schema!=='hps-companion-execution-context/1'||v.account_id!==expected.accountId||v.host_session_id!==expected.sessionId||!id(v.model_session_id)||v.model_token_jti!==payload.jti||v.model_profile_id!==payload.p)fail('invalid_response');
   const identity=Object.freeze({model_session_id:v.model_session_id,model_token_jti:String(v.model_token_jti),model_profile_id:String(v.model_profile_id)});modelBinding={token:scope.model,identity};return identity;
  });},
  native:(request,signal)=>protocol(request,false,signal),model:(request,signal)=>protocol(request,true,signal),
 };
}
