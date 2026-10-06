// Controls for the #997 acceptance precondition: synthetic App trees and seeds,
// no download, no App launch. Sparse files stand in for the ~230 MB binary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {appSdkVersion,seededSdkBinary,checkSeededSdk} from './sdk-seed.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hps-sdk-seed-control-'));
const version='0.3.207',size=160*1024*1024,sri='sha512-Y2ktZml4dHVyZQ==';
const app=(platform,sdkVersion=version)=>{
 const dir=path.join(root,platform+'-'+sdkVersion,platform==='darwin'?'HypeProof Studio.app':'');
 const pkg=path.join(dir,platform==='darwin'?'Contents/Resources/app':'resources/app','extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk');
 fs.mkdirSync(pkg,{recursive:true});fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-agent-sdk',version:sdkVersion}));
 return dir;
};
const seed=(binary,{bytes=size,marker={}}={})=>{
 fs.mkdirSync(path.dirname(binary),{recursive:true});
 const fd=fs.openSync(binary,'w');fs.ftruncateSync(fd,bytes);fs.closeSync(fd);fs.chmodSync(binary,0o755);
 fs.writeFileSync(binary+'.verified.json',JSON.stringify({sdkVersion:version,size:bytes,tarballSha512:sri,seededBy:'control',...marker}));
};
try{
 // Paths the seed scripts write and the App resolves (sdkCoachHelpers.seededSdkBinaryPath).
 assert.equal(seededSdkBinary(version,{platform:'darwin',home:'/Users/runner'}),'/Users/runner/Library/Application Support/HypeProof-Studio/sdk/0.3.207/claude');
 assert.equal(seededSdkBinary(version,{platform:'win32',home:'C:\\Users\\runner',env:{APPDATA:'C:\\Users\\runner\\AppData\\Roaming'}}),'C:\\Users\\runner\\AppData\\Roaming\\HypeProof-Studio\\sdk\\0.3.207\\claude.exe');
 const mac=app('darwin'),home=path.join(root,'home'),opts={platform:'darwin',home};
 assert.equal(appSdkVersion(mac,'darwin'),version);
 // Negative control: a fresh runner, which is what #997 ran on.
 const fresh=checkSeededSdk(mac,opts);
 assert.equal(fresh.ok,false);assert.equal(fresh.reason,'seeded binary not found');
 // Positive control: a seed shaped exactly like the seed scripts' output.
 const binary=seededSdkBinary(version,opts);seed(binary);
 assert.deepEqual(checkSeededSdk(mac,opts),{ok:true,version,binary});
 // A Windows PowerShell 5.1 marker carries a BOM; the App accepts it, so must this.
 fs.writeFileSync(binary+'.verified.json','\uFEFF'+JSON.stringify({sdkVersion:version,size,tarballSha512:sri}));
 assert.equal(checkSeededSdk(mac,opts).ok,true);
 // Negative controls: every reason the App would distrust the seed and fall back.
 const rejects=(why,setup)=>{seed(binary);setup();const r=checkSeededSdk(mac,opts);assert.equal(r.ok,false,why);return r.reason;};
 assert.match(rejects('stale marker version',()=>seed(binary,{marker:{sdkVersion:'0.3.200'}})),/marker is for 0\.3\.200, App expects 0\.3\.207/);
 assert.match(rejects('truncated binary',()=>fs.truncateSync(binary,size-1)),/differs from seed-time size/);
 assert.match(rejects('below floor',()=>seed(binary,{bytes:1024})),/below sanity floor/);
 assert.match(rejects('no integrity',()=>seed(binary,{marker:{tarballSha512:'none'}})),/malformed/);
 assert.match(rejects('no marker',()=>fs.unlinkSync(binary+'.verified.json')),/malformed/);
 assert.match(rejects('not executable',()=>fs.chmodSync(binary,0o644)),/not executable/);
 // A binary seeded for another SDK version does not satisfy an App that vendors this one.
 assert.equal(checkSeededSdk(app('darwin','0.3.300'),opts).ok,false);
 // Windows layout on disk: APPDATA decides, executable bit does not apply. A win32
 // path is only a real path on a Windows host; elsewhere the string check above covers it.
 const win=app('win32');
 if(process.platform==='win32'){
  const winOpts={platform:'win32',home,env:{APPDATA:path.join(root,'appdata')}};
  assert.equal(checkSeededSdk(win,winOpts).ok,false);
  const exe=seededSdkBinary(version,winOpts);seed(exe);
  assert.equal(checkSeededSdk(win,winOpts).ok,true);
 }
 // An App without vendored SDK JS is not a candidate for this check at all.
 assert.throws(()=>appSdkVersion(path.join(root,'empty'),'darwin'));
 // The CLI the workflows use prints the bare version for the seed scripts.
 const script=fileURLToPath(new URL('./sdk-seed.mjs',import.meta.url));
 const cli=spawnSync(process.execPath,[script,'version',process.platform==='darwin'?mac:win],{encoding:'utf8'});
 assert.equal(cli.status,0,cli.stderr);assert.equal(cli.stdout,version);
 assert.notEqual(spawnSync(process.execPath,[script],{encoding:'utf8'}).status,0);
 console.log('PASS SDK seed precondition controls: fresh runner blocked, seeded App version accepted, stale/truncated/unmarked/non-executable/other-version seeds rejected');
}finally{fs.rmSync(root,{recursive:true,force:true});}
