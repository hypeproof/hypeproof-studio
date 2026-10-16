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
export async function rawHeadlessCdp(url){
 const parsed=new URL(url);assert(parsed.protocol==='ws:'&&parsed.hostname==='127.0.0.1','Owned loopback CDP only');
 const ws=new WebSocket(url),messages=new Set(),closed=new Set();
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('Owned headless CDP failed'));});
 ws.onmessage=event=>{const data=JSON.parse(event.data);for(const listener of messages)listener(data);};
 ws.onclose=()=>{for(const listener of closed)listener();};
 return {onDidReceiveMessage(listener){messages.add(listener);return{dispose(){messages.delete(listener);}};},onDidClose(listener){closed.add(listener);return{dispose(){closed.delete(listener);}};},async sendMessage(message){ws.send(JSON.stringify(message));},async close(){if(ws.readyState===WebSocket.CLOSED)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned headless CDP close timed out')),2000);ws.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});ws.close();});}};
}
