// REQ-STUDIO-DOCTOR — the rendered doctor surfaces. Bundled with esbuild and run with plain Node (scripts/run-tsx-tests.mjs).
//
//   report form — 「진단 결과 첨부」 starts ticked and says it sends codes only; an older host (no `doctor`) shows no box
//   quiet line  — a status (not an alert, not a dialog) with the check's sentence; the fix button only when the host
//                 gave one (negative control: no fix → only 닫기)
//   error card  — a fault shows 진단하기 when the panel wires it; a calm notice does not (positive/negative control)

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DoctorNoticeLine, ProblemReportDialog } from "../webview-ui/src/ProblemReportDialog";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { doctorNotice, DOCTOR_TEXT } from "../src/studioDoctor";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

let fail = 0;
const t = (name: string, fn: () => void) => { try { fn(); console.log(`✅ ${name}`); } catch (e) { fail++; console.log(`❌ ${name}\n   ${(e as Error).message}`); } };
const noop = () => {};
const form = (doctor?: { available: boolean; checked: boolean }) => ({
  id: "f1", reason: "manual" as const, details: [], contactPrompt: "연락처", contactPlaceholder: "예: 이메일", recentTurns: 0, autoReport: true,
  logs: { available: false, checked: false, errorCount: 0 }, ...(doctor ? { doctor } : {}),
});
const box = (html: string) => /<input[^>]*data-problem-doctor[^>]*>/.exec(html)?.[0];

t("report form: 진단 결과 첨부 starts ticked and states it carries codes only", () => {
  const html = renderToStaticMarkup(<ProblemReportDialog form={form({ available: true, checked: true })} onAnswer={noop} />);
  if (!box(html)) throw new Error("box missing (positive control)");
  if (!/checked/.test(box(html)!)) throw new Error("must start ticked");
  if (!html.includes("진단 결과 첨부") || !html.includes("확인한 항목의 이름과 결과 코드만 보내요")) throw new Error("label or statement missing");
});

t("report form: an older host without the doctor shows no box", () => {
  const html = renderToStaticMarkup(<ProblemReportDialog form={form()} onAnswer={noop} />);
  if (box(html) || html.includes("진단 결과 첨부")) throw new Error("box shown without a doctor");
  if (!html.includes("data-problem-description")) throw new Error("form did not render (control)");
});

t("quiet line: status with the sentence and the host's fix; without a fix only 닫기", () => {
  const withFix = renderToStaticMarkup(<DoctorNoticeLine notice={doctorNotice({ id: "workfolder", status: "fail", code: "folder_mac_privacy", fix: "mac_privacy" }, "n1")!} onAnswer={noop} />);
  if (!withFix.includes('role="status"') || withFix.includes('role="alert"') || withFix.includes("<dialog")) throw new Error("must be a calm status line");
  if (!withFix.includes(DOCTOR_TEXT.folder_mac_privacy)) throw new Error("sentence missing");
  if (!withFix.includes(">Mac 설정 열기</button>") || !withFix.includes(">닫기</button>")) throw new Error("buttons");
  const noFix = renderToStaticMarkup(<DoctorNoticeLine notice={doctorNotice({ id: "service", status: "fail", code: "service_offline" }, "n2")!} onAnswer={noop} />);
  if ((noFix.match(/<button/g) ?? []).length !== 1 || !noFix.includes(">닫기</button>")) throw new Error("no fix → only 닫기");
});

const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const config = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "studio-native-trial", activity_kind: "trial", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "AI 체험", kind: "trial", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const PROPS = {
  messages: [], streaming: false, streamingId: null, errorRequestId: "rid-123", errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const card = (error: string, onDiagnose?: () => void) =>
  renderToStaticMarkup(<ChatPanel {...PROPS} error={error} config={config} instructor={false} {...(onDiagnose ? { onDiagnose } : {})} />);

t("error card: a fault offers 진단하기 next to 문제 보내기", () => {
  const html = card("문제가 발생했습니다.", noop);
  if (!html.includes("문제 보내기")) throw new Error("banner missing (control)");
  if (!/class="hps-error-banner-report hps-error-banner-diagnose"[^>]*>진단하기<\/button>/.test(html)) throw new Error("진단하기 missing");
});

t("error card: no 진단하기 on a calm notice or when the panel does not wire it", () => {
  const notice = card("오늘 준비한 무료 사용량이 모두 소진되었습니다. 밤 12시(한국 시간) 이후에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다.", noop);
  if (!notice.includes("hps-error-banner--notice")) throw new Error("notice did not render (control)");
  if (notice.includes("진단하기")) throw new Error("calm notice shows 진단하기");
  if (card("문제가 발생했습니다.").includes("진단하기")) throw new Error("unwired panel shows 진단하기");
});

if (fail) { console.error(`studio-doctor-ui: ${fail} failed`); process.exit(1); }
console.log("studio-doctor-ui.test.tsx — all assertions passed");
