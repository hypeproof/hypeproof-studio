// Bounded metadata only. Never inspect tool inputs, URLs, credentials or image data.
import {createHash} from 'node:crypto';
export const TRACE_LIMITS=Object.freeze({messages:64,blocks:64,events:256,depth:4});
// Frozen e8af2b9 App implementation. Harness tracing must not relabel changed App code.
export const PINNED_APP_BUNDLES=Object.freeze({sdk:'ab769a29e9837ff8cd915d9cae6505688699f73a492734b6f294125066f83390',proxy:'969a657610c4c10c0f5542d2d8a2a8c38a659b39f94713025c42a361a4ba5126',skills:'162814d9726074b2d31cdb6ec5c457d548464bef956b28a3dbd4a11457abf89d',reference:'ed03a484c2cbae11b1518b782f2a9159e86c92e981e95f3557255b8c19ad0756',brief:'a54dd956915c3e5045b97b16f087c43ccddaeea0b49de70f3089ee6d8f374916',policy:'778f7aa51b0036f6daaf85f8962df37d9e5515d5002527aba8fad268a2c1fcab'});
const sha=value=>createHash('sha256').update(value).digest('hex');
const text=value=>typeof value==='string'?{bytes:Buffer.byteLength(value),sha256:sha(value)}:null;
const roles=new Set(['user','assistant','system','tool']);
const types=new Set(['text','image','tool_use','tool_result','thinking','redacted_thinking','document','server_tool_use','web_search_tool_result','web_fetch_tool_result','tool_reference','text_delta','thinking_delta','signature_delta','input_json_delta']);
const eventTypes=new Set(['assistant','user','system','result','stream_event','text','content_block_delta','content_block_start','content_block_stop','message_start','message_delta','message_stop','tool_progress','tool_use_summary','auth_status','rate_limit_event','keep_alive']);
const subtypes=new Set(['init','success','error_during_execution','error_max_turns','error_max_budget_usd','error_max_structured_output_retries','api_retry','compact_boundary','status','hook_started','hook_progress','hook_response','local_command_output']);
const stops=new Set(['end_turn','tool_use','max_tokens','stop_sequence','pause_turn','refusal','model_context_window_exceeded']);
const label=(value,allowed)=>allowed.has(value)?value:'other';
function contentSummary(content,budget,depth=0){
 if(depth>TRACE_LIMITS.depth)return {truncated:true};
 const list=typeof content==='string'?[{type:'text',text:content}]:Array.isArray(content)?content:[];
 const blocks=[];
 for(const block of list){
  if(budget.left<=0)break;budget.left--;
  if(!block||typeof block!=='object'){blocks.push({type:'other'});continue;}
  const row={type:label(block.type,types)};
  // tool_use.input, image.source and all URL/location fields deliberately stay unread.
  if(block.type==='text'&&typeof block.text==='string')row.text=text(block.text);
  if(block.type==='thinking'&&typeof block.thinking==='string')row.text=text(block.thinking);
  if(block.type==='tool_result')row.content=contentSummary(block.content,budget,depth+1);
  blocks.push(row);
 }
 return {count:list.length,blocks,...(blocks.length<list.length?{truncated:true}:{})};
}
export function messageMetadata(messages){
 const list=Array.isArray(messages)?messages:[],budget={left:TRACE_LIMITS.blocks};
 const rows=list.slice(0,TRACE_LIMITS.messages).map(message=>({role:label(message?.role,roles),content:contentSummary(message?.content,budget)}));
 return {count:list.length,messages:rows,...(rows.length<list.length||budget.left===0?{bounded:true}:{})};
}
export function eventMetadata(value){
 if(!value||typeof value!=='object')return {type:'other'};
 const row={type:label(value.type,eventTypes)};
 if(value.subtype!==undefined)row.subtype=label(value.subtype,subtypes);
 if(value.message&&typeof value.message==='object')row.message=messageMetadata([value.message]).messages[0];
 if(value.content!==undefined)row.content=contentSummary(value.content,{left:TRACE_LIMITS.blocks});
 if(value.type==='text'&&typeof value.text==='string')row.text=text(value.text);
 const event=value.type==='stream_event'?value.event:value;
 if(event&&typeof event==='object'){
  if(value.type==='stream_event')row.event_type=label(event.type,eventTypes);
  if(event.content_block)row.block=contentSummary([event.content_block],{left:TRACE_LIMITS.blocks});
  if(event.delta&&typeof event.delta==='object'){
   row.delta={type:label(event.delta.type,types)};
   if(['text_delta','thinking_delta'].includes(event.delta.type))row.delta.text=text(event.delta.text??event.delta.thinking);
   // input_json_delta is tool input, so even its digest is excluded.
   if(event.delta.stop_reason!==undefined)row.stop_reason=label(event.delta.stop_reason,stops);
  }
 }
 if(value.stop_reason!==undefined)row.stop_reason=label(value.stop_reason,stops);
 return row;
}
export function createSdkTrace(expectedUserText,onUpdate=()=>{}){
 const state={schema:'hps-feedback-sdk-metadata/1',expected_initial_text:{...text(expectedUserText),evidence:'expected_from_verified_source_replay'},queries:[],events:[],events_seen:0,events_dropped:0,observer_errors:0};
 const update=()=>{try{onUpdate(structuredClone(state));}catch{state.observer_errors++;}};
 return {
  query(input){if(state.queries.length<TRACE_LIMITS.messages)state.queries.push({prompt_kind:typeof input.prompt==='string'?'string':'async_iterable',...(typeof input.prompt==='string'?{observed_text:text(input.prompt)}:{iteration_observed:false}),expected_text_source:'expected_from_verified_source_replay'});update();},
  event(value){state.events_seen++;if(state.events.length<TRACE_LIMITS.events)state.events.push(eventMetadata(value));else state.events_dropped++;update();},
  snapshot:()=>structuredClone(state),
 };
}
/** Pass the exact query input/prompt/options to the real SDK; never consume the prompt.
 * Proxy only iteration. Each IteratorResult/event remains the original object and all
 * Query methods (including return/throw/interrupt) execute with the original receiver.
 */
