// Owned headless implementation of the existing BrowserMcpHost transport boundary.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {createServer} from 'node:http';import {once} from 'node:events';import {spawn} from 'node:child_process';
import {rawHeadlessCdp,waitForHeadlessEndpoint,waitForHeadlessPageTarget} from '../feedback-native/headless-cdp.mjs';import {runtimeEnvironment} from '../feedback-native/hosted-shell.mjs';import {sha256} from '../feedback-native/safety.mjs';import {fileOnlyProfile,digest,privateSecret} from './guard.mjs';
export function renderConfig(config,args=[]){
 if(config.renderFeedback===undefined){assert(!args.includes('--allow-render-feedback'),'Render flag requires explicit config');return null;}
 const r=config.renderFeedback;assert(r&&r.enabled===true&&r.mode==='owned-headless','Explicit owned headless render config required');
 assert.deepEqual(Object.keys(r).sort(),['browserDependencyRoot','enabled','maxScreenshots','mode','repetitionId','widths'].sort(),'Unknown render settings refused');
 assert(args.includes('--allow-render-feedback'),'Explicit --allow-render-feedback required');assert.deepEqual(r.widths,[390,1280]);assert.equal(r.maxScreenshots,6);assert(/^hps-render-[0-9]{8}-r[1-3]-[a-f0-9]{32}$/.test(r.repetitionId),'Fresh immutable repetition identifier required');assert(path.isAbsolute(r.browserDependencyRoot??''));assert(Array.isArray(config.attempts)&&config.attempts.length>0&&config.attempts.length<=3&&config.attempts.every(a=>a.runtime==='sdk'&&a.scenario==='T10-T11'&&Array.isArray(a.outputPaths)&&a.outputPaths.filter(p=>typeof p==='string'&&p.endsWith('.html')).length===1),'Render feedback requires one to three explicit SDK reference candidates, each with one HTML output');
 return r;
}
export function renderProfile(profile){assert.equal(profile.sdk_tools?.browser,true,'Current served browser grant required; never add a grant');const p=fileOnlyProfile(profile);p.sdk_tools.browser=true;return p;}
export function priorScreenshotCalls(guard,repetitionId){assert.equal(guard.render_repetition_id,repetitionId,'Repetition ID must bind the existing immutable guard');assert(guard.render_screenshot_limit===6&&Number.isSafeInteger(guard.render_screenshot_attempts)&&guard.render_screenshot_attempts>=0&&guard.render_screenshot_attempts<=6,'Durable guard screenshot counter required; never infer from model messages');return guard.render_screenshot_attempts;}
export function screenshotReservationClient({guard,activityId,repetitionId}){
 const url=new URL(guard.origin);assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash);assert(path.isAbsolute(guard.controlKeyFile));
 return async()=>{const key=privateSecret(guard.controlKeyFile);assert(/^hps-guard-control-[a-f0-9]{64}$/.test(key));const response=await fetch(url.origin+'/__feedback/render-screenshot',{method:'POST',headers:{'content-type':'application/json','x-hps-guard-control':key},body:JSON.stringify({guard_id:guard.id,activity_sha256:digest(activityId),render_repetition_id:repetitionId}),redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,'Guard screenshot reservation refused or unknown; no retry/capture');const value=await response.json();assert(value.guard_id===guard.id&&value.render_repetition_id===repetitionId&&value.limit===6&&Number.isSafeInteger(value.attempt)&&value.attempt>=1&&value.attempt<=6,'Invalid screenshot reservation');return value;};
}
// Own every event-started command. Rejections become explicit host/cleanup failures,
// and shutdown cannot close the transport while interception commands remain pending.
export function ownedFetchInterception({cdp,origin,onBlocked,onFailure}){
 const pending=new Set(),failures=[];let closing;
 const subscription=cdp.onEvent(event=>{
  if(event.method!=='Fetch.requestPaused')return;
  const p=event.params;let allow=false;try{allow=new URL(p.request.url).origin===origin||p.request.url.startsWith('data:');}catch{}
  const method=allow?'Fetch.continueRequest':'Fetch.failRequest';
  const task=(async()=>{if(!allow)await onBlocked();await cdp.send(method,allow?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'});})().catch(async error=>{
   failures.push({method,error_sha256:digest(String(error))});
   try{await onFailure();}catch(failure){failures.push({method:'fatal_callback',error_sha256:digest(String(failure))});}
  });
  pending.add(task);void task.then(()=>pending.delete(task));
 });
 return {get failed(){return failures.length>0;},close(){return closing??=(async()=>{subscription.dispose();await Promise.all([...pending]);return{status:failures.length?'FAIL':'PASS',pending:pending.size,failures:[...failures]};})();}};
}
export async function startRenderHost({root,workspace,evidence,temp,dependencyRoot,browserDependencyRoot,maxScreenshots=6,priorScreenshots=0,reserveScreenshot,onFatal=()=>{},fatalToolErrors=false}){
 assert.equal(typeof reserveScreenshot,'function','Durable guard reservation is mandatory before host capture');
 const require=createRequire(path.join(dependencyRoot,'package.json')),esbuild=require('esbuild'),{chromium}=createRequire(path.join(browserDependencyRoot,'package.json'))('playwright');
 const shim={window:{browserTabs:[]},workspace:{},Uri:{file:p=>({fsPath:p})}};
 const entries={browser:'browserControl.ts',mcp:'browserMcp.ts',server:'liveServerHelpers.ts',ax:'browserControlHelpers.ts'};
 await esbuild.build({entryPoints:Object.fromEntries(Object.entries(entries).map(([k,v])=>[k,path.join(root,'extensions/hypeproof-chat/src',v)])),outdir:path.join(temp,'render-build'),bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},nodePaths:[path.join(dependencyRoot,'node_modules')],logLevel:'silent',plugins:[{name:'owned-browser-tab-transport',setup(b){b.onResolve({filter:/^vscode$/},()=>({path:'vscode',namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:'module.exports=globalThis.__hpsRenderVscode;',loader:'js'}));}}]});
 globalThis.__hpsRenderVscode=shim;
 const load=createRequire(import.meta.url),{buildAxSnapshot}=load(path.join(temp,'render-build/ax.cjs')),{BrowserControl}=load(path.join(temp,'render-build/browser.cjs')),{toMcpToolResult}=load(path.join(temp,'render-build/mcp.cjs')),{serveStatic,staticResponseHeaders}=load(path.join(temp,'render-build/server.cjs'));
 const state={schema:'hps-owned-render-host/1',headless:true,native_ui:false,max_screenshots:maxScreenshots,captures:[],prior_screenshot_attempts:priorScreenshots,screenshot_attempts:priorScreenshots,actions:[],blocked_requests:0,bundles:Object.fromEntries(Object.keys(entries).map(k=>[k,sha256(path.join(temp,'render-build',k+'.cjs'))]))};
 let candidateFile,candidatePath,servedCandidateSha;let widthRefs=new Map();
 const fatal=reason=>{state.fatal??=reason;return onFatal(reason);};
 const server=createServer((req,res)=>{const r=serveStatic(workspace,req.url);if(candidatePath&&new URL(req.url,'http://127.0.0.1').pathname===candidatePath&&r.status===200)servedCandidateSha=sha256(candidateFile);res.writeHead(r.status,staticResponseHeaders(r.contentType));res.end(r.body);});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 let chrome,control,cdp,wrapperUrl,tab,fetchInterception;const sessions=[];
 let closing;
 const close=()=>closing??=(async()=>{const errors=[];state.cleanup={cdp_closed:0,server_closed:false,chromium_exited:!chrome};if(fetchInterception){state.cleanup.interception=await fetchInterception.close();if(state.cleanup.interception.status!=='PASS')errors.push('fetch_interception');}for(const session of sessions)try{await session.close();state.cleanup.cdp_closed++;}catch{errors.push('cdp_close');}try{if(chrome){if(chrome.exitCode===null&&chrome.signalCode===null)chrome.kill();if(chrome.exitCode===null&&chrome.signalCode===null)await Promise.race([once(chrome,'exit'),new Promise(r=>setTimeout(r,5000))]);state.cleanup.chromium_exited=chrome.exitCode!==null||chrome.signalCode!==null;}}catch{errors.push('chromium_close');}try{server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));state.cleanup.server_closed=true;}catch{errors.push('server_close');}delete globalThis.__hpsRenderVscode;state.cleanup.status=errors.length||!state.cleanup.chromium_exited?'FAIL':'PASS';state.cleanup.errors=errors;})();
 try{
  const userData=path.join(temp,'render-chromium');fs.mkdirSync(userData);chrome=spawn(chromium.executablePath(),['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+userData,'--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--dns-prefetch-disable','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{env:runtimeEnvironment(process.env),stdio:'ignore'});
  const {port,wsPath}=await waitForHeadlessEndpoint(path.join(userData,'DevToolsActivePort'),chrome);
  await waitForHeadlessPageTarget({port},chrome);
  tab={url:'about:blank',title:'Owned preview',async startCDPSession(){const raw=await rawHeadlessCdp('ws://127.0.0.1:'+port+wsPath);sessions.push(raw);return raw;}};shim.window.browserTabs=[tab];shim.window.activeBrowserTab=tab;control=new BrowserControl();control.setTargetTab(tab);cdp=await control.cdp();state.browser_version=await cdp.send('Browser.getVersion');await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  fetchInterception=ownedFetchInterception({cdp,origin,onBlocked:async()=>{state.blocked_requests++;if(fatalToolErrors)await fatal('external_request_blocked');},onFailure:async()=>{state.interception_failed=true;await fatal('request_interception_failed');}});
  const navigate=async url=>{widthRefs.clear();try{assert(!fetchInterception.failed,'Owned request interception failed');assert.equal(new URL(url).origin,origin,'Headless host refuses non-owned origin');const r=await control.execute({id:'owned-open',name:'browser_navigate',input:{url}});assert(!r.isError,'Owned preview navigation failed');assert(!fetchInterception.failed,'Owned request interception failed');tab.url=url;state.actions.push({name:'browser_open',url_path:new URL(url).pathname});}catch(error){if(fatalToolErrors)await fatal('browser_open_failed');throw error;}};
  // Bind observed refs to the two actual OUTER wrapper nodes, never names in
  // generated iframe content. A fresh AX snapshot must equal the delivered read.
  const wrapperButtons=async()=>{
   const current=(await cdp.send('Runtime.evaluate',{expression:'location.href',returnByValue:true})).result.value;
   if(current!==wrapperUrl)return new Map();
   const {root:document}=await cdp.send('DOM.getDocument',{}),buttons=new Map();
   for(const width of[390,1280]){
    const {nodeIds}=await cdp.send('DOM.querySelectorAll',{nodeId:document.nodeId,selector:`body > nav > button[data-width="${width}"]`});
    if(nodeIds.length!==1)return new Map();
    const {node}=await cdp.send('DOM.describeNode',{nodeId:nodeIds[0]});buttons.set(node.backendNodeId,width);
   }
   return buttons;
  };
  const rememberWidthRefs=async result=>{
   const delivered=result.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
   const snapshot=buildAxSnapshot((await cdp.send('Accessibility.getFullAXTree',{})).nodes);
   if(delivered!==`URL: ${tab.url}\n제목: ${tab.title}\n\n${snapshot.text}`)return;
   const buttons=await wrapperButtons();
   for(const [ref,node]of snapshot.refs)if(buttons.has(node))widthRefs.set(ref,node);
  };
  const host={currentPage:async()=>({url:tab.url,title:tab.title}),openPages:async()=>[{url:tab.url,title:tab.title}],livePreviewUrl:async()=>origin,openBrowser:navigate,startLivePreview:async()=>{assert(wrapperUrl,'Candidate path required');await navigate(wrapperUrl);return wrapperUrl;},screenshot:async()=>{throw Error('Screenshot fallback not allowed');},inspect:async(name,input)=>{
   assert(!fetchInterception.failed,'Owned request interception failed');
   if(name==='browser_screenshot')try{const reserved=await reserveScreenshot();state.screenshot_attempts=reserved.attempt;assert.equal(reserved.limit,maxScreenshots);}catch{state.screenshot_reservation_failed=true;await fatal('screenshot_reservation_failed');await close();return{isError:true,content:[{type:'text',text:'Guard screenshot reservation refused or unknown; stop without capture or retry.'}]};}
   try{if(name!=='browser_screenshot')widthRefs.clear();const r=toMcpToolResult(await control.execute({id:'owned-'+name,name,input}));state.actions.push({name,isError:r.isError===true});if(name==='browser_read'&&!r.isError&&tab.url===wrapperUrl)await rememberWidthRefs(r);if(r.isError&&fatalToolErrors){await fatal('browser_tool_failed');await close();return r;}for(const b of r.content)if(b.type==='image'){
    const n=state.captures.length,file='render-capture-'+n+'.jpg';fs.writeFileSync(path.join(evidence,file),Buffer.from(b.data,'base64'),{flag:'wx'});
    const page=(await cdp.send('Runtime.evaluate',{expression:'({url:location.href,viewport:{width:innerWidth,height:innerHeight},frameWidth:document.querySelector("iframe")?.contentWindow.innerWidth??null,frameUrl:document.querySelector("iframe")?.contentWindow.location.href??null})',returnByValue:true})).result.value;const sourceSha=sha256(candidateFile);assert.equal(servedCandidateSha,sourceSha,'Candidate changed since its actual HTTP load');assert.equal(page.frameUrl,origin+candidatePath,'Screenshot must show the owned candidate iframe');state.captures.push({file,source_sha256:sourceSha,sha256:sha256(path.join(evidence,file)),bytes:fs.statSync(path.join(evidence,file)).size,mime:b.mimeType,page});
   }assert(!fetchInterception.failed,'Owned request interception failed');return r;}catch(error){state.capture_failure=error.name;await fatal('capture_failure');await close();throw error;}}};
  return {host,origin,state,close,approveViewportClick:async action=>{
   if(action.toolName!=='mcp__hypeproof__browser_click'||Object.keys(action.input??{}).join(',')!=='ref'||!widthRefs.has(action.input.ref)||tab.url!==wrapperUrl)return false;
   const node=widthRefs.get(action.input.ref);return(await wrapperButtons()).has(node);
  },setCandidate(paths){const html=paths.filter(p=>p.endsWith('.html'));assert.equal(html.length,1,'Exactly one explicit candidate HTML required');assert(!path.isAbsolute(html[0])&&!html[0].split('/').includes('..')&&!html[0].includes('\\'));candidateFile=path.join(workspace,html[0]);candidatePath='/'+html[0];wrapperUrl=origin+'/__hp_viewport?path='+encodeURIComponent(candidatePath);return {wrapperUrl,instruction:'The owned preview is '+wrapperUrl+'. After writing the HTML, use live_preview_start or browser_open to inspect it. Use browser_read and actual browser_click on the existing 모바일 390px / 데스크톱 1280px controls, then browser_screenshot. Compare actual pixels with the reference; fix only one observed failure while preserving prior candidates. After edits call live_preview_start to reload. Total candidate screenshot ceiling6 across this entire activity; all SDK/aux/retry requests still share12 slots. If tools/budget are unavailable stop and report unverified. Browser/DOM presence is not visual acceptance.'};}};
 }catch(error){await close();error.ownedCleanup=state.cleanup;throw error;}
}
