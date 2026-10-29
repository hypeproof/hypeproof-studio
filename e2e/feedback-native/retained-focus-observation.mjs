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
   const records=[],started=Date.now();let capped=false;
   const snapshot=phase=>{const input=document.querySelector('.hps-input textarea'),active=document.activeElement;const role=active===input?'textarea':active===document.body?'body':active===document.documentElement?'root':active?'other':'none';
    const rect=input?.getBoundingClientRect();return {phase,elapsed_ms:Math.max(0,Date.now()-started),document_focused:document.hasFocus(),textarea_focused:!!input&&active===input,active_kind:role,input_present:!!input,input_connected:!!input?.isConnected,input_disabled:!!input?.disabled,input_visible:!!rect&&rect.width>0&&rect.height>0,document_visible:document.visibilityState==='visible'};};
   const record=phase=>{if(records.length<64)records.push(snapshot(phase));else capped=true;};
   const focusIn=()=>record('focus_in'),focusOut=()=>record('focus_out'),gained=()=>record('window_focus'),lost=()=>record('window_blur'),visibility=()=>record('visibility');
   document.addEventListener('focusin',focusIn,true);document.addEventListener('focusout',focusOut,true);window.addEventListener('focus',gained);window.addEventListener('blur',lost);document.addEventListener('visibilitychange',visibility);
   window[key]={read(phase){return {state:snapshot(phase),events:[...records],capped};},stop(){document.removeEventListener('focusin',focusIn,true);document.removeEventListener('focusout',focusOut,true);window.removeEventListener('focus',gained);window.removeEventListener('blur',lost);document.removeEventListener('visibilitychange',visibility);delete window[key];return {listeners_removed:true};}};record('observer_started');return true;})()`);
 }catch{return{snapshot:async phase=>unavailable(phase),async finish(){try{const result=await read(`window[${JSON.stringify(key)}]?.stop()??{listeners_removed:false}`);return{status:'UNAVAILABLE',identity,...result};}catch{return{status:'UNAVAILABLE',listeners_removed:false,identity};}}};}
 return {
  async snapshot(phase){if(!['before_secondary','before_switch','after_switch','switch_refused'].includes(phase)||stopped)return unavailable('invalid_phase');try{return{phase,status:'OBSERVED',identity,...await read(`window[${JSON.stringify(key)}].read(${JSON.stringify(phase)})`)};}catch{return unavailable(phase);}},
  async finish(){if(stopped)return{status:'ALREADY_STOPPED',identity};stopped=true;try{return{status:'OBSERVED',identity,...await read(`window[${JSON.stringify(key)}].stop()`)};}catch{return{status:'TARGET_UNAVAILABLE',listeners_removed:false,identity};}}
 };
}
