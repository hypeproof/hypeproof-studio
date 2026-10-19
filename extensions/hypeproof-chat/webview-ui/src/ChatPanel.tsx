import { CitationRack as PersonalCitationRack } from './CitationPreview';
import type { RecoveredRequest } from '../../src/activityDraft';
import { canReserveRecovery, recoveryFull } from '../../src/recoveryCapacity';
import type { TurnToolMode } from '../../src/turnTools';
import { ComposerTools, SelectedTool } from './ComposerTools';
import { bindComposerFocus } from './composerFocus';
import { ChatIcon, CopyAnswer, ResponsePending, useChatViewport, useGrowingComposer } from './ChatDetails';
import { useResponseAnnouncement } from './responseAnnouncer';
import { imeComposing } from './imeGuard';
import { AccessControl } from './AccessControl';
import { EffortControl } from './EffortControl';
import { ModelControl } from './ModelControl';
import { ChatPreferences } from './ChatPreferences';
import { ReplyChoices } from './ReplyChoices';
import { replyChoices } from './replyChoiceParser';
import { activityDetail, activityLabel, trialHeaderLine } from "./activityLabel";
import { errorBannerPresentation } from "./errorBannerPresentation";
import { TrialEndCard } from "./TrialEndCard";
import {NativeObservationPanel} from './NativeObservationPanel';
import { MissionHeader } from './MissionHeader';
import { recordShownBy, recordViewKey, stepViewOnPick, stepViewOnState, taskFlowSeat, type StepViewSettled } from './missionHeaderLogic';
import { EvidenceDrawer } from './EvidenceDrawer';
import { CompletionGate } from './CompletionGate';
import { LessonStepPanel } from './LessonStepPanel';
import { StudentGoal } from './StudentGoal';
import type { StepWork } from '../../src/lessonFocus';
import { acceptGoalView, goalNoteFor, goalOfLesson, type GoalNote, type GoalSaveRequest, type StudentGoalView } from '../../src/studentGoal';
import { InstructorInbox } from './InstructorInbox';
import { HelpRequest } from './HelpRequest';
import { acceptHelp } from '../../src/classroomHelp';
import { addImportRef, canUndoImport, dropImportRef, importIntoDraft, type ImportRef, type LastImport } from './draftImport';
import { isObservationFormat, showsObservationResults } from '../../src/nativeObservationContract';
import { MarkdownText } from './MarkdownText';
import { DisconnectedChat } from "./StartPage";
import { Children, cloneElement, isValidElement, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HeadingSlotContext } from "./headingSlot";
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
import { onHostMessage, postToHost } from "./vscode";
import { hasActivityThisTurn } from "../../src/chatTimeline";
import { composerLabel, copulaParticle, resolveCoachIdentity } from "../../src/coachIdentity";
import { errorIdTitle, profileAudience, reportButtonTitle, seatAudience, type SeatAudience } from "../../src/seatVocabulary";
import { classroomPanelsShown } from "../../src/classroomPanels";
import { decideEnter, draftAfterStop, shouldFlushQueue, shouldRestoreQueue } from "./sendQueue";
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
  incomingImage: { dataUrl: string; nonce: number } | null;
  /**
   * #503 — a single timeline. user / assistant / tool are interleaved in the order
   * they happened. The `toolLog` prop that used to carry tool logs separately is gone
   * — that was what split the screen into two blocks.
   */
  messages: ChatMessage[];
  pageNotice: string | null;           // #308 — inline notice for "페이지를 코치에게"
  /** CR-09 — the picked element queued for the next turn (Curriculum Runtime only). */
  elementPreview?: import("../../src/protocol").ElementPreview | null;
  onRemoveElement?: () => void;
  /** cr-verify — the "내 제품 테스트" panel, drawn above the composer when the host shows it. */
  verifyPanel?: import("react").ReactNode;
  /** cr-verify — a product test is driving the browser: nothing is sent until it ends. */
  sendLocked?: boolean;
  aiNotice: string | null;             // #320 — AI disclosure at session start
  stopNotice: string | null;           // #497 — notice that the turn was cut off by Stop
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
  error: string | null;
  errorRequestId: string | null;
  errorRunbookUrl: string | null;  // #165 — render as clickable runbook link
  /** TUX-COND-07 — the end-of-trial card for this turn ending; drawn instead of the error banner. */
  trialEndCard?: import("../../src/protocol").TrialEndCardView | null;
  /** TUX-COND-07 — the card's Primary. The host opens the start page's pass list; nothing else does. */
  onTrialEndCardPasses?: () => void;
  canRetryLast: boolean;
  sendPending?: boolean;
  onSend: (text: string, images?: string[], imports?: ImportRef[], attachments?: StagedPhoto[], toolMode?: TurnToolMode) => void | boolean;
  onRetry: (prompt: string, source?: ChatMessage) => void;
  onRetryLast: () => void;
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
interface StagedPhoto { id: string; name: string; thumb: string | null; ready: boolean }

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
  const { config, messages, streaming, streamingId, error, incomingImage } = props;
  const saved = config?.activityDraft;
  const separateQueue = !!saved?.queued && (saved.queuedPaused === true || (saved.queuedToolMode ?? 'auto') !== (saved.toolMode ?? 'auto'));
  const [draft, setDraft] = useState(() => separateQueue ? saved?.text ?? '' : draftAfterStop(saved?.text ?? '', saved?.queued ?? null));
  const [toolMode, setToolMode] = useState<TurnToolMode>(saved?.toolMode ?? 'auto');
  const [queuedToolMode, setQueuedToolMode] = useState<TurnToolMode>(saved?.queuedToolMode ?? saved?.toolMode ?? 'auto');
  const [queuedPaused, setQueuedPaused] = useState(separateQueue);
  const [recovered, setRecovered] = useState<RecoveredRequest[]>(saved?.recovered ?? []);
  const recoveryAtCapacity = useMemo(() => recoveryFull(recovered), [recovered]);
  const [discardRequest, setDiscardRequest] = useState<RecoveredRequest | null>(null);
  const [composing, setComposing] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // `usage`: the dialog was opened from "이용권 · 사용량" or the access recovery entry, so its usage
  // section opens with focus on it (the #1814 menu shortcut, kept inside the #1763 dialog).
  const [preferencesUsage, setPreferencesUsage] = useState(false);
  const openPreferences = (usage: boolean) => { setPreferencesUsage(usage); setPreferencesOpen(true); };
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
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const discardedPhotos = useRef(new Set<string>());
  // #416 — the ONE message parked while a turn is running (null = none).
  const [queued, setQueued] = useState<string | null>(separateQueue ? saved?.queued ?? null : null);
  const [frozen, setFrozen] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // SX-01/SX-02 — the step currently being viewed. A **view state**. Not a completion judgment.
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
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
  useEffect(() => { setGoalNote(null); }, [config?.profile?.lesson?.sha256]);
  useEffect(() => onHostMessage((msg) => {
    if (msg.type !== "goalState") return;
    setGoalAnswer((prev) => acceptGoalView(prev, msg.view));
    const note = goalNoteFor(msg, goalRequest.current);
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
  const draftPayload = () => ({...(recovered.length ? {recovered} : {}),text:draft,images:pendingImages,queued,...(imports.length?{imports}:{}),toolMode,...(queued !== null ? {queuedToolMode,...(queuedPaused?{queuedPaused:true}:{})} : {})});
  const snapshot = useRef(draftPayload());
  snapshot.current = draftPayload();
  const activityId = config?.activity?.id;
  const taskId = config?.taskWorkspace?.activeTaskId ?? undefined;
  const initialDraft = useRef(true);
  useEffect(() => {
    if (initialDraft.current) { initialDraft.current=false; return; }
    if (activityId) postToHost({type:"saveActivityDraft",activityId,taskId,draft:draftPayload()});
  }, [activityId,taskId,draft,pendingImages,queued,imports,toolMode,queuedToolMode,queuedPaused,recovered]);
  useEffect(() => {
    const off = onHostMessage(msg => {
      if (!activityId || msg.activityId !== activityId) return;
      if (msg.type === "inputRejected") {
        const rejectedMode = msg.toolMode ?? 'auto';
        const current = snapshot.current;
        if (current.queued !== null || current.text.trim() || current.recovered?.length) {
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
      if (msg.type === "activityFreeze") {
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
  // D-028 — the host did not keep a staged photo: drop its chip and say why. Or the host staged
  // one itself (dropped from Finder, it opened as a tab): draw its chip.
  useEffect(() => onHostMessage((msg) => {
    if (msg.type === "imageStageRefused") {
      setStagedPhotos((prev) => prev.filter((p) => p.id !== msg.stageId));
      setImgNote(msg.reason);
      return;
    }
    if (msg.type !== "imageStagedByHost") return;
    const { stageId, name, dataUrl } = msg;
    if (discardedPhotos.current.has(stageId)) return;
    setImgNote(null);
    setStagedPhotos((prev) => (prev.some((p) => p.id === stageId) ? prev.map((p) => p.id === stageId ? { ...p, ready: true } : p) : [...prev, { id: stageId, name, thumb: null, ready: true }]));
    if (dataUrl) void photoThumb(dataUrl).then((thumb) => setStagedPhotos((prev) => prev.map((p) => (p.id === stageId ? { ...p, thumb } : p))));
  }), []);
  // SX-14·15·17 — take the learning state the host sent as-is. Why it is not filtered
  // by activity id: the gate is per **task**, and the host already sends only that
  // task's events.
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type === "config") recordKeyNow.current = recordViewKey(msg.config);
      if (msg.type !== "learningState") return;
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
  // #751 native help — the host reads the learner, class connection and Service again for every draw; nothing is kept here.
  const [help, setHelp] = useState<import("../../src/classroomHelp").HelpView | null>(null);
  useEffect(() => {
    // The host numbers its draws; one that arrives after a newer draw (an older learner's, or an older read) is not shown.
    const off = onHostMessage((msg) => { if (msg.type === "helpState") setHelp((prev) => acceptHelp(prev, msg.help)); });
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
  const unavailable = frozen || (!!config?.activity && !config.activity.verified);
  const busy = streaming || worldPending || unavailable;

  const ux: UxConfig = config?.profile?.ux ?? DEFAULT_UX;
  // Image paste is a per-profile opt-in (website-copyclone). Default-off so
  // minor cohorts never expose the image flow — the worker enforces the same
  // gate server-side, this just keeps the UI honest (no thumbnail, plain text
  // paste). Absent on older cached /v1/profile responses → treated as off.
  const imagePasteEnabled = config?.profile?.input?.image_paste === true;
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
  const responseAnnouncementText = useResponseAnnouncement(streaming, { personal: personalWorkspace, stopped: !!props.stopNotice, failed: !!error });
  // Trial diagnosis D3 — solo seats (trial/pass/personal) get no classroom/operator words.
  const audience: SeatAudience = config?.activity ? seatAudience(config.activity) : profileAudience(config?.profile);
  const funding = config?.access;
  const fundingChoice = funding?.view?.choices.find(choice => choice.id === funding.selected);
  const accessNeedsAttention = !!funding && (funding.status === 'unknown' || !!funding.notice ||
    (!!funding.view?.required && !funding.selected) || (!!fundingChoice && (!fundingChoice.available ||
      !!config?.profile?.model_selection?.choices.some(model => model.alias === config.model && !fundingChoice.allowed.models.includes(model.id)))));
  const viewport = useChatViewport(scrollRef, personalWorkspace, messages);
  const headingSlot = useContext(HeadingSlotContext);
  const composerExpanded = useGrowingComposer(textareaRef, personalWorkspace, draft, pendingImages.length > 0 || stagedPhotos.length > 0 || toolMode === 'web-search');
  const classroomPanels = classroomPanelsShown(config?.profile, personalWorkspace);
  // TUX-SP-13 — a trial seat's personal workspace has no mission header, so its passive remaining
  // line sits in the chat header. Text only (CU-13): no button, no offer. A pass is never read as a trial.
  const trialLine = personalWorkspace && config?.activity && !config.activity.pass ? trialHeaderLine(config.activity.trial, Date.now(), !!config.activity.free) : null;
  const galleryEnabled =
    publishing?.enabled === true && publishing?.strategy === "hypeproof_gallery";
  // #140 / #747 — one identity rule shared with the host (coachIdentity.ts):
  // a fixed cohort or lesson name wins over any stored student name.
  const coachName = resolveCoachIdentity(config?.coach, { ux }).name;

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
  const namingEmoji =
    appTone === "search" ? "🔍" : appTone === "site" ? "🌐" : appTone === "quest" ? "✨" : "🎮";

  // Show the kid-friendly naming card when: profile loaded, it asks the kid to
  // name the coach, and they haven't yet.
  const [forceNaming, setForceNaming] = useState(false);

  const needsNaming =
    !!config?.profile &&
    config.profile.ux.coach.naming_mode === "user_names_it" &&
    !config.coach?.configured;

  useEffect(() => {
    if (!personalWorkspace) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
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
    if (imagePreparationBlocksSend()) return false;
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
    if (props.onSend(value, pendingImages.length > 0 ? pendingImages : undefined, !parked && imports.length ? imports : undefined, stagedPhotos.length > 0 ? stagedPhotos : undefined, mode) === false) return false;
    if (!parked) { setDraft(""); setImports([]); setLastImport(null); setImportNote(null); }
    setPendingImages([]);
    // The host now owns these files (it moves them into images/), so no discard here.
    setStagedPhotos([]);
    setImgNote(null);
    setRollExpand(null);
    return true;
  };

  const retryRecovered = (request: RecoveredRequest) => {
    if (streaming || frozen || unavailable || props.sendLocked || props.sendPending) return;
    // Send only this request's images; later staged photos/imports belong to the
    // untouched composer. A refused send keeps the recovery item for another try.
    if (props.onSend(request.text, request.images.length ? request.images : undefined, undefined, undefined, request.toolMode) === false) return;
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
    // #751 U4 — a turn the instructor cut off hands the parked message back, exactly like the learner's own Stop. Never sent.
    if (queuedPaused) return;
    if (shouldRestoreQueue(prev, streaming, queued, !!props.stopNotice || !!error)) { restoreQueuedToDraft(); return; }
    if (queuedPaused || unavailable || !shouldFlushQueue(prev, streaming, queued, !!props.stopNotice || !!error)) return;
    // cr-verify — a product test holds the tab: the parked message goes back to the draft, never lost.
    if (props.sendLocked) { restoreQueuedToDraft(); return; }
    const text = queued as string;
    // A staging/pending-send guard can refuse this edge. Keep the message and
    // its mode until acceptance; a paused item gives it an explicit retry path
    // instead of silently losing it or sending later on an unrelated render.
    if (submit(text, queuedToolMode)) setQueued(null);
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
      fitPastedImage(f)
        .then((url) => {
          if (!url) return;
          setPendingImages((prev) => {
            if (prev.length >= MAX_IMAGES) {
              setImgNote(`이미지는 한 번에 최대 ${MAX_IMAGES}장까지 붙일 수 있어요.`);
              return prev;
            }
            // A sibling read may already have failed; a successful image is not recovery.
            return [...prev, url];
          });
        })
        .catch(() => {
          imagePreparationFailed.current = true;
          setImgNote("이미지를 붙이지 못했어요. 다시 시도하거나 URL로 참고 화면을 주세요.");
        })
        .finally(finish);
    }
  };

  // D-028 — keep dropped or pasted photos as files in the host until the message is sent.
  const stagePhotoFiles = (files: File[]) => {
    setImgNote(null);
    let count = stagedPhotos.length;
    for (const f of files) {
      if (count >= MAX_FILE_PHOTOS) { setImgNote(`사진은 한 번에 ${MAX_FILE_PHOTOS}장까지 보낼 수 있어요.`); break; }
      if (f.size > MAX_FILE_PHOTO_BYTES) { setImgNote("사진이 너무 커요(25MB까지). 휴대폰에서 보통 크기로 다시 보내 주세요."); continue; }
      count++;
      const id = newStageId();
      setStagedPhotos((prev) => [...prev, { id, name: f.name, thumb: null, ready: false }]);
      readAsDataUrl(f)
        .then(async (url) => {
          if (discardedPhotos.current.has(id)) return;
          postToHost({ type: "stageImage", stageId: id, name: f.name, mime: f.type, base64: url.slice(url.indexOf(",") + 1) });
          const thumb = await photoThumb(url);
          setStagedPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, thumb } : p)));
        })
        .catch(() => {
          setStagedPhotos((prev) => prev.filter((p) => p.id !== id));
          setImgNote("사진을 읽지 못했어요. 다시 끌어다 놓아 주세요.");
        });
    }
  };

  // #384 — attach an image handed over by the host (an image opened in an
  // editor tab, e.g. a dropped screenshot). Same downscale + thumbnail path as
  // paste, just from a data URL. Re-runs on nonce so the same file re-attaches.
  const incomingNonce = incomingImage?.nonce;
  useEffect(() => {
    if (!incomingImage || !imagePasteEnabled) return;
    const finish = beginImagePreparation();
    fitDataUrl(incomingImage.dataUrl)
      .then((url) => {
        if (!url) return;
        setPendingImages((prev) => {
          if (prev.length >= MAX_IMAGES) {
            setImgNote(`이미지는 한 번에 최대 ${MAX_IMAGES}장까지 붙일 수 있어요.`);
            return prev;
          }
          // Keep failures from other reads in this preparation batch visible.
          return [...prev, url];
        });
      })
      .catch(() => { imagePreparationFailed.current = true; setImgNote(platformizeKeys("이미지를 붙이지 못했어요. ⌘V로 다시 시도해 주세요.")); })
      .finally(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingNonce]);

  // Clipboard paste of an image (e.g. ⌘⌃⇧4 screenshot → ⌘V) attaches it to the
  // next turn instead of pasting raw text. A normal text paste falls through
  // to the textarea default (we only preventDefault when we found image data).
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!imagePasteEnabled && !imageFilesEnabled) return;          // text-only cohort — let default text paste happen
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length === 0) return;     // plain text paste — let default happen
    e.preventDefault();
    if (imageFilesEnabled) stagePhotoFiles(imageFiles);
    else attachImageFiles(imageFiles);
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
        emoji={namingEmoji}
        onSave={(n, p) => {
          props.onSaveCoach(n, p);
          setForceNaming(false);
        }}
      />
      </>
    );
  }
  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!imagePasteEnabled && !imageFilesEnabled) return;
    if (!Array.from(e.dataTransfer.items ?? []).some((it) => it.kind === "file")) return;
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const handleDragLeave = () => setDragActive(false);
  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    if (!imagePasteEnabled && !imageFilesEnabled) return;
    const files = Array.from(e.dataTransfer.files ?? []).filter(imageFilesEnabled ? isPhotoFile : (f) => f.type.startsWith("image/"));
    if (files.length === 0) { setDragActive(false); return; }
    e.preventDefault();
    setDragActive(false);
    if (imageFilesEnabled) stagePhotoFiles(files);
    else attachImageFiles(files);
  };

  /** D-028 — the × on a staged photo: it was never sent, so the host deletes the file. */
  const removeStagedPhoto = (id: string) => {
    discardedPhotos.current.add(id);
    postToHost({ type: "discardStagedImage", stageId: id });
    setStagedPhotos((prev) => prev.filter((p) => p.id !== id));
    setImgNote(null);
    if (personalWorkspace) textareaRef.current?.focus({ preventScroll: true });
  };

  const removePendingImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
    setImgNote(null);
    if (personalWorkspace) textareaRef.current?.focus({ preventScroll: true });
  };

  const handleReplyChoice = (answer: string) => {
    if (streaming || frozen || unavailable || props.sendLocked || props.sendPending) return;
    // A choice prepares an editable reply, never sends or replaces an existing draft.
    const messageId = messages.filter(message => message.role !== 'tool').at(-1)?.id ?? '';
    const previous = lastReplyChoice.current;
    setDraft(current => previous?.messageId === messageId && current.endsWith(previous.answer)
      ? current.slice(0, -previous.answer.length) + answer
      : current.trim() ? `${current}\n${answer}` : answer);
    lastReplyChoice.current = { messageId, answer };
    requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  };

  const handleChip = (chip: SuggestionChip) => {
    if (chip.style === "weak") return;       // contrast-only chips are not clickable
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
    if (!reserveRecovery(chip, [], 'auto')) return;
    setWorldPending(true);
    props.onSend(chip);
    setRollExpand(null);
  };

  const handleRollClick = () => {
    // Capture the current draft as the "first thought" and prompt expansion.
    setRollExpand({ original: draft.trim() });
    setDraft("");
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleRollSend = () => {
    if (imagePreparationBlocksSend()) return;
    const extra = draft.trim();
    if (!extra || !rollExpand) return;
    const combined = rollExpand.original
      ? `${rollExpand.original} — 그리고 ${extra}`
      : extra;
    if (!reserveRecovery(combined, pendingImages, 'auto')) return;
    if (props.onSend(combined, pendingImages.length > 0 ? pendingImages : undefined) === false) return;
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
  // Personal chat offers retry on the latest coach answer only.
  const latestAssistantId = [...messages].reverse().find(m => m.role === 'assistant')?.id;

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
    <div
      className={`hps-shell${dragActive ? " hps-shell-drag" : ""}`}
      data-chat-detail={personalWorkspace ? 'personal' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="hps-shell-drop-overlay">여기에 놓으면 이미지가 첨부돼요 🖼</div>
      )}
      {(() => { const header = <header className="hps-header">
        {ux.coach.naming_mode === "fixed"
          // Personal chat: a fixed name is not a control, and the one header row has no room for a
          // label that names nothing the learner can act on. It stays readable to screen readers.
          ? <strong title={`이 수업의 AI 이름: ${coachName}`} className={personalWorkspace ? "hps-coach-name hps-sr-only" : "hps-coach-name"}>{coachName}</strong>
          : <button title="코치 이름 바꾸기" onClick={() => setForceNaming(true)} className="hps-coach-name">{coachName}</button>}
        {/* US-05 (P0): the work screen's top names the current activity and whether it is a trial or a
            class. Personal chat has no mission header (#1760), so the line that header carried moves
            into this row with the same `현재 활동` label (the a11y contract in MissionHeader.tsx). The
            kind stays visible; the name yields first on a narrow header (title keeps the full line). */}
        {personalWorkspace && config?.activity && (() => {
          const kind = activityLabel(config.activity.kind, config.activity.pass, undefined, !!config.activity.free);
          return <span className="hps-activity-now" aria-label="현재 활동" title={`${kind} · ${config.activity.name}`}>
            <span className="hps-activity-kind">{kind}</span><span className="hps-activity-name"> · {config.activity.name}</span>
          </span>;
        })()}
        {/* The count is the status (it never gives way); the end time yields on a narrow header (title keeps the full line). */}
        {trialLine &&<span className="hps-trial-left" title={trialLine}>{trialLine.split(" · ")[0]}{trialLine.includes(" · ") && <span className="hps-trial-until">{trialLine.slice(trialLine.indexOf(" · "))}</span>}</span>}
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
              title="지금 만든 세상을 갤러리에 올려요"
            >
              {props.publish?.state === "uploading"
                ? "올리는 중…"
                : props.publish?.state === "done"
                  ? "올렸어요 ✓"
                  : "🖼️ 갤러리"}
            </button>
          )}
          {/* One-click publish. The decision comes from the host (config.sitePublish) so it
              cannot drift from the host gate; the host re-checks on click anyway. */}
          {config?.sitePublish === true && props.onPublishSite && (
            <button
              className="hps-site-publish-btn"
              onClick={props.onPublishSite}
              disabled={props.streaming}
              title="홈페이지를 내 GitHub 주소로 올려요"
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
              title="GitHub에 있는 다른 프로젝트로 바꿔요"
              aria-label="프로젝트 변경"
            >
              프로젝트 변경
            </button>
          )}
          <button onClick={props.onSetToken} title="연결된 활동 확인 및 변경">
            활동 변경
          </button>
          <button onClick={props.onClear} disabled={props.streaming} title="대화 기록 지우기">대화 지우기</button>
          {/* Personal chat: usage opens the settings dialog on its usage section (the remaining line
              already shows the count). */}
          {personalWorkspace && config?.access && <button onClick={() => openPreferences(true)} title="이용권과 사용량 확인">이용권 · 사용량</button>}
          <button onClick={personalWorkspace ? () => openPreferences(false) : props.onSettings} title="설정" aria-label="설정">{personalWorkspace ? "설정" : "⚙"}</button>
        </HeaderActions>
      </header>;
      return personalWorkspace && headingSlot ? createPortal(header, headingSlot) : header; })()}

      {/* Region A — Mission header. Student-only surface; #1298 hides it for instructor mode. */}
      {!props.instructor && !personalWorkspace && <MissionHeader
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
      />}
      {draftError && <p role="alert">{draftError}</p>}
      {updateBanner}

      {/* AE-01 (#554) — "내 목표": the learner's own goal and completion criteria, in the rail right under region A.
          Region A keeps drawing the lesson's own criteria from the design file; this block never touches them.
          Student-only, like region A (#1298). */}
      {!props.instructor && config?.profile?.lesson && (
        <StudentGoal
          lesson={config.profile.lesson}
          view={goalOfLesson(studentGoal, config.profile.lesson)}
          note={goalNote}
          pending={goalPending}
          onSave={sendGoalSave}
        />
      )}

      {/* Region B's lesson info — inside the coach rail, **outside** the message stream
          (SX-05). Closed by default, and it opens only the current step. It used to
          expand all six steps at once and took up more room than the mission. */}
      {config?.profile?.lesson && (() => {
        const lesson = config.profile.lesson;
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
            <LessonStepPanel lesson={lesson} step={step} rehearsal={config.profile.rehearsal} busy={streaming} post={postToHost}
              work={lessonWork?.sha256 === lesson.sha256 ? lessonWork.work : {}} rehearsalState={rehearsalResult} />
            {/* #751 F4 — a learner self-report for the current step, separate from region D's task completion gate. */}
            <p className="hp-rail-step-report">
              <button type="button" className="hp-cta-quiet hps-lesson-done" aria-pressed={lessonSteps[step.id] === 'submitted'} disabled={lessonSteps[step.id] === 'submitted'} onClick={() => { postToHost({ type: 'lessonStep', stepId: step.id, status: 'submitted' }); setLessonSteps(prev => ({ ...prev, [step.id]: 'submitted' })); }}>{lessonSteps[step.id] === 'submitted' ? '마쳤다고 표시함 · 강사 확인 전' : '이 단계를 마쳤어요'}</button>
            </p>
          </>
        );
      })()}

      {/* #751 U2 — instructor notices/materials: the coach rail's "강사 메시지" kind (SX-06), outside the message stream
          (SX-05), closed by default, no Primary (SX-04). Drawn with or without a lesson. */}
      <InstructorInbox inbox={inbox} post={postToHost} promptImport={{ onImport: importPrompt, onUndo: undoImport, disabled: frozen, draft, last: lastImport, note: importNote }} />
      {/* #751 native help — the learner's own request to the instructor of this class. Same rail, closed by default, no Primary. */}
      {/* #1298 — hidden for instructor mode; instructor has no student help-request surface. */}
      {!props.instructor && classroomPanels.help && <HelpRequest view={help} post={postToHost} />}
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
      {learning && (
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
      )}

      {/* Both lines were originally pinned to `=== 'hps-observation/1'`. The moment `/2`
          opened, (a) the observation panel disappeared and (b) "관찰을 지원하지 않습니다"
          showed up next to a screen whose drawer was working fine. The test is "is
          observation on", not "which version is it". */}
      {/* The observation RESULTS panel is an assessment shown to the learner. SX-01·06·07·59
          keep that off the work screen, and SX-59 names the remedy as "학습 경험 프로필에서
          비활성" rather than deletion, because the trial's own TUX-OBS-07 is to read it. So it
          follows the cohort's `assess` opt-in; recording keeps its own switch and stays on. */}
      {!personalWorkspace && showsObservationResults(config?.profile?.observation) && <NativeObservationPanel scope={config!.profile!.observation!.scope} coachName={coachName} />}
      {!personalWorkspace && config?.profile?.profile_id === 'studio-native-trial' && !isObservationFormat(config.profile.observation?.format) && <p role="status">현재 연결은 작업 관찰을 지원하지 않습니다. 기존 작업 파일은 계속 사용할 수 있습니다.</p>}

      <div className="hps-messages" ref={scrollRef} onScroll={viewport.onScroll}>
        {props.aiNotice && (
          // #320 — AI disclosure (Anthropic Usage Policy / ToS §D.3). Compact
          // and unobtrusive; sits at the top of the conversation so it reads
          // as a session-start notice, not an interruption.
          <div className="hps-ai-disclosure" role="note" aria-live="polite">
            {props.aiNotice}
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

        {messages.map((m) =>
          m.role === "tool" ? (
            <ToolLine key={m.id} message={m} />
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
              onRetry={props.onRetry}
              personal={personalWorkspace}
              isLatest={m.id === latestAssistantId}
              freeSeat={!!config?.activity?.free}
              onPickReply={personalWorkspace && !streaming && !frozen && !unavailable && !props.sendLocked && !props.sendPending && m.id === messages.filter(message => message.role !== 'tool').at(-1)?.id ? handleReplyChoice : undefined}
              onWriteReply={() => textareaRef.current?.focus({ preventScroll: true })}
            />
          ),
        )}

        {props.pageNotice && (
          <div className="hps-page-notice" role="status" aria-live="polite">
            {props.pageNotice}
          </div>
        )}

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
            </div>
            <button type="button" className="hps-element-remove" aria-label="이 요소 빼기" onClick={props.onRemoveElement}>
              ✕
            </button>
          </div>
        )}

        {props.verifyPanel}

        {/* #497 — the notice right after Stop. It is not an error, so it is announced as
            a quiet inline status line rather than an error banner. It goes away on the
            next input. */}
        {/* CGP-CHAT-R-001: one polite line per turn start (classroom) and completion (both modes). */}
        <div className="hps-sr-only" role="status" aria-live="polite" data-testid="response-announcer">{responseAnnouncementText}</div>

        {props.stopNotice && (
          <div className="hps-stop-notice" role="status" aria-live="polite">
            <span className="hps-stop-notice-icon" aria-hidden="true">⏹</span>
            {props.stopNotice}
          </div>
        )}

        {showFollowUpChips && (
          <ChipRack
            chips={ux.suggestions.follow_up}
            onPick={handleChip}
            label="이어서 이런 것도 해볼래요?"
          />
        )}

        {error && props.trialEndCard && props.onTrialEndCardPasses ? (
          <TrialEndCard card={props.trialEndCard} onPasses={props.onTrialEndCardPasses} onDismiss={props.onDismissError} />
        ) : error && (
          <ErrorBanner
            message={error}
            requestId={props.errorRequestId}
            runbookUrl={props.errorRunbookUrl}
            canRetry={props.canRetryLast && recovered.length === 0}
            onRetry={() => recoverToComposer(props.onRetryLast)}
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
        {/* Personal chat (#1763, REQ-STUDIO-CHAT-DETAIL): model, thinking depth and usage live in the
            settings dialog; only an access problem shows a recovery entry here. Classroom keeps its rows. */}
        {!personalWorkspace && <><ModelControl config={config} streaming={streaming} />
          <EffortControl config={config} post={postToHost} />
          <AccessControl config={config} streaming={streaming} post={postToHost} /></>}
        {personalWorkspace && accessNeedsAttention && <div className="hps-access-attention" role="status">
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
        <div className="hps-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="attachment-announcer">{imgNote || ''}</div>
        {imgNote && <div id={imageNoteId} className="hps-img-note">{imgNote}</div>}
        {recoveryAtCapacity && <div className="hps-recovery-notice" role="status">보관한 메시지를 먼저 다시 보내거나 정리해 주세요. 새 메시지는 입력창에 남아 있습니다.</div>}
        {recovered.length > 0 && <div className="hps-recovery-list" aria-label={`보내지 못한 메시지 ${recovered.length}개`}>
          {recovered.map((request, index) => <div className="hps-queued hps-recovered" role="status" aria-live="polite" key={index}>
            <span className="hps-queued-label">보내지 못한 메시지{request.toolMode === 'web-search' ? ' · 웹 검색' : ''}{request.images.length ? ` · 사진 ${request.images.length}장` : ''}</span>
            <span className="hps-queued-text" title={request.text}>{request.text}</span>
            <button type="button" className="hps-queued-send" disabled={streaming || frozen || props.sendPending || unavailable || props.sendLocked} onClick={() => retryRecovered(request)}>다시 보내기</button>
            <button type="button" className="hps-queued-send" disabled={streaming || frozen || props.sendPending || props.sendLocked} onClick={() => editRecovered(request)}>수정하기</button>
            {discardRequest === request ? <span className="hps-recovery-confirm" role="group" aria-label="메시지 삭제 확인" onKeyDown={event => {if(event.key === 'Escape' && !imeComposing(event)){event.preventDefault();setDiscardRequest(null);textareaRef.current?.focus({preventScroll:true});}}}>
              <span>이 메시지와 사진을 삭제할까요?</span>
              <button type="button" className="hps-queued-send" autoFocus onClick={() => {setDiscardRequest(null);requestAnimationFrame(() => textareaRef.current?.focus({preventScroll:true}));}}>취소</button>
              <button type="button" className="hps-queued-send" onClick={() => {setRecovered(items => items.filter(item => item !== request));setDiscardRequest(null);setImgNote(null);textareaRef.current?.focus({preventScroll:true});}}>삭제 확인</button>
            </span> : <button type="button" className="hps-queued-send" onClick={() => setDiscardRequest(request)}>삭제</button>}
          </div>)}
        </div>}
        {queued !== null && (
          // #416 — what is parked, and how to take it back. Cancel returns it to
          // the draft (see restoreQueuedToDraft): the × must not mean "delete".
          <div className="hps-queued" role="status" aria-live="polite">
            <span className="hps-queued-label">{queuedPaused ? '보관한 메시지' : '다음에 보낼 메시지'}{queuedToolMode === 'web-search' ? ' · 웹 검색' : ''}</span>
            <span className="hps-queued-text" title={queued}>{queued}</span>
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
            <button
              type="button"
              className="hps-queued-cancel"
              onClick={restoreQueuedToDraft}
              title="예약 취소 — 입력창으로 되돌려요"
              aria-label={queuedPaused ? "보관한 메시지 입력창으로 가져오기" : "예약 취소"}
            >
              ×
            </button>
          </div>
        )}
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
                  title="이미지 제거"
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
                <div key={p.id} className="hps-attachment hps-attachment-file" title={p.name}>
                  {p.thumb ? <img src={p.thumb} alt={p.name} /> : <span className="hps-attachment-name">{p.ready ? p.name : "준비 중…"}</span>}
                  <button
                    type="button"
                    className="hps-attachment-remove"
                    onClick={() => removeStagedPhoto(p.id)}
                    title="사진 빼기"
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
        <div
          className={`hps-input${dragActive ? " hps-input-drag" : ""}`}
          data-expanded={personalWorkspace ? composerExpanded : undefined}
        >
          {personalWorkspace && <ComposerTools mode={toolMode} onMode={setToolMode} webSearch={config?.turnTools?.webSearch} locked={queued !== null || !!props.sendPending} onAttach={imagePasteEnabled || imageFilesEnabled ? () => imagePicker.current?.click() : undefined} />}
          {personalWorkspace && <input ref={imagePicker} type="file" accept="image/*" multiple hidden aria-label="첨부할 이미지 선택" onChange={event => { const files = [...(event.target.files ?? [])]; if (imageFilesEnabled) stagePhotoFiles(files); else if (imagePasteEnabled) attachImageFiles(files); event.target.value = ''; }} />}
          <textarea
            ref={textareaRef}
            autoFocus
            readOnly={unavailable}
            aria-label={composerLabel(coachName)}
            aria-describedby={[personalWorkspace ? "personal-composer-hint" : '', imgNote ? imageNoteId : ''].filter(Boolean).join(' ') || undefined}
            value={draft}
            onChange={(e) => {
              // Manual edits own the entire draft, even if it ends with an old choice.
              lastReplyChoice.current = null;
              setDraft(e.target.value);
            }}
            onPaste={handlePaste}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              const isComposing = imeComposing(e, composing);
              // CGP-DS-R-027: composition keys stay with the IME and never reach the panel,
              // workspace or menu handlers above (Escape would close the sources panel).
              if (isComposing) { e.stopPropagation(); return; }
              // Composing Hangul: Enter commits the syllable, it must never
              // send. Unchanged from before — typing mid-turn does not make the
              // IME any less load-bearing.
              if (e.key !== "Enter" || e.shiftKey || isComposing || unavailable) return;
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
          {personalWorkspace && toolMode === 'web-search' && <SelectedTool locked={queued !== null || !!props.sendPending} onClear={() => { setToolMode('auto'); textareaRef.current?.focus({ preventScroll: true }); }} />}
          <div className="hps-input-buttons">
            {personalWorkspace && <span id="personal-composer-hint" className="hps-composer-hint">{streaming ? 'Enter 예약 · Shift+Enter 줄바꿈' : 'Enter 보내기 · Shift+Enter 줄바꿈'}</span>}
            {!streaming && ux.hints.roll_input_button.enabled && !rollExpand && (
              <button
                onClick={handleRollClick}
                disabled={!draft.trim()}
                className="hps-btn-roll"
                title="떠오른 것에 한 줄 더 보태기"
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
                title={personalWorkspace ? '응답 멈추기' : undefined}
              >
                {personalWorkspace ? <ChatIcon kind="stop" /> : 'Stop'}
              </button>
            ) : rollExpand ? (
              <button
                onClick={handleRollSend}
                disabled={!draft.trim()}
                className="hps-btn-send"
                aria-label={personalWorkspace ? '메시지 보내기' : undefined}
                title={personalWorkspace ? '메시지 보내기' : undefined}
              >
                {personalWorkspace ? <ChatIcon kind="send" /> : '보내기'}
              </button>
            ) : (
              <button
                onClick={() => { if (submit() && personalWorkspace) textareaRef.current?.focus({ preventScroll: true }); }}
                disabled={preparingImages > 0 || (!draft.trim() && pendingImages.length === 0 && stagedPhotos.length === 0) || unavailable || props.sendLocked || props.sendPending || stagedPhotos.some((p) => !p.ready)}
                className="hps-btn-send"
                aria-label={personalWorkspace ? '메시지 보내기' : undefined}
                title={personalWorkspace ? '메시지 보내기' : undefined}
              >
                {personalWorkspace ? <ChatIcon kind="send" /> : '보내기'}
              </button>
            )}
          </div>
        </div>
      </footer>
      {personalWorkspace && <ChatPreferences open={preferencesOpen} onClose={() => { setPreferencesOpen(false); setPreferencesUsage(false); }} initialFocus={preferencesUsage ? '.hps-access > summary' : undefined}>
        <details className="hps-advanced-response"><summary>응답 고급 설정</summary>
          <p>선택한 설정은 다음 요청부터 적용됩니다.</p>
          <ModelControl config={config} streaming={streaming} />
          <EffortControl config={config} post={postToHost} personal />
        </details>
        <AccessControl key={preferencesUsage ? 'usage' : 'plain'} config={config} streaming={streaming} post={postToHost} defaultOpen={preferencesUsage} />
        {showsObservationResults(config.profile?.observation) && <NativeObservationPanel scope={config.profile!.observation!.scope} coachName={coachName} />}
        <button type="button" className="hps-all-settings" onClick={() => { setPreferencesOpen(false); props.onSettings(); }}>앱 설정 열기</button>
      </ChatPreferences>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
        <span aria-hidden>🖼️</span> 갤러리에 올렸어요!{" "}
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
      {showLabel && <div className="hps-worlds-label">👇 친구를 누르면 그 세상으로 가요</div>}
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
              title={
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
  emoji,
  onSave,
}: {
  namingPromptMd: string;
  personalityPromptMd: string;
  fallbackName: string;
  emoji: string;
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
        <div className="hps-naming-emoji">{emoji}</div>
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
            title={c.style === "weak" ? platformizeKeys(c.caption ?? "예시일 뿐이에요") : "탭하면 입력창에 들어가요"}
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
function ToolLine({ message }: { message: ChatMessage }) {
  const t = message.tool;
  if (!t) return null;
  // This row is a waiting indicator, never evidence that a file was changed.
  // Hide completed waits from old histories too; retain the stored timeline.
  if (message.id.startsWith('pending-') && t.state === 'done') return null;
  const thinking = /^think-\d+$/.test(message.id);
  if (thinking && t.state === 'done') {
    return (
      <details className="hps-thinking-details">
        <summary className="hps-tool-log-line hps-tool-done" aria-label="AI 처리 내용 보기">
          <span className="hps-tool-icon">{t.icon}</span>
          <span className="hps-tool-label">응답 준비</span>
          <span className="hps-tool-mark">▾</span>
        </summary>
        <pre>{t.label}</pre>
      </details>
    );
  }
  return (
    <div className={`hps-tool-log-line hps-tool-${t.state}`} role="status" aria-live="polite">
      <span className="hps-tool-icon">{t.icon}</span>
      <span className="hps-tool-label">{thinking ? '응답을 준비하는 중…' : t.label}</span>
      <span className="hps-tool-mark">
        {t.state === "running" ? "…" : t.state === "error" ? "⚠️" : "✓"}
      </span>
    </div>
  );
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
    <div className={`hps-msg hps-msg-${message.role}${personal && isStreamingThis ? ' hps-msg-live' : ''}`}>
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
            title="미리보기 패널에서 실행"
          >
            ▶ Run
          </button>
        )}
        {!personal && retryPrompt && (
          <button
            className="hps-msg-retry"
            onClick={() => onRetry(retryPrompt.content, retryPrompt)}
            title="다른 방식으로 한 번 더 만들기"
          >
            🔄
          </button>
        )}
      </div>
      {personal && message.role === 'user' && message.toolMode === 'web-search' && <span className="hps-user-tool"><ChatIcon kind="globe" /> 웹 검색 요청</span>}
      <div className="hps-msg-body">
        {question && onPickReply && onWriteReply ? <ReplyChoices question={question} onPick={onPickReply} onWrite={onWriteReply} /> : message.role === "assistant" ? (
          <AssistantContent
            content={message.content}
            streaming={isStreamingThis}
            buildingLabel={buildingLabel}
            tone={tone}
            hasActivity={hasActivity}
            personal={personal}
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
      </div>
      {message.role === "assistant" && message.citations && message.citations.length > 0 && (
        personal ? <PersonalCitationRack citations={message.citations} messageId={message.id} /> : <CitationRack citations={message.citations} />
      )}
      {/* Merge of #1814 polish and #1763: one ghost row (copy · preview · ask again), retry on the
          latest answer only and never on a free seat. */}
      {personal && message.role === 'assistant' && !isStreamingThis && message.content.trim() && <CopyAnswer
        content={message.content}
        onRun={renderable ? () => onRunCode(renderable) : undefined}
        onRetry={retryPrompt ? () => onRetry(retryPrompt.content, retryPrompt) : undefined} />}
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
          title={c.url}
        >
          <span className="hps-cit-index">[{i + 1}]</span>
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
}: {
  content: string;
  streaming: boolean;
  buildingLabel: string;
  tone: "game" | "search" | "site" | "quest";
  /** #414 — the tool/activity log below carries the real state of the turn. */
  hasActivity?: boolean;
  personal?: boolean;
}) {
  const segments = useMemo(() => splitFences(content), [content]);
  const hasOpenFence = segments.some((s) => s.type === "code-open");

  if (content.length === 0) {
    return personal && streaming ? <ResponsePending /> : <span>{streaming ? "생각하는 중… ✨" : ""}</span>;
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <MarkdownText key={i} text={seg.value} />;
        }
        if (seg.type === "code-open") {
          if (streaming) {
            if (personal) return <ResponsePending key={i} hasContent />;
            const stage = buildStageText(buildingLabel, content, hasOpenFence, tone, hasActivity);
            return (
              <div key={i} className="hps-code-progress">
                🛠️ {stage}… <span className="hps-dots">✨</span>
              </div>
            );
          }
          // Stream ended with the fence still open → render partial + retry note.
          return (
            <div key={i}>
              <CodePill code={seg.value} personal={personal} />
              <div className="hps-stream-note">
                {personal ? "응답이 도중에 끊겼어요. 같은 요청을 한 번 더 보내 주세요." : "응답이 도중에 끊겼어요. 위의 🔄 버튼으로 다시 시도해주세요."}
              </div>
            </div>
          );
        }
        return <CodePill key={i} code={seg.value} personal={personal} />;
      })}
      {personal && streaming && !hasOpenFence && <ResponsePending hasContent />}
      {!personal && streaming && !hasOpenFence && content.length > 0 && (
        <div className="hps-code-progress hps-code-progress-prelude">
          🛠️ {buildStageText(buildingLabel, content, false, tone, hasActivity)}… <span className="hps-dots">✨</span>
        </div>
      )}
    </>
  );
}

