import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import http from 'node:http';
import {verificationContext,verificationProfileFromStorage} from '../src/updateVerification.ts';
import {fetchLatestRelease,downloadVerifiedUpdate,trustedUpdateUrl} from '../src/updateTransport.ts';
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hps-installed-'))),profile=path.join(root,'profile'),installRoot=path.join(root,'app'),workspace=path.join(root,'workspace');for(const dir of [profile,installRoot,workspace])fs.mkdirSync(dir);
const executable=path.join(installRoot,'exe');fs.writeFileSync(executable,'synthetic-executable-not-a-release');
const data=Buffer.from('immutable synthetic candidate bytes'),sha256=createHash('sha256').update(data).digest('hex');const manifest=Buffer.from(JSON.stringify({schema:'hps-release-verification-feed/1',version:'v2026.1019.1',sourceSha:'a'.repeat(40),assets:[{id:'mac',name:'HypeProof-Studio-darwin-arm64.zip',size:data.length,sha256}]}));
let authorization=0,changed=false;const server=http.createServer((req,res)=>{if(req.headers.authorization)authorization++;if(req.url==='/manifest')res.end(changed?Buffer.from('{}'):manifest);else if(req.url==='/asset/mac')res.end(data);else{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const marker={schema:'hps-release-verification/1',root,profile,installRoot,workspace,manifestSha256:createHash('sha256').update(manifest).digest('hex'),sourceSha:'a'.repeat(40),target:'mac',debugPort:19876,expiresAt:Date.now()+60000};fs.writeFileSync(path.join(profile,'.hps-release-verification.json'),JSON.stringify(marker));const env={HPS_RELEASE_VERIFY_MODE:'local-pinned-feed',HPS_RELEASE_VERIFY_ROOT:root,HPS_RELEASE_VERIFY_FEED:`http://127.0.0.1:${server.address().port}`};
const saved={...process.env};
try{
 assert.equal(verificationContext({},{}),null);assert.throws(()=>verificationContext({verificationProfile:profile},{...env,HPS_RELEASE_VERIFY_FEED:'https://evil.test'},executable));assert.throws(()=>verificationContext({},env,executable));assert.throws(()=>verificationContext({verificationProfile:profile},env,process.execPath));
 assert.equal(verificationProfileFromStorage(path.join(profile,'User/globalStorage/ext')),profile);
 // Transport context binds the actual process path; fixture executable is only for validator unit checks.
 const check=verificationContext({verificationProfile:profile},env,executable);assert.equal(check.origin,env.HPS_RELEASE_VERIFY_FEED);
 // Process cannot claim an isolated install merely by supplying a profile marker.
 Object.assign(process.env,env);await assert.rejects(fetchLatestRelease({verificationProfile:profile}),/invalid/);assert.equal(authorization,0);
 assert.throws(()=>trustedUpdateUrl('http://127.0.0.1:1/asset/mac',{}),/invalid/);
 const {verificationManifest}=await import('../src/updateVerification.ts');assert.equal((await verificationManifest(check)).assets[0].sha256,sha256);assert.equal(authorization,0);changed=true;await assert.rejects(verificationManifest(check),/invalid/);
 console.log('PASS verification feed: explicit owned profile/install, loopback-only, immutable manifest, no process impersonation, no token forwarding or production fallback');
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}

const {renderInstallerScript,renderWindowsUpdateWrapper}=await import('../src/updateCheckerHelpers.ts');
const mac=renderInstallerScript({newAppPath:'/tmp/owned/new.app',oldAppPath:'/tmp/owned/old.app',expectedBundleId:'test.fixture',newVersion:'2',oldVersion:'1',logPath:'/tmp/owned/log',relaunchArgs:['--user-data-dir=/tmp/owned/profile','/tmp/owned/workspace']});
assert.ok(!mac.includes('xattr -dr'));assert.ok(!mac.includes('open "$OLD_APP"'));assert.ok(mac.includes('--user-data-dir=/tmp/owned/profile'));
const win=renderWindowsUpdateWrapper({appProcessName:'Studio',appExecutablePath:'C:\\owned\\Studio.exe',installerPath:'C:\\owned\\Setup.exe',installerArgs:['/DIR=C:\\owned\\app','/MERGETASKS=!runcode'],relaunchExecutable:'C:\\owned\\Studio.exe',relaunchArgs:['--user-data-dir=C:\\owned\\profile'],elevateInstaller:true});
assert.ok(win.includes('Get-CimInstance Win32_Process'));assert.ok(!win.includes('Get-Process -Name'));assert.ok(win.includes('-Verb RunAs -Wait -PassThru'));assert.ok(win.includes('if ($installed.ExitCode -ne 0)'));assert.ok(win.includes('--user-data-dir='));
console.log('PASS isolated installer: exact process scope, genuine UAC, isolated relaunch and quarantine preserved');
