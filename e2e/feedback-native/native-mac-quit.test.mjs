import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createMacQuitPort,captureMacQuitOwner,confirmMacStreamingQuit,forceStopMacOwnedChild} from './native-mac-quit.mjs';
import {NativeUI} from './native-ui.mjs';
import {stopOwnedCandidate} from './safety.mjs';
const owner={pid:9244,start:'1793238420:123456',executable:'/owned/HypeProof Studio.app/Contents/MacOS/HypeProof Studio',accessibilityTrusted:true};
const child=()=>({pid:owner.pid,exitCode:null,signalCode:null,kill(){throw Error('unexpected signal');}});
test('Mac capture requires a live hosted owned child and exact start/executable, without requesting permission',async()=>{
 const options={child:child(),executable:owner.executable,platform:'darwin',env:{GITHUB_ACTIONS:'true',RUNNER_TEMP:'/owned'},port:async()=>({...owner})};
 assert.deepEqual(await captureMacQuitOwner(options),owner);
 for(const patch of[{platform:'win32'},{env:{}},{child:{...child(),exitCode:0}},{port:async()=>({...owner,pid:1})},{port:async()=>({...owner,executable:'/peer/Studio'})},{port:async()=>({...owner,start:'invalid'})}])await assert.rejects(captureMacQuitOwner({...options,...patch}));
 const untrusted=await captureMacQuitOwner({...options,port:async()=>({...owner,accessibilityTrusted:false})});assert.equal(untrusted.accessibilityTrusted,false,'Capture retains identity for cleanup but never grants AX');
});
test('Mac quit invokes explicit confirmation once after CmdQ; no callback leaves ordinary quit unchanged',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];
 ui.workbench=async()=>({send:async(method,args)=>events.push(args.type)});ui.focusWorkbench=async()=>{};
 await ui.quitOwned('darwin',async()=>events.push('confirm'));assert.deepEqual(events,['rawKeyDown','keyUp','confirm']);
 events.length=0;await ui.quitOwned('darwin');assert.deepEqual(events,['rawKeyDown','keyUp']);
});
test('native confirmation fails before input without AX permission/current owner and never retries unknown invocation',async()=>{
 let calls=0;const port=async()=>{calls++;throw Error('receipt lost');};
 await assert.rejects(confirmMacStreamingQuit({owner:{...owner,accessibilityTrusted:false},current:()=>true,port}),/permission_unavailable/);
 await assert.rejects(confirmMacStreamingQuit({owner,current:()=>false,port}));assert.equal(calls,0);
 await assert.rejects(confirmMacStreamingQuit({owner,current:()=>true,port}),/receipt lost/);assert.equal(calls,1);
 for(const receipt of [{invoked:false},{invoked:true,owner_pid:owner.pid+1,choice:'끝내기',native_dialog_observed:true,samples:1}])await assert.rejects(confirmMacStreamingQuit({owner,current:()=>true,port:async()=>receipt}));
 const receipt=await confirmMacStreamingQuit({owner,current:()=>true,port:async()=>({invoked:true,owner_pid:owner.pid,choice:'끝내기',native_dialog_observed:true,samples:3})});assert.equal(receipt.invoked_once,true);
});
test('cleanup escalation requires original child and fresh exact identity; never signals replaced process or retries',async()=>{
 for(const kind of ['valid','start','path','pid','stale','closed','error']){
  const owned=child(),signals=[];owned.kill=signal=>(signals.push(signal),true);let current=true;
  const run=()=>forceStopMacOwnedChild({child:owned,owner,current:()=>current,port:async()=>{
   if(kind==='stale')current=false;if(kind==='closed')owned.signalCode='SIGTERM';if(kind==='error')throw Error('probe failed');
   return {...owner,...(kind==='start'?{start:'1793238421:1'}:kind==='path'?{executable:'/peer/Studio'}:kind==='pid'?{pid:owner.pid+1}:{})};
  }});
  if(kind==='valid'){assert.equal(await run(),true);assert.deepEqual(signals,['SIGKILL']);}else{await assert.rejects(run());assert.deepEqual(signals,[]);}
 }
});
test('failed SIGTERM cleanup may escalate once, observes exit/CDP separately and preserves initial timeout',async()=>{
 let attempts=0,forced=0;const owned=child();owned.kill=()=>true;
 const result=await stopOwnedCandidate({config:{},child:owned,waitExit:async()=>{if(++attempts===1)throw Error('original timeout');owned.signalCode='SIGKILL';},forceStop:async exact=>{assert.equal(exact,owned);forced++;return true;},waitCdpDown:async()=>{}});
 assert.equal(result.status,'PASS');assert.equal(result.initial_exit_error,'original timeout');assert.equal(result.escalation_cleanup_only,true);assert.equal(result.signal_code,'SIGKILL');assert.equal(forced,1);
 for(const failure of ['refused','throw','still-live','cdp']){
  const c=child();c.kill=()=>true;let waits=0,forces=0;
  const r=await stopOwnedCandidate({config:{},child:c,waitExit:async()=>{if(++waits===1)throw Error('original timeout');if(failure!=='still-live')c.signalCode='SIGKILL';},forceStop:async()=>{forces++;if(failure==='throw')throw Error('identity changed');return failure!=='refused';},waitCdpDown:async()=>{throw Error('CDP still live');}});
  assert.equal(r.status,'FAIL');assert.equal(r.initial_exit_error,'original timeout');assert.equal(forces,1);assert.equal(r.cdp_down,false);
 }
 let calls=0;const normal=child();normal.kill=()=>true;
 await stopOwnedCandidate({config:{},child:normal,waitExit:async()=>{normal.signalCode='SIGTERM';},waitCdpDown:async()=>{},forceStop:async()=>{calls++;return true;}});assert.equal(calls,0);
 await assert.rejects(stopOwnedCandidate({config:{attach:true},child:child(),forceStop:async()=>{calls++;}}));assert.equal(calls,0);
});
test('compiled Mac contract refuses foreign/hidden/unknown/duplicate choices without AX input',{skip:process.platform!=='darwin'},async()=>{
 const helper=await createMacQuitPort();try{
 const dialog=()=>({pid:owner.pid,ownerPid:owner.pid,kind:'AXSheet',visible:true,texts:['Studio를 끝낼까요?','지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요.'],buttons:['계속하기','끝내기'].map(name=>({name,pid:owner.pid,enabled:true,visible:true,pressable:true}))});
 const check=async d=>{const result=await helper.port({mode:'contract',owner,dialog:d});assert.equal(result.native_input,false);return result.accepted;};
 assert.equal(await check(dialog()),true);const standalone=dialog();standalone.kind='AXDialog';assert.equal(await check(standalone),true);
 for(const change of[d=>d.pid++,d=>d.ownerPid++,d=>d.kind='AXWindow',d=>d.visible=false,d=>d.texts[1]='private unknown detail',d=>d.texts.push('extra'),d=>d.buttons.push({...d.buttons[0]}),d=>d.buttons[0].name='끝내기',d=>d.buttons[1].pid++,d=>d.buttons[1].enabled=false,d=>d.buttons[1].visible=false,d=>d.buttons[1].pressable=false]){const d=dialog();change(d);assert.equal(await check(d),false);}
 }finally{await helper.close();}
});

