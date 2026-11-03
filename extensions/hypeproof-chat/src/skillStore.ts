// Skill store client (Epic #3418). No `vscode` import: skillStorePanel.ts owns the editor
// surface, this file owns the Service calls (`/v1/store/*`) and the Korean copy. The Service
// decides every rule (price caps, age, refund window, fraud block); the App only shows the result
// and the Service's reason. Custody (design v1 D1): the App receives the public layer of a skill
// only. A run is composed by the Service on the buyer's chat turn; no call returns the seller's text.
import type { StoreInstallView, StoreItemView, StoreOverlaySpec, StoreOverlayView, StorePublishDraft, StoreSellerView } from "./skillStoreProtocol.ts";

export class StoreClientError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(code: string, detail: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}
export interface StoreClientOptions {
  /** `hypeproofChat.proxyUrl`, ending in `/v1`. */
  proxyUrl: string;
  /** The signed-in personal account's bearer, or undefined when signed out. */
  token: () => Promise<string | undefined>;
  /** Opaque device id for the Service's same-device block. */
  device?: string;
  fetchImpl?: typeof fetch;
}
export interface StoreOrder {
  order_id: string;
  amount: number;
  title: string;
  checkout_url: string;
  policy_version: string;
}
export type StoreOrderState = "pending" | "confirming" | "paid" | "failed" | "blocked" | "refunding" | "refunded" | "expired";

export class StoreClient {
  private readonly o: StoreClientOptions;
  constructor(options: StoreClientOptions) {
    this.o = options;
  }
  private base() {
    return this.o.proxyUrl.replace(/\/+$/, "") + "/store";
  }
  /** `optional` sends the account when there is one: a store open to listed accounts only answers 404 without it. */
  private async call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean | "optional" } = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = init.auth === false ? undefined : await this.o.token();
    if (!token && init.auth !== false && init.auth !== "optional") throw new StoreClientError("account_required");
    if (token) {
      headers.authorization = `Bearer ${token}`;
      if (this.o.device) headers["x-hps-device"] = this.o.device;
    }
    let response: Response;
    try {
      response = await (this.o.fetchImpl ?? fetch)(this.base() + path, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new StoreClientError("unavailable");
    }
    let value: any = null;
    try {
      value = await response.json();
    } catch {
      /* not JSON */
    }
    if (!response.ok) {
      if (response.status === 404 && path === "/items") throw new StoreClientError("store_off");
      throw new StoreClientError(typeof value?.error === "string" ? value.error : `http_${response.status}`, value && typeof value === "object" ? value : {});
    }
    return value as T;
  }
  /** The public list, or a search of titles, descriptions and step titles (scene 2). */
  async items(query = ""): Promise<StoreItemView[]> {
    const q = query.trim().slice(0, 40);
    const r = await this.call<{ items: StoreItemView[] }>(q ? `/items?q=${encodeURIComponent(q)}` : "/items", { auth: "optional" });
    return Array.isArray(r?.items) ? r.items : [];
  }
  me() {
    return this.call<{ age_group: "adult" | "minor" | "unknown"; installs: StoreInstallView[]; can_buy_paid: boolean }>("/me");
  }
  seller() {
    return this.call<StoreSellerView>("/seller");
  }
  declareAge(birthYear: number) {
    return this.call<{ age_group: "adult" | "minor" }>("/me/age", { body: { birth_year: birthYear } });
  }
  async createOrder(itemId: string): Promise<StoreOrder> {
    const order = await this.call<StoreOrder>("/orders", { body: { item_id: itemId } });
    // The checkout page must be the Service's own; anything else is never opened.
    const expected = new URL(this.base() + "/checkout");
    let got: URL | null = null;
    try { got = new URL(order?.checkout_url); } catch { /* malformed */ }
    if (!got || got.origin !== expected.origin || got.pathname !== expected.pathname || !/^sto_[0-9a-f]{32}$/.test(order?.order_id)) throw new StoreClientError("invalid_response");
    return order;
  }
  async orderState(orderId: string): Promise<{ state: StoreOrderState; block_reason?: string }> {
    return this.call<{ state: StoreOrderState; block_reason?: string }>(`/orders/${encodeURIComponent(orderId)}`);
  }
  refund(orderId: string) {
    return this.call<{ state: "refunded" }>(`/orders/${encodeURIComponent(orderId)}/refund`, { method: "POST", body: {} });
  }
  installFree(itemId: string) {
    return this.call<{ item_id: string }>(`/items/${encodeURIComponent(itemId)}/install`, { method: "POST", body: {} });
  }
  report(itemId: string, reason: string) {
    return this.call<{ status: string }>(`/items/${encodeURIComponent(itemId)}/report`, { body: { reason } });
  }
  /** A quest skill (questSkill.ts): every step's public layer and its private layer, which the Service seals. */
  publishPackage(pkg: unknown) {
    return this.call<{ id: string; status: "listed" | "review"; tier: string; cap_krw: number }>("/items", { body: pkg });
  }
  /** The buyer's own adaptation and the public steps; never the seller's text. */
  overlay(itemId: string) {
    return this.call<StoreOverlayView>(`/items/${encodeURIComponent(itemId)}/overlay`);
  }
  saveOverlay(itemId: string, steps: Record<string, StoreOverlaySpec>) {
    return this.call<StoreOverlayView>(`/items/${encodeURIComponent(itemId)}/overlay`, { method: "PUT", body: { steps } });
  }
  /**
   * D10: the buyer's roster rows in, the rendered messages out. The template stays in the Service; the first
   * render ends the refund right like the first run (F1).
   */
  async render(itemId: string, version: number, rows: { to: string; values: Record<string, string> }[]) {
    const r = await this.call<{ messages: { to: string; subject: string; body: string }[] }>(`/items/${encodeURIComponent(itemId)}/render`, { body: { version, rows } });
    if (!Array.isArray(r?.messages)) throw new StoreClientError("invalid_response");
    return r.messages;
  }
  /** Moves to the seller's current version; one that adds connections, tools or outputs needs `consent` (F5). */
  update(itemId: string, consent = false) {
    return this.call<{ version: number; widened: string[] }>(`/items/${encodeURIComponent(itemId)}/update`, { body: { consent } });
  }
  /** A single-step skill written in the store form. */
  publish(draft: StorePublishDraft) {
    return this.call<{ id: string; status: "listed" | "review"; tier: string; cap_krw: number }>("/items", {
      body: {
        title: draft.title,
        summary: draft.summary,
        price_krw: draft.price_krw,
        tools: draft.tools,
        // Writing files is a declared output, or a store run gets no write tool (design v1 F2).
        outputs: draft.tools.includes("write") ? ["chat_answer", "workspace_file"] : ["chat_answer"],
        steps: [{ step_id: "main", title: draft.title, description: draft.summary, private: { prompt: draft.body } }],
      },
    });
  }
}

