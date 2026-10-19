/**
 * Buying a pass from inside Studio (REQ-L12). Host side, no VS Code API here.
 *
 * Studio creates an order on the Service, opens the checkout page in the browser and
 * waits. The Service confirms the card payment with the gateway itself; Studio never
 * sees card data and never decides that something was paid. When the Service reports
 * the order as paid, Studio claims the seat with the order secret and receives an
 * ordinary participation code, which then goes through the same entry path as a
 * pasted code.
 *
 * The order secret is the only proof that this Studio started the order, so the host
 * keeps it in SecretStorage until the seat is claimed. It never reaches the webview.
 */

export interface PassProduct {
  id: string;
  label: string;
  /** Who the pass is for, one short line. Optional; the Service sends it when configured. */
  tagline?: string;
  recommended?: boolean;
  amount: number;
  durationDays: number;
  requestLimit: number;
}
export interface PendingOrder {
  id: string;
  secret: string;
  productId: string;
  label: string;
  amount: number;
  checkoutUrl: string;
  expiresAt: number;
  /** The Service the order was created on. A changed setting must not send the secret elsewhere. */
  service: string;
  /** The seat was handed over once. The record stays until the activity is actually entered, so a lost code can be replaced. */
  claimed?: boolean;
  /** Signed-in purchases are activated through the account, never anonymous claim. */
  accountOwned?: boolean;
}
export type OrderState = "pending" | "confirming" | "paid" | "failed" | "refunded" | "expired";
/** What the start page may show. No secret, no code. */
export interface PurchaseView {
  available: boolean;
  products?: PassProduct[];
  stage?: "choosing" | "waiting" | "connecting" | "stopped";
  order?: { label: string; amount: number };
  message?: string;
  /**
   * TUX-COND-07 — set only when the person pressed "이용권 살펴보기" on the chat's end-of-trial
   * card. The start page switches to the purchase list once per value; it is cleared when the
   * start tab closes, so a later visit never opens the purchase view by itself (REQ-L12 ①).
   */
  focus?: number;
}

/** Studio keeps waiting this long after the order's payment deadline, for a confirm that was already in flight. */
export const SETTLE_GRACE_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 3000;

/**
 * Purchase copy is written in 해요체 (2026-10-12 Jay): spoken, active, and saying what
 * happened to the money. The rest of the start screen keeps its own voice.
 */
export const PURCHASE_COPY = {
  unavailable: "지금은 이용권을 살 수 없어요. 잠시 뒤에 다시 해 주세요.",
  orderFailed: "주문을 만들지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.",
  badCheckout: "결제 페이지 주소가 이상해서 열지 않았어요. 앱을 업데이트하고 다시 해 주세요.",
  waiting: "결제를 마치면 이 화면이 저절로 바뀌어요.",
  confirming: "결제를 확인하고 있어요. 잠시만 기다려 주세요.",
  connecting: "결제를 확인했어요. 이용권을 넣고 있어요.",
  failed: "결제하지 못했어요. 카드에서 돈이 나가지 않았어요.",
  expired: "주문 시간이 지났어요. 결제하지 않았다면 다시 시작하면 돼요.",
  refunded: "환불한 주문이에요. 다시 쓰려면 새로 구매하면 돼요.",
  claimFailed: "결제는 확인했는데 이용권을 넣지 못했어요. 다시 연결을 눌러 주세요. 결제 내역은 그대로 있어요.",
  cancelled: "구매를 멈췄어요. 이미 결제했다면 다시 연결을 눌러 주세요.",
  unfinished: "결제한 이용권을 아직 넣지 못했어요. 다시 연결을 눌러 주세요.",
} as const;

const ORDER_ID = /^ord_[0-9a-f]{32}$/;
const base = (proxyUrl: string) => proxyUrl.replace(/\/+$/, "");
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export function parseProducts(input: unknown): PassProduct[] | null {
  if (!isRecord(input) || !Array.isArray(input.products) || !input.products.length) return null;
  const out: PassProduct[] = [];
  for (const raw of input.products) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.id)) return null;
    if (typeof raw.label !== "string" || !raw.label || raw.label.length > 80 || raw.currency !== "KRW") return null;
    if (!positiveInt(raw.amount) || !positiveInt(raw.duration_hours) || !positiveInt(raw.request_limit)) return null;
    if (raw.tagline !== undefined && (typeof raw.tagline !== "string" || raw.tagline.length > 80)) return null;
    out.push({ id: raw.id, label: raw.label, ...(typeof raw.tagline === "string" && raw.tagline ? { tagline: raw.tagline } : {}), ...(raw.recommended === true ? { recommended: true } : {}),
      amount: raw.amount, durationDays: Math.max(1, Math.round(raw.duration_hours / 24)), requestLimit: raw.request_limit });
  }
  return out;
}

/**
 * The checkout page must be on the configured site. A Service answer that points anywhere
 * else is refused, so the browser is never sent to an address this build does not know.
 */
export function checkoutUrlAllowed(url: unknown, siteBase: string): url is string {
  if (typeof url !== "string") return false;
  try {
    const target = new URL(url), site = new URL(siteBase);
    if (target.origin !== site.origin) return false;
    return target.protocol === "https:" || target.hostname === "localhost" || target.hostname === "127.0.0.1";
  } catch { return false; }
}

