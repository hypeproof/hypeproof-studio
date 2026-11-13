import { StoreClient } from "./skillStore";
import * as vscode from "vscode";
import { AccountError, accountProductionEnabled, ACCOUNTS_ENABLED_DEFAULT, type AccountSession, type AccountPassBinding } from "./accountSession";
import { ChatPanelProvider } from "./chatPanelProvider";
import { ActivityConnectionError, FOLDER_TAKEN_MESSAGE, activityConnections, passTakesOver } from "./activityConnections";
import { carryoverAdvertised, carryoverOfferKey, carryoverSourceOf, newOffer, validOffer } from "./trialCarryoverHelpers";
import { fetchProfileResult, verifyActivity, ProxyTransportError } from "./proxyClient";
import { sanitizeWorkshopToken, looksLikeIssuerTokenUnverified, reentryWorkspace } from "./chatPanelHelpers";
import * as path from "node:path";
import type { ResolvedProfile } from "./protocol";
import type { StartRequest, StartState } from "./startPageProtocol";
import { PENDING_PURCHASE_KEY, PURCHASE_COPY, POLL_INTERVAL_MS, claimWithRecovery, pollOrder, restorePendingOrder, waitDecision, type PendingOrder, type PurchaseView } from "./passPurchase";
import { isPurchaseReturnOrderId } from "./purchaseReturnHelpers";
import type { ClassReposOutcome } from "./publish/publishHost";
import { fetchTrialOffer, freeStartAdvertised, type TrialOffer } from "./trialOffer";
import { AGE_KEY, FREE_CLAIM_REFUSALS, freeSeatEnding, freeSeatRefill, INSTALL_ID_KEY, belowFloor, claimFreeStart, guardianUrl, isAgeAnswer, isInstallId, type AgeAnswer, type FreeClaimRefusal, type FreeClaimResult } from "./freeStart";
import type { FreeStartView } from "./startPageProtocol";
import { isFreeSeat } from "./seatVocabulary";
import { randomUUID } from "node:crypto";
import type { ClassRepo } from "./publish/githubContinue";
import { JOIN_LINK_COPY, classOfCode, isClassId } from "./joinLink";
import { isMinorProfile } from "./sdkCoachHelpers";
import { parseStartSettingWrite, startSettingsView, type StartSettingsView } from "./startSettings";
import { TEXT_SIZE_KEY } from "./textSize";
import type { ActivityResume } from './studioNavigation';
import { MemberApprovalController, parseApprovalPending } from './memberApproval';

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
type ReflectionEntry = { accountId?: string; sessionId?: string; activity?: string; workspace?: string; service: string; opening: boolean; waiting?: boolean; task?: string };

/** App entry surface; authentication and cohort authority remain in Service. */
export class StartPage {
  private panel?: vscode.WebviewPanel;
  private busy = false;
  private choosingFolder = false;
  // The start page's one error line. Any assignment clears the code-field mark: only refuseCode sets it.
  private errorText?: string;
  private errorAtCode = false;
  private get error(): string | undefined { return this.errorText; }
  private set error(text: string | undefined) { this.errorText = text; this.errorAtCode = false; }
  /** DES-SHELL-04 — the refusal of a submitted code; the page draws it under the code field, not in the card's error area. */
  private refuseCode(text: string) { this.error = text; this.errorAtCode = true; }
  private started = false;
  // Invalid arrival may list saved activities, but only explicit entry reactivates its profile.
  private deferProfileUntilEntry = false;
  private candidate?: Candidate;
  // REQ-L12 ⑤ — legacy order recovery only. New passes are not sold (2026-11-11) and this build has
  // no purchase view (2026-11-13): no catalogue read, no order creation. An order saved by an older
  // build is still waited on, claimed and recovered here.
  // TUX-SP-12 — what the Service advertises about the trial before entry. `null`: not advertised (or unreadable).
  private trialOffer?: TrialOffer | null;
  private order?: PendingOrder;
  private purchaseStage?: PurchaseView["stage"];
  private purchaseMessage?: string;
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
  /** REQ-STUDIO-FREE-DAILY-REFILL — the `refills_at` values this window already re-claimed for (once each). */
  private readonly refillsClaimed = new Set<number>();
  /** The current seat is the free allowance (read in refresh; its credential links a sign-in, CONV-FUNNEL-R-007). */
  private freeSeatNow = false;
  /** The first start-page paint waits briefly for the offer, so a newcomer does not see the code choices flash. */
  private offerWaited = false;
  /** REQ-STUDIO-JOIN-LINK — the class a join link named, until a code is confirmed or the learner drops it. */
  private joinLink?: { classId: string; seq: number };
  private useGrantAfterSignIn = false;
  private enteringAccountGrant = false;
  private accountEntryRevision = 0;
  private reflectionEntry?: ReflectionEntry;
  private reflectionEntering = false;
  private openingChat?: vscode.WebviewPanel;
  private memberApprovals?: MemberApprovalController;
  private memberAccount?: string;
  private memberSession?: string;
  private memberProbe = 0;
  constructor(
    private context: vscode.ExtensionContext,
    private chat: ChatPanelProvider,
    private begin: (profile: ResolvedProfile, commit: (directory?: string) => Promise<void>, selectedDirectory?: string, reflection?: ActivityResume['personalReflection'], validateEntry?: () => Promise<void>) => Promise<boolean>,
    private githubSource?: GithubContinueSource,
    private accounts?: AccountSession,
  ) {
    if (accounts) this.memberApprovals = new MemberApprovalController({
      identity: () => accounts.approvalIdentity(), request: (identity,id,decision) => accounts.approvalRequest(identity,id,decision), uuid: randomUUID,
      load: async accountID => {
        const prefix = 'hypeproof.memberApproval.v1.' + Buffer.from(accountID).toString('base64url') + '.';
        return parseApprovalPending(context.globalState.keys().filter(k=>k.startsWith(prefix)).map(k=>context.globalState.get(k)),accountID);
      },
      save: async (accountID,pending) => {
        const prefix = 'hypeproof.memberApproval.v1.' + Buffer.from(accountID).toString('base64url') + '.';
        for(const row of pending) await context.globalState.update(prefix+row.id,row);
      },
      remove: async (accountID,id) => { await context.globalState.update('hypeproof.memberApproval.v1.' + Buffer.from(accountID).toString('base64url') + '.' + id,undefined); },
      changed: () => { if(this.panel)void this.refresh(); },
    });
    // REQ-STUDIO-START-UPDATE-NOTICE — a found, cleared or dismissed update redraws an open start page.
    // Optional: hosts without the hook (tests, older providers) just show no notice.
    this.chat.onAvailableUpdateChanged?.(() => { if (this.panel) void this.refresh(); });
  }
  /** The chat banner's offer, for the start page; the dismissal rule already ran in the scheduler. */
  private updateView(): StartState["update"] {
    const offer = this.chat.getAvailableUpdate?.();
    if (!offer?.version) return undefined;
    // CGP-SHELL-R-003 — the cohort's update freeze hides the notice too, unless the release is security-critical.
    if (this.chat.isUpdateFrozen?.(offer)) return undefined;
    return { version: offer.version, ...(this.chat.isClassUpdateHeld?.() ? { heldForClass: true } : {}) };
  }

