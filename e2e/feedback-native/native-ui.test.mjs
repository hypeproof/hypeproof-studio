// Transport/predicate regressions only; these stubs never count as native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {NativeUI} from './native-ui.mjs';
function fixture(outerVisible){const ui=new NativeUI('http://127.0.0.1:9777');const iframe={name:'visible-webview',getBoundingClientRect:()=>({width:outerVisible?800:0,height:600})};const control={getBoundingClientRect:()=>({width:700,height:60})};const host={evaluate:expression=>vm.runInNewContext(expression,{document:{querySelectorAll:()=>[iframe]},getComputedStyle:()=>({display:'inline',visibility:'visible'})})};const target={info:{id:'target'},send:async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'frame'}}}:{executionContextId:1},evaluate:expression=>vm.runInNewContext(expression,{document:{visibilityState:'hidden',querySelector:()=>control}})};ui.list=async()=>[{id:'target',type:'iframe',url:'vscode-webview://test/index.html?id=visible-webview&extensionId=hypeproof.hypeproof-chat'}];ui.workbench=async()=>host;ui.target=async()=>target;return {ui,target};}
test('visible workbench iframe and control geometry work despite Electron Page Visibility false negative',async()=>{const {ui,target}=fixture(true);assert.equal(await ui.frame('textarea',500),target);});
test('hidden outer webview cannot pass by retaining an inner control geometry',async()=>{const {ui}=fixture(false);await assert.rejects(ui.frame('textarea',1),/Timed out/);});
test('command input retains palette mode prefix instead of switching to file quick-open',async()=>{const ui=new NativeUI('http://127.0.0.1:9777'),typed=[];const target={evaluate:async()=>true};ui.workbench=async()=>target;ui.focusWorkbench=async()=>{};let state={visible:false};ui.quickState=async()=>state;ui.key=async()=>{state={visible:true,ready:true,mode:'command',value:'>'};};ui.press=async()=>{state={visible:false};};ui.choiceSelector=async()=>'.choice';ui.input=async(_t,_selector,text)=>{typed.push(text);state.value=text;};await ui.palette('HypeProof: 작업 파일 열기');assert.deepEqual(typed,['>HypeProof: 작업 파일 열기']);});

test('palette chooses the exact visible command even when another row extends its name',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),pressed=[];
 const rows=['HypeProof Chat: Focus on Chat View','HypeProof Chat: Focus'].map(text=>({querySelector:selector=>selector==='.label-name'?{textContent:text}:null,getBoundingClientRect:()=>({height:22})}));
 for(const row of rows)row.parentElement={children:rows};
 const target={evaluate:async expression=>expression.includes("querySelectorAll('.quick-input-list")?vm.runInNewContext(expression,{document:{querySelectorAll:()=>rows}}):true};
 ui.workbench=async()=>target;ui.focusWorkbench=async()=>{};let state={visible:false};ui.quickState=async()=>state;ui.key=async()=>{state={visible:true,ready:true,mode:'command',value:'>'};};ui.input=async(_target,_selector,text)=>{state.value=text;};ui.press=async(_target,selector)=>{pressed.push(selector);state={visible:false};};
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
 ui.workbench=async()=>({});ui.focusWorkbench=async()=>{};ui.quickState=async()=>({...state});ui.choiceSelector=async()=>'.declared-choice';
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

test('new file waits for a new resource bound to the focused editor before typing and rendering',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let created=false,rendered=false;
 const target={send:async(method,args)=>{events.push([method,args.text]);setTimeout(()=>{rendered=true;},30);}};
 ui.workbench=async()=>target;ui.focusWorkbench=async()=>{};ui.editorState=async()=>({resources:created?['old.txt','Untitled-2']:['old.txt'],resource:created?'Untitled-2':'old.txt',editorLabel:created?'Untitled-2':'old.txt',focused:true,text:rendered?'Native file text':'old original'});
 // The old editor remains ready while the new editor is still being created.
 ui.key=async(_w,key)=>{events.push(['key',key]);setTimeout(()=>{created=true;},30);};
 const originalState=ui.editorState;ui.editorState=async()=>{const s=await originalState();if(created&&!rendered)s.text='';return s;};
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

test('workbench activation is observed before palette keyboard input, without DOM focus mutation',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let focused=false,state={visible:false};
 const target={send:async(method)=>{events.push(method);assert.equal(method,'Page.bringToFront');setTimeout(()=>{focused=true;},35);},evaluate:async expression=>{assert.equal(expression,'document.hasFocus()');return focused;}};
 ui.workbench=async()=>target;ui.quickState=async()=>state;ui.choiceSelector=async()=>'.exact-command';
 ui.key=async(_target,key)=>{assert(focused,'F1 cannot precede observed native window focus');events.push(key);state={visible:true,ready:true,mode:'command',value:'>'};};
 ui.input=async(_target,_selector,value)=>{state.value=value;};ui.press=async()=>{state={visible:false};};
 const pending=ui.palette('Exact command');await new Promise(r=>setTimeout(r,15));assert.deepEqual(events,['Page.bringToFront']);await pending;assert.deepEqual(events,['Page.bringToFront','F1']);
});
test('failed workbench activation stops before any keyboard input or retry',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let sends=0,keys=0;
 ui.workbench=async()=>({send:async method=>{sends++;assert.equal(method,'Page.bringToFront');throw Error('Activation unavailable');}});ui.key=async()=>{keys++;};
 await assert.rejects(ui.palette('Exact command'),/Activation unavailable/);assert.equal(sends,1);assert.equal(keys,0);
});
test('read-only workbench discovery never activates the window',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),calls=[];const target={send:async method=>{calls.push(method);}};
 ui.list=async()=>[{id:'read-only',type:'page',url:'vscode-file://workbench.html'}];ui.target=async()=>target;
 assert.equal(await ui.workbench(),target);assert.deepEqual(calls,[]);
});

