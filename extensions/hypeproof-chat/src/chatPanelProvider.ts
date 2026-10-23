import { AccuracyEducationStore } from "./accuracyEducationStore";
import { accuracyOffer, offerAccuracy, dismissAccuracy, type AccuracyOffer } from "./accuracyEducation";
import { showVisitorPreview } from "./visitorPreviewHost";
import { attemptGroups, attemptHistory, selectAttempt, visibleAttempts } from './answerAttempts';
import { lessonCapabilityEntryId, entryReceiptKey } from "./lessonCapabilityEntry";
import { PublishReadGate } from "./publishReadGate";
import { AnnotationBatch, AnnotationRefusal, ANNOTATION_LIMIT, ANNOTATION_REFUSAL, ANNOTATION_RETRY_DROPPED, recordAnnotations, withAnnotations } from "./annotationBatch";
import { runWorkTakeaway } from "./workTakeawayHost";
import { loadLedger, provenanceLedgerFile } from "./artifactProvenance";
import { takeawayTask, takeawayOwnedFiles } from "./workTakeaway";
import { workPower } from "./workPower";
import { ArtifactHistoryPanel } from './artifactHistoryPanel';
import { modelRefusalNotifier } from "./modelRefusalNotice";
import { denialNotice, denialNoticeLabel, storedDenialNotice, taggedDenialSource, type DenialNotice } from "./denialNotice";
import { activityFailure, type FailureEvidence } from "./activityAvailability.ts";
import { activityLocalFile } from "./activityLocalFiles.ts";
import { confirmOutbound, setOutboundPresenter } from "./outboundConsentHost";
import { OutboundApproval, type AnyOutboundPrompt } from "./outboundApproval";
import { contentBytes, observationOutboundItems } from "./outboundConsent";
import { ATTACHMENT_FAILURE_COPY, attachmentDisplayName, attachmentReadFailure, withAttachmentDeadline } from "./attachmentFailure";
import { focusDiagnosticLine, type FocusDiagnosticPhase } from "./focusDiagnostics";
import {localRuntimeConfig,localModelSelection,runLocalCoach} from './localRuntime';
import type { BrowserToolsForLocal } from './localRuntime';
import { FREE_DAILY_CAP_NOTICE, freeDailyCapReached, passSpentNotice, passesOnSale, trialEndNotice, trialEnding } from "./passPurchase";
import { endCardAdvertised, endCardCatalogue, notifyOptinOffered, trialEndCardView, trialEndReason } from "./trialEndCard";
import { openPersonalContinuation } from "./personalContinuationHost";
import { NOTIFY_OPTIN_ERRORS, notifySubmitted, plausibleEmail, setNotifySubmitted, submitNotifyOptin, withdrawNotifyOptin } from "./notifyOptin";
import { canonicalizeExistingPath, relativeEscapes } from "./workspaceRouting";
import { InstructorModeManager } from './chalk/instructorMode';
import { decideMode, profileFailureToStatus } from './chalk/modeDecision';
import { chalkToolsEnabled } from './chalk/tools';
import { runInstructorTurn, INSTRUCTOR_TOOL_PROFILE } from './chalk/instructorTurn';
import { ActivityConnectionError, activityConnections, canonicalRoot } from './activityConnections';
import { isProjectSwitchRequest, projectSwitchBrief } from "./publish/projectSwitch";

/** The first-turn note a project switch leaves for the folder it opens (takeProjectSwitchBrief). */
const PROJECT_SWITCH_BRIEF_KEY = "hps.projectSwitch.brief.v1";
const PROJECT_SWITCH_BRIEF_TTL_MS = 24 * 60 * 60_000;
import { emptyActivityDraft, preservedDraftContent, validActivityDraft } from './activityDraft';
import type { ActivityDraft } from './activityDraft';
import { requireTurnTools, turnToolsDenialSource, retryTurnToolMode, turnToolMode, TurnToolModeError, turnToolsAvailability, validTurnToolMode, WebSearchActivity, type TurnToolMode } from './turnTools';
import { folderConsentForFolder, folderConsentProfile, folderConsentState, folderNoAiRefusal, folderWriteRefusal, FolderConsentRefusal } from './folderConsentHost';
import { folderConsentApplies, canonicalFolder, folderNoAiCopy, folderShellRefusalNotice, folderShellUndecidedNotice } from './folderConsent';
import { missingTaskFolder, missingTaskFolderNotice, repickedFolder, MISSING_TASK_FOLDER_FAILED, MISSING_TASK_FOLDER_NO_AI, MISSING_TASK_FOLDER_NOT_A_FOLDER, MISSING_TASK_FOLDER_PICK_LABEL, MISSING_TASK_FOLDER_PICK_TITLE, MISSING_TASK_FOLDER_UNDECIDED } from './missingTaskFolder';
import { chatVisible, createFinishNotifier, watchChatSurface } from './finishNoticeHost';
import { TURN_SETTLING_REFUSAL, turnSettleSignal, waitAtMost } from './turnSettle';
import { verifyActivity } from './proxyClient';
import { fetchAccessView, sendBudgetRequest, accessProfile, type AccessState } from './accessClient';
import { availableModelSelection, selectedModel, modelSelectionScope, type SavedModelChoice, selectedEffort, observedEffortResult, type SavedEffortChoice } from './modelSelection';
import { modelEchoVerdict, modelEchoNotice, describeModelEcho, type ModelEchoInput } from './modelEchoHelpers';
/** Everything except the part that changes per turn — `resolved` is filled in when the response arrives. */
type ModelEchoContext = Omit<ModelEchoInput, 'resolved'>;
import * as vscode from "vscode";
import * as path from "path";
import * as os from "node:os";
// hype-dental D-028 — photos attached as files: staged until sent, then moved into images/.
import { ImageStaging, stagingRootFor, attachedImageRefusal, attachedImageExt, safeAttachedImageName, attachedImagesNote, attachedImagesSavedLabel, attachedImagesFailedLabel, ATTACHED_IMAGE_DIR } from "./attachedImages";
import { imagePathsFromNotes, selectReferencedImagePaths, readWorkspaceReferenceImages, referenceImageFailuresNote } from "./referenceImages";
import { selectedExternalInstructions } from "./externalSkillCommands";
import { runImageEdit, selectedImageEditContext } from "./imageEditCommands";
import * as fs from "fs";
import {createHash} from 'node:crypto';
import { TaskWorkspaceStore, TaskWorkspaceStoreError } from './taskWorkspaceStore';
import { APPROVAL_PLACEHOLDER, approvalChoices, approvalMessage, approveArtifact } from "./artifactApproval.ts";
import {NativeObservationRecorder} from './nativeObservationRecorder';
import {OBSERVATION_FORMATS, validateFindings, validateObservation, asCapabilityModel, type ObservationBatch} from './nativeObservationContract';
import {acceptSubmit, learningEventRequest, learningState, type CompletionItem} from './learningStateHelpers';
import {FlowSession, flowErrorCode, flowLessonOf, flowNotice, learningTaskIdOf, runTaskFlowOn, runsTaskFlow, screenFlow, taskRecordIdOf, type FlowLesson, type FlowOutcome, type FlowSignal, type ShownFlow} from './taskFlowHelpers';
import {observationHeaders} from './proxyClientHelpers.ts';
import { TOKEN_KEY, resolveWorkspaceRoot } from "./extension";
import { ISSUER_TOKEN_KEY } from "./mintStudentTokenHelpers";
import { proxyChat, fetchProfileResult, ProxyAuthError, ProxyTransportError } from "./proxyClient";
import { helpLinesEnabled, moderationBlockOf, ModerationBlockError, safetyNoticeView } from "./safetyNotice.ts";
import { TOKEN_MISSING_FRIENDLY, buildProxyHeaders, lessonBindingHeader, paidPassEndNotice, type ProfileFailure } from "./proxyClientHelpers";
import { resolveSdkBinaryForHost, runSdkCoach, SdkGatewayAuthError, SdkUnavailableError, type BrowserMcpHost } from "./sdkCoach";
import { fetchSdkSeed } from "./sdkSeedFetch";
import { sdkSeedOfferDecision, sdkSeedOnDemandEnabled, sdkSeedPlatformKey, sdkSeedUrls } from "./sdkSeedHelpers";
import { SDK_BINARY_MANIFEST } from "./sdkBinaryManifest";
import { SdkRequiredError, sdkUnavailableOutcome } from "./sdkRequiredHelpers";
import { acceptFocus, acceptWork, rehearsalReport, turnLesson, workContext, type LessonFocus, type StepWork } from "./lessonFocus";
import { GOAL_REFUSAL_SENTENCES, STUDENT_GOAL_KEY, acceptGoalSave, goalRequestIdOf, goalViewOf } from "./studentGoal";
import { REFUSAL_COPY, bindingRefusalCode, candidateMatches, closeTurn, fetchTurnState, planPreflight, refusedTurnEnding, shouldRecheckEnforcement, tokenLessonSha } from "./lessonBinding";
import {
  coachSeatKeyFor,
  sdkErrorDisplayText,
  sdkToolToActionRequest,
  seededSdkBinaryPath,
  summarizeToolInput,
  withCoachSeatLock,
} from "./sdkCoachHelpers";
import { describeCommandForApproval, shellApprovalFor } from "./shellPolicy";
import { shellAllowedByFolderConsent, TASK_COMMAND_ALLOW_LABEL, TaskCommandAllows, taskCommandAllowScopeKey, taskCommandExact } from "./taskCommandAllow";
import { curriculumBase, extractTitle, galleryPublishAllowed, publishWorldConfirmed, resolveSiteBase, type GalleryRecord } from "./galleryPublish";
import { readSessionSnapshot, sendSessionSnapshot, snapshotItems, snapshotRecipient } from "./spoolUploader";
import { PublishSession } from "./publishSession";
import { EvidenceSession } from "./evidenceSession";
import { MemorySession } from "./memorySession";
import { SkillSession, completeSkillRequest, type SkillCompletion } from "./skillSession";
import { answerPromptSources, answerProposal, answerSources, applyWikiProposal, archiveNotes, brainIntent, brainIntro, brainName, brainSummary, coachContext, defaultIngestSession, firstCoachTurn, ingestReport, initWiki, josa, jsonFromText, loadState, newState, productTitle, proposalPreview, readNotes, renderWikiPages, ro, saveState, sessionCount, sessionFocus, sessionHash, sessionLabel, turnsFromEvents, wikiDir, wikiPrompt, writeFiles, writeWiki, type BrainIntent, type LearningWikiPlan, type WikiProposal, type WikiState } from "./learningWiki";
import { applyDeckProposal, applySlideText, deckPrompt, deckReport, deckRepairPrompt, refusedSlides, renderDeck, slideTextItems, type DeckProposal, type DeckRun } from "./deckGenerator";
import { applyHumanized, humanizePrompt, type HumanizeProposal } from "./humanizer";
import { ReviewSession, directorAvailable } from "./reviewSession";
import { qrDataUrl } from "./testQr";
import {
  originOfUrl,
  planCoachBrowserTabs,
  coachTabSlot,
  isSameBrowserUrl,
  resolveLivePreviewUrl,
  pickRevealTabIndex,
  browserTabCoverage,
  toProxyToolResult,
  isLoopbackUrl,
} from "./browserControlHelpers";
import { isCurriculumRuntimeEnabled, isCrVerifyTool, CR_CONTEXT_KEY, CR_DIRECTOR_CONTEXT_KEY, CR_DIRECTOR_REPROBE_MS } from "./curriculumRuntime";
import { VerifySession, recordChecked, refusalText, verifyContext, verifyToolResult, type VerifyRecorderPort } from "./verifySession";
import { artifactVersionFor } from "./artifactVersion";
import type { ElementContext } from "./elementPick";
import { checkAgentOrigin } from "./experimentBrowser";
import {
  crContextKeyValue,
  ElementQueue,
  SdkCrResults,
  withElementText,
  turnImages,
  recordProxyCrResult,
  recordElementCapture,
  proxyTurnBrowser,
  crResultHistory,
  crResultEntries,
  assessmentBatch,
  roomGuardedSink,
  crResultsMenu,
  clearStoredResults,
  CR_BYTES_CONTEXT_KEY,
  CR_BYTES_OWNERS_STATE,
  CR_PROJECTS_STATE,
  CrProjectMemory,
  crAllowedOrigins,
  crBytesOwner,
  crBytesOwnersAfter,
  type BlobSink,
} from "./crHostWiring";
import { FileRecordStorage, LOCAL_RECORD_DIR } from "./localRecordFile";
import { LocalRecord } from "@hypeproof/measurement-core/local-record";
import {
  toMcpToolResult,
  BROWSER_OPEN_TOOL_DEF,
  LIVE_PREVIEW_START_TOOL_DEF,
  runBrowserOpen,
  runLivePreviewStart,
  SiteCheckViewports,
} from "./browserMcp";

// #525 — a plain editor command registered in the core. The browser-only API cannot
// bring a tab to the front (BrowserTab has no show()/reveal()), so this path is used
// instead. `openEditorAtIndex` opens by 0-based index within the **active group**
// (core editorCommands.ts) — which is why activating the group comes first.
/** The `/1` key is kept byte-for-byte and only `/2` uses a different slot. See the comment above. */
const observationKey = (b: {format?: string; scope: string; program: string}) =>
  'hps.observation.'+(b.format === 'hps-observation/2' ? '2' : '1')+'.'+b.scope+'.'+b.program;

const FOCUS_FIRST_GROUP = "workbench.action.focusFirstEditorGroup";
const FOCUS_SECOND_GROUP = "workbench.action.focusSecondEditorGroup";
const OPEN_EDITOR_AT_INDEX = "workbench.action.openEditorAtIndex";

// Instructor-mode browser tool definitions — use the canonical defs from browserMcp.ts
// so the description and inputSchema stay in sync with the student SDK path.
const INSTRUCTOR_LOCAL_BROWSER_DEFS = [LIVE_PREVIEW_START_TOOL_DEF, BROWSER_OPEN_TOOL_DEF] as const;
import { PreviewProvider, sanitizeQuestResult } from "./previewProvider";
import {
  matchWorldRef,
  isGuestListRequest,
  guestListMessage,
  WORLD_ARCHIVE_DIR,
  worldArchiveFileName,
  worldArchiveTitle,
  shouldArchiveWorld,
  worldEngineUrls,
  openWorldNotice,
  isWorldCohort,
  openWorldKeyForCohort,
} from "./chatPanelHelpers";
import {
  approvalCopyFor,
  approvalFallbackTitle,
  asSubject,
  browserApprovalTitle,
  coachDegradedNotice,
  pageAttachedNotice,
  profileNotReadyNotice,
  shellApprovalTitle,
} from "./coachIdentity.ts";
import { isFreeSeat, profileAudience, seatAudience, type SeatAudience } from "./seatVocabulary.ts";
import { classifyDenial, denialCopy, lessonFeatureOff } from "./denialSource.ts";
// A5 (ADR 0011) — the front-line orchestrator's panel side: the switch, the roster's labels,
// the seat's session and the host arguments runSdkCoach takes.
import { resolveOrchestrator, type OrchestratorEvent, type OrchestratorHostArgs } from "./orchestratorSurfaces";
import { agentLabel, rosterAgent, type ServedRoster } from "./agentRoster";
import { OrchestratorSession } from "./consultTool";
import { adultArchiveTimelineLabel, archiveBeforeOverwrite } from "./adultArchive";
import { artifactHistoryStore, captureArtifactVersion, reviewTurnFiles, listRestorePoints, restoreArtifactVersion, changeCount, diffRestorePoint, dropRestorePoint, restoreToPoint, scanFolder, takeRestorePoint, turnRestoreStoreDir, type RestoreManifest } from "./turnRestore";
import { ArtifactProvenanceRecorder, noteHostWrite, setHostWriteSink, type HostWriteActor } from "./artifactProvenance";
import type { TurnReviewView } from "./turnReviewView";
import { buildPageCard, handlePageCardAction, PageCardRegistry, type PageCardMessage } from "./pageCardHost";
import type { StudentGoalView } from "./studentGoal";
import { CdpSession } from "./cdpSession";
import { LiveServer } from "./liveServer";
import { recoverLearnerPreview, isLoopbackPreview, previewPagePath, type ArtifactState, type PreviewTabsState } from "./previewRecovery";
import { browserRememberLabel, browserTargetDetail } from "./browserTargetHost";
import { WriteApprovalRequest } from "./writeApprovalPrompt";
import { writePathLine, writePathEntries, writeTargetsFromPayload, type WritePathEntry } from "./writeApprovalPaths";
import { measurePreview, probePreviewPage, runPreviewRecoveryAction, type PreviewSignals } from "./previewFailure";
import { BrowserControl, type BrowserToolCall, type CrBrowserOptions } from "./browserControl";
import { linkSafety, resolveBrowserSafety, routeExternalLink } from "./browserSafetyHelpers";
import { reduceMotionForced, withReducedMotionAttr } from "./motionPreference";
import { normalizeTextSize, TEXT_SIZE_KEY } from "./textSize";
import { CapabilityChangeTracker, seatAiCapabilities, type SeatInputs } from "./capabilityChange";
import { buildPageAttachment, type PageAttachmentPreview } from "./pageContext";
import { fileAttachAllowed, readWorkspaceTextFile, FILE_REFUSAL_COPY, FILE_RETRY_NOTICE, ASK_ABOUT_FILE_CONTEXT_KEY } from "./fileAttachment";
import { addMaterialFile, checkMaterialUrl, listMaterialFolder, loadManifest, materialsManifestFile, materialsView, saveManifest, selectedMaterialsText, unavailableSelected, withLearnerItem, withoutItem, MATERIALS_COPY, MATERIALS_MAX_SELECTED, type MaterialsView } from "./activityMaterials";
import { classUpdateHold } from "./updateCheckerHelpers";
import { extractAgentMd } from "./agentHandoff";
import { compactionLineId, CONTEXT_COMPACT_NOTE, trimBoundaryId } from "./contextTrim";
import { DELEGATION_ICON, DelegationTracker, delegationHeader, delegationResultLabel, NO_ANSWER_REASON, TURN_FAILED_REASON } from "./delegationRow";
import {
  clampTimeline,
  emptyTimeline,
  modelHistory,
  timelineDelta,
  timelineEnd,
  timelineStart,
  timelineTool,
  type TimelineState,
  type ToolEntry,
} from "./chatTimeline";
import { editResendPayload, latestUserTurn, modelConversation, validEditTarget, versionCount } from "./editResend";
import { parseVerdictRequest, promptIdFor, verdictTargets, type VerdictEvent } from "./answerVerdict";
import { capturePageContext } from "./nativeBrowser";
import { isGeneralBrowserOpenRequest } from "./browserIntent";
import { validateAndRepairHtml, type HtmlStructureResult } from "./htmlStructure";
import {
  PASTED_IMAGE_DIR,
  parsePastedImage,
  pastedImageFailureLabel,
  pastedImageName,
  pastedImageNote,
  pastedImageSavedLabel,
} from "./pastedImages";
import {
  ChatMessage,
  CoachInfo,
  HostMessage,
  ResolvedProfile,
  WebviewMessage,
  ActionRequest,
} from "./protocol";
import { applyCarryoverDecision, carryoverAdvertised, carryoverState, type CarryoverStores } from "./trialCarryoverHelpers";
import { carryoverStoresFor, taskWorkspaceRoot, taskWorkspaceScope } from "./trialCarryoverSource";
import {
  isShowIntent,
  clampHistory,
  HISTORY_MAX,
  sanitizeCoachInput,
  abortAllStreams,
  resolveCoach,
  labelsForProfile,
  LEGACY_HISTORY_KEY,
  LEGACY_COACH_KEY,
  LEGACY_COACH_RITUAL_DONE_KEY,
  HISTORY_MIGRATION_DONE_KEY,
  COACH_MIGRATION_DONE_KEY,
  historyKeyForCohort,
  coachKeyForCohort,
  coachRitualDoneKeyForCohort,
  stateBucketId,
  extractCohortIdUnverified,
  decodeTokenPayloadUnverified,
  browserToolLogLine,
  AiDisclosureGate,
  sdkFallbackLogLine,
  resolveCoachRuntime,
  classifyTurnError,
  sdkTurnEndFailure,
  lessonStepSignal,
  pendingCloseLabel,
  WRITE_TOOL_NAMES,
  resolveInstructorTokenFromSecrets,
} from "./chatPanelHelpers";
import { buildChatPanelCsp } from "./cspBuilder";
import { toolActivityMode, workPhrase, WorkLine, THINKING_PHRASE, NEXT_STEP_PHRASE, PREVIEW_PHRASE } from "./toolActivity";
import { StepLines } from "./longStepHint";
import {
  SessionSpool,
  spoolIdentityFromToken,
  traceMsgToWorkflowRecord,
  type SpoolArtifactSource,
} from "./sessionSpool";
import type { ProxyStreamUsage } from "./proxyClientHelpers";
import { SitePublisher, SITE_PUBLISH_CONTEXT_KEY } from "./publish/publishHost";
import type { PublishEndpoints } from "./publish/publishConfig";
import { sitePublishAllowed, type AccessCheck } from "./publish/publishContract";
import { nextFreeFolder } from "./publish/githubContinue";
import type { GithubContinueSource } from "./startPage";
import { isMinorProfile } from "./sdkCoachHelpers";
import type { QuitGuardActivity } from "./quitGuardHelpers";
import { FunnelReporter, entryOutcome, funnelOs, funnelProfileStep, funnelToolKind, isTrialGrantToken, parseTrialEventsProbe, trialEventsUrl, usesTraceRoute, type ToolResultKind } from "./funnelEvents";
import {
  ArtifactChangeGate,
  startHeartbeat,
  type HeartbeatPinger,
  type LivenessEvent,
} from "./heartbeat";

/**
 * Approval modal copy. It says in Korean what is about to happen, per `kind`, and the
 * confirm button is the verb of that action — `저장`/`위임` makes what is being
 * approved clearer than `Approve` does. Cancel is not written here: VS Code always
 * adds it.
 *
 * #747 — the titles live in `coachIdentity.approvalCopyFor(name)` and are built
 * from the resolved AI name (lesson-fixed, student-chosen, or "코치"). With the
 * default name they are byte-identical to the previous literals here.
 */


/** #751 U3 — what the webview said was imported, reduced to the two fields the record keeps. Anything malformed is dropped. */
function promptRefs(raw: unknown): Array<{ object_id: string; revision: number }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((r) => r && typeof r.object_id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(r.object_id) && Number.isSafeInteger(r.revision) && r.revision > 0).slice(0, 8).map((r) => ({ object_id: r.object_id as string, revision: r.revision as number }));
  return out.length ? out : undefined;
}
/** #751 U3 — the switch was recorded but the new profile could not be verified: the turn is not sent, the input is returned. */
class LessonBindingPreflightError extends Error {}

/** What one 팀 브레인 run tells the student (one short sentence per line) and the page to open when it worked. */
interface BrainRun { lines: string[]; open?: string }

// ── The front-line orchestrator, panel side (A5; ADR 0011, spec §5.1, §5.2, §6.3) ──
// Pure (no vscode), exported for test/orchestrator-panel.smoke.mjs. Without a roster this
// seat may use, every one of them answers "off", and the panel does what it did before A5.

/**
 * The served roster this seat runs under, or null: an older Service, the cohort's flag off,
 * the header-less answer, a minor or unknown tier, or a roster the parser refuses. The same
 * switch runSdkCoach uses (A4 resolveOrchestrator); the host arguments are this panel.
 */
export function orchestratorRosterFor(profile: ResolvedProfile | null | undefined): ServedRoster | null {
  const resolved = resolveOrchestrator(profile, {});
  return resolved.on ? resolved.roster : null;
}

/**
 * The modal a machine that lists `consultHelper` in requireApprovalFor shows (spec §5.1): who is
 * asked, on which model, the question, and what the helper can and cannot do. Without that
 * setting a consult never reaches it.
 */
export function consultApprovalCopy(
  coachName: string,
  roster: ServedRoster | null,
  payload: unknown,
): { message: string; verb: string } {
  const p = payload && typeof payload === "object" ? (payload as { agent?: unknown; question?: unknown }) : {};
  const name = typeof p.agent === "string" ? p.agent.trim().slice(0, 40) : "";
  const agent = roster && name ? rosterAgent(roster, name) : undefined;
  const who = agent ? agentLabel(agent) : name || "도우미";
  const question = typeof p.question === "string" ? p.question.trim().slice(0, 400) : "";
  return {
    message:
      `${asSubject(coachName)} 도우미에게 물어보려고 해요:\n\n` +
      `${who}${question ? `에게: ${question}` : ""}\n\n` +
      "도우미는 대화 기록 없이 작업 파일의 일부만 보고, 파일을 고치지 않아요.",
    verb: "묻기",
  };
}

function withoutIcon(label: string, icon: string): string {
  return icon && label.startsWith(icon) ? label.slice(icon.length).trimStart() : label;
}

/**
 * The timeline line an orchestrator event becomes (spec §5.2), or null for one the learner is
 * not shown. Quiet by default: one line per consult (running → done | error, in place), one
 * line per page per turn for the site check (the latest verdict, in place), one per archive,
 * and the busy notice. The diff summary goes to the coach only (A4 D13). A4 builds each label
 * with its icon in front; the line draws the icon itself, so it is taken off the label.
 */
export function orchestratorToolEntry(event: OrchestratorEvent, turnId: string): ToolEntry | null {
  const at = typeof event.at === "number" && Number.isFinite(event.at) ? { at: event.at } : {};
  if (event.kind === "notice") return { id: event.id, icon: "⏳", label: event.text, state: "done", ...at };
  if (event.kind === "consult") {
    return { id: event.id, icon: event.icon, label: withoutIcon(event.label, event.icon), state: event.state, ...at };
  }
  if (event.name === "diff") return null;
  if (event.name === "site_check") {
    // `done` whatever the verdict (spec §5.2's table): the check ran, and the label says what it
    // found, 통과 or 넘침 or 미확인 — never a pass it did not measure. The error state is for a line
    // the learner must act on (#746 B4); a failing page is the coach's to fix.
    return {
      id: `check:site_check:${turnId}:${event.path}`,
      icon: event.icon,
      label: withoutIcon(event.label, event.icon),
      state: "done",
      ...at,
    };
  }
  return { id: event.id, icon: event.icon, label: withoutIcon(event.label, event.icon), state: "done", ...at };
}

/** The learner's own goal for this lesson revision, as a consult may attach it (`learner_goal`). */
export function learnerGoalText(view: StudentGoalView | null | undefined): string | null {
  const goal = view?.goal?.trim();
  if (!goal) return null;
  const criteria = (view?.criteria ?? []).map((c) => c.trim()).filter(Boolean);
  return criteria.length ? `${goal} (완료 기준: ${criteria.join(" · ")})` : goal;
}

/**
 * What runSdkCoach takes as `orchestrator` (A4 OrchestratorHostArgs): this seat's session, the
 * timeline, and the learner's goal. Passing it is the panel saying it runs the orchestrator;
 * runSdkCoach still turns it on only for a seat the served roster is on for.
 */
export function orchestratorHostArgs(deps: {
  session: OrchestratorSession;
  turnId: string;
  post: (entry: ToolEntry) => void;
  learnerGoal: () => string | null;
}): OrchestratorHostArgs {
  return {
    session: deps.session,
    onEvent: (event) => {
      const entry = orchestratorToolEntry(event, deps.turnId);
      if (entry) deps.post(entry);
    },
    learnerGoal: deps.learnerGoal,
  };
}

/** The director overview did not open: no instructor token, the Service said no, or it did not answer (source unknown). */
const DIRECTOR_REVIEW_UNAVAILABLE = denialCopy({ source: "unknown", feature: "주간 리뷰 디렉터 화면", reason: "강사 토큰이 없거나, 서비스가 이 화면을 열어 주지 않았어요", next: "강사 토큰을 확인한 뒤 다시 열어 보세요" });

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private effortNotice?: string;
  /** #897 H-13 — has the model-substitution notice already been attached to this turn? One turn per seat (REQ-M37 ③). */
  private modelNoticeTurn?: string;
  private effortScope?: string;
  private effortResult?: import('./protocol').ChatConfig['effortResult'];
  private effortTurn?: { id: string; url: string; token: string; scope: string };
  /**
   * A5 — the orchestrator session of the seat this window runs (spec §3.2: uses per session,
   * the last check of each page, failure events). Another seat starts a new one, and so does
   * "대화 지우기". The Service keeps its own per-session cap either way.
   */
  private orchestratorState?: { seatKey: string; session: OrchestratorSession };
  private orchestratorSessionFor(seatKey: string): OrchestratorSession {
    if (this.orchestratorState?.seatKey !== seatKey) this.orchestratorState = { seatKey, session: new OrchestratorSession() };
    return this.orchestratorState.session;
  }

  private async refreshEffortResult(): Promise<void> {
    const turn = this.effortTurn;
    if (!turn) return;
    let result: import('./protocol').ChatConfig['effortResult'] = {state:'unknown',requests:[]};
    try {
      const response = await fetch(`${turn.url.replace(/\/$/,'')}/request-settings/${encodeURIComponent(turn.id)}`, {
        headers:{authorization:`Bearer ${turn.token}`}, signal:AbortSignal.timeout(5000),
      });
      if (response.ok) {
        result = observedEffortResult(await response.json());
      }
    } catch { /* Retrieval cannot fail the conversation; unknown stays visible. */ }
    if (this.effortTurn !== turn || await this.context.secrets.get(TOKEN_KEY) !== turn.token) return;
    this.effortResult = result;
    await this.postConfig();
  }

  private attemptWrite?: Promise<void>;
  private nativeObservation: NativeObservationRecorder | null = null;
  private nativeHistoryScope: string | null = null;
  private taskWorkspace?: { activityId: string; store: TaskWorkspaceStore };
  /** Failed turns are not in durable history yet; keep only bounded, task-bound retry metadata. */
  private turnRequests = new Map<string, { scope: string; message: ChatMessage }>();
  private turnRequestScope(): string {
    return JSON.stringify([activityConnections(this.context)?.scope ?? this.nativeHistoryScope ?? '', this.currentTaskStore?.()?.getView().activeTaskId ?? null]);
  }
  private retryMessages(): ChatMessage[] {
    const scope = this.turnRequestScope();
    return [...this.getHistory(), ...[...(this.turnRequests ?? new Map()).values()].filter(value => value.scope === scope).map(value => value.message)];
  }
  private rememberTurnRequest(text: string, mode: TurnToolMode, id?: string, retrySourceId?: string, editOf?: string): string {
    if (id !== undefined && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new TurnToolModeError('요청 식별자를 확인할 수 없습니다. 입력은 그대로 보관됩니다.');
    const userId = id ?? randomId();
    const previous = this.retryMessages().find(message => message.id === userId);
    if (previous && (retrySourceId !== userId || previous.content !== text || turnToolMode(previous.toolMode) !== mode)) throw new TurnToolModeError('이미 보낸 요청입니다. 원래 요청의 다시 보내기를 사용해 주세요.');
    this.turnRequests ??= new Map();
    this.turnRequests.set(userId, { scope: this.turnRequestScope(), message: { id: userId, role: 'user', content: text, createdAt: Date.now(), toolMode: mode, ...(editOf ? { editOf } : {}) } });
    while (this.turnRequests.size > 64) this.turnRequests.delete(this.turnRequests.keys().next().value!);
    return userId;
  }
  /**
   * CGP-CHAT-R-002 — the prompts an edit may target: the saved conversation plus a failed request
   * newer than it (failed turns are not saved, but their bubble is the latest one on screen).
   */
  private editableHistory(): ChatMessage[] {
    const history = this.getHistory();
    const ids = new Set(history.map(message => message.id));
    const lastSaved = latestUserTurn(history)?.message.createdAt ?? -1;
    const scope = this.turnRequestScope();
    const failed = [...(this.turnRequests ?? new Map()).values()]
      .filter(value => value.scope === scope && !ids.has(value.message.id) && value.message.createdAt > lastSaved).map(value => value.message);
    return [...history, ...failed.slice(-1)];
  }
  /** Refuses an edit of anything but the latest prompt group, and any edit from instructor mode. */
  private requireEditTarget(editOf: unknown): void {
    if (this._instructorMode.isInstructor || !validEditTarget(visibleAttempts(this.editableHistory()).items, editOf)) {
      throw new TurnToolModeError('마지막으로 보낸 메시지만 고칠 수 있어요. 고친 내용은 입력창에 남겨 두었어요.');
    }
  }
  private interruptedHistory?: { scope: string; messages: ChatMessage[] };
  private interruptedHistoryError(): string | null {
    return this.interruptedHistory?.scope === this.turnRequestScope()
      ? '받은 대화를 저장하지 못했습니다. 이 화면을 닫기 전에 필요한 내용을 복사해 주세요.' : null;
  }
  private async retryInterruptedHistory(): Promise<void> {
    const pending = this.interruptedHistory;
    if (!pending || pending.scope !== this.turnRequestScope()) return;
    try { await this.appendHistory(pending.messages); }
    catch { throw new Error(this.interruptedHistoryError()!); }
    if (this.interruptedHistory === pending) {
      this.interruptedHistory = undefined;
      await this.post({ type: 'taskWorkspaceError', error: null, historySaveFailed: true });
    }
  }
  private taskChanging = false;
  private sourceOpening?: string;
  /** Only this flow's tab can be reused/replaced; user-navigated or foreign tabs are left alone. */
  private taskSourceBrowser?: { tab: vscode.BrowserTab; taskId: string; activityId: string; url: string; requestId?: string; source?: vscode.Webview };


  private currentTaskStore(): TaskWorkspaceStore | undefined {
    return this.taskWorkspace?.activityId === activityConnections(this.context)?.scope ? this.taskWorkspace?.store : undefined;
  }

  private async prepareTaskWorkspace(isInstructor: boolean): Promise<void> {
    const activity = activityConnections(this.context)?.current;
    if (!activity || isInstructor || !['trial', 'personal'].includes(activity.kind ?? '')) { this.taskWorkspace = undefined; return; }
    if (this.taskWorkspace?.activityId === activity.id) return;
    const store = new TaskWorkspaceStore(taskWorkspaceRoot(this.context.globalStorageUri.fsPath), taskWorkspaceScope(activity));
    this.taskWorkspace = { activityId: activity.id, store };
    try {
      await store.initialize(this.context.workspaceState.get<ChatMessage[]>(this.historyKey(), []), this.context.workspaceState.get('hps.activity.draft.' + activity.id, emptyActivityDraft()));
    } catch {
      // The error view is shown, and sends are blocked. Never replace unreadable history.
    }
  }

  private async handleTaskMessage(msg: WebviewMessage, source?: vscode.Webview): Promise<void> {
    const store = this.currentTaskStore?.();
    if (!store) return;
    const before = store.getView();
    if (!msg.taskId || msg.taskId !== before.activeTaskId || this.taskChanging) return;
    const knownSource = (value: string) => {
      try {
        const url = new URL(value);
        return typeof value === 'string' && value.length <= 8192 && value === value.trim() && !/[\u0000-\u0020\u007f]/.test(value) && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && store.getHistory().some(message => message.citations?.some(citation => citation.url === value));
      } catch { return false; }
    };
    try {
      if (msg.type === 'taskOpenSource') {
        if (!knownSource(msg.url)) throw new Error('이 작업에서 확인한 출처를 선택해 주세요.');
        if (msg.requestId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(msg.requestId)) throw new Error('출처 요청을 확인할 수 없습니다. 다시 선택해 주세요.');
        if (this.sourceOpening) throw new Error('이전 출처를 여는 중입니다. 잠시 뒤 다시 시도해 주세요.');
        const opening = msg.requestId ?? randomId();
        this.sourceOpening = opening;
        const activityId = activityConnections(this.context)?.scope ?? '';
        const stillCurrent = () => this.currentTaskStore?.() === store && store.getView().activeTaskId === msg.taskId && activityConnections(this.context)?.scope === activityId && !this.taskChanging;
        try {
          const previous = this.taskSourceBrowser;
          const owned = previous && previous.taskId === msg.taskId && previous.activityId === activityId && previous.tab.url === previous.url && (vscode.window.browserTabs ?? []).includes(previous.tab) ? previous : undefined;
          let tab: vscode.BrowserTab;
          if (owned?.url === msg.url) { tab = owned.tab; await this.revealBrowserTab(tab); }
          else tab = await vscode.window.openBrowserTab(msg.url, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
          if (!stillCurrent()) {
            if (tab !== owned?.tab && tab.url === msg.url) await Promise.resolve(tab.close()).catch(() => {});
            return;
          }
          this.taskSourceBrowser = { tab, taskId: msg.taskId, activityId, url: msg.url, requestId: msg.requestId, source };
          if (owned && owned.tab !== tab && owned.tab.url === owned.url) await Promise.resolve(owned.tab.close()).catch(() => {});
          if (msg.requestId) await this.post({ type: 'sourceOpenResult', requestId: msg.requestId, taskId: msg.taskId, activityId, url: msg.url, opened: true });
        } finally { if (this.sourceOpening === opening) this.sourceOpening = undefined; }
      } else if (msg.type === 'taskReturnFromSource') {
        const opened = this.taskSourceBrowser;
        if (!knownSource(msg.url) || !opened || opened.requestId !== msg.requestId || opened.url !== msg.url || opened.taskId !== msg.taskId || opened.activityId !== activityConnections(this.context)?.scope || opened.source !== source) throw new Error('이 작업에서 연 출처로 돌아가 주세요.');
        // Reveal the initiating chat surface, then let its exact citation restore focus.
        // Do not use focusEditor(): its focusInput message would steal the citation focus.
        if (source && source === this.editorChat?.webview) this.editorChat.reveal(vscode.ViewColumn.One);
        else if (source && source === this.view?.webview) await vscode.commands.executeCommand('hypeproof-chat.panel.focus');
        else throw new Error('대화 화면을 찾지 못했습니다. 현재 작업을 다시 열어 주세요.');
        if (this.currentTaskStore?.() !== store || store.getView().activeTaskId !== msg.taskId) return;
        await this.post({ type: 'sourceReturn', requestId: msg.requestId, url: msg.url, taskId: msg.taskId, activityId: opened.activityId });
      } else if (msg.type === 'taskSourceSelection') {
        if (!knownSource(msg.selection.url)) throw new Error('이 작업에서 확인한 출처를 선택해 주세요.');
        await store.saveSurface(msg.taskId, msg.selection);
      } else {
        if (this.hasActiveStream() || this.verifySession?.running || this.connectionChanging || this.clearingHistory) {
          // Stop hides the control immediately, while the aborted transport may still be settling.
          const settlingStoppedResponse = this.activeStreams.size > 0
            && [...this.activeStreams.values()].every(controller => controller.signal.aborted)
            && !this.verifySession?.running && !this.worldOpening && !this.observationAssessment
            && !(this.pendingApprovals?.size ?? 0) && !this.connectionChanging && !this.clearingHistory;
          throw new Error(settlingStoppedResponse
            ? '중단한 응답을 정리하고 있어요. 잠시 후 다시 시도해 주세요. 작성 중인 내용은 유지됩니다.'
            : '진행 중인 작업을 멈춘 뒤 다시 시도해 주세요.');
        }
        this.taskChanging = true;
        try {
          if (source) this.draftSource = source;
          let recoveryDraft: ActivityDraft | undefined;
          await this.setConnectionChanging(true, msg.type === 'taskRecoverDraft' ? draft => { recoveryDraft = draft; } : undefined);
          if (this.currentTaskStore?.() !== store || store.getView().activeTaskId !== msg.taskId) throw new Error('열린 작업이 바뀌었습니다. 현재 작업에서 다시 시도해 주세요.');
          await this.retryInterruptedHistory();
          const expected = { taskId: msg.taskId, revision: store.getView().revision };
          if (msg.type === 'taskCreate') await store.create('새 작업', expected);
          else if (msg.type === 'taskRecoverDraft') {
            if (!recoveryDraft) throw new Error('현재 입력을 확인하지 못했습니다. 이 창을 유지하고 다시 시도해 주세요.');
            await store.recoverDraft(msg.taskId, recoveryDraft);
          }
          else if (msg.type === 'taskSelect') await store.select(msg.id, expected);
          else if (msg.type === 'taskRename') await store.rename(msg.taskId, msg.title);
          this.orchestratorState = undefined;
          // CGP-AGENT-R-004 — "이번 작업 동안" ends with the task.
          if (msg.type === 'taskCreate' || msg.type === 'taskSelect') this.endTaskCommandAllows();
          // CGP-ART-R-007 — queued page text belongs to the conversation it was attached in.
          if ((msg.type === 'taskCreate' || msg.type === 'taskSelect') && this.pendingPageAttachment) this.clearPageAttachment();
          // CGP-CHAT-R-011 — so does an attached work-folder file.
          if ((msg.type === 'taskCreate' || msg.type === 'taskSelect') && this.pendingFileAttachment) this.clearFileAttachment();
          await this.postConfig();
          await this.postHistory();
        } finally {
          this.taskChanging = false;
          await this.setConnectionChanging(false);
        }
      }
      await this.post({ type: 'taskWorkspaceState', view: store.getView() });
      if (msg.type === 'taskRename' && msg.requestId) await this.post({ type: 'taskRenameResult', requestId: msg.requestId, taskId: msg.taskId, saved: true });
    } catch (error) {
      let message = error instanceof Error ? error.message : '작업 기록을 저장하지 못했습니다. 다시 시도해 주세요.';
      if (msg.type === 'taskOpenSource' || msg.type === 'taskReturnFromSource') {
        // Browser/command failures may contain internal paths or tokens, including across realms.
        const safeMessages = msg.type === 'taskOpenSource'
          ? ['이 작업에서 확인한 출처를 선택해 주세요.', '출처 요청을 확인할 수 없습니다. 다시 선택해 주세요.', '이전 출처를 여는 중입니다. 잠시 뒤 다시 시도해 주세요.']
          : ['이 작업에서 연 출처로 돌아가 주세요.', '대화 화면을 찾지 못했습니다. 현재 작업을 다시 열어 주세요.'];
        if (!safeMessages.includes(message)) message = msg.type === 'taskOpenSource'
          ? '브라우저에서 출처를 열지 못했습니다. 다시 시도해 주세요.'
          : '대화로 돌아가지 못했습니다. 다시 시도해 주세요.';
      }
      if ((msg.type === 'taskOpenSource' || msg.type === 'taskReturnFromSource') && msg.requestId) {
        await this.post({ type: 'sourceOpenResult', requestId: msg.requestId, url: msg.url, taskId: msg.taskId, opened: false, error: message });
      } else await this.post({ type: 'taskWorkspaceError', error: message, ...(msg.type === 'taskRecoverDraft' ? { draftSaveFailed: true } : {}) });
      if (msg.type === 'taskRename' && msg.requestId) await this.post({ type: 'taskRenameResult', requestId: msg.requestId, taskId: msg.taskId, saved: false });
    }
  }
  private accessState:AccessState|undefined;
  private accessScope:string|undefined;
  private accessCheckedAt=0;
  private accessLoad:Promise<void>|undefined;
  private async loadAccess(force=false):Promise<void>{
    const token=await this.context.secrets.get(TOKEN_KEY);
    const scope=token?createHash('sha256').update(token).digest('hex'):undefined;
    if(scope!==this.accessScope){this.accessScope=scope;this.accessState=undefined;this.accessCheckedAt=0;this.accessLoad=undefined;}
    if(!token)return;
    if(!force&&this.accessState&&Date.now()-this.accessCheckedAt<10000)return;
    if(this.accessLoad)return this.accessLoad;
    const proxy=vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1');
    const selected=this.accessState?.selected;
    const pending=(async()=>{try{const view=await fetchAccessView(proxy,token);if(await this.context.secrets.get(TOKEN_KEY)===token)this.accessState={status:'ready',view,selected:this.accessState?.selected??selected};}
      catch{if(await this.context.secrets.get(TOKEN_KEY)===token)this.accessState={status:'unknown',selected,notice:'사용량 미확인 · 새로고침해 주세요.'};}
      finally{if(this.accessScope===scope){this.accessCheckedAt=Date.now();this.accessLoad=undefined;}}})();
    this.accessLoad=pending;return pending;
  }

  private profileGeneration=0;
  // REQ-M46 — the user declined the seed download this session (asked once,
  // not every turn), and the one download in flight.
  private sdkSeedDeclined = false;
  private sdkSeedInFlight: Promise<void> | null = null;
  // #1298 — instructor-mode state and server calls. Reset in invalidateProfile().
  private _instructorMode = new InstructorModeManager();
  private nativeObservationError: string | null = null;
  private nativeLearningPath: {title:string;url:string;reason:string} | null = null;
  private observationAssessment: AbortController | null = null;
  private observationWrites: Promise<void> = Promise.resolve();
  /**
   * Puts the format into the storage key.
   *
   * The `/1` key is kept byte-for-byte (an existing saved batch still opens). `/2`
   * uses a different slot — sharing one slot would open a `/1`-saved batch in a `/2`
   * context, and `recordLearningEvent()` would then be blocked by
   * `observation_format`, leaving the state where **the configuration is right but
   * learning events just quietly stop accumulating**.
   */
  private async prepareObservation(proxyUrl: string, token: string | undefined, profile: ResolvedProfile | null) {
    await this.observationWrites;
    // A re-test runs outside any turn and writes and persists its recorder for seconds. A new
    // recorder built from the saved batch now would be persisted over by the re-test, or
    // persist over it: whole snapshots, last write wins. Every writer shares the re-test's
    // recorder until it ends.
    if (this.verifyRunRecorder && this.verifySession.retestActive) return (this.nativeObservation = this.verifyRunRecorder);
    this.nativeObservation = null;
    // P1 — both `/1` and `/2` are accepted. Which one is used is the profile's call
    // (design §관측 이벤트와 필드: "the profile's observation.format decides which one is used").
    if (!OBSERVATION_FORMATS.includes(profile?.observation?.format as never) || !token) return null;
    try {
      // **P1 was still dead because this header was missing.** `/v1/profile` was
      // served `/2` while this one request went out without the header and got back a
      // `/1` context, so the recorder was built as `/1` and `currentLearningRecorder()`
      // stayed null forever. The client asks with one voice.
      const response = await fetch(proxyUrl.replace(/\/$/, '')+'/observations/context', {headers:observationHeaders(token),signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw Error('observation_unavailable');
      const context = await response.json() as Omit<ObservationBatch,'events'> & {learning_path?:{title:string;url:string;reason:string}};
      this.nativeLearningPath=context.learning_path??null;
      const key=observationKey(context);
      this.nativeObservation = new NativeObservationRecorder(context, this.context.workspaceState.get(key));
      this.nativeObservationError=null;
      return this.nativeObservation;
    } catch { this.nativeObservationError='관찰 기록을 연결하지 못했습니다. 기존 작업은 계속할 수 있습니다.'; return null; }
  }
  private persistObservation(recorder: NativeObservationRecorder) {
    const value=recorder.snapshot(), key=observationKey(value);
    this.observationWrites=this.observationWrites.then(async()=>{await this.context.workspaceState.update(key,value);}).catch(()=>{this.nativeObservationError='관찰 기록 저장에 실패했습니다.';});
  }
  /** Drawer D is open. A view state, so it is never used in a verdict. */
  private learningDrawerOpen = false;

  /** Learning events are made only on a connection using `/2`. Otherwise null, and region D is not drawn. */
  private async currentLearningRecorder(): Promise<NativeObservationRecorder | null> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    const proxy = vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1');
    const recorder = await this.prepareObservation(proxy, token, await this.ensureProfile());
    return recorder?.batch.format === 'hps-observation/2' ? recorder : null;
  }

  /**
   * Design §과제 흐름 상태 기계 — `task-<first 16 chars of the module sha256>-<first 8
   * chars of the activity id>`. Two tasks are never merged just because they share a
   * folder (MC-08).
   */
  private learningTaskId(lessonSha: string | undefined, activityId: string | undefined) {
    return learningTaskIdOf(lessonSha, activityId);
  }

  /**
   * The completion conditions. When the session design declares none it is an **empty
   * list**, and that fact travels all the way to the screen as
   * `learningState.declared=false`. No default is invented here.
   */
  private learningCompletion(profile: ResolvedProfile | null): CompletionItem[] {
    const rows = profile?.lesson?.content?.learning?.completion ?? [];
    return rows.map(r => ({ id: r.id, event: r.event as CompletionItem['event'], label: r.text }));
  }

  /**
   * Uses the step id the webview sent, but **only after checking it**. A step that is
   * not part of this lesson falls back to the first step — if the webview's string
   * were stored straight into `context.step_id`, there would later be no way to tell
   * which step the evidence belongs to.
   */
  private learningStep(profile: ResolvedProfile | null, wanted: string | undefined) {
    const steps = profile?.lesson?.content?.steps ?? [];
    return steps.find(s => s.id === wanted) ?? steps[0];
  }

  /**
   * The learning state the host computes and sends down to the webview. The gate is never
   * stored; it is computed every time. The task-flow phase (SX-55) is read from the record,
   * which is also where the task is opened the first time it is on screen.
   */
  private async postLearningState() {
    const recorder = await this.currentLearningRecorder();
    if (!recorder) {
      this.learningStateOwed = true;
      return;
    }
    const profile = await this.ensureProfile();
    const task = this.learningTaskId(profile?.lesson?.sha256, activityConnections(this.context)?.current?.id);
    const target = this.taskFlowTarget(recorder, profile);
    const shown = target ? screenFlow(await this.runTaskFlow({ kind: 'seen' }, recorder, profile), this.taskFlowLast, target.recordId) : null;
    // SX-02 — "지난번 이어서" for the record shown, decided by this session (`FlowSession`).
    const resume = this.flowSession.resumeFor(target?.recordId ?? null, shown);
    // A notice is said once, with the state it explains.
    const notice = this.taskFlowNotice;
    this.taskFlowNotice = null;
    await this.post({
      type: 'learningState',
      state: learningState({
        task,
        events: recorder.batch.events,
        completion: this.learningCompletion(profile),
        ...(shown ? { phase: shown.curriculum.phase, currentStep: shown.curriculum.current_step, resume } : {}),
        notice,
      }),
    });
    this.learningStateOwed = false;
  }

  /**
   * SX-01/SX-02 — a learning state could not be built (no `/2` recorder: the Service's observation
   * context did not answer). On a task-flow seat region A's Primary stays busy until a state has
   * shown the task's record (webview `recordShownBy`), so the next coach turn that answers sends one
   * (the turn end below) rather than leaving that to the webview being made again (`ready`).
   */
  private learningStateOwed = false;

  /** SX-55 — the last record this host read, so a busy record does not reopen a submitted task on screen. */
  private taskFlowLast: ({ recordId: string } & ShownFlow) | null = null;

  /**
   * SX-02 — this session of the App, for "지난번 이어서" (`FlowSession`, in memory only). It began
   * when this host was made, on the extension's activation: a task record last changed before
   * that was left by an earlier session. Taken once, never per state: a fresh `Date.now()` at each
   * state would make the record of a moment ago read as "last time". It also holds the records
   * the student has acted on since, which end the entry whether or not the act wrote anything.
   */
  private readonly flowSession = new FlowSession(Date.now());

  /**
   * SX-55 — the one task-flow line the student has to see, next to the completion button.
   * `nativeObservationError` cannot carry it: only the observation results panel reads that,
   * and a seat that records without assessment never draws that panel.
   */
  private taskFlowNotice: string | null = null;

  /**
   * SX-55 — the task this seat's flow runs on: the lesson, the design's task id (the one the
   * learning events, the screen and the submit name) and the id its record is stored under,
   * which adds the observation batch the gate reads and this folder (`taskRecordIdOf`), so a
   * phase is never read next to another seat's or another folder's events.
   *
   * null when this seat runs no task flow: no `/2` learning recorder, or a lesson without a
   * mission (SX-01 negative: then the flow does not start).
   */
  private taskFlowTarget(recorder: NativeObservationRecorder, profile: ResolvedProfile | null): { lesson: FlowLesson; taskId: string; recordId: string } | null {
    const lesson = flowLessonOf(profile?.lesson);
    if (!lesson || recorder.batch.format !== 'hps-observation/2') return null;
    const taskId = this.learningTaskId(lesson.sha256, activityConnections(this.context)?.current?.id);
    const { format, scope, program } = recorder.batch;
    return { lesson, taskId, recordId: taskRecordIdOf(taskId, { workspace: this.context.storageUri?.toString() ?? '', format, scope, program }) };
  }

  /**
   * SX-55 — move this seat's task by one signal on the measurement-core record (the
   * `hps-local-record/1` store the local review and CR-10 share; no new store, SX-48).
   *
   * null when this seat runs no task flow (`taskFlowTarget`). The step gate and the start are
   * judged on this recorder's batch. The record's lock is taken only for a write
   * (`runTaskFlowOn`): a signal that writes nothing (a refresh, a coach turn on a task already
   * working, a step start in place) is answered from a plain read. What the student must be
   * told is decided by `flowNotice`: a storage failure becomes a notice and null, never a phase
   * nobody stored.
   */
  private async runTaskFlow(signal: FlowSignal, recorder: NativeObservationRecorder, profile: ResolvedProfile | null): Promise<FlowOutcome | null> {
    const target = this.taskFlowTarget(recorder, profile);
    if (!target) return null;
    // SX-02 — the student's own signal ends "지난번 이어서" for this record, written or not, and
    // also when the record cannot be read this time.
    this.flowSession.noteSignal(target.recordId, signal);
    try {
      const { store, record } = this.crRecordHandle();
      const outcome = await runTaskFlowOn(store, record, { ...target, signal, events: recorder.batch.events, at: Date.now() });
      this.taskFlowLast = { recordId: target.recordId, curriculum: outcome.curriculum, changed_at: outcome.changed_at };
      this.taskFlowNotice = flowNotice(this.taskFlowNotice, signal, { outcome });
      return outcome;
    } catch (error) {
      this.taskFlowNotice = flowNotice(this.taskFlowNotice, signal, { error: flowErrorCode(error) });
      return null;
    }
  }

  /**
   * SX-55 — the step the learner started (region A's Primary) becomes the task's current step,
   * while the task is being worked on and only past steps whose gate the student met (back is
   * always allowed). A refused move stores no step and says nothing (`flowNotice`); the screen
   * is redrawn only when the record changed, a notice is waiting, or the "지난번 이어서" it shows
   * has ended (a start onto the step the record holds writes nothing, yet the student continued).
   */
  private async recordStepStart(stepId: string) {
    const recorder = await this.currentLearningRecorder();
    if (!recorder) return;
    const flow = await this.runTaskFlow({ kind: 'start_step', stepId }, recorder, await this.ensureProfile());
    if (flow?.changed || this.taskFlowNotice || this.flowSession.stale) await this.postLearningState();
  }

  private view?: vscode.WebviewView;
  private editorChat?: vscode.WebviewPanel;
  // REQ-STUDIO-FINISH-NOTICE — one calm notice when a turn ends while no chat surface is on screen.
  // Lazy: fixtures build the provider with Object.create, which skips field initializers.
  private finishNotice?: ReturnType<typeof createFinishNotifier>;
  private get finishNotifier() { return (this.finishNotice ??= createFinishNotifier({ view: () => this.view, editor: () => this.editorChat })); }
  // CGP-SHELL-R-024 — what the learner was last told the AI can do, per token and activity (memory only).
  // Inline `??=` at each use, not a getter: some fixtures call postConfig on a plain object that has no prototype getters.
  private capChanges?: CapabilityChangeTracker;
  private activeStreams = new Map<string, AbortController>();
  // REQ-STUDIO-STEER-NOW — the latest turn until its outer finally released the folder lock (turnSettle.ts);
  // undefined once it has. Fixtures build the provider with Object.create, which skips field initializers.
  private turnSettling?: Promise<void>;
  // A send owns its activity before its first authentication await, through persistence.
  private pendingSends = 0;
  /**
   * #503 — the single timeline of the in-flight turn (per stream id). It is built with
   * the **same pure reducer** the webview draws with and persisted exactly as it is.
   * Two sets of rules would mean a different order once the window is reopened.
   */
  private turnTimelines = new Map<string, TimelineState>();
  private pendingApprovals = new Map<string, (approved: boolean) => void>();
  /** REQ-STUDIO-TASK-RUN-STATE — approval modals open right now (resolveActionApprovalTracked). */
  private approvalWaits = 0;
  private readonly writeApprovalRequest = new WriteApprovalRequest({
    scope:()=>this.writeApprovalScope(),
    present:prompt=>this.presentWriteApproval(prompt),
  });
  /** CGP-KNOW-D-006 — every R-006 manifest opens as the in-panel dialog while a chat panel is visible. */
  private readonly outboundApproval = new OutboundApproval({
    scope:()=>this.writeApprovalScope(),
    id:()=>crypto.randomUUID(),
    present:prompt=>this.presentOutbound(prompt),
  });
  private async presentOutbound(prompt:AnyOutboundPrompt|null):Promise<boolean|void> {
    if(prompt && !(this.editorChat?.visible || this.view?.visible))return false;
    return this.post({type:'outboundPrompt',prompt});
  }
  private async presentWriteApproval(prompt:import('./writeApprovalPrompt').WriteApprovalPrompt|null):Promise<boolean|void> {
    if(prompt && !(this.editorChat?.visible || this.view?.visible))return false;
    return this.post({type:'writeApprovalPrompt',prompt});
  }
  private writeApprovalScope():string {
    return JSON.stringify([activityConnections(this.context)?.scope,this.currentTaskStore?.()?.getView().activeTaskId,this.resolveCoachCwd(),this.cachedProfile?.profile_id,this._instructorMode.isInstructor]);
  }
  private async confirmWriteFiles(id:string,title:string,verb:string,entries:WritePathEntry[]):Promise<boolean> {
    this.writeApprovalRequest.invalidate();
    const scope=this.writeApprovalScope(), generation=this.writeApprovalRequest.generation;
    const current=()=>scope===this.writeApprovalScope() && generation===this.writeApprovalRequest.generation;
    const token=await this.context.secrets.get(TOKEN_KEY);
    if(!current())return false;
    const approved=await this.writeApprovalRequest.confirm({id,title,verb,files:entries.map(writePathLine)});
    if(!approved)return false;
    const after=await this.context.secrets.get(TOKEN_KEY);
    return token===after && current();
  }
  /**
   * #476 — has the participant ever been told about the agent-sdk → proxy fallback
   * (once per session)?
   *
   * Why it is not attached every turn: the fallback keeps happening on that machine
   * (without the seed the next turn is the same). The same warning every turn means
   * nobody reads it from the second one on, and the conversation record gets buried
   * under warnings. Losing a capability is a state, not an event.
   */
  private fallbackNoticeShown = false;
  /** #596 — has the session-end upload banner already been shown this activation (toast-spam guard)? */
  private sessionEndUploadOffered = false;
  /**
   * #476 — the developer-facing diagnostic channel. The fallback used to be a single
   * `console.warn`, but the extension had `createOutputChannel` **nowhere at all**, so
   * that line survived nowhere: on the day of the incident, the string `[coach]`
   * appeared 0 times across every session's `exthost.log`. In other words there was no
   * way, after the fact, to check "did this classroom run on the proxy?".
   */
  private logChannel: vscode.OutputChannel | null = null;
  private focusDiagnosticCount = 0;
  /** Existing output channel, opt-in synthetic host only; never changes focus. */
  focusDiagnostic(phase: FocusDiagnosticPhase, flags: {scope_present?:boolean;delivered?:boolean} = {}): void {
    if (process.env.HPS_TEST_E2E !== '1' || this.focusDiagnosticCount >= 64) return;
    const line = focusDiagnosticLine(phase, flags);
    if (!line) return;
    try { this.voiceLogChannel().appendLine(line); this.focusDiagnosticCount++; } catch { /* observation cannot change the command */ }
  }

  /**
   * #897 (VO-01) — the voice capability probe in flight. One per command, cleared when
   * a response arrives or it times out. With no webview, or one that does not answer,
   * this has to end as **not measured** (it must not be written down as blocked), so
   * null is returned here.
   */
  private voiceProbes = new Map<string, (o: import("./voiceCapabilityHelpers").VoiceProbeObservations) => void>();

  isViewVisible(): boolean { return !!this.view?.visible; }

  /** The surface the diagnostic command uses. With the webview closed it returns null, leaving it as not measured. */
  async probeVoiceCapability(
    timeoutMs: number,
  ): Promise<import("./voiceCapabilityHelpers").VoiceProbeObservations | null> {
    if (!this.view) return null;
    const probeId = randomId();
    const observations = new Promise<import("./voiceCapabilityHelpers").VoiceProbeObservations | null>((resolve) => {
      this.voiceProbes.set(probeId, resolve);
      setTimeout(() => {
        if (this.voiceProbes.delete(probeId)) resolve(null);
      }, timeoutMs);
    });
    void this.post({ type: "probeVoiceCapability", probeId });
    return observations;
  }

  /** The output channel — where a diagnosis leaves its verdict. Same channel as the fallback notice (#476). */
  voiceLogChannel(): vscode.OutputChannel {
    this.logChannel ??= vscode.window.createOutputChannel("HypeProof Coach");
    return this.logChannel;
  }
  private cachedProfile: ResolvedProfile | null = null;

  // ── One-click publish (src/publish/) ──────────────────────────────────────
  private sitePublisherInstance: SitePublisher | null = null;
  private publishEndpoints: PublishEndpoints | null = null;

  /** Called once by activate(): where the publish talks to (test overrides already gated). */
  initSitePublish(endpoints: PublishEndpoints): void {
    this.publishEndpoints = endpoints;
    this.sitePublisherInstance = null; // rebuilt with these endpoints on first use
    this.refreshSitePublishContext();
  }

  /** Mirror "may the publish button be shown here" (the served profile for this seat's token). */
  private refreshSitePublishContext(): void {
    void vscode.commands.executeCommand("setContext", SITE_PUBLISH_CONTEXT_KEY, this.sitePublisher().available());
  }

  /** Lazily built so a cohort that never publishes never resolves `gh`. */
  private sitePublisher(): SitePublisher {
    this.sitePublisherInstance ??= new SitePublisher({
      profile: () => this.cachedProfile,
      isMinor: (p) => isMinorProfile(p),
      workspaceRoot: () => this.resolveCoachCwd(),
      idle: () => !this.hasActiveStream(),
      postToChat: (text) => this.postAppReply(text),
      notice: (text) => this.postPageNotice(text),
      clearNotice: (expected) => {
        if (this.pendingPageNotice === expected) this.postPageNotice("");
      },
      log: (line) => this.voiceLogChannel().appendLine(line),
      stallMs: () => vscode.workspace.getConfiguration("hypeproofChat").get<number>("sdkStallTimeoutMs"),
      store: this.context.globalState,
      endpoints: this.publishEndpoints ?? { refused: [] },
      checkAccess: () => this.checkSitePublishAccess(),
      // ensureProfile(true) re-reads the profile and re-sets the context key; postConfig carries
      // the new answer to the chat header button.
      refreshProfile: async () => {
        await this.ensureProfile(true);
        await this.postConfig();
      },
      // The folder the class connected in; the profile's workspace_root when no activity is recorded.
      classFolder: () => {
        try {
          const current = activityConnections(this.context)?.current?.workspace;
          if (current) return current;
        } catch {
          /* an unreadable activity record: fall back to the profile */
        }
        const root = this.cachedProfile?.workspace_root;
        return (root && resolveWorkspaceRoot(root)) || undefined;
      },
      sameFolder: (a, b) => canonicalizeForCompare(a) === canonicalizeForCompare(b),
    });
    return this.sitePublisherInstance;
  }

  /**
   * One fresh /v1/profile for the token in this seat: the publish press's token gate. Read
   * apart from the cache on purpose — the cached profile outlives the token in an app left open
   * — and with the same activity rule as ensureProfile, so the two never disagree on a seat.
   */
  private async checkSitePublishAccess(): Promise<AccessCheck> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    if (!token) return { kind: "no_token" };
    const connections = activityConnections(this.context);
    if (connections && !connections.matchesService) return { kind: "profile", publishing: null, minor: false };
    const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    const r = await fetchProfileResult({ proxyUrl, token }).catch(() => null);
    if (!r) return { kind: "failure", reason: "network" };
    if (!r.ok) return { kind: "failure", reason: r.failure.reason };
    if (connections?.current && r.profile.activity_id !== connections.current.serverId) return { kind: "profile", publishing: null, minor: false };
    return { kind: "profile", publishing: r.profile.publishing, minor: isMinorProfile(r.profile) };
  }

  /**
   * "GitHub에서 이어하기" for the start page (startPage.ts): the publish module's GitHub side, for
   * profiles behind the same gate as the publish button and naming a class folder.
   */
  githubContinueSource(): GithubContinueSource {
    const classRoot = (p: ResolvedProfile) => (p.workspace_root ? resolveWorkspaceRoot(p.workspace_root) : null);
    return {
      allowed: (p) => sitePublishAllowed(p.publishing, isMinorProfile(p)).ok && !!classRoot(p),
      find: () => this.sitePublisher().findClassRepos(),
      signIn: () => this.sitePublisher().signInForContinue(),
      prepare: (args) => this.sitePublisher().prepareContinue(args),
      newFolder: (root) => nextFreeFolder(root),
      classRoot,
    };
  }

  /** Opens a class folder as this activity's workspace (extension.ts: ensureWorkspace + activity commit). Reloads the window. */
  private projectOpener?: (folder: string) => Promise<void>;
  /**
   * The class folder as the Service served it. `cachedProfile.workspace_root` is rewritten to the
   * activity's current folder (ensureProfile), so after one switch it names a project folder, and
   * deriving `<class folder>-<repo>` from it chained names (`…-sandbox-dental-homepage-3-…`).
   */
  private servedWorkspaceRoot: string | null = null;
  /** The served class folder (REQ-STUDIO-FOLDER-CONSENT: the activity's own folder). */
  get servedClassRoot(): string | null { return this.servedWorkspaceRoot; }
  /** Local trash is explicit machine opt-in; a resolved learner profile is still required. */
  get activityTrashBinding(): { root: string; scope: string } | undefined {
    if (!this.cachedProfile || this.isInstructor !== false || this.taskChanging || this.connectionChanging) return undefined;
    const root = this.resolveCoachCwd();
    return root ? { root, scope: this.turnRequestScope() } : undefined;
  }

  private folderConsentOpts() { return { servedRoot: this.servedWorkspaceRoot, instructor: this._instructorMode?.isInstructor === true }; }
  /** REQ-STUDIO-FOLDER-CONSENT — the one write question (also asked by the preview). null = may write. */
  folderWriteRefusalFor(target: string): string | null { return folderWriteRefusal(this.context, this.cachedProfile, this.folderConsentOpts(), target); }
  private readonly folderWriteNoted = new Set<string>();
  /** Every host write into the open folder passes here: true = blocked, with one 폴더 권한 line per turn. */
  private folderWriteBlocked(target: string, streamId?: string): boolean {
    const refusal = this.folderWriteRefusalFor(target);
    if (!refusal) return false;
    if (!streamId) this.postPageNotice(refusal, "folder");
    else if (!this.folderWriteNoted.has(streamId)) { this.folderWriteNoted.add(streamId); this.postToolLog(streamId, { id: randomId(), icon: "🔒", label: refusal, state: "error", denial: denialNotice("folder", this.getSeatAudience() === "classroom") }); }
    return true;
  }
  /** Every model call the host makes outside the chat turn's own check passes here: the refusal copy, or null. */
  private async folderAiRefusal(): Promise<string | null> {
    const profile = this.cachedProfile ?? (await this.ensureProfile().catch(() => null));
    if (!profile) return null;
    try { await folderConsentProfile(this.context, profile, this.folderConsentOpts()); return null; }
    catch (error) { if (error instanceof FolderConsentRefusal) return error.message; throw error; }
  }
  /**
   * REQ-STUDIO-MISSING-TASK-FOLDER — the personal task's folder when it is gone, cannot be read and
   * written, or no longer resolves to the activity's recorded folder; else null. Class and lesson
   * seats, the instructor surface and seats without personal tasks never get the notice: their
   * folder is the class's, and they keep the existing refusal. Checked again on every send.
   */
  private missingFolderApplies(): boolean {
    return !!this.currentTaskStore?.() && folderConsentApplies(this.cachedProfile, this._instructorMode?.isInstructor === true);
  }
  private async missingTaskFolderPath(): Promise<string | null> {
    const record = activityConnections(this.context)?.current;
    return missingTaskFolder({
      applies: this.missingFolderApplies(),
      folder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? record?.workspace,
      recorded: record?.workspace,
      canonical: canonicalRoot,
    });
  }
  private async postMissingTaskFolder(note?: string): Promise<void> {
    await this.post({ type: "missingTaskFolder", notice: missingTaskFolderNotice(await this.missingTaskFolderPath(), note) });
  }
  /** A send while the folder is missing is held: the text goes back to the composer, the notice is shown, no turn starts. */
  private async holdSendForMissingFolder(text: string, images: string[] | undefined, toolMode: TurnToolMode): Promise<void> {
    await this.post({ type: "inputRejected", text, images, toolMode });
    await this.postHistory();
    await this.postMissingTaskFolder();
  }
  /**
   * The task store is scoped by activity and folder (taskWorkspaceScope), so a move to another
   * folder opens a different store. Before the move, the current store (with the draft just
   * flushed) is copied into the new folder's scope and read back from disk; the move goes ahead
   * only when the new scope holds the same active task, conversation and draft. The old scope is
   * never changed or deleted.
   */
  private async carryTaskStoreTo(folder: string): Promise<boolean> {
    const record = activityConnections(this.context)?.current;
    const from = this.currentTaskStore?.();
    if (!record || !from) return false;
    const scope = taskWorkspaceScope({ id: record.id, workspace: canonicalRoot(folder) });
    const root = taskWorkspaceRoot(this.context.globalStorageUri.fsPath);
    if (new TaskWorkspaceStore(root, scope).scope === from.scope) return true;
    try {
      await new TaskWorkspaceStore(root, scope).adoptFrom(from);
      const check = new TaskWorkspaceStore(root, scope);
      const id = from.getView().activeTaskId;
      return !!id && check.getView().activeTaskId === id &&
        JSON.stringify(check.getHistory(id)) === JSON.stringify(from.getHistory(id)) &&
        JSON.stringify(check.getDraft(id)) === JSON.stringify(from.getDraft(id));
    } catch { return false; }
  }
  private repickingFolder = false;
  /**
   * 다시 고르기 — the existing folder picker, then the same move "프로젝트 변경" uses (projectOpener:
   * activity commit under the canonical root, ensureWorkspace, reload). A folder outside the
   * activity's own asks folder consent first (REQ-STUDIO-FOLDER-CONSENT); "AI 안 씀" or closing the
   * question moves nothing. The draft is flushed and the task store carried to the new folder's
   * scope before the window moves; a pick that does not move the task keeps the notice with one
   * line why.
   */
  private async repickTaskFolder(): Promise<void> {
    if (this.repickingFolder || this.hasActiveStream()) return;
    this.repickingFolder = true;
    let note: string | undefined;
    try {
      if (!(await this.missingTaskFolderPath())) return;
      const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: MISSING_TASK_FOLDER_PICK_LABEL, title: MISSING_TASK_FOLDER_PICK_TITLE });
      const choice = await repickedFolder(picked?.[0]?.fsPath, (p) => canonicalFolder(p));
      if (choice.kind === "cancel") return;
      if (choice.kind === "invalid") { note = MISSING_TASK_FOLDER_NOT_A_FOLDER; return; }
      const profile = this.cachedProfile ?? (await this.ensureProfile());
      if (!profile || !this.projectOpener) { note = MISSING_TASK_FOLDER_FAILED; return; }
      let consent: Awaited<ReturnType<typeof folderConsentForFolder>>;
      try { consent = await folderConsentForFolder(this.context, profile, this.folderConsentOpts(), choice.folder); }
      catch (error) { if (error instanceof FolderConsentRefusal) { note = error.message; return; } throw error; }
      if (!consent) { note = MISSING_TASK_FOLDER_UNDECIDED; return; }
      if (consent === "none") { note = MISSING_TASK_FOLDER_NO_AI; return; }
      await this.setConnectionChanging(true);
      try {
        if (!(await this.carryTaskStoreTo(choice.folder))) { note = MISSING_TASK_FOLDER_FAILED; return; }
        await this.projectOpener(choice.folder);
      }
      catch (error) { note = error instanceof ActivityConnectionError ? error.message : MISSING_TASK_FOLDER_FAILED; }
      finally { await this.setConnectionChanging(false); }
    } catch {
      note = MISSING_TASK_FOLDER_FAILED;
    } finally {
      this.repickingFolder = false;
      await this.postMissingTaskFolder(note);
    }
  }
  setProjectOpener(open: (folder: string) => Promise<void>): void {
    this.projectOpener = open;
  }

  /**
   * The model-only note for the first turn after a project switch, once, and only in the folder
   * the switch opened: the window reloads in between, so the note waits in globalState.
   */
  private async takeProjectSwitchBrief(): Promise<string | null> {
    const pending = this.context.globalState.get<{ folder?: string; repo?: string; at?: number }>(PROJECT_SWITCH_BRIEF_KEY);
    if (!pending?.folder || !pending.repo) return null;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || canonicalizeForCompare(root) !== canonicalizeForCompare(pending.folder)) return null;
    await this.context.globalState.update(PROJECT_SWITCH_BRIEF_KEY, undefined);
    if (Date.now() - (pending.at ?? 0) > PROJECT_SWITCH_BRIEF_TTL_MS) return null;
    return projectSwitchBrief(pending.repo, fs.existsSync(path.join(root, "agent.md")));
  }

  /** "프로젝트 변경" — the command and the chat sentence (isProjectSwitchRequest) both land here. */
  async switchProject(): Promise<void> {
    const profile = this.cachedProfile ?? (await this.ensureProfile());
    const served = this.servedWorkspaceRoot ?? profile?.workspace_root;
    const classRoot = served ? resolveWorkspaceRoot(served) ?? undefined : undefined;
    const switched = await this.sitePublisher().switchProject(classRoot);
    if (!switched) return;
    const how =
      switched.action === "clone" ? "새 폴더로 내려받았어요" : switched.action === "pull" ? "GitHub의 최신 내용으로 받아왔어요" : "이 컴퓨터에 있던 폴더를 그대로 열어요";
    const note = switched.backup ? `\n\n받기 전 폴더는 ${switched.backup} 에 그대로 남겨 뒀어요.` : "";
    await this.postAppReply(`프로젝트를 **${switched.repo}**(으)로 바꿨어요. ${how}. 이제 이 프로젝트에서 이어서 작업하면 돼요.${note}`).catch(() => undefined);
    if (!this.projectOpener) {
      this.postPageNotice(`폴더를 열지 못했어요: ${switched.folder}`);
      return;
    }
    await this.context.globalState.update(PROJECT_SWITCH_BRIEF_KEY, { folder: switched.folder, repo: switched.repo, at: Date.now() });
    try {
      await this.projectOpener(switched.folder);
    } catch (err) {
      this.voiceLogChannel().appendLine(`[switch] open ${switched.folder}: ${err instanceof Error ? err.message : String(err)}`);
      this.postPageNotice(err instanceof ActivityConnectionError ? err.message : `폴더를 열지 못했어요: ${switched.folder}`);
    }
  }

  /** "배포 등록 해제" — forget a persisted publish registration. */
  async unregisterSitePublish(): Promise<void> {
    await this.sitePublisher().unregisterFromCommand();
  }

  /** The "홈페이지 올리기" command. The manifest hides it; this re-checks (a command can run without its menu). */
  async publishSite(): Promise<void> {
    await this.sitePublisher().runFromButton();
  }

  /**
   * An app-written reply bubble in the transcript, the same channel the team-brain answers use:
   * the webview shows it and the next turn's history carries it, so the coach can continue
   * from the button's outcome instead of asking what happened.
   */
  private async postAppReply(text: string, deferCompletion?: (streamId: string) => void, onStart?: (streamId: string) => void): Promise<void> {
    const sid = randomId();
    const aid = randomId();
    // handleSend owns deferred replies. Button/command replies must retain
    // their own ownership until persistence settles, including its failure path.
    const ownsCompletion = !deferCompletion;
    if (ownsCompletion) this.pendingSends++;
    let failed = false;
    try {
      onStart?.(sid);
      void this.post({ type: "streamStart", streamId: sid, messageId: aid });
      void this.post({ type: "streamChunk", streamId: sid, delta: text });
      await this.appendHistory([{ id: aid, role: "assistant", content: text, createdAt: Date.now(), assistantName: this.coachDisplayName() }]);
      deferCompletion?.(sid);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (ownsCompletion) {
        this.pendingSends--;
        await this.post(failed
          ? { type: "streamError", streamId: sid, retryable: false, error: "답변을 기록에 저장하지 못했어요. 화면의 내용을 확인해 주세요." }
          : { type: "streamEnd", streamId: sid });
      }
    }
  }
  /** #751 G2 — the step on screen and the learner's help choice, checked against the lesson; read ONCE per turn at turn start. */
  private lessonFocus: LessonFocus | null = null;
  /**
   * AE-01 (#554) — goal saves run one after another: the answers come back in the order the saves were sent, and each
   * save reads, checks and writes as one step. What refuses a second save made from the same revision is the revision
   * check in `acceptGoalSave`, not this queue.
   */
  private goalWrites: Promise<void> = Promise.resolve();
  private profileFetchPromise: Promise<ResolvedProfile | null> | null = null;
  /**
   * #381 — why the last profile fetch failed (null when it succeeded or was
   * never attempted). Read by the token-entry command so a rejected paste gets
   * a cause-specific sentence instead of one generic failure message.
   */
  private lastProfileFailure: ProfileFailure | null = null;
  // #278 — browser-page context queued by "페이지를 코치에게", prepended to the
  // NEXT turn's prompt only (history keeps the user's clean text).
  private pendingPageContext: string | null = null;
  // #278 Phase 2 — screenshot of the current browser page (data: URL), sent as
  // an image with the NEXT turn so the coach can *see* the page. image_paste-
  // gated; consumed once, like pendingPageContext.
  private pendingPageImage: string | null = null;
  /** CGP-ART-R-007 — what the learner sees for the queued page text (null when none). */
  private pendingPageAttachment: PageAttachmentPreview | null = null;
  /** CGP-CHAT-R-011 — the work-folder file queued for the next message: what the learner sees, what the model gets, and from which folder. */
  private pendingFileAttachment: { preview: import("./protocol").FileAttachmentPreview; modelText: string; root: string } | null = null;
  /** CGP-CHAT-R-011 — user turns of this window that carried a file (a retry of one says the file was not resent). */
  private fileTurnIds?: Set<string>;
  // #308 — inline "붙였어요" notice queued for the webview. post() silently
  // drops messages while the view is unresolved, and extension.ts calls
  // attachPageContext() BEFORE panel.focus creates the view — so the notice
  // must survive until the webview signals "ready". Also re-flushed on every
  // remount: WebviewView does not support retainContextWhenHidden, so React
  // state (pageNotice) resets whenever the panel is hidden and re-shown.
  // Cleared alongside pendingPageContext when the queued context is consumed.
  private pendingPageNotice: string | null = null;
  // #320 — AI disclosure at session start (REQ-C14). Host-side gate because
  // the webview forgets everything on hide/show remounts; see AiDisclosureGate.
  private readonly aiDisclosure = new AiDisclosureGate();
  private accuracyStore(): AccuracyEducationStore {
    return new AccuracyEducationStore(path.join(this.context.globalStorageUri.fsPath, 'accuracy-education'));
  }
  private async accuracyOwner(): Promise<string> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    return crBytesOwner(token) ?? createHash('sha256').update(token || this.turnRequestScope()).digest('hex');
  }
  private async postAccuracyEducation(requestId?: string): Promise<void> {
    if (!requestId) { await this.post({ type: 'accuracyEducationChanged' }); return; }
    const scope = this.turnRequestScope(), token = await this.context.secrets.get(TOKEN_KEY);
    const owner = crBytesOwner(token) ?? createHash('sha256').update(token || scope).digest('hex');
    const currentToken = await this.context.secrets.get(TOKEN_KEY);
    if (scope !== this.turnRequestScope() || token !== currentToken) return;
    // A store that cannot be built or read means no card, never a thrown host error.
    let offer: AccuracyOffer | null = null;
    if (!this._instructorMode.isInstructor) { try { offer = accuracyOffer(this.accuracyStore(), owner, scope); } catch { offer = null; } }
    await this.post({ type: 'accuracyEducation', requestId, offer });
  }

  private activeCohortId: string | null = null;
  /**
   * CGP-AGENT-R-004 (REQ-E1) — exact shell commands the participant allowed "이번 작업 동안".
   * Scoped to one task (cohort, activity, task, folder, folder consent, instructor) and in memory
   * only: any scope change forgets them, and a reload starts empty. Destructive and chained
   * commands are never remembered (taskCommandExact returns null), so `rm` can never be remembered.
   */
  private readonly taskCommandAllows = new TaskCommandAllows();
  /** The current task scope for `taskCommandAllows`, and the folder-consent refusal for shell (null = may run). */
  private taskCommandAllowState(): { key: string; refusal: string | null } {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.cachedProfile?.workspace_root ?? null;
    const { tag: consent, at: consentAt } = folderConsentState(this.context, this.cachedProfile, this.folderConsentOpts());
    const key = taskCommandAllowScopeKey({
      cohort: this.activeCohortId ?? null,
      activity: activityConnections(this.context)?.scope ?? this.nativeHistoryScope ?? null,
      task: this.currentTaskStore?.()?.getView().activeTaskId ?? null,
      folder,
      consent,
      consentAt,
      instructor: this._instructorMode?.isInstructor === true,
    });
    // "AI 안 씀" and a seat with no activity keep their own copy; read-only says 명령 실행, undecided says nothing was chosen.
    const refusal = shellAllowedByFolderConsent(consent) ? null
      : consent === "none" ? folderNoAiCopy()
      : consent === "ask" ? folderShellUndecidedNotice()
      : consent === "refuse" ? (folder ? this.folderWriteRefusalFor(folder) : null) ?? folderShellRefusalNotice()
      : folderShellRefusalNotice();
    return { key, refusal };
  }
  private lastAllowInstructor?: boolean;
  /** Ends every task allow now (task create / select, sign-in, instructor flip, the folder-consent command). */
  // Optional chaining: test harnesses build the host with Object.create, without field initializers.
  endTaskCommandAllows(): void { this.taskCommandAllows?.clear(); }
  /**
   * Origins the participant pressed "이 사이트는 항상 허용" on. The same discipline as
   * the shell allow (which is now per task) — session-scoped, never persisted. It is per origin, so a
   * different site is asked again.
   */
  private readonly approvedBrowserOrigins = new Set<string>();
  /** #457 — the CDP executor for the SDK path's inspection tools. Created on first use. */
  private mcpBrowser?: BrowserControl;
  /** CR-10 — Experiment Browser results the SDK path produced, matched to their tool_result (crHostWiring). */
  private readonly crSdkResults = new SdkCrResults();
  /**
   * CR-10 — the local measurement-core record (`hps-local-record/1`, the store the local
   * review uses) that holds a browser result's screenshot and trace bytes by digest.
   * Opened on first use; writes are serialized here and run under the record's file lock.
   */
  private crRecord: { store: FileRecordStorage; record: LocalRecord } | null = null;
  private crBlobWrites: Promise<unknown> = Promise.resolve();
  private crRecordHandle(): { store: FileRecordStorage; record: LocalRecord } {
    if (!this.crRecord) {
      const store = new FileRecordStorage(path.join(this.context.globalStorageUri.fsPath, LOCAL_RECORD_DIR));
      this.crRecord = { store, record: new LocalRecord(store) };
    }
    return this.crRecord;
  }
  /**
   * CR-10 — where one turn's result bytes go, recorded as `owner`'s (crBytesOwner of the
   * turn's token). Signed out (no owner): nothing is stored, so no bytes exist that nobody
   * can count or delete.
   */
  private crBlobSinkFor(owner: string | null): BlobSink | undefined {
    if (!owner) return undefined;
    return (blobs) => {
      const next = this.crBlobWrites.then(async () => {
        try {
          const { store, record } = this.crRecordHandle();
          // One lock for the result's screenshot and trace together.
          return await store.exclusive(async () => {
            const out: Array<string | null> = [];
            for (const blob of blobs) out.push(await record.putBlob(blob, { owner }).catch(() => null));
            return out;
          });
        } catch {
          // Busy (a local review in another window holds the lock) or failed: the event
          // then carries no digest for these bytes, never a dangling one.
          return blobs.map(() => null);
        }
      });
      this.crBlobWrites = next;
      void next.then((digests) => { if (digests.some((d) => d !== null)) void this.noteCrBytes(owner, true); });
      return next;
    };
  }
  /** Remember whether `owner` has bytes stored (CR_BYTES_OWNERS_STATE), then refresh the context key. */
  private async noteCrBytes(owner: string, has: boolean): Promise<void> {
    const list = this.context.globalState.get<unknown>(CR_BYTES_OWNERS_STATE);
    await this.context.globalState.update(CR_BYTES_OWNERS_STATE, crBytesOwnersAfter(list, owner, has));
    await this.refreshCrBytesContext();
  }
  /**
   * CR-10 — mirror "the signed-in person has browser-result bytes stored" to
   * CR_BYTES_CONTEXT_KEY, which shows the delete command whatever the CR switch says
   * (MC-27). Reads only the owners list in globalState, never the record: it runs at
   * start-up and on every sign-in for every seat, so it does no disk I/O.
   */
  async refreshCrBytesContext(): Promise<void> {
    const owner = crBytesOwner(await this.context.secrets.get(TOKEN_KEY));
    const list = this.context.globalState.get<unknown>(CR_BYTES_OWNERS_STATE);
    const flagged = !!owner && Array.isArray(list) && list.includes(owner);
    void vscode.commands.executeCommand("setContext", CR_BYTES_CONTEXT_KEY, flagged);
  }
  /**
   * CR-10 — how many browser-result bytes the signed-in person stored, counted on the record
   * (keys only, so an unrelated corrupt review record cannot hide them). Corrects the owners
   * list. null when the record cannot be read: the delete is still offered if the list says
   * bytes may be stored, so a read failure never makes stored screens undeletable.
   */
  private async crStoredCount(owner: string | null): Promise<number | null> {
    if (!owner) return 0;
    try {
      const n = await this.crRecordHandle().record.blobCount({ owner });
      await this.noteCrBytes(owner, n > 0);
      return n;
    } catch {
      const list = this.context.globalState.get<unknown>(CR_BYTES_OWNERS_STATE);
      return Array.isArray(list) && list.includes(owner) ? null : 0;
    }
  }
  /** CR-09 — the element the student picked for the NEXT turn, until sent or removed. */
  private readonly elementQueue = new ElementQueue();
  private _annotationBatch?: AnnotationBatch;
  private get annotationBatch(): AnnotationBatch { return this._annotationBatch ??= new AnnotationBatch(); }
  private annotationBoundScope?: string;
  private syncAnnotationScope(): void {
    const scope = this.annotationScope();
    if (scope !== this.annotationBoundScope) {
      void this.mcpBrowser?.clearAnnotationMarkers?.().catch(() => {});
      this.annotationBoundScope = scope;
    }
    this.annotationBatch.bind(scope);
  }
  private annotationScope(): string {
    return `${activityConnections(this.context)?.scope ?? ''}:${this.currentTaskStore?.()?.getView().activeTaskId ?? ''}`;
  }
  /** CGP-ART-R-001 — the flag (machine scope, default off) plus the served CR and image grants and a
   * non-local runtime. Every one is read fresh; any missing piece means no annotations go. */
  private annotationFlag(): boolean {
    return vscode.workspace.getConfiguration("hypeproofChat").get<boolean>("annotationBatchEnabled", false) === true;
  }
  private annotationsAllowed(): boolean {
    return this.annotationFlag() && this.isCurriculumRuntimeEnabled() && this.isImagePasteEnabled() && this.annotationRuntimeAvailable();
  }
  /** The annotations each sent turn carried, by user message id, so an error retry resends them. */
  private annotationTurns?: Map<string, import('./annotationBatch').Annotation[]>;
  private rememberAnnotationTurn(userId: string, annotations: import('./annotationBatch').Annotation[]): void {
    if (!annotations.length) return;
    const turns = (this.annotationTurns ??= new Map());
    turns.set(userId, annotations);
    while (turns.size > 20) turns.delete(turns.keys().next().value!);
  }
  /** Re-checks a page identity for `annotations`: the same document generation, artifact version and refs. */
  private async annotationsStillValid(annotations: import('./annotationBatch').Annotation[]): Promise<boolean> {
    const identity = await this.mcpBrowser?.annotationIdentity().catch(() => null);
    if (!identity || !this.mcpBrowser?.annotationRefsValid(annotations.flatMap(a => a.contexts))) return false;
    return annotations.every(a => a.contexts.every(c => c.documentGeneration === identity.generation && c.artifact.id === identity.artifactId));
  }
  private async takeAnnotationBatch(retrySourceId: string | undefined, revision: number, scope: string, pinnedCount = 0): Promise<import('./annotationBatch').Annotation[]> {
    this.syncAnnotationScope();
    // An error retry is the same request: it carries the annotations the failed turn carried, when the
    // page is still the one they were marked on, and says so plainly when it is not. It never takes
    // the new draft (that rides the next fresh message).
    if (retrySourceId !== undefined) {
      const prior = this.annotationTurns?.get(retrySourceId);
      if (!prior?.length) return [];
      if (this.annotationsAllowed() && scope === this.annotationScope() && await this.annotationsStillValid(prior) && scope === this.annotationScope()) return prior;
      this.postPageNotice(ANNOTATION_RETRY_DROPPED);
      return [];
    }
    // The activity or task changed during this send: a draft pinned at its start went with the old
    // task (the sync above dropped it), so the send is refused and says so, never sent without it.
    if (scope !== this.annotationScope()) { if (pinnedCount > 0) throw new AnnotationRefusal(ANNOTATION_REFUSAL.activity); return []; }
    if (!this.annotationBatch.size) return [];
    const identity = await this.mcpBrowser?.annotationIdentity().catch(() => null);
    if (scope !== this.annotationScope()) throw new AnnotationRefusal(ANNOTATION_REFUSAL.activity);
    const refsValid = this.mcpBrowser?.annotationRefsValid(this.annotationBatch.contexts());
    const valid = this.annotationBatch.validate(refsValid ? identity?.generation ?? '' : '', identity?.artifactId ?? '');
    this.postAnnotations();
    if (!this.annotationsAllowed()) throw new AnnotationRefusal(ANNOTATION_REFUSAL.gate);
    if (!valid) throw new AnnotationRefusal(ANNOTATION_REFUSAL.stale);
    return this.annotationBatch.take(revision);
  }
  /** After the batch is taken for a turn: the tray shows the empty draft and the page markers go. */
  private finishAnnotationSend(annotations: import('./annotationBatch').Annotation[]): void {
    if (!annotations.length) return;
    this.postAnnotations();
    for (const a of annotations) void this.mcpBrowser?.annotationMarker(a.number, null).catch(() => {});
  }
  private annotationRuntimeAvailable(): boolean {
    // Fail closed: a host that cannot say which app it is cannot prove it is not the local runtime.
    const appName = (vscode as { env?: { appName?: unknown } }).env?.appName;
    if (typeof appName !== 'string') return false;
    const cfg = vscode.workspace.getConfiguration('hypeproofChat');
    return !localRuntimeConfig(appName, cfg.get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1'));
  }
  /** Last state sent to the webview, so a seat that never had the feature gets no message at all. */
  private annotationsShown = false;
  private postAnnotations(): void {
    this.syncAnnotationScope();
    const enabled = this.annotationsAllowed();
    const annotations = this.annotationBatch.preview();
    if (!enabled && !annotations.length && !this.annotationsShown) return;
    this.annotationsShown = enabled || annotations.length > 0;
    void this.post({ type: 'annotations', enabled, annotations });
  }

  // ── AI Verify (cr-verify, #1392) ──────────────────────────────────────────
  /** "Test my product": the session over the record, the preview and the CR executor. */
  private readonly verifySession = new VerifySession({
    switchOn: () => this.isCurriculumRuntimeEnabled(),
    audience: () => this.getSeatAudience(),
    recorder: () => this.verifyRecorder(),
    startUrl: () => this.liveServer.currentUrl() ?? null,
    allowedOrigins: () => this.crBrowserOptions().allowedOrigins(),
    executor: () => {
      this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions());
      return this.mcpBrowser.crExecutor();
    },
    currentVersion: async () => {
      const root = this.liveServer.currentRoot();
      const base = this.liveServer.currentUrl();
      if (!root || !base) return null;
      return (await artifactVersionFor(root, new URL(base).pathname || "/")).id;
    },
    storeScreenshot: async (base64, mimeType) => {
      const sink = this.crBlobSinkFor(crBytesOwner(await this.context.secrets.get(TOKEN_KEY)));
      if (!sink) return null;
      const [digest] = await sink([{ media_type: mimeType === "image/png" ? "image/png" : "image/jpeg", base64 }]);
      return digest ?? null;
    },
    // CR-68, chat-panel half: the panel shows the run while it acts on the page.
    onRun: () => void this.postVerifyState(),
    release: () => { this.verifyRunRecorder = null; },
  });

  /**
   * The recorder of the turn now streaming, captured by `handleSend` and cleared when the
   * turn ends. Other webview handlers may replace `this.nativeObservation` mid-turn
   * (`prepareObservation`), and the turn later persists its own recorder over the same key,
   * so verdicts written anywhere else during the turn would be overwritten.
   */
  private verifyTurnRecorder: NativeObservationRecorder | null = null;
  /**
   * The recorder a re-test writes to, held from its first recorder call until it ends
   * (`release`). Meanwhile `prepareObservation` hands this one out instead of building
   * another, so a drawer write during a re-test lands on the same record.
   */
  private verifyRunRecorder: NativeObservationRecorder | null = null;

  /**
   * The record a verify action writes to. Inside a turn this is the turn's own recorder
   * (`verifyTurnRecorder`), so the turn's later writes never overwrite the verdicts;
   * outside a turn it is prepared from the saved batch. Learning events need `/2`.
   */
  private async verifyRecorder(): Promise<VerifyRecorderPort | null> {
    // During a re-test every verify action (the panel's view included) uses the re-test's
    // recorder; outside one, nothing is held.
    const retest = this.verifySession.retestActive;
    if (!retest) this.verifyRunRecorder = null;
    const recorder = (retest ? this.verifyRunRecorder : null) ?? this.verifyTurnRecorder ?? (this.nativeObservation?.batch.format === 'hps-observation/2' ? this.nativeObservation : await this.currentLearningRecorder());
    if (!recorder) return null;
    if (retest) this.verifyRunRecorder = recorder;
    const profile = await this.ensureProfile();
    const task = this.learningTaskId(profile?.lesson?.sha256, activityConnections(this.context)?.current?.id);
    const context = verifyContext({
      week: profile?.lesson?.content?.learning?.week,
      stepId: profile?.lesson?.content?.steps?.[0]?.id,
      task,
      moduleVersion: profile?.lesson?.version,
    });
    return {
      events: () => recorder.batch.events,
      record: (kind, text, extra) => recordChecked(recorder.batch, validateObservation, () => recorder.record(task, kind, text, extra)),
      recordLearning: (draft) => recordChecked(recorder.batch, validateObservation, () => recorder.recordLearningEvent({ ...draft, context })),
      persist: () => this.persistObservation(recorder),
    };
  }

  /** Post the panel state; `sendText` is the student's sentence the panel sends next. */
  private async postVerifyState(extra: { sendText?: string; requestId?: string; error?: string } = {}): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.post({ type: "verifyState", view: null });
      return;
    }
    await this.post({ type: "verifyState", view: await this.verifySession.view(), ...extra });
  }

  /** CR-12 — the "Test my product" command: re-checks the served switch, then opens the panel. */
  async testMyProduct(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(refusalText("switch_off", this.getSeatAudience()), "lesson");
      return;
    }
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await this.postVerifyState();
  }

  /** One verify action from the panel, each behind the served switch (a message can be posted without the panel). */
  private async handleVerifyMessage(msg: { type: "verifyOpen" } | { type: "verifyStart"; requestId: string; criteria: unknown } | { type: "verifyRetest" } | { type: "verifyFix"; requestId: string; criterionId: string; text: string } | { type: "verifyPark" } | { type: "verifyResume"; requestId: string }): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.postDenialNotice("lesson");
      await this.post({ type: "verifyState", view: null, error: refusalText("switch_off", this.getSeatAudience()) });
      return;
    }
    if (msg.type === "verifyOpen") return this.postVerifyState();
    // CGP-SHELL-R-011 N1 — never refused as busy: an unsendable handed-back turn must leave the live slots.
    if (msg.type === "verifyPark") { this.verifySession.park(); return; }
    // A run or re-test while the coach is answering would share the tab and the record with that turn.
    if (this.pendingSends > 0 || this.activeStreams.size > 0) return this.postVerifyState({ error: refusalText("turn_running") });
    if (msg.type === "verifyStart") {
      const r = await this.verifySession.start(msg.criteria);
      return this.postVerifyState(r.ok ? { sendText: r.sendText, requestId: String(msg.requestId ?? "") } : { error: refusalText(r.code) });
    }
    if (msg.type === "verifyResume") {
      const r = this.verifySession.resume();
      return this.postVerifyState(r.ok ? { sendText: r.sendText, requestId: String(msg.requestId ?? "") } : { error: refusalText(r.code) });
    }
    if (msg.type === "verifyFix") {
      const r = await this.verifySession.fix(msg.criterionId, msg.text);
      return this.postVerifyState(r.ok ? { sendText: r.sendText, requestId: String(msg.requestId ?? "") } : { error: refusalText(r.code) });
    }
    const pending = this.verifySession.retest();
    await this.postVerifyState();
    const r = await pending;
    await this.postVerifyState(r.ok ? {} : { error: refusalText(r.code) });
  }

  // ── Publish for User Test (cr-publish, #1393) ─────────────────────────────
  /** The signed-in person's Project id and test origin, keyed by crBytesOwner (a digest, never the identity). */
  private readonly crProjectMemory = new CrProjectMemory(
    {
      get: () => this.context.workspaceState.get<unknown>(CR_PROJECTS_STATE),
      update: (value) => this.context.workspaceState.update(CR_PROJECTS_STATE, value),
    },
    async () => (await this.context.secrets.get(TOKEN_KEY)) ?? null,
  );
  /** "사용자 테스트용으로 공개": the session over the preview's files, the record and the Service. */
  private readonly publishSession = new PublishSession({
    previewVisitor: showVisitorPreview,
    confirmOutbound,
    scopeKey: () => String(this.profileGeneration),
    privateDirectories: () => this.cachedProfile?.learning_wiki?.plan?.dir ? [this.cachedProfile.learning_wiki.plan.dir] : [],
    switchOn: () => this.isCurriculumRuntimeEnabled(),
    audience: () => this.getSeatAudience(),
    token: () => this.crProjectMemory.refresh(),
    base: () => curriculumBase(vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1")),
    root: () => this.liveServer.currentRoot() ?? null,
    entry: () => {
      const base = this.liveServer.currentUrl();
      return base ? new URL(base).pathname || "/" : null;
    },
    events: async () => (await this.verifyRecorder())?.events() ?? [],
    projectId: () => this.crProjectMemory.projectId(),
    setProjectId: (id) => this.crProjectMemory.set(id ? { id } : { id: undefined, origin: null }),
    rememberedOrigin: () => this.crProjectMemory.origin(),
    rememberOrigin: (origin) => this.crProjectMemory.set({ origin }),
    week: () => {
      const w = this.cachedProfile?.lesson?.content?.learning?.week;
      return typeof w === "number" ? w : null;
    },
    defaultTitle: () => vscode.workspace.workspaceFolders?.[0]?.name ?? "내 제품",
    qr: qrDataUrl,
  });

  private readonly publishReadGate = new PublishReadGate();

  /** Post the publish panel state (null hides it with the switch off). */
  private async postPublishState(extra: { error?: string; errorLines?: string[]; shareUrl?: string } = {}): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.post({ type: "publishState", view: null, ...extra });
      return;
    }
    await this.publishReadGate.read(() => this.readPublishView(), async view => { await this.post({ type: "publishState", view, ...extra }); });
  }

  /** The last read that answered, kept per scope: a failed read shows it marked stale, never as current. */
  private lastGoodPublish: { scope: string; at: number; view: import("./publishView").PublishView } | null = null;

  /** One sharing read. A read that failed keeps the last good rows (same scope) with `read_failed` and the time they were read. */
  private async readPublishView(): Promise<import("./publishView").PublishView> {
    const scope = this.publishSession.readScope();
    const view = await this.publishSession.view();
    if (view.available) { this.lastGoodPublish = { scope, at: Date.now(), view }; return view; }
    const last = this.lastGoodPublish;
    if (!view.read_failed || !last || last.scope !== scope) { if (!view.read_failed) this.lastGoodPublish = null; return view; }
    return { ...last.view, read_failed: true, stale_at: last.at, reason: view.reason, notice: view.notice };
  }

  /** CR-17 — the "Publish for user test" command: re-checks the served switch, then opens the panel. */
  async publishTestVersion(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(lessonFeatureOff("사용자 테스트 공개", this.getSeatAudience()), "lesson");
      return;
    }
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    this.publishReadGate.open();
    await this.postPublishState();
  }

  /** One publish action from the panel, each behind the served switch (a message can be posted without the panel). */
  private async handlePublishMessage(msg: { type: "publishRefresh" } | { type: "publishClose" } | { type: "publishOpen"; manifest?: string[] } | { type: "publishSubmit"; form: import("./publishView").PublishForm } | { type: "publishLink"; experimentId: string; channel?: string; expiresInDays?: number } | { type: "publishRevoke"; linkId: string } | { type: "publishCopy"; versionId: string }): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.postDenialNotice("lesson");
      await this.post({ type: "publishState", view: null, error: lessonFeatureOff("사용자 테스트 공개", this.getSeatAudience()) });
      this.publishReadGate.close();
      return;
    }
    if (msg.type === "publishClose") { this.publishReadGate.close(); return; }
    if (msg.type === "publishRefresh") {
      if (this.publishReadGate.canRefresh) await this.postPublishState();
      return;
    }
    if (msg.type === "publishOpen") this.publishReadGate.open();
    this.publishReadGate.beginAction();
    try {
      if (msg.type === "publishOpen") {
        if (msg.manifest !== undefined) this.publishSession.setManifest(msg.manifest);
        return this.postPublishState();
      }
      if (msg.type === "publishCopy") {
        const error = await this.publishSession.copyLink(String(msg.versionId ?? ""), url => vscode.env.clipboard.writeText(url));
        return this.postPublishState(error ? { error } : {});
      }
      if (msg.type === "publishSubmit") {
        const r = await this.publishSession.submit(msg.form ?? ({} as import("./publishView").PublishForm));
        return this.postPublishState(r.ok ? { shareUrl: r.share_url } : { error: r.message, ...(r.lines ? { errorLines: r.lines } : {}) });
      }
      if (msg.type === "publishLink") {
        const r = await this.publishSession.link(String(msg.experimentId ?? ""), { channel: msg.channel, expires_in_days: msg.expiresInDays });
        return this.postPublishState(r.ok ? { shareUrl: r.share_url } : { error: r.message });
      }
      const r = await this.publishSession.revoke(String(msg.linkId ?? ""));
      return this.postPublishState(r.ok ? {} : { error: r.message });
    } finally { this.publishReadGate.endAction(); }
  }

  // ── Experiment evidence (cr-evidence, #1394) ──────────────────────────────
  /** The evidence panel over the same Project the publish panel remembers; reads and writes go to the Service. */
  private readonly evidenceSession = new EvidenceSession({
    switchOn: () => this.isCurriculumRuntimeEnabled(),
    audience: () => this.getSeatAudience(),
    token: () => this.crProjectMemory.refresh(),
    base: () => curriculumBase(vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1")),
    projectId: () => this.crProjectMemory.projectId(),
  });

  /** Post the evidence panel state (null hides it with the switch off). */
  private async postEvidenceState(extra: { error?: string; done?: string } = {}, select?: string): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.post({ type: "evidenceState", view: null, ...extra });
      return;
    }
    await this.post({ type: "evidenceState", view: await this.evidenceSession.view(select), ...extra });
  }

  /** CR-24–CR-27 — the "실험 증거 보기" command: re-checks the served switch, then opens the panel. */
  async experimentEvidence(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(lessonFeatureOff("실험 증거", this.getSeatAudience()), "lesson");
      return;
    }
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await this.postEvidenceState();
  }

  /** One evidence action from the panel, each behind the served switch (a message can be posted without the panel). */
  private async handleEvidenceMessage(
    msg:
      | { type: "evidenceOpen"; experimentId?: string }
      | { type: "evidenceNote"; experimentId: string; note: import("./evidenceView").NoteForm }
      | { type: "evidenceDraft"; experimentId: string }
      | { type: "evidenceReview"; experimentId: string; draftId: string; revision: number; actions: Array<{ item: string; action: "accept" | "edit" | "reject"; text?: string }> }
      | { type: "evidenceDelete"; experimentId: string; sessionId?: string },
  ): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.postDenialNotice("lesson");
      await this.post({ type: "evidenceState", view: null, error: lessonFeatureOff("실험 증거", this.getSeatAudience()) });
      return;
    }
    if (msg.type === "evidenceOpen") return this.postEvidenceState({}, msg.experimentId);
    const exp = String(msg.experimentId ?? "");
    if (msg.type === "evidenceNote") {
      const r = await this.evidenceSession.addNote(exp, msg.note ?? ({} as import("./evidenceView").NoteForm));
      return this.postEvidenceState(r.ok ? { done: "기록을 남겼어요." } : { error: r.message });
    }
    if (msg.type === "evidenceDraft") {
      const r = await this.evidenceSession.makeDraft(exp);
      return this.postEvidenceState(r.ok ? { done: "기록에서 초안을 만들었어요. 읽어 보고 받아들이거나 고쳐 주세요." } : { error: r.message });
    }
    if (msg.type === "evidenceReview") {
      const r = await this.evidenceSession.review(exp, String(msg.draftId ?? ""), Number(msg.revision), Array.isArray(msg.actions) ? msg.actions : []);
      return this.postEvidenceState(r.ok ? {} : { error: r.message });
    }
    // CR-69 — deleting participant records is the person's explicit act, behind a modal.
    const what = msg.sessionId ? "이 참가 세션의 기록" : "이 실험의 참가 기록 · 메모 · 초안 전부";
    const pick = await vscode.window.showWarningMessage(`${what}을 지울까요? 지운 기록은 되돌릴 수 없고, 그 기록을 근거로 쓴 초안도 함께 지워져요.`, { modal: true }, "지우기");
    if (pick !== "지우기") return this.postEvidenceState();
    const r = await this.evidenceSession.delete(exp, msg.sessionId ? String(msg.sessionId) : undefined);
    return this.postEvidenceState(r.ok ? { done: "지웠어요. 지운 기록의 영수증이 남았어요." } : { error: r.message });
  }

  // ── Venture Memory (cr-memory, #1395) ──────────────────────────────────────
  /** The memory panel over the same Project the publish panel remembers; it reads the Service only, never chat history (CR-36). */
  private readonly memorySession = new MemorySession({
    switchOn: () => this.isCurriculumRuntimeEnabled(),
    audience: () => this.getSeatAudience(),
    token: () => this.crProjectMemory.refresh(),
    base: () => curriculumBase(vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1")),
    projectId: () => this.crProjectMemory.projectId(),
  });

  /** Post the memory panel state (null hides it with the switch off). */
  private async postMemoryState(extra: { error?: string; done?: string } = {}): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.post({ type: "memoryState", view: null, ...extra });
      return;
    }
    await this.post({ type: "memoryState", view: await this.memorySession.view(), ...extra });
  }

  /** CR-35/CR-36 — the "프로젝트 기억 보기" command: re-checks the served switch, then opens the panel. */
  async ventureMemory(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(lessonFeatureOff("프로젝트 기억", this.getSeatAudience()), "lesson");
      return;
    }
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await this.postMemoryState();
  }

  // ── Learning wiki and deck generator (generic skills; a cohort specializes them via learning_wiki.plan) ──

  /** Is the learning wiki on for the served profile? Re-read at every use. */
  isLearningWikiEnabled(): boolean {
    return this.cachedProfile?.learning_wiki?.enabled === true;
  }

  private learningWikiPlan(): LearningWikiPlan | undefined {
    return this.cachedProfile?.learning_wiki?.plan;
  }

  /** The command "팀 브레인에 정리하기": always asks which session (the palette is where any session can be picked). */
  async wikiIngest(): Promise<void> {
    const run = await this.runWikiIngest({ ask: true });
    if (run) await this.showBrainRun(run);
  }

  /** The command "팀 브레인으로 덱 만들기": the student picks the slides (the latest session's focus is preselected). */
  async deckDraft(): Promise<void> {
    const run = await this.runDeckDraft({ ask: true });
    if (run) await this.showBrainRun(run);
  }

  /** A command's result: in-chat, not a toast (a notification pauses the integrated browser over the weekly pack). */
  private async showBrainRun(run: BrainRun): Promise<void> {
    this.postPageNotice(run.lines.join(" "));
    if (run.open) await this.openBrainFile(run.open);
  }

  private async openBrainFile(file: string): Promise<void> {
    await vscode.commands.executeCommand(file.endsWith(".html") ? "hypeproof-chat.previewActiveFile" : "vscode.open", vscode.Uri.file(file));
  }

  /**
   * The wiki called by name in the chat ("팀 브레인에 정리해 줘", "팀 브레인으로 덱 만들어 줘",
   * "팀 브레인에 뭐 있어?"). The skill runs here instead of a coach turn and its report is the reply
   * bubble; the stream stays open while it works, so the chat shows it is busy. The student's sentence
   * and the reply are recorded like the other answers the App writes itself (show intent, guest list),
   * and neither goes to the spool, so the next ingest reads only the class conversation.
   */
  private async answerBrainCall(text: string, intent: BrainIntent, deferCompletion: (streamId: string) => void, onStart: (streamId: string) => void, userMessageId?: string): Promise<void> {
    const name = brainName(this.learningWikiPlan());
    const uid = randomId();
    const aid = randomId();
    onStart(uid);
    void this.post({ type: "streamStart", streamId: uid, messageId: aid, ...(userMessageId ? { userMessageId } : {}) });
    let run: BrainRun | undefined;
    try {
      run = intent.kind === "show" ? this.brainShow() : intent.kind === "deck" ? await this.runDeckDraft({ ask: false }) : await this.runWikiIngest({ ask: false, session: intent.session });
      run ??= { lines: [intent.kind === "deck" ? "덱 초안은 쓰지 않았어요." : `정리하지 않았어요. ${josa(name, "은", "는")} 그대로예요.`] };
    } catch (err) {
      this.logChannel?.appendLine(`[learning-wiki] ${err instanceof Error ? err.message : String(err)}`);
      run = { lines: [`${name} 작업이 중간에 멈췄어요. 잠시 뒤 다시 해 주세요.`] };
    }
    // Markdown hard breaks: one short sentence per line in one bubble.
    const reply = run.lines.join("  \n");
    void this.post({ type: "streamChunk", streamId: uid, delta: reply });
    await this.appendHistory([
      { id: randomId(), role: "user", content: text, createdAt: Date.now() },
      { id: aid, role: "assistant", content: reply, createdAt: Date.now(), assistantName: this.coachDisplayName() },
    ]);
    if (run.open) await this.openBrainFile(run.open);
    deferCompletion(uid);
  }

  /** "팀 브레인에 뭐 있어?": the summary from the wiki state; no model call, nothing opened. */
  private brainShow(): BrainRun {
    const plan = this.learningWikiPlan();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const dir = root ? wikiDir(root, plan) : null;
    return { lines: brainSummary(dir ? loadState(dir) : null, plan, dir ? path.basename(dir) : "") };
  }

  /**
   * The wiki skill on this session's conversation (the spool's events.jsonl) and the notes in
   * <wiki>/notes/, then, when the plan names slides for that session, the deck skill on those slides.
   * Each skill is one non-streaming coach-route request; only cited items are kept. Nothing is stored
   * on the Service. Returns what to tell the student, or undefined when the student closed the pick.
   */
  private async runWikiIngest(opts: { ask: boolean; session?: number }): Promise<BrainRun | undefined> {
    const plan = this.learningWikiPlan();
    const name = brainName(plan);
    if (!this.isLearningWikiEnabled()) { await this.postDenialNotice("lesson"); return { lines: [lessonFeatureOff(name, this.getSeatAudience())] }; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { lines: ["작업 폴더를 먼저 열어 주세요."] };
    const label = sessionLabel(plan);
    const dir = wikiDir(folder.uri.fsPath, plan);
    const folderBlocked = this.folderWriteRefusalFor(dir);
    if (folderBlocked) return { lines: [folderBlocked] };
    const state = initWiki(dir, productTitle(folder.uri.fsPath) ?? folder.name, plan);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const session = await this.ingestSession(state, plan, today, opts);
    if (session === undefined) return undefined;
    try { await this.spool?.flush(); } catch {}
    const sessionDir = this.spool?.currentSessionDir() ?? null;
    let events = "";
    try { if (sessionDir) events = fs.readFileSync(path.join(sessionDir, "events.jsonl"), "utf8"); } catch {}
    const sources = { turns: turnsFromEvents(events), notes: readNotes(dir) };
    if (!sources.turns.length && !Object.keys(sources.notes).length) return { lines: ["정리할 대화나 메모가 아직 없어요."] };
    const sid = sessionHash(session, sources);
    if (state.sessions_ingested.includes(sid)) return { lines: [`${session}${label} 이 대화는 이미 정리했어요.`] };
    const answer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `HypeProof: ${name}에 정리하는 중` },
      () => this.completeSkill(wikiPrompt(state, session, sources, plan), {}),
    );
    const proposal = answer.ok ? jsonFromText<WikiProposal>(answer.text) : null;
    if (!proposal) return { lines: [`정리하지 못했어요. ${josa(name, "은", "는")} 그대로예요. 잠시 뒤 다시 해 주세요.`] };
    const r = applyWikiProposal(state, session, sources, proposal, sid, today, plan);
    writeWiki(dir, r.state, plan);
    archiveNotes(dir, sources.notes);
    const focus = sessionFocus(plan, session);
    const deck = plan?.deck && focus.length ? await this.draftDeck(dir, r.state, plan, focus, session) : null;
    const info = { session, turns: sources.turns.length, notes: Object.keys(sources.notes).length };
    return {
      lines: ingestReport(state, r, info, plan, { deck: deck ? deckReport(deck) : undefined, opened: plan?.deck ? "덱 미리보기를 열었어요." : "index.md를 열었어요." }),
      open: path.join(dir, plan?.deck ? "deck.html" : "index.md"),
    };
  }

  /** CGP-KNOW-R-004 — "팀 브레인에 정리하기" on one finished answer; the result is an in-chat notice like the command's. */
  private async handleAnswerToWiki(msg: unknown): Promise<void> {
    if (this.answerToWikiBusy) return;
    this.answerToWikiBusy = true;
    try {
      const run = await this.runAnswerToWiki(msg);
      if (run) await this.showBrainRun(run);
    } catch (err) {
      this.logChannel?.appendLine(`[learning-wiki] ${err instanceof Error ? err.message : String(err)}`);
      this.postPageNotice(`${brainName(this.learningWikiPlan())} 작업이 중간에 멈췄어요. 잠시 뒤 다시 해 주세요.`);
    } finally {
      this.answerToWikiBusy = false;
    }
  }
  private answerToWikiBusy?: boolean;

  /**
   * The write question's refusal for the one-answer filing, worded for the choice made: "AI 안 씀"
   * reads as its own copy here (folderWriteRefusal words every non-full choice as read-only).
   */
  private answerToWikiRefusalCopy(refusal: string | null): string | null {
    if (!refusal) return null;
    return folderNoAiRefusal(this.context, this.cachedProfile, this.folderConsentOpts()) ?? refusal;
  }

  /**
   * CGP-KNOW-R-004 (REQ-STUDIO-ANSWER-TO-WIKI) — files ONE finished answer and the question that
   * prompted it. The seat gate is the session ingest's (the served learning_wiki switch and the folder
   * consent), narrowed to where the answer's action row exists: personal task chat, never a lesson or
   * instructor mode (as handleAnswerVerdict). The proposal is the session ingest's (wikiPrompt and
   * applyWikiProposal over a one-turn source; the prompt shows it as t1 and its citations are mapped
   * back to the answer's message id); applyWikiProposal is
   * pure, so the learner sees exactly what it would add and nothing is written until they confirm.
   * The write is the session ingest's writer (writeWiki), which reports every file to the
   * provenance hook. Undefined: nothing to say (a request the action row would not have offered).
   */
  private async runAnswerToWiki(msg: unknown): Promise<BrainRun | undefined> {
    const messageId = (msg as { messageId?: unknown } | null)?.messageId;
    const store = this.currentTaskStore?.();
    const taskId = store?.getView().activeTaskId;
    if (typeof messageId !== "string" || !store || !taskId || this._instructorMode.isInstructor || this.cachedProfile?.lesson) return undefined;
    const plan = this.learningWikiPlan();
    const name = brainName(plan);
    if (!this.isLearningWikiEnabled()) { await this.postDenialNotice("lesson"); return { lines: [lessonFeatureOff(name, this.getSeatAudience())] }; }
    // The saved conversation holds finished turns only, so a streaming answer is not found here.
    const sources = answerSources(store.getHistory(taskId), messageId);
    if (!sources) return undefined;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { lines: ["작업 폴더를 먼저 열어 주세요."] };
    const dir = wikiDir(folder.uri.fsPath, plan);
    // Before the model call: 읽기만, AI 안 씀 and an undecided folder (fail closed, never asked here) refuse.
    const folderBlocked = this.answerToWikiRefusalCopy(this.folderWriteRefusalFor(dir));
    if (folderBlocked) return { lines: [folderBlocked] };
    // No initWiki before the confirmation: it would create the folder and its pages.
    const existing = loadState(dir);
    const state = existing ?? newState(productTitle(folder.uri.fsPath) ?? folder.name);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const session = await this.ingestSession(state, plan, today, { ask: false });
    if (session === undefined) return undefined;
    const sid = sessionHash(session, sources);
    if (state.sessions_ingested.includes(sid)) return { lines: [`이 답은 이미 ${name}에 정리했어요.`] };
    const answer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `HypeProof: ${name}에 정리하는 중` },
      () => this.completeSkill(wikiPrompt(state, session, answerPromptSources(sources), plan), {}),
    );
    const raw = answer.ok ? jsonFromText<WikiProposal>(answer.text) : null;
    if (!raw) return { lines: [`정리하지 못했어요. ${josa(name, "은", "는")} 그대로예요. 잠시 뒤 다시 해 주세요.`] };
    // The prompt numbered the turn t1 (its own id rule); citations of t1 are this answer's message id.
    const r = applyWikiProposal(state, session, sources, answerProposal(raw, sources.turns[0].id), sid, today, plan);
    const preview = proposalPreview(state, r.state);
    if (!preview.length) return { lines: [`이 답에서 새로 정리할 내용을 찾지 못했어요. ${josa(name, "은", "는")} 그대로예요.`] };
    const pick = await vscode.window.showInformationMessage(
      `${name}에 이렇게 정리할까요?`,
      { modal: true, detail: [...preview, "", `이 답과 질문만 읽었어요 (${session}${sessionLabel(plan)}).`].join("\n") },
      "정리하기",
    );
    if (pick !== "정리하기") return { lines: [`정리하지 않았어요. ${josa(name, "은", "는")} 그대로예요.`] };
    // Re-checked after the modal: the seat or the folder may have changed, or another run filed meanwhile.
    if (this._instructorMode.isInstructor || this.cachedProfile?.lesson || !this.isLearningWikiEnabled()) { await this.postDenialNotice("lesson"); return { lines: [lessonFeatureOff(name, this.getSeatAudience())] }; }
    const lateRefusal = this.answerToWikiRefusalCopy(this.folderWriteRefusalFor(dir));
    if (lateRefusal) return { lines: [lateRefusal] };
    if (JSON.stringify(loadState(dir)) !== JSON.stringify(existing)) return { lines: [`그사이 ${josa(name, "이", "가")} 바뀌었어요. 다시 해 주세요.`] };
    if (!existing) initWiki(dir, state.team, plan);
    writeWiki(dir, r.state, plan);
    return { lines: ingestReport(state, r, { session, turns: 1, notes: 0 }, plan) };
  }

  /**
   * Which session an ingest files under. The command always asks. A chat call takes the session the
   * student named ("2주차 …"), else the next session without a click, and asks only when the latest
   * session was already filed today (defaultIngestSession).
   */
  private async ingestSession(state: WikiState, plan: LearningWikiPlan | undefined, today: string, opts: { ask: boolean; session?: number }): Promise<number | undefined> {
    const label = sessionLabel(plan);
    if (opts.session !== undefined && opts.session >= 1 && opts.session <= sessionCount(plan)) return opts.session;
    if (opts.ask || opts.session !== undefined) return this.pickSession(state, plan, `몇 ${label} 수업을 정리할까요?`);
    const d = defaultIngestSession(state, plan, today);
    if (!d.ambiguous) return d.session;
    return this.pickSession(state, plan, `오늘 ${d.last}${josa(label, "을", "를")} 이미 정리했어요. 어느 ${label}에 정리할까요?`, [d.last, d.session]);
  }

  /** The deck skill on the latest session's slides: the plan's focus in the chat, the student's pick from the command (or when there is no focus). */
  private async runDeckDraft(opts: { ask: boolean }): Promise<BrainRun | undefined> {
    const plan = this.learningWikiPlan();
    const name = brainName(plan);
    if (!this.isLearningWikiEnabled()) { await this.postDenialNotice("lesson"); return { lines: [lessonFeatureOff("덱 초안", this.getSeatAudience())] }; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || !plan?.deck) return { lines: ["이 수업에는 덱 템플릿이 없어요."] };
    const dir = wikiDir(folder.uri.fsPath, plan);
    const folderBlocked = this.folderWriteRefusalFor(dir);
    if (folderBlocked) return { lines: [folderBlocked] };
    const state = loadState(dir);
    if (!state || !state.sessions.length) return { lines: [`먼저 수업 내용을 ${name}에 정리해 주세요. "${name}에 정리해 줘"라고 말하면 돼요.`] };
    const last = Math.max(...state.sessions);
    let slides = sessionFocus(plan, last);
    if (opts.ask || !slides.length) {
      const focus = new Set(slides);
      const picked = await vscode.window.showQuickPick(
        plan.deck.slides.map((x) => ({ label: `${x.no} · ${x.title}`, description: x.question, picked: focus.has(x.no), no: x.no })),
        { canPickMany: true, placeHolder: "초안을 쓸 장을 고르세요" },
      );
      if (!picked?.length) return undefined;
      slides = picked.map((x) => x.no);
    }
    const d = await this.draftDeck(dir, state, plan, slides, last);
    return { lines: [deckReport(d), "덱 미리보기를 열었어요."], open: path.join(dir, "deck.html") };
  }

  /** One deck-skill run; writes deck/ and deck.html and returns what happened (deckReport words it). */
  private async draftDeck(dir: string, state: WikiState, plan: LearningWikiPlan, slides: number[], session: number): Promise<DeckRun> {
    const template = plan.deck!;
    const answer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "HypeProof: 덱 초안 쓰는 중" },
      () => this.completeSkill(deckPrompt(state, template, slides, plan), {}),
    );
    const proposal = answer.ok ? jsonFromText<DeckProposal>(answer.text) : null;
    if (!proposal) {
      writeFiles(dir, renderDeck(state, template, plan));
      return { written: [], drafted: Object.keys(state.deck).length, total: template.slides.length, refused: 0, failed: true };
    }
    let r = applyDeckProposal(state, template, slides, proposal, session);
    // One repair round for slides the gate refused (no resolvable citation, or a number the evidence lacks).
    const refused = refusedSlides(r.dropped);
    if (refused.length) {
      const again = await this.completeSkill(deckRepairPrompt(r.state, template, refused, plan), {});
      const fix = again.ok ? jsonFromText<DeckProposal>(again.text) : null;
      if (fix) {
        const r2 = applyDeckProposal(r.state, template, refused.map((x) => x.no), fix, session);
        r = { state: r2.state, dropped: r2.dropped, written: [...r.written, ...r2.written] };
      }
    }
    // The humanizer skill on what was written (quotes stay verbatim; a rewrite that adds a number is refused).
    const texts = slideTextItems(r.state, r.written);
    if (texts.length) {
      const h = await this.completeSkill(humanizePrompt(texts, "발표 슬라이드 문장"), {});
      const fixed = applyHumanized(texts, h.ok ? jsonFromText<HumanizeProposal>(h.text) : null);
      r = { ...r, state: applySlideText(r.state, fixed.items) };
    }
    saveState(dir, r.state);
    writeFiles(dir, { ...renderWikiPages(r.state, plan), ...renderDeck(r.state, template, plan) }, "ai");
    return { written: r.written, drafted: Object.keys(r.state.deck).length, total: template.slides.length, refused: r.dropped.length, failed: false };
  }

  /** Every session, or only `only` ([the session filed today, the next one]) when a chat call was ambiguous. */
  private async pickSession(state: WikiState, plan: LearningWikiPlan | undefined, placeHolder: string, only?: number[]): Promise<number | undefined> {
    const label = sessionLabel(plan);
    const count = sessionCount(plan);
    const last = state.sessions.length ? Math.max(...state.sessions) : 0;
    const next = Math.min(last + 1, count);
    const describe = (n: number) => (only ? (n === last ? `오늘 정리한 ${label}에 더하기` : `다음 ${ro(label)} 새로 정리`) : n === next ? `이번 ${label}` : undefined);
    const pick = await vscode.window.showQuickPick(
      (only ?? Array.from({ length: count }, (_, i) => i + 1)).map((n) => ({ label: `${n}${label}`, description: describe(n), n })),
      { placeHolder },
    );
    return pick?.n;
  }

  // ── Curriculum skills (cr-skills, #1396) ────────────────────────────────────
  /**
   * The skills panel over the same Project the publish panel remembers. The skill list and every
   * contract come from the Service; the model call goes through the existing coach route with the
   * run's skill tag and capability (CR-45), never a model id; the Service gates the answer (CR-44).
   */
  private readonly skillSession = new SkillSession({
    switchOn: () => this.isCurriculumRuntimeEnabled(),
    audience: () => this.getSeatAudience(),
    token: () => this.crProjectMemory.refresh(),
    base: () => curriculumBase(this.proxyUrl()),
    projectId: () => this.crProjectMemory.projectId(),
    complete: (prompt, headers) => this.completeSkill(prompt, headers),
  });

  private proxyUrl(): string {
    return vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
  }

  /**
   * One non-streaming request on the coach route, carrying only the run's metadata headers and no
   * model. On a lesson seat it names the lesson binding the profile serves, as a coach turn does
   * (#751 U3), so a switched lesson version admits the request instead of refusing it.
   */
  private async completeSkill(prompt: string, headers: Record<string, string>): Promise<SkillCompletion> {
    const folderRefusal = await this.folderAiRefusal();
    if (folderRefusal) { this.postPageNotice(folderRefusal, "folder"); return { ok: false }; }
    const token = await this.crProjectMemory.refresh();
    if (!token) return { ok: false };
    const profile = await this.ensureProfile().catch(() => null);
    const binding = lessonBindingHeader(profile?.lesson_binding?.enforced ? profile.lesson_binding.key : undefined);
    return completeSkillRequest(fetch, { proxyUrl: this.proxyUrl(), baseHeaders: buildProxyHeaders({ token }), binding, prompt, headers });
  }

  /** Post the skills panel state (null hides it with the switch off). */
  private async postSkillsState(extra: { error?: string; done?: string } = {}): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.post({ type: "skillsState", view: null, ...extra });
      return;
    }
    await this.post({ type: "skillsState", view: await this.skillSession.view(), running: this.skillSession.isRunning(), ...extra });
  }

  /** CR-43 — the "커리큘럼 스킬" command: re-checks the served switch, then opens the panel. */
  async curriculumSkills(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(lessonFeatureOff("커리큘럼 스킬", this.getSeatAudience()), "lesson");
      return;
    }
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await this.postSkillsState();
  }

  /** One skills action from the panel, behind the served switch (a message can be posted without the panel). */
  private async handleSkillsMessage(msg: { type: "skillsOpen" } | { type: "skillRun"; skill: string; form: import("./skillView").SkillForm }): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.postDenialNotice("lesson");
      await this.post({ type: "skillsState", view: null, error: lessonFeatureOff("커리큘럼 스킬", this.getSeatAudience()) });
      return;
    }
    if (msg.type === "skillsOpen") return this.postSkillsState();
    const f = msg.form ?? {};
    const form: import("./skillView").SkillForm = {
      ...(typeof f.experiment_id === "string" ? { experiment_id: f.experiment_id } : {}),
      ...(typeof f.decision_id === "string" ? { decision_id: f.decision_id } : {}),
      ...(Array.isArray(f.evidence_refs) ? { evidence_refs: f.evidence_refs.map(String) } : {}),
      ...(typeof f.text === "string" ? { text: f.text } : {}),
      ...(typeof f.notes === "string" ? { notes: f.notes } : {}),
    };
    void this.post({ type: "skillsState", view: await this.skillSession.view(), running: true });
    const r = await this.skillSession.run(String(msg.skill ?? ""), form);
    return this.postSkillsState(r.ok ? { done: "AI의 답이 규칙을 지켰어요." } : { error: r.message });
  }

  // ── Weekly Review (cr-review, #1398) ────────────────────────────────────────
  /**
   * The student's "주간 리뷰" over the same Project the publish panel remembers, and, with the
   * issuer token, the director's overview, pack and decision. The model call goes through the
   * existing coach route with the Experiment skill's tag and capability (CR-45), never a model
   * id, and only for a stale model section (CR-49); opening never calls a model (CR-50).
   */
  private readonly reviewSession = new ReviewSession({
    switchOn: () => this.isCurriculumRuntimeEnabled(),
    audience: () => this.getSeatAudience(),
    token: () => this.crProjectMemory.refresh(),
    directorToken: async () => (await resolveInstructorTokenFromSecrets(this.context.secrets)) ?? null,
    base: () => curriculumBase(this.proxyUrl()),
    projectId: () => this.crProjectMemory.projectId(),
    complete: (prompt, headers) => this.completeSkill(prompt, headers),
  });

  /** CR_DIRECTOR_CONTEXT_KEY as last answered, per issuer token. */
  private crDirector: { token: string | null; on: boolean; at: number } = { token: null, on: false, at: 0 };

  /**
   * CR-02 for the director (cr-review): mirror "the stored issuer token directs a cohort whose
   * profile has the switch on" to CR_DIRECTOR_CONTEXT_KEY, from the Service's answer (a director
   * has no served student profile). Asked again when the token changes, after five minutes, or
   * when `force`d, and, while the key is on, every five minutes by the constructor's timer, so the
   * palette entry goes within five minutes of the Service's switch going off; false without an
   * issuer token or with any refusal.
   */
  async refreshCrDirectorContext(force = false): Promise<boolean> {
    const token = (await resolveInstructorTokenFromSecrets(this.context.secrets)) ?? null;
    if (!force && token === this.crDirector.token && Date.now() - this.crDirector.at < 5 * 60_000) return this.crDirector.on;
    const on = token ? await directorAvailable({ base: curriculumBase(this.proxyUrl()), token }) : false;
    this.crDirector = { token, on, at: Date.now() };
    void vscode.commands.executeCommand("setContext", CR_DIRECTOR_CONTEXT_KEY, on);
    return on;
  }

  /** Post the review panel state, the student's or the director's (null hides it with the switch off). */
  private async postReviewState(mode: "student" | "director", extra: { error?: string; done?: string } = {}, week?: number): Promise<void> {
    if (mode === "student") {
      if (!this.isCurriculumRuntimeEnabled()) {
        await this.post({ type: "reviewState", view: null, ...extra });
        return;
      }
      await this.post({ type: "reviewState", view: await this.reviewSession.studentView(week), ...extra });
      return;
    }
    if (!(await this.refreshCrDirectorContext())) {
      await this.post({ type: "reviewState", view: null, ...extra });
      return;
    }
    await this.post({ type: "reviewState", view: await this.reviewSession.directorView(), ...extra });
  }

  /** CR-49 — "주간 리뷰" (the student's): re-checks the served switch, then opens the panel. */
  async weeklyReview(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(lessonFeatureOff("주간 리뷰", this.getSeatAudience()), "lesson");
      return;
    }
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await this.postReviewState("student");
  }

  /** CR-50, CR-53 — "주간 리뷰 (디렉터)": re-checks the switch through the Service for the issuer token, then opens the overview. */
  async weeklyReviewDirector(): Promise<void> {
    if (!(await this.refreshCrDirectorContext(true))) {
      this.postPageNotice(DIRECTOR_REVIEW_UNAVAILABLE, "unknown");
      return;
    }
    this.reviewSession.select(null);
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    await this.postReviewState("director");
  }

  /** The student's review actions, behind the served switch (a message can be posted without the panel). */
  private async handleReviewMessage(msg: { type: "reviewOpen"; week?: number } | { type: "reviewPrepare"; week?: number }): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.postDenialNotice("lesson");
      await this.post({ type: "reviewState", view: null, error: lessonFeatureOff("주간 리뷰", this.getSeatAudience()) });
      return;
    }
    const week = Number.isInteger(msg.week) ? msg.week : undefined;
    if (msg.type === "reviewOpen") return this.postReviewState("student", {}, week);
    void this.post({ type: "reviewState", view: { ...(await this.reviewSession.studentView(week)), running: true } });
    const r = await this.reviewSession.prepare(week);
    if (!r.ok) return this.postReviewState("student", { error: r.message }, week);
    const refused = this.reviewSession.lastRefusal() !== null;
    const done = r.unchanged
      ? "바뀐 기록이 없어서 다시 만들지 않았어요. 지금 리뷰가 최신이에요."
      : refused
        ? r.regenerated.length
          ? "바뀐 부분은 다시 준비했어요. 다음 실험 제안은 만들지 못했어요."
          : "다음 실험 제안을 만들지 못했어요. 다시 준비해 주세요."
        : "주간 리뷰를 준비했어요.";
    return this.postReviewState("student", { done }, week);
  }

  /** The director's review actions, behind the switch as the Service answers the issuer token. */
  private async handleReviewDirectorMessage(
    msg: { type: "reviewDirectorOpen"; projectId?: string | null; week?: number } | { type: "reviewDecision"; projectId: string; week: number; revision: number; form: import("./reviewView").DirectorDecisionForm },
  ): Promise<void> {
    if (!(await this.refreshCrDirectorContext())) {
      await this.post({ type: "reviewState", view: null, error: DIRECTOR_REVIEW_UNAVAILABLE });
      return;
    }
    if (msg.type === "reviewDirectorOpen") {
      this.reviewSession.select(typeof msg.projectId === "string" && msg.projectId ? msg.projectId : null, Number.isInteger(msg.week) ? msg.week : undefined);
      return this.postReviewState("director");
    }
    const f = msg.form ?? ({} as import("./reviewView").DirectorDecisionForm);
    const n = f.next;
    const r = await this.reviewSession.decide(String(msg.projectId ?? ""), { week: Number(msg.week), revision: Number(msg.revision) }, {
      statement: String(f.statement ?? ""),
      evidence_refs: Array.isArray(f.evidence_refs) ? f.evidence_refs.map(String) : [],
      assumption_refs: Array.isArray(f.assumption_refs) ? f.assumption_refs.map(String) : [],
      affected_deck_slides: Array.isArray(f.affected_deck_slides) ? f.affected_deck_slides.map(Number) : [],
      next: n
        ? {
            ...(typeof n.hypothesis_id === "string" && n.hypothesis_id ? { hypothesis_id: n.hypothesis_id } : { hypothesis: String(n.hypothesis ?? "") }),
            question: String(n.question ?? ""),
            method: String(n.method ?? ""),
            success_criteria: Array.isArray(n.success_criteria) ? n.success_criteria.map(String) : [],
          }
        : null,
    });
    // A second press while the first decision is being written sent nothing; the first one's answer redraws the panel.
    if (!r.ok && r.busy) return;
    return this.postReviewState("director", r.ok ? { done: r.reused ? "이미 기록된 결정이에요. 다시 저장하지 않았어요." : "결정과 다음 실험을 프로젝트 기억에 기록했어요." } : { error: r.message });
  }

  /** One memory action from the panel, behind the served switch (a message can be posted without the panel). */
  private async handleMemoryMessage(
    msg: { type: "memoryOpen" } | { type: "memoryDiff"; from: string; to: string } | { type: "memoryDecision"; form: import("./memoryView").DecisionForm },
  ): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      await this.postDenialNotice("lesson");
      await this.post({ type: "memoryState", view: null, error: lessonFeatureOff("프로젝트 기억", this.getSeatAudience()) });
      return;
    }
    if (msg.type === "memoryOpen") return this.postMemoryState();
    if (msg.type === "memoryDiff") {
      const r = await this.memorySession.compare(String(msg.from ?? ""), String(msg.to ?? ""));
      return this.postMemoryState(r.ok ? {} : { error: r.message });
    }
    const f = msg.form ?? ({} as import("./memoryView").DecisionForm);
    const r = await this.memorySession.decide({
      statement: String(f.statement ?? ""),
      evidence_refs: Array.isArray(f.evidence_refs) ? f.evidence_refs.map(String) : [],
      assumption_refs: Array.isArray(f.assumption_refs) ? f.assumption_refs.map(String) : [],
      affected_deck_slides: Array.isArray(f.affected_deck_slides) ? f.affected_deck_slides.map(Number) : [],
      resulting_version_id: typeof f.resulting_version_id === "string" && f.resulting_version_id ? f.resulting_version_id : null,
    });
    return this.postMemoryState(r.ok ? { done: "결정을 기록했어요." } : { error: r.message });
  }

  /** A coach call of a verify tool (both runtimes): the same session, the same answer (CR-03). */
  private async runVerifyTool(name: string, input: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean; observation?: undefined }> {
    const short = name.replace(/^mcp__hypeproof__/, "");
    const answer = !this.isCurriculumRuntimeEnabled()
      ? { isError: true, text: `알 수 없는 도구: ${short}` }
      : short === "verify_criterion"
        ? await this.verifySession.runTool(input ?? {})
        : await this.verifySession.propose(input ?? {});
    void this.postVerifyState();
    return verifyToolResult(answer);
  }
  /** CR-09 — a pick is waiting for the student's click; a second one is refused, not stacked. */
  private pickInProgress = false;
  // Stashed for the bug-report flow (#64). Updated whenever a stream errors
  // or completes — the Worker's request-id middleware (PR #49) plumbs an
  // x-request-id header on every response we can correlate against in tail.
  private lastRequestId: string | undefined;
  /**
   * Task E (docs/plan/dag.yaml) — liveness. `lastActivityAt` is bumped by any
   * webview message; the pinger turns it into an idle_ms the instructor board
   * can read. Deliberately NOT tied to the chat path: a seat that is reading,
   * and a seat whose app died, are the two cases the board must tell apart.
   */
  private lastActivityAt = Date.now();
  private heartbeat: HeartbeatPinger | null = null;
  /**
   * studio-funnel-events — App funnel events on the Service's grant-scoped POST /v1/trial/events.
   * Off until a GET probe of that route answers (Service flag HPS_OPEN_TRIAL); never /v1/trace/event.
   */
  private readonly funnel = new FunnelReporter({
    send: async (url, token, body) => {
      const version = this.context.extension?.packageJSON?.version;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(typeof version === "string" && version ? { "x-hps-client-version": version } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      return res.status;
    },
    log: (line) => this.logChannel?.appendLine(line),
  });
  /** The seat token found at the first profile read of this process (entry outcome `reused` vs `granted`). */
  private funnelStartupToken: string | null | undefined = undefined;
  /** Free start — the claim's own outcome for the token it issued (a rotated reuse is still "reused"). */
  private funnelClaimHint: { token: string; outcome: "granted" | "reused" } | null = null;
  /** The token whose /v1/trial/events probe has run (or is running); null = none. */
  private funnelProbedToken: string | null = null;
  /**
   * CONV-FUNNEL-R-003 — the token the free end card was last drawn for. The card's buttons count
   * as end_card offer clicks/dismissals only while it is still the probed funnel seat: a message
   * from a card that was never drawn (code-issued trial, pass) or from an older seat sends nothing.
   */
  private endCardOfferToken: string | null = null;
  private personalContinuationPane?: vscode.Disposable;
  private personalContinuationOpening = false;
  private readonly artifactGate = new ArtifactChangeGate();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly preview: PreviewProvider,
    private readonly liveServer: LiveServer,
    /** #580 — the local session-log spool. Optional: tests and older callers run without recording. */
    private readonly spool?: SessionSpool,
  ) {
    // REQ-STUDIO-ARTIFACT-PROVENANCE — install the host-write hook before any write can happen.
    this.provenanceRecorder();
    context.subscriptions.push(setOutboundPresenter((manifest,step)=>this.outboundApproval?.confirm(manifest,step) ?? Promise.resolve(null)));
    // cr-publish (CR-11 after a restart): know the signed-in person's published origin from
    // activation on, and follow every change of the stored token.
    void this.crProjectMemory.refresh().catch(() => undefined);
    const sub = context.secrets.onDidChange?.((e) => {
      if (e.key === TOKEN_KEY) { this.outboundApproval?.cancel(); void this.crProjectMemory.refresh().catch(() => undefined); }
      // cr-review — the director's command follows the stored issuer token (set, replaced or forgotten).
      if (e.key === ISSUER_TOKEN_KEY) void this.refreshCrDirectorContext(true).catch(() => undefined);
    });
    if (sub) context.subscriptions.push(sub);
    // cr-review (CR-02) — the Service's switch can go off while the App stays open: while the
    // director's key is on, it is asked again every five minutes, so the palette entry outlives the
    // switch by at most that long. While the key is off the timer sends nothing, so an instructor
    // whose cohorts never use the runtime makes no standing request; the key turns on at activation,
    // when the issuer token changes, or when the panel's settings are sent (at most once per five
    // minutes, `refreshCrDirectorContext`). The command itself asks again on every use.
    const directorProbe = setInterval(() => {
      if (this.crDirector.on) void this.refreshCrDirectorContext(true).catch(() => undefined);
    }, CR_DIRECTOR_REPROBE_MS);
    context.subscriptions.push({ dispose: () => clearInterval(directorProbe) });
    // D-028 — staged photos that were never sent go with the window.
    context.subscriptions.push({ dispose: () => this.imageStaging?.dispose() });
    // REQ-STUDIO-PREVIEW-RECOVERY — a browser tab opened, closed or changed address/title: measure the preview again.
    for (const event of [vscode.window.onDidChangeBrowserTabState, vscode.window.onDidOpenBrowserTab, vscode.window.onDidCloseBrowserTab]) {
      const d = event?.(() => this.schedulePreviewRecovery());
      if (d) context.subscriptions.push(d);
    }
    context.subscriptions.push({ dispose: () => clearTimeout(this.previewRecoveryTimer) });
  }

  private previewRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private previewRecoveryRunning = false;
  private schedulePreviewRecovery(): void {
    clearTimeout(this.previewRecoveryTimer);
    this.previewRecoveryTimer = setTimeout(() => { void this.postPreviewRecovery(); }, 600);
  }
  /**
   * REQ-STUDIO-PREVIEW-RECOVERY — the learner's preview tab: one on an address a Studio preview server has served
   * (this run or an earlier one, so a tab restored after a restart counts), never another localhost tool. The tab the
   * coach drives first, then the active one, then any.
   */
  private learnerPreviewTab(): vscode.BrowserTab | undefined {
    const tabs = this.coachBrowserTabs();
    const own = (t: vscode.BrowserTab | undefined): t is vscode.BrowserTab =>
      !!t && tabs.includes(t) && isLoopbackPreview(t.url) && !previewPagePath(t.url).startsWith("/__hp_viewport") && !!this.liveServer?.servedBefore(t.url);
    const pinned = this.mcpBrowser?.currentTab();
    if (own(pinned)) return pinned;
    const active = vscode.window.activeBrowserTab;
    if (own(active)) return active;
    return tabs.find(own);
  }
  /** Measured, never guessed: which server runs now (process state) and what the tab's page answered (HTTP status). */
  private async previewSignals(): Promise<PreviewSignals | null> {
    let tab: vscode.BrowserTab | undefined;
    try { tab = this.learnerPreviewTab(); } catch { return null; }
    if (!tab) return null;
    return measurePreview(tab.url, () => ({ base: this.liveServer?.currentUrl(), listening: !!this.liveServer?.isListening() }), (url) => probePreviewPage(url));
  }
  private async postPreviewRecovery(): Promise<void> {
    await this.post({ type: "previewRecovery", signals: await this.previewSignals() });
  }
  /** The webview's one action. The host measures again and refuses an action that no longer fits (previewActionFits). */
  private async runPreviewRecovery(action: unknown): Promise<void> {
    if (this.previewRecoveryRunning) return;
    this.previewRecoveryRunning = true;
    try {
      await runPreviewRecoveryAction(action, {
        signals: () => this.previewSignals(),
        restart: async () => !!(await this.startLivePreview()),
        showFiles: async () => { await vscode.commands.executeCommand("workbench.view.explorer"); },
        retry: async () => {
          const tab = this.learnerPreviewTab();
          if (!tab) return;
          const pinned = new BrowserControl(); pinned.setTargetTab(tab);
          try { await pinned.loadInPinnedTab(tab.url); } finally { await pinned.dispose(); }
        },
        post: async (signals, result) => { await this.post({ type: "previewRecovery", signals, result }); },
      });
    } finally { this.previewRecoveryRunning = false; }
  }

  /**
   * Public accessor for the #64 report-problem flow. Returns the most recent
   * request_id we've seen (from a stream error or successful response). Used
   * to auto-attach to bug reports without the user typing it.
   */
  getLastRequestId(): string | undefined {
    return this.lastRequestId;
  }

  /**
   * Public accessor for #64. Returns the cached profile_id if any. Used as
   * an auto-attached field on bug reports.
   */
  getProfileId(): string | undefined {
    return this.cachedProfile?.profile_id;
  }

  /** Trial diagnosis D3 — solo (trial/pass/personal) or classroom wording for host-side copy. */
  getSeatAudience(): SeatAudience {
    return profileAudience(this.cachedProfile);
  }

  /** #278 — is "페이지를 코치에게" allowed for this cohort? Default off (minor-safe). */
  isPageContextEnabled(): boolean {
    return this.cachedProfile?.input?.page_context === true;
  }

  /**
   * #306 — mirror the cohort's browser_session onto the two settings the fork
   * core patch reads (`hypeproof.browser.safeSession` / `.safeAllowlist`). Safe
   * cohorts (minors) get the hardened persist:hp-safe integrated-browser
   * session; every other cohort explicitly clears it, so switching cohorts in
   * one install self-corrects. Best-effort + feature-detecting: on a Studio
   * build without patches/62-hp-safe-session.patch these keys are unregistered
   * and `update` rejects — we swallow it, since there is no hardened session to
   * drive there and the panel must not crash on older builds.
   */
  private async applyBrowserSafety(profile: ResolvedProfile | null): Promise<void> {
    const { safeSession, safeAllowlist } = resolveBrowserSafety(profile);
    try {
      const cfg = vscode.workspace.getConfiguration("hypeproof.browser");
      await cfg.update("safeSession", safeSession, vscode.ConfigurationTarget.Global);
      await cfg.update("safeAllowlist", safeAllowlist, vscode.ConfigurationTarget.Global);
    } catch {
      /* setting not registered → build without the fork patch; nothing to enforce */
    }
  }

  /** #278 Phase 2 — may we attach a page screenshot (image)? Worker enforces the same gate. */
  isImagePasteEnabled(): boolean {
    return this.cachedProfile?.input?.image_paste === true;
  }

  /**
   * #384 — hand the webview an image data URL to attach to the next turn. Used
   * by the "image opened in an editor tab" flow (extension.ts) so dropping a
   * screenshot onto the editor still reaches the coach. The webview downscales
   * + thumbnails it, same path as ⌘V paste. image_paste-gated by the caller.
   */
  attachImageDataUrl(dataUrl: string, name: string): void {
    void this.post({ type: "attachImage", dataUrl, name });
  }

  /**
   * #278 — stash captured browser-page context for the NEXT turn. The DOM text
   * is prepended to the prompt; the screenshot (if present, and if this cohort
   * has image_paste) rides along as an image so the coach can *see* the page
   * too. History keeps the user's clean text.
   */
  attachPageContext(ctx: { url: string; title: string; text: string; imageBase64?: string; textSource?: import("./pageContext").PageTextSource }): void {
    // capturePageContext returns raw JPEG base64 (no data: prefix). Only attach
    // when the cohort allows images — otherwise the worker would drop it anyway.
    this.pendingPageImage =
      ctx.imageBase64 && this.isImagePasteEnabled()
        ? `data:image/jpeg;base64,${ctx.imageBase64}`
        : null;
    // CGP-ART-R-007 — the model gets the page as quoted data, and the learner sees exactly that text.
    const page = buildPageAttachment(ctx, !!this.pendingPageImage);
    this.pendingPageContext = page.modelText;
    this.pendingPageAttachment = page.preview;
    void this.post({ type: "pageAttachment", attachment: page.preview });
    // #308 — announce inline in the chat panel, NOT via a VS Code toast (a toast
    // pauses the integrated browser). The webview clears it on the next send.
    const withShot = !!this.pendingPageImage;
    this.postPageNotice(pageAttachedNotice(this.coachDisplayName(), withShot, page.preview.title || page.preview.url, page.preview.textNote));
  }

  /**
   * kids-quest — a skeleton round ended (`hp:result`). Stash a one-line summary
   * for the NEXT turn so the coach can react in the guest's voice to what the
   * kid actually did, instead of guessing. Same consume-once channel as
   * attachPageContext (#278): history keeps the kid's clean text; only the
   * model sees the prepended line. Retries overwrite — the last round is the
   * one the kid is talking about — but the attempt count is kept so "got it on the
   * 3rd try" is visible to the coach.
   */
  attachQuestResult(result: Record<string, unknown>): void {
    const ok = result.ok === true;
    const attempts = ++this.questAttempts;
    if (ok) this.questAttempts = 0;
    const kv = Object.entries(result)
      .filter(([k]) => k !== "ok")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    this.dropPageAttachment(); // CGP-ART-R-007: this slot now carries something else
    this.pendingPageContext =
      `[게스트 결과] ${ok ? "성공" : "실패"} · ${kv}` +
      (attempts > 1 ? ` · ${attempts}번째 시도` : "") +
      `\n위 결과를 게스트 목소리로 한 줄 반응한 뒤 아이에게 넘겨줘. 결과에 없는 숫자는 지어내지 마.`;
    this.pendingPageImage = null;
    // 2026-08-19 on a real device — the notification copy ("친구가 해봤어요 — 아직")
    // is noise to the child. The child just played it and already knows the result;
    // the guest reacting in the next message is enough. Attached quietly to the next
    // turn only, with no notification.
  }
  /**
   * CGP-CHAT-R-011 — "작업 폴더 파일 붙이기": a picker that starts in the work folder; the choice is
   * re-checked here (inside the folder, no links, no hidden paths, text only, size caps).
   * CGP-KNOW-R-015 passes `chosen` (a path relative to the work folder, or absolute) instead of
   * opening the picker; everything else is the same path. Resolves true when a file was queued.
   */
  private failedAttachmentReads = new Map<string, { scope: string; root: string; file: string; kind: 'text' | 'photo' | 'image'; reason: string; running?: boolean }>();
  private failAttachmentRead(file: string, kind: 'text' | 'photo' | 'image', reason: string, id = randomId()): void {
    this.failedAttachmentReads ??= new Map();
    for (const [key, value] of this.failedAttachmentReads) if (value.scope !== this.turnRequestScope() || value.root !== (this.resolveCoachCwd() ?? '')) this.failedAttachmentReads.delete(key);
    if (this.failedAttachmentReads.size >= 10 && !this.failedAttachmentReads.has(id)) return;
    this.failedAttachmentReads.set(id, { file, kind, root: this.resolveCoachCwd() ?? '', scope: this.turnRequestScope(), reason });
    void this.post({ type: 'attachmentFailure', failure: { id, name: attachmentDisplayName(path.basename(file)), reason } });
  }
  private async repickAttachment(id: string, name: string): Promise<void> {
    const root=this.resolveCoachCwd(), scope=this.turnRequestScope();
    const chosen=await vscode.window.showOpenDialog({canSelectFiles:true,canSelectFolders:false,canSelectMany:false,title:`${attachmentDisplayName(name)} 다시 선택`,openLabel:"이 파일로 다시 시도"});
    if(root!==this.resolveCoachCwd() || scope!==this.turnRequestScope())return;
    if(!chosen?.[0]) {void this.post({type:'attachmentFailure',failure:{id,name:attachmentDisplayName(name),reason:'파일을 선택하지 않았어요. 다시 선택하거나 첨부에서 빼 주세요.'}});return;}
    const file=chosen[0].fsPath, image=!!attachedImageExt(path.basename(file),'');
    const kind=image ? (this.isImageFilesEnabled() ? 'photo' : 'image') : 'text';
    this.failAttachmentRead(file,kind,'파일을 다시 읽는 중이에요.',id);
    await this.retryAttachmentRead(id);
  }
  private async retryAttachmentRead(id: string): Promise<void> {
    const failed = this.failedAttachmentReads.get(id);
    if (!failed || failed.running || failed.root !== (this.resolveCoachCwd() ?? '') || failed.scope !== this.turnRequestScope()) return;
    failed.running = true;
    if (failed.kind === 'text') {
      const ok = await this.attachWorkspaceFile(failed.file, id);
      if (ok) { this.failedAttachmentReads.delete(id); void this.post({ type: 'attachmentFailureResolved', id }); }
    } else {
      await this.attachNativeImageFile(failed.file, failed.kind === 'photo', id);
    }
  }
  private async attachWorkspaceFile(chosen?: string, retryId?: string): Promise<boolean> {
    const profile = this.cachedProfile ? accessProfile(this.cachedProfile, this.accessState?.view?.choices.find(c => c.id === this.accessState?.selected)) : null;
    const refuse = (error: string) => {
      if (retryId && chosen) this.failAttachmentRead(chosen, 'text', error, retryId);
      else void this.post({ type: "fileAttachment", attachment: this.pendingFileAttachment?.preview ?? null, error });
      return false;
    };
    if (!fileAttachAllowed(profile, this._instructorMode.isInstructor === true)) {
      await this.postDenialNotice("lesson");
      return refuse(denialCopy({ source: "lesson", feature: "작업 폴더 파일 붙이기" }, "neutral"));
    }
    const root = this.resolveCoachCwd();
    if (!root) return refuse(FILE_REFUSAL_COPY["no-workspace"]);
    // REQ-STUDIO-FOLDER-CONSENT — "AI 안 씀" here: nothing from this folder is queued for the model.
    const noAi = folderNoAiRefusal(this.context, this.cachedProfile, this.folderConsentOpts());
    if (noAi) return refuse(noAi);
    const scope = this.turnRequestScope();
    let file = chosen === undefined ? undefined : path.resolve(root, chosen);
    if (file === undefined) {
      const picked = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(root), canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
        openLabel: "붙이기", title: "작업 폴더에서 붙일 파일 고르기",
      });
      if (!picked?.[0]) return false;
      // The folder may have changed while the dialog was open.
      if (this.resolveCoachCwd() !== root || this.turnRequestScope() !== scope) return refuse(FILE_REFUSAL_COPY.changed);
      file = picked[0].fsPath;
    }
    const read = readWorkspaceTextFile(root, file);
    if (!read.ok) { this.failAttachmentRead(file, 'text', read.reason, retryId); return refuse(read.reason); }
    this.pendingFileAttachment = { preview: read.preview, modelText: read.modelText, root };
    void this.post({ type: "fileAttachment", attachment: read.preview });
    return true;
  }
  /**
   * CGP-KNOW-R-015 — "이 파일에 대해 묻기" (작업 자료 list, explorer context menu): attach that file
   * through attachWorkspaceFile, then move focus to the composer. The draft is left as it is and
   * nothing is sent; a refusal shows under the chip row like a picker refusal.
   */
  async askAboutFile(target: string): Promise<void> {
    if (await this.attachWorkspaceFile(target)) void this.post({ type: "focusInput" });
  }
  /** CGP-CHAT-R-011 — remove the queued file; nothing from it is sent. */
  private clearFileAttachment(): void {
    this.pendingFileAttachment = null;
    void this.post({ type: "fileAttachment", attachment: null });
  }
  /** CGP-CHAT-R-011 — hand the queued file text to the send that is starting, and stop showing it as going out. */
  private takeFileAttachment(): string | null {
    const file = this.pendingFileAttachment;
    if (!file) return null;
    this.clearFileAttachment();
    return file.modelText;
  }
  // ── CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS) — the activity's 자료 list (activityMaterials.ts).
  // The list is stored per work folder in the extension's storage; the selection is host-owned and
  // bound to the task scope and folder it was made in, and a fresh send takes it once.
  /**
   * `ids`: selected id → its title when selected, so an item that disappears before Send is still named.
   * An item that left the list stays selected (shown as unavailable above the composer) until the learner
   * takes it out: the send is held meanwhile, so nothing the learner chose drops without being named.
   */
  private materialSelection: { scope: string; root: string; ids: Map<string, string> } | null = null;
  private materialTurnIds?: Set<string>;
  /** A watcher on `<root>/자료/`: a file that is deleted or renamed there is named before the next Send. */
  private materialsWatch?: { root: string; dispose(): void };
  private materialsWatchTimer?: ReturnType<typeof setTimeout>;
  /** Same gate as a work-folder file (sdk_tools.read after pass narrowing, never the instructor surface). */
  private materialsAllowed(): boolean {
    const profile = this.cachedProfile ? accessProfile(this.cachedProfile, this.accessState?.view?.choices.find(c => c.id === this.accessState?.selected)) : null;
    return fileAttachAllowed(profile, this._instructorMode?.isInstructor === true);
  }
  private watchMaterials(root: string): void {
    if (this.materialsWatch?.root === root) return;
    this.materialsWatch?.dispose();
    this.materialsWatch = undefined;
    const ws = vscode.workspace as Partial<typeof vscode.workspace>;
    if (typeof ws.createFileSystemWatcher !== "function" || typeof vscode.RelativePattern !== "function") return;
    // The folder itself too: a 자료 folder that is removed or renamed takes every file with it.
    const watcher = ws.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), "{자료,자료/*}"));
    const refresh = () => {
      if (this.materialsWatchTimer) clearTimeout(this.materialsWatchTimer);
      this.materialsWatchTimer = setTimeout(() => { this.materialsWatchTimer = undefined; void this.postMaterials(); }, 150);
    };
    const subs = [watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), watcher.onDidChange(refresh)];
    this.materialsWatch = { root, dispose: () => { for (const d of subs) d.dispose(); watcher.dispose(); } };
    this.context?.subscriptions?.push({ dispose: () => this.materialsWatch?.dispose() });
  }
  private async materialsSnapshot(): Promise<{ root: string; file: string; view: MaterialsView; cards: import("./classroomInbox").InboxCard[]; dropped: string[] } | null> {
    const base = this.context?.globalStorageUri?.fsPath;
    const cwd = this.resolveCoachCwd();
    if (!base || !cwd || !this.materialsAllowed()) return null;
    let root: string;
    try { root = await fs.promises.realpath(cwd); } catch { return null; }
    this.watchMaterials(root);
    const file = materialsManifestFile(base, root);
    const cards = this.inboxSource ? (await this.inboxSource.inboxView().catch(() => null))?.cards ?? [] : [];
    let provenance: import("./artifactProvenanceView").ArtifactProvenanceView | null = null;
    try { provenance = await this.provenanceRecorder()?.view(root) ?? null; } catch { provenance = null; }
    const kinds = new Map((provenance?.entries ?? []).map(e => [e.path, e.kind as string]));
    const scope = this.turnRequestScope();
    const own = this.materialSelection;
    // A selection belongs to the task and folder it was made in: another task or folder never shows or sends it.
    let dropped: string[] = [];
    if (own && (own.scope !== scope || own.root !== root)) { dropped = [...own.ids.values()]; this.materialSelection = null; }
    const selected = this.materialSelection?.ids ?? new Map<string, string>();
    const listed = materialsView({ manifest: loadManifest(file), folderFiles: listMaterialFolder(root), provenance: rel => kinds.get(rel), inbox: cards, selected: new Set(selected.keys()), scope });
    const view: MaterialsView = { ...listed, unavailable: unavailableSelected(root, listed, selected) };
    return { root, file, view, cards, dropped };
  }
  private async postMaterials(extra?: { requestId?: string; error?: string; notice?: string }): Promise<void> {
    const snap = await this.materialsSnapshot().catch(() => null);
    const dropped = snap?.dropped.length && !extra?.error ? { error: MATERIALS_COPY.changed } : {};
    await this.post({ type: "materialsState", view: snap?.view ?? null, ...extra, ...dropped });
  }
  /** The refusal for a seat or folder that may not send work-folder content, or null. */
  private materialsRefusal(): string | null {
    if (!this.materialsAllowed()) return denialCopy({ source: "lesson", feature: "자료" }, "neutral");
    if (!this.resolveCoachCwd()) return FILE_REFUSAL_COPY["no-workspace"];
    // REQ-STUDIO-FOLDER-CONSENT — "AI 안 씀": nothing from this folder is queued for the model.
    return folderNoAiRefusal(this.context, this.cachedProfile, this.folderConsentOpts());
  }
  private async addMaterial(requestId: string, url?: string): Promise<void> {
    const refusal = this.materialsRefusal();
    if (refusal) { await this.postMaterials({ requestId, error: refusal }); return; }
    const snap = await this.materialsSnapshot();
    if (!snap) { await this.postMaterials({ requestId, error: FILE_REFUSAL_COPY["no-workspace"] }); return; }
    const scope = this.turnRequestScope();
    let item: { kind: "file" | "url"; ref: string; title: string };
    if (url !== undefined) {
      const checked = checkMaterialUrl(url);
      if (!checked.ok) { await this.postMaterials({ requestId, error: checked.reason }); return; }
      item = { kind: "url", ref: checked.url, title: checked.host };
    } else {
      const picked = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, openLabel: "자료에 넣기", title: "자료에 넣을 파일 고르기" });
      if (!picked?.[0]) { await this.postMaterials({ requestId }); return; }
      // The folder or task may have changed while the dialog was open.
      if (this.turnRequestScope() !== scope || (await fs.promises.realpath(this.resolveCoachCwd() ?? "").catch(() => "")) !== snap.root) { await this.postMaterials({ requestId, error: MATERIALS_COPY.changed }); return; }
      const added = addMaterialFile(snap.root, picked[0].fsPath);
      if (!added.ok) { await this.postMaterials({ requestId, error: added.reason }); return; }
      // REQ-STUDIO-ARTIFACT-PROVENANCE — the copy is the learner's upload.
      if (added.copied) noteHostWrite([{ absPath: path.join(snap.root, ...added.rel.split("/")), data: added.bytes }], "learner_upload");
      item = { kind: "file", ref: added.rel, title: added.rel.slice(added.rel.indexOf("/") + 1) };
    }
    const next = withLearnerItem(loadManifest(snap.file), item, Date.now(), listMaterialFolder(snap.root));
    if ("full" in next) { await this.postMaterials({ requestId, error: MATERIALS_COPY.tooManyItems }); return; }
    try { saveManifest(snap.file, next.manifest); } catch { await this.postMaterials({ requestId, error: FILE_REFUSAL_COPY.unreadable }); return; }
    await this.postMaterials({ requestId, notice: MATERIALS_COPY.added(item.title) });
  }
  private async selectMaterial(msg: { requestId: string; scope: string; id: string; selected: boolean }): Promise<void> {
    const refusal = msg.selected ? this.materialsRefusal() : null;
    if (refusal) { await this.postMaterials({ requestId: msg.requestId, error: refusal }); return; }
    const snap = await this.materialsSnapshot();
    if (!snap || snap.view.scope !== msg.scope) { await this.postMaterials({ requestId: msg.requestId, error: MATERIALS_COPY.changed }); return; }
    // Taking out an unavailable item is how the learner agrees to send without it.
    if (!msg.selected && this.materialSelection?.ids.has(msg.id)) { this.materialSelection.ids.delete(msg.id); await this.postMaterials({ requestId: msg.requestId }); return; }
    if (!snap.view.items.some(i => i.id === msg.id)) { await this.postMaterials({ requestId: msg.requestId, error: MATERIALS_COPY.gone }); return; }
    const own = this.materialSelection ??= { scope: snap.view.scope, root: snap.root, ids: new Map() };
    if (msg.selected && !own.ids.has(msg.id) && own.ids.size >= MATERIALS_MAX_SELECTED) { await this.postMaterials({ requestId: msg.requestId, error: MATERIALS_COPY.tooManySelected }); return; }
    if (msg.selected) own.ids.set(msg.id, snap.view.items.find(i => i.id === msg.id)!.title); else own.ids.delete(msg.id);
    await this.postMaterials({ requestId: msg.requestId });
  }
  private async removeMaterial(msg: { requestId: string; scope: string; id: string }): Promise<void> {
    const snap = await this.materialsSnapshot();
    if (!snap || snap.view.scope !== msg.scope) { await this.postMaterials({ requestId: msg.requestId, error: MATERIALS_COPY.changed }); return; }
    if (!snap.view.items.some(i => i.id === msg.id)) { await this.postMaterials({ requestId: msg.requestId, error: MATERIALS_COPY.gone }); return; }
    // withoutItem is the one place that decides what may be removed: an instructor item never.
    const next = withoutItem(loadManifest(snap.file), msg.id);
    if ("refused" in next) { await this.postMaterials({ requestId: msg.requestId, error: next.refused === "instructor" ? MATERIALS_COPY.notRemovable : MATERIALS_COPY.gone }); return; }
    try { saveManifest(snap.file, next.manifest); } catch { await this.postMaterials({ requestId: msg.requestId, error: FILE_REFUSAL_COPY.unreadable }); return; }
    this.materialSelection?.ids.delete(msg.id);
    await this.postMaterials({ requestId: msg.requestId, notice: next.kind === "file" ? MATERIALS_COPY.removed(next.title) : MATERIALS_COPY.removedUrl(next.title) });
  }
  /**
   * Part of a fresh send's preflight, before anything of the turn is consumed. The selection must be
   * this task's and folder's, and every selected item readable now; otherwise the send is held (the
   * draft goes back, the items are named) and nothing is sent. Returns the items read now, which the
   * model turn takes once (`takeMaterials`). Nothing unselected is read; a seat without the gate or a
   * folder set to "AI 안 씀" reads nothing here (REQ-STUDIO-FOLDER-CONSENT holds that turn itself).
   */
  private async prepareMaterials(): Promise<{ own: NonNullable<ChatPanelProvider["materialSelection"]>; key: string; text: string | null } | null> {
    const own = this.materialSelection;
    if (!own || own.ids.size === 0 || this.materialsRefusal()) return null;
    const root = await fs.promises.realpath(this.resolveCoachCwd() ?? "").catch(() => "");
    if (own.scope !== this.turnRequestScope() || own.root !== root) {
      const titles = [...own.ids.values()];
      this.materialSelection = null;
      await this.postMaterials({ error: MATERIALS_COPY.heldChanged(titles) });
      throw new ActivityConnectionError(MATERIALS_COPY.heldChanged(titles));
    }
    const snap = await this.materialsSnapshot();
    if (!snap) return null;
    const out = selectedMaterialsText(snap.root, snap.view, new Set(own.ids.keys()), snap.cards);
    const blocked = [...new Set([...(snap.view.unavailable ?? []).map(u => u.title), ...out.skipped])];
    if (blocked.length) {
      await this.post({ type: "materialsState", view: snap.view, error: MATERIALS_COPY.held(blocked) });
      throw new ActivityConnectionError(MATERIALS_COPY.held(blocked));
    }
    return { own, key: [...own.ids.keys()].join("\n"), text: out.text };
  }
  /**
   * The model turn takes the prepared selection once and clears it, whether or not it goes (a later
   * refusal in the send does not restore it). It goes only when it is still the selection that was
   * checked, on the same task and folder, and the seat still has the gate; otherwise it is named.
   */
  private async takeMaterials(prepared: Awaited<ReturnType<ChatPanelProvider["prepareMaterials"]>>, allowed: boolean): Promise<string | null> {
    const own = this.materialSelection;
    if (!own) return null;
    this.materialSelection = null;
    const root = await fs.promises.realpath(this.resolveCoachCwd() ?? "").catch(() => "");
    const same = prepared && prepared.own === own && prepared.key === [...own.ids.keys()].join("\n") && own.scope === this.turnRequestScope() && own.root === root;
    if (same && allowed) { await this.postMaterials(); return prepared.text; }
    await this.postMaterials(own.ids.size ? { error: MATERIALS_COPY.skipped([...own.ids.values()]) } : undefined);
    return null;
  }
  /** CGP-ART-R-007 — remove queued page text, screenshot and notice; nothing from the page is sent. */
  private clearPageAttachment(): void {
    if (!this.pendingPageAttachment) return;
    this.pendingPageContext = null;
    this.pendingPageImage = null;
    this.pendingPageNotice = null;
    void this.post({ type: "pageAttached", label: "" });
    this.dropPageAttachment();
  }
  /** CGP-ART-R-007 — the queued page text is replaced or gone; stop showing it as going out. */
  private dropPageAttachment(): void {
    if (!this.pendingPageAttachment) return;
    this.pendingPageAttachment = null;
    void this.post({ type: "pageAttachment", attachment: null });
  }
  /** Rounds since the last success (a success resets it). */
  private questAttempts = 0;
  /** JSON of the last pulled `__hpLast` — so a round is folded in once. */
  private lastPulledQuestResult = "";

  /**
   * kids-quest, live_server path — the skeleton runs in the native browser tab
   * (no parent window, so `hp:result` postMessage has nowhere to go). Every
   * skeleton also leaves the last round on `window.__hpLast`; pull it over CDP
   * right before a turn goes out. Cheap (one Runtime.evaluate) and pull-based,
   * so "됐어?" always sees the freshest round. Silent on any failure — a
   * missing result just means the coach says "한번 해보고 알려주세요".
   */
  private async pullQuestResultFromPreview(): Promise<void> {
    if (this.cachedProfile?.game?.template_tier !== "kids-quest") return;
    const tabs = vscode.window.browserTabs ?? [];
    const tab =
      this.mcpBrowser?.currentTab() ??
      tabs.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(t.url ?? "")) ??
      vscode.window.activeBrowserTab;
    if (!tab) return;
    let json = "";
    try {
      const session = await CdpSession.attach(tab);
      try {
        const res = await session.send(
          "Runtime.evaluate",
          { expression: "JSON.stringify(window.__hpLast || null)", returnByValue: true },
          3_000,
        );
        json = typeof res?.result?.value === "string" ? res.result.value : "";
      } finally {
        await session.close();
      }
    } catch {
      return;
    }
    if (!json || json === "null" || json === this.lastPulledQuestResult) return;
    this.lastPulledQuestResult = json;
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return; }
    this.attachQuestResult(sanitizeQuestResult(parsed));
  }

  /**
   * #308 — show an inline notice line in the chat panel (toast replacement;
   * a visible toast pauses the integrated browser). The label is stashed in
   * pendingPageNotice and flushed on webview "ready", because at call time the
   * view may not exist yet (attachPageContext runs before panel.focus) or may
   * be recreated later (WebviewView has no retainContextWhenHidden). Posting
   * is idempotent: the webview reducer replaces pageNotice, never appends.
   */
  postPageNotice(label: string, source?: import("./denialSource").DenialSource): void {
    if (source) { void this.postDenialNotice(source); return; }
    this.pendingPageNotice = label;
    void this.post({ type: "pageAttached", label });
  }

  private denialWrites?: Promise<void>;

  /** Capture the destination before awaiting disk IO; a later task switch must not receive this row. */
  private postDenialNotice(source: import("./denialSource").DenialSource): Promise<void> {
    const store = this.currentTaskStore?.();
    const taskId = store?.getView().activeTaskId ?? undefined;
    const activityId = activityConnections(this.context)?.scope;
    const historyKey = this.historyKey();
    const id = `denial-${randomId()}`;
    const label = denialNoticeLabel(denialNotice(source, this.getSeatAudience() === 'classroom'));
    const message: ChatMessage = { id, role: 'tool', content: '', createdAt: Date.now(), tool: { icon: '🔒', label, state: 'error' } };
    const write = async () => {
      if (store) {
        if (!taskId) throw Error('missing task');
        await store.appendDenial(taskId, message);
      } else {
        const current = this.context.workspaceState.get<ChatMessage[]>(historyKey, []);
        await this.context.workspaceState.update(historyKey, clampTimeline([...current, message], HISTORY_MAX));
      }
      if (this.historyKey() !== historyKey || activityConnections(this.context)?.scope !== activityId || this.currentTaskStore?.()?.getView().activeTaskId !== taskId) return;
      await this.post({ type: 'denialNotice', id, label, at: message.createdAt, activityId, taskId });
    };
    const operation = (this.denialWrites ?? Promise.resolve()).then(write);
    this.denialWrites = operation.catch(async () => {
      if (this.historyKey() === historyKey && activityConnections(this.context)?.scope === activityId && this.currentTaskStore?.()?.getView().activeTaskId === taskId)
        await this.post({ type: 'taskWorkspaceError', error: '차단 안내를 대화에 저장하지 못했어요. 다시 시도해 주세요.', historySaveFailed: true });
    });
    return this.denialWrites;
  }

  // ── Curriculum Runtime (cr-browser, #1391) ────────────────────────────────

  /** Is the CR switch on for the served profile (CR-02)? Re-read at every use. */
  isCurriculumRuntimeEnabled(): boolean {
    return isCurriculumRuntimeEnabled(this.cachedProfile);
  }

  /**
   * CR hooks for the coach's BrowserControl. The switch is read on every tool call, the
   * allowed origin is the live server's (CR-11), and the artifact version is computed
   * from the served root (CR-10, recon R4).
   */
  private crBrowserOptions(): CrBrowserOptions {
    return {
      enabled: () => this.isCurriculumRuntimeEnabled(),
      // CR-11 — the live preview, plus the published test origin of the student's own Project (cr-publish).
      allowedOrigins: () => crAllowedOrigins(this.liveServer.currentUrl(), this.publishSession.publishedOrigins()),
      artifactVersion: async (url: string) => {
        // cr-publish — a page on the Project's published test origin is the version its link pins.
        const published = this.publishSession.publishedArtifactVersion(url);
        if (published) return published;
        const root = this.liveServer.currentRoot();
        if (!root) throw new Error("미리보기 서버가 꺼져 있어요");
        const u = new URL(url);
        // CR-10 — only a page served from the student's own root has a version; an
        // external page whose path collides with a local file is not that file.
        const base = this.liveServer.currentUrl();
        if (!base || u.origin !== new URL(base).origin) throw new Error(`미리보기 주소가 아니에요: ${u.origin}`);
        const entry = u.pathname === "/__hp_viewport" ? (u.searchParams.get("path") || "/") : u.pathname;
        return artifactVersionFor(root, entry.split(/[?#]/)[0] || "/");
      },
    };
  }

  /**
   * CR-09 — the student picks an element in the Experiment Browser and asks about it.
   *
   * Re-checks the served switch (a command runs without its menu), reveals the pinned
   * preview tab and refuses with a reason when the editor tab state does not show it as
   * the visible tab of its group (recon R2: a covered tab loses the first pick, and page
   * visibility cannot tell). Never waits silently.
   */
  async pickElement(kind: "element" | "rectangle" = "element"): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice(lessonFeatureOff("요소 고르기", this.getSeatAudience()), "lesson");
      return;
    }
    // CGP-ART-R-001 — a rectangle exists only in the annotation batch (flag on).
    if (kind === "rectangle" && !this.annotationFlag()) return;
    // The switch above already requires a web-app workshop tier; age does not decide it (2026-10-05).
    if (!this.cachedProfile) {
      // No served profile yet: the app cannot tell which setting applies (source unknown).
      this.postPageNotice(denialCopy({ source: "unknown", feature: "요소 고르기", reason: "수업 정보를 아직 받지 못했어요" }, this.getSeatAudience()), "unknown");
      return;
    }
    if (this.annotationFlag() && (!this.isImagePasteEnabled() || !this.annotationRuntimeAvailable())) {
      this.postPageNotice("이 수업에서는 화면 표시를 보낼 수 없어요.");
      return;
    }
    this.syncAnnotationScope();
    if (this.annotationFlag() && this.annotationBatch.size >= ANNOTATION_LIMIT) { this.postPageNotice("표시는 10개까지 모을 수 있어요."); return; }
    if (this.pickInProgress) {
      this.postPageNotice("이미 요소를 고르는 중이에요. 미리보기에서 요소를 클릭하세요.");
      return;
    }
    this.pickInProgress = true;
    try {
      await this.pickElementOnce(kind);
    } finally {
      this.pickInProgress = false;
    }
  }

  private async pickElementOnce(kind: "element" | "rectangle"): Promise<void> {
    const base = this.liveServer.currentUrl();
    const previewOrigin = (() => {
      try {
        return base ? new URL(base).origin : null;
      } catch {
        return null;
      }
    })();
    const pinned = this.mcpBrowser?.currentTab();
    const onPreview = (t: vscode.BrowserTab | undefined) => {
      try {
        return !!t?.url && !!previewOrigin && new URL(t.url).origin === previewOrigin;
      } catch {
        return false;
      }
    };
    const tab = onPreview(pinned) ? pinned : this.coachBrowserTabs().find((t) => onPreview(t));
    if (!tab) {
      this.postPageNotice("먼저 미리보기를 연 뒤에 요소를 고를 수 있어요.");
      return;
    }
    this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions());
    this.mcpBrowser.setTargetTab(tab);
    await this.revealBrowserTab(tab);
    const coverage = browserTabCoverage(
      (vscode.window.tabGroups?.all ?? []).map((g) => ({
        tabs: g.tabs.map((t, i) => ({ index: i, label: t.label, inputIsUndefined: t.input === undefined, isActive: t.isActive })),
      })),
      tab.title,
    );
    if (coverage !== "visible") {
      this.postPageNotice(
        coverage === "covered"
          ? "미리보기 탭이 다른 탭에 가려져 있어요. 미리보기 탭을 눌러 앞으로 가져온 뒤 다시 골라 주세요."
          : "어느 탭이 미리보기인지 확실하지 않아 요소 고르기를 시작하지 않았어요. 미리보기 탭을 눌러 앞으로 가져온 뒤 다시 골라 주세요.",
      );
      return;
    }
    this.postPageNotice(kind === 'element' ? "미리보기에서 물어볼 요소를 클릭하세요." : "미리보기에서 영역을 끌어서 골라 주세요. Escape로 취소해요.");
    const scope = this.annotationScope();
    const batchEnabled = this.annotationFlag();
    if (!batchEnabled) {
      // Flag off: the shipped CR-09 single pick, unchanged.
      let ctx: ElementContext;
      try {
        ctx = await this.mcpBrowser.pickElement({ root: this.liveServer.currentRoot() ?? null });
      } catch (err) {
        this.postPageNotice(`요소를 가져오지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      this.attachElementContext(ctx);
      await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
      return;
    }
    try {
      const captured = kind === 'element'
        ? await this.mcpBrowser.pickElement({ root: this.liveServer.currentRoot() ?? null }).then(ctx => ({ contexts: [ctx], crop: ctx.crop }))
        : await this.mcpBrowser.pickRectangle(this.liveServer.currentRoot() ?? null);
      if (scope !== this.annotationScope() || !this.annotationsAllowed()) return;
      const identity = await this.mcpBrowser.annotationIdentity();
      if (captured.contexts.some(c => c.documentGeneration !== identity.generation || c.artifact.id !== identity.artifactId)) throw new Error("화면이 바뀌었어요. 다시 골라 주세요.");
      const a = this.annotationBatch.add(kind, captured.contexts, captured.crop);
      await this.mcpBrowser.annotationMarker(a.number, a.crop!.clip);
      this.postAnnotations();
      await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    } catch (err) {
      this.postPageNotice(`표시를 가져오지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * CR-10 — the Experiment Browser results stored on this seat's record, read back and
   * labelled with the version they were taken against: "현재 버전" when the page's files
   * are still at that version, "이전 버전" when they changed since, "버전 확인 안 됨" when
   * the preview is off. A result whose screenshot bytes are stored can be attached to the
   * next message, with a line saying which version it shows.
   */
  async showBrowserResults(): Promise<void> {
    if (!this.isCurriculumRuntimeEnabled()) {
      this.postPageNotice("지금 수업에서는 실험 브라우저 기록을 볼 수 없어요.");
      return;
    }
    const token = await this.context.secrets.get(TOKEN_KEY);
    const proxy = vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1');
    const recorder = this.nativeObservation ?? await this.prepareObservation(proxy, token, await this.ensureProfile());
    const events = recorder?.snapshot().events ?? [];
    const root = this.liveServer.currentRoot();
    const current = new Map<string, string | null>();
    for (const entry of crResultEntries(events)) {
      try {
        current.set(entry, root ? (await artifactVersionFor(root, '/' + entry)).id : null);
      } catch {
        current.set(entry, null);
      }
    }
    const items = crResultHistory(events, (entry) => current.get(entry) ?? null);
    // What the record holds, so stored screenshots are never invisible (MC-27).
    const owner = crBytesOwner(token);
    const stored = await this.crStoredCount(owner);
    const menu = crResultsMenu({ items, stored });
    if (menu.notice) {
      this.postPageNotice(menu.notice);
      return;
    }
    type Pick = vscode.QuickPickItem & { item?: (typeof items)[number]; clear?: true };
    const rows: Pick[] = menu.rows.map((r): Pick =>
      r.kind === "separator" ? { label: "", kind: vscode.QuickPickItemKind.Separator }
      : r.kind === "clear" ? { label: r.label, description: r.description, detail: r.detail, clear: true }
      : { label: r.label, description: r.description, detail: r.detail, item: r.item });
    const picked = await vscode.window.showQuickPick(rows, { title: "실험 브라우저 결과 기록", placeHolder: "결과마다 어느 버전에서 본 것인지 함께 보여 줘요" });
    if (picked?.clear) {
      if (owner) await this.clearBrowserResultBytes(owner, stored);
      return;
    }
    if (!picked?.item?.screenshot_digest) return;
    if (!this.isImagePasteEnabled()) {
      this.postPageNotice("이 수업에서는 기록된 화면을 코치에게 보낼 수 없어요.");
      return;
    }
    let blob: Awaited<ReturnType<LocalRecord['getBlob']>> = null;
    try {
      blob = await this.crRecordHandle().record.getBlob(picked.item.screenshot_digest);
    } catch {
      blob = null;
    }
    if (!blob) {
      this.postPageNotice("기록된 화면을 찾지 못했어요.");
      return;
    }
    this.pendingPageImage = `data:${blob.media_type};base64,${Buffer.from(blob.bytes).toString('base64')}`;
    this.dropPageAttachment(); // CGP-ART-R-007: this slot now carries something else
    this.pendingPageContext =
      `[실험 브라우저 기록] 붙인 화면은 ${picked.item.label}에서 찍은 것이다 (${picked.item.description}). ` +
      (picked.item.state === "current" ? "지금 파일과 같은 버전이다." : "지금 파일과 다를 수 있다. 지금 화면처럼 말하지 마라.");
    this.postPageNotice(`${picked.item.label} 화면을 다음 메시지에 붙였어요.`);
  }

  /**
   * CR-10 — the delete command (CR_BYTES_CLEAR_COMMAND). Deliberately NOT gated on the CR
   * switch: it deletes what an earlier switch-on stored, so it must work after the switch
   * goes off (cohort or tier change). It shows nothing of the results, only the count.
   */
  async clearStoredBrowserResults(): Promise<void> {
    const owner = crBytesOwner(await this.context.secrets.get(TOKEN_KEY));
    const stored = await this.crStoredCount(owner);
    if (!owner || stored === 0) {
      this.postPageNotice("이 컴퓨터에 저장된 내 실험 브라우저 화면이 없어요.");
      return;
    }
    await this.clearBrowserResultBytes(owner, stored);
  }

  /**
   * CR-10 — the student deletes the browser-result bytes (screenshots, action traces) THEY
   * stored; another student's on the same PC are neither counted nor deleted.
   */
  private async clearBrowserResultBytes(owner: string, stored: number | null): Promise<void> {
    try {
      const out = await clearStoredResults(
        stored,
        (message) => Promise.resolve(vscode.window.showWarningMessage(message, { modal: true }, "지우기")),
        async () => {
          await this.crBlobWrites.catch(() => undefined);
          const { store, record } = this.crRecordHandle();
          return store.exclusive(() => record.deleteBlobs({ by: "user", at: Date.now(), owner }));
        },
      );
      if (out) this.postPageNotice(`저장된 화면·동작 기록 ${out.removed}개를 지웠어요.`);
    } catch {
      this.postPageNotice("기록을 지우지 못했어요. 다른 창에서 기록을 쓰는 중이면 잠시 뒤에 다시 해 주세요.");
    }
    await this.crStoredCount(owner);
  }

  /** Queue a picked element for the NEXT turn and show the student exactly what goes. */
  attachElementContext(ctx: ElementContext): void {
    // The crop rides the page-image conduit when the cohort accepts images (recon R2).
    this.elementQueue.attach(ctx, { imagesAllowed: this.isImagePasteEnabled() });
    this.postElementPreview();
  }

  /** The student removed the element before sending: nothing of it is sent. */
  clearElementContext(): void {
    if (this.elementQueue.clear()) this.postElementPreview();
  }

  private postElementPreview(): void {
    void this.post({ type: "elementAttached", element: this.elementQueue.preview() });
  }

  /**
   * Public accessor for #64. Returns the persisted chat history (workspaceState).
   * The report flow takes only the tail (last 3) and only when the user
   * explicitly opts in.
   */
  getHistorySnapshot(): ChatMessage[] {
    return this.getHistory();
  }

  /** Explicit personal text continuation; never alters the Service runtime or tool grants. */
  private async openPersonalClaude(draft: unknown): Promise<void> {
    if (this.personalContinuationOpening || this.taskChanging || this.connectionChanging || this.activeStreams.size || !this.currentTaskStore?.()?.getView().activeTaskId || this.cachedProfile?.lesson || !endCardAdvertised(this.cachedProfile) || this.cachedProfile?.minor_cohort === true || this._instructorMode.isInstructor || !this.endCardOfferToken || typeof draft !== 'string' || draft.length > 24000) return;
    this.personalContinuationOpening = true;
    const token = this.endCardOfferToken;
    const scope = () => JSON.stringify([this.profileGeneration, activityConnections(this.context)?.scope, this.currentTaskStore?.()?.getView().activeTaskId, this.resolveCoachCwd()]);
    const bound = scope();
    const current = () => scope() === bound && this.endCardOfferToken === token && endCardAdvertised(this.cachedProfile) && !this.cachedProfile?.lesson && !this.activeStreams.size && this.cachedProfile?.minor_cohort !== true && !this._instructorMode.isInstructor && !this.taskChanging && !this.connectionChanging;
    try {
      if (await this.context.secrets.get(TOKEN_KEY) !== token || !current()) return;
      const history = this.getHistory().filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
      const lastRequest = this.retryMessages().filter(m => m.role === 'user').at(-1)?.content ?? '';
      this.personalContinuationPane?.dispose();
      this.personalContinuationPane = openPersonalContinuation({
        projectLabel: path.basename(this.resolveCoachCwd() ?? '') || '현재 작업',
        draft: draft || lastRequest,
        history,
        isCurrent: current,
        commitReply: async result => {
          if (!current()) throw new Error('activity_changed');
          await this.appendHistory([
            { id: `personal-${result.id}-user`, role: 'user', content: result.prompt, createdAt: Date.now() },
            { id: `personal-${result.id}-assistant`, role: 'assistant', content: result.text, createdAt: Date.now(), assistantName: result.source === 'manual' ? 'Claude Code · 직접 가져온 답변' : 'Claude Code · 개인 계정' },
          ]);
          if (current()) await this.post({ type: 'history', messages: this.getHistory() });
        },
      });
      this.context.subscriptions.push(this.personalContinuationPane);
    } finally { this.personalContinuationOpening = false; }
  }

  /**
   * Just before the lesson log is sealed, leave the work folder's real index.html as
   * the last piece of evidence. If the child edited the file by hand after the last
   * AI response, that change disappears when only the chat text is kept. A failure or
   * a missing file is a fail-soft path that never blocks the upload itself.
   */
  async captureFinalArtifactForSpool(): Promise<boolean> {
    if (!this.spool?.currentSessionDir()) return false;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return false;
    try {
      const target = vscode.Uri.joinPath(root, "index.html");
      const bytes = await vscode.workspace.fs.readFile(target);
      const content = Buffer.from(bytes).toString("utf8");
      if (!/<html[\s>]/i.test(content) && !/<!doctype html/i.test(content)) return false;
      this.spool.recordArtifactSnapshot({
        source: "session_end",
        path: "index.html",
        content,
      });
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Public API used by extension.ts
  // -------------------------------------------------------------------------

  extractLastRenderableCode(): string | null {
    const messages = this.getHistory();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const html = extractRenderableHtml(m.content);
      if (html) return html;
    }
    return null;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const webviewDist = vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "dist");
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewDist],
    };
    view.webview.html = this.renderHtml(view.webview, webviewDist);

    const sidebarWebview=view.webview;
    view.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg, view.webview));
    watchChatSurface(view, this.finishNotifier);
    view.onDidDispose(() => {
      this.writeApprovalRequest.cancel();
      this.outboundApproval?.cancel();
      if (this.draftSource===sidebarWebview) this.draftSource=undefined;
      this.queuedSources.delete(sidebarWebview);
      if (this.view === view) this.view = undefined;
      if (!this.editorChat) abortAllStreams(this.activeStreams);
    });
  }

  /** Hand the entry canvas to the conversation instead of leaving a landing
   * page beside a narrow sidebar. The same provider owns auth, history and tools. */
  async openInEditor(entry: vscode.WebviewPanel): Promise<void> {
    if (this.editorChat) {
      this.editorChat.reveal(vscode.ViewColumn.One);
      if (entry !== this.editorChat) entry.dispose();
    } else {
      this.editorChat = entry;
      entry.title = 'AI와 작업';
      const dist = vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist');
      entry.webview.onDidReceiveMessage((msg: WebviewMessage) => this.handleMessage(msg, entry.webview));
      watchChatSurface(entry, this.finishNotifier);
      const editorWebview=entry.webview;
      entry.onDidDispose(() => {
        this.writeApprovalRequest.cancel();
        this.outboundApproval?.cancel();
        if(this.draftSource===editorWebview)this.draftSource=undefined;
        this.queuedSources.delete(editorWebview);
        if (this.editorChat === entry) {
          this.editorChat = undefined;
          abortAllStreams(this.activeStreams);
        }
      });
      entry.webview.html = this.renderHtml(entry.webview, dist);
      entry.reveal(vscode.ViewColumn.One);
    }
  }

  focusEditor(): boolean {
    if (!this.editorChat) { this.focusDiagnostic('editor_absent'); return false; }
    const editor = this.editorChat;
    editor.reveal(vscode.ViewColumn.One);
    this.focusDiagnostic('editor_revealed');
    // Revealing a retained webview focuses its document, not its composer.
    // Only this explicit command sends the request; passive restore stays quiet.
    const scope = activityConnections(this.context)?.scope;
    this.focusDiagnostic('message_send', {scope_present:!!scope});
    try {
      const sent = editor.webview.postMessage({type:'focusInput',activityId:scope} satisfies HostMessage);
      if (process.env.HPS_TEST_E2E === '1') void Promise.resolve(sent).then(delivered=>this.focusDiagnostic('message_delivery',{delivered:delivered===true}),()=>this.focusDiagnostic('message_rejected'));
      else void sent;
    } catch(error) { this.focusDiagnostic('message_threw'); throw error; }
    return true;
  }

  private connectionChanging = false;
  private draftWrites: Promise<void> = Promise.resolve();
  private draftSource?: vscode.Webview;
  private draftFlush?: {nonce:string;source:vscode.Webview;resolve:()=>void;reject:(e:Error)=>void;capture?:(draft:ActivityDraft)=>void};
  async setConnectionChanging(value: boolean, capture?: (draft: ActivityDraft) => void): Promise<void> {
    this.connectionChanging = value;
    if (value) { this.personalContinuationPane?.dispose(); this.personalContinuationPane = undefined; }
    if (!activityConnections(this.context)) return;
    await this.post({type:'activityFreeze',frozen:value});
    if (!value) return;
    const source=this.draftSource;
    const activityId=activityConnections(this.context)?.scope;
    // Expired credentials unmount the composer; it cannot acknowledge a scoped flush.
    if (source && activityId) {
      const nonce=crypto.randomUUID();
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{this.draftFlush=undefined;reject(new Error('입력 저장을 확인하지 못했습니다. 활동을 유지하고 다시 시도해 주세요.'));},8000);
        this.draftFlush={nonce,source,capture,resolve:()=>{clearTimeout(timer);this.draftFlush=undefined;resolve();},reject:e=>{clearTimeout(timer);this.draftFlush=undefined;reject(e);}};
        void source.postMessage({type:'activityFreeze',frozen:true,nonce,activityId});
      });
    }
    await this.draftWrites;
    if (this.interruptedHistory) await this.retryInterruptedHistory();
  }

  /** #751 — metadata-only observer for remote classroom operations; null unless the learner connected. */
  opsObserver: (import("./classroomOpsHost").ClassroomOpsObserver & Partial<Pick<import("./classroomOpsHost").ClassroomOpsHost, "switchPendingSetting" | "confirmSettingBound" | "knownBindingKey" | "holdsLessonSetting" | "approvalScope">>) | null = null;
  /** #751 U2 — set by extension.ts. The provider only relays: every answer is read from disk by the host adapter. */
  inboxSource: { inboxView(): Promise<import("./classroomInbox").InboxView>; inboxOpened(objectId: string, generation: number): Promise<void>; inboxLink(objectId: string, url: string, generation: number): Promise<string | null> } | null = null;
  async postInbox(): Promise<void> { if (this.inboxSource) await this.post({ type: "inboxState", inbox: await this.inboxSource.inboxView() }); }
  /** #751 native help — set by extension.ts. The provider only relays; the host adapter re-checks the learner on every call. */
  helpSource: import("./classroomHelpHost").ClassroomHelpHost | null = null;
  // #1298 — called when the auto-read whoami path gets a rejected result (401/403).
  // Extension sets this to delete the issuer token and show the student start page once.
  onIssuerAutoRejected?: () => void;
  postHelp(help: import("./classroomHelp").HelpView): void {
    // #1298 — instructor has no student help-request surface; suppress even if ClassroomHelpHost pushes.
    if (this._instructorMode.isInstructor) return;
    void this.post({ type: "helpState", help });
  }
  /** Shared with the start page: one rule for what a click on an instructor link may do. */
  async handleInboxLink(msg: { objectId: string; url: string; generation: number; action: "open" | "copy" }): Promise<void> {
    const url = await this.inboxSource?.inboxLink(msg.objectId, msg.url, msg.generation); if (!url) return;
    if (msg.action === "copy") await vscode.env.clipboard.writeText(url); else await this.openLearnerLink(url);
  }
  /**
   * CGP-ART-R-008 — the one exit for links a learner clicks in chat. Minor cohorts stay in the
   * integrated browser (its hardened session enforces the allowlist); others confirm the host
   * before the system browser opens.
   */
  async openLearnerLink(raw: unknown): Promise<void> {
    const persisted = vscode.workspace.getConfiguration("hypeproof.browser").get<boolean>("safeSession");
    const route = routeExternalLink(raw, linkSafety(this.cachedProfile, persisted));
    if (route.kind === "refuse") return;
    if (route.kind === "integrated") {
      try {
        await vscode.window.openBrowserTab(route.url, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
      } catch {
        // Fail closed: no system-browser fallback for a safe session.
        void vscode.window.showInformationMessage("이 링크를 Studio 브라우저에서 열 수 없어요. 강사에게 알려 주세요.");
      }
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      "바깥 사이트를 열까요?",
      { modal: true, detail: `${route.host}\n${route.url}` },
      "열기",
      "링크 복사",
    );
    if (choice === "열기") await vscode.env.openExternal(vscode.Uri.parse(route.url));
    else if (choice === "링크 복사") await vscode.env.clipboard.writeText(route.url);
  }
  private opsLastArtifact: string | undefined;
  // #751 R3 — why new AI runs are held. Local editing, saving, Stop and export never consult this.
  private lastActivityStatus?: { scope: string; message: Extract<HostMessage, {type:'streamError'}> };
  private localFileBusy = false;
  private opsHold: "paused" | "stop_unconfirmed" | null = null;
  private opsGeneration = 0;
  opsSetHold(hold: "paused" | "stop_unconfirmed" | null): void { this.opsHold = hold; }
  opsRuntimeGeneration(): number { return this.opsGeneration; }
  /** Ask every running turn and pending approval to end. Entries leave the maps through their normal finally paths — that is the confirmation. */
  opsRequestStop(): void {
    this.writeApprovalRequest?.cancel();
    for (const [streamId, ctrl] of [...this.activeStreams]) { try { ctrl.abort(); } catch { /* best-effort */ } void this.post({ type: "streamStopped", streamId, by: "instructor" }); }
    for (const resolve of [...this.pendingApprovals.values()]) resolve(false);
    this.observationAssessment?.abort();
  }
  /** Freeze + confirmed draft save, reusing the activity-switch path. */
  async opsFreezeInput(frozen: boolean): Promise<void> { await this.setConnectionChanging(frozen); }
  /** Digests only — the conversation itself never leaves this process. Reads; never writes or clears. */
  async opsPreservation(): Promise<{ history_count: number; history_sha256: string; draft_sha256: string | null; spool_session: string | null; spool_flushed: boolean }> {
    const history = this.getHistory();
    const scope = activityConnections(this.context)?.scope;
    const draft = scope ? this.context.workspaceState.get<unknown>("hps.activity.draft." + scope) : undefined;
    const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
    let flushed = true;
    try { await this.spool?.flush(); } catch { flushed = false; }
    const dir = this.spool?.currentSessionDir() ?? null;
    return { history_count: history.length, history_sha256: digest(history), draft_sha256: draft === undefined ? null : digest(preservedDraftContent(draft)), spool_session: dir ? path.basename(dir) : null, spool_flushed: flushed };
  }
  /**
   * #751 R4 — the allowlisted spool files of the current session plus the spool's sequence state, read under the
   * spool's own write queue so the counter matches the bytes. Reads only: the live spool is not sealed, truncated or moved.
   */
  async opsReadSpool(sinceMs: number): Promise<import("./sessionSpool").SpoolSnapshotSource | null> {
    try { return (await this.spool?.readForSnapshot(sinceMs)) ?? null; } catch { return null; }
  }
  /** #751 U1b — this learner's sessions in the class window for a kinds collection. Reads only; the live spool is not sealed or moved. */
  async opsReadCollection(sinceMs: number, identity: { u: string; c: string; p: string }): Promise<import("./sessionSpool").SpoolCollectionSource | null> {
    try { return (await this.spool?.readForCollection(sinceMs, identity)) ?? null; } catch { return null; }
  }
  /**
   * #751 U1b — the learner marks the CURRENT artifact version (workspace index.html) as their class result, or withdraws that
   * mark. Only versions marked here travel in an "approved artifacts" collection; nothing is sent by this command itself.
   */
  async approveArtifactInteractively(): Promise<void> {
    const spool = this.spool;
    if (!spool) { void vscode.window.showInformationMessage("이 창에서는 결과물을 표시할 수 없습니다."); return; }
    const outcome = await approveArtifact({
      owner: () => spool.owner(),
      classroom: () => this.opsObserver?.approvalScope?.() ?? "",
      readPage: async () => { const root = vscode.workspace.workspaceFolders?.[0]?.uri; try { return root ? Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, "index.html"))).toString("utf8") : null; } catch { return null; } },
      ask: async (page) => (await vscode.window.showQuickPick(approvalChoices(page), { title: "수업 결과물 승인", placeHolder: APPROVAL_PLACEHOLDER }))?.approved,
      record: (owner, e) => spool.recordArtifactApprovalFor(owner, e),
    });
    const msg = approvalMessage(outcome); if (msg) void vscode.window.showInformationMessage(msg);
  }
  /** New execution generation on the same files: cached runtime handles are dropped, nothing stored is touched. */
  async opsNewGeneration(): Promise<number> {
    // Reached only after the stop was confirmed, so there is no run state to force-clear here.
    await this.ensureProfile(true);
    return ++this.opsGeneration;
  }
  /**
   * #751 U4 — bring the learner's preview back and report what the learner's OWN tabs then hold. Touches no file. Only tabs
   * on the preview server as it was before the action are re-loaded (each at its own path) — any other localhost tool or
   * site is left exactly as it was. The re-load goes through a tab-pinned CDP session that never falls back to another tab.
   */
  async opsRecoverPreview(): Promise<{ state: "no_preview" | "reloaded" | "restarted"; artifact: ArtifactState; tabs: PreviewTabsState }> {
    const answers = async (url: string) => { try { return (await fetch(url, { signal: AbortSignal.timeout(4000) })).status < 500; } catch { return false; } };
    const column = () => (this.editorChat ? vscode.ViewColumn.Two : vscode.ViewColumn.One);
    const driven = this.mcpBrowser?.currentTab();
    return recoverLearnerPreview<vscode.BrowserTab>({
      tabs: () => this.coachBrowserTabs(),
      serverUrl: () => this.liveServer.currentUrl(),
      recover: () => this.liveServer.recover(answers),
      fetchPage: async (url) => { const res = await fetch(url, { signal: AbortSignal.timeout(4000) }); return { status: res.status, contentType: res.headers.get("content-type") }; },
      load: async (tab, url) => { const pinned = new BrowserControl(); pinned.setTargetTab(tab); try { return await pinned.loadInPinnedTab(url); } finally { await pinned.dispose(); } },
      close: async (tab) => { await tab.close(); },
      open: async (url) => {
        const opened = await vscode.window.openBrowserTab(url, { viewColumn: column(), preserveFocus: true });
        this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions()); this.mcpBrowser.setTargetTab(opened);
        return opened;
      },
    }, driven);
  }
  /** #751 — approval wait is reported as such, never as a failure or as "running". */
  opsRuntime(): { idleMs: number; status: "idle" | "running" | "waiting_approval" } {
    const status = (this.pendingApprovals?.size ?? 0) > 0 ? "waiting_approval" : this.hasActiveStream() ? "running" : "idle";
    return { idleMs: Date.now() - this.lastActivityAt, status };
  }
  hasActiveStream(): boolean { return !!this.attemptWrite || this.pendingSends > 0 || this.activeStreams.size > 0 || !!this.worldOpening || !!this.observationAssessment || (this.pendingApprovals?.size ?? 0) > 0; }
  /** REQ-STUDIO-QUIT-GUARD — chat surfaces that last reported a queued, unsent message. */
  private queuedSources = new Set<vscode.Webview>();
  quitGuardActivity(): QuitGuardActivity { return { turnRunning: this.hasActiveStream(), queuedUnsent: this.queuedSources.size > 0 }; }

  refreshConfig(): Promise<void> {
    return (async () => {
      await this.postConfig();
      await this.postHistory();
    })();
  }

  get isInstructor(): boolean | null {
    return this._instructorMode.isInstructor;
  }

  get lastWhoamiStatus() {
    return this._instructorMode.lastWhoamiStatus;
  }

  private clearingHistory = false;
  async clearHistory(): Promise<void> {
    if (this.clearingHistory || this.taskChanging || this.connectionChanging || this.hasActiveStream()) return;
    this.clearingHistory = true;
    if (this.pendingPageAttachment) this.clearPageAttachment(); // CGP-ART-R-007 — a new conversation starts without the old page
    if (this.pendingFileAttachment) this.clearFileAttachment(); // CGP-CHAT-R-011 — and without the old file
    const key = this.historyKey();
    const taskStore = this.currentTaskStore?.();
    const taskId = taskStore?.getView().activeTaskId;
    try {
      const choice = await vscode.window.showWarningMessage(
        "이 대화 기록을 지울까요?",
        { modal: true, detail: "채팅 기록은 되돌릴 수 없습니다. 작업 파일과 내 작업 돌아보기의 관찰 기록은 그대로 남습니다." },
        "대화 지우기",
      );
      if (choice !== "대화 지우기" || this.hasActiveStream() || key !== this.historyKey()) return;
      if (this.taskChanging || this.connectionChanging || taskStore !== this.currentTaskStore?.() || taskId !== taskStore?.getView().activeTaskId) return;
      if (taskStore && taskId) {
        await taskStore.clearHistory(taskId);
        await this.post({ type: 'taskWorkspaceState', view: taskStore.getView() });
      }
      await this.context.workspaceState.update(key, []);
      if (this.interruptedHistory && this.interruptedHistory.scope === this.turnRequestScope()) {
        this.interruptedHistory = undefined;
        await this.post({ type: 'taskWorkspaceError', error: null, historySaveFailed: true });
      }
      // A5 — a new conversation starts the orchestrator session over (A4 report §9).
      this.orchestratorState = undefined;
      void this.post({ type: "history", messages: [] });
      void this.post({ type: "contextTrim", boundaryId: null });
      // A cleared chat starts a new conversation, not a new trial allowance.
      void this.post({ type: "aiDisclosure", text: this.aiDisclosure.noticeForHistoryClear() });
    } catch {
      const message = "대화 삭제를 완료하지 못했어요. 현재 기록을 확인하고 잠시 뒤 다시 시도해 주세요.";
      if (taskStore) await this.post({ type: 'taskWorkspaceError', error: message });
      else void vscode.window.showErrorMessage(message);
    } finally { this.clearingHistory = false; }
  }

  /**
   * #751 U3 — the turn-start preflight of a targeted lesson setting. Switch (owner window) or learn of a switch (any other
   * window), fetch the profile as a CANDIDATE, and adopt it only when the Service serves exactly that binding.
   */
  private async lessonBindingPreflight(): Promise<void> {
    const ops = this.opsObserver; if (!ops?.switchPendingSetting || !ops.knownBindingKey) return;
    let current = await this.ensureProfile(); if (!current?.lesson) return;
    const token = await this.context.secrets.get(TOKEN_KEY), base = tokenLessonSha(token); if (!token || !base) return;
    if (shouldRecheckEnforcement(current.lesson_binding, (await ops.holdsLessonSetting?.()) === true)) {
      const fresh = await this.fetchCandidateProfile(token);
      if (fresh?.lesson_binding?.enforced) { await this.adoptProfile(fresh, token); current = fresh; }
    }
    if (!current.lesson_binding?.enforced) return;
    const sw = await ops.switchPendingSetting(base);
    const plan = planPreflight(current.lesson_binding, sw, sw.state === "switched" ? null : await ops.knownBindingKey());
    if (plan.action === "proceed") { if (sw.state === "switched") await ops.confirmSettingBound?.(sw); return; }
    const candidate = await this.fetchCandidateProfile(token);
    if (!candidateMatches(plan, candidate)) {
      // Switched at the Service but not verified here: sending this turn with the old key would only be refused, and with a
      // guessed key it would run under a tool policy this window does not hold. Nothing is sent.
      if (plan.confirm) throw new LessonBindingPreflightError("수업 설정을 확인하지 못했습니다. 입력한 글과 첨부는 그대로입니다 — 잠시 뒤 다시 보내 주세요.");
      return;
    }
    const from = current.lesson_binding!, fromVersion = current.lesson?.version;
    await this.adoptProfile(candidate!, token);
    if (sw.state === "switched") await ops.confirmSettingBound?.(sw);
    this.spool?.recordLessonBinding({ from: { key: from.key, version: fromVersion }, to: { key: candidate!.lesson_binding!.key, version: candidate!.lesson?.version, source: candidate!.lesson_binding!.source, object_id: candidate!.lesson_binding!.object_id, revision: candidate!.lesson_binding!.revision } });
  }
  private async fetchCandidateProfile(token: string): Promise<ResolvedProfile | null> {
    const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    const r = await fetchProfileResult({ proxyUrl, token }).catch(() => null);
    if (!r?.ok) return null;
    const connections = activityConnections(this.context);
    if (connections?.current) return r.profile.activity_id !== connections.current.serverId ? null : { ...r.profile, workspace_root: connections.current.workspace };
    return r.profile;
  }
  /**
   * TUX-SP-13 — re-read only the trial block after a trial turn so the header's passive line follows the Service (CU-13).
   * The profile read spends no attempt. Any failure keeps the last confirmed value; the turn's own error says what ended.
   */
  private async refreshTrialStatus(proxyUrl: string, token: string): Promise<void> {
    const r = await fetchProfileResult({ proxyUrl, token }).catch(() => null);
    const current = this.cachedProfile;
    if (!r?.ok || !r.profile.trial || r.profile.pass || !current?.trial || current.activity_id !== r.profile.activity_id) return;
    if (await this.context.secrets.get(TOKEN_KEY) !== token || this.cachedProfile !== current) return;
    this.cachedProfile = { ...current, trial: r.profile.trial };
    await this.postConfig();
  }
  /** Same token, same activity: only what the lesson version decides changes (steps, AI name, model list, tool policy). */
  private async adoptProfile(p: ResolvedProfile, token: string): Promise<void> {
    if (await this.context.secrets.get(TOKEN_KEY) !== token) return;
    this.cachedProfile = p; this.profileFetchPromise = null;
    await this.postConfig();
  }
  /** A turn refused under the lesson-binding contract. The Service's record decides how it ends; nothing is re-sent automatically. */
  private async endRefusedTurn(o: { code: string; streamId: string; proxyUrl: string; token: string | undefined; text: string; images?: string[]; toolMode?: TurnToolMode }): Promise<void> {
    const ending = refusedTurnEnding(o.token ? await fetchTurnState({ proxyUrl: o.proxyUrl, token: o.token, turnId: o.streamId }) : null);
    console.warn(`[lesson-binding] turn ${o.streamId} refused: ${o.code} → ${ending}`);
    if (ending === "restore_input") await this.post({ type: "inputRejected", text: o.text, images: o.images, toolMode: o.toolMode });
    await this.post({ type: "streamError", streamId: o.streamId, error: REFUSAL_COPY[ending] });
    // The next turn must start from what the Service runs now; a profile that cannot be verified stays as it is.
    if (o.token) { const candidate = await this.fetchCandidateProfile(o.token); if (candidate?.lesson_binding && candidate.lesson_binding.key !== this.cachedProfile?.lesson_binding?.key) await this.adoptProfile(candidate, o.token); }
  }

  /** Force re-fetch on next config push (e.g. after token change). */
  invalidateProfile(): void {
    this.personalContinuationPane?.dispose(); this.personalContinuationPane = undefined;
    this.writeApprovalRequest?.cancel();
    this.outboundApproval?.cancel();
    this.profileGeneration++;
    this.observationAssessment?.abort();
    this.nativeObservation=null;
    this.nativeLearningPath=null;
    this.cachedProfile = null;
    this.servedWorkspaceRoot = null;
    this.profileFetchPromise = null;
    this.lastProfileFailure = null;
    this.activeCohortId = null;
    this.nativeHistoryScope = null;
    // CGP-AGENT-R-004 — a sign-in, sign-out or token change ends every "이번 작업 동안" allow.
    this.endTaskCommandAllows();
    // CR-10 — the token changed: the delete command follows the new identity.
    void this.refreshCrBytesContext();
    // The profile is gone, and with it the publish button (token gate).
    this.refreshSitePublishContext();
    // #1298 — re-check instructor status + brief after token change.
    this._instructorMode.reset();
  }

  /** #381 — cause of the most recent failed profile fetch, if any. */
  profileFailure(): ProfileFailure | null {
    return this.lastProfileFailure;
  }

  /**
   * Public so extension.ts can drive the naming flow at first launch /
   * when the user clicks the coach name in the header.
   */
  async runCoachNamingRitual(opts: { force?: boolean } = {}): Promise<void> {
    const profile = await this.ensureProfile();
    const mode = profile?.ux.coach.naming_mode ?? "fixed";
    if (mode === "fixed" && !opts.force) {
      // Nothing to ask — fixed name is server-driven (or fallback).
      return;
    }

    const namingPrompt = profile?.ux.coach.naming_prompt_md ?? "코치의 이름";
    const personalityPrompt = profile?.ux.coach.personality_prompt_md ?? "";
    const fallback = profile?.ux.coach.fallback_name ?? "코치";

    const existing = this.getCoach();
    const name = await vscode.window.showInputBox({
      title: stripMd(namingPrompt),
      prompt: "비워두면 기본 이름을 사용해요",
      placeHolder: fallback,
      value: opts.force ? existing.name : "",
      ignoreFocusOut: true,
    });
    if (name === undefined) return;       // user pressed Escape

    let personality = existing.personality;
    if (personalityPrompt) {
      const ans = await vscode.window.showInputBox({
        title: stripMd(personalityPrompt),
        prompt: "건너뛰어도 괜찮아요",
        placeHolder: "예: 친절하고 엉뚱한 친구",
        value: opts.force ? existing.personality : "",
        ignoreFocusOut: true,
      });
      // ans === undefined means user dismissed; preserve existing if force, clear otherwise
      personality = ans ?? (opts.force ? existing.personality : "");
    }

    const sanitized = sanitizeCoachInput(name.trim() || "", personality, fallback);
    const next: CoachInfo = { ...sanitized, configured: true };
    await this.context.globalState.update(this.coachKey(), next);
    await this.context.globalState.update(this.coachRitualDoneKey(), true);
    await this.postConfig();
  }

  /** Should extension.ts pop the naming ritual on this launch? */
  shouldOfferNamingRitual(profile: ResolvedProfile | null): boolean {
    const mode = profile?.ux.coach.naming_mode ?? "fixed";
    if (mode === "fixed") return false;
    const done = this.context.globalState.get<boolean>(this.coachRitualDoneKey(), false);
    if (!done) return true;
    return !!profile?.ux.coach.revisit_on_entry;
  }

  /**
   * A forced profile re-read that also republishes the panel config, so what the re-read changed
   * (CGP-SHELL-R-024: what the AI can do) reaches the chat before the next model call.
   */
  async refreshProfileAndConfig(): Promise<ResolvedProfile | null> {
    const profile = await this.ensureProfile(true);
    // A failed republish must not stop the caller (it did not post before); the next postConfig retries.
    await this.postConfig().catch((err) => console.warn("[capability-change] config republish after refresh failed:", err));
    return profile;
  }

  /** Eager profile fetch — called by extension.ts on activation. */
  async ensureProfile(forceRefresh = false): Promise<ResolvedProfile | null> {
    if (forceRefresh) {
      await this.profileFetchPromise;
      this.cachedProfile = null;
    }
    const connections=activityConnections(this.context);
    if (connections && !connections.matchesService) return null;
    if (this.cachedProfile) return this.cachedProfile;
    if (this.profileFetchPromise) return this.profileFetchPromise;

    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    const proxyUrl = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    const token = await this.context.secrets.get(TOKEN_KEY);
    if (this.funnelStartupToken === undefined) this.funnelStartupToken = token ?? null;
    if (!token) {
      this.lastProfileFailure = null;
      // No seat yet (open entry before a grant): funnel events wait in memory.
      this.funnel.setTarget(undefined);
      return null;
    }

    const generation=this.profileGeneration;
    this.profileFetchPromise = fetchProfileResult({ proxyUrl, token }).then(
      async (r) => {
        if(generation!==this.profileGeneration || await this.context.secrets.get(TOKEN_KEY)!==token)return null;
        // #381 — remember WHY, so the token-entry flow can say something the
        // participant can act on instead of one generic "확인이 안 돼요".
        this.lastProfileFailure = r.ok ? null : r.failure;
        this.opsObserver?.profileResult(r.ok ? { ok: true } : { ok: false, status: r.failure.status, code: r.failure.reason === "expired" ? "expired" : undefined, requestId: r.failure.requestId, network: r.failure.reason === "network" }, token);
        let p = r.ok ? r.profile : null;
        this.servedWorkspaceRoot = p?.workspace_root ?? null;
        if (connections?.current && p) {
          if (p.activity_id!==connections.current.serverId) p=null;
          else p={...p,workspace_root:connections.current.workspace};
        }
        this.cachedProfile = p;
        this.profileFetchPromise = null;
        // #278 — gate the "페이지를 코치에게" toolbar button to opted-in cohorts.
        void vscode.commands.executeCommand(
          "setContext",
          "hypeproof-chat.pageContextEnabled",
          p?.input?.page_context === true,
        );
        // CR-02 (recon R3) — mirror the Curriculum Runtime switch; CR commands are gated on it.
        void vscode.commands.executeCommand("setContext", CR_CONTEXT_KEY, crContextKeyValue(p));
        // Learning wiki and deck generator commands follow the cohort's own switch.
        void vscode.commands.executeCommand("setContext", "hypeproof-chat.learningWikiEnabled", p?.learning_wiki?.enabled === true);
        // One-click publish: the button shows only where the served profile allows it.
        this.refreshSitePublishContext();
        if (!isCurriculumRuntimeEnabled(p)) this.clearElementContext();
        // CR-10 — the delete command follows whoever is signed in now (no disk I/O).
        void this.refreshCrBytesContext();
        // #306 — mirror the cohort's browser_session onto the hardened-session
        // settings the fork core patch reads (minor cohorts → persist:hp-safe).
        await this.applyBrowserSafety(p);
        this.activeCohortId = extractCohortIdUnverified(token) ?? null;
        this.nativeHistoryScope=(p?.access_identity?.kind==='account')?p.access_identity.scope:(p?.observation||this.activeCohortId==='studio-native-trial')?'native-'+(p?.observation?.scope??createHash('sha256').update(token).digest('hex')):null;
        // Task E — a resolved profile means we have a usable token; start the
        // chat-independent ping. Failures back off inside the pinger.
        // studio-funnel-events — a trial grant whose funnel route is on never posts to the
        // session-only /v1/trace/event; everything else keeps its liveness exactly as before.
        if(p?.access_identity?.kind!=='account' && usesTraceRoute(this.funnel.active && this.funnelProbedToken===token, decodeTokenPayloadUnverified(token)))this.startLiveness();else this.stopLiveness();
        void this.refreshFunnelTarget(p, token, proxyUrl);
        await this.migrateLegacyStateForActiveCohort();
        // Apply tone-appropriate labels to the preview panel (#159).
        const labels = labelsForProfile(p);
        this.preview.setLabels({
          title: labels.previewTitle,
          placeholder: labels.previewPlaceholder,
          emoji: labels.namingEmoji,
        });
        return p;
      },
      () => {
        this.profileFetchPromise = null;
        return null;
      },
    );
    return this.profileFetchPromise;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private getCoach(): CoachInfo {
    return this.context.globalState.get<CoachInfo>(this.coachKey(), {
      name: "",
      personality: "",
      configured: false,
    });
  }

  /**
   * #747 — the AI's display name for THIS seat: the lesson/cohort-fixed name
   * (ux.coach fixed precedence, #140 / ADR-0005), else the student's stored
   * name, else "코치". Every host-side sentence that names the AI (approval
   * modals, degraded notice, page-attach notice, start page) uses this, so a
   * lesson called "제작 파트너" is "제작 파트너" everywhere, not only in the header.
   */
  coachDisplayName(profile: ResolvedProfile | null = this.cachedProfile): string {
    return resolveCoach(this.getCoach(), profile).name;
  }

  /**
   * #747 — true when the displayed name was actually chosen: fixed by the
   * cohort/lesson, or named by this student. False means a `user_names_it`
   * seat that has not been through the naming step, where the start page
   * should describe the mode instead of showing the placeholder as a name.
   */
  coachNameIsChosen(profile: ResolvedProfile | null = this.cachedProfile): boolean {
    return profile?.ux.coach.naming_mode === "fixed" || this.getCoach().configured;
  }

  /**
   * Save the latest game to the workspace root as index.html so it persists
   * and is GitHub-Pages-ready. No approval modal — this is the kid saving
   * their own game in their own workspace (the core flow), not an AI-initiated
   * arbitrary file write.
   */
  /**
   * #371 — persist the coach's ```agent-md handoff fence to workspace/agent.md
   * (same sanctioned workspace-write pattern as index.html, REQ-D5). Surfaced
   * as a toolLog line so the participant knows the file exists.
   */
  private async saveAgentMdIfPresent(text: string, streamId?: string): Promise<void> {
    const md = extractAgentMd(text);
    if (!md) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;
    if (this.folderWriteBlocked(path.join(folders[0].uri.fsPath, "agent.md"), streamId)) return;
    try {
      const target = vscode.Uri.joinPath(folders[0].uri, "agent.md");
      await vscode.workspace.fs.writeFile(target, Buffer.from(md, "utf8"));
      noteHostWrite([{ absPath: target.fsPath, data: md }], "ai"); // the coach's own fence
      if (streamId) {
        this.postToolLog(streamId, {
          id: randomId(),
          icon: "📝",
          label: "agent.md 저장됨 — 작업 폴더에서 확인하세요",
          state: "done",
        });
      }
    } catch {
      // Non-fatal: the coach's reply already tells the user to copy manually.
    }
  }

  // ── Task E — liveness (heartbeat + artifactChanged) ───────────────────────

  /**
   * POST one liveness event to the worker. Never throws and never surfaces to
   * the participant: telemetry that can interrupt a kid mid-turn is worse than
   * telemetry that is missing.
   *
   * `x-hps-client-version` is what lets the instructor board say "this seat is
   * still on last week's build". It is optional on the worker side on purpose —
   * the worker deploys in 30 seconds, the app takes 1–2 hours plus a reinstall,
   * so an old client sending none of this is the normal path.
   */
  private async postLivenessEvent(
    ev: LivenessEvent,
  ): Promise<{ ok: boolean; status: number }> {
    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    const proxyUrl = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    const token = await this.context.secrets.get(TOKEN_KEY);
    // No token yet (the participant hasn't pasted one) is TRANSIENT, not a
    // rejection — status 0 makes the pinger back off and retry rather than
    // stopping for good.
    if (!token) return { ok: false, status: 0 };
    // studio-funnel-events — the trace route refuses a trial grant (403 session_inactive); do not send.
    if (!usesTraceRoute(this.funnel.active && this.funnelProbedToken === token, decodeTokenPayloadUnverified(token))) return { ok: false, status: 0 };
    const version = this.context.extension?.packageJSON?.version;
    try {
      const res = await fetch(`${proxyUrl.replace(/\/$/, "")}/trace/event`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(typeof version === "string" && version ? { "x-hps-client-version": version } : {}),
        },
        body: JSON.stringify(ev),
      });
      this.opsObserver?.traceResult(res.status);
      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  /** Start the 45 s ping. Idempotent — a second call is a no-op. */
  startLiveness(): void {
    if (this.heartbeat) return;
    this.heartbeat = startHeartbeat({
      send: (ev) => this.postLivenessEvent(ev),
      idleMs: () => Date.now() - this.lastActivityAt,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      log: (line) => this.logChannel?.appendLine(line),
      onStopped: () => {
        this.heartbeat = null;
      },
    });
    this.context.subscriptions.push({ dispose: () => this.stopLiveness() });
  }

  /**
   * CONV-FUNNEL-R-003 — one press on the free end card's buttons, as `{type, surface: end_card}`.
   * Only for a card this host drew on the seat the funnel probed (see endCardOfferToken). Every
   * press is sent; the Service keeps the first per grant and surface. Never throws.
   */
  private emitEndCardOffer(type: "offer_clicked" | "offer_dismissed"): void {
    if (!this.endCardOfferToken || this.endCardOfferToken !== this.funnelProbedToken) return;
    this.funnel?.emit({ type, surface: "end_card" });
  }

  /** studio-funnel-events — one App funnel event; validated, whitelisted and fire-and-forget. */
  funnelEmit(event: unknown): void {
    this.funnel.emit(event);
  }

  /** Free start (SPEC iteration 4 §1.5) — `trial_entry` reports the claim's outcome for this token. Memory only. */
  noteFreeClaim(token: string, outcome: "granted" | "reused"): void {
    this.funnelClaimHint = { token, outcome };
  }

  /**
   * studio-funnel-events — point the reporter at the Service route for this seat.
   * Not a trial grant → off. A trial grant → GET /v1/trial/events once per token; only a
   * `hps-trial-funnel/1` answer turns it on (404 while the Service flag is off). A network
   * failure leaves it "unknown" so the next profile read probes again. A failed profile read keeps
   * an already-probed token's target (see funnelProfileStep). Never throws.
   */
  private async refreshFunnelTarget(p: ResolvedProfile | null, token: string, proxyUrl: string): Promise<void> {
    try {
      const payload = decodeTokenPayloadUnverified(token);
      const step = funnelProfileStep({ profileOk: !!p, trialGrant: isTrialGrantToken(payload), token, probedToken: this.funnelProbedToken });
      if (step === "keep") return;
      if (step === "unknown") { this.funnelProbedToken = null; this.funnel.setTarget(undefined); return; }
      if (step === "off") { this.funnelProbedToken = null; this.funnel.setTarget(null); return; }
      if (!p) return;
      this.funnelProbedToken = token;
      const url = trialEventsUrl(proxyUrl);
      let probe: ReturnType<typeof parseTrialEventsProbe>;
      try {
        const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        probe = parseTrialEventsProbe(res.status, res.status === 200 ? await res.json().catch(() => null) : null);
      } catch {
        this.funnelProbedToken = null;
        return;
      }
      if (await this.context.secrets.get(TOKEN_KEY) !== token) return;
      if (!probe) { this.funnel.setTarget(null); return; }
      this.funnel.setTarget({ url, token, events: probe.events });
      if (p.access_identity?.kind !== 'account') this.stopLiveness();
      const version = this.context.extension?.packageJSON?.version;
      this.funnel.emit({
        type: "trial_entry",
        outcome: this.funnelClaimHint?.token === token ? this.funnelClaimHint.outcome
          : entryOutcome({ account: p.access_identity?.kind === 'account' || typeof payload?.personal_account === "string", token, startupToken: this.funnelStartupToken }),
        app_version: typeof version === "string" ? version : undefined,
        os: funnelOs(process.platform),
      });
    } catch (err) {
      this.logChannel?.appendLine(`[funnel] target not set: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  stopLiveness(): void {
    const h = this.heartbeat;
    this.heartbeat = null;
    h?.stop(); // onStopped nulls the field too — idempotent either way.
  }

  /**
   * Report that the participant's artifact changed — a digest and a length,
   * nothing else. Silent when the bytes are identical to the last report
   * (see ArtifactChangeGate).
   */
  private emitArtifactChanged(content: string): void {
    const ev = this.artifactGate.next(content);
    if (!ev) return;
    void this.postLivenessEvent(ev);
  }

  /** REQ-STUDIO-ARTIFACT-PROVENANCE — who the next page/engine save is recorded as (revealBuilt sets it). */
  private revealWriter: HostWriteActor = "studio";

  /** False only when the folder choice kept it off disk (the reply still renders from memory). */
  private async saveGameToWorkspace(html: string, streamId?: string): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return true;
    if (this.folderWriteBlocked(path.join(folders[0].uri.fsPath, "index.html"), streamId)) return false;
    try {
      const root = folders[0].uri;
      const target = vscode.Uri.joinPath(root, "index.html");
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, "utf8"));
      // Task E — "the coach ran for four minutes; did anything change?"
      noteHostWrite([{ absPath: target.fsPath, data: html }], this.revealWriter);
      this.emitArtifactChanged(html);
    } catch {
      // Non-fatal: preview still works even if the save fails.
    }
    return true;
  }

  /** Developer record of an SdkUnavailableError, verbatim (REQ-M30 ③; REQ-M45 keeps it when no fallback runs). */
  private logSdkUnavailable(reason: string): void {
    this.logChannel ??= vscode.window.createOutputChannel("HypeProof Coach");
    this.logChannel.appendLine(sdkFallbackLogLine(reason, new Date()));
  }

  /**
   * #476 — records the agent-sdk → proxy fallback for **three audiences**.
   *
   * 1. The developer — a dedicated output channel. The previous `console.warn` left
   *    nothing even in `exthost.log`, because the extension had `createOutputChannel`
   *    nowhere at all; on the day of the incident the string `[coach]` appeared 0
   *    times across every session. Checking after the fact was simply impossible. The
   *    raw reason is carried verbatim — the `SdkUnavailableError` message already
   *    lists the 4 candidate interpretations.
   * 2. The participant — one line in the conversation timeline (once per session). It
   *    says both what no longer works and what does.
   * 3. The instructor — no separate channel was built. That one line on the student's
   *    screen is the real thing an instructor walking the room can see, and it stays
   *    in the conversation record (REQ-C17), so it is visible after the fact too.
   *    Signalling the worker as well, to see it per classroom in `/console`, is left
   *    as separate work.
   *
   * Telling the coach itself is the **worker's** job — `degradedRuntimeNoticeFor`
   * (translate.ts). The runtime's ground truth is the route and the prompt's owner is
   * the worker, so it lands with a deploy and needs no app release.
   */
  private noteSdkFallback(reason: string, streamId: string): void {
    this.logSdkUnavailable(reason);

    // Once per session. The fallback keeps happening on that machine (without the
    // seed the next turn is the same), so attaching it every turn means nobody reads
    // it from the second one on and the record gets buried under warnings.
    if (this.fallbackNoticeShown) return;
    this.fallbackNoticeShown = true;
    // CGP-AGENT-R-003: the capability card now follows the proxy runtime.
    void this.postConfig();
    this.postToolLog(streamId, {
      id: randomId(),
      icon: "⚠️",
      label: coachDegradedNotice(this.coachDisplayName(), profileAudience(this.cachedProfile)),
      state: "error",
    });
  }

  /** D-028 — this panel's staging folder, created on the first attached photo. */
  private imageStaging: ImageStaging | null = null;
  private imageStagingScope: string | undefined;
  private ensureAttachmentStaging(): ImageStaging {
    const scope = `${this.turnRequestScope()}|${this.resolveCoachCwd() ?? ''}`;
    if (this.imageStaging && this.imageStagingScope !== scope) { this.imageStaging.dispose(); this.imageStaging=null; }
    if (!this.imageStaging) {
      const location=stagingRootFor(os.tmpdir(),process.pid,randomId());
      this.imageStaging=new ImageStaging(location.rootParent,location.root);this.imageStaging.purgeLeftovers();
    }
    this.imageStagingScope=scope;return this.imageStaging;
  }


  /**
   * D-028 — keep a photo dropped or pasted into the chat until the message is sent. Only a
   * cohort with `input.image_files` takes photos this way; a refusal goes back to the panel
   * so a failed chip remains available for targeted retry.
   */
  private async stageAttachedImage(stageId: string, name: string, mime: string, base64: string): Promise<void> {
    const refusal = this.stageImageBytes(stageId, name, mime, Buffer.from(base64, "base64"));
    if (refusal) void this.post({ type: "imageStageRefused", stageId, reason: refusal });
    else void this.post({ type: "imageStagedByHost", stageId, name });
  }

  /** Keep the bytes in the staging folder; returns the refusal shown to the participant, or null. */
  private stageImageBytes(stageId: string, name: string, mime: string, bytes: Buffer): string | null {
    if (!this.isImageFilesEnabled()) return "이 수업에서는 사진을 붙일 수 없어요.";
    this.ensureAttachmentStaging();
    const refusal = attachedImageRefusal({ name, mime, bytes: bytes.length, alreadyStaged: this.imageStaging?.has(stageId) ? 0 : this.imageStaging?.count() ?? 0 });
    if (refusal) return refusal;
    try {
      this.ensureAttachmentStaging();
      this.imageStaging!.stage(stageId, safeAttachedImageName(name, attachedImageExt(name, mime) ?? "jpg"), bytes);
      return null;
    } catch (err) {
      console.warn("[attached-images] staging failed:", err);
      return "사진을 잠시 보관하지 못했어요. 다시 끌어다 놓아 주세요.";
    }
  }

  /** D-028 — does this cohort take photos into the chat as files? */
  isImageFilesEnabled(): boolean {
    return this.cachedProfile?.input?.image_files === true;
  }

  /** D-028 — is this file already inside the class folder (an existing photo being viewed)? */
  isInsideWorkspace(fsPath: string): boolean {
    const roots = [this.resolveCoachCwd(), ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)].filter(
      (r): r is string => !!r,
    );
    return roots.some((r) => {
      const rel = path.relative(r, fsPath);
      return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    });
  }

  /**
   * D-028 — a photo dropped onto Studio from Finder. VS Code takes such a drop before the
   * chat webview sees it and opens the file as an editor tab (see #384), so extension.ts
   * hands the opened file here: it is staged like a dropped photo and its chip appears in
   * the chat. Returns false when it was not taken (the reason is shown in the chat).
   */
  async stageImageFromFile(fsPath: string): Promise<boolean> {
    return this.attachNativeImageFile(fsPath, true);
  }
  async attachNativeImageFile(fsPath: string, asFile: boolean, retryId?: string): Promise<boolean> {
    const scope = this.turnRequestScope(), root = this.resolveCoachCwd();
    const allowed = () => asFile ? this.isImageFilesEnabled() : this.isImagePasteEnabled();
    if (!allowed()) { if (retryId) this.failAttachmentRead(fsPath, asFile ? 'photo' : 'image', '지금은 이 파일을 붙일 수 없어요. 파일을 빼거나 활동 권한을 확인해 주세요.', retryId); return false; }
    const name = attachmentDisplayName(path.basename(fsPath));
    const ext = attachedImageExt(name, '') ?? '';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext ? `image/${ext}` : '';
    try {
      const bytes = Buffer.from(await withAttachmentDeadline(Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)))));
      if (retryId && !this.failedAttachmentReads.has(retryId)) return false;
      if (scope !== this.turnRequestScope() || root !== this.resolveCoachCwd()) { if (retryId) this.failedAttachmentReads.delete(retryId); return false; }
      if (!allowed()) { if (retryId) this.failAttachmentRead(fsPath, asFile ? 'photo' : 'image', '권한이 바뀌었어요. 파일을 빼거나 권한을 확인해 주세요.', retryId); return false; }
      const stageId = randomId().replace(/[^A-Za-z0-9_-]/g, '');
      const refusal = asFile ? this.stageImageBytes(stageId, name, mime, bytes)
        : bytes.length === 0 ? FILE_REFUSAL_COPY.empty : null;
      if (refusal) { this.failAttachmentRead(fsPath, asFile ? 'photo' : 'image', refusal, retryId); return false; }
      const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
      if (asFile) void this.post({ type: 'imageStagedByHost', stageId, name, ...(bytes.length <= 8 * 1024 * 1024 ? { dataUrl } : {}) });
      else this.attachImageDataUrl(dataUrl, name);
      if (retryId) { this.failedAttachmentReads.delete(retryId); void this.post({ type: 'attachmentFailureResolved', id: retryId }); }
      return true;
    } catch (error) {
      if ((!retryId || this.failedAttachmentReads.has(retryId)) && scope === this.turnRequestScope() && root === this.resolveCoachCwd()) this.failAttachmentRead(fsPath, asFile ? 'photo' : 'image', attachmentReadFailure(error), retryId);
      return false;
    }
  }

  /** Actual safe writes before optimistic UI send; retries use cached successful destinations. */
  private prepareAttachments(files: Array<{ id: string; stageId?: string; dataUrl?: string }>): { relPaths: string[]; pastedPaths: string[]; failures: import("./attachmentFailure").AttachmentFailure[]; stageIds: string[] } {
    const relPaths: string[] = [], pastedPaths: string[] = [], failures: import("./attachmentFailure").AttachmentFailure[] = [], stageIds: string[] = [];
    if (!Array.isArray(files) || files.length > 14 || files.some(f=>!f || typeof f.id!=="string" || f.id.length>128) || files.filter(f=>f.dataUrl!==undefined).length>4 || files.filter(f=>f.stageId!==undefined).length>10) return { relPaths, pastedPaths, failures: [{id:"limit",name:"첨부 파일",reason:ATTACHMENT_FAILURE_COPY.tooMany,final:true}], stageIds };
    const root = this.resolveCoachCwd();
    if (files.length) this.ensureAttachmentStaging();
    for (const file of files) {
      const name = file.stageId ? this.imageStaging?.name(file.stageId) ?? "사진" : "붙인 이미지";
      // As on main (savePastedImages): with no work folder a pasted image has no save target and still
      // rides inline to the model, so it is not a preparation failure. Staged photo files still fail.
      if (!root && file.dataUrl !== undefined) continue;
      try {
        if (!root || this.connectionChanging || this.taskChanging || (file.dataUrl ? !this.isImagePasteEnabled() : !this.isImageFilesEnabled())) throw new Error("attachment_unavailable");
        const refusal = this.folderWriteRefusalFor(path.join(root, file.dataUrl ? PASTED_IMAGE_DIR : ATTACHED_IMAGE_DIR));
        if (refusal) { failures.push({id:file.id,name,reason:refusal}); continue; }
        let stageId = file.stageId;
        if (file.dataUrl !== undefined) {
          if (typeof file.dataUrl !== "string" || file.dataUrl.length > 12 * 1024 * 1024) throw new Error("attachment_too_large");
          const parsed = parsePastedImage(file.dataUrl);
          if (!parsed) throw new Error("attachment_format");
          stageId = `paste-${createHash("sha256").update(file.dataUrl).digest("hex").slice(0,40)}`;
          const staging=this.ensureAttachmentStaging();
          if (!staging.has(stageId)) staging.stage(stageId, `붙인-이미지.${parsed.ext}`, Buffer.from(parsed.base64,"base64"));
        }
        if (!stageId || !this.imageStaging) throw new Error("missing_stage");
        const result = this.imageStaging.commit([stageId], root, file.dataUrl ? PASTED_IMAGE_DIR : ATTACHED_IMAGE_DIR);
        stageIds.push(stageId);
        if (result.failed) failures.push({id:file.id,name,reason:result.failures[0]?.reason ?? "사진을 저장하지 못했어요. 다시 시도해 주세요."});
        else (file.dataUrl ? pastedPaths : relPaths).push(...result.relPaths);
      } catch (error) { failures.push({id:file.id,name,reason:attachmentReadFailure(error)}); }
    }
    return { relPaths, pastedPaths, failures, stageIds };
  }

  /** #278 Phase 1 — does this cohort's profile request the native live-server preview? */
  private isLiveServerPreview(): boolean {
    return this.cachedProfile?.preview?.type === "live_server";
  }

  /**
   * Reveal a freshly-built page. Always persists it to the workspace root
   * (index.html, GitHub-Pages-ready). Then either:
   *  - live_server cohorts (#278): serve the workspace root over
   *    http://127.0.0.1 and open/refresh the native integrated browser — real
   *    origin, so multi-file, same-origin fetch, storage, and page navigation
   *    all work; or
   *  - default: the sandboxed iframe PreviewProvider (existing behavior).
   * Public so extension.ts (runLastCode) shares the same routing.
   */
  /**
   * **Before** a new world is written to index.html, archive the current one as
   * '이전 세상/<title>.html'.
   *
   * 2026-08-20 (#649) — it used to skip the whole thing when
   * `lastPrebuiltWorld === nextId`. That rule caused a real incident: "water instead
   * of fire in 초코's world" fetched 초코's world again, and because it was the same
   * world the archive was skipped and the index.html the child had spent a long time
   * editing was overwritten. The criterion is now **content**, not id — if the
   * current file differs from the HTML about to be written, it is always archived,
   * even when the same world was clicked again. A failed archive does not block
   * opening the world (the child's screen comes first).
   */
  private async archiveCurrentWorld(nextHtml: string, streamId?: string): Promise<string | null> {
    const cwd = this.resolveCoachCwd();
    if (!cwd) return null;
    let html: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(cwd, "index.html")));
      html = Buffer.from(bytes).toString("utf8");
    } catch {
      return null; // no file means there is nothing to archive
    }
    if (!shouldArchiveWorld(html, nextHtml)) return null;
    if (this.folderWriteBlocked(path.join(cwd, WORLD_ARCHIVE_DIR), streamId)) return null;
    try {
      const dir = vscode.Uri.file(path.join(cwd, WORLD_ARCHIVE_DIR));
      await vscode.workspace.fs.createDirectory(dir);
      let taken: string[] = [];
      try {
        taken = (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name);
      } catch {
        /* the empty folder we just created */
      }
      const name = worldArchiveFileName(worldArchiveTitle(html), taken);
      // 2026-08-20 review — putting the source in as-is means the archived copy
      // **does not open**: a world's HTML calls `<script src="engine.js">` by relative
      // path, and since it is saved under '이전 세상/' it went looking for
      // `이전 세상/engine.js` → 404 → S_* ReferenceError → a black screen. On top of
      // that the engine now differs per world (#644) — keeping one copy in the folder
      // is not enough either. So the archived copy **inlines** that world's engine and
      // is complete in itself.
      const body = await this.inlineEngineIfNeeded(html);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(path.join(cwd, WORLD_ARCHIVE_DIR, name)),
        Buffer.from(body, "utf8"),
      );
      // An archive that happens silently is the same as no archive — the child does
      // not know a backup was made and asks "where did the one from before go?". An
      // archive that happened inside a turn leaves one line.
      if (streamId) {
        this.postToolLog(streamId, {
          id: randomId(),
          icon: "📦",
          label: `고치던 세상을 「${WORLD_ARCHIVE_DIR}」 폴더에 넣어 뒀어요 — ${name}`,
          state: "done",
        });
      }
      return name;
    } catch (e) {
      console.warn(`[world] 이전 세상 보관 실패: ${String(e).slice(0, 120)}`);
      return null;
    }
  }


  /**
   * "갤러리에 올리기" — sends the current world to the lab gallery.
   *
   * ## What is uploaded
   *
   * Not the last HTML on the chat screen but **the work folder's `index.html`**. The
   * child also edits the file directly without going through the coach (that is one
   * of this lesson's goals), and what was edited that way is what has to go up.
   * `engine.js` is inlined to make it **one single page** — the gallery takes exactly
   * one file, and the relative `<script src="engine.js">` 404s there
   * (`archiveCurrentWorld` does the same thing for the same reason).
   *
   * ## Whose it is is NOT decided here
   *
   * Only the token is sent. The name and seat number are looked up by the server on
   * the distribution board — the child never retypes their own name, and there is no
   * room to write someone else's.
   *
   * ## Failures are not swallowed
   *
   * It is a button pressed explicitly, so the result has to be visible on screen. The
   * Korean sentence the server produced is handed to the webview as it is
   * (`publishResult`). A VS Code toast is not used because the integrated browser
   * stops on a notification (the same reason as #308).
   */
  private galleryPublishing = false;
  private async publishToGallery(): Promise<void> {
    if (this.galleryPublishing) return;
    this.galleryPublishing = true;
    const generation = this.profileGeneration;
    try {
    const fail = (message: string) =>
      void this.post({ type: "publishResult", state: "error", message });

    // #748 — the profile owns the publishing policy. This check comes **before** the
    // world / token / folder ones: a seat that is not permitted must not be handed a
    // next-step hint like "open a world first". That reads as something that would
    // work if they did it.
    const allowed = galleryPublishAllowed(this.cachedProfile?.publishing);
    if (!allowed.ok) return fail(allowed.message);

    const worldId = this.lastPrebuiltWorld;
    if (!worldId) return fail("먼저 친구를 눌러 세상을 열어주세요.");

    const token = await this.context.secrets.get(TOKEN_KEY);
    if (!token) return fail(TOKEN_MISSING_FRIENDLY);

    const cwd = this.resolveCoachCwd();
    if (!cwd) return fail("작업 폴더를 찾지 못했어요.");

    let html: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(cwd, "index.html")));
      html = Buffer.from(bytes).toString("utf8");
    } catch {
      return fail("아직 만든 세상이 없어요.");
    }

    const body = await this.inlineEngineIfNeeded(html);
    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    // The spool session directory's name IS the session_id (sessionSpool builds it
    // that way). Null when the spool is off — publishing still goes ahead. Getting the
    // work itself up comes before keeping the logs joined up.
    const sessionDir = this.spool?.currentSessionDir() ?? null;
    const sessionId = sessionDir ? path.basename(sessionDir) : null;

    const siteBase = resolveSiteBase(cfg.get<string>("siteBase"));
    const title = extractTitle(body);
    const current = async () => { const activeToken = await this.context.secrets.get(TOKEN_KEY); return token === activeToken && generation === this.profileGeneration && cwd === this.resolveCoachCwd() && worldId === this.lastPrebuiltWorld && galleryPublishAllowed(this.cachedProfile?.publishing).ok; };

    // Publish succeeded → a log snapshot of the in-flight session goes up **without sealing it** (2026-08-21 operations
    // decision: guardian pre-survey consent secured). The "this far" at publish time survives on the server even when the
    // learner misses "기록 보내기"; the complete upload at the end of the lesson overwrites the same key (the header comment
    // on uploadSessionSnapshot is the canonical one). REQ-KNOW-09 / DEC-KNOW-09: the snapshot is read once here and listed
    // as its own block (recipient, files, sizes) in the publish confirmation; exactly those bytes are sent afterwards.
    let record: GalleryRecord | null = null;
    if (sessionDir && sessionId && this.cachedProfile?.analytics?.upload_session_logs === true) {
      const read = readSessionSnapshot({ dir: sessionDir, day: path.basename(path.dirname(sessionDir)), sessionId });
      if (read.ok) {
        const proxyUrl = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
        const session = { dir: sessionDir, day: path.basename(path.dirname(sessionDir)), sessionId };
        record = {
          recipient: snapshotRecipient(proxyUrl),
          items: snapshotItems(read.entries).map((i) => ({ name: `이번 활동 기록 ${i.name}`, bytes: i.bytes })),
          send: () => sendSessionSnapshot({ session, baseUrl: proxyUrl, token, current: async () => await this.context.secrets.get(TOKEN_KEY) === token }, read.entries).then((r) => {
            console.log(
              r.ok
                ? `[gallery] 로그 스냅샷 업로드 완료 (${r.keys.length}개 파일)`
                : `[gallery] 로그 스냅샷 실패 (${r.failedAt}: ${r.message}) — 수업 끝 완결 업로드가 대신한다`,
            );
          }),
        };
      }
    }
    const result = await publishWorldConfirmed({
      previewVisitor: showVisitorPreview,
      siteBase,
      token,
      worldId,
      title,
      html: body,
      sessionId,
    }, confirmOutbound, current, record);

    if (!result.ok) {
      console.error(`[gallery] 발행 실패 (${result.status}): ${result.message}`);
      return fail(result.message);
    }
    void this.post({ type: "publishResult", state: "done", url: result.url });

    } finally { this.galleryPublishing = false; }
  }

  /** Saves engine.js into the work folder (beside the world HTML). A failure is rescued by the preview's inlining. */
  private async saveEngineToWorkspace(js: string, streamId?: string): Promise<void> {
    const cwd = this.resolveCoachCwd();
    if (!cwd) return;
    if (this.folderWriteBlocked(path.join(cwd, "engine.js"), streamId)) return;
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(cwd, "engine.js")), Buffer.from(js, "utf8"));
      noteHostWrite([{ absPath: path.join(cwd, "engine.js"), data: js }], this.revealWriter);
    } catch { /* the fallback rescues it by inlining */ }
  }

  /** For the srcdoc fallback — replaces `<script src="engine.js">` with the file's contents. */
  private async inlineEngineIfNeeded(html: string): Promise<string> {
    if (!html.includes('<script src="engine.js"></script>')) return html;
    const cwd = this.resolveCoachCwd();
    if (!cwd) return html;
    try {
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(cwd, "engine.js")));
      return html.replace('<script src="engine.js"></script>', `<script>\n${Buffer.from(buf).toString("utf8")}\n</script>`);
    } catch {
      return html;
    }
  }

  /** Debounce timer for consecutive saves (preview once, after the last save). */
  private revealTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The id of the pre-built world currently on screen. Since #649 it does NOT mean
   * "do not fetch it again" (re-clicking the same world fetches it again, archiving
   * first) — it is used to restore the friend strip's highlight when the webview
   * remounts.
   */
  private get lastPrebuiltWorld(): string | null {
    return this.context.workspaceState.get<string>(openWorldKeyForCohort(this.activeCohortId), "") || null;
  }
  /**
   * 2026-08-20 review — while this was an in-memory field, reopening the window
   * (Reload Window, or closing and reopening the laptop) left index.html holding the
   * world the child had edited while the app alone went back to "no world open": the
   * strip highlight disappeared, the runner ran as ✨, and the world notice on the
   * first send after a Clear never attached again. The value is a single id, so
   * storing it costs nothing.
   */
  private set lastPrebuiltWorld(id: string | null) {
    void this.context.workspaceState.update(openWorldKeyForCohort(this.activeCohortId), id ?? undefined);
  }

  /** revealPrebuiltWorld re-entry guard — a child's rapid clicking must not overlap index.html writes. */
  private worldOpening = false;

  /** The name of the file archived this time (if any). Used to tell the coach "what to roll back to is here". */
  private lastArchivedWorldFile: string | null = null;

  /**
   * 2026-08-19 — fetches the worker's pre-built world (GET /v1/worlds/:id) and shows
   * it through revealBuilt. False on failure — the coach then builds it itself as
   * before (slow, but it works).
   */
  private async revealPrebuiltWorld(id: string, proxyUrl: string, token: string): Promise<boolean> {
    // 2026-08-20 review — when a child hammers the friend buttons (초코, then 나비
    // within a second) this function ran overlapped and the archive and the index.html
    // write raced. It is blocked in two layers, together with the webview's pending
    // guard — the second call opens no world and is passed on as a coach turn.
    if (this.worldOpening) return false;
    this.worldOpening = true;
    try {
      const base = proxyUrl.replace(/\/$/, "");
      const res = await fetch(base + "/worlds/" + encodeURIComponent(id), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return false;
      const html = await res.text();
      if (!/<!doctype html/i.test(html)) return false;
      // #629 — a world's HTML calls the engine with <script src="engine.js">. It has
      // to be saved into the same folder first for the live server to serve it 200.
      //
      // #644 (2026-08-20, real device) — **that world's own engine** is fetched first
      // now. The shared copy carries all 9 worlds' sprites (S_PENG penguin, S_ICE
      // ice…), so one read by the coach produced ice talk in 초코's world. A per-world
      // engine holds only that world's art, so there is nothing to bleed even if it is
      // read. On a 404 or a failure it falls back to the shared one — with no engine
      // the screen does not come up at all, and that is worse than contamination.
      //
      // 2026-08-20 review — this used to carry on **even when both candidates
      // failed**. Then index.html alone became the new world while engine.js was the
      // previous world's (or missing entirely), so the S_* constants the new HTML
      // calls were undefined → ReferenceError → a black screen — while the coach was
      // told "it is already up" (this is exactly the path when the classroom wifi
      // drops). So the engine is secured **first**, and when it cannot be fetched the
      // child's files are left untouched and false is returned, handing over to the
      // coach-generation path — slow, but the screen does come up.
      let engineJs: string | null = null;
      for (const url of worldEngineUrls(base, id)) {
        try {
          const eng = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
          if (!eng.ok) continue;
          engineJs = await eng.text();
          break;
        } catch {
          /* on to the next candidate (the shared one) — throwing here means the world never opens */
        }
      }
      if (!engineJs) return false;
      // Swapping the engine and writing index.html are one unit, so revealBuilt owns
      // the whole ordering: archive the old world (inlining the engine.js of that
      // moment) → save the new engine → save the new index.html. Swapping the engine
      // in here first would inline **the NEXT world's** engine into the archived copy
      // and misalign its sprites, and if the structure guard then blocks, index.html
      // is left on the old world while engine.js alone is the new one.
      const ok = await this.revealBuilt(html, { artifactSource: "prebuilt", engineJs });
      if (!ok) return false;
      this.lastPrebuiltWorld = id;
      // Tell the webview so its friend strip can highlight the currently open world (#649).
      const w = this.cachedProfile?.worlds?.find((x) => x.id === id);
      void this.post({ type: "worldOpened", id, guest: w?.guest ?? "", emoji: w?.emoji ?? "" });
      return true;
    } catch {
      return false;
    } finally {
      this.worldOpening = false;
    }
  }

  /**
   * 2026-08-19 — shows the .html the SDK coach saved with Write/Edit in the preview.
   * It reads the file and hands it to revealBuilt (exactly the same save/reveal
   * behaviour as the fence path). A missing file, or one that is not HTML, is passed
   * over silently — so that the coach's next utterance does not stand in for the
   * screen, a failure leaves only one tool-log line.
   */
  private async revealWrittenHtml(filePath: string, streamId?: string): Promise<void> {
    try {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(this.resolveCoachCwd() ?? "", filePath);
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
      const html = Buffer.from(buf).toString("utf8");
      if (!/<html[\s>]/i.test(html) && !/<!doctype html/i.test(html)) return;
      await this.revealBuilt(html, { streamId, artifactSource: "assistant_tool" });
    } catch (e) {
      if (streamId) {
        this.postToolLog(streamId, { id: randomId(), icon: "🖼️", label: `미리보기 열기 실패: ${String(e).slice(0, 80)}`, state: "error" });
      }
    }
  }

  /**
   * A5 (orchestrator spec §6.3) — before revealBuilt saves index.html on an adult orchestrator
   * seat whose roster lists `archive_before_overwrite`, keep the current page in
   * .hypeproof/history (A3 archiveBeforeOverwrite: identical content is skipped, the newest 20
   * are kept), with one timeline line. The same file saveGameToWorkspace writes: the first
   * workspace folder's index.html. No model call, no modal, never throws: an archive that fails
   * does not stop the save.
   */
  private archiveAdultPage(nextHtml: string, streamId?: string): void {
    try {
      const roster = orchestratorRosterFor(this.cachedProfile);
      if (!roster?.checks.includes("archive_before_overwrite")) return;
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) return;
      if (this.folderWriteBlocked(path.join(root, ".hypeproof", "history"), streamId)) return;
      const outcome = archiveBeforeOverwrite({
        seat: { profile: this.cachedProfile, orchestrator: true },
        workspaceRoot: root,
        file: "index.html",
        nextContent: nextHtml,
      });
      if (!outcome.archived || !outcome.path || !streamId) return;
      const label = outcome.timeline ?? adultArchiveTimelineLabel(outcome.path);
      this.postToolLog(streamId, { id: randomId(), icon: "🗂", label: label.replace(/^🗂\s*/, ""), state: "done" });
    } catch {
      /* the learner's save comes first */
    }
  }

  async revealBuilt(
    html: string,
    opts?: {
      streamId?: string;
      /** #580 — for callers that leave the UI alone and need only spool attribution (the browser loop). */
      spoolTurnId?: string;
      /** Distinguishes a pre-built copy from the student's/AI's edited one, even for identical HTML. */
      artifactSource?: SpoolArtifactSource;
      /**
       * The world engine paired with this HTML (#644). When given, it is swapped in
       * **after the archive and just before the save** — reverse the order and the
       * archived copy gets the NEXT world's engine, and when the structure guard
       * blocks, index.html (old world) and engine.js (new world) are left mismatched.
       */
      engineJs?: string;
    },
  ): Promise<boolean> {
    const releasePower = workPower.acquire("preview-build");
    try {
    // #359 — structural guard: auto-repair the known comment-close typo, and
    // refuse to reveal a still-broken document as if it succeeded. Returns
    // false when blocked so the streaming caller can let a corrected block retry.
    const checked = validateAndRepairHtml(html);
    // #580 — "preview open" is one of the 5 MVP events in #552. Every reveal path
    // (stream auto · ▶ Run · show-intent · browser loop) funnels into this method, so
    // it is recorded here, in one place. **After** the structure guard — a blocked
    // reveal never reached the screen, and recording it would overcount "preview
    // opened".
    if (!checked.blocked) {
      const spoolTurn = opts?.streamId ?? opts?.spoolTurnId;
      this.spool?.recordWorkflow({
        ...(spoolTurn ? { turnId: spoolTurn } : {}),
        event: "preview_reveal",
      });
    }
    if (checked.issues.length > 0) this.surfaceStructureIssues(checked, opts?.streamId);
    if (checked.blocked) return false;

    const spoolTurn = opts?.streamId ?? opts?.spoolTurnId;
    this.spool?.recordArtifactSnapshot({
      ...(spoolTurn ? { turnId: spoolTurn } : {}),
      source: opts?.artifactSource ?? (spoolTurn ? "assistant_response" : "manual_preview"),
      path: "index.html",
      content: checked.html,
    });
    // #751 F4 — a real change to the artifact, reported to the class board as digests only (never the HTML).
    { const after = createHash("sha256").update(checked.html, "utf8").digest("hex"); this.opsObserver?.artifactChanged(this.opsLastArtifact, after); this.opsLastArtifact = after; }

    // 2026-08-17, Windows real device — the screen stayed blank for a long time
    // **even after** the coach said "완성됐어요!". Between the stream ending and the
    // preview actually coming up sit the live-server startup and opening a tab, and
    // with nothing shown across that stretch it simply looks stopped to the child
    // ("완성된거 안보여").
    //
    // That gap is filled with one timeline line. It turns done when it really comes
    // up and error when it fails, so the state "said it was up but it was not" never
    // stays on screen (R0).
    // D-027 — a summary cohort sees the line only while the preview opens: a `pending-` id is
    // hidden once done. Five Edits in one turn used to leave five "미리보기를 열었어요".
    const summaryActivity = toolActivityMode(this.cachedProfile) === "summary";
    const revealLogId = summaryActivity ? `pending-reveal-${randomId()}` : randomId();
    const logReveal = (state: "running" | "done" | "error", label: string): void => {
      if (!opts?.streamId) return;
      const shown = summaryActivity && state === "running" ? PREVIEW_PHRASE.label : label;
      this.postToolLog(opts.streamId, { id: revealLogId, icon: "🖼️", label: shown, state });
    };

    logReveal("running", "미리보기 여는 중");
    // 2026-08-20 review — the point that actually overwrites the work folder's
    // index.html funnels into this one place (pre-built world · ▶ Run · "보여줘" ·
    // coach fence). With the archive living only inside revealPrebuiltWorld,
    // "보여줘" / ▶ Run overwrote the file the child had edited, with no archive, using
    // an **old fence** out of the history — the loss #649 blocked was still there
    // through another door.
    // Kids track only — an '이전 세상' folder appearing in an adult's work folder
    // would be stranger still.
    // When the content is identical, shouldArchiveWorld filters it out so archived
    // copies do not pile up (the coach's Edit-save path rewrites the file itself, so
    // it is always filtered here).
    if (isWorldCohort(this.cachedProfile)) {
      this.lastArchivedWorldFile = await this.archiveCurrentWorld(checked.html, opts?.streamId);
    }
    // A5 (orchestrator spec §6.3, FO-10) — adults on an orchestrator seat get the same safety
    // before this same overwrite: the page about to be replaced is copied to .hypeproof/history.
    // Kids never reach it (their worlds archive above; the gate fails closed for minors and
    // unknown tiers), and neither does a seat without the roster's archive check.
    this.archiveAdultPage(checked.html, opts?.streamId);
    // Swap the engine in **after** the archive is done (the archived copy takes the
    // old engine inlined).
    // REQ-STUDIO-ARTIFACT-PROVENANCE — the coach's own output (this turn's answer or tool) is the AI's;
    // a prebuilt world, a re-shown or a clicked-to-run page is Studio's write (its bytes' author is not recorded).
    const writer: HostWriteActor = opts?.artifactSource === "assistant_response" || opts?.artifactSource === "assistant_tool" ? "ai" : "studio";
    this.revealWriter = writer;
    if (opts?.engineJs !== undefined) await this.saveEngineToWorkspace(opts.engineJs, opts?.streamId);
    // REQ-STUDIO-FOLDER-CONSENT — not saved (읽기만): the live server would show the old file, so the reply renders from memory.
    const saved = await this.saveGameToWorkspace(checked.html, opts?.streamId);
    if (saved && this.isLiveServerPreview() && (await this.openInLiveServer())) {
      logReveal("done", "미리보기를 열었어요");
      return true;
    }
    // #629 — the srcdoc preview (fallback) cannot read the relative
    // <script src="engine.js">. This path is taken only when the live server did not
    // come up, so the engine is inlined here and only here.
    await this.preview.show(await this.inlineEngineIfNeeded(checked.html));
    logReveal("done", "미리보기를 열었어요");
    return true;
    } finally { releasePower(); }
  }

  /**
   * #359 — surface a one-line structural note for a build. In-stream we reuse
   * the existing toolLog channel (a corrected/blocked build reads like any
   * other build step); off-stream (e.g. the ▶ Run button) we fall back to a
   * VS Code warning toast.
   */
  private surfaceStructureIssues(r: HtmlStructureResult, streamId?: string): void {
    const label = `생성물 점검: ${r.issues.join(" · ")}`;
    if (streamId) {
      this.postToolLog(streamId, {
        id: randomId(),
        icon: r.blocked ? "🚫" : "⚠️",
        label,
        state: r.blocked ? "error" : "done",
      });
    } else {
      void vscode.window.showWarningMessage(label);
    }
  }

  /**
   * Ensure the live server is up for the workspace root and open (or refresh)
   * the native browser at its URL. Returns false on any failure so the caller
   * falls back to the iframe preview.
   */
  private async openInLiveServer(): Promise<boolean> {
    return (await this.startLivePreview()) !== null;
  }

  /**
   * Ensure the live server is up for the workspace root and open (or refresh)
   * the native browser at its URL. Returns the server URL, or null on failure
   * (no workspace / server error) so callers can fall back or report.
   * Shared by the live_server preview path and the coach's
   * `live_preview_start` MCP tool (#282 P2 slice 2).
   */
  async startLivePreview(): Promise<string | null> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return null;
    try {
      const base = await this.liveServer.ensure(root);
      // Avoid stacking preview tabs on the right. The live server binds a fresh
      // random port on each (re)start (app relaunch, root change), so the URL
      // can differ from a previously-opened tab — an exact-URL match alone then
      // fails and every restart opens ANOTHER tab. So we match by "is this a
      // loopback preview tab" (port-independent): reuse the one already on the
      // current URL via SSE reload; otherwise close any STALE preview tabs
      // (dead port from a prior server start) and open exactly one fresh tab.
      const tabs = this.coachBrowserTabs();
      const isPreviewTab = (u?: string): boolean =>
        !!u && /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(u);
      const current = tabs.find((t) => t.url?.startsWith(base));
      // #519 — below, the preview tab is pinned as the coach's drive target. Leaving
      // it as `?.` means that when live_preview_start is the first tool call (no
      // instance yet) the pin is silently lost and the screenshot that follows falls
      // back to depending on activeBrowserTab.
      this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions());
      if (current) {
        this.liveServer.reload();
        // #519 — pin this tab so that it is the target when the coach calls
        // screenshot/read next. This path opens with `preserveFocus: true`, so
        // activeBrowserTab may not be set, and when that happened the inspection tools
        // failed with "열린 탭이 없어요".
        this.mcpBrowser.setTargetTab(current);
        // #525 — this is the flow where the participant said "미리보기 띄워줘". If the
        // already-open tab is in the background, only a reload happens and the screen
        // is unchanged, so it looks like "nothing happened". Bring it forward.
        await this.revealBrowserTab(current);
      } else {
        // REQ-STUDIO-PREVIEW-RECOVERY — only tabs on an address this process's own server served are closed; another
        // localhost tool's tab (or one on a port Studio used in an earlier run) is never touched.
        for (const t of tabs) {
          if (isPreviewTab(t.url) && this.liveServer.servedThisSession(t.url)) {
            try {
              await t.close();
            } catch {
              /* best-effort — a tab we can't close shouldn't block the preview */
            }
          }
        }
        // Open in the FIRST editor column (not Beside): this cohort edits via the
        // coach, so the editor area is otherwise an empty welcome group. Beside
        // would open the preview next to that empty group, leaving a blank pane
        // between the chat sidebar and the preview. ViewColumn.One fills the main
        // editor area so the layout is just: chat sidebar | preview.
        const opened = await vscode.window.openBrowserTab(base, {
          viewColumn: this.editorChat ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
          preserveFocus: true,
        });
        this.mcpBrowser.setTargetTab(opened);
      }
      return base;
    } catch {
      return null;
    }
  }

  /**
   * #507 — corrects the proxy path's (#278) `browser_navigate` right before it runs.
   *
   * When the coach does not know the live server's address it reflexively types a
   * common port such as `127.0.0.1:3000` (3000 appears nowhere in the code — it is
   * the model's guess). The live server takes a random port via `listen(0)` on every
   * run, so that address is always empty and it ends in `ERR_CONNECTION_REFUSED`. The
   * Run button receives the URL directly so it was fine; only the coach failed,
   * because it did not have this path (#470 recurrence).
   *
   * Nothing is corrected when the server is not up — it is never fixed by guessing
   * (if we do not know, leave it as it is).
   */
  private retargetLoopbackNavigation(call: BrowserToolCall): {
    call: BrowserToolCall;
    note?: string;
  } {
    if (call.name !== "browser_navigate") return { call };
    const requested = String(call.input?.url ?? "");
    const target = resolveLivePreviewUrl(requested, this.liveServer.currentUrl());
    if (!target?.redirected) return { call };
    return {
      call: { ...call, input: { ...call.input, url: target.url } },
      note:
        `참고: ${target.requested} 은(는) 이 Studio 의 주소가 아니라 실제 라이브 서버 주소 ` +
        `${target.url} 로 이동했어요. 라이브 서버 포트는 실행할 때마다 달라지니 ` +
        `추측하지 말고 이 주소를 쓰세요.`,
    };
  }

  /**
   * #282 P2 slice 2 — host capabilities behind the "hypeproof" MCP browser
   * tools. Registered by runSdkCoach only when the profile grants
   * sdk_tools.browser (adults; minors are stripped). Silent by design: MCP
   * failures become isError tool results the coach can react to in-chat —
   * a toast here would pause the integrated browser (#308).
   */
  /**
   * Brings an already-open browser tab **to the front of the participant's screen**
   * (#525).
   *
   * The proposed API's `BrowserTab` has no `show()`/`reveal()`, and calling
   * `openBrowserTab` again makes a new tab, undoing #519. So the **plain editor
   * path** is used: activate the group, put that tab in front with
   * `openEditorAtIndex`, and bounce back if the participant was in an editor.
   *
   * Measured on 2026-08-02 (installed 0.1.16, isolated profile):
   *   - a browser tab that was in the background really does come forward
   *   - after the bounce, `activeTextEditor` **and the selection are preserved
   *     exactly**
   *   - that column keeps showing the browser (it does not revert)
   *
   * Two disciplines — both of them "if we are not sure, do not touch the
   * participant's screen":
   *   ① Tab identification is the intersection of `pickRevealTabIndex`'s three
   *      conditions. With two candidates it does nothing (labels were seen tying in
   *      the measurements).
   *   ② With no `activeTextEditor` the bounce is skipped — with no cursor to return
   *      to, the risk of disturbing an IME composition is 0 (when the coach uses a
   *      tool, the participant's focus is usually in the chat sidebar).
   *
   * All of it is best-effort. It never throws on failure — turning the tool result
   * into an error would be the worse state of "it opened but it looks like it
   * failed".
   */
  private async revealBrowserTab(tab: vscode.BrowserTab): Promise<void> {
    try {
      if (!tab.url) return;
      const column = coachTabSlot(tab.url) === "preview" ? 1 : 2;
      const group = (vscode.window.tabGroups?.all ?? []).find((g) => g.viewColumn === column);
      if (!group) return;
      const index = pickRevealTabIndex(
        group.tabs.map((t, i) => ({
          index: i,
          label: t.label,
          inputIsUndefined: t.input === undefined,
          isActive: t.isActive,
        })),
        tab.title,
      );
      if (index === null) return;

      // Grab the bounce target **before** firing the command — after firing it has
      // already moved.
      const restore = vscode.window.activeTextEditor;
      const focusGroup = column === 1 ? FOCUS_FIRST_GROUP : FOCUS_SECOND_GROUP;
      await vscode.commands.executeCommand(focusGroup);
      await vscode.commands.executeCommand(OPEN_EDITOR_AT_INDEX, index);
      if (restore) {
        // Restore the cursor and the selection too. showTextDocument can name the
        // column explicitly, which is more precise than a focus{N}EditorGroup
        // combination (the participant may be in column 3).
        await vscode.window.showTextDocument(restore.document, {
          viewColumn: restore.viewColumn,
          selection: restore.selection,
          preserveFocus: false,
        });
      }
    } catch {
      /* failing to bring it forward does not make the tool itself fail — pass over quietly */
    }
  }

  /**
   * A5 (orchestrator spec §6.1) — the site check's own browser tabs, while a check holds one.
   * The coach's tab plans (browser_open, live_preview_start, the duplicate check) never see them,
   * so a check tab is neither reused as the preview nor closed under a running check.
   */
  private readonly siteCheckTabs = new Set<vscode.BrowserTab>();
  private siteCheckPages?: SiteCheckViewports<vscode.BrowserTab>;

  /** The browser tabs the coach's tab logic works on: every tab but the site check's. */
  private coachBrowserTabs(): readonly vscode.BrowserTab[] {
    const tabs = vscode.window.browserTabs ?? [];
    return this.siteCheckTabs.size ? tabs.filter((t) => !this.siteCheckTabs.has(t)) : tabs;
  }

  /**
   * The page a site check measures in (BrowserMcpHost.viewportPage; browserMcp.ts
   * SiteCheckViewports): the learner's own 화면 크기 검수 tab for this page when one is open,
   * otherwise a background tab opened without focus and closed after the check. The learner's
   * preview tab is never navigated.
   */
  private siteCheckViewports(): SiteCheckViewports<vscode.BrowserTab> {
    this.siteCheckPages ??= new SiteCheckViewports<vscode.BrowserTab>({
      tabs: () => this.coachBrowserTabs(),
      urlOf: (tab) => tab.url,
      open: async (url) => {
        const tab = await vscode.window.openBrowserTab(url, {
          viewColumn: this.editorChat ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
          preserveFocus: true,
          background: true,
        });
        this.siteCheckTabs.add(tab);
        return tab;
      },
      close: async (tab) => {
        try {
          await tab.close();
        } finally {
          this.siteCheckTabs.delete(tab);
        }
      },
      attach: (tab) => CdpSession.attach(tab),
    });
    return this.siteCheckPages;
  }

  private buildBrowserMcpHost(userText = ""): BrowserMcpHost {
    return {
      generalBrowserRequest: isGeneralBrowserOpenRequest(userText),
      // A5 — the site check's page (spec §6.1). Asked only on an orchestrator turn whose roster
      // lists site_check; the live server is never started for it (livePreviewUrl below).
      viewportPage: (wrapperUrl: string) => this.siteCheckViewports().page(wrapperUrl),
      openBrowser: async (url: string) => {
        // #519 — **this navigates; it does not open.**
        //
        // `openBrowserTab` makes a new editor on every call (mainThreadBrowsers draws
        // a fresh UUID each time) — the platform has no URL reuse at all. There used
        // to be a "close then open" layer on top of that, but loopback (the
        // participant's own artifact) was left out of the cleanup, so tabs piled up
        // every time a sub-page was visited. Now one tab is held per slot (artifact /
        // reference) and navigated with CDP: neither tabs nor columns multiply, the
        // page history (browser_back) survives, and the other slot the participant was
        // looking at is left alone.
        // CR-11 — with the switch on, the coach opens only the student's own preview.
        const crOn = this.isCurriculumRuntimeEnabled();
        if (crOn) {
          const v = checkAgentOrigin(url, this.crBrowserOptions().allowedOrigins());
          if (!v.ok) throw new Error(v.reason);
        }
        const tabs = this.coachBrowserTabs();
        const plan = planCoachBrowserTabs(tabs.map((t) => t.url), url);
        // Clean up only the surplus tabs already stacked in the same slot (the legacy pile-up).
        for (const i of plan.close) {
          try {
            await tabs[i]?.close();
          } catch {
            /* a tab we cannot close must not block the navigation */
          }
        }
        this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions());
        if (plan.reuse !== null) {
          // #526 — grab what this tab was showing **before** navigating. Read it after
          // the navigation and it is already the new address, so there is no way to
          // know "what got pushed out".
          const reused = tabs[plan.reuse];
          const replaced = reused?.url ? { url: reused.url, title: reused.title } : undefined;
          // Pin the reused tab, then CDP navigate — riding the very executor the
          // proxy path (#278) uses. Two copies of the same behaviour means only one of
          // them ever gets fixed (the same reason as #457).
          this.mcpBrowser.setTargetTab(reused);
          const r = await this.mcpBrowser.execute({
            id: "mcp-browser_open",
            name: "browser_navigate",
            input: { url },
          });
          if (!r.isError) {
            // #525 — the navigation succeeded, but with that tab in the background the
            // participant's screen is unchanged. This is the flow where the
            // participant said "열어줘", so bring it forward.
            if (reused) await this.revealBrowserTab(reused);
            return { replaced };
          }
          // CR-11 — with the switch on the CR executor's refusal is the answer; opening a
          // new tab here would take a path that ignores its scope.
          if (crOn) throw new Error(r.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").trim() || "미리보기를 열지 못했어요.");
          // A failed navigation (the tab was just closed, say) falls back to opening a
          // new one — to the student it must never become "it did not open".
          this.mcpBrowser.setTargetTab(undefined);
        }
        // Open a new one when the slot is empty. Why the column is named
        // **explicitly**: `Beside` (SIDE_GROUP) looks for the neighbour to the right of
        // the active group and makes a new group when there is none. If the browser
        // tab just opened is the active one (= rightmost), every following call splits
        // off another column and the workspace narrows. preserveFocus prevents that
        // activation in the first place, and the tab handle drives it without focus.
        const opened = await vscode.window.openBrowserTab(url, {
          viewColumn:
            this.editorChat ? vscode.ViewColumn.Two : coachTabSlot(url) === "preview" ? vscode.ViewColumn.One : vscode.ViewColumn.Two,
          preserveFocus: true,
        });
        this.mcpBrowser.setTargetTab(opened);
      },
      screenshot: async () => {
        // #519 — the fallback path also looks at the tab being driven first (the same
        // reason as currentPage above).
        const tab = this.mcpBrowser?.currentTab() ?? vscode.window.activeBrowserTab;
        if (!tab) return null;
        try {
          const ctx = await capturePageContext(tab);
          if (!ctx.imageBase64) {
            // Leave the cause behind. `catch { return null }` swallowed the reason
            // whole, so the 2026-07-26 measurements could not establish why the
            // screenshot was failing.
            console.warn(`[coach] screenshot: empty image for ${tab.url ?? "(no url)"}`);
            return null;
          }
          return {
            imageBase64: ctx.imageBase64,
            mimeType: "image/jpeg",
            url: ctx.url,
            title: ctx.title,
          };
        } catch (e) {
          console.warn(`[coach] screenshot failed for ${tab.url ?? "(no url)"}: ${String(e)}`);
          return null;
        }
      },
      startLivePreview: () => this.startLivePreview(),
      // CR-02/CR-11 — the served switch and the agent scope, read per call.
      crEnabled: () => this.isCurriculumRuntimeEnabled(),
      // cr-verify — the same session the proxy path runs (CR-03).
      verify: async (name: string, input: Record<string, unknown>) => toMcpToolResult(await this.runVerifyTool(name, input)),
      // One-click publish: the same pipeline and lock as the toolbar button.
      publishSite: (input) => this.sitePublisher().runForTool(input),
      crScope: (url: string) => checkAgentOrigin(url, this.crBrowserOptions().allowedOrigins()),
      // #507 — the address of the live server currently up. It does not start one
      // (giving a lookup a side effect would mean "what is the address?" turns the
      // server on). This is the only truth, and anything that does not read it is
      // guessing — that guess was 127.0.0.1:3000.
      livePreviewUrl: async () => this.liveServer.currentUrl() ?? null,
      // #415 — the cheapest path to read the page currently up. BrowserTab already
      // holds url/title as they are, so neither a CDP connection nor a screenshot is
      // needed (taking an image just to learn one URL wastes tokens and time alike).
      //
      // #519 — looking only at `activeBrowserTab` here is wrong. That value is set
      // only when the active editor is a browser, so the moment the participant
      // clicked a code tab it became "no page open" and the duplicate guard silently
      // switched off (the same page opens again and the approval modal appears again).
      // Look at the tab the coach is driving first, and fall back to the active tab
      // only when there is none.
      currentPage: async () => {
        const tab = this.mcpBrowser?.currentTab() ?? vscode.window.activeBrowserTab;
        if (!tab?.url) return null;
        return { url: tab.url, title: tab.title };
      },
      // #519 — for the duplicate check. There are two slots, so "the page currently
      // on screen" alone misses the other slot that is already up and raises an
      // unnecessary approval modal.
      openPages: async () =>
        this.coachBrowserTabs()
          .filter((t) => !!t.url)
          .map((t) => ({ url: t.url, title: t.title })),
      // #523 — pins the tab judged "already open" as the drive target. openPages
      // passes URLs only (a tab handle never crosses this boundary), so it is looked
      // up again here — it has to be found with the **same comparison function** as
      // the judgment, or the judged tab and the pinned tab diverge.
      //
      // #525 — pinning alone is invisible to the participant. With that tab in the
      // background the screen is unchanged. It brings it forward as well
      // (revealBrowserTab — a failure is silently ignored).
      focusOpenPage: async (url: string) => {
        const tab = this.coachBrowserTabs().find(
          (t) => !!t.url && isSameBrowserUrl(t.url, url),
        );
        if (!tab?.url) return null;
        this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions());
        this.mcpBrowser.setTargetTab(tab);
        await this.revealBrowserTab(tab);
        return { url: tab.url, title: tab.title };
      },
      // #457 — delegates the 3 inspection tools (read/click/type) straight to the CDP
      // executor. It reuses the BrowserControl the proxy path (#278) was using —
      // implementing the same behaviour twice produces the bug where only one of the
      // two gets fixed. The instance is made lazily here and the panel cleanup path
      // owns its dispose.
      fetchHead: async (url: string) => {
        try {
          const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
          return { ok: res.ok, status: res.status };
        } catch {
          return { ok: false, status: 0 };
        }
      },
      inspect: async (name, input) => {
        try {
          this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions());
          const r = await this.mcpBrowser.execute({ id: `mcp-${name}`, name, input });
          // CR-10 — a CR result is recorded against its artifact version when the SDK
          // reports this call's tool_result (onActivity takes it from this queue).
          this.crSdkResults.onInspect(name, input, r.observation);
          // BrowserToolResult(content: text | image_url) → McpToolResult(text | image), the
          // same conversion the CR-03 adapter parity check runs.
          return toMcpToolResult(r);
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: `브라우저 조작 실패: ${String(e)}` }],
            isError: true,
          };
        }
      },
    };
  }

  /**
   * REQ-M46 (studio-sdk-seed-on-demand) — offer to fetch the public native SDK
   * seed when no binary resolves. Default off: `hypeproofChat.sdkSeedOnDemand`
   * or a profile that advertises `sdk_seed: { fetch: true }`. Nothing is
   * downloaded without the user's confirmation, and a seed is installed only
   * when its sha256 matches the release and its sha512 the value pinned in this
   * App (sdkSeedHelpers). Never throws: the turn goes on either way.
   */
  private async maybeOfferSdkSeed(profile: unknown, settingPath: string | undefined, signal: AbortSignal): Promise<void> {
    try {
      const cfg = vscode.workspace.getConfiguration("hypeproofChat");
      const enabled = sdkSeedOnDemandEnabled({ setting: cfg.get<boolean>("sdkSeedOnDemand", false), profile });
      if (!enabled) return;
      if (this.sdkSeedInFlight) {
        await this.sdkSeedInFlight;
        return;
      }
      const platformKey = sdkSeedPlatformKey(process.platform, process.arch);
      const appVersion = String((this.context.extension.packageJSON as { version?: unknown }).version ?? "");
      const urls = platformKey ? sdkSeedUrls({ appVersion, platformKey }) : null;
      const decision = sdkSeedOfferDecision({
        enabled,
        resolution: resolveSdkBinaryForHost({ settingPath }),
        platformKey,
        urls,
        declined: this.sdkSeedDeclined,
        inFlight: false,
      });
      if (decision !== "offer" || !platformKey) {
        if (decision === "unsupported-platform" || decision === "no-release") console.warn(`[coach] SDK seed not offered: ${decision}`);
        return;
      }
      const megabytes = Math.round((SDK_BINARY_MANIFEST[platformKey]?.unpackedSize ?? 0) / (1024 * 1024));
      const download = "내려받기";
      const choice = await vscode.window.showInformationMessage(
        "AI 실행 도구를 내려받을까요?",
        {
          modal: true,
          detail:
            `이 컴퓨터에는 AI 코치가 쓰는 실행 도구가 아직 없습니다. HypeProof Studio 공개 릴리스에서 내려받아 ` +
            `파일이 맞는지 확인한 뒤 설치합니다. 디스크 공간이 약 ${megabytes} MB 필요합니다.`,
        },
        download,
      );
      if (choice !== download) {
        this.sdkSeedDeclined = true;
        return;
      }
      const destBinary = seededSdkBinaryPath({ platform: process.platform, homeDir: os.homedir(), env: process.env });
      const run = (async () => {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "AI 실행 도구를 내려받는 중…" },
          (progress) => {
            let reported = 0;
            return fetchSdkSeed({
              appVersion,
              platformKey,
              destBinary,
              signal,
              onProgress: (received, total) => {
                const pct = Math.floor((received / total) * 100);
                if (pct > reported) {
                  progress.report({ increment: pct - reported, message: `${pct}%` });
                  reported = pct;
                }
              },
            });
          },
        );
        if (result.ok) {
          console.info(`[coach] SDK seed installed at ${result.path} (${result.size} bytes)`);
          return;
        }
        console.warn(`[coach] SDK seed ${result.stage} failed: ${result.reason}`);
        if (signal.aborted) return;
        void vscode.window.showWarningMessage(
          result.stage === "verify"
            ? "내려받은 파일이 확인값과 달라 설치하지 않았습니다. 다음 메시지를 보낼 때 다시 시도할 수 있습니다."
            : "AI 실행 도구를 내려받지 못했습니다. 인터넷 연결을 확인하고 다음 메시지를 보낼 때 다시 시도해 주세요.",
        );
      })();
      this.sdkSeedInFlight = run;
      try {
        await run;
      } finally {
        this.sdkSeedInFlight = null;
      }
    } catch (err) {
      console.warn("[coach] SDK seed offer failed:", err);
    }
  }

  /**
   * #457 — the work folder the coach stands in. The opened folder, then the profile's
   * workspace_root. With neither it returns undefined, but it **does not pass over
   * silently**: that state means the coach cannot find files, and with no log the
   * cause cannot be established after the fact.
   */
  // AE-15 / CGP-ART-R-002 / CGP-AGENT-R-026 (#673) — per-turn restore points of the work folder (turnRestore.ts).
  // The copies live in the extension's storage, per work folder and task, so the coach's tools never see them and every
  // seat (minors too) gets them. One review bar at a time: the next turn replaces it.
  private turnReview: { view: TurnReviewView; store: string; root: string; point: RestoreManifest; taskKey: string; measuredDigest?: string } | null = null;
  private turnRestoreBusy = false;
  private artifactHistoryEnabled(): boolean {
    return !!this.cachedProfile && this._instructorMode?.isInstructor === false
      && !this.connectionChanging && !this.taskChanging
      && vscode.workspace.getConfiguration("hypeproofChat").get<boolean>("artifactHistoryEnabled", false);
  }
  /** Capture an observed editor save without guessing whether a learner, formatter or tool authored it. */
  async recordArtifactSave(abs: string): Promise<void> {
    const cwd = this.resolveCoachCwd();
    if (!cwd || !this.artifactHistoryEnabled()) return;
    const generation = this.profileGeneration, task = this.turnRestoreTaskKey();
    const current = () => this.artifactHistoryEnabled() && this.resolveCoachCwd() === cwd && this.profileGeneration === generation && this.turnRestoreTaskKey() === task;
    try {
      const root = await fs.promises.realpath(cwd), rel = path.relative(root, abs).split(path.sep).join("/");
      await captureArtifactVersion(artifactHistoryStore(this.context.globalStorageUri.fsPath, root, rel), root, rel, "unknown", undefined, current);
    } catch { /* A history failure never interrupts the editor save. */ }
  }

  /** DES-KNOW-30: the existing command opens a side panel for every known learner seat. */
  async openArtifactHistoryPanel(abs: string): Promise<void> {
    const cwd = this.resolveCoachCwd(), task = this.turnRestoreTaskKey(), generation = this.profileGeneration;
    const idle = () => !this.hasActiveStream() && this.pendingSends === 0 && !this.taskChanging && !this.connectionChanging && !this.clearingHistory && !this.verifySession?.running;
    const current = () => this.artifactHistoryEnabled() && idle() && this.profileGeneration === generation && this.resolveCoachCwd() === cwd && this.turnRestoreTaskKey() === task;
    if (!cwd || !current() || this.turnRestoreBusy) {
      void vscode.window.showInformationMessage(this.artifactHistoryEnabled() ? "진행 중인 작업이 끝난 뒤에 이전 버전을 볼 수 있어요." : "이전 버전 보관은 설정에서 켠 활동에서 사용할 수 있어요.");
      return;
    }
    try {
      const root = await fs.promises.realpath(cwd), rel = path.relative(root, abs).split(path.sep).join('/');
      if (!current()) return;
      const panel = new ArtifactHistoryPanel({
        root, rel, store: artifactHistoryStore(this.context.globalStorageUri.fsPath, root, rel), current,
        writeAllowed: () => !this.folderWriteRefusalFor(abs) && !vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && d.uri.fsPath === abs && d.isDirty),
        canStart: () => !this.turnRestoreBusy,
        busy: value => { this.turnRestoreBusy = value; },
        restored: async () => { await this.provenanceRecorder()?.unobserved(root); },
        attest: async () => { if (current()) await this.showArtifactHistory(abs); },
      });
      await panel.open();
    } catch { void vscode.window.showInformationMessage('이전 버전을 열지 못했어요.'); }
  }

  /** REQ-KNOW-30: native history works for every learner seat, including class seats without TaskWorkspace. */
  async showArtifactHistory(abs: string): Promise<void> {
    const cwd = this.resolveCoachCwd();
    if (!cwd || !this.artifactHistoryEnabled() || this.turnRestoreBusy) {
      void vscode.window.showInformationMessage("이전 버전 보관은 설정에서 켠 활동에서 사용할 수 있어요."); return;
    }
    const idle = () => !this.hasActiveStream() && this.pendingSends === 0 && !this.taskChanging && !this.connectionChanging && !this.clearingHistory && !this.verifySession?.running;
    if (!idle()) { void vscode.window.showInformationMessage("진행 중인 작업이 끝난 뒤에 이전 버전을 볼 수 있어요."); return; }
    const task = this.turnRestoreTaskKey(), generation = this.profileGeneration;
    this.turnRestoreBusy = true;
    try {
      const root = await fs.promises.realpath(cwd), rel = path.relative(root, abs).split(path.sep).join("/");
      const store = artifactHistoryStore(this.context.globalStorageUri.fsPath, root, rel);
      const current = await captureArtifactVersion(store, root, rel, "unknown", undefined, () => this.artifactHistoryEnabled() && idle() && this.profileGeneration === generation && this.resolveCoachCwd() === cwd && this.turnRestoreTaskKey() === task);
      if (!current) { void vscode.window.showInformationMessage("이 파일은 이전 버전을 보관할 수 없어요."); return; }
      const expected = current.files[0].sha256;
      const points = await listRestorePoints(store);
      const selected = await vscode.window.showQuickPick(points.map(p => ({ label: `${p.turnId === "artifact-ai" ? "AI" : p.turnId === "artifact-learner" ? "나" : "기록 없음"} · ${new Date(p.createdAt).toLocaleString("ko-KR")}`, description: p.id === current.id ? "현재 버전" : "보관된 버전", detail: p.turnId === "artifact-learner" ? "내가 확인한 수정·업로드·복원 기록" : p.turnId === "artifact-ai" ? "AI 작업에서 기록한 버전" : "작성자를 확인하지 않은 버전 · 현재 버전은 내 수정을 확인해 기록할 수 있어요", point: p })), { title: `${path.basename(abs).replace(/[\u0000-\u001f\u007f\u2028-\u202e\u2066-\u2069]/g, "�").slice(0, 120)} · 이전 버전`, placeHolder: "복원할 버전을 골라 주세요. 현재 내용도 보관해요." });
      if (!selected) return;
      const stillCurrent = () => this.artifactHistoryEnabled() && idle() && this.profileGeneration === generation && this.resolveCoachCwd() === cwd && this.turnRestoreTaskKey() === task && !vscode.workspace.textDocuments.some(d => d.uri.scheme === "file" && d.uri.fsPath === abs && d.isDirty);
      if (selected.point.id === current.id) {
        if (current.turnId !== "artifact-unknown") return;
        const answer = await vscode.window.showWarningMessage("이 내용을 직접 수정했나요?", { modal: true, detail: "직접 고친 내용이 맞으면 이 버전을 ‘나’로 기록해요. 파일 내용은 바뀌지 않아요." }, "내 수정으로 기록");
        if (answer !== "내 수정으로 기록") return;
        if (!stillCurrent()) { void vscode.window.showInformationMessage("파일이 바뀌었어요"); return; }
        const recorded = await captureArtifactVersion(store, root, rel, "learner", expected, stillCurrent);
        void vscode.window.showInformationMessage(recorded?.turnId === "artifact-learner" ? "내가 확인한 수정으로 기록했어요." : "파일이 바뀌었어요");
        return;
      }
      const answer = await vscode.window.showWarningMessage(`${new Date(selected.point.createdAt).toLocaleString("ko-KR")} 버전으로 복원할까요?`, { modal: true, detail: "현재 파일을 먼저 보관한 뒤 이 파일만 바꿔요." }, "복원하기");
      if (answer !== "복원하기") return;
      if (!stillCurrent() || this.folderWriteRefusalFor(abs)) { void vscode.window.showInformationMessage("파일이 바뀌었어요"); return; }
      const result = await restoreArtifactVersion({ store, root, rel, id: selected.point.id, expected, stillCurrent });
      if (result.ok) { await this.provenanceRecorder()?.unobserved(root); }
      void vscode.window.showInformationMessage(result.ok ? "이전 버전을 복원했어요. 복원 전 내용도 보관했어요." : result.reason === "changed" ? "파일이 바뀌었어요" : "파일을 복원하지 못했어요. 이전 버전을 다시 확인해 주세요.");
    } catch { void vscode.window.showInformationMessage("이전 버전을 읽지 못했어요."); }
    finally { this.turnRestoreBusy = false; }
  }

  // REQ-STUDIO-ARTIFACT-PROVENANCE — per-file provenance ledger beside the restore stores (artifactProvenance.ts).
  private provenance: ArtifactProvenanceRecorder | null = null;
  private provenanceRecorder(): ArtifactProvenanceRecorder | null {
    const base = this.context?.globalStorageUri?.fsPath;
    if (!base) return null;
    if (!this.provenance) {
      const recorder = new ArtifactProvenanceRecorder(base, Date.now, () => this.artifactHistoryEnabled());
      this.provenance = recorder;
      // The one host-write hook (noteHostWrite) lands in this recorder, for the folder the coach stands in.
      setHostWriteSink({
        wrote: (writes, actor) => { const cwd = this.resolveCoachCwd(); if (cwd) void recorder.hostWrote(cwd, writes, actor); },
        replaced: (folder) => { void recorder.folderReplaced(folder); },
      });
    }
    return this.provenance;
  }

  /** REQ-STUDIO-ARTIFACT-PROVENANCE — this send's pasted (#421) and attached (D-028) photos, committed by the host, are the learner's uploads. */
  private recordLearnerUploads(pastedRelPaths: readonly string[], attachedNote: string): void {
    const root = this.resolveCoachCwd();
    const rels = [...pastedRelPaths, ...imagePathsFromNotes(attachedNote)];
    if (root && rels.length) noteHostWrite(rels.map((rel) => ({ absPath: path.join(root, ...rel.split("/")) })), "learner_upload");
  }

  /** REQ-STUDIO-ARTIFACT-PROVENANCE — the work folder's provenance list; `observe` rescans when no turn runs. Never throws. */
  private async postArtifactProvenance(observe: boolean): Promise<void> {
    const recorder = this.provenanceRecorder();
    const cwd = this.currentTaskStore() && this._instructorMode?.isInstructor !== true ? this.resolveCoachCwd() : undefined;
    let view: import("./artifactProvenanceView").ArtifactProvenanceView | null = null;
    try {
      if (recorder && cwd) {
        const root = await fs.promises.realpath(cwd);
        const idle = () => !this.hasActiveStream() && this.pendingSends === 0 && !this.turnRestoreBusy && !this.taskChanging && !this.verifySession?.running;
        let scan: Awaited<ReturnType<typeof scanFolder>> | undefined;
        // Only files whose size, mtime or inode changed since the last list are read again.
        // Anything recorded while the scan runs (a host write, a pull, a whole turn) moves the
        // generation; the recorder then does not apply this scan's possibly older bytes.
        const generation = recorder.generation();
        if (observe && idle()) scan = await scanFolder(root, { cache: recorder.scanCache(root) });
        // An incomplete scan (past the entry cap) is passed on: the recorder marks the window unmeasured.
        view = await recorder.view(root, scan && idle() ? scan : undefined, generation);
      }
    } catch { view = null; }
    await this.post({ type: "artifactProvenance", view });
  }
  // CGP-KNOW-D-013 (DES-KNOW-24) — the activity trash at the bottom of 내 작품. The store, its gates
  // and native confirms live in activityTrashCommands.ts; this only routes the panel's requests.
  private activityTrashPanel?: import("./activityTrashCommands").ActivityTrashPanelApi;
  setActivityTrashPanel(api: import("./activityTrashCommands").ActivityTrashPanelApi): void { this.activityTrashPanel = api; }
  /** The 내 작품 panel exists only on a task workspace (personal, trial); activityTrashBinding admits learners only. */
  private activityTrashSeat(): boolean { return !!this.currentTaskStore(); }
  private async postActivityTrash(extra?: { requestId: string; result: import("./activityTrashView").ActivityTrashResult }): Promise<void> {
    const view = this.activityTrashPanel && this.activityTrashSeat() ? await this.activityTrashPanel.view() : null;
    await this.post({ type: "activityTrashState", view, ...extra });
  }
  private async runActivityTrashAction(msg: Extract<WebviewMessage, { type: "activityTrashAction" }>): Promise<void> {
    const requestId = typeof msg.requestId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(msg.requestId) ? msg.requestId : null;
    if (!requestId) return;
    const action = msg.action === "move" || msg.action === "restore" || msg.action === "purge" ? msg.action : null;
    const panel = this.activityTrashPanel;
    let result: import("./activityTrashView").ActivityTrashResult;
    if (!action || !panel || !this.activityTrashSeat() || typeof msg.target !== "string" || typeof msg.scope !== "string") {
      result = { action: action ?? "move", error: "작업 상태가 바뀌었어요. 목록을 다시 확인한 뒤 시도해 주세요." };
    } else if (this.hasActiveStream() || this.turnRestoreBusy || this.taskChanging || this.verifySession?.running) {
      // A turn may be writing the same files; the learner retries once it ends.
      result = { action, error: "AI가 일하는 동안에는 파일을 옮길 수 없어요. 끝난 뒤 다시 시도해 주세요." };
    } else {
      // Reserves the folder like a turn restore: a send during the native confirm is refused, not raced.
      this.turnRestoreBusy = true;
      try { result = await panel.act(action, msg.target, msg.scope); }
      finally { this.turnRestoreBusy = false; }
    }
    await this.postActivityTrash({ requestId, result });
    if (!result.error && !result.cancelled) await this.postArtifactProvenance(true);
  }
  // REQ-STUDIO-PAGE-CARD (CGP-ART-R-010) — the page cards this session issued, per task. In memory only: a reload of the
  // window starts with none, and the transcript stores nothing new for them.
  private pageCardRegistry: PageCardRegistry | undefined;
  private get pageCards(): PageCardRegistry { return (this.pageCardRegistry ??= new PageCardRegistry()); }

  private turnRestoreTaskKey(): string {
    return this.currentTaskStore()?.getView().activeTaskId ?? "default";
  }

  private postTurnReview(): void {
    const review = this.turnReview;
    // A bar belongs to the task it was taken in; another open task sees none.
    void this.post({ type: "turnReviewState", view: review && review.taskKey === this.turnRestoreTaskKey() ? review.view : null });
  }

  private postPageCards(): void {
    void this.post({ type: "pageCardsState", cards: this.pageCards.forTask(this.turnRestoreTaskKey()) });
  }

  /** REQ-STUDIO-PAGE-CARD — 열기 opens the page in the Studio preview; 폴더에서 보기 shows it in the OS file manager. */
  private async handlePageCardMessage(msg: PageCardMessage): Promise<void> {
    const out = await handlePageCardAction(this.pageCards, this.turnRestoreTaskKey(), msg, {
      // The bytes come from the checked inode (pageCardHost readPageInFolder), never a second read by name.
      open: async (abs, html, reload) => {
        await this.preview.show(html, vscode.Uri.file(path.dirname(abs)));
        this.preview.watchForReload(vscode.Uri.file(abs), async () => reload());
      },
      reveal: async (abs) => { await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(abs)); },
    });
    // A refusal is a notice on the card; clearing an earlier notice needs a redraw too.
    if (out.ok === false && out.notice === undefined) return;
    this.postPageCards();
  }

  /** Before a coach turn: record the work folder. Never throws; a failure is one visible line and the turn runs without a revert. */
  private async beginTurnRestore(streamId: string): Promise<{ store: string; root: string; point: RestoreManifest; taskKey: string } | null> {
    if (this.turnReview) { this.turnReview = null; this.postTurnReview(); }
    if (this._instructorMode?.isInstructor === true) {
      // The instructor surface draws no bar and records no turn; what its coach changes must not
      // read as confirmed if the seat leaves instructor mode in this session (REQ-STUDIO-ARTIFACT-PROVENANCE).
      const cwd = this.resolveCoachCwd();
      if (cwd) await fs.promises.realpath(cwd).then((root) => this.provenanceRecorder()?.unobserved(root)).catch(() => undefined);
      return null;
    }
    let root: string;
    try {
      const cwd = this.resolveCoachCwd();
      if (!cwd) return null;
      root = await fs.promises.realpath(cwd);
      if (!(await fs.promises.stat(root)).isDirectory()) return null;
    } catch { return null; }
    const base = this.context?.globalStorageUri?.fsPath;
    if (!base) return null;
    let taskKey: string;
    let store: string;
    try {
      taskKey = this.turnRestoreTaskKey();
      store = turnRestoreStoreDir(base, root, taskKey);
    } catch { return null; }
    try {
      const { point } = await takeRestorePoint({ store, root, id: streamId, turnId: streamId, kind: "turn" });
      if (!point.complete) {
        await dropRestorePoint(store, point.id);
        await this.provenanceRecorder()?.unobserved(root);
        this.postToolLog(streamId, { id: `turn-restore-${streamId}`, icon: "⚠️", label: "작업 폴더에 파일이 너무 많아서 이번 요청은 되돌리기를 쓸 수 없어요.", state: "error" });
        return null;
      }
      await this.provenanceRecorder()?.turnStart(root, point);
      return { store, root, point, taskKey };
    } catch {
      await this.provenanceRecorder()?.unobserved(root);
      this.postToolLog(streamId, { id: `turn-restore-${streamId}`, icon: "⚠️", label: "이번 요청 전 상태를 보관하지 못해서 이번에는 되돌리기를 쓸 수 없어요.", state: "error" });
      return null;
    }
  }

  /** After a coach turn: compare the folder with the turn's restore point and offer the review bar when anything changed. Never throws. */
  private async endTurnRestore(handle: { store: string; root: string; point: RestoreManifest; taskKey: string } | null, streamId: string, messageId: string): Promise<void> {
    if (!handle) return;
    try {
      const now = await scanFolder(handle.root);
      if (!now.complete) {
        await this.provenanceRecorder()?.unobserved(handle.root);
        this.postToolLog(streamId, { id: `turn-restore-end-${streamId}`, icon: "⚠️", label: "작업 폴더에 파일이 너무 많아져서 이번 요청은 되돌릴 수 없어요.", state: "error" });
        return;
      }
      const changes = diffRestorePoint(handle.point, now);
      await this.provenanceRecorder()?.turnEnd(handle.root, handle.point, changes, now);
      void this.postArtifactProvenance(false);
      if (changeCount(changes) === 0) { await dropRestorePoint(handle.store, handle.point.id); return; }
      // REQ-STUDIO-PAGE-CARD — the same diff (a stopped turn included) names the pages; the card sits under the
      // turn's last transcript row. `pending-` lines are hidden once done, so they cannot carry it. A card that
      // cannot be built never costs the review bar below.
      try {
        const timeline = this.turnTimelines?.get(streamId);
        const items = timeline ? timelineEnd(timeline, Date.now()).items : [];
        const anchorId = [...items].reverse().find((m) => !m.id.startsWith("pending-"))?.id ?? messageId;
        const card = buildPageCard({ root: handle.root, turnId: handle.point.turnId, anchorId, changes });
        if (card) { this.pageCards.add(handle.taskKey, handle.root, card); this.postPageCards(); }
      } catch { /* no card */ }
      this.turnReview = {
        ...handle, measuredDigest: now.digest,
        view: { files: await reviewTurnFiles(handle.store, handle.root, handle.point, now), turnId: handle.point.turnId, state: "open", added: changes.added, changed: changes.changed, deleted: changes.deleted, notCovered: changes.notCovered.map((n) => n.path) },
      };
      this.postTurnReview();
    } catch {
      // The folder could not be read after the turn: no bar; the point stays until pruned.
      await this.provenanceRecorder()?.unobserved(handle.root);
    }
  }

  /**
   * AE-15 — a revert is rewriting the work folder: a send waits for it, its text going back to the composer.
   * Callers test `turnRestoreBusy` synchronously first, so an ordinary send reaches handleSend with no extra tick.
   */
  private async refuseSendWhileRestoring(text: string, images: string[] | undefined, requestedMode: TurnToolMode | undefined): Promise<void> {
    await this.post({ type: "inputRejected", text, images, toolMode: turnToolMode(requestedMode) });
    await this.post({ type: "streamError", streamId: "activity", error: "파일을 되돌리는 중이에요. 끝난 뒤에 보내 주세요." });
  }

  private async handleTurnReviewMessage(msg: { type: "turnRevert" | "turnKeep" | "turnReviewClose"; turnId: string; path?: string }): Promise<void> {
    const review = this.turnReview;
    if (!review || review.view.turnId !== msg.turnId || review.taskKey !== this.turnRestoreTaskKey()) return;
    if (msg.type === "turnReviewClose") {
      if (review.view.state === "restored" || review.view.state === "failed") { this.turnReview = null; this.postTurnReview(); }
      return;
    }
    if (review.view.state !== "open") return;
    const counts = { added: review.view.added.length, changed: review.view.changed.length, deleted: review.view.deleted.length, not_covered: review.view.notCovered.length };
    if (msg.type === "turnKeep") {
      // Accept the decision before awaiting evidence; a second click cannot undo it.
      this.turnReview = null;
      this.postTurnReview();
      let afterDigest: string | undefined;
      try { afterDigest = (await scanFolder(review.root)).digest; } catch { /* recorded without it */ }
      // REQ-Q1 — local evidence: digests and counts only, never paths or contents.
      this.spool?.recordWorkflow({ turnId: review.point.turnId, event: "turn_review_keep", payload: { restore_point: review.point.id, before_digest: review.point.digest, ...(afterDigest ? { after_digest: afterDigest } : {}), ...counts } });
      return;
    }
    if (this.hasActiveStream() || this.pendingSends > 0 || this.turnRestoreBusy || this.taskChanging || this.verifySession?.running) {
      review.view = { ...review.view, notice: "진행 중인 작업이 끝난 뒤에 되돌릴 수 있어요." };
      this.postTurnReview();
      return;
    }
    const paths = [...review.view.added, ...review.view.changed, ...review.view.deleted];
    if (msg.path !== undefined && (typeof msg.path !== "string" || !paths.includes(msg.path))) return;
    const selected = msg.path === undefined ? paths : [msg.path];
    if (!selected.length) return;
    const generation = this.profileGeneration;
    const current = () => {
      if (this.turnReview !== review || generation !== this.profileGeneration || review.taskKey !== this.turnRestoreTaskKey() || this.connectionChanging || this.hasActiveStream() || this.taskChanging || this.verifySession?.running || this._instructorMode?.isInstructor) return false;
      try { if (fs.realpathSync(this.resolveCoachCwd() ?? "") !== review.root) return false; } catch { return false; }
      return !vscode.workspace.textDocuments.some(d => d.uri.scheme === "file" && d.isDirty && selected.some(p => { try { return fs.realpathSync(d.uri.fsPath) === fs.realpathSync(path.join(review.root, p)); } catch { return path.resolve(d.uri.fsPath) === path.join(review.root, p); } }));
    };
    this.turnRestoreBusy = true;
    review.view = { ...review.view, state: "restoring", notice: undefined };
    this.postTurnReview();
    try {
      const now = await scanFolder(review.root);
      if (!now.complete || !current() || (review.measuredDigest && review.measuredDigest !== now.digest)) {
        review.view = { ...review.view, state: "open", notice: "파일이나 작업이 바뀌었어요. 변경 내용을 다시 확인한 뒤 되돌려 주세요." };
        if (current() && now.complete) {
          const changes = diffRestorePoint(review.point, now);
          review.measuredDigest = now.digest;
          review.view = { ...review.view, ...changes, notCovered: changes.notCovered.map(n => n.path), files: await reviewTurnFiles(review.store, review.root, review.point, now) };
        }
        return;
      }
      const answer = await vscode.window.showWarningMessage(
        `파일 ${selected.length}개를 이번 요청 전으로 되돌릴까요?`,
        { modal: true, detail: "지금 상태를 먼저 보관해요. 웹 게시와 작업 폴더 밖의 변경은 되돌리지 않아요." }, "되돌리기");
      if (answer !== "되돌리기" || !current()) {
        review.view = { ...review.view, state: "open", notice: "되돌리지 않았어요." };
        return;
      }
      const out = await restoreToPoint({ store: review.store, root: review.root, point: review.point, paths: selected, sweepDirs: msg.path === undefined, expectedDigest: now.digest, stillCurrent: current, beforeRestoreId: `${review.point.id}-before-restore-${Date.now()}` });
      if (out.touched) {
        const after = await scanFolder(review.root).catch(() => null);
        await this.provenanceRecorder()?.reverted(review.root, review.point, after?.complete ? after : null, [...out.restored, ...out.removed]);
      }
      review.view = {
        ...review.view,
        state: out.ok ? "restored" : "failed",
        restoredCount: out.restored.length + out.removed.length,
        failed: out.failed.map((f) => f.path),
        beforeRestoreKept: !!out.beforeRestore,
        nothingChanged: !out.touched,
        tooLarge: out.error === "folder_too_large",
        notCovered: out.notCovered.map((n) => n.path),
      };
      if (out.ok && msg.path !== undefined) {
        const after = await scanFolder(review.root);
        const changes = diffRestorePoint(review.point, after);
        if (changeCount(changes)) {
          review.measuredDigest = after.digest;
          review.view = { ...review.view, state: "open", ...changes, notCovered: changes.notCovered.map(n => n.path), files: await reviewTurnFiles(review.store, review.root, review.point, after), notice: "파일 1개를 되돌렸어요. 나머지는 그대로 두었어요." };
        }
      }
      this.spool?.recordWorkflow({
        turnId: review.point.turnId,
        event: "turn_review_revert",
        payload: {
          restore_point: review.point.id, target_digest: review.point.digest,
          ...(out.beforeRestore ? { before_restore_point: out.beforeRestore.id, before_digest: out.beforeRestore.digest } : {}),
          ...(out.afterDigest ? { after_digest: out.afterDigest } : {}),
          ok: out.ok, restored: out.restored.length, removed: out.removed.length, failed: out.failed.length,
          ...counts, ...(out.error ? { error: out.error.split(":")[0] } : {}),
        },
      });
    } catch {
      // Nothing is claimed: an unexpected failure reads as a partial failure with no list.
      // Unknown whether anything was written, so neither "nothing changed" nor "kept" is claimed.
      review.view = { ...review.view, state: "failed", failed: [], beforeRestoreKept: false, nothingChanged: false, tooLarge: false };
      this.spool?.recordWorkflow({ turnId: review.point.turnId, event: "turn_review_revert", payload: { restore_point: review.point.id, target_digest: review.point.digest, ok: false, error: "unexpected", ...counts } });
    } finally {
      this.turnRestoreBusy = false;
      this.postTurnReview();
    }
  }

  private resolveCoachCwd(): string | undefined {
    const opened = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (opened) return opened;

    const root = this.cachedProfile?.workspace_root;
    const resolved = root ? resolveWorkspaceRoot(root) : null;
    if (resolved) {
      console.warn(
        `[coach] no folder open — falling back to profile workspace_root: ${resolved}`,
      );
      return resolved;
    }
    console.error(
      "[coach] cwd is UNKNOWN (no folder open, no usable profile workspace_root). " +
        "The coach will not receive a working directory and file tools will fail.",
    );
    return undefined;
  }

  async editImage(): Promise<void> {
    if (this.hasActiveStream()) {
      void vscode.window.showWarningMessage("진행 중인 작업을 마친 뒤 이미지를 편집해 주세요.");
      return;
    }
    this.pendingSends++;
    let releaseActivity: (() => void) | undefined;
    try {
      const connections = activityConnections(this.context);
      if (connections) {
        releaseActivity = connections.acquire();
        const token = await connections.token();
        if (!token || !connections.current) throw new Error("활동 연결을 먼저 확인해 주세요.");
        await verifyActivity({ token, proxyUrl: connections.current.service }, connections.current.serverId);
      }
      const profile = await this.refreshProfileAndConfig();
      const token = await this.context.secrets.get(TOKEN_KEY);
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!profile || !token || !cwd) {
        void vscode.window.showWarningMessage("활동에 연결하고 작업 폴더를 연 뒤 이미지를 편집해 주세요.");
        return;
      }
      // REQ-STUDIO-FOLDER-CONSENT — image editing calls the model and saves its result into the folder.
      const folderRefusal = (await this.folderAiRefusal()) ?? this.folderWriteRefusalFor(cwd);
      if (folderRefusal) { void vscode.window.showWarningMessage(folderRefusal); return; }
      await runImageEdit(this.context, { profile, token, cwd, proxyUrl: this.proxyUrl(),
        onSelected: async (relativePath) => {
          await this.postAppReply(`선택한 이미지: ${relativePath}. 다음 요청에 ‘선택한 이미지’라고 적으면 이 파일을 참고합니다. 원본은 그대로 보존됩니다.`);
        },
      });
    } catch {
      void vscode.window.showWarningMessage("활동 연결을 확인하지 못해 이미지 편집을 시작하지 않았어요. 원본은 보존됩니다.");
    } finally {
      try { releaseActivity?.(); } finally { this.pendingSends--; }
    }
  }

  /** Persist coach info chosen via the in-panel naming card. */
  private async saveCoachFromWebview(name: string, personality: string): Promise<void> {
    const profile = await this.ensureProfile();
    const fallback = profile?.ux.coach.fallback_name ?? "코치";
    const sanitized = sanitizeCoachInput(name, personality, fallback);
    const next: CoachInfo = { ...sanitized, configured: true };
    await this.context.globalState.update(this.coachKey(), next);
    await this.context.globalState.update(this.coachRitualDoneKey(), true);
    await this.postConfig();
  }

  private async handleMessage(msg: WebviewMessage, source?: vscode.Webview): Promise<void> {
    if ((msg.type === 'sendMessage' || msg.type === 'retryMessage') && this.attemptWrite) await this.attemptWrite;
    // REQ-STUDIO-QUIT-GUARD: handled before the activity/task checks, which would answer a
    // task-less report with a task error. It only records the flag for this surface.
    if (msg.type === 'queueState') {
      if (source) { if (msg.queued === true) this.queuedSources.add(source); else this.queuedSources.delete(source); }
      return;
    }
    const connections=activityConnections(this.context);
    if (connections && msg.activityId && msg.activityId!==connections.scope) return;
    const taskStore = this.currentTaskStore?.();
    if (taskStore && msg.type !== 'ready') {
      const task = taskStore.getView();
      if (task.error || !msg.taskId || msg.taskId !== task.activeTaskId) {
        await this.post({ type: 'taskWorkspaceError', error: task.error?.message ?? '작업이 바뀌었습니다. 현재 작업에서 다시 시도해 주세요.' });
        return;
      }
    }
    if (['taskCreate', 'taskRecoverDraft', 'taskSelect', 'taskRename', 'taskSourceSelection', 'taskOpenSource', 'taskReturnFromSource'].includes(msg.type)) {
      await this.handleTaskMessage(msg, source); return;
    }
    if (msg.type==='saveActivityDraft') {
      if (!connections?.scope || msg.activityId!==connections.scope || !validActivityDraft(msg.draft)) return;
      const flush = this.draftFlush;
      if (msg.nonce && flush?.nonce === msg.nonce && flush.source === source && msg.imagePreparationFailed) {
        flush.reject(new Error('이미지를 준비하지 못해 작업을 바꾸지 않았어요. 현재 입력은 그대로입니다. 이미지를 다시 붙이거나 작업 이동을 다시 선택해 주세요.'));
        return;
      }
      if (msg.nonce && flush?.nonce === msg.nonce && flush.source === source && flush.capture) {
        flush.capture(msg.draft);
        flush.resolve();
        return;
      }
      if (source && !msg.nonce) this.draftSource=source;
      const key='hps.activity.draft.'+msg.activityId;
      const save=this.draftWrites.then(async () => {
        if (taskStore && msg.taskId) await taskStore.saveDraft(msg.taskId, msg.draft);
        else await this.context.workspaceState.update(key,msg.draft);
      });
      this.draftWrites=save.catch(()=>{});
      try {
        await save;
        if (taskStore) await this.post({ type: 'taskWorkspaceError', error: this.interruptedHistoryError(), historySaveFailed: !!this.interruptedHistoryError() });
        if (msg.nonce && this.draftFlush?.nonce===msg.nonce && this.draftFlush.source===source) this.draftFlush.resolve();
      } catch (failure) {
        const conflict = failure instanceof TaskWorkspaceStoreError && failure.code === 'stale';
        const error=new Error(taskStore
          ? conflict
            ? '다른 창의 변경과 충돌해 입력을 저장하지 못했습니다. 이 입력은 현재 화면에만 있습니다. 현재 대화와 입력을 새 작업에 보관해 이어갈 수 있습니다.'
            : '입력을 저장하지 못했습니다. 이 입력은 현재 화면에만 있습니다. 저장 공간을 확인한 뒤 작업을 다시 선택해 주세요.'
          : '입력을 저장하지 못했습니다. 기존 활동을 유지합니다.');
        if (msg.nonce && this.draftFlush?.nonce===msg.nonce) this.draftFlush.reject(error);
        if (taskStore) await this.post({ type: 'taskWorkspaceError', error: error.message, draftSaveFailed: true });
        else await this.post({type:'activityDraftError',error:'입력을 저장하지 못했습니다. 활동을 바꾸기 전에 내용을 복사해 두세요.'});
      }
      return;
    }
    if (connections && (msg.type==='sendMessage'||msg.type==='retryMessage') && msg.activityId!==connections.scope) {
      await this.post({type:'streamError',streamId:'connection',error:'활동이 바뀌었습니다. 현재 활동에서 요청을 다시 확인해 주세요.'});return;
    }
    let requestedMode: TurnToolMode = 'auto';
    if (msg.type === 'sendMessage' || msg.type === 'retryMessage') {
      try {
        requestedMode = msg.type === 'retryMessage' ? retryTurnToolMode(this.retryMessages(), msg) : turnToolMode(msg.toolMode);
        if (msg.type === 'sendMessage' && msg.editOf !== undefined) this.requireEditTarget(msg.editOf);
        if (this.interruptedHistoryError()) throw new Error('중단한 대화가 아직 저장되지 않았습니다. 작업을 다시 선택해 저장을 재시도한 뒤 보내 주세요.');
      } catch (error) {
        await this.post({ type: 'inputRejected', text: msg.type === 'sendMessage' ? msg.text : msg.prompt, images: msg.images,
          ...(validTurnToolMode(msg.toolMode) ? { toolMode: msg.toolMode } : {}) });
        await this.post({ type: 'streamError', streamId: 'tools', error: error instanceof Error ? error.message : '도구 선택을 확인하지 못했습니다.' });
        return;
      }
    }
    // Any message from the panel is evidence of a human. See `lastActivityAt`.
    this.lastActivityAt = Date.now();
    // D-028 — a send that is turned away here never reaches handleSend, so its staged photos
    // are deleted now; they are not part of the text handed back to the input box.
    if ((this.opsHold || this.connectionChanging) && msg.type === "sendMessage") {
      for (const id of msg.attachments ?? []) this.imageStaging?.discard(id);
    }
    if (this.opsHold && (msg.type === "sendMessage" || msg.type === "retryMessage")) {
      // #751 — only a NEW AI run is held; the typed text goes back into the box, nothing is lost.
      await this.post({type:"inputRejected",text:msg.type==="sendMessage"?msg.text:msg.prompt,images:msg.images,toolMode:requestedMode});
      void this.post({ type: "streamError", streamId: "connection", activityUnavailable: { cause: this.opsHold === "paused" ? "paused" : "forbidden", audience: "classroom" }, error: this.opsHold === "paused" ? "강사가 새 AI 실행을 잠시 멈췄습니다. 입력은 그대로 남겨 두었고, 파일 편집·저장·내보내기는 계속 할 수 있습니다." : "이전 AI 실행이 끝났는지 확인하지 못해 새 실행을 잠시 막았습니다. 입력은 그대로 남겨 두었습니다. 강사에게 알려 주세요." });
      return;
    }
    if (this.connectionChanging && (msg.type === "sendMessage" || msg.type === "retryMessage")) {
      await this.post({type:"inputRejected",text:msg.type==="sendMessage"?msg.text:msg.prompt,images:msg.images,toolMode:requestedMode});
      void this.post({ type: "streamError", streamId: "connection", error: "활동 전환이 끝난 뒤 다시 보내세요. 입력은 초안에 남겨 두었습니다." });
      return;
    }
    switch (msg.type) {
      case 'observationCancel':
        this.observationAssessment?.abort();
        return;
      case 'observationAssess':
      case 'observationCorrect': {
        const token=await this.context.secrets.get(TOKEN_KEY);
        const proxy=vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1');
        const recorder=await this.prepareObservation(proxy,token,await this.ensureProfile());
        if(!recorder||recorder.batch.scope!==msg.scope){await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:null,error:'수업 연결이 바뀌었습니다. 기록을 다시 확인하세요.'});return;}
        if(msg.type==='observationCorrect'){
          if(typeof msg.text==='string'&&msg.text.trim()&&msg.text.length<=2000){recorder.record(crypto.randomUUID(),'correction',msg.text);this.persistObservation(recorder);await this.observationWrites;}
          await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:recorder.snapshot(),error:null});return;
        }
        const snapshot=recorder.snapshot();
        if(snapshot.incomplete||recorder.missing.length){await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:snapshot,error:'빠진 기록이 있어 관찰을 요청할 수 없습니다. 작업 파일은 보존돼 있습니다.'});return;}
        if(this.observationAssessment){await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:snapshot,error:'이미 관찰 중입니다. 완료하거나 취소한 뒤 다시 요청하세요.'});return;}
        if(JSON.stringify(msg.eventIds)!==JSON.stringify(snapshot.events.map(e=>e.id))){await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:snapshot,error:'새 작업 기록이 추가됐습니다. 보낼 내용을 다시 확인해 주세요.'});return;}
        const controller=new AbortController();this.observationAssessment=controller;
        try{
          // REQ-KNOW-09: the ticked box in the panel is the learner's choice; the host still lists recipient, items and sizes
          // for exactly this body and sends nothing on Cancel. `snapshot` is a structuredClone and assessmentBatch is pure,
          // so the confirmed items and the body below are the same bytes (CR-10 pins the body expression literally).
          if(!await confirmOutbound({recipient:`관찰 평가 API (원문은 저장하지 않음) · ${new URL(proxy).host}`,items:observationOutboundItems(assessmentBatch(snapshot).events)})||await this.context.secrets.get(TOKEN_KEY)!==token){await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:snapshot,error:'보내지 않았습니다. 기록은 그대로 있습니다.'});return;}
          const response=await fetch(proxy.replace(/\/$/,'')+'/observations/assess',{method:'POST',headers:{...observationHeaders(token),'content-type':'application/json'},body:JSON.stringify(assessmentBatch(snapshot)),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(65000)])});
          if(!response.ok){const failure=await response.json() as {error?:{code?:string}};throw Error(/^[a-z_0-9]{1,80}$/.test(failure.error?.code??'')?failure.error!.code:'assessment_failed');}
          const result=await response.json() as {findings:unknown;capability_model?:unknown};
          // Against the model the SERVICE says it wrote them in, not a constant. The
          // whole record — including `capability_model` — is what gets persisted two
          // lines down, so a reload validates against the same model.
          const findings=validateFindings(result.findings,snapshot,asCapabilityModel(result.capability_model));
          if(this.nativeObservation?.batch.scope!==snapshot.scope || await this.context.secrets.get(TOKEN_KEY)!==token)return;
          await this.context.workspaceState.update('hps.observation.result.'+snapshot.scope+'.'+snapshot.program,{...result,at:Date.now(),event_ids:snapshot.events.map(e=>e.id)});
          await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:snapshot,error:null,findings,capabilityModel:asCapabilityModel(result.capability_model),assessedEventCount:snapshot.events.length});
        }catch(error){const code=error instanceof Error&&/^[a-z_0-9]{1,80}$/.test(error.message)?error.message:'assessment_failed';if(await this.context.secrets.get(TOKEN_KEY)===token)await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:snapshot,error:controller.signal.aborted?'관찰을 취소했습니다. 작업과 기록은 보존돼 있습니다.':'관찰 결과를 확인하지 못했습니다. 작업과 기록은 보존돼 있습니다. ('+code+')'});}finally{if(this.observationAssessment===controller)this.observationAssessment=null;}
        return;
      }
      case 'observationOpen': {
        const token=await this.context.secrets.get(TOKEN_KEY);
        const proxy=vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1');
        const recorder=await this.prepareObservation(proxy,token,await this.ensureProfile());
        const saved=recorder?this.context.workspaceState.get<{findings:unknown;event_ids:string[];capability_model?:unknown}>('hps.observation.result.'+recorder.batch.scope+'.'+recorder.batch.program):undefined;
        let findings;try{if(saved&&recorder&&saved.event_ids.every(id=>recorder.batch.events.some(e=>e.id===id)))findings=validateFindings(saved.findings,recorder.batch,asCapabilityModel(saved.capability_model));}catch{this.nativeObservationError='이전 관찰 근거를 확인하지 못했습니다.';}
        await this.post({type:'observationState',learningPath:this.nativeLearningPath,batch:recorder?.snapshot()??null,error:this.nativeObservationError,findings,capabilityModel:asCapabilityModel(saved?.capability_model),assessedEventCount:saved?.event_ids.length});
        return;
      }
      case 'learningEvent': {
        // SX-45 rule 2 — the **only** place where a learning event is made. The coach
        // stream callback (`recordObservation`) does not call this function.
        const recorder = await this.currentLearningRecorder();
        if (!recorder) { await this.postLearningState(); return; }
        const profile = await this.ensureProfile();
        const step = this.learningStep(profile, msg.stepId);
        const made = learningEventRequest(msg.draft, {
          week: Number(profile?.lesson?.content?.learning?.week ?? 1),
          step_id: step?.id ?? '',
          task: this.learningTaskId(profile?.lesson?.sha256, activityConnections(this.context)?.current?.id),
          module_version: String(profile?.lesson?.version ?? ''),
          sender: 'webview-form',
          stepEvidenceType: step?.evidence as never,
        });
        // A refusal is not swallowed silently — if what the student wrote disappears,
        // they will not write it again.
        if (!made.ok) { this.nativeObservationError = '남긴 내용을 저장하지 못했어요 ('+made.code+'). 다시 한 번 눌러 주세요.'; }
        else {
          try {
            recorder.recordLearningEvent(made.event); this.persistObservation(recorder); this.nativeObservationError = null;
            // SX-55 — the student's first learning event starts the task (assigned → working).
            await this.runTaskFlow({ kind: 'work' }, recorder, profile);
          }
          catch (error) { this.nativeObservationError = '남긴 내용을 저장하지 못했어요 ('+(error as Error).message+').'; }
        }
        await this.postLearningState();
        return;
      }
      case 'learningDrawer':
        // A view state. The host only records it and never uses it in a verdict.
        this.learningDrawerOpen = msg.open;
        return;
      case 'submitTask': {
        // SX-14's negative condition — the webview's disabled state is not evidence.
        // Run the same gate again.
        const recorder = await this.currentLearningRecorder();
        const profile = await this.ensureProfile();
        const completion = this.learningCompletion(profile);
        // SX-55 — the submit names the task on screen. The gate is judged on that task's
        // events and the record moves that task, so a different name is not this task's submit.
        const current = this.learningTaskId(profile?.lesson?.sha256, activityConnections(this.context)?.current?.id);
        if (msg.task !== current) { await this.postLearningState(); return; }
        const verdict = acceptSubmit({
          task: msg.task,
          events: recorder?.batch.events ?? [],
          completion,
        });
        if (!verdict.ok) {
          this.nativeObservationError = '아직 완료할 수 없어요: ' + verdict.reasons.join(' · ');
          await this.postLearningState();
          return;
        }
        this.nativeObservationError = null;
        // SX-55 — the gate held, so the task is submitted (working → submitted). Before any work
        // the record refuses by name and runTaskFlow says so beside the button: a button alone
        // does not skip `working`.
        if (recorder) await this.runTaskFlow({ kind: 'submit' }, recorder, profile);
        await this.postLearningState();
        return;
      }
      case "inboxRequest": await this.postInbox(); return;
      case "turnReviewRequest": this.postTurnReview(); return;
      case "missingTaskFolderRequest": await this.postMissingTaskFolder(); return;
      case "missingTaskFolderRepick": await this.repickTaskFolder(); return;
      case "previewRecoveryRequest": await this.postPreviewRecovery(); return;
      case "previewRecoveryAction": await this.runPreviewRecovery(msg.action); return;
      case "activityTrashRequest": await this.postActivityTrash(); return;
      case "activityTrashAction": await this.runActivityTrashAction(msg); return;
      case "artifactProvenanceRequest": await this.postArtifactProvenance(true); return;
      case "pageCardsRequest": this.postPageCards(); return;
      case "pageCardOpen":
      case "pageCardReveal":
        await this.handlePageCardMessage(msg);
        return;
      case "turnRevert":
      case "turnKeep":
      case "turnReviewClose":
        await this.handleTurnReviewMessage(msg);
        return;
      case "inboxOpen": await this.inboxSource?.inboxOpened(msg.objectId, msg.generation); return;
      case "inboxLink": await this.handleInboxLink(msg); return;
      case "helpRequest": await this.helpSource?.refresh(); return;
      case "artifactApprove": await this.approveArtifactInteractively(); return;
      case "helpDraft": await this.helpSource?.draft(msg.key, msg.draft); return;
      case "helpPreview": await this.helpSource?.preview(msg.key, msg.draft); return;
      case "helpCancel": await this.helpSource?.cancel(msg.key, msg.requestId); return;
      case "helpSend": await this.helpSource?.send(msg.key, msg.requestId, msg.consent === true); return;
      case "helpRetry": await this.helpSource?.retry(msg.key); return;
      case "helpDiscard": await this.helpSource?.discard(msg.key, msg.requestId); return;
      case "helpConfirm": await this.helpSource?.confirm(msg.key, msg.id, msg.revision); return;
      case "helpWithdraw": await this.helpSource?.withdraw(msg.key, msg.id); return;
      case "writeApprovalAnswer": this.writeApprovalRequest.respond(msg.id,msg.approved); return;
      case "outboundAnswer": this.outboundApproval?.respond(msg.id,msg.selected); return;
      case "accuracyEducationRequest": if (typeof msg.requestId === "string" && msg.requestId.length <= 100) await this.postAccuracyEducation(msg.requestId); return;
      case "accuracyEducationDismiss": {
        const scope = this.turnRequestScope(), owner = await this.accuracyOwner();
        if (scope !== this.turnRequestScope() || this._instructorMode.isInstructor) return;
        try { await dismissAccuracy(this.accuracyStore(), owner, scope, msg.messageId); } catch { /* best effort; the card stays until a dismissal can be stored */ }
        await this.postAccuracyEducation();
        return;
      }
      case "ready":
        this.writeApprovalRequest.cancel();
        this.outboundApproval?.cancel();
        await this.postInbox();
        // AE-15 — a remount must still show the open review bar (it never auto-dismisses).
        this.postTurnReview();
        this.postPageCards();
        await this.postConfig();
        await this.postHistory();
        await this.postAccuracyEducation();
        await this.postLearningState();
        // #308 — flush the pending inline notice. The webview may have just
        // been created for the first time (attachPageContext ran before
        // panel.focus) or recreated after hide/show (no retainContextWhenHidden
        // for WebviewView → React state reset). Re-posting is idempotent: the
        // reducer replaces pageNotice rather than appending.
        if (this.pendingPageNotice) {
          void this.post({ type: "pageAttached", label: this.pendingPageNotice });
        }
        // CR-09 — a remount must still show the picked element that is queued to go.
        this.postAnnotations();
        if (this.elementQueue.queued) this.postElementPreview();
        // CGP-ART-R-007 — and the page text that is queued to go.
        if (this.pendingPageAttachment) void this.post({ type: "pageAttachment", attachment: this.pendingPageAttachment });
        // CGP-CHAT-R-011 — and the work-folder file that is queued to go.
        if (this.pendingFileAttachment) void this.post({ type: "fileAttachment", attachment: this.pendingFileAttachment.preview });
        for (const [id, failed] of this.failedAttachmentReads ?? []) {
          if (failed.scope === this.turnRequestScope() && failed.root === (this.resolveCoachCwd() ?? '')) void this.post({ type: 'attachmentFailure', failure: { id, name: attachmentDisplayName(path.basename(failed.file)), reason: failed.reason } });
          else this.failedAttachmentReads.delete(id);
        }
        // #320 — AI disclosure at session start (REQ-C14). First "ready" of
        // a session shows the notice; hide/show remounts within the same
        // session return null here and stay silent. A history clear resets
        // the session (see clearHistory), so the next conversation start is
        // disclosed again.
        {
          const savedStatus = this.lastActivityStatus;
          if (savedStatus?.scope === this.turnRequestScope() && !this.hasActiveStream()) await this.post({...savedStatus.message, streamId:'activity'});
          const disclosure = this.aiDisclosure.noticeForReady();
          if (disclosure) void this.post({ type: "aiDisclosure", text: disclosure });
        }
        return;
      case 'workTakeaway': await this.takeMyWork(); return;
      case 'activityLocalFile': {
        if (msg.action !== 'open' && msg.action !== 'export') return;
        if (this.localFileBusy) return;
        this.localFileBusy = true;
        const scope = this.turnRequestScope();
        try {
          await activityLocalFile<vscode.Uri>(msg.action, {
            current: () => scope === this.turnRequestScope(),
            choose: async () => (await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, title: '내 컴퓨터의 파일 선택', openLabel: '선택' }))?.[0],
            destination: async source => {
              const file = path.parse(source.fsPath);
              return vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(file.dir, file.name + '-copy' + file.ext)), title: '내 파일을 다른 위치에 내보내기', saveLabel: '내보내기' });
            },
            open: async source => { if (source.scheme === 'file') await vscode.commands.executeCommand('vscode.open', source); },
            copy: async (source, destination) => {
              if (source.scheme !== 'file' || destination.scheme !== 'file' || source.toString() === destination.toString()) return;
              // Never overwrite silently, including a destination changed while the picker was open.
              await vscode.workspace.fs.copy(source, destination, { overwrite: false });
              void vscode.window.showInformationMessage('내 파일을 내보냈습니다.');
            },
          });
        } catch { void vscode.window.showWarningMessage('파일을 열거나 내보내지 못했습니다. 접근 권한을 확인하고, 내보내기는 새 파일 이름을 선택해 주세요.'); }
        finally { this.localFileBusy = false; }
        return;
      }
      case 'refreshAccess':
        this.lastActivityStatus = undefined;
        await this.loadAccess(true);await this.postConfig();return;
      case 'carryoverDecision':
        await this.decideCarryover(msg.decision);
        return;
      case 'selectFunding':
        await this.loadAccess();
        if(!this.hasActiveStream()&&this.accessState?.view?.choices.some(c=>c.id===msg.id&&c.active))this.accessState={...this.accessState,selected:msg.id,notice:'선택한 이용권을 다음 작업부터 사용합니다.'};
        await this.postConfig();return;
      case 'requestBudget':{
        const token=await this.context.secrets.get(TOKEN_KEY),selected=this.accessState?.selected;
        if(token&&selected){try{const sent=await sendBudgetRequest(vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1'),token,selected,msg.note,async(m)=>await confirmOutbound(m)&&await this.context.secrets.get(TOKEN_KEY)===token&&this.accessState?.selected===selected);await this.loadAccess(true);if(this.accessState)this.accessState.notice=sent?'강사에게 추가 사용 요청을 보냈습니다.':'보내지 않았습니다.';}catch(error){if(this.accessState)this.accessState.notice=error instanceof Error?error.message:'요청을 보내지 못했습니다.';}}
        await this.postConfig();return;
      }
      case "refreshEffort":
        await this.refreshEffortResult();
        return;
      case "selectEffort": {
        const profile = await this.ensureProfile();
        const cfg = vscode.workspace.getConfiguration('hypeproofChat');
        const selection = availableModelSelection(profile,cfg.get<'proxy'|'agent-sdk'>('coachRuntime','proxy'));
        if (profile && selection) {
          const model = selectedModel(profile,selection,this.context.workspaceState.get<SavedModelChoice>('hps.modelChoice'),cfg.get<string>('model','hypeproof-default'));
          const effort = selectedEffort(profile,selection,model);
          if (effort?.allowed.includes(msg.value)) {
            await this.context.workspaceState.update('hps.effortChoice',{scope:modelSelectionScope(profile),model,value:msg.value});
            this.effortNotice = '다음 요청부터 적용돼요';
          }
        }
        await this.postConfig();
        return;
      }
      case "selectModel": {
        const profile = await this.ensureProfile();
        const cfg = vscode.workspace.getConfiguration('hypeproofChat');
        const selection = availableModelSelection(profile, cfg.get<'proxy' | 'agent-sdk'>('coachRuntime', 'proxy'));
        if (profile && selection?.choices.some(c => c.alias === msg.alias)) {
          const previous = selectedModel(profile,selection,this.context.workspaceState.get<SavedModelChoice>('hps.modelChoice'),cfg.get<string>('model','hypeproof-default'));
          await this.context.workspaceState.update('hps.modelChoice', { scope: modelSelectionScope(profile), alias: msg.alias });
          if (previous !== msg.alias) {
            await this.context.workspaceState.update('hps.effortChoice',undefined);
            this.effortNotice = selection.choices.find(c=>c.alias===msg.alias)?.effort
              ? '모델이 바뀌어 수업 기본 처리 수준을 사용해요' : '이 모델은 처리 수준 조절을 지원하지 않아요';
          }
        }
        await this.postConfig();
        return;
      }
      // #1298 — instructor-only: free-form model id. Saved immediately; the first
      // turn that runs with this model validates it (server rejects unknown models,
      // CLI errors on first turn). revertModelOnTurnError() restores prevChoice.
      case "selectModelDirect": {
        if (!this._instructorMode.isInstructor) return;
        const modelId = msg.modelId.trim();
        if (!modelId) { await this.postConfig(); return; }
        await this._instructorMode.selectModel(
          modelId,
          () => this.context.workspaceState.get('hps.modelChoice'),
          c => Promise.resolve(this.context.workspaceState.update('hps.modelChoice', c)),
        );
        await this.postConfig();
        return;
      }
      case "sendMessage":
        // REQ-STUDIO-MISSING-TASK-FOLDER — no turn starts in a folder that is gone; the draft stays. Other seats
        // pass without an await, so their send still reaches its first await exactly as before.
        if (this.missingFolderApplies() && await this.missingTaskFolderPath()) { await this.holdSendForMissingFolder(msg.text, msg.images, requestedMode); return; }
        if (this.turnRestoreBusy) { await this.refuseSendWhileRestoring(msg.text, msg.images, requestedMode); return; }
        await this.handleSend(msg.text, msg.history, msg.images, promptRefs(msg.imports), msg.attachments, requestedMode, msg.userMessageId, undefined, msg.editOf, true); // CGP-CHAT-R-011 — a fresh send may carry the attached file
        return;
      case "prepareAttachments": {
        const result = this.prepareAttachments(msg.files);
        await this.post({type:"attachmentsPrepared",requestId:msg.requestId,failures:result.failures}); return;
      }
      case "stageImage":
        await this.stageAttachedImage(msg.stageId, msg.name, msg.mime, msg.base64);
        return;
      case "discardStagedImage":
        this.imageStaging?.discard(msg.stageId);
        return;
      case "selectAnswerAttempt": {
        if (this.hasActiveStream() || this.pendingSends || this._instructorMode.isInstructor ||
            msg.activityId !== activityConnections(this.context)?.current?.id ||
            msg.taskId !== (this.currentTaskStore?.()?.getView().activeTaskId ?? undefined)) return;
        const scope = this.turnRequestScope();
        const selected = selectAttempt(this.getHistory(), msg.rootId, msg.attemptId, msg.choose === true);
        if (!selected) return;
        const write = (async () => {
          await this.appendHistory([selected]);
          if (msg.choose === true) {
            const key = `answer-attempt-events:${scope}`;
            const events = this.context.globalState.get<unknown[]>(key, []);
            await this.context.globalState.update(key, [...events, { event: 'answer_attempt_chosen',
              rootId: msg.rootId, attemptId: msg.attemptId, actor: 'learner', at: Date.now() }]);
          }
          if (scope === this.turnRequestScope()) await this.post({type:'answerAttemptSelected',root:selected,scope});
        })();
        this.attemptWrite = write;
        try { await write; } finally { if (this.attemptWrite === write) this.attemptWrite = undefined; }
        return;
      }
      case "retryMessage":
        // #358 — carry the failed turn's image(s) through the retry so the
        // coach actually re-receives the screenshot (was text-only → "스크린샷을
        // 아직 못 받았어요").
        if (this.missingFolderApplies() && await this.missingTaskFolderPath()) { await this.holdSendForMissingFolder(msg.prompt, msg.images, requestedMode); return; }
        if (this.turnRestoreBusy) { await this.refuseSendWhileRestoring(msg.prompt, msg.images, requestedMode); return; }
        await this.handleSend(msg.prompt, msg.history, msg.images, undefined, undefined, requestedMode, msg.userMessageId, msg.sourceMessageId);
        return;
      case "voiceCapabilityProbeResult": {
        // #897 — hand the raw observation to whoever is waiting for it. No verdict
        // is made here.
        const pending = this.voiceProbes.get(msg.probeId);
        if (pending) {
          this.voiceProbes.delete(msg.probeId);
          pending(msg.observations);
        }
        return;
      }
      case "cancelStream":
        this.activeStreams.get(msg.streamId)?.abort();
        // #497 — abort() alone tells the webview NOTHING. handleSend and
        // handleSendError both skip their posts on an aborted signal, each
        // citing "the webview already ended the stream" — a premise no code
        // ever satisfied. The panel therefore stayed in the streaming state
        // forever: Stop and the spinner never cleared, and every later message
        // parked in the #416 queue whose flush only fires on the streaming →
        // idle edge. Say it explicitly here, where we know it was user-initiated.
        void this.post({ type: "streamStopped", streamId: msg.streamId });
        return;
      case "requestAction":
        await this.handleActionRequest(msg.action);
        return;
      case "setTextSize":
        await this.context.globalState.update(TEXT_SIZE_KEY, normalizeTextSize(msg.size));
        await this.postConfig();
        return;
      case "openSettings":
        void vscode.commands.executeCommand("workbench.action.openSettings", "hypeproofChat");
        return;
      case "setToken":
        void vscode.commands.executeCommand("hypeproof-chat.setToken");
        return;
      case "openReportModal":
        // #64. Webview's error banner has a 🚨 link; we delegate to the same
        // command so the QuickInput cascade lives in one place.
        void vscode.commands.executeCommand("hypeproof-chat.reportProblem");
        return;
      case "trialEndCardPasses":
        // TUX-COND-07 — the person pressed the card's Primary. The start page opens its own
        // purchase view (REQ-L12 ②); no order is created until they choose there.
        // CONV-FUNNEL-R-003 — counted here as offer_clicked end_card: showPurchase() opens the pass
        // list directly and never passes through the start page's purchaseOpen (surface start_page).
        this.emitEndCardOffer("offer_clicked");
        // CONV-FUNNEL-R-006 — the pass list it opens is counted as pass_list_viewed on this surface.
        void vscode.commands.executeCommand("hypeproof-chat.showPasses", msg.surface === "header_menu" ? "header_menu" : "end_card");
        return;
      case "trialEndCardDismiss":
        // CONV-FUNNEL-R-003 — the card's escape (오늘은 여기까지). The webview closes the card itself.
        this.emitEndCardOffer("offer_dismissed");
        return;
      case "trialEndCardClaude":
        await this.openPersonalClaude(msg.draft);
        return;
      case "notifyOptinSubmit":
      case "notifyOptinWithdraw":
        // TUX-COND-08 — the optional email on the end card. Never stored; only a submitted flag is.
        void this.handleNotifyOptin(msg.type === "notifyOptinSubmit" ? msg.email : null);
        return;
      case "installUpdate":
        // #72. User clicked "Install Now" on the update banner.
        void vscode.commands.executeCommand("hypeproof-chat.installUpdate");
        return;
      case "dismissUpdate":
        // #72. User clicked "Later" — silence this version for 7 days.
        void vscode.commands.executeCommand("hypeproof-chat.dismissUpdate", msg.version);
        return;
      case "acknowledgeLessonCapabilities": {
        const cfg = vscode.workspace.getConfiguration("hypeproofChat");
        const token = await this.context.secrets.get(TOKEN_KEY);
        const service = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
        const id = lessonCapabilityEntryId(this.cachedProfile, token, service,
          !!localRuntimeConfig(vscode.env.appName, service) || this.lastAllowInstructor === true);
        // A stale view can acknowledge only the exact seat and lesson it drew.
        if (!id || msg.id !== id) return;
        try { await this.context.globalState.update(entryReceiptKey(id), true); }
        catch { return; } // Keep the card open if its receipt could not be stored.
        await this.postConfig();
        return;
      }
      case "dismissCapabilityChange":
        (this.capChanges ??= new CapabilityChangeTracker()).dismiss(msg.id);
        void this.postConfig();
        return;
      case "namingRitual":
        void this.runCoachNamingRitual({ force: true });
        return;
      case "saveCoach":
        await this.saveCoachFromWebview(msg.name, msg.personality);
        return;
      case "repickAttachment":
        if(typeof msg.id==='string' && msg.id.length<=128 && typeof msg.name==='string') await this.repickAttachment(msg.id,msg.name); return;
      case "retryAttachment":
        if (typeof msg.id === "string") await this.retryAttachmentRead(msg.id);
        return;
      case "discardAttachmentFailure":
        this.failedAttachmentReads.delete(msg.id);
        return;
      case "attachWorkspaceFile":
        await this.attachWorkspaceFile();
        return;
      case "askAboutFile":
        if (typeof msg.path === "string") await this.askAboutFile(msg.path);
        return;
      case "removeFileContext":
        // CGP-CHAT-R-011 — removed before sending: nothing from the file goes with the next turn.
        this.clearFileAttachment();
        return;
      // CGP-KNOW-R-003 — the 자료 list; the host re-checks the seat, folder and scope on every press.
      case "materialsRequest": await this.postMaterials(); return;
      case "materialAddFile": await this.addMaterial(String(msg.requestId)); return;
      case "materialAddUrl": await this.addMaterial(String(msg.requestId), typeof msg.url === "string" ? msg.url : ""); return;
      case "materialSelect": if (typeof msg.id === "string" && typeof msg.scope === "string") await this.selectMaterial({ requestId: String(msg.requestId), scope: msg.scope, id: msg.id, selected: msg.selected === true }); return;
      case "materialRemove": if (typeof msg.id === "string" && typeof msg.scope === "string") await this.removeMaterial({ requestId: String(msg.requestId), scope: msg.scope, id: msg.id }); return;
      case "removePageContext":
        // CGP-ART-R-007 — removed before sending: nothing from the page goes with the next turn.
        this.clearPageAttachment();
        void this.post({ type: "pageAttachment", attachment: null });
        return;
      case "annotationAction":
        this.syncAnnotationScope();
        if (msg.action === 'remove' && Number.isInteger(msg.number)) {
          if (this.annotationBatch.remove(msg.number!)) await this.mcpBrowser?.annotationMarker(msg.number!, null).catch(() => {});
        } else if (msg.action === 'comment' && Number.isInteger(msg.number) && typeof msg.comment === 'string') {
          this.annotationBatch.edit(msg.number!, msg.comment);
        } else if (msg.action === 'element' || msg.action === 'rectangle') await this.pickElement(msg.action);
        this.postAnnotations();
        return;
      case "removeElementContext":
        // CR-09 — the student removed the picked element; a CR-only message (CR-T02 inventory).
        this.clearElementContext();
        break;
      case "verifyOpen":
      case "verifyStart":
      case "verifyRetest":
      case "verifyFix":
      case "verifyPark":
      case "verifyResume":
        // cr-verify — CR-only messages (CR-T02 inventory); the handler re-checks the switch first.
        await this.handleVerifyMessage(msg);
        break;
      case "publishRefresh":
      case "publishClose":
      case "publishOpen":
      case "publishSubmit":
      case "publishLink":
      case "publishCopy":
      case "publishRevoke":
        // cr-publish — CR-only messages (CR-T02 inventory); the handler re-checks the switch first.
        await this.handlePublishMessage(msg);
        break;
      case "evidenceOpen":
      case "evidenceNote":
      case "evidenceDraft":
      case "evidenceReview":
      case "evidenceDelete":
        // cr-evidence — CR-only messages (CR-T02 inventory); the handler re-checks the switch first.
        await this.handleEvidenceMessage(msg);
        break;
      case "memoryOpen":
      case "memoryDiff":
      case "memoryDecision":
        // cr-memory — CR-only messages (CR-T02 inventory); the handler re-checks the switch first.
        await this.handleMemoryMessage(msg);
        break;
      case "skillsOpen":
      case "skillRun":
        // cr-skills — CR-only messages (CR-T02 inventory); the handler re-checks the switch first.
        await this.handleSkillsMessage(msg);
        break;
      case "reviewOpen":
      case "reviewPrepare":
        // cr-review — CR-only messages (CR-T02 inventory); the handler re-checks the switch first.
        await this.handleReviewMessage(msg);
        break;
      case "reviewDirectorOpen":
      case "reviewDecision":
        // cr-review — the director's messages (CR-T02 inventory); the handler re-checks the switch through the Service first.
        await this.handleReviewDirectorMessage(msg);
        break;
      case "clearHistory":
        void this.clearHistory();
        return;
      case "answerVerdict":
        await this.handleAnswerVerdict(msg);
        return;
      case "answerToWiki":
        await this.handleAnswerToWiki(msg);
        return;
      case "runCode":
        void this.revealBuilt(msg.html, { artifactSource: "manual_preview" });
        return;
      case "previewReady":
        return;
      case "openExternal":
        // #173 citation chip click. routeExternalLink keeps the http(s)-only guard against a
        // hostile scheme from a compromised upstream; CGP-ART-R-008 adds the cohort-aware exit.
        void this.openLearnerLink(msg.url);
        return;
      case "publishToGallery":
        void this.publishToGallery();
        return;
      case "switchProject":
        void this.switchProject();
        return;
      case "publishSite":
        // The visible "Studio button": HP shell defaults hide editor/view title actions (#725),
        // so the chat header is where a participant can actually press it.
        void this.publishSite();
        return;
      case "webviewError":
        // S-04 (#48). Log to output channel so the trace survives a panel
        // reload; don't crash the host.
        console.error(
          `[hypeproof-chat] webview error: ${msg.message}\n` +
          `stack:\n${msg.stack}\n` +
          `componentStack:\n${msg.componentStack}`,
        );
        return;
      // #580 — a trace event lands in the local spool first (spool-then-forward).
      // Real-time forwarding to the worker (#552, #9d follow-up) can later just read
      // this spool and send, so the two paths share one schema. The mapping is owned
      // by a vscode-free helper (traceMsgToWorkflowRecord), and agreement with
      // trace.ts's field names is pinned by test/trace-workflow-map.smoke.mjs.
      // #751 F4 — the learner's own step action in the lesson panel. Only a step of the CONFIRMED lesson this profile
      // carries is accepted; the record stays in the local spool first, then goes to the class board as ids only.
      case "lessonStep": {
        const signal = lessonStepSignal(this.cachedProfile?.lesson, msg);
        if (!signal) return;
        this.spool?.recordWorkflow({ event: "lesson_step", payload: signal });
        this.opsObserver?.lessonStep(signal.lesson_version, signal.step_id, signal.status);
        // SX-55 — starting a step makes it the task's current step when its gates allow
        // (recordStepStart). "Marked done" (`submitted`) is the learner's own report to the class
        // board and moves nothing in the task flow. Only a seat that runs the flow goes on: every
        // other seat keeps this handler exactly as it was, with no observation recorder prepared
        // and no Service request on a step start (runsTaskFlow).
        if (signal.status === "in_progress" && runsTaskFlow(this.cachedProfile)) void this.recordStepStart(signal.step_id).catch(() => undefined);
        return;
      }
      // #751 G2 — the learner's focus (step + help choice) for the NEXT turn. A turn already running keeps what it started with.
      case "lessonFocus": {
        const lesson = this.cachedProfile?.lesson;
        const focus = acceptFocus(lesson, msg);
        if (focus) this.lessonFocus = focus;
        if (lesson) await this.post({ type: "lessonWorkState", sha256: lesson.sha256, work: this.lessonWorkFor(lesson.sha256) });
        return;
      }
      // #751 G2 — a work-surface save. Kept on this device per lesson digest; it travels with the next turn of that step.
      case "lessonWork": {
        const lesson = this.cachedProfile?.lesson;
        const saved = acceptWork(lesson, msg, Date.now());
        if (!lesson || !saved) return;
        const all = this.context.workspaceState.get<Record<string, Record<string, StepWork>>>("hps.lessonWork") ?? {};
        await this.context.workspaceState.update("hps.lessonWork", { ...all, [lesson.sha256]: { ...(all[lesson.sha256] ?? {}), [saved.stepId]: saved.work } });
        this.spool?.recordWorkflow({ event: "lesson_work_saved", payload: { lesson_version: lesson.version, step_id: saved.stepId, kind: saved.work.kind } });
        await this.post({ type: "lessonWorkState", sha256: lesson.sha256, work: this.lessonWorkFor(lesson.sha256) });
        return;
      }
      // AE-01 (#554) — the learner's own goal and completion criteria for this lesson revision. Kept on this device beside
      // the lesson's criteria, which this path never reads from the message or stores; it moves no task and records no event.
      case "goalSave": {
        const save = this.goalWrites.then(() => this.saveGoal(msg));
        this.goalWrites = save.catch(() => undefined);
        await save;
        return;
      }
      // #751 G2 — rehearsal only: send what the panel drew, with this App's identity, under the rehearsal code.
      case "rehearsalSend": {
        await this.sendRehearsalReport(msg.steps, msg.mission);
        return;
      }

      case "traceTrialStart":
      case "traceTrialEnd":
      case "traceValidationRun":
      case "traceHumanAction":
        this.spool?.recordWorkflow(traceMsgToWorkflowRecord(msg));
        return;
    }
  }

  /**
   * #580 — proxy-path usage → spool mapping. The single turn and the browser loop had
   * inlined the same shape twice; this brings it into one place. The field names match
   * SpoolUsageRecord, so it ends in a spread.
   */
  /**
   * #897 H-13 — while recording usage, also look at **whether the model requested and
   * the model that answered differ**.
   *
   * Observed 2026-09-11: echoing a different model back for the same request left the
   * whole screen's innerText completely identical. `usage.model` reached this far but
   * went only into the spool, and not one character of it reached the student — a
   * silent substitution was indistinguishable from success.
   *
   * The verdict is made by `modelEchoHelpers` (warn only on an explicit choice, a date
   * variant counts as a match, no echo means no verdict). Here that result is attached
   * to the turn's text exactly once — stacking only one notice per turn is the same
   * rule as REQ-M39 ④, and it structurally prevents the same sentence repeating on a
   * path like the browser loop where several requests go out within one turn. A seat
   * has only one coach turn at a time (REQ-M37 ③), so one turn-id slot is enough.
   */
  private proxyUsageRecorder(turnId: string, echo?: ModelEchoContext, onNotice?: (text: string) => void) {
    return (u: ProxyStreamUsage & { requestKey: string | null; model: string | null;
      serverSubstituted?: boolean; serverRequested?: string | null }): void => {
      this.spool?.recordUsage({ turnId, source: "proxy", ...u });
      if (!echo || !onNotice) return;
      // REQ-M42 — pass on the verdict the server stated itself. String comparison
      // alone does not distinguish "alias translation" from "the request was thrown
      // away", which is why the verdict layer had to choose silence here.
      const verdict = modelEchoVerdict({
        ...echo, resolved: u.model,
        ...(u.serverSubstituted === true
          ? { serverSubstituted: true, serverRequested: u.serverRequested ?? null }
          : {}),
      });
      this.logChannel?.appendLine(`[model] ${describeModelEcho(verdict)}`);
      const notice = modelEchoNotice(verdict);
      if (!notice || this.modelNoticeTurn === turnId) return;
      this.modelNoticeTurn = turnId;
      onNotice(notice);
    };
  }

  private async handleSend(
    text: string,
    rawHistory: ChatMessage[],
    images?: string[],
    instructorPromptRefs?: Array<{ object_id: string; revision: number }>,
    attachments?: string[],
    requestedMode?: TurnToolMode,
    userMessageId?: string,
    retrySourceId?: string,
    editOf?: string,
    /** CGP-CHAT-R-011 — a fresh send (never a retry) takes the attached file when its model turn starts. */
    carryFile = false,
  ): Promise<void> {
    const mode = turnToolMode(requestedMode);
    // cr-verify — a re-test is driving the tab and writing the record: the turn waits for it.
    if (this.verifySession?.running) {
      await this.post({type:"inputRejected",text,images,toolMode:mode});
      await this.post({type:"streamError",streamId:"activity",error:"제품 테스트가 끝난 뒤에 보내 주세요."});
      return;
    }
    this.pendingSends++;
    // CGP-ART-R-001 — the draft this send may take, pinned before the first await: a later edit, a
    // task switch or another send makes the take refuse instead of sending a different batch.
    this.syncAnnotationScope();
    const annotationRevision = this.annotationBatch.revision;
    const annotationScope = this.annotationScope();
    const annotationCount = this.annotationBatch.size;
    // A message that carries annotations is always a coach turn: no app shortcut may answer it.
    const carriesAnnotations = this.annotationBatch.size > 0 || (retrySourceId !== undefined && !!this.annotationTurns?.get(retrySourceId)?.length);
    // REQ-STUDIO-STEER-NOW — a stopped turn posts streamStopped before it has saved its partial answer
    // and released the folder lock. This send owns its slot at once (pendingSends) and starts after the
    // previous turn released the lock (at most 15 s), so a send right after a stop is not refused as
    // "another window" and its history already holds the partial answer. No previous turn still
    // settling: no await at all, so the send stays synchronous up to its first real await.
    const previousTurn = this.turnSettling, settle = turnSettleSignal();
    this.turnSettling = settle.promise;
    const previousSettled = previousTurn ? await waitAtMost(previousTurn) : true;
    let releaseActivity: (()=>void) | undefined;
    // streamEnd lets the webview flush its queued follow-up. Announce readiness
    // only after persistence, stream cleanup and the activity lease have settled.
    let accuracyResult: { owner: string; offer: AccuracyOffer; text: string; instructor: boolean } | undefined;
    let completedStreamId: string | undefined;
    let responseStreamId: string | undefined;
    const responseStarted = (id: string) => { responseStreamId = id; };
    let completionSignal: AbortSignal | undefined;
    // REQ-STUDIO-TASK-RUN-STATE — a turn whose stream closed normally but whose result failed (#751 U4) ends as 오류, not 끝남.
    let completionFailed = false;
    const deferCompletion = (streamId: string, signal?: AbortSignal, failed = false) => { completedStreamId = streamId; completionSignal = signal; completionFailed = failed; };
    const attachmentNames = (attachments ?? []).map(id=>({id,name:this.imageStaging?.name(id) ?? "사진"}));
    let preflightComplete=false;
    const releasePower = workPower.acquire("coach-turn");
    try {
    // CGP-CHAT-R-002 — an error retry of an edited prompt (same id) stays a version of its group.
    const retryRoot = retrySourceId ? attemptGroups(this.editableHistory()).find(group => group.attempts.some(attempt => attempt.user.id === retrySourceId))?.root : undefined;
    const versionOf = editOf ?? retryRoot?.editOf ?? (retrySourceId !== undefined && retrySourceId === userMessageId ? this.retryMessages().find(message => message.id === retrySourceId)?.editOf : undefined);
    const editedFrom = editOf ? latestUserTurn(visibleAttempts(this.editableHistory()).items) : null;
    const versions = editOf ? versionCount(visibleAttempts(this.editableHistory()).items, editOf) : 0;
    const userId = this.rememberTurnRequest(text, mode, userMessageId, retrySourceId, versionOf);
    const userLine = (content: string): ChatMessage => ({ id: userId, role: "user", content, createdAt: Date.now(), toolMode: mode, ...(versionOf ? { editOf: versionOf } : {}), ...(retryRoot && userId !== retryRoot.id ? { retryOf: retryRoot.id } : {}) });
    if (retryRoot) Object.assign(this.turnRequests.get(userId)!.message, { retryOf: retryRoot.id });
    const connections=activityConnections(this.context);
    // Instructor mode has no student activity connection — skip the acquire/verify gate.
    if (connections && !this._instructorMode.isInstructor) {
      // The wait ran out: the lock is still this window's own stopped turn, not "another window".
      if (!previousSettled) throw new ActivityConnectionError(TURN_SETTLING_REFUSAL);
      releaseActivity=connections.acquire();
      const token=await connections.token();
      await verifyActivity({token:token!,proxyUrl:connections.current!.service},connections.current!.serverId);
    }
    // #751 U3 — a lesson setting this device holds is switched HERE, before the turn consumes the input. A failure to
    // switch leaves the turn exactly as it would have been; only "switched but the new profile could not be verified"
    // stops it, and then the learner's text and attachments go straight back into the composer.
    if (this.opsObserver?.switchPendingSetting) await this.lessonBindingPreflight();
    const preparedAttachments = this.prepareAttachments([
      ...(attachments ?? []).map(id => ({id,stageId:id})),
      ...(images ?? []).map((dataUrl,index) => ({id:`pasted-${index}`,dataUrl})),
    ]);
    if (preparedAttachments.failures.length) throw new ActivityConnectionError(preparedAttachments.failures[0].reason);
    // CGP-KNOW-R-003 — a selected 자료 that is gone, unreadable or from another task or folder holds the send here, named.
    // No selection: no await at all, so a send without 자료 keeps its timing.
    const preparedMaterials = carryFile && this.materialSelection?.ids.size ? await this.prepareMaterials() : null;
    preflightComplete=true;
    // REQ-STUDIO-FOLDER-CONSENT — decided before anything in this turn calls the model (team brain included).
    if (this.cachedProfile) await folderConsentProfile(this.context, this.cachedProfile, this.folderConsentOpts());
    // DEC-08 — an edited resend is measured as its own event; the original attempt keeps its own turn record.
    if (editOf && editedFrom) this.spool?.recordWorkflow({ event: "edit_resend", payload: editResendPayload({
      editOf, fromMessageId: editedFrom.message.id, toMessageId: userId, versions,
      originalLength: editedFrom.message.content.length, editedLength: text.length, images: images?.length ?? 0, toolMode: mode,
    }) });
    // #503 — the webview's history now has tool lines (role:"tool") mixed in. This is
    // the only path out to the model, so they are filtered once right at the entrance.
    // The proxy/SDK gateway calls below are a contract that knows only user/assistant.
    // CGP-CHAT-R-002 — only the latest version of each prompt goes to the model. A turn that belongs to a
    // version group (an edit, or the error retry of one, which arrives without editOf) drops its whole group.
    const savedHistory = this.getHistory();
    const conversation = activityConnections(this.context) || savedHistory.length ? savedHistory : rawHistory;
    const history = modelHistory(clampTimeline(modelConversation(attemptHistory(conversation, retrySourceId), versionOf), HISTORY_MAX));
    if (retryRoot && userId !== retryRoot.id) await this.appendHistory([{ ...retryRoot, visibleAttemptId: userId }, userLine(text)]);
    // Learning wiki called by name ("팀 브레인에 정리해 줘", "팀 브레인으로 덱 만들어 줘", "팀 브레인에
    // 뭐 있어?"): the App answers with the skill instead of a coach turn. Checked before the show
    // intent below, so "… 보여 줘" with the name never opens the game instead. A pasted image is
    // always a real turn. Reads the profile already held (no await before the turn's first one).
    const wikiSwitch = this.cachedProfile?.learning_wiki;
    const brainCall = mode === 'auto' && wikiSwitch?.enabled === true && !carriesAnnotations && !images?.length ? brainIntent(text, brainName(wikiSwitch.plan), sessionLabel(wikiSwitch.plan)) : null;
    if (brainCall) {
      await this.answerBrainCall(text, brainCall, deferCompletion, responseStarted, userId);
      return;
    }
    // "Show me / open it / run it" — if the kid asks to see the game in plain
    // language and a game already exists, just open it. Don't make them hunt
    // for the ▶ Run button or burn an AI round-trip on a deflection. Skipped
    // when an image is attached — a pasted screenshot is always a real turn.
    if (mode === 'auto' && !carriesAnnotations && isShowIntent(text) && (!images || images.length === 0)) {
      const lastGame = this.extractLastRenderableCode();
      if (lastGame) {
        const labels = labelsForProfile(this.cachedProfile);
        const reply = labels.showIntentReply;
        const uid = randomId();
        const aid = randomId();
        responseStarted(uid);
        void this.post({ type: "streamStart", streamId: uid, messageId: aid, userMessageId: userId });
        void this.post({ type: "streamChunk", streamId: uid, delta: reply });
        await this.appendHistory([
          userLine(text),
          {
            id: aid,
            role: "assistant",
            content: reply,
            createdAt: Date.now(),
            // #747 — an answer the app itself wrote is also labelled with the coach's
            // name on screen. It is stamped here too so it is not dragged along when
            // the name changes later.
            assistantName: this.coachDisplayName(),
          },
        ]);
        deferCompletion(uid);
        void this.revealBuilt(lastGame, { artifactSource: "existing" });
        return;
      }
      // No game yet → fall through to the AI, which will guide them to make one.
    }

    // 2026-10-15 — "프로젝트 변경" opens the project list (switchProject) instead of a coach turn:
    // the switch commits, pulls and reopens folders, which is the app's job, not the coach's.
    if (mode === 'auto' && !carriesAnnotations && isProjectSwitchRequest(text) && (!images || images.length === 0) && this.sitePublisher().available()) {
      await this.appendHistory([userLine(text)]);
      await this.postAppReply("GitHub에 있는 프로젝트 목록을 열게요. 위에 뜨는 목록에서 이어서 작업할 프로젝트를 골라 주세요.", deferCompletion, responseStarted);
      // After this send settles: switchProject refuses while a send is pending (idle()).
      setTimeout(() => void this.switchProject(), 0);
      return;
    }

    // 2026-08-19 — "다른 친구도 있어?" is answered instantly from the profile's
    // worlds. This used to spend one LLM turn (10–40 s) — the app already holds the
    // list.
    if (mode === 'auto' && !carriesAnnotations && isGuestListRequest(text) && (!images || images.length === 0)) {
      const ws = this.cachedProfile?.worlds;
      if (ws?.length) {
        const shown = (this.cachedProfile?.ux?.suggestions?.initial ?? []).map((c) => c.text);
        const reply = guestListMessage(ws, shown);
        const uid = randomId();
        const aid = randomId();
        responseStarted(uid);
        void this.post({ type: "streamStart", streamId: uid, messageId: aid, userMessageId: userId });
        void this.post({ type: "streamChunk", streamId: uid, delta: reply });
        await this.appendHistory([
          userLine(text),
          {
            id: aid,
            role: "assistant",
            content: reply,
            createdAt: Date.now(),
            assistantName: this.coachDisplayName(),
          },
        ]);
        deferCompletion(uid);
        return;
      }
    }


    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    const proxyUrl = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    let model = cfg.get<string>("model", "hypeproof-default");
    const token = await this.context.secrets.get(TOKEN_KEY);
    const coach = this.getCoach();
    // Fixed-naming cohorts must NOT inject a user-supplied coach name carried
    // over from a different cohort's user-data-dir into the LLM context (#140).
    const resolvedProfile = await this.ensureProfile();
    await this.loadAccess();
    const fundingSource=this.accessState?.selected;
    const chosenAccess=this.accessState?.view?.choices.find(c=>c.id===fundingSource);
    // REQ-STUDIO-FOLDER-CONSENT — a personal activity in a folder that is not its own asks once; the choice only narrows.
    const profile=resolvedProfile?await folderConsentProfile(this.context,accessProfile(resolvedProfile,chosenAccess),{servedRoot:this.servedWorkspaceRoot,instructor:this._instructorMode.isInstructor===true}):null;
    // #751 U3 — captured ONCE for this turn: every request of the turn names the binding the turn started under.
    const bindingKey = profile?.lesson_binding?.enforced ? profile.lesson_binding.key : undefined;
    // #751 G2 — the step and help choice for THIS turn, from the focus at turn start against the turn's own lesson.
    const turnFocus = turnLesson(profile?.lesson, this.lessonFocus);
    const selection = availableModelSelection(profile, cfg.get<'proxy' | 'agent-sdk'>('coachRuntime', 'proxy'));
    const runtime: 'proxy' | 'agent-sdk' = selection?.source === 'lesson' ? selection.runtime : resolveCoachRuntime({
      settingRuntime: cfg.get<'proxy' | 'agent-sdk'>('coachRuntime', 'proxy'), profileRuntime: profile?.coach_runtime, minorCohort: profile?.minor_cohort,
    });
    const toolSeat = { profile, runtime, local: !!localRuntimeConfig(vscode.env.appName, proxyUrl), instructor: this._instructorMode.isInstructor === true };
    const toolDenial = mode === 'web-search' ? turnToolsDenialSource(toolSeat) : undefined;
    if (toolDenial) await this.postDenialNotice(toolDenial);
    requireTurnTools(mode, turnToolsAvailability(toolSeat));
    const savedModel = this.context.workspaceState.get<SavedModelChoice>('hps.modelChoice');
    if (profile && selection) model = selectedModel(profile, selection, savedModel, model);
    const effort = profile && selection ? selectedEffort(profile,selection,model,this.context.workspaceState.get<SavedEffortChoice>('hps.effortChoice'))?.value : undefined;
    const { name: effectiveCoachName, personality: effectiveCoachPersonality } =
      resolveCoach(coach, profile);

    // #278 — consume any queued browser-page context for THIS turn only. The
    // user message stored in history keeps their clean text; only the model
    // sees the prepended page context.
    // kids-quest — fold the latest round from the native preview tab (if any).
    await this.pullQuestResultFromPreview();
    const annotations = await this.takeAnnotationBatch(retrySourceId, annotationRevision, annotationScope, annotationCount);
    this.rememberAnnotationTurn(userId, annotations);
    const pageContext = this.pendingPageContext;
    this.pendingPageContext = null;
    // A page attached while this send was between its awaits is consumed now: clear its chip too.
    this.dropPageAttachment();
    // #308 — the notice describes the queued context; once consumed, stop
    // resurrecting it on webview remounts (webview clears its copy on userSent).
    this.pendingPageNotice = null;
    // CR-09 — the picked element goes with this turn only, and only while the switch is on.
    this.finishAnnotationSend(annotations);
    const element = this.elementQueue.take(this.isCurriculumRuntimeEnabled());
    // CGP-CHAT-R-011 — the attached file rides in front of the learner's text, model-only, as quoted data.
    // It is taken only here, where the model turn starts: a send turned away earlier leaves the chip
    // (host-owned; the webview never clears it on its own) and the file pending.
    const fileContext = carryFile ? this.takeFileAttachment() : null;
    const withFile = fileContext && fileAttachAllowed(profile, this._instructorMode.isInstructor === true) ? `${fileContext}\n\n${text}` : text;
    if (withFile !== text) (this.fileTurnIds ??= new Set()).add(userId);
    // A retry of a turn that carried a file does not resend it; say so instead of implying it did.
    if (!carryFile && retrySourceId !== undefined && this.fileTurnIds?.has(retrySourceId)) {
      void this.post({ type: "fileAttachment", attachment: this.pendingFileAttachment?.preview ?? null, notice: FILE_RETRY_NOTICE });
    }
    // CGP-KNOW-R-003 — the 자료 items the learner selected for this message, read in the preflight; nothing
    // else from the list. The gate is checked again on this turn's narrowed profile. A retry takes none.
    const materialContext = carryFile ? await this.takeMaterials(preparedMaterials, fileAttachAllowed(profile, this._instructorMode.isInstructor === true)) : null;
    const withMaterials = materialContext ? `${materialContext}\n\n${withFile}` : withFile;
    if (materialContext) (this.materialTurnIds ??= new Set()).add(userId);
    if (!carryFile && retrySourceId !== undefined && this.materialTurnIds?.has(retrySourceId)) void this.postMaterials({ notice: MATERIALS_COPY.retryNotice });
    let userTextForModel = withElementText(pageContext ? `${pageContext}\n\n${withMaterials}` : withMaterials, element);
    // CGP-ART-R-001 — one envelope for the whole batch in front of the learner's text (quoted data).
    userTextForModel = withAnnotations(userTextForModel, undefined, annotations).text;
    // cr-verify — a test run or fix request rides with the student's own sentence, model-only, while the switch is on.
    const verifyContextText = this.verifySession.takeCoachContext();
    if (verifyContextText && this.isCurriculumRuntimeEnabled()) userTextForModel = `${verifyContextText}\n\n${userTextForModel}`;
    // 2026-10-15 — the first turn in a folder "프로젝트 변경" opened reads that project's agent.md first.
    const switchBrief = await this.takeProjectSwitchBrief();
    if (switchBrief) userTextForModel = `${switchBrief}\n\n${userTextForModel}`;
    // #751 G2 — what the learner saved on this step's work surface travels with the turn (their words, labelled).
    if (profile?.lesson && turnFocus.step) {
      const step = profile.lesson.content.steps.find((x) => x.id === turnFocus.step);
      const saved = workContext(step?.title ?? turnFocus.step, this.lessonWorkFor(profile.lesson.sha256)[turnFocus.step]);
      if (saved) userTextForModel = `${saved}\n\n${userTextForModel}`;
    }
    // 2026-08-19 — pre-built guest worlds. When a child picks a guest they are not
    // made to wait 30–40 s for the coach to produce 5 KB: the filled-in HTML is
    // fetched from the worker, saved and shown immediately, and the coach is told
    // "it is already up — just the opening line".
    let openedWorldThisTurn = false;
    {
      const world = matchWorldRef(text, profile?.worlds);
      if (world && token) {
        this.lastArchivedWorldFile = null; // only tell the coach about an archive made this turn

        const shown = await this.revealPrebuiltWorld(world.id, proxyUrl, token);
        if (shown) {
          openedWorldThisTurn = true;
          // 2026-08-20 review — archived copies ('이전 세상/…') are hidden from the
          // coach's file listing (to stop "another world" contamination, #644), so even
          // when the child said "give me 초코's from before back" the coach did not
          // know the path. That one line is given only when an archive actually
          // happened this turn — a rollback request can then Read that file and
          // restore it into index.html.
          const archived = this.lastArchivedWorldFile
            ? `직전에 고치던 세상은 '${WORLD_ARCHIVE_DIR}/${this.lastArchivedWorldFile}' 로 보관해 뒀다 — ` +
              `아이가 되돌려 달라고 하면 그 파일을 Read 해서 index.html 에 되살려라. `
            : "";
          userTextForModel =
            `[Studio 안내: 아이가 ${world.emoji} ${world.guest} 세상을 골랐고, Studio 가 그 세상(문제 상태 기본값)을 ` +
            `이미 작업 폴더 index.html 에 저장하고 오른쪽 화면에 띄웠다. ${archived}코드나 파일 도구 없이 — ` +
            `${world.guest}의 첫 대사 한 줄과 "한번 해보세요" 만 짧게 말해라. 이후 바꾸기 요청부터 index.html 을 Read 하고 고쳐라.]\n\n${userTextForModel}`;
        }
      }
    }
    // #644 (2026-08-20, real device) — clearing the conversation empties only the
    // coach's memory; the world on the right-hand screen stays up. In that state, when
    // a child said "water instead of fire" the coach did not know which world it was
    // and either asked back or made a new file. Only on the first send after a clear,
    // one line about the open world is laid in front of the model input to refill that
    // memory — it is not attached to the child's bubble (the history stores the
    // original `text`). When a world was opened this turn it is skipped, because the
    // notice above already says the same thing.
    if (!openedWorldThisTurn && history.length === 0 && this.lastPrebuiltWorld) {
      const open = profile?.worlds?.find((w) => w.id === this.lastPrebuiltWorld);
      const notice = openWorldNotice(open);
      if (notice) userTextForModel = `${notice}\n\n${userTextForModel}`;
    }
    // Learning wiki: on the first coach turn of a conversation (calls of the wiki by name, answered by
    // the App, do not count), the team's summary (and, from the cohort's plan, the next session's
    // question and deck focus) is laid in front of the model input, not the student's bubble, so the
    // coach can open with the last session's test. On an empty conversation, even with an empty wiki,
    // the coach is also told to mention the wiki by name once, so students know they can call it.
    if (this.isLearningWikiEnabled()) {
      const plan = this.learningWikiPlan();
      if (firstCoachTurn(history, brainName(plan), sessionLabel(plan))) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const wiki = root ? loadState(wikiDir(root, plan)) : null;
        const lead = [wiki?.sessions.length ? coachContext(wiki, plan) : "", history.length === 0 ? brainIntro(plan) : ""].filter(Boolean).join("\n\n");
        if (lead) userTextForModel = `${lead}\n\n${userTextForModel}`;
      }
    }
    // #278 Phase 2 — fold any queued page screenshot into this turn's images.
    // CR-09 — a picked element's crop joins the queued page screenshot; neither replaces the other.
    const pageImage = this.pendingPageImage;
    this.pendingPageImage = null;
    let effectiveImages = turnImages(images, pageImage, element);
    // CGP-ART-R-001 — and one crop per annotation after the turn's other images.
    effectiveImages = withAnnotations('', effectiveImages, annotations).images;

    // #580 — streamId becomes the spool's turn_id, and the later spool-then-forward
    // has to be able to resend it to the worker's trace. The worker validates turn_id
    // strictly as a UUID (routes/trace.ts), so a UUID is used instead of randomId().
    const streamId = crypto.randomUUID();
    // A5 (spec §5.2) — an orchestrator seat reads the per-request record too, whatever its effort
    // policy: the details list is where each request's agent and model are shown.
    if (token && profile && (selection?.choices.some(c=>c.effort) || orchestratorRosterFor(profile))) {
      this.effortTurn = {id:streamId,url:proxyUrl,token,scope:modelSelectionScope(profile)};
      this.effortResult = {state:'loading',requests:[]};
      void this.postConfig();
    }
    const observation = await this.prepareObservation(proxyUrl, token, profile);
    // cr-verify — the coach's verify calls in this turn write to this turn's recorder.
    this.verifyTurnRecorder = observation?.batch.format === 'hps-observation/2' ? observation : null;
    const recordObservation = (kind: import('./nativeObservationContract').ObservationKind, value: string, extra: Partial<import('./nativeObservationContract').ObservationEvent> = {}) => {
      if (!observation) return;
      try { observation.record(streamId,kind,value,extra);this.persistObservation(observation); }
      catch { observation.batch.incomplete=true;this.persistObservation(observation);this.nativeObservationError='관찰 기록이 불완전합니다. 이 기록으로 수행 능력을 판단하지 않습니다.'; }
    };
    recordObservation('user',text);
    const observationFiles = new Map<string,string>();
    const observationCaptures: Promise<void>[] = [];
    // CR-10 — the element capture is a browser result bound to its artifact version; its
    // bytes are stored first, and the turn's end waits for it (observationCaptures).
    // Bytes are stored only when a recorder will write the event that names them.
    const turnBlobSink = roomGuardedSink(this.crBlobSinkFor(crBytesOwner(token)), observation ? (n) => observation.hasRoom(n) : undefined);
    if (element) observationCaptures.push(recordElementCapture(recordObservation, `pick-${crypto.randomUUID()}`, element, turnBlobSink));
    observationCaptures.push(...recordAnnotations(recordObservation, recordElementCapture, streamId, annotations, turnBlobSink));
    const messageId = randomId();
    const accuracyScope = this.turnRequestScope();
    const ctrl = new AbortController();
    this.activeStreams.set(streamId, ctrl);
    this.finishNotifier.release(); // a new turn is sent from the chat: the learner has seen it

    responseStarted(streamId);
    void this.post({ type: "streamStart", streamId, messageId, userMessageId: userId });
    this.rememberAnswerTurn(messageId, streamId);
    // #503 — this turn's single timeline. It runs the same reducer as the webview, so
    // the history keeps exactly the on-screen order.
    this.turnTimelines.set(streamId, timelineStart(emptyTimeline(), messageId, Date.now()));

    // #421 — leave a pasted image in the work folder as a file, and lay its path onto
    // this turn's model input. Without saving it the coach has nothing to point
    // `<img src>` at, and it hands the job back to the participant with "could you
    // save it as a file?" (2026-07-24, a live class).
    //
    // Only `images` is saved — `pageImage` (#278 "이 페이지를 코치에게") is a browser
    // capture, not material the participant attached in order to keep it, and saving
    // it would fill the work folder with files the participant never asked for.
    const savedImages = {note:preparedAttachments.pastedPaths.length ? pastedImageNote(preparedAttachments.pastedPaths, this.resolveCoachCwd()!) : "",relPaths:preparedAttachments.pastedPaths};
    if (savedImages.note) userTextForModel = `${userTextForModel}\n\n${savedImages.note}`;
    // D-028 — photos attached as files move into images/ now, and the message carries their
    // paths. The same lines go into the saved history, so later turns can still name them.
    const attachedNote = attachedImagesNote(preparedAttachments.relPaths);
    for (const id of preparedAttachments.stageIds) this.imageStaging?.discard(id);
    if (attachedNote) void this.post({ type:"attachedImagesSaved",note:attachedNote });
    if (attachedNote) userTextForModel = `${userTextForModel}\n\n${attachedNote}`;
    this.recordLearnerUploads(savedImages.relPaths ?? [], attachedNote);
    const historyText = [text, savedImages.note, attachedNote].filter(Boolean).join("\n\n");
    const requestSnapshot = this.turnRequests.get(userId);
    if (requestSnapshot) requestSnapshot.message.content = historyText;
    // File attachments carry bytes on their first turn. A later explicit reference
    // re-reads this activity's files, so edits/deletions never resurrect old pixels.
    const currentPaths = imagePathsFromNotes(attachedNote);
    const priorReference = currentPaths.length || images?.length
      ? { requested: false, paths: [] as string[] }
      : selectReferencedImagePaths(text, history);
    const referencePaths = [...currentPaths, ...priorReference.paths];
    const referenceRoot = this.resolveCoachCwd();
    const referenceRead = referenceRoot
      ? readWorkspaceReferenceImages({ cwd: referenceRoot, paths: referencePaths, allowed: profile?.input?.image_paste === true })
      : { images: [], assets: [], failures: referencePaths.map(p => ({ path: p, reason: "작업 폴더를 먼저 열어 주세요." })) };
    if (referenceRead.images.length) effectiveImages = [...(effectiveImages ?? []), ...referenceRead.images];
    if (referenceRead.assets.length) {
      userTextForModel += `\n\n[이번 요청에서 실제 읽은 참고 이미지]\n${referenceRead.assets.map(a => `${a.path} · ${a.mime} · sha256:${a.sha256}`).join("\n")}`;
    }
    const referenceFailure = referenceImageFailuresNote(referenceRead.failures, priorReference.requested && !priorReference.paths.length);
    if (referenceFailure) {
      userTextForModel += `\n\n${referenceFailure}`;
      this.postToolLog(streamId, { id: randomId(), icon: "⚠️", label: referenceFailure, state: "error" });
    }

    const generalBrowserRequest = isGeneralBrowserOpenRequest(text);
    let assistantText = "";
    // REQ-D2: auto-reveal as soon as a renderable HTML block completes in
    // the stream, NOT waiting for streamEnd. The block closes (```) often
    // arrives many seconds before the assistant's trailing prose. Showing
    // the game in that window is the strongest Taste "감탄" moment.
    let revealed = false;
    // #364 (Jay review) — the LAST html we attempted to reveal. On a blocked
    // reveal we reset `revealed` so a corrected block can retry, but without
    // this every subsequent delta re-extracts the SAME still-broken html and
    // re-surfaces a fresh toolLog warning (new randomId each chunk → warning
    // spam, no UI dedup). Retry ONLY when the extracted html actually changed.
    let lastAttemptedHtml = "";
    // REQ-STUDIO-ARTIFACT-PROVENANCE — reveal writes still in flight; the post-turn scan waits for them.
    const pendingReveals: Promise<unknown>[] = [];
    const tryReveal = (text: string) => {
      if (generalBrowserRequest || revealed) return;
      const html = extractRenderableHtml(text);
      if (!html) return;
      if (html === lastAttemptedHtml) return; // unchanged → don't re-warn
      lastAttemptedHtml = html;
      revealed = true; // optimistic — stop later chunks from re-revealing
      pendingReveals.push(this.revealBuilt(html, { streamId, artifactSource: "assistant_response" }).then((ok) => {
        // #359 — a blocked (still-broken after repair) build didn't ship;
        // let a later, CORRECTED (different) HTML block in the same stream try.
        if (!ok) revealed = false;
      }).catch(() => undefined));
    };
    // #173 — accumulate citations across the stream so they persist to history.
    const assistantCitations: import("./protocol").Citation[] = [];
    const webActivity = new WebSearchActivity();
    // Freeze the visible conversation at cancellation. Runtime callbacks may settle
    // later; neither those bytes nor a later task belong to this interrupted turn.
    let interruptedItems: ChatMessage[] | undefined;
    let failedPartial = false;
    let runtimeSettled = false;
    const captureInterrupted = () => {
      interruptedItems = this.finishTurnItems(streamId, messageId, assistantText, assistantCitations, effectiveCoachName);
    };
    if (ctrl.signal.aborted) captureInterrupted();
    else ctrl.signal.addEventListener('abort', captureInterrupted, { once: true });

    // #580 — this turn's spool recording state. spoolRuntime is the runtime that
    // **actually ran**, reflecting an SDK→proxy fallback — quantifying the cause of a
    // turn with no usage requires the recorded runtime to match reality (no silent
    // caps).
    let spoolRuntime: "proxy" | "agent-sdk" | null = null;
    let spoolStatus: "ok" | "error" = "ok";
    let spoolErrorKind: string | undefined;
    // Why a holder: TS's CFA cannot see the reassignment inside the callback, so a
    // plain let is narrowed to null by the time finally runs.
    let opsSdkFallback = false;
    let opsFailure: { status?: number; code?: string; requestId?: string } = {};
    const sdkTurnTotal: {
      current: { usage: Record<string, unknown>; totalCostUsd: number | null } | null;
    } = { current: null };
    // AE-15 / CGP-ART-R-002 — the work folder as it was before this turn; the review bar compares against it.
    const turnRestorePoint = await this.beginTurnRestore(streamId);
    // REQ-STUDIO-DELEGATION-ROW — rows this turn left open are closed at its end (stop excepted).
    let delegations: DelegationTracker | null = null;
    const closeDelegations = (reason: string) => {
      for (const r of delegations?.takeOpen() ?? []) {
        this.postToolLog(streamId, { id: r.lineId, icon: DELEGATION_ICON, label: delegationResultLabel(r.header, undefined, { isError: true, reason }), state: "error" });
      }
    };
    try {
      if (effectiveImages?.length && profile?.input?.image_paste !== true) {
        throw new Error("이 활동은 이미지 분석을 허용하지 않아요.");
      }
      const instructionRoot = this.resolveCoachCwd();
      if (instructionRoot) {
        // The same user-turn content reaches SDK and proxy. Server-owned system
        // prompts, tool grants and curriculum metadata remain authoritative.
        const selected = await selectedExternalInstructions(this.context, instructionRoot);
        userTextForModel += await selectedImageEditContext(this.context, instructionRoot, text);
        if (selected.text) {
          userTextForModel += `\n\n${selected.text}`;
          this.postToolLog(streamId, { id: randomId(), icon: "📖", label: selected.provenance.map(s => `${s.name} · ${s.revision.slice(0, 12)}`).join(" · "), state: "done" });
        }
      }
      // #282 Phase 1 — route to the Agent SDK coach behind the flag. Default
      // "proxy" keeps the exact existing single-turn behavior; "agent-sdk"
      // runs runSdkCoach with the SAME callbacks so nothing downstream changes.
      // #371 — the cohort profile can request "agent-sdk" (worker already
      // force-pinned minors to "proxy"), OR the machine-scoped setting can
      // select it. Either opts in; the SDK path still gates every tool via
      // canUseTool and strips minor tools. Belt-and-suspenders: never honor a
      // profile agent-sdk request for a minor_cohort, even if the worker
      // somehow sent one.
      // The decision is owned by resolveCoachRuntime (chatPanelHelpers) — it was
      // pulled out as a pure function while fixing the asymmetry where the minor check
      // was missing from the setting path alone. Unit test, with controls:
      // test/coach-runtime.smoke.mjs
      // #580 — record the raw question plus the runtime this turn is headed for into
      // the spool. The identity comes from the token payload (u·c·p); with no token it
      // is recorded without an identity (the call below fails anyway and lands as
      // turn_end(status:error)).
      spoolRuntime = runtime;
      this.spool?.noteIdentity(spoolIdentityFromToken(token));
      this.spool?.recordPrompt({
        turnId: streamId,
        runtime,
        text,
        imagesCount: effectiveImages?.length ?? 0,
        model, // #1298 — record which model this turn ran on
        ...(instructorPromptRefs?.length ? { instructorPromptRefs } : {}),
      });
      const onRefusal = modelRefusalNotifier(ctrl.signal, () => runtimeSettled, () => {
        void this.post({ type: "streamRefusal", streamId });
      });
      const onDelta = (delta: string) => {
        if (ctrl.signal.aborted || runtimeSettled) return;
        if (pendingShown) clearPending();
        assistantText += delta;
        const t = this.turnTimelines.get(streamId);
        if (t) this.turnTimelines.set(streamId, timelineDelta(t, delta, Date.now()));
        void this.post({ type: "streamChunk", streamId, delta });
        // Cheap check; extractRenderableHtml regex returns null fast on
        // most chunks (no fence/doctype present yet).
        tryReveal(assistantText);
      };
      const onCitations = (cites: import("./protocol").Citation[]) => {
        if (ctrl.signal.aborted || runtimeSettled) return;
        for (const c of cites) assistantCitations.push(c);
        void this.post({ type: "streamCitations", streamId, citations: cites });
      };
      // SX-59 / SX-43 — no capability score, grade or badge appears on the working
      // screen. The worker still sends the `asset_score` SSE chunk so the parser has
      // to keep reading it, but the host **throws it away.** The status-bar sink
      // (`assetStatusBar.ts`) and the webview message (`streamAssetScore`) disappeared
      // in this commit.
      // Stopping the chunk itself is a separate Service change (design §디자인 시스템).
      // Why the callback is left as a no-op instead of removed: it is required by
      // `sdkCoach.ts`'s option type, and the `sdk-surface-drift` smoke locks that
      // surface.
      const onAssetScore = (_assetScore: import("./protocol").AssetScoreChunk) => {};
      // #414 — the SDK coach's real work, rendered through the same toolLog
      // lines the browser loop already uses. Deliberately NOT translated: the
      // model thinks in English and the tool names are the SDK's own, and a
      // Korean paraphrase of "Write(index.html)" would be a worse signal than
      // the thing itself. Shape follows Claude Code — one truncated line per
      // action (the CSS ellipsizes), plus a live token counter while thinking.
      let thinkingIndex = 0;
      // The webview replaces an entry wholesale by id, so a tool_result has to
      // re-send the label the tool_use showed — keep it per stream.
      const toolLabels = new Map<string, string>();
      const toolLineIds = new Map<string, string>();
      // .html paths Written/Edited during an SDK turn (tool_use id → absolute path) — previewed when the tool_result succeeds.
      const htmlWrites = new Map<string, string>();
      const funnelTools = new Map<string, ToolResultKind>();
      // The "building the next action" notice line (the silent stretch between a tool
      // result and the next call).
      let pendingShown = false;
      const PENDING_ID = `pending-${streamId}`;
      // D-027 — a "summary" cohort gets one Korean line per stretch of work in place of a line
      // per tool call (toolActivity.ts). The pending line below becomes that line.
      const work = toolActivityMode(profile) === "summary"
        ? new WorkLine(PENDING_ID, (entry) => this.postToolLog(streamId, entry))
        : null;
      // REQ-STUDIO-DELEGATION-ROW — a Task/Agent call draws one row bound to this stream; its
      // helper's calls group under it. A summary cohort (D-027) gets no row: its line stays as is.
      const tracker = new DelegationTracker(streamId, { rows: !work });
      // REQ-STUDIO-LONG-STEP-HINT — when each detailed tool line's clock starts (at its approval).
      const stepLines = new StepLines();
      const deniedCalls = new Map<string, DenialNotice>();
      delegations = tracker;
      // Between a tool result and the next tool call the stream is completely silent
      // (a call only arrives once complete, in one lump). On a real device that stretch
      // was 3 minutes and the last line was `Read ✓`, so children and adults alike
      // misread it as "still reading". That stretch is filled with one live line.
      const showPending = () => {
        if (work) {
          pendingShown = true;
          work.show(NEXT_STEP_PHRASE);
          return;
        }
        if (pendingShown) return;
        pendingShown = true;
        this.postToolLog(streamId, { id: PENDING_ID, icon: "…", label: "다음 단계를 준비하는 중…", state: "running" });
      };
      // Has a write tool **succeeded** during this turn? It is the only evidence for
      // writing "고쳤어요" when the notice line closes — without it, it becomes a lie
      // told to the child (R0).
      let wroteOk = false;
      const writeToolIds = new Set<string>();
      const clearPending = () => {
        if (!pendingShown) return;
        pendingShown = false;
        if (work) {
          work.close(pendingCloseLabel(wroteOk));
          return;
        }
        this.postToolLog(streamId, {
          id: PENDING_ID,
          icon: "✍️",
          label: pendingCloseLabel(wroteOk),
          state: "done",
        });
      };
      // CR-10 — SDK tool ids of the delegated browser tools whose results carry an observation.
      this.crSdkResults.reset(turnBlobSink);
      this.mcpBrowser?.crNewTurn();
      const onActivity = (a: import("./sdkCoachHelpers").SdkActivity) => {
        webActivity.observe(a);
        // studio-funnel-events — first write/edit/preview/publish result (kind + ok only).
        if (a.kind==='tool_use') { const k = funnelToolKind(a.name); if (k) funnelTools.set(a.id, k); }
        if (a.kind==='tool_result' && funnelTools.has(a.id)) { this.funnel.emit({ type: "trial_tool_result", kind: funnelTools.get(a.id), ok: !a.isError }); funnelTools.delete(a.id); }
        if (a.kind==='tool_use') this.crSdkResults.onToolUse(a.id, a.name, this.isCurriculumRuntimeEnabled());
        if (observation && (a.kind==='tool_use' || a.kind==='approval')) {
          try { observation.toolRequest(streamId,a.id,`${a.name}(${summarizeToolInput(a.name,a.input,300,this.resolveCoachCwd())})`); this.persistObservation(observation); }
          catch { observation.batch.incomplete=true;this.persistObservation(observation);this.nativeObservationError='도구 요청 기록이 불완전합니다.'; }
          const file=(a.input as {file_path?:unknown})?.file_path;
          if (['Write','Edit','MultiEdit'].includes(a.name) && typeof file==='string') {
            const absolute=path.resolve(this.resolveCoachCwd()??'',file);
            if (isInsideWorkspace(absolute)) observationFiles.set(a.id,absolute);
          }
        }
        if (a.kind==='approval') recordObservation('approval',a.actor==='user'?'사용자가 승인 창에서 선택했습니다.':'런타임 정책이 처리했습니다.',{tool_id:a.id,actor:a.actor,outcome:a.allowed?'allowed':'denied'});
        if (a.kind==='tool_result') {
          const recordDefault = () => recordObservation('tool_result',a.isError?(a.reason??'도구 실패'):(toolLabels.get(a.id)??'도구 실행 완료'),{tool_id:a.id,outcome:a.isError?'error':'success'});
          const crResult = this.crSdkResults.onToolResult(a.id, a.isError);
          if (crResult) observationCaptures.push(crResult.then((r) => recordObservation('tool_result', r.text, { ...r.refs, tool_id: a.id, outcome: 'success' }), recordDefault));
          else recordDefault();
        }
        if (a.kind==='tool_result' && !a.isError && observationFiles.has(a.id)) {
          const file=observationFiles.get(a.id)!;
          observationCaptures.push((async()=>{
            try {
              if(!vscode.workspace.workspaceFolders?.length||!isInsideWorkspace(file))throw Error('artifact_outside_workspace');
              const stat=await fs.promises.stat(file);
              if(stat.size>20000) {if(observation){observation.batch.incomplete=true;this.persistObservation(observation);}this.nativeObservationError='큰 파일은 관찰 사본에서 제외했습니다.';return;}
              const bytes=await fs.promises.readFile(file);
              recordObservation('artifact',path.basename(file)+'\n'+bytes.toString('utf8'),{sha256:createHash('sha256').update(bytes).digest('hex')});
            }catch {if(observation){observation.batch.incomplete=true;this.persistObservation(observation);}this.nativeObservationError='산출물 사본을 확인하지 못했습니다.';}
          })());
        }
        const log = (id: string, icon: string, label: string, state: "running" | "done" | "error") =>
          // #503 — a.at: the SDK's own timestamp as it sent it. It becomes the persisted line's createdAt.
          this.postToolLog(streamId, { id, icon, label, state, ...(a.at ? { at: a.at } : {}) });
        switch (a.kind) {
          case "thinking_tokens":
            if (work) {
              pendingShown = true;
              work.show(THINKING_PHRASE);
              break;
            }
            // One entry that ticks in place; the completed block replaces it.
            log(`think-${thinkingIndex}`, "💭", `응답 준비 중 · ${a.tokens} 토큰`, "running");
            break;
          case "thinking":
            // D-027 — a summary cohort sees that the coach is thinking, not what it thinks.
            if (work) {
              pendingShown = true;
              work.show(THINKING_PHRASE);
              break;
            }
            // 2026-08-20 — thinking is also "doing something". A child's inner
            // thoughts are hidden (below), so without this line the screen goes
            // completely quiet — 3 minutes of silence after Read ✓ on a real device.
            showPending();
            // 2026-08-19 — a child cohort is not shown the coach's inner thoughts (the
            // English original) as they are. "The user wants me to display the HTML
            // file…" came up verbatim on a child's screen (real device, the guest
            // worlds). The adult track (#414) is unchanged.
            if (profile?.minor_cohort === true) break;
            log(`think-${thinkingIndex}`, "💭", a.text, "done");
            thinkingIndex += 1;
            break;
          case "tool_use": {
            // Pass the workspace root so the path is shown relative to it. Leaving
            // only the filename makes "normal · relative path refused · outside the
            // workspace" all read as the same characters.
            const line = tracker.lineFor(a);
            toolLineIds.set(a.id, line.lineId);
            // A helper's call lands inside its row, so the main flow's notice line stays as it is.
            if (!work && line.kind !== "child") clearPending();
            const label = `${a.name}(${summarizeToolInput(a.name, a.input, 60, this.resolveCoachCwd(), { urlHostOnly: true })})`;
            toolLabels.set(a.id, label);
            // 2026-08-19 — when the SDK coach saves a .html with Write/Edit, that
            // result has to appear on screen. Before, only the chat's ```html fence
            // opened the preview, so on a turn where the coach fixed the file with a
            // tool the screen did not change even as it said "다 됐어요", and the coach
            // drifted into "press ▶ Run / open 127.0.0.1:<port>" (2026-08-19, real
            // device, guest worlds T1). Remember which file is being written.
            {
              const inp = a.input as { file_path?: unknown } | undefined;
              const fp = typeof inp?.file_path === "string" ? inp.file_path : "";
              const isWrite = (WRITE_TOOL_NAMES as readonly string[]).includes(a.name);
              // Separately from the preview case (.html), the "고쳤어요" verdict counts
              // **every write tool** — editing engine.js or any other file is still
              // editing.
              if (isWrite) writeToolIds.add(a.id);
              if (isWrite && /\.html?$/i.test(fp)) {
                htmlWrites.set(a.id, fp);
              }
            }
            if (line.kind === "row") {
              const header = delegationHeader(a.input, this.resolveCoachCwd());
              tracker.setHeader(a.id, header);
              log(line.lineId, DELEGATION_ICON, header, "running");
              // REQ-STUDIO-LONG-STEP-HINT — no clock yet; it starts at the approval (case "approval").
              const started = stepLines.begin(a.id, { lineId: line.lineId, icon: DELEGATION_ICON, label: header, ...(a.at ? { at: a.at } : {}) }, workPhrase(a.name, a.input).label);
              if (started) this.postToolLog(streamId, started);
            } else if (work) {
              pendingShown = true;
              work.show(workPhrase(a.name, a.input));
            } else if (line.kind === "child") {
              // A helper's own call sits inside its row; the row is the step the hint times.
              log(line.lineId, "🔧", label, "running");
            } else {
              log(line.lineId, "🔧", label, "running");
              // The words come from the tool name (workPhrase), never from `label`.
              const started = stepLines.begin(a.id, { lineId: line.lineId, icon: "🔧", label, ...(a.at ? { at: a.at } : {}) }, workPhrase(a.name, a.input).label);
              if (started) this.postToolLog(streamId, started);
            }
            break;
          }
          case "approval": {
            // REQ-STUDIO-LONG-STEP-HINT — every call passes canUseTool, which reports here once the
            // learner (modal) or the policy decided. The step's clock starts now, so time spent on
            // the approve/deny modal ("승인 기다리는 중") is never counted as running time.
            if (!a.allowed) {
              stepLines.end(a.id);
              if (a.actor === 'policy') {
                const denial = denialNotice(a.denialSource, this.getSeatAudience() === 'classroom');
                deniedCalls.set(a.id, denial);
                tracker.settle(a.id);
                this.postToolLog(streamId, { id: toolLineIds.get(a.id) ?? a.id, icon: '🔒', label: '', state: 'error', denial });
              }
              break;
            }
            const startedAt = Date.now();
            if (work) {
              pendingShown = true;
              work.startStep(a.id, workPhrase(a.name, a.input), startedAt);
              break;
            }
            const started = stepLines.approved(a.id, startedAt);
            if (started) this.postToolLog(streamId, started);
            break;
          }
          case "tool_result": {
            stepLines.end(a.id);
            work?.endStep(a.id);
            const line = tracker.lineFor(a);
            // A denial is evidence even in summary mode. Runtime errors use unknown, never a guessed source.
            if (a.isError || deniedCalls.has(a.id)) {
              const denial = deniedCalls.get(a.id) ?? denialNotice(taggedDenialSource(a.reason), this.getSeatAudience() === 'classroom');
              deniedCalls.set(a.id, denial);
              tracker.settle(a.id);
              this.postToolLog(streamId, { id: line.lineId, icon: '🔒', label: '', state: 'error', denial });
              break;
            }
            // A backgrounded helper's result is the SDK's placeholder, never its answer: the row
            // stays open and the turn's end closes it as 실패 (NO_ANSWER_REASON).
            if (line.kind === "row") {
              if (!a.launched) {
                tracker.settle(a.id);
                log(
                  line.lineId,
                  DELEGATION_ICON,
                  delegationResultLabel(tracker.header(a.id), a.content, { isError: a.isError, reason: a.reason, workspaceRoot: this.resolveCoachCwd() }),
                  a.isError ? "error" : "done",
                );
              }
            }
            // A failure leaves a mark in the label — an icon alone disappears once the
            // scroll passes it. In real use a Write failure was missed and
            // "저장됐습니다" was believed as it stood (2026-07-26).
            // D-027 — a summary cohort gets no per-call line, failures included: the coach
            // retries on its own, and the turn's own text has to say what did not work (R0).
            else if (!work) log(
              line.lineId,
              "🔧",
              a.isError
                ? `${toolLabels.get(a.id) ?? ""} — 실패${a.reason ? `: ${a.reason}` : ""}`
                : (toolLabels.get(a.id) ?? ""),
              a.isError ? "error" : "done",
            );
            // Only a **successful** write tool establishes the evidence for "it was
            // fixed". On a failure, or when it was never a write in the first place,
            // the notice line closes with "생각했어요".
            if (!a.isError && writeToolIds.has(a.id)) wroteOk = true;
            // When a tool successfully wrote a .html, read that file and show it in
            // the preview (the same revealBuilt as the fence path — identical down to
            // the save, the live server and the native tab).
            if (work || line.kind !== "child") showPending();
            if (!a.isError && htmlWrites.has(a.id)) {
              const fp = htmlWrites.get(a.id)!;
              htmlWrites.delete(a.id);
              // 2026-08-19 — reopening the preview on every consecutive edit (5 Edits
              // before MultiEdit existed) stacks five "미리보기를 열었어요" lines and
              // reopens the live server just as many times. Open once, after the last
              // save (debounce).
              // Instructor mode uses live_preview_start + browser_open; skip
              // the student auto-preview when the instructor writes an HTML file.
              if (!generalBrowserRequest && !this._instructorMode.isInstructor) {
                if (this.revealTimer) clearTimeout(this.revealTimer);
                this.revealTimer = setTimeout(() => {
                  this.revealTimer = undefined;
                  void this.revealWrittenHtml(fp, streamId);
                }, 900);
              }
            }
            break;
          }
          case "compaction":
            // REQ-STUDIO-CONTEXT-TRIM-MARKER — earlier context was summarized in this turn. One line
            // per turn (the id is the turn's), drawn as a quiet note; summary cohorts get it too. As a
            // tool line it is kept in the timeline and modelHistory never sends it.
            this.postToolLog(streamId, { id: compactionLineId(streamId), icon: "", label: CONTEXT_COMPACT_NOTE, state: "done", ...(a.at ? { at: a.at } : {}) });
            break;
        }
      };
      // The non-SDK runtime: the agentic browser loop when the cohort opted
      // into browser_control (copyclone opens the reference URL / re-checks the
      // live preview), else the plain single-turn proxy. #371 — the SDK path's
      // SdkUnavailableError fallback MUST route here too; falling back to a bare
      // runProxy() drops the browser loop, so the coach only *narrates* "브라우저
      // 열게요" and never opens it (regression from the #380 SDK-runtime flip).
      // #897 H-13 — the context for comparing the model requested against the model
      // that answered. **Passing the source along is the point**: a model the student
      // picked themselves being changed and a lesson default or a legacy alias being
      // resolved on the server are different events, and warning about the latter too
      // means normal behaviour raises a warning every turn and buries the real
      // substitution. Both proxy paths (ordinary send, browser loop) use the same
      // value.
      const modelEcho: ModelEchoContext = {
        requestedAlias: model,
        source: !selection ? 'unknown'
          : profile && savedModel?.scope === modelSelectionScope(profile) ? 'explicit'
          : selection.source === 'lesson' ? 'course_default' : 'legacy_alias',
        choices: selection?.choices ?? [],
        seatProvider: selection?.provider ?? null,
      };
      const runProxyRuntime = async () => {
        if (profile?.browser_control?.enabled) {
          await this.runBrowserLoop({
            generalBrowserRequest,
            modelEcho,
            proxyUrl,
            model,
            effort,
            fundingSource,
            lessonBinding: bindingKey,
            lessonStep: turnFocus.step,
            helpMode: turnFocus.helpMode,

            token,
            history,
            userText: userTextForModel,
            images: effectiveImages,
            signal: ctrl.signal,
            streamId,
            coachName: effectiveCoachName,
            coachPersonality: effectiveCoachPersonality,
            onDelta,
            onRefusal,
            onCitations,
            recordObservation,
            blobSink: turnBlobSink,
            trackObservation: (q) => observationCaptures.push(q),
          });
        } else {
          await runProxy();
        }
      };
      const runProxy = () =>
        proxyChat({
          proxyUrl,
          model,
          effort,
          turnId: streamId,
            fundingSource,
          lessonBinding: bindingKey,
          lessonStep: turnFocus.step,
          helpMode: turnFocus.helpMode,

          token,
          history,
          userText: userTextForModel,
          images: effectiveImages,
          signal: ctrl.signal,
          coachName: effectiveCoachName,
          coachPersonality: effectiveCoachPersonality,
          audience: profileAudience(this.cachedProfile),
          // #507 — send the address of the live server that is up on every turn.
          // Omitted when there is none: the worker then says "it is not up yet + do
          // not guess the port" on our behalf.
          previewUrl: this.liveServer.currentUrl(),
          onDelta,
          onRefusal,
          onCitations,
          onAssetScore,
          // #580 — the usage of one request (the worker's hps_usage / the upstream
          // usage chunk).
          // #897 H-13 — when that usage's `model` differs from the request, say so to
          // the student. Passing the source along is the point: a model the student
          // **picked themselves** being changed and a lesson default or a legacy alias
          // being resolved on the server are different events, and warning about the
          // latter too means normal behaviour raises a warning every turn and buries
          // the real substitution.
          onUsage: this.proxyUsageRecorder(streamId, modelEcho, onDelta),
        });
      // #749 — a seat runs only one coach turn at a time. The lock has to be
      // **outside** the runtime: it started inside `runSdkCoach`, which left every
      // proxy cohort unprotected, and when the SDK dropped out with
      // `SdkUnavailableError` the lock was released first and then the fallback ran —
      // so **the duplicate turn it was meant to block ran on the other runtime**.
      // Taking it here puts both paths and the fallback inside one fence.
      //
      // The seat key is derived from the token and the profile (only a hash of the
      // token is used). With no token it is blocked below anyway, so the lock is left
      // best-effort.
      await withCoachSeatLock(coachSeatKeyFor({ token: token ?? undefined, profile: profile ?? undefined }), async () => {
      const local = localRuntimeConfig(vscode.env.appName, proxyUrl);
      if (local) {
        if (this._instructorMode.isInstructor === true) {
          // Instructor path — bypasses student token, ensureProfile, lesson gates, spool
          // (chalk-po condition 1). Uses INSTRUCTOR_TOOL_PROFILE (read + write + browser).
          const cwd=this.resolveCoachCwd();
          if(!cwd) throw new Error('개발 작업 폴더를 먼저 여세요.');
          // #1297 (E4-2): chalkToolsEnabled is a first-pass filter (button display).
          // #1295 (E2-6): cwd and requestConfirmation added for file I/O and overwrite confirm.
          const chalkCtx = (await chalkToolsEnabled(this.context.secrets))
            ? {
                serverUrl: proxyUrl,
                secrets: this.context.secrets,
                cwd,
                currentModel: local.model,
                requestConfirmation: async (message: string): Promise<boolean> => {
                  const answer = await vscode.window.showWarningMessage(
                    message, { modal: true }, "계속", "취소",
                  );
                  return answer === "계속";
                },
              }
            : undefined;
          // Browser tools for the local runtime: live_preview_start + browser_open.
          // Reuses INSTRUCTOR_TOOL_PROFILE.sdk_tools.browser to stay in sync with the policy.
          // Delegates to runBrowserOpen / runLivePreviewStart via the same BrowserMcpHost the
          // student SDK path uses (buildBrowserMcpHost). That gives the instructor the full
          // #507 port correction (livePreviewUrl), #415 duplicate suppression (openPages /
          // currentPage), and #526 slot-displaced notice. The host's crEnabled / crScope
          // are fine for the instructor: with CR off they are no-ops; with CR on the
          // instructor is subject to the same scope rules as a student.
          const browserTools: BrowserToolsForLocal | undefined =
            INSTRUCTOR_TOOL_PROFILE.sdk_tools?.browser
              ? (() => {
                  const host = this.buildBrowserMcpHost(text);
                  return {
                    definitions: [...INSTRUCTOR_LOCAL_BROWSER_DEFS],
                    call: async (name: string, input: unknown) => {
                      const r =
                        name === "live_preview_start"
                          ? await runLivePreviewStart(host)
                          : name === "browser_open"
                            ? await runBrowserOpen(host, input && typeof input === "object" ? (input as Record<string, unknown>).url : null)
                            : null;
                      if (!r) throw new Error(`알 수 없는 브라우저 도구: ${name}`);
                      // isError mirrors the workspace/chalk tool convention: throw so the
                      // local runtime marks the tool result as a failure.
                      const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
                      if (r.isError) throw new Error(text);
                      return text;
                    },
                  };
                })()
              : undefined;
          const result=await runInstructorTurn({
            local,cwd,
            history:history.map(m=>({role:m.role,content:m.content})),userText:userTextForModel,
            brief:this._instructorMode.brief,
            chalkCtx,
            browserTools,
            signal:ctrl.signal,onDelta,onRefusal,onActivity,
            requestApproval:async action=>{
              if (generalBrowserRequest) return {approved:false,actor:'policy' as const};
              let prompted=false;
              let denialSource: import("./denialSource").DenialSource | undefined;
              const approved=await this.resolveActionApprovalTracked({requestId:randomId(),...sdkToolToActionRequest(action)},()=>{prompted=true;},source=>{denialSource=source;});
              return {approved,actor:prompted?'user':'policy',denialSource};
            }});
          sdkTurnTotal.current={usage:{local_provider:local.provider,model:result.model,reported_usage:result.usage},totalCostUsd:null};
        } else {
          if (!profile) throw new Error(profileNotReadyNotice(this.coachDisplayName()));
          if (effectiveImages?.length) throw new Error('로컬 개발 연결의 이미지 입력은 아직 지원하지 않습니다. 텍스트로 요청하세요.');
          const cwd=this.resolveCoachCwd();
          if(!cwd) throw new Error('개발 작업 폴더를 먼저 여세요.');
          const chalkCtx = undefined; // student local path never has instructor chalkCtx
          const result=await runLocalCoach({config:local,profile,cwd,
            history:history.map(m=>({role:m.role,content:m.content})),userText:userTextForModel,
            signal:ctrl.signal,onDelta,onRefusal,onActivity,chalkCtx,
            requestApproval:async action=>{
              if (generalBrowserRequest) return {approved:false,actor:'policy' as const};
              let prompted=false;
              let denialSource: import("./denialSource").DenialSource | undefined;
              const approved=await this.resolveActionApprovalTracked({requestId:randomId(),...sdkToolToActionRequest(action)},()=>{prompted=true;},source=>{denialSource=source;});
              return {approved,actor:prompted?'user':'policy',denialSource};
            }});
          sdkTurnTotal.current={usage:{local_provider:local.provider,model:result.model,reported_usage:result.usage},totalCostUsd:null};
        }
      } else if (this._instructorMode.isInstructor === true) {
        throw new Error('강사 채팅은 지금 내 Claude 구독 연결에서만 됩니다.');
      } else if (runtime === "agent-sdk") {
        if (!profile) {
          throw new Error(profileNotReadyNotice(this.coachDisplayName()));
        }
        if (!token) {
          throw new ProxyAuthError("missing", TOKEN_MISSING_FRIENDLY);
        }
        // REQ-M46 — default off. With the setting on (or the Service advertising
        // it) and no binary, ask before this turn; a confirmed, verified download
        // lands in the seeded location and runSdkCoach then resolves it. Declined
        // or failed, the turn continues exactly as before.
        await this.maybeOfferSdkSeed(profile, cfg.get<string>("sdkBinaryPath", "") || undefined, ctrl.signal);
        try {
          const sdkEnd = await runSdkCoach({
            toolMode: mode,
            gatewayUrl: proxyUrl,
            effort,
            turnId: streamId,
            fundingSource,
            lessonBinding: bindingKey,
            lessonStep: turnFocus.step,
            helpMode: turnFocus.helpMode,

            token,
            model,
            profile,
            // #747 — failure copy inside the SDK run names the same AI as the
            // header and the approval modals.
            coachName: this.coachDisplayName(profile),
            // The worker gateway (POST /v1/messages, #316) DROPS the client
            // `system` field and injects the cohort profile blocks server-side
            // (REQ-M10) — the tuned Korean prompt + classroom key never leave
            // the worker, so there is nothing to send from here.
            systemPrompt: "",
            history: history.map((m) => ({ role: m.role, content: m.content })),
            userText: userTextForModel,
            images: effectiveImages,
            signal: ctrl.signal,
            // #457 — with no folder open, workspaceFolders is empty and cwd goes
            // through as undefined. withWorkspaceContext then returns the prompt
            // **unchanged** (no path injection), so the coach uses relative paths
            // without knowing where it is and every one of them fails. In real use on
            // 2026-07-26, 5 Reads failed in a row and the coach burned 13 of 20 turns
            // ransacking the whole home directory with `find ~` before the session died
            // on maxTurns.
            //
            // The profile already knows workspace_root, so that is the fallback. Only
            // when both sources are absent is it left undefined, and that case is
            // recorded loudly.
            cwd: this.resolveCoachCwd(),
            // #507 — the address of the live server that is up (omitted when there is
            // none). It is also reported through an MCP tool result, but it has to be
            // in the context at the start of the turn for the very first navigation to
            // be right.
            previewUrl: this.liveServer.currentUrl(),
            // #282 W4a — explicit claude-binary override (highest priority in
            // the REQ-M24 resolution order: setting > HPS_SDK_BINARY env >
            // seeded > node_modules). Empty string = unset.
            binaryPathSetting: cfg.get<string>("sdkBinaryPath", "") || undefined,
            // #403 — no-progress budget before the turn is aborted with a
            // visible retry message instead of an endless "생각하는 중…".
            stallTimeoutMs: cfg.get<number>("sdkStallTimeoutMs"),
            onDelta,
            onRefusal,
            onActivity,
            // #580 — SDK-path usage: the assistant message is the per-request unit
            // (one record even when a single API response arrives split across several
            // messages, via requestKey dedupe), and the result message is the turn
            // total (the control against the sum of the per-request records), carried
            // on turn_end.
            onUsage: (u) => {
              if (u.kind === "request") {
                this.spool?.recordUsage({
                  turnId: streamId,

                  source: "sdk",
                  requestKey: u.requestKey,
                  model: u.model,
                  inputTokens: u.usage.input_tokens,
                  outputTokens: u.usage.output_tokens,
                  cacheReadInputTokens: u.usage.cache_read_input_tokens,
                  cacheCreationInputTokens: u.usage.cache_creation_input_tokens,
                });
              } else {
                sdkTurnTotal.current = { usage: u.usage, totalCostUsd: u.totalCostUsd };
              }
            },
            onCitations,
            onAssetScore,
            // Map the SDK tool call → an accurate host ActionRequest so the
            // executeShell hard-deny and writeFile workspace-scope actually fire.
            requestApproval: async (action) => {
              let prompted = false;
              let denialSource: import('./denialSource').DenialSource | undefined;
              const approved = await this.resolveActionApprovalTracked({ requestId: randomId(), ...sdkToolToActionRequest(action) }, () => { prompted = true; }, source => { denialSource = source; });
              return {approved, actor: prompted ? 'user' as const : 'policy' as const, denialSource};
            },
            // #282 P2 slice 2 — native-browser capabilities for the hypeproof
            // MCP tools. Always passed; runSdkCoach registers the server only
            // when the profile grants sdk_tools.browser (minors never do).
            browserHost: this.buildBrowserMcpHost(text),
            // A5 (ADR 0011) — the front-line orchestrator host. Always passed, like browserHost:
            // runSdkCoach turns the orchestrator on only for a seat the served roster is on for (an
            // adult with a well-formed roster, A2's binding); otherwise the turn is today's, byte for
            // byte (test/orchestrator-switch.smoke.mjs). Its consult and check lines join this turn's
            // timeline; the learner's goal is read when a consult declares learner_goal.
            orchestrator: orchestratorHostArgs({
              session: this.orchestratorSessionFor(coachSeatKeyFor({ token, profile })),
              turnId: streamId,
              post: (entry) => this.postToolLog(streamId, entry),
              learnerGoal: () =>
                learnerGoalText(goalViewOf(profile.lesson, activityConnections(this.context)?.current?.id ?? null, this.context.workspaceState.get<unknown>(STUDENT_GOAL_KEY))),
            }),
            // REQ-STUDIO-TRIAL-BUSY — a native-trial seat's busy notice joins this turn's timeline
            // as the same ⏳ line an orchestrator notice draws (orchestratorToolEntry).
            onNotice: (text) => this.postToolLog(streamId, { id: `notice:${randomId()}`, icon: "⏳", label: text, state: "done", at: Date.now() }),
          });
          // #751 U4 — the SDK closed the stream normally but its result said the turn failed (the learner already read the
          // notice). Not thrown: the notice and the words stay in the conversation exactly as shown, nothing is re-sent. The
          // failure is recorded ONCE here so closeTurn, the ops observation, the spool and the observation log all say the same.
          const ended = sdkTurnEndFailure(sdkEnd);
          if (ended) { spoolStatus = "error"; spoolErrorKind = ended.errorKind; opsFailure = ended.failure; }
        } catch (err) {
          if (!(err instanceof SdkUnavailableError)) throw err;
          // REQ-M45 — an SDK-only seat (native trial, pass) or a picked pass is refused on the proxy
          // route by the Service, so it never falls back: every branch shows the same install notice
          // and the raw English reason goes to the developer log only. Classroom seats keep the
          // existing web-search / picked-model copy and the REQ-M7 fallback below.
          const outcome = sdkUnavailableOutcome({
            profile,
            fundingSource,
            webSearch: mode === 'web-search',
            modelPicked: !!selection && (selection.source === 'lesson' || (!!profile && savedModel?.scope === modelSelectionScope(profile))),
          });
          if (outcome.kind === 'fail') {
            this.postToolLog(streamId, { id: `denial:${randomId()}`, icon: '🔒', label: '', state: 'error', at: Date.now(), denial: denialNotice('runtime', this.getSeatAudience() === 'classroom') });
            if (outcome.requiredSdk) this.logSdkUnavailable(err.message);
            throw mode === 'web-search' && !outcome.requiredSdk ? new TurnToolModeError(outcome.error.message) : outcome.error;
          }
          // Pre-Phase-1: the SDK package isn't installed. Keep the classroom
          // working — fall back to the proxy runtime for this turn instead of
          // showing the student a technical error.
          //
          // #476 — the fallback itself is kept (no behaviour change) but made
          // **visible**. Before, one `console.warn` was all there was, and with no
          // output channel in the extension that line survived nowhere: the student,
          // the instructor, the developer and the coach itself all failed to notice
          // the capability had disappeared, and that misdiagnosis produced 3 issues
          // (#470 · #471 · #472).
          assistantText = "";
          assistantCitations.length = 0;
          revealed = false;
          // #503 — discarding the text discards the timeline with it. Otherwise only
          // the tool lines stamped before the fallback survive into the history, making
          // a turn with "actions but no words".
          this.turnTimelines.set(streamId, timelineStart(emptyTimeline(), messageId, Date.now()));
          // #476 — the notice goes in **after** this reset. Put it before and the line
          // just stamped is wiped along with it, surviving in the webview only and not
          // in the history (it disappears when the window is reopened).
          this.noteSdkFallback(err.message, streamId);
          // #580 — the runtime this turn actually ran on is proxy. A fallback is a
          // state, but it is recorded as an event too — the evidence for quantifying
          // "why did a turn with no usage happen?".
          opsSdkFallback = true;
          spoolRuntime = "proxy";
          this.spool?.recordWorkflow({
            turnId: streamId,

            event: "sdk_fallback",
            payload: { reason: err.message },
          });
          // #371 — fall back to the browser-loop-aware runtime, NOT bare proxy,
          // so a browser_control cohort (copyclone) still opens the browser when
          // the SDK binary isn't seeded.
          await runProxyRuntime();
        }
      } else {
        // #278 Phase 3 — browser loop for opted-in cohorts, else plain proxy.
        await runProxyRuntime();
      }
      });
      // On user-initiated stop the cancelStream handler already ended the stream
      // in the webview. Persist the frozen interrupted conversation in finally,
      // without a successful streamEnd (the proxy path may throw on abort).
      if (!ctrl.signal.aborted) {
        clearPending();
        closeDelegations(NO_ANSWER_REASON);
        if (mode === 'web-search') {
          const completion = webActivity.completion(assistantCitations.length);
          if (completion) this.postToolLog(streamId, { id: `web-search-result-${streamId}`, icon: '🔎', ...completion });
        }
        // #371 — persist the agent.md handoff fence, if the coach emitted one.
        // #503 — await it **before** the history is frozen. The toolLog line this
        // leaves also has to be in this turn's timeline for it to be visible when the
        // window is reopened.
        if (!generalBrowserRequest) await this.saveAgentMdIfPresent(assistantText, streamId);
        const finishedItems = this.finishTurnItems(
          streamId,
          messageId,
          assistantText,
          assistantCitations,
          effectiveCoachName,
        );
        await this.appendHistory([userLine(historyText), ...finishedItems]);
        const answer = finishedItems.filter(item => item.role === 'assistant' && item.content.trim()).at(-1);
        if (answer) accuracyResult = { owner: crBytesOwner(token) ?? createHash('sha256').update(token || this.turnRequestScope()).digest('hex'),
          offer: { scope: accuracyScope, messageId: answer.id }, text: assistantText, instructor: this._instructorMode.isInstructor === true };
        // Fallback reveal in case the stream completed but the per-chunk
        // probe missed it (e.g. the closing ``` was in the very last delta).
        tryReveal(assistantText);
        if (!ctrl.signal.aborted) deferCompletion(streamId, ctrl.signal, (spoolStatus as "ok" | "error") === "error");
      }
    } catch (err) {
      runtimeSettled = true;
      // A stop leaves its rows open (멈춤); an error closes them as 실패, kept in the history.
      if (!ctrl.signal.aborted) closeDelegations(TURN_FAILED_REASON);
      // Received text belongs to the conversation even when the transport fails.
      // Keep a visible incomplete marker across reload without treating it as a
      // successful answer or silently retrying the model request.
      if (!ctrl.signal.aborted && assistantText.length > 0) {
        this.postToolLog(streamId, { id: `incomplete-${streamId}`, icon: '⚠️', label: '답변을 완료하지 못했어요. 위 내용은 부분 답변입니다.', state: 'error' });
        captureInterrupted();
        failedPartial = true;
      }
      if (!failedPartial && this.turnTimelines.get(streamId)?.items.some(m => m.tool && storedDenialNotice(m.tool.label))) {
        captureInterrupted();
        failedPartial = true;
      }
      spoolStatus = "error";
      spoolErrorKind = classifyTurnError(err);
      { const e = err as { status?: unknown; kind?: unknown; requestId?: unknown }; opsFailure = { ...(typeof e?.status === "number" ? { status: e.status } : {}), ...(typeof e?.kind === "string" ? { code: e.kind } : {}), ...(typeof e?.requestId === "string" ? { requestId: e.requestId } : {}) }; }
      // #751 — a stop (the learner's or the instructor's) is judged by THIS turn's abort signal, not by the shape of what
      // the runtime threw while dying: the SDK can surface an abort as a transport-looking error, and the learner then
      // read a deliberate stop as "연결이 끊겼어요". The stop notice was already posted by whoever stopped it.
      // #751 U3 — a turn the Service refused under the lesson-binding contract is closed from the Service's record of it.
      const refused = bindingKey ? bindingRefusalCode(err) : null;
      if (refused && !ctrl.signal.aborted) await this.endRefusedTurn({ code: refused, streamId, proxyUrl, token, text, images, toolMode: mode });
      else if (!ctrl.signal.aborted) {
        // An edited request with no answer has not reached persisted history.
        // Preserve it through the existing durable recovery path before reporting the error.
        if (mode === 'web-search' || (versionOf && assistantText.length === 0)) await this.post({ type: 'inputRejected', text, images, toolMode: mode });
        await this.handleSendError(err, streamId, { profile, proxyUrl, token, signal: ctrl.signal });
      }
      // #1298 — revert model choice if a direct-entry model caused this turn to fail.
      await this._instructorMode.revertModelOnTurnError(c => Promise.resolve(this.context.workspaceState.update('hps.modelChoice', c)));
    } finally {
      runtimeSettled = true;
      let interruptedSaveError: unknown;
      let interruptedSaveFailed = false;
      if (ctrl.signal.aborted || failedPartial) {
        try {
          this.interruptedHistory = { scope: this.turnRequestScope(), messages: [
            userLine(historyText),
            ...(interruptedItems ?? []),
          ] };
          await this.retryInterruptedHistory();
        } catch (error) {
          interruptedSaveFailed = true;
          interruptedSaveError = error;
          await this.post({ type: 'taskWorkspaceError', error: '받은 대화를 저장하지 못했습니다. 이 화면을 닫기 전에 필요한 내용을 복사해 주세요.', historySaveFailed: true });
        }
      }
      // The host is the only party that knows a turn ended (an auxiliary request of the same turn ends with end_turn before
      // the main loop does). A closed turn id is refused by the Service from then on; best effort, bounded by the Service.
      if (bindingKey && token) void closeTurn({ proxyUrl, token, turnId: streamId, outcome: ctrl.signal.aborted ? "aborted" : spoolStatus === "ok" ? "completed" : "failed" });
      // TUX-SP-13 — the header's remaining line is as of the last profile read; a trial turn spends attempts, so re-read it.
      if (profile?.trial && !profile.pass && token) void this.refreshTrialStatus(proxyUrl, token);
      // #580 — always record the end of the turn. A user abort also arrives through
      // catch, so the signal is checked first. When there is an SDK turn total it is
      // carried along — the control against the sum of the per-request usage records.
      // #751 F4 — what actually happened to this turn, from the real runtime path. No text leaves here.
      this.opsObserver?.turnResult({ ok: spoolStatus === "ok", aborted: ctrl.signal.aborted, runtime: spoolRuntime === "agent-sdk" ? "agent-sdk" : "proxy", sdkFallback: opsSdkFallback, ...(spoolErrorKind ? { errorKind: spoolErrorKind } : {}), ...opsFailure });
      const total = sdkTurnTotal.current;
      const finalSpoolStatus = ctrl.signal.aborted ? "aborted" : spoolStatus;
      this.finishNotifier.turnEnded({ status: finalSpoolStatus, chatVisible: chatVisible({ view: () => this.view, editor: () => this.editorChat }), seat: profile, instructor: this._instructorMode?.isInstructor === true });
      // #1298 — clear pending model revert when the turn succeeded.
      if (finalSpoolStatus === "ok") this._instructorMode.onTurnSuccess();
      await Promise.all(observationCaptures);
      if (assistantText) recordObservation('coach',assistantText);
      recordObservation('turn_end',finalSpoolStatus,{outcome:ctrl.signal.aborted?'cancelled':spoolStatus==='ok'?'success':'error'});
      await this.observationWrites;
      // SX-55 — the first coach turn that answered starts the task (assigned → working): a turn that
      // completed with a reply, not one that failed or was cancelled half-way. Kept off the turn's
      // own path: the turn has ended either way, and the flow reports its own failure.
      if (observation?.batch.format === 'hps-observation/2' && finalSpoolStatus === 'ok' && assistantText.length > 0) {
        void this.runTaskFlow({ kind: 'work' }, observation, profile)
          .then((flow) => (flow?.changed || this.taskFlowNotice || this.flowSession.stale || this.learningStateOwed ? this.postLearningState() : undefined))
          .catch(() => undefined);
      }
      if (assistantText.length > 0) {
        this.spool?.recordResponse({
          turnId: streamId,

          status: finalSpoolStatus,
          runtime: spoolRuntime,
          text: assistantText,
        });
      }
      this.spool?.recordTurnEnd({
        turnId: streamId,
        status: finalSpoolStatus,
        runtime: spoolRuntime,
        ...(spoolErrorKind && !ctrl.signal.aborted ? { errorKind: spoolErrorKind } : {}),
        ...(total
          ? {
              totalUsage: total.usage,
              ...(total.totalCostUsd !== null ? { totalCostUsd: total.totalCostUsd } : {}),
            }
          : {}),
      });
      if (this.effortTurn?.id === streamId) void this.refreshEffortResult().catch(() => { /* panel may have closed */ });
      // AE-15 — also after a stop or a failure: whatever the turn changed is offered for review.
      // A reveal started during the stream may still be writing index.html: let it land (bounded) before the scan.
      if (pendingReveals.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([Promise.allSettled(pendingReveals), new Promise((r) => { timer = setTimeout(r, 10_000); })]);
        clearTimeout(timer);
      }
      await this.endTurnRestore(turnRestorePoint, streamId, messageId);
      this.activeStreams.delete(streamId);
      // cr-verify — the run this turn carried takes no more coach calls once the turn ends.
      this.verifySession?.endTurn();
      this.verifyTurnRecorder = null;
      void this.loadAccess(true).then(()=>this.postConfig()).catch(()=>{});
      this.turnTimelines.delete(streamId);
      // Persistence failure must not skip closing the runtime and verification turn.
      if (interruptedSaveFailed) throw interruptedSaveError;
    }
    } catch (error) {
      completedStreamId = undefined;
      // Storage/profile failures can also happen after a reply has started.
      // Bind that error to its own turn so a late failure cannot end the next one.
      if (responseStreamId) {
        this.activeStreams.get(responseStreamId)?.abort();
        this.activeStreams.delete(responseStreamId);
        this.turnTimelines.delete(responseStreamId);
      }
      const activityUnavailable: import("./activityAvailability").ActivityUnavailable | undefined = error instanceof ProxyTransportError ? activityFailure(error.evidence ?? {},profileAudience(this.cachedProfile)) ?? {cause:"unknown",audience:profileAudience(this.cachedProfile)} : undefined;
      // A pre-stream storage/profile failure still owns a pending UI request.
      // Restore its captured input before propagating an unexpected host error.
      await this.post({type:"inputRejected",text,images,toolMode:mode,...(attachmentNames.length ? {photos:attachmentNames} : {})});
      await this.post({type:"streamError",streamId:responseStreamId ?? "activity",activityUnavailable,error:error instanceof AnnotationRefusal || error instanceof ActivityConnectionError || error instanceof ProxyTransportError || error instanceof LessonBindingPreflightError || error instanceof TurnToolModeError ? error.message : "활동 연결 또는 작업 폴더를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 보내 주세요."});
      // CGP-ART-R-001 — an annotation refusal is a told, handled outcome: the learner has the reason, the text and the draft.
      if (preflightComplete && !(error instanceof TurnToolModeError) && !(error instanceof AnnotationRefusal)) throw error;
    } finally {
      releasePower();
      // Reserve before a queued send is released; immutable disk records also serialize windows.
      // The education card must never break a finished turn: building the store is inside the guard
      // so a missing workspace/storage path or a corrupt record cannot skip the release cleanup below.
      if (accuracyResult && completedStreamId && !completionSignal?.aborted && !completionFailed) {
        try {
          await offerAccuracy(this.accuracyStore(), accuracyResult.owner, accuracyResult.offer,
            { status: 'ok', text: accuracyResult.text, instructor: accuracyResult.instructor });
        } catch { /* education is best effort */ }
      }
      try { releaseActivity?.(); } finally {
        this.pendingSends--; settle.settled();
        if (this.turnSettling === settle.promise) this.turnSettling = undefined;
      }
      if (completedStreamId && !completionSignal?.aborted) await this.post({ type: "streamEnd", streamId: completedStreamId, ...(completionFailed ? { failed: true as const } : {}) });
      if (accuracyResult) await this.postAccuracyEducation().catch(() => undefined);
    }
  }

  /**
   * #503 — closes the turn and produces the items to persist. It is an array with
   * bubbles and tool lines mixed **in the order they happened**. Citations attach to
   * the last assistant bubble (a tool can split the bubbles into several, so the
   * assumption of "one assistant message per turn" can no longer be used).
   *
   * With no timeline (when the call order got out of step) it falls back to a single
   * assistant lump exactly as before — better than an empty history.
   */
  /**
   * #747 (AE-08) — stamps this turn's answer lines with **the name that turn answered
   * under**.
   *
   * This is the common commit point for both runtimes, so only one place needs fixing.
   * The value stamped is exactly the `effectiveCoachName` `handleSend` already
   * computed and handed to the runtime — resolving it again at render time would keep
   * today's behaviour where the past changes along with the name.
   *
   * `chatTimeline.ts` is left alone. It is a pure module with no vscode, so identity
   * is not put into it; it is stamped **on the way out**.
   */
  private finishTurnItems(
    streamId: string,
    messageId: string,
    assistantText: string,
    citations: import("./protocol").Citation[],
    assistantName?: string,
  ): ChatMessage[] {
    const stamp = (items: ChatMessage[]): ChatMessage[] =>
      assistantName
        ? items.map((m) => (m.role === "assistant" ? { ...m, assistantName } : m))
        : items;
    const t = this.turnTimelines.get(streamId);
    const fallback: ChatMessage[] = [
      {
        id: messageId,
        role: "assistant",
        content: assistantText,
        createdAt: Date.now(),
        ...(citations.length > 0 ? { citations } : {}),
      },
    ];
    if (!t) return stamp(fallback);
    const items = stamp(timelineEnd(t, Date.now()).items);
    if (items.length === 0) return assistantText ? stamp(fallback) : [];
    if (citations.length === 0) return items;
    let lastAssistant = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0) return items;
    return items.map((m, i) =>
      i === lastAssistant ? { ...m, citations: [...(m.citations ?? []), ...citations] } : m,
    );
  }

  /**
   * #278 Phase 3 — client-driven agentic browser loop. Streams a turn; if the
   * coach emitted tool_use blocks, runs each via the CDP executor, posts an
   * action-log line (auto-run + log, no modal), appends the tool_use +
   * tool_result as EPHEMERAL scratch turns, and re-invokes — until the coach
   * stops calling tools (or the per-cohort iteration cap). Text streams through
   * `onDelta` (accumulated into the caller's assistant message + history);
   * scratch turns never touch persisted history. Asset score is recorded from
   * the terminal (non-tool) turn only.
   */
  private async runBrowserLoop(p: {
    generalBrowserRequest?: boolean;
    effort?: import('./protocol').CourseEffort;
    fundingSource?: string;
    lessonBinding?: string;
    lessonStep?: string;
    helpMode?: string;
    proxyUrl: string;
    model: string;
    token: string | undefined;
    history: ChatMessage[];
    userText: string;
    images?: string[];
    signal: AbortSignal;
    streamId: string;
    coachName: string;
    coachPersonality: string;
    onDelta: (delta: string) => void;
    onRefusal: () => void;
    onCitations: (cites: import("./protocol").Citation[]) => void;
    /** #897 H-13 — even when several requests go out within one turn the notice appears once (the recorder blocks the rest). */
    modelEcho?: ModelEchoContext;
    /** CR-10 — the turn's observation recorder; browser results are recorded only with the CR switch on. */
    recordObservation?: (
      kind: import("./nativeObservationContract").ObservationKind,
      value: string,
      extra?: Partial<import("./nativeObservationContract").ObservationEvent>,
    ) => void;
    /** CR-10 — the turn's end waits for these recordings (their bytes are stored first). */
    trackObservation?: (p: Promise<void>) => void;
    /** CR-10 — where a result's bytes go; absent when the turn has no recorder, so none are stored. */
    blobSink?: BlobSink;
  }): Promise<void> {
    // CR-11/CR-09 — with the switch on the turn drives the long-lived control, so the scope
    // guard and the picked element's refs outlive the turn (proxyTurnBrowser).
    const turnBrowser = proxyTurnBrowser(
      this.isCurriculumRuntimeEnabled(),
      () => (this.mcpBrowser ??= new BrowserControl(this.crBrowserOptions())),
      () => new BrowserControl(this.crBrowserOptions()),
    );
    const browser = turnBrowser.browser;
    // CR-08 — step numbers in results count this request's actions, not the control's lifetime.
    browser.crNewTurn();
    const maxIter = this.cachedProfile?.browser_control?.max_iterations ?? 8;
    const scratch: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    try {
      for (let iter = 0; ; iter++) {
        if (p.signal.aborted) return;
        const result = await proxyChat({
          proxyUrl: p.proxyUrl,
          model: p.model,
          effort: p.effort,
          turnId: p.streamId,
          fundingSource:p.fundingSource,
          lessonBinding: p.lessonBinding,
          lessonStep: p.lessonStep,
          helpMode: p.helpMode,
          token: p.token,
          history: p.history,
          userText: p.userText,
          images: p.images,
          toolTurns: scratch,
          signal: p.signal,
          coachName: p.coachName,
          coachPersonality: p.coachPersonality,
          audience: profileAudience(this.cachedProfile),
          // #507 — re-read on every turn inside the loop: the server address that
          // live_preview_start just brought up has to be in the next turn's context for
          // there to be no reason left to guess.
          previewUrl: this.liveServer.currentUrl(),
          onDelta: p.onDelta,
          onRefusal: p.onRefusal,
          onCitations: p.onCitations,
          // SX-59 — the browser loop discards the score chunk too. It used to buffer
          // the last turn's and put it on the status bar. The status bar is gone, so
          // the buffer went with it.
          onAssetScore: () => {},
          // #580 — the browser loop issues several requests within one turn. Per
          // iteration, 1 request = 1 record (requestKey is the per-request request id).
          onUsage: this.proxyUsageRecorder(p.streamId, p.modelEcho, p.onDelta),
        });
        if (result.toolUses.length === 0) break; // terminal turn → done
        if (iter >= maxIter) {
          p.onDelta("\n\n_(브라우저 작업을 여기서 멈췄어요.)_");
          break;
        }
        // #371 — save+reveal THIS iteration's HTML BEFORE running its browser
        // tools, so a re-check (browser_navigate to the live preview) reads the
        // freshly-saved page, not a stale one. Without this the autonomous
        // rubric loop re-reads iteration-0's HTML every round and can't
        // converge on later fixes. tryReveal's once-per-stream latch does not
        // fire here (browser loop path), so reveal explicitly per iteration.
        if (result.text && !p.generalBrowserRequest) {
          const iterHtml = extractRenderableHtml(result.text);
          // #580 — pass spoolTurnId only: passing streamId would create a logReveal
          // timeline line on every iteration and change the UI. Only the spool
          // attribution is added.
          if (iterHtml) {
            await this.revealBuilt(iterHtml, {
              spoolTurnId: p.streamId,
              artifactSource: "assistant_response",
            });
          }
        }
        // Assistant tool_use turn (its text + tool_use blocks) — scratch only.
        const asstContent: unknown[] = [];
        if (result.text) asstContent.push({ type: "text", text: result.text });
        for (const b of result.toolUses) {
          asstContent.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
        }
        scratch.push({ role: "assistant", content: asstContent });
        // Run each tool → action log + tool_result (executor never throws).
        const toolResults: unknown[] = [];
        for (const call of result.toolUses) {
          if (p.signal.aborted) return;
          // #507 — correct a guessed loopback port to the real live server before
          // running it. Fix it **before** building the log: if the on-screen line shows
          // the requested address, the participant reads an address different from
          // where it actually opened.
          const blankOpen = call.name === "browser_navigate" &&
            (call.input?.url === undefined || call.input?.url === "about:blank");
          const outsideBrowserIntent = p.generalBrowserRequest && !blankOpen;
          const fixed = p.generalBrowserRequest
            ? { call: blankOpen ? { ...call, input: { ...call.input, url: "about:blank" } } : call }
            : this.retargetLoopbackNavigation(call);
          const line = browserToolLogLine(fixed.call.name, fixed.call.input);
          this.postToolLog(p.streamId, { id: call.id, ...line, state: "running" });
          // cr-verify — the verify tools go to the session (its runner drives the same control), switch on only.
          const tr = outsideBrowserIntent
            ? { isError: true, content: [{ type: "text" as const, text: "브라우저만 열어 달라는 요청이에요. browser_navigate로 about:blank를 열어 주세요." }] }
            : isCrVerifyTool(fixed.call.name) && this.isCurriculumRuntimeEnabled()
            ? await this.runVerifyTool(fixed.call.name, (fixed.call.input ?? {}) as Record<string, unknown>)
            : await browser.execute(fixed.call);
          this.postToolLog(p.streamId, { id: call.id, ...line, state: tr.isError ? "error" : "done",
            ...(tr.isError ? { denial: denialNotice(taggedDenialSource(tr.content.find(c => c.type === 'text')?.text), this.getSeatAudience() === 'classroom') } : {}) });
          // If it was corrected, tell the model too — fix it silently and it guesses
          // again next turn. One mapping shared with the CR-T03 adapter parity check.
          toolResults.push(toProxyToolResult(call.id, tr, fixed.note));
          // CR-10 — with the switch on, the result is recorded against its artifact version.
          if (tr.observation && p.recordObservation) {
            const recording = recordProxyCrResult(p.recordObservation, call.id, fixed.call.name, fixed.call.input ?? {}, tr.observation, p.blobSink);
            if (p.trackObservation) p.trackObservation(recording);
            else void recording;
          }
        }
        scratch.push({ role: "user", content: toolResults });
      }
    } finally {
      await turnBrowser.release();
    }
  }

  /**
   * TUX-COND-08 — submit (`email` given) or withdraw (`null`) the optional notify opt-in of this
   * free seat. Re-checks that the seat's profile still advertises it, then calls the Service with
   * the seat's own credential. The address lives only in this call: it is never written to
   * settings, globalState, SecretStorage, a log or a trace. Only the submitted flag is kept.
   */
  private async handleNotifyOptin(email: string | null): Promise<void> {
    const reply = (state: "subscribed" | "withdrawn" | "error", message?: string) =>
      void this.post({ type: "notifyOptinResult", state, ...(message ? { message } : {}) });
    const token = await this.context.secrets.get(TOKEN_KEY);
    const proxy = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    const consentVersion = notifyOptinOffered(this.cachedProfile);
    if (!token || !proxy || !consentVersion) return reply("error", NOTIFY_OPTIN_ERRORS.failed);
    if (email === null) {
      const r = await withdrawNotifyOptin(proxy, token);
      if (!r.ok) return reply("error", r.message);
      await setNotifySubmitted(this.context.globalState, token, false).catch(() => undefined);
      return reply("withdrawn");
    }
    const address = plausibleEmail(email);
    if (!address) return reply("error", NOTIFY_OPTIN_ERRORS.invalid);
    const r = await submitNotifyOptin(proxy, token, address, consentVersion);
    if (!r.ok) return reply("error", r.message);
    await setNotifySubmitted(this.context.globalState, token, true).catch(() => undefined);
    return reply("subscribed");
  }

  /**
   * Turn raw errors into kid-friendly messages and recovery actions. The kid
   * must never see raw JSON. Expired/missing token → auto-reopen the token
   * input box (teacher pastes a fresh one). Session/roster → friendly nudge
   * to call the teacher.
   */
  private async handleSendError(
    err: unknown,
    streamId: string,
    current?: { profile: ResolvedProfile | null; proxyUrl: string; token?: string; signal?: AbortSignal },
  ): Promise<void> {
    // Only this turn's cancellation signal identifies a deliberate Stop. A
    // transport can also throw AbortError (for example on timeout), and still
    // needs a terminal error so the user can recover instead of waiting forever.
    if (current?.signal?.aborted) return;
    // REQ-CGP-LEARN-13 — a moderation block (either runtime) is drawn as a calm inline notice, not the
    // red card: the Service's own sentence, no retry, no OS notification or sound. The 109/1388 help
    // lines join it only for a self_harm block on a seat whose profile turned them on (DEC-LEARN-13a).
    const block = moderationBlockOf(err);
    if (block) {
      const profile = current?.profile ?? this.cachedProfile;
      const requestId = err instanceof ModerationBlockError ? err.requestId : undefined;
      if (requestId) this.lastRequestId = requestId;
      const safetyNotice = safetyNoticeView(block, { helpLines: helpLinesEnabled(profile), audience: profileAudience(profile) });
      await this.post({ type: "streamError", streamId, error: block.message, safetyNotice, retry: false, ...(requestId ? { requestId } : {}) });
      return;
    }
    // REQ-KNOW-68: classify evidence before prose-only legacy notices. Preserve the seat
    // before expired-code cleanup can remove its profile. All runtimes enter here.
    const statusProfile = current?.profile ?? this.cachedProfile;
    const audience = statusProfile?.activity_kind === "classroom" ? "classroom" : profileAudience(statusProfile);
    const evidence = err instanceof ProxyAuthError || err instanceof ProxyTransportError
      ? { ...err.evidence, ...(err instanceof ProxyAuthError ? { kind: err.kind } : {}) }
      : err && typeof err === 'object' ? {status:(err as FailureEvidence).status,...(err as {evidence?:FailureEvidence}).evidence} : {};
    const unavailable = err instanceof SdkGatewayAuthError && current?.profile?.pass ? null : activityFailure(evidence, audience);
    if (unavailable && (err instanceof ProxyAuthError || err instanceof ProxyTransportError || evidence.code || evidence.type || (evidence.status !== 403 && evidence.status !== 429))) {
      const requestId = err instanceof ProxyAuthError || err instanceof ProxyTransportError ? err.requestId : undefined;
      if (requestId) this.lastRequestId = requestId;
      await this.post({ type: 'streamError', streamId, error: err instanceof ProxyAuthError ? err.friendly : sdkErrorDisplayText(err, audience), activityUnavailable: unavailable, requestId, retry: false });
      return;
    }
    // TUX-COND-07 — a free trial that ran out ends in one inline card, only on an open-trial seat
    // (`profile_id: "studio-open-trial"`, served only behind the Service's default-off
    // HPS_OPEN_TRIAL). The card carries the Service's own pass facts; it never opens the
    // purchase view, and any other turn ending falls through unchanged.
    // CONV-ENDCARD-R-005 — an unreadable catalogue is read once more; if it still cannot be read the
    // card is drawn without pass facts. Only a Service that sells no passes falls back to the banner.
    if (current?.proxyUrl && endCardAdvertised(current.profile) && trialEndReason(err, false)) {
      const card = trialEndCardView({ profile: current.profile, err, products: await endCardCatalogue(current.proxyUrl, { signal: current.signal }), notifySubmitted: notifySubmitted(this.context?.globalState, current.token) });
      if (current.signal?.aborted) return;
      if (card) {
        void this.post({ type: "streamError", streamId, error: card.text, activityUnavailable: { cause: trialEndReason(err, false) === "expired" ? "expired" : "exhausted", audience }, trialEndCard: card });
        // CONV-FUNNEL-R-002 — count the card on the grant-scoped funnel route. Only reached when the
        // card is drawn (never for the banner fallback, a code-issued trial or a pass). The reporter
        // sends nothing unless the probe turned the route on, and keeps the first view per grant.
        // Optional call: telemetry must never turn a drawn card into a thrown turn ending.
        this.funnel?.emit({ type: "offer_viewed", surface: "end_card" });
        this.endCardOfferToken = current.token ?? null;
        return;
      }
    }
    // REQ-L12 (13) — a free trial that ran out (requests or time) is not a crash either. The notice
    // says the files stay and, only while passes are sold, names '이용권으로 시작하기'. It never
    // opens the purchase screen or the code box, and leaves the saved code alone.
    // Free start (SPEC iteration 4 §2.4) — today's free budget is drained: a calm notice with
    // the 00:00 KST time, no retry button and no purchase opened. Files and conversation stay.
    if (isFreeSeat(current?.profile) && freeDailyCapReached(err)) {
      void this.post({ type: "streamError", streamId, error: FREE_DAILY_CAP_NOTICE, activityUnavailable: {cause:"exhausted",audience}, retry: false });
      return;
    }
    const ending = trialEnding(err, !!current?.profile?.pass);
    if (ending) {
      const sold = current?.proxyUrl ? await passesOnSale(current.proxyUrl) : false;
      if (current?.signal?.aborted) return;
      void this.post({ type: "streamError", streamId, error: trialEndNotice(ending, sold, isFreeSeat(current?.profile)), activityUnavailable: {cause: ending,audience} });
      return;
    }
    // REQ-L12 — a spent pass is not a crash: say what happened and where to buy again.
    const spent = passSpentNotice(err);
    if (spent) { void this.post({ type: "streamError", streamId, error: spent, activityUnavailable: {cause:"exhausted",audience} }); return; }
    if (unavailable) {
      const requestId = err instanceof ProxyAuthError || err instanceof ProxyTransportError ? err.requestId : undefined;
      if (requestId) this.lastRequestId = requestId;
      await this.post({ type: 'streamError', streamId, error: err instanceof ProxyAuthError ? err.friendly : sdkErrorDisplayText(err, audience), activityUnavailable: unavailable, requestId, retry: false });
      return;
    }
    // REQ-L12 — the SDK's api_retry carries only 401, which is not enough to
    // call a code refunded or expired. For a profile already typed as a bought
    // pass, re-read the authenticated profile endpoint and trust only its exact
    // native-seat ending code. A valid profile, network failure, malformed code,
    // trial profile or any other answer continues through the generic 401 path.
    if (err instanceof SdkGatewayAuthError && current?.profile?.pass && current.token) {
      const refreshed = await fetchProfileResult({ proxyUrl: current.proxyUrl, token: current.token, signal: current.signal }).catch(() => null);
      // A Stop during the bounded profile read owns the final UI state. Do not
      // replace streamStopped with either paid-pass copy or generic auth recovery.
      if (current.signal?.aborted) return;
      const notice = refreshed && !refreshed.ok ? paidPassEndNotice(current.profile.pass, refreshed.failure) : null;
      if (notice) {
        void this.post({ type: "streamError", streamId, error: notice, activityUnavailable: {cause: refreshed && !refreshed.ok && refreshed.failure.code === "trial_revoked_or_reissued" ? "revoked" : "expired",audience} });
        return;
      }
    }
    if (err instanceof ProxyAuthError) {
      if (err.requestId) this.lastRequestId = err.requestId;
      void this.post({
        type: "streamError",
        streamId,
        error: err.friendly,
        activityUnavailable: activityFailure({ ...err.evidence, kind: err.kind }, audience) ?? undefined,
        requestId: err.requestId,
        runbookUrl: err.runbookUrl,
      });
      // #596 — the moment the session closes is the natural trigger for "send today's
      // records". It raises **a notice with one button**, not an automatic upload
      // (#580 AC: no upload of any kind without an explicit action). If the cohort has
      // not opted in, nothing is shown — the server refuses it anyway (fail closed).
      // Once per activation — if toasts stack up on every resend after the lesson
      // ends, nobody reads them from the second one on (the same judgment as the #476
      // fallback notice).
      if (
        err.kind === "session_window" &&
        !this.sessionEndUploadOffered &&
        this.cachedProfile?.analytics?.upload_session_logs === true
      ) {
        this.sessionEndUploadOffered = true;
        void vscode.window
          .showInformationMessage(
            "수업이 끝났어요 — 오늘 활동 기록을 남겨둘까요?",
            "기록 보내기",
          )
          .then((pick) => {
            if (pick === "기록 보내기") {
              void vscode.commands.executeCommand("hypeproof-chat.uploadSessionLogs");
            }
          });
      }
      return;
    }
    // REQ-M45 — the install notice: shown as is, with its request ID, and without "다시 보내기".
    if (err instanceof SdkRequiredError) {
      if (err.requestId) this.lastRequestId = err.requestId;
      void this.post({ type: "streamError", streamId, error: err.message, ...(err.requestId ? { requestId: err.requestId } : {}), retry: false });
      return;
    }
    // REQ-M44 — the SDK's own error text ("Claude Code returned an error result: API Error: …") never reaches the
    // banner: the Service's sentence, or a Korean line by status. The App's own Korean errors pass through unchanged.
    const reason = sdkErrorDisplayText(err, profileAudience(this.cachedProfile));
    const requestId = err instanceof ProxyTransportError ? err.requestId : undefined;
    if (requestId) this.lastRequestId = requestId;
    void this.post({ type: "streamError", streamId, error: reason, requestId, activityUnavailable: {cause: err instanceof TypeError ? "outage" : "unknown", audience} });
  }

  /**
   * REQ-STUDIO-TASK-RUN-STATE — tells the webview while a modal raised by this request is open, so the
   * task rail and the busy line say 승인 기다리는 중. `onPrompted` fires right before every modal below;
   * an auto-allowed or policy-refused request never shows one and never reports a wait.
   */
  async resolveActionApprovalTracked(req: ActionRequest, onPrompted?: () => void, onDenied?: (source: import("./denialSource").DenialSource) => void): Promise<boolean> {
    let prompted = false;
    try {
      return await this.resolveActionApproval(req, () => {
        if (!prompted) { prompted = true; this.approvalWaits++; void this.post({ type: "approvalWait", waiting: true }); }
        onPrompted?.();
      }, onDenied);
    } finally {
      if (prompted) { this.approvalWaits = Math.max(0, this.approvalWaits - 1); void this.post({ type: "approvalWait", waiting: this.approvalWaits > 0 }); }
    }
  }

  private async handleActionRequest(req: ActionRequest): Promise<void> {
    const approved = await this.resolveActionApprovalTracked(req);
    void this.post({ type: "actionResult", requestId: req.requestId, approved });
  }

  /**
   * Resolve a manual-approve request from streamed assistant code.
   *
   * Policy tiers (#115 / epic #108):
   *   1. Hard-deny: `executeShell` is refused outright — no modal, info toast.
   *      Defense-in-depth on top of the worker's "셸 실행 금지" prompt rule.
   *   2. Path-scope: `writeFile` with an absolute path outside the active
   *      workspace is refused outright — warning toast, no modal.
   *   3. Modal-gated: anything else listed in `requireApprovalFor` triggers
   *      a Warning modal; Approve/Deny → boolean.
   *   4. Allow-by-default: not in the required set → return true.
   *
   * Public so e2e tests can synthesize requests without spinning through the
   * streamed-assistant path.
   */
  async resolveActionApproval(req: ActionRequest, onPrompted?: () => void, onDenied?: (source: import("./denialSource").DenialSource) => void): Promise<boolean> {
    // Tier 1 — shell (epic #431). No longer a hard deny: a cohort that set
    // `sdk_tools.shell` gets arbitrary commands, and THIS modal is the gate.
    // Four shapes, in order of how much they interrupt:
    //   folder consent not full → refused before any allow is read (CGP-AGENT-R-004);
    //   destructive → strong confirm every time, never remembered;
    //   allowed for this task → silent (the participant chose "이번 작업 동안 이 명령 허용" for this exact command);
    //   otherwise   → normal confirm + the option to allow this exact command for this task.
    if (req.kind === "executeShell") {
      const command = (req.payload as { command?: string } | null | undefined)?.command ?? "";
      // REQ-M4a: the flag is re-derived from the command here too and can only
      // be added, never dropped, so a request without the SDK verdict's flag
      // still gets the strong confirm.
      const { destructive } = shellApprovalFor(command, req.destructive === true);
      const scope = this.taskCommandAllowState();
      // Observed before refusing, so a read-only interlude (full → read → full) still ends the allow.
      this.taskCommandAllows.observe(scope.key);
      if (scope.refusal) {
        void vscode.window.showInformationMessage(scope.refusal);
        if (onDenied) onDenied("folder"); else await this.postDenialNotice("folder");
        return false;
      }
      const exact = destructive ? null : taskCommandExact(command);

      if (exact && this.taskCommandAllows.has(scope.key, exact.key)) {
        return true;
      }
      const allowGeneration = this.taskCommandAllows.generation;

      const pretty = describeCommandForApproval(command);
      if (destructive) {
        // Deliberately NOT offering "항상 허용". Approving `rm -rf` once must
        // never approve it for the rest of the session, and the whole point of
        // the strong confirm is that it stays interruptive.
        onPrompted?.();
    const pick = await vscode.window.showWarningMessage(
          "⚠️ 되돌리기 어려운 명령이에요. 정말 실행할까요?",
          { modal: true, detail: pretty },
          "실행",
          "취소",
        );
        return pick === "실행";
      }

      const buttons = exact ? ["실행", TASK_COMMAND_ALLOW_LABEL] : ["실행"];
      onPrompted?.();
    const pick = await vscode.window.showWarningMessage(
        shellApprovalTitle(this.coachDisplayName()),
        { modal: true, detail: pretty },
        ...buttons,
      );
      if (pick === TASK_COMMAND_ALLOW_LABEL && exact) {
        // This task only, in memory only. What we are killing is the fifteen identical modals
        // inside ONE 20:35 block that train them to stop reading; another task, folder or window
        // starts the judgment over. Remembered only if nothing ended the allows while the modal was
        // open (a task switch, even one that came back) and the scope is still the same.
        if (this.taskCommandAllows.generation === allowGeneration && this.taskCommandAllowState().key === scope.key) this.taskCommandAllows.remember(scope.key, exact.key);
        return true;
      }
      return pick === "실행";
    }

    // Tier 1.5 — opening the browser. Asked once per origin.
    //
    // Measured (2026-07-26, real use): while the coach read the reference site's
    // sub-pages one after another, a modal appeared for every page — About ·
    // 첨단디지털 · 평생예방 · 시니어 … The judgment is finished after one answer to
    // "may the coach look around this site", and demanding the same answer five times
    // leaves only the habit of clicking without reading — the exact opposite of what
    // the approval gate was meant to train. It is the same device as the shell's
    // `항상 허용` (above) and, likewise, session-scoped.
    if (req.kind === "openBrowser") {
      const url = (req.payload as { url?: string } | null | undefined)?.url ?? "";
      const origin = originOfUrl(url);
      if (origin && this.approvedBrowserOrigins.has(origin)) {
        return true;
      }
      // The button names the same normalized host as the body (REQ-E3); the remembered key stays the origin.
      // A file: URL has no site to remember (its origin is the string "null").
      const rememberLabel = browserRememberLabel(url);
      const REMEMBER = origin && rememberLabel ? rememberLabel : null;
      const buttons = REMEMBER ? ["열기", REMEMBER] : ["열기"];
      onPrompted?.();
    const pick = await vscode.window.showWarningMessage(
        // REQ-E3 / CGP-AGENT-R-006: the host on its own line + 내 미리보기 / 인터넷, never the full URL.
        `${browserApprovalTitle(this.coachDisplayName())}\n\n${browserTargetDetail(url, { workspaceRoot: this.resolveCoachCwd() ?? null })}`,
        { modal: true },
        ...buttons,
      );
      if (pick === REMEMBER && origin) {
        this.approvedBrowserOrigins.add(origin);
        return true;
      }
      return pick === "열기";
    }

    // Tier 1.6 — publishing the workspace to a public GitHub repository (publish_site).
    // Asked until the repository is REGISTERED (persisted per GitHub login + repository, shared
    // with the toolbar button — publishRegistry.ts), then never again until "배포 등록 해제".
    // Not configurable through requireApprovalFor (see the ActionRequest kind comment).
    // check_only never reaches here.
    if (req.kind === "publishSite") {
      const payload = (req.payload as { repo_name?: string; stage?: string } | null | undefined) ?? {};
      const publisher = this.sitePublisher();
      if (!publisher.allowed()) { if (onDenied) onDenied("unknown"); else await this.postDenialNotice("unknown"); return false; }
      const repo = publisher.repoNameFor({ repo_name: payload.repo_name || undefined });
      return publisher.approveForTool(repo, payload.stage === "save" ? "save" : "publish", onPrompted);
    }

    // Tier 2 — file access must target the active workspace (write and read).
    if (req.kind === "readFile") {
      const target = (req.payload as { path?: string } | null | undefined)?.path;
      if (typeof target === "string" && target.length > 0 && !isInsideWorkspace(target)) {
        if (onDenied) onDenied("safety"); else await this.postDenialNotice("safety");
        vscode.window.showWarningMessage(
          denialCopy({ source: classifyDenial("path_outside_workspace"), reason: `작업 폴더 밖의 경로예요: ${target}` }),
        );
        return false;
      }
    }
    // REQ-E1 / CGP-AGENT-R-005 — a write is checked for EVERY path it names (not only the first), canonically
    // (a `..` escape or a symlink that resolves outside counts as outside), and refused before any modal. The
    // notice names the path as the modal would (작업 폴더 밖 · <name>), never the full path.
    let writeEntries: WritePathEntry[] = [];
    const writeTargets = req.kind === "writeFile" ? writeTargetsFromPayload(req.payload) : [];
    if (writeTargets.length > 0) {
      const root = this.resolveCoachCwd() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
      const targets = writeTargets;
      writeEntries = writePathEntries(targets, root);
      // With a work folder, its canonical containment decides; without one, the open workspace folders do (as before).
      const outside = writeEntries.filter((e, i) => (root ? e.outside : !isInsideWorkspace(targets[i].path)));
      if (outside.length > 0) {
        if (onDenied) onDenied("safety"); else await this.postDenialNotice("safety");
        vscode.window.showWarningMessage(
          // One 작업 폴더 밖 token per path; a solo seat (personal, trial, pass) is never told to ask a teacher.
          denialCopy({ source: classifyDenial("path_outside_workspace"), reason: `저장하려는 곳: ${outside.map((e) => e.display).join(", ")}` }, profileAudience(this.cachedProfile)),
        );
        return false;
      }
    }

    // Tier 3 — modal-gated.
    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    //
    // writeFile is **out** of this list (원장 decision 2026-07-27, reversing an
    // earlier decision).
    //
    // By the time this modal appears, the safety checks are already done: a path
    // outside the workspace is refused with no modal by evaluateSdkToolUse's
    // containment. So the only function left was not safety but teaching delegation
    // judgment — and in the measurements that teaching did not hold up.
    //
    //   07-27 turn 2: one file-save modal was left sitting for **174 seconds**. The
    //   원장 was not in front of the screen, and the coach was stuck doing nothing the
    //   whole time. The day before, a 42.2-second one was 77% of one turn's approval
    //   wait. There was also a day it appeared 8 times in one turn, and then it was
    //   clicked within 3–4 seconds — the rhythm of clicking without reading.
    //
    // So this modal becomes one of two things: missed, stopping the session; or
    // clicked by reflex, teaching nothing. Delegation judgment is taught on shell,
    // browser and subagents — those are genuinely hard to undo, or they reach outside.
    //
    // Reverting it is one line of settings: add "writeFile" to
    // hypeproofChat.requireApprovalFor.
    // browserClick is **not** in the list → auto-allowed.
    //
    // The delegation judgment was already made in the decision to open the page
    // (openBrowser). Clicking inside that page is verification, not a new outward act,
    // and browser_read on the same page is already auto-allowed. Measured (07-27): a
    // modal appeared on every loop where the coach "fixed it and clicked to check for
    // himself", and thanks to a missing mapping it even appeared **with the shell copy
    // and empty content**.
    // browserType stays — it can enter a value and go as far as submitting, which is a
    // different kind of act.
    //
    // The single source of the policy is `requireApprovalFor.default` in package.json.
    // When the manifest declares a default, **the manifest always wins** and the
    // second argument below is never reached. #499 was the drift caused by missing
    // that fact — only the code was fixed and not the manifest, so the writeFile modal
    // was still alive while browserType, absent from the list, was unconditionally
    // auto-allowed. To change the policy, edit `default` and `items.enum` in
    // package.json (a smoke test locks it).
    const required = cfg.get<string[]>("requireApprovalFor", [
      "executeShell",
      "openBrowser",
      "delegateAgent",
      "browserType",
    ]);
    const needsApproval = required.includes(req.kind);
    if (!needsApproval) return true;

    // Ask in Korean. Shell (`코치가 명령을 실행하려고 해요`) and browser (`코치가
    // 브라우저를 열려고 해요`) were Korean, but file writing alone dropped into this
    // generic fallback and went out as `HypeProof Chat wants to writeFile:` /
    // `Deny·Cancel·Approve`.
    //
    // This is not about removing noise, it is about **speed** (measured 2026-07-27):
    // the Korean modals were clicked within 3–4 seconds while this one English modal
    // ate 42.2 seconds — that single instance was 77% of that turn's approval wait.
    // When English suddenly appears in front of an adult professional audience, it
    // takes time to read.
    //
    // The approval gate itself stays (원장 decision 2026-07-27): consciously approving
    // at every moment your own artifact changes IS this track's delegation-judgment
    // training.
    const coachName = this.coachDisplayName();
    // A5 — consult (orchestrator spec §5.1). Only a machine that added consultHelper to
    // requireApprovalFor reaches this line; the default never does. The modal names the helper
    // by its title and model (AE-27), not by its wire id.
    if (req.kind === "consultHelper") {
      const copy = consultApprovalCopy(coachName, orchestratorRosterFor(this.cachedProfile), req.payload);
      onPrompted?.();
      const pick = await vscode.window.showWarningMessage(copy.message, { modal: true }, copy.verb);
      return pick === copy.verb;
    }
    const { title, verb } = approvalCopyFor(coachName)[req.kind] ?? {
      title: approvalFallbackTitle(coachName),
      verb: "허용",
    };
    // DES-CGP-AGENT-05 changes presentation only; the opt-in policy and path gates above remain.
    if (req.kind === "writeFile") {
      onPrompted?.();
      return this.confirmWriteFiles(randomId(),title,verb,writeEntries);
    }
    onPrompted?.();
    const pick = await vscode.window.showWarningMessage(
      `${title}\n\n${req.description}`,
      { modal: true },
      verb,
    );
    return pick === verb;
  }

  private lessonWorkFor(sha256: string): Record<string, StepWork> {
    return (this.context.workspaceState.get<Record<string, Record<string, StepWork>>>("hps.lessonWork") ?? {})[sha256] ?? {};
  }

  /**
   * AE-01 (#554) — one goal save, judged against the served lesson and the stored goal (`acceptGoalSave`), then
   * answered to every chat view with the id of the save it answers, so only the view that sent it shows the note. A
   * stored save carries the goal as stored. A refused or failed save stores nothing and carries no goal, so every view
   * keeps the goal and the typed text it shows (the host may have no lesson at hand while the screen still draws one);
   * only a `stale` refusal brings the newer goal the save lost to.
   */
  private async saveGoal(msg: unknown): Promise<void> {
    const lesson = this.cachedProfile?.lesson;
    const activity = activityConnections(this.context)?.scope ?? null;
    const all = this.context.workspaceState.get<unknown>(STUDENT_GOAL_KEY);
    const requestId = goalRequestIdOf(msg);
    const echo = requestId ? { requestId } : {};
    // Re-check at execution time: queued writes may outlive an activity or instructor switch.
    if (msg && typeof msg === "object" && "status" in msg &&
        (this._instructorMode?.isInstructor || !("activityId" in msg) || msg.activityId !== activity)) {
      await this.post({ type: "goalState", error: GOAL_REFUSAL_SENTENCES.other_lesson, ...echo });
      return;
    }
    const saved = acceptGoalSave(lesson, activity, msg, all, Date.now());
    if (!saved.ok) {
      const newer = saved.code === "stale" ? goalViewOf(lesson, activity, all) : null;
      await this.post({ type: "goalState", ...(newer ? { view: newer } : {}), error: GOAL_REFUSAL_SENTENCES[saved.code], ...echo });
      return;
    }
    try {
      await this.context.workspaceState.update(STUDENT_GOAL_KEY, saved.all);
    } catch {
      await this.post({ type: "goalState", error: GOAL_REFUSAL_SENTENCES.not_stored, ...echo });
      return;
    }
    const view = goalViewOf(lesson, activity, saved.all);
    await this.post({ type: "goalState", ...(view ? { view } : {}), saved: true, ...echo });
  }

  /**
   * #751 G2 — the rehearsal report. The panel's own read-back of what it drew goes out unchanged (only steps of this lesson);
   * the Service compares it with the candidate AND with its own records of the requests made under this code.
   */
  private async sendRehearsalReport(steps: import("./lessonFocus").RenderedStep[], mission?: unknown): Promise<void> {
    const profile = this.cachedProfile, lesson = profile?.lesson, token = await this.context.secrets.get(TOKEN_KEY);
    if (!profile?.rehearsal || !lesson || !token) { await this.post({ type: "rehearsalState", state: "error", message: "리허설 코드로 연 수업이 아닙니다." }); return; }
    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    const pkg = this.context.extension.packageJSON as { version?: string; devDependencies?: Record<string, string> };
    const report = rehearsalReport(lesson, Array.isArray(steps) ? steps : [], {
      extension_version: String(pkg.version ?? "unknown"), host: `${vscode.env.appName} ${vscode.version}`.slice(0, 120),
      runtime: cfg.get<string>("coachRuntime", "proxy"), sdk: String(pkg.devDependencies?.["@anthropic-ai/claude-agent-sdk"] ?? "none").slice(0, 120),
      os: process.platform, arch: process.arch,
    }, mission);
    await this.post({ type: "rehearsalState", state: "sending" });
    try {
      const base = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1").replace(/\/$/, "");
      const r = await fetch(base + "/classroom/rehearsal/report", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(report) });
      const j = await r.json().catch(() => ({})) as { verdict?: string; reasons?: string[]; reason?: string; error?: string };
      if (!r.ok) { await this.post({ type: "rehearsalState", state: "error", message: j.reason === "no_request_yet" ? "아직 AI에게 한 번도 묻지 않았습니다. 단계마다 한 번 이상 물어본 뒤 보내세요." : (j.error ?? "보내지 못했습니다 (" + r.status + ")") }); return; }
      await this.post({ type: "rehearsalState", state: "sent", verdict: j.verdict, reasons: j.reasons ?? [] });
    } catch (err) { await this.post({ type: "rehearsalState", state: "error", message: "Service에 연결하지 못했습니다: " + (err as Error).message }); }
  }

  private async postConfig(): Promise<void> {
    const activity=activityConnections(this.context)?.current;
    const scope=activity?.id;
    await this.draftWrites;
    await this.loadAccess();
    const cfg = vscode.workspace.getConfiguration("hypeproofChat");
    const token = await this.context.secrets.get(TOKEN_KEY);
    const profile = await this.ensureProfile();
    const selection = availableModelSelection(profile, cfg.get<'proxy' | 'agent-sdk'>('coachRuntime', 'proxy'));
    const settingModel = cfg.get<string>('model', 'hypeproof-default');
    const model = profile && selection ? selectedModel(profile, selection, this.context.workspaceState.get<SavedModelChoice>('hps.modelChoice'), settingModel) : settingModel;
    const effort = profile && selection ? selectedEffort(profile,selection,model,this.context.workspaceState.get<SavedEffortChoice>('hps.effortChoice')) : undefined;
    const effortScope = profile ? JSON.stringify([token, modelSelectionScope(profile)]) : undefined;
    if (this.effortScope !== effortScope) {
      this.effortScope = effortScope;
      this.effortTurn = undefined; this.effortResult = undefined; this.effortNotice = undefined;
    }
    if (scope!==activityConnections(this.context)?.scope) return;
    const local=localRuntimeConfig(vscode.env.appName,cfg.get<string>('proxyUrl','https://api.hypeproof-ai.xyz/v1'));
    const proxyUrl = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    // #1298 A-01 — student slot takes priority. If the student token is active
    // (present, not expired, not hard-rejected), skip the instructor check entirely
    // to prevent the instructor panel from flashing during a rehearsal.
    // profileFetched: ensureProfile() completed and recorded an answer (ok or failure).
    // Distinct from "token exists" to handle the connections.matchesService=false early-return.
    const profileFetched = !!token && (profile !== null || this.lastProfileFailure !== null);
    const studentProfileStatus = profileFailureToStatus(
      this.lastProfileFailure,
      !!token,
      profileFetched,
    );
    const panelMode = decideMode({ studentToken: token ?? undefined, studentProfileStatus });
    // Instructor auth always uses the issuer token slot, never the student token.
    const issuerToken = await resolveInstructorTokenFromSecrets(this.context.secrets);
    // cr-review — the director's Weekly Review command follows the switch as the Service answers this token.
    void this.refreshCrDirectorContext();
    let isInstructor: boolean;
    if (panelMode === "instructor") {
      isInstructor = await this._instructorMode.checkInstructorMode(issuerToken, proxyUrl);
    } else {
      // Student slot active: clear any cached instructor state so that handleSend and other
      // callers checking this._instructorMode.isInstructor === true see false, not a stale true.
      this._instructorMode.reset();
      isInstructor = false;
    }
    // CGP-AGENT-R-004 — an instructor flip ends every task allow, even with no shell request in between.
    if (this.lastAllowInstructor !== undefined && this.lastAllowInstructor !== isInstructor) this.endTaskCommandAllows();
    this.lastAllowInstructor = isInstructor;
    // #1298 — on the auto-read path (postConfig/refresh), act on the whoami result.
    // The setInstructorToken command has its own rejection handler; this covers the background refresh path.
    if (issuerToken) {
      const action = this._instructorMode.handleAutoReadResult();
      if (action === "rejected_delete_and_show") {
        this.onIssuerAutoRejected?.();
      }
    }
    const instructorBrief = (isInstructor && issuerToken)
      ? await this._instructorMode.fetchInstructorBrief(issuerToken, proxyUrl)
      : undefined;
    const instructorConnection = isInstructor
      ? (local?.provider === "claude" ? "내 Claude 구독"
        : local?.provider === "codex" ? "내 Codex 구독"
        : "서버")
      : undefined;
    await this.prepareTaskWorkspace?.(isInstructor);
    if (scope !== activityConnections(this.context)?.scope) return;
    const taskStore = this.currentTaskStore?.();
    const taskView = taskStore?.getView();
    // REQ-L12 ⑫ — flag off (no Service offer) reads nothing and changes nothing.
    const carryover = activity && carryoverAdvertised(profile) ? carryoverState(activity.id, true, this.carryoverStores()).view : null;
    const toolProfile = profile ? accessProfile(profile, this.accessState?.view?.choices.find(choice => choice.id === this.accessState?.selected)) : null;
    const toolRuntime = selection?.source === 'lesson' ? selection.runtime : resolveCoachRuntime({
      settingRuntime: cfg.get<'proxy' | 'agent-sdk'>('coachRuntime', 'proxy'), profileRuntime: toolProfile?.coach_runtime, minorCohort: toolProfile?.minor_cohort,
    });
    // REQ-M47 and CGP-SHELL-R-024 evaluate a served profile the same way: this access choice, this runtime setting, this fallback.
    const seatInputs: SeatInputs = { choice: this.accessState?.view?.choices.find(choice => choice.id === this.accessState?.selected), settingRuntime: cfg.get<'proxy' | 'agent-sdk'>('coachRuntime', 'proxy'), fallback: !!this.fallbackNoticeShown, requiredApprovals: cfg.get<string[]>("requireApprovalFor", []) };
    // CGP-SHELL-R-024 — the remembered and the new served profile are both evaluated under seatInputs, so only a profile change shows.
    const capabilityChange = (this.capChanges ??= new CapabilityChangeTracker()).observe({ scope: JSON.stringify([token ?? null, scope ?? null]), profile, inputs: seatInputs, instructor: isInstructor, local: !!local });
    // CGP-KNOW-R-015 — the explorer's "이 파일에 대해 묻기" follows the file-attach gate. The host re-checks
    // the gate on every request, so a failed context update never holds up the config post.
    void (async () => vscode.commands.executeCommand("setContext", ASK_ABOUT_FILE_CONTEXT_KEY, fileAttachAllowed(toolProfile, isInstructor)))().catch(() => undefined);
    const entryId = lessonCapabilityEntryId(profile, token, proxyUrl, !!local || isInstructor);
    await this.post({
      type: "config",
      config: {
        ...(entryId ? { lessonCapabilityEntry: { id: entryId, seen: this.context.globalState?.get(entryReceiptKey(entryId)) === true } } : {}),
        turnTools: turnToolsAvailability({ profile: toolProfile, runtime: toolRuntime, local: !!local, instructor: isInstructor }),
        ...(fileAttachAllowed(toolProfile, isInstructor) ? { fileAttach: true } : {}),
        ...(fileAttachAllowed(toolProfile, isInstructor) ? { materials: true } : {}),
        // After an agent-sdk → proxy fallback this session, turns run on proxy, so the card follows it.
        ...(profile && !local && !isInstructor ? { aiCapabilities: seatAiCapabilities(profile, seatInputs) } : {}),
        ...(capabilityChange && !isInstructor ? { capabilityChange } : {}),
        proxyUrl,
        model:local?.model??model,
        hasToken: !!token,
        workTakeawayEnabled: vscode.workspace.getConfiguration('hypeproofChat').get<boolean>('workTakeawayEnabled', false),
        ...(taskView ? { taskWorkspace: taskView } : {}),
        ...(activity && carryover ? { carryover } : {}),
        ...(activity ? {activity:{id:activity.id,name:activity.name,kind:activity.kind,workspace:activity.workspace,verified:!!profile,...(profile?.pass?{pass:profile.pass}:{}),...(profile?.trial&&!profile.pass?{trial:profile.trial}:{}),...(isFreeSeat(profile)?{free:true}:{})},
          activityDraft:taskStore && !taskView?.error ? taskStore.getDraft() : this.context.workspaceState.get('hps.activity.draft.'+activity.id,emptyActivityDraft())} : {}),
        // AE-01 (#554) — every mount and reconnect starts from the goal stored for THIS lesson revision and activity.
        studentGoal: goalViewOf(profile?.lesson, scope ?? null, this.context.workspaceState.get<unknown>(STUDENT_GOAL_KEY)),
        activityUnavailable: this.opsHold ? {cause:this.opsHold === 'paused' ? 'paused' : 'forbidden',audience:'classroom'} : this.lastProfileFailure ? activityFailure(this.lastProfileFailure, activity ? seatAudience(activity) : profileAudience(profile)) ?? (this.lastProfileFailure.reason === 'network' ? {cause:'outage',audience:activity ? seatAudience(activity) : profileAudience(profile)} : undefined) : undefined,
        access:this.accessState,
        cohortSettings: !local && !isInstructor && profile &&
          (profile.activity_kind === 'classroom' || !!profile.lesson)
          ? { model: selection?.choices.length === 1, effort: effort?.allowed.length === 1 }
          : undefined,
        effort, effortNotice:this.effortNotice, effortResult:this.effortResult,
        reduceMotion: reduceMotionForced(vscode.workspace.getConfiguration("workbench").get("reduceMotion")),
        textSize: normalizeTextSize(this.context.globalState?.get(TEXT_SIZE_KEY)),
        coach: this.getCoach(),
        profile: profile ? { ...profile, model_selection: local?localModelSelection(local):selection } : null,
        update: local ? undefined : this.availableUpdate && { ...this.availableUpdate, heldForClass: classUpdateHold(profile, activity) },
        ...(this.sitePublisher().available() ? { sitePublish: true } : {}),
        ...(isInstructor ? { isInstructor: true } : {}),
        ...(instructorBrief ? { instructorBrief } : {}),
        ...(instructorConnection ? { instructorConnection } : {}),
        ...(isInstructor && local ? { instructorModelChoices: localModelSelection(local).choices } : {}),
      },
    });
    // CGP-ART-R-007 — a config for another activity or task resets the webview's state; queued page
    // text must stay visible for as long as it would be sent.
    if (this.pendingPageAttachment) void this.post({ type: "pageAttachment", attachment: this.pendingPageAttachment });
    // CGP-ART-R-001 — so does the annotation tray: re-post this task's annotation state (the tray and
    // its add buttons), and a changed task or activity clears the old task's numbered preview markers.
    this.postAnnotations();
    // CGP-CHAT-R-011 — a file from another work folder, or on a seat that lost the gate, is dropped; a pending one is re-shown.
    if (this.pendingFileAttachment) {
      if (this.pendingFileAttachment.root !== this.resolveCoachCwd() || !fileAttachAllowed(toolProfile, isInstructor)) this.clearFileAttachment();
      else void this.post({ type: "fileAttachment", attachment: this.pendingFileAttachment.preview });
    }
    // #649 — when the webview remounts (panel hide → show, reload) the highlight
    // disappears. Announce the currently open world once more to restore the strip's
    // aria-pressed.
    if (this.lastPrebuiltWorld) {
      const w = profile?.worlds?.find((x) => x.id === this.lastPrebuiltWorld);
      void this.post({
        type: "worldOpened",
        id: this.lastPrebuiltWorld,
        guest: w?.guest ?? "",
        emoji: w?.emoji ?? "",
      });
    }
  }

  // ---- #72: auto-update banner state ---------------------------------------
  // The scheduler in updateChecker.ts pushes here whenever a check completes;
  // we relay through postConfig so the webview re-renders. Null clears.
  private availableUpdate: import("./protocol").UpdateOffer | null = null;

  /**
   * Test-only: post `webviewTestCrash` to the webview so the React tree
   * throws on next render and ChatErrorBoundary catches it. Called from
   * the env-gated `__test_crashWebview` command (REQ-C7).
   */
  postTestCrash(): void {
    void this.post({ type: "webviewTestCrash" });
  }

  setAvailableUpdate(info: import("./protocol").UpdateOffer | null): void {
    this.availableUpdate = info;
    // Best-effort push; if webview isn't ready yet, the next postConfig
    // (e.g., after panel reveal) picks it up.
    void this.postConfig();
  }

  /** CGP-SHELL-R-001 — the active seat is a class, so no update installs now. */
  isClassUpdateHeld(): boolean {
    return classUpdateHold(this.cachedProfile, activityConnections(this.context)?.current);
  }

  getAvailableUpdate(): import("./protocol").UpdateOffer | null {
    return this.availableUpdate;
  }

  /**
   * CGP-CHAT-R-005 — answer bubble id (the turn's base id; later segments are `<id>#n`) → the turn's
   * id (streamId), for the answers of this window's session, stored on the verdict event. A reopened
   * task has no entry; its verdict event then carries the message and prompt ids only.
   */
  private answerTurns?: Map<string, string>;
  private rememberAnswerTurn(messageId: string, streamId: string): void {
    // Created on first use, like turnRequests: tests build the provider without running field initialisers.
    this.answerTurns ??= new Map();
    this.answerTurns.set(messageId, streamId);
    while (this.answerTurns.size > 256) this.answerTurns.delete(this.answerTurns.keys().next().value!);
  }

  private async postVerdicts(): Promise<void> {
    const store = this.currentTaskStore?.();
    const taskId = store?.getView().activeTaskId;
    if (!store || !taskId || store.getView().error) return;
    await this.post({ type: "answerVerdicts", taskId, verdicts: store.getVerdicts(taskId) });
  }

  /**
   * CGP-CHAT-R-005 (REQ-STUDIO-ANSWER-VERDICT, DEC-09) — the learner's verdict on a finished answer.
   * Personal task chat only (never a lesson, a classroom seat or instructor mode), and only for an
   * answer the verdict rules offer one on. DEC-09: the event is stored ONLY in the task's local verdict
   * file. It is deliberately NOT written to the session spool, because the spool is uploaded and
   * collected for class records. It never reaches the model: it is not a chat message and is not in
   * the history.
   */
  private async handleAnswerVerdict(msg: unknown): Promise<void> {
    const store = this.currentTaskStore?.();
    const taskId = store?.getView().activeTaskId;
    const activityId = activityConnections(this.context)?.scope;
    const request = parseVerdictRequest(msg);
    if (!store || !taskId || !request || this._instructorMode.isInstructor || this.cachedProfile?.lesson) { await this.postVerdicts(); return; }
    // The saved conversation holds finished turns only (a turn is saved when it ends), so a running
    // turn is not in it and an earlier answer stays judgeable while the next one streams.
    const history = store.getHistory(taskId);
    if (!verdictTargets(history, false).has(request.messageId)) {
      await this.post({ type: "answerVerdicts", activityId, taskId, requestId: request.requestId, messageId: request.messageId, verdicts: store.getVerdicts(taskId) });
      return;
    }
    const promptId = promptIdFor(history, request.messageId);
    const turnId = this.answerTurns?.get(request.messageId.split("#")[0]);
    const event: VerdictEvent = {
      messageId: request.messageId,
      ...(promptId ? { promptId } : {}),
      ...(turnId ? { turnId } : {}),
      verdict: request.verdict,
      ...(request.reason ? { reason: request.reason } : {}),
      ...(request.note ? { note: request.note } : {}),
      at: Date.now(),
    };
    try {
      const verdicts = await store.recordVerdict(taskId, event);
      if (this.currentTaskStore?.() !== store || activityConnections(this.context)?.scope !== activityId) return;
      await this.post({ type: "answerVerdicts", activityId, taskId, requestId: request.requestId, messageId: request.messageId, verdicts });
    } catch (error) {
      // A delayed failure belongs to the originating workspace, not the task now on screen.
      if (this.currentTaskStore?.() !== store || activityConnections(this.context)?.scope !== activityId) return;
      await this.post({ type: "answerVerdicts", activityId, taskId, requestId: request.requestId, messageId: request.messageId, verdicts: store.getVerdicts(taskId) });
      await this.post({ activityId, taskId, type: 'taskWorkspaceError', verdictRequestId: request.requestId, verdictMessageId: request.messageId, error: error instanceof Error ? error.message : '답변에 남긴 선택을 저장하지 못했습니다.' });
    }
  }

  private async postHistory(): Promise<void> {
    await this.denialWrites;
    const error = this.currentTaskStore?.()?.getView().error;
    if (error) { await this.post({ type: 'taskWorkspaceError', error: error.message }); return; }
    const saved = this.getHistory();
    const pending = this.interruptedHistory && this.interruptedHistory.scope === this.turnRequestScope() ? this.interruptedHistory : undefined;
    const ids = new Set(saved.map(message => message.id));
    const messages = pending ? [...saved, ...pending.messages.filter(message => !ids.has(message.id))] : saved;
    await this.post({ type: "history", messages });
    await this.postContextTrim();
    await this.postVerdicts();
    if (pending) await this.post({ type: 'taskWorkspaceError', error: this.interruptedHistoryError(), historySaveFailed: true });
  }

  /**
   * REQ-STUDIO-CONTEXT-TRIM-MARKER — the clamp boundary from the SAVED history, the list the next
   * model call clamps (`conversation` in the turn). The webview's list also holds failed prompts
   * that were never saved, so only the host can say where the boundary is.
   */
  private async postContextTrim(): Promise<void> {
    await this.post({ type: "contextTrim", boundaryId: trimBoundaryId(this.getHistory()) });
  }

  private async appendHistory(msgs: ChatMessage[]): Promise<void> {
    const taskStore = this.currentTaskStore?.();
    if (taskStore) {
      const taskId = taskStore.getView().activeTaskId;
      if (!taskId) throw new Error('작업 기록을 열지 못했습니다. 저장소 오류를 확인해 주세요.');
      await taskStore.append(taskId, msgs);
      await this.post({ type: 'taskWorkspaceState', view: taskStore.getView() });
      await this.postContextTrim();
      return;
    }
    const current = this.getHistory();
    // #503 — the cap is counted on 'what was said'. Counting tool lines inside the
    // same 200 lets a single SDK turn (dozens of lines) push the entire conversation
    // history out.
    // A retry reuses its user-message id. Preserve the original position rather
    // than appending the same question again after a failed partial response.
    const merged = new Map(current.map(message => [message.id, message]));
    for (const message of msgs) merged.set(message.id, message);
    const next = clampTimeline([...merged.values()], HISTORY_MAX);
    await this.context.workspaceState.update(this.historyKey(), next);
    await this.postContextTrim();
  }

  /**
   * REQ-L12 ⑫ exception (ot-conversation-carryover) — the stores behind the trial carry-over offer.
   * The trial transcript is read from the trial's own task store and never written into the pass
   * history; only the visible summary message is (trialCarryoverHelpers.ts, trialCarryoverSource.ts).
   */
  private carryoverStores(): CarryoverStores {
    // A trial keeps its conversation in its own TaskWorkspaceStore (prepareTaskWorkspace); the
    // workspaceState key holds only pre-migration history, read when no store file exists yet.
    return carryoverStoresFor({
      globalStoragePath: this.context.globalStorageUri.fsPath,
      offers: this.context.globalState,
      legacyHistory: (trialId) => this.context.workspaceState.get<ChatMessage[]>(historyKeyForCohort(trialId), []),
      passHistory: () => this.getHistory(),
    });
  }

  /**
   * The learner's explicit answer. Confirm posts the summary as a visible app message in the pass
   * conversation (the coach reads it from the next turn's history). No SDK session, credential or
   * runtime state from the trial seat is reused: the pass runs on its own grant from a fresh start.
   */
  private async decideCarryover(decision: 'confirm' | 'decline'): Promise<void> {
    const activity = activityConnections(this.context)?.current;
    if (activity && !this.hasActiveStream()) {
      const profile = await this.ensureProfile();
      if (activityConnections(this.context)?.current?.id === activity.id) {
        await applyCarryoverDecision({ passId: activity.id, advertised: carryoverAdvertised(profile), decision, stores: this.carryoverStores(),
          appendSeed: (text) => this.postAppReply(text), now: Date.now() });
      }
    }
    await this.postConfig();
  }

  private historyKey(): string {
    return historyKeyForCohort(activityConnections(this.context)?.scope ?? this.nativeHistoryScope??this.activeCohortId);
  }

  private coachKey(): string {
    return coachKeyForCohort(activityConnections(this.context)?.scope ?? this.activeCohortId);
  }

  private coachRitualDoneKey(): string {
    return coachRitualDoneKeyForCohort(activityConnections(this.context)?.scope ?? this.activeCohortId);
  }

  private takeawayBusy = false;
  /** Explicit local copy remains available when AI has ended; no model/Service call. */
  async takeMyWork(): Promise<boolean> {
    const activity = activityConnections(this.context)?.current;
    const enabled = () => vscode.workspace.getConfiguration('hypeproofChat').get<boolean>('workTakeawayEnabled', false);
    if (this.takeawayBusy || !activity || !['trial', 'personal', 'classroom'].includes(activity.kind ?? '')) return false;
    const root = this.resolveCoachCwd();
    if (!root || root !== activity.workspace) return false;
    const generation = this.profileGeneration;
    const scope = this.turnRequestScope();
    const current = () => enabled() && this.isInstructor === false && !this.hasActiveStream() && !this.taskChanging && !this.connectionChanging
      && this.profileGeneration === generation && this.turnRequestScope() === scope && activityConnections(this.context)?.current?.id === activity.id
      && this.resolveCoachCwd() === root;
    if (!current()) return false;
    this.takeawayBusy = true;
    try {
      const store = this.currentTaskStore();
      if (store?.getView().error) throw new Error('task_read_failed');
      const secrets = [activity.token].filter((value): value is string => typeof value === 'string' && !!value);
      const tasks = store ? store.getView().tasks.map(task => takeawayTask(task.title, store.getHistory(task.id), secrets))
        : [takeawayTask('이 활동의 대화', this.getHistory(), secrets)];
      const owned = takeawayOwnedFiles(await loadLedger(provenanceLedgerFile(this.context.globalStorageUri.fsPath, root)));
      if (!current()) return false;
      return await runWorkTakeaway({ root, secrets, tasks, owned, wikiDirectory: path.basename(wikiDir(root, this.cachedProfile?.learning_wiki?.plan)), current });
    } catch { await vscode.window.showWarningMessage('내 작업 가져가기를 완료하지 못했어요. 원본은 그대로 있어요. 위치와 권한을 확인해 주세요.'); return false; }
    finally { this.takeawayBusy = false; }
  }

  private getHistory(): ChatMessage[] {
    const taskStore = this.currentTaskStore?.();
    if (taskStore) return taskStore.getHistory();
    return this.context.workspaceState.get<ChatMessage[]>(this.historyKey(), []);
  }

  private async migrateLegacyStateForActiveCohort(): Promise<void> {
    if(activityConnections(this.context) || this.nativeHistoryScope)return; // Legacy cohort-wide history has no participant provenance.
    const bucket = stateBucketId(this.activeCohortId);
    if (!bucket) return;

    const historyDone = this.context.globalState.get<boolean>(HISTORY_MIGRATION_DONE_KEY, false);
    if (!historyDone) {
      const targetKey = this.historyKey();
      const target = this.context.workspaceState.get<ChatMessage[]>(targetKey, []);
      const legacy = this.context.workspaceState.get<ChatMessage[]>(LEGACY_HISTORY_KEY, []);
      if (target.length === 0 && legacy.length > 0) {
        await this.context.workspaceState.update(targetKey, legacy);
      }
      await this.context.globalState.update(HISTORY_MIGRATION_DONE_KEY, true);
    }

    const coachDone = this.context.globalState.get<boolean>(COACH_MIGRATION_DONE_KEY, false);
    if (!coachDone) {
      const targetKey = this.coachKey();
      const target = this.context.globalState.get<CoachInfo | undefined>(targetKey, undefined);
      const legacy = this.context.globalState.get<CoachInfo | undefined>(LEGACY_COACH_KEY, undefined);
      if (!target && legacy) {
        await this.context.globalState.update(targetKey, legacy);
      }

      const targetDoneKey = this.coachRitualDoneKey();
      const targetDone = this.context.globalState.get<boolean | undefined>(targetDoneKey, undefined);
      const legacyDone = this.context.globalState.get<boolean>(LEGACY_COACH_RITUAL_DONE_KEY, false);
      if (targetDone === undefined && legacyDone) {
        await this.context.globalState.update(targetDoneKey, true);
      }
      await this.context.globalState.update(COACH_MIGRATION_DONE_KEY, true);
    }
  }

  /**
   * #503 — sends one tool line to the webview and leaves **the same line in this
   * turn's timeline** as well. A toolLog that does not pass through this single point
   * becomes a line that shows on screen but is not in the history, and disappears when
   * the window is reopened — the very symptom this issue is meant to catch.
   */
  private postToolLog(streamId: string, entry: ToolEntry): void {
    if (entry.denial) {
      const denial = denialNotice(entry.denial.source, entry.denial.classroom);
      entry = { id: entry.id, icon: '🔒', label: denialNoticeLabel(denial), state: 'error', ...(entry.at ? { at: entry.at } : {}) };
    }
    const t = this.turnTimelines.get(streamId);
    if (t) this.turnTimelines.set(streamId, timelineTool(t, entry, Date.now()));
    void this.post({ type: "toolLog", streamId, ...entry });
  }

  private async post(msg: HostMessage): Promise<boolean | void> {
    if(msg.type!=='outboundPrompt')this.outboundApproval?.invalidateIfScopeChanged();
    if(msg.type!=='writeApprovalPrompt') {
      if(['streamStart','inputRejected','streamEnd','streamStopped','streamError'].includes(msg.type))this.writeApprovalRequest?.cancel();
      else this.writeApprovalRequest?.invalidate();
    }
    if (msg.type === 'streamStart') this.lastActivityStatus = undefined;
    if (msg.type === 'streamError' && msg.activityUnavailable) this.lastActivityStatus = {scope:this.turnRequestScope(),message:msg};
    msg={...msg,activityId:msg.activityId ?? activityConnections(this.context)?.scope, taskId: msg.taskId ?? this.currentTaskStore?.()?.getView().activeTaskId ?? undefined} as HostMessage;
    const targets = [this.editorChat?.webview, this.view?.webview].filter((view): view is vscode.Webview => !!view);
    if (!targets.length) return;
    const results = await Promise.all(targets.map(view => view.postMessage(msg)));
    return results.some(Boolean);
  }

  renderHtml(webview: vscode.Webview, distDir: vscode.Uri): string {
    const indexPath = path.join(distDir.fsPath, "index.html");
    if (!fs.existsSync(indexPath)) {
      return /* html */ `<!doctype html><html><body style="font-family:sans-serif;padding:20px">
        <h3>HypeProof Chat — webview not built</h3>
        <p>Run <code>npm run build:webview</code> in <code>extensions/hypeproof-chat/</code>.</p>
      </body></html>`;
    }
    let html = fs.readFileSync(indexPath, "utf8");
    // Rewrite asset URIs (`./assets/x`, `/assets/x`, `assets/x`) to
    // vscode-resource scheme so the sandboxed iframe can fetch them.
    html = html.replace(
      /(src|href)="(?!https?:|data:|vscode-|#)([^"]+)"/g,
      (_m, attr: string, raw: string) => {
        const cleaned = raw.replace(/^\.?\//, "");
        const onDisk = vscode.Uri.joinPath(distDir, cleaned);
        return `${attr}="${webview.asWebviewUri(onDisk)}"`;
      },
    );
    const nonce = randomId();
    const csp = buildChatPanelCsp({ cspSource: webview.cspSource, nonce });
    html = html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);
    return withReducedMotionAttr(html, reduceMotionForced(vscode.workspace.getConfiguration("workbench").get("reduceMotion")));
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Is `targetPath` inside any of the currently-open workspace folders? Used by
 * the writeFile path-scope check (#115). Resolves both sides to absolute paths
 * before comparison so `..` traversal can't sneak past.
 *
 * Returns true when no workspace is open — we don't want to block writes in
 * dev/test scenarios that haven't opened a folder yet. The production path
 * always has a workspace via ensureWorkspace().
 */
/**
 * Canonicalize a path for containment comparison. realpath the nearest
 * EXISTING ancestor (the target itself may not exist yet — new-file writes),
 * then re-append the non-existing tail. Resolves macOS /var → /private/var
 * style symlinks so a canonicalized SDK path still matches the workspace root
 * (#384: without this every coach Write in a symlinked workspace auto-denied).
 */
const canonicalizeForCompare = canonicalizeExistingPath;

function isInsideWorkspace(targetPath: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return true;
  const resolved = canonicalizeForCompare(targetPath);
  for (const f of folders) {
    const root = canonicalizeForCompare(f.uri.fsPath);
    const rel = path.relative(root, resolved);
    if (rel === "" || !relativeEscapes(rel)) {
      return true;
    }
  }
  return false;
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/**
 * Pull renderable HTML out of an assistant message. Order of preference:
 *   1. ```html fenced block
 *   2. Full <!doctype html...> document anywhere in the text
 *   3. ```javascript or ```js block → wrap into a minimal HTML shell
 * Returns null if nothing renderable found.
 */
export function extractRenderableHtml(text: string): string | null {
  const htmlFence = /```(?:html|HTML)\s*\n([\s\S]*?)\n```/.exec(text);
  if (htmlFence) return htmlFence[1].trim();

  const doctype = /<!doctype\s+html[\s\S]*?<\/html\s*>/i.exec(text);
  if (doctype) return doctype[0];

  const jsFence = /```(?:javascript|js)\s*\n([\s\S]*?)\n```/.exec(text);
  if (jsFence) {
    const js = jsFence[1].trim();
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif;padding:12px}</style></head>
<body><script>
try { ${js} } catch (err) { document.body.innerHTML = '<pre style="color:#c00">'+ err +'</pre>'; }
</script></body></html>`;
  }

  return null;
}
