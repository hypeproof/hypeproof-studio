// CGP-CHAT-R-012 (REQ-STUDIO-STEER-NOW) — "지금 방향 바꾸기": while a turn streams and a message is
// parked, one action stops the turn through the existing Stop path and sends the parked text as the
// next turn, exactly once. Bundled with esbuild and run with plain Node. The pure decisions run
// first; then the real ChatPanel mounts on the minimal DOM (fixtures/mini-dom.mjs, loaded first):
// the test types into the composer, parks with Enter, clicks the real button and plays the host's
// side by re-rendering with the props App would pass (streaming, stopNotice, error).

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import {
  STEER_LABEL, STEER_STOPPING_LABEL, STEER_STOPPED_MARK, STEER_SENDING_MARK, STEER_OFFLINE_NOTE, STEER_STOP_FAILED_NOTE, STEER_STOP_TIMEOUT_MS,
  steerOffered, steerPress, steerAtEnd, steerMarkTarget, steerMarksAccept, steerMarksRefuse,
} from "../webview-ui/src/steerNow";
import { shouldFlushQueue, shouldRestoreQueue } from "../webview-ui/src/sendQueue";
import { finishNoticeKind } from "../src/finishNotice";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

// --- pure decisions ----------------------------------------------------------------------------

t("offered only while streaming with a live parked message", () => {
  eq(steerOffered({ streaming: true, queued: "다른 색으로 해 줘", queuedPaused: false }), true, "positive");
  eq(steerOffered({ streaming: false, queued: "다른 색으로 해 줘", queuedPaused: false }), false, "idle");
  eq(steerOffered({ streaming: true, queued: null, queuedPaused: false }), false, "no queued text");
  eq(steerOffered({ streaming: true, queued: "   ", queuedPaused: false }), false, "blank");
  eq(steerOffered({ streaming: true, queued: "x", queuedPaused: true }), false, "paused (kept) item");
  eq(steerOffered({ streaming: true, queued: "x", queuedPaused: false, sendLocked: true }), false, "product test holds the tab");
  eq(steerOffered({ streaming: true, queued: "x", queuedPaused: false, unavailable: true }), false, "panel unavailable");
});
t("press: stop online, hold offline, ignore a second press or when not offered", () => {
  eq(steerPress({ offered: true, online: true, pending: false }), "stop");
  eq(steerPress({ offered: true, online: false, pending: false }), "hold");
  eq(steerPress({ offered: true, online: true, pending: true }), "ignore");
  eq(steerPress({ offered: false, online: true, pending: false }), "ignore");
});
t("end edge with a steer: the learner's stop is not a cut-off, a failure still is", () => {
  const stopped = steerAtEnd(true, false, true, true, false)!;
  eq(stopped.cutOff, false); eq(stopped.stoppedHere, true);
  // Composed with the unchanged queue rules: send, do not restore.
  eq(shouldFlushQueue(true, false, "q", stopped.cutOff), true);
  eq(shouldRestoreQueue(true, false, "q", stopped.cutOff), false);
  // Negative control: without the steer, the same stopped end restores to the draft (today's Stop).
  eq(shouldFlushQueue(true, false, "q", true), false);
  eq(shouldRestoreQueue(true, false, "q", true), true);
  const natural = steerAtEnd(true, false, true, false, false)!;
  eq(natural.cutOff, false); eq(natural.stoppedHere, false, "a natural end is not marked stopped");
  const failed = steerAtEnd(true, false, true, false, true)!;
  eq(failed.cutOff, true, "a failed turn hands the text back"); eq(failed.stoppedHere, false);
  eq(steerAtEnd(true, true, true, true, false), null, "still streaming: not the edge");
  eq(steerAtEnd(false, false, true, true, false), null, "already idle: not the edge");
  eq(steerAtEnd(true, false, false, true, false), null, "no steer pending");
});
t("marker: drawn after the stopped turn's last item, never under the learner's own line; sent only on acceptance", () => {
  eq(steerMarkTarget([{ id: "u1", role: "user" }, { id: "a1", role: "assistant" }]), "a1");
  eq(steerMarkTarget([{ id: "u1", role: "user" }, { id: "t1", role: "tool" }]), "t1");
  eq(steerMarkTarget([{ id: "u1", role: "user" }]), undefined, "stopped before any answer");
  eq(steerMarkTarget([]), undefined);
  const items = [{ id: "u1", role: "user" }, { id: "a1", role: "assistant" }, { id: "u2", role: "user" }];
  const pending = [{ id: "a0", sent: true, from: 0 }, { id: "a1", sent: false, from: 2 }];
  eq(JSON.stringify(steerMarksAccept(pending, items, "u2").map((m) => m.sent)), "[true,true]", "its own request started");
  eq(steerMarksAccept(pending, items, null), pending, "an app reply (no request) never confirms it");
  eq(steerMarksAccept(pending, items, "u1"), pending, "another request's turn never confirms it");
  eq(steerMarksAccept(pending, items.slice(0, 2), "u2"), pending, "its request line not there yet");
  eq(JSON.stringify(steerMarksRefuse(pending)), JSON.stringify([{ id: "a0", sent: true, from: 0 }]), "a refusal drops only the unsent mark");
  const settled = [{ id: "a0", sent: true, from: 0 }];
  eq(steerMarksRefuse(settled), settled, "nothing pending: same array");
});
t("copy: Korean, no capability or score labels", () => {
  eq(STEER_LABEL, "지금 방향 바꾸기");
  for (const s of [STEER_LABEL, STEER_STOPPING_LABEL, STEER_STOPPED_MARK, STEER_SENDING_MARK, STEER_OFFLINE_NOTE, STEER_STOP_FAILED_NOTE]) {
    ok(/[가-힣]/.test(s), `not Korean: ${s}`);
    ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP|점수|역량/.test(s), `capability label in: ${s}`);
  }
});
t("finish notice (#2072): the steered turn ends aborted, which never notifies", () => {
  const seat = { activity_kind: "personal" };
  eq(finishNoticeKind({ status: "aborted", chatVisible: false, seat }), null, "stopped turn");
  eq(finishNoticeKind({ status: "ok", chatVisible: false, seat }), "done", "control: a finished turn notifies");
});
t("the steer stops through the existing Stop path (App.cancel → cancelStream → aborted)", () => {
  const app = readFileSync("webview-ui/src/App.tsx", "utf8");
  const host = readFileSync("src/chatPanelProvider.ts", "utf8");
  ok(/postToHost\(\{ type: "cancelStream", streamId: state\.streamId \}\)/.test(app), "App.cancel posts cancelStream");
  ok(/case "cancelStream":\s*this\.activeStreams\.get\(msg\.streamId\)\?\.abort\(\);/.test(host), "host aborts the stream");
  ok(/const finalSpoolStatus = ctrl\.signal\.aborted \? "aborted" : spoolStatus;\s*this\.finishNotifier\.turnEnded\(\{ status: finalSpoolStatus/.test(host), "finish notice reads the abort");
  const panel = readFileSync("webview-ui/src/ChatPanel.tsx", "utf8");
  ok(/steerPress\(/.test(panel) && /props\.onCancel\(\)/.test(panel.slice(panel.indexOf("steerPress("), panel.indexOf("steerPress(") + 900)), "the steer press calls the panel's onCancel");
  ok(!/postToHost\(\{\s*type:\s*["']sendMessage/.test(panel), "ChatPanel never posts a turn itself");
});

// --- the real panel on a minimal DOM -----------------------------------------------------------

const noop = () => {};
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
  ...classroom, profile: { ...(classroom as unknown as { profile: object }).profile, activity_kind: "personal" },
  activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const asst = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const RUNNING = [u("u1", "고양이 그려 줘"), asst("a1", "고양이를 파랗게 그리는 중")];

type El = {
  getAttribute(n: string): string | null; hasAttribute(n: string): boolean; textContent: string; value: string;
  localName: string; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean;
};
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(),
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() { (this as { _stopped?: boolean })._stopped = true; }, ...extra,
});

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, get: () => online });
  return act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: online ? "online" : "offline", bubbles: false }); });
}

