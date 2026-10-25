import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
const root=await mkdtemp(join(tmpdir(),'hps-mention-host-'));
try{
 let pause=null,entered=null;
 const f=await createTaskHarness(root,()=>{},{beforeReadDir:async()=>{if(pause){entered?.();await pause;}}}),h=f.h;
 Object.assign(h,{cachedProfile:{activity_kind:'personal',sdk_tools:{read:true}},_instructorMode:{isInstructor:false},profileGeneration:1,failedAttachmentReads:new Map(),fileMentionSearches:new Map()});
 f.vscode.workspace.workspaceFolders=[{uri:{fsPath:root}}];h.context.globalState={get:()=>undefined,update:async()=>{}};
 const cwd=h.resolveCoachCwd();await writeFile(join(cwd,'note.txt'),'실제 파일 원문');await writeFile(join(cwd,'binary.bin'),Buffer.from([0,1,2]));await writeFile(join(cwd,'other.txt'),'다른 파일');
 const send=message=>f.handle(f.scoped(message));
 const search=async(id,query='')=>{await send({type:'fileMentionSearch',requestId:id,query});return f.posts.filter(m=>m.type==='fileMentionResults').at(-1)};
 const pick=async(id,path)=>{await send({type:'fileMentionPick',requestId:id,path});return f.posts.filter(m=>m.type==='fileMentionPicked').at(-1)};
 assert.ok((await search('valid')).files.some(file=>file.path==='note.txt'));
 assert.equal((await pick('valid','note.txt')).ok,true);assert.equal(h.pendingFileAttachment.preview.text,'실제 파일 원문');
 assert.equal(f.posts.some(m=>m.type==='streamStart'),false,'selection does not send');
 h.clearFileAttachment();await search('forged');assert.equal((await pick('forged','../secret.txt')).ok,false);assert.equal(h.pendingFileAttachment,null);
 // A real, readable in-root text file that the current list did not offer is refused (the offered-list guard, not the outside check).
 h.clearFileAttachment();assert.deepEqual((await search('narrow','note')).files.map(file=>file.path),['note.txt']);assert.equal((await pick('narrow','other.txt')).ok,false,'pick outside the offered list is refused');assert.equal(h.pendingFileAttachment,null);
 await search('cancel');await send({type:'fileMentionCancel',requestId:'cancel'});assert.equal((await pick('cancel','note.txt')).ok,false);
 await search('generation');h.profileGeneration++;assert.equal((await pick('generation','note.txt')).ok,false);
 await search('gate');h.cachedProfile={activity_kind:'personal',sdk_tools:{read:false}};assert.equal((await pick('gate','note.txt')).ok,false);assert.ok((await search('denied')).error);
 h.cachedProfile={activity_kind:'classroom',minor_cohort:true,sdk_tools:{read:true}};assert.ok((await search('minor')).error);
 h.cachedProfile={activity_kind:'personal',sdk_tools:{read:true}};await search('binary');assert.equal((await pick('binary','binary.bin')).ok,false);assert.equal(h.pendingFileAttachment,null);
 await search('old-task');const count=f.posts.length;await f.handle({...f.scoped({type:'fileMentionPick',requestId:'old-task',path:'note.txt'}),taskId:'foreign-task'});assert.equal(f.posts.length,count+1);assert.equal(f.posts.at(-1).type,'taskWorkspaceError');assert.equal(h.pendingFileAttachment,null);
 // Two panels (sidebar + editor chat) that both use the same request id, as the old per-webview counter did: each sees only its own list and pick.
 h.clearFileAttachment();const postsB=[],panelB={postMessage:async message=>{postsB.push(JSON.parse(JSON.stringify(message)));return true;}};h.view={webview:panelB};
 const sendB=message=>h.handleMessage(f.scoped(message),panelB),mark=f.posts.length;
 await send({type:'fileMentionSearch',requestId:'mention-1',query:'note'});await sendB({type:'fileMentionSearch',requestId:'mention-1',query:'other'});
 const listsA=f.posts.slice(mark).filter(m=>m.type==='fileMentionResults'),listsB=postsB.filter(m=>m.type==='fileMentionResults');
 assert.deepEqual(listsA.map(m=>m.files.map(file=>file.path)),[['note.txt']],'panel A receives only its own list');
 assert.deepEqual(listsB.map(m=>m.files.map(file=>file.path)),[['other.txt']],'panel B receives only its own list');
 assert.equal((await pick('mention-1','note.txt')).ok,true,'panel A pick still current after panel B searched');
 assert.equal(postsB.filter(m=>m.type==='fileMentionPicked').length,0,'panel B never sees panel A pick result');
 await sendB({type:'fileMentionPick',requestId:'mention-1',path:'other.txt'});assert.deepEqual(postsB.filter(m=>m.type==='fileMentionPicked').map(m=>m.ok),[true]);
 assert.equal(f.posts.slice(mark).filter(m=>m.type==='fileMentionPicked').length,1,'panel A received exactly its own pick result');
 h.view=undefined;h.clearFileAttachment();
 const beforeLate=f.posts.filter(m=>m.type==='fileMentionResults').length;let release;pause=new Promise(resolve=>release=resolve);const began=new Promise(resolve=>entered=resolve);const late=send({type:'fileMentionSearch',requestId:'late-generation',query:''});await began;h.profileGeneration++;release();await late;pause=null;assert.equal(f.posts.filter(m=>m.type==='fileMentionResults').length,beforeLate,'profile change suppresses in-flight directory result');
 console.log('PASS actual host mention selection: standard attachment, no send, forged path/cancel/profile generation/revoked grant/minor/stale task/binary refusal, not-offered pick refused, two panels isolated');
}finally{await rm(root,{recursive:true,force:true})}
