// Skill store editor panel (Epic #3418, REQ-STORE-*). Webview surface "skill-store"
// (webview-ui/src/SkillStore.tsx); Service calls in skillStore.ts.
//
// Purchase: the Service creates the order, the browser opens the Service's checkout page, and
// this panel polls the order until the Service itself reports it paid (the gateway confirmed it
// server to server). The App never sees card data and never decides a refund or a price rule.
import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { StoreClient, StoreClientError, STORE_COPY, storeErrorMessage } from "./skillStore";
import type { StoreAttributionInput, StoreHostMessage, StoreLocalConnections, StoreQuestDraft, StoreRequest, StoreState, StoreStepView, StoreTab } from "./skillStoreProtocol";
import { adaptOverlay } from "./questSkill";

export const SKILL_STORE_COMMAND = "hypeproof-chat.skillStore";
/** The quest completion card's "스토어에 등록": the sell tab with the finished quest prefilled (scene 1). */
export const SKILL_STORE_PUBLISH_QUEST_COMMAND = "hypeproof-chat.skillStore.publishQuest";
const POLL_MS = 3000;
const CHECKOUT_LIMIT_MS = 30 * 60 * 1000;

export interface SkillStoreDeps {
  render: (webview: vscode.Webview, dist: vscode.Uri) => string;
  /** The signed-in personal account's bearer; undefined when accounts are off or signed out. */
  accountToken: () => Promise<string | undefined>;
  /**
   * The seat a run would spend: `personal` (the buyer's own pass, trial or free seat), `classroom`
   * (a class or minor cohort, which must not pay for or reach the store), or `none`.
   */
  seat: () => Promise<"personal" | "classroom" | "none">;
  /** Which connections this device already has (D6), for the card's "이미 연결됨". */
  localConnections?: () => Promise<StoreLocalConnections>;
  /** The finished quest on this device, as a completion-card prefill and the package that publishes it. */
  questOffer?: () => { draft: StoreQuestDraft; pkg: (meta: { title: string; summary: string; price_krw: number }) => unknown } | undefined;
  /** Opens the buyer's run of an installed skill: a new chat task the Service composes (D2), shown as a quest. */
  runSkill?: (skill: { itemId: string; version: number; title: string; steps: StoreStepView[]; connections?: StoreLocalConnections }) => Promise<void>;
  /** Shows the buyer's quest for an installed skill (scene 3), from the public layer only. */
  showQuest?: (skill: { title: string; steps: StoreStepView[]; connections?: StoreLocalConnections }) => Promise<void>;
  /**
   * D10/F7: runs a mail skill from the buyer's own roster. `render` sends only the rows to the Service and returns
   * the rendered messages; the host shows the exact preview and sends through the buyer's own Gmail connection.
   */
  runMailSkill?: (skill: { title: string; params: { name: string; label: string }[] }, render: (rows: { to: string; values: Record<string, string> }[]) => Promise<{ to: string; subject: string; body: string }[]>) => Promise<{ sent: number; failed: number } | { cancelled: true }>;
}

