import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{compilerDiagnostics,apkMetadata}from'./compiler-diagnostics.mjs';
import{execFileSync}from'node:child_process';
import{fileURLToPath}from'node:url';
test('bounded compiler categories preserve public location without private snippets',()=>{
 const raw='/private/client/NativeDraftLifecycleTest.java:42: error: cannot find symbol\n SECRET_TOKEN=secret-code\n/private/PrivateClient.java:1: error: secret-code\nhttps://private.invalid/auth?token=secret-code';
 const d=compilerDiagnostics(raw,'gradle');assert.deepEqual(d.rows,[{file:'NativeDraftLifecycleTest.java',line:42,category:'cannot_find_symbol'}]);assert.equal(d.outputSha256.length,64);assert.equal(d.rawOutputIncluded,false);assert.doesNotMatch(JSON.stringify(d),/secret-code|private|https|SECRET/);assert.equal(compilerDiagnostics((raw+'\n').repeat(40),'gradle').rows.length,20);
});
test('APK metadata requires exact package and both API35 values',()=>{
 const value="package: name='ai.hypeproof.companion.debug' versionCode='1'\nsdkVersion:'35'\ntargetSdkVersion:'35'";
 assert.equal(apkMetadata(value,'target').package,'ai.hypeproof.companion.debug');assert.throws(()=>apkMetadata(value,'test'));assert.throws(()=>apkMetadata(value.replace("sdkVersion:'35'","sdkVersion:'34'"),'target'));assert.throws(()=>apkMetadata(value.replace('companion.debug','foreign.debug'),'target'));
});
test('Android opt-in keeps an explicit no-APK upload allowlist',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/feedback-candidate.yml',import.meta.url),'utf8');
 for(const[job,directory,expected]of[
  ['android-draft','android-draft-evidence',['result.json','build-receipt.json','attempt.json','unconfigured-launch.png','diagnostics.json']],
  ['android-authenticated-ui','android-auth-ui-evidence',['result.json','build-receipt.json','attempt.json','ui_*.png','diagnostics.json']],
 ]){
  const block=workflow.split('  '+job+':\n')[1]?.split(/\n  [a-z-]+:\n/)[0];assert.ok(block,job+' exists');
  const uploads=block.split('uses: actions/upload-artifact@v4');assert.equal(uploads.length,2,job+' has one evidence upload');
  const paths=uploads[1].split('          path: |\n')[1]?.split('          if-no-files-found:')[0].trim().split('\n').map(line=>line.trim());
  assert.deepEqual(paths,expected.map(name=>'${{ runner.temp }}/'+directory+'/'+name),job+' exact public evidence paths');
 }
 const runner=await readFile(new URL('./run-hosted.py',import.meta.url),'utf8');assert.ok(runner.includes("'-accel','on'"));assert.doesNotMatch(runner,/'-accel','off'|kill-server/);
 const java=await readFile(new URL('../../apps/companion-android/app/src/androidTest/java/ai/hypeproof/companion/NativeDraftLifecycleTest.java',import.meta.url),'utf8');for(const phase of ['seed_ready','erased_ready','cold_absence'])assert.ok(java.includes('ack("'+phase+'",true)'));assert.ok(java.includes('new AndroidDraftFile()'));assert.ok(java.includes('assertFalse(((DeviceSignInFixtureActivity)activity).signInTransportEnabled())'));
});

test('both explicit runner modes require hosted ownership; default, unknown and mixed arguments cannot launch',()=>{
 const script=`
import contextlib,importlib.util,io,json,sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('hosted_optin',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class Admitted(Exception):pass
owned={'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux','HPS_ANDROID_OWNED_HOSTED':'1','HPS_ANDROID_EVIDENCE':'/owned/evidence'}
with patch.object(h.subprocess,'run')as run,patch.object(h.subprocess,'Popen')as popen,patch.object(h,'Path',side_effect=Admitted)as path:
 for args in [[],['--unknown'],['--run','--run-authenticated-ui'],['--run','extra'],['--run-authenticated-ui','extra'],['--run','--run']]:
  with patch.dict(h.os.environ,owned,clear=True),contextlib.redirect_stdout(io.StringIO())as out:
   assert h.main(args)==0
  assert json.loads(out.getvalue())['status']=='NOT_RUN'
  path.assert_not_called();run.assert_not_called();popen.assert_not_called()
 for mode in ['--run','--run-authenticated-ui']:
  for missing in ['GITHUB_ACTIONS','RUNNER_OS','HPS_ANDROID_OWNED_HOSTED']:
   env={k:v for k,v in owned.items()if k!=missing}
   with patch.dict(h.os.environ,env,clear=True):
    try:h.main([mode]);raise AssertionError('missing ownership accepted')
    except RuntimeError as error:assert str(error)=='owned_hosted_linux_only'
   path.assert_not_called();run.assert_not_called();popen.assert_not_called()
  with patch.dict(h.os.environ,owned,clear=True):
   try:h.main([mode]);raise AssertionError('explicit mode not admitted')
   except Admitted:pass
  path.assert_called_once_with('/owned/evidence');path.reset_mock();run.assert_not_called();popen.assert_not_called()
print('PASS explicit opt-in and ownership without process or filesystem effects')
`;
 assert.match(execFileSync('python3',['-c',script,fileURLToPath(new URL('./run-hosted.py',import.meta.url))],{encoding:'utf8',timeout:10000}),/^PASS explicit opt-in/);
});

