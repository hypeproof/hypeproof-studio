import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {renderConfig,renderProfile,startRenderHost,capturedSourceVersions,captureEvidenceStore,assertCapturedResponse,ownedFetchInterception,priorScreenshotCalls,screenshotReservationClient} from './render-host.mjs';import {toolResultImageHashes,screenshotCallHashes,digest,startGuard} from './guard.mjs';
import {createCompletionSession} from './render-completion.mjs';
const config={renderFeedback:{enabled:true,mode:'owned-headless',widths:[390,1280],maxScreenshots:6,repetitionId:'hps-render-20261016-r1-'+'a'.repeat(32),browserDependencyRoot:'/owned/e2e'},attempts:[{runtime:'sdk',scenario:'T10-T11',outputPaths:['candidate-1/keyboard.html']}]};
test('default stays file-only; render double opt-in never invents browser grant or accepts flexible caps/IDs',()=>{
 assert.equal(renderConfig({}),null);assert.throws(()=>renderConfig({},['--allow-render-feedback']));assert.throws(()=>renderConfig(config));assert.deepEqual(renderConfig(config,['--allow-render-feedback']),config.renderFeedback);
 for(const update of[{widths:[320,1280]},{maxScreenshots:7},{repetitionId:'old-r3'},{enabled:false},{arbitrary:true}])assert.throws(()=>renderConfig({...config,renderFeedback:{...config.renderFeedback,...update}},['--allow-render-feedback']));
 assert.throws(()=>renderProfile({sdk_tools:{browser:false}}));const p={sdk_tools:{read:true,write:true,browser:true,shell:true,subagents:true},publishing:{enabled:true}};const original=JSON.stringify(p),restricted=renderProfile(p);assert.equal(JSON.stringify(p),original);assert.equal(restricted.sdk_tools.browser,true);assert.equal(restricted.sdk_tools.shell,false);assert.equal(restricted.sdk_tools.subagents,false);assert.equal(restricted.publishing.enabled,false);
});
test('tool-result image metadata hashes real nested bytes separately from reference pixels, without raw payload retention',()=>{
 const data=Buffer.from('owned-screenshot-pixels').toString('base64'),body={messages:[{role:'user',content:[{type:'image',source:{type:'base64',data}},{type:'tool_result',content:[{type:'image',source:{type:'base64',data}}]}]}]},original=JSON.stringify(body);assert.deepEqual(toolResultImageHashes(body),[digest(Buffer.from(data,'base64'))]);assert.equal(JSON.stringify(body),original);assert(!JSON.stringify(toolResultImageHashes(body)).includes(data));assert.deepEqual(toolResultImageHashes({messages:[{content:[{type:'tool_result',is_error:true,content:'No capture'}]}]}),[]);
});
test('actual capture aborted before any next dispatch and failed capture both remain consumed after host restart; cleanup is explicit',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-render-host-controls-')),workspace=path.join(base,'work'),evidence=path.join(base,'evidence'),temp=path.join(base,'runtime');for(const p of[workspace,evidence,temp])fs.mkdirSync(p,{mode:0o700});fs.copyFileSync(path.join(root,'extensions/hypeproof-chat/test/fixtures/reference-design/keyboard.html'),path.join(workspace,'keyboard.html'));
 const keyFiles={keyFile:path.join(base,'provider-key'),serviceCredentialFile:path.join(base,'service-key'),controlKeyFile:path.join(base,'control-key')};for(const [name,value]of Object.entries({keyFile:'sk-ant-synthetic-control',serviceCredentialFile:'hps-guard-only-'+'a'.repeat(64),controlKeyFile:'hps-guard-control-'+'b'.repeat(64)}))fs.writeFileSync(keyFiles[name],value,{mode:0o600});
 const repetitionId=config.renderFeedback.repetitionId,activityId='synthetic-render-abort-control',ledgerFile=path.join(base,'guard.json'),g=await startGuard({...keyFiles,activityId,ledgerFile,renderRepetitionId:repetitionId,fetchImpl:async()=>{throw Error('No upstream dispatch allowed');}}),client=()=>screenshotReservationClient({guard:{origin:g.origin,id:g.snapshot().guard_id,controlKeyFile:keyFiles.controlKeyFile},activityId,repetitionId});
 const options={root,workspace,evidence,temp,dependencyRoot:path.join(root,'extensions/hypeproof-chat'),browserDependencyRoot:path.join(root,'e2e'),reserveScreenshot:client()};let host,second;
 try{
  host=await startRenderHost(options);const view=host.setCandidate(['keyboard.html']);await host.host.openBrowser(view.wrapperUrl);const read=await host.host.inspect('browser_read',{}),text=read.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');assert(text.includes('모바일 390px')&&text.includes('데스크톱 1280px'));await host.host.inspect('browser_screenshot',{});assert.equal(host.state.captures[0].page.frameWidth,390);
  const ref=text.split('\n').find(s=>s.includes('데스크톱 1280px')).match(/ref=(e\d+)/)?.[1];assert(ref);
  const click={toolName:'mcp__hypeproof__browser_click',input:{ref}};
  assert.equal(await host.approveViewportClick(click),true);
  for(const action of[{...click,input:{ref:'e999'}},{...click,input:{ref,extra:true}},{...click,toolName:'mcp__hypeproof__browser_type'}])assert.equal(await host.approveViewportClick(action),false);
  assert(!(await host.host.inspect('browser_click',{ref})).isError);
  assert.equal(await host.approveViewportClick(click),false,'Consumed/stale read ref requires a new actual read');await new Promise(r=>setTimeout(r,100));await host.host.inspect('browser_screenshot',{});assert.equal(host.state.captures[1].page.frameWidth,1280);
  await host.host.openBrowser(host.origin+'/keyboard.html');assert.equal(await host.approveViewportClick(click),false,'Candidate page does not grant wrapper controls');
  await assert.rejects(host.host.openBrowser('http://example.com/'),/non-owned/);await host.close();assert.equal(host.state.cleanup.status,'PASS');assert.equal(host.state.cleanup.server_closed,true);assert.equal(host.state.cleanup.chromium_exited,true);
  // Simulate the runtime abort here: no subsequent model request exists.
  assert.equal(g.snapshot().rows.length,0);assert.equal(JSON.parse(fs.readFileSync(ledgerFile)).render_screenshot_attempts,2);assert.equal(priorScreenshotCalls(g.snapshot(),repetitionId),2);
  const nextTemp=path.join(base,'next-runtime'),nextEvidence=path.join(base,'next-evidence');fs.mkdirSync(nextTemp);fs.mkdirSync(nextEvidence,{mode:0o700});let fatal=0;
  second=await startRenderHost({...options,temp:nextTemp,evidence:nextEvidence,reserveScreenshot:client(),priorScreenshots:priorScreenshotCalls(g.snapshot(),repetitionId),onFatal:()=>fatal++});const next=second.setCandidate(['keyboard.html']);await second.host.openBrowser(next.wrapperUrl);fs.writeFileSync(path.join(nextEvidence,'render-capture-0.jpg'),'owned collision forces capture storage failure');
  await assert.rejects(second.host.inspect('browser_screenshot',{}),/EEXIST/);assert.equal(fatal,1);assert.equal(second.state.cleanup.status,'PASS');assert.equal(g.snapshot().render_screenshot_attempts,3);assert.equal(g.snapshot().rows.length,0);
  const resumed=client();for(let i=4;i<=6;i++)assert.equal((await resumed()).attempt,i);await assert.rejects(client()(),/reservation refused/);assert.equal(g.snapshot().render_screenshot_attempts,6);assert.equal(JSON.parse(fs.readFileSync(ledgerFile)).render_screenshot_attempts,6);
  const badTemp=path.join(base,'setup-failure');fs.mkdirSync(badTemp);fs.mkdirSync(path.join(badTemp,'render-chromium'));await assert.rejects(startRenderHost({...options,temp:badTemp}),error=>error.code==='EEXIST'&&error.ownedCleanup.server_closed&&error.ownedCleanup.chromium_exited&&error.ownedCleanup.status==='PASS');assert.equal(globalThis.__hpsRenderVscode,undefined);
 }finally{await host?.close();await second?.close();await g.close();await assert.rejects(startGuard({...keyFiles,activityId,ledgerFile,renderRepetitionId:repetitionId}),/EEXIST/);fs.rmSync(base,{recursive:true,force:true});}
});

