// CGP-CHAT-R-002 (REQ-STUDIO-CHAT-EDIT-RESEND) — where "수정" and the version pager render.
// Bundled with esbuild and run with plain Node, like text-size.test.tsx.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { EditPrompt, REVERT_NOTE, PAGER_TITLE } from "../webview-ui/src/EditResend";
import type { ChatConfig, ChatMessage } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

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


import { visibleAttempts } from '../src/answerAttempts';
import { AttemptPager } from '../webview-ui/src/AttemptPager';
const rows:ChatMessage[]=[{id:'u1',role:'user',content:'질문 하나',createdAt:1},{id:'a1',role:'assistant',content:'첫번째 내용',createdAt:2},{id:'u2',role:'user',content:'질문 하나',createdAt:3,retryOf:'u1'},{id:'a2',role:'assistant',content:'두번째 내용',createdAt:4}];
for (const config of [personal,classroom()]) {
 const render=(extra={})=>renderToStaticMarkup(<ChatPanel {...PROPS} config={config} messages={rows} instructor={false} onSelectAttempt={noop} {...extra}/>);
 t('one prompt, latest answer, pager, choice and honest tooltip',()=>{
  const html=render();
  ok(html.split('질문 하나').length===2,'duplicate prompt');
  ok(html.includes('두번째 내용')&&!html.includes('첫번째 내용'),'wrong answer');
  ok(html.includes('2/2')&&html.includes('이걸 쓸래요'),'pager/choice missing');
  ok(html.includes('다음 질문에는 지금 보고 있는 답변만 대화 기록으로 보내요. 답이 없는 시도라면 가장 최근 답변을 보내요.'),'tooltip missing');
  ok(html.includes('aria-label="보낸 메시지 수정"'),'editing after retry lost');
 });
 t('empty failed attempt retains navigation',()=>{
  const html=render({messages:rows.slice(0,3)});ok(html.includes('2/2'),'pager lost on failed attempt');
  ok(html.includes('disabled="" aria-pressed="false"'),'empty attempt can be chosen');
 });
 t('selected old answer and choice restore',()=>{
  const messages=rows.map(m=>m.id==='u1'?{...m,visibleAttemptId:'u1',chosenAttemptId:'u1'}:m);
  const html=render({messages});ok(html.includes('첫번째 내용')&&!html.includes('두번째 내용'),'selection not shown');
  ok(html.includes('aria-pressed="true"'),'choice not shown');
 });
 t('instructor hides selection; running disables choice',()=>{
  ok(!render({instructor:true}).includes('이걸 쓸래요'),'instructor choice');
  ok(render({sendPending:true}).includes('disabled="" aria-pressed="false"'),'pending choice');
 });
}
t('pager invokes only page callback with bounded index',()=>{
 let chosen=-1;const el=AttemptPager({index:1,count:2,onPage:i=>{chosen=i;}});
 const children=el.props.children; children[0].props.onClick();ok(chosen===0,'wrong previous');
 ok(children[2].props.disabled,'next end not disabled');
 const busy=AttemptPager({index:1,count:2,onPage:noop,disabled:true});ok(busy.props.children[0].props.disabled,'busy navigation');
});
if(fail)process.exit(1);
