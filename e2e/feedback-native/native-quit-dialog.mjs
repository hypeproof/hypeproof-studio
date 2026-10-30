// Explicit acceptance input for the owned Windows native quit guard only.
// No shell/product command bridge, keyboard defaults, process kill or peer input.
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./native-quit-dialog.ps1',import.meta.url));
const MESSAGE='Studio를 끝낼까요?';
const DETAIL='지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요.';
const BUTTONS=['계속하기','끝내기'];
const normalize=value=>typeof value==='string'?value.replace(/\r\n/g,'\n').trim():'';
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.win32.isAbsolute(a)&&path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase();
export function assertQuitOwner(actual,expected){
 assert(actual&&actual.pid===expected.pid&&Number.isSafeInteger(actual.pid)&&actual.pid>0,'Owned quit PID changed');
 assert(samePath(actual.executable,expected.executable),'Owned quit executable changed');
 assert(typeof actual.start==='string'&&/^[0-9]{12,20}$/.test(actual.start),'Owned quit start stamp required');
 if(expected.start)assert.equal(actual.start,expected.start,'Owned quit process replaced');
}
export function selectQuitDialog(snapshot,owner){
 assertQuitOwner(snapshot?.owner,owner);
 assert(Array.isArray(snapshot.dialogs)&&snapshot.dialogs.length<=8,'Bounded owned dialog observation required');
 if(snapshot.dialogs.length===0)return null;
 assert.equal(snapshot.dialogs.length,1,'Ambiguous owned native dialog');
 const d=snapshot.dialogs[0];
 assert(d.pid===owner.pid&&d.ownerPid===owner.pid&&d.ownerHandle!=='0'&&d.handle!=='0'&&/^[0-9]+$/.test(d.ownerHandle)&&/^[0-9]+$/.test(d.handle),'Native dialog must belong to the exact owned window');
 assert(d.className==='#32770'&&d.visible===true,'Visible native message box required');
 assert(Array.isArray(d.texts)&&d.texts.length<=8,'Bounded native dialog text required');
 assert(JSON.stringify(d.texts.map(normalize).filter(Boolean).sort())===JSON.stringify([MESSAGE,DETAIL].sort()),'Unknown native quit message or detail');
 assert(Array.isArray(d.buttons)&&d.buttons.length===2,'Exactly two native quit choices required');
 assert(JSON.stringify(d.buttons.map(b=>b.name).sort())===JSON.stringify([...BUTTONS].sort()),'Unknown or duplicate native quit choice');
 assert(d.buttons.every(b=>b.pid===owner.pid&&b.enabled===true&&b.visible===true&&b.invokable===true),'Native quit choices must be owned, visible and invokable');
 return {handle:d.handle,ownerHandle:d.ownerHandle};
}
function powershell(request,timeout){
 return new Promise((resolve,reject)=>{
  const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{timeout,maxBuffer:32768,windowsHide:true},(error,stdout)=>{
   if(error)return reject(new Error('Owned native quit observer failed'));
   try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(new Error('Invalid owned native quit observation'));}
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
 });
}
export async function captureWindowsQuitOwner({child,executable,platform=process.platform,env=process.env,port=powershell}){
 assert(platform==='win32'&&env.GITHUB_ACTIONS==='true'&&env.RUNNER_TEMP,'Native quit confirmation requires an owned Windows hosted run');
 assert(child&&Number.isSafeInteger(child.pid)&&child.pid>0&&child.exitCode===null&&child.signalCode===null,'Live owned child required');
 const expected={pid:child.pid,executable};
 const owner=await port({mode:'capture',owner:expected},5000);assertQuitOwner(owner,expected);
 assert(child.exitCode===null&&child.signalCode===null,'Owned child exited before quit');
 return owner;
}