test('only durable guard counter retains consumed attempts; model message IDs are transport diagnostics',()=>{
 const id=config.renderFeedback.repetitionId,call={type:'tool_use',name:'mcp__hypeproof__browser_screenshot',id:'owned-shot-1'};assert.deepEqual(screenshotCallHashes({messages:[{role:'assistant',content:[call]}]}),[digest('owned-shot-1')]);const state={render_repetition_id:id,render_screenshot_limit:6,render_screenshot_attempts:2,rows:[]};assert.equal(priorScreenshotCalls(state,id),2);assert.throws(()=>priorScreenshotCalls(state,'another'));for(const value of[-1,7,undefined])assert.throws(()=>priorScreenshotCalls({...state,render_screenshot_attempts:value},id));assert.throws(()=>priorScreenshotCalls({render_repetition_id:id,rows:[{screenshot_call_sha256:['diagnostic']} ]},id));
});

test('interception shutdown unsubscribes then awaits pending command; refusal remains explicit failure',async()=>{
 let listener,resolve,reject,disposed=false,fatal=0;const calls=[];
 const cdp={onEvent(fn){listener=fn;return{dispose(){disposed=true;}};},send(method){calls.push(method);return new Promise((a,b)=>{resolve=a;reject=b;});}};
 const owned=ownedFetchInterception({cdp,origin:'http://127.0.0.1:12345',onBlocked:async()=>{},onFailure:async()=>{fatal++;}});
 listener({method:'Fetch.requestPaused',params:{requestId:'owned',request:{url:'http://127.0.0.1:12345/file'}}});let done=false;const close=owned.close().then(value=>{done=true;return value;});
 await Promise.resolve();assert(disposed);assert.equal(done,false,'No transport close before pending interception settles');resolve({});const result=await close;assert.equal(result.status,'PASS');assert.equal(result.pending,0);assert.deepEqual(calls,['Fetch.continueRequest']);assert.equal(fatal,0);
 const failed=ownedFetchInterception({cdp,origin:'http://127.0.0.1:12345',onBlocked:async()=>{},onFailure:async()=>{fatal++;}});
 listener({method:'Fetch.requestPaused',params:{requestId:'failed',request:{url:'http://127.0.0.1:12345/file'}}});const ending=failed.close();reject(Error('seeded CDP rejection'));
 const failure=await ending;assert.equal(failure.status,'FAIL');assert.equal(failure.pending,0);assert.equal(failed.failed,true);assert.equal(fatal,1);assert.equal(failure.failures[0].method,'Fetch.continueRequest');assert(!JSON.stringify(failure).includes('seeded'));
});
test('blocked request and rejecting fatal callback are both awaited and cannot yield cleanup PASS',async()=>{
 let listener,blocked=0;const owned=ownedFetchInterception({cdp:{onEvent(fn){listener=fn;return{dispose(){}};},async send(method){assert.equal(method,'Fetch.failRequest');throw Error('seeded transport refusal');}},origin:'http://127.0.0.1:12345',onBlocked:async()=>{blocked++;},onFailure:async()=>{throw Error('seeded hold refusal');}});
 listener({method:'Fetch.requestPaused',params:{requestId:'blocked',request:{url:'https://example.invalid/'}}});const result=await owned.close();assert.equal(blocked,1);assert.equal(result.status,'FAIL');assert.equal(result.pending,0);assert.deepEqual(result.failures.map(x=>x.method),['Fetch.failRequest','fatal_callback']);
});


