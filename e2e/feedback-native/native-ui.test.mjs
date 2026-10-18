// Transport/predicate regressions only; these stubs never count as native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {NativeUI,sessionRefusalObserved,assertOwnedPreviewClose} from './native-ui.mjs';
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
 const widget={querySelector:()=>input,getBoundingClientRect:()=>({width:100,height:40})};const document={querySelector:()=>widget,hasFocus:()=>true,activeElement:input,elementFromPoint:()=>hit};
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
test('chat focus readiness observes command-produced actual input focus without clicking or focusing it',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let focused=false;
 const target={evaluate:async()=>({documentFocused:focused,inputFocused:focused})};
 ui.frame=async()=>target;for(const action of['press','key','input','focusWorkbench'])ui[action]=()=>assert.fail('focus readiness must not synthesize '+action);
 setTimeout(()=>{focused=true;},30);assert.equal(await ui.focusChatReady(500),target);
 focused=false;await assert.rejects(ui.focusChatReady(1),/actual webview and textarea focus/);
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

test('preview identity accepts the shell content-title suffix but refuses another Untitled resource',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let model='Untitled-1';
 ui.editorState=async()=>({resource:'Untitled-2',editorLabel:'# 외부 지침 스킬 • '+model,focused:true,text:'revision manifest'});
 await assert.rejects(ui.newPreview({}, {resources:['Untitled-1']},['revision','manifest'],1),/Timed out/);
 model='Untitled-2';assert.equal((await ui.newPreview({}, {resources:['Untitled-1']},['revision','manifest'])).resource,'Untitled-2');
});
test('Mac select all uses the native key editing command; ordinary and Windows keys do not',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[],target={send:async(method,args)=>events.push({method,...args})};
 await ui.key(target,'a',4);assert.deepEqual(events[0].commands,['selectAll']);assert.equal(events[1].commands,undefined);
 events.length=0;await ui.key(target,'a',2);assert(events.every(e=>e.commands===undefined));
});
test('input replacement waits for focus and full selection before inserting, then observes final value',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');const control={value:'old draft',selectionStart:0,selectionEnd:0};let inserted=false;
 const document={querySelector:()=>control,activeElement:control};
 const target={evaluate:expression=>vm.runInNewContext(expression,{document}),send:async(method,args)=>{assert.equal(control.selectionEnd,control.value.length);assert.equal(method,'Input.insertText');inserted=true;control.value=args.text;}};
 ui.press=async()=>{};ui.key=async()=>{setTimeout(()=>{control.selectionEnd=control.value.length;},50);};
 const pending=ui.input(target,'textarea','new draft');await new Promise(r=>setTimeout(r,20));assert.equal(inserted,false);await pending;assert.equal(control.value,'new draft');
});

test('owned quit uses Mac CmdQ and actual Windows File Exit after observed focus, never kill or host command',async()=>{
 for(const platform of['darwin','win32']){
  const ui=new NativeUI('http://127.0.0.1:9777'),events=[];const target={send:async(method,args)=>events.push([method,args])};
  ui.workbench=async()=>target;ui.focusWorkbench=async t=>{assert.equal(t,target);events.push(['focused']);};
  ui.clickText=async(t,label,css)=>{assert.equal(t,target);events.push(['native-click',label,css]);};
  await ui.quitOwned(platform);assert.equal(events[0][0],'focused');
  if(platform==='darwin'){assert.equal(events[1][0],'Input.dispatchKeyEvent');assert.equal(events[1][1].key,'q');assert.equal(events[1][1].modifiers,4);assert.equal(events[1][1].type,'keyDown');assert.equal(events[2][1].type,'keyUp');}
  else assert.deepEqual(events,[['focused'],['native-click','File','.menubar-menu-button'],['native-click','Exit','.monaco-menu .action-label']]);
 }
});
test('visible menu choice matches exact mnemonic label, refusing hidden or neighboring exit labels',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),parent={children:[]};
 const nodes=[['Exit Other',20],['Exit',0],['Exit',20]].map(([text,width])=>({tagName:'SPAN',textContent:text,parentElement:parent,getBoundingClientRect:()=>({width})}));parent.children=nodes;
 const document={documentElement:parent,querySelectorAll:selector=>{assert.equal(selector,'.monaco-menu .action-label');return nodes;}};
 const view={evaluate:expression=>vm.runInNewContext(expression,{document})};
 assert.equal(await ui.textSelector(view,'Exit','.monaco-menu .action-label'),'html>span:nth-child(3)');
});
test('CDP down requires connection refusal, not HTTP error or timeout',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),original=globalThis.fetch;
 try{for(const [answer,expected]of[[async()=>new Response('',{status:500}),false],[async()=>{throw Object.assign(Error(),{cause:{code:'ECONNREFUSED'}});},true],[async()=>{throw Object.assign(Error(),{name:'TimeoutError'});},false]]){globalThis.fetch=answer;assert.equal(await ui.cdpDown(),expected);}}finally{globalThis.fetch=original;}
});

