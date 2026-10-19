/**
 * TUX-COND-07 — the inline end-of-trial card (REQ-L12 ①②, CU-13/14, INT-ACCESS-05).
 * Pure: no VS Code API, no DOM. The host decides and builds the view; the chat renders it.
 *
 * When a free trial's turn ends because the trial ran out (requests or time), the chat shows
 * one inline card instead of an error: facts first (files and conversation stay; the Service's
 * own pass facts), one Primary "이용권 살펴보기" and the escape "오늘은 여기까지". The card never
 * opens the purchase view by itself, never counts down and is never shown mid-work.
 *
 * Default off. The card follows the Service's own open-trial switch: it is drawn only for a seat
 * whose `/v1/profile` says `profile_id: "studio-open-trial"`, `activity_kind: "trial"` and no
 * `pass` block. The Service serves that profile only while `HPS_OPEN_TRIAL === "enabled"`
 * (Service ot-open-profile); with the switch off no seat has it, so every turn ends exactly as
 * before. Code-issued trials (`studio-native-trial`) and bought passes never get the card.
 * No new `/v1/profile` field is read: `profile_id`, `activity_kind` and `pass` are already served.
 *
 * The two trial sentences are the ones observed on 2026-10-18 (SDK 0.3.299); the Service sends
 * them without a code. The cost-ceiling refusal (`trial_cost_exhausted`) reaches Studio through the
 * SDK as its sentence only, so that sentence counts as "exhausted" too (observed 2026-10-19 against
 * the local Worker). The bare `trial_exhausted` / `trial_cost_exhausted` codes count only off a
 * bought pass, because the Service uses the same code for both. (Studio #1765 matches the same sentences for its notice.)
 */
import type { ResolvedProfile, TrialEndCardView, TrialEndNotifyView } from "./protocol.ts";
import { FREE_EXHAUSTED_SERVICE, FREE_EXPIRED_SERVICE, defaultProduct, fetchProducts, passFacts, type PassProduct } from "./passPurchase.ts";

export type TrialEnding = TrialEndCardView["ending"];

/** The Service profile id of the open trial's free tier (Service `profiles/studio-open-trial.ts`). */
export const OPEN_TRIAL_PROFILE_ID = "studio-open-trial";

export const TRIAL_END_CARD_COPY = {
  // Free start (SPEC iteration 4 §2.4): the free allowance is never called a 체험.
  titleExhausted: "무료 사용량을 모두 썼습니다",
  titleExpired: "무료 사용 시간이 끝났습니다",
  kept: "만든 파일은 작업 폴더에 그대로 있습니다. 대화도 계속 볼 수 있습니다.",
  needPass: "이어서 작업하려면 이용권이 필요합니다.",
  noRenewal: "한 번만 결제하며 자동으로 다시 결제되지 않습니다.",
  primary: "이용권 살펴보기",
  escape: "오늘은 여기까지",
} as const;

/**
 * TUX-COND-08 — the optional email section (Jay 2026-10-19). Draft copy in 해요체, pending Jay's
 * final wording. Advertising consent (정보통신망법 §50) is explicit: nothing is pre-checked and
 * pressing 받기 is the agreement, with the items named right above the button.
 */
export const NOTIFY_OPTIN_COPY = {
  prompt: "새 기능과 할인 소식을 이메일로 받아 볼래요? (선택)",
  label: "이메일",
  placeholder: "이메일 주소",
  button: "받기",
  consent: "이메일은 HypeProof 소식을 보내는 데만 쓰고, 언제든 그만 받을 수 있어요. 받기를 누르면 [수집 항목: 이메일 · 목적: 서비스·할인 소식 안내 · 보관: 수신 거부 또는 1년 뒤 삭제]에 동의하는 거예요.",
  done: "소식을 보내 드릴게요.",
  withdraw: "그만 받기",
  withdrawn: "이제 소식을 보내지 않을게요.",
} as const;

