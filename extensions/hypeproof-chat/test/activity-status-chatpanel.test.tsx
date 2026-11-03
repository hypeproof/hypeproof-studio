// REQ-KNOW-68 (CGP-KNOW-R-036) — the real ChatPanel on the minimal DOM: when the activity can no longer run
// AI the status is shown, the composer is held with the draft kept, 상태 다시 확인 asks the host, and the
// trial card appears on solo seats only. Deleting the status wiring in ChatPanel must fail this file.
// Bundled with esbuild and run with plain Node; the banner captures what the panel posts to the host.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { ACTIVITY_CAUSE_COPY, type ActivityCause, type ActivityUnavailable } from "../src/activityAvailability";
import type { ChatConfig, TrialEndCardView } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: Array<{ type: string; action?: string }> }).__posted;
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
const card: TrialEndCardView = { ending: "exhausted", title: "무료 사용량을 모두 썼습니다", facts: ["사실 하나"], primary: "이용권 보기", escape: "닫기", productId: "pass-lite", text: "무료 사용량을 모두 썼습니다" };

type El = {
  getAttribute(n: string): string | null; textContent: string; value: string; localName: string;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean;
};
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(),
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra,
});

const mounted: Root[] = [];
// The access footer renders a <select>; the minimal DOM has no `options` list for it.
{
  const proto = Object.getPrototypeOf(mountPoint());
  if (!("options" in proto)) Object.defineProperty(proto, "options", { get(this: El) { return this.findAll((e) => e.localName === "option"); } });
}
async function harness(config: ChatConfig, extra: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const calls = { dismiss: 0, passes: 0, report: 0 };
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props: Record<string, unknown> = {
    messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: (text: string) => { sent.push(text); }, onRetry: noop, onRetryLast: noop, onDismissError: () => { calls.dismiss++; }, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: () => { calls.report++; }, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    config, instructor: false, ...extra,
  };
  await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];
  const button = (label: string) => host.findAll((e) => e.localName === "button" && e.textContent.trim() === label)[0];
  return {
    sent, calls, button,
    status: () => host.findAll((e) => e.getAttribute("aria-label") === "AI 이용 상태")[0],
    cardTitle: () => host.findAll((e) => e.textContent === card.title && e.localName === "h3")[0],
    type: async (text: string) => { const ta = textarea(); await act(async () => { ta.value = text; ta.dispatchEvent(ev("input")); }); },
    enter: async () => act(async () => { textarea().dispatchEvent(ev("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: false, isComposing: false })); }),
    draft: () => textarea().value,
    press: async (el: El) => act(async () => { click(el); }),
    text: () => (host as unknown as { textContent: string }).textContent,
  };
}
const status = (cause: ActivityCause, audience: ActivityUnavailable["audience"] = "solo"): ActivityUnavailable => ({ cause, audience });

t("control: with no status the composer sends and nothing of the status is drawn", async () => {
  const h = await harness(personal);
  eq(h.status(), undefined, "no status");
  await h.type("안녕");
  await h.enter();
  eq(h.sent.length, 1, "the send goes out");
});

t("every cause is shown with its own sentence, the composer is held and the draft is kept", async () => {
  const causes: ActivityCause[] = ["auth", "expired", "ended", "paused", "exhausted", "forbidden", "not_started", "outage", "limited", "unknown", "revoked"];
  for (const cause of causes) {
    const h = await harness(personal, { activityUnavailable: status(cause), error: "x" });
    ok(h.status(), `status drawn for ${cause}`);
    eq(h.status().getAttribute("role"), "status", "announced");
    ok(h.text().includes(ACTIVITY_CAUSE_COPY[cause]), `the ${cause} sentence`);
    ok(h.text().includes("내 파일을 계속") || h.text().includes("저장된 내 파일"), "files stay");
    await h.type("고양이 그려 줘");
    await h.enter();
    eq(h.sent.length, 0, `send held for ${cause}`);
    eq(h.draft(), "고양이 그려 줘", `draft kept for ${cause}`);
  }
});

t("the status also comes from the host config and from the selected access choice", async () => {
  let h = await harness({ ...personal, activityUnavailable: status("paused", "classroom") } as ChatConfig);
  ok(h.status() && h.text().includes(ACTIVITY_CAUSE_COPY.paused), "config.activityUnavailable");
  await h.type("질문"); await h.enter(); eq(h.sent.length, 0, "held from config too");
  const choice = (state: string) => ({ id: "pass-1", label: "이용권", mode: "included", source_kind: "class", can_request: false, active: true, available: true, state, ends_at: 0, allowed: { models: [], efforts: [], features: [], runtimes: [] }, resources: [] });
  const access = { status: "ready", selected: "pass-1", view: { schema: "hps-access-view/1", configured: true, as_of: "2026-10-20T00:00:00Z", choices: [choice("ended")] } };
  h = await harness({ ...classroom, access } as unknown as ChatConfig);
  ok(h.status() && h.text().includes(ACTIVITY_CAUSE_COPY.ended), "an ended funding choice is shown");
  h = await harness({ ...classroom, access: { ...access, view: { ...access.view, choices: [choice("active")] } } } as unknown as ChatConfig);
  eq(h.status(), undefined, "an active choice shows nothing (negative control)");
});

t("상태 다시 확인 clears the error and asks the host to re-read access; nothing is sent", async () => {
  const h = await harness(personal, { activityUnavailable: status("outage"), error: "x" });
  await h.type("남겨 둘 글");
  posted.length = 0;
  await h.press(h.button("상태 다시 확인"));
  ok(posted.some((m) => m.type === "refreshAccess"), "refreshAccess posted");
  eq(h.calls.dismiss, 1, "the error is dismissed");
  eq(h.sent.length, 0, "recover never sends");
  eq(h.draft(), "남겨 둘 글", "draft untouched");
});

t("the file buttons ask the host, the token button only on auth and expired, support opens the report", async () => {
  let h = await harness(personal, { activityUnavailable: status("auth"), error: "x" });
  posted.length = 0;
  await h.press(h.button("내 파일 열기")); await h.press(h.button("내 파일 내보내기"));
  eq(posted.filter((m) => m.type === "activityLocalFile").map((m) => m.action).join(), "open,export");
  await h.press(h.button("참여 코드 확인")); ok(posted.some((m) => m.type === "setToken"), "setToken posted");
  await h.press(h.button("HypeProof 지원 문의")); eq(h.calls.report, 1);
  for (const cause of ["ended", "paused", "exhausted", "forbidden", "outage", "limited", "unknown", "revoked"] as ActivityCause[]) {
    h = await harness(personal, { activityUnavailable: status(cause), error: "x" });
    eq(h.button("참여 코드 확인"), undefined, `no token button for ${cause}`);
  }
  h = await harness(personal, { activityUnavailable: status("expired"), error: "x" });
  ok(h.button("참여 코드 확인"), "expired has it");
});

t("solo seat: the trial card sits inside the status; its buttons work", async () => {
  const h = await harness(personal, { activityUnavailable: status("exhausted"), error: "x", trialEndCard: card, onTrialEndCardPasses: () => { h.calls.passes++; } });
  ok(h.status(), "status"); ok(h.cardTitle(), "trial card shown on a solo seat");
  await h.press(h.button("이용권 보기")); eq(h.calls.passes, 1);
  await h.press(h.button("닫기")); eq(h.calls.dismiss, 1);
});

t("classroom seat: no trial card and no purchase, even if the status says solo or the host sent a card", async () => {
  for (const audience of ["classroom", "solo"] as const) {
    const h = await harness(classroom, { activityUnavailable: status("exhausted", audience), error: "x", trialEndCard: card, onTrialEndCardPasses: noop });
    ok(h.status(), "status shown to the class seat");
    eq(h.cardTitle(), undefined, `no card (status audience ${audience})`);
    ok(!h.text().includes("이용권 보기"), "no purchase button");
    if (audience === "classroom") ok(h.text().includes("강사"), "names the instructor");
  }
  // And with no status at all a class seat's stray card is not drawn either.
  const h = await harness(classroom, { error: "x", trialEndCard: card, onTrialEndCardPasses: noop });
  eq(h.cardTitle(), undefined, "no card without a status");
  const solo = await harness(personal, { error: "x", trialEndCard: card, onTrialEndCardPasses: noop });
  ok(solo.cardTitle(), "positive control: a solo seat gets the card without a status");
});

t("takeaway is opt-in and its class-ended button reaches the host", async () => {
  for (const config of [personal, classroom]) {
    const off = await harness(config, { activityUnavailable: status("ended"), error: "x" });
    eq(off.button("내 작업 가져가기"), undefined, "hidden by default");
    const on = await harness({ ...config, workTakeawayEnabled: true }, { activityUnavailable: status("ended"), error: "x" });
    posted.length = 0;
    await on.press(on.button("내 작업 가져가기"));
    ok(posted.some(m => m.type === "workTakeaway"), "takeaway request posted");
  }
});

t("takeaway is not offered for outage, limited, auth or other non-end causes", async () => {
  for (const config of [personal, classroom]) {
    for (const cause of ["outage", "limited", "auth", "forbidden", "paused", "exhausted", "expired", "not_started", "unknown", "revoked"]) {
      const on = await harness({ ...config, workTakeawayEnabled: true }, { activityUnavailable: status(cause as never), error: "x" });
      eq(on.button("내 작업 가져가기"), undefined, cause + " must not offer the takeaway");
      ok(on.button("상태 다시 확인"), "positive control: status card renders for " + cause);
    }
  }
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} activity-status-chatpanel check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} activity-status-chatpanel checks passed`);
  process.exit(0);
})();