test('second activity candidate uses actual StartPage choices, explicit token entry and selected folder UI',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[],token='synthetic-token-B-private',folder='/owned/C';
 const view={evaluate:async expression=>{assert(expression.includes(".studio-course"));events.push(['observe',expression.includes('#connect-title')?'authenticated-candidate':'selected-folder']);return expression.includes('#connect-title')?true:folder;}};
 ui.clickText=async(target,label)=>{assert.equal(target,view);events.push(['click',label]);};
 ui.input=async(target,selector,value)=>{assert.equal(target,view);assert.equal(selector,'#course-code');assert.equal(value,token);events.push(['input','explicit-token-B']);};
 ui.folder=async(directory,label)=>events.push(['folder',directory,label]);
 assert.equal(await ui.activityCandidate(view,token,folder),view);
 assert.deepEqual(events,[['click','다른 활동 선택'],['click','수업에 참여하기'],['input','explicit-token-B'],['click','코드 확인하기'],['observe','authenticated-candidate'],['click','다른 작업 폴더 선택'],['folder',folder,'이 활동의 작업 폴더 선택'],['observe','selected-folder']]);
 assert(!JSON.stringify(ui.phases).includes(token),'private code is not phase evidence');
});

test('restart observes delayed restored draft without focus, palette or token admission input',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let restored=false,reads=0;
 ui.frame=async selector=>{assert.equal(selector,'.hps-input textarea');return{evaluate:async expression=>{assert.equal(expression,"document.querySelector('.hps-input textarea')?.value");reads++;return restored?'persisted-A':'';}};};
 for(const action of['palette','focusWorkbench','focusChatReady','input','key','press','activityCandidate'])ui[action]=()=>assert.fail('Restart must not perform '+action);
 setTimeout(()=>{restored=true;},25);
 assert.equal(await ui.restoredDraft('persisted-A',500),'persisted-A');assert(reads>=2);
 ui.frame=async()=>({evaluate:async()=> 'wrong-B'});await assert.rejects(ui.restoredDraft('persisted-A',1),/actual restored chat/);
});

