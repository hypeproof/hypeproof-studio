// Configuration only: no native app, keychain access, provider or GitHub request.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('hosted explicit OS credential mode survives config creation; local default stays in-memory',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-config-'));
 try{
 const receipt=path.join(dir,'receipt.json'),service=path.join(dir,'service.json');
 fs.writeFileSync(receipt,JSON.stringify({source:root,app:path.join(dir,'app')}));fs.writeFileSync(service,JSON.stringify({origin:'http://127.0.0.1:8788',token_a_file:path.join(dir,'synthetic-token'),token_b_file:path.join(dir,'synthetic-token-b')}));
 const env={...process.env};delete env.HPS_FEEDBACK_SECRET_STORAGE;
 const generate=(name,args=[])=>{const evidence=path.join(dir,name);execFileSync(process.execPath,['e2e/feedback-native/prepare-config.mjs',receipt,service,evidence,...args],{cwd:root,env,stdio:'pipe'});return JSON.parse(fs.readFileSync(path.join(evidence,'config.json'),'utf8'));};
 const generated=generate('default');assert.equal(generated.secretStorage,'inmemory');assert(generated.scenarios.includes('restart'));assert(generated.scenarios.includes('activity-isolation'));assert.deepEqual(fs.readdirSync(generated.workspace.c),[]);assert.notEqual(generated.workspace.c,generated.workspace.a);const owner=JSON.parse(fs.readFileSync(path.join(generated.userDataDir,'feedback-owner.json'),'utf8'));assert.equal(owner.workspaces.c,generated.workspace.c);assert.equal(generated.service.tokenBFile,path.join(dir,'synthetic-token-b'));assert.equal(generate('persisted',['--secret-storage=os-keychain']).secretStorage,'os-keychain');
 for(const [name,args]of [['bad',['--secret-storage=unknown']],['empty',['--secret-storage=']],['duplicate',['--secret-storage=os-keychain','--secret-storage=inmemory']]]){assert.throws(()=>generate(name,args));assert(!fs.existsSync(path.join(dir,name)),'invalid storage modes refuse before creating artifacts');}
 assert(fs.readFileSync(path.join(root,'e2e/feedback-native/hosted.mjs'),'utf8').includes("evidence,'--secret-storage=os-keychain'"),'dedicated hosted entrypoint explicitly selects persistent mode');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
