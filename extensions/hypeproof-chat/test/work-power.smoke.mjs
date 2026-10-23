import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WorkPower, nativePowerCommand, WINDOWS_POWER_SCRIPT, workPower } from '../src/workPower.ts';
import { downloadVerifiedUpdate } from '../src/updateTransport.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createTaskHarness } from './task-workspace-harness.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fake() { const p = new EventEmitter(); p.stdin = new PassThrough(); p.kills = 0; p.kill = () => { p.kills++; return true; }; return p; }
const children = [];
const start = () => { const p=fake(); children.push(p); return p; };
let warnings=0;
const power = new WorkPower(start, () => warnings++);
const a=power.acquire('coach-turn'), b=power.acquire('preview-build'), c=power.acquire('update-download');
assert.equal(children.length,1,'overlapping work shares one assertion');
a(); a(); b(); assert.equal(children[0].kills,0,'duplicate/early releases cannot end another lease');
c(); assert.equal(children[0].kills,1,'last completion releases synchronously');
const d=power.acquire('coach-turn'); assert.equal(children.length,2,'new turn reacquires');
children[0].emit('exit'); children[0].emit('error',Error('late')); assert.equal(warnings,1); warnings=0; power.dispose(); assert.equal(power.leases.size,0,'dispose clears pending identities before callbacks settle'); assert.equal(children[1].kills,1,'stale helper exit cannot clear new helper');
d(); power.acquire('coach-turn'); assert.equal(children.length,2,'disposed host cannot reacquire');
assert.equal(children[1].kills,1,'late completion after disposal is harmless');
const one=new WorkPower(start), two=new WorkPower(start); const x=one.acquire('coach-turn'),y=two.acquire('coach-turn');
x(); assert.equal(children.at(-1).kills,0,'another window owns its assertion'); y();
const failed=new WorkPower(()=>{throw Error('spawn');},()=>warnings++); failed.acquire('coach-turn')(); assert.equal(warnings,1,'spawn failure does not fail the learner turn');
const errors=new WorkPower(start,()=>warnings++); const e=errors.acquire('coach-turn'); const failedChild=children.at(-1); failedChild.emit('error',Error('spawn')); const f=errors.acquire('preview-build'); assert.notEqual(children.at(-1),failedChild,'failed spawn is replaced on new work'); assert.equal(warnings,2); e(); assert.equal(children.at(-1).kills,0); f(); assert.equal(children.at(-1).kills,1);
assert.deepEqual(nativePowerCommand('darwin',123),{file:'/usr/bin/caffeinate',args:['-i','-w','123']},'system idle only, parent-bound');
const win=nativePowerCommand('win32',123); assert.ok(win.file.endsWith('powershell.exe')); assert.deepEqual(win.args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-Command']); assert.equal(win.args[4],WINDOWS_POWER_SCRIPT);
// Validate the native flag values passed to the API (no DISPLAY_REQUIRED / AWAYMODE).
assert.deepEqual([...WINDOWS_POWER_SCRIPT.matchAll(/SetThreadExecutionState\((0x[0-9a-f]+)\)/g)].map(m=>Number(m[1])),[0x80000001,0x80000000]);
assert.equal(nativePowerCommand('linux',123),undefined);
const exited=new WorkPower(start); const oldLease=exited.acquire('coach-turn');const exitedChild=children.at(-1);exitedChild.emit('exit');const newLease=exited.acquire('preview-build');assert.notEqual(children.at(-1),exitedChild);oldLease();assert.equal(children.at(-1).kills,0);newLease();assert.equal(children.at(-1).kills,1);
assert.equal(power.leases.size,0,'disposal drops all retained lease identities');

const root=await mkdtemp(join(tmpdir(),'work-power-'));
const oldFetch=globalThis.fetch; const oldStart=workPower.start;
try {
  workPower.start=start;
  const bytes=Buffer.from('test-update');
  const asset={downloadUrl:'https://api.github.com/repos/hypeproof/hypeproof-studio/releases/assets/123',sizeBytes:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
  for (const outcome of ['ok','error','digest','timeout']) {
    const pending=deferred(); let entered=false;
    globalThis.fetch=async (_url,{signal})=>{entered=true;signal.addEventListener('abort',()=>pending.reject(signal.reason));return pending.promise;};
    const done=downloadVerifiedUpdate({...asset,...(outcome==='digest'?{digest:'sha256:'+'0'.repeat(64)}:{})},join(root,outcome),{totalTimeoutMs:40});
    assert.equal(entered,true); const child=children.at(-1); assert.equal(child.kills,0,`${outcome}: assertion during download`);
    if(outcome==='error')pending.reject(Error('network'));
    else if(outcome!=='timeout')pending.resolve(new Response(bytes));
    if(outcome==='ok')await done;else await assert.rejects(done);
    assert.equal(child.kills,1,`${outcome}: release after download settles`);
  }
  // Real provider entry points; mock only the expensive work at their boundaries.
  const h=await createTaskHarness(join(root,'host')); const hostPower=h.internals.workPower; hostPower.start=start;
  Object.assign(h.h,{turnTimelines:new Map(),_instructorMode:{isInstructor:true},imageStaging:null,rememberTurnRequest:()=> 'request',getHistory:()=>[],prepareAttachments:()=>({failures:[]}),extractLastRenderableCode:()=>'<html></html>',coachDisplayName:()=> 'coach',revealBuilt: h.h.revealBuilt.bind(h.h)});
  for(const outcome of ['ok','error']) {
    const pending=deferred();
    h.h.appendHistory=()=>pending.promise;
    // Avoid launching the detached preview here; it is independently exercised below.
    const realReveal=h.h.revealBuilt; h.h.revealBuilt=async()=>true;
    const done=h.h.handleSend('보여줘',[]); const child=children.at(-1);
    assert.equal(child.kills,0,`${outcome}: turn holds power while pending`);
    if(outcome==='ok')pending.resolve();else pending.reject(Error('storage'));
    if(outcome==='ok')await done;else await assert.rejects(done,/storage/);
    assert.equal(child.kills,1,`${outcome}: turn released`); h.h.revealBuilt=realReveal;
  }
  Object.assign(h.h,{surfaceStructureIssues:()=>{},archiveAdultPage:()=>{},saveGameToWorkspace:async()=>false,inlineEngineIfNeeded:async html=>html});
  for(const outcome of ['ok','error']) {
    const pending=deferred(); let entered=false;h.h.preview={show:()=>{entered=true;return pending.promise;}};
    const done=h.h.revealBuilt('<!doctype html><html><head><title>test</title></head><body>page</body></html>');
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(entered,true);
    const child=children.at(-1); assert.equal(child.kills,0,`${outcome}: preview stays protected until ready`);
    if(outcome==='ok')pending.resolve();else pending.reject(Error('preview'));
    if(outcome==='ok')assert.equal(await done,true);else await assert.rejects(done,/preview/);
    assert.equal(child.kills,1,`${outcome}: preview released`);
  }
  // Live server success returns early but still releases its own build lease.
  h.h.saveGameToWorkspace=async()=>true; h.h.isLiveServerPreview=()=>true;
  const live=deferred(); h.h.openInLiveServer=()=>live.promise;
  const building=h.h.revealBuilt('<html><body>page</body></html>');
  await new Promise(resolve=>setTimeout(resolve,0)); const liveChild=children.at(-1);
  assert.equal(liveChild.kills,0);live.resolve(true);assert.equal(await building,true);assert.equal(liveChild.kills,1);
  hostPower.dispose();
  // Execute the real extension deactivation, rather than just calling manager.dispose.
  const bundle=await build({stdin:{contents:"export {deactivate} from './src/extension'; export {workPower, startNativePower} from './src/workPower';",resolveDir:fileURLToPath(new URL('..',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
  const module={exports:{}}; const require=createRequire(import.meta.url); const spawns=[];
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:id=>id==='vscode'?{}:id==='node:child_process'?{...require(id),spawn:(...args)=>{spawns.push(args);return start();}}:require(id),console,Buffer,process:{...process,platform:"darwin"},setTimeout,clearTimeout,setInterval,clearInterval,AbortController,AbortSignal,URL,fetch,TextEncoder,TextDecoder});
  const last=module.exports.workPower.acquire('coach-turn'); const ending=children.at(-1);
  assert.deepEqual(Array.from(spawns.at(-1)[1]),['-i','-w',String(process.pid)]);
  assert.equal(spawns.at(-1)[2].windowsHide,true);assert.deepEqual(Array.from(spawns.at(-1)[2].stdio),['pipe','ignore','ignore']);
  module.exports.deactivate();assert.equal(ending.kills,1,'actual extension shutdown releases active work');last();
  const linux={exports:{}};
  vm.runInNewContext(bundle.outputFiles[0].text,{module:linux,exports:linux.exports,require:id=>id==='vscode'?{}:id==='node:child_process'?{...require(id),spawn:()=>{throw Error('unsupported native launch');}}:require(id),console,Buffer,process:{...process,platform:'linux'},setTimeout,clearTimeout,setInterval,clearInterval,AbortController,AbortSignal,URL,fetch,TextEncoder,TextDecoder});
  assert.equal(linux.exports.startNativePower(),undefined,'unsupported platform never spawns');


} finally { globalThis.fetch=oldFetch;workPower.start=oldStart;await rm(root,{recursive:true,force:true}); }
console.log('work power: leases, display flags, turn/preview/update lifecycle PASS');
