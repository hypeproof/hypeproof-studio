#!/usr/bin/env node
// Provider-free integration proof through the unmodified real CLI and its admission checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {runtimeEnvironment} from './hosted-shell.mjs';
import {compatibilityEnvironment} from '../unified-release/output-bound.mjs';
import {digest} from '../feedback-live/guard.mjs';
import {PINNED_APP_BUNDLES} from '../feedback-live/trace.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),[evidence,binary,studioSha,serviceSource,serviceSha]=args;
const revisionFlags=args.filter(x=>x.startsWith('--revision-case='));assert(revisionFlags.length<=1);const revisionCase=revisionFlags[0]?.split('=')[1];assert(!revisionCase||['edit-complete','edit-missing'].includes(revisionCase));
if(args.includes('--help')||args.length<5){console.log('node render-completion-cli-probe.mjs EVIDENCE SDK_BINARY STUDIO_SHA SERVICE_SOURCE SERVICE_SHA [--execute] [--revision-case=edit-complete|edit-missing]\nDefault prepares only. Execute requires this probe and implementation committed, clean exact source; isolated loopback scripted requests only.');process.exit(args.includes('--help')?0:2);}
for(const value of[evidence,binary,serviceSource])assert(path.isAbsolute(value));
for(const value of[studioSha,serviceSha])assert(/^[a-f0-9]{40}$/.test(value));
assert(!fs.existsSync(evidence),'Fresh proof directory required');fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const git=(directory,...argv)=>execFileSync('git',argv,{cwd:directory,encoding:'utf8'}).trim();
const hash=file=>digest(fs.readFileSync(file));
const fixtureFiles=['e2e/feedback-live/run.mjs','e2e/feedback-live/guard.mjs','e2e/feedback-live/render-completion.mjs','e2e/feedback-live/render-host.mjs','e2e/feedback-native/service.mjs','e2e/feedback-native/completion-upstream.mjs','e2e/feedback-native/render-completion-cli-probe.mjs'];
const report={schema:'hps-render-completion-cli-probe/1',status:'PREPARED_NOT_EXECUTED',revision_case:revisionCase??null,provider_called:false,native_ui:'NOT_RUN',source:{requested:studioSha,actual:git(root,'rev-parse','HEAD'),tracked_clean:git(root,'status','--porcelain','--untracked-files=no')===''},fixture_sha256:Object.fromEntries(fixtureFiles.map(f=>[f,hash(path.join(root,f))])),service_source:serviceSha,sdk_binary_sha256:hash(binary),caps:{requests:12,candidate_claims:3,screenshots:6,output_tokens:4096},originals:{}};
const save=()=>fs.writeFileSync(path.join(evidence,'probe.json'),JSON.stringify(report,null,2),{mode:0o600});save();
if(!args.includes('--execute')){console.log(JSON.stringify({status:report.status,evidence,provider_called:false}));process.exit(0);}
assert.equal(report.source.actual,studioSha);assert(report.source.tracked_clean,'Exact committed implementation required before any process starts');
for(const file of fixtureFiles)git(root,'ls-files','--error-unmatch',file);
assert.equal(git(serviceSource,'rev-parse','HEAD'),serviceSha);assert.equal(git(serviceSource,'status','--porcelain','--','worker/src','worker/schema.sql','worker/test/harness'),'');
assert.equal(fs.realpathSync(serviceSource),serviceSource);assert(!fs.lstatSync(binary).isSymbolicLink());
const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hps-render-cli-proof-'))),workspace=path.join(base,'workspace'),serviceDir=path.join(base,'service'),cliEvidence=path.join(evidence,'cli');
for(const directory of[workspace,serviceDir,cliEvidence])fs.mkdirSync(directory,{mode:0o700});
const write=(file,value)=>fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const env=runtimeEnvironment(process.env);for(const key of Object.keys(env))if(/^(?:ANTHROPIC|CLAUDE|OPENAI|GEMINI|GOOGLE)_/.test(key)||key==='NODE_OPTIONS')delete env[key];
Object.assign(env,compatibilityEnvironment(env),{HPS_SERVICE_SOURCE:serviceSource,HPS_SERVICE_SHA:serviceSha,APPDATA:path.join(base,'app-data'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
const wait=async(fn,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out '+label);};
const processHash=pid=>digest(execFileSync('ps',['-p',String(pid),'-o','lstart=,command='],{env:{...env,LC_ALL:'C'}}));
const readJson=file=>JSON.parse(fs.readFileSync(file));
let service,cli,browser;const serviceErrors=[],cliOutput=[];
async function metadata(origin,route,headers){const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert(!['8802','8803'].includes(url.port));const r=await fetch(url.origin+route,{headers,redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return r.json();}
try{
 report.status='RUNNING';save();
 // Reference pixels are fixture input. Candidate outputs do not exist until SDK Write.
 const fixture=path.join(root,'extensions/hypeproof-chat/test/fixtures/reference-design/keyboard.html'),html=fs.readFileSync(fixture,'utf8'),editedHtml=html+'\n<p>Provider-free final revision</p>';assert.notEqual(editedHtml,html);write(path.join(workspace,'reference.html'),html);
 const {chromium}=createRequire(path.join(root,'e2e/package.json'))('playwright');
 browser=await chromium.launch({headless:true,env});const context=await browser.newContext({viewport:{width:390,height:700}});await context.route('**/*',route=>route.request().url().startsWith('file:')?route.continue():route.abort());const page=await context.newPage();await page.goto(pathToFileURL(path.join(workspace,'reference.html')).href);await page.evaluate(()=>document.fonts.ready);const pixels=await page.screenshot({type:'png'});await browser.close();browser=null;
 write(path.join(workspace,'reference.png'),pixels);
 const capture={schema:'hps-reference-capture/1',url:null,title:'Synthetic keyboard fixture',capturedAt:new Date().toISOString(),mime:'image/png',sha256:digest(pixels),bytes:pixels.length,viewport:{width:390,height:700,deviceScaleFactor:1},state:'rest',readiness:{document:'complete',fonts:'loaded',pendingImages:0}};
 write(path.join(workspace,'capture.json'),capture);
 const brief={schema:'hps-reference-design/1',captures:[capture],fields:Object.fromEntries(['goal','subject','layout','depth','style','motion','responsive','functionality','exclusions'].map(name=>[name,{value:null,provenance:'unknown',evidence:[]}]))};
 const repetitionId='hps-render-20261016-r3-'+randomBytes(16).toString('hex');
 write(path.join(serviceDir,'render-config.json'),{completion:true,cli:true,workspace,repetitionId,outputHtml:'candidate-1.html',outputBrief:'candidate-1.brief.json',candidateHtml:html,brief,...(revisionCase?{revisionCase,editedHtml}:{})});
 service=spawn(process.execPath,['--experimental-strip-types','--experimental-sqlite',path.join(root,'e2e/feedback-native/service.mjs'),serviceDir,'--scripted-render'],{cwd:root,env,stdio:['ignore','ignore','pipe']});service.stderr.on('data',b=>{if(serviceErrors.length<64)serviceErrors.push(digest(b));});service.on('error',()=>{});
 await wait(()=>{assert(service.exitCode===null&&service.signalCode===null,'Owned Service exited during startup');return fs.existsSync(path.join(serviceDir,'cli-startup.json'));},'owned CLI Service startup');
 const manifest=readJson(path.join(serviceDir,'service.json')),binding=readJson(path.join(serviceDir,'cli-startup.json'));
 assert.equal(binding.pid,service.pid);assert.equal(binding.source_sha,serviceSha);assert.equal(binding.source_directory,serviceSource);assert.equal(binding.process_sha256,processHash(service.pid));assert.equal(binding.env_sha256,hash(binding.env_file));
 const identity=await metadata(manifest.origin,'/__feedback-native/identity');assert.equal(identity.pid,service.pid);assert.equal(identity.source_sha,serviceSha);assert.equal(identity.env_sha256,binding.env_sha256);assert.equal(identity.env_file,binding.env_file);assert.equal(identity.actual_provider_keys_in_service,false);
 const token=fs.readFileSync(manifest.token_a_file,'utf8'),headers={authorization:'Bearer '+token};
 const activity=await metadata(manifest.origin,'/v1/activity',headers),profile=await metadata(manifest.origin,'/v1/profile',headers);assert.equal(activity.activity_id,identity.activity_id);assert.equal(profile.sdk_tools.browser,true);
 const guard=await metadata(manifest.scripted.origin,'/__feedback/guard');assert.equal(guard.activity_sha256,digest(activity.activity_id));assert.equal(guard.armed,false);assert.equal(guard.attempts,0);assert.equal(guard.candidate_attempts,0);assert.equal(guard.render_screenshot_attempts,0);
 write(path.join(workspace,'.feedback-live-owned.json'),{schema:'hps-feedback-live-workspace/1',activity_sha256:digest(activity.activity_id),disposable:true});
 const inputSnapshot=path.join(evidence,'original-inputs');fs.mkdirSync(inputSnapshot,{mode:0o700});
 for(const file of fs.readdirSync(workspace)){report.originals[file]=hash(path.join(workspace,file));fs.copyFileSync(path.join(workspace,file),path.join(inputSnapshot,file),fs.constants.COPYFILE_EXCL);}
 const prompt=path.join(base,'prompt.txt');write(prompt,'HPS_COMPLETION_PROOF:'+(revisionCase??'positive')+'\nCreate candidate-1.html and candidate-1.brief.json from the synthetic reference. Inspect actual viewport pixels. '+(revisionCase?'Capture the first revision at390, edit the candidate, reload, and capture the final revision. '+(revisionCase==='edit-missing'?'End the first turn before final1280; evidence continuation must retain the observed SDK session.':'Complete final390 and1280 in the initial turn.'):'This fixture deliberately ends its first turn after390; acceptance continuation must retain the observed SDK session.'));
 const config={schema:'hps-feedback-live/1',sourceSha:studioSha,workspace,evidence:cliEvidence,dependencyRoot:path.join(root,'extensions/hypeproof-chat'),activityId:activity.activity_id,model:'hypeproof-fast',syntheticInputs:true,service:{origin:manifest.origin,tokenFile:manifest.token_a_file,envFile:binding.env_file,sourceDirectory:serviceSource,sourceSha:serviceSha,bindingFile:path.join(serviceDir,'cli-startup.json'),bindingSha256:hash(path.join(serviceDir,'cli-startup.json')),processSha256:binding.process_sha256},guard:{origin:manifest.scripted.origin,id:guard.guard_id,serviceCredentialFile:path.join(serviceDir,'completion-service'),controlKeyFile:path.join(serviceDir,'completion-control')},sdkBinary:{path:binary,version:'0.3.299',sha256:hash(binary)},renderFeedback:{enabled:true,mode:'owned-headless',repetitionId,widths:[390,1280],maxScreenshots:6,browserDependencyRoot:path.join(root,'e2e')},renderCompletion:{enabled:true,mode:'missing-width-only'},attempts:[{runtime:'sdk',scenario:'T10-T11',promptFile:prompt,promptSha256:hash(prompt),images:[{path:'reference.png',sha256:capture.sha256}],outputPaths:['candidate-1.html','candidate-1.brief.json'],briefPath:'candidate-1.brief.json',timeoutMs:180000}]};
 for(const name of config.attempts[0].outputPaths)assert(!fs.existsSync(path.join(workspace,name)),'Candidate must not be preseeded');
 const configFile=path.join(base,'run.json');write(configFile,config);report.startup={pid:service.pid,binding_sha256:config.service.bindingSha256,env_sha256:binding.env_sha256,process_sha256:binding.process_sha256,guard_id:guard.guard_id,activity_sha256:guard.activity_sha256};save();
 const command=[path.join(root,'e2e/feedback-live/run.mjs'),configFile,'--allow-render-feedback','--allow-render-completion','--allow-live','--arm-guard'];
 cli=spawn(process.execPath,command,{cwd:root,env,stdio:['ignore','pipe','pipe']});for(const stream of[cli.stdout,cli.stderr])stream.on('data',b=>{if(cliOutput.length<128)cliOutput.push(digest(b));});cli.on('error',()=>{});
 await wait(()=>cli.exitCode!==null||cli.signalCode!==null,'actual CLI terminal result',210000);report.cli_exit_code=cli.exitCode;report.cli_signal=cli.signalCode;
 const result=readJson(path.join(cliEvidence,'result.json'));report.cli_result_sha256=hash(path.join(cliEvidence,'result.json'));assert.equal(cli.exitCode,0);assert.equal(result.status,'PASS_SELECTED_BACKGROUND_SLICE');assert.equal(result.preflight.source_sha,studioSha);assert.deepEqual(result.runtime_bundle_sha256,PINNED_APP_BUNDLES);
 const continuations=revisionCase==='edit-complete'?0:1;assert.equal(result.attempts.length,continuations+1);const first=result.attempts[0],last=result.attempts.at(-1);assert.equal(last.status,'PASS_TRANSPORT_AND_DECLARED_CHECKS');assert.equal(last.completion.status,'COMPLETE');assert(first.sdk_session.session_sha256);if(continuations){assert.equal(first.status,'INCOMPLETE_EVIDENCE');assert.deepEqual(first.completion.missing,[1280]);assert.equal(first.sdk_session.session_sha256,last.sdk_session.session_sha256);assert.deepEqual(first.outputs,last.outputs);}assert.equal(result.render_feedback.host.cleanup.status,'PASS');
 const captures=last.render_captures;assert.equal(captures.length,revisionCase?3:2);if(revisionCase){assert.equal(captures[0].source_sha256,digest(html));assert.deepEqual(captures.slice(1).map(x=>x.source_sha256),[digest(editedHtml),digest(editedHtml)]);assert.deepEqual(captures.slice(1).map(x=>x.page.frameWidth),[390,1280]);for(const capture of captures)for(const snapshot of Object.values(capture.revision))assert.equal(hash(path.join(cliEvidence,snapshot.file)),snapshot.sha256);report.revision_evidence={historical_captures:1,final_captures:2,source_snapshots:new Set(captures.map(x=>x.revision.source.file)).size,all_retained_and_charged:true};}
 const finalGuard=await metadata(manifest.scripted.origin,'/__feedback/guard'),observations=readJson(path.join(serviceDir,'completion-observations.json')),requests=await metadata(manifest.origin,'/__feedback-native/requests');
 assert.equal(finalGuard.attempts,revisionCase==='edit-complete'?11:revisionCase==='edit-missing'?12:9);assert.equal(finalGuard.candidate_attempts,continuations+1);assert.equal(finalGuard.render_screenshot_attempts,revisionCase?3:2);assert(finalGuard.rows.every(r=>r.max_tokens===undefined||r.max_tokens<=4096));assert.equal(finalGuard.completion.held,false);assert.equal(requests.blocked_outbound,0);
 assert(observations.some(r=>r.completed_fixture_tools?.includes('completion_write_html')&&r.completed_fixture_tools.includes('completion_write_brief')),'Actual SDK Write results required');
 assert.equal(observations.some(r=>r.resumed),continuations>0);assert(observations.filter(r=>r.resumed).every(r=>r.prior_user_present&&r.prior_image_hashes.length&&!r.advertised_tools.includes('Write')));
 for(const[file,sha]of Object.entries(report.originals))assert.equal(hash(path.join(workspace,file)),sha);
 assert.equal(hash(path.join(workspace,'candidate-1.html')),digest(revisionCase?editedHtml:html));assert.deepEqual(readJson(path.join(workspace,'candidate-1.brief.json')),brief);
 for(const name of['cli-startup.json','completion-guard.json','completion-observations.json'])fs.copyFileSync(path.join(serviceDir,name),path.join(evidence,name),fs.constants.COPYFILE_EXCL);
 report.captured_source_versions=result.render_feedback.host.source_versions;assert.equal(report.captured_source_versions.captured_source_version_count,revisionCase?2:1);assert.equal(report.captured_source_versions.uncaptured_source_versions,'UNKNOWN');assert.equal(result.render_feedback.sdk_candidate_claims,finalGuard.candidate_attempts);report.guard_summary={attempts:finalGuard.attempts,candidate_claims:finalGuard.candidate_attempts,screenshots:finalGuard.render_screenshot_attempts,route_proofs:finalGuard.route_proofs};report.originals_preserved=true;report.app_bundles=result.runtime_bundle_sha256;report.sdk_session_sha256=last.sdk_session.session_sha256;report.actual_service_request_count=requests.calls.length;report.status='PASS_ACTUAL_CLI_PROVIDER_ZERO';
}catch(error){report.status='FAIL';report.error={name:error.name,message:String(error.message).slice(0,400)};process.exitCode=1;}
finally{
 await browser?.close();report.cleanup={};for(const[name,child]of[['cli',cli],['service',service]])if(child){if(child.exitCode===null&&child.signalCode===null)child.kill();try{await wait(()=>child.exitCode!==null||child.signalCode!==null,name+' owned exit',10000);report.cleanup[name]='EXIT_OBSERVED';}catch{report.cleanup[name]='FAIL';report.status='FAIL';process.exitCode=1;}}
 report.service_log_hashes=serviceErrors;report.cli_log_hashes=cliOutput;report.finished_at=new Date().toISOString();save();if(Object.values(report.cleanup).every(v=>v==='EXIT_OBSERVED'))fs.rmSync(base,{recursive:true,force:true});else report.retained_private_fixture=base;save();
}
console.log(JSON.stringify({status:report.status,evidence,provider_called:false}));
