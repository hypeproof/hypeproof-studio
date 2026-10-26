import { useMenuTypeahead } from './menuTypeahead';
import { citationKindLabel } from './citationKind';
import { elapsedWorkLabel } from '../../src/turnElapsed';
import { useFileMentions } from './FileMentions';
import { PastedDraft } from './PasteChip';
import { fullDraft, visibleDraft, editVisible, replaceVisible, changePaste, longPaste, type DraftPart } from './pastedDraft';
import { TurnBoundary } from './TurnBoundary';
import { SketchDialog } from './SketchDialog';
import { CopyFeedbackRegion, CopyFeedbackOutlet } from './CopyFeedback';
import { ChatFindBar } from './ChatFindBar';
import { registerClosedText } from './chatFind';
import { ClassWindowNotice } from "./ClassWindowNotice";
import { SteerDelivery, type SteerDeliverySnapshot } from './SteerDelivery';
import { AccuracyEducation, useAccuracyEducation } from "./AccuracyEducation";
import './answerAttempts.css';
import { visibleAttempts, ATTEMPT_HISTORY_NOTE } from '../../src/answerAttempts';
import { AttemptPager } from './AttemptPager';
import { AnnotationTray } from "./AnnotationTray";
import { StyleTweakPanel } from "./StyleTweakPanel";
import { storedShell } from "../../src/shellDisplay";
import { aiCapabilityState } from "../../src/aiCapabilities";
import { PageAttachment } from './PageAttachment';
import { UndoToast, newUndoId, offerUndo, settleUndo } from './UndoToast';
import { denialNoticeView, storedDenialNotice } from "../../src/denialNotice";
import { downloadLineView } from "../../src/browserDownloadNotice";
import { DownloadLine } from "./DownloadLine";
import { ActivityStatus } from "./ActivityStatus";
import { accessFailure, type ActivityUnavailable } from "../../src/activityAvailability";
import { useAttachmentSendPreparation } from "./AttachmentSendPreparation";
import { AttachmentFailures, AttachmentFailureBadge, AttachmentFailureNotice, useAttachmentFailures } from "./AttachmentFailures";
import { ATTACHMENT_FAILURE_COPY, attachmentDisplayName, attachmentReadFailure, withAttachmentDeadline } from "../../src/attachmentFailure";
import { CitationRack as PersonalCitationRack } from './CitationPreview';
import type { RecoveredRequest, InlineEditDraft } from '../../src/activityDraft';
import { canReserveRecovery, recoveryFull } from '../../src/recoveryCapacity';
import type { TurnToolMode } from '../../src/turnTools';
import { FileContextChip } from "./FileContextChip";
import { ComposerTools, SelectedTool } from './ComposerTools';
import { TurnReviewBar } from './TurnReviewBar';
import { PageCard } from './PageCard';
import { MissingFolderNotice } from './MissingFolderNotice';
import { LowDiskBar } from './LowDiskBar';
import { PreviewRecoveryNotice } from './PreviewRecoveryNotice';
import { previewRecoveryNote, previewRecoveryView, type PreviewSignals } from '../../src/previewFailure';
import { bindComposerFocus, composerSurfacePress } from './composerFocus';
import { ChatIcon, CopyAnswer, ResponsePending, useChatViewport, useGrowingComposer, type IconKind } from './ChatDetails';
import { ConversationCopyStatus, useConversationCopy } from './ConversationCopy';
import { TASK_APPEARANCE_LABEL, useTaskAppearance } from './TaskAppearance';
import { COPY_CONVERSATION_LABEL } from '../../src/conversationCopy';
import { glyphIconKind, splitLeadingGlyph, stripLeadingGlyph } from './glyphIcon';
import { EditAction, EditPrompt, VersionPager } from './EditResend';
import { VerdictButtons, VerdictReasons } from './AnswerVerdict';
import { verdictTargets, type VerdictMap, type VerdictState } from '../../src/answerVerdict';
import { composerBlockedByEdit, EDIT_OPEN_NOTE, editableUserId, visibleVersions, type VersionPager as Pager } from '../../src/editResend';
import { useResponseAnnouncement } from './responseAnnouncer';
import { useConnectivity, useLiveRegion, guardSend, OFFLINE_BANNER_TEXT, OFFLINE_HELD_NOTES, type HeldNoteKind } from './connectivity';
import { imeComposing } from './imeGuard';
import { QuoteAction, useAnswerQuote } from './QuoteAction';
import { mergeQuoteIntoDraft, QUOTE_ROW_ATTR, QUOTE_SCOPE_ATTR, type AnswerQuote } from './quoteReply';
import { steerAtEnd, steerMarksAccept, steerMarksRefuse, steerMarkTarget, steerOffered, steerPress, STEER_LABEL, STEER_OFFLINE_NOTE, STEER_SENDING_MARK, STEER_STOP_FAILED_NOTE, STEER_STOP_TIMEOUT_MS, STEER_STOPPED_MARK, STEER_STOPPING_LABEL, type SteerMark } from './steerNow';
import { scrollBehavior } from './motion';
import { TEXT_SIZES, TEXT_SIZE_LABELS, normalizeTextSize } from '../../src/textSize';
import { CAPABILITY_CHANGE_COPY } from '../../src/aiCapabilities';
import { AccessControl } from './AccessControl';
import { AccessHeader } from './AccessHeader';
import { EffortControl } from './EffortControl';
import { ModelControl } from './ModelControl';
import { ChatPreferences } from './ChatPreferences';
import { ShortcutSheet, useShortcutSheetKey } from './ShortcutSheet';
import { NicknameSetting } from './NicknameSetting';
import { useDialogFocus } from './dialogFocus';
import { ReplyChoices } from './ReplyChoices';
import { SafetyNotice } from './SafetyNotice';
import { replyChoices } from './replyChoiceParser';
import { activityDetail, activityLabel, freeSeatEnded, freeSeatEndedNote, trialHeaderLine } from "./activityLabel";
import { RefusalBanner } from "./RefusalBanner";
import { errorBannerPresentation } from "./errorBannerPresentation";
import { TrialEndCard } from "./TrialEndCard";
import {NativeObservationPanel} from './NativeObservationPanel';
import { MissionHeader } from './MissionHeader';
import { recordShownBy, recordViewKey, stepViewOnPick, stepViewOnState, taskFlowSeat, type StepViewSettled } from './missionHeaderLogic';
import { EvidenceDrawer } from './EvidenceDrawer';
import { CompletionGate } from './CompletionGate';
import { LessonStepPanel } from './LessonStepPanel';
import { GoalStatusBar } from './GoalStatusBar';
import { StudentGoal } from './StudentGoal';
import type { StepWork } from '../../src/lessonFocus';
import { acceptGoalView, goalNoteFor, goalOfLesson, type GoalNote, type GoalSaveRequest, type StudentGoalView } from '../../src/studentGoal';
import { InstructorInbox } from './InstructorInbox';
import { MaterialsChips, MaterialsPanel } from './MaterialsPanel';
import { ActivityHomeContext } from './activityHome';
import { HelpRequest } from './HelpRequest';
import { acceptHelp } from '../../src/classroomHelp';
import { addImportRef, canUndoImport, dropImportRef, importIntoDraft, type ImportRef, type LastImport } from './draftImport';
import { isObservationFormat, showsObservationResults } from '../../src/nativeObservationContract';
import { CodeBlock, CodeBlockScope } from "./CodeBlock";
import { MarkdownText } from './MarkdownText';
import { DisconnectedChat } from "./StartPage";
import { Children, cloneElement, Fragment, isValidElement, useContext, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HeadingSlotContext } from "./headingSlot";
import { MyQuestions } from "./MyQuestions";
import { CoachRunState } from "./CoachRunState";
import { myQuestions, MY_QUESTION_ATTR } from "../../src/myQuestions";
import type {
  ChatConfig,
  ChatMessage,
  Citation,
  ResolvedProfile,
  SuggestionChip,
  UpdateOffer,
  UxConfig,
} from "../../src/protocol";
import type { LearningStatePayload } from "../../src/learningStateHelpers";
import { onHostMessage, patchWebviewState, postToHost, readWebviewState } from "./vscode";
import { LessonTip } from "./LessonTip";
import { WhatsNewPanel, WhatsNewSheet, useWhatsNew } from "./WhatsNew";
import { LESSON_TIP_STATE_KEY, lessonTipFor, prefillWithTip, readDismissed, withDismissed } from "./lessonTipModel";
import { ProjectIdeas } from "./ProjectIdeas";
import { PROJECT_IDEAS, PROJECT_IDEAS_MAX, PROJECT_IDEAS_STATE_KEY, ideaOfferFor, ideaOfferKey, readIdeaDismissals, withIdeaDismissal } from "./projectIdeasModel";
import { hasActivityThisTurn } from "../../src/chatTimeline";
import { groupDelegations, delegationGroups, parseDelegationId } from "../../src/delegationRow";
import { idleTurnHint, runningProgressStep } from "../../src/longStepHint";
import { DelegationGroup } from "./DelegationGroup";
import { guardHostPayload, PanelBoundary } from "./PanelBoundary";
import { CONTEXT_COMPACT_NOTE, CONTEXT_TRIM_NOTE, isCompactionLine, trimMarkerIndex } from "../../src/contextTrim";
import { currentDividerId, stepDividerLabel, stepDividers, type LessonStepMarks } from "../../src/lessonStepMarks";
import { composerLabel, copulaParticle, resolveCoachIdentity } from "../../src/coachIdentity";
import { errorIdTitle, profileAudience, reportButtonTitle, seatAudience, type SeatAudience } from "../../src/seatVocabulary";
import { classroomPanelsShown } from "../../src/classroomPanels";
import { decideEnter, draftAfterStop, shouldFlushQueue, shouldRestoreQueue } from "./sendQueue";
import { TaskActivity } from "./TaskActivity";
import { summarizeTaskActivity, validTaskActivityFact, type TaskActivityFact } from "../../src/taskActivity";
import {
  RUNNER_PHRASE_MS,
  isRunnerCohort,
  runnerFace,
  runnerPhrase,
  shouldShowRunner,
  type RunnerFace,
} from "./runner";

interface Props {
  config: ChatConfig | null;
  // #384 — image handed from the host (editor-tab image → attach to coach).
  incomingImage: { dataUrl: string; nonce: number; name?: string } | null;
  /**
   * #503 — a single timeline. user / assistant / tool are interleaved in the order
   * they happened. The `toolLog` prop that used to carry tool logs separately is gone
   * — that was what split the screen into two blocks.
   */
  messages: ChatMessage[];
  pageNotice: string | null;           // #308 — inline notice for "페이지를 코치에게"
  /** CR-09 — the picked element queued for the next turn (Curriculum Runtime only). */
  annotationsEnabled?: boolean;
  annotations?: import("../../src/annotationBatch").AnnotationView[];
  onAnnotationAction?: (action: 'element' | 'rectangle' | 'remove' | 'comment', number?: number, comment?: string) => void;
  elementPreview?: import("../../src/protocol").ElementPreview | null;
  onRemoveElement?: () => void;
  /** CGP-ART-R-006 — preview one offered style value on the picked element (null resets it). */
  onStyleTweakSet?: (id: string, prop: string, value: string | null) => void;
  /** CGP-ART-R-007 — the page text queued for the next turn, shown in full and removable. */
  pageAttachment?: import("../../src/pageContext").PageAttachmentPreview | null;
  /** CGP-CHAT-R-029 — `undoId`: the host keeps the removed page under it for 되돌리기. */
  onRemovePageAttachment?: (undoId?: string) => void;
  /** CGP-CHAT-R-011 — the work-folder file queued for the next turn, shown in full and removable. */
  fileAttachment?: import("../../src/protocol").FileAttachmentPreview | null;
  /** CGP-CHAT-R-011 — why the last picked file was refused (Korean, one per cause). */
  fileAttachError?: string | null;
  /** CGP-CHAT-R-011 — a one-line notice (a retry did not resend the file). */
  fileAttachNotice?: string | null;
  onAttachFile?: () => void;
  /** CGP-CHAT-R-029 — `undoId`: the host keeps the removed file under it for 되돌리기. */
  onRemoveFileAttachment?: (undoId?: string) => void;
  /** cr-verify — the "내 제품 테스트" panel, drawn above the composer when the host shows it. */
  verifyPanel?: import("react").ReactNode;
  /** cr-verify — a product test is driving the browser: nothing is sent until it ends. */
  sendLocked?: boolean;
  aiNotice: string | null;             // #320 — AI disclosure at session start
  stopNotice: string | null;           // #497 — notice that the turn was cut off by Stop
  /** REQ-STUDIO-STEER-NOW — the learner request the running turn answers (host streamStart), if any. */
  streamFor?: string | null;
  /** #649 — id of the world currently open (the host's worldOpened). Used only to highlight the strip. */
  openWorldId: string | null;
  /** Progress of "갤러리에 올리기". null = not pressed yet. */
  publish:
    | { state: "uploading" }
    | { state: "done"; url: string }
    | { state: "error"; message: string }
    | null;
  onPublish: () => void;
  /** One-click publish to GitHub Pages (shown when the host says `config.sitePublish`). */
  onPublishSite?: () => void;
  /** "프로젝트 변경": list the participant's GitHub projects and switch the class folder (same gate as publishing). */
  onSwitchProject?: () => void;
  streaming: boolean;
  /**
   * WHICH message is streaming, not just whether one is (#429). `streaming` is
   * a turn-level flag; handing it to every row made each FINISHED assistant
   * message re-render its in-progress spinner the moment a NEW turn started, so
   * "🛠️ 웹사이트 만드는 중… ✨" sat under a turn that had visibly ended. Row-level
   * progress has to key off identity; turn-level concerns (composer disabled,
   * retry buttons hidden) correctly stay on `streaming`.
   */
  streamingId: string | null;
  refusal?: boolean;
  onDismissRefusal?: () => void;
  error: string | null;
  activityUnavailable?: ActivityUnavailable;
  errorRequestId: string | null;
  errorRunbookUrl: string | null;  // #165 — render as clickable runbook link
  /** TUX-COND-07 — the end-of-trial card for this turn ending; drawn instead of the error banner. */
  trialEndCard?: import("../../src/protocol").TrialEndCardView | null;
  /** REQ-CGP-LEARN-13 — a moderation block for this turn ending; drawn instead of every other ending card. */
  safetyNotice?: import("../../src/safetyNotice").SafetyNoticeView | null;
  /** TUX-COND-07 — the card's Primary. The host opens the start page's pass list; nothing else does. */
  onTrialEndCardPasses?: () => void;
  canRetryLast: boolean;
  sendPending?: boolean;
  onSend: (text: string, images?: string[], imports?: ImportRef[], attachments?: StagedPhoto[], toolMode?: TurnToolMode) => void | boolean;
  onSelectAttempt?: (rootId: string, attemptId: string, choose: boolean) => void;
  onRetry: (prompt: string, source?: ChatMessage) => void;
  onRetryLast: () => void;
  /** CGP-CHAT-R-002 — resend an edited copy of the latest prompt. Absent (instructor mode): no "수정". */
  onEditResend?: (original: ChatMessage, editOf: string, text: string, images: string[]) => boolean | void;
  /** CGP-CHAT-R-005 — the learner's verdict per answer, and the setter. Absent: no verdict controls. */
  verdicts?: VerdictMap;
  /** REQ-STUDIO-CONTEXT-TRIM-MARKER — the host's clamp boundary id (null: nothing is left out). */
  trimBoundaryId?: string | null;
  /** CGP-CHAT-R-023 — the host's served-step mark per user message id. Absent: no step dividers. */
  stepMarks?: LessonStepMarks;
  /** REQ-STUDIO-DELEGATION-ROW — the stream running now; a delegation row is live only for it. */
  runningStreamId?: string | null;
  delegationStops?: Record<string, import("../../src/delegationStop").DelegationStopState>;
  onStopDelegations?: (streamId:string)=>void;
  progressSince?: number;
  progressApprovalPending?: boolean;
  /** REQ-STUDIO-COACH-RUN-STATE: how this view's last turn ended (App's lastOutcome); absent = none yet. */
  lastOutcome?: import("../../src/taskRunState").TaskTurnOutcome;
  /** REQ-STUDIO-COACH-RUN-STATE: the product test run (내 제품 테스트) is running. */
  verifyRunning?: boolean;
  onVerdict?: (messageId: string, next: VerdictState | null) => void;
  /** CGP-KNOW-R-004 — "팀 브레인에 정리하기" on one finished answer. Absent: no action. */
  onAnswerToWiki?: (messageId: string) => void;
  onDismissError: () => void;
  onCancel: () => void;
  onClear: () => void;
  onSetToken: () => void;
  onSettings: () => void;
  onRunCode: (html: string) => void;
  onNamingRitual: () => void;
  onSaveCoach: (name: string, personality: string) => void;
  onReportProblem: () => void;                          // #64
  onInstallUpdate: () => void;                          // #72
  onDismissUpdate: (version: string) => void;           // #72
  // #1298 — when true, student-only surfaces (MissionHeader, HelpRequest, artifact approval) are hidden.
  instructor?: boolean;
}

