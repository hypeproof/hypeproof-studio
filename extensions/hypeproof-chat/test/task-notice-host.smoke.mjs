// Real host bridge: internal command discovery and cancellation during discovery.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const req=createRequire(import.meta.url),code=(await build({entryPoints:['src/finishNoticeHost.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['vscode']})).outputFiles[0].text;
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({delayed=false,patched=true}={}){
 const calls=[],notices=[],reveals=[];let discover;
 const vscode={commands:{getCommands:filter=>{assert.equal(filter,false,'internal command must not be filtered');return delayed?new Promise(r=>discover=r):Promise.resolve(patched?['_hypeproof.notice.show']:[]);},executeCommand:async(id,...args)=>{calls.push([id,...args]);return {clicked:true};}},window:{showInformationMessage:async(...a)=>{notices.push(a);return '열기';}}};
 const m={exports:{}};vm.runInNewContext(code,{module:m,exports:m.exports,require:id=>id==='vscode'?vscode:req(id),console,Date,Promise});
 return {n:m.exports.createTaskNotifier(async scope=>reveals.push(scope)),calls,notices,reveals,discover:v=>discover(v)};
}
const input={scope:'["a","task"]',status:'ok',chatVisible:false,seat:{activity_kind:'personal'}};
let f=fixture();f.n.turnEnded(input);await tick();assert.equal(f.calls[0][0],'_hypeproof.notice.show');assert.equal(f.notices.length,0);assert.deepEqual(f.reveals,[input.scope]);
f=fixture({delayed:true});f.n.turnEnded(input);f.n.release();f.discover(['_hypeproof.notice.show']);await tick();assert.ok(!f.calls.some(c=>c[0]==='_hypeproof.notice.show'));assert.deepEqual(f.reveals,[]);
f=fixture({patched:false});f.n.turnEnded(input);await tick();assert.deepEqual(f.notices,[['AI 답이 준비됐어요.','열기']]);assert.deepEqual(f.reveals,[input.scope]);
console.log('PASS host: internal command discovery, cancelled discovery, legacy shell compatibility');
