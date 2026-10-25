// CGP-AGENT-R-027 / REQ-CGP-AGENT-53 / DES-CGP-AGENT-53 — the webview half of "저장 지점 남기기" on mini-dom:
// the real TurnReviewBar opens a form whose textarea holds the suggested message, has focus and the whole
// text selected; Enter (and IME composition) never saves, Cmd/Ctrl+Enter does; there is no push, publish or
// upload control; saved checkpoints are listed in the 바뀐 것 panel. The real ChatPanel posts `checkpointSave`
// with the reviewed text. The host half is test/checkpoint.smoke.mjs.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { TurnReviewBar } from "../webview-ui/src/TurnReviewBar";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { TurnReviewView, CheckpointView } from "../src/turnReviewView";
import type { ChatConfig } from "../src/protocol";

for (const name of ["Node", "Element"]) (globalThis as Record<string, unknown>)[name] ??= (globalThis.window as unknown as Record<string, unknown>)[name];
(globalThis as Record<string, unknown>).HTMLElement ??= (globalThis.window as unknown as Record<string, unknown>).Element;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => Promise<void>][] = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = { localName: string; textContent: string; value: string; selectionStart: number; selectionEnd: number; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: object): boolean; focus(): void };
const fireKey = async (target: El, k: string, extra: object = {}) => {
  const ev: Record<string, unknown> = { type: "keydown", key: k, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), isComposing: false, keyCode: k === "Enter" ? 13 : 0, shiftKey: false, metaKey: false, ctrlKey: false, ...extra,
    preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { ev._stopped = true; } };
  await act(async () => { target.dispatchEvent(ev); });
  return ev;
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 8)); });
const cls = (e: El) => (e.getAttribute("class") ?? "").split(/\s+/);
const byClass = (root: El, c: string) => root.findAll((e) => cls(e).includes(c));
const buttons = (root: El) => root.findAll((e) => e.localName === "button");
const button = (root: El, text: string) => buttons(root).find((b) => b.textContent === text);
const type = async (field: El, value: string) => act(async () => { field.value = value; field.dispatchEvent({ type: "input", bubbles: true }); });

const CP: CheckpointView = {
  suggestion: "예약 버튼을 메인에 추가했어요.",
  source: "ai",
  history: [{ id: "cp-2", message: "첫 화면 정리", createdAt: new Date(2026, 9, 25, 14, 3).getTime(), fileCount: 4 }],
};
const VIEW: TurnReviewView = { turnId: "t1", state: "open", added: [], changed: ["index.html"], deleted: [], notCovered: [], checkpoint: CP };

async function mountBar(view: TurnReviewView) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  const saved: string[] = [];
  const render = (v: TurnReviewView) => act(async () => { root.render(<TurnReviewBar view={v} onRevert={() => {}} onKeep={() => {}} onClose={() => {}} onCheckpointSave={(m) => saved.push(m)} />); });
  await render(view);
  const field = () => host.findAll((e) => e.localName === "textarea")[0];
  return { host, saved, render, field };
}

t("no checkpoint view: no section at all (minor, other tiers, instructor)", async () => {
  const v = await mountBar({ ...VIEW, checkpoint: undefined });
  ok(!byClass(v.host, "hps-checkpoint").length, "section drawn without a checkpoint view");
  ok(!button(v.host, "저장 지점 남기기"), "save offered without a checkpoint view");
});

t("opening the form: textarea prefilled with the suggestion, focused, whole text selected; source named", async () => {
  const v = await mountBar(VIEW);
  ok(!v.field(), "form is closed until asked for");
  await act(async () => { click(button(v.host, "저장 지점 남기기")!); });
  await settle();
  const field = v.field();
  ok(field, "textarea missing");
  eq(field.value, CP.suggestion, "prefilled");
  ok(doc.activeElement === field, "textarea does not have focus");
  eq([field.selectionStart, field.selectionEnd], [0, CP.suggestion.length], "whole suggestion selected");
  ok(v.host.textContent.includes("AI가 이번 답의 첫 줄로 메시지를 제안했어요"), "AI source not named");
  ok(v.host.textContent.includes("웹에는 올리지 않아요"), "local-only line missing");
  const labels = buttons(v.host).map((b) => b.textContent).join("|");
  ok(!/올리기|푸시|push|게시|커밋|commit|보내기/i.test(labels), `a push-like control exists: ${labels}`);
});

t("Enter is a newline, IME composition never saves, Cmd/Ctrl+Enter saves the edited text", async () => {
  const v = await mountBar(VIEW);
  await act(async () => { click(button(v.host, "저장 지점 남기기")!); });
  await settle();
  await type(v.field(), "메인에 예약 버튼 추가\n직접 고침");
  const plain = await fireKey(v.field(), "Enter");
  ok(!plain.defaultPrevented, "Enter was swallowed");
  await fireKey(v.field(), "Enter", { metaKey: true, isComposing: true });
  await fireKey(v.field(), "Enter", { ctrlKey: true, keyCode: 229 });
  eq(v.saved, [], "saved during composition or on plain Enter");
  const cmd = await fireKey(v.field(), "Enter", { metaKey: true });
  ok(cmd.defaultPrevented, "Cmd+Enter not handled");
  eq(v.saved, ["메인에 예약 버튼 추가\n직접 고침"], "Cmd+Enter did not save the edited text");
  await fireKey(v.field(), "Enter", { ctrlKey: true });
  eq(v.saved.length, 2, "Ctrl+Enter did not save");
});

