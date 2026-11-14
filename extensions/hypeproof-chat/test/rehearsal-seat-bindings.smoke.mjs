// #4048 (chalk#17) — the rehearsal folder's activity stays out of the saved-activity list, and can be dropped
// on return without touching the instructor's own folder binding.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const bundled=await build({entryPoints:[new URL('../src/activityConnections.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};vm.runInNewContext(bundled.outputFiles[0].text,{module,exports:module.exports,require,process,URL});
const {ActivityConnections}=module.exports;

let failed=0;
async function t(name,fn){try{await fn();console.log(`  ok   ${name}`);}catch(err){failed++;console.log(`  FAIL ${name}\n       ${err&&err.message}`);}}

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hps-seat-bind-'));
const storage=path.join(tmp,'storage');
const home=path.join(tmp,'home'),seat=path.join(storage,'rehearsal-seat','abc123');
fs.mkdirSync(home,{recursive:true});fs.mkdirSync(seat,{recursive:true});
const origin='https://synthetic.invalid/v1';
const profile=(id,name=id)=>({activity_id:id.repeat(64),display_name:name,activity_kind:'trial'});
function context(){
  const secrets=new Map(),state=new Map();
  return {
    globalStorageUri:{fsPath:storage},
    workspaceState:{get:(k,d)=>state.has(k)?state.get(k):d,update:async(k,v)=>{state.set(k,v);}},
    secrets:{get:async k=>secrets.get(k),store:async(k,v)=>{secrets.set(k,v);},delete:async k=>{secrets.delete(k);},keys:async()=>[...secrets.keys()],onDidChange:()=>({dispose(){}})},
  };
}

await t('list hides the rehearsal folder activity and keeps the home activity',async()=>{
  const raw=context();
  const store=new ActivityConnections(raw,()=>origin,()=>home,async()=>profile('a'));
  await store.commit('synthetic-home',profile('a'),home);
  const rehearsal=new ActivityConnections(raw,()=>origin,()=>seat,async()=>profile('b'));
  await rehearsal.commit('synthetic-rehearsal',profile('b'),seat);
  const names=(await store.list()).map(r=>r.workspace);
  assert.ok(names.includes(fs.realpathSync(home)),'home activity listed');
  assert.ok(!names.some(w=>w.startsWith(seat)||w.includes(path.sep+'rehearsal-seat'+path.sep)),'rehearsal activity hidden');
});

await t('dropBindingFor removes the rehearsal record and binding and leaves the home binding intact',async()=>{
  const raw=context();
  const store=new ActivityConnections(raw,()=>origin,()=>home,async()=>profile('a'));
  await store.commit('synthetic-home',profile('a'),home);
  const rehearsal=new ActivityConnections(raw,()=>origin,()=>seat,async()=>profile('b'));
  await rehearsal.commit('synthetic-rehearsal',profile('b'),seat);
  const homeBinding=fs.readFileSync(store['bindingPath'](home),'utf8');
  await rehearsal.dropBindingFor(seat);
  assert.equal(fs.existsSync(rehearsal['bindingPath'](seat)),false,'rehearsal binding file removed');
  assert.equal(rehearsal.current,undefined,'the window disconnects from the rehearsal activity');
  assert.equal(fs.readFileSync(store['bindingPath'](home),'utf8'),homeBinding,'home binding untouched');
  assert.equal(await store.token(),'synthetic-home','home token still readable');
  const names=(await store.list()).map(r=>r.workspace);
  assert.equal(names.length,1,'only the home activity remains saved');
});

fs.rmSync(tmp,{recursive:true,force:true});
if(failed){console.log(`\n${failed} failed`);process.exit(1);}
console.log('\nall rehearsal-seat-bindings checks passed');
