// CGP-CHAT-D-001 verify M10: after a scope (task) switch the announcer resyncs, so the next turn still
// announces its start once. Fails if ChatPanel drops the prev.current = streaming resync.
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

async function run() {
 const c=structuredClone(config);
 const host:any=mountPoint(); const root=createRoot(host);
 let props:any={...PROPS,config:c,streaming:false,instructor:false};
 const draw=()=>act(async()=>{root.render(<ChatPanel {...props}/>);});
 await draw();
 const region=host.findAll((e:any)=>e.getAttribute('data-testid')==='response-announcer')[0];
 props={...props,streaming:true,streamingId:'a1',messages:[{id:'a1',role:'assistant',content:'',createdAt:1}]}; await draw();
 assert.equal(region.textContent,'답변을 시작했어요');
 // switch scope and end stream in the same render
 props={...props,streaming:false,config:{...c,activity:{...c.activity,id:'zz'}}}; await draw(); await sleep();
 assert.equal(region.textContent,'');
 props={...props,streaming:true}; await draw();
 assert.equal(region.textContent,'답변을 시작했어요','new turn in new scope must announce start');
 console.log('PROBE PASS');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('PROBE FAIL',e.message);process.exit(1)});