test('Windows displayed folder identity normalizes only complete drive/separator paths, never a suffix or URI',async()=>{
 const {sameDisplayedWorkspace}=await import('./native-ui.mjs');
 assert(sameDisplayedWorkspace('d:\\a\\_temp\\candidate\\A','D:/a/_temp/candidate/A','win32'));
 assert(sameDisplayedWorkspace('D:/a/_temp/candidate/A','D:\\a\\_temp\\candidate\\A','win32'));
 for(const other of['E:\\a\\_temp\\candidate\\A','D:\\other\\candidate\\A','D:\\a\\_temp\\candidate\\AB','D:\\a\\_temp\\candidate\\A\\child','file:///D:/a/_temp/candidate/A','candidate/A','D:candidate\\A','D:\\a\\_temp\\Candidate\\A'])assert(!sameDisplayedWorkspace(other,'D:\\a\\_temp\\candidate\\A','win32'),other);
 assert(!sameDisplayedWorkspace('/owned/a','/owned/A','darwin'));
 assert(!sameDisplayedWorkspace(undefined,'D:\\a','win32'));
});
test('failed owned activity cleanup cancels only visible candidate choice, never disconnects another activity',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),events=[];let pending=false;
 const view={};ui.frame=async selector=>{assert.equal(selector,'.studio-start');return view;};
 ui.hasTextButton=async(target,label)=>{assert.equal(target,view);assert.equal(label,'선택 취소');return pending;};
 ui.clickText=async(target,label)=>{assert.equal(target,view);assert.equal(label,'선택 취소');events.push(label);setTimeout(()=>{pending=false;},25);};
 assert.equal(await ui.cancelActivityCandidate(),false);assert.deepEqual(events,[]);
 pending=true;assert.equal(await ui.cancelActivityCandidate(),true);assert.deepEqual(events,['선택 취소']);assert.equal(pending,false);
 ui.frame=async()=>{throw Error('No visible Start');};assert.equal(await ui.cancelActivityCandidate(),false);
});
test('public skill preview outcome distinguishes actual confirmation, canonical failure and unrelated progress',async()=>{
 const {skillPreviewOutcome}=await import('./native-ui.mjs');
 assert.equal(skillPreviewOutcome(['출처·고정 revision·라이선스·요구 capability와 지침 내용을 확인했나요?']),'preview');
 for(const message of['공개 GitHub 다운로드 한도에 도달했습니다.','공개 GitHub 파일을 받지 못했습니다 (403).','지침 스킬을 처리하지 못했습니다. 기존 선택과 작업 결과는 보존됩니다.'])assert.equal(skillPreviewOutcome([message]),'failure');
 for(const message of['지침 스킬 검사 중','이 활동으로 시작할까요?','다른 알림','고정 revision text without actual confirmation'])assert.equal(skillPreviewOutcome([message]),null);
});

test('saved activity selects complete workspace identity, never another folder with matching basename',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),pressed=[];
 const view={evaluate:async()=>[{index:0,workspace:'/different/A'},{index:1,workspace:'/owned/A'}]};
 ui.press=async(_view,selector)=>pressed.push(selector);
 await ui.savedActivity(view,'/owned/A');assert.deepEqual(pressed,['.studio-saved-activities button:nth-of-type(2)']);
 await assert.rejects(ui.savedActivity({evaluate:async()=>[{index:0,workspace:'/different/A'}]},'/owned/A',1),/unique saved activity/);
 await assert.rejects(ui.savedActivity({evaluate:async()=>[{index:0,workspace:'/owned/A'},{index:1,workspace:'/owned/A'}]},'/owned/A',1),/unique saved activity/);
 assert.equal(pressed.length,1,'missing or ambiguous identity cannot click');
});

// Uses the real App mapping against the actual Service-shaped denial; no native acceptance implied.
test('session refusal observes exact mapped App message, preservation and no candidate; raw/wrong/hidden states refuse',async()=>{
 const {classifyProfileFailure}=await import('../../extensions/hypeproof-chat/src/proxyClientHelpers.ts');
 const raw='수업이 아직 시작 전이에요. 강사가 곧 열어줄 거예요 — 잠시 후 다시 보내보세요.';
 const expected=classifyProfileFailure(403,JSON.stringify({error:{type:'session_inactive',message:raw}})).friendly;
 const actual={visible:true,candidate:false,message:expected,preservation:'기존 활동 연결은 유지됩니다.'};
 assert.equal(sessionRefusalObserved(actual,expected),true);
 for(const changed of [{message:raw},{message:classifyProfileFailure(401,JSON.stringify({error:{code:'expired'}})).friendly},{message:expected+' extra'},{visible:false},{candidate:true},{preservation:''},{preservation:'연결을 해제했습니다.'}])assert.equal(sessionRefusalObserved({...actual,...changed},expected),false,JSON.stringify(changed));
 const ui=new NativeUI('http://127.0.0.1:9777');
 const paragraph={textContent:actual.preservation},element={childNodes:[{nodeType:3,textContent:expected},{nodeType:1,textContent:actual.preservation}],getBoundingClientRect:()=>({width:400,height:90}),querySelector:()=>paragraph};
 const view={evaluate:expression=>vm.runInNewContext(expression,{document:{querySelector:selector=>selector==='#connection-error'?element:{textContent:'이어서 시작할까요?'}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})})};
 assert.equal((await ui.sessionRefusal(view,expected,500)).message,expected,'DOM paragraph must not contaminate exact mapped message');
 const hidden={evaluate:async()=>({...actual,visible:false})};await assert.rejects(ui.sessionRefusal(hidden,expected,1),/visible canonical App profile refusal/);
});

