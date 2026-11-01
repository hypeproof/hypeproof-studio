// #3225: actual workspace tool boundary, local synthetic files, no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {workspaceTools} from '../src/localRuntime/tools.ts';

async function fixture(run) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-large-read-'));
 const events=[];
 const tools=workspaceTools({cwd:root,profile:{sdk_tools:{read:true}},signal:new AbortController().signal,approve:async()=>{throw Error('Read must not request write approval');},activity:e=>events.push(e)});
 try {await run(root,tools,events);} finally {await fs.rm(root,{recursive:true,force:true});}
}
test('small UTF-8 read remains exact',()=>fixture(async(root,tools)=>{
 const text='<h1>내 자료</h1>\n작은 파일';await fs.writeFile(path.join(root,'small.html'),text);
 assert.equal(await tools.call('Read',{file_path:'small.html'}),text);
}));
test('workspace escape still denied',()=>fixture(async(root,tools)=>{
 await assert.rejects(tools.call('Read',{file_path:path.join(root,'../outside.txt')}));
}));
test('2 MB HTML yields bounded useful text instead of size rejection',()=>fixture(async(root,tools,events)=>{
 const header='<html><h1>Large reference</h1>\n';
 const text=header+'<p>Relevant local reference text.</p>\n'.repeat(60000)+'</html>';
 assert.ok(Buffer.byteLength(text)>2_000_000);
 await fs.writeFile(path.join(root,'large.html'),text);
 const result=await tools.call('Read',{file_path:'large.html'});
 assert.match(result,/Large reference/);
 assert.ok(Buffer.byteLength(result)<64_000,'bounded result leaves space for prior conversation');
 assert.equal(events.at(-1).isError,false);
}));
test('binary bytes never become lossy model text',()=>fixture(async(root,tools)=>{
 await fs.writeFile(path.join(root,'binary.bin'),Buffer.from([0,255,254,0,128,0,1]));
 await assert.rejects(tools.call('Read',{file_path:'binary.bin'}),/binary|바이너리|텍스트|지원/i);
}));

test('continuation reads reconstruct UTF-8 exactly across split multibyte characters',()=>fixture(async(root,tools)=>{
 const text='a'.repeat(49151)+'한글🙂'.repeat(15000)+'END';
 await fs.writeFile(path.join(root,'unicode.txt'),text);
 let offset=0,combined='',reads=0;
 do {
  const result=await tools.call('Read',{file_path:'unicode.txt',offset_bytes:offset});
  assert.ok(Buffer.byteLength(result)<64_000);
  const match=/bytes (\d+)-(\d+) of (\d+)/.exec(result);
  assert.ok(match);assert.equal(Number(match[1]),offset);
  const next=Number(match[2]);assert.ok(next>offset);
  combined+=result.slice(result.indexOf('\n\n')+2);
  offset=next;reads++;
 }while(offset<Buffer.byteLength(text));
 assert.ok(reads>2);assert.equal(combined,text);
}));
test('invalid continuation boundaries reject instead of corrupting text',()=>fixture(async(root,tools)=>{
 await fs.writeFile(path.join(root,'utf8.txt'),'한글');
 for(const offset_bytes of [-1,0.5,'1',99,1])
  await assert.rejects(tools.call('Read',{file_path:'utf8.txt',offset_bytes}));
}));
test('binary container headers reject even when caller skips the header',()=>fixture(async(root,tools)=>{
 for(const [name,text] of [['document.pdf','%PDF-1.7\nASCII content'],['document.docx','PK\x03\x04ASCII content']]) {
  await fs.writeFile(path.join(root,name),text);
  for(const offset_bytes of [0,8])
   await assert.rejects(tools.call('Read',{file_path:name,offset_bytes}),/바이너리/);
 }
}));