test('private captured source and served snapshots reject unknown, changed, missing, linked or substituted provenance',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-revisions-')),image=Buffer.from('synthetic pixels'),source=Buffer.from('<p>source</p>'),served=Buffer.from('<p>source</p><script>injected</script>');
 try{
  const file='render-capture-0.jpg';fs.writeFileSync(path.join(base,file),image);const store=captureEvidenceStore(base),capture=store.record({file,sha256:digest(image),bytes:image.length,source_sha256:digest(source),page:{frameWidth:390}},{source,served});assert(store.verify(capture));assert.notEqual(capture.revision.source.sha256,capture.revision.served.sha256);assert(fs.readFileSync(path.join(base,capture.revision.source.file)).equals(source));assert(fs.readFileSync(path.join(base,capture.revision.served.file)).equals(served));
  if(process.platform!=='win32'){assert.equal(fs.statSync(path.join(base,'private')).mode&0o777,0o700);assert.equal(fs.statSync(path.join(base,capture.revision.source.file)).mode&0o777,0o400);}
  for(const changed of [{...capture,source_sha256:'unknown'},{...capture,file:'../outside'},{...capture,page:{frameWidth:1280}},{...capture,revision:{...capture.revision,source:{...capture.revision.source,file:'../outside'}}}])assert.throws(()=>store.verify(changed));
  const sourceFile=path.join(base,capture.revision.source.file),saved=fs.readFileSync(sourceFile);fs.chmodSync(sourceFile,0o600);fs.writeFileSync(sourceFile,'tampered');assert.throws(()=>store.verify(capture),/Evidence/);fs.writeFileSync(sourceFile,saved);assert(store.verify(capture));fs.unlinkSync(sourceFile);assert.throws(()=>store.verify(capture));
  const other=path.join(base,'outside');fs.writeFileSync(other,saved);fs.symlinkSync(other,sourceFile);assert.throws(()=>store.verify(capture),/unlinked/);fs.unlinkSync(sourceFile);fs.linkSync(other,sourceFile);assert.throws(()=>store.verify(capture),/unlinked/);fs.unlinkSync(sourceFile);fs.writeFileSync(sourceFile,saved,{mode:0o400});
  fs.writeFileSync(path.join(base,file),'altered image');assert.throws(()=>store.verify(capture),/Evidence/);fs.writeFileSync(path.join(base,file),image);
  const privateDir=path.join(base,'private'),moved=path.join(base,'moved-private');fs.renameSync(privateDir,moved);fs.symlinkSync(moved,privateDir,'dir');assert.throws(()=>store.verify(capture),/directory must be regular/);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('actual headless capture edit reload recapture retains both source revisions and charges every image',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-render-revision-control-')),workspace=path.join(base,'work'),evidence=path.join(base,'evidence'),temp=path.join(base,'runtime');for(const dir of [workspace,evidence,temp])fs.mkdirSync(dir,{mode:0o700});
 const file=path.join(workspace,'keyboard.html'),initial=fs.readFileSync(path.join(root,'extensions/hypeproof-chat/test/fixtures/reference-design/keyboard.html')),final=Buffer.from(initial.toString()+'\n<p>Owned revision two</p>');assert.notDeepEqual(initial,final);fs.writeFileSync(file,initial);let attempts=0,host;
 try{
  host=await startRenderHost({root,workspace,evidence,temp,dependencyRoot:path.join(root,'extensions/hypeproof-chat'),browserDependencyRoot:path.join(root,'e2e'),reserveScreenshot:async()=>({attempt:++attempts,limit:6})});const view=host.setCandidate(['keyboard.html']);
  await host.host.openBrowser(view.wrapperUrl);assert(!fs.existsSync(path.join(evidence,'private')),'Navigation alone must not copy revisions to disk');await host.host.inspect('browser_screenshot',{});
  const historical=structuredClone(host.state.captures[0]);assert(host.verifyCapture(historical));fs.writeFileSync(file,final);await host.host.openBrowser(view.wrapperUrl);await host.host.inspect('browser_screenshot',{});
  const read=await host.host.inspect('browser_read',{}),text=read.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'),ref=text.split('\n').find(x=>x.includes('데스크톱 1280px')).match(/ref=(e\d+)/)[1];await host.host.inspect('browser_click',{ref});await host.host.inspect('browser_screenshot',{});
  assert.equal(attempts,3);assert.equal(host.state.screenshot_attempts,3);assert.deepEqual(host.state.captures.map(x=>x.source_sha256),[digest(initial),digest(final),digest(final)]);assert.deepEqual(host.state.captures.map(x=>x.page.frameWidth),[390,390,1280]);assert.deepEqual(host.state.captures[0],historical);
  for(const capture of host.state.captures){assert(host.verifyCapture(capture));assert.notEqual(capture.revision.source.sha256,capture.revision.served.sha256);assert(capture.page.frameId);}
  assert.deepEqual(host.state.source_versions.captured_source_sha256,[digest(initial),digest(final)]);assert.equal(host.state.source_versions.captured_source_version_count,2);assert.equal(host.state.source_versions.exceeds_three_captured_versions,false);assert.equal(host.state.source_versions.uncaptured_source_versions,'UNKNOWN');assert.equal(fs.readdirSync(path.join(evidence,'private/render-revisions')).length,4);assert(fs.readFileSync(path.join(evidence,historical.revision.source.file)).equals(initial));
  fs.writeFileSync(file,initial);await assert.rejects(host.host.inspect('browser_screenshot',{}),/Candidate changed since its actual HTTP load/);assert.equal(attempts,4,'Failed stale-load capture remains charged');assert.equal(host.state.captures.length,3);assert.equal(host.state.cleanup.status,'PASS');
 }finally{await host?.close();fs.rmSync(base,{recursive:true,force:true});}
});


test('captured response requires exact document frame, loader, source, served bytes and uncached owned load',()=>{
 const load={loadId:'1',sourceSha:'candidate-hash',servedSha:'response-hash'},frame={id:'owned-frame',loaderId:'owned-loader'},response={...load,frameId:frame.id,loaderId:frame.loaderId,status:200,cached:false};assert.doesNotThrow(()=>assertCapturedResponse(load,response,frame));
 for(const delta of [{frameId:'another-frame'},{loaderId:'older-loader'},{sourceSha:'another-source'},{servedSha:'another-response'},{loadId:'older-load'},{cached:true},{status:304},{sourceSha:undefined}])assert.throws(()=>assertCapturedResponse(load,{...response,...delta},frame));
 assert.throws(()=>assertCapturedResponse(load,null,frame));assert.throws(()=>assertCapturedResponse({...load,loadId:undefined},response,frame));assert.throws(()=>assertCapturedResponse(load,response,{id:frame.id}));
});
test('snapshot store refuses nonprivate or substituted owner directories and never exceeds six capture records',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-revision-owner-')),moved=base+'-replaced',source=Buffer.from('candidate'),served=Buffer.from('served'),image=Buffer.from('image');
 try{
  if(process.platform!=='win32'){fs.chmodSync(base,0o755);assert.throws(()=>captureEvidenceStore(base),/must be private/);fs.chmodSync(base,0o700);}
  const store=captureEvidenceStore(base);let capture;
  for(let i=0;i<6;i++){const file='render-capture-'+i+'.jpg';fs.writeFileSync(path.join(base,file),image);capture=store.record({file,sha256:digest(image),bytes:image.length,source_sha256:digest(source)},{source,served});}
  assert.equal(fs.readdirSync(path.join(base,'private/render-revisions')).length,2);assert.throws(()=>store.record({...capture,file:'render-capture-6.jpg'},{source,served}),/ceiling/);assert.equal(fs.readdirSync(path.join(base,'private/render-revisions')).length,2);
  const file=path.join(base,capture.revision.served.file);fs.chmodSync(file,0o600);fs.writeFileSync(file,'tampered response');assert.throws(()=>store.verify(capture),/Evidence/);
  fs.renameSync(base,moved);fs.mkdirSync(base,{mode:0o700});assert.throws(()=>store.verify(capture),/Owned evidence directory changed/);
 }finally{fs.rmSync(base,{recursive:true,force:true});fs.rmSync(moved,{recursive:true,force:true});}
});


