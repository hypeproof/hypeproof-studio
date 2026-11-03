// Seat-aware wording (trial diagnosis 2026-10-18, D3/D9; REQ-L14).
//
// A trial, a bought pass and personal work are solo seats: nobody named "강사", "스태프"
// or "운영 담당자" stands behind them, and "Jay" is a maintainer, not someone a stranger
// on a trial can reach. Classroom seats keep the wording they had, because there an
// instructor is in the room and that sentence is the correct remedy.
//
// Pure: no vscode, no DOM, no Node imports. Both the extension host and the webview
// import this file.

export type SeatAudience = "solo" | "classroom";

/**
 * `kind` is the presentation-only activity kind (`activity_kind` on the profile,
 * `activity.kind` in the chat config). A bought pass is served as a trial seat, but
 * `pass` alone also makes it solo. Unknown or missing → classroom: an older profile
 * without a kind keeps the copy it always had.
 */
export function seatAudience(seat?: { kind?: string | null; pass?: unknown } | null): SeatAudience {
  if (!seat) return "classroom";
  if (seat.pass) return "solo";
  return seat.kind === "trial" || seat.kind === "personal" ? "solo" : "classroom";
}

/** Same rule, read from a resolved profile (`activity_kind` + `pass`). */
export function profileAudience(p?: { activity_kind?: string | null; pass?: unknown } | null): SeatAudience {
  return p ? seatAudience({ kind: p.activity_kind, pass: p.pass }) : "classroom";
}

/** Where a solo learner can actually go: the report flow exists on every seat. */
const SOLO_REPORT_HINT = "계속되면 ‘문제 신고하기’로 알려 주세요.";

/** Generic transport failure card (proxy non-OK without a specific message). */
export const TRANSPORT_FAILURE_CLASSROOM = "문제가 발생했습니다. 다시 시도하거나 운영 담당자에게 문의해 주세요.";
export const TRANSPORT_FAILURE_SOLO = `문제가 발생했습니다. 잠시 후 다시 시도하고, ${SOLO_REPORT_HINT}`;
export const transportFailureText = (a: SeatAudience): string =>
  a === "solo" ? TRANSPORT_FAILURE_SOLO : TRANSPORT_FAILURE_CLASSROOM;

/** SDK stream stalled on a 429. */
export const RATE_LIMIT_STALL_CLASSROOM =
  "요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도하거나 강사에게 체험 한도를 확인해 주세요. (429)";
export const RATE_LIMIT_STALL_SOLO = "요청 한도에 도달해 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요. (429)";
export const rateLimitStallText = (a: SeatAudience): string =>
  a === "solo" ? RATE_LIMIT_STALL_SOLO : RATE_LIMIT_STALL_CLASSROOM;

/** Remedy sentence that ends the SDK-degraded notice (`coachDegradedNotice`). */
export const degradedRemedy = (a: SeatAudience): string =>
  a === "solo" ? `도움이 필요하면 ‘문제 신고하기’로 알려 주세요.` : "스태프를 불러주세요.";

/** Hover titles on the chat error banner. */
export const errorIdTitle = (a: SeatAudience): string =>
  a === "solo" ? "문제를 신고할 때 이 ID가 함께 전달돼요" : "강사에게 이 ID를 알려주세요 — Jay가 바로 추적할 수 있어요";
export const reportButtonTitle = (a: SeatAudience): string =>
  a === "solo"
    ? "이 문제를 신고합니다 (request_id 등 메타데이터 자동 첨부)"
    : "이 문제를 Jay에게 신고합니다 (request_id 등 메타데이터 자동 첨부) — #64";

/** Report-problem flow (command palette and the banner's 신고하기). */
export const reportContactPrompt = (a: SeatAudience): string =>
  a === "solo"
    ? "회신받을 연락처 (이메일 등). 비워 둬도 돼요."
    : "Jay가 회신할 수 있는 연락처 (디스코드 ID, 이메일 등). 비워둬도 OK.";
export const reportContactPlaceholder = (a: SeatAudience): string =>
  a === "solo" ? "이메일 (선택)" : "tj.kr (선택)";
export const reportReceipt = (a: SeatAudience, reportId: string): string =>
  a === "solo"
    ? `신고 접수됐어요. ID: ${reportId}\n연락처를 남기셨다면 확인하는 대로 회신드릴게요.`
    : `신고 접수됐어요. ID: ${reportId}\nJay가 #hypeproof-studio 채널에서 확인하는 대로 회신드릴게요.`;

/** Words a solo seat must never see in the copy above (used by the smoke test). */
export const CLASSROOM_ONLY_WORDS = ["스태프", "강사", "운영 담당자", "Jay"] as const;

// ── Free start (SPEC iteration 4 §2.4) ────────────────────────────────────────────────────────
// The free allowance a newcomer gets without a code is served as the open-trial profile. Its
// learner-facing copy never says 체험 and never points at a class; code-issued trials
// (`studio-native-trial`) and bought passes keep their wording.

/** The Service profile id of the free allowance (Service `profiles/studio-open-trial.ts`). */
export const FREE_PROFILE_ID = "studio-open-trial";

/** A seat on the free allowance: the open-trial profile and no bought pass. */
export function isFreeSeat(p?: { profile_id?: string | null; id?: string | null; pass?: unknown } | null): boolean {
  if (!p || p.pass) return false;
  return (p.profile_id ?? p.id) === FREE_PROFILE_ID;
}

/**
 * REQ-STUDIO-FREE-START — how many folders a free seat may work in: its served home and the
 * numbered siblings Studio creates itself when that home is held (`<home>-2` … `<home>-20`).
 */
export const FREE_FOLDER_COUNT = 20;