test('Mac kernel identity fences cleanup of an actual owned Node child that ignores SIGTERM',{skip:process.platform!=='darwin'},async()=>{
 const helper=await createMacQuitPort();
 const owned=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send('ready')"],{stdio:['ignore','ignore','ignore','ipc']});
 const waitExit=()=>new Promise((resolve,reject)=>{const deadline=Date.now()+300;const timer=setInterval(()=>{if(owned.exitCode!==null||owned.signalCode!==null){clearInterval(timer);resolve();}else if(Date.now()>deadline){clearInterval(timer);reject(Error('bounded owned Node exit timeout'));}},10);});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned child readiness timeout')),5000);owned.once('message',value=>{clearTimeout(timer);value==='ready'?resolve():reject(Error('unexpected child readiness'));});owned.once('error',error=>{clearTimeout(timer);reject(error);});});
  const captured=await captureMacQuitOwner({child:owned,executable:fs.realpathSync(process.execPath),platform:'darwin',env:{GITHUB_ACTIONS:'true',RUNNER_TEMP:'/synthetic'},port:helper.port});
  await assert.rejects(forceStopMacOwnedChild({child:owned,owner:{...captured,start:captured.start+'0'},current:()=>true,port:helper.port}),/owned_process_changed/);
  assert.equal(owned.signalCode,null,'Rejected identity probe cannot kill the child');
  const proof=await stopOwnedCandidate({config:{},child:owned,waitExit,waitCdpDown:async()=>{},forceStop:exact=>forceStopMacOwnedChild({child:exact,owner:captured,current:()=>exact===owned,port:helper.port})});
  assert.equal(proof.status,'PASS');assert.equal(proof.signal_code,'SIGKILL');assert.equal(proof.escalation_cleanup_only,true);assert.match(proof.initial_exit_error,/bounded owned Node/);
 }finally{if(owned.exitCode===null&&owned.signalCode===null){owned.kill('SIGKILL');await waitExit();}await helper.close();}
});
