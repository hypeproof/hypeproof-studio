export interface ErrorBannerPresentation {
  icon: string;
  title: string;
}

/** Keep account-state notices distinct from generic authentication failures. */
export function errorBannerPresentation(message: string): ErrorBannerPresentation {
  const isAuth = /참여 코드|토큰|세션|강사|만료|등록|인가/.test(message);
  const isConn = /연결|네트워크|시간|타임아웃|중단|stream|interrupt|abort/i.test(message);
  // REQ-L12 — a spent, refunded or ended pass is an account state, not a fault.
  // Mentioning a pass as a troubleshooting step does not prove it has ended.
  const isPass = /환불|이용권(?:의 AI 요청(?:을| 횟수를) 모두 썼| 기간이 끝|을 더 쓸 수 없)/.test(message);
  const isRateLimited = /\b429\b|요청이 제한/.test(message);
  return {
    icon: isPass ? "🎟️" : isRateLimited ? "⚠️" : isAuth ? "🔒" : isConn ? "🔌" : "⚠️",
    title: isPass ? "이용권을 더 쓸 수 없어요" : isRateLimited ? "AI 요청이 제한됐어요" : isAuth ? "잠시 멈춰요" : isConn ? "연결이 끊겼어요" : "문제가 생겼어요",
  };
}
