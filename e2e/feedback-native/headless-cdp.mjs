// Transport seam only: production CdpSession still performs its own attach,
// BrowserControl still owns DOM/AX/Input/capture. No browser behavior is faked.
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Chromium creates this file before its Windows writer necessarily releases it.
// Wait for a complete, readable owned endpoint, not just directory-entry presence.
export async function waitForHeadlessEndpoint(file, child, {timeoutMs=30000,intervalMs=100,readFile=fs.readFileSync}={}){
 const deadline=Date.now()+timeoutMs;
 for(;;){
  assert(child.exitCode===null&&child.signalCode===null,'Owned headless Chromium exited before readiness');
  try{
   const lines=readFile(file,'utf8').trim().split(/\r?\n/);
   const port=Number(lines[0]),wsPath=lines[1];
   if(lines.length===2&&Number.isInteger(port)&&port>0&&port<=65535&&/^\/devtools\/browser\/[a-f0-9-]+$/i.test(wsPath??''))return {port,wsPath};
  }catch(error){if(!['ENOENT','EBUSY'].includes(error.code))throw error;}
  assert(Date.now()<deadline,'Owned headless Chromium endpoint readiness timed out');
  await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,Math.max(1,deadline-Date.now()))));
 }
}
// A readable browser endpoint can precede creation of its initial page on Windows.
// Observe the owned browser only; production CdpSession still discovers/attaches itself.
export async function waitForHeadlessPageTarget({port}, child, {timeoutMs=30000,intervalMs=100,fetchImpl=fetch}={}){
 assert(Number.isInteger(port)&&port>0&&port<=65535,'Owned headless port required');
 assert(Number.isFinite(timeoutMs)&&timeoutMs>0&&Number.isFinite(intervalMs)&&intervalMs>0,'Bounded headless readiness required');
 const controller=new AbortController();
 const checkChild=()=>{if(child.exitCode!==null||child.signalCode!==null)controller.abort(Error('Owned headless Chromium exited before page readiness'));};
 const timeout=setTimeout(()=>controller.abort(Error('Owned headless page target readiness timed out')),timeoutMs);
 const monitor=setInterval(checkChild,Math.min(intervalMs,100));
 try{
  for(;;){
   checkChild();controller.signal.throwIfAborted();
   const response=await fetchImpl('http://127.0.0.1:'+port+'/json/list',{redirect:'error',signal:controller.signal});
   assert(response.ok,'Owned headless target discovery failed');
   const targets=await response.json();
   checkChild();controller.signal.throwIfAborted();
   assert(Array.isArray(targets),'Owned headless target discovery malformed');
   const page=targets.find(target=>target?.type==='page'&&target.url==='about:blank'&&typeof target.id==='string'&&target.id.length>0);
   if(page)return {targetId:page.id};
   await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,timeoutMs)));
  }
 }finally{clearTimeout(timeout);clearInterval(monitor);controller.abort();}
}
export async function rawHeadlessCdp(url){
 const parsed=new URL(url);assert(parsed.protocol==='ws:'&&parsed.hostname==='127.0.0.1','Owned loopback CDP only');
 const ws=new WebSocket(url),messages=new Set(),closed=new Set();
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('Owned headless CDP failed'));});
 ws.onmessage=event=>{const data=JSON.parse(event.data);for(const listener of messages)listener(data);};
 ws.onclose=()=>{for(const listener of closed)listener();};
 return {onDidReceiveMessage(listener){messages.add(listener);return{dispose(){messages.delete(listener);}};},onDidClose(listener){closed.add(listener);return{dispose(){closed.delete(listener);}};},async sendMessage(message){ws.send(JSON.stringify(message));},async close(){if(ws.readyState===WebSocket.CLOSED)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned headless CDP close timed out')),2000);ws.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});ws.close();});}};
}