test('window discovery is explicit, read-only and never falls back to another live window',async()=>{
 const {selectWorkbenchInfo}=await import('./native-ui.mjs');
 const a={id:'A',type:'page',url:'vscode-file://workbench.html'},b={...a,id:'B'};
 assert.equal(selectWorkbenchInfo([a]),a);assert.throws(()=>selectWorkbenchInfo([a,b]),/Ambiguous/);
 assert.equal(selectWorkbenchInfo([a,b],'B'),b);assert.equal(selectWorkbenchInfo([a],'B'),undefined);
 assert.equal(selectWorkbenchInfo([{...b,type:'iframe'}],'B'),undefined);
 const ui=new NativeUI('http://127.0.0.1:9777','B'),calls=[];ui.list=async()=>[a,b];ui.target=async info=>{calls.push(info.id);return info;};
 assert.equal(await ui.workbench(),b);assert.deepEqual(calls,['B']);
});
test('restart focus observation refuses visible unfocused input and never repairs focus',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let focused=false;
 ui.frame=async()=>({evaluate:async expression=>{assert.equal(expression,"document.hasFocus()&&document.activeElement===document.querySelector('.hps-input textarea')");return focused;}});
 for(const method of ['press','key','input','palette','focusWorkbench'])ui[method]=()=>assert.fail('Read-only restart observation');
 await assert.rejects(ui.restoredFocus(1),/restored native input focus/);focused=true;
 assert.deepEqual(await ui.restoredFocus(500),{input_focus_restored:true,focus_repaired:false});
});
test('secondary close requires exact scope, actual focus and public Close Window selection',async()=>{
 const unbound=new NativeUI('http://127.0.0.1:9777');await assert.rejects(unbound.closeOwnedWindow(),/explicitly bound/);
 const ui=new NativeUI('http://127.0.0.1:9777','B'),events=[];let alive=true,focused=false;
 const w={evaluate:async expression=>{assert.equal(expression,'document.hasFocus()');return focused;}};ui.workbench=async()=>w;
 ui.palette=async(title,options)=>{assert.equal(title,'Close Window');assert.deepEqual(options,{expectReload:true});events.push(title);alive=false;};
 ui.key=()=>assert.fail('No guessed shortcut');ui.list=async()=>[{id:'A'},...(alive?[{id:'B'}]:[])];
 await assert.rejects(ui.closeOwnedWindow(),/actually focused/);assert.deepEqual(events,[]);
 focused=true;await ui.closeOwnedWindow();assert.deepEqual(events,['Close Window']);
});
test('retained background frame keeps identity and owner without visibility or focus repair',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777','C');
 const info={id:'chat-C',type:'iframe',url:'vscode-webview://test/index.html?id=outer-C&extensionId=hypeproof.hypeproof-chat'},chat={info};let infos=[info],belongs=true;
 ui.list=async()=>infos;ui.workbench=async()=>({evaluate:async expression=>{assert(expression.includes('outer-C'));assert(!expression.includes('getBoundingClientRect'));return belongs;}});
 for(const method of ['frame','target','focusWorkbench','press','key'])ui[method]=()=>assert.fail('Must retain observed target without discovery/input');
 assert.equal(await ui.retainedFrame(chat),chat);belongs=false;await assert.rejects(ui.retainedFrame(chat),/belongs/);belongs=true;
 infos=[{...info,id:'replacement'}];await assert.rejects(ui.retainedFrame(chat),/identity/);
 infos=[{...info,url:info.url+'&changed=1'}];await assert.rejects(ui.retainedFrame(chat),/identity/);
 ui.workbenchId=undefined;await assert.rejects(ui.retainedFrame(chat),/explicit/);
});
test('scoped webview discovery cannot connect to another window iframe even when its inner control is visible',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777','B'),connected=[];
 const pages=['A','B'].map(id=>({id,type:'page',url:'vscode-file://workbench.html'}));
 const frames=['A','B'].map(id=>({id:'chat-'+id,type:'iframe',url:'vscode-webview://test/index.html?id=outer-'+id+'&extensionId=hypeproof.hypeproof-chat'}));
 const host={evaluate:expression=>vm.runInNewContext(expression,{document:{querySelectorAll:()=>[{name:'outer-B',getBoundingClientRect:()=>({width:800,height:600})}]},getComputedStyle:()=>({display:'block',visibility:'visible'})})};
 const chat={info:{id:'chat-B'},send:async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'inner'}}}:{executionContextId:1},evaluate:()=>true};
 ui.list=async()=>[...pages,...frames];ui.target=async info=>{connected.push(info.id);if(info.id==='B')return host;if(info.id==='chat-B')return chat;assert.fail('Cross-window target '+info.id);};
 assert.equal(await ui.frame('textarea',500),chat);assert(!connected.includes('chat-A'));assert(!connected.includes('A'));
});