export function registerSkillStore(context: vscode.ExtensionContext, deps: SkillStoreDeps): void {
  let panel: vscode.WebviewPanel | undefined;
  let state: StoreState = { access: "ready", tab: "browse", items: [], ageGroup: "unknown", installs: [], testPayments: true };
  let poll: ReturnType<typeof setTimeout> | undefined;
  let checkoutOrder: { id: string; startedAt: number } | undefined;
  let identityPoll: ReturnType<typeof setTimeout> | undefined;
  let identityStarting = false;
  /** The finished quest this window already published, so 「내 스토어」 does not offer it twice. */
  let publishedDraft: string | undefined;
  const client = () =>
    new StoreClient({
      proxyUrl: vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1"),
      token: deps.accountToken,
      device: createHash("sha256").update(`hps-store-device\u0000${vscode.env.machineId}`).digest("hex").slice(0, 40),
    });
  const post = async (msg: StoreHostMessage) => {
    try { await panel?.webview.postMessage(msg); } catch { /* the panel closed */ }
  };
  const push = async (patch: Partial<StoreState>) => {
    state = { ...state, ...patch };
    await post({ type: "storeState", state });
  };

  const load = async (tab: StoreTab = state.tab, extra: Partial<StoreState> = {}) => {
    // A class seat (every under-14 instructor-code cohort included) has no store, however the panel was opened.
    if ((await deps.seat().catch(() => "none")) === "classroom") return push({ access: "unavailable", tab, items: [], installs: [], seller: undefined, busy: false, error: STORE_COPY.classroomSeat });
    const c = client();
    let items = state.items;
    const connections = await deps.localConnections?.().catch(() => undefined);
    if (connections) extra = { connections, ...extra };
    // 「내 스토어」 always offers the finished quest on this device, however the tab was reached.
    if (tab === "sell" && !state.questDraft && !("questDraft" in extra)) {
      const offer = deps.questOffer?.();
      if (offer && JSON.stringify(offer.draft) !== publishedDraft) extra = { questDraft: offer.draft, ...extra };
    }
    try {
      items = await c.items(state.query ?? "");
    } catch (error) {
      await push({ access: "unavailable", tab, busy: false, error: storeErrorMessage(error), ...extra });
      return;
    }
    if (!(await deps.accountToken().catch(() => undefined))) {
      await push({ access: "signedOut", tab, items, installs: [], seller: undefined, busy: false, ...extra });
      return;
    }
    try {
      const me = await c.me();
      const seller = tab === "sell" ? await c.seller() : state.seller;
      // A course that does not sell: no quest prefill and no "가격만 정하면 올릴 수 있어요" next to the reason.
      if (seller?.course_blocked) {
        extra = { ...extra, questDraft: undefined };
        if ((extra.notice ?? state.notice) === STORE_COPY.questPrefill) extra = { ...extra, notice: undefined };
      }
      await push({ access: "ready", tab, items, ageGroup: me.age_group, installs: me.installs, seller, busy: false, ...extra });
    } catch (error) {
      const signedOut = error instanceof StoreClientError && error.code === "account_required";
      await push({ access: signedOut ? "signedOut" : "ready", tab, items, busy: false, error: storeErrorMessage(error), ...extra });
    }
  };

  const stopPoll = () => {
    if (poll) clearTimeout(poll);
    poll = undefined;
  };
  const watchOrder = () => {
    stopPoll();
    poll = setTimeout(async () => {
      const order = checkoutOrder;
      if (!order) return;
      let next: string;
      let reason: string | undefined;
      try {
        ({ state: next, block_reason: reason } = await client().orderState(order.id));
      } catch {
        next = "pending";
      }
      if (next === "paid") {
        const title = state.checkout?.title ?? "";
        checkoutOrder = undefined;
        await load("mine", { checkout: undefined, notice: STORE_COPY.paid(title) });
        return;
      }
      if (next === "blocked" || next === "failed" || next === "expired" || Date.now() - order.startedAt > CHECKOUT_LIMIT_MS) {
        checkoutOrder = undefined;
        await push({ checkout: undefined, busy: false, error: next === "blocked" ? (reason === "duplicate_purchase" ? STORE_COPY.duplicate : STORE_COPY.blocked) : STORE_COPY.failed });
        return;
      }
      watchOrder();
    }, POLL_MS);
  };

  /**
   * First publication (policy v2): the seller's partner/instructor choice is registered once, right before the
   * publish it belongs to. A seller who already chose (or whose binding an operator set) skips this.
   */
  const registerFirst = async (c: StoreClient, attribution: StoreAttributionInput | undefined) => {
    if (state.seller?.attribution?.decided !== false) return;
    if (!attribution) throw new StoreClientError("attribution_required");
    let view;
    try {
      view = await c.registerAttribution(attribution);
    } catch (error) {
      // The consent text changed version while the panel was open: reload the seller view so the next try sends it.
      if (error instanceof StoreClientError && error.code === "referral_consent_required") {
        const seller = await c.seller().catch(() => undefined);
        if (seller) state = { ...state, seller };
      }
      throw error;
    }
    // Recorded at once: if the publish after it fails, a retry must not register a second time.
    if (state.seller) state = { ...state, seller: { ...state.seller, attribution: view } };
  };

  /** Polls the verification the seller opened in the browser until the Service reports its outcome. */
  const watchIdentity = (sessionId: string, startedAt: number) => {
    if (identityPoll) clearTimeout(identityPoll);
    identityPoll = setTimeout(async () => {
      if (state.identity?.sessionId !== sessionId || !panel) return;
      let r: { state: string; failure?: string };
      try { r = await client().identityState(sessionId); } catch { r = { state: "pending" }; }
      // The panel may have closed, or the seller stopped waiting, while the answer was on its way.
      if (state.identity?.sessionId !== sessionId || !panel) return;
      if (r.state === "verified") {
        // The new tier and cap come from a fresh seller view, whatever tab is open.
        const seller = await client().seller().catch(() => undefined);
        await load(state.tab, { identity: undefined, ...(seller ? { seller } : {}) });
        return void (await push({ notice: STORE_COPY.identityDone(seller?.cap_krw) }));
      }
      if (r.state === "failed" || r.state === "expired" || Date.now() - startedAt > CHECKOUT_LIMIT_MS) {
        const code = r.state === "failed" ? (r.failure === "under_minimum_age" ? "under_minimum_age_identity" : r.failure ?? "identity_failed") : "identity_expired";
        return void (await push({ identity: undefined, busy: false, error: storeErrorMessage(new StoreClientError(code)) }));
      }
      watchIdentity(sessionId, startedAt);
    }, POLL_MS);
  };

  const handle = async (msg: StoreRequest) => {
    if (!msg || typeof msg.type !== "string") return;
    const c = client();
    const run = async (fn: () => Promise<void>) => {
      await push({ busy: true, error: undefined, notice: undefined, checks: undefined });
      try {
        await fn();
      } catch (error) {
        const checks = error instanceof StoreClientError && Array.isArray(error.detail.messages) ? (error.detail.messages as string[]) : undefined;
        await push({ busy: false, error: storeErrorMessage(error), checks });
      }
    };
    switch (msg.type) {
      case "storeLoad":
        return load(msg.tab ?? state.tab, { consent: undefined });
      case "storeSignIn":
        await vscode.commands.executeCommand("hypeproof-chat.start");
        return push({ notice: "시작 화면에서 Google로 로그인한 뒤 스토어로 돌아오세요." });
      case "storeDeclareAge":
        return run(async () => {
          await c.declareAge(msg.birthYear);
          await load(state.tab);
        });
      case "storeBuy":
        return run(async () => {
          const item = state.items.find((i) => i.id === msg.itemId);
          const order = await c.createOrder(msg.itemId);
          checkoutOrder = { id: order.order_id, startedAt: Date.now() };
          await push({ busy: false, checkout: { itemId: msg.itemId, title: item?.title ?? order.title, amount: order.amount }, notice: STORE_COPY.checkoutOpen });
          await vscode.env.openExternal(vscode.Uri.parse(order.checkout_url));
          watchOrder();
        });
      case "storeCancelCheckout":
        checkoutOrder = undefined;
        stopPoll();
        return push({ checkout: undefined, busy: false });
      case "storeInstallFree":
        return run(async () => {
          await c.installFree(msg.itemId);
          const title = state.items.find((i) => i.id === msg.itemId)?.title ?? "";
          await load("mine", { notice: STORE_COPY.installedFree(title) });
        });
      case "storeRefund":
        return run(async () => {
          const ok = await vscode.window.showWarningMessage("환불하면 스킬이 지워지고 결제가 전액 취소돼요.", { modal: true }, "환불하기");
          if (ok !== "환불하기") return void push({ busy: false });
          await c.refund(msg.orderId);
          await load("mine", { notice: STORE_COPY.refunded });
        });
      case "storeReport":
        return run(async () => {
          await c.report(msg.itemId, msg.reason);
          await load(state.tab, { notice: STORE_COPY.reported });
        });
      case "storePublish":
        return run(async () => {
          await registerFirst(c, msg.attribution);
          const r = await c.publish(msg.draft);
          await load("sell", { attributionPreview: undefined, notice: r.status === "review" ? STORE_COPY.inReview : STORE_COPY.published });
        });
      case "storeResolveCodes":
        return run(async () => {
          const names = await c.resolveCodes(msg.partnerCode, msg.instructorCode);
          await push({ busy: false, attributionPreview: { partnerCode: msg.partnerCode, instructorCode: msg.instructorCode, partner: names.partner, instructor: names.instructor } });
        });
      case "storeVerifyIdentity":
        // One verification at a time: a second start (a double click) would open the browser twice.
        if (state.identity || identityStarting) return;
        identityStarting = true;
        return run(async () => {
          let started;
          try { started = await c.startIdentity(); } finally { identityStarting = false; }
          // The panel closed while the start was on its way: open nothing and wait for nothing.
          if (!panel) return;
          await push({ busy: false, identity: { sessionId: started.session_id, sandbox: started.sandbox }, notice: STORE_COPY.identityWaiting });
          await vscode.env.openExternal(vscode.Uri.parse(started.verify_url));
          watchIdentity(started.session_id, Date.now());
        });
      case "storeCancelIdentity":
        if (identityPoll) clearTimeout(identityPoll);
        return push({ identity: undefined, notice: undefined });
      case "storeSavePayoutAccount":
        // The number goes straight to the Service and is not kept in the panel state or logged here.
        return run(async () => {
          await c.savePayoutAccount({ bank_code: msg.bankCode, account_number: msg.accountNumber, holder_name: msg.holderName });
          await load("sell", { notice: STORE_COPY.payoutSaved });
        });
      case "storeSearch":
        state = { ...state, query: msg.query.slice(0, 40) };
        return load("browse");
      case "storePublishQuest":
        return run(async () => {
          const offer = deps.questOffer?.();
          if (!offer) throw new StoreClientError("no_finished_quest");
          await registerFirst(c, msg.attribution);
          const r = await c.publishPackage(offer.pkg({ title: msg.title, summary: msg.summary, price_krw: msg.price_krw }));
          publishedDraft = JSON.stringify(offer.draft);
          await load("sell", { questDraft: undefined, attributionPreview: undefined, notice: r.status === "review" ? STORE_COPY.inReview : STORE_COPY.published });
        });
      case "storeRun":
        return run(async () => {
          const install = state.installs.find((i) => i.item_id === msg.itemId);
          if (!install?.runnable || !deps.runSkill) throw new StoreClientError(install ? "item_unlisted" : "not_installed");
          // A mail skill runs from the buyer's roster through the Service's render, never as a chat turn (the
          // store run holds no mail tool, F2) and never with its template on this device (D10).
          if (install.public?.outputs?.includes("mail_draft") && deps.runMailSkill) {
            await deps.showQuest?.({ title: install.title, steps: install.public.steps ?? [], connections: state.connections }).catch(() => undefined);
            const params = (install.public.steps ?? []).flatMap((st) => st.params ?? []);
            const result = await deps.runMailSkill({ title: install.title, params }, (rows) => c.render(install.item_id, install.version, rows));
            return void (await load("mine", { notice: "cancelled" in result ? STORE_COPY.mailCancelled : STORE_COPY.mailSent(result.sent, result.failed) }));
          }
          await deps.runSkill({ itemId: install.item_id, version: install.version, title: install.title, steps: install.public?.steps ?? [], connections: state.connections });
          await push({ busy: false, notice: STORE_COPY.runStarted(install.title) });
        });
      case "storeOverlayOpen":
        return run(async () => push({ busy: false, overlay: await c.overlay(msg.itemId) }));
      case "storeOverlayClose":
        return push({ overlay: undefined });
      case "storeOverlaySave":
        return run(async () => push({ busy: false, overlay: await c.saveOverlay(msg.itemId, msg.steps), notice: STORE_COPY.adapted }));
      case "storeAdapt":
        return run(async () => {
          const current = state.overlay?.item_id === msg.itemId ? state.overlay : await c.overlay(msg.itemId);
          const { overlay, changes } = adaptOverlay(msg.text, current.steps, current.overlay);
          const saved = await c.saveOverlay(msg.itemId, overlay);
          await push({ busy: false, overlay: saved, notice: [STORE_COPY.adapted, ...changes].join(" ") });
        });
      case "storeUpdate":
        return run(async () => {
          try {
            await c.update(msg.itemId, msg.consent === true);
          } catch (error) {
            if (error instanceof StoreClientError && error.code === "consent_required") {
              const widened = Array.isArray(error.detail.widened) ? (error.detail.widened as string[]) : [];
              return void (await push({ busy: false, consent: { itemId: msg.itemId, widened }, notice: STORE_COPY.consent }));
            }
            throw error;
          }
          await load("mine", { consent: undefined, overlay: undefined, notice: STORE_COPY.updated });
        });
      case "storeImportFile": {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "스킬 문서": ["md", "txt"] }, title: "스토어에 올릴 스킬 파일 고르기" });
        if (!picked?.[0]) return;
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        if (bytes.byteLength > 20_000 * 4) return push({ error: "파일이 너무 커요. 2만 자 이하로 줄여 주세요." });
        return post({ type: "storeDraftBody", body: new TextDecoder().decode(bytes).slice(0, 20_000) });
      }
    }
  };

  const open = (tab?: StoreTab, extra: Partial<StoreState> = {}) => {
    if (tab) state = { ...state, tab, ...extra };
    if (panel) {
      panel.reveal();
      void load(tab);
      return;
    }
    const dist = vscode.Uri.joinPath(context.extensionUri, "webview-ui", "dist");
    panel = vscode.window.createWebviewPanel("hypeproof.skillStore", STORE_COPY.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    panel.webview.html = deps.render(panel.webview, dist).replace(/<html\b/, '<html data-surface="skill-store"');
    panel.webview.onDidReceiveMessage((m) => void handle(m as StoreRequest));
    // Sign-in happens on the start page; coming back to this tab re-reads the account.
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.visible && !checkoutOrder) void load(); });
    panel.onDidDispose(() => {
      panel = undefined;
      stopPoll();
      // A closed panel stops waiting: no poll survives it, and reopening shows no stale waiting state.
      if (identityPoll) clearTimeout(identityPoll);
      state = { ...state, identity: undefined };
      checkoutOrder = undefined;
    });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(SKILL_STORE_COMMAND, () => open()),
    vscode.commands.registerCommand(SKILL_STORE_PUBLISH_QUEST_COMMAND, () => {
      const offer = deps.questOffer?.();
      if (!offer) return void vscode.window.showInformationMessage("먼저 자동화 퀘스트의 모든 단계를 완료해 주세요.");
      open("sell", { questDraft: offer.draft, notice: STORE_COPY.questPrefill });
    }),
    { dispose: stopPoll },
  );
}
