import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileMentionsAllowed,listMentionFiles} from '../src/workspaceFileMentions.ts';
assert.equal(fileMentionsAllowed({sdk_tools:{read:true},activity_kind:'personal'},false),true);
assert.equal(fileMentionsAllowed({sdk_tools:{read:true},minor_cohort:false},false),true);
for(const p of [undefined,{}, {minor_cohort:false}, {sdk_tools:{read:true},minor_cohort:true}, {sdk_tools:{read:true}}])assert.equal(fileMentionsAllowed(p,false),false);
assert.equal(fileMentionsAllowed({sdk_tools:{read:true},activity_kind:'personal'},true),false);
const root=await mkdtemp(join(tmpdir(),'hps-mention-')),outside=await mkdtemp(join(tmpdir(),'hps-mention-out-'));
try{
 await mkdir(join(root,'nested'));await mkdir(join(root,'.private'));
 await writeFile(join(root,'one.txt'),'hello');await writeFile(join(root,'nested','한국어.md'),'자료');await writeFile(join(root,'.secret'),'secret');await writeFile(join(root,'.private','hidden.txt'),'hidden');await writeFile(join(outside,'foreign.txt'),'foreign');
 await symlink(outside,join(root,'escape'));await symlink(join(outside,'foreign.txt'),join(root,'link.txt'));
 const all=await listMentionFiles(root);assert.deepEqual(all.files.map(f=>f.path),['one.txt','nested/한국어.md']);assert.equal(all.files[0].bytes,5);assert.equal(all.limited,false);
 assert.deepEqual((await listMentionFiles(root,'한국')).files.map(f=>f.path),['nested/한국어.md']);assert.equal((await listMentionFiles(root,'NOPE')).files.length,0);
 assert.equal((await listMentionFiles(root,'',1)).limited,true);await assert.rejects(listMentionFiles(join(root,'missing')));
 // NFD-stored Korean name (macOS downloads/apps) found by the NFC query an IME produces; the stored path is returned untouched.
 const nfd='보고서.txt'.normalize('NFD');assert.notEqual(nfd,'보고서.txt');await writeFile(join(root,nfd),'보고');
 const korean=await listMentionFiles(root,'보고서'.normalize('NFC'));assert.deepEqual(korean.files.map(f=>f.path),[nfd],'NFC query finds an NFD-stored name and keeps its stored spelling');
 assert.deepEqual((await listMentionFiles(root,'보고서'.normalize('NFD'))).files.map(f=>f.path),[nfd],'NFD query also matches');
 // Heavy dependency folders (VS Code default excludes) never use the 5,000-entry budget.
 const heavy=await mkdtemp(join(tmpdir(),'hps-mention-heavy-'));
 try{
  await mkdir(join(heavy,'node_modules','pkg'),{recursive:true});await Promise.all(Array.from({length:5200},(_,i)=>writeFile(join(heavy,'node_modules','pkg',`f${i}.js`),'')));
  await mkdir(join(heavy,'zz-notes'));await writeFile(join(heavy,'zz-notes','learner-plan.md'),'plan');
  const r=await listMentionFiles(heavy,'learner');assert.deepEqual(r.files.map(f=>f.path),['zz-notes/learner-plan.md']);assert.equal(r.limited,false,'node_modules did not exhaust the budget');
  assert.equal((await listMentionFiles(heavy,'pkg')).files.length,0,'nothing under node_modules is offered');
 }finally{await rm(heavy,{recursive:true,force:true})}
 console.log('PASS workspace mention gate and real filesystem: scoped names/sizes, nested/query, hidden/symlink exclusion, visible limit, missing-root error, NFD/NFC Korean match, node_modules skipped');
}finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true})}
