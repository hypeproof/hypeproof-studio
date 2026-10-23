import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bundle = await build({entryPoints:['src/nativeBrowser.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const api={window:{browserTabs:[]},commands:{executeCommand:async()=>{}}}, mod={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?api:require(id),URL,console,setTimeout,clearTimeout});
const {capturePageContext,captureActivePage,sendActivePageToCoach}=mod.exports;
const own='http://127.0.0.1:43210/';
function fixture(url=own) {
 let closed=0, opened=0, reads=0, hook=()=>{};
 const calls=[], listeners=new Set();
 const document={body:{get innerText(){reads++;return 'visible\noff-screen learner text';}}};
 const tab={url,title:'내 페이지',startCDPSession:async()=>{
  opened++;
  return {onDidReceiveMessage(fn){listeners.add(fn);return {dispose(){listeners.delete(fn);}};},onDidClose(){return {dispose(){}};},close:async()=>{closed++;},sendMessage:async m=>{
   calls.push(m.method);hook(m);
   let result={};
   if(m.method==='Target.getTargets')result={targetInfos:[{type:'page',targetId:'page'}]};
   else if(m.method==='Target.attachToTarget')result={sessionId:'s'};
   else if(m.method==='Page.captureScreenshot')result={data:'current-tab-image'};
   else if(m.method==='Runtime.evaluate')result={result:{value:vm.runInNewContext(m.params.expression,{document,location:new URL(actualUrl)})}};
   else if(m.method!=='Target.setDiscoverTargets')assert.fail('unexpected capture/permission API '+m.method);
   for(const fn of [...listeners])fn({id:m.id,result});
  }};
 }};
 let actualUrl=url;
 api.window.browserTabs=[tab];
 return {tab,calls,setActual:u=>actualUrl=u,setHook:fn=>hook=fn,get closed(){return closed;},get opened(){return opened;},get reads(){return reads;}};
}
let f=fixture();let r=await capturePageContext(f.tab,()=>own);
assert.equal(r.text,'visible\noff-screen learner text');assert.equal(r.textSource,'own');assert.equal(r.imageBase64,'current-tab-image');assert.equal(f.closed,1);assert.equal(f.reads,1);
assert.deepEqual(f.calls,['Target.setDiscoverTargets','Target.getTargets','Target.attachToTarget','Page.captureScreenshot','Runtime.evaluate']);
console.log('PASS own preview off-screen text, integrated screenshot, no OS or AX API');
for(const url of ['https://external.invalid/','http://127.0.0.1:43211/','file:///tmp/secret','data:text/html,secret','blob:http://127.0.0.1:43210/id']) {
 f=fixture(url);r=await capturePageContext(f.tab,()=>own);assert.equal(r.text,'',url);assert.equal(r.textSource,'not-own',url);assert.equal(f.reads,0,url);assert.equal(r.imageBase64,'current-tab-image');
}
f=fixture();r=await capturePageContext(f.tab);assert.equal(r.text,'');assert.equal(r.textSource,'owner-unknown');assert.equal(f.reads,0);
for (const owner of ['file:///tmp/', 'blob:'+own+'id', 'malformed']) {
 f=fixture();r=await capturePageContext(f.tab,()=>owner);assert.equal(r.text,'');assert.equal(r.textSource,'owner-unknown');assert.equal(f.reads,0);
}
console.log('PASS external/other port/opaque/file/unknown owner cannot read DOM');
f=fixture();api.window.browserTabs=[];await assert.rejects(capturePageContext(f.tab,()=>own));assert.equal(f.opened,0);
f=fixture();f.setActual(own+'other');r=await capturePageContext(f.tab,()=>own);assert.equal(r.text,'');assert.equal(f.reads,0);
f=fixture();f.setActual('https://external.invalid/');r=await capturePageContext(f.tab,()=>own);assert.equal(r.text,'');assert.equal(f.reads,0);
for(const kind of ['navigation','close','owner']) {
 f=fixture();let preview=own;
 f.setHook(m=>{if(m.method==='Page.captureScreenshot') {
  if(kind==='navigation') f.tab.url=own+'next';
  if(kind==='close')api.window.browserTabs=[];
  if(kind==='owner')preview='http://127.0.0.1:43211/';
 }});
 await assert.rejects(capturePageContext(f.tab,()=>preview));assert.equal(f.closed,1);
}
console.log('PASS foreign handle, stale document, navigation/close/owner switch, session cleanup');

// Exercise the public active-tab entry, including forwarding its host-owned origin.
f=fixture();api.window.activeBrowserTab=f.tab;
r=await captureActivePage(()=>own);assert.equal(r.text,'visible\noff-screen learner text');
api.window.activeBrowserTab=undefined;let warned=0;api.window.showWarningMessage=()=>warned++;
assert.equal(await captureActivePage(()=>own),null);assert.equal(warned,1);
console.log('PASS active-tab entry forwards owner and refuses missing tab');

// CGP-VOICE-R-010 — the command wiring. The owner must come from Studio's own preview server,
// never from the tab: if the tab vouched for itself, every external page would be "own".
import { readFileSync } from 'node:fs';
async function sendCommand(tabUrl, serverUrl) {
 const f=fixture(tabUrl);api.window.activeBrowserTab=f.tab;
 const attached=[], notices=[];
 const provider={isPageContextEnabled:()=>true,postPageNotice:t=>notices.push(t),attachPageContext:c=>attached.push(c)};
 await sendActivePageToCoach(provider,{currentUrl:()=>serverUrl});
 assert.equal(attached.length,1);return {ctx:attached[0],f};
}
let w=await sendCommand(own,own);
assert.equal(w.ctx.text,'visible\noff-screen learner text');assert.equal(w.ctx.textSource,'own');assert.equal(w.ctx.imageBase64,'current-tab-image');
w=await sendCommand('https://external.invalid/page',own);
assert.equal(w.ctx.text,'');assert.equal(w.ctx.textSource,'not-own');assert.equal(w.f.reads,0);assert.equal(w.ctx.imageBase64,'current-tab-image');
w=await sendCommand('https://external.invalid/page',undefined);
assert.equal(w.ctx.text,'');assert.equal(w.ctx.textSource,'owner-unknown');assert.equal(w.f.reads,0);
{ // the gate still comes first: nothing is captured when page context is off
 const f=fixture();api.window.activeBrowserTab=f.tab;const notices=[];
 await sendActivePageToCoach({isPageContextEnabled:()=>false,postPageNotice:t=>notices.push(t),attachPageContext:()=>assert.fail('attached')},{currentUrl:()=>own});
 assert.equal(f.opened,0);assert.equal(notices.length,1);
}
const ext=readFileSync(new URL('../src/extension.ts',import.meta.url),'utf8');
assert.match(ext,/registerCommand\("hypeproof-chat\.sendPageToCoach", \(\) => sendActivePageToCoach\(provider, liveServer\)\)/,'command passes the preview server');
assert.match(ext,/const liveServer = new LiveServer\(/,'liveServer is the own preview server');
assert.doesNotMatch(ext,/captureActivePage|capturePageContext/,'extension.ts must not capture with its own owner');
console.log('PASS command wiring: owner is the preview server, never the tab');
