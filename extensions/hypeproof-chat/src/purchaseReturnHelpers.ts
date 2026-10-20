/**
 * CONV-PURCHASE-R-004 (REQ-L12 ⑤⑥) — the purchase-return link the Lab done page emits:
 *
 *   <uriScheme>://hypeproof.hypeproof-chat/purchase-return?order=ord_<32 lowercase hex>
 *
 * Pure (no `vscode`): the URI handler in extension.ts passes the parts of `vscode.Uri` and its
 * own scheme. The link carries no credential; it only names an order. Anything that is not exactly
 * this shape returns undefined and is ignored silently.
 */
export const PURCHASE_RETURN_AUTHORITY = "hypeproof.hypeproof-chat";
export const PURCHASE_RETURN_PATH = "/purchase-return";
const ORDER_ID = /^ord_[0-9a-f]{32}$/;
/** Longer than any valid query (`order=` + 36). A long query is refused before it is parsed. */
const QUERY_MAX = 64;

export interface PurchaseReturnUri { scheme: string; authority: string; path: string; query: string; fragment: string }

export function isPurchaseReturnOrderId(value: unknown): value is string {
  return typeof value === "string" && ORDER_ID.test(value);
}

/** The order id the link names, or undefined unless the link is exactly the purchase-return shape. */
export function purchaseReturnOrder(uri: PurchaseReturnUri, scheme: string): string | undefined {
  if (!scheme || uri.scheme !== scheme || uri.authority !== PURCHASE_RETURN_AUTHORITY || uri.path !== PURCHASE_RETURN_PATH || uri.fragment) return undefined;
  if (uri.query.length > QUERY_MAX) return undefined;
  let query: URLSearchParams;
  try { query = new URLSearchParams(uri.query); } catch { return undefined; }
  const keys = [...query.keys()];
  if (keys.length !== 1 || keys[0] !== "order") return undefined;
  const order = query.get("order");
  // Rebuilt and compared: the (already decoded) query must be exactly `order=<id>`, nothing reordered or decorated.
  if (!isPurchaseReturnOrderId(order) || uri.query !== `order=${order}`) return undefined;
  return order;
}
