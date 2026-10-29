// Build-only; private archives/source/cache never enter the evidence directory.
import {readFile,writeFile,mkdir,mkdtemp,symlink,lstat,unlink,rm,copyFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';import{promisify}from'node:util';import{createHash}from'node:crypto';import{tmpdir}from'node:os';import{join,resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
import{compilerDiagnostics,apkMetadata}from'./compiler-diagnostics.mjs';
import{companionCiInput,validateCompanionPackage}from'../../scripts/companion-ci.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
let stage='guard',ownedLink=false,temp;const output=resolve(process.env.HPS_ANDROID_EVIDENCE??'');
const report={schema:'hps-android-draft-build/1',status:'FAIL',scope:'debug target+instrumentation APK; no auth or installed acceptance'};
const call=async(name,cmd,args,options={})=>{stage=name;try{return await exec(cmd,args,{cwd:root,timeout:300000,maxBuffer:4*1024*1024,...options});}catch(error){report.failedStage=name;report.exitCode=Number.isInteger(error.code)?error.code:null;await writeFile(join(output,'diagnostics.json'),JSON.stringify(compilerDiagnostics(String(error.stdout??'')+'\n'+String(error.stderr??''),name),null,2)+'\n');throw Error('build stage failed');}};
try{
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Linux'||!process.env.RUNNER_TEMP||!output.startsWith(resolve(process.env.RUNNER_TEMP)+'/'))throw Error('owned hosted output required');
 await mkdir(output,{recursive:true});
 const sha=(await call('source','git',['rev-parse','HEAD'])).stdout.trim();if(sha!==process.env.HPS_ANDROID_SOURCE_SHA||!/^[a-f0-9]{40}$/.test(sha))throw Error('source mismatch');
 if((await call('source-clean','git',['status','--porcelain','--untracked-files=no'])).stdout.trim())throw Error('dirty source');report.sourceSha=sha;
 const {archive,pin}=await companionCiInput();report.privateClient={sourceCommit:pin.sourceCommit,archiveSha256:pin.sha256};
 temp=await mkdtemp(join(tmpdir(),'hosted-android-client-'));await call('unpack-client','tar',['-xf',archive,'-C',temp]);validateCompanionPackage(JSON.parse(await readFile(join(temp,'package/package.json'),'utf8')));
 const link=join(root,'apps/companion-android/node_modules');try{await lstat(link);throw Error('dependency link must be absent');}catch(e){if(e.code!=='ENOENT')throw e;}
 await symlink(join(root,'extensions/hypeproof-chat/node_modules'),link,'dir');ownedLink=true;
 // Capture bundler output too: esbuild's default diagnostics can contain private source snippets.
 const assetProgram=`import {buildCompanionAndroidWeb} from './apps/companion-android/build-web.mjs';const {report:r}=await buildCompanionAndroidWeb({client:process.env.HPS_BUILD_CLIENT,selection:process.env.HPS_BUILD_SELECTION});console.log(JSON.stringify({jsSha256:r.jsSha256,htmlSha256:r.htmlSha256,reactVersion:r.reactVersion,clientEntrySha256:r.clientEntrySha256,selectionSha256:r.selectionSha256}));`;
 const assets=await call('assets',process.execPath,['--input-type=module','-e',assetProgram],{env:{...process.env,HPS_BUILD_CLIENT:join(temp,'package/src/index.mjs'),HPS_BUILD_SELECTION:join(root,'extensions/hypeproof-chat/src/companionSelection.ts')}});report.assets=JSON.parse(assets.stdout);
 await writeFile(join(root,'apps/companion-android/local.properties'),'sdk.dir='+process.env.ANDROID_SDK_ROOT+'\n');
 await call('gradle','gradle',['--no-daemon','--console=plain',':app:assembleDebug',':app:assembleDebugAndroidTest',':app:processReleaseMainManifest'],{cwd:join(root,'apps/companion-android')});
 report.apks={};for(const[name,src]of Object.entries({target:'app/build/outputs/apk/debug/app-debug.apk',test:'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'})){
  const dest=join(output,name+'.apk');await copyFile(join(root,'apps/companion-android',src),dest);const bytes=await readFile(dest);const metadata=await call('apk-metadata',join(process.env.ANDROID_SDK_ROOT,'build-tools/34.0.0/aapt'),['dump','badging',dest]);report.apks[name]={file:name+'.apk',sha256:hash(bytes),bytes:bytes.length,...apkMetadata(metadata.stdout,name)};
 }
 const tracked=(await call('source-inputs','git',['ls-files','-z','apps/companion-android','e2e/companion-android','.github/workflows/feedback-candidate.yml','config/service-packages.json','extensions/hypeproof-chat/package-lock.json','extensions/hypeproof-chat/webview-ui/package-lock.json','extensions/hypeproof-chat/src/companionSelection.ts'])).stdout.split('\0').filter(Boolean);report.sourceFiles={};for(const path of tracked)report.sourceFiles[path]=hash(await readFile(join(root,path)));
 report.status='PASS_BUILD_ONLY';
}catch{report.failedStage??=stage;process.exitCode=1;if(process.env.RUNNER_TEMP&&output.startsWith(resolve(process.env.RUNNER_TEMP)+'/')){await mkdir(output,{recursive:true});try{await lstat(join(output,'diagnostics.json'));}catch{await writeFile(join(output,'diagnostics.json'),JSON.stringify(compilerDiagnostics('',stage),null,2)+'\n');}}}
finally{
 report.privateBuildInputsRemoved=true;
 try{if(ownedLink)await unlink(join(root,'apps/companion-android/node_modules'));if(temp)await rm(temp,{recursive:true,force:true});}
 catch{report.privateBuildInputsRemoved=false;report.status='FAIL';report.failedStage='private-input-cleanup';process.exitCode=1;}
 if(process.env.RUNNER_TEMP&&output.startsWith(resolve(process.env.RUNNER_TEMP)+'/'))await writeFile(join(output,'build-receipt.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({status:report.status,failedStage:report.failedStage??null,sourceSha:report.sourceSha??null}));
