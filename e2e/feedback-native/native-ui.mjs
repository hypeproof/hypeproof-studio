// Cross-platform form of the existing classroom/mac-window.mjs OOPIF/input contract.
// Reads DOM state; actions use native CDP input, never DOM click(), setters or postMessage().
// Streaming quit may explicitly delegate its OS-native confirmation to an owned platform port.
import fs from 'node:fs/promises';
import path from 'node:path';
import {loopback} from './safety.mjs';
import {coreCommandLabel,menuLabels,openFolderDialogTitles,detectShellLocale} from '../fixtures/shell-labels.mjs';
export function focusedResource(state){const title=state.editorLabel?.split(',')[0].trim();return !!state.resource&&(title===state.resource||title?.endsWith(' • '+state.resource));}
// Compare complete absolute identities; only Windows drive spelling and separators
// are canonicalized. Never accept a matching suffix, another drive or URI text.
export function sameDisplayedWorkspace(actual,expected,platform=process.platform){
 if(typeof actual!=='string'||typeof expected!=='string')return false;
 if(platform!=='win32')return actual===expected;
 if(!path.win32.isAbsolute(actual)||!path.win32.isAbsolute(expected))return false;
 const normalize=value=>path.win32.normalize(value).replace(/^[a-z]:/,drive=>drive.toUpperCase());
 return normalize(actual)===normalize(expected);
}
// Only an untouched preview newly observed by this scenario may be discarded.
export function assertOwnedPreviewClose(before,preview,current){
 if(!/^Untitled-[0-9]+$/.test(preview?.resource??'')||before.resources.includes(preview.resource)||!preview.focused||!focusedResource(preview)||!preview.text)throw Error('Preview was not a newly observed disposable editor');
 if(!Array.isArray(current.dirtyResources)||current.dirtyResources.some(resource=>resource!==preview.resource))throw Error('Foreign dirty editor prevents preview cleanup');
 if(current.resources.filter(resource=>resource===preview.resource).length!==1||current.resource!==preview.resource||!current.focused||!focusedResource(current)||current.text!==preview.text)throw Error('Owned preview identity/content changed before cleanup');
 const remaining=current.resources.filter(resource=>resource!==preview.resource).sort();
 if(JSON.stringify(remaining)!==JSON.stringify([...before.resources].sort()))throw Error('Unexpected editor change before preview cleanup');
}
export function skillPreviewOutcome(messages){const text=String(messages);if(text.includes('출처·고정 revision·라이선스·요구 capability'))return 'preview';if(/공개 GitHub|지침 스킬을 처리하지 못했습니다|가져오지/.test(text))return 'failure';return null;}
// Profile UI uses its canonical mapped copy; raw Service prose alone is not this proof.
export function sessionRefusalObserved(state,expected){
 return typeof expected==='string'&&expected.length>0&&state?.visible===true&&state.candidate===false&&state.message===expected&&state.preservation==='기존 활동 연결은 유지됩니다.';
}
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function waitFor(fn,label,timeout=30000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(error){last=error;}await sleep(150);}throw Error('Timed out: '+label+(last?' ('+last.message+')':''));}
// One owned read-only observation budget; callers cannot reset it between awaits.
function readObservation(timeout,workbench){
 const deadline=Date.now()+timeout,controller=new AbortController();
 const check=()=>{if(controller.signal.aborted||Date.now()>=deadline)throw Error('Owned readiness deadline');};
 const timer=setTimeout(()=>controller.abort(),timeout);
 const run=async operation=>{check();let aborted;const stopped=new Promise((_,reject)=>{aborted=()=>reject(Error('Owned readiness deadline'));controller.signal.addEventListener('abort',aborted,{once:true});});
  try{const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),stopped]);check();return value;}finally{controller.signal.removeEventListener('abort',aborted);}};
 const poll=async operation=>{for(;;){check();try{const value=await run(operation);if(value)return value;}catch{check();}await run(()=>sleep(Math.min(150,Math.max(1,deadline-Date.now()))));}};
 return {signal:controller.signal,workbench,run,poll,check,remaining:()=>deadline-Date.now(),close(){clearTimeout(timer);controller.abort();}};
}

class Target{
 constructor(info){this.info=info;this.sequence=0;this.pending=new Map();}
 async connect(observation){
  this.ws=new WebSocket(this.info.webSocketDebuggerUrl);
  try{const connected=()=>new Promise((resolve,reject)=>{this.ws.onopen=resolve;this.ws.onerror=()=>reject(Error('CDP target connection failed'));});await (observation?observation.run(connected):connected());}
  catch(error){this.ws.close();throw error;}
  this.ws.onmessage=event=>{const m=JSON.parse(event.data);const pending=this.pending.get(m.id);if(pending){m.error?pending.reject(Error(m.error.message)):pending.resolve(m.result);}};
  this.ws.onclose=()=>{for(const p of this.pending.values())p.reject(Error('CDP target closed'));this.pending.clear();};
  try{await this.send('Page.enable',{},observation);return this;}catch(error){this.ws.close();throw error;}
 }
 send(method,params={},observation){return new Promise((resolve,reject)=>{
  if(observation)try{observation.check();}catch(error){reject(error);return;}
  const id=++this.sequence;let timer;
  const finish=(settle,value)=>{clearTimeout(timer);observation?.signal.removeEventListener('abort',aborted);this.pending.delete(id);settle(value);};
  const aborted=()=>finish(reject,Error('Owned readiness deadline'));
  timer=setTimeout(()=>finish(reject,Error('CDP request timed out: '+method)),10000);
  this.pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});
  observation?.signal.addEventListener('abort',aborted,{once:true});
  try{this.ws.send(JSON.stringify({id,method,params}));}catch(error){finish(reject,error);}
 });}
 async evaluate(expression,observation){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(this.contextId?{contextId:this.contextId}:{})},observation);if(r.exceptionDetails)throw Error(r.exceptionDetails.text||'DOM observation failed');return r.result?.value;}

 close(){this.ws?.close();}
}
export function selectWorkbenchInfo(infos,id){
 const pages=infos.filter(t=>t.type==='page'&&t.url.includes('workbench'));
 const matches=id?pages.filter(t=>t.id===id):pages;
 if(matches.length>1)throw Error('Ambiguous native workbench; explicit owned window ID required');
 return matches[0];
}
export class NativeUI{
 constructor(endpoint,workbenchId){this.workbenchId=workbenchId;this.endpoint=loopback(endpoint);this.targets=new Map();this.phases=[];this.modifier=process.platform==='darwin'?4:2;}

