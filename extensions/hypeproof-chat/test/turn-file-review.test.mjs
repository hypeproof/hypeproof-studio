import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareTurnText } from '../src/turnReviewView.ts';
import { takeRestorePoint, scanFolder, diffRestorePoint, reviewTurnFiles, restoreToPoint, listRestorePoints } from '../src/turnRestore.ts';
import { emptyLedger, observeOutsideTurn, recordHostWrite, recordRevert, provenanceView } from '../src/artifactProvenance.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';
async function fixture() {
 const tmp=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'turn-files-'))),root=join(tmp,'work'),store=join(tmp,'storage','task');await fs.mkdir(root);
 await fs.writeFile(join(root,'a.txt'),'same\nold\nend\n');await fs.writeFile(join(root,'b.txt'),'before\n');
 const {point}=await takeRestorePoint({root,store,id:'turn',turnId:'turn',kind:'turn'});
 await fs.writeFile(join(root,'a.txt'),'same\nnew\nextra\nend\n');await fs.unlink(join(root,'b.txt'));await fs.writeFile(join(root,'new.txt'),'new file\n');
 return {tmp,root,store,point,cleanup:()=>fs.rm(tmp,{recursive:true,force:true})};
}
test('physical lines, bounded text and measured bytes',async()=>{const f=await fixture();try{
 const now=await scanFolder(f.root),files=await reviewTurnFiles(f.store,f.root,f.point,now),a=files.find(x=>x.path==='a.txt');
 assert.deepEqual([a.added,a.removed],[2,1]);assert.deepEqual(a.lines.map(l=>l.kind),['same','removed','added','added','same']);
 assert.equal(files.find(x=>x.path==='b.txt').removed,1);assert.equal(files.find(x=>x.path==='new.txt').added,1);
 assert.equal(compareTurnText('a','a\n').removed,1);assert.equal(compareTurnText('','').added,0);assert.ok(compareTurnText('a\n'.repeat(501),'b').unavailable);
 await fs.writeFile(join(f.root,'a.txt'),'xxxx\nxxx\nxxxxx\nxxx\n');assert.ok((await reviewTurnFiles(f.store,f.root,f.point,now)).find(x=>x.path==='a.txt').unavailable);
 for(const content of [Buffer.from([0,1,2]),Buffer.from([255,254]),Buffer.alloc(65537,65)]){await fs.writeFile(join(f.root,'a.txt'),content);assert.ok((await reviewTurnFiles(f.store,f.root,f.point,await scanFolder(f.root))).find(x=>x.path==='a.txt').unavailable);}
 await fs.unlink(join(f.root,'a.txt'));await fs.symlink(join(f.root,'new.txt'),join(f.root,'a.txt'));assert.ok((await reviewTurnFiles(f.store,f.root,f.point,now)).find(x=>x.path==='a.txt').unavailable);
}finally{await f.cleanup();}});
test('selected add/change/delete restores only selected bytes and keeps recovery',async()=>{for(const selected of ['a.txt','b.txt','new.txt']){const f=await fixture();try{
 const before=await scanFolder(f.root),out=await restoreToPoint({...f,paths:[selected],expectedDigest:before.digest,stillCurrent:()=>true,beforeRestoreId:'undo'});assert.equal(out.ok,true,JSON.stringify({selected,out}));assert.equal(out.restored.length+out.removed.length,1);
 const after=await scanFolder(f.root);for(const file of before.files.filter(x=>x.path!==selected))assert.equal(after.files.find(x=>x.path===file.path)?.sha256,file.sha256);
 if(selected==='new.txt')await assert.rejects(fs.stat(join(f.root,selected)));else assert.equal(await fs.readFile(join(f.root,selected),'utf8'),selected==='a.txt'?'same\nold\nend\n':'before\n');
 assert.equal((await listRestorePoints(f.store)).find(x=>x.id==='undo').digest,before.digest);
}finally{await f.cleanup();}}});
test('stale digest/context and forged selection do not change files',async()=>{for(const options of [{expectedDigest:'bad'},{stillCurrent:()=>false},{paths:['../outside']}]){const f=await fixture();try{const before=await scanFolder(f.root),out=await restoreToPoint({...f,paths:['a.txt'],...options,beforeRestoreId:'undo'});assert.equal(out.touched,false);assert.equal((await scanFolder(f.root)).digest,before.digest);}finally{await f.cleanup();}}});
test('single-file provenance preserves unrelated history',()=>{
 let l=observeOutsideTurn(emptyLedger(),[{path:'a',sha256:'a0'},{path:'b',sha256:'b0'}],{at:1});l=recordHostWrite(l,[{path:'a',sha256:'a1'},{path:'b',sha256:'b1'}],{at:3,actor:'ai'});
 const next=recordRevert(l,{pointAt:2,pointFiles:[{path:'a',sha256:'a0'},{path:'b',sha256:'b0'}],at:4,paths:['a']},[{path:'a',sha256:'a0'},{path:'b',sha256:'b1'}]);assert.deepEqual(next.events.filter(x=>x.path==='b'),l.events.filter(x=>x.path==='b'));assert.ok(!next.events.some(x=>x.path==='a'&&x.sha256==='a1'));assert.deepEqual(provenanceView(next).entries.find(x=>x.path==='b'),provenanceView(l).entries.find(x=>x.path==='b'));
});
async function hostFixture(prep){const f=await fixture();if(prep)await prep(f);const h=await createTaskHarness(join(f.tmp,'host'));h.h.resolveCoachCwd=()=>f.root;h.h.profileGeneration=1;const provenance=[];h.h.provenanceRecorder=()=>({reverted:async(...args)=>provenance.push(args)});h.provenance=provenance;h.vscode.workspace.textDocuments=[];h.h.post=async message=>h.posts.push(message);
 const now=await scanFolder(f.root),changes=diffRestorePoint(f.point,now);h.h.turnReview={...f,taskKey:h.h.turnRestoreTaskKey(),measuredDigest:now.digest,view:{turnId:'turn',state:'open',...changes,notCovered:[],files:await reviewTurnFiles(f.store,f.root,f.point,now)}};
 const confirmations=[];h.vscode.window.showWarningMessage=async(...args)=>{confirmations.push(args);return '되돌리기';};return {...f,...h,confirmations,revert:extra=>h.h.handleTurnReviewMessage({type:'turnRevert',turnId:'turn',...extra})};
}
test('real host confirms exact count once, per-file leaves remaining list, all restores',async()=>{const f=await hostFixture();try{
 await f.revert({path:'a.txt'});assert.deepEqual(Array.from(f.provenance[0][3]),['a.txt']);assert.equal(f.confirmations.length,1);assert.match(f.confirmations[0][0],/파일 1개/);assert.equal(f.confirmations[0][1].modal,true);assert.equal(f.h.turnReview.view.state,'open');assert.equal(f.h.turnReview.view.changed.length,0);assert.match(f.h.turnReview.view.notice,/나머지는 그대로/);
 await f.revert();assert.equal(f.confirmations.length,2);assert.match(f.confirmations[1][0],/파일 2개/);assert.equal(f.h.turnReview.view.state,'restored');assert.equal((await scanFolder(f.root)).digest,f.point.digest);
}finally{await f.cleanup();}});
// Restore-all passes the displayed list as `paths`; empty directories the AI created must still go (real temp files).
const addNested=async f=>{await fs.mkdir(join(f.root,'newdir','deep'),{recursive:true});await fs.writeFile(join(f.root,'newdir','deep','x.txt'),'x\n');await fs.writeFile(join(f.root,'newdir','y.txt'),'y\n');};
const dirExists=p=>fs.stat(p).then(()=>true,()=>false);
test('restore-all through the real host removes the empty directories the AI created',async()=>{const f=await hostFixture(addNested);try{
 assert.deepEqual(f.h.turnReview.view.added.slice().sort(),['new.txt','newdir/deep/x.txt','newdir/y.txt']);
 await f.revert();
 assert.equal(f.h.turnReview.view.state,'restored');
 assert.equal(await dirExists(join(f.root,'newdir')),false,'newdir is gone');
 const after=await scanFolder(f.root);assert.deepEqual(after.dirs,f.point.dirs);assert.equal(after.digest,f.point.digest);
}finally{await f.cleanup();}});
test('restoring a single new file through the real host does not sweep directories',async()=>{
 const f=await hostFixture(addNested);
 try{
  await f.revert({path:'newdir/deep/x.txt'});
  assert.equal(await dirExists(join(f.root,'newdir','deep')),true,'single-file restore does not sweep directories');
  assert.equal(await fs.readFile(join(f.root,'newdir','y.txt'),'utf8'),'y\n');
 }finally{await f.cleanup();}
});
test('library: sweepDirs removes empty new directories deepest first, never a directory the point had or one that is not empty',async()=>{
 const tmp=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'sweep-'))),root=join(tmp,'work'),store=join(tmp,'storage','task');
 try{
  await fs.mkdir(join(root,'had'),{recursive:true});await fs.writeFile(join(root,'a.txt'),'a\n');
  const {point}=await takeRestorePoint({root,store,id:'turn',turnId:'turn',kind:'turn'});
  await fs.mkdir(join(root,'n1','n2'),{recursive:true});await fs.writeFile(join(root,'n1','n2','f.txt'),'f\n');
  await fs.mkdir(join(root,'other'));await fs.writeFile(join(root,'other','note.txt'),'user');
  const now=await scanFolder(root);
  // A filtered restore (single file) keeps the directories.
  const one=await restoreToPoint({root,store,point,paths:['n1/n2/f.txt'],expectedDigest:now.digest,beforeRestoreId:'u1'});
  assert.equal(one.ok,true);assert.equal(await dirExists(join(root,'n1','n2')),true);
  await fs.writeFile(join(root,'n1','n2','f.txt'),'f\n');
  // Same selection with sweepDirs: n1/n2 and n1 go; `had` stays (the point had it); `other` is only removed if it is empty.
  const now2=await scanFolder(root);
  const all=await restoreToPoint({root,store,point,paths:['n1/n2/f.txt','other/note.txt'],sweepDirs:true,expectedDigest:now2.digest,beforeRestoreId:'u2'});
  assert.equal(all.ok,true,JSON.stringify(all.failed));
  assert.equal(await dirExists(join(root,'n1')),false);assert.equal(await dirExists(join(root,'other')),false);assert.equal(await dirExists(join(root,'had')),true);
  const after=await scanFolder(root);assert.deepEqual(after.dirs,point.dirs);assert.equal(after.digest,point.digest);
  // A directory that still holds a file we did not select is never removed.
  await fs.mkdir(join(root,'mix'));await fs.writeFile(join(root,'mix','a.txt'),'1');await fs.writeFile(join(root,'mix','b.txt'),'2');
  const now3=await scanFolder(root);
  const partial=await restoreToPoint({root,store,point,paths:['mix/a.txt'],sweepDirs:true,expectedDigest:now3.digest,beforeRestoreId:'u3'});
  assert.equal(partial.ok,true);assert.equal(await dirExists(join(root,'mix')),true);assert.equal(await fs.readFile(join(root,'mix','b.txt'),'utf8'),'2');
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('real host cancel, stale context, dirty aliases, forged path, double press and edits fail closed',async()=>{for(const kind of ['cancel','profile','task','dirty','alias','forged','busy','double','changed','root','connection','instructor','stream','pending','changing','verify','review']){const f=await hostFixture();try{
 const original=await scanFolder(f.root);let release;
 if(kind==='dirty')f.vscode.workspace.textDocuments=[{isDirty:true,uri:{scheme:'file',fsPath:join(f.root,'a.txt')}}];
 if(kind==='alias'){await fs.symlink(f.root,join(f.tmp,'alias'));f.vscode.workspace.textDocuments=[{isDirty:true,uri:{scheme:'file',fsPath:join(f.tmp,'alias','a.txt')}}];}
 if(kind==='busy')f.h.pendingSends=1;
 f.vscode.window.showWarningMessage=async(...args)=>{f.confirmations.push(args);if(kind==='cancel')return undefined;if(kind==='root')f.h.resolveCoachCwd=()=>f.tmp;if(kind==='connection')f.h.connectionChanging=true;if(kind==='instructor')f.h._instructorMode={isInstructor:true};if(kind==='stream')f.h.activeStreams.set('other',{});if(kind==='pending')f.h.pendingSends=1;if(kind==='changing')f.h.taskChanging=true;if(kind==='verify')f.h.verifySession={running:true};if(kind==='review')f.h.turnReview={...f.h.turnReview};if(kind==='profile')f.h.profileGeneration++;if(kind==='task')f.h.turnRestoreTaskKey=()=> 'another-task';if(kind==='changed')await fs.writeFile(join(f.root,'a.txt'),'newer user edit');if(kind==='double')return new Promise(r=>{release=r;});return '되돌리기';};
 const action=f.revert({path:kind==='forged'?'../outside':'a.txt'});if(kind==='double'){while(!release)await new Promise(r=>setTimeout(r,1));await f.revert({path:'b.txt'});assert.equal(f.confirmations.length,1);release(undefined);}await action;
 if(kind==='forged')assert.equal(f.confirmations.length,0);
 if(kind==='changed')assert.equal(await fs.readFile(join(f.root,'a.txt'),'utf8'),'newer user edit');else assert.equal((await scanFolder(f.root)).digest,original.digest,kind);
}finally{await f.cleanup();}}});

test('aggregate comparison budget and file count stay bounded',async()=>{
 const f=await fixture();try{
  await fs.rm(f.root,{recursive:true});await fs.mkdir(f.root);
  const empty=(await takeRestorePoint({...f,id:'empty',turnId:'empty',kind:'turn'})).point;
  for(let i=0;i<201;i++)await fs.writeFile(join(f.root,`file-${String(i).padStart(3,'0')}`),'one');
  let files=await reviewTurnFiles(f.store,f.root,empty,await scanFolder(f.root));
  assert.equal(files.filter(x=>x.lines).length,200);assert.ok(files.at(-1).unavailable);
  await fs.rm(f.root,{recursive:true});await fs.mkdir(f.root);
  for(let i=0;i<10;i++)await fs.writeFile(join(f.root,`file-${i}`),'x'.repeat(65536));
  files=await reviewTurnFiles(f.store,f.root,empty,await scanFolder(f.root));assert.equal(files.filter(x=>x.lines).length,8);assert.ok(files[8].unavailable);
 }finally{await f.cleanup();}
});

// Inject filesystem races at the real module's async boundary, with bytes on disk.
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import * as syncFs from 'node:fs';
const require=createRequire(import.meta.url);
const raceBundle=await build({stdin:{contents:"export {restoreToPoint,reviewTurnFiles} from './src/turnRestore.ts'",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
function raceModule(sync={},async={}){const module={exports:{}};vm.runInNewContext(raceBundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='node:fs'?{...syncFs,...sync}:id==='node:fs/promises'?{...require(id),...async}:require(id),Buffer,TextDecoder,console,process,setTimeout,clearTimeout});return module.exports;}

test('bounded reader refuses growth and path substitution at open',async()=>{
 for(const kind of ['growth','link','parent']){const f=await fixture();try{
  const now=await scanFolder(f.root);let invoked=false;
  const m=raceModule({openSync:(p,flags)=>{
   if(p===join(f.root,'a.txt')&&!invoked){invoked=true;
    if(kind==='growth')syncFs.writeFileSync(p,'x'.repeat(70000));
    else {const outside=join(f.tmp,'outside');syncFs.mkdirSync(outside);syncFs.writeFileSync(join(outside,'a.txt'),'same\nnew\nextra\nend\n');
     if(kind==='link'){syncFs.unlinkSync(p);syncFs.symlinkSync(join(outside,'a.txt'),p);}
     else {syncFs.renameSync(f.root,f.root+'-old');syncFs.symlinkSync(outside,f.root);}
    }
   }
   return syncFs.openSync(p,flags);
  }});
  const result=await m.reviewTurnFiles(f.store,f.root,f.point,now);assert.ok(result.find(x=>x.path==='a.txt').unavailable,kind);
 }finally{await f.cleanup();}}
});

test('restore guards context before creating parents and catches exact-byte edits before mutation',async()=>{
 for(const kind of ['context','hash','parent']){const f=await fixture();try{
  let current=true,swapped=false;
  const before=await scanFolder(f.root);
  const m=raceModule({writeFileSync:(p,data,options)=>{
   if(String(p).includes('.hps-restore-')&&!swapped){swapped=true;
    if(kind==='hash')syncFs.writeFileSync(join(f.root,'a.txt'),'user edit');
    if(kind==='parent'){
     const outside=join(f.tmp,'outside');syncFs.mkdirSync(outside);syncFs.writeFileSync(join(outside,'a.txt'),'same\nnew\nextra\nend\n');
     syncFs.renameSync(f.root,f.root+'-old');syncFs.symlinkSync(outside,f.root);
    }
   }
   return syncFs.writeFileSync(p,data,options);
  }},{readFile:async(p,...args)=>{
   const data=await fs.readFile(p,...args);
   if(kind==='context'&&String(p).includes('/blobs/'))current=false;
   return data;
  }});
  const out=await m.restoreToPoint({...f,paths:['a.txt'],expectedDigest:before.digest,stillCurrent:()=>current,beforeRestoreId:'race'});
  assert.equal(out.ok,false,kind);
  if(kind==='context'){assert.equal(out.touched,false);assert.equal((await scanFolder(f.root)).digest,before.digest);assert.equal(swapped,false);}
  if(kind==='hash')assert.equal(await fs.readFile(join(f.root,'a.txt'),'utf8'),'user edit');
  if(kind==='parent')assert.equal(await fs.readFile(join(f.tmp,'outside','a.txt'),'utf8'),'same\nnew\nextra\nend\n');
 }finally{await f.cleanup();}}
});

test('two restore callers serialize and second stale request never overwrites the first',async()=>{
 const f=await fixture();try{
  const before=await scanFolder(f.root);
  const result=await Promise.all(['first','second'].map(id=>restoreToPoint({...f,paths:['a.txt'],expectedDigest:before.digest,beforeRestoreId:id})));
  assert.equal(result.filter(x=>x.ok).length,1);assert.equal(result.filter(x=>x.error==='context_changed').length,1);
  assert.equal(await fs.readFile(join(f.root,'a.txt'),'utf8'),'same\nold\nend\n');
 }finally{await f.cleanup();}
});

test('restoring one file does not invent a history event for an unrelated first observation',()=>{
 const l=observeOutsideTurn(emptyLedger(),[{path:'a',sha256:'a1'},{path:'b',sha256:'b1'}],{at:3});
 const after=recordRevert(l,{pointAt:1,pointFiles:[{path:'a',sha256:'a0'},{path:'b',sha256:'b0'}],at:4,paths:['a']},[{path:'a',sha256:'a0'},{path:'b',sha256:'b1'}]);
 assert.deepEqual(after.events.filter(x=>x.path==='b'),[]);
});
