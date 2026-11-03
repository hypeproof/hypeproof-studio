// Messages between the skill store panel (webview surface "skill-store") and its host
// (skillStorePanel.ts). REQ-STORE-* in docs/studio-requirements.md, Epic #3418.

/** The public layer of one step (design v1 D4). The private layer never reaches the App. */
export interface StoreStepView {
  step_id: string;
  title: string;
  description: string;
  connections: { id: string; why: string }[];
}
export interface StoreItemView {
  id: string;
  title: string;
  summary: string;
  price_krw: number;
  version: number;
  tools: string[];
  outputs: string[];
  steps: StoreStepView[];
  connections: string[];
  seller_name: string;
  refund_window_days: number;
}
export interface StoreInstallView {
  item_id: string;
  title: string;
  summary: string;
  price_krw: number;
  version: number;
  public: { steps: StoreStepView[]; outputs: string[] };
  update_available: boolean;
  runnable: boolean;
  warning: "reported" | null;
  order_id: string | null;
  first_run_at: number | null;
  refundable: boolean;
  refund_until: number | null;
}
export interface StoreSaleView {
  order_id: string;
  title: string;
  gross: number;
  pg_fee: number;
  seller: number;
  commission: number;
  partner: number;
  instructor: number;
  hypeproof: number;
  seller_net: number;
  policy_version: string;
  paid_at: number;
  status: "refunded" | "refund_window" | "payout_hold" | "payable";
  payout_hold_ends: number;
}
export interface StoreSellerView {
  tier: "none" | "new" | "standard" | "verified" | "minor";
  cap_krw: number;
  identity_verified: boolean;
  origin: { lecture_id: string | null; partner: boolean; instructor: boolean } | null;
  items: { id: string; title: string; price_krw: number; status: string; report_count: number }[];
  sales: StoreSaleView[];
  totals: { payable: number; pending: number; rolls_over: boolean; payout_min_krw: number };
  payout: "not_started" | "linked_adult_required";
  policy_version: string;
}
export type StoreTab = "browse" | "mine" | "sell";
export interface StoreState {
  /** `signedOut`: no personal account on this device. `unavailable`: the Service has no store. */
  access: "ready" | "signedOut" | "unavailable";
  tab: StoreTab;
  items: StoreItemView[];
  ageGroup: "adult" | "minor" | "unknown";
  installs: StoreInstallView[];
  seller?: StoreSellerView;
  /** The order the buyer is paying for in the browser. */
  checkout?: { itemId: string; title: string; amount: number };
  busy?: boolean;
  notice?: string;
  error?: string;
  /** Publication check messages from the Service, one per failed check. */
  checks?: string[];
  testPayments: boolean;
}
/** The App's single-step draft. The Service checks the text, seals it and never returns it. */
export interface StorePublishDraft {
  title: string;
  summary: string;
  body: string;
  tools: string[];
  price_krw: number;
}
export type StoreRequest =
  | { type: "storeLoad"; tab?: StoreTab }
  | { type: "storeSignIn" }
  | { type: "storeDeclareAge"; birthYear: number }
  | { type: "storeBuy"; itemId: string }
  | { type: "storeInstallFree"; itemId: string }
  | { type: "storeRefund"; orderId: string }
  | { type: "storeReport"; itemId: string; reason: string }
  | { type: "storePublish"; draft: StorePublishDraft }
  | { type: "storeImportFile" }
  | { type: "storeCancelCheckout" };
export type StoreHostMessage = { type: "storeState"; state: StoreState } | { type: "storeDraftBody"; body: string };