  accountChanged(): void {
    const account = this.accounts?.view();
    if (this.reflectionEntry && ((this.reflectionEntry.accountId && account?.account?.id !== this.reflectionEntry.accountId)
        || (this.reflectionEntry.waiting && account?.status === 'signedOut' && !account.busy))) this.reflectionEntry = undefined;
    const memberAccount = account?.status === 'signedIn' ? account.account?.id : undefined;
    const changedMember = memberAccount!==this.memberAccount;
    if(changedMember || !memberAccount) { this.memberAccount=memberAccount; this.memberSession=undefined; this.memberApprovals?.invalidate(); }
    const probe=++this.memberProbe;
    if(memberAccount && this.accounts?.approvalSessionKey) void this.accounts.approvalSessionKey().then(session=>{
      if(probe!==this.memberProbe || this.memberAccount!==memberAccount) return;
      if(session!==this.memberSession || changedMember) {
        this.memberSession=session; this.memberApprovals?.invalidate();
        if(session) void this.memberApprovals?.discover();
      }
    }).catch(()=>{ if(probe===this.memberProbe) { this.memberSession=undefined; this.memberApprovals?.invalidate(); } });
    if (this.candidate?.accountPass && this.accounts?.view().status === "signedOut") this.candidate = undefined;
    if (this.panel) void this.refresh();
    void this.loadStore().then((changed) => { if (changed && this.panel) return this.refresh(); });
  }

  /** Explicit login resumes granted personal use; background refresh never changes activities. */
  async finishAccountSignIn(): Promise<void> {
    if (this.reflectionEntry) { await this.continuePersonalReflection(); return; }
    if (!this.useGrantAfterSignIn) return;
    this.useGrantAfterSignIn = false;
    const account = this.accounts?.view();
    const current = activityConnections(this.context)?.current;
    if (account?.status !== "signedIn" || this.order || (current && !current.free)) return;
    const grant = account.passes?.find(pass => pass.id === "super" && pass.status === "active" && pass.requests_remaining > 0);
    if (!grant) return;
    await this.enterGrantedAccountPass();
  }

