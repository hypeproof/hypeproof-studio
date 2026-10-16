// Transport/predicate regressions only; these stubs never count as native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {NativeUI} from './native-ui.mjs';
function fixture(outerVisible){const ui=new NativeUI('http://127.0.0.1:9777');const iframe={name:'visible-webview',getBoundingClientRect:()=>({width:outerVisible?800:0,height:600})};const control={getBoundingClientRect:()=>({width:700,height:60})};const host={evaluate:expression=>vm.runInNewContext(expression,{document:{querySelectorAll:()=>[iframe]},getComputedStyle:()=>({display:'inline',visibility:'visible'})})};const target={info:{id:'target'},send:async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'frame'}}}:{executionContextId:1},evaluate:expression=>vm.runInNewContext(expression,{document:{visibilityState:'hidden',querySelector:()=>control}})};ui.list=async()=>[{id:'target',type:'iframe',url:'vscode-webview://test/index.html?id=visible-webview&extensionId=hypeproof.hypeproof-chat'}];ui.workbench=async()=>host;ui.target=async()=>target;return {ui,target};}
test('visible workbench iframe and control geometry work despite Electron Page Visibility false negative',async()=>{const {ui,target}=fixture(true);assert.equal(await ui.frame('textarea',500),target);});
test('hidden outer webview cannot pass by retaining an inner control geometry',async()=>{const {ui}=fixture(false);await assert.rejects(ui.frame('textarea',1),/Timed out/);});
test('command input retains palette mode prefix instead of switching to file quick-open',async()=>{const ui=new NativeUI('http://127.0.0.1:9777'),typed=[];const target={evaluate:async()=>true};ui.workbench=async()=>target;let state={visible:false};ui.quickState=async()=>state;ui.key=async()=>{state={visible:true,ready:true,mode:'command',value:'>'};};ui.press=async()=>{state={visible:false};};ui.choiceSelector=async()=>'.choice';ui.input=async(_t,_selector,text)=>{typed.push(text);state.value=text;};await ui.palette('HypeProof: 작업 파일 열기');assert.deepEqual(typed,['>HypeProof: 작업 파일 열기']);});

test('palette chooses the exact visible command even when another row extends its name',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),pressed=[];
 const rows=['HypeProof Chat: Focus on Chat View','HypeProof Chat: Focus'].map(text=>({querySelector:selector=>selector==='.label-name'?{textContent:text}:null,getBoundingClientRect:()=>({height:22})}));
 for(const row of rows)row.parentElement={children:rows};
 const target={evaluate:async expression=>expression.includes("querySelectorAll('.quick-input-list")?vm.runInNewContext(expression,{document:{querySelectorAll:()=>rows}}):true};
 ui.workbench=async()=>target;let state={visible:false};ui.quickState=async()=>state;ui.key=async()=>{state={visible:true,ready:true,mode:'command',value:'>'};};ui.input=async(_target,_selector,text)=>{state.value=text;};ui.press=async(_target,selector)=>{pressed.push(selector);state={visible:false};};
 await ui.palette('HypeProof Chat: Focus');
 assert.deepEqual(pressed,['.quick-input-list .monaco-list-row:nth-child(2)']);
});
test('custom dialog messages are observed through their actual IDs alongside notifications',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');
 const message={textContent:'출처·고정 revision·라이선스·요구 capability'};
 ui.workbench=async()=>({evaluate:expression=>vm.runInNewContext(expression,{document:{querySelectorAll:selector=>selector.includes('#monaco-dialog-message-text')?[message]:[]}})});
 assert.deepEqual(Array.from(await ui.toasts()),[message.textContent]);
});
test('simple Save As accepts the observed OK action without accepting an undeclared action',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),clicked=[];
 ui.workbench=async()=>({evaluate:async()=>true});ui.input=async()=>{};
 ui.hasTextButton=async(_target,label)=>label==='OK';ui.clickText=async(_target,label)=>clicked.push(label);
 await ui.pathDialog('/owned/new.txt',['Save','저장','OK','확인']);assert.deepEqual(clicked,['OK']);
 await assert.rejects(ui.pathDialog('/owned/new.txt',['Save','저장']),/No declared native dialog action/);
});