function extractRenderableHtml(text: string): string | null {
  const htmlFence = /```(?:html|HTML)\s*\n([\s\S]*?)\n```/.exec(text);
  if (htmlFence) return htmlFence[1].trim();
  const doctype = /<!doctype\s+html[\s\S]*?<\/html\s*>/i.exec(text);
  if (doctype) return doctype[0];
  const jsFence = /```(?:javascript|js)\s*\n([\s\S]*?)\n```/.exec(text);
  if (jsFence) {
    const js = jsFence[1].trim();
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:sans-serif;padding:12px}</style></head><body><script>try{${js}}catch(e){document.body.innerHTML='<pre style="color:#c00">'+e+'</pre>';}</script></body></html>`;
  }
  return null;
}

/** REQ-KNOW-35 — how often a visible panel asks the host to measure free space again. */
const LOW_DISK_POLL_MS = 60_000;

// Pasted-image context (website-copyclone). Bounds match the worker's
// translate.ts caps so a paste that the webview accepts is one the worker
// will also forward. Raw-file bytes here ≈ base64 chars there with headroom.
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3_500_000;   // ~3.5MB raw → ~4.7MB base64, under the worker's ceiling
const DOWNSCALE_MAX_DIM = 1600;      // longest side after downscale — plenty for reading a webpage layout

/** Estimate decoded byte size of a data: URL from its base64 payload length. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Turn a pasted image File into a data: URL that fits under MAX_IMAGE_BYTES —
 * a full-res Retina screenshot (which would otherwise be rejected) is scaled
 * down + re-encoded as JPEG so image paste "just works" for any screenshot.
 * All in-webview (canvas + data URLs) — CSP-safe, no external fetch.
 */
async function fitPastedImage(file: File): Promise<string> {
  const original: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
  // Already small enough → send as-is (keeps PNG crispness for tiny images).
  if (file.size <= MAX_IMAGE_BYTES) return original;
  return fitDataUrl(original);
}

/** #384 — downscale a data: URL (from the host "image opened" flow) the same
 *  way fitPastedImage handles a File. Already-small URLs pass through. */
async function fitDataUrl(original: string): Promise<string> {
  if (dataUrlBytes(original) <= MAX_IMAGE_BYTES) return original;
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = original;
  });

  let scale = Math.min(1, DOWNSCALE_MAX_DIM / Math.max(img.width, img.height));
  let quality = 0.85;
  let out = original;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(out) <= MAX_IMAGE_BYTES) return out;
    // Still too big → shrink dimensions, then bite into quality.
    if (attempt < 3) scale *= 0.75;
    else quality -= 0.15;
  }
  return out; // best effort — worker cap still guards the extreme tail
}

// hype-dental D-028 — photos attached as files (cohorts with `input.image_files`). The bytes
// go to the host's staging folder as they are; the host moves them into images/ on send and
// the model gets their paths. Limits mirror the host's attachedImages.ts.
const MAX_FILE_PHOTOS = 10;
const MAX_FILE_PHOTO_BYTES = 25 * 1024 * 1024;
interface StagedPhoto { id: string; name: string; thumb: string | null; ready: boolean; error?: string; repick?:boolean }

function newStageId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
}

/** A photo file? HEIC from an iPhone often arrives with an empty type, so the name counts too. */
function isPhotoFile(f: File): boolean {
  return f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** A small preview for the chip; null when the browser cannot draw the format (HEIC). */
async function photoThumb(dataUrl: string): Promise<string | null> {
  try {
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = dataUrl;
    });
    const scale = Math.min(1, 160 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

const DEFAULT_UX: UxConfig = {
  coach: {
    naming_mode: "fixed",
    fallback_name: "코치",
    naming_prompt_md: "",
    personality_prompt_md: "",
  },
  suggestions: { initial: [], follow_up: [] },
  hints: {
    short_input: { enabled: false, min_chars: 0, message_md: "" },
    roll_input_button: { enabled: false, label: "", probe_md: "" },
  },
  retry_button: { enabled: false, show_counter: false },
};

/** Find the user prompt that led to a given assistant message, walking backwards. */
function userPromptBefore(messages: ChatMessage[], assistantId: string): ChatMessage | null {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

export function ChatPanel(props: Props) {
  const accuracyOffer = useAccuracyEducation(props.config, props.instructor === true);
  const { config, messages, streaming, streamingId, error, incomingImage } = props;
  const [reopenedCapabilities, setReopenedCapabilities] = useState<string | null>(null);
  const entry = !props.instructor && config?.aiCapabilities ? config.lessonCapabilityEntry : undefined;
  useEffect(() => setReopenedCapabilities(null), [entry?.id]);
  const entryOpen = !!entry && (!entry.seen || reopenedCapabilities === entry.id);
  const saved = config?.activityDraft;
  const separateQueue = !!saved?.queued && (saved.queuedPaused === true || (saved.queuedToolMode ?? 'auto') !== (saved.toolMode ?? 'auto'));
  const [draftParts, setDraftParts] = useState<DraftPart[]>(() => [{ text: separateQueue ? saved?.text ?? '' : draftAfterStop(saved?.text ?? '', saved?.queued ?? null) }]);
  const draft = fullDraft(draftParts), composerText = visibleDraft(draftParts);
  const pasteId = useRef(0);
  // External replacements/imports operate on the complete draft and restore it inline.
  const setDraft = useCallback((value: string | ((previous: string) => string)) => setDraftParts(previous => {
    const before = fullDraft(previous), next = typeof value === 'function' ? value(before) : value;
    return next === before ? previous : [{ text: next }];
  }), []);
  const [toolMode, setToolMode] = useState<TurnToolMode>(saved?.toolMode ?? 'auto');
  const [queuedToolMode, setQueuedToolMode] = useState<TurnToolMode>(saved?.queuedToolMode ?? saved?.toolMode ?? 'auto');
  const [queuedPaused, setQueuedPaused] = useState(separateQueue);
  const [recovered, setRecovered] = useState<RecoveredRequest[]>(saved?.recovered ?? []);
  const recoveryAtCapacity = useMemo(() => recoveryFull(recovered), [recovered]);
  const [discardRequest, setDiscardRequest] = useState<RecoveredRequest | null>(null);
  // CGP-CHAT-R-002 — which version of each edited prompt is drawn (view only), and the line being edited.
  const [versionChoice, setVersionChoice] = useState<Record<string, number>>({});
  const [inlineEdit, setInlineEdit] = useState<InlineEditDraft | undefined>(saved?.inlineEdit);
  const [editingId, setEditingId] = useState<string | null>(saved?.inlineEdit?.messageId ?? null);
  const editFocusScope = useRef('');
  const [composing, setComposing] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [sketchOpen, setSketchOpen] = useState(false);
  // `usage`: the dialog was opened from "이용권 · 사용량" or the access recovery entry, so its usage
  // section opens with focus on it (the #1814 menu shortcut, kept inside the #1763 dialog).
  const [preferencesUsage, setPreferencesUsage] = useState(false);
  const openPreferences = (usage: boolean) => { preferencesOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPreferencesUsage(usage); setPreferencesOpen(true); };
  // CGP-SHELL-D-028: the classroom detail dialog mounts only while open, so its close button's
  // autoFocus runs before the focus hook could see the opener; remember the opener here instead.
  const preferencesOpener = useRef<HTMLElement | null>(null);
  // CGP-CHAT-R-030 — 키보드 단축키: opened by `?` outside a text field, or from the settings dialog.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsOpener = useRef<HTMLElement | null>(null);
  useShortcutSheetKey(!shortcutsOpen, () => { shortcutsOpener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; setShortcutsOpen(true); });
  // From settings: the settings dialog closes first, so focus later returns to what opened settings.
  const openShortcutsFromPreferences = () => { shortcutsOpener.current = preferencesOpener.current; setPreferencesOpen(false); setPreferencesUsage(false); setShortcutsOpen(true); };
  // CGP-SHELL-R-035 — "새로운 기능": once after an update above the composer, and later from settings.
  const [whatsNew, dismissWhatsNew] = useWhatsNew(props.config, props.instructor === true);
  const [whatsNewSheetOpen, setWhatsNewSheetOpen] = useState(false);
  const openWhatsNewFromPreferences = () => { shortcutsOpener.current = preferencesOpener.current; setPreferencesOpen(false); setPreferencesUsage(false); setWhatsNewSheetOpen(true); };
  const lastReplyChoice = useRef<{ messageId: string; answer: string } | null>(null);
  const [rollExpand, setRollExpand] = useState<{ original: string } | null>(null);
  // Pasted-image attachments for the next turn (data URLs). `imgNote` surfaces
  // a brief reason when a paste is rejected (too big / too many).
  const [pendingImages, setPendingImages] = useState<string[]>(config?.activityDraft?.images ?? []);
  const preparingImagesRef = useRef(0);
  const imagePreparationFailed = useRef(false);
  const deferredDraftFlush = useRef<string | null>(null);
  const [preparingImages, setPreparingImages] = useState(0);
  const beginImagePreparation = () => {
    if (!preparingImagesRef.current) {
      imagePreparationFailed.current = false;
      setImgNote(null);
    }
    preparingImagesRef.current++;
    setPreparingImages(preparingImagesRef.current);
    const finish = () => {
      preparingImagesRef.current--;
      setPreparingImages(preparingImagesRef.current);
    };
    return finish;
  };
  const imagePreparationBlocksSend = () => {
    if (!preparingImagesRef.current) return false;
    return true;
  };
  const [imgNote, setImgNote] = useState<string | null>(null);
  const imageNoteId = useId();
  // D-028 — photos staged in the host until this message is sent. Not part of the saved draft:
  // the host deletes staged files when the window closes.
  const photoMetadataKey=`hps.photo-metadata.${JSON.stringify([config?.activity?.id,config?.taskWorkspace?.activeTaskId])}`;
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>(()=>{
    try { const value=JSON.parse(sessionStorage.getItem(photoMetadataKey) ?? '[]');return Array.isArray(value) ? value.slice(0,10).filter(p=>p && typeof p.id==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.id) && typeof p.name==='string').map(p=>({id:p.id,name:attachmentDisplayName(p.name),thumb:null,ready:false,repick:true,error:'다시 열린 화면에서는 사진을 다시 골라 주세요. 작성한 글은 그대로예요.'})) : []; } catch { return []; }
  });
  useEffect(()=>{try{if(stagedPhotos.length)sessionStorage.setItem(photoMetadataKey,JSON.stringify(stagedPhotos.map(({id,name})=>({id,name}))));else sessionStorage.removeItem(photoMetadataKey);}catch{/* metadata only; no image bytes retained */}},[photoMetadataKey,stagedPhotos]);
  const discardedPhotos = useRef(new Set<string>());
  // #416 — the ONE message parked while a turn is running (null = none).
  const [queued, setQueued] = useState<string | null>(separateQueue ? saved?.queued ?? null : null);
  const [frozen, setFrozen] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // SX-01/SX-02 — the step currently being viewed. A **view state**. Not a completion judgment.
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  // CGP-CHAT-R-021 — lesson tips the learner closed, per served step; kept in this panel's webview state.
  const [dismissedTips, setDismissedTips] = useState<string[]>(() => readDismissed(readWebviewState<Record<string, unknown>>()));
  // CGP-SHELL-R-020 — idea lists the learner closed with "내가 정할래요", per task and answer.
  const [dismissedIdeas, setDismissedIdeas] = useState<string[]>(() => readIdeaDismissals(readWebviewState<Record<string, unknown>>()));
  // #751 F4 — local display state for the learner's step self-report; it is separate from task completion.
  const [lessonSteps, setLessonSteps] = useState<Record<string, 'in_progress' | 'submitted'>>({});
  // #751 G2 — the learner's saved work-surface entries for the current lesson digest, and the rehearsal send result.
  const [lessonWork, setLessonWork] = useState<{ sha256: string; work: Record<string, StepWork> } | null>(null);
  const [rehearsalResult, setRehearsalResult] = useState<{ state: "sending" | "sent" | "error"; verdict?: string; reasons?: string[]; message?: string } | null>(null);
  useEffect(() => onHostMessage((msg) => {
    if (msg.type === "lessonWorkState") setLessonWork({ sha256: msg.sha256, work: msg.work });
    if (msg.type === "rehearsalState") setRehearsalResult({ state: msg.state, verdict: msg.verdict, reasons: msg.reasons, message: msg.message });
  }), []);
  // AE-01 (#554) — the learner's own goal for the served lesson, as the host stored it: the newer, by revision, of the
  // goal the current `config` carries and the goal the host's save answers brought (they reach every chat view). Only
  // the answers are kept in state; `config` is read on every render, never copied once. A panel that mounted before its
  // lesson arrived (no config yet, or a first config without a profile under the same activity, so nothing remounts)
  // therefore draws the goal of the config that brings the lesson, and its first save starts from that goal's revision.
  // A goal never moves back to an older revision. The note under the editor is this view's own: the host echoes the id
  // of the save it answers, and only the view that sent that save shows "저장했어요." or the refusal. One save at a time
  // per view.
  const [goalAnswer, setGoalAnswer] = useState<StudentGoalView | null>(null);
  const studentGoal = acceptGoalView(goalAnswer, config?.studentGoal);
  const [goalNote, setGoalNote] = useState<GoalNote>(null);
  const goalRequest = useRef<string | null>(null);
  const [goalPending, setGoalPending] = useState(false);
  // A note belongs to the lesson it was made under.
  useEffect(() => {
    goalRequest.current = null;
    setGoalPending(false);
    setGoalNote(null);
  }, [config?.profile?.lesson?.sha256, config?.activity?.id]);
  useEffect(() => onHostMessage((msg) => {
    if (msg.type !== "goalState") return;
    // A malformed answer keeps the goal already shown.
    setGoalAnswer((prev) => guardHostPayload("goal-state", () => acceptGoalView(prev, msg.view), prev));
    const note = guardHostPayload("goal-state", () => goalNoteFor(msg, goalRequest.current), undefined);
    if (note === undefined) return;
    goalRequest.current = null;
    setGoalPending(false);
    setGoalNote(note);
  }), []);
  const sendGoalSave = (edit: GoalSaveRequest) => {
    if (goalRequest.current) return;
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    goalRequest.current = requestId;
    setGoalPending(true);
    setGoalNote(null);
    postToHost({ type: "goalSave", ...edit, requestId });
  };
  /**
   * SX-14·15·17 — the learning state the host computed and sent. **It is not
   * recomputed here.** null means this connection does not use learning events (it is
   * not `hps-observation/2`), and then region D is not drawn — an empty drawer left on
   * screen does nothing when pressed.
   */
  const [learning, setLearning] = useState<LearningStatePayload | null>(null);
  /**
   * SX-01/SX-02 — the step region A shows starts where the task's record stands, then follows the
   * student (`stepViewOnState`). Drawn from the first step, a reopened task offered an earlier
   * step's action as the Primary, and pressing it moved the record back.
   */
  const stepView = useRef<StepViewSettled>(null);
  const learningTask = useRef<string | null>(null);
  const pickStep = (stepId: string) => {
    stepView.current = stepViewOnPick(learningTask.current);
    setCurrentStepId(stepId);
  };
  /**
   * SX-01/SX-02 — the lesson and activity (`recordViewKey`) whose task record a learning state has
   * shown this screen (`recordShownBy`). Until then, on a seat that runs the task flow, region A's
   * Primary is busy: it is drawn from the profile at the first step, and a start pressed there
   * moved a task left mid-way back to that step (review of 2026-10-05). The key a state counts for
   * is the one of the last `config` message, read in message order (not from a render, which can
   * run after the next message).
   */
  const recordKeyNow = useRef(recordViewKey(config));
  const [recordShownFor, setRecordShownFor] = useState<string | null>(null);
  const awaitingRecord = taskFlowSeat(config?.profile) && recordShownFor !== recordViewKey(config);
  /** Drawer open/closed is a **view state**, so the webview owns it. Closed by default (SX-17). */
  const [drawerOpen, setDrawerOpen] = useState(false);
  // #751 U3 — instructor prompts imported into THIS draft (bodiless refs, saved with the draft, handed over with the send).
  const [imports, setImports] = useState<ImportRef[]>(() => config?.activityDraft?.imports ?? []);
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  // A draft that never imported an instructor prompt is saved exactly as before U3: no `imports` key at all.
  const draftPayload = () => ({...(inlineEdit ? {inlineEdit} : {}),...(recovered.length ? {recovered} : {}),text:draft,images:pendingImages,queued,...(imports.length?{imports}:{}),toolMode,...(queued !== null ? {queuedToolMode,...(queuedPaused?{queuedPaused:true}:{})} : {})});
  const snapshot = useRef(draftPayload());
  snapshot.current = draftPayload();
  const composerHasAttachments = useRef(false);
  composerHasAttachments.current = !!(pendingImages.length || stagedPhotos.length || imports.length);
  const activityId = config?.activity?.id;
  const taskId = config?.taskWorkspace?.activeTaskId ?? undefined;
  const attachmentFailures = useAttachmentFailures(JSON.stringify([activityId, taskId]));
  const attachmentSend = useAttachmentSendPreparation(JSON.stringify([activityId,taskId]));
  const composerFailures = [...attachmentSend.failures, ...attachmentFailures.items, ...stagedPhotos.filter(p=>p.error).map(p=>({id:p.id,name:p.name,reason:p.error!}))];
  // CGP-KNOW-D-020: the error summary is the one live region for an attachment failure; the sr-only announcer keeps
  // main's text (photo-only-send) but is hidden from assistive tech while it repeats a reason the summary carries.
  const noteInSummary = imgNote != null && composerFailures.some(f => f.reason === imgNote);
  const composerIdentity = [activityId,taskId,draft,pendingImages,stagedPhotos.map(p=>p.id).join("|"),imports,toolMode,queued,streaming,frozen,config?.activity?.verified,props.sendLocked,props.sendPending];
  const composerIdentityRef = useRef(composerIdentity); composerIdentityRef.current=composerIdentity;
  const photoSources = useRef(new Map<string, File>());
  // CGP-CHAT-R-029 — the state an undo offer was made against; an offer is valid only while it is unchanged.
  const undoScope = { activityId: activityId ?? null, taskId: taskId ?? null };
  const undoSubject = useRef({ pendingImages, stagedPhotos, draftParts, queued, streaming, file: props.fileAttachment, page: props.pageAttachment });
  undoSubject.current = { pendingImages, stagedPhotos, draftParts, queued, streaming, file: props.fileAttachment, page: props.pageAttachment };
  const photoReading = useRef(new Set<string>());
  const imageCount = useRef(pendingImages.length); imageCount.current = pendingImages.length;
  useEffect(() => () => {
    for (const id of photoSources.current.keys()) { discardedPhotos.current.add(id); postToHost({ type: 'discardStagedImage', stageId: id }); }
    photoSources.current.clear(); photoReading.current.clear();
  }, [activityId, taskId]);
  useEffect(() => {
    if (attachmentFailures.items.length || stagedPhotos.some(p => !!p.error)) imagePreparationFailed.current = true;
  }, [attachmentFailures.items.length, stagedPhotos]);

  const initialDraft = useRef(true);
  useEffect(() => {
    if (initialDraft.current) { initialDraft.current=false; return; }
    if (activityId) postToHost({type:"saveActivityDraft",activityId,taskId,draft:draftPayload()});
  }, [activityId,taskId,draft,pendingImages,queued,imports,toolMode,queuedToolMode,queuedPaused,recovered,inlineEdit]);
  // REQ-STUDIO-QUIT-GUARD: the host names an unsent queued message in the quit dialog.
  const hasQueued = queued !== null;
  useEffect(() => { postToHost({ type: "queueState", queued: hasQueued }); }, [hasQueued]);
  useEffect(() => {
    const off = onHostMessage(msg => {
      if (msg.activityId !== activityId || (msg.taskId && msg.taskId !== taskId)) return;
      if (msg.type === "inputRejected") {
        if(msg.photos?.length) setStagedPhotos(old=>[...old,...msg.photos!.filter(p=>!old.some(own=>own.id===p.id)).map(p=>({id:p.id,name:attachmentDisplayName(p.name),thumb:null,ready:true}))]);
        setSteerMarks(steerMarksRefuse);
        setSteerDelivery(null);
        const rejectedMode = msg.toolMode ?? 'auto';
        const current = snapshot.current;
        if (current.queued !== null || current.text.trim() || current.recovered?.length || composerHasAttachments.current || preparingImagesRef.current) {
          // A refusal belongs to its original request, never to the later parked
          // message or its attachments. Keep both durable and explicitly paused.
          const request = {text: msg.text, toolMode: rejectedMode, images: msg.images ?? []};
          setRecovered(items => items.some(item => item.text === request.text && item.toolMode === request.toolMode && JSON.stringify(item.images) === JSON.stringify(request.images)) ? items : [...items, request]);
          if (current.queued !== null) setQueuedPaused(true);
          return;
        }
        setDraft(d => d === msg.text ? d : draftAfterStop(d,msg.text));
        setToolMode(rejectedMode);
        if (msg.images?.length) setPendingImages(images => [...new Set([...images,...msg.images!])]);
      }
      if (msg.type === "activityFreeze" && activityId) {
        setFrozen(msg.frozen);
        if (!msg.frozen) { deferredDraftFlush.current = null; imagePreparationFailed.current = false; }
        if (msg.nonce) {
          if (preparingImagesRef.current) deferredDraftFlush.current = msg.nonce;
          else postToHost({type:"saveActivityDraft",activityId,taskId,draft:snapshot.current,nonce:msg.nonce,imagePreparationFailed:imagePreparationFailed.current});
        }
      }
      if (msg.type === "activityDraftError") setDraftError(msg.error);
    });
    return off;
  }, [activityId,taskId]);
  // Navigation already waits for this nonce-bound draft write. Do not acknowledge
  // a snapshot that omits an image still being read. Report failed preparation to
  // the same nonce-bound handshake; abandoned reads use the existing host timeout.
  useEffect(() => {
    const nonce = deferredDraftFlush.current;
    if (!nonce || preparingImages || !activityId) return;
    deferredDraftFlush.current = null;
    postToHost({type:"saveActivityDraft",activityId,taskId,draft:snapshot.current,nonce,imagePreparationFailed:imagePreparationFailed.current});
  }, [preparingImages,pendingImages,activityId,taskId]);
  // D-028 — retain a refused photo and its diagnosis until retry/removal. Or the host staged
  // one itself (dropped from Finder, it opened as a tab): draw its chip.
  useEffect(() => onHostMessage((msg) => {
    if (msg.type === "attachmentFailureResolved") { setStagedPhotos(old=>old.filter(p=>p.id!==msg.id)); return; }
    if (msg.type === "imageStageRefused") {
      setStagedPhotos((prev) => prev.map((p) => p.id === msg.stageId ? { ...p, ready: false, error: msg.reason } : p));
      setImgNote(msg.reason); // main's announcer and note (REQ-STUDIO-ATTACHMENT-FAILURE) stay; the chip and summary add to them.
      return;
    }
    if (msg.type !== "imageStagedByHost") return;
    const { stageId, name, dataUrl } = msg;
    if (discardedPhotos.current.has(stageId)) return;
    // A sibling acknowledgement does not resolve a refused photo. New attachment attempts clear the note.
    // CGP-KNOW-D-020: the refused photo itself now staged clears its own note (idempotent, so safe in an updater).
    setStagedPhotos((prev) => { const old = prev.find((p) => p.id === stageId); if (old?.error) setImgNote((n) => n === old.error ? null : n); return prev; });
    setStagedPhotos((prev) => (prev.some((p) => p.id === stageId) ? prev.map((p) => p.id === stageId ? { ...p, ready: true, error: undefined } : p) : [...prev, { id: stageId, name, thumb: null, ready: true }]));
    if (dataUrl) void photoThumb(dataUrl).then((thumb) => setStagedPhotos((prev) => prev.map((p) => (p.id === stageId ? { ...p, thumb } : p))));
  }), []);
  // SX-14·15·17 — take the learning state the host sent as-is. Why it is not filtered
  // by activity id: the gate is per **task**, and the host already sends only that
  // task's events.
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type === "config") recordKeyNow.current = recordViewKey(msg.config);
      if (msg.type !== "learningState") return;
      // A malformed state clears the evidence region and is reported once (a listener throw would fail
      // silently). The checks are pure, so running them first changes nothing for a good state.
      if (!guardHostPayload("learning-state", () => { void msg.state.task; stepViewOnState(stepView.current, msg.state); recordShownBy(msg.state); return true; }, false)) { setLearning(null); return; }
      setLearning(msg.state);
      learningTask.current = msg.state.task;
      const next = stepViewOnState(stepView.current, msg.state);
      stepView.current = next.settled;
      if (next.step) setCurrentStepId(next.step);
      if (recordShownBy(msg.state)) setRecordShownFor(recordKeyNow.current);
    });
    return off;
  }, []);
  // #751 U2 — notices/materials an instructor sent. Nothing is kept here as a record: the host reads the inbox from disk
  // and sends it; this panel asks again whenever it (re)appears, so a restart or a hidden sidebar loses nothing.
  const [inbox, setInbox] = useState<import("../../src/classroomInbox").InboxView | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => { if (msg.type === "inboxState") setInbox(msg.inbox); });
    const ask = () => { if (document.visibilityState !== "hidden") postToHost({ type: "inboxRequest" }); };
    ask(); document.addEventListener("visibilitychange", ask);
    const stop = () => { off(); document.removeEventListener("visibilitychange", ask); };
    return stop;
  }, []);
  // AE-15 / CGP-ART-R-002 — the last coach turn's file review. The host owns it and re-sends it on "ready"; null clears it.
  const [turnReview, setTurnReview] = useState<import("../../src/turnReviewView").TurnReviewView | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => { if (msg.type === "turnReviewState") setTurnReview(msg.view); });
    // Subscribe before asking: ready/config can precede this task-scoped panel's mount.
    postToHost({ type: "turnReviewRequest" });
    return off;
  }, []);
  // CGP-ART-R-020 — entries of a running turn, shown before the turn's history is saved. The host binds
  // each to the task it started in (onHostMessage drops another task's); a history load or a scope change
  // replaces them with what was persisted.
  const [liveActivity, setLiveActivity] = useState<TaskActivityFact[]>([]);
  useEffect(() => onHostMessage((msg) => {
    if (msg.type === "history") setLiveActivity([]);
    else if (msg.type === "taskActivityFact" && validTaskActivityFact(msg.fact)) setLiveActivity((list) => list.some((f) => f.id === msg.fact.id) ? list : [...list, msg.fact]);
  }), []);
  useEffect(() => { setLiveActivity([]); }, [activityId, taskId]);
  const [reviewFocus, setReviewFocus] = useState<{ path: string; seq: number; turnId: string } | null>(null);
  // REQ-STUDIO-PAGE-CARD — page cards of this task's coach turns, keyed by the chat row each sits under.
  const [pageCards, setPageCards] = useState<Map<string, import("../../src/pageCard").PageCardView>>(() => new Map());
  useEffect(() => {
    // A malformed payload becomes no cards and one report (a listener throw would fail silently).
    const off = onHostMessage((msg) => { if (msg.type === "pageCardsState") setPageCards(guardHostPayload("page-cards", () => new Map(msg.cards.map((c) => [c.anchorId, c])), new Map())); });
    postToHost({ type: "pageCardsRequest" });
    return off;
  }, []);
  // REQ-STUDIO-MISSING-TASK-FOLDER — the host says whether this task's folder is gone; asked again on mount,
  // when the panel comes back into view and when the window regains focus (the folder may have moved meanwhile).
  const [missingFolder, setMissingFolder] = useState<import("../../src/missingTaskFolder").MissingTaskFolderNotice | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => { if (msg.type === "missingTaskFolder") setMissingFolder(msg.notice); });
    const ask = () => { if (document.visibilityState !== "hidden") postToHost({ type: "missingTaskFolderRequest" }); };
    ask(); document.addEventListener("visibilitychange", ask); window.addEventListener("focus", ask);
    const stop = () => { off(); document.removeEventListener("visibilitychange", ask); window.removeEventListener("focus", ask); };
    return stop;
  }, []);
  // REQ-KNOW-35 (CGP-KNOW-R-019) — free space on the work folder's volume. The host also measures as every turn
  // starts and ends; the panel asks on mount, when it comes back into view, on focus and once a minute while visible.
  const [lowDisk, setLowDisk] = useState<import("../../src/lowDisk").LowDiskNotice | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => { if (msg.type === "lowDisk") setLowDisk(msg.notice); });
    const ask = () => { if (document.visibilityState !== "hidden") postToHost({ type: "lowDiskRequest" }); };
    postToHost({ type: "lowDiskRequest", mount: true });
    document.addEventListener("visibilitychange", ask); window.addEventListener("focus", ask);
    const timer = setInterval(ask, LOW_DISK_POLL_MS);
    // Render tests run this panel in Node: an always-on poll must not keep their process alive.
    (timer as unknown as { unref?: () => void }).unref?.();
    const stop = () => { off(); clearInterval(timer); document.removeEventListener("visibilitychange", ask); window.removeEventListener("focus", ask); };
    return stop;
  }, []);
  // REQ-STUDIO-PREVIEW-RECOVERY — the host measures the learner's preview tab (server state, HTTP status) and pushes it when a
  // browser tab changes; the panel asks again on mount, when it comes back into view and when the window regains focus.
  const [previewSignals, setPreviewSignals] = useState<PreviewSignals | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  // The line after a press that did not run (refused or failed). Only a press's answer (`result`) re-enables the button,
  // so a state pushed by a tab event while the host works does not invite a second press.
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type !== "previewRecovery") return;
      setPreviewSignals(msg.signals);
      if (msg.result) { setPreviewBusy(false); setPreviewNote(guardHostPayload("preview-recovery", () => previewRecoveryNote(msg.result!, msg.signals), null)); }
      else if (!msg.signals) setPreviewNote(null);
    });
    const ask = () => { if (document.visibilityState !== "hidden") postToHost({ type: "previewRecoveryRequest" }); };
    ask(); document.addEventListener("visibilitychange", ask); window.addEventListener("focus", ask);
    const stop = () => { off(); document.removeEventListener("visibilitychange", ask); window.removeEventListener("focus", ask); };
    return stop;
  }, []);
  // #751 native help — the host reads the learner, class connection and Service again for every draw; nothing is kept here.
  const [help, setHelp] = useState<import("../../src/classroomHelp").HelpView | null>(null);
  useEffect(() => {
    // The host numbers its draws; one that arrives after a newer draw (an older learner's, or an older read) is not shown.
    const off = onHostMessage((msg) => { if (msg.type === "helpState") setHelp((prev) => guardHostPayload("help", () => acceptHelp(prev, msg.help), null)); });
    const ask = () => { if (document.visibilityState !== "hidden") postToHost({ type: "helpRequest" }); };
    ask(); document.addEventListener("visibilitychange", ask);
    const stop = () => { off(); document.removeEventListener("visibilitychange", ask); };
    return stop;
  }, []);
  /**
   * #642/#649 (2026-08-20 review) — the **unguarded window** between pressing a friend
   * and the host sending streamStart. In between, the host fetches the world HTML +
   * engine (two round trips), archives them and writes index.html — hundreds of ms to
   * several seconds. `streaming` is still false, so the whole strip stayed live and the
   * runner stayed folded: a kid pressing 초코 and then 나비 right after made two world
   * opens overlap (exactly the symptom #642·#649 were meant to catch).
   */
  const [worldPending, setWorldPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Explicit recovery actions remove their own control. Return typing to the
  // existing draft without moving the viewport or resetting its selection.
  const recoverToComposer = (action: (() => void) | undefined) => {
    const editor = textareaRef.current;
    const selection = editor && [editor.selectionStart, editor.selectionEnd, editor.selectionDirection] as const;
    action?.();
    editor?.focus({ preventScroll: true });
    if (editor && selection) editor.setSelectionRange(...selection);
  };
  const imagePicker = useRef<HTMLInputElement>(null);
  useEffect(() => bindComposerFocus(() => textareaRef.current, activityId), [activityId]);
  /** Previous `streaming` value — the flush must fire on the edge, not the state. */
  const prevStreamingRef = useRef(streaming);

  // Once the host has started the turn (streamStart), `streaming` does the same job
  // from there on. Safety timer — so the buttons are never locked forever when opening
  // a world fails and the turn never starts at all (the kid reads that as a dead app).
  useEffect(() => {
    if (!worldPending) return;
    if (streaming) {
      setWorldPending(false);
      return;
    }
    const t = setTimeout(() => setWorldPending(false), 20000);
    // Written as `return () => …`, test/hook-order.smoke.mjs's static check reads this
    // line as an **early return of the component** (and counts every hook below it as a
    // violation) — so the cleanup function is named and then returned.
    const cancel = () => clearTimeout(t);
    return cancel;
  }, [worldPending, streaming]);

  /** Responding, or opening a world — the friend buttons and the runner read the same value. */
  const statusAudience = config?.activity?.kind === "classroom" || config?.profile?.activity_kind === "classroom" ? "classroom" : config?.activity ? seatAudience(config.activity) : profileAudience(config?.profile);
  const selectedAccess = config?.access?.view?.choices.find(c => c.id === config.access?.selected);
  const activityStatus = props.activityUnavailable ?? config?.activityUnavailable ?? accessFailure(selectedAccess?.state, statusAudience);
  const unavailable = !!activityStatus || frozen || (!!config?.activity && !config.activity.verified);
  const busy = streaming || worldPending || unavailable;
  // CGP-CHAT-R-007 — a selection inside one answer offers 인용하기; the quote joins the draft, never sends.
  const [answerQuote, dropAnswerQuote] = useAnswerQuote(!unavailable);
  const quoteAnswer = (quote: AnswerQuote) => {
    if (unavailable || composing) return;
    lastReplyChoice.current = null;
    setDraft(current => mergeQuoteIntoDraft(current, quote.block));
    dropAnswerQuote();
    document.getSelection?.()?.removeAllRanges?.();
    requestAnimationFrame(() => {
      const editor = textareaRef.current;
      if (!editor?.isConnected) return;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
  };
  // Escape: the button goes away, so focus returns to the composer (draft and caret untouched), not <body>.
  const dismissQuote = () => { dropAnswerQuote(); document.getSelection?.()?.removeAllRanges?.(); recoverToComposer(undefined); };

  const ux: UxConfig = config?.profile?.ux ?? DEFAULT_UX;
  // Image paste is a per-profile opt-in (website-copyclone). Default-off so
  // minor cohorts never expose the image flow — the worker enforces the same
  // gate server-side, this just keeps the UI honest (no thumbnail, plain text
  // paste). Absent on older cached /v1/profile responses → treated as off.
  const imagePasteEnabled = config?.profile?.input?.image_paste === true;
  const sketchAllowed = imagePasteEnabled && !props.instructor && !unavailable && pendingImages.length < MAX_IMAGES;
  const sketchAllowedRef = useRef(sketchAllowed);sketchAllowedRef.current = sketchAllowed;
  // D-028 — photos as files, paths only to the model. Takes over drop and paste where on.
  const imageFilesEnabled = config?.profile?.input?.image_files === true;
  // #649 — switching worlds is **click-only**. Only for cohorts whose profile carries
  // worlds (kids-quest), the friend strip is always up, right above the composer. It
  // must not disappear once the conversation has started — in v0.1.48, which had only
  // the first-screen chips, typing was the only way to change worlds, and that typing
  // overwrote the world the kid had already fixed up.
  const worlds: WorldChoice[] = config?.profile?.worlds ?? [];
  /**
   * Whether to show the gallery button. **The cohort profile decides** — only when the
   * worker's `publishing` is on (`enabled`) and the destination is the gallery
   * (`strategy`).
   *
   * The minor-cohort default is `local_only`, and that profile carries the decision as
   * a comment: "public publishing is turned on only after parental consent + the PII
   * design is finished". Opening the UI here alone still gets a 403 from the server
   * (fail closed), so this check is **about not showing a kid a button they do not
   * have**, not a security boundary.
   *
   * #748 — this used to look at `strategy` only. `enabled` was a value the worker
   * shipped down and nobody read. Now it reads **the same two values in the same
   * direction** as the host's `galleryPublishAllowed`. The reason for mirroring by hand
   * is the same as REQ-M33 — the webview is a separate vite app and does not import
   * extension-host modules. test/gallery-publish-gate.smoke.mjs locks the drift so the
   * two sides do not diverge.
   */
  const publishing = config?.profile?.publishing;
  // hype-dental D-025 — the Service decides per cohort whether the two classroom-operation panels
  // are drawn; absent → shown (classroomPanels.ts).
  const personalWorkspace = !!config?.taskWorkspace && !config?.profile?.lesson;
  // Sending is held (the draft stays) while the task's folder is missing.
  const folderMissing = personalWorkspace && !props.instructor && !!missingFolder;
  // CGP-CHAT-R-021 — the step the rail shows (the first before any is picked); no tip for the instructor console.
  const lessonTip = props.instructor ? null : lessonTipFor(config?.profile?.lesson, currentStepId);
  // CGP-CHAT-R-011 — the host grants it (sdk_tools.read, never instructors); the instructor surface never shows it.
  const fileAttachShown = config?.fileAttach === true && !props.instructor && !!props.onAttachFile;
  const responseAnnouncementText = useResponseAnnouncement(streaming, { personal: personalWorkspace, stopped: !!props.stopNotice, failed: !!error, scope: `${activityId ?? ""}/${taskId ?? ""}` });
  // CGP-SHELL-R-011 — offline banner and reconnect line; nothing is sent on reconnect.
  const connectivity = useConnectivity();
  // Malformed signals from the host draw no recovery line (and one report) instead of failing the chat's render.
  const previewView = guardHostPayload("preview-recovery", () => previewRecoveryView(previewSignals, connectivity.online), null);
  // One live region: the most recent line wins, so a reconnect is heard after a finished turn.
  // REQ-STUDIO-LONG-STEP-HINT — the hint's 20 s and 60 s lines go through this always-mounted region.
  const [longStepAnnouncement, setLongStepAnnouncement] = useState('');
  const liveAnnouncement = useLiveRegion([responseAnnouncementText, longStepAnnouncement, connectivity.announcement]);
  /** The one gate for every learner send: offline it sends nothing, keeps the draft or choice, and says where it is. */
  // CGP-CHAT-R-029 — every send path goes through here (send, resend of an unsent message, roll, world chip,
  // retry, edit): a send that went out makes every earlier removal final, so the 되돌리기 offer ends.
  const sendWhenOnline = (send: () => unknown, held: HeldNoteKind) => {
    const sent = guardSend(connectivity.online, send, () => setImgNote(OFFLINE_HELD_NOTES[held]));
    if (sent) settleUndo();
    return sent;
  };
  // CGP-CHAT-R-012 — "지금 방향 바꾸기": stop through the Stop path; the parked text goes on the end edge (steerNow.ts).
  const steerRef = useRef<true | null>(null);
  const steerFocus = useRef<Element | null>(null);
  const [steerPending, setSteerPending] = useState(false);
  const [steerDelivery, setSteerDelivery] = useState<SteerDeliverySnapshot | null>(null);
  const steerScope = JSON.stringify([activityId, taskId]);
  const clearSteerDelivery = useCallback(() => setSteerDelivery(null), []);
  useEffect(() => { setSteerDelivery(null); }, [steerScope]);
  useEffect(() => { if (error && !streaming) setSteerDelivery(null); }, [error, streaming]);
  const [steerMarks, setSteerMarks] = useState<SteerMark[]>([]);
  const steerShown = steerOffered({ streaming, queued, queuedPaused, sendLocked: props.sendLocked, unavailable });
  const steerNow = () => {
    const press = steerPress({ offered: steerShown, online: connectivity.online, pending: steerRef.current !== null });
    if (press === 'ignore') return;
    if (press === 'hold') { setImgNote(STEER_OFFLINE_NOTE); return; }
    steerFocus.current = document.activeElement?.classList?.contains('hps-queued-steer') ? document.activeElement : null;
    steerRef.current = true; setSteerPending(true); setImgNote(null);
    props.onCancel();
  };
  useEffect(() => {
    if (!steerPending) return;
    // The stop never landed: give up the steer. The text stays parked and goes when the turn ends.
    const timer = setTimeout(() => { if (steerRef.current === null) return; steerRef.current = null; setSteerPending(false); setImgNote(STEER_STOP_FAILED_NOTE); }, STEER_STOP_TIMEOUT_MS);
    // Named, not `return () => …`: test/hook-order.smoke.mjs reads that as an early return.
    const cancel = () => clearTimeout(timer);
    return cancel;
  }, [steerPending]);
  // "보냈어요" only once the host started the next turn; a send turned away (error before start) drops the marker.
  useEffect(() => { if (streaming) setSteerMarks((marks) => steerMarksAccept(marks, messages, props.streamFor)); else if (error) setSteerMarks(steerMarksRefuse); }, [streaming, error, props.streamFor, messages]);
  const steerMarkAfter = (id: string) => {
    const mark = steerMarks.find((m) => m.id === id);
    return mark ? <div className="hps-stop-notice hps-steer-mark" role="note"><span className="hps-stop-notice-icon"><ChatIcon kind="stop" size={16} /></span>{mark.sent ? STEER_STOPPED_MARK : STEER_SENDING_MARK}</div> : null;
  };
  // Trial diagnosis D3 — solo seats (trial/pass/personal) get no classroom/operator words.
  const audience: SeatAudience = config?.activity ? seatAudience(config.activity) : profileAudience(config?.profile);
  const funding = config?.access;
  const fundingChoice = funding?.view?.choices.find(choice => choice.id === funding.selected);
  const accessNeedsAttention = !!funding && (funding.status === 'unknown' || !!funding.notice ||
    (!!funding.view?.required && !funding.selected) || (!!fundingChoice && (!fundingChoice.available ||
      !!config?.profile?.model_selection?.choices.some(model => model.alias === config.model && !fundingChoice.allowed.models.includes(model.id)))));
  const viewport = useChatViewport(scrollRef, personalWorkspace, messages, normalizeTextSize(config?.textSize));
  const headingSlot = useContext(HeadingSlotContext);
  // CGP-KNOW-R-002: inside a task workspace whose rail has the 자료 view, the list lives there, not here.
  const { materialsHome } = useContext(ActivityHomeContext);
  const setVisibleDraft = useCallback((value: string | ((previous: string) => string)) => setDraftParts(previous => editVisible(previous, typeof value === 'function' ? value(visibleDraft(previous)) : value)), []);
  const fileMentions = useFileMentions({ enabled: config?.fileMentions === true && !props.instructor && !unavailable, draft: composerText, setDraft: setVisibleDraft, editor: textareaRef, composing, activityId, taskId });
  const composerExpanded = useGrowingComposer(textareaRef, personalWorkspace || !!props.fileAttachment, composerText, !!props.fileAttachment || pendingImages.length > 0 || stagedPhotos.length > 0 || toolMode === 'web-search');
  const classroomPanels = classroomPanelsShown(config?.profile, personalWorkspace);
  // TUX-SP-13 — a trial seat's personal workspace has no mission header, so its passive remaining
  // line sits in the chat header. Text only (CU-13): no button, no offer. A pass is never read as a trial.
  const trialLine = personalWorkspace && config?.activity && !config.activity.pass ? trialHeaderLine(config.activity.trial, Date.now(), !!config.activity.free) : null;
  // CONV-ENDCARD-R-003 — after the end card is closed (`오늘은 여기까지`) an ended free seat keeps the
  // way back to the pass list one press away: a quiet header link and a line above the composer.
  // While the card itself is on screen it is the only offer, so neither is drawn then.
  const freeEnded = personalWorkspace && config?.activity && !(error && props.trialEndCard) ? freeSeatEnded(config.activity) : null;
  const galleryEnabled =
    publishing?.enabled === true && publishing?.strategy === "hypeproof_gallery";
  // #140 / #747 — one identity rule shared with the host (coachIdentity.ts):
  // a fixed cohort or lesson name wins over any stored student name.
  const coachName = resolveCoachIdentity(config?.coach, { ux }).name;
  // CGP-CHAT-R-024 — the personal task's own conversation, copied as Markdown from the task menu.
  // Exactly the conversation as drawn: one version per prompt (the one on screen), never hidden attempts.
  const drawnConversation = useMemo(() => visibleVersions(visibleAttempts(messages).items, versionChoice).items, [messages, versionChoice]);
  const taskAppearance = useTaskAppearance();
  const taskActivity = useMemo(() => summarizeTaskActivity(drawnConversation, liveActivity), [drawnConversation, liveActivity]);
  const conversationCopy = useConversationCopy(JSON.stringify([activityId ?? null, taskId ?? null]), {
    messages: drawnConversation,
    title: config?.taskWorkspace?.tasks.find(task => task.id === taskId)?.title,
    coachName,
  });

  // Tone for hard-coded chat-panel labels — game (kids) vs search-webapp
  // (예시치과 teaser) vs website (치과 원장 copyclone) vs world
  // ("내가 만든 미래"). Centralized in chatPanelHelpers (appToneOf/TONE_LABELS)
  // but mirrored here so the webview stays vscode-free (chatPanelHelpers
  // imports Node `Buffer`).
  //
  // ⚠ If this mirror drifts, the wrong word shows on screen. On 2026-08-17, on a real
  // device, the kids-world (now kids-quest) track put up "게임 만드는 중" — that
  // curriculum forbids the "게임" frame. test/tone-mirror.smoke.mjs forces the two
  // places to agree. When adding a tone, fix both sides.
  const templateTier =
    (config?.profile as { game?: { template_tier?: string } } | undefined)?.game?.template_tier;
  const appTone: "game" | "search" | "site" | "quest" =
    templateTier === "search-webapp"
      ? "search"
      : templateTier === "website"
        ? "site"
        : templateTier === "kids-quest"
          ? "quest"
          : "game";
  const buildingLabel =
    appTone === "search"
      ? "검색엔진 만드는 중"
      : appTone === "site"
        ? "웹사이트 만드는 중"
        : appTone === "quest"
          ? "생각 중…"
          : "게임 만드는 중";
  // REQ-STUDIO-STROKE-ICONS: the naming card's tone mark is a stroke icon, not an emoji.
  const namingIcon: IconKind =
    appTone === "search" ? "search" : appTone === "site" ? "globe" : appTone === "quest" ? "sparkle" : "game";

  // Show the kid-friendly naming card when: profile loaded, it asks the kid to
  // name the coach, and they haven't yet.
  const [forceNaming, setForceNaming] = useState(false);

  const needsNaming =
    !!config?.profile &&
    config.profile.ux.coach.naming_mode === "user_names_it" &&
    !config.coach?.configured;

  useEffect(() => {
    if (!personalWorkspace) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: scrollBehavior() });
  }, [messages.length, streaming, personalWorkspace]);

  // NOTE: the early return into the naming card sits **below this component's last
  // hook**. It must not go here (between hooks) — see the "Hook order" comment below.

  const reserveRecovery = (text: string, images: string[] = pendingImages, mode: TurnToolMode = toolMode) => {
    if (canReserveRecovery(recovered, {text, images, toolMode: mode})) return true;
    setImgNote(recovered.length
      ? '보관한 메시지를 먼저 다시 보내거나 정리해 주세요. 지금 작성한 내용과 사진은 그대로입니다.'
      : '메시지와 사진이 너무 커서 보내지 않았어요. 내용을 나누거나 사진을 줄여 주세요. 입력한 내용은 그대로입니다.');
    return false;
  };
  const submit = (text?: string, mode: TurnToolMode = toolMode) => {
    // CGP-CHAT-R-002 — an open edit box owns the next turn; never drop its text by sending past it.
    if (composerBlockedByEdit(editingId, editableId)) { setImgNote(EDIT_OPEN_NOTE); return false; }
    if (attachmentFailures.items.length) return false; // The persistent error summary owns this diagnosis.
    if (imagePreparationBlocksSend()) return false;
    // REQ-STUDIO-MISSING-TASK-FOLDER — held while the task's folder is missing; the draft stays. A press
    // asks the host to look again. Recovery never sends a draft without a fresh send action.
    if (folderMissing) {
      if (text === undefined) postToHost({ type: "missingTaskFolderRequest" });
      return false;
    }
    const value = (text ?? draft).trim();
    if ((!value && pendingImages.length === 0 && stagedPhotos.length === 0) || streaming || unavailable || props.sendLocked || props.sendPending) return false;
    if (stagedPhotos.some((p) => !p.ready)) { setImgNote("사진을 준비하는 중이에요. 잠시 뒤에 다시 보내 주세요."); return false; }
    if (!reserveRecovery(value, pendingImages, mode)) return false;
    if (personalWorkspace) viewport.toLatest();
    // `text` given = the PARKED message going out when the turn ended (#416). It is its own message: it never contained the
    // prompt the learner imported into the draft meanwhile, so it carries no import reference — and the draft typed while
    // waiting is not thrown away with it (observed in the browser run: the parked send took the draft's provenance and
    // emptied the input). Pasted images still ride along with the next turn that goes out, as #416 defined.
    const parked = text !== undefined;
    const sendPrepared = () => {
    if (!sendWhenOnline(() => props.onSend(value, pendingImages.length > 0 ? pendingImages : undefined, !parked && imports.length ? imports : undefined, stagedPhotos.length > 0 ? stagedPhotos : undefined, mode), parked ? 'kept' : 'draft')) return false;
    if (!parked) { setDraft(""); setImports([]); setLastImport(null); setImportNote(null); }
    setPendingImages([]);
    // The host now owns these files (it moves them into images/), so no discard here.
    setStagedPhotos([]);
    setImgNote(null);
    setRollExpand(null);
      if (parked) setQueued(null);
      return true;
    };
    if (pendingImages.length || stagedPhotos.length) {
      if (attachmentSend.busy) return false;
      const identity = composerIdentityRef.current;
      void attachmentSend.prepare([
        ...stagedPhotos.map(p=>({id:p.id,stageId:p.id})),
        ...pendingImages.map((dataUrl,index)=>({id:`pasted-${index}`,dataUrl})),
      ]).then(ok=>{
        if (!ok) return;
        if (!identity.every((value,index)=>value===composerIdentityRef.current[index])) { setImgNote("파일을 준비했어요. 작성한 내용을 확인하고 다시 보내 주세요."); return; }
        sendPrepared();
      });
      return false;
    }
    return sendPrepared();
  };

  const retryRecovered = (request: RecoveredRequest) => {
    if (streaming || frozen || unavailable || props.sendLocked || props.sendPending) return;
    // Send only this request's images; later staged photos/imports belong to the
    // untouched composer. A refused send keeps the recovery item for another try.
    if (!sendWhenOnline(() => props.onSend(request.text, request.images.length ? request.images : undefined, undefined, undefined, request.toolMode), 'kept')) return;
    setRecovered(items => items.filter(item => item !== request));
    textareaRef.current?.focus({preventScroll: true});
  };

  const editRecovered = (request: RecoveredRequest) => {
    if (streaming || frozen || props.sendPending || props.sendLocked) return;
    if (draft.trim() || pendingImages.length || preparingImagesRef.current || stagedPhotos.length || imports.length) {
      setImgNote('작성 중인 메시지를 먼저 보내거나 입력창을 비운 뒤 수정해 주세요. 두 메시지는 그대로 보관되어 있습니다.');
      return;
    }
    setDraft(request.text); setToolMode(request.toolMode); setPendingImages(request.images);
    setRecovered(items => items.filter(item => item !== request));
    setImgNote(null); textareaRef.current?.focus({preventScroll: true});
  };

  // #416 — the turn ended: send the message the participant parked during it.
  // Edge-triggered (see shouldFlushQueue): firing while `streaming` is still
  // true would hit submit()'s own guard and silently drop the message.
  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    // CGP-CHAT-R-012 — with a steer pending, the learner's own stop is not a cut-off: this edge sends the parked text.
    const steer = steerAtEnd(prev, streaming, steerRef.current !== null, !!props.stopNotice, !!error);
    if (steer) { steerRef.current = null; setSteerPending(false); }
    const cutOff = steer ? steer.cutOff : !!props.stopNotice || !!error;
    // #751 U4 — a turn the instructor cut off hands the parked message back, exactly like the learner's own Stop. Never sent.
    if (queuedPaused) return;
    if (shouldRestoreQueue(prev, streaming, queued, cutOff)) { restoreQueuedToDraft(); return; }
    if (queuedPaused || unavailable || folderMissing || !shouldFlushQueue(prev, streaming, queued, cutOff)) return;
    // cr-verify — a product test holds the tab: the parked message goes back to the draft, never lost.
    if (props.sendLocked) { restoreQueuedToDraft(); return; }
    const text = queued as string;
    // A staging/pending-send guard can refuse this edge. Keep the message and
    // its mode until acceptance; a paused item gives it an explicit retry path
    // instead of silently losing it or sending later on an unrelated render.
    const stoppedAt = steer?.stoppedHere ? steerMarkTarget(messages) : undefined;
    if (submit(text, queuedToolMode)) { setQueued(null); if (steer) { setSteerDelivery({ text, from: messages.length, scope: steerScope }); if (steerFocus.current && (document.activeElement === steerFocus.current || document.activeElement === document.body)) textareaRef.current?.focus({ preventScroll: true }); steerFocus.current = null; } if (stoppedAt) setSteerMarks((marks) => [...marks, { id: stoppedAt, sent: false, from: messages.length }]); }
    else {
      setQueuedPaused(true);
      setImgNote(note => note ?? '메시지를 보내지 못해 보관했습니다. 준비가 끝나면 보관한 메시지의 보내기를 눌러 주세요.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, queued, queuedPaused]);

  /**
   * #751 U3 — the learner pressed `초안에 가져오기`. One functional update of the draft: it merges into whatever the draft is
   * at the moment it is applied, so nothing typed between drawing the card and pressing the button can be lost. It appends,
   * it never replaces; attachments and a parked message are not touched; nothing is sent.
   */
  const importPrompt = (card: { object_id: string; revision: number; body: string; content_hash?: string }) => {
    if (frozen) return;
    const before = snapshot.current.text, merged = importIntoDraft(before, card.body);
    if (!merged.ok) { setImportNote(merged.reason === "too_long" ? "입력창이 가득 차서 가져오지 못했습니다. 입력한 글은 그대로입니다." : null); return; }
    setDraft((d) => { if (d === before) return merged.draft; const again = importIntoDraft(d, card.body); return again.ok ? again.draft : d; });
    setLastImport({ before, after: merged.draft, object_id: card.object_id, revision: card.revision });
    setImports((refs) => addImportRef(refs, { object_id: card.object_id, revision: card.revision, hash16: (card.content_hash ?? "").slice(0, 16).padEnd(16, "0") }));
    setImportNote(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };
  /** Only while the draft is byte-identical to the just-imported state; after one keystroke it is the learner's text. */
  const undoImport = () => {
    const last = lastImport; if (!last) return;
    setDraft((d) => (canUndoImport(d, last) ? last.before : d));
    if (canUndoImport(snapshot.current.text, last)) { setImports((refs) => dropImportRef(refs, last)); setLastImport(null); }
  };

  /**
   * CGP-CHAT-R-029 — the queued item's ×: as before, its text goes back to the draft (never away), and
   * 되돌리기 queues it again exactly as it was, while the draft is untouched and the turn it waits for is
   * still running (a paused item waits for nothing). A mismatched tool mode only pauses: nothing is removed.
   */
  const cancelQueued = () => {
    if (queued === null) return;
    if (draft.trim() && toolMode !== queuedToolMode) { restoreQueuedToDraft(); return; }
    const before = { parts: draftParts, queued, queuedToolMode, toolMode, paused: queuedPaused };
    const text = draftAfterStop(draft, queued);
    const after: DraftPart[] = text === draft ? draftParts : [{ text }];
    setDraftParts(after);
    setToolMode(queuedToolMode);
    setQueued(null); setQueuedPaused(false);
    const valid = () => undoSubject.current.draftParts === after && undoSubject.current.queued === null && (before.paused || undoSubject.current.streaming);
    offerUndo({
      kind: 'queued', scope: undoScope,
      undo: () => {
        if (!valid()) return;
        setDraftParts(before.parts); setToolMode(before.toolMode);
        setQueued(before.queued); setQueuedToolMode(before.queuedToolMode); setQueuedPaused(before.paused);
      },
      stillValid: valid,
    });
  };

  /** Stop / cancel-reservation: the parked text goes back to the draft, never away. */
  const restoreQueuedToDraft = () => {
    if (queued === null) return;
    if (draft.trim() && toolMode !== queuedToolMode) {
      setQueuedPaused(true);
      setImgNote('도구가 다른 메시지는 따로 보관했습니다. 현재 입력을 보낸 뒤 가져오거나, 보관한 메시지를 먼저 보내세요.');
      return;
    }
    setDraft((d) => draftAfterStop(d, queued));
    setToolMode(queuedToolMode);
    setQueued(null); setQueuedPaused(false);
  };

  // Shared attach path for both clipboard paste (⌘V) and drag-and-drop.
  // Downscales oversized screenshots instead of rejecting them (#384), bounds
  // the count, and surfaces a brief note on limit/failure.
  const attachImageFiles = (imageFiles: File[]) => {
    for (const f of imageFiles) {
      const finish = beginImagePreparation();
      const id = newStageId();
      void attachmentFailures.attempt(id, f.name, () => withAttachmentDeadline((async () => {
        if (!f.size) throw Object.assign(new Error('empty'), { code: 'EMPTY' });
        return fitPastedImage(f);
      })()), url => {
        if (imageCount.current >= MAX_IMAGES) throw Object.assign(new Error('count'), { code: 'COUNT' });
        imageCount.current++;
        setPendingImages(prev => [...prev, url]);
      }).finally(finish);
    }
  };

  // D-028 — keep dropped or pasted photos as files in the host until the message is sent.
  const stagePhoto = (id: string, f: File) => {
    if (photoReading.current.has(id)) return;
    setStagedPhotos(prev => prev.map(p => p.id === id ? { ...p, ready: false, error: undefined } : p));
    const refusal = !isPhotoFile(f) ? ATTACHMENT_FAILURE_COPY.unsupported
      : !f.size ? ATTACHMENT_FAILURE_COPY.empty
      : f.size > MAX_FILE_PHOTO_BYTES ? '사진이 너무 커요(25MB까지). 크기를 줄여 다시 붙여 주세요.' : null;
    if (refusal) { setStagedPhotos(prev => prev.map(p => p.id === id ? { ...p, error: refusal } : p)); return; }
    photoReading.current.add(id);
    void withAttachmentDeadline(readAsDataUrl(f)).then(url => {
      if (discardedPhotos.current.has(id)) return;
      postToHost({ type: 'stageImage', activityId, taskId, stageId: id, name: f.name, mime: f.type, base64: url.slice(url.indexOf(',') + 1) });
      void withAttachmentDeadline(photoThumb(url)).then(thumb => setStagedPhotos(prev => prev.map(p => p.id === id ? { ...p, thumb } : p))).catch(() => {});
    }).catch(error => {
      setStagedPhotos(prev => prev.map(p => p.id === id ? { ...p, error: attachmentReadFailure(error) } : p));
    }).finally(() => photoReading.current.delete(id));
  };
  const stagePhotoFiles = (files: File[]) => {
    // A new pick starts a fresh composer note; a still-failed chip keeps its own alert and retry.
    setImgNote(null);
    let count = stagedPhotos.length;
    for (const f of files) {
      if (count++ >= MAX_FILE_PHOTOS) { setImgNote(`사진은 한 번에 ${MAX_FILE_PHOTOS}장까지 보낼 수 있어요.`); break; }
      const id = newStageId();
      photoSources.current.set(id, f);
      setStagedPhotos(prev => [...prev, { id, name: f.name, thumb: null, ready: false }]);
      stagePhoto(id, f);
    }
  };

  // #384 — attach an image handed over by the host (an image opened in an
  // editor tab, e.g. a dropped screenshot). Same downscale + thumbnail path as
  // paste, just from a data URL. Re-runs on nonce so the same file re-attaches.
  const incomingNonce = incomingImage?.nonce;
  useEffect(() => {
    if (!incomingImage || !imagePasteEnabled) return;
    const finish = beginImagePreparation();
    void attachmentFailures.attempt(newStageId(), incomingImage.name ?? "이미지", () => withAttachmentDeadline(fitDataUrl(incomingImage.dataUrl)), url => {
      if (imageCount.current >= MAX_IMAGES) throw Object.assign(new Error('count'), { code: 'COUNT' });
      imageCount.current++;
      setPendingImages(prev => [...prev, url]);
    }).finally(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingNonce]);

  // Clipboard paste of an image (e.g. ⌘⌃⇧4 screenshot → ⌘V) attaches it to the
  // next turn instead of pasting raw text. A normal text paste falls through
  // to the textarea default (we only preventDefault when we found image data).
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (folderMissing) { e.preventDefault(); return; }
    if (unavailable || composing) return;
    const imageFiles: File[] = [];
    if (imagePasteEnabled || imageFilesEnabled) for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) { const file = item.getAsFile();if (file) imageFiles.push(file); }
    }
    if (imageFiles.length) {
      e.preventDefault();
      if (imageFilesEnabled) stagePhotoFiles(imageFiles);else attachImageFiles(imageFiles);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (!longPaste(text)) return;
    e.preventDefault();
    const start = e.currentTarget.selectionStart, end = e.currentTarget.selectionEnd;
    const next = replaceVisible(draftParts, start, end, { id: ++pasteId.current, text });
    if (fullDraft(next).length > 200000) { setImgNote('입력할 수 있는 글의 길이를 넘었어요. 글을 나누어 붙여넣어 주세요.');return; }
    lastReplyChoice.current = null;setDraftParts(next);
    requestAnimationFrame(() => { textareaRef.current?.focus();textareaRef.current?.setSelectionRange(start, start); });
  };

  // #384 — drag a screenshot file from Finder/desktop straight onto the input.
  // Same attach path as paste. dragover must preventDefault so drop fires.
  const [dragActive, setDragActive] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Hook order — do not add hooks below this line. The early return is here.
  //
  // The naming card renders only when `needsNaming` is true. If that return sits
  // **between** hooks, the hook count differs per render and React crashes:
  //
  //   before naming (needsNaming=true) → return → N hooks
  //   kid saves the name → coach.configured=true
  //   after naming (needsNaming=false) → falls through → N+3 hooks   ← React #310
  //   (the other direction — config arriving late, `코치 이름 다시 짓기` → fewer hooks → React #300)
  //
  // Every student must pass through the naming ritual, so this transition happens 100%
  // of the time on the normal path.
  // Both directions, #300 and #310, reproduced in the 2026-08-10 real-device session (2/2).
  // ErrorBoundary catches it, it drops to "화면을 그리다가 멈췄어요", and only "다시 열기" recovers.
  //
  // If you need a new hook, add it **above** this block.
  // ─────────────────────────────────────────────────────────────────────────
  const updateBanner = config?.update ? (
    <UpdateBanner offer={config.update} onInstall={props.onInstallUpdate} onDismiss={props.onDismissUpdate} />
  ) : null;
  // #1298 — config null means postConfig not yet received; show loading regardless of instructor role.
  // Once config arrives, an instructor may render without a profile or activity.
  if (!config) return <>{updateBanner}<DisconnectedChat open={props.onSetToken} /></>;
  if (!config.profile && !config.activity && !props.instructor) return <>{updateBanner}<DisconnectedChat open={props.onSetToken} /></>;
  if ((needsNaming || forceNaming) && config?.profile) {
    return (
      <>
      {config?.activity && <div className="hps-activity-header" aria-label="현재 활동">
        {activityLabel(config.activity.kind, config.activity.pass, undefined, !!config.activity.free)} · {config.activity.name}{activityDetail(config.activity) && <> · {activityDetail(config.activity)}</>}
        {!config.activity.verified && <p role="status">연결을 확인하지 못했습니다. 저장된 기록을 볼 수 있으며, 다시 연결한 뒤 보낼 수 있습니다.</p>}
      </div>}
      {draftError && <p role="alert">{draftError}</p>}
      {updateBanner}
      <NamingCard
        namingPromptMd={config.profile.ux.coach.naming_prompt_md}
        personalityPromptMd={config.profile.ux.coach.personality_prompt_md}
        fallbackName={config.profile.ux.coach.fallback_name}
        icon={namingIcon}
        onSave={(n, p) => {
          props.onSaveCoach(n, p);
          setForceNaming(false);
        }}
      />
      </>
    );
  }
  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (folderMissing) { e.preventDefault(); return; }
    if (!imagePasteEnabled && !imageFilesEnabled) return;
    if (!Array.from(e.dataTransfer.items ?? []).some((it) => it.kind === "file")) return;
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const handleDragLeave = () => setDragActive(false);
  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    if (folderMissing) { e.preventDefault(); setDragActive(false); return; }
    if (!imagePasteEnabled && !imageFilesEnabled) return;
    const files = Array.from(e.dataTransfer.files ?? []).filter(imageFilesEnabled ? () => true : (f) => f.type.startsWith("image/"));
    if (files.length === 0) { setDragActive(false); return; }
    e.preventDefault();
    setDragActive(false);
    if (imageFilesEnabled) stagePhotoFiles(files);
    else attachImageFiles(files);
  };

  /**
   * D-028 — the × on a staged photo: it was never sent, so the host deletes the file. CGP-CHAT-R-029: a
   * staged (ready) photo is deleted only when its 되돌리기 offer ends; 되돌리기 puts the same chip back.
   * A photo still being prepared or refused is deleted at once (there is no settled state to restore).
   */
  const removeStagedPhoto = (id: string) => {
    const before = stagedPhotos, photo = before.find(p => p.id === id);
    const source = photoSources.current.get(id);
    photoSources.current.delete(id);
    discardedPhotos.current.add(id);
    const after = before.filter((p) => p.id !== id);
    const undoable = !!photo && photo.ready && !photo.error && !photo.repick;
    if (!undoable) postToHost({ type: "discardStagedImage", stageId: id });
    setStagedPhotos(after);
    setImgNote(null);
    if (undoable) offerUndo({
      kind: 'photo', scope: undoScope,
      undo: () => {
        if (undoSubject.current.stagedPhotos !== after) return;
        discardedPhotos.current.delete(id);
        if (source) photoSources.current.set(id, source);
        setStagedPhotos(before);
      },
      stillValid: () => undoSubject.current.stagedPhotos === after,
      onExpire: () => postToHost({ type: "discardStagedImage", stageId: id }),
    });
    if (personalWorkspace) textareaRef.current?.focus({ preventScroll: true });
  };

  const removePendingImage = (idx: number) => {
    const before = pendingImages;
    if (idx < 0 || idx >= before.length) return;
    const after = before.filter((_, i) => i !== idx);
    setPendingImages(after);
    setImgNote(null);
    // CGP-CHAT-R-029 — the same image back at the same place, while nothing else changed the list.
    offerUndo({
      kind: 'image', scope: undoScope,
      undo: () => { if (undoSubject.current.pendingImages === after) setPendingImages(before); },
      stillValid: () => undoSubject.current.pendingImages === after,
    });
    if (personalWorkspace) textareaRef.current?.focus({ preventScroll: true });
  };

  /** CGP-CHAT-R-029 — a host-held chip (work-folder file, page): the host keeps it under `undoId`, unsent. */
  const removeFileAttachment = () => {
    const file = props.fileAttachment, remove = props.onRemoveFileAttachment;
    if (!file || !remove) return;
    const undoId = newUndoId();
    remove(undoId);
    offerUndo({
      kind: 'file', scope: undoScope, hostUndoId: undoId,
      undo: () => postToHost({ type: 'restoreFileContext', undoId }),
      stillValid: () => !undoSubject.current.file || undoSubject.current.file === file,
    });
  };
  const removePageAttachment = () => {
    const page = props.pageAttachment, remove = props.onRemovePageAttachment;
    if (!page || !remove) return;
    const undoId = newUndoId();
    remove(undoId);
    offerUndo({
      kind: 'page', scope: undoScope, hostUndoId: undoId,
      undo: () => postToHost({ type: 'restorePageContext', undoId }),
      stillValid: () => !undoSubject.current.page || undoSubject.current.page === page,
    });
  };
  const removePaste = (id: number) => {
    const before = draftParts, after = changePaste(before, id, null);
    setDraftParts(after);
    // CGP-CHAT-R-029 — the folded paste back in its place, until the draft is edited.
    offerUndo({
      kind: 'paste', scope: undoScope,
      undo: () => { if (undoSubject.current.draftParts === after) setDraftParts(before); },
      stillValid: () => undoSubject.current.draftParts === after,
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleReplyChoice = (answer: string, focusComposer = true) => {
    if (streaming || frozen || unavailable || props.sendLocked || props.sendPending) return;
    // A choice prepares an editable reply, never sends or replaces an existing draft.
    const messageId = messages.filter(message => message.role !== 'tool').at(-1)?.id ?? '';
    const previous = lastReplyChoice.current;
    setDraft(current => previous?.messageId === messageId && current.endsWith(previous.answer)
      ? current.slice(0, -previous.answer.length) + answer
      : current.trim() ? `${current}\n${answer}` : answer);
    lastReplyChoice.current = { messageId, answer };
    if (focusComposer) requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  };

  const handleChip = (chip: SuggestionChip) => {
    if (chip.style === "weak") return;       // contrast-only chips are not clickable
    // Personal starters share the editable-choice ownership rule: keep manual text.
    if (personalWorkspace) { handleReplyChoice(chip.text); return; }
    // Drop the chip text into draft and focus textarea so kid can append/edit.
    setDraft(chip.text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  /**
   * #649 — friend button: sends the chip text **verbatim** (the host opens a world only
   * on an exact match). Why not submit(): submit clears the draft. If a kid is typing
   * "불 대신 물" and presses a friend, what they were writing vanishes silently — the
   * button changes only the world.
   */
  const handleWorldPick = (chip: string) => {
    if (busy) return;
    if (composerBlockedByEdit(editingId, editableId)) { setImgNote(EDIT_OPEN_NOTE); return; }
    if (!reserveRecovery(chip, [], 'auto')) return;
    if (!sendWhenOnline(() => { setWorldPending(true); props.onSend(chip); }, 'press')) return;
    setRollExpand(null);
  };

  /**
   * CGP-ART-R-006 — "{n}개 바꿔 달라고 하기" sends the learner's chosen values as their own message,
   * verbatim, like a friend button: the draft is left alone. The host adds the element block and
   * the structured request (property, old value, new value) that the chip already showed.
   */
  const handleStyleTweakSend = (text: string) => {
    if (busy || props.sendLocked || !text) return;
    if (composerBlockedByEdit(editingId, editableId)) { setImgNote(EDIT_OPEN_NOTE); return; }
    if (!reserveRecovery(text, [], 'auto')) return;
    sendWhenOnline(() => props.onSend(text), 'press');
  };

  const handleRollClick = () => {
    // Capture the current draft as the "first thought" and prompt expansion.
    setRollExpand({ original: draft.trim() });
    setDraft("");
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleRollSend = () => {
    if (composerBlockedByEdit(editingId, editableId)) { setImgNote(EDIT_OPEN_NOTE); return; }
    if (imagePreparationBlocksSend()) return;
    const extra = draft.trim();
    if (!extra || !rollExpand) return;
    const combined = rollExpand.original
      ? `${rollExpand.original} — 그리고 ${extra}`
      : extra;
    if (!reserveRecovery(combined, pendingImages, 'auto')) return;
    if (!sendWhenOnline(() => props.onSend(combined, pendingImages.length > 0 ? pendingImages : undefined), 'draft')) return;
    setDraft("");
    setPendingImages([]);
    setImgNote(null);
    setRollExpand(null);
  };

  const shortHintVisible =
    ux.hints.short_input.enabled &&
    draft.length > 0 &&
    draft.trim().length < ux.hints.short_input.min_chars;

  // If the strip already carries the same chip, drop it from the first-screen chips —
  // two copies of the same button read to a kid as "these are two different things"
  // (2026-08-20 review).
  const stripChips = new Set(worlds.map((w) => w.chip));
  const initialChips =
    worlds.length > 0
      ? ux.suggestions.initial.filter((c) => !stripChips.has(c.text))
      : ux.suggestions.initial;
  const showInitialChips =
    messages.length === 0 &&
    !streaming &&
    initialChips.length > 0;

  // #503 — a tool row can come at the end of the timeline, so "is the last one the
  // assistant" is judged by the last **bubble**. Otherwise the follow-up chips vanish
  // on a turn that ended with a tool.
  const lastSpoken = [...messages].reverse().find((m) => m.role !== "tool");
  const showFollowUpChips =
    !streaming &&
    messages.length > 0 &&
    lastSpoken?.role === "assistant" &&
    ux.suggestions.follow_up.length > 0;
  // #414 — if a real activity log showed up this turn, the spinner does not invent fake stages.
  const turnHasActivity = hasActivityThisTurn(messages);
  const longStep = streaming ? runningProgressStep(messages) : null;
  // Personal chat offers retry on the latest coach answer only.
  const latestAssistantId = [...visibleAttempts(messages).items].reverse().find(m => m.role === 'assistant')?.id;
  // CGP-CHAT-R-002 — one version per prompt is drawn; "수정" sits on the latest prompt only, and
  // never while a turn runs, a message waits in the queue or recovery list, or in instructor mode.
  const attempts = visibleAttempts(messages);
  const shown = visibleVersions(attempts.items, versionChoice);
  // CGP-SHELL-R-020 — example ideas only after a no-idea answer to a goal question, never on the first
  // screen (that needs a learner message), never in a lesson or the instructor console, never mid-turn,
  // and never mid-work (the task must be at its start: no tool work, no artifact, an early conversation).
  const ideaOffer = personalWorkspace && !props.instructor && !streaming
    ? ideaOfferFor(shown.items, config?.profile?.welcome?.greeting_md ?? "", (text) => replyChoices(text) !== null,
      // Ideas are for starting a project: a picked surface, an open world or a publish means work exists.
      !!config?.taskWorkspace?.sourceSelection || props.openWorldId !== null || props.publish !== null) : null;
  const ideaKey = ideaOffer ? ideaOfferKey(activityId, taskId, ideaOffer.messageId) : null;
  const showIdeas = !!ideaKey && !dismissedIdeas.includes(ideaKey);
  // REQ-STUDIO-CONTEXT-TRIM-MARKER — derived from the conversation each render; -1 when nothing is left out.
  const trimAt = trimMarkerIndex(shown.items, props.trimBoundaryId);
  // CGP-CHAT-R-023 — read-only step dividers where the served step changes, and the "지금 단계로" target: the
  // divider of the step on screen (the rail's step, the first step when none is picked). Learner seats only.
  const servedLesson = props.instructor ? null : config?.profile?.lesson ?? null;
  const dividers = stepDividers(shown.items, servedLesson ? props.stepMarks : null);
  const stepOnScreen = servedLesson ? (servedLesson.content.steps.find(s => s.id === currentStepId) ?? servedLesson.content.steps[0])?.id ?? null : null;
  // CGP-CHAT-R-028 — the "내 질문" list: the drawn prompts (one version each), offered from 4 on.
  const questionList = myQuestions(shown.items);
  const jumpTarget = currentDividerId(dividers, servedLesson?.sha256, stepOnScreen);
  const jumpToStep = jumpTarget ? () => {
    const box = scrollRef.current;
    const divider = box ? [...box.querySelectorAll<HTMLElement>("[data-step-divider]")].find(el => el.dataset.stepDivider === jumpTarget) : undefined;
    if (!box || !divider) return;
    box.scrollTo({ top: divider.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop, behavior: scrollBehavior() });
  } : null;
  // REQ-STUDIO-DELEGATION-ROW — a delegation is one row; its helper's tool lines are drawn inside it.
  const delegations = groupDelegations(shown.items, streaming ? props.runningStreamId ?? null : null);
  const helperGroups = delegationGroups(delegations.rows);
  const editableId = props.onEditResend ? editableUserId(attempts.items, {
    streaming, sendPending: props.sendPending, parked: queued !== null || recovered.length > 0,
    instructor: props.instructor, locked: unavailable || !!props.sendLocked,
  }) : null;
  const editing = editingId !== null && editingId === editableId ? editingId : null;
  editFocusScope.current = JSON.stringify([activityId, taskId]);
  const cancelEdit = () => {
    const owner = editFocusScope.current;
    const origin = document.activeElement;
    const row = origin?.closest('.hps-msg');
    setEditingId(null);
    setInlineEdit(undefined);
    requestAnimationFrame(() => {
      // A later task or intentional focus choice owns the keyboard now.
      if (editFocusScope.current !== owner || !row?.isConnected) return;
      if (document.activeElement !== origin && document.activeElement !== document.body) return;
      row.querySelector<HTMLButtonElement>('.hps-edit-prompt')?.focus({ preventScroll: true });
    });
  };
  // CGP-CHAT-R-005 — verdicts sit on the last answer bubble of each finished turn, personal task chat only
  // (SX-06 lists what a classroom/lesson rail may show; a verdict control is not on that list).
  const judgeable = personalWorkspace && !props.instructor && props.onVerdict ? verdictTargets(shown.items, streaming) : null;
  // CGP-KNOW-R-004 — same answers, and only where the served profile turns team brain on (the session
  // command's own switch); the host re-checks the switch and asks before writing anything.
  const wikiTargets = personalWorkspace && !props.instructor && props.onAnswerToWiki && config?.profile?.learning_wiki?.enabled === true ? judgeable ?? verdictTargets(shown.items, streaming) : null;
  const saveEdit = (original: ChatMessage, text: string, images: string[]) => {
    const editOf = original.editOf ?? original.id;
    if (!sendWhenOnline(() => props.onEditResend?.(original, editOf, text, images), 'edit')) return;
    setEditingId(null);
    setInlineEdit(undefined);
    // The new version is drawn: forget a choice that pointed at an older one.
    setVersionChoice(({ [editOf]: _dropped, ...rest }) => rest);
    recoverToComposer(undefined);
  };

  // #642 — if the screen is static for the 1–3 minutes the coach is working, a kid
  // reads it as broken (2026-08-20, real device). The runner bar goes above the
  // composer on the kids track only. All the decisions live in runner.ts (pure). When
  // the cohort matches it **stays in place, folded, even with no turn running** — that
  // is what makes both the appearing and the disappearing smooth, and keeps the
  // composer from jumping up and down.
  const runnerCohort = isRunnerCohort({ worldCount: worlds.length, tone: appTone });
  const runnerRunning = shouldShowRunner({ streaming: busy, worldCount: worlds.length, tone: appTone });
  const runnerWho = runnerFace(worlds, props.openWorldId);

  return (
    <CopyFeedbackRegion><div
      className={`hps-shell${dragActive ? " hps-shell-drag" : ""}`}
      data-chat-detail={personalWorkspace ? 'personal' : undefined}
      data-text-size={normalizeTextSize(config?.textSize) === 'base' ? undefined : normalizeTextSize(config?.textSize)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="hps-shell-drop-overlay">여기에 놓으면 이미지가 첨부돼요 <ChatIcon kind="image" size={20} /></div>
      )}
      {!connectivity.online && <div className="hps-offline-banner" role="status" data-testid="offline-banner" aria-atomic="true"><ChatIcon kind="plug" size={16} /><span>{OFFLINE_BANNER_TEXT}</span></div>}
      {(() => { const header = <header className="hps-header">
        {personalWorkspace && config?.folderRestricted && <span className="hps-folder-restricted" role="note" data-hp-tooltip="이 폴더에서는 AI가 읽기만 할 수 있어요. 파일 고치기와 명령 실행은 꺼져 있어요. ‘이 폴더의 AI 권한 바꾸기’에서 다시 고를 수 있어요." aria-label="제한 모드: AI 파일 고치기와 명령 실행 꺼짐">제한 모드</span>}
        {ux.coach.naming_mode === "fixed"
          // Personal chat: a fixed name is not a control, and the one header row has no room for a
          // label that names nothing the learner can act on. It stays readable to screen readers.
          ? <strong data-hp-tooltip={`이 수업의 AI 이름: ${coachName}`} className={personalWorkspace ? "hps-coach-name hps-sr-only" : "hps-coach-name"}>{coachName}</strong>
          : <button data-hp-tooltip="코치 이름 바꾸기" onClick={() => setForceNaming(true)} className="hps-coach-name">{coachName}</button>}
        {/* CGP-LEARN-R-016: the one coach run state, derived from the timeline and the approval prompts. */}
        <CoachRunState preparing={!!props.sendPending} running={streaming || !!props.verifyRunning} approvalPending={!!props.progressApprovalPending}
          error={!!error} unavailable={unavailable || !connectivity.online} lastOutcome={props.lastOutcome ?? null} messages={messages} />
        {/* US-05 (P0): the work screen's top names the current activity and whether it is a trial or a
            class. Personal chat has no mission header (#1760), so the line that header carried moves
            into this row with the same `현재 활동` label (the a11y contract in MissionHeader.tsx). The
            kind stays visible; the name yields first on a narrow header (title keeps the full line). */}
        {personalWorkspace && config?.activity && (() => {
          const kind = activityLabel(config.activity.kind, config.activity.pass, undefined, !!config.activity.free);
          return <span className="hps-activity-now" aria-label="현재 활동" data-hp-tooltip={`${kind} · ${config.activity.name}`}>
            <span className="hps-activity-kind">{kind}</span><span className="hps-activity-name"> · {config.activity.name}</span>
          </span>;
        })()}
        {/* The count is the status (it never gives way); the end time yields on a narrow header (title keeps the full line). */}
        {trialLine &&<span className="hps-trial-left" data-hp-tooltip={trialLine}>{trialLine.split(" · ")[0]}{trialLine.includes(" · ") && <span className="hps-trial-until">{trialLine.slice(trialLine.indexOf(" · "))}</span>}</span>}
        {/* CONV-ENDCARD-R-003 — the same path as the end card's Primary (the host counts offer_clicked
            end_card and opens the pass list). A link, not a Primary: no count, no pressure (CU-13). */}
        {freeEnded && props.onTrialEndCardPasses && <button type="button" className="hps-header-passes" onClick={props.onTrialEndCardPasses}>이용권 살펴보기</button>}
        {entry && <button className="hp-capability-reopen" type="button" aria-expanded={entryOpen} onClick={() => setReopenedCapabilities(entry.id)}>AI 안내</button>}
        <MyQuestions items={questionList} scrollRoot={scrollRef} scope={JSON.stringify([activityId, taskId])} onBeforeJump={viewport.pauseFollowing} />
        <AccessHeader config={config} onOpenDetail={() => openPreferences(true)} />
        <HeaderActions personal={personalWorkspace} taskId={taskId}>
          {/* Immediately **left** of Token, same size. It inherits the header button
              style (.hps-header button) as-is and differs only in color — giving it its
              own size makes the header row grow taller because of this one button.
              Token·Clear·⚙ are the settings family and this is a control the kid uses,
              so it stands in front of that group, where the hand reaches first. */}
          {galleryEnabled && props.openWorldId !== null && (
            <button
              className="hps-gallery-btn"
              onClick={props.onPublish}
              disabled={busy || props.publish?.state === "uploading"}
              data-hp-tooltip="지금 만든 세상을 갤러리에 올려요"
            >
              {props.publish?.state === "uploading"
                ? "올리는 중…"
                : props.publish?.state === "done"
                  ? <>올렸어요 <ChatIcon kind="check" size={16} /></>
                  : <><ChatIcon kind="image" size={16} /> 갤러리</>}
            </button>
          )}
          {/* One-click publish. The decision comes from the host (config.sitePublish) so it
              cannot drift from the host gate; the host re-checks on click anyway. */}
          {config?.sitePublish === true && props.onPublishSite && (
            <button
              className="hps-site-publish-btn"
              onClick={props.onPublishSite}
              disabled={props.streaming}
              data-hp-tooltip="홈페이지를 내 GitHub 주소로 올려요"
              aria-label="인터넷에 올리기"
            >
              인터넷에 올리기
            </button>
          )}
          {config?.sitePublish === true && props.onSwitchProject && (
            <button
              className="hps-site-publish-btn"
              onClick={props.onSwitchProject}
              disabled={props.streaming}
              data-hp-tooltip="GitHub에 있는 다른 프로젝트로 바꿔요"
              aria-label="프로젝트 변경"
            >
              프로젝트 변경
            </button>
          )}
          <button onClick={props.onSetToken} data-hp-tooltip="연결된 활동 확인 및 변경">
            활동 변경
          </button>
          {personalWorkspace && !props.instructor && taskAppearance.open && <button type="button" className="tw-task-appearance" onClick={taskAppearance.open} data-hp-tooltip="목록에서 이 작업을 찾기 쉽게 표시를 붙여요">{TASK_APPEARANCE_LABEL}</button>}
          {personalWorkspace && !props.instructor && <button type="button" className="tw-copy-conversation" onClick={() => { void conversationCopy.copy(); }} disabled={props.streaming || !conversationCopy.available} data-hp-tooltip="이 작업의 대화를 글로 복사해요">{COPY_CONVERSATION_LABEL}</button>}
          <button onClick={props.onClear} disabled={props.streaming} data-hp-tooltip="대화 기록 지우기">대화 지우기</button>
          {/* CGP-CHAT-R-025 — hide this task from the list; its conversation, draft and records stay. Personal tasks only. */}
          {personalWorkspace && !props.instructor && <button type="button" className="tw-archive-task" onClick={() => postToHost({ type: 'taskArchive' })} disabled={props.streaming} data-hp-tooltip="목록에서 숨기고 대화는 그대로 둬요">보관하기</button>}
          {/* Personal chat: usage opens the settings dialog on its usage section (the remaining line
              already shows the count). */}
          {personalWorkspace && config?.access && <button onClick={() => openPreferences(true)} data-hp-tooltip="이용권과 사용량 확인">이용권 · 사용량</button>}
          <button onClick={personalWorkspace ? () => openPreferences(false) : props.onSettings} data-hp-tooltip="설정" aria-label="설정">{personalWorkspace ? "설정" : <ChatIcon kind="settings" size={20} />}</button>
        </HeaderActions>
      </header>;
      return personalWorkspace && headingSlot ? createPortal(header, headingSlot) : header; })()}
      {personalWorkspace && !props.instructor && <ConversationCopyStatus state={conversationCopy.state} />}
      {!props.instructor && <ClassWindowNotice window={config.classWindow} />}

      {entryOpen && entry && config?.aiCapabilities && <PanelBoundary panel="lesson-capability-entry">
        <LessonCapabilitySheet key={entry.id} items={config.aiCapabilities} solo={audience === 'solo'} onAcknowledge={() => {
          setReopenedCapabilities(null);
          postToHost({ type: "acknowledgeLessonCapabilities", id: entry.id });
        }} />
      </PanelBoundary>}
      {/* Region A — Mission header. Student-only surface; #1298 hides it for instructor mode. */}
      {/* CGP-SHELL-R-013 — each independent panel below fails alone (PanelBoundary); the composer,
          the draft and the conversation keep working, and ChatErrorBoundary stays the last resort. */}
      {!props.instructor && !personalWorkspace && <PanelBoundary panel="mission-header">{() => <MissionHeader
        lesson={config?.profile?.lesson ?? null}
        // SX-01·SX-50 — the completion items are checked off from the host's own gate verdict.
        // Without `learningState` (a seat that records no learning events) there is no verdict,
        // and nothing gets a check mark.
        missing={learning ? learning.complete.missing : null}
        // SX-02 — "지난번 이어서", exactly as the host decided it from the task record.
        resume={learning?.resume ?? null}
        // AE-01 — the learner's own goal for THIS lesson, fixed with the header; edited in the rail below.
        goal={goalOfLesson(studentGoal, config?.profile?.lesson)?.goal || null}
        currentStepId={currentStepId}
        onSelectStep={pickStep}
        onJumpToStep={jumpToStep}
        onStartStep={(step) => {
          pickStep(step.id);
          const lesson = config?.profile?.lesson;
          if (!lesson) return;
          postToHost({ type: 'lessonStep', stepId: step.id, status: 'in_progress' });
          setLessonSteps(prev => ({ ...prev, [step.id]: prev[step.id] === 'submitted' ? 'submitted' : 'in_progress' }));
          handleChip({
            style: 'good',
            text: `수업: ${lesson.content.title} (${lesson.version})\n과제: ${step.instructions}\n확인 기준: ${step.acceptance}\n현재 작업을 보존하면서 이 과제를 도와주세요.`,
          });
        }}
        onOpenGrowth={() => postToHost({ type: "openLocalReview" })}
        // SX-04 — busy while the coach answers, and (SX-01/SX-02) until a learning state has shown
        // this screen the task's record: before it the Primary stands on the first step, not the
        // step the record holds.
        busy={streaming || awaitingRecord}
        activity={config?.activity ? {
          label: activityLabel(config.activity.kind, config.activity.pass, undefined, !!config.activity.free),
          // TUX-SP-13 — a pass's end date, or a trial's passive remaining line (text only, no button).
          ...(activityDetail(config.activity) ? { detail: activityDetail(config.activity)! } : {}),
          name: config.activity.name,
          verified: !!config.activity.verified,
        } : null}
      />}</PanelBoundary>}
      {draftError && <p role="alert">{draftError}</p>}
      {updateBanner}

      {/* AE-01 (#554) — "내 목표": the learner's own goal and completion criteria, in the rail right under region A.
          Region A keeps drawing the lesson's own criteria from the design file; this block never touches them.
          Student-only, like region A (#1298). */}
      {!props.instructor && config?.profile?.lesson && (
        <PanelBoundary panel="student-goal">{() => <StudentGoal
          lesson={config.profile!.lesson!}
          view={goalOfLesson(studentGoal, config.profile!.lesson)}
          note={goalNote}
          pending={goalPending}
          onSave={sendGoalSave}
        />}</PanelBoundary>
      )}

      {/* Region B's lesson info — inside the coach rail, **outside** the message stream
          (SX-05). Closed by default, and it opens only the current step. It used to
          expand all six steps at once and took up more room than the mission. */}
      {config?.profile?.lesson && <PanelBoundary panel="lesson">{() => {
        const lesson = config.profile!.lesson!;
        const steps = lesson.content.steps;
        const step = steps.find(s => s.id === currentStepId) ?? steps[0];
        if (!step) return null;
        const index = steps.indexOf(step);
        return (
          <>
            <details className="hp-rail-lesson">
              <summary>이번 단계 안내 · {index + 1}. {step.title}</summary>
              <p className="hp-rail-lesson-meta">{lesson.content.title} · 버전 {lesson.version} · {lesson.content.duration_minutes}분</p>
              <p>{step.instructions}</p>
              {step.hint ? <details><summary>힌트 보기</summary><p>{step.hint}</p></details> : null}
              <p>확인 기준: {step.acceptance}</p>
              <p className="hp-rail-lesson-note">안내를 읽은 것만으로 이 단계가 끝나지는 않습니다. 직접 만들고 확인한 기록이 남아야 합니다.</p>
            </details>
            <LessonStepPanel lesson={lesson} step={step} rehearsal={config.profile!.rehearsal} busy={streaming} post={postToHost}
              work={lessonWork?.sha256 === lesson.sha256 ? lessonWork.work : {}} rehearsalState={rehearsalResult} />
            {/* #751 F4 — a learner self-report for the current step, separate from region D's task completion gate. */}
            <p className="hp-rail-step-report">
              <button type="button" className="hp-cta-quiet hps-lesson-done" aria-pressed={lessonSteps[step.id] === 'submitted'} disabled={lessonSteps[step.id] === 'submitted'} onClick={() => { postToHost({ type: 'lessonStep', stepId: step.id, status: 'submitted' }); setLessonSteps(prev => ({ ...prev, [step.id]: 'submitted' })); }}>{lessonSteps[step.id] === 'submitted' ? '마쳤다고 표시함 · 강사 확인 전' : '이 단계를 마쳤어요'}</button>
            </p>
          </>
        );
      }}</PanelBoundary>}

      {/* #751 U2 — instructor notices/materials: the coach rail's "강사 메시지" kind (SX-06), outside the message stream
          (SX-05), closed by default, no Primary (SX-04). Drawn with or without a lesson. */}
      {/* CGP-AGENT-R-003 — what the AI can do on this seat. Same rail, closed by default, no Primary. */}
      {!props.instructor && !entryOpen && config?.aiCapabilities && <PanelBoundary panel="ai-can-do"><AiCanDo items={config.aiCapabilities} solo={audience === 'solo'} /></PanelBoundary>}
      <PanelBoundary panel="instructor-inbox"><InstructorInbox inbox={inbox} post={postToHost} promptImport={{ onImport: importPrompt, onUndo: undoImport, disabled: frozen, draft, last: lastImport, note: importNote }} /></PanelBoundary>
      {/* CGP-KNOW-R-003 — the activity's 자료 list. Same rail, closed by default, no Primary; only with the file-attach gate.
          CGP-KNOW-R-002: a task workspace draws it as the activity home's 자료 view instead (classroom seats keep it here). */}
      {!props.instructor && config?.materials && !materialsHome && <PanelBoundary panel="materials"><MaterialsPanel /></PanelBoundary>}
      {/* #751 native help — the learner's own request to the instructor of this class. Same rail, closed by default, no Primary. */}
      {/* #1298 — hidden for instructor mode; instructor has no student help-request surface. */}
      {!props.instructor && classroomPanels.help && <PanelBoundary panel="help-request"><HelpRequest view={help} post={postToHost} /></PanelBoundary>}
      {/* #751 U1b — the learner's approval of their page as the class result, next to help (drawn only for a learner in class).
          Closed by default, no Primary; the button opens the host's question, which shows the exact version first. */}
      {/* #1298 — hidden for instructor mode. */}
      {!props.instructor && help && classroomPanels.approval && <details className="hp-inbox hp-rail-lesson" data-artifact-approval="">
        <summary>수업 결과물 승인</summary>
        <p className="hp-rail-lesson-note">작업 폴더의 index.html 지금 판을 수업 결과물로 승인하거나 승인을 취소합니다. 누르면 그 판의 지문을 먼저 보여 주고 고르게 합니다. 승인한 판만 ‘학생이 승인한 결과물’ 회수에 들어가며, 이 버튼은 아무것도 보내지 않습니다. 고치면 새 판은 다시 승인해야 합니다.</p>
        <button type="button" className="hp-cta-quiet" data-artifact-approve="" onClick={() => postToHost({ type: "artifactApprove" })}>지금 결과물 확인하고 승인·취소</button>
      </details>}

      {/* Region D — the completion gate and the Evidence drawer (SX-14·17). Drawn only
          when the host sends `learningState`. On a connection that does not send it (a
          profile that does not use learning events), an empty drawer left on screen is
          decoration that does nothing when pressed. */}
      {learning && <PanelBoundary panel="evidence">{() => (
        <section className="hp-evidence-region" aria-label="근거와 완료">
          {/* SX-14 gate and SX-55 phase, as the host decided them. The host made the judgment; this only draws it. */}
          <CompletionGate learning={learning} onSubmit={() => postToHost({ type: "submitTask", task: learning.task })} />
          <EvidenceDrawer
            open={drawerOpen}
            rows={learning.evidence}
            verification={learning.verification}
            // The step id is a **view state**, so it comes from here. The host uses it
            // only after checking it is a step of this lesson — a value the webview
            // sent is never trusted as-is.
            onSubmit={(draft) => postToHost({ type: "learningEvent", draft, stepId: currentStepId ?? undefined })}
            onToggle={(open) => {
              setDrawerOpen(open);
              postToHost({ type: "learningDrawer", open });
            }}
          />
        </section>
      )}</PanelBoundary>}

      {/* Both lines were originally pinned to `=== 'hps-observation/1'`. The moment `/2`
          opened, (a) the observation panel disappeared and (b) "관찰을 지원하지 않습니다"
          showed up next to a screen whose drawer was working fine. The test is "is
          observation on", not "which version is it". */}
      {/* The observation RESULTS panel is an assessment shown to the learner. SX-01·06·07·59
          keep that off the work screen, and SX-59 names the remedy as "학습 경험 프로필에서
          비활성" rather than deletion, because the trial's own TUX-OBS-07 is to read it. So it
          follows the cohort's `assess` opt-in; recording keeps its own switch and stays on. */}
      {!personalWorkspace && showsObservationResults(config?.profile?.observation) && <PanelBoundary panel="observation"><NativeObservationPanel scope={config!.profile!.observation!.scope} coachName={coachName} /></PanelBoundary>}
      {!personalWorkspace && config?.profile?.profile_id === 'studio-native-trial' && !isObservationFormat(config.profile.observation?.format) && <p role="status">현재 연결은 작업 관찰을 지원하지 않습니다. 기존 작업 파일은 계속 사용할 수 있습니다.</p>}

      {(previewView || previewNote) && <PanelBoundary panel="preview-recovery"><PreviewRecoveryNotice view={previewView} note={previewNote} busy={previewBusy} onAction={(action) => {
        setPreviewBusy(true); setPreviewNote(null);
        let sent = false;
        try { postToHost({ type: "previewRecoveryAction", action }); sent = true; } finally { if (!sent) setPreviewBusy(false); }
      }} /></PanelBoundary>}
      {/* CGP-CHAT-D-001: stable, invisible response announcements live outside the scrolling message list. */}
      <div className="hps-sr-only" role="status" aria-live="polite" data-testid="response-announcer">{liveAnnouncement}</div>

      {/* CGP-CHAT-R-027: Cmd/Ctrl+F find bar, right above the conversation. */}
      <PanelBoundary panel="chat-find">{() => <ChatFindBar scrollRef={scrollRef} scope={`${activityId ?? ""}/${taskId ?? ""}`} onReading={viewport.pauseFollowing} />}</PanelBoundary>
      <div className="hps-messages" ref={scrollRef} onScroll={viewport.onScroll}>
        {props.aiNotice && (
          // #320 — AI disclosure (Anthropic Usage Policy / ToS §D.3). Compact
          // and unobtrusive; sits at the top of the conversation so it reads
          // as a session-start notice, not an interruption.
          <div className="hps-ai-disclosure" role="note" aria-live="polite">
            {/* REQ-STUDIO-STROKE-ICONS: a stroke icon, not a colour emoji; the sentence carries the meaning. */}
            <ChatIcon kind="info" size={16} />{stripLeadingGlyph(props.aiNotice)}
          </div>
        )}

        {messages.length === 0 && (
          <EmptyState
            ux={ux}
            coachName={coachName}
            greetingMd={config?.profile?.welcome.greeting_md ?? ""}
          />
        )}

        {showInitialChips && (
          <ChipRack
            chips={initialChips}
            onPick={handleChip}
            label={personalWorkspace ? "시작할 질문" : "이렇게 시작해볼까요? (탭하면 입력창에 들어가요)"}
          />
        )}

        {/* CGP-CHAT-R-008: code-block wrap choices are scoped to this conversation. */}
        <CodeBlockScope root id={`${activityId ?? ""}/${taskId ?? ""}`}>
        {shown.items.map((m, i) => <TurnBoundary key={`${activityId ?? ""}/${taskId ?? ""}/${m.id}`} messageId={m.id} rawText={m.content}>{() => <Fragment>
          {i === trimAt && <ContextNote text={CONTEXT_TRIM_NOTE} />}
          {dividers.has(m.id) && <StepDivider id={m.id} label={stepDividerLabel(dividers.get(m.id)!)} />}
          {(m.elapsedTurn || m.activity) && m.role === "system" && !m.content ? null : m.role === "tool" && m.tool?.state === "error" && storedDenialNotice(m.tool.label) ? (
            <ToolLine message={m} onReport={props.onReportProblem} />
          ) : delegations.grouped.has(m.id) ? null : isCompactionLine(m) ? (
            <ContextNote text={CONTEXT_COMPACT_NOTE} />
          ) : m.role === "tool" && delegations.rows.has(m.id) ? (
            helperGroups.has(m.id) ? <PanelBoundary panel="delegation"><DelegationGroup
              views={helperGroups.get(m.id)!}
              textSize={config?.textSize}
              renderChild={(child) => child.tool?.state === "error" && storedDenialNotice(child.tool.label) ? null : <ToolLine message={child} onReport={props.onReportProblem} />}
              stopState={props.delegationStops?.[parseDelegationId(m.id)?.stream ?? '']}
              onStopAll={() => { const stream=parseDelegationId(m.id)?.stream;if(!stream||stream!==props.runningStreamId)return;if(props.onStopDelegations)props.onStopDelegations(stream);else {restoreQueuedToDraft();props.onCancel();} }}
            /></PanelBoundary> : null
          ) : m.role === "tool" ? (
            <ToolLine key={m.id} message={m} onReport={props.onReportProblem} />
          ) : (
            <MessageItem
              key={m.id}
              message={m}
              streaming={streaming}
              isStreamingThis={streaming && m.id === streamingId}
              ux={ux}
              coachName={coachName}
              buildingLabel={buildingLabel}
              tone={appTone}
              messages={messages}
              hasActivity={turnHasActivity}
              onRunCode={props.onRunCode}
              onRetry={(prompt, source) => { sendWhenOnline(() => props.onRetry(prompt, source), 'press'); }}
              personal={personalWorkspace}
              isLatest={m.id === latestAssistantId}
              freeSeat={!!config?.activity?.free}
              onPickReply={personalWorkspace && !streaming && !frozen && !unavailable && !props.sendLocked && !props.sendPending && m.id === messages.filter(message => message.role !== 'tool').at(-1)?.id ? (answer) => handleReplyChoice(answer, false) : undefined}
              onWriteReply={() => textareaRef.current?.focus({ preventScroll: true })}
              replyTyping={composing || draft.length > 0}
              replySelectionValid={lastReplyChoice.current?.messageId === m.id}
              onSubmitReply={(answer) => {
                const owned = lastReplyChoice.current;
                const latest = messages.filter(message => message.role !== 'tool').at(-1);
                if (!personalWorkspace || frozen || latest?.id !== m.id || owned?.messageId !== m.id || owned.answer !== answer) return false;
                return submit();
              }}
              pager={shown.pagers[m.id]}
              onPage={(key, index) => setVersionChoice((all) => ({ ...all, [key]: index }))}
              onEdit={m.id === editableId ? () => { setEditingId(m.id); setInlineEdit(current => current?.messageId === m.id ? current : {messageId:m.id,text:m.content,images:m.images ?? []}); } : undefined}
              editing={m.id === editing}
              editDraft={inlineEdit?.messageId === m.id ? inlineEdit : undefined}
              onEditChange={(text, images) => setInlineEdit({messageId:m.id,text,images})}
              revertNote={!props.instructor && !!turnReview}
              onCancelEdit={cancelEdit}
              onSaveEdit={(text, images) => saveEdit(m, text, images)}
              verdict={judgeable?.has(m.id) ? props.verdicts?.[m.id] ?? null : undefined}
              onVerdict={judgeable?.has(m.id) && props.onVerdict ? (next) => props.onVerdict?.(m.id, next) : undefined}
              wikiScope={JSON.stringify([activityId, taskId])}
              onToWiki={wikiTargets?.has(m.id) && props.onAnswerToWiki ? () => props.onAnswerToWiki?.(m.id) : undefined}
              quotable={m.role === 'assistant' && !(streaming && m.id === streamingId)}
              quoteAction={answerQuote?.messageId === m.id ? <QuoteAction quote={answerQuote} disabled={composing} onQuote={quoteAnswer} onDismiss={dismissQuote} /> : undefined}
              elapsed={m.elapsedTurn ? <ElapsedReceipt message={m} inline /> : undefined}
            />
          )}
          {m.elapsedTurn && !answerActionRowShown(m, personalWorkspace, streaming && m.id === streamingId) && <ElapsedReceipt message={m} />}
          {!streaming && accuracyOffer?.messageId === m.id && m.role === 'assistant' && <AccuracyEducation key={`accuracy-${m.id}`} answer={m.content}
            onDismiss={() => postToHost({ type: 'accuracyEducationDismiss', messageId: m.id })} />}
          {steerMarkAfter(m.id)}
          {!props.instructor && pageCards.get(m.id) && <PanelBoundary panel="page-card">{() => {
            const card = pageCards.get(m.id)!;
            return <PageCard view={card} onOpen={(path) => postToHost({ type: "pageCardOpen", turnId: card.turnId, path })} onReveal={(path) => postToHost({ type: "pageCardReveal", turnId: card.turnId, path })} />;
          }}</PanelBoundary>}
        {(() => {
            const group = attempts.groups.find(group => group.attempts.length > 1 && (group.attempts[group.index].lines.at(-1)?.id ?? group.root.id) === m.id);
            if (!group || !props.onSelectAttempt || props.instructor) return null;
            const locked = streaming || !!props.sendPending || !!props.sendLocked || unavailable;
            const selected = group.attempts[group.index].user.id;
            return <div className="hps-answer-attempts">
              {group.root.chosenAttemptId === selected && <span className="hps-attempt-chosen">이 답변을 골랐어요</span>}
              <button type="button" className="hps-attempt-choose" disabled={locked || !group.attempts[group.index].lines.some(line => line.role === "assistant" && line.content.trim())}
                aria-pressed={group.root.chosenAttemptId === selected}
                onClick={() => { viewport.pauseFollowing(); props.onSelectAttempt?.(group.root.id, selected, true); }}>이걸 쓸래요</button>
              <AttemptPager index={group.index} count={group.attempts.length} title={ATTEMPT_HISTORY_NOTE}
                disabled={locked} onPage={index => { viewport.pauseFollowing(); props.onSelectAttempt?.(group.root.id, group.attempts[index].user.id, false); }} />
            </div>;
          })()}
          </Fragment>}</TurnBoundary>)}
        </CodeBlockScope>

        {/* CGP-ART-D-019 — one calm hint for the active turn after20s without visible progress. */}
        {streaming && props.progressSince !== undefined && <PanelBoundary key={props.runningStreamId ?? "active-turn"} panel="long-step"><LongStepHintLine
          since={props.progressSince}
          step={longStep?.step ?? null}
          turn={{ streaming, stalled: !!error, approvalPending: !!props.progressApprovalPending }}
          onStop={() => { restoreQueuedToDraft(); props.onCancel(); }}
          onAnnounce={setLongStepAnnouncement}
        /></PanelBoundary>}

        {props.pageNotice && (
          <div className="hps-page-notice" role="status" aria-live="polite">
            {/* REQ-STUDIO-STROKE-ICONS: the host's leading glyph becomes a stroke icon. */}
            {(() => { const notice = splitLeadingGlyph(props.pageNotice); return <>{notice.glyph && <><ChatIcon kind={glyphIconKind(notice.glyph)} size={16} /> </>}{notice.text}</>; })()}
          </div>
        )}

        {/* CGP-KNOW-R-003 — the 자료 selected for the next message, each removable before Send. */}
        {!props.instructor && config?.materials && <MaterialsChips />}

        {(props.annotationsEnabled || !!props.annotations?.length) && <AnnotationTray key={`${config?.activity?.id ?? ""}/${config?.taskWorkspace?.activeTaskId ?? ""}`} annotations={props.annotations ?? []} onAction={props.onAnnotationAction!} />}
        {/* CR-09 — exactly what goes to the coach with the next message, removable before sending. */}
        {props.elementPreview && (
          <div className="hps-element-context" role="group" aria-label="코치에게 함께 보낼 화면 요소" data-testid="element-context">
            {props.elementPreview.imageDataUrl && (
              <img className="hps-element-crop" src={props.elementPreview.imageDataUrl} alt="고른 요소의 모습" />
            )}
            <div className="hps-element-meta">
              <div>
                <strong>함께 보낼 요소</strong> &lt;{props.elementPreview.tag}&gt;{" "}
                {props.elementPreview.text && `“${props.elementPreview.text.slice(0, 40)}”`} · {props.elementPreview.ref}
              </div>
              <div className="hps-element-source">
                {props.elementPreview.source === "unmapped" ? "소스 위치: 찾지 못함" : `소스 위치: ${props.elementPreview.source}`}
                {!props.elementPreview.imageDataUrl && " · 이미지는 보내지 않아요"}
              </div>
              <details>
                <summary>코치에게 보낼 내용 보기</summary>
                <pre data-testid="element-context-sent">{props.elementPreview.sentText}</pre>
              </details>
              {props.elementPreview.styleTweak && props.onStyleTweakSet && (
                <StyleTweakPanel
                  key={props.elementPreview.styleTweak.id}
                  view={props.elementPreview.styleTweak}
                  disabled={busy || !!props.sendLocked}
                  onSet={(prop, value) => props.onStyleTweakSet!(props.elementPreview!.styleTweak!.id, prop, value)}
                  onSend={handleStyleTweakSend}
                />
              )}
            </div>
            <button type="button" className="hps-element-remove" aria-label="이 요소 빼기" onClick={props.onRemoveElement}>
              <ChatIcon kind="close" size={16} />
            </button>
          </div>
        )}

        {props.verifyPanel}

        {/* #497 — the notice right after Stop. It is not an error, so it is announced as
            a quiet inline status line rather than an error banner. It goes away on the
            next input. */}

        {props.stopNotice && (
          <div className="hps-stop-notice">
            <span className="hps-stop-notice-icon"><ChatIcon kind="stop" size={16} /></span>
            {props.stopNotice}
          </div>
        )}

        {/* CGP-SHELL-R-024 — what the AI can do changed on a profile refresh. A system line, not a modal; never blocks sending. */}
        {!props.instructor && config?.capabilityChange && (
          <PanelBoundary panel="capability-change"><CapabilityChangeCard change={config.capabilityChange} onDismiss={(id) => postToHost({ type: "dismissCapabilityChange", id })} /></PanelBoundary>
        )}

        {/* CGP-ART-R-020 — what the AI did in this task, from its tool events only. */}
        <PanelBoundary panel="task-activity"><TaskActivity
          summary={taskActivity}
          reviewPaths={new Set(!props.instructor && turnReview?.state === "open" ? [...turnReview.added, ...turnReview.changed] : [])}
          onShowReview={(path) => { if (turnReview) setReviewFocus((f) => ({ path, seq: (f?.seq ?? 0) + 1, turnId: turnReview.turnId })); }}
        /></PanelBoundary>

        {/* AE-15 / CGP-ART-R-002 — review of what the last turn changed in the work folder. Never auto-dismissed. */}
        {!props.instructor && turnReview && (
          <PanelBoundary panel="turn-review"><TurnReviewBar
            view={turnReview}
            focus={reviewFocus?.turnId === turnReview.turnId ? reviewFocus : null}
            onRevert={(path) => postToHost({ type: "turnRevert", turnId: turnReview.turnId, ...(path === undefined ? {} : { path }) })}
            onKeep={() => postToHost({ type: "turnKeep", turnId: turnReview.turnId })}
            onClose={() => postToHost({ type: "turnReviewClose", turnId: turnReview.turnId })}
            onCheckpointSave={(message) => postToHost({ type: "checkpointSave", turnId: turnReview.turnId, message })}
          /></PanelBoundary>
        )}

        {showIdeas && ideaKey && <PanelBoundary panel="project-ideas">{() => <ProjectIdeas
          ideas={PROJECT_IDEAS.slice(0, PROJECT_IDEAS_MAX)}
          // Shown as chosen only while its sentence is still in the composer (the learner may have edited it away).
          picked={PROJECT_IDEAS.find((idea) => draft.includes(idea.prompt))?.id ?? null}
          // Mid-IME composition, a read-only (missing folder) draft, or a seat that cannot send: picks are inert.
          disabled={frozen || unavailable || folderMissing || composing || !!props.sendLocked || !!props.sendPending}
          onPick={(idea) => {
            if (composing || folderMissing) return;
            // Same ownership rule as reply choices: prepares an editable draft, keeps manual text, never sends.
            handleReplyChoice(idea.prompt);
          }}
          onOwn={() => {
            const next = withIdeaDismissal(dismissedIdeas, ideaKey);
            setDismissedIdeas(next);
            patchWebviewState({ [PROJECT_IDEAS_STATE_KEY]: next });
            textareaRef.current?.focus({ preventScroll: true });
          }}
        />}</PanelBoundary>}

        {showFollowUpChips && !showIdeas && (
          <ChipRack
            chips={ux.suggestions.follow_up}
            onPick={handleChip}
            label="이어서 이런 것도 해볼래요?"
          />
        )}

        {error && props.safetyNotice ? (
          <SafetyNotice view={props.safetyNotice} onDismiss={() => recoverToComposer(props.onDismissError)} />
        ) : activityStatus ? <ActivityStatus status={activityStatus}
          onOpen={() => postToHost({type:'activityLocalFile',action:'open'})}
          onExport={() => postToHost({type:'activityLocalFile',action:'export'})}
          onTakeaway={props.config?.workTakeawayEnabled ? () => postToHost({type:'workTakeaway'}) : undefined}
          onRecover={() => { props.onDismissError(); postToHost({type:'refreshAccess'}); }}
          onSupport={props.onReportProblem} onToken={() => postToHost({type:'setToken'})}>
          {audience === 'solo' && props.trialEndCard && props.onTrialEndCardPasses && <TrialEndCard card={props.trialEndCard} onPasses={props.onTrialEndCardPasses} continuationDraft={draft} allowPersonalClaude={personalWorkspace && config?.profile?.profile_id === "studio-open-trial" && config?.profile?.minor_cohort !== true} onDismiss={() => { postToHost({ type: "trialEndCardDismiss" }); props.onDismissError(); }} />}
        </ActivityStatus> : error && audience === 'solo' && props.trialEndCard && props.onTrialEndCardPasses ? (
          <PanelBoundary panel="trial-end" blocking><TrialEndCard card={props.trialEndCard} onPasses={props.onTrialEndCardPasses} continuationDraft={draft} allowPersonalClaude={personalWorkspace && config?.profile?.profile_id === "studio-open-trial" && config?.profile?.minor_cohort !== true} onDismiss={() => { postToHost({ type: "trialEndCardDismiss" }); props.onDismissError(); }} /></PanelBoundary>
        ) : error && (
          <ErrorBanner
            message={error}
            requestId={props.errorRequestId}
            runbookUrl={props.errorRunbookUrl}
            canRetry={props.canRetryLast && recovered.length === 0}
            onRetry={() => { if (composerBlockedByEdit(editingId, editableId)) { setImgNote(EDIT_OPEN_NOTE); return; } recoverToComposer(() => { sendWhenOnline(props.onRetryLast, 'press'); }); }}
            onDismiss={() => recoverToComposer(props.onDismissError)}
            onReport={props.onReportProblem}
            audience={audience}
          />
        )}
      </div>

      {personalWorkspace && viewport.away && <div className="hps-catchup">
        <button type="button" onClick={viewport.toLatest}><ChatIcon kind="down" />최신 메시지</button>
      </div>}

      {rollExpand !== null && (
        <RollExpandHint
          probe={ux.hints.roll_input_button.probe_md}
          original={rollExpand.original}
          onCancel={() => setRollExpand(null)}
        />
      )}

      <footer className="hps-input-area">
        {!props.instructor && config?.profile?.lesson && <PanelBoundary panel="goal-status">{() => <GoalStatusBar
          config={config} view={goalOfLesson(studentGoal, config.profile!.lesson)}
          pending={goalPending} note={goalNote} onSave={sendGoalSave} />}</PanelBoundary>}

        {lowDisk && <LowDiskBar notice={lowDisk} />}
        {props.refusal && <RefusalBanner onDismiss={() => {
          props.onDismissRefusal?.();
          textareaRef.current?.focus({ preventScroll: true });
        }} />}
        {props.pageAttachment && <PageAttachment attachment={props.pageAttachment} onRemove={props.onRemovePageAttachment ? removePageAttachment : undefined} />}
        {/* CGP-KNOW-R-020: failure rows live in the footer (never inside the shrinking message list), so the reason stays readable. */}
        <AttachmentFailures items={attachmentSend.failures} retry={attachmentSend.retry} remove={id=>{
          const file=attachmentSend.remove(id);
          if(file?.stageId) {setStagedPhotos(old=>old.filter(p=>p.id!==file.stageId));postToHost({type:'discardStagedImage',stageId:file.stageId});}
          if(file?.dataUrl) setPendingImages(old=>old.filter(url=>url!==file.dataUrl));
        }} />
        <AttachmentFailures items={attachmentFailures.items} retry={attachmentFailures.retry} remove={attachmentFailures.remove} />
        {/* Personal chat (#1763, REQ-STUDIO-CHAT-DETAIL): model, thinking depth and usage live in the
            settings dialog; only an access problem shows a recovery entry here. Classroom keeps its rows. */}
        {!personalWorkspace && <><ModelControl config={config} streaming={streaming} />
          <EffortControl config={config} post={postToHost} />
          <AccessControl config={config} streaming={streaming} post={postToHost} /></>}
        {personalWorkspace && accessNeedsAttention && <div className="hps-notice-caution hps-access-attention" role="status">
          <span>이용권 상태를 확인해 주세요.</span><button type="button" onClick={() => openPreferences(true)}>이용권 확인</button>
        </div>}
        {runnerCohort && <RunnerBar face={runnerWho} running={runnerRunning} />}
        {/* The button is in the header; **only the result** appears here. One header row
            has no room for either the link or the failure reason, and a kid cannot read
            a notice that disappears — so it stays as one line above the composer, only
            when there is something to say. */}
        {props.publish && props.publish.state !== "uploading" && (
          <GalleryNotice
            publish={props.publish}
            onOpenUrl={(url) => postToHost({ type: "openExternal", url })}
          />
        )}
        {worlds.length > 0 && (
          <WorldStrip
            worlds={worlds}
            openId={props.openWorldId}
            disabled={busy}
            /* When the conversation is empty (first screen, right after Clear) the
               instruction about what to press is needed again — in kids-quest the
               first-screen chips overlap the strip and drop out entirely, so this one
               line is the only instruction. */
            showLabel={props.openWorldId === null || messages.length === 0}
            onPick={handleWorldPick}
          />
        )}
        {shortHintVisible && (
          <div className="hps-hint" dangerouslySetInnerHTML={{
            __html: renderInlineMd(ux.hints.short_input.message_md),
          }} />
        )}
        <div className="hps-sr-only" role="status" aria-live="polite" aria-atomic="true" aria-hidden={noteInSummary || undefined} data-testid="attachment-announcer">{imgNote || ''}</div>
        {imgNote && <div id={imageNoteId} className="hps-img-note">{imgNote}</div>}
        {freeEnded && <p id="hps-free-ended-note" className="hps-free-ended-note">{freeSeatEndedNote(freeEnded)}</p>}
        {recoveryAtCapacity && <div className="hps-recovery-notice" role="status">보관한 메시지를 먼저 다시 보내거나 정리해 주세요. 새 메시지는 입력창에 남아 있습니다.</div>}
        {recovered.length > 0 && <div className="hps-recovery-list" aria-label={`보내지 못한 메시지 ${recovered.length}개`}>
          {recovered.map((request, index) => <div className="hps-queued hps-recovered" role="status" aria-live="polite" key={index}>
            <span className="hps-queued-label">보내지 못한 메시지{request.toolMode === 'web-search' ? ' · 웹 검색' : ''}{request.images.length ? ` · 사진 ${request.images.length}장` : ''}</span>
            <span className="hps-queued-text" data-hp-tooltip={request.text}>{request.text}</span>
            <button type="button" className="hps-queued-send" disabled={streaming || frozen || props.sendPending || unavailable || props.sendLocked} onClick={() => retryRecovered(request)}>다시 보내기</button>
            <button type="button" className="hps-queued-send" disabled={streaming || frozen || props.sendPending || props.sendLocked} onClick={() => editRecovered(request)}>수정하기</button>
            {discardRequest === request ? <span className="hps-recovery-confirm" role="group" aria-label="메시지 삭제 확인" onKeyDown={event => {if(event.key === 'Escape' && !imeComposing(event)){event.preventDefault();setDiscardRequest(null);textareaRef.current?.focus({preventScroll:true});}}}>
              <span>이 메시지와 사진을 삭제할까요?</span>
              <button type="button" className="hps-queued-send" autoFocus onClick={() => {setDiscardRequest(null);requestAnimationFrame(() => textareaRef.current?.focus({preventScroll:true}));}}>취소</button>
              <button type="button" className="hps-queued-send" onClick={() => {setRecovered(items => items.filter(item => item !== request));setDiscardRequest(null);setImgNote(null);textareaRef.current?.focus({preventScroll:true});}}>삭제 확인</button>
            </span> : <button type="button" className="hps-queued-send" onClick={() => setDiscardRequest(request)}>삭제</button>}
          </div>)}
        </div>}
        {steerDelivery?.scope === steerScope && <SteerDelivery key={`${steerDelivery.scope}:${steerDelivery.from}`} delivery={steerDelivery} messages={messages} streamFor={props.streamFor} streaming={streaming} sendPending={props.sendPending} onDone={clearSteerDelivery} />}
        {queued !== null && (
          // #416 — what is parked, and how to take it back. Cancel returns it to
          // the draft (see restoreQueuedToDraft): the × must not mean "delete".
          <div className="hps-queued" role="status" aria-live="polite">
            <span className="hps-queued-label">{queuedPaused ? '보관한 메시지' : '다음에 보낼 메시지'}{queuedToolMode === 'web-search' ? ' · 웹 검색' : ''}</span>
            <span className="hps-queued-text" data-hp-tooltip={queued}>{queued}</span>
            {queuedPaused && !streaming && <button type="button" className="hps-queued-send" disabled={props.sendPending || unavailable || props.sendLocked} onClick={() => {
              const editor = textareaRef.current;
              const selection = editor && [editor.selectionStart, editor.selectionEnd, editor.selectionDirection] as const;
              if (submit(queued, queuedToolMode)) {
                setQueued(null); setQueuedPaused(false);
                // This action disappears after sending; keep typing in the untouched next draft.
                editor?.focus({ preventScroll: true });
                if (editor && selection) editor.setSelectionRange(...selection);
              }
            }}>보내기</button>}
            {steerShown && <button type="button" className="hps-queued-send hps-queued-steer" aria-disabled={steerPending || undefined} onClick={steerNow}>{steerPending ? STEER_STOPPING_LABEL : STEER_LABEL}</button>}
            <button
              type="button"
              className="hps-queued-cancel"
              onClick={cancelQueued}
              data-hp-tooltip="예약 취소 — 입력창으로 되돌려요"
              aria-label={queuedPaused ? "보관한 메시지 입력창으로 가져오기" : "예약 취소"}
            >
              ×
            </button>
          </div>
        )}
        {/* CGP-SHELL-R-035 — never drawn while a turn runs or a send (chat or rehearsal) is pending; drawing it is the "seen" record. */}
        {whatsNew.show && whatsNew.notes && !streaming && !props.sendPending && rehearsalResult?.state !== 'sending' && <WhatsNewPanel notes={whatsNew.notes} onDismiss={() => {
          dismissWhatsNew();
          requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
        }} />}
        {/* CGP-CHAT-R-021 — at most one tip, from the served step's Chalk-authored hint only. Hidden while a turn runs. */}
        {lessonTip && !streaming && !props.sendPending && !dismissedTips.includes(lessonTip.key) && <PanelBoundary panel="lesson-tip">{() => <LessonTip
          tip={lessonTip}
          disabled={frozen || unavailable || !!props.sendLocked || folderMissing}
          onUse={() => {
            if (streaming || frozen || unavailable || props.sendLocked || props.sendPending || folderMissing) return;
            setDraft(current => prefillWithTip(current, lessonTip.text));
            requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
          }}
          onDismiss={() => {
            const next = withDismissed(dismissedTips, lessonTip.key);
            setDismissedTips(next);
            patchWebviewState({ [LESSON_TIP_STATE_KEY]: next });
            requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
          }}
        />}</PanelBoundary>}
        {preparingImages > 0 && (
          <div className="hps-image-preparing" role="status">이미지 {preparingImages}장을 준비하고 있어요. 준비가 끝나면 보낼 수 있어요.</div>
        )}
        {pendingImages.length > 0 && (
          <div className="hps-attachments" aria-label="첨부한 이미지">
            {pendingImages.map((url, i) => (
              <div key={i} className="hps-attachment">
                <img src={url} alt={`첨부 이미지 ${i + 1}`} />
                <button
                  type="button"
                  className="hps-attachment-remove"
                  onClick={() => removePendingImage(i)}
                  data-hp-tooltip="이미지 제거"
                  aria-label="이미지 제거"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {stagedPhotos.length > 0 && (
          <>
            <div className="hps-attachments" aria-label="첨부한 사진">
              {stagedPhotos.map((p) => (
                <div key={p.id} className="hps-attachment hps-attachment-file" data-hp-tooltip={p.name}>
                  {p.thumb ? <img src={p.thumb} alt={p.name} /> : <span className="hps-attachment-name">{p.ready || p.error ? p.name : "준비 중…"}</span>}
                  {p.error && <div className="hps-photo-failure"><AttachmentFailureBadge reason={p.error}/><p>{p.error}</p><button type="button" onClick={() => { const file = photoSources.current.get(p.id); if (file && !p.repick) stagePhoto(p.id, file); else postToHost({type:'repickAttachment',id:p.id,name:p.name}); }}>{p.repick ? '이 파일 다시 선택' : '이 파일만 다시 시도'}</button></div>}
                  <button
                    type="button"
                    className="hps-attachment-remove"
                    onClick={() => removeStagedPhoto(p.id)}
                    data-hp-tooltip="사진 빼기"
                    aria-label={`${p.name} 빼기`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="hps-img-note">보내면 작업 폴더의 images 폴더에 저장돼요.</div>
          </>
        )}
        {draftParts.some(part => part.id !== undefined) && <div className="hps-pasted-list" aria-label="붙여넣은 글 목록">
          {draftParts.filter(part => part.id !== undefined).map(part => <PastedDraft key={part.id} part={part} disabled={unavailable || folderMissing}
            onChange={text => {
              if (draft.length - part.text.length + text.length > 200000) { setImgNote('입력할 수 있는 글의 길이를 넘었어요.');return; }
              setDraftParts(previous => changePaste(previous, part.id!, text));
            }}
            onRemove={() => removePaste(part.id!)}
            onInline={() => { setDraftParts(previous => changePaste(previous, part.id!, part.text, true));requestAnimationFrame(() => textareaRef.current?.focus()); }} />)}
        </div>}
        {/* CGP-CHAT-D85 — bottom of the chat pane, directly above the composer. */}
        <UndoToast scope={undoScope} composer={() => textareaRef.current} />
        <div
          className={`hps-input${dragActive ? " hps-input-drag" : ""}`}
          data-expanded={personalWorkspace ? composerExpanded && !folderMissing : undefined}
          data-file-context={!folderMissing && (props.fileAttachment || props.fileAttachNotice) ? "true" : undefined}
          data-folder-missing={folderMissing || undefined}
          onMouseDown={event => composerSurfacePress(event, textareaRef.current)}
        >
          {folderMissing && missingFolder && <PanelBoundary panel="missing-folder" blocking><MissingFolderNotice notice={missingFolder} onRepick={() => postToHost({ type: "missingTaskFolderRepick" })} onRecheck={() => postToHost({ type: "missingTaskFolderRequest" })} /></PanelBoundary>}
          {folderMissing && <span id="missing-folder-draft-label" className="hps-missing-folder-draft-label">작성 중인 내용 · 읽기 전용</span>}
          {/* CGP-CHAT-D06: the refusal text sits directly under the chip row, inside the composer card.
              CGP-AGENT-D-024: in read-only folder recovery nothing can be sent, so pending file chips are not shown. */}
          {!folderMissing && (props.fileAttachment || props.fileAttachNotice) && <div className="hps-file-context-stack">
            {props.fileAttachment && <FileContextChip file={props.fileAttachment} onRemove={props.onRemoveFileAttachment ? removeFileAttachment : undefined} />}
            {props.fileAttachNotice && <p className="hps-file-attach-notice" role="status" data-testid="file-attach-notice">{props.fileAttachNotice}</p>}
          </div>}
          {personalWorkspace && !folderMissing && <ComposerTools mode={toolMode} onMode={setToolMode} webSearch={config?.turnTools?.webSearch} locked={queued !== null || !!props.sendPending} onAttach={imagePasteEnabled || imageFilesEnabled ? () => imagePicker.current?.click() : undefined} onAttachFile={fileAttachShown ? props.onAttachFile : undefined} onSketch={sketchAllowed ? () => setSketchOpen(true) : undefined} />}
          {/* CGP-CHAT-R-011 — a classroom seat has no tool menu; it gets one with the file item only. */}
          {!personalWorkspace && (fileAttachShown || sketchAllowed) && <ComposerTools mode={toolMode} onMode={setToolMode} locked={queued !== null || !!props.sendPending} onAttachFile={fileAttachShown ? props.onAttachFile : undefined} onSketch={sketchAllowed ? () => setSketchOpen(true) : undefined} webSearchItem={false} />}
          {/* CGP-CHAT-D-018: the @ file list floats above the composer card, anchored at the @ that opened it. */}
          {fileMentions.view}
          {personalWorkspace && <input ref={imagePicker} type="file" accept="image/*" multiple hidden aria-label="첨부할 이미지 선택" onChange={event => { const files = [...(event.target.files ?? [])]; if (imageFilesEnabled) stagePhotoFiles(files); else if (imagePasteEnabled) attachImageFiles(files); event.target.value = ''; }} />}
          <textarea
            ref={textareaRef}
            autoFocus
            readOnly={unavailable || folderMissing}
            aria-label={folderMissing ? "보관한 초안 (읽기 전용)" : composerLabel(coachName)}
            aria-describedby={[freeEnded ? "hps-free-ended-note" : '', folderMissing ? "missing-folder-draft-label" : personalWorkspace ? "personal-composer-hint" : '', imgNote ? imageNoteId : ''].filter(Boolean).join(' ') || undefined}
            aria-autocomplete={config?.fileMentions ? "list" : undefined}
            aria-controls={fileMentions.open ? fileMentions.listId : undefined}
            aria-activedescendant={fileMentions.activeId}
            onSelect={event => fileMentions.setCaret(event.currentTarget.selectionStart)}
            onBlur={fileMentions.blur}
            value={composerText}
            onChange={(e) => {
              if (folderMissing) return;
              // Manual edits own the entire draft, even if it ends with an old choice.
              lastReplyChoice.current = null;
              const value = e.target.value;setDraftParts(previous => editVisible(previous, value));fileMentions.setCaret(e.target.selectionStart);
            }}
            onPaste={handlePaste}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              const isComposing = imeComposing(e, composing);
              if (!isComposing && fileMentions.keyDown(e)) return;
              // CGP-DS-R-027: composition keys stay with the IME and never reach the panel,
              // workspace or menu handlers above (Escape would close the sources panel).
              if (isComposing) { e.stopPropagation(); return; }
              // Remove only the queued file at the caret's start; preserve the draft and selection edits.
              if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
                && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0
                && props.fileAttachment && props.onRemoveFileAttachment) {
                e.preventDefault();
                removeFileAttachment();
                return;
              }
              // Composing Hangul: Enter commits the syllable, it must never
              // send. Unchanged from before — typing mid-turn does not make the
              // IME any less load-bearing.
              if (e.key !== "Enter" || e.shiftKey || isComposing || unavailable || folderMissing) return;
              e.preventDefault();
              if (imagePreparationBlocksSend()) return;
              // Roll-expand owns Enter while it is open (idle-only flow).
              if (rollExpand && !streaming) {
                handleRollSend();
                return;
              }
              // #416 — mid-turn Enter parks the message instead of sending it.
              const decision = decideEnter({
                draft,
                streaming,
                queued,
                hasImages: pendingImages.length > 0 || stagedPhotos.length > 0,
              });
              if (decision.action === "ignore") return;
              if (decision.action === "queue") {
                if (queued !== null && (queuedPaused || queuedToolMode !== toolMode)) { setImgNote('보관한 메시지를 먼저 보내거나 입력창으로 가져와 주세요. 지금 입력한 내용은 그대로입니다.'); return; }
                setQueuedToolMode(toolMode);
                setQueued(decision.queued);
                setDraft("");
                return;
              }
              submit();
            }}
            placeholder={
              personalWorkspace ? (streaming ? '다음 메시지를 준비하세요' : '메시지를 입력하세요') : streaming
                ? queued
                  ? "이어서 적으면 예약 메시지에 덧붙여요"
                  : "응답 중에도 적을 수 있어요 — Enter 로 예약하면 끝나고 바로 보내요"
                : rollExpand
                  ? "한 가지만 더 떠올려서 적어주세요"
                  : imagePasteEnabled
                    ? platformizeKeys("메시지를 입력하고 Enter — 이미지는 ⌘V로 붙여넣기 (Shift+Enter 줄바꿈)")
                    : "메시지를 입력하고 Enter (Shift+Enter 줄바꿈)"
            }
            rows={personalWorkspace ? 1 : 3}
          />
          {personalWorkspace && !folderMissing && toolMode === 'web-search' && <SelectedTool locked={queued !== null || !!props.sendPending} onClear={() => { setToolMode('auto'); textareaRef.current?.focus({ preventScroll: true }); }} />}
          {(!folderMissing || streaming) && <div className="hps-input-buttons">
            {personalWorkspace && !folderMissing && <span id="personal-composer-hint" className="hps-composer-hint">{streaming ? 'Enter 예약 · Shift+Enter 줄바꿈' : 'Enter 보내기 · Shift+Enter 줄바꿈'}</span>}
            {!folderMissing && !streaming && ux.hints.roll_input_button.enabled && !rollExpand && (
              <button
                onClick={handleRollClick}
                disabled={!draft.trim()}
                className="hps-btn-roll"
                data-hp-tooltip="떠오른 것에 한 줄 더 보태기"
              >
                {ux.hints.roll_input_button.label}
              </button>
            )}
            {streaming ? (
              <button
                onClick={() => {
                  // #416 — a parked message survives the stop as draft text.
                  restoreQueuedToDraft();
                  props.onCancel();
                  if (personalWorkspace) textareaRef.current?.focus({ preventScroll: true });
                }}
                className="hps-btn-stop"
                aria-label={personalWorkspace ? '응답 멈추기' : undefined}
                data-hp-tooltip={personalWorkspace ? '응답 멈추기' : undefined}
              >
                {personalWorkspace ? <ChatIcon kind="stop" /> : 'Stop'}
              </button>
            ) : rollExpand ? (
              <button
                onClick={handleRollSend}
                disabled={!draft.trim()}
                className="hps-btn-send"
                aria-label={personalWorkspace ? '메시지 보내기' : undefined}
                data-hp-tooltip={personalWorkspace ? '메시지 보내기' : undefined}
              >
                {personalWorkspace ? <ChatIcon kind="send" /> : '보내기'}
              </button>
            ) : (
              <button
                onClick={() => { if (submit() && personalWorkspace) textareaRef.current?.focus({ preventScroll: true }); }}
                disabled={attachmentSend.busy || attachmentFailures.items.length > 0 || preparingImages > 0 || (!draft.trim() && pendingImages.length === 0 && stagedPhotos.length === 0) || unavailable || props.sendLocked || props.sendPending || stagedPhotos.some((p) => !p.ready)}
                className="hps-btn-send"
                aria-label={personalWorkspace ? '메시지 보내기' : undefined}
                data-hp-tooltip={personalWorkspace ? '메시지 보내기' : undefined}
              >
                {personalWorkspace ? <ChatIcon kind="send" /> : '보내기'}
              </button>
            )}
          </div>}
        </div>
        <AttachmentFailureNotice items={composerFailures} fallback={props.fileAttachError}/>
        <CopyFeedbackOutlet />
      </footer>
      {sketchOpen && <SketchDialog scope={JSON.stringify([activityId,taskId])} allowed={sketchAllowed} onClose={() => setSketchOpen(false)} onAttach={png => {
        if (!sketchAllowedRef.current || imageCount.current >= MAX_IMAGES) return false;
        imageCount.current++;setPendingImages(previous => [...previous,png]);setImgNote('그림을 작업 폴더의 assets에 저장하고 붙였어요. 보내기를 누르면 함께 보내요.');return true;
      }} />}
      {/* CGP-SHELL-D-028: in the DOM only while the chip has it open (A5 old-profile identity). */}
      {!personalWorkspace && preferencesOpen && <ChatPreferences open={preferencesOpen} onClose={() => { setPreferencesOpen(false); setPreferencesUsage(false); }} initialFocus=".hps-access > summary" opener={() => preferencesOpener.current}>
        <AccessControl key={preferencesUsage ? 'usage' : 'plain'} config={config} streaming={streaming} post={postToHost} defaultOpen={preferencesUsage} />
        {/* CGP-SHELL-R-028 — local zip of the work folder and the conversation record; no Service call, so it stays after a pass ends. */}
        <button type="button" className="hps-all-settings hps-export-work" onClick={() => { setPreferencesOpen(false); setPreferencesUsage(false); postToHost({ type: 'exportMyWork' }); }}>내 작업 내보내기</button>
        <button type="button" className="hps-all-settings hps-open-shortcuts" onClick={openShortcutsFromPreferences}>키보드 단축키</button>
        <button type="button" className="hps-all-settings hps-open-shortcuts hps-open-whats-new" onClick={openWhatsNewFromPreferences}>새로운 기능</button>
      </ChatPreferences>}
      {personalWorkspace && <ChatPreferences open={preferencesOpen} onClose={() => { setPreferencesOpen(false); setPreferencesUsage(false); }} initialFocus={preferencesUsage ? '.hps-access > summary' : undefined}>
        {/* CGP-SHELL-R-013 — the dialog (and its close button) stays; only its content falls back. */}
        <PanelBoundary panel="settings">{() => <>
        <details className="hps-advanced-response"><summary>응답 고급 설정</summary>
          <p>선택한 설정은 다음 요청부터 적용됩니다.</p>
          <ModelControl config={config} streaming={streaming} />
          <EffortControl config={config} post={postToHost} personal />
        </details>
        <fieldset className="hps-text-size">
          <legend>글자 크기</legend>
          {TEXT_SIZES.map(size => <label key={size}>
            <input type="radio" name="hps-text-size" value={size} checked={normalizeTextSize(config.textSize) === size}
              onChange={() => { viewport.captureReadingPosition(); postToHost({ type: 'setTextSize', size }); }} />
            <span>{TEXT_SIZE_LABELS[size]}</span>
          </label>)}
        </fieldset>
        {config.learnerNickname && <NicknameSetting key={config.activity?.id ?? ''} saved={config.learnerNickname.value} post={postToHost} />}
        <AccessControl key={preferencesUsage ? 'usage' : 'plain'} config={config} streaming={streaming} post={postToHost} defaultOpen={preferencesUsage} />
        {showsObservationResults(config.profile?.observation) && <PanelBoundary panel="observation"><NativeObservationPanel scope={config.profile!.observation!.scope} coachName={coachName} /></PanelBoundary>}
        {/* CGP-SHELL-R-028 — local zip of the work folder and the conversation record; no Service call, so it stays after a pass ends. */}
        <button type="button" className="hps-all-settings hps-export-work" onClick={() => { setPreferencesOpen(false); setPreferencesUsage(false); postToHost({ type: 'exportMyWork' }); }}>내 작업 내보내기</button>
        <button type="button" className="hps-all-settings hps-open-shortcuts" onClick={openShortcutsFromPreferences}>키보드 단축키</button>
        <button type="button" className="hps-all-settings hps-open-shortcuts hps-open-whats-new" onClick={openWhatsNewFromPreferences}>새로운 기능</button>
        <button type="button" className="hps-all-settings" onClick={() => { setPreferencesOpen(false); props.onSettings(); }}>앱 설정 열기</button>
        </>}</PanelBoundary>
      </ChatPreferences>}
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} opener={() => shortcutsOpener.current} />
      <WhatsNewSheet open={whatsNewSheetOpen} notes={whatsNew.notes} loaded={whatsNew.loaded} onClose={() => setWhatsNewSheetOpen(false)} opener={() => shortcutsOpener.current} />
    </div></CopyFeedbackRegion>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * CGP-AGENT-R-003: every REQ-M38 key is listed; an off key reads "안 해요" so nothing is implied.
 * REQ-STUDIO-UI-POLISH-1: closed by default (R-032 opens the first lesson entry), with a one-line summary that already says how many of the
 * listed things the AI does here ("6가지 중 4가지", so the count matches the rows that open); each row is a mark, the label and one state word in the same quiet style.
 */
function LessonCapabilitySheet({ items, solo, onAcknowledge }: { items: NonNullable<ChatConfig['aiCapabilities']>; solo: boolean; onAcknowledge: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const entryComposing = useRef(false);
  // No opener return: this disclosure always hands focus to the preserved composer.
  useDialogFocus(dialog, { open: true, kind: 'modal', initialFocus: '.hp-capability-next', opener: () => null,
    fallback: () => document.querySelector<HTMLTextAreaElement>('.hps-input textarea') });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>('.hp-capability-next')?.focus();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="hp-capability-sheet" aria-label="AI 안내"
    onCompositionStart={() => { entryComposing.current = true; }} onCompositionEnd={() => { entryComposing.current = false; }}
    onKeyDownCapture={event => { if (imeComposing(event, entryComposing.current)) { event.preventDefault(); event.stopPropagation(); } }}
    onCancel={event => { event.preventDefault(); if (!entryComposing.current) onAcknowledge(); }}>
    <AiCanDo items={items} solo={solo} expanded onNext={onAcknowledge} />
  </dialog>;
}

function AiCanDo({ items, solo, expanded, onNext }: { items: NonNullable<ChatConfig['aiCapabilities']>; solo: boolean; expanded?: boolean; onNext?: () => void }) {
  const onCount = items.filter(item => item.on).length;
  // Trial diagnosis D3: a solo seat (trial, pass, personal) has no lesson and no teacher.
  return <details className="hp-rail-lesson hp-ai-can-do" open={expanded}>
    <summary onClick={expanded ? event => event.preventDefault() : undefined}>
      <span className="hp-ai-can-do-title">{solo ? '여기서 AI가 할 수 있는 일' : '이 수업에서 AI가 할 수 있는 일'}</span>
      <span className="hp-ai-can-do-count">{onCount ? `${items.length}가지 중 ${onCount}가지` : '지금은 없음'}<span className="hp-ai-can-do-more"> · 자세히</span></span>
    </summary>
    <ul>
      {items.map(item => <li key={item.key} data-capability={item.key} data-on={item.on ? 'true' : 'false'} aria-label={`${item.label}: ${aiCapabilityState(item)}`}>
        <span className="hp-ai-can-do-mark"><ChatIcon kind={!item.on ? 'minus' : item.asks === true ? 'info' : 'check'} size={16} /></span>
        <span className="hp-ai-can-do-label">{item.label}</span>
        <span className="hp-ai-can-do-state">{aiCapabilityState(item)}</span>
      </li>)}
    </ul>
    {items.some(item => item.on && item.asks === true) && <p className="hp-rail-lesson-note">물어봐요: 확인이 필요한 동작을 하기 전에 허락을 받아요. 이미 허락했거나 확인이 필요 없는 동작은 바로 할 수 있어요.</p>}
    {onNext && <button className="hp-capability-next" type="button" onClick={onNext}>알겠어요</button>}
    <p className="hp-rail-lesson-note">{solo ? '지금 쓰는 체험·이용권에서 정해진 범위예요.' : '수업 설정이 정한 범위예요. 바꾸려면 선생님께 이야기해 주세요.'}</p>
  </details>;
}

/** CGP-SHELL-R-024: one calm line per change, in the REQ-M47 card's words; "알겠어요" closes it for good. */
function CapabilityChangeCard({ change, onDismiss }: { change: NonNullable<ChatConfig['capabilityChange']>; onDismiss: (id: string) => void }) {
  // REQ-STUDIO-FOCUS-RESTORE: the system shows it (no opener, no focus taken); when 알겠어요 removes
  // it, focus goes to the composer instead of <body>.
  const card = useRef<HTMLDivElement>(null);
  useDialogFocus(card, { open: true, kind: 'inline', initialFocus: false, opener: () => null });
  return <div ref={card} className="hps-stop-notice hps-capability-change" role="status" aria-live="polite" data-capability-change={change.id}>
    <span className="hps-stop-notice-icon"><ChatIcon kind="info" size={16} /></span>
    <div>
      <p>{CAPABILITY_CHANGE_COPY.title}</p>
      {change.added.length > 0 && <p data-change="added">{CAPABILITY_CHANGE_COPY.added} — {change.added.join(', ')}</p>}
      {change.removed.length > 0 && <p data-change="removed">{CAPABILITY_CHANGE_COPY.removed} — {change.removed.join(', ')}</p>}
    </div>
    <button type="button" className="hp-cta-quiet" onClick={() => onDismiss(change.id)}>{CAPABILITY_CHANGE_COPY.dismiss}</button>
  </div>;
}

/** One world the profile ships down (reuses the host protocol's definition as-is). */
type WorldChoice = NonNullable<ResolvedProfile["worlds"]>[number];

/**
 * One line of publish result. The button is in the header (next to Token); this says
 * **only the result**.
 *
 * Why success stays up: a kid cannot read a notice that disappears. The link has to
 * stay there so they can show it to the friend sitting next to them, or to a parent.
 * Changing worlds clears this state through App's `worldOpened` — from then on it is a
 * different world's story.
 *
 * The failure text is never truncated. "why it did not work" is this feature's only
 * recovery clue.
 */
function GalleryNotice({
  publish,
  onOpenUrl,
}: {
  publish: { state: "done"; url: string } | { state: "error"; message: string };
  onOpenUrl: (url: string) => void;
}) {
  if (publish.state === "done") {
    return (
      <div className="hps-gallery-notice hps-gallery-done" role="status" aria-live="polite">
        <ChatIcon kind="image" size={16} /> 갤러리에 올렸어요!{" "}
        <button type="button" className="hps-gallery-link" onClick={() => onOpenUrl(publish.url)}>
          보러 가기
        </button>
      </div>
    );
  }
  return (
    <div className="hps-gallery-notice hps-gallery-error" role="status" aria-live="polite">
      {publish.message}
    </div>
  );
}

/**
 * #649 — the friend strip. **Always** right above the composer (mid-conversation and
 * mid-response too).
 *
 * Why buttons: in v0.1.47/48, which also accepted world switches in prose, "초코 세상에
 * 다람쥐 데려와줘" opened 도토's world, and "초코 세상에 불 대신 물" re-fetched the
 * original 초코 and overwrote the screen the kid had fixed up (2026-08-20, real device).
 * Worlds now change only through this button.
 *
 * Disabled while responding — swapping the world in the middle attaches the answer now
 * arriving to somebody else's world. A click sends the chip text **verbatim** (the
 * host's matchWorldRef only catches an exact match, so not one character is touched up).
 */
function WorldStrip({
  worlds,
  openId,
  disabled,
  showLabel,
  onPick,
}: {
  worlds: WorldChoice[];
  openId: string | null;
  disabled: boolean;
  showLabel: boolean;
  onPick: (chip: string) => void;
}) {
  return (
    <div className="hps-worlds-wrap">
      {/* A one-line instruction when the conversation is empty or no world has been
          opened yet. The first-screen chips (same wording) are hidden because they
          overlap the strip, so the "what to press" has to be said here at least once.
          2026-08-20 review: the condition was `openId === null` alone, so **right after
          Clear** the first screen was empty — no chips and no label. The arrow points
          down — the buttons are directly below this line (matching the wording and
          direction of the guest-list answer). */}
      {showLabel && <div className="hps-worlds-label"><ChatIcon kind="down" size={16} /> 친구를 누르면 그 세상으로 가요</div>}
      <div className="hps-worlds" role="group" aria-label="친구 고르기">
        {worlds.map((w) => {
          const open = w.id === openId;
          return (
            <button
              key={w.id}
              type="button"
              className={`hps-world${open ? " hps-world-open" : ""}`}
              aria-pressed={open}
              /* The world currently open cannot be pressed again (2026-08-20 review). A
                 re-click means 're-fetch the pristine original and overwrite
                 index.html', so a world worked on for 20 minutes is reset by one
                 misoperation — and the most eye-catching color (button-background)
                 happens to be on that very button, which makes it the first thing a
                 3rd/4th grader mis-taps. The archived copy survives, but undoing it is
                 something that has to go through the coach. */
              disabled={disabled || open}
              data-hp-tooltip={
                open
                  ? `${w.guest} 세상을 열어 뒀어요`
                  : w.line
                    ? `${w.guest} — ${w.line}`
                    : `${w.guest} 세상으로 가기`
              }
              onClick={() => onPick(w.chip)}
            >
              <span className="hps-world-emoji" aria-hidden="true">{w.emoji}</span>
              <span className="hps-world-name">{w.guest}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * #642 — the running guest. Fills the 1–3 minutes that used to sit static after
 * "Read ✓" (2026-08-20, real device: the kid read the frozen screen as broken and sent
 * the same message again — turns overlap).
 *
 * Why it always renders and only toggles a class: attaching and detaching it
 * conditionally cuts the moment of disappearance off abruptly and pops the composer up
 * 40px. Leaving it folded (max-height:0) lets CSS handle both directions smoothly.
 *
 * Hidden from screen readers (aria-hidden): reading out a phrase that changes every 4
 * seconds through a live region is noise. The accessible route to progress is the tool
 * log in the timeline ("✍️ 고치는 중…"); this bar is a visual device laid on top of it.
 */
/** One quiet-period hint; event receipts reset since, timer ticks never change announcements.
 * The existing response live region speaks phase changes and the learner Stop path is reused.
 */
function LongStepHintLine({ since, step, turn, onStop, onAnnounce }: { since: number; step: string | null; turn: { streaming: boolean; stalled: boolean; approvalPending: boolean }; onStop: () => void; onAnnounce: (text: string) => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    const stop = () => clearInterval(timer);
    return stop;
  }, [since]);
  const hint = idleTurnHint({ step, since, now: Date.now(), ...turn });
  const announce = hint?.announce ?? '';
  useEffect(() => { onAnnounce(announce); }, [announce, onAnnounce]);
  useEffect(() => {
    const clear = () => onAnnounce('');
    return clear;
  }, [onAnnounce]);
  if (!hint) return null;
  return (
    <section className="hps-long-step" data-phase={hint.phase}>
      <span className="hps-idle-progress-motion" aria-hidden="true"><span className="hps-idle-progress-dot">●</span></span>
      <span className="hps-long-step-text" aria-hidden="true">{hint.text}</span>
      {hint.offerStop && <span className="hps-long-step-offer">
        <span className="hps-long-step-choice" aria-hidden="true">{hint.choice}</span>
        <button type="button" className="hps-long-step-stop" style={{ minHeight: 'var(--ds-c-inline-hit-target)', minWidth: 'var(--ds-c-inline-hit-target)' }} onClick={onStop}>멈추기</button>
      </span>}
    </section>
  );
}

function RunnerBar({ face, running }: { face: RunnerFace; running: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    // When the turn ends, stop the timer and reset to 0 — the next turn has to start
    // over from "세상을 고치는 중…" (carrying on from "거의 다 됐어요…" would be a lie).
    if (!running) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), RUNNER_PHRASE_MS);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <div className={`hps-runner${running ? " hps-runner-on" : ""}`} aria-hidden="true">
      <div className="hps-runner-track">
        {/* The dust trails behind the face — CSS row-reverse flips the order.
            Under prefers-reduced-motion three dots just blink in place. */}
        <div className="hps-runner-go">
          <span className="hps-runner-face">{face.emoji}</span>
          <span className="hps-runner-dust" />
          <span className="hps-runner-dust" />
          <span className="hps-runner-dust" />
        </div>
      </div>
      <span className="hps-runner-say">{runnerPhrase(elapsed, face.guest)}</span>
    </div>
  );
}

function NamingCard({
  namingPromptMd,
  personalityPromptMd,
  fallbackName,
  icon,
  onSave,
}: {
  namingPromptMd: string;
  personalityPromptMd: string;
  fallbackName: string;
  icon: IconKind;
  onSave: (name: string, personality: string) => void;
}) {
  const [step, setStep] = useState<"name" | "personality">("name");
  const [name, setName] = useState("");
  const [personality, setPersonality] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const persRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 100);
  }, []);
  useEffect(() => {
    if (step === "personality") setTimeout(() => persRef.current?.focus(), 100);
  }, [step]);

  const goNext = () => {
    if (personalityPromptMd) setStep("personality");
    else onSave(name || fallbackName, "");
  };
  const finish = () => onSave(name || fallbackName, personality);

  return (
    <div className="hps-shell">
      <div className="hps-naming">
        <div className="hps-naming-emoji"><ChatIcon kind={icon} size={24} /></div>
        {step === "name" ? (
          <>
            <h2
              className="hps-naming-title"
              dangerouslySetInnerHTML={{ __html: renderInlineMd(namingPromptMd) }}
            />
            <input
              ref={nameRef}
              className="hps-naming-input"
              value={name}
              maxLength={20}
              placeholder={`예: 별이, 루카, 포포 (안 정하면 '${fallbackName}')`}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !imeComposing(e)) goNext();
              }}
            />
            <button className="hps-naming-btn" onClick={goNext}>
              다음 →
            </button>
          </>
        ) : (
          <>
            <h2
              className="hps-naming-title"
              dangerouslySetInnerHTML={{ __html: renderInlineMd(personalityPromptMd) }}
            />
            <input
              ref={persRef}
              className="hps-naming-input"
              value={personality}
              maxLength={60}
              placeholder="예: 친절하고 엉뚱한 친구 (건너뛰어도 돼요)"
              onChange={(e) => setPersonality(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !imeComposing(e)) finish();
              }}
            />
            <div className="hps-naming-row">
              <button className="hps-naming-btn-ghost" onClick={() => onSave(name || fallbackName, "")}>
                건너뛰기
              </button>
              <button className="hps-naming-btn" onClick={finish}>
                시작하기 →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  ux,
  coachName,
  greetingMd,
}: {
  ux: UxConfig;
  coachName: string;
  greetingMd: string;
}) {
  // Profile-driven greeting (welcome.greeting_md) is the source of truth per
  // cohort. For user-named coaches (kid cohorts), prepend a coach-intro line
  // so the kid sees the name they chose echoed back. For fixed-name cohorts
  // (e.g. adult professional teasers — naming_mode=fixed), the coach name is
  // just a generic label and shouldn't dilute the cohort framing.
  const showCoachIntro = ux.coach.naming_mode === "user_names_it" && coachName;
  const hasGreeting = greetingMd.trim().length > 0;

  return (
    <div className="hps-empty">
      <p className="hps-empty-greeting">
        {showCoachIntro && (
          <>
            안녕하세요! 저는 <strong>{coachName}</strong>{copulaParticle(coachName)}.
            {hasGreeting && <br />}
          </>
        )}
        {hasGreeting ? (
          <span dangerouslySetInnerHTML={{ __html: renderInlineMd(greetingMd) }} />
        ) : (
          !showCoachIntro && <>안녕하세요! 저는 <strong>{coachName}</strong>{copulaParticle(coachName)}.</>
        )}
      </p>
    </div>
  );
}

function ChipRack({
  chips,
  onPick,
  label,
}: {
  chips: SuggestionChip[];
  onPick: (c: SuggestionChip) => void;
  label: string;
}) {
  return (
    <div className="hps-chips-rack">
      <div className="hps-chips-label">{label}</div>
      <div className="hps-chips">
        {chips.map((c, i) => (
          <button
            key={i}
            className={`hps-chip hps-chip-${c.style}`}
            onClick={() => onPick(c)}
            disabled={c.style === "weak"}
            data-hp-tooltip={c.style === "weak" ? platformizeKeys(c.caption ?? "예시일 뿐이에요") : "탭하면 입력창에 들어가요"}
          >
            <span className="hps-chip-text">{platformizeKeys(c.text)}</span>
            {c.caption && (
              <span className="hps-chip-caption">{platformizeKeys(c.caption)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * #503 — one tool row inside the timeline. It used to be a single `.hps-tool-log` box
 * sitting **below** all the bubbles, so "what the coach said and then what it did"
 * could not be read off the screen. Now it sits exactly where it happened.
 *
 * The class names (`hps-tool-log-line` / `hps-tool-icon` / `hps-tool-label` /
 * `hps-tool-<state>`) are **left alone on purpose** — the e2e (t1-first-turn-trace) and
 * the observer (e2e/observe/watch.mjs) read activity through these selectors.
 */
/** REQ-STUDIO-CONTEXT-TRIM-MARKER — one quiet line in the conversation (CGP-CHAT-D16): not a bubble, not a toast. */
/** CGP-CHAT-R-023 (CGP-CHAT-D56) — a full-width hairline with the served step centred. Read-only: not focusable, no action. */
function StepDivider({ id, label }: { id: string; label: string }) {
  return <div className="hps-step-divider" role="separator" aria-label={label} data-step-divider={id}><span className="hps-step-divider-label" aria-hidden="true">{label}</span></div>;
}

function ContextNote({ text }: { text: string }) {
  return <div className="hps-context-note" role="note">{text}</div>;
}

export function ToolLine({ message, onReport }: { message: ChatMessage; onReport: () => void }) {
  const t = message.tool;
  if (!t) return null;
  const denial = t.state === "error" ? storedDenialNotice(t.label) : null;
  if (denial) {
    const view = denialNoticeView(denial);
    return <div className="hps-denial-notice" role="status" aria-live="polite" aria-atomic="true" data-denial-source={view.source}>
      <ChatIcon kind="lock" size={16} />
      <div><span className="hps-denial-source">{view.label}</span><p>{view.text}</p></div>
      <button type="button" onClick={onReport}>{view.action}</button>
    </div>;
  }
  // CGP-KNOW-D-021 — a Studio-browser download is a quiet secondary line, not a tool row.
  const download = message.id.startsWith('download-') ? downloadLineView(t.label, t.state) : null;
  if (download) return <DownloadLine id={message.id} view={download} />;
  // This row is a waiting indicator, never evidence that a file was changed.
  // Hide completed waits from old histories too; retain the stored timeline.
  if (message.id.startsWith('pending-') && t.state === 'done') return null;
  const shell = t.shell ?? storedShell(t.label);
  if (shell) return <div className={`hps-shell-row hps-tool-${t.state}`}>
    <p className="hps-shell-purpose">{shell.purpose}</p>
    <details open={!shell.collapsed}><summary>실행 명령 · {t.state === 'running' ? '처리 중' : t.state === 'error' ? '실패' : '완료'}</summary>
      <pre><code>{`$ ${shell.command}`}</code></pre>{shell.folder !== undefined && <p className="hps-shell-folder">폴더: {shell.folder}</p>}
    </details>
  </div>;
  const thinking = /^think-\d+$/.test(message.id);
  if (thinking && t.state === 'done') {
    return (
      <details className="hps-thinking-details">
        <summary className="hps-tool-log-line hps-tool-done" aria-label="AI 처리 내용 보기">
          <span className="hps-tool-icon" data-glyph={t.icon}><ChatIcon kind={glyphIconKind(t.icon)} size={16} /></span>
          <span className="hps-tool-label">응답 준비</span>
          <span className="hps-tool-mark"><ChatIcon kind="chevron-down" size={16} /></span>
        </summary>
        <pre>{t.label}</pre>
      </details>
    );
  }
  return (
    <div className={`hps-tool-log-line hps-tool-${t.state}`} role="status" aria-live="polite">
      {/* REQ-STUDIO-STROKE-ICONS: the host's glyph is a key; the row draws the stroke icon it names
          and drops a label's leading copy of it. The state mark has a Korean name: it is the only
          place that says whether the step failed. */}
      <span className="hps-tool-icon" data-glyph={t.icon}><ChatIcon kind={glyphIconKind(t.icon)} size={16} /></span>
      <span className="hps-tool-label">{thinking ? '응답을 준비하는 중…' : stripLeadingGlyph(t.label)}</span>
      <span className="hps-tool-mark">
        {t.state === "running" ? <ChatIcon kind="dots" size={16} label="처리 중" /> : t.state === "error" ? <ChatIcon kind="alert" size={16} label="실패" /> : <ChatIcon kind="check" size={16} label="완료" />}
      </span>
    </div>
  );
}

/** CGP-CHAT-D-015: a personal answer's action row is that turn's status line. One predicate decides
 * both where the row renders and where the elapsed receipt goes, so the receipt is never shown twice
 * or dropped. */
function answerActionRowShown(message: ChatMessage, personal: boolean, isStreamingThis: boolean): boolean {
  return personal && message.role === 'assistant' && !isStreamingThis && !!message.content.trim();
}

/** CGP-CHAT-R-015 / CGP-CHAT-D-015: observed terminal time, secondary text. `inline` = trailing item
 * of the answer action row; otherwise the receipt is the turn's own status line. */
function ElapsedReceipt({ message, inline = false }: { message: ChatMessage; inline?: boolean }) {
  const receipt = message.elapsedTurn;
  if (!receipt) return null;
  const text = `${elapsedWorkLabel(receipt.ms, receipt.outcome) ?? ''}${message.role === 'system' && !message.content ? ' · 답변 없음' : ''}`;
  if (!text) return null;
  return inline ? <span className="hps-turn-elapsed hps-turn-elapsed-inline" role="status">{text}</span> : <p className="hps-turn-elapsed" role="status">{text}</p>;
}

function MessageItem({
  message,
  streaming,
  isStreamingThis,
  ux,
  coachName,
  buildingLabel,
  tone,
  messages,
  hasActivity,
  onRunCode,
  onRetry,
  personal = false,
  isLatest = false,
  freeSeat = false,
  onPickReply,
  onWriteReply,
  onSubmitReply,
  replyTyping,
  replySelectionValid,
  pager,
  onPage,
  onEdit,
  editing = false,
  revertNote = false,
  onCancelEdit,
  onSaveEdit,
  editDraft,
  onEditChange,
  verdict,
  onVerdict,
  onToWiki,
  wikiScope,
  quotable = false,
  quoteAction,
  elapsed,
}: {
  message: ChatMessage;
  /** Turn-level: any stream in flight. Gates the retry button, not the spinner. */
  streaming: boolean;
  /** Row-level: THIS message is the one streaming. Gates the spinner (#429). */
  isStreamingThis: boolean;
  ux: UxConfig;
  coachName: string;
  buildingLabel: string;
  tone: "game" | "search" | "site" | "quest";
  messages: ChatMessage[];
  /** #414 — an activity log is on screen, so the spinner must not invent stages. */
  hasActivity: boolean;
  onRunCode: (html: string) => void;
  onRetry: (prompt: string, source?: ChatMessage) => void;
  personal?: boolean;
  /** Personal chat: retry is offered on the latest coach answer only (the ChatGPT/Claude pattern). */
  isLatest?: boolean;
  /**
   * Personal chat on the free allowance: no retry. A retry is a new turn (REQ-STUDIO-TURN-ID), so
   * a "refresh-looking" control would silently spend one of the ten free turns.
   */
  freeSeat?: boolean;
  onPickReply?: (answer: string) => void;
  onWriteReply?: () => void;
  onSubmitReply?: (answer: string) => boolean;
  replyTyping?: boolean;
  replySelectionValid?: boolean;
  /** CGP-CHAT-R-002 — this user line has earlier/later versions. */
  pager?: Pager;
  onPage?: (key: string, index: number) => void;
  /** Present on the one user line that may be edited now. */
  onEdit?: () => void;
  editing?: boolean;
  revertNote?: boolean;
  onCancelEdit?: () => void;
  onSaveEdit?: (text: string, images: string[]) => void;
  editDraft?: InlineEditDraft;
  onEditChange?: (text: string, images: string[]) => void;
  /** CGP-CHAT-R-005 — present (null = no verdict yet) on an answer that offers a verdict. */
  verdict?: VerdictState | null;
  onVerdict?: (next: VerdictState | null) => void;
  /** CGP-KNOW-R-004 — present on an answer that may be filed to the team brain. */
  onToWiki?: () => void;
  wikiScope?: string;
  /** CGP-CHAT-R-007 — a finished answer whose text may be quoted, and its 인용하기 button. */
  quotable?: boolean;
  quoteAction?: ReactNode;
  /** CGP-CHAT-D-015: the observed elapsed receipt, placed at the end of the answer action row. */
  elapsed?: ReactNode;
}) {
  const question = useMemo(() => onPickReply && message.role === "assistant" ? replyChoices(message.content) : null, [message.content, message.role, onPickReply]);
  const renderable = useMemo(
    () => (message.role === "assistant" ? extractRenderableHtml(message.content) : null),
    [message.role, message.content],
  );
  const canRetry =
    !streaming &&
    message.role === "assistant" &&
    ux.retry_button.enabled &&
    message.content.length > 0 &&
    (!personal || (isLatest && !freeSeat));
  const retryPrompt = canRetry ? userPromptBefore(messages, message.id) : null;

  return (
    // CGP-CHAT-R-026 — data-message-id is the task-search jump target.
    <div className={`hps-msg hps-msg-${message.role}${personal && isStreamingThis ? ' hps-msg-live' : ''}`} data-message-id={message.id} {...(quotable ? { [QUOTE_ROW_ATTR]: message.id } : {})} {...(message.role === 'user' ? { [MY_QUESTION_ATTR]: message.id } : {})}>
      <div className={personal ? "hps-msg-role hps-sr-only" : "hps-msg-role"}>
        {/*
          * #747 (AE-08) — if a stored name exists, use **that**. If not (rows from
          * before this change, a bubble still streaming) it falls back to the live name.
          * Re-resolving here would make the past change along the moment the name changes.
          */}
        {/* Personal chat: the speaker is read out, not drawn — the bubble and the column already
            say who is speaking, and a label on some turns but not others read as inconsistent. */}
        <span>{message.role === "user" ? "나" : message.assistantName ?? coachName}</span>
        {!personal && renderable && (
          <button
            className="hps-msg-run"
            onClick={() => onRunCode(renderable)}
            data-hp-tooltip="미리보기 패널에서 실행"
          >
            <ChatIcon kind="play" size={16} /> Run
          </button>
        )}
        {!personal && retryPrompt && (
          <button
            className="hps-msg-retry"
            onClick={() => onRetry(retryPrompt.content, retryPrompt)}
            data-hp-tooltip="다른 방식으로 한 번 더 만들기"
            aria-label="다른 방식으로 한 번 더 만들기"
          >
            <ChatIcon kind="retry" size={16} />
          </button>
        )}
      </div>
      {personal && message.role === 'user' && message.toolMode === 'web-search' && <span className="hps-user-tool"><ChatIcon kind="globe" /> 웹 검색 요청</span>}
      {message.role === 'user' && editing && onCancelEdit && onSaveEdit ? <EditPrompt
        text={editDraft?.text ?? message.content}
        images={editDraft?.images ?? message.images ?? []}
        onChange={onEditChange}
        revertNote={revertNote}
        onCancel={onCancelEdit}
        onSave={onSaveEdit} /> : <div className={`hps-msg-body${question && onPickReply && onWriteReply ? " hps-msg-question" : ""}`} {...(quotable ? { [QUOTE_SCOPE_ATTR]: message.id } : {})}>
        {question && onPickReply && onWriteReply ? <CodeBlockScope id={message.id}><ReplyChoices key={`${message.id}:${message.content}`} question={question} onPick={onPickReply} onWrite={onWriteReply} onSubmit={onSubmitReply} typing={replyTyping} selectionValid={replySelectionValid} /></CodeBlockScope> : message.role === "assistant" ? (
          <AssistantContent
            content={message.content}
            streaming={isStreamingThis}
            buildingLabel={buildingLabel}
            tone={tone}
            hasActivity={hasActivity}
            personal={personal}
            messageId={message.id}
          />
        ) : (
          <>
            {message.images && message.images.length > 0 && (
              <div className="hps-msg-images">
                {message.images.map((url, i) => (
                  <img key={i} src={url} alt={`첨부 이미지 ${i + 1}`} />
                ))}
              </div>
            )}
            {message.content}
          </>
        )}
      </div>}
      {quoteAction}
      {message.role === 'user' && !editing && (pager || onEdit) && <div className="hps-user-actions">
        {pager && onPage && <VersionPager pager={pager} onPage={(index) => onPage(pager.key, index)} />}
        {onEdit && <EditAction onEdit={onEdit} />}
      </div>}
      {message.role === "assistant" && message.citations && message.citations.length > 0 && (
        <PanelBoundary panel="citations">{personal ? <PersonalCitationRack citations={message.citations} messageId={message.id} /> : <CitationRack citations={message.citations} />}</PanelBoundary>
      )}
      {/* Merge of #1814 polish and #1763: one ghost row (copy · preview · ask again), retry on the
          latest answer only and never on a free seat. */}
      {answerActionRowShown(message, personal, isStreamingThis) && <CopyAnswer
        content={message.content}
        status={elapsed}
        onRun={renderable ? () => onRunCode(renderable) : undefined}
        onRetry={retryPrompt ? () => onRetry(retryPrompt.content, retryPrompt) : undefined}
        verdict={onVerdict ? <VerdictButtons state={verdict ?? undefined} onChange={onVerdict} /> : undefined}
        onToWiki={onToWiki} wikiTurnId={message.id} wikiScope={wikiScope} />}
      {personal && onVerdict && verdict?.verdict === 'fix' && !isStreamingThis && <VerdictReasons state={verdict} onChange={onVerdict} />}
    </div>
  );
}

/**
 * #173 — Render the citation chip rack under an assistant message body.
 * Tier number drives the trust palette via CSS class; clicking a chip posts
 * to the host so VS Code opens the URL in the user's default browser
 * (webview iframe has no direct openExternal capability).
 */
function CitationRack({ citations }: { citations: Citation[] }) {
  return (
    <div className="hps-cit-rack" role="list" aria-label="검색 출처">
      {citations.map((c, i) => (
        <span key={`${c.url}-${i}`} role="listitem"><button
          type="button"
          className={`hps-cit-chip hps-cit-tier-${c.tier}`}
          onClick={() => postToHost({ type: "openExternal", url: c.url })}
          data-hp-tooltip={c.url}
        >
          <span className="hps-cit-index">[{i + 1}]</span>
          <span className="hps-source-kind">{citationKindLabel(c.kind)}</span>
          <span className="hps-cit-title">{c.title || c.domain}</span>
          <span className="hps-cit-domain">{c.domain}</span>
        </button></span>
      ))}
    </div>
  );
}

/**
 * Render an assistant message with code fences hidden behind a collapsed pill.
 * - While streaming and a fence has opened: show "<tone> 만드는 중… ✨".
 * - When streaming ends with the fence still open (max_tokens cut / network
 *   drop / model bailed) — render the partial as a code pill + a stuck-stream
 *   note so the user can retry instead of staring at a spinner forever. (#159)
 * - When done normally: prose + a collapsed "📄 코드 보기" pill per code block.
 */
/**
 * Stream-length-based stage label for the build spinner (#161). Lets the
 * participant feel forward motion instead of staring at a static "만드는 중…".
 *
 * Stages are derived from cumulative response length + fence-open detection;
 * no LLM-side cooperation required. Tuned for the dental V1 skeleton
 * (~2.5KB HTML output).
 *
 * #414 — the length heuristic is a PROXY-path device. On the agent-sdk path the
 * coach writes files with tools, so the chat text barely grows and every turn
 * froze on "구조 정리 중" while the coach was actually running thinking → Write
 * → Bash → Write. When a real activity log is on screen (`hasActivity`) the
 * truth is right there, so the spinner drops the invented sub-stage instead of
 * contradicting it. A guess is only acceptable while nothing better exists.
 */
function buildStageText(
  buildingLabel: string,
  content: string,
  fenceOpen: boolean,
  tone: "game" | "search" | "site" | "quest",
  hasActivity = false,
): string {
  if (fenceOpen) return "거의 다 됐어요";
  // The quest track does not name what is being made — the label itself is "생각 중…",
  // and adding sub-stages would define "what" is being made all over again.
  if (tone === "quest") return buildingLabel;
  // Real signal present → say only what is certainly true.
  if (hasActivity) return buildingLabel;
  const len = content.length;
  if (tone === "site") {
    // website-copyclone substages (clone target → layout → polish).
    if (len > 500) return `${buildingLabel} — 화면 그리는 중`;
    if (len > 200) return `${buildingLabel} — 레이아웃 잡는 중`;
    return `${buildingLabel} — 구조 정리 중`;
  }
  if (len > 500) return `${buildingLabel} — V1 화면 그리는 중`;
  if (len > 200) return `${buildingLabel} — 검색어·출처 정리`;
  return `${buildingLabel} — 검색 주제 잡는 중`;
}

function AssistantContent({
  content,
  streaming,
  buildingLabel,
  tone,
  hasActivity = false,
  personal = false,
  messageId,
}: {
  content: string;
  streaming: boolean;
  buildingLabel: string;
  tone: "game" | "search" | "site" | "quest";
  /** #414 — the tool/activity log below carries the real state of the turn. */
  hasActivity?: boolean;
  personal?: boolean;
  /** CGP-CHAT-R-008: scopes this answer's code-block wrap choices. */
  messageId?: string;
}) {
  const segments = useMemo(() => splitFences(content), [content]);
  const hasOpenFence = segments.some((s) => s.type === "code-open");

  if (content.length === 0) {
    return personal && streaming ? <ResponsePending /> : <span>{streaming ? <>생각하는 중… <span className="hps-dots"><ChatIcon kind="sparkle" size={16} /></span></> : ""}</span>;
  }

  return (
    <CodeBlockScope id={messageId}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <CodeBlockScope key={i} id={`seg${i}`}><MarkdownText text={seg.value} /></CodeBlockScope>;
        }
        if (seg.type === "code-open") {
          if (streaming) {
            if (personal) return <ResponsePending key={i} hasContent />;
            const stage = buildStageText(buildingLabel, content, hasOpenFence, tone, hasActivity);
            return (
              <div key={i} className="hps-code-progress">
                <ChatIcon kind="tool" size={16} /> {stage}… <span className="hps-dots"><ChatIcon kind="sparkle" size={16} /></span>
              </div>
            );
          }
          // Stream ended with the fence still open → render partial + retry note.
          return (
            <div key={i}>
              <CodePill code={seg.value} personal={personal} blockKey={`seg${i}`} />
              <div className="hps-stream-note" data-quote-skip="">
                {personal ? "응답이 도중에 끊겼어요. 같은 요청을 한 번 더 보내 주세요." : <>응답이 도중에 끊겼어요. 위의 <ChatIcon kind="retry" size={16} label="다른 방식으로 한 번 더 만들기" /> 버튼으로 다시 시도해주세요.</>}
              </div>
            </div>
          );
        }
        return <CodePill key={i} code={seg.value} personal={personal} blockKey={`seg${i}`} />;
      })}
      {personal && streaming && !hasOpenFence && <ResponsePending hasContent />}
      {!personal && streaming && !hasOpenFence && content.length > 0 && (
        <div className="hps-code-progress hps-code-progress-prelude">
          <ChatIcon kind="tool" size={16} /> {buildStageText(buildingLabel, content, false, tone, hasActivity)}… <span className="hps-dots"><ChatIcon kind="sparkle" size={16} /></span>
        </div>
      )}
    </CodeBlockScope>
  );
}

function CodePill({ code, personal = false, blockKey }: { code: string; personal?: boolean; blockKey?: string }) {
  const [open, setOpen] = useState(false);
  const lines = code.split("\n").length;
  // CGP-CHAT-R-027: while collapsed, find-in-chat still counts this code and can open it.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (!open && root.current ? registerClosedText(root.current, code, () => setOpen(true)) : undefined), [open, code]);
  return (
    <div className="hps-codepill" ref={root}>
      {/* Personal chat: a quiet disclosure in the answer's own type size, with a line icon from the
          chat's icon set instead of a colour emoji (UI audit P0-2). */}
      {personal ? <button className="hps-codepill-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChatIcon kind="code" size={16} /><span>{open ? "코드 숨기기" : `코드 보기 · ${lines}줄`}</span>
      </button> : <button className="hps-codepill-toggle" onClick={() => setOpen((v) => !v)}>
        <ChatIcon kind={open ? "chevron-down" : "chevron"} size={16} /><ChatIcon kind="file" size={16} /> 코드 {open ? "숨기기" : `보기 (${lines}줄)`}
      </button>}
      {/* CGP-CHAT-R-008: the open block carries its own copy and wrap tools; collapsed stays as is (#159). */}
      {open && <CodeBlock code={code} defaultWrap={false} blockKey={blockKey} preClassName="hps-codepill-body" />}
    </div>
  );
}

type FenceSeg =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "code-open"; value: string };

/** Split content into prose / closed-code / still-open-code segments. */
function splitFences(content: string): FenceSeg[] {
  const out: FenceSeg[] = [];
  const fenceRe = /```[^\n]*\n?/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  let inCode = false;
  let codeStart = 0;

  while ((m = fenceRe.exec(content)) !== null) {
    if (!inCode) {
      if (m.index > idx) out.push({ type: "text", value: content.slice(idx, m.index) });
      inCode = true;
      codeStart = m.index + m[0].length;
    } else {
      out.push({ type: "code", value: content.slice(codeStart, m.index).replace(/\n$/, "") });
      inCode = false;
      idx = m.index + m[0].length;
    }
  }

  if (inCode) {
    // Opened fence with no closing yet → still being generated.
    out.push({ type: "code-open", value: content.slice(codeStart) });
  } else if (idx < content.length) {
    out.push({ type: "text", value: content.slice(idx) });
  }
  return out;
}

