#!/usr/bin/env node
// Background acceptance only. A single activity owns one non-resettable 12-dispatch budget.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {messageMetadata} from './trace.mjs';
export const REQUEST_LIMIT=12,OUTPUT_CAP=4096;
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function prepareRequest(body,endpoint){
 if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.model))throw Error('invalid_request');
 const prepared={...body};
 if(endpoint==='/v1/messages'){
  if(!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1)throw Error('invalid_max_tokens');
  prepared.max_tokens=Math.min(body.max_tokens,OUTPUT_CAP);
  if(body.thinking!==undefined){const t=body.thinking;if(!t||typeof t!=='object'||Array.isArray(t)||!['enabled','disabled','adaptive'].includes(t.type))throw Error('invalid_thinking');if(t.type==='enabled'){if(!Number.isSafeInteger(t.budget_tokens)||t.budget_tokens<1||t.budget_tokens>=prepared.max_tokens)throw Error('thinking_exceeds_cap');}else if(t.budget_tokens!==undefined)throw Error('invalid_thinking');}
 }
 return prepared;
}
/** Restrictive completion gate, before reservation. Never interpret error text as authority. */
export function completionRequestProblem(body){
 if(!Array.isArray(body.messages)||!body.messages.length)return 'malformed_tool_history';
 const blocks=(content,depth=0)=>{
  if(typeof content==='string')return null;
  if(!Array.isArray(content)||depth>8)return 'malformed_tool_history';
  for(const b of content){
   if(!b||typeof b!=='object'||!['text','image','tool_use','tool_result','thinking','redacted_thinking'].includes(b.type))return 'malformed_tool_history';
   if(b.type==='tool_result'){
    if(b.is_error===true)return 'tool_result_error';
    if(b.is_error!==undefined&&b.is_error!==false||typeof b.tool_use_id!=='string'||!b.tool_use_id)return 'malformed_tool_history';
    const problem=blocks(b.content,depth+1);if(problem)return problem;
   }
  }
  return null;
 };
 for(const m of body.messages){if(!m||!['user','assistant'].includes(m.role))return 'malformed_tool_history';const problem=blocks(m.content);if(problem)return problem;}
 return null;
}
function instructionHashes(body){const hashes=[];for(const m of Array.isArray(body.messages)?body.messages:[])if(m.role==='user')for(const text of typeof m.content==='string'?[m.content]:Array.isArray(m.content)?m.content.filter(b=>b?.type==='text').map(b=>b.text):[]){if(typeof text==='string')for(const match of text.matchAll(/<external-instruction-skills>[\s\S]*?<\/external-instruction-skills>/g))if(hashes.length<4)hashes.push(digest(match[0]));}return hashes;}
function imageHashes(body){const hashes=[];for(const message of Array.isArray(body.messages)?body.messages:[])for(const block of Array.isArray(message.content)?message.content:[]){if(block?.type==='image'&&block.source?.type==='base64'&&typeof block.source.data==='string'&&hashes.length<16)hashes.push(digest(Buffer.from(block.source.data,'base64')));}return hashes;}
export function screenshotCallHashes(body){const ids=[];for(const m of Array.isArray(body.messages)?body.messages:[])for(const b of Array.isArray(m.content)?m.content:[])if(b?.type==='tool_use'&&b.name==='mcp__hypeproof__browser_screenshot'&&typeof b.id==='string'&&ids.length<32)ids.push(digest(b.id));return ids;}
export function toolResultImageHashes(body){const hashes=[];for(const m of Array.isArray(body.messages)?body.messages:[])for(const b of Array.isArray(m.content)?m.content:[])if(b?.type==='tool_result')for(const image of Array.isArray(b.content)?b.content:[])if(image?.type==='image'&&image.source?.type==='base64'&&typeof image.source.data==='string'&&hashes.length<16)hashes.push(digest(Buffer.from(image.source.data,'base64')));return hashes;}
export const completedGenerationRows=(rows,since)=>rows.filter(row=>row.attempt>since&&row.endpoint==='/v1/messages'&&row.phase==='complete'&&row.status>=200&&row.status<300);
export function fileOnlyProfile(profile){return {...profile,sdk_tools:{read:profile.sdk_tools?.read===true,write:profile.sdk_tools?.write===true,shell:false,browser:false,subagents:false},tools:{web_search:false},browser_control:{enabled:false},curriculum_runtime:{enabled:false},publishing:{...profile.publishing,enabled:false},orchestrator:undefined};}
export function privateSecret(file){if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Absolute private credential file required');const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));try{const stat=fs.fstatSync(fd);if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw Error('Private credential file permissions required');return fs.readFileSync(fd,'utf8').trim();}finally{fs.closeSync(fd);}}
const matches=(actual,expected)=>typeof actual==='string'&&timingSafeEqual(Buffer.from(digest(actual)),Buffer.from(digest(expected)));
export async function startGuard({activityId,ledgerFile,keyFile,serviceCredentialFile,controlKeyFile,port=0,renderRepetitionId,renderCompletion=false,fetchImpl=globalThis.fetch,timeoutMs=180000}){
 if(typeof activityId!=='string'||!activityId||activityId.length>256||!path.isAbsolute(ledgerFile)||!Number.isInteger(port)||port<0||port>65535)throw Error('Explicit fixed activity and absolute new ledger required');
 if(renderRepetitionId!==undefined&&!/^hps-render-[0-9]{8}-r[1-3]-[a-f0-9]{32}$/.test(renderRepetitionId))throw Error('Invalid immutable render repetition ID');
 if(typeof renderCompletion!=='boolean'||renderCompletion&&!renderRepetitionId)throw Error('Completion requires an explicit render guard');
 const upstreamKey=privateSecret(keyFile),serviceKey=privateSecret(serviceCredentialFile),controlKey=privateSecret(controlKeyFile);
 if(!/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(upstreamKey)||!/^hps-guard-only-[a-f0-9]{64}$/.test(serviceKey)||!/^hps-guard-control-[a-f0-9]{64}$/.test(controlKey))throw Error('Dedicated provider/service/control credentials required');
 fs.mkdirSync(path.dirname(ledgerFile),{recursive:true});
 const state={schema:'hps-feedback-live-guard/1',guard_id:randomUUID(),...(renderRepetitionId?{render_repetition_id:renderRepetitionId,render_screenshot_attempts:0,render_screenshot_limit:6}:{}),...(renderCompletion?{completion:{enabled:true,held:false,reason:null}}:{}),activity_sha256:digest(activityId),upstream:'https://api.anthropic.com',request_limit:REQUEST_LIMIT,output_cap:OUTPUT_CAP,attempts:0,blocked:0,candidate_attempts:0,armed:false,route_nonce:randomUUID(),route_proofs:0,rejected:{},rows:[]};
 fs.writeFileSync(ledgerFile,JSON.stringify(state,null,2),{flag:'wx',mode:0o600});
 const persist=()=>{const temp=ledgerFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temp,ledgerFile);};
 const snapshot=()=>structuredClone(state);
 const heldReply=res=>{state.completion.blocked_requests=Math.min((state.completion.blocked_requests??0)+1,1000000);persist();reply(res,423,'completion_held');};
 const hold=reason=>{if(state.completion&&!state.completion.held){state.completion={enabled:true,held:true,reason};persist();}};
 const reply=(res,status,error)=>{if(!res.destroyed&&!res.headersSent){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error}));}};
 const server=createServer(async(req,res)=>{
  const deny=(status,kind)=>{state.rejected[kind]=Math.min((state.rejected[kind]??0)+1,1000000);persist();reply(res,status,kind);};
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method==='GET'&&url.pathname==='/__feedback/guard'&&!url.search){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(snapshot()));return;}
  if(req.method==='POST'&&url.pathname==='/__feedback/hold'&&!url.search){
   if(!matches(req.headers['x-hps-guard-control'],controlKey)){reply(res,401,'invalid_control_key');return;}
   try{let text='';for await(const chunk of req){text+=chunk;if(text.length>1024)throw Error();}const claim=JSON.parse(text);if(!state.completion||Object.keys(claim).sort().join(',')!=='activity_sha256,guard_id,render_repetition_id'||claim.guard_id!==state.guard_id||claim.activity_sha256!==state.activity_sha256||claim.render_repetition_id!==state.render_repetition_id){reply(res,409,'guard_identity_mismatch');return;}hold('host_stopped');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({held:true,guard_id:state.guard_id}));}catch{reply(res,400,'invalid_hold');}return;
  }
  if(state.completion?.held&&req.method==='POST'){heldReply(res);return;}
  if(req.method==='POST'&&url.pathname==='/__feedback/arm'&&!url.search){if(!matches(req.headers['x-hps-guard-control'],controlKey)){reply(res,401,'invalid_control_key');return;}try{let data='';for await(const chunk of req){data+=chunk;if(data.length>1024)throw Error('invalid_arm');}const claim=JSON.parse(data);if(state.completion?.held){heldReply(res);return;}if(claim.guard_id!==state.guard_id||claim.activity_sha256!==state.activity_sha256||claim.nonce!==state.route_nonce||state.route_proofs<1){reply(res,409,'route_proof_required');return;}state.armed=true;persist();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({armed:true,guard_id:state.guard_id}));}catch{reply(res,400,'invalid_arm');}return;}
  if(req.method==='POST'&&url.pathname==='/__feedback/render-screenshot'&&!url.search){
   if(!matches(req.headers['x-hps-guard-control'],controlKey)){reply(res,401,'invalid_control_key');return;}
   try{
    let text='';for await(const chunk of req){text+=chunk;if(text.length>1024)throw Error('invalid_screenshot_claim');}const claim=JSON.parse(text);
    if(state.completion?.held){heldReply(res);return;}
    if(!claim||typeof claim!=='object'||Array.isArray(claim)||Object.keys(claim).sort().join(',')!=='activity_sha256,guard_id,render_repetition_id'){reply(res,400,'invalid_screenshot_claim');return;}
    if(!state.render_repetition_id||claim.guard_id!==state.guard_id||claim.activity_sha256!==state.activity_sha256||claim.render_repetition_id!==state.render_repetition_id){reply(res,409,'guard_identity_mismatch');return;}
    if(state.render_screenshot_attempts>=6){reply(res,429,'render_screenshot_budget_exhausted');return;}
    // Persist the attempt BEFORE acknowledging permission to capture. Abort,
    // failed capture, or absent next provider dispatch never refunds this slot.
    state.render_screenshot_attempts++;persist();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({guard_id:state.guard_id,render_repetition_id:state.render_repetition_id,attempt:state.render_screenshot_attempts,limit:6}));
   }catch(error){reply(res,error instanceof SyntaxError||error.message==='invalid_screenshot_claim'?400:500,'screenshot_reservation_failed');}return;
  }
  if(req.method==='POST'&&url.pathname==='/__feedback/attempt'&&!url.search){try{let data='';for await(const chunk of req){data+=chunk;if(data.length>1024)throw Error('invalid_claim');}const claim=JSON.parse(data);if(state.completion?.held){heldReply(res);return;}if(claim.activity_sha256!==state.activity_sha256||claim.guard_id!==state.guard_id){reply(res,409,'guard_identity_mismatch');return;}if(state.candidate_attempts>=3){reply(res,429,'candidate_attempt_budget_exhausted');return;}state.candidate_attempts++;persist();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({attempt:state.candidate_attempts,guard_id:state.guard_id}));}catch{reply(res,400,'invalid_claim');}return;}
  if(req.method!=='POST'||!['/v1/messages','/v1/messages/count_tokens'].includes(url.pathname)||[...url.searchParams].some(([key,value])=>key!=='beta'||value!=='true')||url.searchParams.getAll('beta').length>1){reply(res,404,'unsupported_endpoint');return;}
  let row,controller;const began=Date.now();
  try{
   const parts=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>20*1024*1024){reply(res,413,'request_too_large');return;}parts.push(part);}
   let body;try{body=prepareRequest(JSON.parse(Buffer.concat(parts).toString('utf8')),url.pathname);}catch(error){if(matches(req.headers['x-api-key'],serviceKey))hold('invalid_request');deny(400,['invalid_request','invalid_max_tokens','invalid_thinking','thinking_exceeds_cap'].includes(error.message)?error.message:'invalid_json');return;}
   if(!matches(req.headers['x-api-key'],serviceKey)){deny(401,'invalid_service_credential');return;}
   const probe=(req.headers['anthropic-beta']??'').split(',').map(x=>x.trim()).includes('hps-feedback-route-proof-'+state.route_nonce);
   if(url.pathname==='/v1/messages/count_tokens'&&probe){state.route_proofs++;persist();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({input_tokens:0,hps_guard_route_proof:{guard_id:state.guard_id,nonce:state.route_nonce}}));return;}
   if(state.completion?.held){heldReply(res);return;}
   if(renderCompletion){const problem=completionRequestProblem(body);if(problem){hold(problem);heldReply(res);return;}}
   if(!state.armed){deny(423,'guard_disarmed');return;}
   if(state.attempts>=REQUEST_LIMIT){state.blocked=Math.min(state.blocked+1,1000000);persist();reply(res,429,'activity_request_budget_exhausted');return;}
   const payload=JSON.stringify(body);
   // Reserve and persist synchronously BEFORE every dispatch, including auxiliary calls and retries.
   row={attempt:++state.attempts,endpoint:url.pathname,model:body.model,body_sha256:digest(payload),body_bytes:Buffer.byteLength(payload),message_metadata:messageMetadata(body.messages),image_sha256:imageHashes(body),tool_result_image_sha256:toolResultImageHashes(body),screenshot_call_sha256:screenshotCallHashes(body),external_instruction_sha256:instructionHashes(body),...(url.pathname==='/v1/messages'?{max_tokens:body.max_tokens}:{}),phase:'reserved'};state.rows.push(row);persist();
   controller=new AbortController();controller.signal.addEventListener('abort',()=>{if(!res.destroyed)res.destroy();},{once:true});const timer=setTimeout(()=>controller.abort(),timeoutMs);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
   const headers={'content-type':'application/json','x-api-key':upstreamKey};for(const name of['anthropic-version','anthropic-beta','accept'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
   try{
    const upstream=await fetchImpl('https://api.anthropic.com'+url.pathname+url.search,{method:'POST',headers,body:payload,redirect:'error',signal:controller.signal});
    row.status=upstream.status;row.phase=upstream.ok?'streaming':'http_error';if(!upstream.ok)hold('upstream_http_error');persist();
    const forwarded={};for(const [key,value]of upstream.headers)if(!['connection','keep-alive','transfer-encoding','content-length','content-encoding'].includes(key))forwarded[key]=value;
    res.writeHead(upstream.status,forwarded);
    if(upstream.body)for await(const chunk of upstream.body){if(controller.signal.aborted)break;if(!res.write(chunk))await new Promise(resolve=>{const finish=()=>{res.off('drain',finish);res.off('close',finish);resolve();};res.once('drain',finish);res.once('close',finish);});}
    if(!controller.signal.aborted){res.end();row.phase=upstream.ok?'complete':'http_error';}else{row.phase='cancelled';hold('upstream_cancelled');}
   }catch{hold('upstream_transport_error');row.phase=controller.signal.aborted?'cancelled':'transport_error';if(!res.headersSent)reply(res,502,row.phase);else res.destroy();}
   finally{clearTimeout(timer);row.elapsed_ms=Date.now()-began;persist();}
  }catch{if(row){hold('guard_request_failed');row.phase=controller?.signal.aborted?'cancelled':'transport_error';row.elapsed_ms=Date.now()-began;persist();}reply(res,500,'guard_request_failed');}
 });
 server.listen(port,'127.0.0.1');await once(server,'listening');
 return {origin:'http://127.0.0.1:'+server.address().port,snapshot,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);if(args.includes('--help')||!args[0]){console.log('node guard.mjs EXPLICIT_CONFIG.json [--allow-live]\nDefault: dry preflight; no listener or provider request. Live listener accepts only fixed api.anthropic.com messages/count_tokens.');process.exit(args.includes('--help')?0:2);}
 const c=JSON.parse(fs.readFileSync(args[0],'utf8'));if(c.schema!=='hps-feedback-live-guard-config/1'||!c.activityId||!path.isAbsolute(c.ledgerFile)||fs.existsSync(c.ledgerFile))throw Error('Explicit new activity guard config/ledger required');
 if(!args.includes('--allow-live'))console.log(JSON.stringify({status:'DRY_PREFLIGHT',activity_sha256:digest(c.activityId),request_limit:REQUEST_LIMIT,output_cap:OUTPUT_CAP,provider_called:false}));
 else{const guard=await startGuard(c);console.log(JSON.stringify({status:'DISARMED_LISTENING',origin:guard.origin,activity_sha256:digest(c.activityId),guard_id:guard.snapshot().guard_id,request_limit:REQUEST_LIMIT}));for(const signal of['SIGINT','SIGTERM'])process.on(signal,async()=>{await guard.close();process.exit(0);});}
}
