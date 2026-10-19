import * as vscode from "vscode";
import { AccountError, type AccountSession, type AccountPassBinding } from "./accountSession";
import { ChatPanelProvider } from "./chatPanelProvider";
import { ActivityConnectionError, activityConnections } from "./activityConnections";
import { fetchProfileResult, verifyActivity, ProxyTransportError } from "./proxyClient";
import { sanitizeWorkshopToken, looksLikeIssuerTokenUnverified, reentryWorkspace } from "./chatPanelHelpers";
import * as path from "node:path";
import type { ResolvedProfile } from "./protocol";
import type { StartRequest, StartState } from "./startPageProtocol";
import { PURCHASE_COPY, POLL_INTERVAL_MS, claimWithRecovery, createOrder, fetchProducts, pollOrder, restorePendingOrder, waitDecision, withTrialPassPointer, type PassProduct, type PendingOrder, type PurchaseView } from "./passPurchase";
import type { ClassReposOutcome } from "./publish/publishHost";
import { fetchTrialOffer, type TrialOffer } from "./trialOffer";
import type { ClassRepo } from "./publish/githubContinue";

/**
 * "GitHub에서 이어하기" for a code being confirmed (user requirement 2026-10-13): look at the
 * seat's GitHub first; offer to continue a site from there, or to start new. The GitHub work
 * lives in the publish module (publishHost.ts); absent → the feature is off.
 */
export interface GithubContinueSource {
  /** The cohort publishes to GitHub (the button's gate) and names a class folder. */
  allowed(profile: ResolvedProfile): boolean;
  find(): Promise<ClassReposOutcome>;
  signIn(): Promise<boolean>;
  prepare(args: { login: string; repo: ClassRepo; classRoot: string }): Promise<{ ok: true; folder: string; downloaded: boolean } | { ok: false; message: string }>;
  /** The folder "새로 하기" opens: the class folder, else the first free `<class folder>-N`. */
  newFolder(classRoot: string): string;
  classRoot(profile: ResolvedProfile): string | null;
}

/** A GitHub look that has not answered by then is treated as unavailable: entry is never held up. */
const GITHUB_LOOK_MS = 15_000;

const entryError = (error:unknown) => error instanceof ActivityConnectionError || error instanceof ProxyTransportError
  ? error.message : "활동을 열지 못했습니다. 다시 시도해 주세요. 기존 연결과 작업 파일은 보존됩니다.";
const TOKEN_KEY = "hypeproofChat.workshopToken";
/** REQ-L12 — the order a buyer is in the middle of paying. Kept until the seat is claimed, so a restart cannot lose a paid order. */
const PENDING_PURCHASE_KEY = "hypeproofChat.pendingPurchase";
const DEFAULT_PROXY_URL = "https://api.hypeproof-ai.xyz/v1";
const DEFAULT_SITE_BASE = "https://hypeproof-ai.xyz";

/**
 * 활동 분리 **이전**에 쌓인 대화 기록 키인가 (#960).
 *
 * 한 곳에 둔 이유: 같은 판정이 "내보내기 버튼을 보일까"(refresh)와 "무엇을 파일로
 * 쓸까"(exportLegacyHistory) 두 곳에 복사돼 있었다. 갈라지면 버튼은 안 보이는데
 * 내보내면 현재 활동 대화가 섞여 나가거나(또는 그 반대) 하고, 그 어긋남은 둘 다
 * "통과" 로 보인다. 활동별 키는 끝이 64자리 hex 라 여기서 걸러낸다 — 그건 이미
 * 활동에 묶여 있으므로 '이전 기록' 이 아니다.
 */
const isLegacyHistoryKey = (key: string): boolean =>
  key === 'hypeproofChat.history' || (key.startsWith('hypeproofChat.history:') && !/:[a-f0-9]{64}$/.test(key));

type Candidate = { token: string; profile: ResolvedProfile; proxyUrl: string; previousConnected: boolean; workspace?: string; accountPass?: AccountPassBinding };
/** What a candidate's GitHub holds. Bound to one candidate: another code or a cancel retires it. */
type GithubLook = { candidate: Candidate; classRoot: string; state: NonNullable<StartState["github"]>; login?: string; repos?: ClassRepo[] };

