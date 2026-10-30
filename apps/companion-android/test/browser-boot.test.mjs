import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {mountPoint} from '../../../extensions/hypeproof-chat/test/fixtures/mini-dom.mjs';

test('actual production browser bundle boots the native initial UI with one React runtime and no Node globals',async()=>{
 let js,report;
 if(process.env.COMPANION_BOOT_BUNDLE){
  js=await readFile(process.env.COMPANION_BOOT_BUNDLE,'utf8');
  assert.equal(createHash('sha256').update(js).digest('hex'),'088d58911eabd3738483703023e46fc351f83f70dc2d66c19bc15e0d412aa4ad','baseline must be the exact main.js extracted from frozen c938 APK');
 }else{
  const {buildCompanionAndroidWeb}=await import('../build-web.mjs');
  const built=await buildCompanionAndroidWeb({client:process.env.COMPANION_CLIENT_ENTRY,selection:process.env.COMPANION_SELECTION_ENTRY,write:false});js=built.js;report=built.report;
  assert.equal(report.reactVersion,report.reactDomVersion);assert.ok(report.reactInputs.length>0);
 }
 const errors=[],posts=[],host=mountPoint();host.setAttribute('id','root');
 const native={onmessage:null,postMessage:raw=>posts.push(JSON.parse(raw))};window.CompanionNative=native;
 const consolePort={...console,error:error=>errors.push(String(error?.message??error))};
 try{
  vm.runInNewContext(js,{window,document,navigator:{userAgent:'Android browser boot fixture'},crypto,performance,TextEncoder,TextDecoder,AbortController,structuredClone,setTimeout,clearTimeout,queueMicrotask,atob,btoa,console:consolePort});
  for(let i=0;i<200&&!errors.length&&!host.findAll(e=>e.localName==='button').length;i++)await new Promise(r=>setTimeout(r,5));
  const button=host.findAll(e=>e.localName==='button'&&e.textContent==='기기 연결 확인')[0];
  assert.ok(button,'packed browser bootstrap failed: '+errors.join(' | '));assert.equal(errors.length,0);assert.equal(posts.length,0,'initial rendering must not read credentials or dispatch protocol HTTP');
  if(report&&process.env.COMPANION_BOOT_REPORT)await writeFile(process.env.COMPANION_BOOT_REPORT,JSON.stringify({...report,initialButtonRendered:true,nodeGlobalsInjected:false,nativePostsBeforeGesture:0},null,2)+'\n');
 }finally{window.dispatchEvent({type:'pagehide',bubbles:false});host.remove();delete window.CompanionNative;}
});
