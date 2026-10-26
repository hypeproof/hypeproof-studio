import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,realpath,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskHarness} from './task-workspace-harness.mjs';
const root=await mkdtemp(join(tmpdir(),'hps-sketch-host-'));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
try{
 const f=await createTaskHarness(root),h=f.h;
 f.vscode.workspace.workspaceFolders=[{uri:{fsPath:root}}];h.context.globalState={get:()=>undefined,update:async()=>{}};
 Object.assign(h,{cachedProfile:{input:{image_paste:true}},_instructorMode:{isInstructor:false}});
 let id=0;const prepare=async(data=png,sketch=true)=>{await f.handle(f.scoped({type:'prepareAttachments',requestId:`sketch-${++id}`,sketch,files:[{id:'sketch',dataUrl:data}]}));return f.posts.filter(m=>m.type==='attachmentsPrepared').at(-1)};
 assert.equal((await prepare()).failures.length,0);const files=await readdir(join(root,'assets'));assert.equal(files.length,1);assert.match(files[0],/^pasted-\d{8}-\d{6}-1\.png$/);assert.deepEqual(await readFile(join(root,'assets',files[0])),Buffer.from(png.split(',')[1],'base64'));
 assert.equal((await prepare()).failures.length,0);assert.equal((await prepare(png,false)).failures.length,0);assert.deepEqual(await readdir(join(root,'assets')),files,'attach then ordinary send preparation reuses exact saved file');
 assert.equal(f.posts.some(m=>m.type==='streamStart'),false);
 assert.ok((await prepare('data:image/png;base64,YmFk')).failures.length);assert.ok((await prepare(png.replace('image/png','image/jpeg'))).failures.length);
 h.cachedProfile={input:{image_paste:false}};assert.ok((await prepare()).failures.length);h.cachedProfile={input:{image_paste:true}};
 f.vscode.workspace.workspaceFolders=[];assert.ok((await prepare()).failures.length,'sketch never claims saved without a workspace');f.vscode.workspace.workspaceFolders=[{uri:{fsPath:root}}];
 const canonical=await realpath(root);h.cachedProfile={activity_kind:'personal',input:{image_paste:true}};h.context.globalState={get:()=>({[f.activity.id]:{[canonical]:{level:'none',at:Date.now()}}}),update:async()=>{}};assert.ok((await prepare()).failures.length,'no-AI folder choice also refuses saving sketch');assert.deepEqual(await readdir(join(root,'assets')),files);h.cachedProfile={input:{image_paste:true}};
 const linked=join(root,'linked'),outside=join(root,'outside');await mkdir(linked);await mkdir(outside);await symlink(outside,join(linked,'assets'));f.vscode.workspace.workspaceFolders=[{uri:{fsPath:linked}}];assert.ok((await prepare()).failures.length);assert.equal((await readdir(outside)).length,0,'symlink assets never receives sketch');
 console.log('PASS real sketch preparation: exactPNG/C18 name/assets, no duplicate onsend, noautosend, invalidformat/grant/no-folder/symlink refusal');
}finally{await rm(root,{recursive:true,force:true})}