/** App entry surface; authentication and cohort authority remain in Service. */
export class StartPage {
  private panel?: vscode.WebviewPanel;
  private busy = false;
  private choosingFolder = false;
  private error?: string;
  private started = false;
  // Invalid arrival may list saved activities, but only explicit entry reactivates its profile.
  private deferProfileUntilEntry = false;
  private candidate?: Candidate;
  // REQ-L12 — purchase state. `products === null` means the Service does not sell passes (or could not be read).
  private products?: PassProduct[] | null;
  // TUX-SP-12 — what the Service advertises about the trial before entry. `null`: not advertised (or unreadable).
  private trialOffer?: TrialOffer | null;
  private order?: PendingOrder;
  private purchaseStage?: PurchaseView["stage"];
  private purchaseMessage?: string;
  private purchaseTimer?: ReturnType<typeof setTimeout>;
  /** The code issued for the saved order, while its activity is previewed but not yet entered. */
  private purchaseToken?: string;
  private github?: GithubLook;
  constructor(
    private context: vscode.ExtensionContext,
    private chat: ChatPanelProvider,
    private begin: (profile: ResolvedProfile, commit: (directory?: string) => Promise<void>, selectedDirectory?: string) => Promise<boolean>,
    private githubSource?: GithubContinueSource,
    private accounts?: AccountSession,
  ) {}

  accountChanged(): void {
    if (this.candidate?.accountPass && this.accounts?.view().status === "signedOut") this.candidate = undefined;
    if (this.panel) void this.refresh();
  }

  /** The look that belongs to the candidate on screen, if any. */
  private look(): GithubLook | undefined {
    return this.candidate && this.github?.candidate === this.candidate ? this.github : undefined;
  }

  /** Look at the candidate's GitHub; the answer lands in the start state when it comes. */
  private lookAtGithub(candidate: Candidate, classRoot: string): void {
    const source = this.githubSource;
    if (!source) return;
    const entry: GithubLook = { candidate, classRoot, state: { status: "checking" } };
    this.github = entry;
    const timeout = new Promise<ClassReposOutcome>((r) => setTimeout(() => r({ status: "unavailable", detail: "timeout" }), GITHUB_LOOK_MS));
    const found = source.find().catch((e): ClassReposOutcome => ({ status: "unavailable", detail: String(e) }));
    void Promise.race([found, timeout]).then(async (r) => {
      if (this.github !== entry || this.candidate !== candidate) return; // another code, or cancelled
      if (r.status === "found") {
        entry.login = r.login;
        entry.repos = r.repos;
        entry.state = { status: "found", repos: r.repos.map(({ name, pushedAt }) => ({ name, pushedAt })), newFolder: path.basename(source.newFolder(classRoot)) };
      } else entry.state = { status: r.status };
      await this.refresh();
    });
  }

  /** Sign in from the candidate card when gh is not signed in, then look again. */
  private async signInToGithub(): Promise<void> {
    const gh = this.look(), source = this.githubSource;
    if (!gh || !source || gh.state.status !== "signin" || this.busy) return;
    this.busy = true; this.error = undefined; gh.state = { status: "signin", working: "signin" };
    await this.refresh();
    let signedIn = false;
    try { signedIn = await source.signIn(); } catch { signedIn = false; } finally { this.busy = false; }
    if (this.github !== gh || this.candidate !== gh.candidate) return;
    if (!signedIn) {
      gh.state = { status: "signin" };
      this.error = "GitHub 로그인이 끝나지 않았어요. 다시 눌러 주세요.";
      await this.refresh();
      return;
    }
    this.lookAtGithub(gh.candidate, gh.classRoot);
    await this.refresh();
  }

  /** "GitHub에서 이어하기" / "새로 하기": settle the candidate's folder, then start as usual. */
  private async startFromGithubChoice(msg: Extract<StartRequest, { type: "continueFromGithub" | "startNew" }>): Promise<void> {
    const gh = this.look(), source = this.githubSource;
    if (!gh || !source || gh.state.status !== "found" || this.busy) return;
    const candidate = gh.candidate;
    if (this.chat.hasActiveStream()) { this.error = "진행 중인 작업을 마치거나 중지한 후 활동을 변경하세요."; await this.refresh(); return; }
    let folder: string;
    if (msg.type === "startNew") folder = source.newFolder(gh.classRoot);
    else {
      const repo = gh.repos?.find((r) => r.name === msg.repo);
      if (!repo || !gh.login) return;
      this.busy = true; this.error = undefined; gh.state = { ...gh.state, working: "download" };
      await this.refresh();
      let prepared: Awaited<ReturnType<GithubContinueSource["prepare"]>>;
      try { prepared = await source.prepare({ login: gh.login, repo, classRoot: gh.classRoot }); }
      catch { prepared = { ok: false, message: "GitHub에서 홈페이지를 내려받지 못했어요. 잠시 뒤 다시 눌러 주세요." }; }
      finally { this.busy = false; gh.state = { ...gh.state, working: undefined }; }
      if (this.candidate !== candidate) return;
      if (!prepared.ok) { this.error = prepared.message; await this.refresh(); return; }
      folder = prepared.folder;
    }
    // The folder travels as the local choice (`begin`'s selectedDirectory), not as a rewrite of
    // the served profile: the profile stays what the Service said.
    candidate.workspace = folder;
    await this.handle({ type: "beginCourse" });
  }