export function traceSdkModule(sdk,observer){
 const query=sdk.query;
 const safe=(method,value)=>{try{observer[method](value);}catch{/* metadata cannot alter runtime behavior */}};
 const wrappedQuery=function(input){
  safe('query',input);
  const stream=Reflect.apply(query,sdk,[input]),seen=new WeakMap();
  const wrap=target=>{
   if(seen.has(target))return seen.get(target);
   const cache=new Map();
   const proxy=new Proxy(target,{get(object,key){
    const value=Reflect.get(object,key,object);
    if(typeof value!=='function')return value;
    if(cache.has(key)&&cache.get(key).original===value)return cache.get(key).wrapped;
    let wrapped;
    if(key===Symbol.asyncIterator)wrapped=function(...args){return wrap(Reflect.apply(value,object,args));};
    else if(['next','return','throw'].includes(key))wrapped=function(...args){
     const inspect=result=>{if(result&&!result.done)safe('event',result.value);return result;};
     const result=Reflect.apply(value,object,args);return result&&typeof result.then==='function'?result.then(inspect):inspect(result);
    };
    else wrapped=value.bind(object);
    cache.set(key,{original:value,wrapped});return wrapped;
   }});seen.set(target,proxy);return proxy;
  };
  return wrap(stream);
 };
 // A facade also supports frozen module exports without Proxy get invariants.
 return Object.create(sdk,{query:{value:wrappedQuery,enumerable:true}});
}
export function matchExpectedUpstreamText(rows,expectedSha){
 const found=[];
 for(const row of rows)for(let message=0;message<(row.message_metadata?.messages.length??0);message++)for(const block of row.message_metadata.messages[message].content.blocks??[])if(row.message_metadata.messages[message].role==='user'&&block.type==='text'&&block.text?.sha256===expectedSha)found.push({attempt:row.attempt,message,role:'user'});
 return {status:found.length?'OBSERVED_EXACT_TEXT_BLOCK':'UNKNOWN_WRAPPED_OR_ABSENT',expected_sha256:expectedSha,matches:found};
}