export const STORE_COPY = {
  title: "스킬 스토어",
  entry: "스킬 스토어",
  testBanner: "지금은 테스트 결제만 돼요. 실제 돈이 나가지 않아요.",
  refundRule: (days: number) => `구매 후 ${days}일 안에, 한 번도 실행하지 않았다면 전액 환불돼요. 처음 실행한 뒤에는 환불할 수 없어요.`,
  modelCost: "실행할 때 드는 AI 사용량은 내 이용권에서 차감돼요.",
  signIn: "스토어를 쓰려면 Google로 로그인해 주세요.",
  unavailable: "지금은 스토어를 열 수 없어요. 잠시 뒤 다시 시도해 주세요.",
  askAge: "구매나 판매 전에 태어난 해를 한 번만 알려 주세요.",
  minorBuy: "만 19세 미만은 무료 스킬만 설치할 수 있어요.",
  checkoutOpen: "브라우저에서 결제를 마치면 여기에 자동으로 설치돼요.",
  paid: (title: string) => `「${title}」을 설치했어요. 처음 실행하기 전까지는 환불할 수 있어요.`,
  blocked: "판매자와 같은 기기, 카드 또는 네트워크로는 살 수 없어요. 결제는 자동으로 취소됐어요.",
  duplicate: "이미 산 스킬이라 이번 결제는 자동으로 취소됐어요.",
  failed: "결제가 끝나지 않았어요. 돈은 나가지 않았어요.",
  refunded: "환불했어요. 스킬도 지웠어요.",
  classroomSeat: "수업에 연결된 동안에는 스킬 스토어를 쓸 수 없어요.",
  published: "스토어에 올렸어요.",
  inReview: "운영팀이 검토한 뒤에 올라가요. 50만 원을 넘는 스킬과 만 19세 미만 판매자의 스킬은 검토를 거쳐요.",
  reported: "신고했어요. 운영팀이 확인할게요.",
  payoutNotStarted: "정산은 기록만 되고 있어요. 실제 지급은 결제사 계약이 끝난 뒤 시작돼요.",
  payoutLinkedAdult: "만 19세 미만 판매자의 정산금은 연결된 보호자 계정으로만 지급돼요. 보호자 연결이 필요해요.",
  listed: "판매 중",
  connected: "이미 연결됨",
  needsConnection: "연결 필요",
  questPrefill: "완성한 퀘스트의 이름과 설명을 채워 두었어요. 가격만 정하면 올릴 수 있어요.",
  questPrivate: "단계 이름과 설명만 공개돼요. 메일 문구와 지침은 HypeProof 서버에만 보관되고 구매자에게도 보이지 않아요. 내 Google 계정·명단·보낸 메일은 올라가지 않아요.",
  runStarted: (title: string) => `「${title}」 스킬로 새 작업을 열었어요. 대화창에 요청을 입력하세요.`,
  adapted: "내 방식으로 바꿨어요. 다음 실행부터 적용돼요.",
  updated: "새 버전으로 바꿨어요. 내가 바꾼 단계는 그대로 다시 적용돼요.",
  consent: "새 버전이 연결이나 도구를 더 써요. 확인한 뒤에만 바꿔요.",
  mailSent: (sent: number, failed: number) => failed ? `${sent}명에게 보냈고 ${failed}명은 보내지 못했어요. 자동화 기록에서 확인해 주세요.` : `${sent}명에게 메일을 보냈어요.`,
  mailCancelled: "메일을 보내지 않았어요.",
} as const;
/** A store skill runs only where the Service composes it (design v1 D2/D8). */
export const STORE_RUN_NEEDS_SERVICE = "스토어 스킬은 HypeProof 서버에 연결된 AI 코치에서만 실행돼요. 내 구독이나 로컬 연결로는 실행할 수 없어요.";

