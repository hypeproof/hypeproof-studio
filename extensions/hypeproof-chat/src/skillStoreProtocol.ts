// Messages between the skill store panel (webview surface "skill-store") and its host
// (skillStorePanel.ts). REQ-STORE-* in docs/studio-requirements.md, Epic #3418.

/** The public layer of one step (design v1 D4). The private layer never reaches the App. */
export interface StoreStepView {
  step_id: string;
  title: string;
  description: string;
  connections: { id: string; why: string }[];
  params?: { name: string; label: string }[];
  /** Earlier steps this one waits for (quest graph). Absent: linear order. */
  depends_on?: string[];
}
/** A buyer's adaptation of one step (design v1 D5). Keys starting with `buyer-` are steps the buyer added. */
export interface StoreOverlaySpec {
  enabled?: boolean;
  position?: number;
  params?: Record<string, string>;
  tone?: "짧게" | "친근하게" | "격식 있게";
  extra?: string;
  replace?: string;
  title?: string;
}
export interface StoreOverlayView {
  item_id: string;
  version: number;
  steps: StoreStepView[];
  overlay: Record<string, StoreOverlaySpec>;
  needs_review: string[];
}
/** Connections this device already has, for the card's "이미 연결됨" (design v1 D6). Never their values. */
export interface StoreLocalConnections {
  google: boolean;
  roster: boolean;
}
/** A finished quest offered for sale from its completion card: name and description prefilled. */
export interface StoreQuestDraft {
  title: string;
  summary: string;
  steps: { title: string; description: string }[];
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
  status: "refunded" | "refunding" | "refund_window" | "payout_hold" | "payable";
  payout_hold_ends: number;
}
export interface StoreSellerView {
  tier: "none" | "new" | "standard" | "verified" | "minor";
  cap_krw: number;
  identity_verified: boolean;
  /** The partner and instructor the seller registered at their first publication (names only; policy v2 `attribution.*`). */
  attribution: StoreAttributionView;
  items: { id: string; title: string; price_krw: number; status: string; report_count: number }[];
  sales: StoreSaleView[];
  /** Earnings first: every amount is shown before any payout account exists. */
  totals: { refund_window: number; payout_hold: number; payable: number; refunded: number; pending: number; rolls_over: boolean; payout_min_krw: number };
  payout_account: StorePayoutAccountView;
  payout: "not_started" | "linked_adult_required";
  policy_version: string;
}
export interface StoreAttributionView {
  decided: boolean;
  partner: { name: string } | null;
  instructor: { name: string } | null;
  source: "seller" | "operator" | null;
  seller_editable: boolean;
  /** The referral consent version a code registration must carry, and the one this seller gave (null: none). */
  consent_version: string;
  consent_given: string | null;
}
/** `due`: the payable balance reached `payout.account_prompt_krw`, so the account is asked for. Never the number itself. */
export type StorePayoutAccountView =
  | { state: "not_due" | "due"; prompt_at_krw: number; holder: "self" | "linked_adult"; linked_adult_required: boolean }
  | { state: "on_file"; prompt_at_krw: number; holder: "self" | "linked_adult"; linked_adult_required: boolean; masked: string; holder_check: "sandbox_matched" | "not_run" };
/** What the seller typed at the first publication: codes, or none. */
export type StoreAttributionInput = { partner_code?: string; instructor_code?: string; consent: { version: string; granted: true } } | { none: true };
/** The names the Service resolved for the typed codes, shown before the seller confirms. */
export interface StoreAttributionPreview {
  partnerCode: string;
  instructorCode: string;
  partner: { name: string } | null;
  instructor: { name: string; partner_name: string | null } | null;
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
  query?: string;
  connections?: StoreLocalConnections;
  questDraft?: StoreQuestDraft;
  /** The open adaptation of one installed skill. */
  overlay?: StoreOverlayView;
  /** A seller update that adds connections, tools or outputs waits for this consent (F5). */
  consent?: { itemId: string; widened: string[] };
  attributionPreview?: StoreAttributionPreview;
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
  | { type: "storePublish"; draft: StorePublishDraft; attribution?: StoreAttributionInput }
  | { type: "storeImportFile" }
  | { type: "storeCancelCheckout" }
  | { type: "storeSearch"; query: string }
  | { type: "storePublishQuest"; title: string; summary: string; price_krw: number; attribution?: StoreAttributionInput }
  | { type: "storeResolveCodes"; partnerCode: string; instructorCode: string }
  | { type: "storeSavePayoutAccount"; bankCode: string; accountNumber: string; holderName: string }
  | { type: "storeRun"; itemId: string }
  | { type: "storeOverlayOpen"; itemId: string }
  | { type: "storeOverlayClose" }
  | { type: "storeOverlaySave"; itemId: string; steps: Record<string, StoreOverlaySpec> }
  | { type: "storeAdapt"; itemId: string; text: string }
  | { type: "storeUpdate"; itemId: string; consent?: boolean };
export type StoreHostMessage = { type: "storeState"; state: StoreState } | { type: "storeDraftBody"; body: string };