test('captured source version report separates revisions from SDK claims and leaves uncaptured edits unknown',()=>{
 const captures=['a','b','c','final','final'].map(source=>({source_sha256:digest(source)})),before=structuredClone(captures),report=capturedSourceVersions(captures);
 assert.deepEqual(report.captured_source_sha256,['a','b','c','final'].map(digest));assert.equal(report.captured_source_version_count,4);assert.equal(report.exceeds_three_captured_versions,true);assert.equal(report.uncaptured_source_versions,'UNKNOWN');assert.equal('sdk_candidate_claims' in report,false);assert.deepEqual(captures,before);
 assert.equal(capturedSourceVersions(captures.slice(0,3)).exceeds_three_captured_versions,false);assert.equal(capturedSourceVersions([]).captured_source_version_count,0);assert.throws(()=>capturedSourceVersions([{source_sha256:'raw private text'}]));
});

test('actual candidate response race immediately aborts and holds once; subsequent operations and scripted dispatch are refused',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-response-fatal-')),workspace=path.join(base,'work'),evidence=path.join(base,'evidence'),temp=path.join(base,'runtime');for(const dir of[workspace,evidence,temp])fs.mkdirSync(dir,{mode:0o700});
 const file=path.join(workspace,'keyboard.html');fs.writeFileSync(file,'<!doctype html><p>Owned race control</p>');let host,attempts=0,holds=0,closes=0,dispatches=0,seen,fatalCalls=0;const deadline=Date.now()+60000,controller=new AbortController(),session=createCompletionSession({hold:async()=>{holds++;}});
 const sdk={query(input){seen=input;return Object.assign((async function*(){yield{type:'system',subtype:'init',session_id:'01234567-1234-4321-8123-012345678901'};})(),{close(){closes++;}});}};
 const stream=session.wrap(sdk).query({prompt:'synthetic',options:{abortController:controller,cwd:workspace,model:'synthetic',pathToClaudeCodeExecutable:'/unused',env:{CLAUDE_CONFIG_DIR:temp},allowedTools:[],settingSources:[],strictMcpConfig:true,tools:['Read'],canUseTool:async()=>({behavior:'allow'})}});for await(const event of stream){}
 const originalRead=fs.readFileSync;
 try{
  host=await startRenderHost({root,workspace,evidence,temp,dependencyRoot:path.join(root,'extensions/hypeproof-chat'),browserDependencyRoot:path.join(root,'e2e'),reserveScreenshot:async()=>({attempt:++attempts,limit:6}),fatalToolErrors:true,onFatal:reason=>{fatalCalls++;return session.fail(reason);}});const view=host.setCandidate(['keyboard.html']);await host.host.openBrowser(view.wrapperUrl);await host.host.inspect('browser_screenshot',{});const historical=structuredClone(host.state.captures),remainingDeadline=deadline;
  let reads=0;fs.readFileSync=function(target,...args){const value=originalRead.call(this,target,...args);return target===file&&++reads===2?Buffer.from('Different candidate source'):value;};
  const response=await fetch(host.origin+'/keyboard.html');assert.equal(response.status,409);fs.readFileSync=originalRead;await session.settle();assert.equal(host.state.fatal,'candidate_response_binding_failed');assert.equal(fatalCalls,1);assert.equal(holds,1);assert.equal(closes,1);assert(controller.signal.aborted);assert.equal(session.snapshot().fatal,'candidate_response_binding_failed');
  const actions=host.state.actions.length;for(const operation of[()=>host.host.openBrowser(view.wrapperUrl),()=>host.host.startLivePreview(),()=>host.host.currentPage(),()=>host.host.openPages(),()=>host.host.livePreviewUrl(),()=>host.host.inspect('browser_read',{}),()=>host.host.inspect('browser_screenshot',{}),()=>host.approveViewportClick({})])await assert.rejects(operation(),/host is stopped/);assert.throws(()=>host.setCandidate(['keyboard.html']),/host is stopped/);
  const decision=await seen.options.canUseTool('Read',{});if(decision.behavior==='allow')dispatches++;assert.equal(decision.behavior,'deny');assert.equal(dispatches,0);assert.throws(()=>session.wrap(sdk,{resume:true}),/Fatal completion/);assert.equal(host.state.actions.length,actions);assert.equal(attempts,1);assert.equal(host.state.screenshot_attempts,1);assert.deepEqual(host.state.captures,historical);assert.equal(deadline,remainingDeadline);assert.equal((await fetch(host.origin+'/keyboard.html')).status,409);assert.equal(fatalCalls,1);await host.close();assert.equal(host.state.cleanup.status,'PASS');
 }finally{fs.readFileSync=originalRead;await host?.close();fs.rmSync(base,{recursive:true,force:true});}
});