export function parseOrder(input: unknown, productId: string, service: string, siteBase: string): PendingOrder | "bad_checkout" | null {
  if (!isRecord(input) || typeof input.order_id !== "string" || !ORDER_ID.test(input.order_id)) return null;
  if (typeof input.order_secret !== "string" || !/^[0-9a-f]{32,128}$/.test(input.order_secret)) return null;
  if (!positiveInt(input.amount) || typeof input.label !== "string" || !input.label || !positiveInt(input.expires_at)) return null;
  if (!checkoutUrlAllowed(input.checkout_url, siteBase)) return "bad_checkout";
  return { id: input.order_id, secret: input.order_secret, productId, label: input.label.slice(0, 80), amount: input.amount, checkoutUrl: input.checkout_url, expiresAt: input.expires_at, service };
}

/** A saved order is trusted only if it still has every field and belongs to the Service in use. */
export function restorePendingOrder(raw: string | undefined, service: string, siteBase: string): PendingOrder | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!isRecord(v) || v.service !== service) return null;
    const order = parseOrder({ order_id: v.id, order_secret: v.secret, amount: v.amount, label: v.label, expires_at: v.expiresAt, checkout_url: v.checkoutUrl }, String(v.productId ?? ""), service, siteBase);
    return order && order !== "bad_checkout" ? { ...order, ...(v.claimed === true ? { claimed: true } : {}), ...(v.accountOwned === true ? { accountOwned: true } : {}) } : null;
  } catch { return null; }
}

