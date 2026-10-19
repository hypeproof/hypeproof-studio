import type { PassStatus, TrialStatus } from "../../src/protocol";

type Kind = "trial" | "personal" | "classroom" | undefined;

/**
 * REQ-L12 — a bought pass is served as a trial seat, so the kind alone would call a paid pass
 * "AI 체험" (in-app purchase rehearsal, 2026-10-14). The Service's `pass` block decides.
 */
export function activityLabel(kind: Kind, pass?: unknown, fallback = "개인 작업", free = false): string {
  if (pass) return "이용권";
  // Free start (SPEC iteration 4 §2.4) — the free allowance is not called a 체험.
  if (free) return "무료 사용";
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

// ── TUX-SP-13 — a one-hour trial seat (CU-13, trial diagnosis C2/U3) ─────────────────────────────
// Only values the Service confirmed in its `trial` block are shown. A malformed block shows
// nothing: never 0, never unlimited, never a guessed end time.

type Trial = { limit: number; used: number; end: Date | null; state: TrialStatus["state"] };

function readTrial(trial: unknown): Trial | null {
  if (!trial || typeof trial !== "object") return null;
  const t = trial as Partial<TrialStatus>;
  const limit = t.request_limit, used = t.requests_used;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return null;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  const end = typeof t.ends_at === "string" ? new Date(t.ends_at) : null;
  return { limit, used, end: end && !Number.isNaN(end.getTime()) ? end : null, state: t.state ?? "active" };
}

/** "오후 3시 20분", with the date in front when it is not today. The learner's own clock. */
function clock(at: Date, now: number): string {
  const h = at.getHours(), m = at.getMinutes();
  const time = `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${m ? ` ${m}분` : ""}`;
  return new Date(now).toDateString() === at.toDateString() ? time : `${at.getMonth() + 1}월 ${at.getDate()}일 ${time}`;
}

/** Expiry first, with the chat gate's boundary (`ends_at <= now`); then the count. */
export function trialEnded(trial: TrialStatus | undefined | unknown, now = Date.now()): "exhausted" | "expired" | null {
  const t = readTrial(trial);
  if (!t) return null;
  if (t.state === "expired" || (t.end && t.end.getTime() <= now)) return "expired";
  if (t.state === "exhausted" || t.used >= t.limit) return "exhausted";
  return null;
}

/**
 * The candidate card's allowance, before "이 활동 시작하기". A free seat says 무료; before its
 * first message it has no end yet, so the window is named only when the Service advertised it.
 */
export function trialAllowance(trial: TrialStatus | undefined | unknown, now = Date.now(), free = false, windowHours?: number): string | null {
  const t = readTrial(trial);
  if (!t) return null;
  const head = `${free ? "무료 " : ""}AI 요청 ${t.limit.toLocaleString("ko-KR")}번`;
  if (t.end) return `${head} · ${clock(t.end, now)}까지`;
  return free && windowHours ? `${head} · 첫 요청부터 ${Math.round(windowHours)}시간` : head;
}

/** What is left, as of the last profile read. Null once ended: the ended card says that. */
export function trialSummary(trial: TrialStatus | undefined | unknown, now = Date.now(), free = false): string | null {
  const t = readTrial(trial);
  if (!t || trialEnded(trial, now)) return null;
  return `${free ? "무료 " : ""}AI 요청 ${(t.limit - t.used).toLocaleString("ko-KR")}번 남음` + (t.end ? ` · ${clock(t.end, now)}까지` : "");
}

/** The passive line in the chat header. Text only; it never carries a button (CU-13, no upgrade pressure). */
export function trialHeaderLine(trial: TrialStatus | undefined | unknown, now = Date.now(), free = false): string | null {
  const ended = trialEnded(trial, now);
  if (ended === "expired") return free ? "무료 사용 시간 끝남" : "체험 시간 끝남";
  if (ended === "exhausted") return free ? "무료 AI 요청을 모두 사용함" : "체험 요청을 모두 사용함";
  return trialSummary(trial, now, free);
}

/** The ended card that replaces "이어서 하기" on the start page. 합니다체, the start page's register. */
export function trialEndedFacts(trial: TrialStatus | undefined | unknown, now = Date.now(), free = false): { reason: "exhausted" | "expired"; title: string; description: string; row: string } | null {
  const reason = trialEnded(trial, now);
  const t = readTrial(trial);
  if (!reason || !t) return null;
  const kept = "만든 파일은 작업 폴더에 그대로 있습니다.";
  if (free) return reason === "exhausted"
    ? { reason, title: "무료 사용이 끝났습니다", description: `무료 AI 요청을 모두 사용했습니다. ${kept}`, row: `무료 AI 요청 ${t.limit.toLocaleString("ko-KR")}번 모두 사용` }
    : { reason, title: "무료 사용이 끝났습니다", description: `무료 사용 시간이 끝났습니다. ${kept}`, row: t.end ? `${clock(t.end, now)}에 끝남` : "무료 사용 시간 끝남" };
  return reason === "exhausted"
    ? { reason, title: "체험이 끝났습니다", description: `AI 요청을 모두 사용했습니다. ${kept}`, row: `AI 요청 ${t.limit.toLocaleString("ko-KR")}번 모두 사용` }
    : { reason, title: "체험이 끝났습니다", description: `체험 시간이 끝났습니다. ${kept}`, row: t.end ? `${clock(t.end, now)}에 끝남` : "체험 시간 끝남" };
}

/** The chat header's detail after the activity name: a pass's end date, or a trial's remaining line. A pass always wins. */
export function activityDetail(activity: { pass?: PassStatus; trial?: TrialStatus; free?: boolean } | undefined, now = Date.now()): string | null {
  if (!activity) return null;
  if (activity.pass) return passEnd(activity.pass);
  return trialHeaderLine(activity.trial, now, !!activity.free);
}
