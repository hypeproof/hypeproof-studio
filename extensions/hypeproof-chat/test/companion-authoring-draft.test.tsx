import {mountPoint} from './fixtures/mini-dom.mjs';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import assert from 'node:assert/strict';
import {ChatPanel} from '../webview-ui/src/ChatPanel';
import type {ChatConfig} from '../src/protocol';
const posted=()=>(globalThis as any).__posted as any[];
const noop=()=>{};
const props={messages:[],streaming:false,streamingId:null,error:null,errorRequestId:null,errorRunbookUrl:null,canRetryLast:false,pageNotice:null,aiNotice:null,stopNotice:null,openWorldId:null,publish:null,incomingImage:null,onSend:()=>{throw Error('import must not Send');},onRetry:noop,onRetryLast:noop,onDismissError:noop,onCancel:noop,onClear:noop,onSetToken:noop,onSettings:noop,onRunCode:noop,onNamingRitual:noop,onSaveCoach:noop,onReportProblem:noop,onInstallUpdate:noop,onDismissUpdate:noop,onPublish:noop};
const config={proxyUrl:'http://localhost',model:'fixture',hasToken:true,coach:{name:'HypeProof',personality:'',configured:true},activity:{id:'activity',kind:'personal',verified:true,workspace:'/tmp/work'},taskWorkspace:{scope:'s',revision:1,activeTaskId:'task',tasks:[],sourceSelection:null},activityDraft:{text:'',images:[],queued:null}} as unknown as ChatConfig;
const hostSays=(data:unknown)=>act(async()=>{window.dispatchEvent({type:'message',data,bubbles:false} as any);});
async function run(){
 const host=mountPoint(),root=createRoot(host as any);await act(async()=>{root.render(<ChatPanel {...props} config={config}/>);});
 await hostSays({type:'config',config});
 const scope={activityId:'activity',taskId:'task'};
 await hostSays({type:'companionDraftCapture',nonce:'capture',...scope});const captured=posted().findLast(m=>m.nonce==='capture');assert.equal(captured.draft.text,'');assert.equal(captured.imagePreparationFailed,false);
 const beforeApply=posted().length;
 await hostSays({type:'companionDraftApply',nonce:'apply',generation:captured.uiGeneration,text:'검토한 휴대폰 요청',...scope});const applied=posted().findLast(m=>m.nonce==='apply');assert.equal(applied.companionApplied,true);assert.equal(host.querySelector('textarea').value,'검토한 휴대폰 요청');
 // The native host has already durably imported this text. A second ordinary
 // autosave from this render races its exact-revision presentation receipt.
 assert.equal(posted().slice(beforeApply).filter(m=>m.type==='saveActivityDraft'&&!m.nonce).length,0,'confirmed companion render must ACK without a competing ordinary autosave');
 await hostSays({type:'companionDraftApply',nonce:'replay',generation:captured.uiGeneration,text:'overwrite',...scope});assert.equal(posted().findLast(m=>m.nonce==='replay').companionApplied,false);assert.equal(host.querySelector('textarea').value,'검토한 휴대폰 요청');
 const beforeNativeEdit=posted().length;
 await act(async()=>{const area=host.querySelector('textarea');area.value='검토한 휴대폰 요청\n컴퓨터에서 이어 쓴 내용';area.dispatchEvent({type:'input',bubbles:true});});
 const laterSaves=posted().slice(beforeNativeEdit).filter(m=>m.type==='saveActivityDraft'&&!m.nonce);
 assert.equal(laterSaves.length,1,'later ordinary composer changes still autosave');
 assert.ok(laterSaves[0].draft.text.includes('컴퓨터에서 이어 쓴 내용'));
 assert.ok(laterSaves[0].draft.text.includes('검토한 휴대폰 요청'));
 await act(async()=>root.unmount());
 const second=mountPoint(),root2=createRoot(second as any);await act(async()=>root2.render(<ChatPanel {...props} config={config}/>));
 await hostSays({type:'companionDraftCapture',nonce:'beforeEdit',...scope});const beforeEdit=posted().findLast(m=>m.nonce==='beforeEdit');
 // Normal host recovery edits the real composer while desktop review is open.
 await hostSays({type:'inputRejected',text:'검토 중 생긴 입력',images:[],...scope});
 await hostSays({type:'companionDraftApply',nonce:'staleApply',generation:beforeEdit.uiGeneration,text:'phone request',...scope});assert.equal(posted().findLast(m=>m.nonce==='staleApply').companionApplied,false);assert.equal(second.querySelector('textarea').value,'검토 중 생긴 입력');
 await act(async()=>root2.unmount());console.log('companion-authoring-draft: rendered import ACK and stale generation preservation PASS');
}
run().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
