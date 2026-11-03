// DES-CGP-LEARN-13 — the webview side of a safety block. The real ChatPanel on the minimal DOM
// (fixtures/mini-dom.mjs) draws the host's safetyNotice instead of the red error card: a polite
// status (never an alert), no retry, no link, the two help-line numbers as plain text when the host
// sent them, and 닫기 hands focus back to the composer. Classroom and personal seats.
// The host side is test/safety-notice.smoke.mjs; the CSS is test/safety-notice-css.smoke.mjs.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { App } from "../webview-ui/src/App";
import type { ChatConfig } from "../src/protocol";
import { safetyNoticeView, type SafetyNoticeView } from "../src/safetyNotice";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

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
} as unknown as ChatConfig;

const SENTENCE = "앗, 이 이야기는 우리 워크숍에서 함께 다룰 수 없는 내용이에요.";
const withHelp = safetyNoticeView({ message: SENTENCE, category: "self_harm" }, { helpLines: true, audience: "classroom" });
const withHelpSolo = safetyNoticeView({ message: SENTENCE, category: "self_harm" }, { helpLines: true, audience: "solo" });
const plain = safetyNoticeView({ message: SENTENCE, category: "self_harm" }, { helpLines: false, audience: "classroom" });

type El = { getAttribute(n: string): string | null; textContent: string; localName: string; findAll(test: (e: El) => boolean): El[] };
{
  const proto = Object.getPrototypeOf(mountPoint());
  if (!("options" in proto)) Object.defineProperty(proto, "options", { get(this: El) { return this.findAll((e) => e.localName === "option"); } });
}
const mounted: Root[] = [];
async function harness(safetyNotice: SafetyNoticeView | null, config: ChatConfig = classroom) {
  const calls = { dismiss: 0, retry: 0 };
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  let error: string | null = SENTENCE;
  const render = async () => {
    const props: Record<string, unknown> = {
      messages: [], streaming: false, streamingId: null, error, errorRequestId: "rid-1", errorRunbookUrl: null, canRetryLast: true,
      pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
      onSend: noop, onRetry: noop, onRetryLast: () => { calls.retry++; }, onCancel: noop, onClear: noop,
      onDismissError: () => { calls.dismiss++; error = null; void render(); },
      onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
      onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
      safetyNotice: error ? safetyNotice : null, config, instructor: false,
    };
    await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  };
  await render();
  const byClass = (c: string) => host.findAll((e) => (e.getAttribute("class") ?? "").split(/\s+/).includes(c));
  return {
    calls, host, byClass,
    notice: () => byClass("hps-safety-notice")[0],
    banner: () => byClass("hps-error-banner")[0],
    buttons: (root: El) => root.findAll((e) => e.localName === "button").map((b) => b.textContent.trim()),
    press: async (el: El) => act(async () => { click(el); }),
  };
}

for (const [seat, config] of [["classroom", classroom], ["personal", personal]] as const) {
  t(`${seat}: the safety notice replaces the red card — polite status, no alert, no retry`, async () => {
    const h = await harness(withHelp, config);
    const n = h.notice();
    ok(n, "notice drawn");
    eq(n.getAttribute("role"), "status", "role");
    eq(n.getAttribute("aria-live"), "polite", "aria-live");
    eq(h.banner(), undefined, "no red error card");
    eq(h.host.findAll((e) => e.getAttribute("role") === "alert").length, 0, "no alert anywhere");
    eq(JSON.stringify(h.buttons(n)), JSON.stringify(["닫기"]), "only 닫기");
    ok(!h.host.textContent.includes("다시 보내기"), "no retry");
    ok(!n.textContent.includes("rid-1"), "no request id in the notice");
    ok(n.textContent.includes("잠깐 멈췄어요") && n.textContent.includes(SENTENCE), "title + Service sentence");
  });
}

t("help lines: 109 and 1388 as plain text with their labels, no link, the teacher line", async () => {
  const h = await harness(withHelp);
  const n = h.notice();
  const numbers = n.findAll((e) => (e.getAttribute("class") ?? "") === "hps-safety-number").map((e) => e.textContent);
  eq(JSON.stringify(numbers), JSON.stringify(["109", "1388"]), "numbers");
  ok(n.textContent.includes("자살예방상담전화 109") && n.textContent.includes("청소년상담 1388"), "labels beside numbers");
  ok(n.textContent.includes("선생님께 바로 이야기해도 괜찮아요."), "teacher line");
  eq(n.findAll((e) => e.localName === "a" || e.getAttribute("href") !== null).length, 0, "no link (no tel:, nothing leaves the safe session)");
  eq(n.findAll((e) => e.localName === "audio" || e.localName === "video").length, 0, "no sound element");
});

t("solo seat names a nearby adult instead of a teacher", async () => {
  const h = await harness(withHelpSolo, personal);
  ok(h.notice().textContent.includes("가까운 어른께 바로 이야기해도 괜찮아요."), "adult line");
  ok(!h.notice().textContent.includes("선생님께"), "no teacher on a solo seat");
});

t("help lines off: the calm notice without numbers", async () => {
  const h = await harness(plain);
  ok(h.notice(), "notice drawn");
  ok(!h.notice().textContent.includes("109") && !h.notice().textContent.includes("1388"), "no numbers");
  eq(h.byClass("hps-safety-help").length, 0, "no help block");
});

t("닫기 closes the notice and never retries", async () => {
  const h = await harness(withHelp);
  const close = h.notice().findAll((e) => e.localName === "button")[0];
  await h.press(close);
  eq(h.calls.dismiss, 1, "dismissed");
  eq(h.calls.retry, 0, "not retried");
  eq(h.notice(), undefined, "notice gone");
});

t("negative control: the same error without a safetyNotice is the red card", async () => {
  const h = await harness(null);
  eq(h.notice(), undefined, "no safety notice");
  ok(h.banner(), "error banner drawn");
  eq(h.banner().getAttribute("role"), "alert", "the card is an alert");
});

t("the safety notice wins over an access status on the same seat", async () => {
  const h = await harness(withHelp, { ...classroom, activityUnavailable: { cause: "paused", audience: "classroom" } } as unknown as ChatConfig);
  ok(h.notice(), "safety notice drawn");
});

t("App: the host's streamError carries the notice to the panel; the next error never reuses it", async () => {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const g = globalThis as unknown as { window: { dispatchEvent(e: unknown): void } };
  const send = async (data: unknown) => act(async () => { g.window.dispatchEvent({ type: "message", data }); });
  await act(async () => { root.render(<App />); });
  await send({ type: "config", config: classroom });
  const byClass = (c: string) => host.findAll((e) => (e.getAttribute("class") ?? "").split(/\s+/).includes(c));
  await send({ type: "streamStart", streamId: "s1", messageId: "a1" });
  await send({ type: "streamError", streamId: "s1", error: SENTENCE, retry: false, safetyNotice: withHelp });
  ok(byClass("hps-safety-notice")[0], "notice drawn from the host message");
  ok(byClass("hps-safety-notice")[0].textContent.includes("1388"), "with the help lines the host sent");
  eq(byClass("hps-error-banner").length, 0, "no red card");
  await send({ type: "streamStart", streamId: "s2", messageId: "a2" });
  eq(byClass("hps-safety-notice").length, 0, "a new turn clears it");
  await send({ type: "streamError", streamId: "s2", error: "문제가 발생했습니다." });
  eq(byClass("hps-safety-notice").length, 0, "a later ordinary error does not reuse the notice");
  ok(byClass("hps-error-banner")[0], "the ordinary error is the card");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} safety-notice check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} safety-notice checks passed`);
  process.exit(0);
})();
