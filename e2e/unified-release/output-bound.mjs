// Isolated compatibility harness only. No production payload rewriting or retry.
export const COMPATIBILITY_OUTPUT_CAP=4096;
export function compatibilityEnvironment(base){
 const env={...base,CLAUDE_CODE_MAX_OUTPUT_TOKENS:String(COMPATIBILITY_OUTPUT_CAP),CLAUDE_CODE_MAX_RETRIES:'0'};
 delete env.CLAUDE_CODE_RETRY_WATCHDOG;
 return env;
}
async function requestBody(input,init){
 const body=init?.body??(input instanceof Request?await input.clone().text():undefined);
 if(typeof body==='string')return body;
 if(body instanceof ArrayBuffer)return new TextDecoder('utf-8',{fatal:true}).decode(body);
 if(ArrayBuffer.isView(body))return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(body.buffer,body.byteOffset,body.byteLength));
 throw Error('unsupported_body');
}
const transportNames=new Set(['Error','TypeError','AbortError','TimeoutError']);
const transportCodes=new Set(['ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT']);
function transportMetadata(error,signal){
 // Fixed allowlists only: exception prose, stack, URL and arbitrary codes can
 // contain credentials. Unknown values remain unknown instead of being copied.
 return {error_class:transportNames.has(error?.name)?error.name:'unknown',
  error_code:transportCodes.has(error?.code)?error.code:null,
  cause_code:transportCodes.has(error?.cause?.code)?error.cause.code:null,
  signal_aborted:signal?.aborted===true};
}
export function compatibilityOutputGuard(fetchImpl,onChange=()=>{}){
 const state={schema:'hps-compatibility-output-bound/1',output_cap:COMPATIBILITY_OUTPUT_CAP,forwarded:0,rejected:0,transport_errors:0,calls:[]};
 const snapshot=()=>structuredClone(state);
 const persist=()=>onChange(snapshot());
 return {snapshot,async fetch(input,init){
  let url,body,generation;
  try{
   url=new URL(input instanceof Request?input.url:String(input));
   if(url.origin!=='https://api.anthropic.com'||!['/v1/messages','/v1/messages/count_tokens'].includes(url.pathname)||(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase()!=='POST')throw Error('unsupported_endpoint');
   body=JSON.parse(await requestBody(input,init));
   if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_body');
   generation=url.pathname==='/v1/messages';
   if(generation&&(!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>COMPATIBILITY_OUTPUT_CAP))throw Error('invalid_output_bound');
  }catch{
   state.rejected++;persist();throw Error('Compatibility request refused before network: endpoint/body/output bound');
  }
  // Only bounded metadata leaves this process; never body, headers, model text,
  // request URLs with query strings, error prose or credentials.
  const call={kind:generation?'generation':'count_tokens',max_tokens:generation?body.max_tokens:null,state:'dispatching',status:null};
  state.calls.push(call);state.forwarded++;persist();
  try{const response=await fetchImpl(input,init);call.state='response';call.status=response.status;persist();return response;}
  catch(error){call.state='transport_error';call.transport=transportMetadata(error,init?.signal??(input instanceof Request?input.signal:undefined));state.transport_errors++;persist();throw Error('Compatibility upstream transport failed; no automatic retry');}
 }};
}
export function assertCompatibilityOutputBound(proof,api){
 if(proof?.schema!=='hps-compatibility-output-bound/1'||proof.output_cap!==COMPATIBILITY_OUTPUT_CAP||proof.rejected!==0||proof.transport_errors!==0||!Array.isArray(proof.calls)||!Number.isSafeInteger(proof.forwarded)||proof.forwarded<1||proof.forwarded!==proof.calls.length||proof.forwarded!==api.attempts||api.request_limit!==12||api.attempts>12)throw Error('Compatibility output-bound proof missing, rejected or mismatched');
 for(let i=0;i<proof.calls.length;i++){
  const call=proof.calls[i],urlPath=api.calls?.[i]?.path;
  if(call.state!=='response'||call.status!==200||api.calls[i].status!==call.status||!['generation','count_tokens'].includes(call.kind)||(call.kind==='generation'?urlPath!=='/v1/messages'||api.calls[i].request?.max_tokens!==call.max_tokens||!Number.isSafeInteger(call.max_tokens)||call.max_tokens<1||call.max_tokens>COMPATIBILITY_OUTPUT_CAP:urlPath!=='/v1/messages/count_tokens'||call.max_tokens!==null))throw Error('Compatibility dispatch was not proven within output bound');
 }
}
