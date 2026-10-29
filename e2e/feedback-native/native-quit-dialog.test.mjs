import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NativeUI} from './native-ui.mjs';
import {captureWindowsQuitOwner,confirmWindowsStreamingQuit,selectQuitDialog} from './native-quit-dialog.mjs';
const owner={pid:4328,start:'639288355200000000',executable:'D:\\owned\\HypeProof Studio.exe'};
const snapshot=()=>({owner:{...owner},dialogs:[{handle:'1024',ownerHandle:'2048',pid:4328,ownerPid:4328,className:'#32770',visible:true,texts:['Studio를 끝낼까요?','지금 하고 있는 대답이 멈춰요.\r\n만든 파일은 그대로 남아요.'],buttons:['계속하기','끝내기'].map(name=>({name,pid:4328,enabled:true,visible:true,invokable:true}))}]});
test('streaming native quit requires exact process identity, owning window, message and two actionable choices',()=>{
 assert.deepEqual(selectQuitDialog(snapshot(),owner),{handle:'1024',ownerHandle:'2048'});
 for(const mutate of [s=>s.owner.pid++,s=>s.owner.start+='1',s=>s.owner.executable='D:\\peer\\HypeProof Studio.exe',s=>s.dialogs[0].ownerPid++,s=>s.dialogs[0].pid++,s=>s.dialogs[0].ownerHandle='0',s=>s.dialogs[0].visible=false,s=>s.dialogs.push({...s.dialogs[0]}),s=>s.dialogs[0].texts[0]='다른 작업을 끝낼까요?',s=>s.dialogs[0].texts[1]='보내지 않은 메시지가 있어요.',s=>s.dialogs[0].buttons[0].name='끝내기',s=>s.dialogs[0].buttons[1].enabled=false,s=>s.dialogs[0].buttons[1].invokable=false,s=>s.dialogs[0].buttons[1].pid++]){
  const changed=snapshot();mutate(changed);assert.throws(()=>selectQuitDialog(changed,owner));
 }
});
test('unknown native text is refused without echoing arbitrary dialog contents',()=>{
 const s=snapshot();s.dialogs[0].texts[0]='private-native-dialog-text';
 assert.throws(()=>selectQuitDialog(s,owner),error=>!String(error).includes('private-native-dialog-text')&&error.message.includes('Unknown native quit'));
});
test('capture requires live exact owned Windows hosted child before any input',async()=>{
 const options={child:{pid:owner.pid,exitCode:null,signalCode:null},executable:owner.executable,platform:'win32',env:{GITHUB_ACTIONS:'true',RUNNER_TEMP:'D:\\owned'},port:async()=>({...owner})};
 assert.deepEqual(await captureWindowsQuitOwner(options),owner);
 for(const patch of [{platform:'darwin'},{env:{}},{child:{pid:owner.pid,exitCode:0,signalCode:null}},{port:async()=>({...owner,start:'bad'})},{port:async()=>({...owner,executable:'D:\\peer.exe'})}])await assert.rejects(captureWindowsQuitOwner({...options,...patch}));
});
test('actual quit method invokes explicit platform confirmation after the real public quit gesture',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];
 const target={send:async()=>events.push('key')};ui.workbench=async()=>target;ui.focusWorkbench=async()=>events.push('focus');ui.clickText=async()=>events.push('click');
 await ui.quitOwned('win32',async()=>events.push('confirm'));assert.deepEqual(events,['focus','click','click','confirm']);
 events.length=0;await ui.quitOwned('darwin',async()=>events.push('mac-confirm'));assert.deepEqual(events,['focus','key','key','mac-confirm']);
});
test('bounded delayed observation confirms once, with final receipt and no implicit extra quit gesture',async()=>{
 let time=0,reads=0;const calls=[],progress=[];
 const receipt=await confirmWindowsStreamingQuit({owner,current:()=>true,now:()=>time,sleep:async ms=>{time+=ms;},onProgress:value=>progress.push(value),port:async request=>{
  calls.push(request);if(request.mode==='invoke')return {invoked:true,handle:request.selection.handle};
  const s=snapshot();if(++reads<3)s.dialogs=[];return s;
 }});
 assert.equal(receipt.samples,3);assert.equal(calls.filter(c=>c.mode==='invoke').length,1);assert.equal(progress.at(-1).invoked_once,true);
});
test('missing or unknown UI fails bounded without invocation; process change also prevents input',async()=>{
 for(const kind of ['missing','unknown','changed']){
  let time=0,reads=0,invoked=0;
  await assert.rejects(confirmWindowsStreamingQuit({owner,current:()=>kind!=='changed'||reads===0,now:()=>time,sleep:async ms=>{time+=ms;},port:async request=>{
   if(request.mode==='invoke')invoked++;reads++;const s=snapshot();if(kind==='missing')s.dialogs=[];if(kind==='unknown')s.dialogs[0].texts[0]='unknown';return s;
  }}));
  assert.equal(invoked,0);assert(time<=10000);if(kind==='missing')assert.equal(time,10000);
 }
});
test('identity/dialog revalidation failure and lost invocation receipt are unknown and never retried',async()=>{
 for(const fail of [async()=>{throw Error('OS final owner fence refused');},async()=>{throw Error('receipt lost after invocation');},async()=>({invoked:false})]){
  let attempts=0;
  await assert.rejects(confirmWindowsStreamingQuit({owner,current:()=>true,port:async request=>request.mode==='observe'?snapshot():(attempts++,fail())}));
  assert.equal(attempts,1);
 }
});
test('Windows OS port retains UTF8 Korean contract, native ownership and final single Invoke guard',()=>{
 const bytes=readFileSync(new URL('./native-quit-dialog.ps1',import.meta.url)),source=bytes.toString('utf8');
 assert.equal(bytes.subarray(0,3).toString('hex'),'efbbbf','Windows PowerShell5 requires UTF8 BOM for Korean script literals');
 assert(source.includes('Studio를 끝낼까요?'));assert(source.includes('Read-Owner # final PID/start/executable fence'));
 assert(source.includes('GetWindow($handle,4)'));assert(source.includes('TreeScope]::Children,$condition'));
 assert.equal((source.match(/\$invoke\.Invoke\(\)/g)||[]).length,1);
 assert(!/SendKeys|Stop-Process|Set-ExecutionPolicy|SetForegroundWindow/.test(source));
});
