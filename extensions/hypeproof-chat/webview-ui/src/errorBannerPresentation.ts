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
  // REQ-L12 (13) — a free trial that ran out is checked first: its copy says "시간" and may name
  // '이용권으로 시작하기', but it is neither a network drop nor a spent pass.
  if (/체험에서 쓸 수 있는 AI 요청을 모두 썼어요|체험 시간이 끝났어요/.test(message)) return { icon: "⏳", title: "체험이 끝났어요" };
  return {
    icon: isPass ? "🎟️" : isAuth ? "🔒" : isConn ? "🔌" : "⚠️",
    title: isPass ? "이용권을 더 쓸 수 없어요" : isAuth ? "잠시 멈춰요" : isConn ? "연결이 끊겼어요" : "문제가 생겼어요",
  };
}