function previewCloseFixture(){
 const before={resources:['saved.txt'],dirtyResources:[]};
 const preview={resource:'Untitled-2',resources:['saved.txt','Untitled-2'],editorLabel:'Untitled-2',focused:true,text:'# 외부 지침 스킬 · fixture\nprovenance',dirtyResources:['Untitled-2']};
 return {before,preview};
}
test('only a newly observed unchanged preview is reverted and closed via its public UI command',async()=>{
 const {before,preview}=previewCloseFixture(),ui=new NativeUI('http://127.0.0.1:9777'),calls=[];let state=preview;
 ui.editorState=async()=>state;ui.palette=async title=>{calls.push(title);state=before;};
 const proof=await ui.closeOwnedPreview({},before,preview);
 assert.deepEqual(calls,['View: Revert and Close Editor']);assert(proof.other_editors_preserved);assert.equal(proof.resource,'Untitled-2');
});
test('foreign dirty, preexisting, changed, duplicate or unfocused editors cause zero discard actions',async()=>{
 const {before,preview}=previewCloseFixture();
 for(const current of [{...preview,dirtyResources:['Untitled-2','saved.txt']},{...preview,text:'user changed text'},{...preview,focused:false},{...preview,resource:'saved.txt'},{...preview,resources:['saved.txt','Untitled-2','Untitled-2']},{...preview,resources:['saved.txt','Untitled-2','foreign.txt']},{...preview,dirtyResources:undefined}]){
  const ui=new NativeUI('http://127.0.0.1:9777');let calls=0;ui.editorState=async()=>current;ui.palette=async()=>calls++;
  await assert.rejects(ui.closeOwnedPreview({},before,preview));assert.equal(calls,0);
 }
 assert.throws(()=>assertOwnedPreviewClose({...before,resources:['saved.txt','Untitled-2']},preview,preview),/newly observed/);
 const ui=new NativeUI('http://127.0.0.1:9777');ui.editorState=async()=>({dirtyResources:['unknown.txt']});await assert.rejects(ui.assertNoDirtyEditors({}),/dirty editor/);
});


