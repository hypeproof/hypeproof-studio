export interface ErrorBannerPresentation {
  icon: string;
  title: string;
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

/** Keep account-state notices distinct from generic authentication failures. */
export function errorBannerPresentation(message: string): ErrorBannerPresentation {
  const isAuth = /참여 코드|토큰|세션|강사|만료|등록|인가/.test(message);
  const isConn = /연결|네트워크|시간|타임아웃|중단|stream|interrupt|abort|timed? ?out/i.test(message);
  // REQ-L12 — a spent, refunded or ended pass is an account state, not a fault.
  const isPass = /이용권|환불/.test(message);
  // Free start (SPEC iteration 4 §2.4) — the free seat's own sentences come first: today's drained
  // budget says "시간" and would otherwise read as a lost connection. Whole phrases only.
  // Free start D4 (TUX-SP-16) — the drained daily cap is a calm notice, never a problem to report.
  if (/오늘 준비한 무료 사용량이 모두 소진되었습니다/.test(message)) return { icon: "🌙", title: "오늘 무료 사용량이 모두 소진됐어요", tone: "notice" };
  if (/무료로 쓸 수 있는 AI 요청을 모두 썼(?:어요|습니다)/.test(message)) return { icon: "⏳", title: "무료 사용량을 모두 썼어요" };
  if (/무료 사용 시간이 끝났(?:어요|습니다)/.test(message)) return { icon: "⏳", title: "무료 사용 시간이 끝났어요" };
  // REQ-L12 (13) — a free trial that ran out is checked first: its copy says "시간" and may name
  // '이용권으로 시작하기', but it is neither a network drop nor a spent pass.
  if (/체험에서 쓸 수 있는 AI 요청을 모두 썼어요|체험 시간이 끝났어요/.test(message)) return { icon: "⏳", title: "체험이 끝났어요" };
  // An ended trial is also account state. Checked before the connection frame because
  // "체험 시간이 끝났습니다" contains "시간" and used to read as a lost connection.
  const isTrialEnd = !isPass && TRIAL_END.test(message);
  // REQ-M45 — the app lacks the Agent SDK binary: an install step, not a lock or a fault.
  const isInstall = /설치 도구/.test(message);
  return {
    icon: isPass ? "🎟️" : isTrialEnd ? "⏳" : isInstall ? "🧰" : isAuth ? "🔒" : isConn ? "🔌" : "⚠️",
    title: isPass
      ? "이용권을 더 쓸 수 없어요"
      : isTrialEnd
        ? "체험이 끝났어요"
        : isInstall
          ? "설치를 마무리해야 해요"
          : isAuth
            ? "잠시 멈춰요"
            : isConn
              ? "연결이 끊겼어요"
              : "문제가 생겼어요",
  };
}
