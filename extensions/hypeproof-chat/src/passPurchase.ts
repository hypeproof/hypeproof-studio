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
}
export type OrderState = "pending" | "confirming" | "paid" | "failed" | "refunded" | "expired";
/** What the start page may show. No secret, no code. */
export interface PurchaseView {
  available: boolean;
  products?: PassProduct[];
  stage?: "choosing" | "waiting" | "connecting" | "stopped";
  order?: { label: string; amount: number };
  message?: string;
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
    return order && order !== "bad_checkout" ? { ...order, ...(v.claimed === true ? { claimed: true } : {}) } : null;
  } catch { return null; }
}

export async function fetchProducts(proxyUrl: string): Promise<PassProduct[] | null> {
  try {
    const r = await fetch(`${base(proxyUrl)}/purchase/products`, { headers: { accept: "application/json" } });
    return r.ok ? parseProducts(await r.json()) : null;
  } catch { return null; }
}

export async function createOrder(proxyUrl: string, productId: string, siteBase: string): Promise<PendingOrder | "bad_checkout" | null> {
  try {
    const r = await fetch(`${base(proxyUrl)}/purchase/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product_id: productId }) });
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
  return now > order.expiresAt + SETTLE_GRACE_MS ? "expired" : "wait";
}

export const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
/** Requests per day if the count is spread evenly over the period. */
/** The pass a buyer sees selected first: the one the Service suggests, else the first. */
export const defaultProduct = (products: PassProduct[]) => products.find(p => p.recommended) ?? products[0];
