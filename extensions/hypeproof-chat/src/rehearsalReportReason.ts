// #4464(a) — the sentence a learner sees when the rehearsal report is not sent.
// Input: the HTTP status and the `reason` code of the Service answer. The Service `error` text is English and is never shown.
// Reason codes: worker/src/routes/rehearsal-report.ts (hypeproof-service). An unknown code gets the generic sentence.

export interface RehearsalReportRejection {
  status?: number;
  reason?: unknown;
  // mustStayLocal(profile.rehearsal): the rehearsal ran on the subscription path, so no turn reached the server.
  subscription: boolean;
}

export const REHEARSAL_REPORT_NOT_ASKED = "아직 AI에게 한 번도 묻지 않았습니다. 단계마다 한 번 이상 물어본 뒤 보내세요.";
export const REHEARSAL_REPORT_SUBSCRIPTION_NOT_SENT = "구독 연결로 한 대화는 아직 서버에 전달되지 않아 결과를 보낼 수 없습니다.";
export const REHEARSAL_REPORT_ALREADY_JUDGED = "이 리허설은 이미 결과를 보냈습니다. 다시 하려면 강사에게 새 리허설 코드를 받으세요.";
export const REHEARSAL_REPORT_LESSON_UNAVAILABLE = "이 수업 후보를 지금 열 수 없어 결과를 보내지 못했습니다. 강사에게 알려 주세요.";
export const REHEARSAL_REPORT_EXPIRED = "리허설 시간이 끝났습니다. 강사에게 새 리허설 코드를 받으세요.";
export const REHEARSAL_REPORT_UNKNOWN = "이 리허설을 찾지 못했습니다. 강사에게 새 리허설 코드를 받으세요.";
export const REHEARSAL_REPORT_NOT_SENT = "결과를 보내지 못했습니다.";

export function rehearsalReportRejectionSentence(input: RehearsalReportRejection): string {
  switch (input.reason) {
    case "no_request_yet": return input.subscription ? REHEARSAL_REPORT_SUBSCRIPTION_NOT_SENT : REHEARSAL_REPORT_NOT_ASKED;
    case "already_judged": return REHEARSAL_REPORT_ALREADY_JUDGED;
    case "lesson_unavailable": return REHEARSAL_REPORT_LESSON_UNAVAILABLE;
    case "rehearsal_expired": return REHEARSAL_REPORT_EXPIRED;
    case "rehearsal_unknown": return REHEARSAL_REPORT_UNKNOWN;
    default:
      return typeof input.status === "number" ? `${REHEARSAL_REPORT_NOT_SENT.slice(0, -1)} (상태 ${input.status}).` : REHEARSAL_REPORT_NOT_SENT;
  }
}

// #4501 — the subscription turn upload. Shown only on the rehearsal seat, above the sticky input.
export const REHEARSAL_ISSUER_MISSING = "강사 연결 정보가 이 창에 없어 리허설 결과를 보낼 수 없습니다. 강사 창에서 리허설을 다시 여세요.";
export function rehearsalUploadPendingSentence(count: number): string {
  return `대화 ${count}개를 서버에 올리지 못했습니다. 연결을 확인한 뒤 다시 보내세요.`;
}
