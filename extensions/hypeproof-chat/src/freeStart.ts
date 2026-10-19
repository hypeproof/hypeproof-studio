/**
 * Free start (SPEC iteration 4 §2; TUX-SP-14/15/16, US-19). Pure: no VS Code API, no DOM.
 *
 * A newcomer opens Studio and starts right away: one age question, then one unauthenticated
 * `POST /v1/free/claim` with a per-install id, then the ordinary entry path (`connectCourse` →
 * `beginCourse`) with the participant token the Service issued. The host owns every secret: the
 * install id and the issued token never reach a webview, a log line or a funnel event.
 *
 * Inert unless the Service advertises it (`freeStartAdvertised` in trialOffer.ts). The local
 * kill switch `hypeproofChat.freeStart: "off"` forces today's start page.
 */
import { FREE_CLAIM_PATH } from "./trialOffer.ts";

/** SecretStorage key for the install id (globalState fallback under the same key). */
export const INSTALL_ID_KEY = "hypeproofChat.installId.v1";
/** globalState key for the age answer. Never sent anywhere except as `age_ok` on the claim. */
export const AGE_KEY = "hypeproofChat.freeStart.age.v1";
/** globalState key for "the person paying is 19 or older" on a free seat (§2.5). */
export const PAYER_ADULT_KEY = "hypeproofChat.freeStart.payerAdult.v1";

export type AgeAnswer = "14+" | "under14";
export const isAgeAnswer = (v: unknown): v is AgeAnswer => v === "14+" || v === "under14";

/** Learner-facing copy (합니다체, the start page's register). Never 체험, never 수업. */
export const FREE_START_COPY = {
  ageTitle: "시작하기 전에 한 가지만 확인합니다",
  ageQuestion: "만 14세 이상인가요?",
  ageYes: "네, 만 14세 이상입니다",
  ageNo: "아니요, 만 14세 미만입니다",
  readyTitle: "바로 시작할 수 있습니다",
  start: "바로 시작하기",
  preparing: "작업 공간을 준비하고 있습니다.",
  codeLink: "참여 코드가 있어요",
  passLink: "이용권으로 시작하기",
  codeLabel: "참여 코드",
  codeFooter: "강사나 운영자에게 받은 코드를 붙여 넣으세요.",
  network: "연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
  update: "업데이트 확인",
  dailyCapStart: "오늘 준비한 무료 사용량이 모두 소진되었습니다. 밤 12시(한국 시간) 이후에 다시 시작할 수 있습니다.",
  pausedStart: "지금은 무료 사용을 잠시 멈췄습니다. 잠시 뒤 다시 시도해 주세요.",
  under14Title: "보호자와 함께 시작해 주세요",
  under14Body: "만 14세 미만은 보호자의 동의가 있어야 사용할 수 있습니다. 지금은 앱에서 보호자 동의를 받을 수 없어 여기서 시작할 수 없습니다.",
  guardianLink: "보호자 안내 보기 ↗",
  payerQuestion: "결제하는 분이 만 19세 이상인가요?",
  payerYes: "네",
  payerNo: "아니요",
  guardianPay: "보호자에게 결제 요청하기",
  guardianPayHelp: "결제는 보호자가 해 주세요. 보호자 휴대폰으로 이 QR을 열면 결제 페이지가 열립니다.",
} as const;

/** Refusal sentences the Service sends (SPEC §1.2). Used only when its answer carries no readable sentence. */
export const FREE_CLAIM_REFUSALS: Record<string, string> = {
  invalid_body: "요청을 처리하지 못했습니다. Studio를 다시 열어 주세요.",
  under_14: "만 14세 미만은 보호자의 동의가 있어야 사용할 수 있습니다. 지금은 앱에서 보호자 동의를 받을 수 없어 여기서 시작할 수 없습니다. 보호자와 함께 안내 페이지를 확인해 주세요.",
  allowance_revoked: "이 컴퓨터의 무료 사용량은 더 이상 쓸 수 없습니다. 이어서 쓰려면 이용권을 확인해 주세요.",
  app_too_old: "이 Studio는 바로 시작하기를 지원하지 않는 버전입니다. 최신 Studio로 업데이트한 뒤 다시 열어 주세요.",
  network_limit: "이 네트워크에서 오늘 시작할 수 있는 횟수를 모두 사용했습니다. 내일 다시 시도하거나, 참여 코드나 이용권으로 시작해 주세요.",
  rate_limited: "요청이 많아 잠시 기다려야 합니다. 1분 뒤 다시 시도해 주세요.",
  claim_busy: "이전 요청을 마무리하고 있습니다. 잠시 뒤 다시 시도해 주세요.",
  daily_cap_reached: "오늘 준비한 무료 사용량이 모두 소진되었습니다. 밤 12시(한국 시간) 이후에 다시 시작할 수 있습니다. 참여 코드나 이용권이 있다면 지금 바로 시작할 수 있습니다.",
  paused: "지금은 무료 사용을 잠시 멈췄습니다. 잠시 뒤 다시 시도해 주세요.",
  free_start_unavailable: "지금은 바로 시작하기를 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요.",
};
const UNKNOWN_REFUSAL = FREE_CLAIM_REFUSALS.free_start_unavailable!;

