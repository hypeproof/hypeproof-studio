// Independent driver for the packaged product updater. No app code injection,
// direct installer-script execution, credential seeding or security bypass.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import net from 'node:net';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {appIdentity,sha256} from '../../../e2e/unified-release/artifact.mjs';
const check=(ok,reason)=>{if(!ok)throw new Error('BLOCKED: '+reason);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const contained=(root,value)=>{const rel=path.relative(root,value);return !!rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
const exe=app=>process.platform==='darwin'?path.join(app,'Contents/MacOS/HypeProof Studio'):path.join(app,'HypeProof Studio.exe');
export function assertOwnedNativePaths({root,app,profile,workspace}) {
 root=fs.realpathSync(root);check(path.basename(root).startsWith('hps-installed-')&&contained(fs.realpathSync(os.tmpdir()),root),'runner-owned temporary root required');
 for(const item of [app,profile,workspace])check(contained(root,fs.realpathSync(item))&&!fs.lstatSync(item).isSymbolicLink(),'app/profile/workspace must be owned and isolated');
 return root;
}
export function validateSeat(seat) {
 check(seat?.kind==='synthetic-release-test-seat'&&seat.profileId==='synthetic-release-acceptance'&&typeof seat.accountId==='string'&&seat.accountId.length>0&&/^[^\s@]+@[^\s@]+\.invalid$/.test(seat.expectedEmail??''),'pre-existing synthetic account seat required');
 const approval=new URL(seat.approvalUrl);check(approval.protocol==='http:'&&approval.hostname==='127.0.0.1'&&approval.port&&!approval.username&&!approval.password&&!approval.search&&!approval.hash&&approval.pathname.endsWith('/internal/accounts/device/approve'),'only local prepared Service test-seat bridge may approve the displayed device code');
 for(const key of ['serviceBase','siteBase']){const url=new URL(seat[key]);check(!url.username&&!url.password&&!url.hash&&!url.search&&((url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))||(url.protocol==='https:'&&['api.hypeproof-ai.xyz','hypeproof-ai.xyz'].includes(url.hostname))),'test seat Service/site origin rejected');}
 check(typeof seat.bridgeKey==='string'&&seat.bridgeKey.length>=16,'test-seat bridge authorization unavailable');return seat;
}
export function updaterCapability(app) {
 const extension=path.join(app,process.platform==='darwin'?'Contents/Resources/app':'resources/app','extensions/hypeproof-chat/package.json');
 const capability=JSON.parse(fs.readFileSync(extension,'utf8')).hypeproofReleaseVerification;
 check(capability?.schema==='hps-native-verification-capability/1'&&capability.loopbackPinnedFeed===true&&capability.isolatedRelaunch===true,'N−1 released app lacks isolated updater/feed capability; rebuild is not accepted as original N−1 evidence');
}
export async function startPinnedFeed({assetFile,asset,sourceSha,version}) {
 check(fs.statSync(assetFile).size===asset.size&&sha256(assetFile)===asset.sha256&&/^[a-f0-9]{40}$/.test(sourceSha),'candidate package identity changed');
 const bytes=Buffer.from(JSON.stringify({schema:'hps-release-verification-feed/1',version,sourceSha,assets:[{id:'candidate',name:asset.name,size:asset.size,sha256:asset.sha256}]}));const requests=[];
 const server=http.createServer((req,res)=>{
  if(req.method!=='GET'||req.headers.authorization||req.headers.cookie){res.writeHead(403);res.end();return;}
  if(req.url==='/manifest'){requests.push({path:'/manifest'});res.writeHead(200,{'content-type':'application/json'});res.end(bytes);return;}
  let unchanged=false;try{unchanged=fs.statSync(assetFile).size===asset.size&&sha256(assetFile)===asset.sha256;}catch{}
  if(req.url!=='/asset/candidate'||!unchanged){res.writeHead(404);res.end();return;}
  requests.push({path:'/asset/candidate',sha256:asset.sha256,size:asset.size});res.writeHead(200,{'content-type':'application/octet-stream','content-length':asset.size});fs.createReadStream(assetFile).pipe(res);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {origin:'http://127.0.0.1:'+server.address().port,manifestSha256:createHash('sha256').update(bytes).digest('hex'),requests,close:()=>new Promise(r=>server.close(r))};
}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function command(window,title){await window.keyboard.press(process.platform==='darwin'?'Meta+Shift+P':'Control+Shift+P');const input=window.locator('.quick-input-widget input.input').first();await input.fill('>'+title);await window.locator('.quick-input-list .label-name').filter({hasText:title}).first().waitFor({timeout:15000});await input.press('Enter');}
async function accountFrame(window){for(let attempt=0;attempt<120;attempt++){for(const frame of window.frames())try{if(await frame.locator('.studio-account').count())return frame;}catch{}await sleep(500);}throw new Error('BLOCKED: actual installed Studio account view unavailable');}
export function nativeSigningEvidence(app,installer,{teamId,thumbprint}={}) {
 if(process.platform==='darwin'){
  check(typeof teamId==='string'&&teamId.length>0,'expected signing team not configured');
  try{execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});execFileSync('/usr/sbin/spctl',['--assess','--type','execute',app],{stdio:'pipe'});const detail=execFileSync('/usr/bin/codesign',['-dv','--verbose=4',app],{stdio:['ignore','pipe','pipe']});void detail;}catch{throw new Error('BLOCKED: native signing/Gatekeeper acceptance unavailable; no quarantine/security bypass allowed');}
  // codesign writes identity metadata to stderr; inspect with a bounded subprocess.
  const {spawnSync}=createRequire(import.meta.url)('node:child_process');const proof=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',app],{encoding:'utf8'});check(proof.status===0&&proof.stderr.includes('TeamIdentifier='+teamId),'signing TeamIdentifier mismatch');return {platform:'mac',teamId,codeSignature:'verified',gatekeeper:'accepted'};
 }
 check(typeof thumbprint==='string'&&/^[a-fA-F0-9]{40,64}$/.test(thumbprint),'expected Windows publisher thumbprint unavailable');
 const script="$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity);$elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);$sig=Get-AuthenticodeSignature -LiteralPath $env:HPS_NATIVE_SIGNATURE_FILE;@{elevated=$elevated;status=[string]$sig.Status;thumbprint=$sig.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress";
 const proof=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,HPS_NATIVE_SIGNATURE_FILE:installer},encoding:'utf8'}));check(!proof.elevated&&proof.status==='Valid'&&proof.thumbprint?.toLowerCase()===thumbprint.toLowerCase(),'normal-user token or Authenticode publisher not verified');return proof;
}
export function ownedProcesses(app,profile) {
 const executable=exe(app);
 if(process.platform==='darwin'){
  let ids;try{ids=execFileSync('/usr/bin/pgrep',['-f','^'+executable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'( |$)'],{encoding:'utf8'}).trim().split(/\s+/);}catch{return [];}
  return ids.map(Number).filter(Number.isSafeInteger).filter(pid=>{try{return execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).includes('--user-data-dir='+profile);}catch{return false;}});
 }
 const script="Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:HPS_NATIVE_OWNED_EXE -and $_.CommandLine.Contains($env:HPS_NATIVE_OWNED_PROFILE) } | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress";
 const value=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,HPS_NATIVE_OWNED_EXE:executable,HPS_NATIVE_OWNED_PROFILE:'--user-data-dir='+profile},encoding:'utf8'}).trim();return value?[JSON.parse(value)].flat():[];
}

