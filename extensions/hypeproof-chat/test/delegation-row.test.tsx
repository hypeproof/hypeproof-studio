import { readFileSync } from "node:fs";
import { staticTokens } from "./lib/expand-design-tokens.mjs";
// REQ-STUDIO-DELEGATION-ROW (CGP-AGENT-R-009) — the real ChatPanel draws a coach delegation as one
// collapsed row with its helper's tool calls inside, and "모두 멈추기" stops the turn through the same
// cancel path as the Stop button. Bundled with esbuild and run with plain Node; clicks go through
// fixtures/mini-dom.mjs (loaded first).

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { renderToStaticMarkup as renderRawMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { DelegationRow } from "../webview-ui/src/DelegationRow";
import { groupDelegations, delegationChildId, delegationHeader, delegationResultLabel, delegationRowId, DELEGATION_ICON, STOP_ALL_LABEL } from "../src/delegationRow";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const expandTokens = staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"));
const renderToStaticMarkup: typeof renderRawMarkup = (node) => expandTokens(renderRawMarkup(node));
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const count = (html: string, needle: string) => html.split(needle).length - 1;

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

const ROOT = "/tmp/p";
const HEADER = delegationHeader({ subagent_type: "코드리뷰어", description: "index.html 코드 리뷰" }, ROOT);
const tool = (id: string, label: string, state: "running" | "done" | "error", icon = "🔧"): ChatMessage => ({ id, role: "tool", content: "", createdAt: 3, tool: { icon, label, state } });
const turn = (rowState: "running" | "done" | "error"): ChatMessage[] => [
  { id: "u1", role: "user", content: "리뷰 부탁해", createdAt: 1 },
  { id: "a1", role: "assistant", content: "코드리뷰어에게 맡겨 볼게요.", createdAt: 2 },
  tool(delegationRowId("toolu_T", "s1"), rowState === "running" ? HEADER : delegationResultLabel(HEADER, rowState === "done" ? [{ type: "text", text: "잘한 점: 제목이 분명해요." }] : undefined, { isError: rowState === "error", reason: "subagent crashed", workspaceRoot: ROOT }), rowState, DELEGATION_ICON),
  tool(delegationChildId("toolu_T", "toolu_c1"), "Read(index.html)", "done"),
  tool(delegationChildId("toolu_T", "toolu_c2"), "Grep(button)", rowState === "running" ? "running" : "done"),
  tool("toolu_R", "Read(style.css)", "done"),
  tool(delegationChildId("toolu_gone", "toolu_c9"), "Read(orphan.md)", "done"),
];

for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
async function main(){
 for(const [mode,config] of [['personal',personal],['classroom',classroom]] as const){
  for(const status of ['running','done','error'] as const){
   const host:any=mountPoint(),root=createRoot(host);let stops=0,cancels=0;
   const props={...PROPS,config,instructor:false,messages:turn(status),streaming:status==='running',streamingId:status==='running'?'a1':null,runningStreamId:status==='running'?'s1':null,onCancel:()=>{cancels++},onStopDelegations:(id:string)=>{ok(id==='s1','wrong stream');stops++}};
   await act(async()=>root.render(<ChatPanel {...props}/>));
   const toggle=host.querySelector('.hps-delegation-toggle');
   ok(toggle.textContent===`도우미 1명 · ${status==='done'?1:0}명 끝남`,'summary counts');
   ok(!host.querySelector('.hps-delegation-panel'),'closed initially');
   await act(async()=>click(toggle));
   const panel=host.querySelector('.hps-delegation-panel');
   ok(panel && panel.open,'panel opens');ok(panel.textContent.includes('코드리뷰어')&&panel.textContent.includes('index.html 코드 리뷰'),'helper/task');
   ok(panel.textContent.includes('결과 보기'),'result control');
   ok(panel.textContent.includes(status==='running'?'진행 중':status==='done'?'끝남':'실패'),'real status');
   for(const word of ['FRAMING','JUDGMENT','ORCHESTRATE','VERIFY','ADAPT','OWNERSHIP','역량','점수','delegation_judgment'])ok(!host.textContent.includes(word)&&!toggle.textContent.includes(word),'group says '+word);
   ok(panel.textContent.includes('Read(index.html)')&&panel.textContent.includes('Grep(button)'),'children stay inside');
   ok(!panel.textContent.includes('Read(style.css)')&&!panel.textContent.includes('Read(orphan.md)'),'plain/orphan remain outside');
   ok(host.textContent.includes('Read(style.css)')&&host.textContent.includes('Read(orphan.md)'),'plain/orphan retained');
   if(status==='done')ok(panel.textContent.includes('잘한 점: 제목이 분명해요.'),'real result');
   const stop=panel.querySelector('.hps-delegation-stop');
   ok(!!stop===(status==='running'),'stop only live turn');
   if(stop){
    await act(async()=>click(stop));await act(async()=>click(stop));ok(stops===1&&cancels===0,'one helper stop, parent cancel not invoked');
    const pending=host.querySelector('.hps-delegation-stop');ok(pending.textContent==='멈추는 중…'&&pending.hasAttribute('disabled'),'pending is explicit: '+pending.textContent);
    await act(async()=>root.render(<ChatPanel {...props} delegationStops={{s1:'unconfirmed'}}/>));ok(host.textContent.includes('멈춤 확인 안 됨'),'timeout honest');
    await act(async()=>root.render(<ChatPanel {...props} delegationStops={{s1:'confirmed'}}/>));ok(host.textContent.includes('멈춤 확인'),'SDK confirmation');
   }
   await act(async()=>click(panel.querySelector('[data-delegation-close]')));ok(!host.querySelector('.hps-delegation-panel'),'close removes panel');
   await act(async()=>root.unmount());console.log('PASS',mode,status);
  }
  const host:any=mountPoint(),root=createRoot(host);
  const rows=[...turn('done'),tool(delegationRowId('second','s1'),'리서처 · <script>unsafe</script>','running',DELEGATION_ICON)];
  await act(async()=>root.render(<ChatPanel {...PROPS} config={config} instructor={false} messages={rows} streaming={true} streamingId="retry" runningStreamId="s2"/>));
  ok(host.querySelectorAll('.hps-delegation-toggle').length===1,'one roll-up for same stream');
  ok(host.querySelector('.hps-delegation-toggle').textContent==='도우미 2명 · 1명 끝남','mixed counts');
  await act(async()=>click(host.querySelector('.hps-delegation-toggle')));
  ok(host.querySelectorAll('.hps-delegation').length===2,'two expanded rows');
  ok(!host.querySelector('.hps-delegation-stop'),'old turn cannot stop retry');
  ok(host.textContent.includes('멈춤')&&!host.textContent.includes('진행 중'),'old rows read 멈춤, never 진행 중, during the retry');ok(!host.textContent.includes(STOP_ALL_LABEL),'모두 멈추기 offered for a row of another turn');
  ok(host.textContent.includes('멈춤'),'historical status retained');ok(!host.querySelector('script'),'hostile task escaped');
  await act(async()=>root.unmount());
 }
 // Plain tool line markup is unchanged (privacy): no group, no row around a non-Task tool.
 {
  const plain=[{id:'u1',role:'user',content:'x',createdAt:1} as ChatMessage,tool('toolu_R','Read(style.css)','done')];
  const html=renderToStaticMarkup(<ChatPanel {...PROPS} config={personal} instructor={false} messages={plain}/>);
  ok(/<div class="hps-tool-log-line hps-tool-done" role="status" aria-live="polite"><span class="hps-tool-icon" data-glyph="🔧"><svg [^>]*data-icon="tool"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg><\/span><span class="hps-tool-label">Read\(style\.css\)<\/span><span class="hps-tool-mark"><svg [^>]*data-icon="check"[^>]*role="img" aria-label="완료">(?:(?!<\/svg>)[\s\S])*<\/svg><\/span><\/div>/.test(html),'plain line markup changed');
  ok(!html.includes('hps-delegation'),'a plain line became a delegation group');
 }
 // 44px targets: the row summary inline, and the group controls by their rule (computed 44px is guarded in delegation-group-layout.smoke.mjs).
 {
  const view=[...groupDelegations(turn('running'),'s1').rows.values()][0];
  const html=renderToStaticMarkup(<DelegationRow view={view} renderChild={()=>null}/>);
  ok(/hps-delegation-summary[^>]*min-height:44px/.test(html),'row summary below 44px');
  const css=readFileSync('webview-ui/src/styles.css','utf8');
  const rule=css.split('\n').find(l=>l.startsWith('.hps-delegation-toggle, .hps-delegation-panel button {'))??'';
  ok(/min-height: var\(--ds-c-inline-hit-target\)/.test(rule)&&/min-width: var\(--ds-c-inline-hit-target\)/.test(rule),'group controls below the hit target');
  ok(/\.hps-delegation-toggle:hover/.test(css)&&/\.hps-delegation-panel button:hover/.test(css)&&/\.hps-delegation-toggle:active/.test(css)&&/\.hps-delegation-panel button:active/.test(css),'hover/pressed layers missing');
 }
 console.log('delegation-row OK');
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
