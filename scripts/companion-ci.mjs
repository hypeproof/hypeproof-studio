#!/usr/bin/env node
// Source CI only: one verified private archive; no sibling checkout, APK or native app.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,lstat,realpath,symlink,unlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,delimiter} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const toolEnv={...process.env,PATH:dirname(process.execPath)+delimiter+(process.env.PATH??'')};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function companionCiInput(directory=root,manifest){
 const pins=manifest??JSON.parse(await readFile(join(directory,'config/service-packages.json'),'utf8'));
 const matches=pins.packages?.filter(p=>p.asset==='hypeproof-companion-client-0.1.0.tgz')??[];
 if(pins.version!==1||pins.repository!=='hypeproof/hypeproof-service'||matches.length!==1)throw Error('Required pinned companion-client DEV archive is unavailable; publish and pin it before this CI can pass');
 const pin=matches[0];
 if(!/^[a-f0-9]{64}$/.test(pin.sha256)||!/^[a-f0-9]{40}$/.test(pin.sourceCommit)||!/^[a-z0-9][a-z0-9.-]{0,100}$/.test(pin.tag))throw Error('Invalid companion-client immutable pin');
 const archive=join(directory,'.private-service-cache',pin.asset),stat=await lstat(archive);
 if(!stat.isFile()||stat.size>16*1024*1024||digest(await readFile(archive))!==pin.sha256)throw Error('Companion-client archive integrity mismatch');
 return{archive,pin};
}
export function validateCompanionPackage(pkg){
 if(pkg.name!=='@hypeproof/companion-client'||pkg.version!=='0.1.0'||pkg.private!==true
  ||Object.keys(pkg.dependencies??{}).length||Object.keys(pkg.optionalDependencies??{}).length
  ||pkg.exports?.['.']?.import!=='./src/index.mjs'||pkg.exports?.['.']?.types!=='./types/index.d.ts'
  ||pkg.exports?.['./execution']?.import!=='./src/execution.mjs'||pkg.exports?.['./execution']?.types!=='./types/execution.d.ts')throw Error('Unexpected companion-client DEV package contract');
}
export async function runCompanionCi(){
 const {archive,pin}=await companionCiInput();
 // Inspect the verified package before offline installation; never execute package scripts.
 const packed=JSON.parse((await exec('tar',['-xOf',archive,'package/package.json'])).stdout);validateCompanionPackage(packed);
 const temporary=await mkdtemp(join(tmpdir(),'companion-ci-')),output=process.env.COMPANION_CI_OUTPUT?resolve(process.env.COMPANION_CI_OUTPUT):await mkdtemp(join(tmpdir(),'companion-ci-evidence-'));
 await mkdir(output,{recursive:true});const ext=join(root,'extensions/hypeproof-chat'),web=join(ext,'webview-ui'),android=join(root,'apps/companion-android');
 const report={schema:'hps-companion-source-ci/1',verdict:'RUNNING',manifestSourceCommit:pin.sourceCommit,archiveSha256:pin.sha256,steps:[],boundary:'Source/JVM/React/types/browser-bundle only; no APK, Android runtime, Service deployment or real account'};
 let ownedLink=false,deps;const link=join(android,'node_modules');
 async function step(name,command,args,cwd=root,env=toolEnv){
  try{const result=await exec(command,args,{cwd,env,timeout:240000,maxBuffer:16*1024*1024});await writeFile(join(output,name+'.log'),result.stdout+result.stderr);report.steps.push({name,exitCode:0});}
  catch(error){await writeFile(join(output,name+'.log'),String(error.stdout??'')+String(error.stderr??error.message));report.steps.push({name,exitCode:error.code??1});throw Error('Companion CI failed: '+name);}
 }
 try{
  deps=await realpath(join(ext,'node_modules'));
  await writeFile(join(temporary,'package.json'),JSON.stringify({name:'companion-ci-private-input',private:true}));
  await step('install-private-client','npm',['install','--prefix',temporary,'--offline','--ignore-scripts','--no-package-lock','--no-audit','--no-fund',archive],root,{...toolEnv,npm_config_cache:join(temporary,'npm-cache')});
  report.studioCommit=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
  report.workingTreeDirty=!!(await exec('git',['status','--porcelain'],{cwd:root})).stdout.trim();
  report.runnerSha256=digest(await readFile(fileURLToPath(import.meta.url)));
  report.manifestSha256=digest(await readFile(join(root,'config/service-packages.json')));
  const client=join(temporary,'node_modules/@hypeproof/companion-client');validateCompanionPackage(JSON.parse(await readFile(join(client,'package.json'),'utf8')));
  report.clientEntrySha256=digest(await readFile(join(client,'src/index.mjs')));
  const exports=await import(pathToFileURL(join(client,'src/index.mjs')).href);
  for(const name of ['CompanionPreviewClient','CompanionRelayClient','CompanionExecutionClient'])if(typeof exports[name]!=='function')throw Error('Missing actual private-client export: '+name);
  try{await lstat(link);if(await realpath(link)!==deps)throw Error('Android dependency link is owned by another input');}
  catch(error){if(error.code!=='ENOENT')throw error;await symlink(deps,link,'dir');ownedLink=true;}
  const env={...toolEnv,COMPANION_CLIENT_ENTRY:join(client,'src/index.mjs'),COMPANION_SELECTION_ENTRY:join(ext,'src/companionSelection.ts'),COMPANION_REACT_DEPS:join(web,'node_modules'),COMPANION_NODE_PATHS:'',COMPANION_BOOT_REPORT:join(output,'browser-boot.json'),HPS_COMPANION_CLIENT_PACKAGE:client};
  delete env.COMPANION_BOOT_BUNDLE;delete env.COMPANION_ENTRY_BASELINE;delete env.COMPANION_EXECUTION_ENTRY_BASELINE;
  const consumer=join(temporary,'client-contract.mts');
  await writeFile(consumer,`import {CompanionPreviewClient,CompanionRelayClient,CompanionExecutionClient} from '@hypeproof/companion-client';\nimport {CompanionClientAdapter} from ${JSON.stringify(join(ext,'src/companionClientAdapter.ts'))};\nimport type {CompanionExecutionClientPort} from ${JSON.stringify(join(ext,'src/companionExecutionHost.ts'))};\nexport function check(pairing:CompanionPreviewClient,relay:CompanionRelayClient,budget:ConstructorParameters<typeof CompanionClientAdapter>[0]['budget'],options:ConstructorParameters<typeof CompanionExecutionClient>[0]){const execution:CompanionExecutionClientPort=new CompanionExecutionClient(options);return{adapter:new CompanionClientAdapter({pairing,relay,budget,requestId:'ci-request'}),execution};}\n`);
  const options={target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',lib:['ES2022','DOM','DOM.Iterable'],strict:true,skipLibCheck:true,noEmit:true,allowImportingTsExtensions:true,esModuleInterop:true,typeRoots:[join(web,'node_modules/@types'),join(ext,'node_modules/@types')],paths:{react:[join(web,'node_modules/@types/react/index.d.ts')],'react/*':[join(web,'node_modules/@types/react/*')],'react-dom/*':[join(web,'node_modules/@types/react-dom/*')],'@hypeproof/companion-client':[join(client,'types/index.d.ts')],'@companion/selection':[join(ext,'src/companionSelection.ts')]}};
  // Strictly check the private package itself without importing the unrelated SDK's declarations.
  // The product-bound pass below matches both canonical product tsconfigs' skipLibCheck policy.
  const declarations=join(temporary,'client-declarations.mts'),strictConfig=join(temporary,'client-declarations.json');
  await writeFile(declarations,`export {CompanionPreviewClient,CompanionRelayClient,CompanionExecutionClient} from '@hypeproof/companion-client';\n`);
  await writeFile(strictConfig,JSON.stringify({compilerOptions:{...options,skipLibCheck:false},files:[declarations]}));
  await step('private-client-declarations',process.execPath,[join(ext,'node_modules/typescript/bin/tsc'),'-p',strictConfig],root,env);
  const config=join(temporary,'types.json');await writeFile(config,JSON.stringify({compilerOptions:options,files:[consumer,join(android,'web/main.tsx')]}));
  await step('private-client-and-android-types',process.execPath,[join(ext,'node_modules/typescript/bin/tsc'),'-p',config],root,env);
  const tests=(await readdir(join(android,'test'))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>join(android,'test',f));
  if(!tests.some(f=>f.endsWith('/browser-boot.test.mjs')))throw Error('Required actual private-client browser boot is missing');
  await step('android-source-react-browser-build',process.execPath,['--experimental-strip-types','--test',...tests],root,env);
  await step('native-java-source-controls','bash',[join(android,'test/device-sign-in.test.sh')],root,env);
  report.verdict='PASS_SOURCE_ONLY';
 }catch(error){report.verdict='FAIL';throw error;}finally{
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  if(ownedLink&&await realpath(link)===deps)await unlink(link);
  await rm(temporary,{recursive:true,force:true});
 }
 console.log('Companion source CI passed; no installed/production claim. Evidence: '+output);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runCompanionCi().catch(error=>{console.error(error.message);process.exitCode=1;});
