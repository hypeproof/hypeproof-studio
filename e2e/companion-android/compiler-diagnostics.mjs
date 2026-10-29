import {createHash} from 'node:crypto';
// No source snippets, paths, symbols, messages or dependency URLs leave the build.
const files=new Set(['NativeDraftLifecycleTest.java','NativeDraftRecord.java','NativeDraftStore.java','NativeDraftBroker.java','AndroidDraftFile.java','MainActivity.java','DeviceSignInFixtureActivity.java']);
export function compilerDiagnostics(output,stage){
 const bytes=String(output),rows=[];
 for(const line of bytes.split('\n')){
  const match=line.match(/(?:^|[/\\])([A-Za-z0-9_]+\.java):(\d+): error: (.*)$/);
  if(match&&files.has(match[1])){
   const message=match[3];let category='java_compile_error';
   if(message.startsWith('cannot find symbol'))category='cannot_find_symbol';
   else if(/^package .* does not exist$/.test(message))category='missing_package';
   else if(message.startsWith('incompatible types'))category='incompatible_types';
   else if(message.includes('cannot be applied'))category='method_arguments';
   rows.push({file:match[1],line:Number(match[2]),category});
  }
  if(rows.length===20)break;
 }
 return{schema:'hps-sanitized-compiler-diagnostics/1',stage:['gradle','assets','apk-metadata'].includes(stage)?stage:'build',outputSha256:createHash('sha256').update(bytes).digest('hex'),rows,rawOutputIncluded:false};
}
export function apkMetadata(text,name){
 const pkg=text.match(/^package: name='([^']+)'/m)?.[1],sdk=text.match(/^sdkVersion:'(\d+)'/m)?.[1],target=text.match(/^targetSdkVersion:'(\d+)'/m)?.[1];
 const expected='ai.hypeproof.companion.debug'+(name==='test'?'.test':'');
 if(pkg!==expected||sdk!=='35'||target!=='35')throw Error('APK identity or API35 mismatch');
 return{package:pkg,minSdk:Number(sdk),targetSdk:Number(target)};
}