const mounted: Root[] = [];
async function harness(config: ChatConfig, extra: Record<string, unknown> = {}) {
  const sent: string[] = [];
  let cancels = 0;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  let props: Record<string, unknown> = {
    messages: RUNNING, streaming: true, streamingId: "a1", error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: (text: string) => { sent.push(text); }, onRetry: noop, onRetryLast: noop, onDismissError: noop,
    onCancel: () => { cancels++; }, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    config, instructor: false, ...extra,
  };
  const draw = () => act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  await draw();
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];
  const buttons = (label: string) => host.findAll((e) => e.localName === "button" && (e.textContent.trim() === label || e.getAttribute("aria-label") === label));
  return {
    host, sent, get cancels() { return cancels; },
    set: async (next: Record<string, unknown>) => { props = { ...props, ...next }; await draw(); },
    park: async (text: string) => {
      const ta = textarea();
      await act(async () => { ta.value = text; ta.dispatchEvent(ev("input")); });
      await act(async () => { ta.dispatchEvent(ev("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: false, isComposing: false })); });
    },
    steer: () => buttons(STEER_LABEL),
    /** A message from the extension host, as vscode.ts receives it (a config first scopes it). */
    hostMsg: async (data: Record<string, unknown>) => act(async () => {
      const w = (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window;
      const cfg = config as unknown as { activity?: { id: string }; taskWorkspace?: { activeTaskId: string } };
      w.dispatchEvent({ type: "message", bubbles: false, data: { type: "config", config: { activity: cfg.activity, taskWorkspace: cfg.taskWorkspace } } });
      w.dispatchEvent({ type: "message", bubbles: false, data: { activityId: cfg.activity?.id, ...data } });
    }),
    press: async (el: El) => act(async () => { click(el); }),
    text: () => host.textContent,
    draft: () => textarea().value,
  };
}

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: no parked text → no action (negative control)`, async () => {
    const h = await harness(config);
    eq(h.steer().length, 0, "action drawn without a parked message");
  });

  t(`${mode}: parked text while streaming → one action; press stops, then the stop edge sends it exactly once`, async () => {
    const h = await harness(config);
    await h.park("아니, 강아지로 바꿔 줘");
    ok(h.text().includes("아니, 강아지로 바꿔 줘"), "the parked message is shown");
    const btn = h.steer();
    eq(btn.length, 1, "exactly one steer action");
    eq(btn[0].getAttribute("type"), "button", "a real button (keyboard reachable)");
    ok(!btn[0].hasAttribute("tabindex") || btn[0].getAttribute("tabindex") !== "-1", "not removed from the tab order");
    ok((btn[0].getAttribute("class") ?? "").includes("hps-queued-steer"), "44px class");
    await h.press(btn[0]);
    eq(h.cancels, 1, "the press goes through the Stop path");
    eq(h.sent.length, 0, "the press itself never sends");
    ok(h.text().includes(STEER_STOPPING_LABEL), "stopping state shown");
    await h.press(h.steer()[0] ?? btn[0]);
    eq(h.cancels, 1, "a second press is ignored");
    // Host: streamStopped → App clears streamId and sets the stop notice.
    await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    eq(h.sent.length, 1, "sent once on the stop edge");
    eq(h.sent[0], "아니, 강아지로 바꿔 줘");
    ok(h.text().includes("고양이를 파랗게 그리는 중"), "the partial answer stays visible");
    ok(h.text().includes(STEER_SENDING_MARK), "the partial answer is marked stopped, the new message as on its way");
    ok(!h.text().includes(STEER_STOPPED_MARK), "not \"보냈어요\" before the host started the turn");
    ok(!h.draft().includes("강아지"), "not also restored to the draft");
    // A re-render, and App's userSent clearing the notice, never send again.
    await h.set({ stopNotice: null, messages: [...RUNNING, u("u2", "아니, 강아지로 바꿔 줘")] });
    await h.set({ streaming: true, streamingId: "a2", streamFor: "u2" });
    eq(h.sent.length, 1, "no second send");
    ok(h.text().includes(STEER_STOPPED_MARK), "streamStart (the host accepted the turn): now \"보냈어요\"");
    ok(!h.text().includes(STEER_SENDING_MARK), "the sending line is replaced");
    // The steered turn ends naturally: the parked text was cleared when it went out, so nothing goes again.
    await h.set({ streaming: false, streamingId: null, messages: [...RUNNING, u("u2", "아니, 강아지로 바꿔 줘"), asst("a2", "강아지로 바꿀게요")] });
    eq(h.sent.length, 1, "the end of the steered turn does not send the text again");
    // The steer state was cleared at the end: a later turn can be steered again.
    await h.set({ streaming: true, streamingId: "a3", streamFor: "u3", messages: [...RUNNING, u("u2", "아니, 강아지로 바꿔 줘"), asst("a2", "강아지로 바꿀게요"), u("u3", "꼬리도"), asst("a3", "꼬리를")] });
    await h.park("귀도 크게");
    eq(h.steer().length, 1, "offered again on the next turn");
    await h.press(h.steer()[0]);
    eq(h.cancels, 2, "a second steer, in a later turn, goes through");
    await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    eq(h.sent.length, 2); eq(h.sent[1], "귀도 크게");
  });

  t(`${mode}: the host turns the steered send away → the marker does not claim it was sent`, async () => {
    const h = await harness(config);
    await h.park("다른 걸로 해 줘");
    await h.press(h.steer()[0]);
    await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    eq(h.sent.length, 1);
    ok(h.text().includes(STEER_SENDING_MARK), "on its way");
    await h.hostMsg({ type: "inputRejected", text: "다른 걸로 해 줘", toolMode: "auto" });
    ok(!h.text().includes(STEER_STOPPED_MARK) && !h.text().includes(STEER_SENDING_MARK), "no sent claim after a refusal");
    ok(h.draft().includes("다른 걸로 해 줘") || h.text().includes("다른 걸로 해 줘"), "the text is back (draft or kept)");
  });

  t(`${mode}: another turn starting (an app reply) does not confirm the steered send; a refusal then drops the marker`, async () => {
    const h = await harness(config);
    await h.park("노란색으로");
    await h.press(h.steer()[0]);
    await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    await h.set({ stopNotice: null, messages: [...RUNNING, u("u2", "노란색으로")] });
    // A publish finishing in the meantime posts its own reply: a streamStart for no learner request.
    await h.set({ streaming: true, streamingId: "app-1", streamFor: null });
    ok(h.text().includes(STEER_SENDING_MARK) && !h.text().includes(STEER_STOPPED_MARK), "an app reply does not flip it to 보냈어요");
    await h.set({ streaming: false, streamingId: null });
    await h.hostMsg({ type: "inputRejected", text: "노란색으로", toolMode: "auto" });
    ok(!h.text().includes(STEER_STOPPED_MARK) && !h.text().includes(STEER_SENDING_MARK), "the refused send leaves no sent claim");
  });

  t(`${mode}: an error before the steered turn starts also drops the marker`, async () => {
    const h = await harness(config);
    await h.park("다시 정리해 줘");
    await h.press(h.steer()[0]);
    await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    await h.set({ stopNotice: null, error: "다른 창에서 이 폴더를 사용 중입니다. 작업이 끝난 뒤 다시 보내 주세요." });
    ok(!h.text().includes(STEER_STOPPED_MARK) && !h.text().includes(STEER_SENDING_MARK), "no marker after the error");
  });

  t(`${mode}: stopped before any answer → no marker under the learner's own line`, async () => {
    const h = await harness(config, { messages: [u("u1", "고양이 그려 줘")], streamingId: null });
    await h.park("강아지로");
    await h.press(h.steer()[0]);
    await h.set({ streaming: false, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    eq(h.sent.length, 1, "still sent");
    ok(!h.text().includes(STEER_SENDING_MARK) && !h.text().includes(STEER_STOPPED_MARK), "no marker");
  });

  t(`${mode}: a natural end racing the press sends once; the late stop that follows sends nothing`, async () => {
    const h = await harness(config);
    await h.park("파란색은 빼 줘");
    await h.press(h.steer()[0]);
    // streamEnd arrived before the host saw cancelStream: a normal end, no stop notice.
    await h.set({ streaming: false, streamingId: null });
    eq(h.sent.length, 1, "sent once on the natural end");
    eq(h.sent[0], "파란색은 빼 줘");
    ok(!h.text().includes(STEER_STOPPED_MARK), "a natural end is not marked stopped");
    // Then the host answers the cancel with streamStopped for the finished stream.
    await h.set({ stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    await h.set({ stopNotice: null });
    eq(h.sent.length, 1, "never twice");
  });

  t(`${mode}: offline at the press → no stop, nothing sent, the parked text is kept`, async () => {
    const h = await harness(config);
    await h.park("코드를 설명해 줘");
    await setOnline(false);
    try {
      await h.set({});
      await h.press(h.steer()[0]);
      eq(h.cancels, 0, "the running answer is not stopped");
      eq(h.sent.length, 0, "nothing sent");
      ok(h.text().includes(STEER_OFFLINE_NOTE), "the held note says where the words are");
      ok(h.text().includes("코드를 설명해 줘"), "parked text kept");
    } finally { await setOnline(true); }
  });

  t(`${mode}: offline after the stop → the edge sends nothing and keeps the text`, async () => {
    const h = await harness(config);
    await h.park("글씨를 키워 줘");
    await h.press(h.steer()[0]);
    await setOnline(false);
    try {
      await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
      eq(h.sent.length, 0, "nothing sent offline");
      ok(h.text().includes("글씨를 키워 줘"), "the parked text is kept (as a kept message)");
    } finally { await setOnline(true); }
  });

  t(`${mode}: control — Stop (not steer) still hands the parked text back to the draft and sends nothing`, async () => {
    const h = await harness(config);
    await h.park("멈추고 생각할래");
    const stop = h.host.findAll((e) => e.localName === "button" && (e.getAttribute("class") ?? "").includes("hps-btn-stop"))[0];
    await h.press(stop);
    await h.set({ streaming: false, streamingId: null, stopNotice: "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." });
    eq(h.sent.length, 0, "plain Stop never sends");
    ok(h.draft().includes("멈추고 생각할래"), "back in the draft");
  });

  t(`${mode}: a failed turn after the press hands the text back instead of sending`, async () => {
    const h = await harness(config);
    await h.park("다시 해 줘");
    await h.press(h.steer()[0]);
    await h.set({ streaming: false, streamingId: null, error: "연결이 끊겼어요" });
    eq(h.sent.length, 0, "not sent into a failure");
    ok(h.draft().includes("다시 해 줘") || h.text().includes("다시 해 줘"), "text kept");
  });
}

t("stop that never lands: after the timeout the steer gives up, the text stays parked and goes on the natural end", async () => {
  const h = await harness(personal);
  await h.park("천천히 해도 돼");
  // Fire only the steer's own timer early: any other timer keeps its delay.
  const realSetTimeout = globalThis.setTimeout;
  (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
    realSetTimeout(fn, ms === STEER_STOP_TIMEOUT_MS ? 0 : ms, ...rest)) as typeof setTimeout;
  try {
    await h.press(h.steer()[0]);
    await act(async () => { await new Promise((r) => realSetTimeout(r, 20)); });
  } finally { globalThis.setTimeout = realSetTimeout; }
  ok(h.text().includes(STEER_STOP_FAILED_NOTE), "the learner is told the stop did not land");
  eq(h.steer().length, 1, "the action is offered again");
  ok(h.text().includes("천천히 해도 돼"), "the parked text is still there");
  eq(h.sent.length, 0);
  await h.set({ streaming: false, streamingId: null });
  eq(h.sent.length, 1, "it goes on the natural end, once");
});

t("44px target in styles", () => {
  const css = readFileSync("webview-ui/src/styles.css", "utf8");
  const rule = /\.hps-queued-steer\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height:\s*44px/.test(rule) && /min-width:\s*44px/.test(rule), "44px min target");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} steer-now check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} steer-now checks passed`);
  // Timers that belong to unmounted panels (other features' polls) must not hold the process.
  process.exit(0);
})();