// Synthetic transitions deliberately keep the old widget visible after CDP input
// acknowledgment. These assert scheduling and refusal, never native acceptance.
function transitionUI(){
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let state={visible:false,ready:false,mode:'closed'};
 ui.workbench=async()=>({});ui.quickState=async()=>({...state});ui.choiceSelector=async()=>'.declared-choice';
 ui.key=async(_target,key)=>{events.push(key);state={visible:true,ready:true,mode:'command',value:'>'};};
 ui.input=async(_target,_selector,value)=>{events.push('typed:'+value);state.value=value;};
 return {ui,events,get state(){return state;},set state(value){state=value;}};
}
test('palette waits for prior hide, then waits for selection dismissal before another F1',async()=>{
 const f=transitionUI();f.state={visible:true,ready:true,mode:'command',value:'>old'};
 let released=false;f.ui.press=async()=>{f.events.push('clicked');setTimeout(()=>{released=true;f.state={visible:false};},50);};
 const pending=f.ui.palette('Exact command');await new Promise(r=>setTimeout(r,30));assert.deepEqual(f.events,[],'no F1 can toggle the still-open prior palette');
 f.state={visible:false};await pending;assert.equal(released,true,'mouse ack alone cannot complete palette');assert.deepEqual(f.events,['F1','typed:>Exact command','clicked']);
});
test('palette may transition directly into a ready picker without a hidden polling sample',async()=>{
 const f=transitionUI();f.ui.press=async()=>{f.state={visible:true,ready:true,mode:'picker',value:''};};
 await f.ui.palette('Open picker');assert.equal(f.state.mode,'picker');
});
test('quick selection waits out a closing command widget and then its own next picker',async()=>{
 const f=transitionUI();f.state={visible:true,ready:true,mode:'command',value:'>Open picker'};
 let accepted=false;f.ui.press=async()=>{setTimeout(()=>{accepted=true;f.state={visible:true,ready:true,mode:'picker',value:''};},40);};
 const pending=f.ui.quick('Selected item');await new Promise(r=>setTimeout(r,30));assert.deepEqual(f.events,[],'no typing into the stale command field');
 f.state={visible:true,ready:true,mode:'picker',value:''};await pending;assert.equal(accepted,true);assert.deepEqual(f.events,['typed:Selected item']);
});
test('quick state diagnostics omit entered text and fail rather than retrying an action',async()=>{
 const f=transitionUI();f.state={visible:true,ready:false,mode:'picker',value:'synthetic-secret-do-not-log'};
 await assert.rejects(f.ui.waitQuick({},s=>s.ready,'picker ready',1),error=>error.message.includes('picker ready')&&error.message.includes('"ready":false')&&!error.message.includes('synthetic-secret'));
 assert.deepEqual(f.events,[]);
});
test('exact picker label permits selected marker but never an extended neighboring label',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');const rows=['✓ internal-comms-extra','✓ internal-comms'].map(text=>({querySelector:()=>({textContent:text}),getBoundingClientRect:()=>({height:22})}));for(const row of rows)row.parentElement={children:rows};
 const target={evaluate:expression=>vm.runInNewContext(expression,{document:{querySelectorAll:()=>rows}})};
 assert.equal(await ui.choiceSelector(target,'internal-comms'),'.quick-input-list .monaco-list-row:nth-child(2)');
});

test('new file waits for the real focused editor before typing and rendered text before save',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let ready=false,rendered=false;
 const target={evaluate:async expression=>expression.includes('document.activeElement')?ready:rendered,send:async(method,args)=>{events.push([method,args.text]);setTimeout(()=>{rendered=true;},30);}};
 ui.workbench=async()=>target;ui.key=async(_w,key)=>{events.push(['key',key]);setTimeout(()=>{ready=true;},30);};
 const pending=ui.newTextFile('Native file text\n');await new Promise(r=>setTimeout(r,15));assert.deepEqual(events,[['key','n']]);
 assert.equal(await pending,target);assert.equal(rendered,true);assert.deepEqual(events,[['key','n'],['Input.insertText','Native file text\n']]);
});

test('quick input readiness observes actual hit target and does not expose values in failure metadata',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');const input={value:'>Exact',disabled:false,getBoundingClientRect:()=>({left:0,top:0,width:100,height:20})};let hit=input;
 const widget={querySelector:()=>input,getBoundingClientRect:()=>({width:100,height:40})};const document={querySelector:()=>widget,hasFocus:()=>true,activeElement:{tagName:'INPUT'},elementFromPoint:()=>hit};
 const target={evaluate:expression=>vm.runInNewContext(expression,{document,getComputedStyle:()=>({display:'block',visibility:'visible'})})};
 assert.equal((await ui.quickState(target)).ready,true);assert.equal((await ui.quickState(target)).mode,'command');hit={};assert.equal((await ui.quickState(target)).ready,false);
});

test('only an explicitly expected reload accepts observed target closure after command selection',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),target={ws:{readyState:WebSocket.CLOSED}};ui.quickState=async()=>{throw Error('Target closed');};
 assert.equal((await ui.selectedQuick(target,'>Reload','reload selection',true)).mode,'reloading-target-closed');
 await assert.rejects(ui.waitQuick(target,s=>!s.visible,'ordinary selection',1),/Target closed/);
});
