export interface ErrorBannerPresentation {
  icon: string;
  title: string;
}

/** Keep account-state notices distinct from generic authentication failures. */
export function errorBannerPresentation(message: string): ErrorBannerPresentation {
  const isAuth = /참여 코드|토큰|세션|강사|만료|등록|인가/.test(message);
  const isConn = /연결|네트워크|시간|타임아웃|중단|stream|interrupt|abort/i.test(message);
  // REQ-L12 — a spent, refunded or ended pass is an account state, not a fault.
  const isPass = /이용권|환불/.test(message);
  // REQ-M45 — the app lacks the Agent SDK binary: an install step, not a lock or a fault.
  const isInstall = /설치 도구/.test(message);
  return {
    icon: isPass ? "🎟️" : isInstall ? "🧰" : isAuth ? "🔒" : isConn ? "🔌" : "⚠️",
    title: isPass ? "이용권을 더 쓸 수 없어요" : isInstall ? "설치를 마무리해야 해요" : isAuth ? "잠시 멈춰요" : isConn ? "연결이 끊겼어요" : "문제가 생겼어요",
  };
}
