/**
 * TUX-COND-07 — the inline end-of-trial card (REQ-L12 ①②, CU-13/14, INT-ACCESS-05).
 * Pure: no VS Code API, no DOM. The host decides and builds the view; the chat renders it.
 *
 * When a free trial's turn ends because the trial ran out (requests or time), the chat shows
 * one inline card instead of an error. CONV-ENDCARD-R-002: the title and first line speak about
 * continuing the work just made (same folder; files and conversation kept) before any pass fact,
 * then the pass the Service recommends (name, period, price), then the no-renewal promise, and
 * only last why free use stopped. One Primary "이용권 살펴보기" and the escape "오늘은 여기까지".
 * The card never opens the purchase view by itself, never counts down, never shows a remaining or
 * used count (CONV-DEC-03, CU-13/14) and is never shown mid-work.
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
import { FREE_EXHAUSTED_SERVICE, FREE_EXPIRED_SERVICE, defaultProduct, fetchProducts, formatWon, readCatalogue, type CatalogueRead, type PassProduct } from "./passPurchase.ts";

export type TrialEnding = TrialEndCardView["ending"];

/** The Service profile id of the open trial's free tier (Service `profiles/studio-open-trial.ts`). */
export const OPEN_TRIAL_PROFILE_ID = "studio-open-trial";

export const TRIAL_END_CARD_COPY = {
  // Free start (SPEC iteration 4 §2.4): the free allowance is never called a 체험.
  // CONV-ENDCARD-R-002 (해요체, like the purchase view the Primary opens and the email section below):
  // continuity first. The title is the same for both endings; the ending itself is the last line.
  title: "만든 작업을 그대로 이어서 할 수 있어요",
  // Only what is true on every seat: the files stay in their folder and this chat stays readable.
  // It names no folder hand-over (a pass takes over only its own `workspace_root`, REQ-L12 ⑫, which a
  // free seat in a numbered sibling folder does not share) and does not promise the pass continues this
  // very conversation (that is the optional, flag-gated carry-over offer).
  continuity: "만든 파일은 작업 폴더에, 대화는 이 채팅에 그대로 있어요. 이용권이 있으면 이 작업을 이어서 할 수 있어요.",
  noRenewal: "한 번만 결제하고, 자동으로 다시 결제되지 않아요.",
  endedExhausted: "무료로 쓸 수 있는 AI 요청은 모두 썼어요.",
  endedExpired: "무료 사용 시간은 끝났어요.",
  primary: "이용권 살펴보기",
  escape: "오늘은 여기까지",
} as const;

/**
 * The recommended pass in one line, 해요체: name, period and price first, then what it includes.
 * Every number comes from the Service catalogue; nothing about the free seat's own allowance.
 */
export function passOfferLine(product: PassProduct): string {
  const name = /이용권$/.test(product.label) ? product.label : `${product.label} 이용권`;
  return `${name}은 ${product.durationDays}일 동안 쓸 수 있고 ${formatWon(product.amount)}이에요. AI 요청 ${product.requestLimit.toLocaleString("ko-KR")}번이 들어 있어요.`;
}

/**
 * Pressure and countdown words the card must never carry (CU-13/14, CONV-DEC-03). Whole phrases,
 * not single syllables: `곧` alone would also match ordinary words.
 */
const KO_NUMBER = "(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|반)";
export const END_CARD_PRESSURE = new RegExp([
  "지금\\s*(?:바로|만)", "오늘만", "까지만", "마감", "임박", "마지막", "놓치", "놓쳐", "서두르", "서둘러", "한정", "할인", "특가",
  "곧\\s", "남았", "남은", "남음",
  // Loss copy, but not its reassuring negation (`사라지지 않아요`, `잃어버리지 않아요`).
  "사라(?:져|질|집)", "잃(?:는|을|게|어(?!버리지\\s*않))",
  // Countdowns and counts written in digits or in Korean number words.
  "\\d+\\s*(?:초|분|시간|일)\\s*(?:후|뒤|안에|남)",
  `${KO_NUMBER}\\s*(?:초|분|시간|일)\\s*(?:후|뒤|안에|남)`,
  `${KO_NUMBER}\\s*(?:번|회)\\s*(?:남|을\\s*(?:다|모두)|다\\s|모두)`,
].join("|"));

