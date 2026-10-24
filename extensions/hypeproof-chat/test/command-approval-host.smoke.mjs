import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
import {sdkToolToActionRequest} from '../src/sdkCoachHelpers.ts';
const dir=mkdtempSync(join(tmpdir(),'command-host-'));let h,f;
try{
 f=await createTaskHarness(dir);const {ChatPanelProvider}=f.internals;
 f.h.context.subscriptions=[];f.h.context.globalState={get:(_key,fallback)=>fallback,update:async()=>{}};
 // Provenance is unrelated to this presentation test; construct the real host so its request ports run.
 const record=ChatPanelProvider.prototype.provenanceRecorder;ChatPanelProvider.prototype.provenanceRecorder=()=>undefined;
 try{h=new ChatPanelProvider(f.h.context,{},{});}finally{ChatPanelProvider.prototype.provenanceRecorder=record;}
 h.taskWorkspace=f.h.taskWorkspace;h.resolveCoachCwd=()=>dir;h._instructorMode={isInstructor:false};h.coachDisplayName=()=> '코치';
 let scope='one';h.taskCommandAllowState=()=>({key:scope,refusal:null});
 // The request the host actually gets: sdkToolToActionRequest sets description to `Bash: <command>`.
 const send=command=>h.resolveActionApproval({requestId:'request',...sdkToolToActionRequest({toolName:'Bash',input:{command}})});
 const delivered=()=>f.posts.filter(m=>m.type==='commandApprovalPrompt'&&m.prompt).length;
 assert.equal(await send('ls'),false,'no chat webview at all means no approval');
 // M4: a chat webview exists and would receive the message, but neither surface is visible.
 h.editorChat={visible:false,webview:f.source};h.view={visible:false,webview:f.source};
 assert.equal(await send('ls'),false,'hidden chat panel refuses');assert.equal(delivered(),0,'hidden chat panel: no prompt delivered');
 h.view=undefined;h.editorChat={visible:true,webview:f.source};
 const latest=()=>f.posts.filter(m=>m.type==='commandApprovalPrompt'&&m.prompt).at(-1)?.prompt;
 let pending=send('ls');await new Promise(r=>setImmediate(r));const prompt=latest();assert.equal(prompt.command,'ls');assert.equal(prompt.purpose,'shell','fixed heading kind, never the request description');assert.ok(!JSON.stringify(prompt).includes('Bash'),'no tool name reaches the webview');assert.equal(prompt.rememberAllowed,true);
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:'wrong',choice:'allow'}),f.source);
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:prompt.id,choice:'remember'}),f.source);assert.equal(await pending,true);
 const before=f.posts.length;assert.equal(await send('ls'),true);assert.equal(f.posts.length,before,'remembered exact command skips presentation');
 pending=send('rm -rf build');await new Promise(r=>setImmediate(r));const destructive=latest();assert.equal(destructive.destructive,true);assert.equal(destructive.rememberAllowed,false);
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:destructive.id,choice:'deny'}),f.source);assert.equal(await pending,false);
 pending=send('cat next.txt');await new Promise(r=>setImmediate(r));scope='two';await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:latest().id,choice:'allow'}),f.source);assert.equal(await pending,false,'changed scope refuses the old answer');
 pending=send('cat third.txt');await new Promise(r=>setImmediate(r));h.endTaskCommandAllows();assert.equal(await pending,false,'task end dismisses pending approval');
 // M5: a turn that ends, stops, errors, is rejected or restarts refuses the open approval.
 for(const type of ['streamEnd','streamStopped','streamError','inputRejected','streamStart']){
  pending=send('cat turn.txt');await new Promise(r=>setImmediate(r));const open=latest();
  await h.post({type,streamId:'s',error:'x',reason:'x'});
  // Settled now, not by the three-minute timeout.
  assert.equal(await Promise.race([pending,new Promise(r=>setTimeout(()=>r('still open'),500))]),false,`${type} refuses the pending approval at once`);
  await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:open.id,choice:'allow'}),f.source);
  assert.equal(f.posts.filter(m=>m.type==='commandApprovalPrompt'&&m.prompt===null).length>0,true,`${type}: the dialog is dismissed`);
 }
 // The production destructive shape: purpose kind only, the command stays in its own block.
 pending=send('rm -rf ./node_modules/.cache/'+'deep/'.repeat(40));await new Promise(r=>setImmediate(r));const real=latest();
 assert.equal(real.purpose,'destructive');assert.equal(real.destructive,true);assert.ok(real.command.startsWith('rm -rf'));
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:real.id,choice:'deny'}),f.source);assert.equal(await pending,false);
 // The chat surface hiding while a prompt is open refuses it at once, through the listeners the
 // provider itself registers on the sidebar view and the editor panel.
 const surface=()=>{const s={visible:true,changes:[],webview:{options:{},html:'',asWebviewUri:u=>u,cspSource:'x',onDidReceiveMessage(){return{dispose(){}};},postMessage:m=>f.source.postMessage(m)}};
  s.onDidChangeVisibility=fn=>{s.changes.push(fn);return{dispose(){}};};s.onDidChangeViewState=s.onDidChangeVisibility;s.onDidDispose=()=>({dispose(){}});s.reveal=()=>{};s.dispose=()=>{};
  s.hide=()=>{s.visible=false;for(const fn of s.changes)fn();};return s;};
 const settled=p=>Promise.race([p,new Promise(r=>setTimeout(()=>r('still open'),500))]);
 // Only the surface listeners matter here; the webview HTML is not under test.
 f.vscode.Uri.joinPath=(u,...parts)=>({fsPath:[u?.fsPath??'',...parts].join('/')});h.renderHtml=()=>'';
 h.editorChat=undefined;const sidebar=surface();h.resolveWebviewView(sidebar);
 pending=send('cat hidden.txt');await new Promise(r=>setImmediate(r));let open=latest();assert.equal(open.command,'cat hidden.txt');
 sidebar.hide();assert.equal(await settled(pending),false,'sidebar hidden refuses the pending approval at once');
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:open.id,choice:'allow'}),f.source);
 h.view=undefined;const editor=surface();await h.openInEditor(editor);
 pending=send('cat editor.txt');await new Promise(r=>setImmediate(r));open=latest();assert.equal(open.command,'cat editor.txt');
 editor.hide();assert.equal(await settled(pending),false,'editor chat hidden refuses the pending approval at once');
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:open.id,choice:'allow'}),f.source);
 // Hiding one surface while the other is still on screen keeps the prompt: the learner can still answer it.
 const side2=surface();h.resolveWebviewView(side2);editor.visible=true;h.editorChat=editor;
 pending=send('cat both.txt');await new Promise(r=>setImmediate(r));open=latest();side2.hide();
 assert.equal(await Promise.race([pending,new Promise(r=>setImmediate(()=>r('still open')))]),'still open','the other visible surface keeps the prompt');
 await h.handleMessage(f.scoped({type:'commandApprovalAnswer',id:open.id,choice:'deny'}),f.source);assert.equal(await pending,false);
 console.log('PASS constructed command host: real SDK request shape, fixed purpose kind, real ports, hidden-panel gate, sidebar/editor hide refusal, turn end/stop/error refusal, actual message route, exact remember, destructive, stale scope and task end');
}finally{h?.commandApprovalRequest?.cancel();for(const sub of f?.h.context.subscriptions??[])sub.dispose?.();rmSync(dir,{recursive:true,force:true});}