  private reflectionStillWanted(entry: ReflectionEntry): boolean {
    const current = activityConnections(this.context)?.current;
    return this.reflectionEntry === entry && this.settings().proxyUrl === entry.service
      && current?.id === entry.activity && current?.workspace === entry.workspace
      && (!entry.accountId || this.accounts?.view().account?.id === entry.accountId)
      && (!entry.task || this.chat.mobileConversationScope(true)?.task === entry.task);
  }
  private async assertReflectionEntry(entry: ReflectionEntry): Promise<void> {
    if (!this.reflectionStillWanted(entry) || (entry.sessionId && await this.accounts?.conversationSession() !== entry.sessionId)
        || !this.reflectionStillWanted(entry)) throw new ActivityConnectionError('계정이나 활동이 바뀌었어요. 현재 화면에서 나의 질문을 다시 선택해 주세요.');
  }
  /** One explicit action owns login, existing admission and the existing reflection task. */
  async openPersonalReflectionEntry(): Promise<void> {
    if (this.reflectionEntry || this.reflectionEntering || this.busy) return;
    const current = activityConnections(this.context)?.current;
    if (current?.kind === 'classroom' || current?.lesson || this.chat.isInstructor) {
      await this.show(); this.error = '수업은 그대로 유지했어요. 개인 활동을 선택한 뒤 나의 질문을 시작해 주세요.'; await this.refresh(); return;
    }
    if (this.chat.hasActiveStream()) {
      await this.show(); this.error = '진행 중인 작업을 마치거나 중지한 뒤 나의 질문을 열어 주세요.'; await this.refresh(); return;
    }
    if (!this.accounts) { await this.show(); await this.handle({ type: 'accountSignIn' }); return; }
    const entry: ReflectionEntry = { accountId: this.accounts.view().account?.id, activity: current?.id, workspace: current?.workspace, service: this.settings().proxyUrl, opening: false, task: this.chat.mobileConversationScope(true)?.task };
    this.reflectionEntry = entry; this.useGrantAfterSignIn = false; this.error = undefined;
    try {
      if (this.accounts.view().status !== 'signedIn') {
        await this.show(); await this.refresh();
        if (!this.reflectionStillWanted(entry)) return;
        entry.waiting = true; await this.accounts.start();
        if (this.accounts.view().status !== 'signedIn') return;
      }
      await this.continuePersonalReflection();
    } catch (error) { await this.reflectionEntryFailed(entry, error); }
  }
  private async reflectionEntryFailed(entry: ReflectionEntry, error: unknown): Promise<void> {
    if (this.reflectionEntry !== entry) return;
    if (!this.reflectionStillWanted(entry)) { this.reflectionEntry = undefined; return; }
    this.reflectionEntry = undefined;
    await this.show();
    this.error = error instanceof AccountError || error instanceof ActivityConnectionError || error instanceof Error
      ? error.message : '나의 질문을 열지 못했어요. 기존 작업은 그대로 있어요.';
    await this.refresh();
  }
  private async continuePersonalReflection(passId?: string): Promise<void> {
    const entry = this.reflectionEntry, accounts = this.accounts;
    if (!entry || !accounts || this.reflectionEntering) return;
    this.reflectionEntering = true;
    try {
      await this.assertReflectionEntry(entry);
      const session = await accounts.conversationSession();
      await this.assertReflectionEntry(entry);
      const account = accounts.view();
      if (!session || account.status !== 'signedIn' || !account.account?.id) throw new ActivityConnectionError('Google 로그인을 마친 뒤 나의 질문을 다시 선택해 주세요.');
      entry.sessionId = session; entry.accountId = account.account.id;
      const current = activityConnections(this.context)?.current;
      if (current?.kind === 'personal' && activityConnections(this.context)?.matchesService) {
        if (current.accountPass && current.accountPass.sessionId !== session) throw new ActivityConnectionError('이 개인 활동의 계정이 달라요. 내 계정의 활동을 선택해 주세요.');
        const profile = await this.chat.ensureProfile(true); await this.assertReflectionEntry(entry);
        if (profile?.activity_kind !== 'personal' || profile.lesson) throw new ActivityConnectionError('개인 활동 연결을 확인하지 못했어요. 내 계정 · 이용권에서 확인해 주세요.');
        entry.opening = true;
        if (this.panel) await this.openChat();
        await this.chat.refreshConfig(); await this.assertReflectionEntry(entry);
        await this.chat.openPersonalReflection(() => this.reflectionStillWanted(entry));
        if (this.reflectionEntry === entry) this.reflectionEntry = undefined;
        return;
      }
      if (current && !current.free) throw new ActivityConnectionError('현재 활동은 그대로 유지했어요. 개인 활동을 선택한 뒤 나의 질문을 시작해 주세요.');
      // Keep the existing account pass chooser. A normal pass may start its paid period on
      // activation, so only its explicit button selects it; the existing super grant is immediate.
      const chosen = passId ?? account.passes?.find(pass => pass.id === 'super' && pass.status === 'active' && pass.requests_remaining > 0)?.id;
      await this.show(); await this.assertReflectionEntry(entry);
      if (!chosen) {
        this.error = account.passes?.length ? '나의 질문에 사용할 이용권을 골라 주세요.' : '개인 AI 이용 권한이 아직 없어요. 내 계정 · 이용권에서 권한을 확인해 주세요. 기존 작업은 그대로 있어요.';
        await this.refresh(); return;
      }
      try { await this.activateAccountPass(chosen, () => this.reflectionStillWanted(entry)); }
      catch (error) {
        await this.assertReflectionEntry(entry);
        this.error = error instanceof Error ? error.message : '이용권을 확인하지 못했어요. 다른 이용권을 선택하거나 새로고침해 주세요.';
        await this.refresh(); return;
      }
      await this.assertReflectionEntry(entry);
      if (this.candidate?.profile.activity_kind !== 'personal' || this.candidate.profile.lesson) throw new ActivityConnectionError('이 이용권은 개인 질문 활동이 아니에요. 기존 활동은 그대로 유지했어요.');
      await this.handle({ type: 'beginCourse' }, () => this.reflectionStillWanted(entry), entry);
    } catch (error) { await this.reflectionEntryFailed(entry, error); }
    finally { this.reflectionEntering = false; }
  }
  /** Called only with the existing one-shot, validated workspace-resume marker. */
  async resumePersonalReflection(intent: NonNullable<ActivityResume['personalReflection']>): Promise<void> {
    if (this.reflectionEntry || !this.accounts) return;
    const current = activityConnections(this.context)?.current, revision = this.accountEntryRevision;
    if (current?.kind !== 'personal') return;
    const task = this.chat.mobileConversationScope(true)?.task;
    await this.accounts.refreshView();
    if (this.accountEntryRevision !== revision || activityConnections(this.context)?.current !== current
        || this.accounts.view().account?.id !== intent.accountId || this.chat.mobileConversationScope(true)?.task !== task) return;
    this.reflectionEntry = { ...intent, activity: current.id, workspace: current.workspace, task, service: this.settings().proxyUrl, opening: true };
    await this.continuePersonalReflection();
  }

