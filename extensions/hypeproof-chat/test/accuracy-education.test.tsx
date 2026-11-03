import { click, mountPoint } from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccuracyEducation } from '../webview-ui/src/AccuracyEducation';
import { accuracyOffer, offerAccuracy, dismissAccuracy } from '../src/accuracyEducation';
import { AccuracyEducationStore } from '../src/accuracyEducationStore';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import type { ChatConfig, ChatMessage } from '../src/protocol';
const act = (React as any).act;
const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
  onEditResend: () => true,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = (draft?: unknown) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  ...(draft ? { activityDraft: draft } : {}),
}) as unknown as ChatConfig;
const personal = {
  ...classroom(), profile: { ...classroom().profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;



async function main() {
  const values = new Map<string, unknown>();
  const store = { get: <T,>(key: string) => values.get(key) as T | undefined, update: async (key: string, value: unknown) => { values.set(key, value); } };
  assert.equal(accuracyOffer({get:()=>({scope:'x',messageId:42}) as any,update:async()=>{}},'learner','x'),null,'malformed saved offer rejected');
  const offer = {scope:'activity/task',messageId:'first-answer'};
  for (const result of [{status:'error',text:'partial',instructor:false},{status:'aborted',text:'partial',instructor:false},{status:'ok',text:'  ',instructor:false},{status:'ok',text:'answer',instructor:true}]) {
    await offerAccuracy(store,'learner',offer,result);
    assert.equal(accuracyOffer(store,'learner',offer.scope),null,'no card for incomplete/empty/instructor result');
  }
  await offerAccuracy(store,'learner',offer,{status:'ok',text:'first',instructor:false});
  assert.deepEqual(accuracyOffer(store,'learner',offer.scope),offer);
  await offerAccuracy(store,'learner',{scope:'another-task',messageId:'second'},{status:'ok',text:'second',instructor:false});
  assert.deepEqual(accuracyOffer(store,'learner',offer.scope),offer,'a later result never retargets the first check');
  assert.equal(accuracyOffer(store,'learner','another-task'),null);
  assert.equal(await dismissAccuracy(store,'learner','another-task',offer.messageId),false);
  assert.equal(await dismissAccuracy(store,'learner',offer.scope,'second'),false);
  assert.deepEqual(accuracyOffer(store,'learner',offer.scope),offer,'stale clicks do not dismiss');
  assert.equal(await dismissAccuracy(store,'learner',offer.scope,offer.messageId),true);
  const reloaded = {...store};
  assert.equal(accuracyOffer(reloaded,'learner',offer.scope),null);
  await offerAccuracy(reloaded,'learner',offer,{status:'ok',text:'third',instructor:false});
  assert.equal(accuracyOffer(reloaded,'learner',offer.scope),null);
  await offerAccuracy(store,'minor-seat',offer,{status:'ok',text:'minor result',instructor:false});
  assert.deepEqual(accuracyOffer(store,'minor-seat',offer.scope),offer,'another learner/minor never inherits dismissal');
  const host = mountPoint(), root = createRoot(host as any);
  let dismissals=0;
  const answer='<script>hostile()</script> 답을 직접 비교해요';
  await act(async()=>root.render(<AccuracyEducation answer={answer} onDismiss={()=>dismissals++}/>));
  const button=(text:string)=>host.findAll((el:any)=>el.localName==='button'&&el.textContent===text)[0];
  assert.ok(host.textContent.includes('AI도 틀릴 수 있어요. 결과를 직접 눌러 확인해 봐요.'));
  assert.equal(host.findAll((el:any)=>el.localName==='blockquote').length,0);
  await act(async()=>click(button('결과 확인하기')));
  assert.equal(host.findAll((el:any)=>el.localName==='blockquote')[0].textContent,answer,'check opens this result');
  assert.equal(host.findAll((el:any)=>el.localName==='script').length,0,'answer is text, never executable markup');
  assert.ok(host.textContent.includes('원래 자료에서도 확인해 봐요.'));
  assert.ok(button('확인 마치기').hasAttribute('disabled'));
  await act(async()=>click(button('확인 마치기')));
  assert.equal(dismissals,0,'opening the check is not performing it');
  await act(async()=>click(button('요청한 내용과 답을 비교했어요')));
  assert.equal(button('요청한 내용과 답을 비교했어요').getAttribute('aria-pressed'),'true');
  assert.equal(button('확인 마치기').hasAttribute('disabled'),false);
  await act(async()=>click(button('확인 마치기')));
  assert.equal(dismissals,1,'learner completion reaches dismissal');
  await act(async()=>click(button('닫기')));
  assert.equal(dismissals,2,'explicit close reaches dismissal independently');
  await act(async()=>root.unmount());
  const directory = mkdtempSync(join(tmpdir(), 'accuracy-store-'));
  try {
    const windowA = new AccuracyEducationStore(directory), windowB = new AccuracyEducationStore(directory);
    // Both windows may already have read an empty record before either reserves it.
    await Promise.all([windowA.update('racing-reservation',offer),windowB.update('racing-reservation',{scope:offer.scope,messageId:'later'})]);
    assert.deepEqual(windowA.get('racing-reservation'),offer,'atomic create cannot overwrite the first window');
    await Promise.all([offerAccuracy(windowA,'seat',offer,{status:'ok',text:'first',instructor:false}),
      offerAccuracy(windowB,'seat',{scope:offer.scope,messageId:'later'},{status:'ok',text:'later',instructor:false})]);
    assert.deepEqual(accuracyOffer(windowB,'seat',offer.scope),offer,'first reservation wins across windows');
    await dismissAccuracy(windowB,'seat',offer.scope,offer.messageId);
    assert.equal(accuracyOffer(new AccuracyEducationStore(directory),'seat',offer.scope),null,'disk dismissal survives a new host');
  } finally { rmSync(directory,{recursive:true,force:true}); }

  const posted = (globalThis as any).__posted as any[];
  for (const config of [personal, classroom(), {...classroom(), profile:{...classroom().profile, minor_cohort:true}} as ChatConfig]) {
    const container=mountPoint(), panel=createRoot(container as any);
    const messages:ChatMessage[]=[{id:'first-answer',role:'assistant',content:'내 첫 결과',createdAt:1}];
    const render=async(extra={})=>act(async()=>panel.render(<ChatPanel {...PROPS} config={config} messages={messages} {...extra}/>));
    const emit=async(data:any)=>act(async()=>window.dispatchEvent({type:'message',data} as any));
    const card=()=>container.findAll((e:any)=>e.getAttribute('class')==='hps-accuracy-card');
    await render();
    assert.equal(card().length,0,'not before the host confirms completion');
    let request=posted.filter(m=>m.type==='accuracyEducationRequest').at(-1);
    assert.ok(request);
    await emit({type:'accuracyEducation',requestId:'old-request',offer});
    assert.equal(card().length,0,'stale response rejected');
    await emit({type:'accuracyEducation',requestId:request.requestId,offer});
    assert.equal(card().length,1,'personal, classroom, and minor seats receive one card');
    await render({streaming:true,streamingId:'second'});
    assert.equal(card().length,0,'never interrupt streaming');
    await render();
    assert.equal(card().length,1,'same target remains after next turn');
    const close=container.findAll((e:any)=>e.localName==='button'&&e.textContent==='닫기').at(-1);
    await act(async()=>click(close));
    assert.equal(posted.at(-1).type,'accuracyEducationDismiss');
    assert.equal(posted.at(-1).messageId,'first-answer','dismissal bound to actual answer');
    const previousRequestId=request.requestId;
    await emit({type:'accuracyEducationChanged'});
    request=posted.filter(m=>m.type==='accuracyEducationRequest').at(-1);
    assert.notEqual(request.requestId,previousRequestId,'change notification must request fresh persisted state');
    await emit({type:'accuracyEducation',requestId:request.requestId,offer:null});
    assert.equal(card().length,0,'host persisted dismissal removes card');
    await render({instructor:true});
    await emit({type:'accuracyEducation',requestId:request.requestId,offer});
    assert.equal(card().length,0,'instructor excluded');
    await act(async()=>panel.unmount());
  }
  console.log('PASS accuracy education: completion guards, stable binding, durable dismissal, learner check, safe text');
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
