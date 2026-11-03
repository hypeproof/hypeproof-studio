// CGP-KNOW-R-020 — the attachment failure rows in the real ChatPanel: Send is blocked while a failure
// exists, removing a row clears it and unblocks Send, the draft stays, the "limit" failure offers no
// retry, and in every seat the rows sit in the footer (never inside the shrinking message list).
// Mounted on fixtures/mini-dom.mjs and driven by real host messages and clicks.
import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= (globalThis as unknown as { window: { Element: unknown } }).window.Element;
const posted = (globalThis as unknown as { __posted: { type: string; id?: string }[] }).__posted;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
type El = { localName: string; textContent: string; value: string; parentNode: El | null; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(test: (e: El) => boolean): El[] };
const all = (test: (e: El) => boolean) => (doc as unknown as { documentElement: El }).documentElement.findAll(test);
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", data, bubbles: false }); });
const cls = (e: El) => e.getAttribute("class") ?? "";
const inside = (e: El, klass: string) => { for (let n: El | null = e; n && n.getAttribute; n = n.parentNode) if (cls(n).split(/\s+/).includes(klass)) return true; return false; };
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const WS = { scope: "s", revision: 1, activeTaskId: "a", tasks: [{ id: "a", title: "첫 작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const config = (seat: "personal" | "classroom") => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787", fileAttach: true,
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: seat, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "p1-" + seat, name: "내 작업", kind: seat, workspace: "/tmp/p", verified: true },
  ...(seat === "personal" ? { taskWorkspace: WS } : {}),
  activityDraft: { text: "이 글은 유지돼요", images: [], queued: null },
}) as unknown as ChatConfig;
const noop = () => {};
const props = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: () => { throw new Error("sent"); }, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const sendButton = () => all((e) => e.localName === "button" && (cls(e).includes("hps-btn-send")))[0];
const rows = () => all((e) => e.getAttribute("data-testid") === "attachment-failure");

(async () => {
for (const seat of ["personal", "classroom"] as const) {
  const label = (s: string) => `${seat}: ${s}`;
  try {
    const host = mountPoint();
    const root = createRoot(host as never);
    await act(async () => { root.render(<ChatPanel {...(props as never)} config={config(seat)} instructor={false} onAttachFile={noop} onRemoveFileAttachment={noop} />); });
    await hostSays({ type: "config", config: config(seat) });
    const ta = all((e) => e.localName === "textarea")[0];
    eq(ta.value, "이 글은 유지돼요", label("draft present"));
    ok(!sendButton().hasAttribute("disabled"), label("negative control: Send is enabled with a draft and no failure"));
    await hostSays({ type: "attachmentFailure", failure: { id: "f1", name: "메모.txt", reason: "파일을 읽을 권한이 없어요. 파일 접근 권한을 확인한 뒤 다시 시도해 주세요." } });
    await hostSays({ type: "attachmentFailure", failure: { id: "limit", name: "첨부 파일", reason: "파일이 너무 많아요. 수를 줄여 주세요.", final: true } });
    eq(rows().length, 2, label("two failure rows"));
    ok(sendButton().hasAttribute("disabled"), label("Send is blocked while a failure exists"));
    ok(rows().every((r) => !inside(r, "hps-messages") && inside(r, "hps-input-area")), label("rows sit in the footer, not in the message list"));
    eq(ta.value, "이 글은 유지돼요", label("draft kept while failing"));
    const labels = (r: El) => r.findAll((e) => e.localName === "button").map((b) => b.textContent);
    eq(labels(rows()[0]), ["이 파일만 다시 시도", "빼기"], label("a retryable row offers retry and remove"));
    eq(labels(rows()[1]), ["빼기"], label("the limit row offers no inert retry"));
    await act(async () => { click(all((e) => e.localName === "button" && e.getAttribute("aria-label") === "메모.txt 빼기")[0] as never); });
    eq(rows().length, 1, label("remove clears the row"));
    ok(posted.some((m) => m.type === "discardAttachmentFailure" && m.id === "f1"), label("remove tells the host"));
    ok(sendButton().hasAttribute("disabled"), label("still blocked by the remaining failure"));
    await act(async () => { click(all((e) => e.localName === "button" && e.getAttribute("aria-label") === "첨부 파일 빼기")[0] as never); });
    eq(rows().length, 0, label("last row removed"));
    ok(!sendButton().hasAttribute("disabled"), label("Send is enabled again"));
    eq(ta.value, "이 글은 유지돼요", label("draft kept after removal"));
    await act(async () => { root.unmount(); });
    console.log(`  ok   ${seat}`);
  } catch (e) { console.error(`  FAIL ${seat}: ${(e as Error).stack}`); fail++; }
}
})().then(() => {
if (fail) { console.error(`attachment-failure-ui: ${fail} failed`); process.exit(1); }
console.log("attachment-failure-ui OK");
process.exit(0);
});