for(const mode of ['throw','reject','timeout'])test('response race fatal callback '+mode+' is bounded and retained as cleanup FAIL without unhandled rejection',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-response-fatal-reject-')),workspace=path.join(base,'work'),evidence=path.join(base,'evidence'),temp=path.join(base,'runtime');for(const dir of[workspace,evidence,temp])fs.mkdirSync(dir,{mode:0o700});const file=path.join(workspace,'keyboard.html');fs.writeFileSync(file,'<p>Owned response</p>');const originalRead=fs.readFileSync;let host,calls=0;
 try{
  host=await startRenderHost({root,workspace,evidence,temp,dependencyRoot:path.join(root,'extensions/hypeproof-chat'),browserDependencyRoot:path.join(root,'e2e'),reserveScreenshot:async()=>{throw Error('No capture allowed');},onFatal:()=>{calls++;if(mode==='timeout')return new Promise(()=>{});if(mode==='reject')return Promise.reject(Error('private refusal marker'));throw Error('private refusal marker');}});host.setCandidate(['keyboard.html']);let reads=0;fs.readFileSync=function(target,...args){const value=originalRead.call(this,target,...args);return target===file&&++reads===2?Buffer.from('changed'):value;};assert.equal((await fetch(host.origin+'/keyboard.html')).status,409);fs.readFileSync=originalRead;
  await host.close();assert.equal(calls,1);assert.equal(host.state.fatal_callback_failed,true);assert.equal(host.state.cleanup.status,'FAIL');assert(host.state.cleanup.errors.includes('fatal_callback'));assert(!JSON.stringify(host.state).includes('private refusal marker'));
 }finally{fs.readFileSync=originalRead;await host?.close();fs.rmSync(base,{recursive:true,force:true});}
});


