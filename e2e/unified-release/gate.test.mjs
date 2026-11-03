import assert from 'node:assert/strict';
import {assertReceipt,INSTALLER_PRODUCT_JSON,installerTarget,installerProductMatches} from './artifact.mjs';
const sha='a'.repeat(40),digest='b'.repeat(64),version='1.2.3',platform='darwin-arm64';
const assets={'HypeProof-Studio-darwin-arm64.zip':digest};
const result={status:'PASS',real_folder_reload:true,draft_round_trip:true,attachment_round_trip:true,process_restart:true,encrypted_storage:true,shared_root_blocked:true,original_files_preserved:true,live_model:true,model_calls:4};
const good={schema:'hps-unified-acceptance/1',status:'PASS',sourceSha:sha,sourceDirty:false,platform,mode:'candidate-unmodified',app:{sha,version,extensionVersion:version,name:'HypeProof Studio'},publicService:{base:'https://api.hypeproof-ai.xyz/v1',version:'w-test',status:'PASS',activities:['trial','classroom'].map(kind=>({kind,status:'PASS',fileOperations:true}))},treeBefore:digest,treeAfter:digest,assets,activities:['trial','classroom'].map(kind=>({kind,serviceSha:sha,payloadIsolation:true,result:{...result}}))};
assert.equal(assertReceipt(good,{sha,version,platform,assets}),true);
for(const mutate of [r=>delete r.publicService,r=>r.publicService.activities.pop(),r=>r.publicService.base='http://localhost:8787/v1',r=>r.publicService.version='unknown',r=>r.activities[0].result.model_calls=0,r=>r.activities[0].result.model_calls=1.5,r=>r.activities.pop(),r=>r.activities[0].result.status='FAIL',r=>r.activities[1].result.status='BLOCKED',r=>r.sourceSha='c'.repeat(40),r=>r.sourceDirty=true,r=>r.mode='local-injected-rehearsal',r=>r.platform='win32-x64',r=>r.treeAfter='c'.repeat(64),r=>r.assets['HypeProof-Studio-darwin-arm64.zip']='c'.repeat(64),r=>r.activities[0].result.live_model=false,r=>r.activities[1].payloadIsolation=false,r=>r.app.extensionVersion='old',r=>r.activities[0].serviceSha='old']){
 const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertReceipt(bad,{sha,version,platform,assets}));
}
assert.throws(()=>assertReceipt(undefined,{sha,version,platform,assets}));
console.log('PASS release verdict controls: both activities, failed/blocked/missing/stale/injected/OS/byte/version/Service/payload mismatches');
// Both OS success and missing installer evidence are separate controls.
const windowsAssets={'HypeProof.Studio-win32-x64-1.2.3.zip':digest,'HypeProof.StudioUserSetup-x64-1.2.3.exe':digest,'HypeProof.StudioSetup-x64-1.2.3.exe':digest};
const windows={...structuredClone(good),platform:'win32-x64',assets:windowsAssets,installerPayloadsVerified:true};
assert.equal(assertReceipt(windows,{sha,version,platform:'win32-x64',assets:windowsAssets}),true);
assert.throws(()=>assertReceipt({...windows,installerPayloadsVerified:false},{sha,version,platform:'win32-x64',assets:windowsAssets}));
assert.throws(()=>assertReceipt(good,{sha,version,platform,assets:{...assets,'unexpected.zip':digest}}));

// Exercise the public CLI verdict, including its nonzero process exit, with
// synthetic bytes; these fixtures are not release acceptance evidence.
const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
const {spawnSync}=await import('node:child_process');const {sha256}=await import('./artifact.mjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hps-release-control-'));
try{
 const actual={};for(const name of [...Object.keys(assets),...Object.keys(windowsAssets)]){fs.writeFileSync(path.join(directory,name),'synthetic package');actual[name]=sha256(path.join(directory,name));}
 const receipts=[{...structuredClone(good),assets:actual},{...structuredClone(windows),assets:actual}];
 const evidence={schema:'hps-unified-release/1',receipts};
 const file=path.join(directory,'unified-acceptance.json');
 const run=()=>spawnSync(process.execPath,[new URL('../../scripts/check-unified-release.mjs',import.meta.url).pathname,directory,sha,version],{encoding:'utf8'}).status;
 fs.writeFileSync(file,JSON.stringify(evidence));assert.equal(run(),0);
 // The per-release Test Kit zip is generated after acceptance and is not an App package:
 // its presence keeps the verdict (positive control); any other new zip still changes the set.
 const kit=path.join(directory,'HypeProof-v1.2.3-Test-Kit.zip'),stray=path.join(directory,'HypeProof-v1.2.3-Extra.zip');
 fs.writeFileSync(kit,'kit');assert.equal(run(),0);
 fs.writeFileSync(stray,'stray');assert.notEqual(run(),0);
 fs.unlinkSync(kit);fs.unlinkSync(stray);
 evidence.receipts[1].publicService.version='different';fs.writeFileSync(file,JSON.stringify(evidence));assert.notEqual(run(),0);
 evidence.receipts[1].publicService.version='w-test';fs.writeFileSync(file,JSON.stringify(evidence));
 fs.appendFileSync(path.join(directory,'HypeProof-Studio-darwin-arm64.zip'),'changed');assert.notEqual(run(),0);
 fs.unlinkSync(file);assert.notEqual(run(),0);
 console.log('PASS Windows installer and release CLI controls, current-byte and public Service mismatch');
}finally{fs.rmSync(directory,{recursive:true,force:true});}

// Installer product.json: Inno Setup adds `target` and re-serializes with tabs (VS Code
// gulpfile.vscode.win32.ts). Positive: exactly that difference passes for each installer.
{
 const portable=JSON.stringify({nameLong:'HypeProof Studio',version:'1.2.3',commit:sha,win32x64AppId:'{X}',checksums:{a:'1'}},null,2);
 const as=(target,extra={})=>JSON.stringify({...JSON.parse(portable),target,...extra},null,'\t');
 assert.equal(installerTarget('HypeProof.StudioUserSetup-x64-1.2.3.exe'),'user');
 assert.equal(installerTarget('HypeProof.StudioSetup-x64-1.2.3.exe'),'system');
 assert.ok(INSTALLER_PRODUCT_JSON.test('resources\\app\\product.json')&&INSTALLER_PRODUCT_JSON.test('resources/app/product.json'));
 assert.ok(!INSTALLER_PRODUCT_JSON.test('resources/app/extensions/x/product.json'));
 assert.equal(installerProductMatches(portable,as('system'),'system'),null);
 assert.equal(installerProductMatches(portable,as('user'),'user'),null);
 // Negative: wrong or missing target, a changed field, an added or removed field.
 assert.match(installerProductMatches(portable,as('user'),'system'),/target/);
 assert.match(installerProductMatches(portable,portable,'system'),/target/);
 assert.match(installerProductMatches(portable,as('system',{version:'0.0.1'}),'system'),/version/);
 assert.match(installerProductMatches(portable,as('system',{checksums:{a:'2'}}),'system'),/checksums/);
 assert.match(installerProductMatches(portable,as('system',{extra:true}),'system'),/extra/);
 const less=JSON.parse(as('system'));delete less.commit;
 assert.match(installerProductMatches(portable,JSON.stringify(less),'system'),/commit/);
 console.log('PASS installer product.json controls: target-only difference accepted; wrong target or any other field change refused');
}
