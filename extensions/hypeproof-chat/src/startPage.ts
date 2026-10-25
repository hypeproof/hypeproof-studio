import { PersonalSpace } from "./personalSpace";
import { PersonalRecords } from './personalRecords';
import { confirmPersonalRecord, downloadPersonalRecord } from './personalRecordHost';
import * as vscode from "vscode";
import { AccountError, type AccountSession, type AccountPassBinding } from "./accountSession";
import { ChatPanelProvider } from "./chatPanelProvider";
import { ActivityConnectionError, FOLDER_TAKEN_MESSAGE, activityConnections, passTakesOver } from "./activityConnections";
import { carryoverAdvertised, carryoverOfferKey, carryoverSourceOf, newOffer, validOffer } from "./trialCarryoverHelpers";
import { fetchProfileResult, verifyActivity, ProxyTransportError } from "./proxyClient";
import { sanitizeWorkshopToken, looksLikeIssuerTokenUnverified, reentryWorkspace } from "./chatPanelHelpers";
import * as path from "node:path";
import type { ResolvedProfile } from "./protocol";
import type { StartRequest, StartState } from "./startPageProtocol";
import { PURCHASE_COPY, POLL_INTERVAL_MS, claimWithRecovery, createOrder, fetchProducts, pollOrder, restorePendingOrder, waitDecision, withTrialPassPointer, type PassProduct, type PendingOrder, type PurchaseView } from "./passPurchase";
import { isPurchaseReturnOrderId } from "./purchaseReturnHelpers";
import type { ClassReposOutcome } from "./publish/publishHost";
import { fetchTrialOffer, freeStartAdvertised, type TrialOffer } from "./trialOffer";
import { AGE_KEY, FREE_CLAIM_REFUSALS, freeSeatEnding, INSTALL_ID_KEY, PAYER_ADULT_KEY, belowFloor, claimFreeStart, guardianUrl, isAgeAnswer, isInstallId, type AgeAnswer, type FreeClaimRefusal, type FreeClaimResult } from "./freeStart";
import type { FreeStartView } from "./startPageProtocol";
import { isFreeSeat } from "./seatVocabulary";
import { qrDataUrl } from "./testQr";
import { randomUUID } from "node:crypto";
import type { ClassRepo } from "./publish/githubContinue";
import { JOIN_LINK_COPY, classOfCode, isClassId } from "./joinLink";
import { passSurface, type PassSurface, type PurchasePathEvent } from "./funnelEvents";

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

