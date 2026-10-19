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
 * them without a code. The bare `trial_exhausted` code counts only off a bought pass, because the
 * Service uses the same code for both. (Studio #1765 matches the same sentences for its notice.)
 */
import type { ResolvedProfile, TrialEndCardView } from "./protocol.ts";
import { defaultProduct, fetchProducts, passFacts, type PassProduct } from "./passPurchase.ts";

export type TrialEnding = TrialEndCardView["ending"];

/** The Service profile id of the open trial's free tier (Service `profiles/studio-open-trial.ts`). */
export const OPEN_TRIAL_PROFILE_ID = "studio-open-trial";

export const TRIAL_END_CARD_COPY = {
  titleExhausted: "무료 체험을 모두 사용했습니다",
  titleExpired: "무료 체험 시간이 끝났습니다",
  kept: "만든 파일은 작업 폴더에 그대로 있습니다. 대화도 계속 볼 수 있습니다.",
  needPass: "이어서 작업하려면 이용권이 필요합니다.",
  noRenewal: "한 번만 결제하며 자동으로 다시 결제되지 않습니다.",
  primary: "이용권 살펴보기",
  escape: "오늘은 여기까지",
} as const;

/** Whether this turn ended because the free trial ran out. Anything else is not the end of a trial. */
export function trialEndReason(err: unknown, onPass: boolean): TrialEnding | null {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof m !== "string") return null;
  if (/개인 체험의 총 요청 한도에 도달했습니다/.test(m)) return "exhausted";
  if (/개인 체험 시간이 끝났습니다/.test(m)) return "expired";
  if (!onPass && /\btrial_exhausted\b/.test(m)) return "exhausted";
  return null;
}

type ProfileFacts = Pick<ResolvedProfile, "activity_kind" | "pass" | "profile_id">;

/** Whether this seat is an open-trial free-tier seat at all (cheap; no network). */
export function endCardAdvertised(profile: ProfileFacts | null | undefined): boolean {
  return !!profile && !profile.pass && profile.activity_kind === "trial" && profile.profile_id === OPEN_TRIAL_PROFILE_ID;
}

/** The card for this turn ending, or `null` when the turn ends as it does today. */
export function trialEndCardView(input: { profile: ProfileFacts | null | undefined; err: unknown; products: PassProduct[] | null | undefined }): TrialEndCardView | null {
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
  return { ending, title, facts, primary: TRIAL_END_CARD_COPY.primary, escape: TRIAL_END_CARD_COPY.escape, productId: product.id, text: [title, ...facts].join(" ") };
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
