// Transport seam only: production CdpSession still performs its own attach,
// BrowserControl still owns DOM/AX/Input/capture. No browser behavior is faked.
import assert from 'node:assert/strict';
export async function rawHeadlessCdp(url){
 const parsed=new URL(url);assert(parsed.protocol==='ws:'&&parsed.hostname==='127.0.0.1','Owned loopback CDP only');
 const ws=new WebSocket(url),messages=new Set(),closed=new Set();
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('Owned headless CDP failed'));});
 ws.onmessage=event=>{const data=JSON.parse(event.data);for(const listener of messages)listener(data);};
 ws.onclose=()=>{for(const listener of closed)listener();};
 return {onDidReceiveMessage(listener){messages.add(listener);return{dispose(){messages.delete(listener);}};},onDidClose(listener){closed.add(listener);return{dispose(){closed.delete(listener);}};},async sendMessage(message){ws.send(JSON.stringify(message));},async close(){if(ws.readyState===WebSocket.CLOSED)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned headless CDP close timed out')),2000);ws.addEventListener('close',()=>{clearTimeout(timer);resolve();},{once:true});ws.close();});}};
}
