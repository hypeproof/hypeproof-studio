// CGP-CHAT-D53: real React events and the ordinary ChatPanel send path.
import { click, mountPoint, document } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { ReplyChoices } from '../webview-ui/src/ReplyChoices';
import { replyChoices } from '../webview-ui/src/replyChoiceParser';
import { ChatPanel } from '../webview-ui/src/ChatPanel';

import type { ChatConfig, ChatMessage } from '../src/protocol';
const act = (React as unknown as {act: (fn:()=>unknown)=>Promise<void>}).act;
const text='어느 쪽이 좋을까요?\n1. 먼저 계획하기 (추천)\n2. 바로 만들기\n\n편하게 골라 주세요.';
const question=replyChoices(text)!;
const key=(el:any,k:string,extra:Record<string,unknown>={})=>el.dispatchEvent({type:'keydown',key:k,bubbles:true,cancelable:true,keyCode:k==='Enter'?13:k===' '?32:0,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this._stopped=true;},...extra});
const find=(host:any,role:string)=>host.findAll((e:any)=>e.getAttribute('role')===role);
const button=(host:any,label:string)=>host.findAll((e:any)=>e.tagName==='BUTTON'&&e.textContent===label)[0];
async function standalone(extra:Record<string,unknown>={}) {
 const host=mountPoint(),root=createRoot(host as unknown as HTMLElement),picked:string[]=[],sent:string[]=[];
 await act(()=>root.render(<ReplyChoices question={question} onPick={v=>picked.push(v)} onWrite={()=>{}} onSubmit={v=>{sent.push(v);return true;}} {...extra}/>));
 return {host,root,picked,sent,radios:()=>find(host,'radio'),card:()=>find(host,'group')[0],close:async()=>{await act(()=>root.unmount());document.body.removeChild(host);}};
}
const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const personal = {
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

const chatPanelProps = () => PROPS;
async function run(){
 assert.deepEqual(question.options.map(o=>[o.label,!!o.recommended]),[['먼저 계획하기',true],['바로 만들기',false]]);
 for(const marker of ['[추천]','(추천)'])assert.equal(replyChoices(text.replace('(추천)',marker))?.options[0].recommended,true);
 for(const marker of ['[추천)','추천하고 싶어요'])assert.equal(replyChoices(text.replace('(추천)',marker))?.options[0].recommended,undefined);
 for(const bad of ['\u202e숨김','\u0001제어','\u2066방향','\u2028분리','ab\tcd','<img>','x'.repeat(221)])assert.equal(replyChoices(text.replace('바로 만들기',bad)),null);
 assert.equal(replyChoices('설치 순서입니다.\n1. 설치\n2. 실행'),null);
 {
  const v=await standalone(); assert.ok(document.activeElement===v.card(),'idle arrival focuses card');
  assert.deepEqual(v.radios().map((e:any)=>e.getAttribute('aria-checked')),['false','false']);
  assert.equal(v.host.findAll((e:any)=>(e.getAttribute('class')??'')==='hps-choice-recommended')[0].textContent,'추천');
  await act(()=>key(v.radios()[0],'Enter'));assert.equal(v.sent.length,0,'Enter cannot select or send');
  await act(()=>key(v.radios()[0],'ArrowDown'));assert.ok(document.activeElement===v.radios()[1],'ArrowDown focuses next option');assert.equal(v.picked.length,0,'arrows do not choose');
  for(const k of ['ArrowRight','ArrowUp','ArrowLeft','ArrowDown'])await act(()=>key(document.activeElement,k));
  assert.ok(document.activeElement===v.radios()[1],'all arrows wrap focus');
  await act(()=>key(v.radios()[1],' ',{repeat:true}));assert.equal(v.picked.length,0,'held Space does not pick repeatedly');
  await act(()=>key(v.radios()[1],' '));assert.deepEqual(v.picked,['2. 바로 만들기']);assert.equal(v.radios()[1].getAttribute('aria-checked'),'true');assert.equal(v.sent.length,0,'Space only chooses');
  await act(()=>{key(v.radios()[1],'Enter');key(v.radios()[1],'Enter');});assert.deepEqual(v.sent,['2. 바로 만들기'],'two Enter events send once');
  await act(()=>click(v.radios()[0]));assert.deepEqual(v.picked,['2. 바로 만들기'],'sent card cannot prepare another answer');await v.close();
 }
 {
  const input=document.createElement('textarea');input.value='쓰는 중';document.body.appendChild(input);input.focus();
  const v=await standalone();assert.ok(document.activeElement===input,'typing focus is preserved');assert.equal(find(v.host,'status')[0].textContent,'질문이 왔어요');
  await act(()=>click(v.radios()[0]));assert.equal(find(v.host,'status').length,0);await v.close();document.body.removeChild(input);
  const w=await standalone({typing:true});assert.ok(document.activeElement!==w.card(),'IME/draft signal protects empty composition');assert.equal(find(w.host,'status')[0].textContent,'질문이 왔어요');await w.close();
 }
 {
  const v=await standalone();await act(()=>click(v.radios()[0]));
  for(const extra of [{isComposing:true},{keyCode:229},{repeat:true}])await act(()=>key(v.radios()[0],'Enter',extra));
  assert.equal(v.sent.length,0,'IME/repeat never send');
  await act(()=>v.radios()[0].dispatchEvent({type:'compositionstart',bubbles:true,data:''}));
  await act(()=>key(v.radios()[0],'Enter'));assert.equal(v.sent.length,0,'open composition blocks plain Enter');
  await act(()=>click(button(v.host,'선택한 답변 보내기')));assert.equal(v.sent.length,0,'confirmation also waits for composition end');
  await act(()=>v.radios()[0].dispatchEvent({type:'compositionend',bubbles:true,data:'한'}));
  await act(()=>click(button(v.host,'직접 입력')));assert.ok(v.radios().every((e:any)=>e.getAttribute('aria-checked')==='false'));
  await act(()=>key(v.card(),'Enter'));assert.equal(v.sent.length,0,'write-own clears selection');await v.close();
 }
 {
  let attempts=0;const v=await standalone({onSubmit:()=>++attempts>1});await act(()=>click(v.radios()[0]));await act(()=>key(v.card(),'Enter'));await act(()=>key(v.card(),'Enter'));assert.equal(attempts,2,'rejected send remains retryable');await v.close();
 }
 {
  const linked={...question,before:'[설명](https://example.com) 어느 쪽이 좋을까요?'};
  const v=await standalone({question:linked});await act(()=>click(v.radios()[0]));
  const link=v.host.findAll((e:any)=>e.tagName==='A')[0];
  await act(()=>key(link,'Enter'));assert.equal(v.sent.length,0,'prose links cannot submit');
  await act(()=>v.root.render(<ReplyChoices question={question} onPick={()=>{}} onWrite={()=>{}} onSubmit={()=>true} selectionValid={false}/>));
  assert.ok(find(v.host,'radio').every((e:any)=>e.getAttribute('aria-checked')==='false'),'manual draft ownership loss clears selection');
  assert.equal(button(v.host,'선택한 답변 보내기').hasAttribute('disabled'),true);await v.close();
 }
 {
  // A question must never expire or choose automatically while the learner thinks.
  const timers: (()=>void)[]=[];
  const timeout=globalThis.setTimeout, interval=globalThis.setInterval;
  globalThis.setTimeout=((fn:any)=>{timers.push(fn);return 1;}) as any;
  globalThis.setInterval=((fn:any)=>{timers.push(fn);return 1;}) as any;
  try {
   const v=await standalone();
   for(const tick of timers)await act(()=>tick());
   assert.equal(timers.length,0,'question registers no answer timer');
   assert.equal(v.radios().length,2);assert.equal(v.sent.length,0);assert.equal(v.picked.length,0);
   await v.close();
  } finally {globalThis.setTimeout=timeout;globalThis.setInterval=interval;}
 }
 {
  const three={...question,options:[...question.options,{number:3,label:'예시 보기'}]};
  const v=await standalone({question:three});
  await act(()=>key(v.radios()[0],'ArrowLeft'));assert.ok(document.activeElement===v.radios()[2],'left from first wraps to last');
  await act(()=>key(v.radios()[2],'ArrowRight'));assert.ok(document.activeElement===v.radios()[0],'right from last wraps to first');
  await act(()=>key(v.radios()[0],'ArrowRight'));assert.ok(document.activeElement===v.radios()[1],'right moves forward among three choices');
  assert.equal(v.picked.length,0);await v.close();
 }
 const base={...personal, activityDraft:{text:'내 생각',images:[],queued:null}} as unknown as ChatConfig;
 const messages:ChatMessage[]=[{id:'u1',role:'user',content:'골라줘',createdAt:1},{id:'a1',role:'assistant',content:text,createdAt:2}];
 {
  const host=mountPoint(),root=createRoot(host as unknown as HTMLElement),sent:string[]=[];
  const render=(ms=messages,extra:Record<string,unknown>={})=>root.render(<ChatPanel {...chatPanelProps()} config={base} messages={ms} onSend={v=>{sent.push(v);}} {...extra}/>);
  await act(()=>render());assert.equal(find(host,'status').some((e:any)=>e.textContent==='질문이 왔어요'),true);
  await act(()=>click(find(host,'radio')[0]));assert.equal(host.findAll((e:any)=>e.tagName==='TEXTAREA')[0].value,'내 생각\n1. 먼저 계획하기','existing draft preserved');assert.equal(sent.length,0);
  await act(()=>key(find(host,'radio')[0],'Enter'));assert.deepEqual(sent,['내 생각\n1. 먼저 계획하기'],'same normal send path sends composed draft');
  await act(()=>render([...messages,{id:'a2',role:'assistant',content:text,createdAt:3}]));assert.equal(find(host,'radio').length,2,'only latest turn is interactive');
  await act(()=>key(find(host,'radio')[0],'Enter'));assert.equal(sent.length,1,'new turn has no inherited selection');
  await act(()=>render(messages,{sendPending:true}));assert.equal(find(host,'radio').length,0,'pending send removes card');
  await act(()=>render(messages,{streaming:true,streamingId:'a1'}));assert.equal(find(host,'radio').length,0,'streaming fragments are prose');
  await act(()=>root.unmount());document.body.removeChild(host);
 }
 {
  const host=mountPoint(),root=createRoot(host as unknown as HTMLElement),sent:string[]=[];
  const render=(content:string)=>root.render(<ChatPanel {...PROPS} config={base} messages={[messages[0],{...messages[1],content}]} onSend={v=>sent.push(v)}/>);
  await act(()=>render(text));await act(()=>click(find(host,'radio')[0]));
  const editor=host.findAll((e:any)=>e.tagName==='TEXTAREA')[0];
  await act(()=>{editor.value='직접 고친 답';editor.dispatchEvent({type:'input',bubbles:true,cancelable:true});});
  assert.ok(find(host,'radio').every((e:any)=>e.getAttribute('aria-checked')==='false'),'actual composer edit clears card selection');
  await act(()=>key(find(host,'radio')[0],'Enter'));assert.equal(sent.length,0,'editing requires a new selection');
  await act(()=>click(find(host,'radio')[0]));
  await act(()=>render(text.replace('바로 만들기','작게 시작하기')));
  assert.ok(find(host,'radio').every((e:any)=>e.getAttribute('aria-checked')==='false'),'same-id revised question resets selection');
  await act(()=>key(find(host,'radio')[0],'Enter'));assert.equal(sent.length,0,'revised content cannot confirm old selection');
  await act(()=>root.unmount());document.body.removeChild(host);
 }
 {
  const host=mountPoint(),root=createRoot(host as unknown as HTMLElement);
  await act(()=>root.render(<ChatPanel {...chatPanelProps()} config={classroom} messages={messages}/>));assert.equal(find(host,'radio').length,0,'classroom gate unchanged');await act(()=>root.unmount());document.body.removeChild(host);
 }
 console.log('question-card: parser, arrival/typing, keyboard/IME, retry/double press, actual draft/send and seat/turn gates PASS');
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