export async function fetchProducts(proxyUrl: string, signal?: AbortSignal): Promise<PassProduct[] | null> {
  try {
    const r = await fetch(`${base(proxyUrl)}/purchase/products`, { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
    return r.ok ? parseProducts(await r.json()) : null;
  } catch { return null; }
}

export async function createOrder(proxyUrl: string, productId: string, siteBase: string, accountToken?: string): Promise<PendingOrder | "bad_checkout" | null> {
  try {
    const r = await fetch(`${base(proxyUrl)}/purchase/orders`, { method: "POST", headers: { "content-type": "application/json", ...(accountToken ? { authorization: `Bearer ${accountToken}` } : {}) }, body: JSON.stringify({ product_id: productId }), redirect: "error" });
    return r.status === 201 ? parseOrder(await r.json(), productId, proxyUrl, siteBase) : null;
  } catch { return null; }
}

const secretHeader = (order: PendingOrder) => ({ "x-hps-order-secret": order.secret });

/** `null` means the Service could not be read this time; keep waiting. */
export async function pollOrder(order: PendingOrder): Promise<OrderState | null> {
  try {
    const r = await fetch(`${base(order.service)}/purchase/orders/${order.id}`, { headers: secretHeader(order) });
    if (!r.ok) return null;
    const body = await r.json();
    return isRecord(body) && typeof body.state === "string" && ["pending", "confirming", "paid", "failed", "refunded", "expired"].includes(body.state) ? body.state as OrderState : null;
  } catch { return null; }
}

export type ClaimOutcome = { ok: true; code: string } | { ok: false; reason: "already_claimed" | "not_paid" | "unavailable" };
export async function claimSeat(order: PendingOrder, reissue: boolean): Promise<ClaimOutcome> {
  try {
    const r = await fetch(`${base(order.service)}/purchase/orders/${order.id}/claim`, { method: "POST", headers: { "content-type": "application/json", ...secretHeader(order) }, body: JSON.stringify(reissue ? { reissue: true } : {}) });
    const body = await r.json().catch(() => null);
    if (r.ok && isRecord(body) && typeof body.code === "string" && body.code.length > 20) return { ok: true, code: body.code };
    const reason = isRecord(body) && typeof body.error === "string" ? body.error : "";
    return { ok: false, reason: reason === "already_claimed" || reason === "not_paid" ? reason : "unavailable" };
  } catch { return { ok: false, reason: "unavailable" }; }
}

/**
 * Takes the seat. If the first answer was lost on the way (the Service says it was already
 * handed over, but this Studio holds no code), asks once for a replacement.
 */
export async function claimWithRecovery(order: PendingOrder): Promise<ClaimOutcome> {
  // A record marked claimed means a code was issued but the activity was never entered: ask for a replacement directly.
  if (order.claimed) return claimSeat(order, true);
  const first = await claimSeat(order, false);
  return !first.ok && first.reason === "already_claimed" ? claimSeat(order, true) : first;
}

/** What the wait should do next for a polled state at a given time. */
export function waitDecision(state: OrderState | null, order: PendingOrder, now: number): "wait" | "claim" | "failed" | "expired" | "refunded" {
  if (state === "paid") return "claim";
  if (state === "failed") return "failed";
  if (state === "refunded") return "refunded";
  // "expired" from the Service is final for an unpaid order; an unreadable Service is not.
  if (state === "expired") return "expired";
  // Only an order the Service still calls unpaid can run out here. An unreadable Service (offline,
  // outage) or a confirm still in flight may be a paid order: deleting it would lose the pass.
  return state === "pending" && now > order.expiresAt + SETTLE_GRACE_MS ? "expired" : "wait";
}

export const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
/**
 * TUX-COND-07 — one pass's catalogue facts as a sentence (합니다체, the chat register). Every
 * number comes from the Service catalogue; nothing here is a default price or count.
 */
export function passFacts(product: PassProduct): string {
  const name = /이용권$/.test(product.label) ? product.label : `${product.label} 이용권`;
  return `${name}은 ${product.durationDays}일 동안 AI 요청 ${product.requestLimit.toLocaleString("ko-KR")}번이고 ${formatWon(product.amount)}입니다.`;
}
/** Requests per day if the count is spread evenly over the period. */
/** The pass a buyer sees selected first: the one the Service suggests, else the first. */
export const defaultProduct = (products: PassProduct[]) => products.find(p => p.recommended) ?? products[0];

/** What a person reads when a bought pass has no requests left. 해요체 like the rest of the purchase copy. */
export const PASS_SPENT_FRIENDLY =
  "이용권의 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요. 더 쓰려면 시작 화면의 '이용권으로 시작하기'에서 새 이용권을 살 수 있어요.";

/**
 * A turn that ended because the pass is spent. The SDK host sees only text: the Service's 429
 * arrives as "Claude Code returned an error result: API Error: Request rejected (429) · <message>"
 * (2026-10-14 rehearsal), so the Service's pass sentence or the code is matched in the message.
 */
export function passSpentNotice(err: unknown): string | null {
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === "string" && /trial_exhausted|이용권의 AI 요청 횟수를 모두 썼습니다/.test(m) ? PASS_SPENT_FRIENDLY : null;
}

/**
 * REQ-L12 (13) — a free trial that ran out. The SDK host sees only text, and the Service's
 * trial sentences carry no code: the real runs (2026-10-18, SDK 0.3.299) read
 * "API Error: Request rejected (429) · 개인 체험의 총 요청 한도에 도달했습니다." and
 * "Failed to authenticate. API Error: 403 개인 체험 시간이 끝났습니다. …". A bare
 * `trial_exhausted` code (proxy path) counts only for a turn that did not run on a bought pass,
 * because the Service uses the same code for both. The cost-ceiling refusal (429
 * `trial_cost_exhausted`, observed 2026-10-19 against the local Worker) reads
 * "체험에서 쓸 수 있는 AI 사용량을 모두 썼습니다. …" and is a spent trial too.
 */
export type TrialEnding = "exhausted" | "expired";
export function trialEnding(err: unknown, onPass = false): TrialEnding | null {
  const m = (err as { message?: unknown } | null)?.message;
  if (typeof m !== "string") return null;
  if (/개인 체험의 총 요청 한도에 도달했습니다/.test(m)) return "exhausted";
  // The trial's AI cost ceiling (Service `trial_cost_exhausted`, 429): the SDK surfaces only the sentence.
  if (/체험에서 쓸 수 있는 AI 사용량을 모두 썼습니다/.test(m)) return "exhausted";
  if (/개인 체험 시간이 끝났습니다/.test(m)) return "expired";
  if (!onPass && /\btrial_(?:cost_)?exhausted\b/.test(m)) return "exhausted";
  return null;
}

/** Trial endings in 해요체, like the purchase copy. The files stay (CU-14); nothing is charged or opened. */
export const TRIAL_EXHAUSTED_FRIENDLY = "체험에서 쓸 수 있는 AI 요청을 모두 썼어요. 만든 파일과 대화는 그대로 있어요.";
export const TRIAL_EXPIRED_FRIENDLY = "체험 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요.";
/** The way on, named only when the Service sells passes. The person chooses it; it is never opened for them. */
export const TRIAL_PASS_POINTER_CHAT = "계속하려면 시작 화면의 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.";
export const TRIAL_PASS_POINTER_START = "계속하려면 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.";

export function trialEndNotice(ending: TrialEnding, passesSold: boolean): string {
  const said = ending === "exhausted" ? TRIAL_EXHAUSTED_FRIENDLY : TRIAL_EXPIRED_FRIENDLY;
  return passesSold ? `${said} ${TRIAL_PASS_POINTER_CHAT}` : said;
}

/** The start page's error line after a trial expired: the pointer is added only while passes are sold. */
export function withTrialPassPointer(error: string | undefined, passesSold: boolean): string | undefined {
  return error === TRIAL_EXPIRED_FRIENDLY && passesSold ? `${error} ${TRIAL_PASS_POINTER_START}` : error;
}

/**
 * Whether the Service sells passes right now: one unauthenticated catalogue read, bounded so a
 * slow Service never holds back the notice. Unknown counts as not sold, so no dead pointer is shown.
 */
export async function passesOnSale(proxyUrl: string, timeoutMs = 3000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const products = await Promise.race([
      fetchProducts(proxyUrl, ctrl.signal),
      new Promise<null>((resolve) => ctrl.signal.addEventListener("abort", () => resolve(null), { once: true })),
    ]);
    return !!products?.length;
  } finally { clearTimeout(timer); }
}
