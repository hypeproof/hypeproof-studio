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
export async function confirmWindowsStreamingQuit({owner,current,port=powershell,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),onProgress=()=>{}}){
 assert(typeof current==='function'&&current(),'Live owned child required for quit confirmation');
 const deadline=now()+10000;let samples=0,selection;
 while(now()<deadline){
  assert(current(),'Owned child changed during quit confirmation');
  const remaining=Math.floor(deadline-now());if(remaining<=0)break;
  const snapshot=await port({mode:'observe',owner},Math.min(3000,remaining));samples++;
  selection=selectQuitDialog(snapshot,owner);
  onProgress({phase:'native_quit_dialog_observed',samples,present:!!selection,exact:!!selection});
  if(selection)break;
  await sleep(Math.min(150,Math.max(0,deadline-now())));
 }
 assert(selection,'Expected owned streaming quit dialog was not observed');
 assert(current()&&now()<deadline,'Owned quit confirmation expired');
 // The OS port repeats all process/dialog/content checks immediately before Invoke.
 // No retry after invocation: a lost receipt is unknown, never another click.
 const receipt=await port({mode:'invoke',owner,selection},Math.min(3000,Math.max(1,Math.floor(deadline-now()))));
 assert(receipt?.invoked===true&&receipt.handle===selection.handle,'Owned native quit invocation unconfirmed');
 onProgress({phase:'native_quit_dialog_confirmed',action:'끝내기',invoked_once:true,owner_pid:owner.pid});
 return {native_dialog_observed:true,exact_owned_dialog:true,quit_choice:'끝내기',invoked_once:true,samples};
}
