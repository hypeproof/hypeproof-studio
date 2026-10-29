import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{compilerDiagnostics,apkMetadata}from'./compiler-diagnostics.mjs';
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
 const block=workflow.split('name: Upload only bounded public evidence')[1];const paths=[...block.matchAll(/android-draft-evidence\/([^\s]+)/g)].map(m=>m[1]);assert.deepEqual(paths,['result.json','build-receipt.json','attempt.json','unconfigured-launch.png','diagnostics.json']);assert.doesNotMatch(paths.join(' '),/apk|\*/);
 const runner=await readFile(new URL('./run-hosted.py',import.meta.url),'utf8');assert.ok(runner.includes("'-accel','on'"));assert.doesNotMatch(runner,/'-accel','off'|kill-server/);assert.ok(runner.includes("if argv!=['--run']"));
 const java=await readFile(new URL('../../apps/companion-android/app/src/androidTest/java/ai/hypeproof/companion/NativeDraftLifecycleTest.java',import.meta.url),'utf8');for(const phase of ['seed_ready','erased_ready','cold_absence'])assert.ok(java.includes('ack("'+phase+'",true)'));assert.ok(java.includes('new AndroidDraftFile()'));assert.ok(java.includes('assertFalse(((DeviceSignInFixtureActivity)activity).signInTransportEnabled())'));
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
 ];
 for(const[label,github,inputs,native,android]of cases){assert.equal(evaluate('native',github,inputs),native,label+' native');assert.equal(evaluate('android-draft',github,inputs),android,label+' Android');}
 assert.match(workflow,/types: \[opened, synchronize, reopened, labeled\]/);
 for(const glob of ['apps/companion-android/**','e2e/companion-android/**'])assert.ok(workflow.includes("- '"+glob+"'"));
 const android=workflow.split('  android-draft:')[1];
 assert.ok(android.includes('HPS_ANDROID_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'));
 assert.ok(android.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'));
});
