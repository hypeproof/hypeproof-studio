// Read-only, temporary synthetic diagnostics. Never focus, send messages or read content.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const prefix='[hps-native-focus]';
const phases=new Set(['command_enter','restore_ready','command_complete','command_failed','editor_absent','editor_revealed','message_send','message_delivery','message_rejected','message_threw']);
export function parseFocusDiagnostic(line){
 const start=line.indexOf(prefix);if(start<0)return null;
 try{const value=JSON.parse(line.slice(start+prefix.length));if(!phases.has(value?.phase))return null;return{phase:value.phase,...(typeof value.scope_present==='boolean'?{scope_present:value.scope_present}:{}),...(typeof value.delivered==='boolean'?{delivered:value.delivered}:{})};}catch{return null;}
}
export function ownedFocusLogs(userData){
 const root=path.join(userData,'logs'),records=[];let files=0,visited=0,capped=false,unavailable=false;
 function visit(directory,depth=0){if(depth>8||visited++>=300){capped=true;return;}for(const name of fs.readdirSync(directory).sort()){if(records.length>=256){capped=true;return;}const file=path.join(directory,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())continue;if(stat.isDirectory())visit(file,depth+1);else if(stat.isFile()&&/HypeProof Coach.*\.log$/i.test(name)){if(files++>=32||stat.size>2*1024*1024){capped=true;continue;}for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const row=parseFocusDiagnostic(line);if(row&&records.length<256)records.push(row);else if(row)capped=true;}}}}
 try{if(fs.lstatSync(root).isDirectory()&&!fs.lstatSync(root).isSymbolicLink())visit(root);else unavailable=true;}catch{unavailable=true;}
 return{records,capped,unavailable};
}
// selectOwnedBinding already validates production Service/activity/root identity.
// Observe that exact snapshot's composite id, rather than recomputing a policy key.
export function observedBindingScope(binding){
 try{
  const stat=fs.lstatSync(binding.file);if(!stat.isFile()||stat.isSymbolicLink())throw Error();
  const bytes=fs.readFileSync(binding.file);if(createHash('sha256').update(bytes).digest('hex')!==binding.sha256)throw Error();
  const record=JSON.parse(bytes);if(record.version!==1||!/^[a-f0-9]{64}$/.test(record.id??''))throw Error();return record.id;
 }catch{throw Error('Observed activity binding scope unavailable');}
}
export async function beginFocusObservation(target,expectedScope){
 if(typeof expectedScope!=='string'||!expectedScope||expectedScope.length>256)return{finish:async()=>({status:'UNAVAILABLE',records:[],listeners_removed:false})};
 try{await target.evaluate(`(()=>{
  if(window.__hpsNativeFocusObservation)throw Error('Observer already exists');
  const expected=${JSON.stringify(expectedScope)},records=[];let capped=false;
  const record=(phase,flags={})=>{if(records.length>=64){capped=true;return;}const e=document.querySelector('.hps-input textarea');records.push({phase,document_focused:document.hasFocus(),textarea_focused:!!e&&document.activeElement===e,input_present:!!e,input_connected:!!e?.isConnected,input_disabled:!!e?.disabled,...flags});};
  const message=event=>{const m=event.data;if(m?.type==='focusInput')record('focus_input_received',{scope_present:typeof m.activityId==='string'&&!!m.activityId,scope_matches:m.activityId===expected});else if(m?.type==='config')record('config_received',{scope_present:typeof m.config?.activity?.id==='string'&&!!m.config.activity.id,scope_matches:m.config?.activity?.id===expected});};
  const focus=event=>{if(event.target===document.querySelector('.hps-input textarea')||event.target===document.body)record(event.type==='focusin'?'focus_in':'focus_out');};
  const gained=()=>record('document_focus'),lost=()=>record('document_blur');
  window.addEventListener('message',message);document.addEventListener('focusin',focus,true);document.addEventListener('focusout',focus,true);window.addEventListener('focus',gained);window.addEventListener('blur',lost);
  window.__hpsNativeFocusObservation={finish(){window.removeEventListener('message',message);document.removeEventListener('focusin',focus,true);document.removeEventListener('focusout',focus,true);window.removeEventListener('focus',gained);window.removeEventListener('blur',lost);record('observer_finished');delete window.__hpsNativeFocusObservation;return{status:'OBSERVED',records,capped,listeners_removed:true};}};record('observer_started');return true;
 })()`);}catch{return{finish:async()=>({status:'UNAVAILABLE',records:[],listeners_removed:false})};}
 let finished;return{finish(){return finished??=(async()=>{try{return await target.evaluate('window.__hpsNativeFocusObservation.finish()');}catch{return{status:'TARGET_UNAVAILABLE',records:[],listeners_removed:false};}})();}};
}