/** Separate typed action observation, never inferred from the diagnostic census. */
export function selectWin32QuitDialog(snapshot,owner){
 assertQuitOwner(snapshot?.owner,owner);
 assert(Array.isArray(snapshot.nativeDialogs)&&snapshot.nativeDialogs.length<=8,'Bounded native button observation required');
 if(!snapshot.nativeDialogs.length)return null;
 assert.equal(snapshot.nativeDialogs.length,1,'Ambiguous native button dialog');
 const d=snapshot.nativeDialogs[0],handle=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v);
 assert(d.pid===owner.pid&&d.ownerPid===owner.pid&&handle(d.handle)&&handle(d.ownerHandle)&&d.handle!==d.ownerHandle,'Native dialog owner required');
 assert(d.className==='#32770'&&d.visible===true&&d.foreground===true,'Foreground owned native message box required');
 assert(d.copy?.message===1&&d.copy.detail===1&&d.copy.other===0,'Exact owned message and detail required');
 assert(Array.isArray(d.buttons)&&d.buttons.length===2,'Exactly two native Buttons required');
 assert(new Set(d.buttons.map(b=>b.handle)).size===2,'Distinct native Buttons required');
 assert.deepEqual(d.buttons.map(b=>b.label).sort(),['continue','quit'],'Exact native choices required');
 for(const b of d.buttons)assert(b.pid===owner.pid&&b.className==='Button'&&handle(b.handle)&&handle(b.parentHandle)&&b.ownedChain===true&&b.visible===true&&b.enabled===true,'Owned live Button ancestry required');
 const b=d.buttons.find(b=>b.label==='quit');
 return{handle:d.handle,ownerHandle:d.ownerHandle,buttonHandle:b.handle,buttonParentHandle:b.parentHandle};
}
export async function confirmWindowsStreamingQuit({owner,current,port=powershell,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{},allowWin32=false}){
 assert(typeof current==='function'&&current(),'Live owned child required for quit confirmation');
 const deadline=now()+10000;let samples=0,selection,route='uia';
 while(now()<deadline){
  assert(current(),'Owned child changed during quit confirmation');
  const remaining=Math.floor(deadline-now());if(remaining<=0)break;
  const snapshot=await port({mode:'observe',owner},Math.min(3000,remaining));samples++;
  selection=selectQuitDialog(snapshot,owner);
  if(!selection&&allowWin32){
   assert(current(),'Owned child changed before native button observation');
   const left=Math.floor(deadline-now());if(left<=0)break;
   selection=selectWin32QuitDialog(await port({mode:'observe_win32',owner},Math.min(3000,left)),owner);
   if(selection)route='win32';
  }
  onProgress({phase:'native_quit_dialog_observed',samples,present:!!selection,exact:!!selection});
  if(selection)break;
  await sleep(Math.min(150,Math.max(0,deadline-now())));
 }
 assert(selection,'Expected owned streaming quit dialog was not observed');
 assert(current()&&now()<deadline,'Owned quit confirmation expired');
 // The OS port repeats all process/dialog/content checks immediately before Invoke.
 // No retry after invocation: a lost receipt is unknown, never another click.
 const remaining=Math.max(1,Math.floor(deadline-now()));
 const receipt=await port({mode:route==='win32'?'invoke_win32':'invoke',owner,selection,
  ...(route==='win32'?{actionTimeoutMs:Math.min(1000,remaining)}:{})},Math.min(3000,remaining));
 if(route==='win32')assert(receipt?.route==='win32'&&receipt.buttonHandle===selection.buttonHandle,'Owned native button invocation unconfirmed');
 assert(receipt?.invoked===true&&receipt.handle===selection.handle,'Owned native quit invocation unconfirmed');
 onProgress({phase:'native_quit_dialog_confirmed',route,action:'끝내기',invoked_once:true,owner_pid:owner.pid});
 return {native_dialog_observed:true,exact_owned_dialog:true,quit_choice:'끝내기',invoked_once:true,samples};
}