test('late HTTP binding failure during owned socket shutdown is settled after server closes and cannot report cleanup PASS',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=fs.mkdtempSync(path.join(os.tmpdir(),'hps-late-response-fatal-')),workspace=path.join(base,'work'),evidence=path.join(base,'evidence'),temp=path.join(base,'runtime');for(const dir of[workspace,evidence,temp])fs.mkdirSync(dir,{mode:0o700});const file=path.join(workspace,'keyboard.html');fs.writeFileSync(file,'<p>Owned source</p>');
 const originalRead=fs.readFileSync,originalClose=WebSocket.prototype.close;let host,calls=0,closeCalls=0,responseStatus,requestTask;
 try{
  host=await startRenderHost({root,workspace,evidence,temp,dependencyRoot:path.join(root,'extensions/hypeproof-chat'),browserDependencyRoot:path.join(root,'e2e'),reserveScreenshot:async()=>{throw Error('No capture allowed');},onFatal:()=>{calls++;return Promise.reject(Error('private seeded callback refusal'));}});host.setCandidate(['keyboard.html']);let reads=0;
  fs.readFileSync=function(target,...args){const bytes=originalRead.call(this,target,...args);return String(target)===file&&++reads===2?Buffer.from('<p>Concurrent replacement</p>'):bytes;};
  // Preserve the independent reproduction: real response arrives after the first
  // fatal settlement, while the first actual owned socket close is pending.
  WebSocket.prototype.close=function(...args){if(++closeCalls===1){const socket=this;requestTask=(async()=>{await assert.rejects(host.host.inspect('browser_read',{}),/host is stopped/);await assert.rejects(host.host.currentPage(),/host is stopped/);const response=await fetch(host.origin+'/keyboard.html');responseStatus=response.status;await response.arrayBuffer();})().finally(()=>originalClose.apply(socket,args));}else originalClose.apply(this,args);};
  await host.close();await requestTask;assert.equal(responseStatus,409);assert.equal(calls,1);assert.equal(host.state.fatal,'candidate_response_binding_failed');assert.equal(host.state.fatal_callback_failed,true);assert.equal(host.state.cleanup.status,'FAIL');assert.deepEqual(host.state.cleanup.errors,['fatal_callback']);assert.equal(host.state.cleanup.server_closed,true);assert.equal(host.state.cleanup.chromium_exited,true);assert.equal(host.state.cleanup.interception.status,'PASS');assert.equal(host.state.cleanup.interception.pending,0);assert.equal(host.state.screenshot_attempts,0);assert(!JSON.stringify(host.state).includes('private seeded'));
 }finally{fs.readFileSync=originalRead;WebSocket.prototype.close=originalClose;await host?.close();fs.rmSync(base,{recursive:true,force:true});}
});