test('focus diagnostics observe exact target and safe DOM state without repair or private values',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777','owned-window'),input={value:'private-draft-never-log',tagName:'TEXTAREA',getBoundingClientRect:()=>({x:1,y:2,width:300,height:40})};let active={tagName:'BUTTON'},documentFocused=true;
 const document={querySelector:selector=>{assert.equal(selector,'.hps-input textarea');return input;},hasFocus:()=>documentFocused,get activeElement(){return active;}};
 const target={info:{id:'owned-chat'},ownedWorkbenchId:'owned-window',contextId:42,evaluate:expression=>vm.runInNewContext(expression,{document,getComputedStyle:()=>({display:'block',visibility:'visible'})})};
 let frames=0;ui.frame=async()=>{frames++;return target;};for(const action of['press','key','input','focusWorkbench','palette'])ui[action]=()=>assert.fail('No focus repair '+action);
 await assert.rejects(ui.focusChatReady(1),/actual webview and textarea focus/);assert.equal(frames,1);assert.deepEqual(ui.phases.map(x=>x.outcome),['start','timeout']);
 const failure=ui.phases[1];assert.equal(failure.target_id,'owned-chat');assert.equal(failure.owned_workbench_id,'owned-window');assert.equal(failure.context_id,42);assert.equal(failure.state.activeTag,'BUTTON');assert.equal(failure.state.inputFocused,false);assert.equal(failure.state.visible,true);assert(failure.snapshot_age_ms>=0);assert(!JSON.stringify(ui.phases).includes('private-draft'));
 ui.phases=[];active=input;documentFocused=false;await assert.rejects(ui.focusChatReady(1),/actual webview and textarea focus/);assert.equal(ui.phases[1].state.inputFocused,true);assert.equal(ui.phases[1].state.documentFocused,false);
 ui.phases=[];documentFocused=true;assert.equal(await ui.focusChatReady(500),target);assert.deepEqual(ui.phases.map(x=>x.outcome),['start','observed']);assert.equal(ui.phases[1].state.inputFocused,true);
});
test('diagnostic sampling failure preserves refusal without a terminal resample or raw error message',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777');let samples=0;ui.frame=async()=>({info:{id:'owned-chat'},evaluate:async()=>{samples++;throw Object.assign(Error('synthetic-private-error'),{name:'synthetic-private-custom-name'});}});
 await assert.rejects(ui.focusChatReady(1),error=>{assert.match(error.message,/actual webview and textarea focus/);assert.match(error.message,/Chat focus diagnostic sample unavailable/);assert(!String(error).includes('synthetic-private'),'Returned timeout must omit custom name and message');assert(!JSON.stringify({error:error.message,name:error.name}).includes('synthetic-private'),'Serialized step failure must omit private markers');return true;});assert.equal(samples,1,'No extra timeout resample or deadline reset');assert.deepEqual(ui.phases.map(x=>x.outcome),['start','timeout']);assert.equal(ui.phases[1].sample_error,'Error');assert.equal(ui.phases[1].state,null);assert(!JSON.stringify(ui.phases).includes('synthetic-private'),'Neither custom error name nor message may enter diagnostics');
});

test('actual headless quick input refuses visible wrong focus and waits for exact input focus',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(new URL('../package.json',import.meta.url));const {chromium}=require('playwright');
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<input id="other"><iframe></iframe><div class="quick-input-widget"><div class="quick-input-title">Synthetic command</div><input value=">Exact"></div>');
  const ui=new NativeUI('http://127.0.0.1:9777'),target={evaluate:expression=>page.evaluate(expression)};
  await page.locator('iframe').focus();let state=await ui.quickState(target);assert.equal(state.visible,true);assert.equal(state.hostFocused,true);assert.equal(state.activeTag,'IFRAME');assert.equal(state.inputFocused,false);assert.equal(state.ready,false);
  await page.locator('#other').focus();state=await ui.quickState(target);assert.equal(state.activeTag,'INPUT');assert.equal(state.ready,false,'another input cannot authorize palette typing');
  let observed,done=false;const wrongFocusObserved=new Promise(resolve=>{observed=resolve;});const original=ui.quickState.bind(ui);ui.quickState=async t=>{const value=await original(t);if(!value.inputFocused)observed();return value;};
  const waiting=ui.waitQuick(target,s=>s.ready,'synthetic exact input focus',2000).then(value=>{done=true;return value;});await wrongFocusObserved;assert.equal(done,false);
  // Fixture transition only: production quickState/waitQuick never focus or click.
  await page.locator('.quick-input-widget input').focus();const ready=await waiting;assert.equal(ready.inputFocused,true);assert.equal(ready.ready,true);assert.equal(ui.phases[0].inputFocused,true);
  await page.locator('iframe').focus();await assert.rejects(ui.waitQuick(target,s=>s.ready,'synthetic wrong focus refusal',1),/"inputFocused":false/);
 }finally{await browser.close();}
});

test('quick input cannot be ready when its document lacks focus despite exact active element',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),input={value:'>Exact',getBoundingClientRect:()=>({left:0,top:0,width:100,height:20})};const widget={querySelector:()=>input,getBoundingClientRect:()=>({width:100,height:40})};
 const document={querySelector:()=>widget,hasFocus:()=>false,activeElement:input,elementFromPoint:()=>input};const target={evaluate:expression=>vm.runInNewContext(expression,{document,getComputedStyle:()=>({display:'block',visibility:'visible'})})};const state=await ui.quickState(target);assert.equal(state.inputFocused,true);assert.equal(state.hostFocused,false);assert.equal(state.ready,false);
});
