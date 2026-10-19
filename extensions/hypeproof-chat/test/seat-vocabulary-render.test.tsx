// Trial diagnosis 2026-10-18 D3/D9 (ind-trial-vocabulary) — the rendered chat panel per seat.
// Bundled with esbuild (JSX + CSS stripped) and run with plain Node, like instructor-render.
//
//   trial / pass  — the work screen with an error banner carries no 스태프 / 강사 / 운영 담당자 / Jay
//   classroom     — positive control: the banner keeps its instructor/Jay hover titles, so the
//                   absence check above cannot pass vacuously
//   every seat    — the send button reads "보내기", never "Send"
//   start page    — D9: the card eyebrow and footer motto are Korean (shown before any seat exists)

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { StartPage } from "../webview-ui/src/StartPage";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

const noop = () => {};
const PROPS = {
  messages: [],
  streaming: false,
  streamingId: null,
  error: "문제가 발생했습니다.",
  errorRequestId: "rid-123",
  errorRunbookUrl: null,
  canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};

const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};

const config = (kind: "trial" | "classroom", pass?: object): ChatConfig => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: {
    profile_id: kind === "trial" ? "studio-native-trial" : "class-a", activity_kind: kind,
    ...(pass ? { pass } : {}),
    observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX,
  } as unknown as NonNullable<ChatConfig["profile"]>,
  activity: { id: "a1", name: kind === "trial" ? "AI 체험" : "수업", kind, workspace: "/tmp/w", verified: true, ...(pass ? { pass } : {}) } as NonNullable<ChatConfig["activity"]>,
} as ChatConfig);

const BANNED = ["스태프", "강사", "운영 담당자", "Jay"];
let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const render = (c: ChatConfig) => renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false} />);
const sendLabel = (html: string) => /<button[^>]*class="hps-btn-send"[^>]*>([^<]*)<\/button>/.exec(html)?.[1];

const PASS = { ends_at: Date.now() + 86_400_000, duration_days: 30 };
for (const [label, c] of [["trial", config("trial")], ["pass", config("trial", PASS)]] as const) {
  t(`${label}: banner renders with its request id`, () => {
    const html = render(c);
    if (!html.includes("hps-error-banner") || !html.includes("rid-123")) throw new Error("banner missing — the absence checks below would be vacuous");
  });
  t(`${label}: no classroom/operator vocabulary anywhere on the work screen`, () => {
    const html = render(c);
    const hit = BANNED.filter((w) => html.includes(w));
    if (hit.length) throw new Error(`found ${hit.join(", ")}`);
  });
  t(`${label}: send button reads 보내기`, () => {
    const got = sendLabel(render(c));
    if (got !== "보내기") throw new Error(`send label is ${JSON.stringify(got)}`);
  });
}

t("classroom: banner keeps the instructor hover title (positive control)", () => {
  const html = render(config("classroom"));
  if (!html.includes("강사에게 이 ID를 알려주세요 — Jay가 바로 추적할 수 있어요")) throw new Error("classroom id title changed");
  if (!html.includes("이 문제를 Jay에게 신고합니다")) throw new Error("classroom report title changed");
});
t("classroom: send button reads 보내기", () => {
  const got = sendLabel(render(config("classroom")));
  if (got !== "보내기") throw new Error(`send label is ${JSON.stringify(got)}`);
});
t("no seat renders an English Send label", () => {
  for (const c of [config("trial"), config("classroom")]) if (/>Send</.test(render(c))) throw new Error("English Send label present");
});

t("start page: Korean eyebrow and motto, no English chrome", () => {
  const html = renderToStaticMarkup(<StartPage />);
  if (!html.includes("studio-step") || !html.includes("studio-build")) throw new Error("chrome elements missing — the absence check would be vacuous");
  for (const en of ["GET STARTED", "MAKE · VERIFY · OWN"]) if (html.includes(en)) throw new Error(`English chrome present: ${en}`);
  if (!html.includes('<span class="studio-step">시작하기</span>')) throw new Error("eyebrow is not 시작하기");
  if (!html.includes('<span class="studio-build">만들기 · 검토하기 · 내 것으로</span>')) throw new Error("motto is not Korean");
});

if (fail) { console.error(`seat-vocabulary-render: ${fail} failed`); process.exit(1); }
console.log("seat-vocabulary-render.test.tsx — all assertions passed");
