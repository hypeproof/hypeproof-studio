import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
const dir=mkdtempSync(join(tmpdir(),'browser-approval-host-'));let h,f;
try{
 f=await createTaskHarness(dir);const {ChatPanelProvider}=f.internals;f.h.context.subscriptions=[];f.h.context.globalState={get:(_key,fallback)=>fallback,update:async()=>{}};
 const record=ChatPanelProvider.prototype.provenanceRecorder;ChatPanelProvider.prototype.provenanceRecorder=()=>undefined;
 try{h=new ChatPanelProvider(f.h.context,{},{});}finally{ChatPanelProvider.prototype.provenanceRecorder=record;}
 h.taskWorkspace=f.h.taskWorkspace;h.resolveCoachCwd=()=>dir;h._instructorMode={isInstructor:false};h.coachDisplayName=()=> '코치';
 const send=url=>h.resolveActionApproval({requestId:'request',kind:'openBrowser',description:'secret must not reach display',payload:{url}});
 assert.equal(await send('https://example.com'),false,'unavailable presentation refuses');h.editorChat={visible:true,webview:f.source};
 const latest=()=>f.posts.filter(m=>m.type==='browserApprovalPrompt'&&m.prompt).at(-1)?.prompt;
 const reply=choice=>h.handleMessage(f.scoped({type:'browserApprovalAnswer',id:latest().id,choice}),f.source);
 for(const url of ['javascript:alert(1)','data:text/html,hello','vscode://settings','http://','']){const count=f.posts.length;assert.equal(await send(url),false);assert.equal(f.posts.length,count,'invalid URL never raises modal');}
 let pending=send('https://user:secret@EXAMPLE.com/private?token=secret#fragment');await new Promise(r=>setImmediate(r));assert.equal(latest().host,'example.com');assert.equal(latest().label,'인터넷');assert.ok(!JSON.stringify(latest()).includes('secret'));
 await h.handleMessage(f.scoped({type:'browserApprovalAnswer',id:'foreign',choice:'open'}),f.source);await reply('remember');assert.equal(await pending,true);
 const before=f.posts.length;assert.equal(await send('https://example.com/next'),true);assert.equal(f.posts.length,before,'same origin reuses permission');
 for(const url of ['https://example.com:8443/','http://example.com/']){pending=send(url);await new Promise(r=>setImmediate(r));await reply('deny');assert.equal(await pending,false,'different port or scheme asks');}
 for(const [url,host,label] of [['http://localhost:3000/','localhost','내 미리보기'],['http://localhost.evil.com/','localhost.evil.com','인터넷'],['https://аррӏе.com/','xn--80ak6aa92e.com','인터넷'],[undefined,'빈 브라우저','아직 주소 없음'],['file://'+dir+'/index.html','작업 폴더/index.html','내 컴퓨터 파일']]){pending=send(url);await new Promise(r=>setImmediate(r));assert.equal(latest().host,host);assert.equal(latest().label,label);await reply('deny');assert.equal(await pending,false);}
 pending=send('https://different.example/');await new Promise(r=>setImmediate(r));h.profileGeneration++;await reply('remember');assert.equal(await pending,false,'old profile generation cannot grant permission');assert.equal(h.approvedBrowserOrigins.has('https://different.example'),false);
 pending=send('https://stopped.example/');await new Promise(r=>setImmediate(r));await h.post({type:'streamStopped'});assert.equal(await pending,false,'stop cancels approval');
 console.log('PASS constructed browser host: URL gate, real message route, scope, normalized safe target, exact origin reuse, ports/schemes, preview lookalikes, IDN, blank/file and cancellation');
}finally{h?.browserApprovalRequest?.cancel();for(const sub of f?.h.context.subscriptions??[])sub.dispose?.();rmSync(dir,{recursive:true,force:true});}