/** Whether this turn ended because the free trial ran out. Anything else is not the end of a trial. */
export function trialEndReason(err: unknown, onPass: boolean): TrialEnding | null {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof m !== "string") return null;
  if (/개인 체험의 총 요청 한도에 도달했습니다/.test(m)) return "exhausted";
  // The trial's AI cost ceiling (Service `trial_cost_exhausted`, 429). The SDK surfaces only the
  // sentence, so the sentence is matched; the code is matched for clients that pass it through.
  if (/체험에서 쓸 수 있는 AI 사용량을 모두 썼습니다/.test(m)) return "exhausted";
  if (/개인 체험 시간이 끝났습니다/.test(m)) return "expired";
  // The Service's free-grant sentences (SPEC iteration 4 §1.3), as separate whole phrases.
  if (FREE_EXHAUSTED_SERVICE.test(m)) return "exhausted";
  if (FREE_EXPIRED_SERVICE.test(m)) return "expired";
  if (!onPass && /\btrial_(?:cost_)?exhausted\b/.test(m)) return "exhausted";
  return null;
}

type ProfileFacts = Pick<ResolvedProfile, "activity_kind" | "pass" | "profile_id"> & Partial<Pick<ResolvedProfile, "notify_optin">>;

/** Whether this seat is an open-trial free-tier seat at all (cheap; no network). */
export function endCardAdvertised(profile: ProfileFacts | null | undefined): boolean {
  return !!profile && !profile.pass && profile.activity_kind === "trial" && profile.profile_id === OPEN_TRIAL_PROFILE_ID;
}

/**
 * TUX-COND-08 — the consent version when this free seat's Service offers the optional email
 * section, else null. Only on a seat that gets the end card at all, and only when the Service
 * says so (`notify_optin.available`); the Service advertises it to free seats only.
 */
export function notifyOptinOffered(profile: ProfileFacts | null | undefined): string | null {
  if (!profile || !endCardAdvertised(profile)) return null;
  const offer = profile.notify_optin as { available?: unknown; consent_version?: unknown } | undefined;
  if (!offer || offer.available !== true) return null;
  const v = offer.consent_version;
  return typeof v === "string" && /^[\w.-]{1,64}$/.test(v) ? v : null;
}

/** The end card's email section, or undefined when it is not offered. */
export function notifyOptinView(profile: ProfileFacts | null | undefined, submitted: boolean): TrialEndNotifyView | undefined {
  const consentVersion = notifyOptinOffered(profile);
  return consentVersion ? { consentVersion, submitted, ...NOTIFY_OPTIN_COPY } : undefined;
}

/** The card for this turn ending, or `null` when the turn ends as it does today. */
export function trialEndCardView(input: { profile: ProfileFacts | null | undefined; err: unknown; products: PassProduct[] | null | undefined; notifySubmitted?: boolean }): TrialEndCardView | null {
  const { profile, err, products } = input;
  // A bought pass, a classroom or a personal seat never gets a purchase card.
  if (!profile || !endCardAdvertised(profile)) return null;
  const ending = trialEndReason(err, false);
  if (!ending || !products?.length) return null;
  // The pass the Service itself suggests (`recommended`), else its first: the same one the
  // purchase list selects first, so the card never names a pass the list does not lead with.
  const product = defaultProduct(products);
  const title = ending === "exhausted" ? TRIAL_END_CARD_COPY.titleExhausted : TRIAL_END_CARD_COPY.titleExpired;
  const facts = [TRIAL_END_CARD_COPY.kept, `${TRIAL_END_CARD_COPY.needPass} ${passFacts(product)}`, TRIAL_END_CARD_COPY.noRenewal];
  const notify = notifyOptinView(profile, !!input.notifySubmitted);
  return { ending, title, facts, primary: TRIAL_END_CARD_COPY.primary, escape: TRIAL_END_CARD_COPY.escape, productId: product.id, text: [title, ...facts].join(" "), ...(notify ? { notify } : {}) };
}

/** One unauthenticated catalogue read, bounded so a slow Service never holds back the turn ending. */
export async function catalogueWithin(proxyUrl: string, timeoutMs = 3000): Promise<PassProduct[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchProducts(proxyUrl),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
