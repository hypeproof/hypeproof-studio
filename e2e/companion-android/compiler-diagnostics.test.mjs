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
test('manual Android opt-in preserves native default and upload is an explicit no-APK allowlist',async()=>{
 const workflow=await readFile(new URL('../../.github/workflows/feedback-candidate.yml',import.meta.url),'utf8');
 assert.ok(workflow.includes("if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.android_draft) }}"));assert.ok(workflow.includes("if: ${{ github.event_name == 'workflow_dispatch' && inputs.android_draft }}"));
 const block=workflow.split('name: Upload only bounded public evidence')[1];const paths=[...block.matchAll(/android-draft-evidence\/([^\s]+)/g)].map(m=>m[1]);assert.deepEqual(paths,['result.json','build-receipt.json','attempt.json','unconfigured-launch.png','diagnostics.json']);assert.doesNotMatch(paths.join(' '),/apk|\*/);
 const runner=await readFile(new URL('./run-hosted.py',import.meta.url),'utf8');assert.ok(runner.includes("'-accel','on'"));assert.doesNotMatch(runner,/'-accel','off'|kill-server/);assert.ok(runner.includes("if argv!=['--run']"));
 const java=await readFile(new URL('../../apps/companion-android/app/src/androidTest/java/ai/hypeproof/companion/NativeDraftLifecycleTest.java',import.meta.url),'utf8');for(const phase of ['seed_ready','erased_ready','cold_absence'])assert.ok(java.includes('ack("'+phase+'",true)'));assert.ok(java.includes('new AndroidDraftFile()'));assert.ok(java.includes('assertFalse(((DeviceSignInFixtureActivity)activity).signInTransportEnabled())'));
});