test('new Untitled tab cannot authorize typing while the old editor still owns focus',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let command=false,modelReady=false,rendered=false;
 const target={send:async(method,args)=>{assert(modelReady,'never insert into the previous document');events.push({method,destination:'Untitled-2'});rendered=true;}};
 ui.workbench=async()=>target;ui.focusWorkbench=async()=>{};
 ui.editorState=async()=>({resources:command?['old.txt','Untitled-2']:['old.txt'],resource:command?'Untitled-2':'old.txt',editorLabel:modelReady?'Untitled-2':'old.txt',focused:true,text:rendered?'isolated text':''});
 ui.key=async()=>{command=true;setTimeout(()=>{modelReady=true;},45);};
 const pending=ui.newTextFile('isolated text');await new Promise(r=>setTimeout(r,20));assert.deepEqual(events,[],'changed tab alone must not authorize typing');
 await pending;assert.deepEqual(events,[{method:'Input.insertText',destination:'Untitled-2'}]);
});

test('command reset to > cannot count as a completed selection or next picker',async()=>{
 const f=transitionUI();f.state={visible:true,ready:true,mode:'command',value:'>'};let done=false;
 const pending=f.ui.selectedQuick({},'>Open files','selected').then(()=>{done=true;});
 await new Promise(r=>setTimeout(r,25));assert.equal(done,false);f.state={visible:false};await pending;
});
test('Explorer visibility cannot complete Files while delayed focus still belongs to chat',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let focused=false,done=false;
 const explorer={getBoundingClientRect:()=>({width:300}),contains:()=>focused};
 ui.workbench=async()=>({evaluate:expression=>vm.runInNewContext(expression,{document:{querySelector:()=>explorer,activeElement:{}}})});
 const pending=ui.explorerReady().then(()=>{done=true;});await new Promise(r=>setTimeout(r,25));assert.equal(done,false);focused=true;await pending;
});
test('stored preview rejects old matching text and a new tab still bound to the old focused model',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let resource='Untitled-1',model='Untitled-1',done=false;
 ui.editorState=async()=>({resources:[resource],resource,editorLabel:model,focused:true,text:'revision manifest'});
 const pending=ui.newPreview({}, {resources:['Untitled-1']},['revision','manifest']).then(()=>{done=true;});
 await new Promise(r=>setTimeout(r,25));assert.equal(done,false);resource='Untitled-2';await new Promise(r=>setTimeout(r,170));assert.equal(done,false);model='Untitled-2';await pending;
});
test('new preview refuses missing provenance in the actually focused editor',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');ui.editorState=async()=>({resource:'Untitled-2',editorLabel:'Untitled-2',focused:true,text:'unrelated document'});
 await assert.rejects(ui.newPreview({}, {resources:['Untitled-1']},['revision'],1),/Timed out/);
});
test('chat focus readiness waits actual webview focus before clicking the real textarea',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let focused=false,clicked=false;const chat={evaluate:async expression=>expression==='document.hasFocus()'?focused:clicked};ui.frame=async()=>chat;
 ui.press=async()=>{assert(focused);clicked=true;};const pending=ui.focusChatReady();await new Promise(r=>setTimeout(r,25));assert.equal(clicked,false);focused=true;assert.equal(await pending,chat);assert(clicked);
});
test('Open Folder allows observed OK only with its declared visible dialog title',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let title='Save As';const calls=[];
 ui.workbench=async()=>({evaluate:expression=>vm.runInNewContext(expression,{document:{querySelector:()=>({getBoundingClientRect:()=>({height:200}),querySelector:()=>({textContent:title})})}})});
 ui.pathDialog=async(directory,labels)=>calls.push({directory,labels});
 await assert.rejects(ui.ownedOpenFolder('/owned/a/',1),/Timed out/);assert.equal(calls.length,0);title='Open Folder';await ui.ownedOpenFolder('/owned/a/');assert.deepEqual(calls,[{directory:'/owned/a/',labels:['Open','열기','OK','확인']}]);
});
test('failed owned Open Folder cleanup uses Escape and observes closure; unrelated picker is untouched',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let owned=false,visible=true;
 ui.workbench=async()=>({});ui.isOpenFolder=async()=>owned;ui.quickState=async()=>({visible});ui.key=async(_w,key)=>{events.push(key);visible=false;};
 assert.equal(await ui.cancelOwnedOpenFolder(),false);assert.deepEqual(events,[]);owned=true;assert.equal(await ui.cancelOwnedOpenFolder(),true);assert.deepEqual(events,['Escape']);
});
test('phase evidence identifies selected command and omits private picker values',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');ui.commandTitle='Public command';ui.quickState=async()=>({visible:false,value:'private-user-text'});
 await ui.waitQuick({},s=>!s.visible,'selection settled',1);assert.equal(ui.phases[0].command,'Public command');assert.equal(ui.phases[0].outcome,'observed');assert(!JSON.stringify(ui.phases).includes('private-user-text'));
});
