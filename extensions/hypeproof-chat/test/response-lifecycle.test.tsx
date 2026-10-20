import { document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import assert from "node:assert/strict";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { COMPLETION_SETTLE_MS } from "../webview-ui/src/responseAnnouncer";
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

const sleep = () => act(async () => { await new Promise(r => setTimeout(r, COMPLETION_SETTLE_MS + 30)); });
async function run(personal: boolean) {
 const c=structuredClone(config);
 if(personal) { c.activity!.kind='personal'; c.profile!.activity_kind='personal'; c.taskWorkspace={scope:'s',revision:1,activeTaskId:'t1',tasks:[{id:'t1',title:'작업',createdAt:1,updatedAt:1,messageCount:0}],sourceSelection:null}; }
 const host:any=mountPoint(); const root=createRoot(host);
 let props:any={...PROPS,config:c,streaming:false,instructor:false};
 const draw=()=>act(async()=>{root.render(<ChatPanel {...props}/>);});
 await draw();
 const nodes=host.findAll((e:any)=>e.getAttribute('data-testid')==='response-announcer');
 assert.equal(nodes.length,1); const region=nodes[0];
 const scroll=host.findAll((e:any)=>e.getAttribute('class')==='hps-messages')[0];
 assert.ok(!scroll.contains(region),'announcer must be outside scrolling transcript');
 assert.equal(region.getAttribute('class'),'hps-sr-only'); assert.equal(region.getAttribute('role'),'status'); assert.equal(region.getAttribute('aria-live'),'polite');
 assert.equal(region.textContent,'');
 const spoken:string[]=[];
 // Observe actual DOM text writes after the action, not a pre-action snapshot.
 const nodeProto=(window as any).Node.prototype;
 const textProto=Object.getPrototypeOf(doc.createTextNode(''));
 const originals:any[]=[];
 for(const [proto,key] of [[nodeProto,'textContent'],[textProto,'nodeValue']] as const) {
  const desc=Object.getOwnPropertyDescriptor(proto,key)!; originals.push([proto,key,desc]);
  Object.defineProperty(proto,key,{...desc,set(value:any) { const tracked=this===region||region.contains(this); desc.set!.call(this,value); if(tracked&&region.textContent) spoken.push(region.textContent); }});
 }
 try {
  props={...props,streaming:true,streamingId:'a1',messages:[{id:'a1',role:'assistant',content:'',createdAt:1}]}; await draw();
  assert.deepEqual(spoken,['답변을 시작했어요']);
  if(personal) assert.ok(host.findAll((e:any)=>e.getAttribute('class')==='hps-response-pending').length>0,'personal response pending must actually mount');
  for(const content of ['', '글', '글\n```html\n<div>', '글\n```html\n<div></div>\n```', '끝']) {
   props={...props,messages:[{...props.messages[0],content}]}; await draw();
   assert.equal(host.findAll((e:any)=>e.getAttribute('data-testid')==='response-announcer')[0],region);
   for(const pending of host.findAll((e:any)=>e.getAttribute('class')==='hps-response-pending')) {
    assert.equal(pending.getAttribute('role'),null); assert.equal(pending.getAttribute('aria-live'),null);
   }
  }
  assert.deepEqual(spoken,['답변을 시작했어요'],'stream chunks must not repeat lifecycle announcements');
  props={...props,streaming:false}; await draw(); await sleep();
  assert.deepEqual(spoken,['답변을 시작했어요','답변이 끝났어요']);
  await draw(); await sleep(); assert.equal(spoken.length,2);
  props={...props,streaming:true}; await draw();
  props={...props,streaming:false}; await draw();
  await act(async()=>{await new Promise(r=>setTimeout(r,30));});
  props={...props,stopNotice:'답변을 멈췄어요'}; await draw(); await sleep();
  assert.deepEqual(spoken.slice(2),['답변을 시작했어요','답변을 멈췄어요']);
  const visibleStop=host.findAll((e:any)=>e.getAttribute('class')==='hps-stop-notice')[0];
  assert.equal(visibleStop.getAttribute('role'),null); assert.equal(visibleStop.getAttribute('aria-live'),null);
  props={...props,streaming:true,stopNotice:null}; await draw();
  props={...props,streaming:false,error:'연결을 확인해 주세요'}; await draw(); await sleep();
  assert.equal(spoken.at(-1),'답변을 시작했어요','error banner owns failure; no false completion');
  props={...props,streaming:true,error:null}; await draw();
  const before=spoken.length;
  props={...props,streaming:false,config:{...c,activity:{...c.activity,id:'other-activity'}}}; await draw(); await sleep();
  assert.equal(spoken.length,before,'switching activities must not announce an old completion');
  props={...props,streaming:true}; await draw();
  const beforeTask=spoken.length;
  props={...props,streaming:false,config:{...props.config,taskWorkspace:{scope:'s',revision:1,activeTaskId:'other-task',tasks:[],sourceSelection:null}}}; await draw(); await sleep();
  assert.equal(spoken.length,beforeTask,'switching tasks must cancel completion');
  props={...props,streaming:true}; await draw();
  props={...props,streaming:false}; await draw();
  const pendingCount=spoken.length;
  props={...props,config:{...props.config,activity:{...props.config.activity,id:'third-activity'}}}; await draw(); await sleep();
  assert.equal(spoken.length,pendingCount,'same-state scope switch cancels a pending completion');
  props={...props,streaming:true}; await draw();
  props={...props,streaming:false}; await draw();
  props={...props,streaming:true}; await draw();
  const restartingCount=spoken.length; await sleep();
  assert.equal(spoken.length,restartingCount,'a new turn cancels the prior completion timer');
  console.log('PASS actual lifecycle DOM writes, placement and scope: '+(personal?'personal':'classroom'));
 } finally { for(const [proto,key,desc] of originals) Object.defineProperty(proto,key,desc); await act(async()=>root.unmount()); host.remove(); }
}
(async()=>{await run(false);await run(true);})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
