// #3236: Exercise the production command URL expression over real HTTP and files.
// No VS Code host or installed-App claim. Run: node --experimental-strip-types test/named-html-preview.smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {serveStatic} from '../src/liveServerHelpers.ts';
const source=fs.readFileSync(new URL('../src/extension.ts',import.meta.url),'utf8');
const command=source.slice(source.indexOf('registerCommand("hypeproof-chat.previewActiveFile"'));
const calculation=command.match(/const rel = path.relative[^\n]+\n\s*const url = [^\n]+/)[0];
const makeUrl=new Function('path','root','target','base',calculation+'\nreturn url;');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-named-html-'));
const server=http.createServer((req,res)=>{const r=serveStatic(root,req.url);res.writeHead(r.status,{'content-type':r.contentType});res.end(r.body);});
const results=[];
try {
 fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><p>ORIGINAL INDEX</p>');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/`;
 for(const [i,name] of ['index.html','named.html','한글 이름.html','draft#one.html','draft?one.html','draft%one.html','literal%20name.html','nested # folder/한글 ? 100%.htm'].entries()) {
  const marker=name==='index.html'?'ORIGINAL INDEX':`PAGE_${i}`;
  fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});
  if(name!=='index.html')fs.writeFileSync(path.join(root,name),`<!doctype html><p>${marker}</p>`);
  const url=makeUrl(path,root,{fsPath:path.join(root,name)},base);
  const response=await fetch(url);const body=await response.text();
  const encoded=new URL(name.split('/').map(encodeURIComponent).join('/'),base);
  const control=await fetch(encoded);const controlBody=await control.text();
  assert.equal(control.status,200);assert.ok(controlBody.includes(marker));
  results.push({name,status:response.status,selectedContent:body.includes(marker),encodedControl:true});
 }
 assert.equal(fs.readFileSync(path.join(root,'index.html'),'utf8'),'<!doctype html><p>ORIGINAL INDEX</p>');
 console.log(JSON.stringify({calculation,results,indexUnchanged:true},null,2));
 assert.ok(results.every(r=>r.selectedContent),'Named HTML preview must serve the selected file');
} finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
