// #4048 (chalk#17) — while a rehearsal return is held and the issuer key is empty, the student-token command
// (runMintStudentToken) must not open its input box; it shows the approved sentence instead. With no return held,
// the same command behaves as before and opens the box. The real function is bundled, with a vscode stub.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:[new URL('../src/mintStudentToken.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false,external:['vscode']});

let failed=0;
async function t(name,fn){try{await fn();console.log(`  ok   ${name}`);}catch(err){failed++;console.log(`  FAIL ${name}\n       ${err&&err.message}`);}}

const ISSUER_KEY='hypeproofChat.issuerToken', RETURN_KEY='chalk.rehearsal.returnIssuer';
const MINT_BLOCKED='리허설을 끝낸 뒤에 학생 토큰을 발급하세요.';

// A vscode stub: records the calls the command can make. showInputBox resolves undefined (the person cancels).
function vscodeStub(log){
  return {
    window:{
      showInputBox:async()=>{log.inputBox++;return undefined;},
      showWarningMessage:(m)=>{log.warnings.push(m);return undefined;},
      showInformationMessage:()=>undefined,
    },
    env:{clipboard:{writeText:async()=>undefined}},
  };
}
// The bundle is evaluated once per test so each run gets a fresh module with its own stub.
function loadMint(log){
  const module={exports:{}};
  const req=(id)=>id==='vscode'?vscodeStub(log):require(id);
  vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require:req,process,URL,console,Buffer,setTimeout,clearTimeout,fetch:globalThis.fetch,AbortController,Date,JSON,Math,Error,TypeError,Promise,Map,Set,Array,Object,String,Number,RegExp,encodeURIComponent,decodeURIComponent});
  return module.exports.runMintStudentToken;
}
function secretsWith(entries){
  const m=new Map(entries);
  return {get:async k=>m.get(k),store:async(k,v)=>{m.set(k,v);},delete:async k=>{m.delete(k);},_m:m};
}
const deps=(secrets)=>({context:{secrets},proxyUrl:'https://synthetic.invalid/v1',defaults:{}});

await t('guard: a held return with an empty issuer key → no input box, the approved sentence is shown',async()=>{
  const log={inputBox:0,warnings:[]};
  const runMint=loadMint(log);
  const secrets=secretsWith([[RETURN_KEY,'synthetic-held']]);
  const result=await runMint(deps(secrets));
  assert.equal(result,undefined);
  assert.equal(log.inputBox,0,'the input box must not open');
  assert.deepEqual(log.warnings,[MINT_BLOCKED]);
  assert.equal(secrets._m.get(ISSUER_KEY),undefined,'nothing is stored');
});

await t('control: no return held and no issuer → the input box opens as before (the guard does not fire)',async()=>{
  const log={inputBox:0,warnings:[]};
  const runMint=loadMint(log);
  const secrets=secretsWith([]);
  const result=await runMint(deps(secrets));
  assert.equal(result,undefined,'the cancelled box returns undefined');
  assert.equal(log.inputBox,1,'the input box opens once');
  assert.deepEqual(log.warnings,[]);
});

await t('control: a stored issuer with a held return → the guard does not block (the issuer is already there)',async()=>{
  const log={inputBox:0,warnings:[]};
  const runMint=loadMint(log);
  const secrets=secretsWith([[ISSUER_KEY,'synthetic-issuer'],[RETURN_KEY,'synthetic-held']]);
  // With an issuer stored, the command goes on to cohort and the server, which this test does not reach.
  // The guard is not what stops it: no input box opens and no guard sentence is shown.
  await runMint(deps(secrets)).catch(()=>undefined);
  assert.ok(!log.warnings.includes(MINT_BLOCKED),'the guard sentence is not shown when an issuer is stored');
});

if(failed){console.log(`\n${failed} failed`);process.exit(1);}
console.log('\nall rehearsal-seat-mint-guard checks passed');