/** What the start page shows for a refusal. `code` steers layout only; `message` is shown as given. */
export interface FreeClaimRefusal { code: string; message: string; resumesAt?: string }
export type FreeClaimResult =
  | { ok: true; outcome: "granted" | "reused"; code: string; profile: string; expiresAt?: number }
  | ({ ok: false; status: number } & FreeClaimRefusal);

const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isInstallId = (v: unknown): v is string => typeof v === "string" && INSTALL_ID_RE.test(v);
/** Same bound as the Service (`APP_VERSION_RE` in lib/free-start.ts). Releases are calendar versions (`2026.1017.0`). */
const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,5})(?:-([0-9A-Za-z.]{1,16}))?$/;

/** Semver order for `x.y.z[-pre]`: a prerelease sorts before its release. `null` when either is malformed. */
export function compareVersions(a: string, b: string): number | null {
  const x = VERSION_RE.exec(a), y = VERSION_RE.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return Math.sign(d); }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  return x[4] < y[4] ? -1 : 1;
}

/** This build is below the Service's floor (known before any claim is made). */
export function belowFloor(appVersion: string, floor: string | undefined): boolean {
  if (!floor) return false;
  const c = compareVersions(appVersion, floor);
  return c !== null && c < 0;
}

/** The claim URL from the configured Service base (`…/v1`), like `trialEventsUrl`. */
export function freeClaimUrl(proxyUrl: string): string {
  return proxyUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + FREE_CLAIM_PATH;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** A sentence a person can read: Korean, bounded. Anything else is replaced by the local copy. */
const readable = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 400 && /[가-힣]/.test(v);

export function parseClaimRefusal(status: number, body: unknown): FreeClaimRefusal {
  const err = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = typeof err?.code === "string" && /^[a-z0-9_]{1,40}$/.test(err.code) ? err.code : status === 404 ? "free_start_unavailable" : "unknown";
  const message = readable(err?.message) ? err!.message as string : FREE_CLAIM_REFUSALS[code] ?? UNKNOWN_REFUSAL;
  const resumes = err?.resumes_at;
  return { code, message, ...(typeof resumes === "string" && !Number.isNaN(Date.parse(resumes)) ? { resumesAt: resumes } : {}) };
}

export function parseClaimSuccess(body: unknown): Extract<FreeClaimResult, { ok: true }> | null {
  if (!isRecord(body) || (body.outcome !== "granted" && body.outcome !== "reused")) return null;
  if (typeof body.code !== "string" || body.code.length < 20 || body.code.length > 4096) return null;
  if (typeof body.profile !== "string" || !body.profile) return null;
  const expiresAt = typeof body.expires_at === "number" && Number.isFinite(body.expires_at) ? body.expires_at : undefined;
  return { ok: true, outcome: body.outcome, code: body.code, profile: body.profile, ...(expiresAt ? { expiresAt } : {}) };
}

/**
 * One claim. Never throws. A network failure is `{status: 0, code: "network"}` with the network
 * sentence; a malformed 200 is treated as `free_start_unavailable` (no token is invented).
 */
export async function claimFreeStart(args: { proxyUrl: string; installId: string; appVersion: string; ageOk: boolean; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<FreeClaimResult> {
  const f = args.fetchImpl ?? fetch;
  try {
    const r = await f(freeClaimUrl(args.proxyUrl), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ install_id: args.installId, app_version: args.appVersion, age_ok: args.ageOk }),
      redirect: "error",
      signal: AbortSignal.timeout(args.timeoutMs ?? 20_000),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 200) {
      const ok = parseClaimSuccess(body);
      return ok ?? { ok: false, status: 200, code: "free_start_unavailable", message: UNKNOWN_REFUSAL };
    }
    return { ok: false, status: r.status, ...parseClaimRefusal(r.status, body) };
  } catch {
    return { ok: false, status: 0, code: "network", message: FREE_START_COPY.network };
  }
}

/** The Lab guardian section the under-14 block links to. */
export const guardianUrl = (siteBase: string) => `${siteBase.replace(/\/+$/, "")}/studio#guardian`;

/** The allowance line before the first message (SPEC §2.4 candidate allowance). */
export function freeAllowanceLine(offer: { requestLimit?: number; durationHours?: number; unit?: string } | null | undefined): string | null {
  if (!offer?.requestLimit || !offer.durationHours) return null;
  const hours = Math.round(offer.durationHours);
  return `무료 AI 요청 ${offer.requestLimit.toLocaleString("ko-KR")}번 · 첫 요청부터 ${hours}시간`;
}
