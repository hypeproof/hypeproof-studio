// Diagnostic listeners only: same retained document, no values, selection or input.
import {randomUUID} from 'node:crypto';
export async function beginRetainedFocusObservation(ui,target){
 const identity={workbench:ui.workbenchId,target:target?.info?.id,frame:target?.ownedFrameId,loader:target?.ownedLoaderId,context:target?.contextId};
 const key='__hpsRetainedFocus_'+randomUUID().replaceAll('-','');let stopped=false;
 const unavailable=phase=>({phase,status:'UNAVAILABLE',identity});
 const read=async expression=>{
  if(!identity.workbench||!identity.target||!identity.frame||!identity.loader||!Number.isInteger(identity.context)||ui.workbenchId!==identity.workbench)throw Error('identity');
  const signal=AbortSignal.timeout(750),observation={signal,check:()=>{if(signal.aborted)throw Error('observation deadline');}};
  if(target.ownedWorkbenchId!==identity.workbench)throw Error('owner');
  const tree=await target.send('Page.getFrameTree',{},observation),pending=[tree.frameTree];let found=false,seen=0;
  while(pending.length){const node=pending.shift();if(!node||++seen>64)throw Error('frame tree');if(node.frame?.id===identity.frame&&node.frame?.loaderId===identity.loader)found=true;pending.push(...(node.childFrames??[]));}
  if(!found)throw Error('document changed');
  // Runtime.evaluate targets the captured context explicitly, not target?.contextId
  // which another normal discovery can update. A reload cannot adopt this observer.
  const result=await target.send('Runtime.evaluate',{expression,contextId:identity.context,returnByValue:true,awaitPromise:false},observation);
  if(result.exceptionDetails)throw Error('unavailable');return result.result?.value;
 };
 try{
  await read(`(()=>{const key=${JSON.stringify(key)};if(window[key])throw Error('duplicate');
   const records=[],started=Date.now(),capturedInput=document.querySelector('.hps-input textarea');let capped=false;
   const kind=node=>{const current=document.querySelector('.hps-input textarea');return current&&node===current?'textarea':node&&node===capturedInput?'captured_textarea':node===document.body?'body':node===document.documentElement?'root':node?'other':'none';};
   const root=node=>!node||node===document.body||node===document.documentElement;
   const snapshot=phase=>{const input=document.querySelector('.hps-input textarea'),active=document.activeElement,rect=input?.getBoundingClientRect(),style=input?getComputedStyle(input):null;
    return {phase,elapsed_ms:Math.max(0,Date.now()-started),observed_at_ms:Date.now(),document_focused:document.hasFocus(),textarea_focused:!!input&&active===input,active_kind:kind(active),input_present:!!input,input_connected:!!input?.isConnected,input_disabled:!!input?.disabled,input_readonly:!!input?.readOnly,input_visible:!!rect&&rect.width>0&&rect.height>0,input_style_visible:!!style&&style.display!=='none'&&style.visibility==='visible',captured_input_connected:!!capturedInput?.isConnected,current_input_is_captured:!!input&&input===capturedInput,modal_visible:[...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].some(e=>e.getClientRects().length>0),document_visible:document.visibilityState==='visible'};};
   const record=(phase,event,owner_revocation_signal='none')=>{if(records.length<64)records.push({...snapshot(phase),...(event?{event_target_kind:kind(event.target),related_target_kind:kind(event.relatedTarget)}:{}),owner_revocation_signal});else capped=true;};
   const focusIn=e=>record('focus_in',e,!root(e.target)&&e.target!==capturedInput?'other_focus':'none'),focusOut=e=>record('focus_out',e,e.target===capturedInput&&e.relatedTarget&&!root(e.relatedTarget)?'focus_to_other':'none'),gained=()=>record('window_focus'),lost=()=>record('window_blur'),visibility=()=>record('visibility');
   const pointer=e=>record('pointer_down',e,e.target!==capturedInput?'pointer_other':'none'),keyDown=e=>{if(e.key==='Tab'||e.key==='Escape')record('guard_key',e,e.key==='Tab'?'tab':'escape');};
   document.addEventListener('focusin',focusIn,true);document.addEventListener('focusout',focusOut,true);window.addEventListener('focus',gained);window.addEventListener('blur',lost);document.addEventListener('visibilitychange',visibility);document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',keyDown,true);
   window[key]={read(phase){return {state:snapshot(phase),events:[...records],capped,guard_eligibility:'NOT_OBSERVED; signals are DOM events, not internal owner/epoch state'};},stop(){document.removeEventListener('focusin',focusIn,true);document.removeEventListener('focusout',focusOut,true);window.removeEventListener('focus',gained);window.removeEventListener('blur',lost);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',keyDown,true);delete window[key];return {listeners_removed:true};}};record('observer_started');return true;})()`);
 }catch{return{snapshot:async phase=>unavailable(phase),async finish(){try{const result=await read(`window[${JSON.stringify(key)}]?.stop()??{listeners_removed:false}`);return{status:'UNAVAILABLE',identity,...result};}catch{return{status:'UNAVAILABLE',listeners_removed:false,identity};}}};}
 let host,hostIdentity,hostInstalled=false;const hostKey=key+'_host';
 const readHost=async expression=>{
  if(!hostIdentity||!Number.isInteger(hostIdentity.context)||ui.workbenchId!==identity.workbench||host.info?.id!==identity.workbench)throw Error('host owner');
  const signal=AbortSignal.timeout(750),observation={signal,check:()=>{if(signal.aborted)throw Error('observation deadline');}};
  const tree=await host.send('Page.getFrameTree',{},observation),frame=tree.frameTree?.frame;
  if(frame?.id!==hostIdentity.frame||frame.loaderId!==hostIdentity.loader)throw Error('host document changed');
  const result=await host.send('Runtime.evaluate',{expression,contextId:hostIdentity.context,returnByValue:true,awaitPromise:false},observation);if(result.exceptionDetails)throw Error('host unavailable');return result.result?.value;
 };
 try{
  host=ui.targets?.get(identity.workbench);const name=new URL(target.info.url).searchParams.get('id');if(!host||host.info?.id!==identity.workbench||!name)throw Error('host unavailable');
  const signal=AbortSignal.timeout(750),observation={signal,check:()=>{if(signal.aborted)throw Error('observation deadline');}};
  const tree=await host.send('Page.getFrameTree',{},observation),frame=tree.frameTree?.frame;if(!frame?.id||!frame.loaderId)throw Error('host identity');hostIdentity={target:identity.workbench,frame:frame.id,loader:frame.loaderId};const world=await host.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'feedback-native-retained-focus-host'},observation);if(!Number.isInteger(world.executionContextId))throw Error('host context');hostIdentity.context=world.executionContextId;
  await readHost(`(()=>{const key=${JSON.stringify(hostKey)},name=${JSON.stringify(name)};if(window[key])throw Error('duplicate');const records=[],started=Date.now();let capped=false;
   const owned=()=>[...document.querySelectorAll('iframe')].filter(e=>e.name===name),visible=e=>{const r=e?.getBoundingClientRect(),s=e?getComputedStyle(e):null;return !!r&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible';};
   const kind=e=>e&&owned().length===1&&e===owned()[0]?'owned_iframe':e?.closest?.('.quick-input-widget')?'quick_input':e===document.body?'body':e===document.documentElement?'root':e?'other':'none';
   const snapshot=phase=>({phase,elapsed_ms:Math.max(0,Date.now()-started),observed_at_ms:Date.now(),document_focused:document.hasFocus(),document_visible:document.visibilityState==='visible',active_kind:kind(document.activeElement),owned_iframe_unique:owned().length===1,owned_iframe_visible:owned().length===1&&visible(owned()[0]),quick_input_visible:visible(document.querySelector('.quick-input-widget'))});
   const record=(phase,e)=>{if(records.length<64)records.push({...snapshot(phase),...(e?{event_target_kind:kind(e.target),related_target_kind:kind(e.relatedTarget)}:{})});else capped=true;};
   const gained=()=>record('window_focus'),lost=()=>record('window_blur'),focusIn=e=>record('focus_in',e),focusOut=e=>record('focus_out',e),visibility=()=>record('visibility');
   window.addEventListener('focus',gained);window.addEventListener('blur',lost);document.addEventListener('focusin',focusIn,true);document.addEventListener('focusout',focusOut,true);document.addEventListener('visibilitychange',visibility);
   window[key]={read(phase){return{state:snapshot(phase),events:[...records],capped};},stop(){window.removeEventListener('focus',gained);window.removeEventListener('blur',lost);document.removeEventListener('focusin',focusIn,true);document.removeEventListener('focusout',focusOut,true);document.removeEventListener('visibilitychange',visibility);delete window[key];return{listeners_removed:true};}};record('observer_started');return true;})()`);hostInstalled=true;
 }catch{} // Optional host diagnostics cannot change inner observation or admission.
 const hostSnapshot=async phase=>{if(!hostInstalled)return{status:'UNAVAILABLE'};try{return{status:'OBSERVED',identity:hostIdentity,...await readHost(`window[${JSON.stringify(hostKey)}].read(${JSON.stringify(phase)})`) };}catch{return{status:'UNAVAILABLE',identity:hostIdentity};}};
 const hostFinish=async()=>{if(!hostIdentity)return{status:'UNAVAILABLE',listeners_removed:false};try{return{status:'OBSERVED',identity:hostIdentity,...await readHost(`window[${JSON.stringify(hostKey)}]?.stop()??{listeners_removed:false}`)};}catch{return{status:'TARGET_UNAVAILABLE',identity:hostIdentity,listeners_removed:false};}};
 return {
  async snapshot(phase){if(!['before_secondary','before_switch','after_switch','switch_refused'].includes(phase)||stopped)return unavailable('invalid_phase');const [inner,hostState]=await Promise.allSettled([read(`window[${JSON.stringify(key)}].read(${JSON.stringify(phase)})`),hostSnapshot(phase)]);return inner.status==='fulfilled'?{phase,status:'OBSERVED',identity,...inner.value,host:hostState.status==='fulfilled'?hostState.value:{status:'UNAVAILABLE'}}:{...unavailable(phase),host:hostState.status==='fulfilled'?hostState.value:{status:'UNAVAILABLE'}};},
  async finish(){if(stopped)return{status:'ALREADY_STOPPED',identity};stopped=true;const [inner,hostCleanup]=await Promise.allSettled([read(`window[${JSON.stringify(key)}].stop()`),hostFinish()]);return{...(inner.status==='fulfilled'?{status:'OBSERVED',identity,...inner.value}:{status:'TARGET_UNAVAILABLE',listeners_removed:false,identity}),host_cleanup:hostCleanup.status==='fulfilled'?hostCleanup.value:{status:'UNAVAILABLE',listeners_removed:false}};}
 };
}
