// CONV-PURCHASE-R-005 — the webview half of the in-place seat switch. The host side
// (test/paid-seat-switch.smoke.mjs) proves that after a paid poll the chat config is pushed again
// with the pass activity's id. This proves the App reducer then drops the end card and its error,
// and (negative control) that the same activity's config keeps a card that is still true.
// Bundled with esbuild and run with plain Node (scripts/run-tsx-tests.mjs).

import { chatPanelReducer, chatPanelInitialState } from "../webview-ui/src/App";
import type { ChatConfig, TrialEndCardView } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined, innerWidth: 1280, addEventListener() {}, removeEventListener() {} };
let fail = 0;
const t = (label: string, fn: () => void) => { try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } };
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

type S = typeof chatPanelInitialState;
type A = Parameters<typeof chatPanelReducer>[1];
const config = (id: string, extra: Record<string, unknown> = {}) => ({ type: "config", config: { activity: { id, name: "x", kind: "trial", workspace: "/tmp/w", verified: true, ...extra } } as unknown as ChatConfig }) as A;
const card = { ending: "exhausted", title: "카드", facts: [], primary: "이용권 살펴보기", escape: "오늘은 여기까지", text: "카드" } as unknown as TrialEndCardView;
const run = (actions: A[]) => actions.reduce((s: S, a) => chatPanelReducer(s, a), chatPanelInitialState);
const ended = [config("free-seat", { free: true }), { type: "streamError", error: "체험이 끝났어요", trialEndCard: card } as A];

t("the free seat's end card is on screen before the switch (fixture)", () => {
  const s = run(ended);
  ok(s.trialEndCard !== null && s.error !== null, "card drawn");
});
t("config for the pass activity drops the end card and the error", () => {
  const s = run([...ended, config("pass-seat", { pass: { request_limit: 600 } })]);
  ok(s.trialEndCard === null, "end card still on screen after the seat switched");
  ok(s.error === null, "the free seat's ending sentence is still shown");
});
t("same activity's config keeps the card (negative control)", () => {
  const s = run([...ended, config("free-seat", { free: true })]);
  ok(s.trialEndCard !== null, "a config refresh for the same seat dropped a card that is still true");
});

if (fail) { console.error(`paid-seat-end-card: ${fail} failed`); process.exit(1); }
console.log("paid-seat-end-card: all passed");