test('workflow job conditions select PR label and manual Android opt-ins from an event truth table',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/feedback-candidate.yml',import.meta.url),'utf8');
 const condition=name=>workflow.match(new RegExp('^  '+name+':\\n    if: \\$\\{\\{ (.+) \\}\\}', 'm'))?.[1];
 const evaluate=(name,github,inputs)=>{
  const expression=condition(name);assert.ok(expression,'actual workflow condition exists');
  const js=expression.replaceAll('github.event.pull_request.labels.*.name','github.event.pull_request.labels.map(label=>label.name)');
  return Boolean(new Function('github','inputs','contains','return ('+js+');')(github,inputs,(values,value)=>values.includes(value)));
 };
 const pr=(action,labels=[],addedLabel='unrelated')=>({event_name:'pull_request',event:{action,label:{name:addedLabel},pull_request:{labels:labels.map(name=>({name})),head:{sha:'a'.repeat(40)}}}});
 const cases=[
  ['default opened PR',pr('opened'),{},true,false],
  ['default synchronized PR',pr('synchronize'),{},true,false],
  ['default reopened PR',pr('reopened'),{},true,false],
  ['explicit label added',pr('labeled',['companion-android-verify'],'companion-android-verify'),{},false,true],
  ['unrelated label',pr('labeled',['unrelated'],'unrelated'),{},false,false],
  ['unrelated label on already opted-in PR',pr('labeled',['companion-android-verify','unrelated'],'unrelated'),{},false,false],
  ['label event without current opt-in',pr('labeled',[],'companion-android-verify'),{},false,false],
  ['opted-in synchronize retains desktop',pr('synchronize',['companion-android-verify']),{},true,true],
  ['opted-in opened PR retains desktop',pr('opened',['companion-android-verify']),{},true,true],
  ['manual Android true',{event_name:'workflow_dispatch',event:{}},{android_draft:true},false,true],
  ['manual default',{event_name:'workflow_dispatch',event:{}},{android_draft:false},true,false],
  ['UI label added',pr('labeled',['companion-android-ui-verify'],'companion-android-ui-verify'),{},false,false,true],
  ['UI label missing',pr('labeled',[],'companion-android-ui-verify'),{},false,false,false],
  ['unrelated label with UI opt-in',pr('labeled',['companion-android-ui-verify','unrelated'],'unrelated'),{},false,false,false],
  ['UI synchronize retains desktop',pr('synchronize',['companion-android-ui-verify']),{},true,false,true],
  ['both labels synchronize',pr('synchronize',['companion-android-verify','companion-android-ui-verify']),{},true,true,true],
  ['manual UI only',{event_name:'workflow_dispatch',event:{}},{android_ui:true},false,false,true],
  ['manual both selects original lane',{event_name:'workflow_dispatch',event:{}},{android_ui:true,android_draft:true},false,true,false],
 ];
 for(const[label,github,inputs,native,android,ui=false]of cases){assert.equal(evaluate('native',github,inputs),native,label+' native');assert.equal(evaluate('android-draft',github,inputs),android,label+' Android');assert.equal(evaluate('android-authenticated-ui',github,inputs),ui,label+' authenticated UI');}
 assert.match(workflow,/types: \[opened, synchronize, reopened, labeled\]/);
 for(const glob of ['apps/companion-android/**','e2e/companion-android/**'])assert.ok(workflow.includes("- '"+glob+"'"));
 const android=workflow.split('  android-draft:')[1];
 assert.ok(android.includes('HPS_ANDROID_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'));
 assert.ok(android.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'));
});

test('Android task paths are initialized in a step without invalid job-level runner context',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/feedback-candidate.yml',import.meta.url),'utf8');
 const android=workflow.split('  android-draft:')[1],jobEnv=android.split('    env:')[1].split('    steps:')[0];
 assert.doesNotMatch(jobEnv,/runner\.temp/);assert.ok(jobEnv.includes('HPS_ANDROID_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'));
 const initialize=android.indexOf('name: Prepare task-owned Android paths'),checkout=android.indexOf('uses: actions/checkout@v4');assert.ok(initialize>=0&&initialize<checkout);
 const step=android.slice(initialize,checkout);for(const path of ['ANDROID_USER_HOME=$RUNNER_TEMP/android-draft-state/android','GRADLE_USER_HOME=$RUNNER_TEMP/android-draft-state/gradle','HPS_ANDROID_EVIDENCE=$RUNNER_TEMP/android-draft-evidence'])assert.ok(step.includes(path));assert.ok(step.includes('>> "$GITHUB_ENV"'));
});

test('job-scoped concurrency separates Android from each desktop OS without cancelling running jobs',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/feedback-candidate.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow.split('\njobs:')[0],/^concurrency:/m);
 const native=workflow.split('  native:')[1].split('  android-draft:')[0],android=workflow.split('  android-draft:')[1];
 assert.ok(native.includes('group: feedback-native-${{ github.ref }}-${{ matrix.os }}'));assert.ok(android.includes('group: feedback-android-draft-${{ github.ref }}'));
 for(const job of [native,android]){assert.match(job,/    concurrency:\n      group: [^\n]+\n      cancel-in-progress: false/);assert.doesNotMatch(job,/cancel-in-progress: true/);}
});