  private async enterGrantedAccountPass(): Promise<void> {
    if (this.enteringAccountGrant) return;
    this.enteringAccountGrant = true;
    const freeSeat = this.freeSeatInWindow();
    const revision = this.accountEntryRevision;
    const panel = this.panel;
    const current = activityConnections(this.context)?.current;
    try {
      await this.activateAccountPass("super", () => this.accountEntryRevision === revision && this.panel === panel && activityConnections(this.context)?.current === current);
      if (freeSeat) await this.switchSeatInPlace(freeSeat);
      else await this.handle({ type: "beginCourse" });
    } catch (error) {
      this.error = error instanceof AccountError ? error.message : "로그인됐지만 무제한 이용권을 연결하지 못했어요. 다시 눌러 주세요.";
    } finally {
      this.enteringAccountGrant = false;
      await this.refresh();
    }
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
    this.reflectionEntry = undefined;
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

  /** Release only the entry panel we own; never close user editors or the chat. */
  closeForAutomationPreview(): vscode.ViewColumn | undefined {
    this.reflectionEntry = undefined;
    const entry = this.panel;
    if (!entry) return undefined;
    const column = entry.viewColumn;
    this.panel = undefined;
    this.candidate = undefined;
    entry.dispose();
    return column;
  }

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
    // Chat reuses this webview and can send ready before openInEditor resolves.
    // Its messages must never be interpreted as canceling the start-page intent.
    this.openingChat = entry;
    try {
      await this.chat.openInEditor(entry);
      if (this.panel === entry) this.panel = undefined;
    } finally {
      if (this.openingChat === entry) this.openingChat = undefined;
    }
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
    panel.webview.onDidReceiveMessage((msg: StartRequest) => {
      if (this.panel === panel && this.openingChat !== panel) void this.handle(msg);
    });
    // #747 — the naming step happens in the chat panel; this tab is retained
    // (retainContextWhenHidden), so re-read the identity whenever it comes back
    // to the front instead of showing the name from before the rename.
    panel.onDidChangeViewState(e => { if (e.webviewPanel.active) void this.refresh(); });
    panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; this.memberApprovals?.dismiss(); if (!this.reflectionEntry?.opening) this.reflectionEntry = undefined; this.useGrantAfterSignIn = false; this.candidate = undefined; this.stopPurchaseWait();
      this.accounts?.cancel(false); } });
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
  /** REQ-L12 ⑤ — what the start page shows of a legacy order. No secret, no code. */
  private purchaseView(): PurchaseView {
    return {
      available: !!this.order,
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
    const failure = !running && !this.candidate ? this.chat.profileFailure() : null;
    const ended = failure ? freeSeatEnding(failure) : undefined;
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
      ...(ended && failure?.refillsAt ? { refillsAt: failure.refillsAt } : {}),
    };
  }
  /**
   * REQ-STUDIO-FREE-DAILY-REFILL (Jay 2026-10-29) — the saved free seat is spent or expired and the
   * Service says its install's next daily allowance is open (`refills_at` <= now): claim again and
   * enter the returned code through the ordinary free entry, in the same folder, without asking.
   * Read at launch and on every start-page refresh. Once per `refills_at` per window, so a refusal
   * or an unexpected same-seat answer cannot loop. A Service without `refills_at` never gets here.
   */
  private maybeRefill(running: ResolvedProfile | null | undefined): void {
    if (this.candidate || this.busy || this.freeClaiming || !this.freeStartOn() || this.ageAnswer() !== "14+") return;
    if (running && !isFreeSeat(running)) return;
    const refill = freeSeatRefill(running ? { seat: running.pass ? undefined : running.trial } : { failure: this.chat.profileFailure() });
    if (refill?.state !== "due" || this.refillsClaimed.has(refill.refillsAt) || this.chat.hasActiveStream()) return;
    this.refillsClaimed.add(refill.refillsAt);
    void this.freeStartClaim();
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
   * Epic #3418 — one read per window and account: the store entry is drawn only when the Service
   * answers the store for this account (a rollout may open it to listed accounts only).
   */
  private storeOn?: boolean;
  private storeFor?: string;
  private async loadStore(): Promise<boolean> {
    const view = this.accounts?.view();
    const key = view?.status === "signedIn" ? `in:${view.account?.id ?? ""}` : "out";
    if (this.storeFor === key) return false;
    this.storeFor = key;
    const token = key === "out" ? undefined : await this.accounts?.accessToken().catch(() => undefined);
    const before = this.storeOn;
    this.storeOn = await new StoreClient({ proxyUrl: this.settings().proxyUrl, token: async () => token }).items().then(() => true, () => false);
    return before !== this.storeOn;
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
  /** REQ-L12 ⑤ — the recovery intents for a legacy order. There is no way to start a new order here. */
  private async handlePurchase(msg: StartRequest): Promise<void> {
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
      // An order an older build started may still be unpaid: the person can reopen its own checkout page.
      if (this.order) await vscode.env.openExternal(vscode.Uri.parse(this.order.checkoutUrl));
      return;
    }
    if (msg.type === "purchaseRetry") {
      const order = this.order ?? await this.savedOrder();
      if (!order) { this.purchaseStage = undefined; this.purchaseMessage = undefined; await this.refresh(); return; }
      this.order = order;
      if (order.claimed) { await this.claimPurchase(order); return; }
      this.purchaseStage = "waiting"; this.purchaseMessage = PURCHASE_COPY.waiting;
      await this.refresh(); this.schedulePurchasePoll(0); return;
    }
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

  private async activateAccountPass(passId: string, stillWanted?: () => boolean): Promise<void> {
    if (!this.accounts) throw new Error('account disabled');
    const settings = this.settings();
    if (!this.accounts.matches(settings.proxyUrl, settings.siteBase)) throw new AccountError('settings_changed', '서버 설정이 바뀌었어요. Studio를 다시 열고 로그인해 주세요.');
    if (this.chat.hasActiveStream()) throw new AccountError('active_stream', '진행 중인 작업을 마치거나 중지한 후 이용권을 선택해 주세요.');
    const activated = await this.accounts.activate(passId);
    if (stillWanted && !stillWanted()) throw new AccountError("entry_changed", "다른 활동을 선택했어요. 필요할 때 무제한으로 시작하기를 눌러 주세요.");
    await this.handle({type:"connectCourse",token:activated.token}, stillWanted);
    if (stillWanted && !stillWanted()) throw new AccountError("entry_changed", "활동 연결을 취소했어요. 선택한 활동을 계속 사용하세요.");
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
    const freeStart = this.freeStartView(running);
    const state: StartState = {
      automationsEnabled: !this.candidate && p?.automations?.enabled === true,
      legacyConnection:await activityConnections(this.context)?.hasLegacyConnection(),
      legacyHistory,
      activities,
      checking: this.busy,
      personalReflectionPending: !!this.reflectionEntry,
      started: !this.candidate && this.started && !!p,
      candidate: !!this.candidate,
      previousConnected: this.candidate ? this.candidate.previousConnected : !!p,
      // The free card states a free seat's end itself (freeStart.ended), so its failure sentence is not repeated.
      error: this.error ?? (!p && !freeStart?.ended ? this.chat.profileFailure()?.friendly : undefined),
      ...(this.error !== undefined && this.errorAtCode ? { errorAt: "code" as const } : {}),
      version: this.context.extension.packageJSON.version,
      workspace: vscode.workspace.workspaceFolders?.[0]?.name,
      ...(this.chat.inboxSource ? { inbox: await this.chat.inboxSource.inboxView() } : {}),
      purchase: this.purchaseView(),
      ...(this.storeOn ? { skillStore: true } : {}),
      ...(this.accounts ? {account:this.accounts.view()} : {}),
      ...(this.memberApprovals ? {memberApprovals:this.memberApprovals.view()} : {}),
      ...(this.trialOffer ? { trialOffer: this.trialOffer } : {}),
      ...(freeStart ? { freeStart } : {}),
      ...(this.look() ? { github: this.look()!.state } : {}),
      ...(this.joinLink ? { joinLink: { ...this.joinLink } } : {}),
      settings: await this.settingsView(p),
      ...(this.updateView() ? { update: this.updateView() } : {}),
      ...(p ? { coachName: this.chat.coachDisplayName(p), profile: { kind: p.activity_kind, ...(p.pass ? { pass: p.pass } : {}), ...(p.trial && !p.pass ? { trial: p.trial } : {}), ...(isFreeSeat(p) ? { free: true } : {}), id: p.profile_id, name: p.lesson?.content.title ?? p.display_name,
        // #747 — the row is labelled "AI 이름", so it shows the name the rest of
        // the card uses. A student-named cohort that has not been named yet
        // describes the mode instead of showing the placeholder as a name.
        coach: this.chat.coachNameIsChosen(p) ? this.chat.coachDisplayName(p) : "직접 이름 짓는 코치",
        series: p.lesson?.version ?? `${p.series_index} / ${p.series_total}`, workspace: this.candidate?.workspace ?? p.workspace_root ?? "현재 작업 폴더" } } : {}),
    };
    // Account-bound cards are read after settings/profile awaits so an older render
    // cannot put a previous account's card back after logout or a new session.
    if (this.memberApprovals) state.memberApprovals = this.memberApprovals.view();
    if (this.accounts) state.account = this.accounts.view();
    await this.panel?.webview.postMessage({ type: "startState", state });
    if (this.panel) this.maybeRefill(running);
  }

  /**
   * CGP-SHELL-R-014 — the learner settings sheet. `profile` is the one this refresh shows (a previewed
   * candidate or the running seat); without it the seat is read the way refresh reads it.
   */
  private async settingsView(profile?: ResolvedProfile | null): Promise<StartSettingsView> {
    const p = profile !== undefined ? profile : this.candidate?.profile ?? (this.deferProfileUntilEntry ? null : await this.chat.ensureProfile());
    return startSettingsView({
      textSize: this.context.globalState?.get(TEXT_SIZE_KEY),
      reduceMotion: vscode.workspace.getConfiguration("workbench").get("reduceMotion"),
      notices: vscode.workspace.getConfiguration("hypeproofChat").get("osTaskNotices"),
      profileMinor: p ? isMinorProfile(p) : null,
      age: this.context.globalState?.get<unknown>(AGE_KEY),
    });
  }

  private async openUnboundFolder(folder: vscode.Uri): Promise<void> {
    try {
      if (this.chat.hasActiveStream()) throw new ActivityConnectionError('진행 중인 작업을 마치거나 중지한 후 폴더를 변경하세요.');
      await this.chat.setConnectionChanging(true);
      await vscode.commands.executeCommand('vscode.openFolder', folder, { forceReuseWindow: true });
    } finally { await this.chat.setConnectionChanging(false); }
  }

  private async handle(msg: StartRequest, continuation?: () => boolean, reflection?: ReflectionEntry): Promise<void> {
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
    if (msg.type === 'openPersonalReflection') { await this.openPersonalReflectionEntry(); return; }
    if (msg.type === 'accountActivate' && this.reflectionEntry) { await this.continuePersonalReflection(msg.passId); return; }
    if (!continuation && !['startReady', 'accountRefresh', 'accountReopen', 'accountCopyLink'].includes(msg.type)) this.reflectionEntry = undefined;
    if (msg.type === 'cancelPersonalReflection') { if (this.accounts?.view().status === 'waiting' || this.accounts?.view().busy) this.accounts.cancel(); await this.refresh(); return; }
    if(msg.type==='memberApprovalRefresh') { await this.memberApprovals?.refresh(); return; }
    if(msg.type==='memberApprovalDecision') { await this.memberApprovals?.decide(msg.id,msg.requestDigest,msg.choice); return; }
    if (!continuation && !["startReady", "accountRefresh", "accountReopen", "accountCopyLink"].includes(msg.type)) this.accountEntryRevision++;
    if (!["startReady", "accountSignIn", "accountReopen", "accountCopyLink", "accountRefresh"].includes(msg.type)) this.useGrantAfterSignIn = false;
    if (msg.type.startsWith("account")) {
      if (!this.accounts) {
        if (msg.type !== "accountSignIn") return;
        if (this.chat.hasActiveStream()) {
          this.error = "진행 중인 작업을 마치거나 중지한 후 로그인해 주세요.";
          await this.refresh(); return;
        }
        try {
          const config = vscode.workspace.getConfiguration("hypeproofChat");
          const { proxyUrl, siteBase } = this.settings();
          if (!accountProductionEnabled(true, proxyUrl, siteBase)) {
            this.error = "현재 서버 설정에서는 Google 로그인을 사용할 수 없어요. 공식 서비스 주소인지 확인해 주세요.";
            await this.refresh(); return;
          }
          const disabled = !config.get<boolean>("accountsEnabled", ACCOUNTS_ENABLED_DEFAULT);
          const action = disabled ? "켜고 다시 열기" : "다시 열기";
          const choice = await vscode.window.showInformationMessage(
            disabled ? "이 기기에서 개인 계정 사용이 꺼져 있어요. 켜고 Studio 창을 다시 열까요? 작업 파일은 그대로 남아요."
              : "계정 기능을 불러오려면 Studio 창을 다시 열어야 해요. 작업 파일은 그대로 남아요.",
            { modal: true }, action);
          if (choice === action) {
            if (this.chat.hasActiveStream()) {
              this.error = "진행 중인 작업을 마치거나 중지한 후 로그인해 주세요.";
              await this.refresh(); return;
            }
            if (disabled) await config.update("accountsEnabled", true, vscode.ConfigurationTarget.Global);
            if (this.chat.hasActiveStream()) {
              this.error = "개인 계정 사용은 켜졌어요. 진행 중인 작업을 마친 뒤 다시 로그인해 주세요.";
              await this.refresh(); return;
            }
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        } catch {
          this.error = "계정 기능을 다시 열지 못했어요. 잠시 뒤 다시 눌러 주세요.";
          await this.refresh();
        }
        return;
      }
      this.error = undefined;
      try {
        if (msg.type === "accountSignIn") {
          this.useGrantAfterSignIn = true;
          await this.accounts.start();
          if (this.accounts.view().status === "signedIn") await this.finishAccountSignIn();
          else if (this.accounts.view().status === "signedOut" && !this.accounts.view().busy) this.useGrantAfterSignIn = false;
        }
        else if (msg.type === "accountCancel") { this.useGrantAfterSignIn = false; this.accounts.cancel(); }
        else if (msg.type === "accountReopen") await this.accounts.reopen();
        else if (msg.type === "accountCopyLink") await this.accounts.copyLink(text => vscode.env.clipboard.writeText(text));
        else if (msg.type === "accountRefresh") await this.accounts.refreshView();
        else if (msg.type === "accountManage") await this.accounts.openAccount();
        else if (msg.type === "accountSignOut") { this.useGrantAfterSignIn = false; this.candidate = undefined; await this.accounts.signOut(); }
        else if (msg.type === "accountActivate") {
          if (msg.passId === "super") await this.enterGrantedAccountPass();
          else await this.activateAccountPass(msg.passId);
        }
      } catch (e) { this.error = e instanceof AccountError ? e.message : "계정을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요."; }
      await this.refresh(); return;
    }

    if (!msg || typeof msg !== "object") return;
    if (msg.type === "openEmailAutomation") { await vscode.commands.executeCommand("hypeproof-chat.emailAutomation"); return; }
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
      await this.refresh(); void Promise.all([this.loadTrialOffer(), this.loadStore()]).then(() => this.refresh()); return; }
    if (msg.type === "startUpdateInstall") { await vscode.commands.executeCommand("hypeproof-chat.installUpdate"); return; }
    if (msg.type === "startUpdateDismiss") { if (typeof msg.version === "string" && msg.version) await vscode.commands.executeCommand("hypeproof-chat.dismissUpdate", msg.version); return; }
    if (msg.type === "freeStartAge") { if (isAgeAnswer(msg.answer)) await this.freeStartAge(msg.answer); return; }
    if (msg.type === "freeStartClaim") { await this.freeStartClaim(); return; }
    if (msg.type === "freeStartGuardian") { await vscode.env.openExternal(vscode.Uri.parse(guardianUrl(this.settings().siteBase))); return; }
    if (msg.type === "freeStartUpdate") { await vscode.commands.executeCommand("hypeproof-chat.checkForUpdates"); return; }
    if (msg.type === "purchaseReopen" || msg.type === "purchaseRetry" || msg.type === "purchaseCancel" || msg.type === "purchaseHide") { await this.handlePurchase(msg); return; }
    if (msg.type === "inboxOpen") { await this.chat.inboxSource?.inboxOpened(msg.objectId, msg.generation); return; }
    if (msg.type === "inboxLink") { await this.chat.handleInboxLink(msg); return; }
    if (msg.type === "inboxAnswer") { await this.chat.inboxSource?.inboxAnswer?.(msg.objectId, msg.revision, msg.generation, msg.answer); return; }
    if (msg.type === "openStudioFiles") { await vscode.commands.executeCommand("workbench.view.explorer"); return; }
    if (msg.type === "reportProblem") { await vscode.commands.executeCommand("hypeproof-chat.reportProblem", "start_page"); return; }
    if (msg.type === "openSkillStore") { await vscode.commands.executeCommand("hypeproof-chat.skillStore"); return; }
    // CGP-SHELL-R-014 — the start page "설정" opens the learner sheet (webview-side); the VS Code settings
    // editor is reached only through the sheet's "고급 설정", re-checked here: a minor seat never gets it.
    if (msg.type === "openAdvancedSettings") {
      if ((await this.settingsView()).advanced) await vscode.commands.executeCommand("workbench.action.openSettings");
      return;
    }
    if (msg.type === "startSetting") {
      const write = parseStartSettingWrite(msg);
      if (!write) return;
      try {
        if (write.key === "textSize") { await this.context.globalState.update(TEXT_SIZE_KEY, write.value); void this.chat.refreshConfig(); }
        else if (write.key === "reduceMotion") await vscode.workspace.getConfiguration("workbench").update("reduceMotion", write.value, true);
        else await vscode.workspace.getConfiguration("hypeproofChat").update("osTaskNotices", write.value, true);
      } catch { this.error = "설정을 저장하지 못했어요. 잠시 뒤 다시 골라 주세요."; }
      await this.refresh(); return;
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
    if (this.chat.hasActiveStream()) {
      // DES-SHELL-04 — a code submitted during a turn is refused under the code field like any other code refusal.
      const turnRunning = "진행 중인 작업을 마치거나 중지한 후 활동을 변경하세요.";
      if (msg.type === "connectCourse") this.refuseCode(turnRunning); else this.error = turnRunning;
      await this.refresh(); return;
    }
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
          if (reflection) await this.assertReflectionEntry(reflection);
          if (continuation && !continuation()) throw new ActivityConnectionError('활동 열기를 취소했어요. 기존 작업은 유지됩니다.');
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
            if (reflection && this.reflectionEntry === reflection) { reflection.activity = connections.current?.id; reflection.workspace = connections.current?.workspace; }
            await this.recordCarryoverOffer(profile!, root, previousHolder, !!candidate.replacesFree && previousHolder?.id === candidate.replacesFree);
          } else await this.context.secrets.store(TOKEN_KEY, candidate.token);
          committed = true;
          this.chat.invalidateProfile();
          if (vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1") !== candidate.proxyUrl) throw new Error("Activity Service changed during confirmation");
          if (!await this.chat.ensureProfile(true)) throw new Error('connection validation failed');
          if (reflection) await this.assertReflectionEntry(reflection);
          if (!this.panel || this.candidate !== candidate) throw new Error("Activity entry was cancelled");
          // REQ-L12 ⑦ — the purchased activity is entered and verified; the order record has done its job.
          // Retired only now: a check above that fails rolls the entry back and must leave 다시 연결 possible.
          if (this.purchaseToken === candidate.token) { this.purchaseToken = undefined; await this.context.secrets.delete(PENDING_PURCHASE_KEY); }
          this.candidate = undefined;
        };
        const selectedWorkspace = candidate?.workspace ?? (connections?.matchesService && connections.current?.serverId === profile.activity_id ? connections.current?.workspace : undefined);
        if (reflection) await this.assertReflectionEntry(reflection);
        if (await this.begin(profile, commit, selectedWorkspace, reflection?.accountId && reflection.sessionId ? { accountId: reflection.accountId, sessionId: reflection.sessionId } : undefined, reflection ? () => this.assertReflectionEntry(reflection) : undefined)) {
          // The validated activity-resume marker now owns this one explicit navigation.
          if (reflection && this.reflectionEntry === reflection) this.reflectionEntry = undefined;
          return;
        }
        await commit();
        if (!this.panel) throw new Error('Entry page was closed');
        if (reflection) { await this.assertReflectionEntry(reflection); reflection.opening = true; }
        await this.openChat();
        if (reflection) {
          // Admission is complete. A later question refusal must not roll back the activity
          // after the person has already changed tasks or started work in its chat.
          try {
            await this.chat.setConnectionChanging(false);
            await this.chat.refreshConfig(); await this.assertReflectionEntry(reflection);
            await this.chat.openPersonalReflection(() => this.reflectionStillWanted(reflection));
          } catch (error) { await this.reflectionEntryFailed(reflection, error); }
          if (this.reflectionEntry === reflection) this.reflectionEntry = undefined;
        }
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
        if (reflection && this.reflectionEntry === reflection) this.reflectionEntry = undefined;
        this.busy = false; await this.chat.setConnectionChanging(false);
        await this.refresh();
      }
      return;
    }
    if (msg.type !== "connectCourse" || typeof msg.token !== "string") return;
    const token = sanitizeWorkshopToken(msg.token);
    if (!token) { this.refuseCode("수업 참여 코드를 입력하세요."); await this.refresh(); return; }
    if (looksLikeIssuerTokenUnverified(token)) {
      this.refuseCode("강사용 코드입니다. 수강생 참여 코드를 입력하세요."); await this.refresh(); return;
    }
    // REQ-STUDIO-JOIN-LINK — only the form that shows the link's class is constrained by it. A code
    // from any other form (the learner left the link's form) drops the stale link. On the link's
    // form, a code that names another class is refused before it is sent anywhere; a code whose
    // class cannot be read is left to the Service, as without a link.
    if (this.joinLink && msg.joinClass !== this.joinLink.classId) this.joinLink = undefined;
    const codeClass = this.joinLink ? classOfCode(token) : undefined;
    if (this.joinLink && codeClass && codeClass !== this.joinLink.classId) {
      this.refuseCode(JOIN_LINK_COPY.mismatch); await this.refresh(); return;
    }
    const entryPanel=this.panel;
    this.busy = true; this.error = undefined;
    try {
      await this.chat.setConnectionChanging(true);
      await this.refresh();
      const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
      const result = await fetchProfileResult({ proxyUrl, token });
      if (!result.ok) { this.refuseCode(result.failure.friendly); return; }
      const p = result.profile;
      if (!p?.profile_id || !p.display_name || !p.ux?.coach || !p.welcome) {
        this.refuseCode("수업 정보 응답을 읽지 못했습니다. 잠시 후 다시 연결하세요."); return;
      }
      if (!entryPanel || this.panel!==entryPanel) return;
      // Preview only. Existing runtime and credential stay bound until workspace preparation succeeds.
      const running = await this.chat.ensureProfile(), connections = activityConnections(this.context);
      const workspace = reentryWorkspace({ candidateActivity: p.activity_id, record: connections?.current ?? null, recordServiceMatches: !!connections?.matchesService, openFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, runningActivity: running?.activity_id });
      if (continuation && !continuation()) return;
      this.candidate = { token, profile: p, proxyUrl, previousConnected: !!running, ...(workspace ? { workspace } : {}) };
      this.joinLink = undefined; // the code is confirmed; the preview card takes over
      // GitHub first (user requirement 2026-10-13): the served profile names the class folder.
      const classRoot = this.githubSource?.allowed(p) ? this.githubSource.classRoot(p) : null;
      if (classRoot) this.lookAtGithub(this.candidate, classRoot);
      else this.github = undefined;
    } catch (error) {
      console.error('[startPage] connectCourse failed:', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      this.refuseCode("수업에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.");
    } finally {
      this.busy = false; await this.chat.setConnectionChanging(false);
      await this.refresh();
    }
  }
}
