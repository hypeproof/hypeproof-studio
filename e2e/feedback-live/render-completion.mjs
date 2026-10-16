// Explicit render acceptance only. No provider retries or product SDK changes.
import assert from 'node:assert/strict';
import {digest,privateSecret} from './guard.mjs';
import {traceSdkModule} from './trace.mjs';

export function completionConfig(config,args,render){
 if(config.renderCompletion===undefined){assert(!args.includes('--allow-render-completion'));return false;}
 assert(render&&args.includes('--allow-render-completion'),'Completion requires explicit render config and flag');
 assert.deepEqual(config.renderCompletion,{enabled:true,mode:'missing-width-only'});
 assert.equal(config.attempts.length,1,'Completion owns one candidate, up to two evidence-only continuations');
 return true;
}

/** Session UUID stays in memory. The public receipt contains only its digest. */
export function createCompletionSession({hold=async()=>{}}={}){
 let session,context,terminal,abort,query,queries=0,fatal,failureHooks=0,events=0,holding,holdFailed=false;
 const fail=reason=>{fatal??=reason;holding??=Promise.resolve().then(hold).catch(()=>{holdFailed=true;});query?.close?.();abort?.abort();return holding;};
 const snapshot=()=>({queries,hold_failed:holdFailed,failure_hooks:failureHooks,events,session_sha256:session?digest(session):null,terminal,fatal:fatal??null});
 function wrap(sdk,{resume=false}={}){
  assert(!fatal,'Fatal completion state cannot resume');
  assert(resume?session&&queries>0:queries===0,'Explicit observed session required');
  const facade=Object.create(sdk,{query:{value(input){
   const o=input.options;assert(o?.abortController);abort=o.abortController;
   assert(!abort.signal.aborted&&!fatal,'Cancelled completion query');
   assert(!o.resume&&!o.continue&&!o.forkSession&&!o.sessionId&&o.persistSession!==false,'Ambient/forked session forbidden');
   const binding=digest(JSON.stringify({cwd:o.cwd,model:o.model,binary:o.pathToClaudeCodeExecutable,config:o.env?.CLAUDE_CONFIG_DIR,base:o.env?.ANTHROPIC_BASE_URL,token:o.env?.ANTHROPIC_AUTH_TOKEN}));
   assert(o.env?.CLAUDE_CONFIG_DIR,'Isolated SDK config required');
   if(context)assert.equal(binding,context,'Completion context changed');else context=binding;
   assert.deepEqual(o.allowedTools,[]);assert.deepEqual(o.settingSources,[]);assert.equal(o.strictMcpConfig,true);
   if(resume)assert(!o.tools.some(t=>['Write','Edit','MultiEdit','NotebookEdit','Bash','Agent','Task'].includes(t)),'Completion cannot write or delegate');
   terminal=undefined;queries++;
   const hooks={...o.hooks,PostToolUseFailure:[...(o.hooks?.PostToolUseFailure??[]),{hooks:[async()=>{failureHooks++;await fail('tool_failure');return{continue:false,stopReason:'Render evidence tool failed; stop without retry.'};}]}]};
   query=sdk.query({...input,options:{...o,persistSession:true,...(resume?{resume:session}:{}),hooks,canUseTool:async(...args)=>{
    if(fatal||abort.signal.aborted)return{behavior:'deny',message:'Render completion stopped.'};
    try{const decision=await o.canUseTool(...args);if(decision.behavior!=='allow')await fail('tool_denied');return decision;}
    catch(error){await fail('tool_policy_error');throw error;}
   }}});
   assert.equal(typeof query.close,'function','Actual SDK hard-close boundary required');return query;
  }}});
  return traceSdkModule(facade,{query(){},event(event){events++;
   if(event?.type==='system'&&event.subtype==='init'){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.session_id??''))fail('invalid_session');
    else if(session&&session!==event.session_id)fail('session_changed');else session=event.session_id;
   }
   if(event?.subtype==='api_retry'||event?.type==='assistant'&&event.error)fail('sdk_error');
   if(event?.type==='user'&&Array.isArray(event.message?.content)&&event.message.content.some(b=>b.type==='tool_result'&&b.is_error))fail('tool_failure');
   if(event?.type==='result'){
    terminal={subtype:event.subtype,is_error:event.is_error,stop_reason:event.stop_reason};
    if(!session||event.session_id!==session)fail('terminal_session_mismatch');
    if(event.subtype!=='success'||event.is_error!==false||event.stop_reason!=='end_turn')fail('non_normal_terminal');
   }
  }});
 }
 return{wrap,fail,snapshot,settle:()=>holding??Promise.resolve()};
}

