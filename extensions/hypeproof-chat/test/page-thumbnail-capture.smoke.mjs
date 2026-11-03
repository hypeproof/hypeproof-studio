import assert from 'node:assert/strict';
import {capturePageThumbnail} from '../../../scripts/patches/core/page-thumbnail-src/vs/workbench/contrib/hpsPageThumbnail/electron-browser/capture.ts';
const url='http://127.0.0.1:8000/index.html';let calls=[];
const p={create:async id=>calls.push(['create',id]),hide:async id=>calls.push(['hide',id]),layout:async(id,w,h)=>calls.push(['layout',id,w,h]),load:async(id,u)=>calls.push(['load',id,u]),state:async()=>({url,title:'page'}),screenshot:async()=> 'data:image/jpeg;base64,aGVsbG8=',destroy:async id=>calls.push(['destroy',id])};
assert.ok(await capturePageThumbnail(url,'isolated',p));
assert.deepEqual(calls,[['create','isolated'],['hide','isolated'],['layout','isolated',390,244],['load','isolated',url],['destroy','isolated']]);
for(const bad of ['https://example.com','file:///tmp/a','http://user@localhost:8000/','http://127.0.0.1/']){calls=[];assert.equal(await capturePageThumbnail(bad,'bad',p),null);assert.equal(calls.length,0)}
calls=[];assert.equal(await capturePageThumbnail(url,'redirect',{...p,state:async()=>({url:'https://example.com/',title:'wrong'})}),null);assert.equal(calls.at(-1)[0],'destroy');
calls=[];let finish;const slow=capturePageThumbnail(url,'slow',{...p,create:()=>new Promise(r=>finish=r)},20);assert.equal(await slow,null);assert.deepEqual(calls,[['destroy','slow']]);finish();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[['destroy','slow'],['destroy','slow']]);
calls=[];assert.equal(await capturePageThumbnail(url,'fail',{...p,screenshot:async()=>{throw Error('capture')}}),null);assert.equal(calls.at(-1)[0],'destroy');
console.log('PASS isolated thumbnail capture: 390px, hidden order, URL refusal, redirect rejection, timeout/late-create cleanup');
