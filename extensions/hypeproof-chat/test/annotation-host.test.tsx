import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {makeFakePage,FAKE_VERSION} from './fixtures/fake-cdp-page.mjs';
async function main() {
 const require=createRequire(process.cwd()+'/package.json');
 const {build}=require('esbuild');
 let enabled=true;
 const vscode={workspace:{getConfiguration:()=>({get:(key:string,otherwise:any)=>key==='annotationBatchEnabled'?enabled:otherwise})},window:{createOutputChannel:()=>({appendLine(){}})}};
 const bundle=await build({stdin:{contents:`export {BrowserControl} from './src/browserControl'; export {ChatPanelProvider} from './src/chatPanelProvider'; export {AnnotationBatch} from './src/annotationBatch'; export {PageEventLog} from './src/experimentBrowser'; export {recordElementCapture} from './src/crHostWiring';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
 const mod:any={exports:{}};
 vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:(id:string)=>id==='vscode'?vscode:require(id),console,Buffer,process,URL,TextEncoder,TextDecoder,AbortSignal,crypto:webcrypto,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,performance});
 const {BrowserControl,ChatPanelProvider,AnnotationBatch,PageEventLog,recordElementCapture}=mod.exports;
 const page=makeFakePage(); let clip={x:10,y:10,width:100,height:70}; let failShot=false, changeVersion=false;
 const raw=page.cdp.send.bind(page.cdp); let axCalls=0;
 page.cdp.send=async(method:string,p:any)=>{
   if(method==='Page.createIsolatedWorld')return {executionContextId:1};
   if(method==='Runtime.evaluate' && p.awaitPromise)return {result:{value:clip}};
   if(method==='Page.captureScreenshot' && failShot)return {};
   if(method==='Accessibility.getFullAXTree')axCalls++;
   return raw(method,p);
 };
 const log=new PageEventLog(); await log.attach(page.cdp); let refs=new Map(); let versionCalls=0;
 const cr={logFor:async()=>log,refFor:(id:number)=>[...refs].find(([,v])=>v===id)?.[0] ?? null,adoptRefs:(r:any)=>{refs=r;}};
 const browser=Object.create(BrowserControl.prototype);
 Object.assign(browser,{crOptions:{allowedOrigins:()=>['http://127.0.0.1:5173'],artifactVersion:async()=>({...FAKE_VERSION,id:changeVersion && ++versionCalls>1?'changed':FAKE_VERSION.id})},crExecutor:()=>cr,cdp:async()=>page.cdp,currentTab:()=>({url:'http://127.0.0.1:5173/index.html'}),annotationMarkers:new Map()});
 const originalTab=browser.currentTab;browser.currentTab=()=>({url:'https://untrusted.example'});await assert.rejects(browser.pickRectangle(null));browser.currentTab=originalTab;
 const captured=await browser.pickRectangle(null);
 assert.deepEqual(Array.from(captured.contexts,(c:any)=>c.ref),['e1','e2']);
 assert.equal(axCalls,1,'one frozen AX table for every intersection');
 assert.deepEqual({...captured.crop.clip},clip); assert.ok(captured.crop.data);
 assert.ok(browser.annotationRefsValid(captured.contexts)); refs=new Map(); assert.equal(browser.annotationRefsValid(captured.contexts),false);
 clip={x:500,y:500,width:10,height:10}; const blank=await browser.pickRectangle(null); assert.equal(blank.contexts[0].ref,''); assert.equal(blank.contexts[0].source,'unmapped');
 const savedElements=page.state.elements; page.state.elements=Array.from({length:201},(_,i)=>({key:'n'+i,role:'button',name:'N'+i,tag:'button',id:'n'+i})); clip={x:0,y:0,width:200,height:10000}; await assert.rejects(browser.pickRectangle(null),/작은 영역/); page.state.elements=savedElements;
 failShot=true; await assert.rejects(browser.pickRectangle(null),/영역/); failShot=false;
 clip={x:10,y:10,width:100,height:70}; changeVersion=true; versionCalls=0; await assert.rejects(browser.pickRectangle(null),/화면이 바뀌/); changeVersion=false;
 const h=Object.create(ChatPanelProvider.prototype); let scope='activity:task', generation='L0', artifact=FAKE_VERSION.id, refsValid=true, image=true, curriculum=true, posts:any[]=[];
 Object.assign(h,{annotationRuntimeAvailable:()=>true,annotationScope:()=>scope,post:async(m:any)=>{posts.push(m);},isImagePasteEnabled:()=>image,isCurriculumRuntimeEnabled:()=>curriculum,mcpBrowser:{annotationIdentity:async()=>({generation,artifactId:artifact}),annotationRefsValid:()=>refsValid,clearAnnotationMarkers:async()=>{}}});
 const reset=()=>{h._annotationBatch=new AnnotationBatch();h.syncAnnotationScope();h.annotationBatch.add('rectangle',captured.contexts,captured.crop);posts=[];enabled=true;image=true;curriculum=true;refsValid=true;generation='L0';artifact=FAKE_VERSION.id;};
 reset(); const sent=await h.takeAnnotationBatch(undefined,h.annotationBatch.revision,scope); assert.equal(sent.length,1); assert.equal((await h.takeAnnotationBatch(undefined,h.annotationBatch.revision,scope)).length,0);
 reset();assert.equal((await h.takeAnnotationBatch('retry-of-unknown',h.annotationBatch.revision,scope)).length,0);assert.equal(h.annotationBatch.size,1,'retry does not consume new draft');
 for(const guard of ['flag','image','curriculum','generation','version','refs','scope','revision']) {
  reset();let rev=h.annotationBatch.revision;const oldScope=scope;
  if(guard==='flag')enabled=false;if(guard==='image')image=false;if(guard==='curriculum')curriculum=false;if(guard==='generation')generation='old';if(guard==='version')artifact='old';if(guard==='refs')refsValid=false;if(guard==='scope')scope='different';if(guard==='revision')h.annotationBatch.edit(1,'changed');
  if(guard==='scope'){assert.equal((await h.takeAnnotationBatch(undefined,rev,oldScope)).length,0);assert.equal(h.annotationBatch.size,0);scope=oldScope;}
  else {await assert.rejects(h.takeAnnotationBatch(undefined,rev,oldScope));assert.equal(h.annotationBatch.size,1);}
  if(['generation','version','refs'].includes(guard)) assert.equal(posts.at(-1).annotations[0].stale,true);
 }
 reset(); h.mcpBrowser.annotationIdentity=async()=>{scope='changed-during-await';return {generation,artifactId:artifact};}; await assert.rejects(h.takeAnnotationBatch(undefined,h.annotationBatch.revision,scope)); assert.equal(h.annotationBatch.size,1,'scope race refuses before clearing or consuming the captured draft'); scope='activity:task'; h.mcpBrowser.annotationIdentity=async()=>({generation,artifactId:artifact});
 reset(); h.annotationRuntimeAvailable=()=>false; await assert.rejects(h.takeAnnotationBatch(undefined,h.annotationBatch.revision,scope)); assert.equal(h.annotationBatch.size,1); h.annotationRuntimeAvailable=()=>true;
 reset(); const events:any[]=[];
 for(const ctx of captured.contexts) await recordElementCapture((...args:any[])=>events.push(args),'annotation-turn-1-1-'+ctx.ref,{context:{...ctx,crop:captured.crop},text:'표시 #1',image:'data:image/png;base64,'+captured.crop.data});
 const results=events.filter(e=>e[0]==='tool_result');assert.equal(results.length,2); for(const event of results){assert.match(event[1],new RegExp(FAKE_VERSION.id));assert.match(event[2].tool_id,/annotation-turn-1-1-e[12]/);}
 console.log('PASS annotation host: all intersected refs, fixed snapshot, region crop, empty region, version races, send permissions, stale/retry/task guards, numbered artifact recording');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
