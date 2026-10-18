import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { png } from './fixtures/image-edit/png.mjs';
import { prepareImageEditAsset,saveImageEditOutput,imageEditSelection,imageEditComparisonHtml } from '../src/imageEditAssets.ts';
import { inspectEditPng,imageBytesHash } from '../src/imageEditPng.ts';
import { ImageEditClient } from '../src/imageEditClient.ts';
const dir=mkdtempSync(join(tmpdir(),'hps-image-edit-'));mkdirSync(join(dir,'images'));const originalBytes=png();writeFileSync(join(dir,'images','keyboard.png'),originalBytes);
const id=crypto.randomUUID(),output=png(1024,1024),info=await inspectEditPng(output);
const job={schema:'hps-image-edit-result/1',id,state:'succeeded',original_sha256:await imageBytesHash(originalBytes),operation:'remove_background',transparent:true,cancel_requested:false,error_code:null,provider:{name:'openai',model:'synthetic-model',request_id:'provider-test'},cost:{request_id:'cost-test',recording_state:'recorded',pricing:'unknown',amount:null},semantic_preservation:'not_verified',output:{sha256:await imageBytesHash(output),...info,expires_at:Date.now()+10000}};
try{
 const original=await prepareImageEditAsset(dir,'images/keyboard.png');assert.equal(original.sha256,job.original_sha256);
 const saved=await saveImageEditOutput(dir,original,job,output);assert.ok(saved.relativePath.startsWith('images/edited/'));assert.deepEqual(readFileSync(join(dir,'images','keyboard.png')),originalBytes);
 assert.deepEqual(readFileSync(join(dir,saved.relativePath)),output);assert.equal(imageEditSelection(original,saved.relativePath,'restore'),'images/keyboard.png');assert.equal(imageEditSelection(original,saved.relativePath,'adopt'),saved.relativePath);
 await assert.rejects(saveImageEditOutput(dir,original,job,output),/EEXIST/,'duplicate save must not overwrite');
 await assert.rejects(saveImageEditOutput(dir,original,{...job,id:crypto.randomUUID(),state:'completed_after_cancel',cancel_requested:true},output));
 await assert.rejects(saveImageEditOutput(dir,original,{...job,id:crypto.randomUUID(),output:{...job.output,sha256:'0'.repeat(64)}},output),/해시/);
 writeFileSync(join(dir,'images','keyboard.png'),png(8,8,()=>[1,2,3,255]));await assert.rejects(saveImageEditOutput(dir,original,{...job,id:crypto.randomUUID()},output),/원본 파일이 작업 중/);
 writeFileSync(join(dir,'images','keyboard.png'),originalBytes);
 const outside=join(dir,'..',`outside-${id}.png`);writeFileSync(outside,originalBytes);try{symlinkSync(outside,join(dir,'images','linked.png'));await assert.rejects(prepareImageEditAsset(dir,'images/linked.png'),/연결된/);await assert.rejects(prepareImageEditAsset(dir,'../outside.png'));}finally{rmSync(outside,{force:true});}
 writeFileSync(join(dir,'images','fake.png'),'not png');await assert.rejects(prepareImageEditAsset(dir,'images/fake.png'),/PNG/);
 const html=imageEditComparisonHtml({originalUri:original.dataUrl,editedUri:`data:image/png;base64,${output.toString('base64')}`,originalPath:'<img onerror=bad>',editedPath:saved.relativePath,nonce:'safe-comparison-nonce-123',source:'vscode-webview:'});assert.ok(html.includes('&lt;img onerror=bad&gt;'));assert.ok(html.includes('data-action="restore"'));assert.ok(html.includes('체커보드'));
 const originalFetch=globalThis.fetch;let calls=0;
 try{
  const client=new ImageEditClient({proxyUrl:'https://example.test/v1',token:'workshop-only-token'});
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(init.headers.authorization,'Bearer workshop-only-token');assert.equal(url,`https://example.test/v1/image-edits/${id}`);return Response.json(job);};
  const result=await client.start(id,{schema:'hps-image-edit/1',original:{sha256:original.sha256,data_url:original.dataUrl},operation:'remove_background',instruction:'remove background',preserve:'key rows',transparent:true});assert.equal(result.id,id);assert.equal(calls,1);
  calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:{code:'image_edit_provider_not_configured'}},{status:503});};await assert.rejects(client.status(id),/제공자 연결/);assert.equal(calls,1,'no automatic retry');
 }finally{globalThis.fetch=originalFetch;}
 console.log('PASS App image edit modules: real PNG/hash validation, exclusive new-file save, original unchanged, restore selection, cancellation/changed-original/hash/path negatives, workshop auth and no retry');
}finally{rmSync(dir,{recursive:true,force:true});}