t("empty text cannot be saved; the primary button saves; saving disables it", async () => {
  const v = await mountBar(VIEW);
  await act(async () => { click(button(v.host, "저장 지점 남기기")!); });
  await settle();
  await type(v.field(), "   ");
  const primary = () => byClass(v.host, "hps-checkpoint-save")[0];
  ok(primary().hasAttribute("disabled"), "empty message can be saved");
  await fireKey(v.field(), "Enter", { metaKey: true });
  eq(v.saved, [], "empty saved by shortcut");
  await type(v.field(), "정리");
  await act(async () => { click(primary()); });
  eq(v.saved, ["정리"], "primary button did not save");
  await v.render({ ...VIEW, checkpoint: { ...CP, saving: true } });
  ok(primary().hasAttribute("disabled"), "save enabled while saving");
  ok(v.field().hasAttribute("readonly") && !v.field().hasAttribute("disabled"), "saving must keep the field focusable (readOnly, not disabled)");
  eq(primary().textContent, "남기는 중…", "saving label");
});

t("a saved checkpoint closes the form and appears in the 바뀐 것 history, newest first, as text", async () => {
  const v = await mountBar(VIEW);
  await act(async () => { click(button(v.host, "저장 지점 남기기")!); });
  await settle();
  const evil = "<img src=x>" + String.fromCharCode(0x202e) + "끝";
  await v.render({ ...VIEW, checkpoint: { ...CP, savedId: "cp-3", notice: "저장 지점을 남겼어요.", history: [{ id: "cp-3", message: evil, createdAt: 2, fileCount: 2 }, ...CP.history] } });
  await settle();
  ok(!v.field(), "form stayed open after the save");
  const list = v.host.findAll((e) => e.localName === "ol" && e.getAttribute("aria-label") === "저장 지점 기록")[0];
  ok(list, "history list missing");
  const items = list.findAll((e) => e.localName === "li");
  eq(items.map((i) => i.getAttribute("data-checkpoint-id")), ["cp-3", "cp-2"], "order");
  ok(items[0].textContent.startsWith("<img src=x>\\u202e끝"), `message not shown as escaped text: ${items[0].textContent}`);
  ok(!v.host.findAll((e) => e.localName === "img").length, "message rendered as markup");
  ok(items[1].textContent.includes("10월 25일 14:03 · 파일 4개"), `time/count line: ${items[1].textContent}`);
  ok(v.host.textContent.includes("저장 지점을 남겼어요."), "notice missing");
});

t("busy review (restoring) disables opening the form", async () => {
  const v = await mountBar({ ...VIEW, state: "restoring" });
  ok(button(v.host, "저장 지점 남기기")!.hasAttribute("disabled"), "checkpoint offered while restoring");
});

t("real ChatPanel posts checkpointSave with the turn id and the reviewed text", async () => {
  const posted = (globalThis as unknown as { __posted: Record<string, unknown>[] }).__posted;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  const UX = { coach: { naming_mode: "fixed", fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } }, retry_button: { enabled: false, show_counter: false } };
  const config = { model: "m", hasToken: true, proxyUrl: "http://localhost:8787", coach: { name: "HypeProof", personality: "", configured: true },
    profile: { profile_id: "p", activity_kind: "personal", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
    activity: { id: "a1", name: "작업", kind: "personal", workspace: "/tmp/w", verified: true } } as unknown as ChatConfig;
  const noop = () => {};
  const props = { messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false, pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop, onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop, onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onEditResend: () => true, config, instructor: false };
  await act(async () => { root.render(<ChatPanel {...(props as unknown as React.ComponentProps<typeof ChatPanel>)} />); });
  await act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", bubbles: false, data: { type: "turnReviewState", view: VIEW } }); });
  await settle();
  await act(async () => { click(button(host, "저장 지점 남기기")!); });
  await settle();
  const field = host.findAll((e) => e.localName === "textarea" && e.getAttribute("id") === "hps-checkpoint-message")[0];
  ok(field, "checkpoint field not drawn in ChatPanel");
  await type(field, "고친 메시지");
  await act(async () => { click(byClass(host, "hps-checkpoint-save")[0]); });
  const sent = posted.filter((m) => m.type === "checkpointSave");
  eq(sent, [{ type: "checkpointSave", turnId: "t1", message: "고친 메시지" }], "posted message");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  if (fail) { console.error(`${fail} failed`); process.exit(1); }
  console.log("checkpoint: all passed");
  process.exit(0);
})();
