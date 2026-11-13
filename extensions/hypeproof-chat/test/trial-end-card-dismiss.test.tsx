// TUX-COND-07 / CONV-ENDCARD-R-003, retired 2026-11-13 (REQ-L12 ①–④ removed). The end-of-trial card
// was a pass offer; the chat no longer draws it, nor the header "이용권 살펴보기" link. The real
// ChatPanel on the minimal DOM (fixtures/mini-dom.mjs) shows that a card from an older host ends as the
// ordinary banner, and that an ended free seat keeps only the composer note. The host side is
// test/trial-end-card-host.smoke.mjs.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { postToHost } from "../webview-ui/src/vscode";
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
async function harness(trialEndCard: TrialEndCardView | null, config: ChatConfig = personal) {
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
      // An older host's card, and the handler an older App passed: neither draws anything now.
      trialEndCard, onTrialEndCardPasses: () => { calls.passes++; postToHost({ type: "trialEndCardPasses" }); },
      config, instructor: false,
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
    personalClaude: () => byClass("hps-trial-end-card-personal")[0],
    headerLink: () => host.findAll((e) => (e.getAttribute("class") ?? "").split(/\s+/).includes("hps-header-passes")),
    endedNote: () => byClass("hps-free-ended-note")[0],
    // The personal header's activity line: proves the header is drawn, so an absent link is not vacuous.
    activityNow: () => byClass("hps-activity-now")[0]?.textContent,
    text: () => host.textContent,
    bannerClose: () => byClass("hps-error-banner").flatMap(() => host.findAll((e) => e.localName === "button" && e.textContent.trim() === "닫기"))[0],
    press: async (el: El) => act(async () => { click(el); }),
  };
}

const dismissals = () => posted.filter((m) => m.type === "trialEndCardDismiss").length;

t("a card from an older host draws no pass card: the ordinary banner, no pass button", async () => {
  posted.length = 0;
  const h = await harness(card);
  eq(h.card(), undefined, "no end-of-trial card");
  eq(h.primary(), undefined, "no pass Primary");
  ok(!h.text().includes("기본 버튼"), "the card's Primary label is not drawn");
  ok(h.bannerClose(), "the ordinary banner is drawn instead");
  eq(h.calls.passes, 0, "nothing calls the passes handler");
  eq(posted.filter((m) => m.type === "trialEndCardPasses").length, 0);
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

// ── CONV-ENDCARD-R-003 (retired 2026-11-13) — the header no longer carries an "이용권 살펴보기" link ──
// REQ-L12 ①–④ were removed: there is no pass list to open, so an ended free seat keeps only the note.
// A personal-workspace seat whose header is drawn (taskWorkspace present, no lesson). The trial block
// is what the Service serves after the ending turn; the header is re-read at each turn's end.
const taskWorkspace = { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const seat = (activity: Record<string, unknown>) => ({ ...personal, taskWorkspace, activity: { ...personal.activity, ...activity } }) as unknown as ChatConfig;
const later = new Date(Date.now() + 3_600_000).toISOString();
const exhausted = { state: "exhausted", ends_at: later, request_limit: 10, requests_used: 10 };
const expired = { state: "expired", ends_at: new Date(Date.now() - 60_000).toISOString(), request_limit: 10, requests_used: 4 };
const inUse = { state: "active", ends_at: later, request_limit: 10, requests_used: 3 };
const PASS = { request_limit: 200, requests_used: 200, expires_at: Date.now() + 86_400_000 };
const passPresses = () => posted.filter((m) => m.type === "trialEndCardPasses").length;

t("ended free seat: no card and no 이용권 살펴보기 link in the header", async () => {
  posted.length = 0;
  const h = await harness(card, seat({ free: true, trial: exhausted }));
  eq(h.card(), undefined, "no card");
  eq(h.headerLink().length, 0, "no header link");
  ok(!h.text().includes("이용권 살펴보기"), "the pass list is never named");
  eq(passPresses(), 0, "nothing posts trialEndCardPasses");
  eq(dismissals(), 0, "no card, so no dismissal");
});

t("ended free seat: the composer says why the AI no longer answers, with no count", async () => {
  posted.length = 0;
  const h = await harness(null, seat({ free: true, trial: exhausted }));
  eq(h.headerLink().length, 0, "a reopened chat (no card) has no pass link");
  eq(h.endedNote()?.textContent, "무료로 쓸 수 있는 AI 요청을 모두 써서 지금은 AI가 답하지 않아요. 만든 파일과 대화는 그대로 있어요.", "exhausted note");
  const t2 = await harness(null, seat({ free: true, trial: expired }));
  eq(t2.endedNote()?.textContent, "무료 사용 시간이 끝나서 지금은 AI가 답하지 않아요. 만든 파일과 대화는 그대로 있어요.", "expired note");
  eq(t2.headerLink().length, 0, "an expired seat has no pass link either");
  eq(passPresses(), 0, "nothing opens by itself");
});

t("negative control: a free seat still in use has no link and no note", async () => {
  const h = await harness(null, seat({ free: true, trial: inUse }));
  eq(h.activityNow(), "무료 사용 · 무료 사용", "the header is drawn (not vacuous)");
  eq(h.headerLink().length, 0, "no link while in use");
  eq(h.endedNote(), undefined, "no note while in use");
  ok(!h.text().includes("번 남음"), "a free seat never shows a remaining count");
});

t("negative control: a paid pass seat has no link even when its requests ran out", async () => {
  const h = await harness(null, seat({ free: undefined, kind: "trial", trial: undefined, pass: PASS }));
  ok(h.activityNow()?.startsWith("이용권"), "the header is drawn as a pass seat");
  eq(h.headerLink().length, 0, "no link on a pass seat");
  eq(h.endedNote(), undefined, "no note on a pass seat");
});

t("negative control: a pass seat that still carries the free flag has no link", async () => {
  const h = await harness(null, seat({ free: true, trial: exhausted, pass: PASS }));
  ok(h.activityNow()?.startsWith("이용권"), "the header is drawn as a pass seat");
  eq(h.headerLink().length, 0, "a pass is never read as an ended free seat");
  eq(h.endedNote(), undefined, "no note");
});

t("negative control: a code-issued trial (not free) that ended has no link", async () => {
  const h = await harness(null, seat({ free: undefined, trial: exhausted }));
  ok(h.activityNow()?.startsWith("AI 체험"), "the header is drawn as a code-issued trial");
  eq(h.headerLink().length, 0, "code-issued trial keeps today's header");
  eq(h.endedNote(), undefined, "no note");
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