function ErrorBanner({
  message,
  requestId,
  runbookUrl,
  canRetry,
  onRetry,
  onDismiss,
  onReport,
  audience = "classroom",
}: {
  message: string;
  requestId: string | null;
  runbookUrl: string | null;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  onReport: () => void;
  audience?: SeatAudience;
}) {
  // Spot common transport-layer signals so the framing is honest about the
  // recovery path. We don't try to classify perfectly — just enough to pick
  // between "연결 끊김" (worth retrying) and "토큰/세션 문제" (go to the instructor).
  const { icon, title, tone } = errorBannerPresentation(message);
  // Free start D4 — a scheduled state (the drained daily cap) is announced politely and offers
  // only 닫기: there is nothing to report, retry or trace.
  const notice = tone === "notice";

  return (
    <div
      className={notice ? "hps-error-banner hps-error-banner--notice" : "hps-error-banner"}
      role={notice ? "status" : "alert"}
      aria-live={notice ? "polite" : undefined}
    >
      <div className="hps-error-banner-icon"><ChatIcon kind={glyphIconKind(icon)} size={24} /></div>
      <div className="hps-error-banner-body">
        <div className="hps-error-banner-title">{title}</div>
        <div className="hps-error-banner-msg">{message}</div>
        {runbookUrl && (
          <div className="hps-error-banner-runbook">
            {/* CGP-ART-R-008: the host decides where a link opens; a raw target=_blank anchor would reach the system browser. */}
            <a href={runbookUrl} onClick={(e) => { e.preventDefault(); postToHost({ type: "openExternal", url: runbookUrl }); }}>
              <ChatIcon kind="book" size={16} /> 강사 안내 — 세션 여는 법
            </a>
          </div>
        )}
        {requestId && !notice && (
          <div className="hps-error-banner-rid" data-hp-tooltip={errorIdTitle(audience)}>
            ID: <code>{requestId}</code>
          </div>
        )}
      </div>
      <div className="hps-error-banner-actions">
        {canRetry && !notice && (
          <button className="hps-error-banner-retry" onClick={onRetry}>
            다시 보내기
          </button>
        )}
        {!notice && (
          <button
            className="hps-error-banner-report"
            onClick={onReport}
            data-hp-tooltip={reportButtonTitle(audience)}
          >
            <ChatIcon kind="flag" size={16} /> 신고하기
          </button>
        )}
        <button
          className="hps-error-banner-dismiss"
          onClick={onDismiss}
          data-hp-tooltip="이 메시지 숨기기 (대화는 계속할 수 있어요)"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

function RollExpandHint({
  probe,
  original,
  onCancel,
}: {
  probe: string;
  original: string;
  onCancel: () => void;
}) {
  return (
    <div className="hps-roll-hint">
      <div className="hps-roll-probe" dangerouslySetInnerHTML={{ __html: renderInlineMd(probe) }} />
      {original && (
        <div className="hps-roll-original">
          <span className="hps-roll-original-label">처음 떠올린 것 →</span> {original}
        </div>
      )}
      <button className="hps-roll-cancel" onClick={onCancel}>취소</button>
    </div>
  );
}

// Tiny inline-markdown renderer for hints (bold, italic, code). Not a full MD;
// these messages are author-controlled in profiles, so escaping isn't critical.
// Profiles author keyboard hints with macOS glyphs (⌘V). On Windows/Linux we
// rewrite them to the real platform keys so a learner is never told to press a
// key that doesn't exist on their machine. `navigator.platform` reflects the
// host OS inside the VS Code webview renderer.
const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

function platformizeKeys(text: string): string {
  if (IS_MAC) return text;
  return text
    .replace(/⌘/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⌃/g, "Ctrl+")
    .replace(/⇧/g, "Shift+");
}

function renderInlineMd(md: string): string {
  return platformizeKeys(md)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// #72: in-app update banner. Sits between header and message list. Compact
// (kid-friendly UX shouldn't be dominated by an update card), with the full
// release notes hidden behind a "자세히" toggle to keep visual noise low.
function UpdateBanner({
  offer,
  onInstall,
  onDismiss,
}: {
  offer: UpdateOffer;
  onInstall: () => void;
  onDismiss: (version: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sizeMb = offer.sizeBytes > 0 ? (offer.sizeBytes / 1024 / 1024).toFixed(0) + " MB" : "";

  // CGP-SHELL-D-001: during class the update state is one quiet status line, not a card.
  // Nothing to press; the version may ellipsize at 320px, the verb never does.
  if (offer.heldForClass) {
    return (
      <div className="hps-update-line" role="status">
        <ChatIcon kind="upload" size={16} />
        <span className="hps-update-line-version">새 버전 v{offer.version}</span>
        <span className="hps-update-line-verb">수업이 끝나면 설치할 수 있어요.</span>
      </div>
    );
  }

  return (
    <div className="hps-update-banner" role="status">
      <div className="hps-update-banner-icon"><ChatIcon kind="upload" size={24} /></div>
      <div className="hps-update-banner-body">
        <div className="hps-update-banner-title">
          새 버전 v{offer.version} 나왔어요{sizeMb ? ` · ${sizeMb}` : ""}
        </div>
        <div className="hps-update-banner-sub">
          업데이트하면 자동으로 재시작됩니다. 작업 중인 내용은 미리 저장해주세요.
        </div>
        {expanded && offer.notes && (
          <pre className="hps-update-banner-notes">{offer.notes}</pre>
        )}
        {offer.notes && (
          <button
            className="hps-update-banner-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "접기" : "자세히 보기"}
          </button>
        )}
      </div>
      <div className="hps-update-banner-actions">
        <button
          className="hps-update-banner-install"
          onClick={onInstall}
          data-hp-tooltip={`v${offer.version} 다운로드 + 자동 적용`}
        >
          업데이트
        </button>
        <button
          className="hps-update-banner-dismiss"
          onClick={() => onDismiss(offer.version)}
          data-hp-tooltip="이 버전은 7일 동안 다시 묻지 않음"
        >
          나중에
        </button>
      </div>
    </div>
  );
}


/** Personal secondary actions share a full-size target; classroom controls keep their existing layout. */
export function HeaderActions({ personal, taskId, children }: { personal: boolean; taskId?: string; children: import('react').ReactNode }) {
  const [open, setOpen] = useState(false);
  const typeahead = useMenuTypeahead(open);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const items = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
  const close = (restore = false) => { setOpen(false); if (restore) toggle.current?.focus({ preventScroll: true }); };
  useEffect(() => { setOpen(false); }, [personal, taskId]);
  // REQ-STUDIO-FOCUS-RESTORE: Escape, an outside press and Tab close the menu; focus returns to its
  // toggle (Tab then moves on from there). The first (or, from ArrowUp, the last) item takes focus.
  useDialogFocus(panel, { open: personal && open, kind: 'popover', scope: root, opener: () => toggle.current, initialFocus: false, onDismiss: () => setOpen(false) });
  useLayoutEffect(() => {
    if (!personal || !open) return;
    const choices = items();
    (firstFocus.current === 'last' ? choices.at(-1) : choices[0])?.focus({ preventScroll: true });
  }, [personal, open]);
  if (!personal) return <div className="hps-actions">{children}</div>;
  return <div className="hps-actions tw-chat-menu" ref={root} onCompositionStart={typeahead.onCompositionStart} onCompositionEnd={event => typeahead.onCompositionEnd(event, items())} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (!open || event.defaultPrevented || imeComposing(event, typeahead.composing.current)) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      typeahead.reset();
      const choices = items();
      if (!choices.length) return;
      event.preventDefault();
      const at = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      choices[next].focus({ preventScroll: true });
    } else typeahead.search(event, items());
  }}>
    <button ref={toggle} type="button" className="tw-chat-menu-toggle" aria-label="대화 메뉴" data-hp-tooltip="대화 메뉴" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => { firstFocus.current = 'first'; setOpen(!open); }} onKeyDown={event => {
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
      }
    }}><ChatIcon kind="dots" size={20} /></button>
    {open && <div ref={panel} id={menuId} className="tw-chat-menu-panel" role="menu" aria-label="대화 메뉴" onClick={event => {
      if (event.target instanceof Element && event.target.closest('button[role="menuitem"]')) close(true);
    }}>{Children.map(children, child => isValidElement<{ role?: string; tabIndex?: number }>(child) && child.type === 'button' ? cloneElement(child, { role: 'menuitem', tabIndex: -1 }) : child)}</div>}
  </div>;
}
