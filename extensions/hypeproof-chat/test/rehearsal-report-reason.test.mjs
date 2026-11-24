// #4464(a) — the sentence for a rehearsal report that was not sent. Pure checks; the Service `error` text is never shown.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rehearsalReportRejectionSentence as sentence } from "../src/rehearsalReportReason.ts";

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

console.log("rehearsal-report-reason (#4464a)");

// Positive: every row of the table.
t("RR-R1 409 no_request_yet on the server path: the existing sentence, unchanged", () => {
  assert.equal(sentence({ status: 409, reason: "no_request_yet", subscription: false }), "아직 AI에게 한 번도 묻지 않았습니다. 단계마다 한 번 이상 물어본 뒤 보내세요.");
});
t("RR-R2 409 no_request_yet on the subscription path: the subscription sentence, not the server one", () => {
  const s = sentence({ status: 409, reason: "no_request_yet", subscription: true });
  assert.equal(s, "구독 연결로 한 대화는 아직 서버에 전달되지 않아 결과를 보낼 수 없습니다.");
  assert.equal(s.includes("아직 AI에게"), false);
});
t("RR-R3 409 already_judged", () => {
  assert.equal(sentence({ status: 409, reason: "already_judged", subscription: false }), "이 리허설은 이미 결과를 보냈습니다. 다시 하려면 강사에게 새 리허설 코드를 받으세요.");
});
t("RR-R4 409 lesson_unavailable", () => {
  assert.equal(sentence({ status: 409, reason: "lesson_unavailable", subscription: false }), "이 수업 후보를 지금 열 수 없어 결과를 보내지 못했습니다. 강사에게 알려 주세요.");
});
t("RR-R5 410 rehearsal_expired", () => {
  assert.equal(sentence({ status: 410, reason: "rehearsal_expired", subscription: false }), "리허설 시간이 끝났습니다. 강사에게 새 리허설 코드를 받으세요.");
});
t("RR-R6 404 rehearsal_unknown", () => {
  assert.equal(sentence({ status: 404, reason: "rehearsal_unknown", subscription: false }), "이 리허설을 찾지 못했습니다. 강사에게 새 리허설 코드를 받으세요.");
});

// Negative: unknown reason, no reason, other statuses, network error.
t("RR-R7 unknown reason with a status: the generic sentence with the status, no English", () => {
  const s = sentence({ status: 500, reason: "something_new", subscription: false });
  assert.equal(s, "결과를 보내지 못했습니다 (상태 500).");
  assert.equal(/[A-Za-z]/.test(s), false);
});
t("RR-R8 401 with no body (no reason): the generic sentence with the status", () => {
  assert.equal(sentence({ status: 401, reason: undefined, subscription: false }), "결과를 보내지 못했습니다 (상태 401).");
});
t("RR-R9 network error (no status, no reason): the generic sentence without a status", () => {
  assert.equal(sentence({ subscription: false }), "결과를 보내지 못했습니다.");
});
t("RR-R10 the Service English error text is never copied into the sentence", () => {
  const s = sentence({ status: 409, reason: "mystery", subscription: true });
  assert.equal(/[A-Za-z]/.test(s), false);
  assert.equal(s.includes("ask the AI"), false);
});
t("RR-R11 a reason that is not a string is treated as unknown", () => {
  assert.equal(sentence({ status: 400, reason: 42, subscription: false }), "결과를 보내지 못했습니다 (상태 400).");
});
t("RR-R12 a known reason on the subscription path other than no_request_yet keeps its own sentence", () => {
  assert.equal(sentence({ status: 409, reason: "already_judged", subscription: true }), "이 리허설은 이미 결과를 보냈습니다. 다시 하려면 강사에게 새 리허설 코드를 받으세요.");
});

// Wiring: the host sends the sentence for the report failure; the webview shows it above the input, on the rehearsal seat only.
const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
const chatPanel = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
t("RR-R13 the host builds the failure message from status, reason and the subscription path (no raw Service error)", () => {
  assert.ok(provider.includes("rehearsalReportRejectionSentence({ status: r.status, reason: j.reason, subscription: mustStayLocal(profile.rehearsal) })"));
  assert.equal(provider.includes("j.error ??"), false);
});
t("RR-R14 the network-error catch sends the generic sentence, not the raw error text", () => {
  assert.ok(provider.includes("rehearsalReportRejectionSentence({ subscription: mustStayLocal(profile.rehearsal) })"));
  assert.equal(provider.includes('"Service에 연결하지 못했습니다: "'), false);
});
t("RR-R15 the rejection line is the first child of the sticky input footer; the component is gated on the rehearsal seat and the error state", () => {
  const footer = chatPanel.indexOf('<footer className="hps-input-area">');
  const line = chatPanel.indexOf("<RehearsalRejectLine seat={config?.rehearsalSeat === true}", footer);
  const voice = chatPanel.indexOf("<VoiceConversationControl", footer);
  assert.ok(footer >= 0 && line > footer && line < voice, "line is not inside the input footer before the voice control");
  const compAt = chatPanel.indexOf("export function RehearsalRejectLine"); const comp = chatPanel.slice(compAt, chatPanel.indexOf("\n}\n", compAt) + 3);
  assert.ok(comp.includes('if (!seat || result?.state !== "error") return null;'), "component is not gated on seat + error");
  assert.ok(comp.includes('role="alert"'), "no role=alert");
});

if (failed) {
  console.log(`\nrehearsal-report-reason: ${failed} failed`);
  process.exit(1);
}
console.log("\nrehearsal-report-reason: all checks passed.");
