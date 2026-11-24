// #4193 — trial mode is gone from what people see in the chat. The real ChatPanel (minimal DOM,
// fixtures/mini-dom.mjs) and the real TrialCarryover are rendered with a seat that is not free
// (a code-issued `trial` seat) in use, near its limit, spent and expired, and with every error a
// current host or the Service can hand the banner for such a seat. The rendered text and the
// attributes a person or a screen reader gets must not say 체험.
//
// Positive control: an unrelated message that happens to say 체험 is shown as sent, and the checker
// catches it — so the checker can fail, and the banner only rewrites seat endings.
import { mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { TrialCarryover } from "../webview-ui/src/TrialCarryover";
import type { ChatConfig } from "../src/protocol";
import { TRIAL_EXHAUSTED_FRIENDLY, TRIAL_EXPIRED_FRIENDLY, trialEndNotice } from "../src/passPurchase";
import { imageEditFailureMessage } from "../src/imageEditClient";
import { trialRequiresSdkMessage } from "../src/sdkRequiredHelpers";
import { RATE_LIMIT_STALL_CLASSROOM } from "../src/seatVocabulary";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

type El = { getAttribute(n: string): string | null; textContent: string; findAll(test: (e: El) => boolean): El[] };
const ATTRS = ["aria-label", "aria-description", "title", "placeholder", "alt", "data-hp-tooltip"];
function said(host: El): string {
  const parts = [host.textContent];
  for (const el of host.findAll(() => true)) for (const a of ATTRS) { const v = el.getAttribute(a); if (v) parts.push(v); }
  return parts.join("\n");
}
const trialLines = (s: string) => s.split("\n").filter((l) => l.includes("체험"));

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const taskWorkspace = { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
// A code-issued seat (not free): its copy used to say 체험 everywhere.
const codeSeat = (trial: unknown) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "studio-native-trial", activity_kind: "trial", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "p1", name: "합성 활동", kind: "trial", workspace: "/tmp/p", verified: true, trial },
  taskWorkspace,
}) as unknown as ChatConfig;

const later = new Date(Date.now() + 3_600_000).toISOString();
const seats: [string, unknown][] = [
  ["in use", { state: "active", ends_at: later, request_limit: 40, requests_used: 3 }],
  ["near limit", { state: "active", ends_at: later, request_limit: 40, requests_used: 38 }],
  ["exhausted", { state: "exhausted", ends_at: later, request_limit: 40, requests_used: 40 }],
  ["expired", { state: "expired", ends_at: new Date(Date.now() - 60_000).toISOString(), request_limit: 40, requests_used: 4 }],
];
const SERVICE_409 = JSON.stringify({ error: { code: "trial_requires_sdk", message: "이 체험은 최신 Studio에서 실행해 주세요." } });
const errors: [string, string | null][] = [
  ["no error", null],
  ["host: spent", TRIAL_EXHAUSTED_FRIENDLY],
  ["host: expired", TRIAL_EXPIRED_FRIENDLY],
  ["host notice: spent", trialEndNotice("exhausted")],
  ["older host: spent", "체험에서 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요."],
  ["older host: expired", "체험 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요."],
  ["Service unmapped: expired", "개인 체험 시간이 끝났습니다. 다시 체험하려면 코드 발급 담당자에게 새 체험을 요청해 주세요."],
  ["Service unmapped: limit", "개인 체험의 총 요청 한도에 도달했습니다."],
  ["image edit refused", imageEditFailureMessage("trial_busy_or_exhausted")],
  ["409 trial_requires_sdk", trialRequiresSdkMessage(409, SERVICE_409)],
  ["classroom 429", RATE_LIMIT_STALL_CLASSROOM],
];

const mounted: Root[] = [];
async function render(config: ChatConfig, error: string | null): Promise<El> {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props: Record<string, unknown> = {
    messages: [], streaming: false, streamingId: null, error, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onCancel: noop, onClear: noop, onDismissError: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    trialEndCard: null, config, instructor: false,
  };
  await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  return host;
}

t("control: an unrelated sentence saying 체험 is shown as sent, and the checker catches it", async () => {
  const host = await render(codeSeat(seats[0][1]), "체험 학습 자료를 열지 못했어요.");
  ok(trialLines(said(host)).length > 0, "the checker must be able to fail");
  ok(host.textContent.includes("체험 학습 자료를 열지 못했어요."), "a message that is not a seat ending is not rewritten");
});

for (const [seatLabel, trial] of seats) {
  for (const [errLabel, error] of errors) {
    t(`code seat ${seatLabel}, ${errLabel}: no 체험`, async () => {
      const host = await render(codeSeat(trial), error);
      ok(host.textContent.includes("개인 작업"), "the header is drawn, so an absent 체험 is not vacuous");
      const hits = trialLines(said(host));
      if (hits.length) throw new Error(`says 체험: ${JSON.stringify(hits)}`);
    });
  }
}

t("an ending worded as 체험 is replaced by Studio's own sentence", async () => {
  const host = await render(codeSeat(seats[3][1]), "개인 체험 시간이 끝났습니다.");
  ok(host.textContent.includes("사용이 끝났어요"), "banner title");
  ok(host.textContent.includes(TRIAL_EXPIRED_FRIENDLY), "banner body is the host's expired sentence");
});

t("carry-over from a code seat (offer and read-only transcript): no 체험", async () => {
  for (const view of [
    { status: "offer" as const, fromName: "지난 활동" },
    { status: "accepted" as const, fromName: "지난 활동", transcript: [{ role: "user" as const, content: "홈페이지 만들어 줘" }, { role: "assistant" as const, content: "초안입니다." }] },
  ]) {
    const host = mountPoint() as unknown as El;
    const root = createRoot(host as unknown as HTMLElement);
    mounted.push(root);
    await act(async () => { root.render(<TrialCarryover view={view} onDecide={noop} />); });
    ok(host.textContent.includes("이전 활동"), `${view.status}: drawn`);
    const hits = trialLines(said(host));
    if (hits.length) throw new Error(`${view.status} says 체험: ${JSON.stringify(hits)}`);
  }
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} no-trial-copy-chat check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} no-trial-copy-chat checks passed`);
  process.exit(0);
})();