const ERRORS: Record<string, string> = {
  account_required: STORE_COPY.signIn,
  unavailable: STORE_COPY.unavailable,
  store_off: STORE_COPY.unavailable,
  age_required: STORE_COPY.askAge,
  minor_paid_purchase_blocked: STORE_COPY.minorBuy,
  blocked_shared_signal: STORE_COPY.blocked,
  already_installed: "이미 설치한 스킬이에요.",
  payment_in_progress: "이 스킬의 결제를 확인하고 있어요. 잠시 뒤 다시 확인해 주세요.",
  own_item: "내가 올린 스킬은 살 수 없어요.",
  seller_monthly_cap: "이 판매자는 이번 달 판매 한도에 닿았어요.",
  already_run: "이미 실행한 스킬은 환불할 수 없어요.",
  refund_window_closed: "환불 기간이 지났어요.",
  identity_verification_required: "유료 스킬을 팔려면 휴대폰 본인인증이 필요해요. 지금은 무료 스킬만 올릴 수 있어요.",
  over_tier_cap: "판매자 등급의 가격 한도를 넘었어요.",
  price_not_allowed: "500만 원 이상은 올릴 수 없어요.",
  checks_failed: "자동 검사를 통과하지 못했어요.",
  buyers_only: "설치한 사람만 신고할 수 있어요.",
  under_minimum_age: "만 14세 미만은 스토어를 쓸 수 없어요.",
  age_already_declared: "태어난 해는 이미 알려 주셨어요.",
  rate_limited: "잠시 뒤 다시 시도해 주세요.",
  gateway_error: "결제사 응답이 없어서 환불하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  not_installed: "설치되지 않은 스킬이에요. 스토어에서 다시 확인해 주세요.",
  invalid_overlay: "바꾼 내용을 저장하지 못했어요. 입력을 확인해 주세요.",
  item_unlisted: "운영자가 내린 스킬이라 바꿀 수 없어요.",
  no_finished_quest: "먼저 자동화 퀘스트의 모든 단계를 완료해 주세요.",
  no_mail_template: "이 스킬에는 메일 템플릿이 없어요.",
  mail_step_disabled: "메일을 만드는 단계를 꺼 두셨어요. 단계를 다시 켠 뒤 실행해 주세요.",
  minor_google_send: "만 19세 미만은 메일을 보내는 스토어 스킬을 실행할 수 없어요.",
  store_version_mismatch: "스킬이 업데이트됐어요. 스토어에서 다시 열어 주세요.",
  store_audit_unavailable: "지금은 스토어 스킬을 실행할 수 없어요. 잠시 뒤 다시 시도해 주세요.",
};
export function storeErrorMessage(error: unknown): string {
  if (error instanceof StoreClientError) {
    if (error.code === "over_tier_cap" && typeof error.detail.cap_krw === "number") return `판매자 등급의 가격 한도(${won(error.detail.cap_krw)})를 넘었어요.`;
    return ERRORS[error.code] ?? STORE_COPY.unavailable;
  }
  // A host refusal (roster, Google connection, recipient cap) is fixed Korean copy the buyer can act on; anything else
  // (an internal or English error) stays behind the generic sentence.
  if (error instanceof Error && /[가-힣]/.test(error.message) && error.message.length <= 200) return error.message;
  return STORE_COPY.unavailable;
}
export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