// Independent observation, never input eligibility. Unknown classes stay diagnostic.
export function readOwnedQuitCensus(snapshot,owner){
 assertQuitOwner(snapshot?.owner,owner);
 assert(Array.isArray(snapshot.windows)&&snapshot.windows.length<=16,'Bounded owned census required');
 const windows=snapshot.windows.map(w=>{
  assert(w.pid===owner.pid&&/^[1-9][0-9]*$/.test(w.handle),'Owned census window required');
  assert(typeof w.className==='string'&&/^[A-Za-z0-9_#.: -]{1,127}$/.test(w.className)&&typeof w.visible==='boolean','Structural window fields required');
  assert(['none','owned','foreign'].includes(w.ownerRelation)&&/^[0-9]+$/.test(w.ownerHandle)&&(w.ownerRelation==='owned'?w.ownerHandle!=='0':w.ownerHandle==='0'),'Owned parent relation required');
  assert(Array.isArray(w.bounds)&&w.bounds.length===4&&w.bounds.every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=100000),'Bounded window geometry required');
  const u=w.uia;assert(u&&['available','skippedForeign','capped'].every(k=>typeof u[k]==='boolean')&&Number.isInteger(u.ownedNodes)&&u.ownedNodes>=0&&u.ownedNodes<=64&&(u.modal===null||typeof u.modal==='boolean'),'Bounded UIA summary required');
  const roles={};assert(u.roles&&typeof u.roles==='object'&&!Array.isArray(u.roles)&&Object.keys(u.roles).length<=40,'Bounded roles required');
  for(const [role,count] of Object.entries(u.roles)){assert(/^ControlType\.[A-Za-z]+$/.test(role)&&Number.isInteger(count)&&count>=0&&count<=64,'Structural roles only');roles[role]=count;}
  assert(Object.values(roles).reduce((a,b)=>a+b,0)===u.ownedNodes,'Census role counts must match observed nodes');
  const matches={};for(const key of ['message','detail','continue','quit']){const n=u.matches?.[key];assert(Number.isInteger(n)&&n>=0&&n<=u.ownedNodes,'Known-contract counts only');matches[key]=n;}
  assert(Array.isArray(w.nativeChildren)&&w.nativeChildren.length<=64&&Number.isInteger(w.foreignChildCount)&&w.foreignChildCount>=0&&w.foreignChildCount<=64&&w.nativeChildren.length+w.foreignChildCount<=64,'Bounded native child census required');
  if(w.className!=='#32770'||!w.visible||w.ownerRelation!=='owned')assert(w.nativeChildren.length===0&&w.foreignChildCount===0,'Native child census limited to owned visible dialog');
  const nativeChildren=w.nativeChildren.map(child=>{
   assert(child.pid===owner.pid&&/^[1-9][0-9]*$/.test(child.handle),'Owned native child required');
   assert(typeof child.className==='string'&&/^[A-Za-z0-9_#.: -]{1,127}$/.test(child.className)&&Number.isSafeInteger(child.controlId)&&child.controlId>=-2147483648&&child.controlId<=2147483647,'Native child structure required');
   assert(typeof child.visible==='boolean'&&typeof child.enabled==='boolean'&&typeof child.labelPresent==='boolean'&&['continue','quit','other'].includes(child.knownLabel),'Known native child fields required');
   assert(child.labelPresent||child.knownLabel==='other','Missing label cannot be classified');
   const q=child.uia;assert(q&&typeof q.available==='boolean'&&['owned','zero','foreign','unknown'].includes(q.pidRelation)&&typeof q.button==='boolean'&&typeof q.invokePattern==='boolean','Native child UIA structure required');
   assert(q.available ? q.pidRelation!=='unknown' : q.pidRelation==='unknown','Child UIA availability mismatch');
   if(q.pidRelation!=='owned')assert(!q.button&&!q.invokePattern,'Foreign UIA details must not be inspected');
   return {handle:child.handle,className:child.className,controlId:child.controlId,visible:child.visible,enabled:child.enabled,labelPresent:child.labelPresent,knownLabel:child.knownLabel,uia:{available:q.available,pidRelation:q.pidRelation,button:q.button,invokePattern:q.invokePattern}};
  });
  assert(new Set(nativeChildren.map(c=>c.handle)).size===nativeChildren.length,'Duplicate native child');
  return {handle:w.handle,className:w.className,visible:w.visible,ownerRelation:w.ownerRelation,ownerHandle:w.ownerHandle,bounds:[...w.bounds],uia:{available:u.available,ownedNodes:u.ownedNodes,skippedForeign:u.skippedForeign,capped:u.capped,modal:u.modal,roles,matches},nativeChildren,foreignChildCount:w.foreignChildCount};
 });
 assert(new Set(windows.map(w=>w.handle)).size===windows.length,'Duplicate census window');
 return {status:'OBSERVED',owner_pid:owner.pid,windows};
}
export async function observeWindowsQuitStructure({owner,current,port=powershell}){
 try{assert(current(),'owner');const snapshot=await port({mode:'census',owner},3000);assert(current(),'owner');return readOwnedQuitCensus(snapshot,owner);}
 catch{return{status:'UNAVAILABLE',owner_pid:owner.pid,code:'owned_structure_observation_unavailable'};}
}
