// CONV-FUNNEL-R-003 — the webview side of the end card's two buttons. The real ChatPanel on the
// minimal DOM (fixtures/mini-dom.mjs) draws the TUX-COND-07 card; pressing `오늘은 여기까지` posts
// `trialEndCardDismiss` to the host (which counts offer_dismissed end_card) and closes the card;
// pressing the Primary calls the passes handler and posts no dismissal. The host side is
// test/trial-end-card-host.smoke.mjs. The banner captures what the panel posts to the host.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { ChatConfig, TrialEndCardView } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: Array<{ type: string }> }).__posted;
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
const personal = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "studio-open-trial", activity_kind: "trial", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "p1", name: "무료 사용", kind: "trial", workspace: "/tmp/p", verified: true },
} as unknown as ChatConfig;

// Copy is whatever the host built; this test reads the buttons by class, not by label.
const card: TrialEndCardView = {
  ending: "exhausted", title: "카드 제목", facts: ["사실 1", "사실 2"], primary: "기본 버튼", escape: "닫는 버튼",
  productId: "pass-lite", text: "카드 제목 사실 1 사실 2",
};

type El = { getAttribute(n: string): string | null; textContent: string; localName: string; findAll(test: (e: El) => boolean): El[] };

const mounted: Root[] = [];
async function harness(trialEndCard: TrialEndCardView | null) {
  const calls = { passes: 0, dismissError: 0 };
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  let error: string | null = "끝났어요";
  const render = async () => {
    const props: Record<string, unknown> = {
      messages: [], streaming: false, streamingId: null, error, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
      pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
      onSend: noop, onRetry: noop, onRetryLast: noop, onCancel: noop, onClear: noop,
      // The App clears the error (and with it the card) on dismissal; mirror that here.
      onDismissError: () => { calls.dismissError++; error = null; void render(); },
      onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
      onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
      trialEndCard, onTrialEndCardPasses: () => { calls.passes++; },
      config: personal, instructor: false,
    };
    await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  };
  await render();
  const byClass = (c: string) => host.findAll((e) => (e.getAttribute("class") ?? "").split(/\s+/).includes(c));
  return {
    calls,
    card: () => byClass("hps-trial-end-card")[0],
    primary: () => byClass("hps-trial-end-card-primary")[0],
    escape: () => byClass("hps-trial-end-card-escape")[0],
    bannerClose: () => byClass("hps-error-banner").flatMap(() => host.findAll((e) => e.localName === "button" && e.textContent.trim() === "닫기"))[0],
    press: async (el: El) => act(async () => { click(el); }),
  };
}

const dismissals = () => posted.filter((m) => m.type === "trialEndCardDismiss").length;

t("오늘은 여기까지 posts one trialEndCardDismiss and closes the card", async () => {
  posted.length = 0;
  const h = await harness(card);
  ok(h.card(), "card drawn");
  await h.press(h.escape());
  eq(dismissals(), 1, "one dismissal per press");
  eq(h.calls.dismissError, 1, "the card closes as before");
  eq(h.card(), undefined, "card gone");
  eq(h.calls.passes, 0, "the escape opens nothing");
});

t("negative control: the Primary posts no dismissal", async () => {
  posted.length = 0;
  const h = await harness(card);
  await h.press(h.primary());
  eq(h.calls.passes, 1, "the passes handler runs (host counts offer_clicked)");
  eq(dismissals(), 0, "no trialEndCardDismiss");
});

t("negative control: closing an ordinary error banner posts no dismissal", async () => {
  posted.length = 0;
  const h = await harness(null);
  eq(h.card(), undefined, "no card without trialEndCard");
  const close = h.bannerClose();
  ok(close, "the banner has its 닫기");
  await h.press(close);
  eq(h.calls.dismissError, 1, "banner closed");
  eq(dismissals(), 0, "no trialEndCardDismiss");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} trial-end-card-dismiss check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} trial-end-card-dismiss checks passed`);
  process.exit(0);
})();
