import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareVendor,vendorManifest} from '../../scripts/studio-dev-vendor.mjs';
function fixture(dependencySection='dependencies'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hps-sdk-vendor-test-')),extension=path.join(root,'extension');fs.mkdirSync(extension);
 const entries={
  '@anthropic-ai/claude-agent-sdk':{version:'1.2.3',main:'sdk.mjs',type:'module',dependencies:{'runtime-leaf':'2.0.0'},optionalDependencies:{'@anthropic-ai/claude-agent-sdk-fake-platform':'1.2.3'}},
  zod:{version:'4.0.0',main:'index.js',type:'module'},'runtime-leaf':{version:'2.0.0',main:'index.js',type:'module'},
  '@anthropic-ai/claude-agent-sdk-fake-platform':{version:'1.2.3',main:'index.js',type:'module'}
 };const packages={};
 for(const [name,pkg]of Object.entries(entries)){const dir=path.join(extension,'node_modules',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,...pkg}));packages['node_modules/'+name]={version:pkg.version};fs.writeFileSync(path.join(dir,pkg.main),name==='@anthropic-ai/claude-agent-sdk'?"import {value} from 'runtime-leaf';if(value!==42)throw Error('wrong dependency');export const query=()=>{},createSdkMcpServer=()=>{};":name==='zod'?'export const z={object:()=>{}};':'export const value=42;');}
 fs.writeFileSync(path.join(extension,'package.json'),JSON.stringify({[dependencySection]:{'@anthropic-ai/claude-agent-sdk':'1.2.3'}}));fs.writeFileSync(path.join(extension,'package-lock.json'),JSON.stringify({packages}));
 return {root,extension,output:path.join(root,'vendor'),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('current SDK JS and runtime closure are copied and importable, optional native packages are absent',async()=>{const f=fixture();try{const before=vendorManifest(f.extension),r=await prepareVendor(f.extension,f.output);assert.equal(r.packages['@anthropic-ai/claude-agent-sdk'],'1.2.3');assert.equal(r.packages['runtime-leaf'],'2.0.0');assert.equal(fs.existsSync(path.join(f.output,'node_modules/@anthropic-ai/claude-agent-sdk-fake-platform')),false);assert.deepEqual(vendorManifest(f.extension),before);assert.deepEqual(vendorManifest(f.output),{sha256:r.sha256,file_count:r.file_count});fs.appendFileSync(path.join(f.output,'node_modules/zod/index.js'),'\n// changed');assert.notEqual(vendorManifest(f.output).sha256,r.sha256);await assert.rejects(prepareVendor(f.extension,f.output),/New owned/);}finally{f.close();}});
test('SDK declared as a build devDependency is still installed in the runtime candidate',async()=>{const f=fixture('devDependencies');try{const receipt=await prepareVendor(f.extension,f.output);assert.equal(receipt.packages['@anthropic-ai/claude-agent-sdk'],'1.2.3');assert.equal(typeof(await import(pathToFileURL(path.join(f.output,'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')).href)).query,'function');}finally{f.close();}});
test('declared/installed lock drift and missing runtime dependency fail without a shell fallback',async()=>{for(const kind of ['declared','installed','missing']){const f=fixture();try{if(kind==='declared')fs.writeFileSync(path.join(f.extension,'package.json'),JSON.stringify({dependencies:{'@anthropic-ai/claude-agent-sdk':'9.9.9'}}));if(kind==='installed'){const p=path.join(f.extension,'node_modules/zod/package.json');const pkg=JSON.parse(fs.readFileSync(p));pkg.version='9.9.9';fs.writeFileSync(p,JSON.stringify(pkg));}if(kind==='missing')fs.rmSync(path.join(f.extension,'node_modules/runtime-leaf'),{recursive:true});await assert.rejects(prepareVendor(f.extension,f.output));}finally{f.close();}}});
