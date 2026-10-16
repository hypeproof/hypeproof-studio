// Transport/predicate regressions only; these stubs never count as native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {NativeUI} from './native-ui.mjs';
function fixture(outerVisible){const ui=new NativeUI('http://127.0.0.1:9777');const iframe={name:'visible-webview',getBoundingClientRect:()=>({width:outerVisible?800:0,height:600})};const control={getBoundingClientRect:()=>({width:700,height:60})};const host={evaluate:expression=>vm.runInNewContext(expression,{document:{querySelectorAll:()=>[iframe]},getComputedStyle:()=>({display:'inline',visibility:'visible'})})};const target={info:{id:'target'},send:async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'frame'}}}:{executionContextId:1},evaluate:expression=>vm.runInNewContext(expression,{document:{visibilityState:'hidden',querySelector:()=>control}})};ui.list=async()=>[{id:'target',type:'iframe',url:'vscode-webview://test/index.html?id=visible-webview&extensionId=hypeproof.hypeproof-chat'}];ui.workbench=async()=>host;ui.target=async()=>target;return {ui,target};}
test('visible workbench iframe and control geometry work despite Electron Page Visibility false negative',async()=>{const {ui,target}=fixture(true);assert.equal(await ui.frame('textarea',500),target);});
test('hidden outer webview cannot pass by retaining an inner control geometry',async()=>{const {ui}=fixture(false);await assert.rejects(ui.frame('textarea',1),/Timed out/);});
test('command input retains palette mode prefix instead of switching to file quick-open',async()=>{const ui=new NativeUI('http://127.0.0.1:9777'),typed=[];const target={evaluate:async()=>true};ui.workbench=async()=>target;ui.key=async()=>{};ui.press=async()=>{};ui.input=async(_t,_selector,text)=>typed.push(text);await ui.palette('HypeProof: 작업 파일 열기');assert.deepEqual(typed,['>HypeProof: 작업 파일 열기']);});

test('palette chooses the exact visible command even when another row extends its name',async()=>{
 const ui=new NativeUI('http://127.0.0.1:9777'),pressed=[];
 const rows=['HypeProof Chat: Focus on Chat View','HypeProof Chat: Focus'].map(text=>({querySelector:selector=>selector==='.label-name'?{textContent:text}:null,getBoundingClientRect:()=>({height:22})}));
 for(const row of rows)row.parentElement={children:rows};
 const target={evaluate:async expression=>expression.includes("querySelectorAll('.quick-input-list")?vm.runInNewContext(expression,{document:{querySelectorAll:()=>rows}}):true};
 ui.workbench=async()=>target;ui.key=async()=>{};ui.input=async()=>{};ui.press=async(_target,selector)=>pressed.push(selector);
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
