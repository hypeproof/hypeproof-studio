import { createCompanionDevHostEntry } from "./companionDevHostEntry";
import { registerCompanionWorkspace } from "./companionWorkspaceHost";
import { workPower } from "./workPower";
import { registerActivityTrash } from "./activityTrashCommands";
import { confirmOutbound } from "./outboundConsentHost.ts";
import { restoreInitialSurface } from "./initialSurface";
export { resolveActivateBranch } from "./initialSurface";
import { registerExternalSkillCommands } from './externalSkillCommands';
import { initializeFilesLayout, closeNativeChatBarOnce, closeRestoredBrowserTabs, resumeKey, consumeActivityResume, activityCheckpoint, type ActivityResume, WORKSPACE_SWITCH_ATTEMPT_KEY } from "./studioNavigation";
import { registerLocalReview } from "./localReviewPanel";
import { ActivityConnectionError, ActivityConnections, activityConnections } from './activityConnections';
import { callChalkTool, chalkToolsEnabled } from "./chalk/tools";
import { fetchProfileResult } from './proxyClient';
import { ClassroomHelpHost } from './classroomHelpHost';
import { ClassroomOpsHost } from './classroomOpsHost';
import { prepareWorkspaceDirectory } from './workspacePreparation';
import { imageAttachPrompt } from "./coachIdentity.ts";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { StartPage } from "./startPage";
import { handleJoinLink, type JoinLinkHost } from "./joinLink";
import { purchaseReturnOrder } from "./purchaseReturnHelpers";
import { ACCOUNT_SECRET_KEY, ACCOUNTS_ENABLED_DEFAULT, AccountSession, accountPreviewEnabled, accountProductionEnabled } from "./accountSession";
import { accountLock } from "./accountLock";
import { ChatPanelProvider } from "./chatPanelProvider";
import {
  labelsForProfile,
  appToneOf,
  TONE_LABELS,
  extractCohortIdUnverified,
  coachKeyForCohort,
  coachRitualDoneKeyForCohort,
  historyKeyForCohort,
  LEGACY_COACH_KEY,
  LEGACY_COACH_RITUAL_DONE_KEY,
  LEGACY_HISTORY_KEY,
} from "./chatPanelHelpers";
import { PreviewProvider } from "./previewProvider";
import { runReportProblemCommand } from "./reportProblem";
import { PerfTraceController } from "./perfTraceHost";
import { runMintStudentToken, ISSUER_TOKEN_KEY } from "./mintStudentToken";
import { looksLikeIssuerTokenUnverified, testStateCandidates } from "./chatPanelHelpers";
import { localRuntimeConfig } from "./localRuntime";
import {
  scheduleUpdateChecks,
  checkForUpdates,
  runUpdate,
  installStagedUpdate,
  dismissVersion,
  currentBundleVersion,
  reportManualUpdateCheckFailure,
  reportInstallUpdateFailure,
  registerPublicUpdateSignal,
} from "./updateChecker";
import { INSTALL_STAGED_UPDATE_COMMAND, updateInstallAllowed } from "./stagedUpdate";
import { CLASS_UPDATE_HOLD_COPY } from "./updateCheckerHelpers";
import { learnerNotes, recordWhatsNewBaseline } from "./whatsNew";
import { LEARNER_RELEASE_NOTES } from "./learnerReleaseNotes";
import { openBrowser, sendActivePageToCoach, registerPreviewViewport } from "./nativeBrowser";
import { LiveServer } from "./liveServer";
import { canonicalizeExistingPath, decideWorkspaceSwitch, isSameLocation } from "./workspaceRouting";
import { SessionSpool, resolveSpoolSessionsRoot, spoolIdentityFromToken } from "./sessionSpool";
import { uploadAllPending, scanUploadableSessions } from "./spoolUploader";
import type { ResolvedProfile } from "./protocol";
import { changeFolderConsent } from "./folderConsentHost";
import { FOLDER_CONSENT_COMMAND } from "./folderConsent.ts";
import { ASK_ABOUT_FILE_COMMAND } from "./fileAttachment";
import { QUIT_GUARD_COMMAND, UPDATE_DURING_TURN_COPY, quitGuardPrompt } from "./quitGuardHelpers";
import { resolvePublishEndpoints, type PublishOverrideSource } from "./publish/publishConfig";

const TOKEN_KEY = "hypeproofChat.workshopToken";

let providerRef: ChatPanelProvider | null = null;
let spoolRef: SessionSpool | null = null;
/** #596 — re-entry lock on the upload command (banner + palette clicked at once → no double upload). */
let uploadInFlight = false;

