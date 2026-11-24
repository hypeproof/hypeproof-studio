import { TRIAL_EXHAUSTED_FRIENDLY, TRIAL_EXPIRED_FRIENDLY } from "../../src/passPurchase.ts";

export interface ErrorBannerPresentation {
  icon: string;
  title: string;
  /**
   * #4193 — shown instead of the message when the message is a seat ending worded as 체험 (a
   * Service sentence the host did not map, or an older host's copy). Absent: the message is shown.
   */
  body?: string;
  /**
   * "notice" — an expected, scheduled state rather than a fault: rendered calm (status, not
   * alert), without the problem-report action, retry or request id. Absent means a fault.
   */
  tone?: "notice";
}

/**
 * An ended or spent personal trial: the Service's `trial_expired` / `trial_exhausted`
 * sentences and the host's expiry copy. Only sentences that state the ending count;
 * "busy or exhausted" copy cannot prove the trial ended and is left alone.
 */
const TRIAL_END = /체험[^.]*?(시간이 끝났|기간이 끝났|한도에 도달|횟수를 모두 썼|요청을 모두 썼)/;
/** The host's own ending copy for a seat that is not free, current (이 활동) and earlier (체험). */
const SEAT_END_COPY = /이 활동에서 쓸 수 있는 AI 요청을 모두 썼어요|이 활동의 사용 시간이 끝났어요|체험에서 쓸 수 있는 AI 요청을 모두 썼어요|체험 시간이 끝났어요/;
/** #4193 — the banner never prints 체험: an ending worded that way is replaced by Studio's own sentence. */
function endingBody(message: string): { body?: string } {
  if (!/체험/.test(message)) return {};
  return { body: /(시간|기간)이 끝났/.test(message) ? TRIAL_EXPIRED_FRIENDLY : TRIAL_EXHAUSTED_FRIENDLY };
}

/** Keep account-state notices distinct from generic authentication failures. */
export function errorBannerPresentation(message: string): ErrorBannerPresentation {
  const isAuth = /참여 코드|토큰|세션|강사|만료|등록|인가/.test(message);
  const isConn = /연결|네트워크|시간|타임아웃|중단|stream|interrupt|abort|timed? ?out/i.test(message);
  // REQ-L12 — a spent, refunded or ended pass is an account state, not a fault.
  // Mentioning a pass as a troubleshooting step does not prove it has ended.
  const isPass = /환불|이용권(?:의 AI 요청(?:을| 횟수를) 모두 썼| 기간이 끝|을 더 쓸 수 없)/.test(message);
  const isRateLimited = /\b429\b|요청이 제한/.test(message);
  // Free start (SPEC iteration 4 §2.4) — the free seat's own sentences come first: today's drained
  // budget says "시간" and would otherwise read as a lost connection. Whole phrases only.
  // Free start D4 (TUX-SP-16) — the drained daily cap is a calm notice, never a problem to report.
  if (/오늘 준비한 무료 사용량이 모두 소진되었습니다/.test(message)) return { icon: "🌙", title: "오늘 무료 사용량이 모두 소진됐어요", tone: "notice" };
  if (/무료로 쓸 수 있는 AI 요청을 모두 썼(?:어요|습니다)/.test(message)) return { icon: "⏳", title: "무료 사용량을 모두 썼어요" };
  if (/무료 사용 시간이 끝났(?:어요|습니다)/.test(message)) return { icon: "⏳", title: "무료 사용 시간이 끝났어요" };
  // REQ-L12 (13) — a free trial that ran out is checked first: its copy says "시간", but it is
  // neither a network drop nor a spent pass.
  if (SEAT_END_COPY.test(message)) return { icon: "⏳", title: "사용이 끝났어요", ...endingBody(message) };
  // An ended trial is also account state. Checked before the connection frame because
  // the Service's "개인 체험 시간이 끝났습니다" contains "시간" and used to read as a lost connection.
  const isTrialEnd = !isPass && TRIAL_END.test(message);
  // REQ-M45 — the app lacks the Agent SDK binary: an install step, not a lock or a fault.
  const isInstall = /설치 도구/.test(message);
  return {
    ...(isTrialEnd ? endingBody(message) : {}),
    icon: isPass ? "🎟️" : isTrialEnd ? "⏳" : isInstall ? "🧰" : !isRateLimited && isAuth ? "🔒" : !isRateLimited && isConn ? "🔌" : "⚠️",
    title: isPass
      ? "이용권을 더 쓸 수 없어요"
      : isTrialEnd
        ? "사용이 끝났어요"
        : isInstall
          ? "설치를 마무리해야 해요"
          : isRateLimited
            ? "AI 요청이 제한됐어요"
            : isAuth
            ? "잠시 멈춰요"
            : isConn
              ? "연결이 끊겼어요"
              : "문제가 생겼어요",
  };
}