 async restoredDraft(expected,timeout=60000){
  // Observation only: startup may still be restoring/focusing its own webview.
  // Issuing F1/Focus here can race that restoration and adds no credential proof.
  const restored=await waitFor(async()=>{const chat=await this.frame('.hps-input textarea',1500);const value=await chat.evaluate("document.querySelector('.hps-input textarea')?.value");return value===expected?{value}:null;},'actual restored chat with persisted A draft, without focus command or code entry',timeout);
  return restored.value;
 }
 async sessionRefusal(view,expected,timeout=30000){
  return waitFor(async()=>{const state=await view.evaluate(`(()=>{const e=document.querySelector('#connection-error');if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0,message:[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(),preservation:e.querySelector('p')?.textContent?.trim(),candidate:document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'};})()`);return sessionRefusalObserved(state,expected)?state:null;},'visible canonical App profile refusal, existing connection preserved and no candidate admission',timeout);
 }
 async savedActivity(view,workspace,timeout=30000){
  const selector=await waitFor(async()=>{const rows=await view.evaluate("[...document.querySelectorAll('.studio-saved-activities button')].map((e,index)=>({index,workspace:e.getAttribute('title'),label:e.getAttribute('aria-label')}))");const matches=rows.filter(row=>sameDisplayedWorkspace(row.workspace,workspace));if(matches.length!==1||typeof matches[0].label!=='string'||!matches[0].label.endsWith(', '+matches[0].workspace))return null;return '.studio-saved-activities button:nth-of-type('+(matches[0].index+1)+')';},'unique saved activity for complete workspace path',timeout);
  await this.press(view,selector,'saved activity workspace');
 }
 async chooseCandidateFolder(view,folder){
  await this.clickText(view,'다른 작업 폴더 선택');await this.folder(folder,'이 활동의 작업 폴더 선택');
  await waitFor(async()=>sameDisplayedWorkspace(await view.evaluate("document.querySelector('.studio-course dl>div:last-child dd')?.textContent"),folder),'candidate explicitly selected folder');
 }
 async activityCandidate(view,token,folder){
  await this.clickText(view,'다른 활동 선택');await this.clickText(view,'수업에 참여하기');
  await this.input(view,'#course-code',token);await this.clickText(view,'코드 확인하기');
  await waitFor(()=>view.evaluate("!!document.querySelector('.studio-course')&&!document.querySelector('#course-code')&&document.querySelector('#connect-title')?.textContent==='이 활동으로 시작할까요?'"),'token B authenticated candidate card');
  await this.chooseCandidateFolder(view,folder);
  return view;
 }
 async cancelActivityCandidate(){
  let view;try{view=await this.frame('.studio-start',1500);}catch{return false;}
  if(!await this.hasTextButton(view,'선택 취소'))return false;
  await this.clickText(view,'선택 취소');
  await waitFor(async()=>!await this.hasTextButton(view,'선택 취소'),'explicit activity candidate cancellation completed');
  return true;
 }
 async cdpDown(){try{await fetch(this.endpoint+'/json/list',{signal:AbortSignal.timeout(1500)});return false;}catch(error){return error.cause?.code==='ECONNREFUSED'||(Array.isArray(error.cause?.errors)&&error.cause.errors.length>0&&error.cause.errors.every(e=>e.code==='ECONNREFUSED'));}}
 async quitOwned(platform=process.platform,confirmStreamingQuit){
  if(!['darwin','win32'].includes(platform))throw Error('Native quit supports hosted macOS/Windows only');
  const w=await this.workbench();await this.focusWorkbench(w);
  if(platform==='win32'){
   // Upstream MenubarFileMenu exposes workbench.action.quit as E&&xit.
   // CDP Alt+F4 need not reach the OS window manager; click the actual menu.
   await this.clickText(w,menuLabels('file'),'.menubar-menu-button');
   if(confirmStreamingQuit)await this.observeQuitMenu(w,'before_exit_click');
   try{await this.clickText(w,menuLabels('exit'),'.monaco-menu .action-label');}catch(error){if(w.ws?.readyState!==WebSocket.CLOSED)throw error;}
   if(confirmStreamingQuit){await this.observeQuitMenu(w,'after_exit_click');await confirmStreamingQuit();}
   return;
  }
  try{await w.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81,modifiers:4});}
  catch(error){if(w.ws?.readyState===WebSocket.CLOSED)return;throw error;}
  try{await w.send('Input.dispatchKeyEvent',{type:'keyUp',key:'q',code:'KeyQ',windowsVirtualKeyCode:81,modifiers:0});}
  catch(error){if(w.ws?.readyState!==WebSocket.CLOSED)throw error;}
  if(confirmStreamingQuit)await confirmStreamingQuit();
 }

 async observeQuitMenu(target,phase){
  const observation=readObservation(500,target.info?.id);let state;
  try{state=await observation.run(()=>target.evaluate("(()=>{const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;return {menu_visible:[...document.querySelectorAll('.monaco-menu')].some(visible),renderer_dialog_visible:[...document.querySelectorAll('.monaco-dialog-box')].some(visible),document_focused:document.hasFocus()};})()",observation));observation.check();if(!state||['menu_visible','renderer_dialog_visible','document_focused'].some(k=>typeof state[k]!=='boolean'))throw Error('observation unavailable');}
  catch{state=null;}finally{observation.close();}
  this.phases.push({at:new Date().toISOString(),phase:'owned quit menu observation',stage:phase,status:state?'OBSERVED':'UNAVAILABLE',...(state?{menu_visible:state.menu_visible===true,menu_closed:state.menu_visible===false,renderer_dialog_visible:state.renderer_dialog_visible===true,document_focused:state.document_focused===true}:{})});
 }

 async list(observation){const r=await fetch(this.endpoint+'/json/list',{signal:observation?AbortSignal.any([observation.signal,AbortSignal.timeout(1500)]):AbortSignal.timeout(1500)});if(!r.ok)throw Error('CDP target list unavailable');return r.json();}
 async target(info,observation){
  let target=this.targets.get(info.id);
  if(!target||target.ws.readyState!==WebSocket.OPEN){
   target=new Target(info);
   try{await target.connect(observation);observation?.check();this.targets.set(info.id,target);}catch(error){target.close();throw error;}
  }
  return target;
 }
 /** Pick the Korean or English core labels from the running workbench (hosted apps are not Korean-packed). */
 async detectLocale(appPath){return detectShellLocale(await this.workbench(),appPath);}
 async workbench(observation){
  const id=observation?.workbench??this.workbenchId;
  const discover=async()=>{if(observation&&this.workbenchId&&this.workbenchId!==id)throw Error('Owned workbench changed');const infos=await (observation?observation.run(()=>this.list(observation)):this.list());const info=selectWorkbenchInfo(infos,id);return info?(observation?observation.run(()=>this.target(info,observation)):this.target(info)):null;};
  return observation?observation.poll(discover):waitFor(discover,'native workbench'+(id?' '+id:''),60000);
 }

 async observeRetainedFocusTarget(){
  const observation=readObservation(750,this.workbenchId);
  try{return await this.frame('.hps-input textarea',750,observation);}catch{return null;}finally{observation.close();}
 }
 async restoredFocus(timeout=30000){
  // Observe startup focus only; no palette, click or Page.bringToFront may repair it.
  const chat=await this.frame('.hps-input textarea');
  const observed=await waitFor(()=>chat.evaluate("document.hasFocus()&&document.activeElement===document.querySelector('.hps-input textarea')"),'restored native input focus without activation',timeout);
  return {input_focus_restored:observed===true,focus_repaired:false};
 }
 async closeOwnedWindow(){
  if(!this.workbenchId)throw Error('Close requires an explicitly bound owned window');
  const w=await this.workbench();
  if(!await w.evaluate('document.hasFocus()'))throw Error('Owned secondary must be actually focused before Close Window');
  try{await this.palette(coreCommandLabel('workbench.action.closeWindow'),{expectReload:true});}catch(error){if(w.ws?.readyState!==WebSocket.CLOSED)throw error;}
  await waitFor(async()=>!(await this.list()).some(t=>t.id===this.workbenchId),'owned secondary window closed',30000);
 }
 // Activation is an input action, never part of read-only workbench discovery.
 async focusWorkbench(target){await target.send('Page.bringToFront');await waitFor(()=>target.evaluate('document.hasFocus()'),'native workbench window focused');}
 async frame(selector,timeout=30000,observation){
  const observe=operation=>observation?observation.run(operation):operation();
  const discover=async()=>{
   const matches=[];
   for(const info of (await observe(()=>this.list(observation))).filter(t=>t.type==='iframe'&&t.url.includes('hypeproof-chat'))){
    const host=await observe(()=>this.workbench(observation));
    if(observation&&host.info?.id!==observation.workbench)throw Error('Owned workbench changed');
    const name=new URL(info.url).searchParams.get('id');
    const outerVisible=await observe(()=>host.evaluate(`(()=>{const e=[...document.querySelectorAll('iframe')].find(e=>e.name===${JSON.stringify(name)});if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility==='visible'&&s.display!=='none';})()`,observation));
    if(!outerVisible)continue;
    const target=await observe(()=>this.target(info,observation));
    const tree=await observe(()=>target.send('Page.getFrameTree',{},observation));
    const nodes=[tree.frameTree,...(tree.frameTree.childFrames||[])];
    for(const node of nodes){
     const isolated=await observe(()=>target.send('Page.createIsolatedWorld',{frameId:node.frame.id,worldName:'feedback-native-read'},observation));target.contextId=isolated.executionContextId;
     const visible=await observe(()=>target.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})()`,observation));
     if(visible){observation?.check();target.ownedWorkbenchId=host.info?.id;target.ownedFrameId=node.frame.id;target.ownedLoaderId=node.frame.loaderId;matches.push(target);break;}
    }
   }
   if(matches.length>1)throw Error('Ambiguous visible webview '+selector);return matches[0];
  };
  return observation?observation.poll(discover):waitFor(discover,'visible extension webview '+selector,timeout);
 }

 // Re-read only a previously observed frame, including when its native window is inactive.
 async retainedFrame(target){
  if(!this.workbenchId)throw Error('Retained frame requires explicit owned window');
  const info=(await this.list()).find(t=>t.id===target.info.id&&t.type==='iframe'&&t.url===target.info.url);
  if(!info)throw Error('Previously observed frame identity disappeared');
  const name=new URL(info.url).searchParams.get('id');if(!name)throw Error('Observed frame has no owner name');
  const host=await this.workbench();
  if(!await host.evaluate(`!![...document.querySelectorAll('iframe')].find(e=>e.name===${JSON.stringify(name)})`))throw Error('Observed frame no longer belongs to its owned window');
  return target;
 }
 // Retain one DOM object. Reflow may move it after scrolling; never reselect or retry input.
 async press(target,selector,label=selector,timeout=30000,stripCheckmark=false){
  if(!Number.isFinite(timeout)||timeout<=0||timeout>30000)throw Error('Invalid native control readiness bound');
  const deadline=Date.now()+timeout;let objectId,state,previous,lastScrollLayout,scrolls=0,samples=0;const history=[],scrollHistory=[];
  const check=()=>{if(Date.now()>=deadline)throw Error('Control readiness deadline');};
  const bounded=async operation=>{check();let timer;try{const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Control readiness deadline')),Math.max(1,deadline-Date.now()));})]);check();return value;}finally{clearTimeout(timer);}};
  const record=outcome=>this.phases.push({at:new Date().toISOString(),phase:'native control readiness',control_label:label,selector,outcome,state:state??null,samples,scrolls,history_truncated:samples>24,layout_history:[...history],scroll_history:[...scrollHistory]});
  const rectKeys=['x','y','width','height','viewportWidth','viewportHeight','scrollX','scrollY','documentWidth','documentHeight'];
  const stable=(a,b)=>a&&b&&rectKeys.every(key=>Number.isFinite(a[key])&&Number.isFinite(b[key])&&Math.abs(a[key]-b[key])<=0.25);
  const layoutChanged=(a,b)=>!!a&&!!b&&(Math.abs(a.y+a.scrollY-b.y-b.scrollY)>0.25||Math.abs(a.x+a.scrollX-b.x-b.scrollX)>0.25||['width','height','viewportWidth','viewportHeight','documentWidth','documentHeight'].some(key=>Math.abs(a[key]-b[key])>0.25));
  try{
   const selected=await bounded(()=>target.send('Runtime.evaluate',{expression:'document.querySelector('+JSON.stringify(selector)+')',returnByValue:false,...(target.contextId?{contextId:target.contextId}:{})}));
   if(selected.exceptionDetails||!selected.result?.objectId)throw Error('Control absent');objectId=selected.result.objectId;
   let scroll='initial';
   for(;;){
    const sample=await bounded(()=>target.send('Runtime.callFunctionOn',{objectId,returnByValue:true,arguments:[{value:selector},{value:scroll},{value:selector.startsWith('.quick-input-list .monaco-list-row')?label:null},{value:stripCheckmark}],functionDeclaration:`function(selector,scroll,expectedLabel,stripCheckmark){
     const rowLabel=this.querySelector('.label-name')?.textContent.trim();
     const semanticLabel=expectedLabel===null?null:stripCheckmark?rowLabel?.replace(/^✓\\s*/,''):rowLabel;
     const same=this.isConnected&&document.querySelector(selector)===this&&(expectedLabel===null||semanticLabel===expectedLabel);
     if(!same)return {same:false,semantic_match:expectedLabel===null||semanticLabel===expectedLabel};
     const measure=()=>{const b=this.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2,hit=document.elementFromPoint(x,y),s=getComputedStyle(this),root=document.scrollingElement??document.documentElement;
      return {same:true,semantic_match:expectedLabel===null||semanticLabel===expectedLabel,x,y,width:b.width,height:b.height,visible:s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0,inView:b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth,topmost:!!hit&&(hit===this||this.contains(hit)),enabled:!this.disabled,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollX,scrollY,documentWidth:root.scrollWidth,documentHeight:root.scrollHeight};};
     const before=measure();let scrolled=false;
     if(scroll==='initial'||scroll==='reflow'&&before.visible&&before.enabled&&!before.inView){this.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});scrolled=true;}
     return {state:measure(),scrolled,before:scrolled?before:null};
    }` }));scroll=null;
    if(sample.exceptionDetails)throw Error('Control sample unavailable');const value=sample.result?.value;state=value?.state??value;
    if(!state?.same)throw Error('Control identity changed');
    samples++;history.push({sample:samples,...state});if(history.length>24)history.splice(6,1);
    if(value.scrolled){scrolls++;if(scrolls>3)throw Error('Control scroll budget exceeded');lastScrollLayout=state;scrollHistory.push({attempt:scrolls,before:value.before,after:state});previous=null;}
    const finite=rectKeys.every(key=>Number.isFinite(state[key]));
    const usable=finite&&state.visible&&state.inView&&state.topmost&&state.enabled&&state.width>0&&state.height>0;
    if(usable&&previous?.visible&&previous.inView&&previous.topmost&&previous.enabled&&previous.width>0&&previous.height>0&&stable(previous,state)){check();record('observed');break;}
    // A second scroll is only for a measured, stable offscreen layout change.
    // Occlusion, disability, unchanged offscreen layout or replacement do not qualify.
    if(finite&&state.visible&&state.enabled&&!state.inView&&previous?.visible&&previous.enabled&&!previous.inView&&stable(previous,state)&&layoutChanged(lastScrollLayout,state)&&scrolls<3){scroll='reflow';previous=null;}
    else previous=state;
    check();await sleep(Math.min(150,Math.max(1,deadline-Date.now())));
   }
   check();for(const type of ['mouseMoved','mousePressed','mouseReleased'])await target.send('Input.dispatchMouseEvent',{type,x:state.x,y:state.y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
  }catch{record(state?.same===false?'identity-refused':Date.now()>=deadline?'timeout':'unavailable');throw Error('Not a usable visible native control: '+label);}
  finally{if(objectId)try{await target.send('Runtime.releaseObject',{objectId});}catch{record('handle-release-unavailable');}}
 }

 async chatDocumentIdentity(timeout=30000,observation){
  const chat=await this.frame('.hps-input textarea',timeout,observation);observation?.check();
  const identity={workbench:chat.ownedWorkbenchId,target:chat.info?.id,frame:chat.ownedFrameId,loader:chat.ownedLoaderId};
  if(Object.values(identity).some(value=>typeof value!=='string'||!value))throw Error('Owned chat document identity unavailable');
  return identity;
 }
 // Sidebar visibility is not completion of its asynchronous focus return. Observe
 // the exact previously retained document twice before the next single F1.
 async retainedChatReady(before,timeout=30000){
  if(!Number.isFinite(timeout)||timeout<=0||timeout>30000||!before||['workbench','target','frame','loader'].some(k=>typeof before[k]!=='string'||!before[k]))throw Error('Exact retained chat identity required');
  before={workbench:before.workbench,target:before.target,frame:before.frame,loader:before.loader};
  const chat=this.targets.get(before.target),name=chat?.info?.url?new URL(chat.info.url).searchParams.get('id'):null;
  if(!chat||chat.info.id!==before.target||!name)throw Error('Previously observed retained chat target required');
  const observation=readObservation(timeout,before.workbench);let state,readySamples=0;
  const changed=()=>{throw Object.assign(Error('Retained chat identity changed'),{identityChanged:true});};
  const record=outcome=>this.phases.push({at:new Date().toISOString(),phase:'retained sidebar return readiness',outcome,before,state:state??null,ready_samples:readySamples});
  try{for(;;){
   observation.check();const infos=await observation.run(()=>this.list(observation));
   const matches=infos.filter(t=>t.id===before.target);
   if(matches.length!==1||matches[0].type!=='iframe'||matches[0].url!==chat.info.url)changed();
   const host=await observation.run(()=>this.workbench(observation));if(host.info?.id!==before.workbench)changed();
   const tree=await observation.run(()=>chat.send('Page.getFrameTree',{},observation));
   const frames=[tree.frameTree,...(tree.frameTree?.childFrames??[])].filter(n=>n?.frame?.id===before.frame);
   if(frames.length!==1||frames[0].frame.loaderId!==before.loader)changed();
   const outer=await observation.run(()=>host.evaluate(`(()=>{const matches=[...document.querySelectorAll('iframe')].filter(e=>e.name===${JSON.stringify(name)});if(matches.length!==1)return {sameOwner:false};const e=matches[0],r=e.getBoundingClientRect(),s=getComputedStyle(e);return {sameOwner:true,visible:r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible',focused:document.hasFocus()&&document.activeElement===e};})()`,observation));
   if(outer?.sameOwner!==true)changed();
   const inner=await observation.run(()=>chat.evaluate("(()=>{const e=document.querySelector('.hps-input textarea'),r=e?.getBoundingClientRect(),s=e?getComputedStyle(e):null;return {present:!!e,connected:!!e?.isConnected,enabled:!!e&&!e.disabled&&!e.readOnly,visible:!!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible',documentFocused:document.hasFocus(),inputFocused:!!e&&document.activeElement===e};})()",observation));
   state={outerVisible:outer.visible===true,hostFocused:outer.focused===true,...inner};
   readySamples=['outerVisible','hostFocused','present','connected','enabled','visible','documentFocused','inputFocused'].every(k=>state[k]===true)?readySamples+1:0;
   if(readySamples===2){observation.check();record('observed');return before;}
   await observation.run(()=>sleep(Math.min(150,Math.max(1,observation.remaining()))));
  }}catch(error){record(error.identityChanged?'identity-refused':observation.signal.aborted||observation.remaining()<=0?'timeout':'unavailable');throw Error('Retained sidebar return readiness failed');}
  finally{observation.close();}
 }
 async reloadedChatReady(before,timeout=30000){
  if(!Number.isFinite(timeout)||timeout<=0||timeout>30000||!before||['workbench','target','frame','loader'].some(key=>typeof before[key]!=='string'||!before[key]))throw Error('Exact previous owned chat document required');
  const observation=readObservation(timeout,before.workbench);let observed;
  try{const after=await observation.poll(async()=>{const identity=await observation.run(()=>this.chatDocumentIdentity(timeout,observation));
    if(!identity||['workbench','target','frame','loader'].some(key=>typeof identity[key]!=='string'||!identity[key]))return null;
    observation.check();observed=identity;
    if(identity.workbench!==before.workbench)return null;
    return ['target','frame','loader'].some(key=>identity[key]!==before[key])?identity:null;
   });observation.check();this.phases.push({at:new Date().toISOString(),phase:'post-reload chat readiness',outcome:'observed',before,after});return after;
  }catch{this.phases.push({at:new Date().toISOString(),phase:'post-reload chat readiness',outcome:'timeout',before,after:observed??null});throw Error('Timed out: fresh post-reload owned chat document and textarea');}
  finally{observation.close();}

 }

 async textSelector(target,text,css='button,.monaco-button'){return target.evaluate(`(()=>{const wanted=${JSON.stringify([].concat(text))},nodes=[...document.querySelectorAll(${JSON.stringify(css)})].filter(e=>wanted.includes(e.textContent.replace(/[↗→]/g,'').trim())&&e.getBoundingClientRect().width>0);if(nodes.length!==1)return null;let e=nodes[0],parts=[];while(e&&e!==document.documentElement){parts.unshift(e.tagName.toLowerCase()+':nth-child('+([...e.parentElement.children].indexOf(e)+1)+')');e=e.parentElement;}return 'html>'+parts.join('>');})()`);}
 async hasTextButton(target,text){return !!(await this.textSelector(target,text));}
 async clickText(target,text,css){const selector=await waitFor(()=>this.textSelector(target,text,css), 'control '+text);await this.press(target,selector,text);}
 // These are Chromium Windows virtual keys, not OS scan codes. Let Chromium derive
 // the native key from code; passing 65 for Mac A denotes keypad decimal instead.
 // Text arrives via insertText, so shortcuts use rawKeyDown (the CDP/Playwright contract).
 async key(target,key,modifiers=0){const codes={Enter:['Enter',13],Escape:['Escape',27],F1:['F1',112],F4:['F4',115],q:['KeyQ',81],a:['KeyA',65],b:['KeyB',66],k:['KeyK',75],o:['KeyO',79],n:['KeyN',78],s:['KeyS',83],p:['KeyP',80],w:['KeyW',87]};const[code,number]=codes[key]??[key,0];for(const type of['rawKeyDown','keyUp'])await target.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:number,modifiers:type==='keyUp'?0:modifiers,...(type==='rawKeyDown'&&key==='a'&&modifiers===4?{commands:['selectAll']}:{})});}
 async input(target,selector,text){await this.press(target,selector);await this.key(target,'a',this.modifier);await waitFor(()=>target.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e===document.activeElement&&e.selectionStart===0&&e.selectionEnd===e.value.length;})()`),'native input selection covers current value');await target.send('Input.insertText',{text});await waitFor(()=>target.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`),'native input replacement observed');}
 // CDP input acknowledgment is not a workbench transition acknowledgment. Never reuse
 // the previous command/picker while its asynchronous hide/next-picker is pending.
 async quickState(target){return target.evaluate(`(()=>{const e=document.querySelector('.quick-input-widget'),input=e?.querySelector('input');const focus={hostFocused:document.hasFocus(),inputFocused:!!input&&document.activeElement===input,activeTag:document.activeElement?.tagName,activePart:document.activeElement?.closest?.('.part')?.id,title:e?.querySelector('.quick-input-title')?.textContent};if(!e||!input)return {visible:false,ready:false,mode:'closed',...focus};const r=e.getBoundingClientRect(),b=input.getBoundingClientRect(),style=getComputedStyle(e),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);const visible=r.width>0&&r.height>0&&style.display!=='none'&&style.visibility==='visible';return {...focus,visible,ready:visible&&focus.hostFocused&&focus.inputFocused&&b.width>0&&b.height>0&&!input.disabled&&hit===input,mode:input.value.startsWith('>')?'command':'picker',value:input.value};})()`);}
 async waitQuick(target,predicate,phase,timeout=30000,expectReload=false){let state;const record=outcome=>{const safe={at:new Date().toISOString(),phase,outcome,visible:state?.visible,ready:state?.ready,mode:state?.mode,hostFocused:state?.hostFocused,inputFocused:state?.inputFocused,activeTag:state?.activeTag,activePart:state?.activePart,title:state?.title,command:this.commandTitle};this.phases.push(safe);return safe;};try{const found=await waitFor(async()=>{state=expectReload&&target.ws?.readyState===WebSocket.CLOSED?{visible:false,ready:false,mode:'reloading-target-closed'}:await this.quickState(target);return predicate(state)?state:null;},phase,timeout);record('observed');return found;}catch(error){throw Error(error.message+'; quick-input state='+JSON.stringify(record('timeout')));}}
 async selectedQuick(target,previous,phase,expectReload=false){return this.waitQuick(target,s=>!s.visible||(s.ready&&s.mode==='picker'&&s.value!==previous),phase,30000,expectReload);}
 async choiceSelector(target,label,command=false){return target.evaluate(`(()=>{const a=[...document.querySelectorAll('.quick-input-list .monaco-list-row')].filter(e=>{const text=e.querySelector('.label-name')?.textContent.trim();return (${command}?text:text?.replace(/^✓\\s*/,''))===${JSON.stringify(label)}&&e.getBoundingClientRect().height>0;});if(a.length!==1)return null;const e=a[0];return '.quick-input-list .monaco-list-row:nth-child('+([...e.parentElement.children].indexOf(e)+1)+')';})()`);}
 async palette(title,{expectReload=false}={}){this.commandTitle=title;this.phases.push({at:new Date().toISOString(),action:'palette',command:title});const w=await this.workbench();await this.focusWorkbench(w);await this.waitQuick(w,s=>!s.visible,'previous quick input closed before command');await this.key(w,'F1');await this.waitQuick(w,s=>s.ready&&s.mode==='command','command palette opened');const typed='>'+title;await this.input(w,'.quick-input-widget input',typed);await this.waitQuick(w,s=>s.ready&&s.value===typed,'command query entered');const selector=await waitFor(()=>this.choiceSelector(w,title,true),'registered exact command '+title);await this.press(w,selector,title);await this.selectedQuick(w,typed,'command selected and palette dismissed',expectReload);return w;}
 async quick(label){const w=await this.workbench();await this.waitQuick(w,s=>s.ready&&s.mode==='picker','next quick picker opened');await waitFor(()=>this.choiceSelector(w,label),'declared quick choice '+label);await this.input(w,'.quick-input-widget input',label);await this.waitQuick(w,s=>s.ready&&s.value===label,'quick choice query entered');const selector=await waitFor(()=>this.choiceSelector(w,label),'filtered exact quick choice '+label);await this.press(w,selector,label,30000,true);await this.selectedQuick(w,label,'quick choice accepted and previous picker dismissed');}
 async prompt(title,value){const w=await this.workbench();await waitFor(()=>w.evaluate(`document.querySelector('.quick-input-widget')?.textContent.includes(${JSON.stringify(title)})`),'input prompt '+title);await this.waitQuick(w,s=>s.ready&&s.mode==='picker','input prompt ready');await this.input(w,'.quick-input-widget input',value);await this.key(w,'Enter');await this.selectedQuick(w,value,'input prompt accepted');}
 async editorState(target){return target.evaluate(`(()=>{const e=document.activeElement,editor=e?.closest('.monaco-editor.focused'),group=editor?.closest('.editor-group-container'),tab=group?.querySelector('.tabs-container .tab.active');return {resources:[...document.querySelectorAll('.tabs-container .tab')].map(t=>t.getAttribute('data-resource-name')).filter(Boolean),dirtyResources:[...document.querySelectorAll('.tabs-container .tab.dirty')].map(t=>t.getAttribute('data-resource-name')),resource:tab?.getAttribute('data-resource-name'),editorLabel:editor?.parentElement?.getAttribute('aria-label'),focused:!!editor&&(e.matches('textarea.inputarea,.native-edit-context')||e.getAttribute('role')==='textbox'),text:editor?.querySelector('.view-lines')?.textContent.replace(/\\u00a0/g,' ')};})()`);}
 async explorerReady(timeout=30000){const w=await this.workbench();await waitFor(()=>w.evaluate("(()=>{const e=document.querySelector('.explorer-folders-view');return !!e&&e.getBoundingClientRect().width>0&&e.contains(document.activeElement);})()"),'Files command completed with actual Explorer focus',timeout);}
 async focusChatReady(timeout=30000){
  const chat=await this.frame('.hps-input textarea');let state,observedAt,started=false,sampleError;
  const record=outcome=>this.phases.push({at:new Date().toISOString(),phase:'chat input focus readiness',outcome,target_id:chat.info?.id??null,owned_workbench_id:chat.ownedWorkbenchId??this.workbenchId??null,context_id:chat.contextId??null,sampled_at_ms:observedAt??null,snapshot_age_ms:observedAt===undefined?null:Date.now()-observedAt,state:state??null,sample_error:sampleError??null});
  try{await waitFor(async()=>{
   try{state=await chat.evaluate("(()=>{const e=document.querySelector('.hps-input textarea'),r=e?.getBoundingClientRect(),s=e?getComputedStyle(e):null,tag=document.activeElement?.tagName;return {documentFocused:document.hasFocus(),inputFocused:!!e&&document.activeElement===e,inputPresent:!!e,activeTag:typeof tag==='string'&&/^[A-Z][A-Z0-9-]{0,31}$/.test(tag)?tag:null,geometry:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,visible:!!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible'};})()");observedAt=Date.now();sampleError=undefined;}
   catch(error){sampleError=['Error','TypeError','RangeError','ReferenceError','SyntaxError','AssertionError'].includes(error?.name)?error.name:'Error';throw Error('Chat focus diagnostic sample unavailable');}
   finally{if(!started){started=true;record('start');}}
   return state.documentFocused&&state.inputFocused;
  },'chat reveal completed with actual webview and textarea focus',timeout);record('observed');return chat;}
  catch(error){record('timeout');throw error;}
 }
 async assertNoDirtyEditors(target){const state=await this.editorState(target??await this.workbench());if(!Array.isArray(state.dirtyResources)||state.dirtyResources.length)throw Error('Unclosed dirty editor prevents owned folder transition');return state;}
 async previewDestinationReady(target,before,observation){
  if(before.returnTarget?.kind==='chat'){
   const chat=await this.frame('.hps-input textarea',5000,observation);
   const identity={workbench:chat.ownedWorkbenchId,target:chat.info?.id,frame:chat.ownedFrameId,loader:chat.ownedLoaderId};
   if(JSON.stringify(identity)!==JSON.stringify(before.returnTarget.identity))throw Object.assign(Error('Preview destination identity changed'),{identityChanged:true});
   const state=await chat.evaluate("({documentFocused:document.hasFocus(),composerFocused:document.activeElement===document.querySelector('.hps-input textarea'),activeTag:document.activeElement?.tagName})",observation);
   // Passive editor reveal restores the owned document, not its composer.
   // Only the explicit Focus command promises textarea focus.
   this.previewDestinationState={kind:'chat',identity,...state};return state.documentFocused;
  }
  const state=await this.editorState(target);
  this.previewDestinationState={kind:'editor',expected:before.resource,resource:state.resource,focused:state.focused};return !!before.resource&&state.resource===before.resource&&state.focused&&focusedResource(state);
 }
 async closeOwnedPreview(target,before,preview,timeout=5000){
  assertOwnedPreviewClose(before,preview,await this.editorState(target));
  // This registered command targets only the verified active editor; no blanket save dialog response.
  await this.palette(coreCommandLabel('workbench.action.revertAndCloseActiveEditor'));
  const observation=readObservation(timeout,target.info?.id);this.previewDestinationState=undefined;
  const record=outcome=>this.phases.push({at:new Date().toISOString(),phase:'preview destination restoration',outcome,state:this.previewDestinationState??null});
  try{for(;;){
   const state=await observation.run(()=>this.editorState(target));
   const closed=!state.resources.includes(preview.resource)&&JSON.stringify([...state.resources].sort())===JSON.stringify([...before.resources].sort())&&Array.isArray(state.dirtyResources)&&state.dirtyResources.length===0;
   if(closed&&await observation.run(()=>this.previewDestinationReady(target,before,observation))){record('observed');break;}
   await observation.run(()=>sleep(50));
  }}catch(error){record(error.identityChanged?'identity-refused':'timeout');if(error.identityChanged)throw error;throw Error('Timed out: owned preview closed and original destination focus restored');}finally{observation.close();}
  return {resource:preview.resource,public_ui_revert_and_close:true,other_editors_preserved:true,destination_focus_restored:true};
 }
 async newPreview(target,before,required,timeout=30000){return waitFor(async()=>{const s=await this.editorState(target);return s.focused&&/^Untitled-[0-9]+$/.test(s.resource??'')&&!before.resources.includes(s.resource)&&focusedResource(s)&&required.every(text=>s.text?.includes(text))?s:null;},'new preview resource, focused model and rendered provenance',timeout);}
 async isOpenFolder(target){return target.evaluate(`(()=>{const e=document.querySelector('.quick-input-widget');const title=e?.querySelector('.quick-input-title')?.textContent.trim();return e?.getBoundingClientRect().height>0&&${JSON.stringify(openFolderDialogTitles())}.includes(title);})()`);}
 async ownedOpenFolder(directory,timeout=30000){const w=await this.workbench();await waitFor(()=>this.isOpenFolder(w),'declared Open Folder dialog title',timeout);await this.pathDialog(directory,['Open','열기','OK','확인']);}
 async cancelOwnedOpenFolder(){const w=await this.workbench();if(!await this.isOpenFolder(w))return false;await this.key(w,'Escape');await this.waitQuick(w,s=>!s.visible,'failed owned Open Folder dialog canceled');return true;}
 async newTextFile(text,timeout=30000){
  if(!Number.isFinite(timeout)||timeout<=0||timeout>30000)throw Error('Invalid new file readiness bound');
  const w=await this.workbench();await this.focusWorkbench(w);const before=await this.editorState(w);let state;
  await this.key(w,'n',this.modifier);
  let created;
  try{created=await waitFor(async()=>{state=await this.editorState(w);return state.focused&&/^Untitled-[0-9]+$/.test(state.resource??'')&&!before.resources.includes(state.resource)&&focusedResource(state)&&state.text?.trim()===''?state:null;},'new empty Untitled resource and focused editor identity',timeout);}
  catch(error){this.phases.push({at:new Date().toISOString(),phase:'new text file readiness',outcome:'timeout',state:{focused:state?.focused===true,untitled:/^Untitled-[0-9]+$/.test(state?.resource??''),newResource:!!state?.resource&&!before.resources.includes(state.resource),focusedResource:!!state&&focusedResource(state),empty:typeof state?.text==='string'&&state.text.trim()===''}});throw error;}
  await w.send('Input.insertText',{text});await waitFor(async()=>{const s=await this.editorState(w);return s.focused&&s.resource===created.resource&&s.text?.includes(text.trim());},'inserted text rendered in the new Untitled editor');return w;
 }

 async folder(directory,label){const w=await this.workbench();await waitFor(()=>w.evaluate("!!document.querySelector('.quick-input-widget input.input')&&document.querySelector('.quick-input-widget').getBoundingClientRect().height>0"),'simple native folder dialog');await this.input(w,'.quick-input-widget input.input',directory+(directory.endsWith('/')||directory.endsWith('\\')?'':process.platform==='win32'?'\\':'/'));await this.clickText(w,label,'button,.monaco-button');}
 async pathDialog(file,labels){const w=await this.workbench();await waitFor(()=>w.evaluate("!!document.querySelector('.quick-input-widget input.input')&&document.querySelector('.quick-input-widget').getBoundingClientRect().height>0"),'simple native path dialog');await this.input(w,'.quick-input-widget input.input',file);for(const label of labels)if(await this.hasTextButton(w,label)){await this.clickText(w,label);return;}throw Error('No declared native dialog action: '+labels.join('/'));}
 async toasts(){const w=await this.workbench();return w.evaluate("[...document.querySelectorAll('.notification-list-item-message,#monaco-dialog-message-text,#monaco-dialog-message-detail')].map(e=>e.textContent)");}
 async shot(file){const w=await this.workbench();const result=await w.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(file,Buffer.from(result.data,'base64'));}
 close(){for(const target of this.targets.values())target.close();this.targets.clear();}
}
