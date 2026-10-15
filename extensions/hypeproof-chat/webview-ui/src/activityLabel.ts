import type { PassStatus } from "../../src/protocol";

type Kind = "trial" | "personal" | "classroom" | undefined;

/**
 * REQ-L12 — a bought pass is served as a trial seat, so the kind alone would call a paid pass
 * "AI 체험" (in-app purchase rehearsal, 2026-10-14). The Service's `pass` block decides.
 */
export function activityLabel(kind: Kind, pass?: unknown, fallback = "개인 작업"): string {
  if (pass) return "이용권";
  return kind === "trial" ? "AI 체험" : kind === "classroom" ? "수업" : kind === "personal" ? "개인 작업" : fallback;
}

/** What is left on a pass, in the purchase copy's 해요체. The count is as of the last profile read. */
export function passSummary(pass: PassStatus | undefined, now = Date.now()): string | null {
  if (!pass) return null;
  if (pass.expires_at && pass.expires_at <= now) return "이용 기간이 끝났어요";
  const left = Math.max(0, pass.request_limit - pass.requests_used);
  if (left === 0) return "AI 요청을 모두 썼어요";
  const end = pass.expires_at ? new Date(pass.expires_at) : null;
  return `AI 요청 ${left.toLocaleString("ko-KR")}번 남음` + (end ? ` · ${end.getMonth() + 1}월 ${end.getDate()}일까지` : "");
}

/** The end of a pass for the chat header. The count is left out there: it changes every turn and the header is not re-read. */
export function passEnd(pass: PassStatus | undefined): string | null {
  if (!pass?.expires_at) return null;
  const end = new Date(pass.expires_at);
  return `${end.getMonth() + 1}월 ${end.getDate()}일까지`;
}
