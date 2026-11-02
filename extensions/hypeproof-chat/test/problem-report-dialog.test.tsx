// REQ-STUDIO-PROBLEM-REPORT — the rendered in-panel report form, the offer line and the error card's action.
// Bundled with esbuild and run with plain Node (scripts/run-tsx-tests.mjs).
//
//   form       — a dialog (not an input box) with an optional description, an optional contact, the diagnostic rows,
//                and the conversation opt-in rendered UNCHECKED; with no recent messages the opt-in is absent
//   offer      — repeat and frustration copy, two buttons, a status (not an alert)
//   error card — a fault shows 문제 보내기; a calm notice (positive control for the absence) does not

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProblemReportDialog, ProblemReportOffer } from "../webview-ui/src/ProblemReportDialog";
import { problemDetailRows, problemDiagnostic } from "../src/problemReport";
import { ChatErrorBoundary } from "../webview-ui/src/ChatErrorBoundary";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

let fail = 0;
const t = (name: string, fn: () => void) => { try { fn(); console.log(`✅ ${name}`); } catch (e) { fail++; console.log(`❌ ${name}\n   ${(e as Error).message}`); } };
const noop = () => {};
const d = problemDiagnostic({ status: 409, code: "trial_model_unpriced", step: "agent", requestId: "a1b2c3d4" }, { appVersion: "0.1.60", platform: "darwin", arch: "arm64" });
const form = (recentTurns: number) => ({
  id: "f1", reason: "error" as const, details: problemDetailRows(d, "0.1.60", "macos-arm64"),
  contactPrompt: "답을 받을 연락처", contactPlaceholder: "예: 이메일", recentTurns, autoReport: false, logs: { available: true, checked: false, errorCount: 0 },
});

t("form: dialog with description, contact, unchecked opt-in and the diagnostic", () => {
  const html = renderToStaticMarkup(<ProblemReportDialog form={form(3)} onAnswer={noop} />);
  for (const want of ["<dialog", "문제 보내기", "방금 생긴 문제를", "data-problem-description", "data-problem-contact", "최근 대화 3개 함께 보내기",
    "trial_model_unpriced", "a1b2c3d4", "macos-arm64", "파일 이름·경로·토큰은 보내지 않아요", ">취소</button>", ">보내기</button>"])
    if (!html.includes(want)) throw new Error(`missing ${want}`);
  const box = /<input[^>]*data-problem-recent[^>]*>/.exec(html)?.[0];
  if (!box) throw new Error("opt-in checkbox missing (positive control)");
  if (/checked/.test(box)) throw new Error(`opt-in must start unchecked: ${box}`);
  if (html.includes("quick-input")) throw new Error("form is not a quick input");
  const auto = /<input[^>]*data-problem-auto[^>]*>/.exec(html)?.[0];
  if (!auto) throw new Error("automatic-report toggle missing");
  if (/checked/.test(auto)) throw new Error(`automatic report must start off: ${auto}`);
  if (!html.includes("대화 내용, 파일 이름과 경로, 프롬프트, 토큰은 보내지 않고")) throw new Error("toggle must state what it does not send");
});

t("form: a machine that turned automatic reports on sees the toggle on (positive control)", () => {
  const html = renderToStaticMarkup(<ProblemReportDialog form={{ ...form(0), autoReport: true }} onAnswer={noop} />);
  if (!/<input[^>]*data-problem-auto[^>]*checked/.test(html)) throw new Error("stored on-state not shown");
});

t("form: no recent messages → no opt-in offered", () => {
  const html = renderToStaticMarkup(<ProblemReportDialog form={form(0)} onAnswer={noop} />);
  if (html.includes("data-problem-recent") || html.includes("최근 대화")) throw new Error("opt-in offered without messages");
  if (!html.includes("data-problem-description")) throw new Error("form did not render (control)");
});

t("offer: repeat and frustration copy, status role, two choices", () => {
  const repeat = renderToStaticMarkup(<ProblemReportOffer reason="repeat" onAnswer={noop} />);
  const frustrated = renderToStaticMarkup(<ProblemReportOffer reason="frustration" onAnswer={noop} />);
  if (!repeat.includes("같은 문제가 또 생겼어요. 문제를 보낼까요?")) throw new Error("repeat copy");
  if (!frustrated.includes("잘 안 되고 있나요? 문제를 보낼까요?")) throw new Error("frustration copy");
  for (const html of [repeat, frustrated]) {
    if (!html.includes('role="status"') || html.includes('role="alert"')) throw new Error("offer must be a calm status");
    if (!html.includes(">문제 보내기</button>") || !html.includes(">괜찮아요</button>")) throw new Error("offer buttons");
  }
});

t("logs: ticked after a crash, unticked otherwise, hidden without log files; crash records named", () => {
  const box = (html: string) => /<input[^>]*data-problem-logs[^>]*>/.exec(html)?.[0];
  const crashed = renderToStaticMarkup(<ProblemReportDialog form={{ ...form(0), reason: "crash", logs: { available: true, checked: true, errorCount: 2 } }} onAnswer={noop} />);
  if (!box(crashed) || !/checked/.test(box(crashed)!)) throw new Error("after a crash the logs box starts ticked");
  if (!crashed.includes("앱 기록 파일 첨부 (화면·확장 로그 마지막 부분)") || !crashed.includes("토큰·이메일·내 컴퓨터 사용자 이름을 지워요")) throw new Error("logs label or redaction note missing");
  if (!crashed.includes("최근 화면 오류 기록 2건")) throw new Error("crash records not named");
  if (!crashed.includes("화면이 멈춘 문제를")) throw new Error("crash lead missing");
  const calm = renderToStaticMarkup(<ProblemReportDialog form={form(0)} onAnswer={noop} />);
  if (!box(calm) || /checked/.test(box(calm)!)) throw new Error("without a crash the logs box starts unticked");
  if (calm.includes("최근 화면 오류 기록")) throw new Error("no crash records, no line");
  const none = renderToStaticMarkup(<ProblemReportDialog form={{ ...form(0), logs: { available: false, checked: true, errorCount: 0 } }} onAnswer={noop} />);
  if (box(none)) throw new Error("no log files: no box");
});

t("crash card: offers 문제 신고하기 next to 다시 열기", () => {
  const b = new ChatErrorBoundary({ children: null });
  b.state = { err: new Error("Minified React error #185") };
  const html = renderToStaticMarkup(<>{b.render()}</>);
  if (!html.includes("화면을 그리다가 멈췄어요") || !html.includes("다시 열기")) throw new Error("crash card not rendered (control)");
  if (!/data-crash-report[^>]*>문제 신고하기<\/button>/.test(html)) throw new Error("crash card lacks 문제 신고하기");
});

if (fail) { console.error(`problem-report-dialog: ${fail} failed`); process.exit(1); }
console.log("problem-report-dialog.test.tsx — all assertions passed");