function observedWindowsToken(pid) {
 const script=String.raw`Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class HpsTokenProof {
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint a,bool b,int p);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr t,int c,out int v,int n,out int r);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr p);
 public static bool Elevated(int id){IntPtr p=OpenProcess(0x1000,false,id),t;int value,length;if(p==IntPtr.Zero)throw new Exception("Process token unavailable");try{if(!OpenProcessToken(p,8,out t))throw new Exception("Process token unavailable");try{if(!GetTokenInformation(t,20,out value,4,out length))throw new Exception("Process token unavailable");return value!=0;}finally{CloseHandle(t);}}finally{CloseHandle(p);}}
}
'@;@{pid=[int]$env:HPS_NATIVE_OBSERVED_PID;elevated=[HpsTokenProof]::Elevated([int]$env:HPS_NATIVE_OBSERVED_PID)}|ConvertTo-Json -Compress`;
 const proof=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,HPS_NATIVE_OBSERVED_PID:String(pid)},encoding:'utf8'}));check(proof.pid===pid&&proof.elevated===false,'actual updated app is not running as a normal user');return proof;
}

export function assertForwardVersion(previous,next){const tuple=v=>v.replace(/^v/,'').split('.').map(Number);check(/^v?\d+\.\d+\.\d+$/.test(previous)&&/^v?\d+\.\d+\.\d+$/.test(next),'comparable original release versions required');const a=tuple(previous),b=tuple(next);const different=a.findIndex((v,i)=>v!==b[i]);check(different>=0&&b[different]>a[different],'forward N−1 to N update required');}
export async function executeProductUpdate({root,oldApp,profile,workspace,assetFile,asset,sourceSha,version,seat,output,signing={}}) {
 root=assertOwnedNativePaths({root,app:oldApp,profile,workspace});updaterCapability(oldApp);seat=validateSeat(seat);const before=appIdentity(oldApp);assertForwardVersion(before.version,version);check(before.sha!==sourceSha&&before.version!==version.replace(/^v/,''),'real N−1 source/version transition required');
 const security=nativeSigningEvidence(oldApp,assetFile,signing);const { _electron:electron,chromium }=createRequire(new URL('../../../e2e/package.json',import.meta.url))('@playwright/test');
 const debugPort=await port();const feed=await startPinnedFeed({assetFile,asset,sourceSha,version});fs.mkdirSync(output,{recursive:true});fs.mkdirSync(path.join(profile,'User'),{recursive:true});
 const marker={schema:'hps-release-verification/1',root,profile:fs.realpathSync(profile),installRoot:fs.realpathSync(oldApp),workspace:fs.realpathSync(workspace),manifestSha256:feed.manifestSha256,sourceSha,target:asset.id==='win-system'?'win-system':process.platform==='darwin'?'mac':'win-user',debugPort,expiresAt:Date.now()+30*60000};fs.writeFileSync(path.join(profile,'.hps-release-verification.json'),JSON.stringify(marker),{mode:0o600});
 const settings=path.join(profile,'User/settings.json');fs.writeFileSync(settings,JSON.stringify({'hypeproofChat.proxyUrl':seat.serviceBase,'hypeproofChat.siteBase':seat.siteBase,'hypeproofChat.accountsPreview':true,'hypeproofChat.accountsEnabled':true,'hypeproof.releasePersistence':'retained','window.dialogStyle':'custom','telemetry.telemetryLevel':'off','workbench.startupEditor':'none'}));
 const workspaceFile=path.join(workspace,'retained.txt');fs.writeFileSync(workspaceFile,'native-updater-continuity');const retained={workspace:sha256(workspaceFile),settings:sha256(settings)};
 const env={...process.env,HPS_RELEASE_VERIFY_MODE:'local-pinned-feed',HPS_RELEASE_VERIFY_ROOT:root,HPS_RELEASE_VERIFY_FEED:feed.origin};for(const key of Object.keys(env))if(/API_KEY|SECRET|TOKEN|PASSWORD|ISSUER|_CODE$/.test(key))delete env[key];
 let running,connected;try{
  running=await electron.launch({executablePath:exe(oldApp),args:['--user-data-dir='+profile,'--extensions-dir='+path.join(root,'extensions'),'--remote-debugging-port='+debugPort,'--skip-welcome','--skip-release-notes',workspace],env,timeout:60000});const window=await running.firstWindow();await window.waitForSelector('.monaco-workbench',{timeout:60000});
  const native=await running.evaluate(({app,safeStorage})=>({userData:app.getPath('userData'),execPath:process.execPath,encryptionAvailable:safeStorage.isEncryptionAvailable()}));check(fs.realpathSync(native.userData)===fs.realpathSync(profile)&&native.encryptionAvailable,'actual profile or OS secure credential store unavailable');
  const trust=window.getByRole('button',{name:/Yes, I trust|예.*신뢰/});if(await trust.isVisible().catch(()=>false))await trust.click();
  await command(window,'HypeProof Chat: Focus');
  const frame=await accountFrame(window);await frame.locator('.studio-account .studio-primary').click();const code=frame.locator('.studio-account .studio-help strong');await code.waitFor({timeout:30000});const user_code=await code.innerText();
  const approved=await fetch(seat.approvalUrl,{method:'POST',headers:{'content-type':'application/json','x-hps-account-key':seat.bridgeKey},body:JSON.stringify({user_code,account_id:seat.accountId,approve:true}),redirect:'error',signal:AbortSignal.timeout(15000)});check(approved.ok,'prepared synthetic account could not approve displayed device code');
  await frame.locator('.studio-account-identity').filter({hasText:seat.expectedEmail}).waitFor({timeout:60000});await window.screenshot({path:path.join(output,'before-update.png')});
  await command(window,'HypeProof Chat: 업데이트 확인');await window.locator('.notifications-toasts').getByText(/새 버전 v.*발견/).waitFor({timeout:30000});
  await command(window,'HypeProof Chat: 업데이트 설치');const restart=window.getByRole('button',{name:'재시작하고 업데이트',exact:true});await restart.waitFor({timeout:180000});const closed=running.waitForEvent('close',{timeout:180000});await restart.click();await closed;running=null;
  const deadline=Date.now()+180000;let identity;while(Date.now()<deadline){try{const found=appIdentity(oldApp);if(found.sha===sourceSha&&found.version===version.replace(/^v/,'')&&ownedProcesses(oldApp,profile).length){identity=found;break;}}catch{}await sleep(500);}check(identity,'product updater did not restart the exact candidate in the owned profile');
  const afterSecurity=nativeSigningEvidence(oldApp,assetFile,signing);const processProof=ownedProcesses(oldApp,profile).map(pid=>process.platform==='win32'?observedWindowsToken(pid):{pid,profileOwned:true});check(processProof.length>0,'actual candidate process unavailable');connected=await chromium.connectOverCDP('http://127.0.0.1:'+debugPort,{timeout:30000});const restarted=connected.contexts()[0].pages().find(p=>p.url().includes('workbench'));check(restarted,'restarted workbench unavailable');const afterFrame=await accountFrame(restarted);await afterFrame.locator('.studio-account-identity').filter({hasText:seat.expectedEmail}).waitFor({timeout:60000});await restarted.screenshot({path:path.join(output,'after-update.png')});
  check(sha256(workspaceFile)===retained.workspace&&sha256(settings)===retained.settings,'workspace or settings changed');check(feed.requests.some(r=>r.path==='/asset/candidate')&&sha256(assetFile)===asset.sha256,'product updater did not consume exact pinned bytes');
  return {status:'PASS',mode:'actual-product-updater-local-pinned-feed',before,after:identity,security:{before:security,after:afterSecurity},processProof,accountContinuity:{kind:'real-Studio-account-session',identity:'pre-existing-synthetic-Service-account',expectedEmail:seat.expectedEmail,noSecondApproval:true,osSecureStore:true},retained,feed:{manifestSha256:feed.manifestSha256,requests:feed.requests},profileIsolated:true,uiCheckInstallRestart:true,installedCustomerChannel:'NOT_RUN'};
 }finally{if(running)await running.close();if(connected)await connected.close();for(const pid of ownedProcesses(oldApp,profile))try{process.kill(pid,'SIGTERM');}catch{}await feed.close();}
}
