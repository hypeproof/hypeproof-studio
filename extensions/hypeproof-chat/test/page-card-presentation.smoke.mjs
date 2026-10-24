import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {capturePageResult,pageResultState,pageResultTitle} from '../src/pageCardPresentation.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hps-page-result-'));
const page=path.join(root,'index.html');const write=text=>fs.writeFileSync(page,`<title>${text}</title><p>${text}</p>`);
const png='data:image/png;base64,aGVsbG8=';
try {
 assert.equal(pageResultTitle('<title>한\u202e<b>글</b> 제목</title>','file'),'한 글 제목');
 assert.equal(pageResultState('a','a',[]),'unchecked');assert.equal(pageResultState('a','b',[]),'previous');
 write('first');let views=[];
 const ports={events:()=>[],current:()=>true,publish:v=>views.push(v),capture:async()=>({title:'캡처 제목',dataUrl:png})};
 await capturePageResult(root,'index.html',ports);
 assert.deepEqual(views.map(v=>v.thumbnail.state),['loading','ready']);assert.equal(views.at(-1).status,'unchecked');assert.equal(views.at(-1).title,'캡처 제목');
 const first=views.at(-1).versionId;assert.match(first,/^sha256:[a-f0-9]{64}$/);
 views=[];await capturePageResult(root,'index.html',{...ports,capture:async()=>{write('changed');return {title:'stale',dataUrl:png}}});
 assert.equal(views.at(-1).thumbnail.state,'failed');assert.equal(views.at(-1).status,'previous');assert.equal(views.at(-1).versionId,first);
 views=[];let aborted=false;await capturePageResult(root,'index.html',{...ports,capture:async(_p,signal)=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{})}},25);
 assert.equal(aborted,true);assert.equal(views.at(-1).thumbnail.state,'failed');
 views=[];let current=true;await capturePageResult(root,'index.html',{...ports,current:()=>current,capture:async()=>{current=false;return {title:'late',dataUrl:png}}});assert.equal(views.length,1,'no late update after task switch');
 views=[];await capturePageResult(root,'../index.html',ports);assert.equal(views.length,0);
 console.log('PASS page result presentation: real file-set version, changed capture refused, timeout, scope and path');
} finally {fs.rmSync(root,{recursive:true,force:true})}