/**
 * The CONV-ENDCARD-R-002 checker: why this card's main copy breaks the rules, or [] when it does not.
 * The only line allowed to hold digits is the Service's pass line, exactly as `passOfferLine` builds it;
 * any other digit (a remaining or used count, a countdown) is rejected. The email section (TUX-COND-08)
 * is not part of the conversion copy and is not read here.
 */
export function endCardCopyProblems(view: Pick<TrialEndCardView, "title" | "facts" | "primary" | "escape">, product: PassProduct): string[] {
  const problems: string[] = [];
  const offer = passOfferLine(product);
  const lines = [view.title, ...view.facts, view.primary, view.escape];
  for (const line of lines) {
    if (END_CARD_PRESSURE.test(line)) problems.push(`pressure: ${line}`);
    if (line !== offer && /\d/.test(line)) problems.push(`count: ${line}`);
  }
  const offerAt = view.facts.indexOf(offer);
  if (offerAt < 0) problems.push("order: the recommended pass is not named");
  if (/이용권|\d/.test(view.title)) problems.push(`order: the title speaks about the pass, not the work: ${view.title}`);
  if (offerAt !== 1 || !/이어서/.test(view.facts[0] ?? "") || !/이어서/.test(view.title)) problems.push("order: continuity must come first, then the recommended pass");
  return problems;
}

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

/**
 * The card for this turn ending, or `null` when the turn ends as it does today.
 *
 * CONV-ENDCARD-R-005 — `products: "unreadable"` (the catalogue could not be read, even after one
 * retry) still ends in a card, the minimal one: the same continuity title and line, no pass fact
 * (no name, period, price or renewal line, since none was read) and the same Primary, which opens
 * the purchase screen and reads the list again there. Only a Service that does not sell passes
 * (`"unsold"`, `null` or an empty list) falls back to the banner, so a newcomer whose free use
 * ended is never left at an error while passes are on sale.
 */
export function trialEndCardView(input: { profile: ProfileFacts | null | undefined; err: unknown; products: CatalogueRead | null | undefined; notifySubmitted?: boolean }): TrialEndCardView | null {
  const { profile, err, products } = input;
  // A bought pass, a classroom or a personal seat never gets a purchase card.
  if (!profile || !endCardAdvertised(profile)) return null;
  const ending = trialEndReason(err, false);
  if (!ending) return null;
  const ended = ending === "exhausted" ? TRIAL_END_CARD_COPY.endedExhausted : TRIAL_END_CARD_COPY.endedExpired;
  const notify = notifyOptinView(profile, !!input.notifySubmitted);
  if (products === "unreadable") {
    const title = TRIAL_END_CARD_COPY.title;
    const facts = [TRIAL_END_CARD_COPY.continuity, ended];
    return { ending, title, facts, primary: TRIAL_END_CARD_COPY.primary, escape: TRIAL_END_CARD_COPY.escape, text: [title, ...facts].join(" "), ...(notify ? { notify } : {}) };
  }
  if (!Array.isArray(products) || !products.length) return null;
  // The pass the Service itself suggests (`recommended`), else its first: the same one the
  // purchase list selects first, so the card never names a pass the list does not lead with.
  const product = defaultProduct(products);
  // Continuity first, then the recommended pass, then the promise, and only last why free use stopped.
  const title = TRIAL_END_CARD_COPY.title;
  const facts = [TRIAL_END_CARD_COPY.continuity, passOfferLine(product), TRIAL_END_CARD_COPY.noRenewal, ended];
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

/**
 * CONV-ENDCARD-R-005 — the end card's catalogue read: bounded like `catalogueWithin`, and retried
 * once when the list could not be read (a timeout, a network failure, a 5xx or a malformed body).
 * A Service that answers that it sells nothing (`unsold`) is believed at once and never retried.
 */
export async function endCardCatalogue(proxyUrl: string, opts: { timeoutMs?: number; retries?: number; signal?: AbortSignal } = {}): Promise<CatalogueRead> {
  const { timeoutMs = 3000, retries = 1, signal } = opts;
  let result: CatalogueRead = "unreadable";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) return "unreadable";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // A stopped turn ends the read at once instead of waiting out the timeout.
    const stop = () => ctrl.abort();
    signal?.addEventListener("abort", stop, { once: true });
    try {
      result = await Promise.race([
        readCatalogue(proxyUrl, ctrl.signal),
        new Promise<"unreadable">((resolve) => ctrl.signal.addEventListener("abort", () => resolve("unreadable"), { once: true })),
      ]);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
    if (result !== "unreadable") return result;
  }
  return result;
}
