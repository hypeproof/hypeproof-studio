import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const built=await build({stdin:{contents:"export {createSharedRunnerHost} from './src/sharedRunnerHost';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),console,URL,Date,Buffer,AbortSignal,fetch,setTimeout,clearTimeout});
const {createSharedRunnerHost}=module.exports;
function fixture(){
 let recipe={revision:1},identity='account:connection',live=true,preview,records={},sends=0,questions=[],answer={approved:true};
 const runtime={sharedDeployment:async()=>({scriptId:'shared-script',deploymentId:'shared-version',digest:JSON.stringify(recipe),connectionIdentity:identity,versionNumber:1}),isConnected:async()=>true,connect:async()=>{},getConnectionIdentity:async()=>identity,preview:async()=>preview={id:'p1',createdAt:Date.now(),messages:[{id:'m1',to:'person@example.invalid',subject:'subject',body:'body'}]},getPreview:id=>preview?.id===id?preview:undefined,sendApproved:async()=>{sends++;preview=undefined;return{records:[{id:'m1',status:'sent'}]};}};
 const deps={runtime,maxRecipients:20,allowed:async()=>live,recipe:()=>recipe,ask:async q=>{questions.push(q);return{questionId:'q',...answer};},sheet:async()=>({spreadsheetId:'synthetic',range:'A1:D21',connection:identity}),lock:async work=>work(),ledger:{load:async()=>structuredClone(records),save:async v=>{records=structuredClone(v);}}};
 const key=createHash('sha256').update('account:m1').digest('hex');
 return{host:createSharedRunnerHost(deps),deps,questions,get sends(){return sends;},get records(){return records;},changeRecipe(){recipe={revision:2};},changeAccount(){identity='other:connection';},deny(){live=false;},cancel(){answer={cancelled:true};},prior(status){records[key]={id:'m1',status};},setAsk(fn){deps.ask=fn;}};
}
test('shared prepare bypasses personal upload/deploy; preview never sends or leaks mail',async()=>{
 const f=fixture();assert.equal((await f.host.appsScriptPrepare()).sharedRunner,true);
 for(const name of ['appsScriptUpload','appsScriptDeploy']){const r=await f.host[name]();assert.equal(r.ready,true);assert.equal(r.uploaded,false);assert.equal(r.deployed,false);}
 const r=await f.host.appsScriptRun('preview');assert.equal(r.previewed,true);assert.equal(r.nextAction,'wait_for_user');assert.equal(r.mailSent,false);assert.equal(f.sends,0);assert.equal(f.questions.at(-1).kind,'preview_review');assert(!JSON.stringify(r).includes('person@'));
 f.cancel();assert.equal((await f.host.appsScriptRun('send')).cancelled,true);assert.equal(f.sends,0);
});
test('exact preview approval sends once; changed skill/account invalidate approval',async()=>{
 for(const kind of ['normal','recipe','account']){const f=fixture();await f.host.appsScriptRun('preview');if(kind==='recipe')f.changeRecipe();if(kind==='account')f.changeAccount();const r=await f.host.appsScriptRun('send');assert.equal(f.sends,kind==='normal'?1:0);assert.equal((await f.host.appsScriptRun('send')).previewRequired,true);if(kind==='normal'){assert.equal(r.sent,true);assert.equal(f.questions.at(-1).kind,'preview');}}
});
test('migration retains prior sent/sending/unknown ledger and refuses resend',async()=>{
 for(const status of ['sent','sending','unknown']){const f=fixture();await f.host.appsScriptRun('preview');f.prior(status);const before=structuredClone(f.records),n=f.questions.length;const r=await f.host.appsScriptRun('send');assert.equal(r.previousAttempt,true);assert.equal(f.sends,0);assert.equal(f.questions.length,n);assert.deepEqual(f.records,before);}
});
test('approval races and unknown transport cannot silently send or retry',async()=>{
 for(const scenario of ['account','revoked','ledger','transport']){const f=fixture();await f.host.appsScriptRun('preview');if(scenario==='transport')f.deps.runtime.sendApproved=async()=>{throw Error('uncertain');};f.setAsk(async()=>{if(scenario==='account')f.changeAccount();if(scenario==='revoked')f.deny();if(scenario==='ledger')f.prior('unknown');return{questionId:'q',approved:true};});if(scenario==='revoked')await assert.rejects(()=>f.host.appsScriptRun('send'));else await f.host.appsScriptRun('send');assert.equal(f.sends,0);if(scenario==='transport'){assert.equal(Object.values(f.records)[0].status,'unknown');assert.equal((await f.host.appsScriptRun('send')).previewRequired,true);}}
});
