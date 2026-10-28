import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {companionCiInput,validateCompanionPackage} from '../companion-ci.mjs';
const bytes=Buffer.from('synthetic archive bytes'),hash=createHash('sha256').update(bytes).digest('hex');
const pin=()=>({asset:'hypeproof-companion-client-0.1.0.tgz',tag:'companion-client-v0.1.0-dev.1',sha256:hash,sourceCommit:'a'.repeat(40)});
const manifest=p=>({version:1,repository:'hypeproof/hypeproof-service',packages:p});
test('required client input accepts only exact verified regular-file archive and immutable provenance',async t=>{
 const root=await mkdtemp(join(tmpdir(),'companion-ci-input-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'.private-service-cache'));const spec=pin(),archive=join(root,'.private-service-cache',spec.asset);await writeFile(archive,bytes);
 assert.equal((await companionCiInput(root,manifest([spec]))).archive,archive);
 await assert.rejects(companionCiInput(root,manifest([])),/unavailable/);
 for(const change of [{sha256:'unknown'},{sourceCommit:'main'},{tag:'--repo=other'}])await assert.rejects(companionCiInput(root,manifest([{...spec,...change}])),/Invalid/);
 await assert.rejects(companionCiInput(root,manifest([spec,spec])),/unavailable/);
 await writeFile(archive,'changed');await assert.rejects(companionCiInput(root,manifest([spec])),/integrity/);
 await rm(archive);const elsewhere=join(root,'elsewhere');await writeFile(elsewhere,bytes);await symlink(elsewhere,archive);await assert.rejects(companionCiInput(root,manifest([spec])),/integrity/);
});
test('DEV package exports and dependency-free contract cannot silently substitute a different package',()=>{
 const pkg={name:'@hypeproof/companion-client',version:'0.1.0',private:true,exports:{'.':{import:'./src/index.mjs',types:'./types/index.d.ts'},'./execution':{import:'./src/execution.mjs',types:'./types/execution.d.ts'}}};validateCompanionPackage(pkg);
 for(const patch of [{name:'other'},{version:'0.2.0'},{private:false},{dependencies:{other:'*'}},{exports:{'.':pkg.exports['.']}}])assert.throws(()=>validateCompanionPackage({...pkg,...patch}),/contract/);
});
