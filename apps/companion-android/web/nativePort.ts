/** Trusted main-frame broker client; never accepts a credential or a URL. */
export interface NativeEndpoint { postMessage(text: string): void; onmessage: ((event: { data: string }) => void) | null }
export function createNativePort(endpoint: NativeEndpoint, timeoutMs = 13_000) {
 let sequence=0,closed=false;
 const pending=new Map<string,{resolve(value:any):void;reject(reason:Error):void;cleanup():void}>();
 endpoint.onmessage=event=>{
  if(closed || typeof event.data!=='string' || event.data.length>70_000)return;
  let reply:any;try{reply=JSON.parse(event.data);}catch{return;}
  const work=pending.get(reply.id);if(!work)return;
  pending.delete(reply.id);work.cleanup();
  if(reply.ok===true)work.resolve(reply.value);
  else work.reject(Error(typeof reply.error==='string'&&/^[a-z0-9_]{1,64}$/.test(reply.error)?reply.error:'native_unavailable'));
 };
 const call=(payload:Record<string,unknown>,signal?:AbortSignal):Promise<any>=>{
  if(closed||signal?.aborted)return Promise.reject(Error('native_closed'));
  if(pending.size>=32)return Promise.reject(Error('native_overloaded'));
  const id='native-'+(++sequence),raw=JSON.stringify({...payload,id});
  if(new TextEncoder().encode(raw).length>8192)return Promise.reject(Error('native_invalid_request'));
  return new Promise((resolve,reject)=>{
   let timer:ReturnType<typeof setTimeout>;
   const abort=()=>{const item=pending.get(id);if(!item)return;pending.delete(id);item.cleanup();try{endpoint.postMessage(JSON.stringify({id:'cancel-'+id,kind:'cancel',target:id}));}catch{}reject(Error('native_cancelled'));};
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   timer=setTimeout(abort,timeoutMs);pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
   try{endpoint.postMessage(raw);}catch{pending.delete(id);cleanup();reject(Error('native_unavailable'));}
  });
 };
 return {call,close(){if(closed)return;closed=true;for(const work of pending.values()){work.cleanup();work.reject(Error('native_closed'));}pending.clear();endpoint.onmessage=null;try{endpoint.postMessage(JSON.stringify({id:'close',kind:'close'}));}catch{}},get pending(){return pending.size;}};
}
