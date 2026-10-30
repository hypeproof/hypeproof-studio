// Hosted acceptance only. Observes the exact spawned process; never activates an
// app, requests Accessibility permission or changes a system security setting.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('./native-mac-quit.m',import.meta.url));
export function assertMacQuitOwner(actual,expected){
 assert(actual&&Number.isSafeInteger(actual.pid)&&actual.pid>1&&actual.pid===expected.pid,'Owned Mac quit PID changed');
 assert(typeof actual.executable==='string'&&path.posix.isAbsolute(actual.executable)&&actual.executable===expected.executable,'Owned Mac quit executable changed');
 assert(typeof actual.start==='string'&&/^[0-9]+:[0-9]+$/.test(actual.start),'Owned Mac quit start stamp required');
 if(expected.start)assert.equal(actual.start,expected.start,'Owned Mac quit process replaced');
}
function execute(file,args,request,timeout){
 return new Promise((resolve,reject)=>{
  const child=execFile(file,args,{timeout,maxBuffer:32768},(error,stdout,stderr)=>{
   if(error){const code=String(stderr).trim();return reject(new Error(/^owned_[a-z_]+$/.test(code)?code:'owned_mac_observer_failed'));}
   if(request===undefined)return resolve();
   try{resolve(JSON.parse(stdout));}catch{reject(new Error('owned_mac_receipt_invalid'));}
  });
  child.stdin.on('error',()=>{});child.stdin.end(request===undefined?'':JSON.stringify(request));
 });
}
// A fresh run-owned binary, compiled from this tracked source. No download/cache.
export async function createMacQuitPort(){
 assert.equal(process.platform,'darwin','Mac native observer requires macOS');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hps-owned-quit-'));
 await fs.chmod(directory,0o700);const binary=path.join(directory,'observe-quit');
 try{await execute('xcrun',['clang','-fobjc-arc','-Wall','-Wextra','-Werror','-Wno-unused-parameter','-framework','Foundation','-framework','ApplicationServices',source,'-o',binary],undefined,60000);}
 catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
 return {port:(request,timeout=15000)=>execute(binary,[],request,timeout),close:()=>fs.rm(directory,{recursive:true,force:true})};
}
export async function captureMacQuitOwner({child,executable,platform=process.platform,env=process.env,port}){
 assert(platform==='darwin'&&env.GITHUB_ACTIONS==='true'&&env.RUNNER_TEMP,'Native quit confirmation requires an owned Mac hosted run');
 assert(child&&Number.isSafeInteger(child.pid)&&child.pid>1&&child.exitCode===null&&child.signalCode===null,'Live owned child required');
 const expected={pid:child.pid,executable},owner=await port({mode:'capture',owner:expected},5000);
 assertMacQuitOwner(owner,expected);assert.equal(typeof owner.accessibilityTrusted,'boolean','Mac AX permission observation required');
 assert(child.exitCode===null&&child.signalCode===null,'Owned child exited before quit');return owner;
}
export async function confirmMacStreamingQuit({owner,current,port,onProgress=()=>{}}){
 assert(owner.accessibilityTrusted===true,'owned_ax_permission_unavailable');
 assert(typeof current==='function'&&current(),'Live owned child required for Mac quit');
 // One bounded native call re-observes exact process/window/content before AXPress.
 // A lost response is unknown: never re-invoke or retry the quit gesture.
 const receipt=await port({mode:'confirm',owner},15000);
 assert(receipt?.invoked===true&&receipt.owner_pid===owner.pid&&receipt.choice==='끝내기'&&receipt.native_dialog_observed===true&&Number.isInteger(receipt.samples)&&receipt.samples>0,'Owned Mac quit invocation unconfirmed');
 onProgress({phase:'native_quit_dialog_confirmed',action:'끝내기',invoked_once:true,owner_pid:owner.pid,samples:receipt.samples});
 return {...receipt,exact_owned_dialog:true,invoked_once:true};
}
// ONLY finally cleanup after normal-quit acceptance already failed. This cannot
// supply restart evidence. PID, executable and start are re-read before signal.
export async function forceStopMacOwnedChild({child,owner,current,port}){
 assert(child&&child.pid===owner.pid&&current()&&child.exitCode===null&&child.signalCode===null,'Live exact owned child required for cleanup');
 const actual=await port({mode:'identity',owner},5000);assertMacQuitOwner(actual,owner);
 assert(current()&&child.exitCode===null&&child.signalCode===null,'Owned cleanup child changed');
 return child.kill('SIGKILL')===true;
}
