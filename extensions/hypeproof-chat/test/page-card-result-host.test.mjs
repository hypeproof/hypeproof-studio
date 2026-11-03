import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
test('real provider enriches exact card, captures served path, and refreshes changed version without losing image',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hps-result-host-'));
 try {
  const f=await createTaskHarness(root,()=>{},{configureVscode:v=>{v.RelativePattern=class {constructor(base,pattern){this.base=base;this.pattern=pattern}}}});f.h.pageCardRefreshEpoch=0;f.h.verifyRecorder=async()=>({events:()=>[]});
  const watchers=[];
  f.vscode.workspace.createFileSystemWatcher=()=>{const w={disposed:false,onDidChange(fn){this.change=fn},onDidCreate(fn){this.create=fn},onDidDelete(fn){this.delete=fn},dispose(){this.disposed=true}};watchers.push(w);return w};
  const work=path.join(root,'work');await fs.mkdir(work);await fs.writeFile(path.join(work,'index.html'),'<title>첫 판</title>');
  const key=f.h.turnRestoreTaskKey();f.h.pageCards.add(key,work,{turnId:'t',anchorId:'a',pages:[{path:'index.html',kind:'added'}]});
  const calls=[];f.h.liveServer={ensure:async r=>{assert.equal(r,work);return 'http://127.0.0.1:8000/'},currentRoot:()=>work};
  f.vscode.commands.executeCommand=async(...args)=>{calls.push(args);return {title:'실제 페이지',dataUrl:'data:image/jpeg;base64,aGVsbG8='}};
  await f.h.enrichPageCard(key,work,'t');
  const p=f.h.pageCards.get(key,'t').pages[0].presentation;assert.equal(p.status,'unchecked');assert.equal(p.thumbnail.state,'ready');assert.deepEqual(calls,[['_hps.pageThumbnail.capture','http://127.0.0.1:8000/index.html']]);
  assert.equal(watchers.length,1);
  f.h.pageCards.setPresentation(key,'t','index.html',{...p,status:'verified'});
  watchers[0].change({fsPath:path.join(work,'.hidden-style.css')});
  assert.equal(f.h.pageCards.get(key,'t').pages[0].presentation.status,'unchecked','even hidden assets invalidate a displayed badge immediately');
  clearTimeout(f.h.pageCardRefreshTimer);
  await fs.writeFile(path.join(work,'index.html'),'<title>다음 판</title>');await f.h.refreshPageCardStates();
  const old=f.h.pageCards.get(key,'t').pages[0].presentation;assert.equal(old.status,'previous');assert.equal(old.versionId,p.versionId);assert.deepEqual(old.thumbnail,p.thumbnail);
  f.h.pageCards.add(key,work,{turnId:'other',anchorId:'b',pages:[{path:'index.html',kind:'added'}]});
  f.h.liveServer.currentRoot=()=>path.join(root,'another-live-preview');
  f.h.liveServer.ensure=async()=>{throw Error('must not replace another live preview')};
  const before=calls.length;
  await f.h.enrichPageCard(key,work,'other');
  assert.equal(calls.length,before);
  assert.equal(f.h.pageCards.get(key,'other').pages[0].presentation.thumbnail.state,'failed');
  f.h.pageCardScope=()=> 'different-activity';
  f.h.postPageCards();
  assert.deepEqual(f.posts.filter(m=>m.type==='pageCardsState').at(-1).cards,[], 'another activity cannot inherit task-key cards');
  assert.equal(f.h.pageCards.entry(key,'t'),undefined);
  assert.equal(watchers[0].disposed,true);
  const postCount=f.posts.length;watchers[0].change({fsPath:path.join(work,'index.html')});
  assert.equal(f.posts.length,postCount,'disposed watcher cannot mutate the new activity');

 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('capture finishing after activity switch cannot publish into the replacement registry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hps-result-late-'));
 try {
  const f=await createTaskHarness(root);f.h.pageCardRefreshEpoch=0;f.h.verifyRecorder=async()=>({events:()=>[]});
  await fs.writeFile(path.join(root,'index.html'),'<title>old activity</title>');
  const key=f.h.turnRestoreTaskKey();f.h.pageCards.add(key,root,{turnId:'t',anchorId:'a',pages:[{path:'index.html',kind:'added'}]});
  f.h.liveServer={ensure:async()=> 'http://127.0.0.1:8000/',currentRoot:()=>root};
  let finish,entered;const started=new Promise(r=>entered=r);
  f.vscode.commands.executeCommand=()=>{entered();return new Promise(r=>finish=r)};
  const capture=f.h.enrichPageCard(key,root,'t');await started;
  f.h.pageCardScope=()=> 'new-activity';f.h.annotationScope=()=> 'new-activity:task';f.h.postPageCards();
  finish({title:'late',dataUrl:'data:image/jpeg;base64,aGVsbG8='});await capture;
  assert.deepEqual(f.posts.filter(m=>m.type==='pageCardsState').at(-1).cards,[]);
  assert.equal(f.h.pageCards.entry(key,'t'),undefined);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