function CodePill({ code, personal = false }: { code: string; personal?: boolean }) {
  const [open, setOpen] = useState(false);
  const lines = code.split("\n").length;
  return (
    <div className="hps-codepill">
      {/* Personal chat: a quiet disclosure in the answer's own type size, with a line icon from the
          chat's icon set instead of a colour emoji (UI audit P0-2). */}
      {personal ? <button className="hps-codepill-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChatIcon kind="code" size={14} /><span>{open ? "코드 숨기기" : `코드 보기 · ${lines}줄`}</span>
      </button> : <button className="hps-codepill-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} 📄 코드 {open ? "숨기기" : `보기 (${lines}줄)`}
      </button>}
      {open && <pre className="hps-codepill-body">{code}</pre>}
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
      <div className="hps-error-banner-icon">{icon}</div>
      <div className="hps-error-banner-body">
        <div className="hps-error-banner-title">{title}</div>
        <div className="hps-error-banner-msg">{message}</div>
        {runbookUrl && (
          <div className="hps-error-banner-runbook">
            {/* CGP-ART-R-008: the host decides where a link opens; a raw target=_blank anchor would reach the system browser. */}
            <a href={runbookUrl} onClick={(e) => { e.preventDefault(); postToHost({ type: "openExternal", url: runbookUrl }); }}>
              📖 강사 안내 — 세션 여는 법
            </a>
          </div>
        )}
        {requestId && !notice && (
          <div className="hps-error-banner-rid" title={errorIdTitle(audience)}>
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
            title={reportButtonTitle(audience)}
          >
            🚨 신고하기
          </button>
        )}
        <button
          className="hps-error-banner-dismiss"
          onClick={onDismiss}
          title="이 메시지 숨기기 (대화는 계속할 수 있어요)"
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

  return (
    <div className="hps-update-banner" role="status">
      <div className="hps-update-banner-icon">⬆️</div>
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
          title={`v${offer.version} 다운로드 + 자동 적용`}
        >
          업데이트
        </button>
        <button
          className="hps-update-banner-dismiss"
          onClick={() => onDismiss(offer.version)}
          title="이 버전은 7일 동안 다시 묻지 않음"
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
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const items = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
  const close = (restore = false) => { setOpen(false); if (restore) toggle.current?.focus({ preventScroll: true }); };
  useEffect(() => { setOpen(false); }, [personal, taskId]);
  useEffect(() => {
    if (!personal || !open) return;
    const choices = items();
    (firstFocus.current === 'last' ? choices.at(-1) : choices[0])?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [personal, open]);
  if (!personal) return <div className="hps-actions">{children}</div>;
  return <div className="hps-actions tw-chat-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (!open || event.defaultPrevented || imeComposing(event)) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const choices = items();
      if (!choices.length) return;
      event.preventDefault();
      const at = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      choices[next].focus({ preventScroll: true });
    }
  }}>
    <button ref={toggle} type="button" className="tw-chat-menu-toggle" aria-label="대화 메뉴" title="대화 메뉴" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => { firstFocus.current = 'first'; setOpen(!open); }} onKeyDown={event => {
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
      }
    }}><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg></button>
    {open && <div ref={panel} id={menuId} className="tw-chat-menu-panel" role="menu" aria-label="대화 메뉴" onClick={event => {
      if (event.target instanceof Element && event.target.closest('button[role="menuitem"]')) close(true);
    }}>{Children.map(children, child => isValidElement<{ role?: string; tabIndex?: number }>(child) && child.type === 'button' ? cloneElement(child, { role: 'menuitem', tabIndex: -1 }) : child)}</div>}
  </div>;
}
