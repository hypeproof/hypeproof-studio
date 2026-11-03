/** Dedicated, unattached view. Never reuse or resize a learner's browser view. */
export interface ThumbnailPorts {
 create(id:string):Promise<void>;
 hide(id:string):Promise<void>;
 layout(id:string,width:number,height:number):Promise<void>;
 load(id:string,url:string):Promise<void>;
 state(id:string):Promise<{url:string;title:string;error?:unknown}>;
 screenshot(id:string):Promise<string>;
 destroy(id:string):Promise<void>;
}
export async function capturePageThumbnail(raw:unknown,id:string,p:ThumbnailPorts,timeoutMs=1500):Promise<{title:string;dataUrl:string}|null> {
 if(typeof raw!=='string'||raw.length>4096)return null;
 let url:URL;try{url=new URL(raw)}catch{return null}
 if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||!url.port)return null;
 let expired=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const cleanup=()=>p.destroy(id).catch(()=>{});
 const work=(async()=>{
  try {
   await p.create(id);if(expired)return null;
   await p.hide(id);if(expired)return null;
   await p.layout(id,390,244);if(expired)return null;
   await p.load(id,url.href);if(expired)return null;
   const state=await p.state(id);if(expired||state.url!==url.href||state.error)return null;
   const dataUrl=await p.screenshot(id);if(expired||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)||dataUrl.length>2_000_000)return null;
   return {title:state.title.slice(0,200),dataUrl};
  } catch{return null} finally {await cleanup()}
 })();
 const deadline=new Promise<null>(resolve=>{timer=setTimeout(()=>{expired=true;void cleanup();resolve(null)},timeoutMs)});
 try{return await Promise.race([work,deadline])}finally{if(timer)clearTimeout(timer)}
}
