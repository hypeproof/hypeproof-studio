import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import vm from 'node:vm';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const { ImageStaging } = await import(process.env.ATTACHMENT_STAGING_SOURCE ?? '../src/attachedImages.ts');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'attachment-prepare-'));
try {
 const root=path.join(tmp,'work');fs.mkdirSync(root);
 const stage=new ImageStaging(tmp,path.join(tmp,'stage'));
 stage.stage('good','good.png',Buffer.from('good')); stage.stage('bad','bad.png',Buffer.from('bad'));
 const original=fs.writeFileSync;let writes=[];
 fs.writeFileSync=(target,...args)=>{if(typeof target==='number') {const bad=path.join(root,'images','bad.png');if(fs.existsSync(bad)&&fs.statSync(bad).ino===fs.fstatSync(target).ino)throw Object.assign(new Error('permission'),{code:'EACCES'});}return original(target,...args);};
 syncBuiltinESMExports();
 let first;
 try { first=stage.commit(['good','bad'],root); } finally {fs.writeFileSync=original;syncBuiltinESMExports();}
 assert.equal(first.failed,1);assert.equal(first.failures[0].id,'bad');assert.match(first.failures[0].reason,/권한/);
 assert.ok(fs.existsSync(path.join(tmp,'stage','bad')),'failed bytes survive');
 assert.equal(stage.commit(['bad'],root).failed,0,'retry only failed input');
 const before=fs.readdirSync(path.join(root,'images')).sort();
 assert.equal(stage.commit(['good','bad'],root).failed,0);
 assert.deepEqual(fs.readdirSync(path.join(root,'images')).sort(),before,'final send reuses successful writes without duplicates');
 stage.stage('paste','paste.png',Buffer.from('pixels'));assert.deepEqual(stage.commit(['paste'],root,'assets').relPaths,['assets/paste.png']);
 fs.writeFileSync(path.join(root,'images','good.png'),'changed');assert.equal(stage.commit(['good'],root).failed,1,'changed prepared bytes refuse');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
// Run the real preparation hook with a deterministic hook scheduler and message transport.
const code=await build({entryPoints:[fileURLToPath(new URL('../webview-ui/src/AttachmentSendPreparation.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['react'],write:false});
let cursor=0,slots=[],effects=[],posted=[],listeners=new Set();
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const react={
 useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
 useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
 useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))effects.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
};
const window={acquireVsCodeApi:()=>({postMessage:m=>posted.push(m)}),addEventListener:(_,f)=>listeners.add(f),removeEventListener:(_,f)=>listeners.delete(f)};
const module={exports:{}};
vm.runInNewContext(code.outputFiles[0].text,{module,exports:module.exports,require:id=>{if(id==='react/jsx-runtime')return {};assert.equal(id,'react');return react;},window,console,crypto:webcrypto,setTimeout,clearTimeout});
const render=(scope='task-a')=>{cursor=0;effects=[];const out=module.exports.useAttachmentSendPreparation(scope);effects.forEach(f=>f());return out;};
const answer=(id,failures)=>{for(const f of listeners)f({data:{type:'attachmentsPrepared',requestId:id,failures}});};
let hook=render();const files=[{id:'a',stageId:'a'},{id:'b',stageId:'b'}];
let pending=hook.prepare(files);let req=posted.at(-1);answer(req.requestId,[{id:'b',name:'bad.png',reason:'권한을 확인해 주세요.'}]);assert.equal(await pending,false);
hook=render();assert.equal(hook.failures.length,1);hook.retry('b');req=posted.at(-1);assert.deepEqual(JSON.parse(JSON.stringify(req.files)),[files[1]],'retry transmits only failed attachment');answer(req.requestId,[]);
hook=render();assert.equal(hook.failures.length,0);
pending=hook.prepare(files);req=posted.at(-1);hook.remove('b');assert.equal(await pending,false);answer(req.requestId,[{id:'b',name:'bad.png',reason:'late'}]);hook=render();assert.equal(hook.failures.length,0,'late reply cannot resurrect removed row');
pending=hook.prepare(files);assert.equal(await hook.prepare(files),false,'double press does not start another preparation');render('task-b');assert.equal(await pending,false,'scope change cancels pending send');
assert.ok(posted.every(m=>m.type==='prepareAttachments'),'preparation never sends to model');
console.log('attachment preparation: retained failed bytes, selective retry, cached success, stale/remove/scope guards PASS');
const failuresCode=await build({entryPoints:[fileURLToPath(new URL('../webview-ui/src/AttachmentFailures.tsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',external:['react'],write:false,logLevel:'silent'});
const metadata=new Map([['hps.attachment-failures.task-a',JSON.stringify([{id:'reload',name:'photo.png',reason:'읽는 시간이 너무 길어졌어요.'}])]]);
const storage={getItem:key=>metadata.get(key)??null,setItem:(key,value)=>metadata.set(key,value),removeItem:key=>metadata.delete(key)};
const recovered={exports:{}};slots=[];listeners.clear();posted=[];
vm.runInNewContext(failuresCode.outputFiles[0].text,{module:recovered,exports:recovered.exports,require:id=>{if(id==='react/jsx-runtime')return {};assert.equal(id,'react');return react;},window,console,sessionStorage:storage,setTimeout,clearTimeout});
const renderFailure=(scope='task-a')=>{cursor=0;effects=[];const out=recovered.exports.useAttachmentFailures(scope);effects.forEach(f=>f());return out;};
let failure=renderFailure();assert.equal(failure.items[0].repick,true,'lost browser handle becomes explicit repick');failure.retry('reload');assert.equal(posted.at(-1).type,'repickAttachment');
for(const f of listeners)f({data:{type:'attachmentFailure',failure:{id:'reload',name:'photo.png',reason:'파일을 선택하지 않았어요.'}}});
failure=renderFailure();assert.equal(failure.items[0].repick,true,'Cancel leaves truthful repick action');assert.equal(failure.items[0].busy,undefined);
assert.deepEqual(Object.keys(JSON.parse(metadata.get('hps.attachment-failures.task-a'))[0]).sort(),['id','name','reason'],'metadata contains no File handle or image bytes');
failure.remove('reload');renderFailure();assert.equal(metadata.has('hps.attachment-failures.task-a'),false,'an empty failure list leaves no session storage entry');
console.log('attachment reload: metadata-only recovery, explicit repick, Cancel retention and removal PASS');
// The host never answers: the 15 s preparation deadline names every file with its own copy and the row stays removable.
{
  const timers=[];const fakeWindow={...window};
  const m2={exports:{}};
  vm.runInNewContext(code.outputFiles[0].text,{module:m2,exports:m2.exports,require:id=>{if(id==='react/jsx-runtime')return {};return react;},window:fakeWindow,console,crypto:webcrypto,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{}});
  slots=[];listeners.clear();posted=[];
  const r2=()=>{cursor=0;effects=[];const out=m2.exports.useAttachmentSendPreparation('task-timeout');effects.forEach(f=>f());return out;};
  let h2=r2();const pend=h2.prepare([{id:'t1',stageId:'t1'}]);
  const deadline=timers.find(t=>t.ms===15000);assert.ok(deadline,'preparation has a 15 s deadline');deadline.fn();
  assert.equal(await pend,false);h2=r2();
  assert.equal(h2.failures.length,1);assert.equal(h2.failures[0].reason,'파일 저장 응답이 늦어요. 이 파일만 다시 시도해 주세요.','prepare-timeout copy');
  assert.equal(h2.busy,false,'timeout releases the busy state');
  h2.remove('t1');h2=r2();assert.equal(h2.failures.length,0,'remove clears the timed-out row');
  console.log('attachment preparation timeout: exact copy, busy released, remove clears PASS');
}
