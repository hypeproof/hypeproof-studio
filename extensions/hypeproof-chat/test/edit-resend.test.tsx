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

const u = (id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "user", content, createdAt: 1, ...extra });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const plain = [u("u1", "첫 질문"), a("a1", "첫 답"), u("u2", "고양이 그려 줘"), a("a2", "고양이 답")];
const edited = [...plain, u("u2b", "강아지 그려 줘", { editOf: "u2" }), a("a2b", "강아지 답")];

const EDIT = 'aria-label="보낸 메시지 수정"';
const count = (html: string, needle: string) => html.split(needle).length - 1;
const render = (config: ChatConfig, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} {...extra} />);

for (const [mode, config] of [["personal", personal], ["classroom", classroom()]] as const) {
  t(`${mode}: exactly one 수정, on the latest user line (positive control)`, () => {
    const html = render(config, { messages: plain });
    ok(count(html, EDIT) === 1, `count ${count(html, EDIT)}`);
    const at = html.indexOf(EDIT);
    ok(at > html.indexOf("고양이 그려 줘") && at < html.indexOf("고양이 답"), "not under the latest prompt");
    ok(at > html.indexOf("첫 답"), "on the first prompt");
  });
  t(`${mode}: hidden while streaming, pending, queued, parked, recovered, in instructor mode, or without the handler (negative controls)`, () => {
    ok(count(render(config, { messages: plain, streaming: true, streamingId: "a2" }), EDIT) === 0, "streaming");
    ok(count(render(config, { messages: plain, sendPending: true }), EDIT) === 0, "sendPending");
    ok(count(render(config, { messages: plain, sendLocked: true }), EDIT) === 0, "sendLocked");
    // A same-mode queue is folded back into the composer on mount (draftAfterStop); one with its own
    // tool mode survives the mount as a parked row. A live "다음에 보낼 메시지" only exists while a
    // turn streams, which the streaming case above already covers.
    const queued = { ...config, activityDraft: { text: "", images: [], queued: "다음 질문", toolMode: "auto", queuedToolMode: "web-search" } } as ChatConfig;
    ok(render(queued, { messages: plain }).includes("보관한 메시지 · 웹 검색"), "control: the queue row did not render");
    ok(count(render(queued, { messages: plain }), EDIT) === 0, "queued");
    const parked = { ...config, activityDraft: { text: "", images: [], queued: "다음 질문", queuedPaused: true } } as ChatConfig;
    ok(count(render(parked, { messages: plain }), EDIT) === 0, "parked");
    const recovered = { ...config, activityDraft: { text: "", images: [], queued: null, recovered: [{ text: "못 보낸 질문", toolMode: "auto", images: [] }] } } as ChatConfig;
    ok(count(render(recovered, { messages: plain }), EDIT) === 0, "recovered");
    ok(count(renderToStaticMarkup(<ChatPanel {...PROPS} config={config} messages={plain} instructor={true} />), EDIT) === 0, "instructor");
    ok(count(render(config, { messages: plain, onEditResend: undefined }), EDIT) === 0, "no handler");
  });
  t(`${mode}: an edited prompt draws only its latest version with the pager 2/2`, () => {
    const html = render(config, { messages: edited });
    ok(html.includes("강아지 그려 줘") && html.includes("강아지 답"), "latest version missing");
    ok(!html.includes("고양이 그려 줘") && !html.includes("고양이 답"), "version 1 drawn at the same time");
    ok(html.includes('aria-label="메시지 버전"') && html.includes('aria-live="polite">2/2</span>'), "pager missing");
    ok(html.includes(`title="${PAGER_TITLE}"`), "pager title missing");
    ok(count(html, EDIT) === 1, "수정 missing on the latest version");
  });
}
t("a prompt that was never edited has no pager (negative control)", () => ok(!render(personal, { messages: plain }).includes('aria-label="메시지 버전"'), "pager on a single version"));

t("editor: original text, Cancel and 다시 보내기, kept images removable", () => {
  const html = renderToStaticMarkup(<EditPrompt text="고양이 그려 줘" images={["data:image/png;base64,AAAA"]} revertNote={false} onCancel={noop} onSave={noop} />);
  ok(html.includes(">고양이 그려 줘</textarea>"), "original text not loaded");
  ok(html.includes(">취소</button>") && html.includes(">다시 보내기</button>"), "actions");
  ok(html.includes('aria-label="첨부 이미지 1 빼기"'), "image remove");
  ok(!html.includes(REVERT_NOTE), "revert note without a restore bar");
});
t("editor: the file note shows only when the turn-restore bar is there", () => {
  ok(renderToStaticMarkup(<EditPrompt text="x" images={[]} revertNote={true} onCancel={noop} onSave={noop} />).includes(REVERT_NOTE), "note missing");
});

if (fail) { console.error(`edit-resend: ${fail} failed`); process.exit(1); }
console.log("edit-resend render OK");
