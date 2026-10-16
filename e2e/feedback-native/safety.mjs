import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {vendorManifest} from '../../scripts/studio-dev-vendor.mjs';
export const sha256=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceScopes=['extensions/hypeproof-chat','scripts/studio-dev.py','scripts/studio-dev-vendor.mjs','config/service-packages.json'];
export function sourceSnapshot(source){
 const git=(...args)=>execFileSync('git',args,{cwd:source});
 const sha=git('rev-parse','HEAD').toString().trim(),status=git('status','--porcelain=v1','-z','--untracked-files=no'),untracked=git('ls-files','-z','--others','--exclude-standard','--',...sourceScopes);
 const names=[...new Set(git('ls-files','-z','--cached','--others','--exclude-standard','--',...sourceScopes).toString('utf8').split('\0').filter(Boolean))].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
 let symlinks=false;
 const entries=names.map(name=>{const file=path.join(source,name);let stat;try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return[name,'missing',''];throw error;}if(stat.isSymbolicLink()){symlinks=true;return[name,'symlink',fs.readlinkSync(file)];}if(!stat.isFile())throw Error('Cannot bind non-file source input: '+name);return[name,'file',sha256(file)];});
 return {format:'hps-studio-source/1',sha,dirty:!!(status.length||untracked.length),scopes:sourceScopes,inputs_sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),file_count:entries.length,has_symlinks:symlinks,status_sha256:createHash('sha256').update(status).update(Buffer.from([0])).update(untracked).digest('hex')};
}
export function loopback(value){const url=new URL(value);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash)throw Error('Only an explicit credential-free loopback HTTP endpoint is allowed');return url.origin;}
export function within(child,parent){const rel=path.relative(path.resolve(parent),path.resolve(child));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
export function validateConfig(c){
 if(c?.schema!=='hps-feedback-native/1'||!c.candidate?.app||!c.candidate?.receipt||!c.service?.manifest||!c.workspace?.a||!c.workspace?.b||!c.evidence)throw Error('Missing explicit candidate/Service/workspace/evidence config');
 loopback(c.service.origin);if(c.cdp)loopback(c.cdp);
 for(const p of [c.candidate.app,c.candidate.receipt,c.workspace.a,c.workspace.b,c.evidence,c.userDataDir,c.service.manifest,c.service.tokenAFile])if(typeof p!=='string'||!path.isAbsolute(p))throw Error('All local paths must be explicit absolute paths');
 if(c.service.tokenBFile!==undefined&&(typeof c.service.tokenBFile!=='string'||!path.isAbsolute(c.service.tokenBFile)))throw Error('tokenBFile must be an explicit absolute path');
 if(c.workspace.c!==undefined){if(typeof c.workspace.c!=='string'||!path.isAbsolute(c.workspace.c))throw Error('C must be an explicit absolute path');for(const other of[c.candidate.app,c.workspace.a,c.workspace.b])if(within(c.workspace.c,other)||within(other,c.workspace.c))throw Error('C must be isolated from the app and both activity-A folders');}
 if(c.workspace.c&&fs.existsSync(c.workspace.c)){const real=fs.realpathSync(c.workspace.c);for(const other of[c.candidate.app,c.workspace.a,c.workspace.b])if(fs.existsSync(other)){const target=fs.realpathSync(other);if(within(real,target)||within(target,real))throw Error('Real C must remain isolated, including linked paths');}}
 if(c.scenarios?.includes('activity-isolation')&&(!c.workspace.c||!c.service.tokenBFile))throw Error('Activity isolation requires explicit token B and third owned folder C');
 if(c.scenarios?.includes('history-streaming')){
  if(c.attach||typeof c.workspace.d!=='string'||!path.isAbsolute(c.workspace.d))throw Error('History/streaming requires owned fresh D and process');
  const real=fs.realpathSync(c.workspace.d);for(const other of[c.candidate.app,c.workspace.a,c.workspace.b,c.workspace.c])if(other&&fs.existsSync(other)){const target=fs.realpathSync(other);if(within(real,target)||within(target,real))throw Error('Fresh D must remain isolated, including linked paths');}
 }
 if(path.resolve(c.workspace.a)===path.resolve(c.workspace.b))throw Error('A and B must be different real folders');
 if(within(c.userDataDir,c.candidate.app)||within(c.workspace.a,c.candidate.app)||within(c.workspace.b,c.candidate.app)||within(c.evidence,c.candidate.app))throw Error('User data, work and evidence must remain outside the application');
 if(c.secretStorage!=='os-keychain'&&c.secretStorage!=='inmemory')throw Error('Declare secretStorage os-keychain or inmemory; the latter cannot prove process restart credential persistence');
 return c;
}
export function candidateProof(c){
 const app=fs.realpathSync(c.candidate.app),receipt=JSON.parse(fs.readFileSync(c.candidate.receipt,'utf8'));
 if(receipt.format!=='hps-studio-dev/1'||receipt.official_app_unchanged!==true||fs.realpathSync(receipt.app)!==app)throw Error('A studio-dev.py isolated-copy receipt is required; installed application is not an acceptance target');
 const resources=path.join(app,process.platform==='darwin'?'Contents/Resources/app':'resources/app'),extension=path.join(resources,'extensions/hypeproof-chat');
 const actual=sha256(path.join(extension,'dist/extension.js'));
 if(actual!==receipt.extension_sha256)throw Error('Candidate extension bytes differ from the preparation receipt');
 const source=fs.realpathSync(receipt.source),binding=sourceSnapshot(source),sourceSha=binding.sha;
 if(!/^[a-f0-9]{40}$/.test(receipt.source_sha??'')||receipt.source_sha!==sourceSha)throw Error('Preparation receipt source SHA is missing or stale; reprepare this exact checkout');
 if(receipt.source_dirty!==false||receipt.source_binding?.dirty!==false||binding.dirty)throw Error('Candidate source changed or was dirty at preparation; commit/reprepare before acceptance');
 if(receipt.source_binding?.format!=='hps-studio-source/1'||receipt.source_binding.has_symlinks!==false||binding.has_symlinks||!isDeepStrictEqual(receipt.source_binding,binding))throw Error('Preparation receipt source input binding is missing or changed');
 if(c.candidate.sourceSha&&c.candidate.sourceSha!==sourceSha)throw Error('Candidate source SHA is stale');
 if(sha256(path.join(path.dirname(c.candidate.receipt),'build/extension.js'))!==actual)throw Error('Preparation stage build output differs from injected candidate');
 const product=JSON.parse(fs.readFileSync(path.join(resources,'product.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(extension,'package.json'),'utf8'));
 if(pkg.dependencies?.['@anthropic-ai/claude-agent-sdk']||pkg.devDependencies?.['@anthropic-ai/claude-agent-sdk']){
  if(receipt.sdk_vendor?.schema!=='hps-dev-sdk-vendor/1')throw Error('Prepared SDK vendor receipt required');
  const actualVendor=vendorManifest(path.join(extension,'dist/vendor'));
  if(actualVendor.sha256!==receipt.sdk_vendor.sha256||actualVendor.file_count!==receipt.sdk_vendor.file_count)throw Error('Candidate SDK vendor bytes differ from preparation');
 }
 return {level:'prepared-injected-native-candidate',source_sha:receipt.source_sha,source_binding:binding,prepared_at:receipt.prepared_at,app,extension_sha256:actual,shell:{name:product.nameLong,version:product.version,commit:product.commit},extension_version:pkg.version,commandTitles:Object.fromEntries(pkg.contributes.commands.map(x=>[x.command,x.title])),commands:pkg.contributes.commands.map(x=>x.command),source_dirty:false,public_release:false};
}
export function sanitize(text,secrets=[]){let result=String(text);for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))result=result.split(secret).join('[REDACTED]');return result.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]');}
export function assertNoBackdoors(userDataDir,launchEnv){
 const testKeys=Object.keys(launchEnv).filter(key=>key.startsWith('HPS_TEST_'));
 if(testKeys.some(key=>!['HPS_TEST_E2E','HPS_TEST_REAL_WORKSPACE'].includes(key))||testKeys.length&&(launchEnv.HPS_TEST_E2E!=='1'||launchEnv.HPS_TEST_REAL_WORKSPACE!=='1'))throw Error('Only paired analytics isolation + explicit production workspace routing is accepted; no token/history backdoors');
 if(fs.existsSync(path.join(userDataDir,'User/hps-test-state.json')))throw Error('A test-state backdoor file prevents production-routing acceptance');
}
// Config/environment cannot opt a user's desktop into input. Only an explicit invocation flag can.
export const foregroundAllowed=args=>args.includes('--allow-foreground')&&!args.includes('--preflight');

// Orchestration guard only: callbacks must observe real process/UI transitions.
// There is deliberately no force-kill, token-entry or fallback callback.
export async function restartOwnedCandidate({config,child,quit,waitExit,waitCdpDown,launch,observeDraft,expectedDraft,onProgress=()=>{}}){
 if(config.attach||config.secretStorage!=='os-keychain')throw Object.assign(Error('Full credential restart requires owned process and OS-backed SecretStorage'),{blocked:true});
 if(!child||!Number.isInteger(child.pid)||child.exitCode!==null||child.signalCode!==null)throw Error('Owned candidate must be alive before native quit');
 const oldPid=child.pid;
 await quit();onProgress({phase:'native_quit_requested',old_pid:oldPid});
 await waitExit(child);
 if(child.exitCode!==0||child.signalCode!==null)throw Error('Native quit must produce normal owned child exit, not a signal kill');
 onProgress({phase:'owned_child_normal_exit',old_pid:oldPid,exit_code:child.exitCode});
 await waitCdpDown();onProgress({phase:'prior_cdp_connection_refused',old_pid:oldPid});
 const restarted=await launch();
 if(!restarted||!Number.isInteger(restarted.pid)||restarted.pid===oldPid||restarted.exitCode!==null||restarted.signalCode!==null)throw Error('Restart must create a different live owned process');
 onProgress({phase:'new_owned_process_launched',old_pid:oldPid,new_pid:restarted.pid,same_profile:true});
 const observed=await observeDraft();
 if(observed!==expectedDraft)throw Error('Persisted A draft did not restore after full process restart without code entry');
 onProgress({phase:'restored_chat_and_draft_observed',new_pid:restarted.pid,code_reentry:false});
 return {old_pid:oldPid,new_pid:restarted.pid,owned_child_exit:true,cdp_down:true,same_profile:true,os_secret_storage:true,code_reentry:false,actual_chat_restored:true,draft_preserved:true};
}
export function distinctActivities(a,b){
 if(!/^[a-f0-9]{64}$/.test(a?.activity_id??'')||!/^[a-f0-9]{64}$/.test(b?.activity_id??'')||a.activity_id===b.activity_id)throw Error('Token B must authenticate a different actual Service activity identity');
 return true;
}

// Observe the exact file created by native Save As; no replacement/repair fallback.
export function verifyRestartArtifacts({sidebarVisible,savedFile,workspace}){
 if(sidebarVisible!==false)throw Error('User hidden sidebar must remain hidden after full restart');
 if(!savedFile||!path.isAbsolute(savedFile.path)||!within(savedFile.path,workspace)||!within(fs.realpathSync(savedFile.path),fs.realpathSync(workspace)))throw Error('Saved native file must remain in its actual workspace');
 if(fs.lstatSync(savedFile.path).isSymbolicLink()||sha256(savedFile.path)!==savedFile.sha256)throw Error('Actual native saved file bytes changed across full restart');
 return {hidden_sidebar_preserved:true,saved_file_preserved:true,saved_file_sha256:savedFile.sha256};
}

export function sdkProtocolProof(config,service,sdk){
 const proof=config.sdkProtocolProof;
 if(!proof||!path.isAbsolute(proof.file??'')||!fs.existsSync(proof.file)||sha256(proof.file)!==proof.sha256)throw Error('Actual background SDK protocol proof is missing or changed');
 const value=JSON.parse(fs.readFileSync(proof.file,'utf8'));
 if(value.status!=='PASS'||value.protocol_readiness!=='PASS_REAL_SDK_SCRIPTED_PROTOCOL'||value.cancellation_verdict!=='PASS_ALL_LAYERS'||value.provider_called!==false||value.studio_source_sha!==config.candidate.sourceSha||value.studio_dirty!==false||value.service?.sha!==service.source.sha||value.sdk_binary_sha256!==sdk.sha256||value.sdk_version!==sdk.version)throw Error('Scripted SDK proof does not match the actual source/Service/binary/cancellation boundary');
 for(const file of ['service.mjs','scripted-upstream.mjs','scripted-sdk-probe.mjs','session-control.mjs'])if(value.fixture_hashes?.[file]!==sha256(fileURLToPath(new URL(file,import.meta.url))))throw Error('Scripted protocol fixture bytes changed');
 return {sha256:proof.sha256,protocol:value.protocol_readiness,cancellation:value.cancellation_verdict,provider_called:false};
}
