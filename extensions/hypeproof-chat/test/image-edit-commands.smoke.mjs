import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import {png} from './fixtures/image-edit/png.mjs';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export * from './src/imageEditCommands';export {ActivityConnections} from './src/activityConnections';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'cjs',external:['vscode'],write:false});
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'hps-image-ui-'));
const originalBytes=png(),editedBytes=png(12,12),hash=b=>createHash('sha256').update(b).digest('hex');
const service='https://synthetic.invalid/v1',secret='synthetic-workshop-secret';
let world;
const vscode={workspace:{get workspaceFolders(){return [{uri:{scheme:'file',fsPath:world.root}}];},getConfiguration:()=>({get:()=>world.service})},Uri:{file:fsPath=>({scheme:'file',fsPath})},ViewColumn:{One:1},ProgressLocation:{Notification:1},window:{
 showQuickPick:async items=>{const pick=world.quick.shift();return typeof pick==='string'?items.find(i=>typeof i==='string'?i===pick:i.label===pick):pick?.(items);},
 showInputBox:async()=>world.inputs.shift(),showOpenDialog:async()=>world.file?[{fsPath:world.file}]:undefined,
 showInformationMessage:async(message,...args)=>{world.notices.push(message);return args.includes('이미지를 보내 편집')?world.confirm:undefined;},showWarningMessage:async message=>world.warnings.push(message),
 withProgress:async(_options,callback)=>{try{return await callback({}, {isCancellationRequested:false,onCancellationRequested:cb=>{world.cancel=cb;return {dispose(){world.cancel=undefined;}};}});}finally{world.cancel=undefined;}},
 createWebviewPanel:(_type,_title,_column,options)=>{const panel={options,webview:{cspSource:'https://synthetic.vscode-webview.net',html:'',asWebviewUri:uri=>({toString:()=> 'https://synthetic.vscode-webview.net/'+encodeURIComponent(uri.fsPath)}),onDidReceiveMessage:cb=>{panel.message=cb;return {dispose(){panel.disposed=true;}};},postMessage:async msg=>panel.lastMessage=msg},onDidDispose:cb=>{panel.close=cb;return {dispose(){}};},dispose(){this.close?.();}};world.panels.push(panel);return panel;}
}};
const mod={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module:mod,exports:mod.exports,require:id=>id==='vscode'?vscode:require(id),process,console,Buffer,URL,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout,structuredClone,crypto:webcrypto,Blob,DecompressionStream,fetch:async(url,init)=>{
 const w=world;w.calls.push({url,method:init.method,body:init.body});assert.ok(url.startsWith(service+'/image-edits/'));assert.equal(init.headers.authorization,'Bearer '+secret);
 const id=url.split('/image-edits/')[1].split('/')[0];
 if(url.endsWith('/output'))return new Response(editedBytes,{headers:{'content-type':'image/png'}});
 if(init.method==='POST'&&!url.endsWith('/cancel')){
  assert.ok([...w.state.values()].some(s=>s?.jobs?.some(j=>j.id===id)),'job is persisted before dispatch');
  const persisted=JSON.stringify([...w.state]);assert.equal(persisted.includes(secret),false);assert.equal(persisted.includes('data:image'),false);assert.equal(persisted.includes('preserve-the-key-layout'),false);
  const input=JSON.parse(init.body);assert.equal(input.original.sha256,hash(originalBytes));assert.equal(input.preserve,'preserve-the-key-layout');
  if(w.networkFailure)throw Error('injected dispatch response loss');
  if(w.cancelDuringStart)w.cancel?.();
 }
 return Response.json({schema:'hps-image-edit-result/1',id,state:url.endsWith('/cancel')?'completed_after_cancel':'succeeded',original_sha256:hash(originalBytes),operation:'remove_background',transparent:true,cancel_requested:url.endsWith('/cancel'),error_code:null,provider:{name:'synthetic',model:'synthetic',request_id:'synthetic'},cost:w.customCost??(w.unknownCost?{request_id:id,recording_state:'unknown',pricing:'unknown',amount:null}:{request_id:id,recording_state:'recorded',pricing:'priced',amount_micro:'12500',currency:'USD',price_revision:'test-price-v1',unit:'micro_currency'}),semantic_preservation:'not_verified',output:{sha256:hash(editedBytes),mime:'image/png',width:12,height:12,hasAlpha:true,transparentPixels:1,opaquePixels:100,partialAlphaPixels:0,expires_at:Date.now()+10000}});
}});
const {runImageEdit,selectedImageEditContext,ActivityConnections}=mod.exports;
async function fixture(){const root=await fs.mkdtemp(path.join(tmp,'case-'));await fs.writeFile(path.join(root,'keyboard.png'),originalBytes);const state=new Map();world={root,service,token:secret,state,quick:[],inputs:[],calls:[],panels:[],notices:[],warnings:[],file:path.join(root,'keyboard.png'),confirm:'이미지를 보내 편집'};const ctx={workspaceState:{get:(k,d)=>state.has(k)?structuredClone(state.get(k)):d,update:async(k,v)=>state.set(k,structuredClone(v))},secrets:{get:async()=>world.token},subscriptions:[]};const options={profile:{image_edit:{enabled:true}},cwd:root,token:secret,proxyUrl:service,onSelected:async rel=>world.selected=rel};return {ctx,options,w:world};}
function newEdit(w){w.quick.push('새 PNG 편집','배경 제거 (투명 PNG)');w.inputs.push('preserve-the-key-layout');}
try{
 const a=await fixture();newEdit(a.w);await runImageEdit(a.ctx,a.options);assert.equal(a.w.warnings.length,0,a.w.warnings.join('\n'));assert.equal(a.w.panels.length,1);assert.equal(a.w.panels[0].options.localResourceRoots[0].fsPath,await fs.realpath(a.w.root));assert.ok(a.w.panels[0].webview.html.includes("default-src 'none'"));
 const state=[...a.w.state.values()][0],output=state.jobs[0].output;assert.ok(output.relativePath.startsWith('images/edited/'));assert.equal(state.selected,undefined,'saving does not automatically adopt');assert.deepEqual(await fs.readFile(path.join(a.w.root,'keyboard.png')),originalBytes);
 await a.w.panels[0].message({type:'imageEditSelection',action:'invalid'});assert.equal([...a.w.state.values()][0].selected,undefined);
 await a.w.panels[0].message({type:'imageEditSelection',action:'adopt'});assert.equal(a.w.selected,output.relativePath);assert.ok((await selectedImageEditContext(a.ctx,a.options.cwd,'선택한 이미지로 작업해줘')).includes(output.relativePath));assert.equal(await selectedImageEditContext(a.ctx,a.options.cwd,'간단한 페이지를 만들어줘'),'');
 await a.w.panels[0].message({type:'imageEditSelection',action:'restore'});assert.equal(a.w.selected,'keyboard.png');
 const before=a.w.calls.length;a.w.quick.push('이전 작업 확인',items=>items[0]);await runImageEdit(a.ctx,a.options);assert.equal(a.w.calls.length,before+1,'recorded output checks same job status without downloading/saving again');assert.equal(a.w.calls.at(-1).method,'GET');assert.ok(a.w.notices.some(t=>t.includes('12500 micro_currency (USD)')));assert.equal(a.w.panels.length,2);
 a.w.panels[0].dispose();assert.equal(a.w.panels[0].disposed,true,'closing comparison releases message listener');
 const other=await fs.mkdtemp(path.join(tmp,'other-'));a.w.root=other;await a.w.panels[1].message({type:'imageEditSelection',action:'adopt'});assert.equal(a.w.selected,'keyboard.png','stale panel cannot select into another workspace');await assert.rejects(()=>selectedImageEditContext(a.ctx,a.options.cwd,'편집한 이미지를 써줘'));
 console.log('PASS App command flow through VS Code seams: persist before dispatch, no image/prompt/credential in state, original preserved, comparison/adopt/restore/enum validation, selected context, repeated recovery and disposal/workspace isolation');
 const denied=await fixture();denied.options.profile={};await runImageEdit(denied.ctx,denied.options);assert.equal(denied.w.calls.length,0);assert.equal(denied.w.panels.length,0);assert.ok(denied.w.warnings[0].includes('허용'));
 const cancel=await fixture();newEdit(cancel.w);cancel.w.cancelDuringStart=true;await runImageEdit(cancel.ctx,cancel.options);assert.ok(cancel.w.calls.some(c=>c.url.endsWith('/cancel')));assert.equal(cancel.w.calls.some(c=>c.url.endsWith('/output')),false);assert.equal(cancel.w.panels.length,0);assert.equal([...cancel.w.state.values()][0].jobs[0].cancelRequested,true);assert.ok(cancel.w.notices.some(t=>t.includes('비용')&&t.includes('미확인')));
 cancel.w.quick.push('이전 작업 확인',items=>items[0]);await runImageEdit(cancel.ctx,cancel.options);assert.equal(cancel.w.panels.length,0,'late cancelled success cannot auto-save or apply');
 const loss=await fixture();newEdit(loss.w);loss.w.networkFailure=true;await runImageEdit(loss.ctx,loss.options);assert.equal(loss.w.calls.length,1,'response loss does not retry dispatch');const savedId=[...loss.w.state.values()][0].jobs[0].id;loss.w.networkFailure=false;loss.w.quick.push('이전 작업 확인',items=>items[0]);await runImageEdit(loss.ctx,loss.options);assert.equal(loss.w.calls.filter(c=>c.method==='POST').length,1);assert.ok(loss.w.calls.some(c=>c.method==='GET'&&c.url.endsWith(savedId)));assert.equal(loss.w.panels.length,1);
 loss.w.token='revoked-or-new-credential';await loss.w.panels[0].message({type:'imageEditSelection',action:'adopt'});assert.equal(loss.w.selected,undefined,'credential switch invalidates old comparison callback');
 const pendingCancel=await fixture();newEdit(pendingCancel.w);pendingCancel.w.networkFailure=true;await runImageEdit(pendingCancel.ctx,pendingCancel.options);pendingCancel.w.networkFailure=false;pendingCancel.w.quick.push('대기 작업 취소',items=>items[0]);await runImageEdit(pendingCancel.ctx,pendingCancel.options);assert.equal(pendingCancel.w.calls.filter(c=>c.url.endsWith('/cancel')).length,1);assert.equal(pendingCancel.w.panels.length,0);
 const unknownCost=await fixture();unknownCost.w.unknownCost=true;newEdit(unknownCost.w);await runImageEdit(unknownCost.ctx,unknownCost.options);assert.ok(unknownCost.w.notices.some(t=>t.includes('비용은 미확인')));
 const complete=await fixture();newEdit(complete.w);await runImageEdit(complete.ctx,complete.options);const completeCost=complete.w.notices.find(t=>t.includes('12500 micro_currency'));assert.ok(completeCost&&!completeCost.includes('부분 합계'));
 const costCases=[
  {pricing:'partial',amount_micro:19,issues:['missing:image:output_tokens'],partial:true},
  {pricing:'priced',amount_micro:19,issues:['missing:image:output_tokens'],partial:true},
  {pricing:'partial',amount_micro:0,issues:['missing:image:output_tokens'],partial:true},
  {pricing:'unpriced',amount_micro:null,issues:['missing:model']},
  {pricing:'unknown',amount_micro:0,issues:[]},
  {pricing:'priced',amount_micro:19,issues:[],recording_state:'pending_recovery'},
 ];
 for(const c of costCases){const fixtureCost=await fixture();fixtureCost.w.customCost={request_id:'synthetic-cost',recording_state:'recorded',currency:'USD',price_revision:'test-price-v1',unit:'micro_currency',...c};newEdit(fixtureCost.w);await runImageEdit(fixtureCost.ctx,fixtureCost.options);const notice=fixtureCost.w.notices.find(t=>t.includes('이미지')&&t.includes('비용')&&!t.includes('선택한 이미지'));assert.ok(notice?.includes('미확인'),JSON.stringify({c,notice}));if(c.partial){assert.ok(notice.includes('부분 합계')&&notice.includes(`${c.amount_micro} micro_currency`)&&notice.includes('전체 비용'),notice);assert.ok(notice.includes('missing:image:output_tokens'),notice);}else assert.equal(notice.includes('기록된 이미지 비용:'),false,notice);}
 console.log('PASS complete cost differs from partial subtotal/missing meter, unknown and pending recovery; unknown never implies zero');
 const activityChanged=await fixture(),credentials=new Map();activityChanged.ctx.globalStorageUri={fsPath:path.join(activityChanged.w.root,'host-storage')};activityChanged.ctx.secrets={get:async k=>credentials.get(k),store:async(k,v)=>credentials.set(k,v),delete:async k=>credentials.delete(k),keys:async()=>[...credentials.keys()],onDidChange:()=>({dispose(){}})};
 const connections=new ActivityConnections(activityChanged.ctx,()=>service,()=>activityChanged.w.root,async()=>({}));await connections.commit(secret,{activity_id:'a'.repeat(64),display_name:'Synthetic activity'},activityChanged.w.root);activityChanged.ctx=connections.wrap();activityChanged.options.profile.activity_id='a'.repeat(64);newEdit(activityChanged.w);await runImageEdit(activityChanged.ctx,activityChanged.options);assert.equal(activityChanged.w.panels.length,1);await connections.disconnect();await activityChanged.w.panels[0].message({type:'imageEditSelection',action:'adopt'});assert.equal(activityChanged.w.selected,undefined,'disconnected activity cannot adopt an old panel result');
 const outside=await fixture();outside.w.file=path.join(tmp,'outside.png');await fs.writeFile(outside.w.file,originalBytes);newEdit(outside.w);await runImageEdit(outside.ctx,outside.options);assert.equal(outside.w.calls.length,0);assert.equal(outside.w.state.size,0);
 const originalChanged=await fixture();newEdit(originalChanged.w);originalChanged.w.networkFailure=true;await runImageEdit(originalChanged.ctx,originalChanged.options);originalChanged.w.networkFailure=false;await fs.writeFile(path.join(originalChanged.w.root,'keyboard.png'),png(9,9));originalChanged.w.quick.push('이전 작업 확인',items=>items[0]);const oldCalls=originalChanged.w.calls.length;await runImageEdit(originalChanged.ctx,originalChanged.options);assert.equal(originalChanged.w.calls.length,oldCalls+1,'status may be recovered even when original changed; output must not be downloaded');assert.equal(originalChanged.w.calls.at(-1).method,'GET');assert.equal(originalChanged.w.panels.length,0);
 console.log('PASS feature denial, cancellation endpoint and late completion, lost-response same-ID recovery/no retry, credential switch, outside-path and changed-original refusals');
}finally{await fs.rm(tmp,{recursive:true,force:true});}