  /** #751 U2 — a card arrived, changed or came down while this tab is open. */
  inboxChanged(): void { if (this.panel) void this.refresh(); }

  /** A focus request during restore must not create a second sidebar chat. */
  async focusAfterRestore(restore: Promise<void>): Promise<void> {
    this.chat.focusDiagnostic('command_enter');
    try {
      await restore;
      this.chat.focusDiagnostic('restore_ready');
      if (!this.chat.focusEditor()) await this.show();
      this.chat.focusDiagnostic('command_complete');
    } catch(error) { this.chat.focusDiagnostic('command_failed'); throw error; }
  }

  async openChat(): Promise<void> {
    const entry = this.panel;
    if (!entry) return;
    await this.chat.openInEditor(entry);
    if (this.panel === entry) this.panel = undefined;
    this.started = true;
    this.deferProfileUntilEntry = false;
    this.chat.refreshConfig();
  }

  async show(options?: { deferProfileUntilEntry: true }): Promise<void> {
    if (options?.deferProfileUntilEntry) this.deferProfileUntilEntry = true;
    if (this.panel) { this.panel.reveal(); void this.refresh(); return; }
    const existing = this.panel as vscode.WebviewPanel | undefined;
    if (existing) { existing.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("hypeproof.start", "HypeProof Studio", vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "dist")] });
    this.panel = panel;
    panel.webview.html = this.chat.renderHtml(panel.webview, vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "dist"))
      .replace(/<html\b/, '<html data-surface="start"');
    panel.webview.onDidReceiveMessage((msg: StartRequest) => { void this.handle(msg); });
    // #747 — the naming step happens in the chat panel; this tab is retained
    // (retainContextWhenHidden), so re-read the identity whenever it comes back
    // to the front instead of showing the name from before the rename.
    panel.onDidChangeViewState(e => { if (e.webviewPanel.active) void this.refresh(); });
    panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.candidate = undefined; this.stopPurchaseWait(); this.accounts?.cancel(false); } });
    this.context.subscriptions.push(panel);
    void this.resumePurchase();
  }

  private settings() {
    const config = vscode.workspace.getConfiguration("hypeproofChat");
    return { proxyUrl: config.get<string>("proxyUrl", DEFAULT_PROXY_URL), siteBase: config.get<string>("siteBase", DEFAULT_SITE_BASE) };
  }
  private stopPurchaseWait(): void { if (this.purchaseTimer) clearTimeout(this.purchaseTimer); this.purchaseTimer = undefined; }
  private purchaseView(): PurchaseView {
    return {
      available: !!this.products?.length || !!this.order,
      ...(this.products?.length ? { products: this.products } : {}),
      ...(this.purchaseStage ? { stage: this.purchaseStage } : {}),
      ...(this.order ? { order: { label: this.order.label, amount: this.order.amount } } : {}),
      ...(this.purchaseMessage ? { message: this.purchaseMessage } : {}),
    };
  }
  /** TUX-SP-12 — one credential-free read per window; never `/v1/profile`, which would start a trial clock. */
  private async loadTrialOffer(): Promise<void> {
    if (this.trialOffer !== undefined) return;
    this.trialOffer = await fetchTrialOffer(this.settings().proxyUrl);
  }
  /** One unauthenticated read per window. An unreachable or unconfigured Service simply shows no purchase entry. */
  private async loadProducts(force = false): Promise<void> {
    if (this.products !== undefined && !force) return;
    this.products = await fetchProducts(this.settings().proxyUrl);
  }
  private async savedOrder(): Promise<PendingOrder | null> {
    const { proxyUrl, siteBase } = this.settings();
    return restorePendingOrder(await this.context.secrets.get(PENDING_PURCHASE_KEY), proxyUrl, siteBase);
  }
  /** A paid order must survive a closed tab or a restart: pick the wait back up where it stopped. */
  private async resumePurchase(): Promise<void> {
    // The tab was closed and opened again: the order is still held, but its timer died with the panel.
    if (this.order) { if (this.purchaseStage === "waiting") this.schedulePurchasePoll(0); return; }
    const saved = await this.savedOrder();
    if (!saved) return;
    this.order = saved;
    // A claimed record means a code was issued and the activity was never entered. Replacing that code
    // rotates the credential, so it happens only when the buyer asks, never by itself.
    if (saved.claimed) { this.purchaseStage = "stopped"; this.purchaseMessage = PURCHASE_COPY.unfinished; await this.refresh(); return; }
    this.purchaseStage = "waiting"; this.purchaseMessage = PURCHASE_COPY.waiting;
    await this.refresh();
    this.schedulePurchasePoll(0);
  }
  private schedulePurchasePoll(delay = POLL_INTERVAL_MS): void {
    this.stopPurchaseWait();
    if (!this.panel || !this.order) return;
    this.purchaseTimer = setTimeout(() => { void this.purchaseTick(); }, delay);
  }
  private async endPurchase(message: string): Promise<void> {
    this.stopPurchaseWait();
    await this.context.secrets.delete(PENDING_PURCHASE_KEY);
    this.order = undefined; this.purchaseStage = "stopped"; this.purchaseMessage = message;
    await this.refresh();
  }
  private async purchaseTick(): Promise<void> {
    const order = this.order;
    if (!order || !this.panel) return;
    const state = await pollOrder(order);
    if (this.order !== order) return;
    const next = waitDecision(state, order, Date.now());
    if (next === "wait") {
      const message = state === "confirming" ? PURCHASE_COPY.confirming : PURCHASE_COPY.waiting;
      if (message !== this.purchaseMessage) { this.purchaseMessage = message; await this.refresh(); }
      this.schedulePurchasePoll();
      return;
    }
    if (next !== "claim") { await this.endPurchase(PURCHASE_COPY[next]); return; }
    await this.claimPurchase(order);
  }
  private async claimPurchase(order: PendingOrder): Promise<void> {
    this.stopPurchaseWait();
    this.purchaseStage = "connecting"; this.purchaseMessage = PURCHASE_COPY.connecting;
    await this.refresh();
    if (order.accountOwned) {
      try {
        await this.accounts?.refreshView();
        await this.activateAccountPass(order.id);
        await this.context.secrets.delete(PENDING_PURCHASE_KEY);
        this.order = undefined; this.purchaseStage = undefined; this.purchaseMessage = undefined;
      } catch (e) { this.purchaseStage = "stopped"; this.purchaseMessage = e instanceof AccountError ? e.message : PURCHASE_COPY.claimFailed; }
      await this.refresh(); return;
    }
    const claim = await claimWithRecovery(order);
    if (this.order !== order) return;
    if (!claim.ok) {
      // The payment is confirmed and the order is kept, so "다시 연결" can try again without paying twice.
      this.purchaseStage = "stopped"; this.purchaseMessage = PURCHASE_COPY.claimFailed;
      await this.refresh();
      return;
    }
    // Keep the record, marked claimed, until the activity is entered (see the commit in beginCourse).
    // If anything fails before that, "다시 연결" replaces the code instead of the buyer paying again.
    const claimed: PendingOrder = { ...order, claimed: true };
    await this.context.secrets.store(PENDING_PURCHASE_KEY, JSON.stringify(claimed));
    this.order = claimed;
    // From here the issued code is an ordinary participation code and takes the ordinary entry path.
    await this.handle({ type: "connectCourse", token: claim.code });
    if (this.candidate?.token === claim.code) {
      this.purchaseToken = claim.code; this.order = undefined; this.purchaseStage = undefined; this.purchaseMessage = undefined; this.error = undefined;
    } else { this.purchaseStage = "stopped"; this.purchaseMessage = PURCHASE_COPY.claimFailed; }
    await this.refresh();
  }
  private async handlePurchase(msg: StartRequest): Promise<void> {
    if (msg.type === "purchaseOpen") {
      await this.loadProducts(true);
      if (!this.order) { this.purchaseStage = this.products?.length ? "choosing" : "stopped"; this.purchaseMessage = this.products?.length ? undefined : PURCHASE_COPY.unavailable; }
      await this.refresh(); return;
    }
    if (msg.type === "purchaseCancel") {
      // Cancelling stops the wait only. A saved paid order is never thrown away from here.
      this.stopPurchaseWait();
      if (this.order && this.purchaseStage !== "connecting") { this.purchaseStage = "stopped"; this.purchaseMessage = PURCHASE_COPY.cancelled; }
      else if (!this.order) { this.purchaseStage = undefined; this.purchaseMessage = undefined; }
      await this.refresh(); return;
    }
    if (msg.type === "purchaseHide") {
      // Back to the other ways to start. The order stays saved and the choice list offers it again.
      this.stopPurchaseWait();
      if (this.purchaseStage !== "connecting") { this.purchaseStage = undefined; this.purchaseMessage = undefined; }
      await this.refresh(); return;
    }
    if (msg.type === "purchaseReopen") {
      if (this.order) await vscode.env.openExternal(vscode.Uri.parse(this.order.checkoutUrl));
      return;
    }
    if (msg.type === "purchaseRetry") {
      const order = this.order ?? await this.savedOrder();
      if (!order) { this.purchaseStage = this.products?.length ? "choosing" : undefined; this.purchaseMessage = undefined; await this.refresh(); return; }
      this.order = order;
      if (order.claimed) { await this.claimPurchase(order); return; }
      this.purchaseStage = "waiting"; this.purchaseMessage = PURCHASE_COPY.waiting;
      await this.refresh(); this.schedulePurchasePoll(0); return;
    }
    if (msg.type !== "purchaseStart" || typeof msg.productId !== "string" || this.order || this.busy) return;
    if (!this.products?.some(p => p.id === msg.productId)) return;
    const { proxyUrl, siteBase } = this.settings();
    this.busy = true; await this.refresh();
    try {
      if (this.accounts && !this.accounts.matches(proxyUrl, siteBase)) throw new AccountError("settings_changed", "서버 설정이 바뀌었어요. Studio를 다시 열고 로그인해 주세요.");
      const accountToken = this.accounts ? await this.accounts.accessToken() : undefined;
      if (this.accounts && !accountToken) throw new AccountError("authentication_required", "Google로 로그인한 뒤 이용권을 구매해 주세요.");
      const result = await createOrder(proxyUrl, msg.productId, siteBase, accountToken);
      const order = result && result !== "bad_checkout" ? { ...result, ...(accountToken ? {accountOwned:true} : {}) } : result;
      if (!order || order === "bad_checkout") { this.purchaseStage = "stopped"; this.purchaseMessage = order ? PURCHASE_COPY.badCheckout : PURCHASE_COPY.orderFailed; return; }
      // Save before opening the browser: once the buyer can pay, the secret must already be on disk.
      await this.context.secrets.store(PENDING_PURCHASE_KEY, JSON.stringify(order));
      this.order = order; this.purchaseStage = "waiting"; this.purchaseMessage = PURCHASE_COPY.waiting;
      await vscode.env.openExternal(vscode.Uri.parse(order.checkoutUrl));
      this.schedulePurchasePoll();
    } catch (e) { this.purchaseStage = "stopped"; this.purchaseMessage = e instanceof AccountError ? e.message : PURCHASE_COPY.orderFailed; }
    finally { this.busy = false; await this.refresh(); }
  }

  private async activateAccountPass(passId: string): Promise<void> {
    if (!this.accounts) throw new Error('account disabled');
    const settings = this.settings();
    if (!this.accounts.matches(settings.proxyUrl, settings.siteBase)) throw new AccountError('settings_changed', '서버 설정이 바뀌었어요. Studio를 다시 열고 로그인해 주세요.');
    if (this.chat.hasActiveStream()) throw new AccountError('active_stream', '진행 중인 작업을 마치거나 중지한 후 이용권을 선택해 주세요.');
    const activated = await this.accounts.activate(passId);
    await this.handle({type:"connectCourse",token:activated.token});
    if (!this.candidate || this.candidate.token !== activated.token) throw new AccountError('pass_profile_unavailable', '이용권 정보를 확인하지 못했어요. 새로고침 후 다시 선택해 주세요.');
    this.candidate.accountPass = activated.binding;
  }

  private async refresh(profile?: ResolvedProfile | null): Promise<void> {
    const p = this.candidate?.profile ?? (profile === undefined ? (this.deferProfileUntilEntry ? null : await this.chat.ensureProfile()) : profile);
    let activities: StartState['activities'];
    try { activities=await activityConnections(this.context)?.list(); }
    catch { this.error ??= "저장된 활동 목록을 읽지 못했습니다. 참여 코드를 다시 입력해 주세요."; }
    const legacyHistory=this.context.workspaceState?.keys?.().some(isLegacyHistoryKey);
    const state: StartState = {
      legacyConnection:await activityConnections(this.context)?.hasLegacyConnection(),
      legacyHistory,
      activities,
      checking: this.busy,
      started: !this.candidate && this.started && !!p,
      candidate: !!this.candidate,
      previousConnected: this.candidate ? this.candidate.previousConnected : !!p,
      // REQ-L12 (13) — after a free trial ended, name the pass entry while it is drawn. Never open it.
      error: withTrialPassPointer(this.error ?? (!p ? this.chat.profileFailure()?.friendly : undefined), !!this.products?.length),
      version: this.context.extension.packageJSON.version,
      workspace: vscode.workspace.workspaceFolders?.[0]?.name,
      ...(this.chat.inboxSource ? { inbox: await this.chat.inboxSource.inboxView() } : {}),
      purchase: this.purchaseView(),
      ...(this.accounts ? {account:this.accounts.view()} : {}),
      ...(this.trialOffer ? { trialOffer: this.trialOffer } : {}),
      ...(this.look() ? { github: this.look()!.state } : {}),
      ...(p ? { coachName: this.chat.coachDisplayName(p), profile: { kind: p.activity_kind, ...(p.pass ? { pass: p.pass } : {}), id: p.profile_id, name: p.lesson?.content.title ?? p.display_name,
        // #747 — the row is labelled "AI 이름", so it shows the name the rest of
        // the card uses. A student-named cohort that has not been named yet
        // describes the mode instead of showing the placeholder as a name.
        coach: this.chat.coachNameIsChosen(p) ? this.chat.coachDisplayName(p) : "직접 이름 짓는 코치",
        series: p.lesson?.version ?? `${p.series_index} / ${p.series_total}`, workspace: this.candidate?.workspace ?? p.workspace_root ?? "현재 작업 폴더" } } : {}),
    };
    await this.panel?.webview.postMessage({ type: "startState", state });
  }

  private async openUnboundFolder(folder: vscode.Uri): Promise<void> {
    try {
      if (this.chat.hasActiveStream()) throw new ActivityConnectionError('진행 중인 작업을 마치거나 중지한 후 폴더를 변경하세요.');
      await this.chat.setConnectionChanging(true);
      await vscode.commands.executeCommand('vscode.openFolder', folder, { forceReuseWindow: true });
    } finally { await this.chat.setConnectionChanging(false); }
  }

  private async handle(msg: StartRequest): Promise<void> {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type.startsWith("account")) {
      if (!this.accounts) return;
      this.error = undefined;
      try {
        if (msg.type === "accountSignIn") await this.accounts.start();
        else if (msg.type === "accountCancel") this.accounts.cancel();
        else if (msg.type === "accountReopen") await this.accounts.reopen();
        else if (msg.type === "accountRefresh") await this.accounts.refreshView();
        else if (msg.type === "accountManage") await this.accounts.openAccount();
        else if (msg.type === "accountSignOut") { this.candidate = undefined; await this.accounts.signOut(); }
        else if (msg.type === "accountActivate") await this.activateAccountPass(msg.passId);
      } catch (e) { this.error = e instanceof AccountError ? e.message : "계정을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요."; }
      await this.refresh(); return;
    }

    if (!msg || typeof msg !== "object") return;
    if (msg.type === "openLocalReview") { await vscode.commands.executeCommand("hypeproof-chat.localReview"); return; }
    if (msg.type === "startReady") {
      void this.accounts?.refreshView(); await this.refresh(); void Promise.all([this.loadProducts(), this.loadTrialOffer()]).then(() => this.refresh()); return; }
    if (msg.type === "purchaseOpen" || msg.type === "purchaseStart" || msg.type === "purchaseReopen" || msg.type === "purchaseRetry" || msg.type === "purchaseCancel" || msg.type === "purchaseHide") { await this.handlePurchase(msg); return; }
    if (msg.type === "inboxOpen") { await this.chat.inboxSource?.inboxOpened(msg.objectId, msg.generation); return; }
    if (msg.type === "inboxLink") { await this.chat.handleInboxLink(msg); return; }
    if (msg.type === "openStudioFiles" || msg.type === "openStudioSettings") {
      await vscode.commands.executeCommand(msg.type === "openStudioFiles" ? "workbench.view.explorer" : "workbench.action.openSettings");
      return;
    }
    if (msg.type==='exportLegacyHistory') {
      const keys=this.context.workspaceState.keys().filter(isLegacyHistoryKey);
      const file=await vscode.window.showSaveDialog({saveLabel:'이전 기록 저장',filters:{JSON:['json']}});
      if(file) {
        const backup={format:'hps-local-history-export/1',records:keys.map(key=>({source:key,messages:this.context.workspaceState.get(key,[])}))};
        try { await vscode.workspace.fs.writeFile(file,new TextEncoder().encode(JSON.stringify(backup,null,2))); }
        catch { this.error='기록을 저장하지 못했습니다. 다른 저장 위치를 선택해 주세요.'; await this.refresh(); }
      }
      return;
    }
    if (msg.type === "githubSignIn") { await this.signInToGithub(); return; }
    if (msg.type === "continueFromGithub" || msg.type === "startNew") { await this.startFromGithubChoice(msg); return; }
    if (this.busy) return;
    const connections = activityConnections(this.context);
    if (this.chat.hasActiveStream()) { this.error = "진행 중인 작업을 마치거나 중지한 후 활동을 변경하세요."; await this.refresh(); return; }
    if (msg.type === "openLocalFolder") {
      if (this.choosingFolder) return;
      this.choosingFolder = true;
      try {
        const folders = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "작업 폴더 열기" });
        const folder = folders?.[0];
        if (!folder) return;
        try {
          const bound = await connections?.forWorkspace(folder.fsPath);
          if (bound) {
            // Reuse saved-activity validation, preparation and rollback; no second auth path.
            await this.handle({ type: 'selectActivity', ref: bound.ref });
            if (!this.error && this.candidate?.token === bound.token) await this.handle({ type: 'beginCourse' });
          } else if (connections?.matchesService && connections.current) {
            const choice = await vscode.window.showInformationMessage(
              '이 폴더에는 연결된 활동이 없습니다. 현재 활동의 작업 폴더로 연결할까요?',
              { modal: true }, '현재 활동 연결', '폴더만 열기');
            if (choice === '현재 활동 연결') {
              const current = connections.current;
              await this.handle({ type: 'selectActivity', ref: current.ref });
              if (!this.error && this.candidate?.token === current.token) { this.candidate.workspace = folder.fsPath; await this.handle({ type: 'beginCourse' }); }
            } else if (choice === '폴더만 열기') await this.openUnboundFolder(folder);
          } else await this.openUnboundFolder(folder);
        } catch (error) { this.error = entryError(error); await this.refresh(); }
      } finally { this.choosingFolder = false; }
      return;
    }
    if (msg.type === 'selectActivity') {
      this.busy = true;
      try {
        const record = await connections?.candidate(msg.ref);
        // ActivityConnectionError 여야 한다. 평범한 Error 는 entryError 가 일반 문구로
        // 덮어써서, 여기 적힌 이유가 학생에게 **한 번도 도달하지 않는다**(#960 에서
        // 테스트를 쓰다 발견). 저장 목록에서 고른 항목이 사라진 경우는 재시도가 아니라
        // 다른 항목 선택이 답이므로 일반 문구보다 이 문장이 맞다.
        if (!record) throw new ActivityConnectionError('저장된 활동을 찾지 못했습니다.');
        const result = await fetchProfileResult({proxyUrl:record.service,token:record.token});
        if (!result.ok) {this.error=result.failure.friendly; return;}
        this.candidate = {token:record.token,proxyUrl:record.service,profile:result.profile,workspace:record.workspace,previousConnected:!!connections?.current,...(record.accountPass?{accountPass:record.accountPass}:{})};
        this.error = undefined;
      } catch (error) { this.error = entryError(error); }
      finally { this.busy=false; await this.refresh(); }
      return;
    }
    if (msg.type === 'chooseActivityFolder' && this.candidate) {
      const choice = await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:false,openLabel:'이 활동의 작업 폴더 선택'});
      if (choice?.[0]) this.candidate.workspace=choice[0].fsPath;
      await this.refresh(); return;
    }
    if (msg.type === "cancelCandidate") {
      this.candidate = undefined; this.error = undefined; await this.refresh(); return;
    }
    if (msg.type === "disconnectCourse") {
      this.busy = true;
      try {
        await this.chat.setConnectionChanging(true);
        await this.context.secrets.delete(TOKEN_KEY);
        this.candidate = undefined; this.chat.invalidateProfile(); this.error = undefined; this.started = false;
        this.chat.refreshConfig();
      } catch (error) { this.error=entryError(error); } finally {
        this.busy = false; await this.chat.setConnectionChanging(false); await this.refresh();
      }
      return;
    }
    if (msg.type === "beginCourse") {
      const candidate = this.candidate;
      const wasStarted = this.started;
      let previous: string | undefined;
      let committed = false;
      let rollback: (() => Promise<void>) | undefined;
      this.busy = true; this.error = undefined;
      let profile: ResolvedProfile | null = null;
      try {
        await this.chat.setConnectionChanging(true);
        await this.refresh();
        // A connected card is not proof that the session is still live.
        if (candidate) {
          const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
          if (proxyUrl !== candidate.proxyUrl) throw new Error("Activity Service changed during confirmation");
          if (candidate.accountPass) { const fresh = await this.accounts?.resolvePass(candidate.accountPass); if (!fresh) throw new AccountError("unauthorized", "Google로 다시 로그인해 주세요."); candidate.token = fresh; }
          const result = await fetchProfileResult({ proxyUrl, token: candidate.token });
          if (!result.ok) { this.error = result.failure.friendly; return; }
          // Service authority stays separate from the local navigation choice.
          profile = result.profile;
          if (!profile?.profile_id || !profile.display_name || !profile.ux?.coach || !profile.welcome) throw new Error("Invalid activity profile");
        } else profile = await this.chat.ensureProfile(true);
        if (!profile) {
          this.error = this.chat.profileFailure()?.friendly ?? "수업 연결을 확인할 수 없습니다. 참여 코드를 다시 확인해주세요.";
          return;
        }
        if (connections) {
          const token = candidate?.token ?? await connections.token();
          if (!token) throw new Error('참여 코드를 다시 입력해 주세요.');
          await verifyActivity({proxyUrl:candidate?.proxyUrl ?? vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1'),token},profile.activity_id ?? '');
        }
        const commit = async (directory?: string) => {
          if (!this.panel || (candidate && !committed && this.candidate !== candidate)) throw new Error("Activity entry was cancelled");
          if (!candidate || committed) return;
          previous = await this.context.secrets.get(TOKEN_KEY);
          if (!this.panel || this.candidate !== candidate) throw new Error("Activity entry was cancelled");
          if (connections) {
            const root = directory ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) throw new Error('작업 폴더를 선택해 주세요.');
            rollback = await connections.commit(candidate.token,profile!,root,candidate.accountPass);
          } else await this.context.secrets.store(TOKEN_KEY, candidate.token);
          committed = true;
          // REQ-L12 — the purchased activity is entered; the order record has done its job.
          if (this.purchaseToken === candidate.token) { this.purchaseToken = undefined; await this.context.secrets.delete(PENDING_PURCHASE_KEY); }
          this.chat.invalidateProfile();
          if (vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1") !== candidate.proxyUrl) throw new Error("Activity Service changed during confirmation");
          if (!await this.chat.ensureProfile(true)) throw new Error('connection validation failed');
          if (!this.panel || this.candidate !== candidate) throw new Error("Activity entry was cancelled");
          this.candidate = undefined;
        };
        const selectedWorkspace = candidate?.workspace ?? (connections?.matchesService && connections.current?.serverId === profile.activity_id ? connections.current?.workspace : undefined);
        if (await this.begin(profile, commit, selectedWorkspace)) return; // workspace switch reloads the window
        await commit();
        if (!this.panel) throw new Error('Entry page was closed');
        await this.openChat();
      } catch (error) {
        let restoreFailed = false;
        if (committed) {
          try {
            if (rollback) await rollback();
            else if (previous) await this.context.secrets.store(TOKEN_KEY, previous);
            else await this.context.secrets.delete(TOKEN_KEY);
          } catch { restoreFailed = true; }
          this.chat.invalidateProfile();
        }
        this.candidate = !restoreFailed && this.panel ? candidate : undefined;
        this.started = !restoreFailed && wasStarted;
        this.error = restoreFailed
          ? '활동 연결 복구를 완료하지 못했습니다. 파일은 삭제하지 않았습니다. 앱을 다시 열어 현재 활동을 확인해 주세요.'
          : entryError(error);
      } finally {
        this.busy = false; await this.chat.setConnectionChanging(false);
        await this.refresh();
      }
      return;
    }
    if (msg.type !== "connectCourse" || typeof msg.token !== "string") return;
    const token = sanitizeWorkshopToken(msg.token);
    if (!token) { this.error = "수업 참여 코드를 입력하세요."; await this.refresh(); return; }
    if (looksLikeIssuerTokenUnverified(token)) {
      this.error = "강사용 코드입니다. 수강생 참여 코드를 입력하세요."; await this.refresh(); return;
    }
    const entryPanel=this.panel;
    this.busy = true; this.error = undefined;
    try {
      await this.chat.setConnectionChanging(true);
      await this.refresh();
      const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
      const result = await fetchProfileResult({ proxyUrl, token });
      if (!result.ok) { this.error = result.failure.friendly; return; }
      const p = result.profile;
      if (!p?.profile_id || !p.display_name || !p.ux?.coach || !p.welcome) {
        this.error = "수업 정보 응답을 읽지 못했습니다. 잠시 후 다시 연결하세요."; return;
      }
      if (!entryPanel || this.panel!==entryPanel) return;
      // Preview only. Existing runtime and credential stay bound until workspace preparation succeeds.
      const running = await this.chat.ensureProfile(), connections = activityConnections(this.context);
      const workspace = reentryWorkspace({ candidateActivity: p.activity_id, record: connections?.current ?? null, recordServiceMatches: !!connections?.matchesService, openFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, runningActivity: running?.activity_id });
      this.candidate = { token, profile: p, proxyUrl, previousConnected: !!running, ...(workspace ? { workspace } : {}) };
      // GitHub first (user requirement 2026-10-13): the served profile names the class folder.
      const classRoot = this.githubSource?.allowed(p) ? this.githubSource.classRoot(p) : null;
      if (classRoot) this.lookAtGithub(this.candidate, classRoot);
      else this.github = undefined;
    } catch (error) {
      console.error('[startPage] connectCourse failed:', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      this.error = "수업에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.";
    } finally {
      this.busy = false; await this.chat.setConnectionChanging(false);
      await this.refresh();
    }
  }
}