export async function activate(context: vscode.ExtensionContext) {
  // CGP-SHELL-R-035: first, while globalState still tells a fresh install from an updated profile.
  try { await recordWhatsNewBaseline(context.globalState, learnerNotes(LEARNER_RELEASE_NOTES)); }
  catch { console.warn('HypeProof: could not record the what\'s-new baseline.'); }
  // Reset a folder's restored sidebar before network-dependent activity restoration.
  // The explicit file-view actions can open Explorer once the learner asks for it.
  await initializeFilesLayout(command => vscode.commands.executeCommand(command));
  // #2787: a profile that persisted the empty native Chat side bar as open gets it closed once.
  await closeNativeChatBarOnce(context.globalState,
    () => vscode.workspace.getConfiguration('chat').get<boolean>('disableAIFeatures') === true,
    command => vscode.commands.executeCommand(command));
  await closeRestoredBrowserTabs(vscode.window.browserTabs ?? []);
  const connections = new ActivityConnections(context,
    () => vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1'),
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    async token => {
      const result = await fetchProfileResult({token,proxyUrl:vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1')});
      if (!result.ok) throw new Error(result.failure.friendly);
      return result.profile;
    });
  try { await connections.initialize(); }
  catch (error) { void vscode.window.showWarningMessage(error instanceof ActivityConnectionError ? error.message : '저장된 활동 연결을 확인하지 못했습니다. 파일은 보존됩니다. 저장된 활동과 연결 서버를 확인해 주세요.'); }
  context = connections.wrap();
  registerCompanionWorkspace(context, connections);
  registerExternalSkillCommands(context);
  const activationRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const activationService = vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1');
  const resumeStatus = await consumeActivityResume(context, connections.current, activationService, activationRoot).catch(() => {
    void vscode.window.showWarningMessage('저장된 입력과 대화 복원을 완료하지 못했습니다. 원래 폴더의 기록은 보존됩니다. 앱을 다시 열어 복구를 시도해 주세요.');
    return 'mismatch' as const;
  });
  // Respect the existing workspace-trust setting. Changing it on activation
  // forced a restart dialog over the first-run page.

  // Test-only backdoors. Reads from env vars (which Playwright may not always
  // propagate to the extension host) AND a JSON file in the user-data-dir as
  // a more reliable fallback.
  const backdoors = await applyTestBackdoors(context);

  const preview = new PreviewProvider(context);
  // REQ-STUDIO-PREVIEW-RECOVERY — remember the preview server's addresses (max 20, 7 days) so a tab restored on an old port is known.
  const liveServer = new LiveServer({
    get: () => context.globalState.get<unknown[]>("hypeproof.previewServedOrigins.v2", []),
    set: (origins) => { void context.globalState.update("hypeproof.previewServedOrigins.v2", origins); },
  });
  registerPreviewViewport(context, liveServer);
  // SX-59 — the old capability status bar was built here and sat on screen for the
  // whole session. It was removed module and all, per the requirement that no
  // capability score, grade or badge belongs on the working screen. What disappeared
  // is held by git history and `test/sx-legacy-score-removed.smoke.mjs` — writing the
  // deleted strings back into a comment makes that absence check trip over its own
  // documentation (which it did, once).
  // #580 — local session-log spool (collection layer). A session = one activation of
  // this extension. The directory is created lazily on the first event, so a window
  // with no chat leaves nothing behind.
  //
  // An e2e run makes no spool: the spool root is deliberately a fixed path OUTSIDE
  // user-data-dir, which bypasses e2e's fresh-user-data-dir isolation, and the e2e
  // fixture preseeds a real cohort's real token — so synthetic turns would pile up in
  // the real-device spool as sessions under a real student's identity. The moment an
  // uploader exists, that is analytics contamination.
  //
  // The gate is env OR the test state file. This file itself has written down that
  // env (HPS_TEST_E2E) propagates "inconsistently" as far as the extension host (that
  // is why REQ-A7's file backdoor exists), and contamination requires the token to
  // arrive — and the token comes either by env or by that file, so whichever one got
  // through, the gate catches it.
  // An F5 development host does record, but is marked `dev: true` in meta so it can
  // be filtered out.
  const isTestRun = !!process.env.HPS_TEST_E2E || backdoors.testStateFileFound;
  const spoolRoot = resolveSpoolSessionsRoot({
    platform: process.platform,
    homeDir: os.homedir(),
    env: process.env as Record<string, string | undefined>,
  });
  const spool = isTestRun
    ? undefined
    : new SessionSpool({
        root: spoolRoot,
        appVersion: String(
          (context.extension.packageJSON as { version?: unknown } | undefined)?.version ?? "unknown",
        ),
        os: { platform: process.platform, release: os.release(), arch: process.arch },
        devHost: context.extensionMode === vscode.ExtensionMode.Development,
      });
  // #897 (VO-01) — voice capability diagnosis. It runs **by command only**: after the
  // core patch this path raises an OS permission prompt, so it must never be run at
  // activation time.
  //
  // It sits **outside** the spool branch. In #904 this registration had been put
  // inside `if (spool)`, and `spool` is undefined on a test run (`isTestRun`) or when
  // spool initialization fails — so under exactly those conditions the command
  // silently disappeared. A diagnostic tool that vanishes when diagnosis is needed is
  // worse than no tool at all.
  context.subscriptions.push(
    vscode.commands.registerCommand("hypeproof-chat.diagnoseVoiceCapability", async () => {
      const { diagnoseVoiceCapability } = await import("./voiceCapability");
      await diagnoseVoiceCapability(context, provider, provider.voiceLogChannel());
    }),
  );

  if (spool) {
    // Total-size cap enforcement (#580 D7) — fire-and-forget so it never blocks
    // activation; failures are swallowed.
    void spool.sweepRetention();
    // On shutdown, flush the last events left in the queue (best-effort — a crash is
    // covered by the line-at-a-time append).
    context.subscriptions.push({ dispose: () => void spool.flush() });
    spoolRef = spool;
    // #596 — leftovers banner at startup (once per activation). The session-end
    // banner only fires on the proxy runtime's session_window, but the main runtime
    // is agent-sdk (session 1 review F6), so that path alone never reaches anyone —
    // instead, the next startup that finds "records not sent" offers the button. The
    // upload itself still only happens on a click.
    const pendingTimer = setTimeout(() => {
      void (async () => {
        try {
          const token = await context.secrets.get(TOKEN_KEY);
          if (!token) return;
          const pending = scanUploadableSessions(spoolRoot, {
            currentSessionDir: spool.currentSessionDir(),
            // Shared PC (N2): count only the sessions belonging to this token's
            // owner — ringing the banner over someone else's leftovers uploads
            // someone else's raw text under THIS student's consent.
            identity: spoolIdentityFromToken(token),
          });
          if (pending.length === 0) return;
          const profile = await provider.ensureProfile();
          if (profile?.analytics?.upload_session_logs !== true) return;
          const pick = await vscode.window.showInformationMessage(
            `지난 활동 기록 ${pending.length}개가 아직 안 보내졌어요 — 지금 보낼까요?`,
            "기록 보내기",
          );
          if (pick === "기록 보내기") {
            void vscode.commands.executeCommand("hypeproof-chat.uploadSessionLogs");
          }
        } catch { /* best-effort — a failed banner must not get in the way of activation */ }
      })();
    }, 15_000);
    context.subscriptions.push({ dispose: () => clearTimeout(pendingTimer) });
  }
  const provider = new ChatPanelProvider(context, preview, liveServer, spool);
  const perfTrace = new PerfTraceController({ context, seatAllowed: () => provider.perfTraceSeatAllowed(), getProfileId: () => provider.getProfileId(), onState: (state) => provider.postPerfTraceState(state) });
  provider.perfTraceObserver = (msg) => perfTrace.observe(msg);
  provider.perfTracePanel = { state: () => perfTrace.state, stop: (id) => perfTrace.stopFromPanel(id) };
  providerRef = provider;
  let companionDev: ReturnType<typeof createCompanionDevHostEntry>;
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.editImage", () => provider.editImage()));
  // One-click publish endpoints, decided once: GitHub itself, unless this is a test/dev run
  // pointing at a loopback mock (resolvePublishEndpoints explains why only then).
  provider.initSitePublish(
    resolvePublishEndpoints({
      env: process.env as Record<string, string | undefined>,
      testRun: isTestRun,
      devHost: context.extensionMode === vscode.ExtensionMode.Development,
      testState: backdoors.publishOverrides,
    }),
  );
  // CR-10 — show the delete command when an earlier session stored browser-result bytes.
  void provider.refreshCrBytesContext();
  // cr-review — show the director's Weekly Review when the stored issuer token directs a switch-on cohort.
  void provider.refreshCrDirectorContext().catch(() => undefined);
  registerLocalReview(context, (webview, dist) => provider.renderHtml(webview, dist));
  const accountConfig = vscode.workspace.getConfiguration('hypeproofChat');
  const accountService = accountConfig.get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1');
  const accountSite = accountConfig.get<string>('siteBase', 'https://hypeproof-ai.xyz');
  const accountEnabled = accountPreviewEnabled(accountConfig.get<boolean>('accountsPreview', false) || process.env.HPS_ACCOUNTS === 'enabled', accountService, accountSite)
    || accountProductionEnabled(accountConfig.get<boolean>('accountsEnabled', ACCOUNTS_ENABLED_DEFAULT), accountService, accountSite);
  const accounts = accountEnabled ? new AccountSession({
    service: accountService, site: accountSite, secrets: context.secrets,
    label: `${process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows' : 'Studio'} · Studio ${context.extension.packageJSON.version}`,
    openBrowser: url => vscode.env.openExternal(vscode.Uri.parse(url)),
    createReturnUri: async state => (await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://hypeproof.hypeproof-chat/account-return?state=${state}`))).toString(true),
    returned: async () => { await startPage.show(); },
    changed: () => startPage.accountChanged(),
    lock: accountLock(context.globalStorageUri.fsPath),
    freeCredential: (): Promise<string | undefined> => startPage.freeSignInCredential(),
    invalidated: async sessionId => {
      companionDev?.invalidate();
      if (connections.current?.accountPass?.sessionId === sessionId) provider.opsRequestStop();
      if (await connections.forgetAccount(sessionId)) { provider.invalidateProfile(); void provider.refreshConfig(); }
    },
  }) : undefined;
  connections.accountToken = accounts ? binding => accounts.resolvePass(binding) : undefined;
  const startPage = new StartPage(context, provider, async (profile, commit, selectedDirectory) => {
    return ensureWorkspace(profile, context, isTestRun && process.env.HPS_TEST_REAL_WORKSPACE !== "1", commit, selectedDirectory);
  }, provider.githubContinueSource(), accounts);
  companionDev = createCompanionDevHostEntry(context, { accounts, connections,
    configured: () => { const config = vscode.workspace.getConfiguration('hypeproofChat'); return {
      service: config.get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1'), site: config.get<string>('siteBase', 'https://hypeproof-ai.xyz'),
    }; }, taskView: () => provider.companionTaskView(), epoch: () => provider.opsRuntimeGeneration(),
    authoring: {store:()=>provider.companionTaskStore(),reviewDraft:(taskId,isCurrent)=>provider.reviewCompanionDraft(taskId,isCurrent)},
    execution: {submit:input=>provider.submitPreparedCompanionTurn(input)},
    receivingBusy:()=>provider.hasActiveStream(),
  });
  if (companionDev) {
    provider.companionApprovalChanged=waiting=>companionDev?.approval(waiting);
    const invalidate = () => companionDev?.invalidate();
    provider.companionRuntimeInvalidated = invalidate;
    const secretChange = context.secrets.onDidChange?.(event => {
      if (event.key === ACCOUNT_SECRET_KEY || event.key === TOKEN_KEY || event.key === connections.current?.ref) invalidate();
    });
    if (secretChange) context.subscriptions.push(secretChange);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (['hypeproofChat.proxyUrl', 'hypeproofChat.siteBase', 'hypeproofChat.accountsPreview', 'hypeproofChat.accountsEnabled', 'security.workspace.trust']
        .some(key => event.affectsConfiguration(key))) invalidate();
    }), vscode.workspace.onDidChangeWorkspaceFolders(invalidate));
    const trustChange = vscode.workspace.onDidGrantWorkspaceTrust?.(invalidate);
    if (trustChange) context.subscriptions.push(trustChange);
    context.subscriptions.push({ dispose: () => { if (provider.companionRuntimeInvalidated === invalidate) provider.companionRuntimeInvalidated = undefined; provider.companionApprovalChanged=undefined; companionDev?.dispose(); } });
  }
  // D19/REQ-I15: the Service's free-start offer turns on the public-release update path for a
  // Studio without member access. Read at each check; the setting `publicUpdates` still works alone.
  registerPublicUpdateSignal(() => startPage.freeStartSignal());
  context.subscriptions.push({ dispose: () => registerPublicUpdateSignal(null) });
  // One URI handler per extension. REQ-STUDIO-JOIN-LINK (CGP-SHELL-R-005): a Chalk class join link
  // only brings the join form forward with the class named; it is handled whether or not accounts are
  // on. The account return below stays exactly as strict as before.
  const joinLinkHost: JoinLinkHost = {
    scheme: vscode.env.uriScheme,
    activeTurn: () => provider.hasActiveStream(),
    currentClass: () => startPage.currentClassId(),
    open: classId => startPage.openJoinLink(classId),
    notify: message => vscode.window.showInformationMessage(message),
    ask: async (message, detail, action) => (await vscode.window.showInformationMessage(message, { modal: true, detail }, action)) === action,
    log: line => console.info(line),
  };
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: async uri => {
      if (await handleJoinLink(joinLinkHost, uri)) return;
      // CONV-PURCHASE-R-004 — the Lab done page's return link. Non-account orders poll too, so this
      // sits before the account check. A link of any other shape falls through untouched.
      const returnedOrder = purchaseReturnOrder(uri, vscode.env.uriScheme);
      if (returnedOrder) { await startPage.purchaseReturned(returnedOrder); return; }
      if (!accounts) return;
      if (uri.scheme !== vscode.env.uriScheme || uri.authority !== 'hypeproof.hypeproof-chat' || uri.path !== '/account-return' || uri.fragment) return;
      const query = new URLSearchParams(uri.query);
      if ([...query.keys()].some(key => key !== 'state' && key !== 'windowId') || query.getAll('state').length !== 1) return;
      const state = query.get('state') ?? '';
      if (/^[a-f0-9]{64}$/.test(state)) await accounts.browserReturned(state);
    },
  }));
  if (accounts) {
    const accountWatch = setInterval(() => { void accounts.refreshView(); }, 15_000);
    context.subscriptions.push({dispose: () => { clearInterval(accountWatch); accounts.dispose(); }});
  }
  let initialSurfaceReady: Promise<void> = Promise.resolve();
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.start", () => startPage.show()));
  // TUX-COND-07 — only the end-of-trial card's Primary calls this; the person pressed it.
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.showPasses", (surface?: unknown) => startPage.showPurchase(surface)));
  // "프로젝트 변경": open the picked project's folder as this activity's workspace, the same way
  // the start page enters a folder (activity commit, then ensureWorkspace switches and reloads).
  provider.setProjectOpener(async (folder) => {
    const profile = await provider.ensureProfile(true);
    if (!profile) throw new Error("profile unavailable");
    const connections = activityConnections(context);
    const token = connections ? await connections.token() : undefined;
    const commit = async (directory?: string) => {
      if (connections && token) await connections.commit(token, profile, directory ?? folder, connections.current?.accountPass);
    };
    await ensureWorkspace(profile, context, false, commit, folder);
  });
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.switchProject", () => provider.switchProject()));
  // REQ-STUDIO-FOLDER-CONSENT — preview saves ask the same write question as the chat host.
  preview.setWriteGuard((target) => provider.folderWriteRefusalFor(target));
  // REQ-STUDIO-FOLDER-CONSENT — the one place a remembered folder choice is changed.
  context.subscriptions.push(vscode.commands.registerCommand(FOLDER_CONSENT_COMMAND, async () => {
    await changeFolderConsent(context, await provider.ensureProfile(), { servedRoot: provider.servedClassRoot, instructor: provider.isInstructor === true });
    // CGP-AGENT-R-004 — a consent change ends every "이번 작업 동안" shell allow.
    provider.endTaskCommandAllows();
  }));
  // CGP-KNOW-R-015 — "이 파일에 대해 묻기" on an explorer file: show the chat, then attach through the
  // file-attach path (the host refuses anything outside the work folder) and focus the composer.
  context.subscriptions.push(vscode.commands.registerCommand(ASK_ABOUT_FILE_COMMAND, async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== "file") return;
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await provider.askAboutFile(target.fsPath);
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    if (document.uri.scheme === "file") void provider.recordArtifactSave(document.uri.fsPath);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.artifactHistory", async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target?.scheme === "file") await provider.openArtifactHistoryPanel(target.fsPath);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.takeMyWork", () => provider.takeMyWork()));
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.exportMyWork", () => provider.exportMyWork()));
  provider.setActivityTrashPanel(registerActivityTrash(context, {
    active: () => !!provider.activityTrashBinding,
    binding: () => provider.activityTrashBinding,
    refusal: file => provider.folderWriteRefusalFor(file),
  }));
  // kids-quest — skeleton round result → next-turn context for the coach.
  context.subscriptions.push(preview.onResult((r) => provider.attachQuestResult(r)));

  const classroomOps = new ClassroomOpsHost(context, () => provider.opsRuntime(), {
    hasActiveRun: () => provider.hasActiveStream(),
    probeProfile: async () => {
      const token = await context.secrets.get(TOKEN_KEY);
      if (!token) return { ok: false, noToken: true };
      const r = await fetchProfileResult({ token, proxyUrl: vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1") });
      return r.ok ? { ok: true } : { ok: false, status: r.failure.status, code: r.failure.reason === "expired" ? "expired" : undefined, requestId: r.failure.requestId, network: r.failure.reason === "network" };
    },
    // CGP-SHELL-R-024 — the re-read also republishes the config, so a capability change shows before the next turn.
    refreshProfile: async () => !!(await provider.refreshProfileAndConfig()),
    requestStop: () => provider.opsRequestStop(),
    freezeInput: (frozen) => provider.opsFreezeInput(frozen),
    preservation: () => provider.opsPreservation(),
    runtimeGeneration: () => provider.opsRuntimeGeneration(),
    newGeneration: () => provider.opsNewGeneration(),
    setHold: (hold) => provider.opsSetHold(hold),
    readSpool: (sinceMs) => provider.opsReadSpool(sinceMs),
    readCollection: (sinceMs, identity) => provider.opsReadCollection(sinceMs, identity),
    recoverPreview: () => provider.opsRecoverPreview(),
  }, (line) => console.log(line));
  provider.opsObserver = classroomOps;
  provider.inboxSource = classroomOps;
  provider.classWindowSource = () => classroomOps.helpConnection();
  // #1298 — when the background refresh path sees a rejected issuer token, delete it and surface the student start page.
  provider.onIssuerAutoRejected = () => {
    void context.secrets.delete(ISSUER_TOKEN_KEY).then(() => startPage.show());
  };
  // #751 native help: the learner's help requests to the instructor of their live class connection (ADM-03/05, AT-47).
  // Drafts and requests live one file family per record under globalStorageUri (shared by every window; globalState is one
  // object per window and loses records written in two windows at once). globalState is only read to move the old store.
  provider.helpSource = new ClassroomHelpHost(context.globalState, path.join(context.globalStorageUri.fsPath, "classroom-help"), {
    token: async () => (await context.secrets.get(TOKEN_KEY)) ?? "",
    connection: () => classroomOps.helpConnection(),
    base: () => vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1").replace(/\/$/, ""),
    history: () => provider.getHistorySnapshot(),
    post: (view) => provider.postHelp(view),
    log: (line) => console.log(line),
  });
  context.subscriptions.push(classroomOps.onInboxChanged(() => { void provider.postInbox(); startPage.inboxChanged(); }));
  // CGP-DS-R-015: a reduce-motion change reaches the open chat panel without a reload.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("workbench.reduceMotion")) void provider.refreshConfig();
    // CGP-AGENT-D-002: the card must follow the policy used by the next action.
    if (event.affectsConfiguration("hypeproofChat.requireApprovalFor")) void provider.refreshConfig();
  }));
  void classroomOps.resume();
  context.subscriptions.push(
    { dispose: () => liveServer.dispose() },
    vscode.window.registerWebviewViewProvider("hypeproof-chat.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    // Preview is no longer a sidebar view — it's an editor-area WebviewPanel
    // created on demand by PreviewProvider.show().

    vscode.commands.registerCommand("hypeproof-chat.focus", () => startPage.focusAfterRestore(initialSurfaceReady)),

    vscode.commands.registerCommand('hypeproof-chat.openStudioFiles', () => vscode.commands.executeCommand('workbench.view.explorer')),
    // #751 — remote classroom operations: learner-initiated, status-only, droppable.
    vscode.commands.registerCommand("hypeproof-chat.classroomConnect", () => classroomOps.connectInteractively()),
    vscode.commands.registerCommand("hypeproof-chat.classroomDisconnect", () => classroomOps.disconnectInteractively()),
    vscode.commands.registerCommand("hypeproof-chat.classroomNotes", () => classroomOps.showCoachingNotes()),
    vscode.commands.registerCommand("hypeproof-chat.classroomCollectionConsent", () => classroomOps.collectionConsentInteractively()),
    vscode.commands.registerCommand("hypeproof-chat.classroomApproveArtifact", () => provider.approveArtifactInteractively()),

    vscode.commands.registerCommand("hypeproof-chat.clearHistory", async () => {
      await provider.clearHistory();
      vscode.window.showInformationMessage("HypeProof Chat: conversation cleared.");
    }),

    // #596 — session-log upload (#580 upload layer). It always runs on an **explicit
    // action** only: this command (palette), or the button on the session-end /
    // startup leftovers banner.
    //
    // The ORDER is the whole point: first **seal** the current session (seal — the
    // spool routes the next event into a new session), then upload the sealed
    // directory with the quiescence gate waived (allowFresh). Without this, the
    // "exclude the active session" rule means the end-of-day-1 banner uploads none of
    // today's data (session 1 review F1). Active sessions in other windows are still
    // protected by the quiescence gate (UPLOAD_QUIESCENT_MS) (F2).
    vscode.commands.registerCommand("hypeproof-chat.uploadSessionLogs", async () => {
      if (!spool) {
        vscode.window.showInformationMessage("테스트 실행에서는 세션 기록을 남기지 않아요.");
        return;
      }
      if (uploadInFlight) {
        vscode.window.showInformationMessage("이미 기록을 보내는 중이에요 — 잠시만요.");
        return;
      }
      // Take the lock immediately after the check — if a second call slips in between
      // the awaits below, the lock is decoration (session 2 review N4).
      uploadInFlight = true;
      try {
        const token = await context.secrets.get(TOKEN_KEY);
        if (!token) {
          vscode.window.showInformationMessage("토큰을 먼저 넣어주세요 — 기록은 토큰의 수업으로 보내져요.");
          return;
        }
        const profile = await provider.ensureProfile();
        if (profile === null) {
          // A failed lookup must not be merged with "the feature is off" (#381), and
          // the wording must not assert a cause either (the 401 misreading incident in
          // verification.md) — the side that knows the cause AND the next action is
          // profileFailure.
          vscode.window.showWarningMessage(
            provider.profileFailure()?.friendly ??
              "수업 정보를 확인하지 못했어요 — 잠시 후 다시 시도해주세요.",
          );
          return;
        }
        if (profile.analytics?.upload_session_logs !== true) {
          // The server refuses it anyway (fail closed) — say so quietly, up front.
          vscode.window.showInformationMessage("이 수업은 기록 업로드를 사용하지 않아요.");
          return;
        }
        const proxyUrl = vscode.workspace
          .getConfiguration("hypeproofChat")
          .get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "오늘 활동 기록 보내는 중…" },
          async () => {
            // Record the attempt **before sealing, and only into a session that
            // already had activity**. Recording after the seal materializes a junk
            // one-event session, which becomes the next startup banner's "1 record not
            // sent" and kills the signal (N3).
            if (spool.currentSessionDir()) {
              // Seal the real index.html as it stands at the end of the lesson, not
              // the code inside a chat reply. Whatever the child edited by hand last
              // then survives into the outcome analysis.
              await provider.captureFinalArtifactForSpool();
              spool.recordWorkflow({ event: "logs_upload" });
            }
            const sealed = await spool.seal();
            const results = await uploadAllPending(spoolRoot, {
              current: async () => await context.secrets.get(TOKEN_KEY) === token && vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1") === proxyUrl,
              confirm: async (manifest) => await confirmOutbound(manifest) && await context.secrets.get(TOKEN_KEY) === token,
              baseUrl: proxyUrl,
              token,
              currentSessionDir: spool.currentSessionDir(),
              // Shared-PC defence (N2): only sessions whose meta matches this token's identity.
              identity: spoolIdentityFromToken(token),
              ...(sealed ? { allowFresh: [sealed] } : {}),
            });
            const ok = results.filter((r) => r.ok).length;
            const fail = results.length - ok;
            // The result tally goes to the console, not the spool — writing it to the
            // spool materializes the empty post-seal session and starts a junk chain
            // (N3).
            console.log(`[spool-upload] sessions=${results.length} ok=${ok} fail=${fail}`);
            if (results.length === 0) {
              vscode.window.showInformationMessage("보낼 새 기록이 없어요.");
            } else if (fail === 0) {
              vscode.window.showInformationMessage(`활동 기록 ${ok}개 세션을 보냈어요!`);
            } else {
              const first = results.find((r) => !r.ok);
              vscode.window.showWarningMessage(
                `기록 ${ok}개는 보냈고 ${fail}개는 실패했어요 — 나중에 "오늘 활동 기록 보내기"를 다시 실행하면 이어서 보내요.` +
                  (first?.message ? ` (${first.message})` : ""),
              );
            }
          },
        );
      } finally {
        uploadInFlight = false;
      }
    }),

    vscode.commands.registerCommand("hypeproof-chat.setToken", () => startPage.show()),

    vscode.commands.registerCommand("hypeproof-chat.runLastCode", async () => {
      const html = provider.extractLastRenderableCode();
      if (!html) {
        vscode.window.showWarningMessage("HypeProof Chat: 마지막 응답에서 실행할 코드가 없어요.");
        return;
      }
      await provider.revealBuilt(html);
    }),

    // Preview the .html file in the active editor (or a passed-in URI from
    // the explorer context menu). basePath = the file's parent dir so
    // sibling assets (./style.css, ./pic.png) resolve.
    vscode.commands.registerCommand("hypeproof-chat.previewActiveFile", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || target.scheme !== "file") {
        vscode.window.showWarningMessage("HypeProof: preview할 .html 파일을 열어주세요.");
        return;
      }
      if (!/\.html?$/i.test(target.fsPath)) {
        vscode.window.showWarningMessage("HypeProof: .html / .htm 파일만 preview 가능합니다.");
        return;
      }
      // Preview is consolidated onto **one live server** (원장 decision 2026-07-27).
      //
      // It used to render the HTML directly in a webview. That makes the screen the
      // coach sees (live_preview_start → 127.0.0.1) and the screen the student opens
      // by right-click **two different truths**. In real use the right-click preview
      // showed content that lagged behind the live one, and the student had no way to
      // tell which was right.
      //
      // The live server is real HTTP + a real browser + auto-reload on save, so it is
      // exactly the screen the coach verifies against.
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showWarningMessage("HypeProof: 작업 폴더를 먼저 열어주세요.");
        return;
      }
      try {
        const base = await liveServer.ensure(root);
        // Open by a path relative to the workspace root. index.html at the root is `/`.
        const rel = path.relative(root, target.fsPath).split(path.sep).join("/");
        const url = rel === "index.html" ? base : `${base.replace(/\/$/, "")}/${rel}`;
        await vscode.commands.executeCommand("hypeproof-chat.openBrowser", url);
      } catch (err) {
        vscode.window.showErrorMessage(`HypeProof: 미리보기를 열지 못했어요 — ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("hypeproof-chat.renameCoach", async () => {
      await provider.runCoachNamingRitual({ force: true });
    }),

    // REQ-STUDIO-PERF-TRACE (CGP-AGENT-R-030): 느려요 기록, adult and instructor seats, default off.
    vscode.commands.registerCommand("hypeproof-chat.recordPerformanceTrace", async () => { await perfTrace.start(); }),
    vscode.commands.registerCommand("hypeproof-chat.stopPerformanceTrace", async () => { await perfTrace.stop("learner"); }),
    { dispose: () => { provider.perfTraceObserver = undefined; provider.perfTracePanel = undefined; perfTrace.dispose(); } },

    vscode.commands.registerCommand("hypeproof-chat.reportProblem", async () => {
      await runReportProblemCommand({
        context,
        getLastRequestId: () => provider.getLastRequestId(),
        getProfileId: () => provider.getProfileId(),
        getRecentTurns: () => provider.getHistorySnapshot(),
        getAudience: () => provider.getSeatAudience(),
      });
    }),

    // #66 — Mint Student Token for instructors. Pulls cohort/profile defaults
    // from the active /v1/profile response so the instructor doesn't have to retype
    // them. issuer token persists in SecretStorage between mints.
    vscode.commands.registerCommand("hypeproof-chat.mintStudentToken", async () => {
      const proxyUrl = vscode.workspace
        .getConfiguration("hypeproofChat")
        .get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
      // Cohort id is not exposed via /v1/profile; the issuer token payload
      // carries cohort scope and mintStudentToken extracts the default
      // automatically when scope is a single cohort.
      await runMintStudentToken({
        context,
        proxyUrl,
        defaults: {
          profile: provider.getProfileId(),
        },
      });
    }),

    vscode.commands.registerCommand("hypeproof-chat.forgetIssuerToken", async () => {
      await context.secrets.delete(ISSUER_TOKEN_KEY);
      await provider.refreshConfig();
      vscode.window.showInformationMessage("issuer 토큰이 지워졌어요. 다음 발급 시 다시 물어봅니다.");
    }),

    vscode.commands.registerCommand("hypeproof-chat.chalk.setInstructorToken", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "강사 토큰을 입력하세요",
        password: true,
        placeHolder: "issuer 토큰",
        ignoreFocusOut: true,
      });
      if (!input || input.trim().length === 0) return;
      const trimmed = input.trim();
      if (!looksLikeIssuerTokenUnverified(trimmed)) {
        vscode.window.showErrorMessage("issuer 토큰 형식이 아닙니다. 발급받은 강사 토큰을 확인하세요.");
        return;
      }
      await context.secrets.store(ISSUER_TOKEN_KEY, trimmed);
      await provider.refreshConfig();
      const whoamiStatus = provider.lastWhoamiStatus;
      if (whoamiStatus === "rejected") {
        await context.secrets.delete(ISSUER_TOKEN_KEY);
        vscode.window.showErrorMessage("강사 토큰이 유효하지 않습니다. 서버가 인증을 거부했습니다.");
        return;
      }
      if (whoamiStatus === "unreachable") {
        vscode.window.showWarningMessage("서버에 연결하지 못했습니다. 토큰은 저장됐고, 연결되면 강사 모드가 열립니다.");
        return;
      }
      vscode.window.showInformationMessage("강사 토큰이 저장됐습니다.");
    }),

    // #1297 (E4-2): 버튼과 AI가 같은 Chalk 도구 함수를 부른다(SUB-07).
    // 여기서 등록되는 명령은 명령 팔레트에서 수동으로 부를 수 있고,
    // AI 도구 호출도 chalk/tools.ts의 같은 execCheckPlan을 거친다.
    vscode.commands.registerCommand("hypeproof-chat.chalk.checkPlan", async () => {
      const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz");
      const enabled = await chalkToolsEnabled(context.secrets);
      if (!enabled) {
        vscode.window.showWarningMessage("Chalk 초안 검사는 강사 모드에서만 사용할 수 있습니다. issuer 토큰을 먼저 등록하세요.");
        return;
      }
      const cohort = await vscode.window.showInputBox({ prompt: "코호트 ID", placeHolder: "예: kids-workshop-s1" });
      if (!cohort) return;
      const course = await vscode.window.showInputBox({ prompt: "강의 ID", placeHolder: "예: lesson-01" });
      if (!course) return;
      try {
        const result = await callChalkTool(
          { serverUrl: proxyUrl, secrets: context.secrets },
          "chalk_check_plan",
          { cohort, course },
        );
        const panel = vscode.window.createOutputChannel("Chalk 초안 검사", "json");
        panel.appendLine(result);
        panel.show(true);
      } catch (err) {
        vscode.window.showErrorMessage(`검사 실패: ${(err as Error).message}`);
      }
    }),

    // #1295 (E2-6): Chalk 생성 흐름 버튼 명령. 버튼과 AI 도구가 같은 execXxx를 부른다(SUB-07).
    vscode.commands.registerCommand("hypeproof-chat.chalk.openCourse", async () => {
      const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz");
      const enabled = await chalkToolsEnabled(context.secrets);
      if (!enabled) { vscode.window.showWarningMessage("강사 모드에서만 사용할 수 있습니다."); return; }
      const cohort = await vscode.window.showInputBox({ prompt: "코호트 ID", placeHolder: "예: kids-workshop-s1" });
      if (!cohort) return;
      const course = await vscode.window.showInputBox({ prompt: "강의 ID", placeHolder: "예: lesson-01" });
      if (!course) return;
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      try {
        const result = await callChalkTool(
          {
            serverUrl: proxyUrl, secrets: context.secrets, cwd,
            requestConfirmation: async (msg) => (await vscode.window.showWarningMessage(msg, { modal: true }, "계속", "취소")) === "계속",
          },
          "chalk_open_course", { cohort, course },
        );
        const parsed = JSON.parse(result) as { local_file?: string };
        if (parsed.local_file) {
          const doc = await vscode.workspace.openTextDocument(parsed.local_file);
          await vscode.window.showTextDocument(doc);
        }
      } catch (err) { vscode.window.showErrorMessage(`열기 실패: ${(err as Error).message}`); }
    }),
    vscode.commands.registerCommand("hypeproof-chat.chalk.savePlan", async () => {
      const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz");
      const enabled = await chalkToolsEnabled(context.secrets);
      if (!enabled) { vscode.window.showWarningMessage("강사 모드에서만 사용할 수 있습니다."); return; }
      const cohort = await vscode.window.showInputBox({ prompt: "코호트 ID" });
      if (!cohort) return;
      const course = await vscode.window.showInputBox({ prompt: "강의 ID" });
      if (!course) return;
      const knowledgeVersion = await vscode.window.showInputBox({ prompt: "지식 버전 (숫자)" });
      if (!knowledgeVersion) return;
      const expectedRevision = await vscode.window.showInputBox({ prompt: "현재 revision 번호" });
      if (!expectedRevision) return;
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      try {
        const result = await callChalkTool(
          { serverUrl: proxyUrl, secrets: context.secrets, cwd },
          "chalk_save_plan",
          { cohort, course, knowledge_version: Number(knowledgeVersion), expected_revision: Number(expectedRevision), request_id: crypto.randomUUID() },
        );
        const panel = vscode.window.createOutputChannel("Chalk 저장 결과", "json");
        panel.appendLine(result);
        panel.show(true);
      } catch (err) { vscode.window.showErrorMessage(`저장 실패: ${(err as Error).message}`); }
    }),


    // #72: auto-update commands. The banner in the chat panel calls
    // installUpdate via the openInstallUpdate webview message → provider →
    // here. checkForUpdates is also exposed as a command so the user can
    // manually trigger a check (Cmd+Shift+P).
    vscode.commands.registerCommand("hypeproof-chat.checkForUpdates", async () => {
      try {
        const current = currentBundleVersion();
        const info = await checkForUpdates(current);
        if (info.available) {
          provider.setAvailableUpdate({
            version: info.version,
            notes: info.notes,
            releaseUrl: info.releaseUrl,
            sizeBytes: info.sizeBytes,
          });
          vscode.window.showInformationMessage(
            provider.isClassUpdateHeld()
              ? `새 버전 v${info.version} 발견. ${CLASS_UPDATE_HOLD_COPY}`
              : `새 버전 v${info.version} 발견. 채팅 패널 상단의 배너에서 설치할 수 있어요.`,
          );
        } else {
          provider.setAvailableUpdate(null);
          vscode.window.showInformationMessage(`현재 v${current} — 최신 버전입니다.`);
        }
      } catch (error) {
        // REQ-I14: no release access → homepage download, not a retry promise.
        void reportManualUpdateCheckFailure(error);
      }
    }),

    vscode.commands.registerCommand("hypeproof-chat.installUpdate", async () => {
      // CGP-SHELL-R-001: no download, install or restart while a class seat is active.
      if (provider.isClassUpdateHeld()) {
        void vscode.window.showInformationMessage(CLASS_UPDATE_HOLD_COPY);
        return;
      }
      // REQ-STUDIO-QUIT-GUARD: the install ends in a quit, which the quit guard would question.
      if (provider.hasActiveStream()) {
        void vscode.window.showInformationMessage(UPDATE_DURING_TURN_COPY);
        return;
      }
      try {
        // Re-fetch to be safe (the stored banner state might be stale).
        const current = currentBundleVersion();
        const info = await checkForUpdates(current);
        if (!info.available) {
          provider.setAvailableUpdate(null);
          vscode.window.showInformationMessage("최신 버전이라 업데이트 안 해도 됩니다.");
          return;
        }
        await runUpdate(info, {
          context,
          canInstall: () => updateInstallAllowed(provider),
          onUpdateScheduled: () => provider.setAvailableUpdate(null),
        });
      } catch (error) {
        // D19/REQ-I14: no access or a rate-limited re-check gets the manual-check copy.
        void reportInstallUpdateFailure(error);
      }
    }),

    // Invoked only after native shutdown vetoes have accepted an explicit app quit.
    vscode.commands.registerCommand(INSTALL_STAGED_UPDATE_COMMAND, () =>
      installStagedUpdate(context, () => updateInstallAllowed(provider))),

    // REQ-STUDIO-QUIT-GUARD: asked by the core quit guard on window close and app quit.
    // null = nothing would stop, so the shutdown goes ahead without a dialog.
    vscode.commands.registerCommand(QUIT_GUARD_COMMAND, () => quitGuardPrompt(provider.quitGuardActivity())),

    vscode.commands.registerCommand("hypeproof-chat.dismissUpdate", async (version: string) => {
      if (typeof version !== "string" || !version) return;
      await dismissVersion(context, version);
      provider.setAvailableUpdate(null);
    }),

    // #278 — native integrated browser. openBrowser: open a real browser tab
    // (own/external/localhost/file pages, Q1). sendPageToCoach: capture the
    // active tab via CDP for the coach (Q2 foundation).
    vscode.commands.registerCommand("hypeproof-chat.openBrowser", (url?: string) =>
      openBrowser(typeof url === "string" ? url : undefined),
    ),

    // CGP-VOICE-R-010: the own-preview owner is Studio's own preview server.
    vscode.commands.registerCommand("hypeproof-chat.sendPageToCoach", () => sendActivePageToCoach(provider, liveServer)),

    // CR-09 (cr-browser) — pick an element in the Experiment Browser and ask the coach
    // about it. Gated by the CR switch in package.json AND re-checked inside
    // pickElement(), because a command can be executed without its menu (recon R3).
    vscode.commands.registerCommand("hypeproof-chat.pickElement", () => provider.pickElement()),
    // CR-10 (cr-browser) — the stored browser results, labelled by artifact version. Same
    // gate: the manifest hides it with the switch off and showBrowserResults() re-checks.
    vscode.commands.registerCommand("hypeproof-chat.browserResults", () => provider.showBrowserResults()),
    // cr-verify — "Test my product" (CR-12). Gated in the manifest, re-checked in the handler.
    vscode.commands.registerCommand("hypeproof-chat.testMyProduct", () => provider.testMyProduct()),
    // cr-publish — "Publish for user test" (CR-17). Gated in the manifest, re-checked in the handler.
    vscode.commands.registerCommand("hypeproof-chat.publishTestVersion", () => provider.publishTestVersion()),
    // One-click publish to GitHub Pages. Gated in the manifest (sitePublishEnabled), re-checked in the handler.
    vscode.commands.registerCommand("hypeproof-chat.publishSite", () => provider.publishSite()),
    // Forget the persisted "publish without asking" registration (publishRegistry.ts).
    vscode.commands.registerCommand("hypeproof-chat.publishSiteUnregister", () => provider.unregisterSitePublish()),
    vscode.commands.registerCommand("hypeproof-chat.experimentEvidence", () => provider.experimentEvidence()),
    vscode.commands.registerCommand("hypeproof-chat.ventureMemory", () => provider.ventureMemory()),
    vscode.commands.registerCommand("hypeproof-chat.wikiIngest", () => provider.wikiIngest()),
    vscode.commands.registerCommand("hypeproof-chat.deckDraft", () => provider.deckDraft()),
    vscode.commands.registerCommand("hypeproof-chat.deckSlideSuggest", () => provider.deckSlideSuggest()),
    vscode.commands.registerCommand("hypeproof-chat.deckPdf", () => provider.deckPdf()),
    vscode.commands.registerCommand("hypeproof-chat.curriculumSkills", () => provider.curriculumSkills()),
    vscode.commands.registerCommand("hypeproof-chat.weeklyReview", () => provider.weeklyReview()),
    vscode.commands.registerCommand("hypeproof-chat.weeklyReviewDirector", () => provider.weeklyReviewDirector()),
    // CR-10 — delete the stored browser-result bytes. Gated on "bytes are stored", NOT on
    // the CR switch: what an earlier switch-on stored stays deletable after it goes off.
    vscode.commands.registerCommand("hypeproof-chat.clearBrowserResultBytes", () => provider.clearStoredBrowserResults()),

    // #384 — "drag a screenshot in" that survives VS Code. Dropping a file on
    // the editor makes VS Code open it as a tab (it intercepts the drop before
    // the chat webview ever sees it). So we watch for an image tab opening and
    // offer to attach it to the coach — turning the interception into the
    // feature. image_paste-gated; the user still confirms via a one-click
    // notification (never silent).
    vscode.window.tabGroups.onDidChangeTabs(async (e) => {
      const asFiles = provider.isImageFilesEnabled();
      if (!provider.isImagePasteEnabled() && !asFiles) return;
      for (const tab of e.opened) {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        const uri = input?.uri;
        if (!uri || uri.scheme !== "file") continue;
        if (!(asFiles ? /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i : /\.(png|jpe?g|gif|webp)$/i).test(uri.fsPath)) continue;
        const name = uri.path.split("/").pop() ?? "이미지";
        if (asFiles) {
          // D-028 — the photo goes into the chat as a file (saved to images/ on send). A photo
          // already in the class folder is just being looked at, not attached.
          if (provider.isInsideWorkspace(uri.fsPath)) continue;
          const pick = await vscode.window.showInformationMessage(imageAttachPrompt(provider.coachDisplayName(), name), "붙이기");
          if (pick !== "붙이기") continue;
          if (await provider.stageImageFromFile(uri.fsPath)) {
            // The tab VS Code opened for the drop covers the work; the photo now lives in the chat.
            // Look the tab up again by its file: the Tab object from the event can be stale after
            // the prompt (2026-10-14 app run: closing it left the photo tab open).
            const same = vscode.window.tabGroups.all
              .flatMap((g) => g.tabs)
              .filter((t) => (t.input as { uri?: vscode.Uri } | undefined)?.uri?.toString() === uri.toString());
            try { if (same.length) await vscode.window.tabGroups.close(same); } catch { /* already closed */ }
          }
          await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
          continue;
        }
        const pick = await vscode.window.showInformationMessage(
          imageAttachPrompt(provider.coachDisplayName(), name),
          "붙이기",
        );
        if (pick !== "붙이기") continue;
        await provider.attachNativeImageFile(uri.fsPath, false);
        await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
      }
    }),
  );

  // Test-only: if HPS_TEST_CRASH_AFTER_MS is set, post a webviewTestCrash
  // to the panel after that many milliseconds. Lets e2e exercise REQ-C7
  // (ChatErrorBoundary) without needing a registered command in
  // contributes.commands. Env-gated; no-op in real workshop builds.
  if (process.env.HPS_TEST_CRASH_AFTER_MS) {
    const ms = Number(process.env.HPS_TEST_CRASH_AFTER_MS);
    if (Number.isFinite(ms) && ms >= 0) {
      setTimeout(() => provider.postTestCrash(), ms);
    }
  }

  // Test-only (#751 U4): with HPS_TEST_PREVIEW_FAULT=<file>, the appearance of that file drops the live preview server the
  // way a crash would, so a real window can exercise the new-port recovery. Unset = nothing is watched, nothing registered.
  const previewFault = process.env.HPS_TEST_PREVIEW_FAULT;
  if (previewFault) {
    const timer = setInterval(() => {
      if (!fs.existsSync(previewFault)) return;
      try { fs.rmSync(previewFault); } catch { /* the next tick retries */ return; }
      liveServer.simulateCrashForTest();
      console.log("[test] preview server dropped (HPS_TEST_PREVIEW_FAULT)");
    }, 500);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
  }

  // #72: kick off background update checks. Scheduler is disposable so we
  // attach it to the extension lifecycle.
  context.subscriptions.push(
    scheduleUpdateChecks({
      context,
      currentVersion: currentBundleVersion(),
      pushUpdateBanner: (info) => {
        if (!info) {
          provider.setAvailableUpdate(null);
          return;
        }
        provider.setAvailableUpdate({
          version: info.version,
          notes: info.notes,
          releaseUrl: info.releaseUrl,
          sizeBytes: info.sizeBytes,
        });
      },
    }),
  );

  // The start surface owns connection and explicit course entry.
  // #1298 — if an issuer-shaped token is already stored, the user is likely an instructor; skip the
  // student start page automatically. If whoami later returns rejected the token is deleted and the
  // start page is shown once (handled in postConfig/refresh via instructorMode.handleAutoReadResult).
  initialSurfaceReady = restoreInitialSurface({
    getStoredIssuer: () => context.secrets.get(ISSUER_TOKEN_KEY),
    decision: resumeStatus,
    connections: () => activityConnections(context),
    notifyExpired: message => vscode.window.showInformationMessage(message),
    notifyMismatch: message => vscode.window.showWarningMessage(message),
    showStart: options => startPage.show(options),
    ensureProfile: () => provider.ensureProfile(true),
    openChat: () => startPage.openChat(),
  });

  // E2E backdoor for REQ-E1/E2 manual-approve modal. Fires a synthetic
  // actionRequest after the panel mounts and writes the approve/deny result
  // to a file the Playwright test can read. Gated on env so it can never
  // run in a real workshop build.
  void maybeSynthesizeTestAction(context, provider);
  if (companionDev) return { companionDev: companionDev.api };
}

/**
 * Test-only: synthesize a manual-approve actionRequest if the test fixture
 * asked for one. Result (the user's Approve/Deny click outcome) is written
 * to a JSON file so the test side can read it after dismissing the modal.
 */
async function maybeSynthesizeTestAction(
  _context: vscode.ExtensionContext,
  provider: ChatPanelProvider,
): Promise<void> {
  const raw = process.env.HPS_TEST_SYNTH_ACTION;
  if (!raw) return;
  let cfg: {
    kind: "writeFile" | "executeShell";
    description: string;
    resultFile: string;
    destructive?: boolean;
    payload?: Record<string, unknown>;
  };
  try {
    cfg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!cfg.kind || !cfg.resultFile) return;

  // Give the chat panel time to mount so focus is in a sensible place.
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const approved = await provider.resolveActionApproval({
      requestId: `test-${Date.now()}`,
      kind: cfg.kind,
      description: cfg.description ?? "(test description)",
      destructive: cfg.destructive,
      payload: cfg.payload ?? { test: true },
    });
    fs.writeFileSync(cfg.resultFile, JSON.stringify({ approved, ts: Date.now() }));
  } catch (err) {
    fs.writeFileSync(
      cfg.resultFile,
      JSON.stringify({ error: (err as Error).message, ts: Date.now() }),
    );
  }
}

// Legacy fallback folder — used only when the profile carries no (or an
// unusable) `workspace_root`. Cohorts now drive this via profile.workspace_root
// (#422): "~/HypeProofClinic" for the dental website cohort, "~/HypeProofGames"
// for kids, etc. os.homedir() makes the fallback path always absolute.
const LEGACY_WORKSPACE_DIRNAME = "HypeProofGames";

async function clearWorkspaceSwitchAttempt(context?: vscode.ExtensionContext): Promise<void> {
  if (!context) return;
  if (context.globalState.get<string>(WORKSPACE_SWITCH_ATTEMPT_KEY) === undefined) return;
  await context.globalState.update(WORKSPACE_SWITCH_ATTEMPT_KEY, undefined);
}

/**
 * realpath the nearest EXISTING ancestor and re-append the tail, so a folder
 * that does not exist yet still canonicalizes. Same shape as the twins in
 * chatPanelProvider/sdkCoach (#384) — a symlinked home (`/var` → `/private/var`,
 * a redirected profile folder on Windows) must not read as a DIFFERENT root, or
 * we would switch away from the folder we are already in, forever.
 */
const canonicalizeFsPath = canonicalizeExistingPath;

// Per-tone background for the throwaway starter index.html. The title/subtitle
// come from the single source of truth (TONE_LABELS.aboutTitle/aboutSubtitle),
// so game / search-webapp / website each get copy matching their chat panel.
const STARTER_BG: Record<string, string> = {
  game: "#1b1b2a",
  search: "#0b1f2a",
  site: "#0f172a",
};

/**
 * The placeholder index.html seeded into a fresh workspace. Uses the cohort's
 * tone (appToneOf) so a website cohort never sees a "🎮 게임" starter (#422).
 * It's a throwaway — the coach overwrites it on the first build.
 */
function starterIndexHtml(profile?: ResolvedProfile | null): string {
  const tone = appToneOf(profile ?? undefined);
  const { aboutTitle, aboutSubtitle } = TONE_LABELS[tone];
  const bg = STARTER_BG[tone] ?? STARTER_BG.game;
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${aboutTitle}</title>
  <style>
    body { margin:0; height:100vh; display:flex; align-items:center;
           justify-content:center; background:${bg}; color:#fff;
           font-family:-apple-system,sans-serif; text-align:center; }
  </style>
</head>
<body>
  <div>
    <h1>${aboutTitle}</h1>
    <p>${aboutSubtitle}</p>
  </div>
</body>
</html>
`;
}

/**
 * Resolve a profile's `workspace_root` to an absolute path. Expands a leading
 * `~`. Returns null when the value can't be trusted as an absolute location
 * (relative or empty) — the caller then falls back to the legacy folder, so a
 * misauthored profile can never point the open-folder at a relative path and
 * trigger a reload loop.
 */
export function resolveWorkspaceRoot(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const expanded =
    v === "~" ? os.homedir()
    : v.startsWith("~/") || v.startsWith("~\\") ? path.join(os.homedir(), v.slice(2))
    : v;
  return path.isAbsolute(expanded) ? expanded : null;
}

/**
 * Make sure the learner has a real folder to work in, matching their cohort.
 * The folder path comes from a local selection or `profile.workspace_root`, kept
 * separate so a selection cannot authorize pass takeover. The starter page comes from
 * `profile.game.template_tier` (website vs game) — #422. When the profile is
 * absent (called before onboarding resolves it) or carries no workspace_root,
 * we fall back to the legacy `~/HypeProofGames` + game starter, so existing
 * cohorts are unchanged.
 *
 * Returns true if the window is reloading (caller should bail).
 *
 * A folder being open is NOT automatically a no-op. VS Code restores the last
 * window, so once `~/HypeProofGames` was opened it hijacked every later session:
 * a different cohort's token could never move the window, and the coach's cwd
 * (resolveCoachCwd prefers the OPEN folder) stayed on the stale one — an adult
 * cohort ran its lecture inside the kids' game folder. So when the profile names
 * a different root we switch to it (decideWorkspaceSwitch owns the rules; the
 * reload-loop guard is `WORKSPACE_SWITCH_ATTEMPT_KEY` below).
 *
 * Race protection (#42): even with `onStartupFinished` activation, a
 * positional `--folder` arg may take a tick to register in
 * `workspaceFolders`. Grace-poll for up to 1s before deciding to trigger a
 * create-and-reload — without this, e2e cold-launch with a pre-opened test
 * folder would briefly see workspaceFolders empty, fire openFolder, and
 * reload mid-onboard, racing the setToken QuickInput.
 */
export async function ensureWorkspace(
  profile?: ResolvedProfile | null,
  context?: vscode.ExtensionContext,
  isTestRun = false,
  commit: (directory?: string) => Promise<void> = async () => {},
  selectedDirectory?: string,
): Promise<boolean> {
  const desiredRoot = selectedDirectory ? resolveWorkspaceRoot(selectedDirectory)
    : profile?.workspace_root ? resolveWorkspaceRoot(profile.workspace_root) : null;
  let open: string[] = [];
  for (let i = 0; i < 10; i++) {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      open = folders.map((f) => f.uri.fsPath);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (open.length > 0) {
    const attempted = context?.globalState.get<string>(WORKSPACE_SWITCH_ATTEMPT_KEY) ?? null;
    const decision = decideWorkspaceSwitch({
      openFolders: open,
      desiredRoot,
      lastAttemptedRoot: attempted,
      // Reuse the env OR file fixture verdict from activation (same as spool).
      isE2E: isTestRun,
      canonicalize: canonicalizeFsPath,
    });
    if (!decision.switch) {
      const desired = desiredRoot;
      if (!isTestRun && desired && !isSameLocation(open[0], desired, canonicalizeFsPath)) {
        await clearWorkspaceSwitchAttempt(context);
        throw new Error('Activity workspace is not the active root');
      }
      console.info(`[workspace] staying in ${open[0]} — ${decision.reason}`);
      // We just came back from a switch we ordered. Say so: a folder that
      // silently changes underneath the learner reads as "my files are gone".
      // The toast is post-reload on purpose — one fired before openFolder dies
      // with the window and is never seen.
      if (attempted && open.some((f) => isSameLocation(f, attempted, canonicalizeFsPath))) {
        vscode.window.showInformationMessage(
          `선택한 활동의 작업 폴더를 열었습니다: ${path.basename(attempted)}`,
        );
      }
      // The attempt marker has served its purpose (either we landed where we
      // meant to, or we deliberately gave up). Clear it so a LATER cohort change
      // is not mistaken for a failed retry of this one.
      await clearWorkspaceSwitchAttempt(context);
      await commit(open[0]);
      return false;
    }
    console.warn(`[workspace] cohort folder differs — switching ${decision.from} → ${decision.to}`);
    // Record BEFORE the reload: if the open fails we must not try again.
    await context?.globalState.update(WORKSPACE_SWITCH_ATTEMPT_KEY, decision.to);
    try { return await openWorkspaceFolder(decision.to, profile, commit, context); }
    catch (error) { await clearWorkspaceSwitchAttempt(context); throw error; }
  }

  // Folder + starter are cohort-driven; legacy fallback keeps old cohorts intact
  // and guarantees an absolute path (a relative workspace_root resolves to null).
  const resolved = desiredRoot;
  const dir = resolved ?? path.join(os.homedir(), LEGACY_WORKSPACE_DIRNAME);
  return await openWorkspaceFolder(dir, profile, commit, context);
}

/**
 * Create `dir` (with the cohort's starter page if empty) and open it as the
 * single workspace root. Returns true when the open was issued — the window is
 * reloading and the caller must bail. Returns false if the folder could not be
 * created: preparation now throws and entry retains the prior connection.
 *
 * Shared by BOTH entry paths (first open, and the cohort switch) so a switched
 * folder gets the same trust/startup-editor treatment as a freshly created one.
 */
async function openWorkspaceFolder(
  dir: string,
  profile: ResolvedProfile | null | undefined,
  commit: (directory?: string) => Promise<void>,
  context?: vscode.ExtensionContext,
): Promise<boolean> {
  try {
    const prepare=()=>prepareWorkspaceDirectory(dir, !profile || profile.workspace_start === 'empty' ? 'empty' : 'html', () => starterIndexHtml(profile));
    const connections=context && activityConnections(context);
    // REQ-STUDIO-FREE-START — who holds the folder is read from SecretStorage first; prepare() is synchronous.
    if(connections && profile)connections.prepare(dir,profile,prepare,await connections.folderOwners(dir));else prepare();
  } catch(error) {
    if(error instanceof ActivityConnectionError)throw error;
    throw new Error('Activity workspace preparation failed');
  }
  const previousRecord = context && activityConnections(context)?.current;
  const checkpoint = context && previousRecord && previousRecord.serverId === profile?.activity_id && activityConnections(context)?.matchesService
    ? activityCheckpoint(context, previousRecord) : undefined;
  await commit(dir);

  // Binding is committed first; the marker grants no authority and contains no credential.
  const record = context && activityConnections(context)?.current;
  const key = context && record ? resumeKey(dir) : undefined;
  if (context && key && record) {
    await context.globalState.update(key, {
      version: 1, id: record.serverId, service: record.service, workspace: fs.realpathSync(dir), ref: record.ref, at: Date.now(), ...(checkpoint ? { state: checkpoint } : {}),
    } satisfies ActivityResume);
  }
  try {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceReuseWindow: true });
  } catch (error) {
    if (context && key) await context.globalState.update(key, undefined);
    throw error;
  }
  return true;
}

