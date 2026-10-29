import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {readOwnedQuitCensus,observeWindowsQuitStructure,selectQuitDialog,confirmWindowsStreamingQuit} from './native-quit-dialog.mjs';
import {NativeUI} from './native-ui.mjs';
const owner={pid:7000,start:'639288355200000000',executable:'D:\\owned\\HypeProof Studio.exe'};
const snapshot=()=>({owner:{...owner},windows:[{pid:7000,handle:'100',className:'Chrome_WidgetWin_1',visible:true,ownerRelation:'none',ownerHandle:'0',bounds:[0,0,1024,720],uia:{available:true,ownedNodes:3,skippedForeign:true,capped:false,modal:true,roles:{'ControlType.Window':1,'ControlType.Button':2},matches:{message:0,detail:0,continue:1,quit:1}}}]});
test('owned structural census preserves unknown class without authorizing it and strips arbitrary content',()=>{
 const s=snapshot();s.owner.token='PRIVATE';s.windows[0].title='PRIVATE';s.windows[0].uia.matches.text='PRIVATE';
 const read=readOwnedQuitCensus(s,owner);assert.equal(read.windows[0].className,'Chrome_WidgetWin_1');assert(!JSON.stringify(read).includes('PRIVATE'));assert.equal(read.windows[0].uia.modal,true);
 assert.throws(()=>selectQuitDialog({owner,dialogs:[{...s.windows[0],ownerPid:owner.pid,ownerHandle:'22',texts:['Studio를 끝낼까요?','지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요.'],buttons:['계속하기','끝내기'].map(name=>({name,pid:owner.pid,enabled:true,visible:true,invokable:true}))}]},owner),/message box/);
 for(const change of[s=>s.owner.start+='1',s=>s.owner.executable='D:\\peer.exe',s=>s.windows[0].pid++,s=>s.windows.push({...s.windows[0]}),s=>s.windows[0].uia.ownedNodes=65,s=>s.windows[0].uia.matches.quit=4,s=>s.windows[0].bounds[0]=NaN,s=>s.windows[0].uia.roles={'private-text':3}]){const bad=snapshot();change(bad);assert.throws(()=>readOwnedQuitCensus(bad,owner));}
});
test('census is one bounded read, current-fenced, sanitized on error and cannot invoke',async()=>{
 let calls=[];const r=await observeWindowsQuitStructure({owner,current:()=>true,port:async(request,timeout)=>{calls.push(request.mode);assert.equal(timeout,3000);return snapshot();}});assert.equal(r.status,'OBSERVED');assert.deepEqual(calls,['census']);
 for(const kind of['stale-before','stale-after','error']){calls=[];let live=kind!=='stale-before';const x=await observeWindowsQuitStructure({owner,current:()=>live,port:async request=>{calls.push(request.mode);live=false;if(kind==='error')throw Error('PRIVATE');return snapshot();}});assert.equal(x.status,'UNAVAILABLE');assert(!JSON.stringify(x).includes('PRIVATE'));assert(calls.every(c=>c==='census'));}
});
test('extra census data cannot widen the unchanged ten-second missing-dialog acceptance loop',async()=>{
 let time=0,invokes=0;await assert.rejects(confirmWindowsStreamingQuit({owner,current:()=>true,now:()=>time,sleep:async n=>{time+=n;},port:async request=>{if(request.mode==='invoke')invokes++;return{...snapshot(),dialogs:[]};}}),/not observed/);assert.equal(time,10000);assert.equal(invokes,0);
});
test('menu observation captures pre/post closure and renderer modal booleans, without text or input',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let menu=true,dialog=false;const element=visible=>({getBoundingClientRect:()=>({width:visible?10:0,height:10})});
 const target={info:{id:'owned'},evaluate:async expression=>vm.runInNewContext(expression,{document:{querySelectorAll:selector=>[element(selector==='.monaco-menu'?menu:dialog)],hasFocus:()=>true}})};
 await ui.observeQuitMenu(target,'before_exit_click');menu=false;dialog=true;await ui.observeQuitMenu(target,'after_exit_click');assert.equal(ui.phases[0].menu_closed,false);assert.equal(ui.phases[1].menu_closed,true);assert.equal(ui.phases[1].renderer_dialog_visible,true);
 await ui.observeQuitMenu({info:{id:'owned'},evaluate:async()=>{throw Error('PRIVATE');}},'after_exit_click');assert.equal(ui.phases.at(-1).status,'UNAVAILABLE');assert(!JSON.stringify(ui.phases).includes('PRIVATE'));
});