/** `replacesFree` (CONV-PURCHASE-R-005): the free seat's binding id this paid pass replaces in place. */
type Candidate = { token: string; profile: ResolvedProfile; proxyUrl: string; previousConnected: boolean; workspace?: string; accountPass?: AccountPassBinding; replacesFree?: string };
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
  /** TUX-COND-07 — one press of the chat card's "이용권 살펴보기"; cleared with the tab. */
  private purchaseFocus?: number;
  private purchaseTimer?: ReturnType<typeof setTimeout>;
  /** A check is on the wire; a purchase-return link arriving meanwhile does not start a second one. */
  private purchaseTickRunning = false;
  /** The code issued for the saved order, while its activity is previewed but not yet entered. */
  private purchaseToken?: string;
  private github?: GithubLook;
  /** Free start (TUX-SP-14) — a claim, or the entry it leads into, is running. */
  private freeClaiming = false;
  /** The last claim refusal, shown until the next attempt. */
  private freeRefusal?: FreeClaimRefusal;
  /** The current seat is the free allowance (read in refresh; steers the purchase payer question). */
  private freeSeatNow = false;
  /** No activity at all while the Service advertises free start: a newcomer buying before any use. */
  private freeNewcomer = false;
  /** This window's Service refused an order with `account_required` (login at purchase). */
  private accountRequired = false;
  /**
   * CONV-PURCHASE-R-002 — the pass chosen when the purchase-time sign-in began. Host memory only:
   * a catalogue product id, never a secret, never in a URL. Given back to the list while it is open.
   */
  private purchasePick?: string;
  /** SPEC §2.5 — a guardian pays: the checkout link and QR shown instead of opening a browser here. */
  private guardianCheckout?: { url: string; qr: string };
  /** The first start-page paint waits briefly for the offer, so a newcomer does not see the code choices flash. */
  private offerWaited = false;
  /** REQ-STUDIO-JOIN-LINK — the class a join link named, until a code is confirmed or the learner drops it. */
  private joinLink?: { classId: string; seq: number };
  /** CONV-FUNNEL-R-006 — where the pass list on screen was opened from (end card, header link, start page). */
  private passListSurface: PassSurface = "start_page";
  /** CONV-FUNNEL-R-006 — the pass list was on screen at the last paint; a new appearance counts once. */
  private passListShown = false;
  /** CONV-FUNNEL-R-006 — a purchase-time sign-in begun from the list on this surface and not finished yet. */
  private purchaseSignIn?: PassSurface;
  private personalSpace?: PersonalSpace;
  private personalRecords?: PersonalRecords;
  private recordsEnabled(): boolean {
    return vscode.workspace.getConfiguration('hypeproofChat').get<boolean>('personalRecordsPreview', false)
      && (this.context.extensionMode === vscode.ExtensionMode.Development || this.context.extensionMode === vscode.ExtensionMode.Test);
  }
  private records(): PersonalRecords | undefined {
    if (!this.personalRecords && this.accounts && this.context.globalStorageUri?.fsPath && this.recordsEnabled()) {
      this.personalRecords = new PersonalRecords({ account: this.accounts, directory: path.join(this.context.globalStorageUri.fsPath, 'personal-record-outbox'),
        settings: () => ({ ...this.settings(), preview: this.recordsEnabled() }),
        changed: () => { void this.refresh(); }, confirm: confirmPersonalRecord, download: downloadPersonalRecord });
    }
    return this.personalRecords;
  }
  constructor(
    private context: vscode.ExtensionContext,
    private chat: ChatPanelProvider,
    private begin: (profile: ResolvedProfile, commit: (directory?: string) => Promise<void>, selectedDirectory?: string) => Promise<boolean>,
    private githubSource?: GithubContinueSource,
    private accounts?: AccountSession,
  ) {
    if (accounts) this.personalSpace = new PersonalSpace({ account: accounts, settings: () => this.settings(), changed: () => { void this.refresh(); } });
  }

  accountChanged(): void {
    this.personalSpace?.sync();
    this.records()?.sync();
    // CONV-FUNNEL-R-006 — the purchase-time sign-in finished (or ended without an account).
    const account = this.accounts?.view();
    if (this.purchaseSignIn && account?.status === "signedIn") { this.purchasePathEvent("sign_in_completed", this.purchaseSignIn); this.purchaseSignIn = undefined; }
    else if (this.purchaseSignIn && (!account || (account.status === "signedOut" && !account.busy))) this.purchaseSignIn = undefined;
    if (this.candidate?.accountPass && this.accounts?.view().status === "signedOut") this.candidate = undefined;
    // Signed in after a login-at-purchase prompt: the prompt has been answered.
    if (this.accounts?.view().status === "signedIn" && this.purchaseMessage === PURCHASE_COPY.signInFirst) this.purchaseMessage = undefined;
    // CONV-PURCHASE-R-002 — the chosen pass comes back only to the list it was chosen on. Signed in
    // anywhere else (waiting, stopped, list closed): nothing is restored later.
    if (this.accounts?.view().status === "signedIn" && this.purchaseStage !== "choosing") this.purchasePick = undefined;
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

  /**
   * REQ-STUDIO-JOIN-LINK — a class join link was opened (the URI handler already asked the learner
   * if a turn was running or another class was in use). Bring the join form forward with the class
   * named above an empty code field. Nothing is fetched, stored, entered or switched here: the
   * learner types the code and starts the class themselves, through the ordinary path.
   */
  async openJoinLink(classId: string): Promise<void> {
    if (!isClassId(classId)) return;
    this.joinLink = { classId, seq: (this.joinLink?.seq ?? 0) + 1 };
    this.error = undefined;
    await this.show();
    await this.refresh();
  }

  /**
   * CONV-PURCHASE-R-004 (REQ-L12 ⑤⑥) — the Lab done page's "Studio로 돌아가기" link was opened
   * (extension.ts already checked the URI shape). The start page comes forward. Only when this
   * window already holds a pending order with the same id does it run the check `purchaseRetry`
   * runs, once: a paid answer then takes the ordinary claim path (and CONV-PURCHASE-R-005's in-place
   * switch from a free seat). Any other id, no held order, or a claimed record only shows the page:
   * nothing is created, claimed or reissued for a link, and no error is drawn.
   * Returns whether a check was scheduled.
   */
  async purchaseReturned(orderId: string): Promise<boolean> {
    if (!isPurchaseReturnOrderId(orderId)) return false;
    const read = this.order ?? await this.savedOrder();
    // The order may have been set while SecretStorage was read (a fresh page's resumePurchase): keep
    // that object, so an in-flight check still recognises it and schedules the next one.
    const held = this.order ?? read;
    // A claimed record waits for the buyer's own "다시 연결" (replacing a code rotates the credential).
    if (!held || held.id !== orderId || held.claimed || this.purchaseStage === "connecting") { await this.show(); return false; }
    this.order = held;
    this.purchaseStage = "waiting"; this.purchaseMessage = PURCHASE_COPY.waiting;
    // show() has no await before it returns: a timer its resumePurchase schedules is replaced by the
    // one below in the same tick, so repeated opens leave one pending check, never two.
    await this.show();
    if (this.purchaseTickRunning) return true;
    this.schedulePurchasePoll(0);
    await this.refresh();
    return true;
  }

  /** The class of the seat stored on this machine (unverified; used only to word the switch question). */
  async currentClassId(): Promise<string | undefined> {
    return classOfCode(await this.currentToken());
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
    panel.onDidDispose(() => { if (this.panel === panel) { const preview = this.personalRecords?.view()?.preview; if (preview) this.personalRecords?.cancel(preview.nonce); this.panel = undefined; this.candidate = undefined; this.purchaseFocus = undefined; this.purchasePick = undefined; this.purchaseSignIn = undefined; this.stopPurchaseWait();
      // CONV-FUNNEL-R-006 — a reopened tab starts on the start choices, not on the list (the webview
      // draws the list only after an open), so a list left in `choosing` is not a new view until opened again.
      this.passListShown = true; this.accounts?.cancel(false); } });
    this.context.subscriptions.push(panel);
    void this.resumePurchase();
  }

  private settings() {
    const config = vscode.workspace.getConfiguration("hypeproofChat");
    return { proxyUrl: config.get<string>("proxyUrl", DEFAULT_PROXY_URL), siteBase: config.get<string>("siteBase", DEFAULT_SITE_BASE) };
  }
  /** The current seat's participant token (free-credential header only). */
  private async currentToken(): Promise<string | undefined> {
    try { return (await activityConnections(this.context)?.token()) ?? await this.context.secrets.get(TOKEN_KEY); }
    catch { return undefined; }
  }
  /**
   * CONV-FUNNEL-R-007: the free seat's credential for a sign-in that starts now, so the Service can
   * link that free seat to the account (same value and rule as the order header). Any other seat,
   * or no readable token, gives undefined: no header.
   */
  async freeSignInCredential(): Promise<string | undefined> { return this.freeSeatNow ? await this.currentToken() : undefined; }
  private stopPurchaseWait(): void { if (this.purchaseTimer) clearTimeout(this.purchaseTimer); this.purchaseTimer = undefined; }
  /**
   * Login at purchase (Jay 2026-10-19, "결제할때 구글로그인 필수로 하자"). A free seat, a newcomer
   * under free start, and any purchase after the Service answered `account_required` need a Google
   * account. The Service's free-start readiness requires HPS_PURCHASE_ACCOUNT_REQUIRED, so an
   * advertised free start means anonymous orders are refused anyway. Code-issued and class seats
   * keep today's path until the Service says otherwise. Never asked before purchase: the first
   * screen has no login.
   */
  private loginAtPurchase(): boolean { return this.freeSeatNow || this.freeNewcomer || this.accountRequired; }
  /**
   * CONV-FUNNEL-R-006 — one purchase-path funnel event for a free seat (Service #168). The chat host's
   * reporter sends it with the seat's grant token, only when the Service's probe lists the type, and
   * never throws. Any other seat (pass, code-issued trial, class, none) sends nothing.
   */
  private purchasePathEvent(type: PurchasePathEvent, surface: PassSurface = this.passListSurface): void {
    if (!this.freeSeatNow) return;
    try { this.chat.funnelEmit?.({ type, surface }); } catch { /* telemetry never interrupts a purchase */ }
  }
  /** What blocks checkout for want of an account; undefined when checkout may go ahead. */
  private loginGate(): PurchaseView["login"] {
    if (!this.loginAtPurchase()) return undefined;
    if (!this.accounts) return "unavailable";
    return this.accounts.view().status === "signedIn" ? undefined : "signIn";
  }
  private purchaseView(): PurchaseView {
    const payerAdult = this.context.globalState?.get<unknown>(PAYER_ADULT_KEY);
    const login = this.order ? undefined : this.loginGate();
    return {
      ...(login ? { login } : {}),
      ...(this.freeSeatNow ? { freeSeat: true, ...(typeof payerAdult === "boolean" ? { payerAdult } : {}) } : {}),
      ...(this.guardianCheckout && this.order ? { guardian: this.guardianCheckout } : {}),
      available: !!this.products?.length || !!this.order,
      ...(this.products?.length ? { products: this.products } : {}),
      ...(this.purchaseStage ? { stage: this.purchaseStage } : {}),
      ...(this.order ? { order: { label: this.order.label, amount: this.order.amount } } : {}),
      ...(this.purchaseMessage ? { message: this.purchaseMessage } : {}),
      ...(this.purchaseFocus ? { focus: this.purchaseFocus } : {}),
      ...(this.selectedPass() ? { selected: this.selectedPass() } : {}),
    };
  }
  /** CONV-PURCHASE-R-002 — remember the chosen pass when the purchase-time sign-in begins. */
  private notePurchasePick(productId: unknown): void {
    if (typeof productId !== "string" || this.purchaseStage !== "choosing" || this.order) return;
    if (!this.products?.some(p => p.id === productId)) return;
    this.purchasePick = productId;
  }
  /** The remembered pass, only while the pass list is open and still sells it. */
  private selectedPass(): string | undefined {
    const pick = this.purchasePick;
    if (!pick || this.purchaseStage !== "choosing" || this.order) return undefined;
    return this.products?.some(p => p.id === pick) ? pick : undefined;
  }
  /** TUX-SP-12 — one credential-free read per window; never `/v1/profile`, which would start a trial clock. */
  private async loadTrialOffer(): Promise<void> {
    if (this.trialOffer !== undefined) return;
    this.trialOffer = await fetchTrialOffer(this.settings().proxyUrl);
  }

  // ── Free start (SPEC iteration 4 §2; TUX-SP-14/15/16) ────────────────────────────────────────
  /** Advertised by the Service and not switched off on this machine. */
  private freeStartOn(): boolean {
    const setting = vscode.workspace.getConfiguration("hypeproofChat").get<string>("freeStart", "service");
    return setting !== "off" && freeStartAdvertised(this.trialOffer);
  }
  /**
   * D19/REQ-I15 — the free-start signal the update checker reads (`registerPublicUpdateSignal`).
   * True only once this window has read an offer that advertises free start and the local kill
   * switch is not "off"; before any offer is read it is false, so members are never rerouted.
   */
  freeStartSignal(): boolean {
    return this.freeStartOn();
  }
  private ageAnswer(): AgeAnswer | undefined {
    const v = this.context.globalState?.get<unknown>(AGE_KEY);
    return isAgeAnswer(v) ? v : undefined;
  }
  private appVersion(): string { return String(this.context.extension.packageJSON.version ?? ""); }
  private freeStartView(running?: ResolvedProfile | null): FreeStartView | undefined {
    if (!this.freeStartOn()) return undefined;
    const offer = this.trialOffer!;
    // e2e D2 — a saved free seat whose window is over: never offer a fresh start beside its end.
    const ended = !running && !this.candidate ? freeSeatEnding(this.chat.profileFailure()) : undefined;
    const age = this.ageAnswer();
    // Jay 2026-10-19: no allowance before use — a free seat just starts, the way other products
    // do, and the end card asks for a pass when the allowance is spent.
    const tooOld = belowFloor(this.appVersion(), offer.minAppVersion) || this.freeRefusal?.code === "app_too_old";
    return {
      ...(age ? { age } : {}),
      ...(this.freeClaiming ? { claiming: true } : {}),
      ...(this.freeRefusal ? { refusal: this.freeRefusal } : {}),
      ...(offer.available === false ? { unavailable: offer.reason ?? "paused" } : {}),
      ...(tooOld ? { tooOld: true } : {}),
      ...(ended ? { ended } : {}),
    };
  }
  /**
   * The per-install id (UUID v4), created at the first claim. SecretStorage first; if it cannot be
   * used, globalState (not synced). It never reaches a webview, a log line or a funnel event.
   */
  private async installId(): Promise<string> {
    try { const v = await this.context.secrets.get(INSTALL_ID_KEY); if (isInstallId(v)) return v; } catch { /* fall back below */ }
    const kept = this.context.globalState?.get<unknown>(INSTALL_ID_KEY);
    if (isInstallId(kept)) return kept;
    const id = randomUUID();
    try { await this.context.secrets.store(INSTALL_ID_KEY, id); }
    catch { await this.context.globalState?.update(INSTALL_ID_KEY, id); }
    return id;
  }
  private async freeStartAge(answer: AgeAnswer): Promise<void> {
    if (!this.freeStartOn() || this.freeClaiming) return;
    await this.context.globalState?.update(AGE_KEY, answer);
    this.freeRefusal = undefined; this.error = undefined;
    await this.refresh();
    if (answer === "14+") { await this.freeStartClaim(); return; }
    // Under 14: the block is shown whatever the Service answers (also offline). The claim is sent
    // with age_ok:false only so the Service counts the refusal; nothing is issued.
    try { await claimFreeStart({ proxyUrl: this.settings().proxyUrl, installId: await this.installId(), appVersion: this.appVersion(), ageOk: false }); }
    catch { /* counted or not, the block stands */ }
  }
  private async freeStartClaim(): Promise<void> {
    if (!this.freeStartOn() || this.busy || this.freeClaiming || this.ageAnswer() !== "14+") return;
    if (this.chat.hasActiveStream()) { this.error = "진행 중인 작업을 마치거나 중지한 후 활동을 변경하세요."; await this.refresh(); return; }
    if (belowFloor(this.appVersion(), this.trialOffer?.minAppVersion)) {
      this.freeRefusal = { code: "app_too_old", message: FREE_CLAIM_REFUSALS.app_too_old! }; await this.refresh(); return;
    }
    this.freeClaiming = true; this.freeRefusal = undefined; this.error = undefined;
    await this.refresh();
    try {
      const proxyUrl = this.settings().proxyUrl;
      const installId = await this.installId();
      const claim = (): Promise<FreeClaimResult> => claimFreeStart({ proxyUrl, installId, appVersion: this.appVersion(), ageOk: true });
      let result = await claim();
      // A request in flight holds the seat's lease: one automatic retry, then the busy sentence.
      if (!result.ok && result.code === "claim_busy") { await new Promise(r => setTimeout(r, 3000)); result = await claim(); }
      if (!result.ok) { this.freeRefusal = { code: result.code, message: result.message, ...(result.resumesAt ? { resumesAt: result.resumesAt } : {}) }; return; }
      this.chat.noteFreeClaim?.(result.code, result.outcome);
      // From here the issued token takes the ordinary entry path, without a preview or a folder choice:
      // the served profile names the workspace (~/HypeProofTrial), created if missing.
      await this.handle({ type: "connectCourse", token: result.code });
      if (this.candidate?.token !== result.code || this.error) return;
      // REQ-STUDIO-FREE-START (Jay 2026-10-20: "자동으로 돼야지") — a free start never stops on a
      // folder and never asks. The home is reused when the machine owner's earlier trial or free use
      // holds it; when a class or a pass holds it, the next numbered folder (~/HypeProofTrial-2, …)
      // is used instead. Files in the held folder stay where they are.
      const connections = activityConnections(this.context), tried = new Set<string>();
      for (let attempt = 0; ; attempt++) {
        const c: Candidate | undefined = this.candidate;
        if (!c) break;
        if (connections && (!c.workspace || tried.has(c.workspace))) {
          const folder = await connections.freeWorkspace(c.profile, tried).catch(() => undefined);
          if (folder) c.workspace = folder;
        }
        await this.handle({ type: "beginCourse" });
        // Taken between the choice and the claim (another window): the next folder, silently.
        if (this.error !== FOLDER_TAKEN_MESSAGE || attempt >= 2 || this.candidate !== c || !c.workspace) break;
        tried.add(c.workspace); this.error = undefined;
      }
    } catch {
      this.freeRefusal = { code: "network", message: "연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요." };
    } finally {
      this.freeClaiming = false;
      await this.refresh();
    }
  }
  /**
   * TUX-COND-07 — "이용권 살펴보기" on the chat's end-of-trial card. The person pressed it, so
   * the start page opens on the pass list (REQ-L12 ②). No order is created until they choose.
   */
  async showPurchase(surface?: unknown): Promise<void> {
    // CONV-FUNNEL-R-006 — the command argument names the surface; anything else is the end card's.
    this.passListSurface = passSurface(surface, "end_card");
    await this.show();
    await this.handlePurchase({ type: "purchaseOpen" });
    this.purchaseFocus = Date.now();
    await this.refresh();
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
    this.order = undefined; this.purchaseStage = "stopped"; this.purchaseMessage = message; this.guardianCheckout = undefined;
    await this.refresh();
  }
  private async purchaseTick(): Promise<void> {
    const order = this.order;
    if (!order || !this.panel) return;
    this.purchaseTickRunning = true;
    let state: Awaited<ReturnType<typeof pollOrder>>;
    try { state = await pollOrder(order); } finally { this.purchaseTickRunning = false; }
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
    // CONV-PURCHASE-R-005 — read before the claim: the free seat this window runs, if any.
    const freeSeat = this.freeSeatInWindow();
    this.purchaseStage = "connecting"; this.purchaseMessage = PURCHASE_COPY.connecting;
    await this.refresh();
    if (order.accountOwned) {
      let activated = false;
      try {
        await this.accounts?.refreshView();
        await this.activateAccountPass(order.id);
        await this.context.secrets.delete(PENDING_PURCHASE_KEY);
        this.order = undefined; this.purchaseStage = undefined; this.purchaseMessage = undefined;
        activated = true;
      } catch (e) { this.purchaseStage = "stopped"; this.purchaseMessage = e instanceof AccountError ? e.message : PURCHASE_COPY.claimFailed; }
      if (activated) await this.switchSeatInPlace(freeSeat);
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
      await this.switchSeatInPlace(freeSeat);
    } else { this.purchaseStage = "stopped"; this.purchaseMessage = PURCHASE_COPY.claimFailed; }
    await this.refresh();
  }
  /**
   * CONV-PURCHASE-R-005 — the free seat this window runs (its folder binding pins the record to the
   * window). Read from the saved record, not the profile: an ended free seat no longer serves one.
   */
  private freeSeatInWindow(): { id: string; workspace: string } | undefined {
    const seat = activityConnections(this.context)?.current;
    return seat?.free === true && seat.workspace ? { id: seat.id, workspace: seat.workspace } : undefined;
  }
  /**
   * CONV-PURCHASE-R-005 / REQ-L12 ⑮ — the Service answered paid while this window runs a free seat:
   * the pass takes the free seat's place without the preview press, in the same folder, through
   * the ordinary entry (`beginCourse`: profile and activity check, binding, rollback). Free start
   * never blocks: if anything in that entry fails, the free seat is restored by the entry's own
   * rollback, the error is not shown, and today's preview stays with the pass's ordinary folder,
   * so `이 활동 시작하기` (or `다시 연결`, the order record being kept) can try again.
   */
  private async switchSeatInPlace(seat: { id: string; workspace: string } | undefined): Promise<void> {
    const c = this.candidate;
    if (!seat || !c?.profile.pass) return;
    const ordinary = c.workspace;
    c.workspace = seat.workspace; c.replacesFree = seat.id;
    await this.handle({ type: "beginCourse" });
    if (this.candidate !== c) return; // entered (or the entry could not even restore: keep that message)
    c.workspace = ordinary; c.replacesFree = undefined;
    this.error = undefined;
  }
  private async handlePurchase(msg: StartRequest): Promise<void> {
    if (msg.type === "purchaseOpen") {
      // Every open is a new view of the list, even when it was already on screen.
      this.passListShown = false;
      await this.loadProducts(true);
      if (!this.order) { this.purchaseStage = this.products?.length ? "choosing" : "stopped"; this.purchaseMessage = this.products?.length ? undefined : PURCHASE_COPY.unavailable; }
      await this.refresh(); return;
    }
    if (msg.type === "purchaseCancel") {
      // Cancelling stops the wait only. A saved paid order is never thrown away from here.
      this.stopPurchaseWait(); this.purchaseFocus = undefined;
      if (this.order && this.purchaseStage !== "connecting") { this.purchaseStage = "stopped"; this.purchaseMessage = PURCHASE_COPY.cancelled; }
      else if (!this.order) { this.purchaseStage = undefined; this.purchaseMessage = undefined; }
      this.purchasePick = undefined;
      await this.refresh(); return;
    }
    if (msg.type === "purchaseHide") {
      // Back to the other ways to start. The order stays saved and the choice list offers it again.
      this.stopPurchaseWait(); this.purchaseFocus = undefined;
      if (this.purchaseStage !== "connecting") { this.purchaseStage = undefined; this.purchaseMessage = undefined; }
      this.purchasePick = undefined;
      await this.refresh(); return;
    }
    if (msg.type === "purchaseReopen") {
      if (this.order && await vscode.env.openExternal(vscode.Uri.parse(this.order.checkoutUrl))) this.purchasePathEvent("checkout_opened");
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
    if (msg.type === "purchasePayer") {
      if (typeof msg.adult === "boolean") await this.context.globalState?.update(PAYER_ADULT_KEY, msg.adult);
      await this.refresh(); return;
    }
    if (msg.type !== "purchaseStart" || typeof msg.productId !== "string" || this.order || this.busy) return;
    if (!this.products?.some(p => p.id === msg.productId)) return;
    // Login at purchase without an account runtime: no anonymous fallback. The view offers no pay
    // button in this state; this guards a stale view.
    if (this.loginGate() === "unavailable") { this.purchaseStage = "choosing"; this.purchaseMessage = undefined; await this.refresh(); return; }
    const { proxyUrl, siteBase } = this.settings();
    this.busy = true; await this.refresh();
    try {
      if (this.accounts && !this.accounts.matches(proxyUrl, siteBase)) throw new AccountError("settings_changed", "서버 설정이 바뀌었어요. Studio를 다시 열고 로그인해 주세요.");
      const accountToken = this.accounts ? await this.accounts.accessToken() : undefined;
      if (this.accounts && !accountToken) {
        if (this.loginAtPurchase()) { this.purchaseStage = "choosing"; this.purchaseMessage = PURCHASE_COPY.signInFirst; this.notePurchasePick(msg.productId); return; }
        throw new AccountError("authentication_required", "Google로 로그인한 뒤 이용권을 구매해 주세요.");
      }
      // CONV-PURCHASE-R-002 — the pay press is the person's latest choice. A remembered pick is spent
      // here, so a failed order and a retry never bring an older pass back over it.
      this.purchasePick = undefined;
      // SPEC iteration 4 §2.5 — an order made from a free seat carries its credential so the Service
      // can link the purchase to the free start. Header only; never shown or sent to the checkout page.
      const freeCredential = this.freeSeatNow ? await this.currentToken() : undefined;
      const result = await createOrder(proxyUrl, msg.productId, siteBase, accountToken, freeCredential);
      if (result === "account_required") {
        // The Service requires a Google account for this order. Back to the list with the sign-in
        // as the Primary (or the calm notice without an account runtime); nothing was ordered.
        this.accountRequired = true; this.purchaseStage = "choosing";
        this.purchaseMessage = this.accounts ? PURCHASE_COPY.signInFirst : undefined;
        if (this.accounts) this.notePurchasePick(msg.productId);
        if (this.accounts && accountToken) await this.accounts.refreshView();
        return;
      }
      const order = result && result !== "bad_checkout" ? { ...result, ...(accountToken ? {accountOwned:true} : {}) } : result;
      if (!order || order === "bad_checkout") { this.purchaseStage = "stopped"; this.purchaseMessage = order ? PURCHASE_COPY.badCheckout : PURCHASE_COPY.orderFailed; return; }
      // Save before opening the browser: once the buyer can pay, the secret must already be on disk.
      await this.context.secrets.store(PENDING_PURCHASE_KEY, JSON.stringify(order));
      this.order = order; this.purchaseStage = "waiting"; this.purchaseMessage = PURCHASE_COPY.waiting;
      // Under 19 on a free seat: the guardian pays on their own phone, so the page is shown here as a link and QR.
      if (msg.guardian && this.freeSeatNow) this.guardianCheckout = { url: order.checkoutUrl, qr: qrDataUrl(order.checkoutUrl) };
      else { this.guardianCheckout = undefined; if (await vscode.env.openExternal(vscode.Uri.parse(order.checkoutUrl))) this.purchasePathEvent("checkout_opened"); }
      this.schedulePurchasePoll();
    } catch (e) { this.purchaseStage = "stopped"; this.purchaseMessage = e instanceof AccountError ? e.message : PURCHASE_COPY.orderFailed; }
    finally { this.busy = false; await this.refresh(); }
  }

  /**
   * REQ-L12 ⑫ exception — a pass that takes over a trial's home folder may offer to continue the
   * trial conversation. Only an offer is written here (once per pass); nothing is copied or mixed
   * until the learner confirms it in the chat. Off unless the Service advertises it.
   */
  private async recordCarryoverOffer(profile: ResolvedProfile, root: string, previous: { id: string; name: string; workspace?: string; kind?: string; pass?: boolean; free?: boolean } | undefined, replacedFree = false): Promise<void> {
    const pass = activityConnections(this.context)?.current;
    // CONV-PURCHASE-R-005 — a pass that replaced the free seat in place took over that seat's folder,
    // which may be a numbered free folder rather than the pass's own home.
    if (!pass || !carryoverAdvertised(profile) || !(passTakesOver(profile, root) || replacedFree)) return;
    const from = carryoverSourceOf(previous, pass.id);
    if (!from) return;
    const key = carryoverOfferKey(pass.id);
    if (validOffer(this.context.globalState.get(key), pass.id)) return;
    try { await this.context.globalState.update(key, newOffer(pass.id, from)); }
    catch { /* An offer that could not be saved is simply not shown; entry must not fail for it. */ }
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
    // SPEC §2.5 — the running seat (not a candidate being previewed) decides the payer question and the header.
    const running = this.candidate ? null : p;
    this.freeSeatNow = isFreeSeat(running);
    this.freeNewcomer = !p && this.freeStartOn();
    const freeStart = this.freeStartView(running);
    const state: StartState = {
      legacyConnection:await activityConnections(this.context)?.hasLegacyConnection(),
      legacyHistory,
      activities,
      checking: this.busy,
      started: !this.candidate && this.started && !!p,
      candidate: !!this.candidate,
      previousConnected: this.candidate ? this.candidate.previousConnected : !!p,
      // REQ-L12 (13) — after a free trial ended, name the pass entry while it is drawn. Never open it.
      // The free card states a free seat's end itself (freeStart.ended), so its failure sentence is not repeated.
      error: withTrialPassPointer(this.error ?? (!p && !freeStart?.ended ? this.chat.profileFailure()?.friendly : undefined), !!this.products?.length),
      version: this.context.extension.packageJSON.version,
      workspace: vscode.workspace.workspaceFolders?.[0]?.name,
      ...(this.chat.inboxSource ? { inbox: await this.chat.inboxSource.inboxView() } : {}),
      purchase: this.purchaseView(),
      ...(this.accounts ? {account:this.accounts.view(), personalSpace:this.personalSpace?.view(), personalRecords:this.records()?.view()} : {}),
      ...(this.trialOffer ? { trialOffer: this.trialOffer } : {}),
      ...(freeStart ? { freeStart } : {}),
      ...(this.look() ? { github: this.look()!.state } : {}),
      ...(this.joinLink ? { joinLink: { ...this.joinLink } } : {}),
      ...(p ? { coachName: this.chat.coachDisplayName(p), profile: { kind: p.activity_kind, ...(p.pass ? { pass: p.pass } : {}), ...(p.trial && !p.pass ? { trial: p.trial } : {}), ...(isFreeSeat(p) ? { free: true } : {}), id: p.profile_id, name: p.lesson?.content.title ?? p.display_name,
        // #747 — the row is labelled "AI 이름", so it shows the name the rest of
        // the card uses. A student-named cohort that has not been named yet
        // describes the mode instead of showing the placeholder as a name.
        coach: this.chat.coachNameIsChosen(p) ? this.chat.coachDisplayName(p) : "직접 이름 짓는 코치",
        series: p.lesson?.version ?? `${p.series_index} / ${p.series_total}`, workspace: this.candidate?.workspace ?? p.workspace_root ?? "현재 작업 폴더" } } : {}),
    };
    // studio-funnel-events — the pass offer is on screen: the choice list shows it while no activity card is.
    if (this.panel && state.purchase?.available && !state.profile) this.chat.funnelEmit?.({ type: "offer_viewed", surface: "start_page" });
    // CONV-FUNNEL-R-006 — the pass list appears on screen (each open, and each return to it from another stage).
    const listShown = !!this.panel && this.purchaseStage === "choosing" && !!this.products?.length && !this.order;
    if (listShown && !this.passListShown) this.purchasePathEvent("pass_list_viewed");
    this.passListShown = listShown;
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
    if (['personalRecordPrepare', 'personalRecordSave', 'personalRecordCancel', 'personalRecordRetry', 'personalRecordsOpen', 'personalRecordOpen', 'personalRecordDownload'].includes(msg.type)) {
      const intent = msg as Extract<StartRequest, { projectId: string }>, space = this.personalSpace?.view();
      if (this.accounts?.view().account?.id !== intent.accountId || space?.selected?.id !== intent.projectId || !space.workspace) return;
      const records = this.records(); if (!records) return;
      await records.select(space.workspace, space.selected);
      if (msg.type === 'personalRecordPrepare') records.prepare(msg.includeFile);
      else if (msg.type === 'personalRecordSave') await records.save(msg.nonce, msg.digest);
      else if (msg.type === 'personalRecordCancel') records.cancel(msg.nonce);
      else if (msg.type === 'personalRecordRetry') await records.retry();
      else if (msg.type === 'personalRecordsOpen') await records.open();
      else if (msg.type === 'personalRecordOpen') await records.open(msg.recordId);
      else if (msg.type === 'personalRecordDownload') await records.download(msg.artifactId);
      await this.refresh(); return;
    }
    if (["personalSpaceOpen", "personalSpaceEnsure", "personalProjectCreate", "personalProjectOpen"].includes(msg.type)) {
      if (this.accounts?.view().account?.id !== (msg as { accountId?: string }).accountId) return;
      if (msg.type === 'personalProjectCreate' || msg.type === 'personalProjectOpen') await this.records()?.select();
      if (msg.type === "personalSpaceOpen") await this.personalSpace?.open();
      else if (msg.type === "personalSpaceEnsure") await this.personalSpace?.ensure();
      else if (msg.type === "personalProjectCreate") await this.personalSpace?.create(msg.title);
      else if (msg.type === "personalProjectOpen" && typeof msg.projectId === "string") await this.personalSpace?.open(msg.projectId);
      const space = this.personalSpace?.view(); await this.records()?.select(space?.workspace, space?.selected);
      await this.refresh(); return;
    }
    if (msg.type.startsWith("account")) {
      if (!this.accounts) return;
      this.error = undefined;
      try {
        if (msg.type === "accountSignIn") {
          if (this.loginGate() === "signIn") {
            this.notePurchasePick(msg.productId);
            // CONV-FUNNEL-R-006 — the purchase-time sign-in begins from the pass list.
            if (this.purchaseStage === "choosing" && !this.order && this.freeSeatNow) { this.purchaseSignIn = this.passListSurface; this.purchasePathEvent("sign_in_started"); }
          }
          await this.accounts.start();
        }
        else if (msg.type === "accountCancel") this.accounts.cancel();
        else if (msg.type === "accountReopen") await this.accounts.reopen();
        else if (msg.type === "accountCopyLink") await this.accounts.copyLink(text => vscode.env.clipboard.writeText(text));
        else if (msg.type === "accountRefresh") await this.accounts.refreshView();
        else if (msg.type === "accountManage") await this.accounts.openAccount();
        else if (msg.type === "accountSignOut") { this.personalSpace?.signOut(); this.personalRecords?.signOut(); void this.refresh(); this.candidate = undefined; await this.accounts.signOut(); }
        else if (msg.type === "accountActivate") await this.activateAccountPass(msg.passId);
      } catch (e) { this.error = e instanceof AccountError ? e.message : "계정을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요."; }
      await this.refresh(); return;
    }

    if (!msg || typeof msg !== "object") return;
    if (msg.type === "openLocalReview") { await vscode.commands.executeCommand("hypeproof-chat.localReview"); return; }
    if (msg.type === "startReady") {
      void this.accounts?.refreshView();
      // Free start — a newcomer should land on the free card, not see the code choices flash first.
      // The first paint waits for the offer at most 1.5 s; a slow or absent Service paints as today.
      if (!this.offerWaited) {
        this.offerWaited = true;
        // (A host without timers — the vm test harness — simply does not wait.)
        const bound = typeof setTimeout === "function" ? new Promise(r => setTimeout(r, 1500)) : Promise.resolve();
        await Promise.race([this.loadTrialOffer(), bound]);
      }
      await this.refresh(); void Promise.all([this.loadProducts(), this.loadTrialOffer()]).then(() => this.refresh()); return; }
    if (msg.type === "freeStartAge") { if (isAgeAnswer(msg.answer)) await this.freeStartAge(msg.answer); return; }
    if (msg.type === "freeStartClaim") { await this.freeStartClaim(); return; }
    if (msg.type === "freeStartGuardian") { await vscode.env.openExternal(vscode.Uri.parse(guardianUrl(this.settings().siteBase))); return; }
    if (msg.type === "freeStartUpdate") { await vscode.commands.executeCommand("hypeproof-chat.checkForUpdates"); return; }
    // studio-funnel-events — the start-page pass offer (Service type offer_*, surface start_page).
    if (msg.type === "purchaseOpen") { this.chat.funnelEmit?.({ type: "offer_clicked", surface: "start_page" }); this.passListSurface = "start_page"; }
    if ((msg.type === "purchaseHide" || msg.type === "purchaseCancel") && !this.order) this.chat.funnelEmit?.({ type: "offer_dismissed", surface: "start_page" });
    if (msg.type === "purchaseOpen" || msg.type === "purchaseStart" || msg.type === "purchasePayer" || msg.type === "purchaseReopen" || msg.type === "purchaseRetry" || msg.type === "purchaseCancel" || msg.type === "purchaseHide") { await this.handlePurchase(msg); return; }
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
    if (msg.type === "joinLinkDismiss") { this.joinLink = undefined; this.error = undefined; await this.refresh(); return; }
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
      this.joinLink = undefined; // the learner chose a saved activity instead of the link's class
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
        // Offer the copy while the trial still owns its stores; never copy its binding/token.
        if (candidate?.profile.activity_kind === 'classroom' && connections?.current?.kind === 'trial'
            && vscode.workspace.getConfiguration('hypeproofChat').get<boolean>('workTakeawayEnabled', false)) {
          const answer = await vscode.window.showInformationMessage('수업으로 바꾸기 전에 내 작업을 가져갈까요?', { modal: true }, '내 작업 가져가기', '그대로 계속');
          if (!answer) return;
          if (answer === '내 작업 가져가기' && !await this.chat.takeMyWork()) return;
          if (this.candidate !== candidate) return;
        }
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
            // REQ-L12 ⑫ — read who held this folder before the pass takes it over (carry-over offer).
            const previousHolder = carryoverAdvertised(profile) ? await connections.forWorkspace(root).catch(() => undefined) : undefined;
            rollback = await connections.commit(candidate.token,profile!,root,candidate.accountPass,candidate.replacesFree ? { replacesFree: candidate.replacesFree } : undefined);
            await this.recordCarryoverOffer(profile!, root, previousHolder, !!candidate.replacesFree && previousHolder?.id === candidate.replacesFree);
          } else await this.context.secrets.store(TOKEN_KEY, candidate.token);
          committed = true;
          this.chat.invalidateProfile();
          if (vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1") !== candidate.proxyUrl) throw new Error("Activity Service changed during confirmation");
          if (!await this.chat.ensureProfile(true)) throw new Error('connection validation failed');
          if (!this.panel || this.candidate !== candidate) throw new Error("Activity entry was cancelled");
          // REQ-L12 ⑦ — the purchased activity is entered and verified; the order record has done its job.
          // Retired only now: a check above that fails rolls the entry back and must leave 다시 연결 possible.
          if (this.purchaseToken === candidate.token) { this.purchaseToken = undefined; await this.context.secrets.delete(PENDING_PURCHASE_KEY); }
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
    // REQ-STUDIO-JOIN-LINK — only the form that shows the link's class is constrained by it. A code
    // from any other form (the learner left the link's form) drops the stale link. On the link's
    // form, a code that names another class is refused before it is sent anywhere; a code whose
    // class cannot be read is left to the Service, as without a link.
    if (this.joinLink && msg.joinClass !== this.joinLink.classId) this.joinLink = undefined;
    const codeClass = this.joinLink ? classOfCode(token) : undefined;
    if (this.joinLink && codeClass && codeClass !== this.joinLink.classId) {
      this.error = JOIN_LINK_COPY.mismatch; await this.refresh(); return;
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
      this.joinLink = undefined; // the code is confirmed; the preview card takes over
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