async function applyTestBackdoors(
  context: vscode.ExtensionContext,
): Promise<{ testStateFileFound: boolean; publishOverrides?: PublishOverrideSource }> {
  // Source 1: env vars (works when Playwright passes them through to the
  // extension host, which is inconsistent across VS Code versions).
  let token = process.env.HPS_TEST_TOKEN;
  let testStateFileFound = false;
  let coachName = process.env.HPS_TEST_COACH_NAME;
  let coachPersonality = process.env.HPS_TEST_COACH_PERSONALITY ?? "";
  let history: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; createdAt: number }> | undefined;
  let issuerToken = process.env.HPS_TEST_ISSUER_TOKEN;
  // One-click publish e2e: the mock GitHub's addresses and a fake gh. Read here because env
  // reaches the extension host inconsistently (see above); resolvePublishEndpoints still
  // refuses them outside a test/dev run and for non-loopback URLs.
  let publishOverrides: PublishOverrideSource | undefined;

  // Source 2: a JSON file the test fixture writes into the user-data-dir,
  // typically <userDataDir>/User/hps-test-state.json. Always wins over env
  // (file is more explicit + more reliable).
  try {
    const candidates = testStateCandidates(vscode.env.appName,
      path.join(context.globalStorageUri.fsPath, "..", "..", "..", "User", "hps-test-state.json"),
      path.join(os.homedir(), ".hps-test-state.json"),
    );
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        // Regardless of whether parsing succeeds, this is the "test run" marker —
        // the #580 spool gate ORs this flag with env (the file is a more trustworthy
        // channel than env).
        testStateFileFound = true;
        const j = JSON.parse(fs.readFileSync(f, "utf8")) as {
          token?: string;
          coach?: { name?: string; personality?: string };
          history?: typeof history;
          issuerToken?: string;
          publish?: PublishOverrideSource;
        };
        if (j.token) token = j.token;
        if (j.coach?.name) coachName = j.coach.name;
        if (j.coach?.personality) coachPersonality = j.coach.personality;
        if (Array.isArray(j.history)) history = j.history;
        if (j.issuerToken) issuerToken = j.issuerToken;
        if (j.publish && typeof j.publish === "object") publishOverrides = j.publish;
        break;
      }
    }
  } catch { /* ignore — file missing or unparseable */ }

  // Source 3: dev convenience. A manually-launched local build picks up the
  // token `scripts/dev-stack.sh` writes, so contributors don't paste it every
  // launch. Dev-gated:
  //   - only when proxyUrl points at a local worker (so a real workshop build
  //     never reads /tmp); AND
  //   - only when HPS_TEST_E2E is unset — the e2e fixture sets that flag so
  //     `preseedToken: false` actually produces a cold launch instead of
  //     getting silently filled in from the dev token file. Fix for #42.
  if ((!token || token.length === 0) && !process.env.HPS_TEST_E2E) {
    const proxyUrl = vscode.workspace
      .getConfiguration("hypeproofChat")
      .get<string>("proxyUrl", "");
    const isLocalDev = /\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(proxyUrl);
    if (isLocalDev) {
      const devTokenFile = process.env.HPS_DEV_TOKEN_FILE || "/tmp/hps-token.txt";
      try {
        if (fs.existsSync(devTokenFile)) {
          const t = fs.readFileSync(devTokenFile, "utf8").trim();
          if (t.length > 20) token = t;
        }
      } catch { /* ignore — best effort */ }
    }
  }

  if (token && token.length > 0) {
    try {
      await context.secrets.store(TOKEN_KEY, token);
    } catch {
      // A stale development seed must not prevent command registration or
      // the normal participation screen from opening. Never log the token.
      void vscode.window.showWarningMessage('개발용 참여 코드를 연결하지 못했습니다. 새 코드로 수업에 다시 참여해 주세요.');
    }
  }
  if (coachName && coachName.length > 0) {
    const coachInfo = { name: coachName, personality: coachPersonality, configured: true };
    // Legacy flat keys — kept for back-compat with pre-cohort-scoping builds.
    await context.globalState.update(LEGACY_COACH_KEY, coachInfo);
    await context.globalState.update(LEGACY_COACH_RITUAL_DONE_KEY, true);
    // Cohort-scoped keys — the runtime moved coach state to per-cohort buckets
    // (coachKeyForCohort) and only back-fills the legacy value via an async
    // migration that runs *after* the profile fetch resolves. On webview
    // "ready" postConfig can read the still-empty scoped key first, flashing
    // the naming ritual in front of a preseeded test (breaks preseedCoach on
    // the current extension). Writing the scoped keys directly here removes
    // that race. The cohort is read (unverified) from the seeded token.
    const cohortId = activityConnections(context)?.scope ?? extractCohortIdUnverified(token);
    if (cohortId) {
      await context.globalState.update(coachKeyForCohort(cohortId), coachInfo);
      await context.globalState.update(coachRitualDoneKeyForCohort(cohortId), true);
    }
  }
  // Pre-seed chat history so e2e tests can exercise preview / reload paths
  // without depending on a live LLM round-trip. Same legacy + cohort-scoped
  // dual-write as the coach state above (history moved to per-cohort buckets
  // with the same async migration race).
  if (history && history.length > 0) {
    await context.workspaceState.update(LEGACY_HISTORY_KEY, history);
    const cohortId = activityConnections(context)?.scope ?? extractCohortIdUnverified(token);
    if (cohortId) {
      await context.workspaceState.update(historyKeyForCohort(cohortId), history);
    }
  }
  // Pre-seed issuer token for mint-flow tests (G5/G6).
  if (issuerToken && issuerToken.length > 0) {
    await context.secrets.store(ISSUER_TOKEN_KEY, issuerToken);
  }
  // Dev-only issuer token auto-seed: only when localRuntimeConfig returns non-null (Dev app + dev
  // setting on) and HPS_TEST_E2E is unset. Release builds and Dev app with runtime off both skip.
  // localRuntimeConfig throws when Dev app has a remote proxyUrl or missing env — catch and skip.
  // Token value is never logged.
  const _devProxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
  let _devRuntimeActive = false;
  try {
    _devRuntimeActive = localRuntimeConfig(vscode.env.appName, _devProxyUrl) !== null;
  } catch { console.log("[hypeproof-chat] dev issuer seed skipped"); }
  if (_devRuntimeActive && !process.env.HPS_TEST_E2E) {
    const devIssuerTokenFile = process.env.HPS_DEV_ISSUER_TOKEN_FILE;
    if (devIssuerTokenFile) {
      try {
        if (fs.existsSync(devIssuerTokenFile)) {
          const t = fs.readFileSync(devIssuerTokenFile, "utf8").trim();
          if (t.length > 20) {
            await context.secrets.store(ISSUER_TOKEN_KEY, t);
          }
        }
      } catch { /* ignore — best effort */ }
    }
  }
  return { testStateFileFound, ...(publishOverrides ? { publishOverrides } : {}) };
}

export function deactivate() {
  workPower.dispose();
  providerRef = null;
  // #751 U1b — a normal shutdown ends the session with a `session_close` line, so a later collection can prove where it ended.
  // VS Code waits for this promise (bounded); a crash leaves the session without it, and that end stays unproven.
  const s = spoolRef; spoolRef = null;
  return s?.close("shutdown");
}

export { TOKEN_KEY };
