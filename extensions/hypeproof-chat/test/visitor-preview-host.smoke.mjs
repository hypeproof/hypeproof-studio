import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
let panel;
const stub={ViewColumn:{Beside:2},window:{createWebviewPanel:(...args)=>{let receive,closed;panel={args,webview:{html:'',posted:[],postMessage(m){this.posted.push(m);return Promise.resolve(true)},onDidReceiveMessage:fn=>(receive=fn,{dispose(){}})},onDidDispose:fn=>(closed=fn,{dispose(){}}),dispose(){closed?.()},send:m=>receive(m)};return panel;}}};
const result=await build({stdin:{contents:"export { showVisitorPreview } from './src/visitorPreviewHost.ts';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'vscode-stub',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'module.exports=globalThis.__visitorVscode;'}));}}]});
globalThis.__visitorVscode=stub;const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
const {showVisitorPreview}=mod.exports;
const snapshot={entry:'index.html',audience:'인터넷의 누구나',files:[{path:'index.html',data:Buffer.from('<p>hello</p>')}]};
// M25: run the panel script the host actually shipped (default delay) against a minimal DOM and
// fake timers: no timer shorter than 15 s, and Next stays disabled until the 15 s timer fires.
function runPanelScript(html){
 const script=/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
 const el=()=>({disabled:false,textContent:'',open:false,listeners:{},addEventListener(t,f){this.listeners[t]=f}});
 const next=el(),cancel=el(),status=el(),details=el(),frame={...el(),contentWindow:{}};next.disabled=/<button id="next" disabled>/.test(html);
 const timers=[];
 const posts=[];
 const context={acquireVsCodeApi:()=>({postMessage(m){posts.push(m)}}),document:{querySelector:s=>({iframe:frame,details})[s],getElementById:id=>({next,cancel,status})[id]},window:{addEventListener(){}},setTimeout:(fn,ms)=>(timers.push({fn,ms}),timers.length),clearTimeout(){}};
 vm.runInNewContext(script,context);
 return {next,timers,posts};
}
async function opened(){for(let n=0;n<100&&!panel?.webview.html;n++)await new Promise(r=>setTimeout(r,10));assert.ok(panel?.webview.html);return panel;}
for(const action of ['cancel','next','close']){
 panel=undefined;let done=false;const pending=showVisitorPreview(snapshot).then(r=>(done=true,r));const p=await opened();
 assert.deepEqual(p.args[3].localResourceRoots,[]);
 assert.equal(await showVisitorPreview(snapshot),false,'double preview cannot overlap');
 p.send({action:'next',nonce:'untrusted'});await new Promise(r=>setImmediate(r));assert.equal(done,false,'wrong nonce cannot approve');
 const nonce=/nonce="([a-f0-9]+)"/.exec(p.webview.html)[1];
 const ran=runPanelScript(p.webview.html);
 assert.deepEqual(ran.timers.map(t=>t.ms),[15_000],'shipped panel uses exactly the 15 s fallback');
 assert.equal(ran.next.disabled,true,'next disabled before the fallback elapses');
 ran.timers[0].fn();assert.equal(ran.next.disabled,false,'next unlocks only when the 15 s timer fires');
 assert.deepEqual(ran.posts,[],'the fallback timer never approves by itself');
 const url=/src="(http:[^"]+)"/.exec(p.webview.html)[1];assert.deepEqual(p.webview.posted,[],'nothing reported before the frame requests the entry');assert.equal((await fetch(url)).status,200);
 for(let n=0;n<50&&!p.webview.posted.length;n++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(p.webview.posted,[{type:'served',nonce}],'host reports the served entry with this preview nonce');
 if(action==='close')p.dispose();else p.send({action,nonce});
 assert.equal(await pending,action==='next');await assert.rejects(fetch(url),'server closes after decision');
}
// N15: the host's 5-minute unattended timeout refuses; it never authorizes publication.
{
 const realSetTimeout=globalThis.setTimeout;let hostTimeout;
 globalThis.setTimeout=(fn,ms,...rest)=>ms===5*60_000?(hostTimeout=fn,0):realSetTimeout(fn,ms,...rest);
 try{
  panel=undefined;const pending=showVisitorPreview(snapshot);await opened();
  assert.equal(typeof hostTimeout,'function','host arms its 5-minute timeout');
  hostTimeout();assert.equal(await pending,false,'host timeout never approves');
 }finally{globalThis.setTimeout=realSetTimeout;}
}
assert.equal(await showVisitorPreview({...snapshot,entry:'missing'}),false,'failed server initialization refuses');
delete globalThis.__visitorVscode;
console.log('PASS visitor preview host: actual panel wiring, served signal, single flight, nonce, close/cancel/next, server disposal');
