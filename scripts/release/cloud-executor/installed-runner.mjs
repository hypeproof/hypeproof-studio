// Actual disposable-host installation/update runner. Never inject app code or sign evidence.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {appIdentity,sha256,treeHash} from '../../../e2e/unified-release/artifact.mjs';
import {installedPlan} from './evidence.mjs';
import {requireThat,hashBytes} from './provider.mjs';
import {executeProductUpdate,nativeSigningEvidence} from './native-update.mjs';
import os from 'node:os';
import {engineEnabled} from './workflow-gate.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const command=(exe,args)=>execFileSync(exe,args,{stdio:'pipe',timeout:240000});
const same=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():fs.realpathSync(a)===fs.realpathSync(b);
const executable=app=>process.platform==='darwin'?path.join(app,'Contents/MacOS/HypeProof Studio'):path.join(app,'HypeProof Studio.exe');
function assertApp(app,sourceSha,version) {
 const found=appIdentity(app);requireThat(found.sha===sourceSha&&found.version===version&&found.extensionVersion===version&&found.name==='HypeProof Studio','installed app source/version mismatch');return found;
}
function packageFile(directory,asset) {
 const file=path.join(directory,asset.name);requireThat(path.basename(asset.name)===asset.name&&fs.statSync(file).size===asset.size&&sha256(file)===asset.sha256,'untouched package identity changed');return file;
}
export function validatePersistence(before,after) {
 requireThat(before.workspace===after.workspace&&before.settings===after.settings&&before.encryptedFile===after.encryptedFile&&before.account==='release-synthetic-account'&&after.account===before.account,'workspace/settings/encrypted account not retained across N−1 update');
 requireThat(before.version!==after.version&&before.sourceSha!==after.sourceSha,'no real version/source transition');
 return true;
}
async function probe(app,{profile,workspace,ciphertext,secret,proofPath}={}) {
 const { _electron:electron }=createRequire(new URL('../../../e2e/package.json',import.meta.url))('@playwright/test');
 const before=treeHash(app);const args=['--skip-welcome','--skip-release-notes'];
 requireThat(profile,'isolated profile is mandatory');args.push(`--user-data-dir=${profile}`);
 if(workspace)args.push(workspace);
 const env={...process.env}; for(const name of Object.keys(env))if(/API_KEY|SECRET|TOKEN|PASSWORD|ISSUER|CODE$/.test(name))delete env[name];
 const running=await electron.launch({executablePath:executable(app),args,env,timeout:60000});
 try {
  const window=await running.firstWindow();await window.waitForSelector('.monaco-workbench',{timeout:60000});
  const observed=await running.evaluate(({app,safeStorage},input)=>{
   const encryptionAvailable=safeStorage.isEncryptionAvailable();
   return {execPath:process.execPath,userData:app.getPath('userData'),encryptionAvailable,
    encrypted:input.secret&&encryptionAvailable?safeStorage.encryptString(input.secret).toString('base64'):null,
    decrypted:input.ciphertext&&encryptionAvailable?safeStorage.decryptString(Buffer.from(input.ciphertext,'base64')):null};
  },{ciphertext,secret});
  requireThat(same(observed.userData,profile),'launched the real default profile instead of the isolated profile');
  requireThat(same(observed.execPath,executable(app)),'launched a different executable');
  if(proofPath)await window.screenshot({path:proofPath});
  return observed;
 } finally {await running.close();requireThat(treeHash(app)===before,'installed app mutated while running');}
}
async function install(file,destination,target) {
 fs.mkdirSync(destination,{recursive:true});
 if(process.platform==='darwin') {command('/usr/bin/ditto',['-xk',file,destination]);const app=path.join(destination,'HypeProof Studio.app');requireThat(fs.existsSync(app),'Mac package app missing');return app;}
 if(target==='win-system'){
  const args=['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/MERGETASKS=!runcode,!desktopicon,!quicklaunchicon',`/DIR=${destination}`];
  const ps=String.raw`$p=Start-Process -FilePath $env:HPS_NATIVE_INSTALLER -ArgumentList (ConvertFrom-Json $env:HPS_NATIVE_INSTALL_ARGS) -Verb RunAs -Wait -PassThru;exit $p.ExitCode`;
  execFileSync('powershell.exe',['-NoProfile','-Command',ps],{env:{...process.env,HPS_NATIVE_INSTALLER:file,HPS_NATIVE_INSTALL_ARGS:JSON.stringify(args.map(value=>'"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/g,'$1$1')+'"'))},stdio:'pipe',timeout:240000});return destination;
 }
 command(file,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/MERGETASKS=!runcode,!desktopicon,!quicklaunchicon',`/DIR=${destination}`]);return destination;
}
export async function executeInstalledTarget({collection,policy,pins,previous,assetsDirectory,previousDirectory,outputDirectory,target}) {
 const plan=installedPlan(policy,collection,pins);
 const artifactRole={mac:'mac-zip','win-user':'win-user','win-system':'win-system'}[target];
 requireThat(artifactRole,'unknown installed target');
 const checks=plan.checks.filter(check=>check.artifactId===target);
 fs.mkdirSync(outputDirectory,{recursive:true});
 const reports=[];const startedAt=new Date().toISOString();
 const record=(check,verdict,observed,proof={})=>{
  const file=path.join(outputDirectory,`${check.id}.json`);const detail={...proof,provider:{repository:process.env.GITHUB_REPOSITORY,repositoryId:Number(process.env.GITHUB_REPOSITORY_ID),runId:Number(process.env.GITHUB_RUN_ID),runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT)},sourceSha:collection.identity.sourceSha,packageSha256:check.artifact.sha256,environment:{kind:'installed-app',target:check.artifact.platform,runnerId:process.env.RUNNER_NAME??'unavailable',fixture:'synthetic-profile-on-actual-installed-app'},observed,verdict};
  fs.writeFileSync(file,JSON.stringify(detail,null,2));const bytes=fs.readFileSync(file);
  reports.push({startedAt,endedAt:new Date().toISOString(),testId:check.id,requirementId:check.requirementId,expected:check.expected,sourceSha:collection.identity.sourceSha,artifactDigest:check.artifact.sha256,...pins,environment:detail.environment,observed,verdict,file:{path:file,sha256:hashBytes(bytes),size:bytes.length}});
 };
 const supported=process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&((target==='mac'&&process.platform==='darwin')||(target!=='mac'&&process.platform==='win32'));
 if(!supported) {for(const check of checks)record(check,'NOT_RUN','Disposable supported native host unavailable');return {plan,reports};}
 const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hps-installed-')));
 const signing={teamId:process.env.HPS_NATIVE_EXPECTED_TEAM_ID,thumbprint:process.env.HPS_NATIVE_EXPECTED_PUBLISHER_THUMBPRINT};
 const asset=collection.assets.find(a=>a.id===artifactRole);const currentFile=packageFile(assetsDirectory,asset);
 let installedApp;
 for(const check of checks) {
  try {
   if(check.id.startsWith('INSTALL-')) {
    if(process.platform==='win32')nativeSigningEvidence(null,currentFile,signing);
    installedApp=await install(currentFile,path.join(work,'fresh'),target);const app=assertApp(installedApp,collection.identity.sourceSha,collection.identity.version.slice(1));
    const security=nativeSigningEvidence(installedApp,currentFile,signing);
    const native=await probe(installedApp,{profile:path.join(work,'fresh-profile'),proofPath:path.join(outputDirectory,`${check.id}.png`)});
    record(check,'PASS','Untouched candidate installed and its exact executable rendered the native workbench',{app,native,security});
   } else if(check.id.startsWith('UPDATE-')) {
    requireThat(previous,'N−1 release packages/source not available');const previousAsset=previous.assets.find(a=>a.id===artifactRole);requireThat(previousAsset,'N−1 artifact role missing');
    const previousFile=packageFile(previousDirectory,previousAsset);if(process.platform==='win32')nativeSigningEvidence(null,previousFile,signing);
    const oldApp=await install(previousFile,path.join(work,'update'),target);
    assertApp(oldApp,previous.sourceSha,previous.version);
    const workspace=path.join(work,'persistent-workspace'),profile=path.join(work,'update-profile');fs.mkdirSync(workspace);fs.mkdirSync(profile);
    requireThat(process.env.HPS_NATIVE_TEST_SEAT_FILE,'existing synthetic Service account seat unavailable');
    const seat=JSON.parse(fs.readFileSync(process.env.HPS_NATIVE_TEST_SEAT_FILE,'utf8'));
    const observed=await executeProductUpdate({root:work,oldApp,profile,workspace,assetFile:currentFile,asset:{...asset,id:target},sourceSha:collection.identity.sourceSha,version:collection.identity.version,seat,output:path.join(outputDirectory,check.id),signing});
    requireThat(observed.status==='PASS'&&observed.uiCheckInstallRestart&&observed.accountContinuity.noSecondApproval,'actual product updater and account continuity proof missing');
    record(check,'PASS','Actual updater UI downloaded pinned candidate, installed and restarted it in isolated profile; workspace/settings and existing synthetic Service account retained',{previousReleaseId:previous.releaseId,previousAsset,observed});
   } else {
    requireThat(installedApp,'actual installed candidate unavailable for public flows');
    const app=assertApp(installedApp,collection.identity.sourceSha,collection.identity.version.slice(1));
    requireThat(process.env.ANTHROPIC_API_KEY&&process.env.HPS_SERVICE_SOURCE,'pinned Service/model access unavailable');
    // Existing drivers exercise trial/classroom, isolation, persistence, encrypted
    // storage and public Service on the installed candidate, never browser fixtures.
    const env={...process.env,HPS_INSTALLED_PORTABLE_REFERENCE:process.env.HPS_INSTALLED_PORTABLE_REFERENCE};
    execFileSync(process.execPath,[path.join(root,'e2e/unified-release/run.mjs'),installedApp,assetsDirectory,path.join(outputDirectory,'activities'),collection.identity.sourceSha,app.version],{env,stdio:'pipe',timeout:1200000});
    execFileSync(process.execPath,[path.join(root,'e2e/unified-release/public.mjs'),installedApp,path.join(outputDirectory,'activities/public'),collection.identity.sourceSha,app.version],{env,stdio:'pipe',timeout:1200000});
    const receipt=JSON.parse(fs.readFileSync(path.join(outputDirectory,'activities/receipt.json'),'utf8'));
    requireThat(receipt.status==='PASS'&&receipt.sourceSha===collection.identity.sourceSha&&receipt.treeBefore===receipt.treeAfter,'installed activity receipt missing');
    const publicReceipt=receipt.publicService;
    requireThat(publicReceipt?.status==='PASS'&&publicReceipt.activities?.length===2,'public Service receipt missing');
    record(check,'PASS','Existing native trial/classroom and public Service drivers passed on actual installed candidate',{app,receipt,publicReceipt});
   }
  } catch(error) {const missing=/^BLOCKED:|unavailable|not available|access|credential store/.test(error.message??'');record(check,missing?'BLOCKED':'FAIL',error.message?.startsWith('Cloud executor:')?error.message:(missing?'Native host, original N−1 updater capability, signing, isolated account seat or pinned Service access unavailable':'Native process failed its installation/update contract'),{nativeProcessExitCode:Number.isInteger(error.status)?error.status:null});}
 }
 return {plan,reports};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 const [collectionFile,previousDirectory,assetsDirectory,outputDirectory,target]=process.argv.slice(2);
 try {
  const collection=JSON.parse(fs.readFileSync(collectionFile,'utf8'));
  const previousPath=path.join(previousDirectory,'previous.json');
  const context=process.env.HPS_VERIFICATION_CONTEXT?JSON.parse(fs.readFileSync(process.env.HPS_VERIFICATION_CONTEXT,'utf8')):null;
  requireThat(!engineEnabled()||context,'configured canonical verification context required');
  const result=await executeInstalledTarget({collection,policy:context?.policy??JSON.parse(fs.readFileSync(path.join(root,'scripts/release/engine/policy.example.json'),'utf8')),pins:context?{serviceSha:context.serviceSha,testRevision:context.testRevision,rubricRevision:context.rubricRevision}:{serviceSha:JSON.parse(fs.readFileSync(path.join(root,'config/service-deployment.json'),'utf8')).sha,testRevision:collection.identity.sourceSha,rubricRevision:collection.identity.sourceSha},previous:fs.existsSync(previousPath)?JSON.parse(fs.readFileSync(previousPath,'utf8')):null,assetsDirectory,previousDirectory,outputDirectory,target});
  fs.writeFileSync(path.join(outputDirectory,'installed-reports.json'),JSON.stringify(result,null,2));
  if(result.reports.some(r=>r.verdict!=='PASS'))process.exitCode=2;
 }catch {console.error('BLOCKED installed runner identity/setup invalid');process.exitCode=2;}
}
