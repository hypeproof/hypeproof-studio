import { click, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import { AttachmentFailures, AttachmentFailureNotice } from '../webview-ui/src/AttachmentFailures';
const noop=()=>{};
const resolvedProfile=(_n:number,over:any)=>({profile_id:'test',welcome:{greeting_md:'안녕하세요'},ux:{coach:{naming_mode:'fixed',fallback_name:'코치',naming_prompt_md:'',personality_prompt_md:''},suggestions:{initial:[],follow_up:[]},hints:{short_input:{enabled:false,min_chars:0,message_md:''},roll_input_button:{enabled:false,label:'',probe_md:''}},retry_button:{enabled:false,show_counter:false}},...over});
const chatConfig=(_n:number,over:any)=>({model:'test',hasToken:true,proxyUrl:'http://localhost:8787',coach:{name:'코치',personality:'',configured:true},...over});
const chatPanelProps=(over:any)=>({streaming:false,streamingId:null,error:null,errorRequestId:null,errorRunbookUrl:null,canRetryLast:false,pageNotice:null,aiNotice:null,stopNotice:null,openWorldId:null,publish:null,incomingImage:null,messages:[],onSend:noop,onRetry:noop,onRetryLast:noop,onDismissError:noop,onCancel:noop,onClear:noop,onSetToken:noop,onSettings:noop,onRunCode:noop,onNamingRitual:noop,onSaveCoach:noop,onReportProblem:noop,onInstallUpdate:noop,onDismissUpdate:noop,onPublish:noop,...over});
for (const n of ['Node','Element']) (globalThis as any)[n]=(window as any)[n];
(globalThis as any).HTMLElement=(window as any).Element;
const act=(React as any).act;
const find=(h:any,t:string)=>h.findAll((e:any)=>e.getAttribute('data-testid')===t);
const fire=async(data:any)=>act(async()=>window.dispatchEvent({type:'message',data} as any));
const hiddenFromAT=(e:any)=>{for(let n=e;n;n=n.parentNode)if(n.getAttribute?.('aria-hidden')==='true')return true;return false;};
const cases=[
 ['빈 파일이에요. 내용을 저장한 뒤 다시 시도해 주세요.','빈 파일','file'],
 ['읽을 글자가 없어요. 글자가 있는 파일을 골라 주세요.','글자 없음','file'],
 ['파일이 너무 커요. 100KB까지 첨부할 수 있어요.','크기 초과','ruler'],
 ['글자가 너무 많아요. 나눠서 첨부해 주세요.','글자 수 초과','ruler'],
 ['시간이 너무 오래 걸려요. 다시 시도해 주세요.','시간 초과','clock'],
 ['파일을 읽을 권한이 없어요. 접근 권한을 확인해 주세요.','권한 없음','lock'],
 ['지원하지 않는 형식이에요. 다른 파일을 골라 주세요.','지원하지 않는 형식','file'],
 ['파일을 다시 골라 주세요.','다시 선택 필요','folder'],
 ['파일을 읽지 못했어요. 다른 파일을 골라 주세요.','첨부 실패','alert'],
];
async function main(){
 const host=mountPoint(),root=createRoot(host as any);let retry='',remove='';
 for(const [reason,label,icon] of cases){
  await act(async()=>root.render(<><AttachmentFailures items={[{id:'one',name:'<unsafe>\u202efile.txt',reason}]} retry={id=>retry=id} remove={id=>remove=id}/><AttachmentFailureNotice items={[{id:'one',name:'<unsafe>\u202efile.txt',reason}]}/></>));
  const chip=find(host,'attachment-failure')[0],badge=find(host,'attachment-failure-cause')[0];
  assert.equal(badge.textContent,label);assert.equal(badge.findAll((e:any)=>e.localName==='svg')[0].getAttribute('data-icon'),icon);
  assert.equal(badge.findAll((e:any)=>e.localName==='svg')[0].getAttribute('aria-hidden'),'true');
  assert.ok(chip.textContent.includes(reason));assert.ok(!host.textContent.includes('\u202e'));assert.ok(host.textContent.includes('<unsafe>'));
  assert.equal(host.findAll((e:any)=>e.getAttribute('role')==='alert').length,0);
  const summary=find(host,'attachment-error-summary')[0];assert.equal(summary.textContent,`<unsafe> file.txt: ${reason}`);
  assert.equal(summary.getAttribute('role'),'status');assert.equal(summary.getAttribute('aria-live'),'polite');assert.equal(summary.getAttribute('aria-atomic'),'true');
  await act(async()=>click(chip.findAll((e:any)=>e.localName==='button')[0]));assert.equal(retry,'one');
  await act(async()=>click(chip.findAll((e:any)=>e.localName==='button')[1]));assert.equal(remove,'one');
 }
 await act(async()=>root.unmount());
 for(const seat of ['personal','classroom']){
  const host=mountPoint(),root=createRoot(host as any);let sends=0;
  const config=chatConfig(3,{activity:{id:seat,name:'테스트',kind:seat,workspace:'/tmp/test',verified:true},profile:resolvedProfile(3,{activity_kind:seat,input:{image_paste:true},lesson:null}),activityDraft:{text:'보존할 질문',images:[],imports:[]}});
  const render=(extra={})=>root.render(<ChatPanel {...chatPanelProps({config,onSend:()=>sends++,...extra}) as any}/>);
  await act(async()=>render());
  const textarea=host.findAll((e:any)=>e.localName==='textarea')[0];
  const summary=find(host,'attachment-error-summary')[0];assert.ok(summary);assert.equal(summary.textContent,'');
  const input=host.findAll((e:any)=>(e.getAttribute('class')??'').split(' ').includes('hps-input'))[0];
  assert.ok(summary.parentNode===input.parentNode);assert.ok(input.parentNode.childNodes.indexOf(summary)>input.parentNode.childNodes.indexOf(input));
  await act(async()=>{textarea.value='직접 입력한 질문';textarea.dispatchEvent({type:'input',bubbles:true});});
  for(const id of ['a','b']) await fire({type:'attachmentFailure',failure:{id,name:`${id}.txt`,reason:cases[0][0]}});
  assert.equal(find(host,'attachment-failure').length,2);assert.ok(find(host,'attachment-error-summary')[0]===summary);assert.equal(summary.textContent,`b.txt: ${cases[0][0]}`);
  assert.equal(textarea.value,'직접 입력한 질문');assert.equal(sends,0);
  const chip=find(host,'attachment-failure')[0];assert.ok(chip.parentNode.parentNode===input.parentNode);
  await act(async()=>click(chip.findAll((e:any)=>e.localName==='button')[0]));assert.ok(find(host,'attachment-failure')[0].textContent.includes('다시 읽는 중'));assert.ok(!find(host,'attachment-failure')[1].textContent.includes('다시 읽는 중'));
  await fire({type:'attachmentFailureResolved',id:'a'});assert.equal(find(host,'attachment-failure').length,1);assert.ok(summary.textContent.startsWith('b.txt:'));
  await act(async()=>click(find(host,'attachment-failure')[0].findAll((e:any)=>e.localName==='button')[1]));assert.equal(summary.textContent,'');
  await fire({type:'imageStagedByHost',stageId:'photo',name:'사진.png'});await fire({type:'imageStageRefused',stageId:'photo',reason:cases[4][0]});
  assert.equal(find(host,'attachment-failure-cause')[0].textContent,'시간 초과');assert.equal(summary.textContent,`사진.png: ${cases[4][0]}`);
  // Exactly one live region announces a refused photo: the summary. main's sr-only announcer keeps its text but is aria-hidden.
  const announcer=find(host,'attachment-announcer')[0];assert.equal(announcer.textContent,cases[4][0]);assert.equal(announcer.getAttribute('aria-hidden'),'true');
  const announcing=host.findAll((e:any)=>(e.getAttribute('aria-live')||['status','alert'].includes(e.getAttribute('role')))&&e.textContent.includes(cases[4][0])&&!hiddenFromAT(e));
  assert.deepEqual(announcing.map((e:any)=>e.getAttribute('data-testid')),['attachment-error-summary']);
  const retryButton=host.findAll((e:any)=>(e.getAttribute('class')??'').split(' ').includes('hps-photo-failure'))[0].findAll((e:any)=>e.localName==='button')[0];
  assert.equal(retryButton.textContent,'이 파일만 다시 시도');assert.ok(!retryButton.hasAttribute('tabindex')&&!hiddenFromAT(retryButton),'retry is a reachable control');
  await fire({type:'imageStagedByHost',stageId:'sibling',name:'다른 사진.png'});assert.ok(summary.textContent.includes(cases[4][0]));
  await fire({type:'imageStagedByHost',stageId:'photo',name:'사진.png'});assert.equal(summary.textContent,'');assert.equal(find(host,'attachment-announcer')[0].getAttribute('aria-hidden'),null,'the announcer is live again for other notes');assert.equal(textarea.value,'직접 입력한 질문');assert.equal(sends,0);
  assert.ok(!host.textContent.includes(cases[4][0]));
  // Actual send preparation refusal is the third producer of the same status.
  const send=host.findAll((e:any)=>e.localName==='button' && (e.textContent.trim()==='보내기' || e.getAttribute('aria-label')==='메시지 보내기'))[0];
  await act(async()=>click(send));
  const request=(globalThis as any).__posted.filter((m:any)=>m.type==='prepareAttachments').at(-1);assert.ok(request);
  await fire({type:'attachmentsPrepared',requestId:request.requestId,failures:[{id:'photo',name:'사진.png',reason:cases[5][0]}]});
  assert.equal(summary.textContent,`사진.png: ${cases[5][0]}`);assert.equal(textarea.value,'직접 입력한 질문');assert.equal(sends,0);
  await act(async()=>click(find(host,'attachment-failure')[0].findAll((e:any)=>e.localName==='button')[1]));assert.equal(summary.textContent,'');
  await act(async()=>render({fileAttachError:cases[5][0]}));assert.equal(summary.textContent,cases[5][0]);
  await act(async()=>root.unmount());
 }
 console.log('attachment error design: glyph/label, polite status, draft and targeted recovery PASS');
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