export function completionDecision({session,guard,host,captures,sourceSha,wrapperUrl,deadline,now=Date.now()}){
 const stop=reason=>({status:'STOP_HOLD',reason});
 if(!Number.isFinite(deadline)||!Number.isFinite(now)||now>=deadline)return stop('deadline_expired_or_unknown');
 if(session.fatal)return stop(session.fatal);
 if(!session.session_sha256||session.terminal?.subtype!=='success'||session.terminal?.is_error!==false||session.terminal?.stop_reason!=='end_turn')return stop('terminal_unproven');
 if(host.fatal||host.capture_failure||host.screenshot_reservation_failed||host.blocked_requests||host.actions.some(x=>x.isError))return stop('host_failed');
 if(guard.completion?.enabled!==true||guard.completion.held)return stop('guard_completion_held_or_unknown');
 if(!guard.armed||guard.request_limit!==12||guard.output_cap!==4096||guard.render_screenshot_limit!==6||![guard.attempts,guard.candidate_attempts,guard.render_screenshot_attempts].every(Number.isSafeInteger))return stop('guard_unknown');
 if(guard.attempts<0||guard.attempts>12||guard.candidate_attempts<1||guard.candidate_attempts>3||guard.render_screenshot_attempts<0||guard.render_screenshot_attempts>6||guard.blocked||Object.values(guard.rejected??{}).some(Boolean))return stop('guard_failed');
 if(!Array.isArray(guard.rows)||guard.rows.length!==guard.attempts||guard.rows.some((r,index)=>!r||r.attempt!==index+1))return stop('guard_ledger_inconsistent');
 if(guard.rows.some(r=>r.phase!=='complete'||!Number.isInteger(r.status)||r.status<200||r.status>=300))return stop('upstream_failed');
 if(!Array.isArray(captures)||!Array.isArray(host.captures)||!Number.isSafeInteger(host.screenshot_attempts)||host.screenshot_attempts!==guard.render_screenshot_attempts||captures.length!==host.captures.length||captures.length!==guard.render_screenshot_attempts)return stop('capture_counters_inconsistent');
 if(captures.some(x=>x.source_sha256!==sourceSha||x.page.url!==wrapperUrl||![390,1280].includes(x.page.frameWidth)||x.upstream_pixel_delivery!=='OBSERVED'))return stop('capture_binding_or_delivery_failed');
 const missing=[390,1280].filter(width=>!captures.some(x=>x.page.frameWidth===width));
 if(!missing.length)return{status:'COMPLETE',missing:[]};
 if(now>=deadline||session.queries>=3||guard.candidate_attempts>=3||12-guard.attempts<missing.length+1||6-guard.render_screenshot_attempts<missing.length)return{status:'INCOMPLETE_BUDGET',missing};
 return{status:'INCOMPLETE_EVIDENCE',missing};
}

export function completionFeedback(decision,sourceSha){
 assert.equal(decision.status,'INCOMPLETE_EVIDENCE');
 return `Render acceptance feedback: actual model-delivered screenshots are still missing at widths ${decision.missing.join(', ')}px. The candidate SHA256 is ${sourceSha}. Keep all source files unchanged. Continue this same conversation: use browser_read and the existing mobile/desktop width controls through browser_click, then browser_screenshot and inspect its actual pixels. Do not conclude completion until both 390px and 1280px captures have been inspected. This evidence-only continuation grants no new tools or budget; stop on any tool failure.`;
}

/** An authenticated one-way admission hold, never disarm/rearm or a new guard. */
export function completionHoldClient({guard,activityId,repetitionId}){
 const url=new URL(guard.origin);assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash);
 return async()=>{const response=await fetch(url.origin+'/__feedback/hold',{method:'POST',headers:{'content-type':'application/json','x-hps-guard-control':privateSecret(guard.controlKeyFile)},body:JSON.stringify({guard_id:guard.id,activity_sha256:digest(activityId),render_repetition_id:repetitionId}),redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,'Completion admission hold unconfirmed');const held=await response.json();assert(held.held===true&&held.guard_id===guard.id);};
}
