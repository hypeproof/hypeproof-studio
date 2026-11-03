// CGP-CHAT-D-001 verify M10: after a scope (task) switch the announcer resyncs, so the next turn still
// announces its start once. Fails if ChatPanel drops the prev.current = streaming resync.
import { document as doc, mountPoint, click } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { App } from "../webview-ui/src/App";
import type { ChatConfig } from "../src/protocol";
const act = (React as any).act;
const noop = () => {};
const PROPS = {
  messages: [], streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
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
const config = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;


const g = globalThis as any;
async function run() {
  const host:any=mountPoint(); const root=createRoot(host);
  const send = async (data:any) => act(async () => {
    g.window.dispatchEvent({ type: 'message', data });
  });
  await act(async()=>{root.render(<App/>);});
  const cfg:any={...config,activityDraft:{text:'한글 조합 중 표시',images:[]}};
  await send({type:'config',config:cfg});
  const editor=()=>host.findAll((e:any)=>e.localName==='textarea')[0];
  const banner=()=>host.findAll((e:any)=>(e.getAttribute('class')??'').split(' ').includes('hps-refusal-banner'))[0];
  const input:any=editor(); assert.ok(input,'composer exists'); input.focus();
  input.selectionStart=3; input.selectionEnd=5;
  const before=input.value;
  await send({type:'streamStart',streamId:'s1',messageId:'a1'});
  await act(async()=>input.dispatchEvent({type:'compositionstart',bubbles:true,data:'ㅎ'}));
  await send({type:'streamRefusal',streamId:'wrong'}); assert.ok(!banner(),'foreign stream ignored');
  await send({type:'streamRefusal',streamId:'s1',raw:'secret raw policy'});
  assert.ok(banner(),'explicit refusal rendered');
  assert.ok(banner().textContent.includes('이렇게 해 볼 수 있어요'),'next step');
  assert.ok(!banner().textContent.includes('secret raw policy'),'raw payload never rendered');
  assert.equal(banner().getAttribute('aria-live'),'polite');
  assert.equal(banner().parentNode.localName,'footer','banner in composer footer');
  assert.ok(editor()===input,'composer not remounted'); assert.ok(doc.activeElement===input,'arrival preserves focus');
  assert.equal(input.value,before,'draft preserved'); assert.equal(input.selectionStart,3); assert.equal(input.selectionEnd,5);
  await send({type:'streamEnd',streamId:'s1'}); assert.ok(banner(),'terminal keeps guidance');
  const sentBefore=g.__posted.filter((m:any)=>m.type==='sendMessage').length;
  await act(async()=>input.dispatchEvent({type:'keydown',key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true,preventDefault(){},stopPropagation(){}}));
  assert.equal(g.__posted.filter((m:any)=>m.type==='sendMessage').length,sentBefore,'IME Enter never sends');
  const close=banner().findAll((e:any)=>e.localName==='button')[0];
  close.focus(); await act(async()=>click(close));
  assert.ok(!banner(),'dismissed'); assert.ok(doc.activeElement===input,'explicit dismiss returns to composer'); assert.equal(input.value,before);
  await act(async()=>input.dispatchEvent({type:'compositionend',bubbles:true,data:'글'}));
  await act(async()=>input.dispatchEvent({type:'keydown',key:'Enter',keyCode:13,isComposing:false,bubbles:true,cancelable:true,preventDefault(){},stopPropagation(){}}));
  assert.equal(g.__posted.filter((m:any)=>m.type==='sendMessage').length,sentBefore+1,'control: settled composition can send');
  await send({type:'streamRefusal',streamId:'s1'}); assert.ok(!banner(),'late terminal event ignored');
  await send({type:'streamStart',streamId:'s2',messageId:'a2'});
  await send({type:'streamRefusal',streamId:'s2'}); assert.ok(banner());
  await send({type:'config',config:{...cfg,activity:{...cfg.activity,id:'next'}}}); assert.ok(!banner(),'scope switch clears');
  await send({type:'streamRefusal',streamId:'s2'}); assert.ok(!banner(),'old scope ignored');
  await send({type:'streamStart',streamId:'s3',messageId:'a3'});
  await send({type:'streamRefusal',streamId:'s3'}); assert.ok(banner());
  await send({type:'streamEnd',streamId:'s3'});
  await send({type:'streamStart',streamId:'s4',messageId:'a4'}); assert.ok(!banner(),'new turn clears');
  await act(async()=>root.unmount());
  console.log('refusal banner App, draft, scope, composition PASS');
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
