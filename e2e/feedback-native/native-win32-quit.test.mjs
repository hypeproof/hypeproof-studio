import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{selectWin32QuitDialog,confirmWindowsStreamingQuit}from'./native-quit-dialog.mjs';
const owner={pid:6664,start:'639288355200000000',executable:'D:\\owned\\HypeProof Studio.exe'};
const sample=()=>({owner:{...owner},nativeDialogs:[{handle:'1442154',ownerHandle:'786828',pid:6664,ownerPid:6664,className:'#32770',visible:true,foreground:true,copy:{message:1,detail:1,other:0},buttons:[{handle:'131598',parentHandle:'131596',pid:6664,className:'Button',ownedChain:true,label:'continue',visible:true,enabled:true},{handle:'131600',parentHandle:'131614',pid:6664,className:'Button',ownedChain:true,label:'quit',visible:true,enabled:true}]}]});
test('exact owned Win32 choices select only quit; every scope/content/structure mismatch refuses',()=>{
 assert.deepEqual(selectWin32QuitDialog(sample(),owner),{handle:'1442154',ownerHandle:'786828',buttonHandle:'131600',buttonParentHandle:'131614'});
 const changes=[s=>s.owner.pid++,s=>s.owner.start+='1',s=>s.owner.executable='D:\\peer.exe',s=>s.nativeDialogs.push(structuredClone(s.nativeDialogs[0])),s=>s.nativeDialogs[0].ownerPid++,s=>s.nativeDialogs[0].foreground=false,s=>s.nativeDialogs[0].visible=false,s=>s.nativeDialogs[0].className='Chrome_WidgetWin_1',s=>s.nativeDialogs[0].copy.other++,s=>s.nativeDialogs[0].copy.message=0,s=>s.nativeDialogs[0].copy.detail=2,s=>s.nativeDialogs[0].buttons.pop(),s=>s.nativeDialogs[0].buttons[1].label='continue',s=>s.nativeDialogs[0].buttons[1].handle='131598',s=>s.nativeDialogs[0].buttons[1].ownedChain=false,s=>s.nativeDialogs[0].buttons[1].pid++,s=>s.nativeDialogs[0].buttons[1].className='Pane',s=>s.nativeDialogs[0].buttons[1].enabled=false,s=>s.nativeDialogs[0].buttons[1].visible=false,s=>s.nativeDialogs[0].buttons[1].parentHandle='0'];
 for(const change of changes){const s=sample();change(s);assert.throws(()=>selectWin32QuitDialog(s,owner));}
 assert.equal(selectWin32QuitDialog({owner,nativeDialogs:[]},owner),null);
});
test('original empty UIA discovery permits explicit Win32 route once, same deadline and typed receipt',async()=>{
 let time=0;const calls=[];
 const result=await confirmWindowsStreamingQuit({owner,allowWin32:true,current:()=>true,now:()=>time,sleep:async ms=>{time+=ms;},port:async(request,timeout)=>{calls.push(request);assert(timeout>0&&timeout<=3000);time+=10;if(request.mode==='observe')return{owner,dialogs:[]};if(request.mode==='observe_win32')return sample();assert.equal(request.mode,'invoke_win32');assert.equal(request.actionTimeoutMs,1000);assert.deepEqual(request.selection,selectWin32QuitDialog(sample(),owner));return{route:'win32',invoked:true,handle:request.selection.handle,buttonHandle:request.selection.buttonHandle};}});
 assert.equal(result.invoked_once,true);assert.deepEqual(calls.map(c=>c.mode),['observe','observe_win32','invoke_win32']);
});
test('uncertain action, stale owner, bad reply or unknown UIA never retries or changes action route',async()=>{
 for(const scenario of ['action-timeout','bad-receipt','stale','unknown-uia','observation-error']){
  const calls=[];let live=true;
  await assert.rejects(()=>confirmWindowsStreamingQuit({owner,allowWin32:true,current:()=>live,port:async r=>{calls.push(r.mode);if(r.mode==='observe'){if(scenario==='unknown-uia')return{owner,dialogs:[{}]};return{owner,dialogs:[]};}if(r.mode==='observe_win32'){if(scenario==='observation-error')throw Error('unavailable');if(scenario==='stale')live=false;return sample();}if(scenario==='action-timeout')throw Error('unknown after dispatch');return{route:'win32',invoked:true,handle:r.selection.handle,buttonHandle:'changed'};}}));
  assert(calls.filter(c=>c==='invoke_win32').length<=1);assert(!calls.includes('invoke'));if(scenario==='unknown-uia')assert.deepEqual(calls,['observe']);if(scenario==='stale'||scenario==='observation-error')assert(!calls.includes('invoke_win32'));
 }
});
test('missing native dialog remains bounded; no activation, button or alternate route is attempted',async()=>{
 let time=0;const modes=[];await assert.rejects(()=>confirmWindowsStreamingQuit({owner,allowWin32:true,current:()=>true,now:()=>time,sleep:async ms=>{time+=ms;},port:async r=>{modes.push(r.mode);return r.mode==='observe'?{owner,dialogs:[]}:{owner,nativeDialogs:[]};}}),/not observed/);assert.equal(time,10000);assert(modes.every(m=>['observe','observe_win32'].includes(m)));
});
test('native port retains fixed bounded BM_CLICK dispatch and fresh action validation',()=>{
 const s=readFileSync(new URL('./native-quit-dialog.ps1',import.meta.url),'utf8');assert.equal((s.match(/::SendMessageTimeout\(/g)??[]).length,1);assert.match(s,/SendMessageTimeout\(\$button,0x00F5,\[UIntPtr\]::Zero,\[IntPtr\]::Zero,3,\[uint32\]\$timeout/);assert.doesNotMatch(s,/SetActiveWindow|SetForegroundWindow|PostMessage|BM_CLICK.*0xffff/);assert.match(s,/\$nativeDialogs=Read-Win32Dialogs/);assert.match(s,/\$fresh=Read-KnownButton \$dialog \$button/);assert.match(s,/\$dialogPid -ne \$ownedPid -or \$ownerPid -ne \$ownedPid/);assert.match(s,/\$sent -eq \[IntPtr\]::Zero/);
});
test('valid UIA keeps its original action even when the native route is enabled',async()=>{
 const calls=[];const dialogs=[{handle:'10',ownerHandle:'20',pid:owner.pid,ownerPid:owner.pid,className:'#32770',visible:true,texts:['Studio를 끝낼까요?','지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요.'],buttons:['계속하기','끝내기'].map(name=>({name,pid:owner.pid,enabled:true,visible:true,invokable:true}))}];
 await confirmWindowsStreamingQuit({owner,allowWin32:true,current:()=>true,port:async r=>{calls.push(r.mode);if(r.mode==='observe')return{owner,dialogs};assert.equal(r.mode,'invoke');return{invoked:true,handle:r.selection.handle};}});
 assert.deepEqual(calls,['observe','invoke']);
});
