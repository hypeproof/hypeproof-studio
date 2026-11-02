import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const dir = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const H = await import(process.env.ARTIFACT_RESTORE_SOURCE ?? '../src/turnRestore.ts');
const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'history-panel-')));
const panels=[], commands=[], confirmations=[], providers=new Map();
let answer, onConfirm=async()=>{}, tabs=[], closed=[];
class Diff {constructor(original, modified){this.original=original;this.modified=modified;}}
const uri = s => ({toString:()=>s});
const native={ViewColumn:{Beside:2},Uri:{parse:uri},TabInputTextDiff:Diff,
  workspace:{registerTextDocumentContentProvider:(scheme,p)=>{providers.set(scheme,p);return {dispose(){providers.delete(scheme);}};}},
  window:{tabGroups:{all:[{get tabs(){return tabs;}}],close:async t=>{closed.push(...t);tabs=tabs.filter(x=>!t.includes(x));return true;}},
    createWebviewPanel:(type,title,column,options)=>{const p={type,title,column,options, messages:[],webview:{html:'',onDidReceiveMessage(fn){p.receive=fn;},postMessage(m){p.messages.push(m);return Promise.resolve(true);}},onDidDispose(fn){p.dispose=fn;}};panels.push(p);return p;},
    showWarningMessage:async(...args)=>{confirmations.push(args);await onConfirm();return answer;}},
  commands:{executeCommand:async(...args)=>{commands.push(args);tabs.push({input:new Diff(args[1],args[2])});}}
};
const entry=process.env.ARTIFACT_PANEL_SOURCE ?? path.join(dir,'src/artifactHistoryPanel.ts');
const built=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false,logLevel:'silent'});
const module={exports:{}};
vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?native:require(id),process,Buffer,console,TextDecoder,setTimeout,clearTimeout});
const {ArtifactHistoryPanel,artifactHistoryHtml,historyRelativeTime}=module.exports;
try{
  // An empty text file is a valid version on either side of a comparison.
  for (const [before, after] of [['', 'new content'], ['old content', '']]) {
    const root = await fs.mkdtemp(path.join(tmp, 'empty-'));
    const file = path.join(root, 'page.txt'), store = H.artifactHistoryStore(tmp, root, 'page.txt');
    await fs.writeFile(file, before);
    const previous = await H.captureArtifactVersion(store, root, 'page.txt', 'unknown');
    await fs.writeFile(file, after);
    const panel = new ArtifactHistoryPanel({store, root, rel:'page.txt', current:()=>true, writeAllowed:()=>true,
      canStart:()=>true, busy:()=>{}, restored:async()=>{}, attest:async()=>{}});
    await panel.open();
    const ui = panels.at(-1), count = commands.length;
    await panel.handle({action:'compare', id:previous.id});
    assert.equal(commands.length, count + 1, 'empty text versions must open the diff');
    const [command, left, right] = commands.at(-1);
    assert.equal(command, 'vscode.diff');
    const provider = providers.get(left.toString().split(':')[0]);
    assert.equal(provider.provideTextDocumentContent(left), before);
    assert.equal(provider.provideTextDocumentContent(right), after);
    assert.equal(ui.messages.at(-1).compared, previous.id);
    assert.equal(ui.messages.at(-1).error, undefined);
    ui.dispose();
    await new Promise(r=>setImmediate(r));
  }
  commands.length = 0; closed.length = 0;
  const root=path.join(tmp,'work');await fs.mkdir(root);
  const file=path.join(root,'page.txt'),store=H.artifactHistoryStore(tmp,root,'page.txt');
  await fs.writeFile(file,'first AI');const first=await H.captureArtifactVersion(store,root,'page.txt','ai');
  await fs.writeFile(file,'second learner');const second=await H.captureArtifactVersion(store,root,'page.txt','learner');
  await fs.writeFile(file,'third unknown');
  let current=true,write=true,busy=false,restored=0,attested=0;
  const context={store,root,rel:'page.txt',current:()=>current,writeAllowed:()=>write,canStart:()=>!busy,busy:v=>{busy=v;},restored:async()=>{restored++;},attest:async()=>{attested++;}};
  const panel=new ArtifactHistoryPanel(context);await panel.open();const ui=panels.at(-1);
  assert.equal(ui.column,2);assert.deepEqual(Array.from(ui.options.localResourceRoots),[]);
  assert.match(ui.webview.html,/>AI<\/span>/);assert.match(ui.webview.html,/>나<\/span>/);assert.match(ui.webview.html,/>기록 없음<\/span>/);assert.match(ui.webview.html,/<strong>지금<\/strong>/);
  assert.equal(historyRelativeTime(1000,1000),'방금');assert.equal(historyRelativeTime(0,120000),'2분 전');assert.equal(historyRelativeTime(0,7200000),'2시간 전');assert.equal(historyRelativeTime(0,172800000),'2일 전');
  await panel.handle({action:'compare',id:first.id});assert.equal(commands.at(-1)[0],'vscode.diff');
  const [_,left,right]=commands.at(-1);const provider=providers.get(left.toString().split(':')[0]);
  assert.equal(provider.provideTextDocumentContent(left),'first AI');assert.equal(provider.provideTextDocumentContent(right),'third unknown');
  assert.equal(ui.messages.at(-1).compared,first.id);
  const unrelated={input:new Diff(uri('unrelated:/one'),uri('unrelated:/two'))};tabs.push(unrelated);
  await panel.handle({action:'compare',id:first.id,close:true});assert.equal(closed.length,1);assert.ok(tabs.includes(unrelated));assert.equal(ui.messages.at(-1).compared,'');
  await panel.handle({action:'compare',id:first.id});const closeBeforeRefresh=closed.length;await panel.handle({action:'refresh'});assert.equal(closed.length,closeBeforeRefresh+1,'refresh closes stale comparison');
  const execute=native.commands.executeCommand;let releaseCompare;
  native.commands.executeCommand=async(...args)=>{await execute(...args);await new Promise(r=>{releaseCompare=r;});};
  const comparePending=panel.handle({action:'compare',id:first.id});
  while(!releaseCompare) await new Promise(r=>setImmediate(r));
  const pendingCommandCount=commands.length;
  const duplicateCompare=panel.handle({action:'compare',id:second.id});assert.equal(await Promise.race([duplicateCompare.then(()=>true),new Promise(r=>setTimeout(()=>r(false),250))]),true,'pending duplicate returns without starting asynchronous work');assert.equal(commands.length,pendingCommandCount,'pending read action rejects duplicate requests');
  releaseCompare();await comparePending;native.commands.executeCommand=execute;
  answer=undefined;await panel.handle({action:'restore',id:first.id});assert.equal(await fs.readFile(file,'utf8'),'third unknown');
  assert.ok(confirmations.at(-1)[0].includes(new Date(first.createdAt).toLocaleString('ko-KR')));assert.equal(confirmations.at(-1)[1].modal,true);
  answer='복원하기';onConfirm=async()=>{current=false;};await panel.handle({action:'restore',id:first.id});assert.equal(await fs.readFile(file,'utf8'),'third unknown');assert.match(ui.messages.at(-1).error,/파일이 바뀌었어요/);assert.equal(busy,false);
  current=true;onConfirm=async()=>{};write=false;await panel.handle({action:'restore',id:first.id});assert.equal(await fs.readFile(file,'utf8'),'third unknown');write=true;
  await panel.handle({action:'refresh'});assert.match(ui.webview.html,/파일이 바뀌었어요/,'error survives refresh');await panel.handle({action:'dismiss'});await panel.handle({action:'refresh'});assert.doesNotMatch(ui.webview.html,/파일이 바뀌었어요/);
  // A dismiss pressed while a restore is pending is honoured: the result must not bring the error back.
  write=false;await panel.handle({action:'restore',id:first.id});write=true;assert.match(ui.messages.at(-1).error,/파일이 바뀌었어요/,'control: an error is showing');
  {
    answer=undefined;let gate;onConfirm=()=>new Promise(r=>{gate=r;});
    const inflight=panel.handle({action:'restore',id:first.id});await new Promise(r=>setImmediate(r));assert.ok(gate,'the restore is waiting on its confirmation');
    await panel.handle({action:'dismiss'});gate();await inflight;
    assert.equal(ui.messages.at(-1).error,undefined,'a dismiss pressed while pending sticks');
    await panel.handle({action:'refresh'});assert.doesNotMatch(ui.webview.html,/파일이 바뀌었어요/,'the dismissed error does not return on refresh');
    // Control: an error that happens after the dismiss is a new error and still shows.
    answer='복원하기';onConfirm=async()=>{};write=false;await panel.handle({action:'restore',id:first.id});write=true;
    onConfirm=()=>new Promise(r=>{gate=r;});
    const failing=panel.handle({action:'restore',id:first.id});await new Promise(r=>setImmediate(r));
    await panel.handle({action:'dismiss'});current=false;gate();await failing;current=true;
    assert.match(ui.messages.at(-1).error,/파일이 바뀌었어요/,'a new failure after the dismiss is shown');
    await panel.handle({action:'dismiss'});onConfirm=async()=>{};
  }
  await panel.handle({action:'compare',id:first.id});const closeBeforeRestore=closed.length;
  await panel.handle({action:'restore',id:first.id});assert.equal(closed.length,closeBeforeRestore+1,'restore closes old current comparison');assert.equal(await fs.readFile(file,'utf8'),'first AI');assert.equal(restored,1);assert.ok((await H.listRestorePoints(store)).some(p=>p.files[0].sha256===second.files[0].sha256));
  assert.ok((await H.listRestorePoints(store)).length>=4,'restore archives current bytes');
  // Invalid identity and current revision cannot write or prompt.
  const count=confirmations.length;await panel.handle({action:'restore',id:'../../escape'});assert.equal(confirmations.length,count);
  const head=(await H.listRestorePoints(store))[0];await panel.handle({action:'restore',id:head.id});assert.equal(confirmations.length,count);
  // A concurrent panel cannot steal a pending host operation.
  busy=true;await panel.handle({action:'restore',id:second.id});assert.equal(confirmations.length,count);busy=false;
  let release;onConfirm=()=>new Promise(r=>{release=r;});
  const waiting=panel.handle({action:'restore',id:second.id});await new Promise(r=>setImmediate(r));
  await panel.handle({action:'restore',id:first.id});assert.equal(confirmations.length,count+1);release();await waiting;onConfirm=async()=>{};
  assert.equal(await fs.readFile(file,'utf8'),'second learner');
  await fs.writeFile(file,'external change');const commandsBefore=commands.length;await panel.handle({action:'compare',id:first.id});assert.equal(commands.length,commandsBefore);assert.ok(ui.messages.at(-1).error);
  await panel.handle({action:'restore',id:first.id});assert.equal(await fs.readFile(file,'utf8'),'external change');
  await panel.handle({action:'refresh'});await panel.handle({action:'attest'});assert.equal(attested,1);
  await panel.handle({action:'compare',id:second.id});const closeBeforeDispose=closed.length;
  const disposable=new ArtifactHistoryPanel(context);await disposable.open();const disposableUI=panels.at(-1);const headForDispose=(await H.listRestorePoints(store))[0];await disposable.handle({action:'compare',id:headForDispose.id});disposableUI.dispose();await new Promise(r=>setImmediate(r));assert.equal(closed.length,closeBeforeDispose+1,'dispose closes its comparison');
  // Binary, corrupt, and invalid UTF-8 snapshots never enter the text diff provider.
  await fs.writeFile(file,Buffer.from([0,1,2]));await panel.handle({action:'refresh'});const binaryHead=(await H.listRestorePoints(store))[0];assert.equal(await H.readArtifactVersion(store,binaryHead.id,'page.txt'),null,'binary snapshot cannot become text');const beforeBinary=commands.length;await panel.handle({action:'compare',id:first.id});assert.equal(commands.length,beforeBinary);assert.ok(ui.messages.at(-1).error);
  assert.equal(await H.readArtifactVersion(store,'../../escape','page.txt'),null);
  await fs.writeFile(file,Buffer.from([255,254]));const invalid=await H.captureArtifactVersion(store,root,'page.txt','unknown');assert.equal(await H.readArtifactVersion(store,invalid.id,'page.txt'),null);
  const binary=second;
  const binaryBlob=path.join(store,'blobs',binary.files[0].sha256.slice(0,2),binary.files[0].sha256);const bytes=await fs.readFile(binaryBlob);await fs.unlink(binaryBlob);const external=path.join(tmp,'outside');await fs.writeFile(external,bytes);await fs.symlink(external,binaryBlob);assert.equal(await H.readArtifactVersion(store,binary.id,'page.txt'),null);await fs.unlink(binaryBlob);await fs.writeFile(binaryBlob,bytes);
  // A corrupted oversized blob must be refused before allocating its bytes.
  const originalRead=fs.readFile, originalBytes=await fs.readFile(binaryBlob);const bigHandle=await fs.open(binaryBlob,'w');await bigHandle.truncate(H.TURN_RESTORE_LIMITS.fileMax+1);await bigHandle.close();let oversizedRead=false;
  fs.readFile=async function(target,...args){if(target===binaryBlob)oversizedRead=true;return originalRead.call(this,target,...args);};syncBuiltinESMExports();
  try{assert.equal(await H.readArtifactVersion(store,binary.id,'page.txt'),null);assert.equal(oversizedRead,false,'oversized snapshot is rejected before read');}finally{fs.readFile=originalRead;syncBuiltinESMExports();await fs.writeFile(binaryBlob,originalBytes);}
  const pointPath=path.join(store,'points',binary.id+'.json'),originalPoint=await fs.readFile(pointPath,'utf8');
  const altered=JSON.parse(originalPoint);altered.files[0].size=H.TURN_RESTORE_LIMITS.fileMax+1;await fs.writeFile(pointPath,JSON.stringify(altered));assert.equal(await H.readArtifactVersion(store,binary.id,'page.txt'),null,'oversized metadata rejected');
  const huge=Buffer.alloc(H.TURN_RESTORE_LIMITS.fileMax+1,65),hugeHash=createHash('sha256').update(huge).digest('hex'),hugeBlob=path.join(store,'blobs',hugeHash.slice(0,2),hugeHash);await fs.mkdir(path.dirname(hugeBlob),{recursive:true});await fs.writeFile(hugeBlob,'small');altered.files[0].size=5;altered.files[0].sha256=hugeHash;await fs.writeFile(pointPath,JSON.stringify(altered));
  fs.readFile=async function(target,...args){if(target===hugeBlob)await fs.writeFile(hugeBlob,huge);return originalRead.call(this,target,...args);};syncBuiltinESMExports();
  try{assert.equal(await H.readArtifactVersion(store,binary.id,'page.txt'),null,'snapshot growing during read is refused');}finally{fs.readFile=originalRead;syncBuiltinESMExports();await fs.writeFile(pointPath,originalPoint);await fs.unlink(hugeBlob);}
  const firstBlob=path.join(store,'blobs',first.files[0].sha256.slice(0,2),first.files[0].sha256);await fs.writeFile(firstBlob,'corrupt');assert.equal(await H.readArtifactVersion(store,first.id,'page.txt'),null);
  // Relative time boundaries (minute, hour, day) and which row offers which action.
  for(const [age,want] of [[59999,'방금'],[60000,'1분 전'],[59*60000,'59분 전'],[60*60000,'1시간 전'],[23*3600000+59*60000,'23시간 전'],[24*3600000,'1일 전']])assert.equal(historyRelativeTime(0,age),want,`age ${age}`);
  {
    const mk=(id,turnId)=>({id,turnId,createdAt:1000,files:[{rel:'x',sha256:'a'.repeat(64),size:1}]});
    const rowsOf=(html)=>[...html.matchAll(/<li>[\s\S]*?<\/li>/g)].map(m=>m[0]);
    const pts=[mk('h','artifact-unknown'),mk('o','artifact-ai')];
    const unknownHead=artifactHistoryHtml(pts,'h','x','n');
    const [headRow,oldRow]=rowsOf(unknownHead);
    assert.ok(!/data-action="restore"/.test(headRow),'the current row has no 복원 button');
    assert.ok(/data-action="restore" data-id="o"/.test(oldRow),'an older row can be restored');
    assert.equal((unknownHead.match(/data-action="attest"/g)??[]).length,1,'내 수정 확인 appears for an unknown head');
    for(const turnId of ['artifact-ai','artifact-learner']){
      const known=artifactHistoryHtml([mk('h',turnId),mk('o','artifact-ai')],'h','x','n');
      assert.ok(!known.includes('data-action="attest"'),`no 내 수정 확인 for a ${turnId} head`);
      assert.ok(!/data-action="restore" data-id="h"/.test(known),'the current row stays unrestorable');
    }
    // Directional marks cannot reorder the heading.
    const marked=artifactHistoryHtml([mk('h','artifact-ai')],'h','evil‏gnp.exe‎.html؜','n');
    assert.ok(!/[‎‏؜]/.test(marked),'bidi marks are replaced');
  }
  const hostile=artifactHistoryHtml([first],first.id,'<img src=x onerror=alert(1)>\u202e','nonce');assert.ok(!hostile.includes('<img'));assert.ok(hostile.includes('&lt;img'));assert.ok(!hostile.includes('\u202e'));assert.match(hostile,/default-src 'none'/);
  ui.dispose();await new Promise(r=>setImmediate(r));const beforeDispose=confirmations.length;await panel.handle({action:'restore',id:first.id});assert.equal(confirmations.length,beforeDispose);assert.equal(providers.size,0);
  if(process.env.ARTIFACT_PANEL_HTML){await fs.writeFile(process.env.ARTIFACT_PANEL_HTML,artifactHistoryHtml([first,second,{...head,turnId:'artifact-unknown'}],head.id,'나의 작품.html','fixture','복원하지 못했어요. 다시 확인해 주세요.'));}
  console.log('artifact history panel: PASS');
}finally{await fs.rm(tmp,{recursive:true,force:true});}
