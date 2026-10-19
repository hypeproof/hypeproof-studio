// REQ-M45 — a seat that can only run on the Agent SDK must not fall back to the
// proxy when the native `claude` binary does not resolve, and must say why and
// what to do in one Korean sentence the learner can act on alone.
//
// Pure: no `vscode`, so the copy and the routing decision are unit-testable
// (test/sdk-required.test.mjs). chatPanelProvider.ts and proxyClient.ts only call in.
//
// Why: a native-trial or paid-pass grant is refused on `/v1/chat/completions` by the
// Service (409 `trial_requires_sdk`, "이 체험은 최신 Studio에서 실행해 주세요."). The REQ-M7
// proxy fallback therefore spent an attempt and then showed a generic or misleading
// message; the pass branch even surfaced the English SdkUnavailableError text. The
// public app zip ships without the binary, so this is the first thing a code-holder
// who installed from the website sees.

import type { ResolvedProfile } from "./protocol";

/** Where a non-member gets the installer that also seeds the SDK binary (Lab `/studio/install`). */
export const SDK_INSTALL_PAGE = "hypeproof-ai.xyz/studio/install";

/**
 * Cause + remedy. No staff, instructor or operator: a solo seat has nobody to call. No retry: resending cannot help.
 * No code either: an open-trial seat was never issued one, and the Lab page decides whether a code is
 * asked (HPS_STUDIO_OPEN_INSTALL, Lab card lab-open-install-scripts), so the notice defers to the page.
 */
export const SDK_MISSING_NOTICE =
  "이 Studio에는 AI 작업 도구(Agent SDK 실행 파일)가 설치되어 있지 않아 코치를 실행할 수 없어요. " +
  `${SDK_INSTALL_PAGE} 의 안내대로 설치 도구를 내려받아 실행한 뒤 Studio를 다시 열어 주세요. ` +
  "대화와 작업은 그대로 남아 있어요.";

/**
 * The seat runs only on the Agent SDK route: the Service refuses the proxy route for
 * native-trial grants (`activity_kind: "trial"`), and a bought pass is such a grant.
 */
export function profileRequiresSdk(profile: Pick<ResolvedProfile, "activity_kind" | "pass"> | null | undefined): boolean {
  return !!profile && (profile.activity_kind === "trial" || !!profile.pass);
}

/** A seat with no instructor or staff in the room: trial, personal account or pass. */
export function isSoloSeat(profile: Pick<ResolvedProfile, "activity_kind" | "pass"> | null | undefined): boolean {
  return !!profile && (profile.activity_kind === "trial" || profile.activity_kind === "personal" || !!profile.pass);
}

/**
 * The turn failed because the seat needs the SDK and this install cannot run it.
 * `retry: false` tells the panel not to offer "다시 보내기" (protocol `streamError.retry`).
 */
export class SdkRequiredError extends Error {
  readonly retry = false as const;
  requestId?: string;
  constructor(message: string = SDK_MISSING_NOTICE, requestId?: string) {
    super(message);
    this.name = "SdkRequiredError";
    this.requestId = requestId;
  }
}

/** Existing classroom copy, kept verbatim (negative control for this change). */
export const CLASSROOM_WEB_SEARCH_SDK_MISSING =
  "웹 검색 실행 환경을 사용할 수 없습니다. SDK 연결을 확인하거나 웹 검색 선택을 해제해 주세요.";
export const CLASSROOM_MODEL_SDK_MISSING =
  "선택한 모델의 실행 환경을 사용할 수 없습니다. Studio의 Agent SDK 설치를 확인하거나 강사에게 알려주세요. 대화와 작업은 보존됩니다.";

export type SdkUnavailableOutcome =
  | { kind: "fallback" }
  | { kind: "fail"; error: Error; requiredSdk: boolean };

/**
 * What to do after `runSdkCoach` threw SdkUnavailableError.
 *
 * - SDK-only seat, or a pass picked as the funding source → fail with the install notice.
 *   Every branch (default, web search, model picked, pass picked) gets the same sentence.
 * - Classroom seat → today's behavior: web search and a picked model fail with their
 *   existing copy; otherwise the REQ-M7 proxy fallback runs.
 */
export function sdkUnavailableOutcome(args: {
  profile: Pick<ResolvedProfile, "activity_kind" | "pass"> | null | undefined;
  fundingSource?: string;
  webSearch: boolean;
  modelPicked: boolean;
}): SdkUnavailableOutcome {
  if (profileRequiresSdk(args.profile) || args.fundingSource) {
    return { kind: "fail", error: new SdkRequiredError(), requiredSdk: true };
  }
  if (args.webSearch) return { kind: "fail", error: new Error(CLASSROOM_WEB_SEARCH_SDK_MISSING), requiredSdk: false };
  if (args.modelPicked) return { kind: "fail", error: new Error(CLASSROOM_MODEL_SDK_MISSING), requiredSdk: false };
  return { kind: "fallback" };
}

/**
 * The Service's 409 `trial_requires_sdk` reached the proxy route anyway (an older app
 * fallback, a machine `coachRuntime` override). Keep the Service's sentence and add the
 * cause and remedy. Returns null for any other response.
 */
export function trialRequiresSdkMessage(status: number, bodyText: string): string | null {
  if (status !== 409) return null;
  let parsed: { error?: { code?: unknown; message?: unknown } } | null = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (parsed?.error?.code !== "trial_requires_sdk") return null;
  const serverMsg = typeof parsed.error.message === "string" ? parsed.error.message.trim() : "";
  return serverMsg ? `${serverMsg} ${SDK_MISSING_NOTICE}` : SDK_MISSING_NOTICE;
}
