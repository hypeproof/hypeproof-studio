import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { CompanionPreviewResultReceiver } from '../src/companionPreviewResult.ts';
import { nativeBridgeFixture } from './lib/companion-native-bridge-harness.mjs';
import { FOLDER_CONSENT_KEY, writeFolderConsent } from '../src/folderConsent.ts';

test('native composition transfers a useful saved Korean artifact through the real framed result consumer',async()=>{
 const f=await nativeBridgeFixture();try{
  const text='<html><button>내 작품</button><p>'+('내가 설명하는 퀴즈입니다. '.repeat(350))+'</p></html>';
  await writeFile(f.file,text);f.document.getText=()=>text;
  const message=await f.message(),request=JSON.parse(message.text),receiver=new CompanionPreviewResultReceiver(request);
  const packets=new Map();let received=null;
  const reply={prepare:async(raw,id)=>{packets.set(id,raw);return raw;},send:async id=>{const result=await receiver.accept(packets.get(id));if(result)received=result;},close:()=>{throw Error('unexpected transport close');}};
  const result=await f.bridge.handleAndReply(message,reply);
  assert.equal(result.state,'completed');assert.ok(packets.size>8);assert.equal(received.artifact.text,text);
  assert.equal(f.dialogs.length,1);assert.equal((await f.journal.load()).entries.length,1);assert.equal(await readFile(f.file,'utf8'),text);
 }finally{await f.cleanup();}
});

test('an external folder uses the resolved activity consent in an unwrapped native context', async () => {
 const f=await nativeBridgeFixture();try{
  f.profile.workspace_root=null;
  assert.equal(await f.message(),null,'an external folder first needs its normal stored consent');
  f.global.set(FOLDER_CONSENT_KEY,writeFolderConsent(undefined,f.profile.activity_id,f.root,'read'));
  assert.ok(await f.message());
  assert.equal(f.dialogs.length,0,'folder consent does not automatically consent to mobile transfer');
 }finally{await f.cleanup();}
});

test('actual native adapter resolves AccountSession pass, current profile/activity/preparation and saved editor before exact modal consent',async()=>{
 const f=await nativeBridgeFixture();try{
  const message=await f.message();assert.ok(message);assert.equal(message.text.includes(f.root),false);assert.equal(message.text.includes(f.text),false);assert.equal(f.dialogs.length,0,'desktop descriptor only publishes metadata');
  const result=await f.bridge.handle(message);assert.equal(result.state,'completed');assert.equal(result.artifact.text,f.text);
  assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].opts.modal,true);assert.match(f.dialogs[0].opts.detail,/phone/);assert.match(f.dialogs[0].opts.detail,/index.html/);assert.match(f.dialogs[0].opts.detail,/native-request/);
  assert.ok(f.calls.some(c=>c.path==='/v1/me/passes/pass/activate'));assert.ok(f.calls.some(c=>c.path==='/v1/profile'&&c.authorization==='Bearer fixture-pass-token'));assert.ok(f.calls.some(c=>c.path==='/v1/activity'));assert.ok(f.calls.some(c=>c.path==='/v1/me'&&c.authorization==='Bearer fixture-product-token'));
  assert.equal(await readFile(f.file,'utf8'),f.text);
 }finally{await f.cleanup();}
});

test('native adapter refuses production/untrusted/dirty selections, missing account binding and mismatched live account/paired context',async()=>{
 const f=await nativeBridgeFixture();try{
  for(const [change,restore] of [
   [()=>f.context.extensionMode=1,()=>f.context.extensionMode=2],
   [()=>f.vscode.workspace.isTrusted=false,()=>f.vscode.workspace.isTrusted=true],
   [()=>f.document.isDirty=true,()=>f.document.isDirty=false],
   [()=>f.document.uri.fsPath=f.root+'/../outside.html',()=>f.document.uri.fsPath=f.file],
   [()=>{f.connections.current.accountPass=undefined;},()=>{f.connections.current.accountPass={sessionId:'host-session',passId:'pass'};}],
   [()=>{f.profile.sdk_tools.read=false;},()=>{f.profile.sdk_tools.read=true;}],
   [()=>{f.pair.account_id='foreign';},()=>{f.pair.account_id='account';}],
  ]){change();assert.equal(await f.bridge.describe('request'),null);restore();}
  assert.equal(f.dialogs.length,0);assert.equal((await f.journal.load()).entries.length,0);
 }finally{await f.cleanup();}
});

test('native adapter blocks awaited scope/account/profile changes and post-modal saved version changes',async()=>{
 const f=await nativeBridgeFixture();try{
  const before=await f.message();
  f.onConfirm=async()=>{f.document.version++;f.document.getText=()=>'<html>changed saved version</html>';};const changed=await f.bridge.handle(before);assert.equal(changed.code,'consent_scope_changed');assert.equal((await f.journal.load()).entries.length,0);
  f.onConfirm=async()=>{};f.onFetch=async url=>{if(url.endsWith('/profile'))f.connections.current.ref='new-ref';};assert.equal(await f.bridge.describe('new-request'),null);
 }finally{await f.cleanup();}
});
