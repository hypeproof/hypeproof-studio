import { FolderConsentDialog } from './FolderConsentDialog';
import type { FolderConsentPrompt } from '../../src/folderConsentPrompt';
import {BrowserApprovalDialog} from './BrowserApprovalDialog';
import type {BrowserApprovalPrompt} from '../../src/browserApprovalPrompt';
import type {DelegationStopState} from "../../src/delegationStop";
import {CommandApprovalDialog} from './CommandApprovalDialog';
import type {CommandApprovalPrompt} from '../../src/commandApprovalPrompt';
import {AnnotationLeaveDialog} from './AnnotationLeaveDialog';
import type {AnnotationLeavePrompt} from '../../src/annotationLeavePrompt';
import { attemptGroups, applyAttemptSelection } from '../../src/answerAttempts';
import { applyMotionPreference } from "./motion";
import {WriteApprovalDialog} from "./WriteApprovalDialog";
import {OutboundDialog, PublicAudienceDialog} from "./OutboundDialog";
import {isPublicAudiencePrompt, type AnyOutboundPrompt} from "../../src/outboundApproval";
import type {WriteApprovalPrompt} from "../../src/writeApprovalPrompt";
import { storedDenialNotice } from "../../src/denialNotice";
import type { TurnToolMode } from '../../src/turnTools';
import { useEffect, useReducer, useState, useRef } from "react";
import type { ChatConfig, ChatMessage, Citation, ElementPreview, HostMessage, TrialEndCardView } from "../../src/protocol";
import {
  emptyTimeline,
  timelineCitations,
  timelineDelta,
  timelineEnd,
  timelineReset,
  timelineStart,
  timelineTool,
  type TimelineState,
  type ToolEntry,
} from "../../src/chatTimeline";
import { onHostMessage, postToHost } from "./vscode";
import { runVoiceCapabilityProbe } from "./voiceProbe";
import { ChatPanel } from "./ChatPanel";
import { TaskWorkspaceFrame } from './TaskWorkspace';
import { askAboutFileAllowed } from './askAboutFile';
import type { TaskWorkspaceView } from '../../src/taskWorkspaceContract';
import type { VerdictMap, VerdictState } from '../../src/answerVerdict';
import { InstructorChatPanel } from "./InstructorChatPanel"; // #1298
import { ChatErrorBoundary } from "./ChatErrorBoundary";
import { PanelBoundary } from "./PanelBoundary";
import { VerifyPanel } from "./VerifyPanel";
import { PublishPanel } from "./PublishPanel";
import { EvidencePanel } from "./EvidencePanel";
import { MemoryPanel } from "./MemoryPanel";
import { SkillsPanel } from "./SkillsPanel";
import { ReviewPanel } from "./ReviewPanel";
import { TrialCarryover } from "./TrialCarryover";
import { pressDecision, reviewPanelReducer, type ReviewPanelAction, type ReviewPanelState } from "./reviewPanelState";
import type { SkillsView } from "../../src/skillView";
import type { MemoryView } from "../../src/memoryView";
import type { EvidenceView } from "../../src/evidenceView";
import type { PublishView } from "../../src/publishView";
import type { VerifyView } from "../../src/verifyView";
import { deriveTaskRunState, type TaskTurnOutcome } from "../../src/taskRunState";
import { useOnline, guardSend } from "./connectivity";
import { verifyPressAction, verifyNote } from "./verifyOffline";

interface State {
  config: ChatConfig | null;
  /**
   * #503 — 대화와 툴 실행이 **하나의 배열**이다. 예전에는 messages 와 toolLog 가
   * 평행선 두 개였고, 그래서 화면이 [말풍선 전부] 아래 [툴 전부] 로 그려졌다.
   */
  timeline: TimelineState;
  streamId: string | null;
  /** Last accepted visible event in the active turn, using this webview clock. */
  progressSince?: number;
  error: string | null;
  errorRetryable: boolean;
  activityUnavailable?: import("../../src/activityAvailability").ActivityUnavailable;
  errorRequestId: string | null;   // S-07 / #49 — surfaced in ErrorBanner
  /** TUX-COND-07 — the inline end-of-trial card the host sent with this turn's ending (drawn instead of the banner). */
  trialEndCard: TrialEndCardView | null;
  /** REQ-CGP-LEARN-13 — a moderation block is drawn as a calm notice instead of the error card. */
  safetyNotice: import("../../src/safetyNotice").SafetyNoticeView | null;
  errorRunbookUrl: string | null;  // #165 — banner renders as clickable link
  errorRetry: boolean;             // REQ-M45 — false when resending cannot help (missing SDK binary)
  pageNotice: string | null;        // #308 — "페이지를 코치에게" 인라인 안내 (토스트 대체)
  /** CR-09 — the picked element queued for the next turn; the student can remove it. */
  elementPreview: ElementPreview | null;
  annotationsEnabled: boolean;
  annotations: import("../../src/annotationBatch").AnnotationView[];
  /** CGP-ART-R-007 — page text queued for the next turn. */
  pageAttachment: import('../../src/pageContext').PageAttachmentPreview | null;
  /** CGP-CHAT-R-011 — the work-folder file queued for the next turn, and why the last pick was refused. */
  fileAttachment: import('../../src/protocol').FileAttachmentPreview | null;
  fileAttachError: string | null;
  /** CGP-CHAT-R-011 — a one-line notice (a retry did not resend the file). */
  fileAttachNotice: string | null;
  /** cr-verify — the "내 제품 테스트" panel as the host computed it; null = hidden. */
  verify: VerifyView | null;
  verifyError: string | null;
  /** The student's own sentence the panel sends next (a run start or a fix request). */
  verifySend: string | null;
  /** cr-publish — the "사용자 테스트용으로 공개" panel (null = hidden) and its last answer. */
  testPublish: { view: PublishView; error: string | null; errorLines: string[]; shareUrl: string | null } | null;
  /** cr-evidence — the "실험 증거" panel (null = hidden). */
  evidence: { view: EvidenceView; error: string | null; done: string | null } | null;
  /** cr-memory — the "프로젝트 기억" panel (null = hidden). */
  memory: { view: MemoryView; error: string | null; done: string | null } | null;
  /** cr-skills — the "커리큘럼 스킬" panel (null = hidden). */
  skills: { view: SkillsView; running: boolean; error: string | null; done: string | null } | null;
  /** cr-review — the "주간 리뷰" panel (reviewPanelState.ts). */
  review: ReviewPanelState;
  aiNotice: string | null;          // #320 — AI disclosure at session start (host-gated)
  /** REQ-STUDIO-STEER-NOW — the learner request the current turn answers (host streamStart), if any. */
  streamFor: string | null;
  stopNotice: string | null;        // #497 — Stop 을 눌러 턴이 끊겼음을 알리는 인라인 안내
  /** REQ-STUDIO-TASK-RUN-STATE — how this view's last turn ended; null until one ends here. */
  lastOutcome: TaskTurnOutcome;
  /** #649 — 지금 열려 있는 세상 id. 친구 스트립이 이 버튼을 강조한다(aria-pressed). */
  openWorldId: string | null;
  /**
   * "갤러리에 올리기" 의 상태. `null` 이면 아직 안 눌렀다.
   *
   * 스트림 상태(`streamId`)와 **섞지 않는다.** 발행은 코치와 무관한 별개의
   * 왕복이라, 하나로 묶으면 발행 중에 대화가 잠기거나 그 반대가 된다.
   */
  publish: { state: "uploading" } | { state: "done"; url: string } | { state: "error"; message: string } | null;
}

type Action =
  | { type: "visibleProgress" }
  | { type: "config"; config: ChatConfig }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "streamStart"; streamId: string; messageId: string; userMessageId?: string }
  | { type: "streamChunk"; delta: string }
  | { type: "streamCitations"; citations: Citation[] }
  | { type: "toolLog"; entry: ToolEntry }
  | { type: "pageAttached"; label: string }
  | { type: "annotations"; enabled: boolean; annotations: import("../../src/annotationBatch").AnnotationView[] }
  | { type: "elementAttached"; element: ElementPreview | null }
  | { type: "pageAttachment"; attachment: import('../../src/pageContext').PageAttachmentPreview | null }
  | { type: "fileAttachment"; attachment: import('../../src/protocol').FileAttachmentPreview | null; error?: string; notice?: string }
  | { type: "verifyState"; view: VerifyView | null; sendText?: string; error?: string }
  | { type: "verifyClose" }
  | { type: "testPublishState"; view: PublishView | null; error?: string; errorLines?: string[]; shareUrl?: string }
  | { type: "testPublishClose" }
  | { type: "evidenceState"; view: EvidenceView | null; error?: string; done?: string }
  | { type: "evidenceClose" }
  | { type: "memoryState"; view: MemoryView | null; error?: string; done?: string }
  | { type: "memoryClose" }
  | { type: "skillsState"; view: SkillsView | null; running?: boolean; error?: string; done?: string }
  | { type: "skillsClose" }
  | ReviewPanelAction
  | { type: "verifySent" }
  | { type: "aiDisclosure"; text: string }
  /** `failed` — the host closed the stream but the turn's result was a failure (#751 U4). `dismissed` — the learner closed the error banner; the outcome stays. */
  | { type: "streamEnd"; failed?: boolean; dismissed?: boolean }
  | { type: "streamStopped"; by?: "instructor" }
  | { type: "worldOpened"; id: string }
  | { type: "publishStart" }
  | { type: "publishResult"; state: "uploading" | "done" | "error"; url?: string; message?: string }
  | { type: "streamError"; error: string; activityUnavailable?: import("../../src/activityAvailability").ActivityUnavailable; requestId?: string; runbookUrl?: string; retry?: false; retryable?: boolean; trialEndCard?: TrialEndCardView; safetyNotice?: import("../../src/safetyNotice").SafetyNoticeView }
  | { type: "answerAttemptSelected"; root: ChatMessage }
  | { type: "userSent"; text: string; images?: string[]; toolMode?: TurnToolMode; id?: string; editOf?: string; retryOf?: string }
  /** D-028 — the host saved this send's attached photos; append their paths to the message. */
  | { type: "attachmentsSaved"; note: string };

// #497 — 사용자가 Stop 을 눌렀을 때의 안내. 오류가 아니므로 에러 배너를 쓰지
// 않는다 ("문제가 생겼어요" + 🚨 신고하기 는 정상 조작을 사고로 만든다).
const STOP_NOTICE = "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요.";
// #751 — a classroom stop is not a fault and not the learner's own click: say who stopped it and that nothing was lost.
const INSTRUCTOR_STOP_NOTICE = "강사가 지금 실행 중이던 작업을 멈췄어요. 대화와 파일은 그대로예요. 준비되면 다시 입력해 주세요.";

const initialState: State = {
  config: null,
  timeline: emptyTimeline(),
  streamId: null,
  error: null,
  errorRetryable: true,
  errorRequestId: null,
  errorRunbookUrl: null,
  errorRetry: true,
  trialEndCard: null,
  safetyNotice: null,
  pageNotice: null,
  elementPreview: null, annotations: [], annotationsEnabled: false,
  pageAttachment: null,
  fileAttachment: null,
  fileAttachError: null,
  fileAttachNotice: null,
  verify: null,
  testPublish: null,
  evidence: null,
  memory: null,
  skills: null,
  review: null,
  verifyError: null,
  verifySend: null,
  aiNotice: null,
  streamFor: null,
  stopNotice: null,
  lastOutcome: null,
  openWorldId: null,
  publish: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "config":
      return { ...(state.config?.activity?.id === action.config.activity?.id && state.config?.taskWorkspace?.activeTaskId === action.config.taskWorkspace?.activeTaskId ? state : initialState), config: action.config };
    case "answerAttemptSelected":
      return { ...state, timeline: { ...state.timeline, items: applyAttemptSelection(state.timeline.items, action.root) } };
    case "history":
      // 대화·툴·에러가 한 번에 갈린다. Clear 를 눌러도 직전 턴의 툴 호출 목록이
      // 화면에 남아 있었다(2026-07-27 실사용) — 이제 툴이 타임라인의 일부라
      // 배열 하나를 갈아끼우면 끝이다.
      return { ...state, timeline: timelineReset(action.messages), error: null };
    case "streamStart":
      return {
        ...state,
        streamId: action.streamId,
        progressSince: Date.now(),
        streamFor: action.userMessageId ?? null,
        error: null,
        stopNotice: null,   // #497 — 새 턴이 시작되면 이전 중지 안내는 사라진다
        lastOutcome: null,
        // #503 — 직전 턴의 툴 줄을 **비우지 않는다**. 예전에는 여기서 toolLog 를
        // [] 로 밀어서, 다음 턴이 시작되는 순간 이전 턴이 무슨 도구를 썼는지가
        // 통째로 증발했다(스크롤을 올려도 말풍선만 남았다).
        timeline: timelineStart(state.timeline, action.messageId, Date.now()),
      };
    case "visibleProgress":
      return state.streamId ? { ...state, progressSince: Date.now() } : state;
    case "streamChunk":
      return { ...state, ...(action.delta ? { progressSince: Date.now() } : {}), timeline: timelineDelta(state.timeline, action.delta, Date.now()) };
    case "streamCitations":
      return { ...state, timeline: timelineCitations(state.timeline, action.citations) };
    case "toolLog":
      // 같은 id 는 제자리 갱신(running → done/error), 새 id 는 지금 이 자리에 삽입.
      return { ...state, progressSince: Date.now(), timeline: timelineTool(state.timeline, action.entry, Date.now()) };
    case "pageAttached":
      // #308 — inline notice; cleared on the next send (userSent) only.
      return { ...state, pageNotice: action.label };
    case "annotations": return { ...state, annotations: action.annotations, annotationsEnabled: action.enabled };
    case "elementAttached":
      return { ...state, elementPreview: action.element };
    case "pageAttachment":
      return { ...state, pageAttachment: action.attachment };
    case "fileAttachment":
      return { ...state, fileAttachment: action.attachment, fileAttachError: action.error ?? null, fileAttachNotice: action.notice ?? (action.attachment ? null : state.fileAttachNotice) };
    case "verifyState":
      return { ...state, verify: action.view, verifyError: action.error ?? null, verifySend: action.sendText ?? state.verifySend };
    case "verifyClose":
      return { ...state, verify: null, verifyError: null };
    case "testPublishState":
      return { ...state, testPublish: action.view ? { view: action.view, error: action.error ?? null, errorLines: action.errorLines ?? [], shareUrl: action.shareUrl ?? null } : null };
    case "testPublishClose":
      return { ...state, testPublish: null };
    case "evidenceState":
      return { ...state, evidence: action.view ? { view: action.view, error: action.error ?? null, done: action.done ?? null } : null };
    case "evidenceClose":
      return { ...state, evidence: null };
    case "memoryState":
      return { ...state, memory: action.view ? { view: action.view, error: action.error ?? null, done: action.done ?? null } : null };
    case "memoryClose":
      return { ...state, memory: null };
    case "skillsState":
      return { ...state, skills: action.view ? { view: action.view, running: action.running === true, error: action.error ?? null, done: action.done ?? null } : null };
    case "skillsClose":
      return { ...state, skills: null };
    case "reviewState":
    case "reviewDeciding":
    case "reviewClose": {
      // cr-review (CR-52) — a decision's press shows a status line until the host's next answer.
      const review = reviewPanelReducer(state.review, action);
      return review === state.review ? state : { ...state, review };
    }
    case "verifySent":
      return { ...state, verifySend: null };
    case "worldOpened":
      // 세상이 바뀌면 직전 발행 결과는 더 이상 이 세상 얘기가 아니다 — 지운다.
      // (안 지우면 초코 세상을 열었는데 뽀로 세상의 "올렸어요" 링크가 남는다.)
      return { ...state, openWorldId: action.id, publish: null };
    case "publishStart":
      return { ...state, publish: { state: "uploading" } };
    case "publishResult":
      if (action.state === "uploading") return { ...state, publish: { state: "uploading" } };
      if (action.state === "done") return { ...state, publish: { state: "done", url: action.url ?? "" } };
      return { ...state, publish: { state: "error", message: action.message ?? "올리지 못했어요." } };
    case "aiDisclosure":
      // #320 — session-start AI disclosure. The host gates when this arrives
      // (once per session + after clear); the webview just keeps it visible
      // for the rest of this mount. Replaces, never appends.
      return { ...state, aiNotice: action.text };
    case "streamEnd":
      return {
        ...state,
        streamId: null,
        timeline: timelineEnd(state.timeline, Date.now()),
        error: null,
        errorRequestId: null,
        errorRunbookUrl: null,
        trialEndCard: null,
        safetyNotice: null,
        lastOutcome: action.dismissed ? state.lastOutcome : action.failed ? "error" : "done",
      };
    case "streamStopped":
      // #497 — 턴이 완주한 게 아니라 사용자가 끊은 것. streamEnd 와 같은 상태
      // 해제를 하되, 무슨 일이 있었는지 한 줄 남긴다. 여기까지 스트리밍된 부분
      // 답변은 화면에 그대로 두고(무엇이 만들어졌는지 보이는 편이 낫다),
      // 호스트는 이 턴을 영속 히스토리에 커밋하지 않는다.
      return {
        ...state,
        streamId: null,
        // #503 — 끊긴 턴도 타임라인은 닫는다: 보류된 툴 줄이 남아 있으면
        // 흘려 넣고 말풍선을 닫는다. 스트리밍된 부분 답변은 그대로 둔다.
        timeline: timelineEnd(state.timeline, Date.now()),
        error: null,
        errorRequestId: null,
        errorRunbookUrl: null,
        stopNotice: action.by === "instructor" ? INSTRUCTOR_STOP_NOTICE : STOP_NOTICE,
        lastOutcome: "stopped",
      };
    case "streamError":
      return {
        ...state,
        streamId: null,
        timeline: timelineEnd(state.timeline, Date.now()),
        error: action.error,
        activityUnavailable: action.activityUnavailable,
        errorRetryable: action.retryable !== false,
        errorRequestId: action.requestId ?? null,
        errorRunbookUrl: action.runbookUrl ?? null,
        errorRetry: action.retry !== false,
        trialEndCard: action.trialEndCard ?? null,
        safetyNotice: action.safetyNotice ?? null,
        lastOutcome: "error",
      };
    case "attachmentsSaved": {
      const items = [...state.timeline.items];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i] as { role?: string; content?: string };
        if (it.role !== "user") continue;
        items[i] = { ...items[i], content: it.content ? `${it.content}\n\n${action.note}` : action.note } as typeof items[number];
        break;
      }
      return { ...state, timeline: { ...state.timeline, items } };
    }
    case "userSent":
      return {
        ...state,
        pageNotice: null,   // #308 — clear the "붙였어요" notice once the user sends
        elementPreview: null, // CR-09 — the picked element went with this turn
        // CGP-ART-R-007 / CGP-CHAT-R-011 — the page and file chips are host-owned: the host clears them
        // when a model turn actually takes them, so a send turned away earlier leaves them visible.
        fileAttachError: null,
        fileAttachNotice: null,
        stopNotice: null,   // #497 — 다시 입력했으면 중지 안내는 역할을 다했다
        lastOutcome: null,
        timeline: {
          ...state.timeline,
          items: [
            ...state.timeline.items.map(message => action.retryOf === message.id ? { ...message, visibleAttemptId: action.id } : message),
            {
              id: action.id ?? `local-${Date.now()}`,
              role: "user",
              content: action.text,
              ...(action.toolMode ? { toolMode: action.toolMode } : {}),
              ...(action.editOf ? { editOf: action.editOf } : {}),
              ...(action.retryOf ? { retryOf: action.retryOf } : {}),
              createdAt: Date.now(),
              ...(action.images && action.images.length > 0 ? { images: action.images } : {}),
            },
          ],
        },
      };
  }
}

/** Exported for the reducer contract tests (test/sdk-required.test.mjs); not a runtime API. */
export { reducer as chatPanelReducer, initialState as chatPanelInitialState };

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [refusal, setRefusal] = useState(false);
  const [delegationStops,setDelegationStops]=useState<Record<string,DelegationStopState>>({});
  const delegationStreams=useRef(new Set<string>());
  const scope = useRef<string | undefined>();
  const taskScope = useRef<string | undefined>();
  // The bridge can deliver an old turn after Stop. Update this synchronously,
  // before React renders, so a late terminal event cannot end the next turn.
  const activeStream = useRef<string | null>(null);
  const pendingSend = useRef(false);
  const [sendPending, setSendPending] = useState(false);
  // CGP-SHELL-R-011 — the product-test start/fix also starts a chat turn: same offline gate as ChatPanel.
  const online = useOnline();
  const [verifyHeld, setVerifyHeld] = useState(false);
  const verifyWhenOnline = (post: () => void) => { if (guardSend(online, post, () => setVerifyHeld(true))) setVerifyHeld(false); };
  // N1 — which press the last handed-back turn came from, and the one parked on the host (if any).
  const lastVerifyKey = useRef<string | null>(null);
  const [parkedVerify, setParkedVerify] = useState<string | null>(null);
  const pressAction = (key: string) => { const action = verifyPressAction(parkedVerify, key); setParkedVerify(null); lastVerifyKey.current = key; return action; };
  // CGP-CHAT-R-005 — the active task's verdicts as the host last confirmed them (drawn optimistically on click).
  const [verdicts, setVerdicts] = useState<VerdictMap>({});
  // REQ-STUDIO-CONTEXT-TRIM-MARKER — computed by the host from the saved history it sends.
  const [trimBoundaryId, setTrimBoundaryId] = useState<string | null>(null);
  const pendingVerdicts = useRef(new Map<string, { requestId: string; value: VerdictState | null }>());
  const latestVerdictRequests = useRef(new Map<string, string>());
  const ownVerdictRequests = useRef(new Set<string>());
  const [shouldCrash, setShouldCrash] = useState(false);
  const [workspace, setWorkspace] = useState<TaskWorkspaceView>();
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [historySaveError, setHistorySaveError] = useState<string | null>(null);
  // REQ-STUDIO-TASK-RUN-STATE — the host raised a tool approval modal and it is still open.
  const [approvalPending, setApprovalPending] = useState(false);
  const [browserApproval,setBrowserApproval]=useState<BrowserApprovalPrompt|null>(null);
  const [commandApproval,setCommandApproval]=useState<CommandApprovalPrompt|null>(null);
  const [annotationLeave,setAnnotationLeave]=useState<AnnotationLeavePrompt|null>(null);
  const [writeApproval,setWriteApproval]=useState<WriteApprovalPrompt|null>(null);
  const [folderConsent,setFolderConsent]=useState<FolderConsentPrompt|null>(null);
  const [outbound,setOutbound]=useState<AnyOutboundPrompt|null>(null);
  // cr-verify — the verify requests THIS view made; the host echoes the id with the sentence to send.
  const verifyRequests = useRef(new Set<string>());
  const verifyRequest = () => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    verifyRequests.current.add(id);
    return id;
  };
  // #384 — image handed over from the host (an image opened in an editor tab).
  // nonce forces ChatPanel's effect to re-run even for the same dataUrl.
  const [incomingImage, setIncomingImage] = useState<{ dataUrl: string; nonce: number; name?: string } | null>(null);

  useEffect(() => {
    const off = onHostMessage((msg: HostMessage) => {
      if (msg.type === "config") {
        setWorkspace(msg.config.taskWorkspace);
        setWorkspaceError(null);
        if (scope.current !== msg.config.activity?.id || taskScope.current !== (msg.config.taskWorkspace?.activeTaskId ?? undefined)) {
          setDraftSaveError(null);
          setHistorySaveError(null);
          setIncomingImage(null);
          verifyRequests.current.clear();
          pendingVerdicts.current.clear();
          latestVerdictRequests.current.clear();
          ownVerdictRequests.current.clear();
          activeStream.current = null;
          setRefusal(false);
          setDelegationStops({});delegationStreams.current.clear();
          setApprovalPending(false); setWriteApproval(null); setOutbound(null); setFolderConsent(null);
        }
        scope.current = msg.config.activity?.id;
        taskScope.current = msg.config.taskWorkspace?.activeTaskId ?? undefined;
      } else if (msg.activityId && msg.activityId !== scope.current) return;
      if(msg.type==='delegationStopState'){
        if(delegationStreams.current.has(msg.streamId))setDelegationStops(old=>({...old,[msg.streamId]:msg.state}));
        return;
      }
      if ("streamId" in msg) {
        if (msg.type === "streamStart") {
          // One turn owns this view; a repeated start must not clear its text.
          if (activeStream.current !== null) return;
          activeStream.current = msg.streamId;
          delegationStreams.current.add(msg.streamId);
          setRefusal(false);
        } else if (msg.streamId !== activeStream.current) {
          // These host refusal codes are emitted before streamStart. They still
          // need to explain an idle preflight failure, never terminate a live turn.
          const preflight = msg.type === "streamError" && activeStream.current === null
            && ["tools", "connection", "activity"].includes(msg.streamId);
          if (!preflight) return;
        }
        if (["streamEnd", "streamStopped", "streamError"].includes(msg.type)) activeStream.current = null;
      }
      if (["streamStart", "inputRejected", "streamError", "streamEnd", "streamStopped"].includes(msg.type)) {
        pendingSend.current = false; setSendPending(false);
        // A modal never outlives its turn; a turn boundary is never "waiting for approval".
        setApprovalPending(false); setWriteApproval(null);
      }
      switch (msg.type) {
        case "streamRefusal": setRefusal(true); return;
        case 'taskWorkspaceState': setWorkspace(msg.view); setWorkspaceError(null); return;
        case 'browserApprovalPrompt': setBrowserApproval(msg.prompt); return;
        case 'commandApprovalPrompt': setCommandApproval(msg.prompt); return;
        case 'annotationLeavePrompt': setAnnotationLeave(msg.prompt); return;
        case 'writeApprovalPrompt': setWriteApproval(msg.prompt); return;
        case 'folderConsentPrompt': setFolderConsent(msg.prompt); return;
        case 'outboundPrompt': setOutbound(msg.prompt); return;
        case 'approvalWait': setApprovalPending(msg.waiting === true); if (!msg.waiting) dispatch({ type: 'visibleProgress' }); return;
        case 'taskWorkspaceError':
          if (msg.verdictMessageId && msg.verdictRequestId && ownVerdictRequests.current.has(msg.verdictRequestId) && latestVerdictRequests.current.has(msg.verdictMessageId) && latestVerdictRequests.current.get(msg.verdictMessageId) !== msg.verdictRequestId) return;
          setWorkspaceError(msg.error);
          if (msg.historySaveFailed) setHistorySaveError(msg.error);
          // A list/config refresh is not proof that the current draft reached disk.
          // Only a successful draft acknowledgement or a new scope releases this warning.
          if (msg.draftSaveFailed) setDraftSaveError(msg.error);
          else if (msg.error === null) setDraftSaveError(null);
          return;
        // #897 (VO-01) — 음성 capability 프로브. **원시 관측만** 돌려보내고 판정은
        // 호스트가 한다. 화면에 아무것도 바꾸지 않는다 — 이건 계측기다.
        case "probeVoiceCapability": {
          // 정적 import 다. 동적 import 로 두면 이 청크가 이 웹뷰의 **첫** 코드 분할이
          // 되는데, `script-src` 가 cspSource 를 허용하니 될 것 같다는 추론에 계측기를
          // 걸 수는 없다. 2.6 kB 를 항상 싣는 쪽이 검증되지 않은 로딩 경로보다 싸다.
          const probeId = msg.probeId;
          void runVoiceCapabilityProbe().then((observations) => {
            postToHost({ type: "voiceCapabilityProbeResult", probeId, observations });
          });
          break;
        }
        case "config":      dispatch({ type: "config", config: msg.config }); break;
        case "answerAttemptSelected": dispatch({type: "answerAttemptSelected", root: msg.root}); break;
        case "history":     dispatch({ type: "history", messages: msg.messages }); setTrimBoundaryId(null); break;
        case "contextTrim": setTrimBoundaryId(msg.boundaryId); break;
        case "answerVerdicts": {
          const latest = msg.messageId ? latestVerdictRequests.current.get(msg.messageId) : undefined;
          if (latest && msg.requestId && ownVerdictRequests.current.has(msg.requestId) && latest !== msg.requestId) break;
          if (msg.messageId && pendingVerdicts.current.get(msg.messageId)?.requestId === msg.requestId) pendingVerdicts.current.delete(msg.messageId);
          const next = { ...msg.verdicts };
          // A saved snapshot must not replace a newer choice whose write is still pending.
          for (const [id, pending] of pendingVerdicts.current) {
            if (pending.value) next[id] = pending.value;
            else delete next[id];
          }
          setVerdicts(next);
          break;
        }
        case "streamStart": dispatch({ type: "streamStart", streamId: msg.streamId, messageId: msg.messageId, userMessageId: msg.userMessageId }); break;
        case "attachedImagesSaved": dispatch({ type: "attachmentsSaved", note: msg.note }); break;
        case "streamChunk": dispatch({ type: "streamChunk", delta: msg.delta }); break;
        case "streamCitations": dispatch({ type: "streamCitations", citations: msg.citations }); break;
        case "toolLog": dispatch({ type: "toolLog", entry: { id: msg.id, icon: msg.icon, label: msg.label, state: msg.state, ...(msg.at ? { at: msg.at } : {}), ...(msg.step !== undefined && msg.since !== undefined ? { step: msg.step, since: msg.since } : {}) } }); break;
        case "denialNotice":
          if (storedDenialNotice(msg.label)) dispatch({ type: "toolLog", entry: { id: msg.id, icon: '', label: msg.label, state: 'error', at: msg.at } });
          break;
        case "pageAttached": dispatch({ type: "pageAttached", label: msg.label }); break;
        case "annotations": dispatch({ type: "annotations", enabled: msg.enabled, annotations: msg.annotations }); break;
        case "elementAttached": dispatch({ type: "elementAttached", element: msg.element }); break;
        case "pageAttachment": dispatch({ type: "pageAttachment", attachment: msg.attachment }); break;
        case "fileAttachment": dispatch({ type: "fileAttachment", attachment: msg.attachment, error: msg.error, notice: msg.notice }); break;
        // Every chat view gets the post; only the one whose panel asked sends the sentence.
        case "verifyState": dispatch({ type: "verifyState", view: msg.view, sendText: msg.sendText && msg.requestId && verifyRequests.current.delete(msg.requestId) ? msg.sendText : undefined, error: msg.error }); break;
        case "publishState": dispatch({ type: "testPublishState", view: msg.view, error: msg.error, errorLines: msg.errorLines, shareUrl: msg.shareUrl }); break;
        case "evidenceState": dispatch({ type: "evidenceState", view: msg.view, error: msg.error, done: msg.done }); break;
        case "memoryState": dispatch({ type: "memoryState", view: msg.view, error: msg.error, done: msg.done }); break;
        case "skillsState": dispatch({ type: "skillsState", view: msg.view, running: msg.running, error: msg.error, done: msg.done }); break;
        case "reviewState": dispatch({ type: "reviewState", view: msg.view, error: msg.error, done: msg.done }); break;
        case "aiDisclosure": dispatch({ type: "aiDisclosure", text: msg.text }); break;
        case "worldOpened": dispatch({ type: "worldOpened", id: msg.id }); break;
        case "publishResult": dispatch({ type: "publishResult", state: msg.state, url: msg.url, message: msg.message }); break;
        case "streamEnd":   dispatch({ type: "streamEnd", failed: msg.failed === true }); break;
        case "streamStopped": dispatch({ type: "streamStopped", by: msg.by }); break;
        case "streamError": dispatch({ type: "streamError", error: msg.error, activityUnavailable: msg.activityUnavailable, requestId: msg.requestId, runbookUrl: msg.runbookUrl, retry: msg.retry, retryable: msg.retryable, trialEndCard: msg.trialEndCard, safetyNotice: msg.safetyNotice }); break;
        case "actionResult": /* not yet routed to UI */ break;
        case "attachImage": setIncomingImage({ dataUrl: msg.dataUrl, nonce: Date.now(), name: msg.name }); break;
        case "webviewTestCrash": setShouldCrash(true); break;
      }
    });
    postToHost({ type: "ready" });
    return off;
  }, []);

  // (REQ-C7 crash injection is performed by <CrashIfFlagged> below, which
  // sits INSIDE the ChatErrorBoundary tree. Throwing here in App() instead
  // would crash above the boundary, leaving nothing to catch it.)

  // #503 — 화면과 히스토리는 같은 배열이다. 호스트로 넘어간 뒤 모델로 나가기
  // 전에 role:"tool" 이 걸러진다(chatTimeline.modelHistory).
  const messages = state.timeline.items;

  useEffect(() => { pendingSend.current = false; setSendPending(false); }, [state.config?.activity?.id, state.config?.taskWorkspace?.activeTaskId]);
  // CGP-DS-R-015: follow a reduce-motion change without reloading the panel.
  useEffect(() => {
    if (!state.config) return;
    applyMotionPreference(state.config.reduceMotion);
  }, [state.config?.reduceMotion, !!state.config]);
  const beginRequest = () => {
    if (pendingSend.current || state.streamId) return false;
    pendingSend.current = true; setSendPending(true); return true;
  };
  const send = (text: string, images?: string[], imports?: Array<{ object_id: string; revision: number; hash16: string }>, attachments?: Array<{ id: string }>, toolMode: TurnToolMode = 'auto') => {
    const trimmed = text.trim();
    const hasImages = !!images && images.length > 0;
    const hasAttachments = !!attachments && attachments.length > 0;
    if ((!trimmed && !hasImages && !hasAttachments) || !beginRequest()) return false;
    // D-028 — only the stage ids go to the host. The photos are not put on the bubble as
    // images (a retry would send those to the model); the host answers with the saved paths,
    // which are appended to this message (attachedImagesSaved).
    const userMessageId = `local-${crypto.randomUUID()}`;
    dispatch({ type: "userSent", text: trimmed, images, toolMode, id: userMessageId });
    postToHost({ type: "sendMessage", activityId: state.config?.activity?.id, userMessageId, toolMode, text: trimmed, history: messages, images, ...(imports?.length ? { imports } : {}), ...(hasAttachments ? { attachments: attachments!.map((a) => a.id) } : {}) });
  };

  // cr-verify — the host recorded the start or fix request; the student's own sentence goes
  // out through the ordinary send path (the host attaches the coach context, model-only).
  // L1 — any answer from the host replaces the held note (declared before the hand-back effect, so a
  // hold that effect sets in the same commit survives).
  useEffect(() => setVerifyHeld(false), [state.verify, state.verifyError]);
  useEffect(() => {
    if (!state.verifySend || state.streamId) return;
    const text = state.verifySend;
    dispatch({ type: "verifySent" });
    // N1 — not sent (offline): park it on the host so no unrelated turn carries its context; the
    // learner's next press of the same button resumes it. Never sent on reconnect by itself.
    const sent = guardSend(online, () => send(text), () => setVerifyHeld(true));
    if (!sent) { postToHost({ type: "verifyPark" }); setParkedVerify(lastVerifyKey.current); }
  }, [state.verifySend, state.streamId]);

  const verifyPanel = state.verify ? (
    <PanelBoundary panel="verify"><VerifyPanel
      view={state.verify}
      error={verifyNote(verifyHeld, state.verifyError)}
      busy={!!state.streamId}
      onStart={(criteria) => verifyWhenOnline(() => { const requestId = verifyRequest(); postToHost(pressAction(`start:${JSON.stringify(criteria)}`) === "resume" ? { type: "verifyResume", requestId } : { type: "verifyStart", requestId, criteria }); })}
      onRetest={() => { setVerifyHeld(false); postToHost({ type: "verifyRetest" }); }}
      onFix={(criterionId, text) => verifyWhenOnline(() => { const requestId = verifyRequest(); postToHost(pressAction(`fix:${JSON.stringify([criterionId, text])}`) === "resume" ? { type: "verifyResume", requestId } : { type: "verifyFix", requestId, criterionId, text }); })}
      onClose={() => { setVerifyHeld(false); dispatch({ type: "verifyClose" }); }}
    /></PanelBoundary>
  ) : null;

  const publishPanel = state.testPublish ? (
    <PanelBoundary panel="publish"><PublishPanel
      view={state.testPublish.view}
      error={state.testPublish.error}
      errorLines={state.testPublish.errorLines}
      shareUrl={state.testPublish.shareUrl}
      busy={!!state.streamId}
      onCopy={(versionId) => postToHost({ type: "publishCopy", versionId })}
      onRefresh={() => postToHost({ type: "publishRefresh" })}
      onManifest={(manifest) => postToHost({ type: "publishOpen", manifest })}
      onSubmit={(form) => postToHost({ type: "publishSubmit", form })}
      onLink={(experimentId, channel, expiresInDays) => postToHost({ type: "publishLink", experimentId, channel, expiresInDays })}
      onRevoke={(linkId) => postToHost({ type: "publishRevoke", linkId })}
      onClose={() => { postToHost({ type: "publishClose" }); dispatch({ type: "testPublishClose" }); }}
    /></PanelBoundary>
  ) : null;

  const evidencePanel = state.evidence ? (
    <PanelBoundary panel="evidence-panel"><EvidencePanel
      view={state.evidence.view}
      error={state.evidence.error}
      done={state.evidence.done}
      busy={!!state.streamId}
      onSelect={(experimentId) => postToHost({ type: "evidenceOpen", experimentId })}
      onNote={(experimentId, note) => postToHost({ type: "evidenceNote", experimentId, note })}
      onDraft={(experimentId) => postToHost({ type: "evidenceDraft", experimentId })}
      onReview={(experimentId, draftId, revision, actions) => postToHost({ type: "evidenceReview", experimentId, draftId, revision, actions })}
      onDelete={(experimentId, sessionId) => postToHost({ type: "evidenceDelete", experimentId, ...(sessionId ? { sessionId } : {}) })}
      onClose={() => dispatch({ type: "evidenceClose" })}
    /></PanelBoundary>
  ) : null;

  const memoryPanel = state.memory ? (
    <PanelBoundary panel="memory"><MemoryPanel
      view={state.memory.view}
      error={state.memory.error}
      done={state.memory.done}
      busy={!!state.streamId}
      onRefresh={() => postToHost({ type: "memoryOpen" })}
      onDiff={(from, to) => postToHost({ type: "memoryDiff", from, to })}
      onDecide={(form) => postToHost({ type: "memoryDecision", form })}
      onClose={() => dispatch({ type: "memoryClose" })}
    /></PanelBoundary>
  ) : null;

  const skillsPanel = state.skills ? (
    <PanelBoundary panel="skills"><SkillsPanel
      view={state.skills.view}
      error={state.skills.error}
      done={state.skills.done}
      running={state.skills.running}
      onRefresh={() => postToHost({ type: "skillsOpen" })}
      onRun={(skill, form) => postToHost({ type: "skillRun", skill, form })}
      onClose={() => dispatch({ type: "skillsClose" })}
    /></PanelBoundary>
  ) : null;

  // REQ-L12 ⑫ — the trial carry-over offer / read-only trial transcript (host-gated on the Service offer).
  const carryoverPanel = state.config?.carryover ? (
    <PanelBoundary panel="carryover"><TrialCarryover view={state.config.carryover} busy={!!state.streamId} onDecide={(decision) => postToHost({ type: "carryoverDecision", decision })} /></PanelBoundary>
  ) : null;
  const reviewPanel = state.review ? (
    <PanelBoundary panel="review"><ReviewPanel
      view={state.review.view}
      error={state.review.error}
      done={state.review.done}
      busy={!!state.streamId}
      deciding={state.review.deciding}
      onRefresh={() => postToHost(state.review!.view.mode === "director" ? { type: "reviewDirectorOpen", projectId: state.review!.view.review?.project_id ?? null } : { type: "reviewOpen" })}
      onPrepare={() => postToHost({ type: "reviewPrepare" })}
      onOpenTeam={(projectId) => postToHost({ type: "reviewDirectorOpen", projectId })}
      onDecide={(projectId, week, revision, form) => pressDecision(dispatch, postToHost, { type: "reviewDecision", projectId, week, revision, form })}
      onClose={() => dispatch({ type: "reviewClose" })}
    /></PanelBoundary>
  ) : null;

  const retry = (prompt: string, source?: ChatMessage) => {
    if (!beginRequest()) return;
    const toolMode = source?.toolMode ?? 'auto';
    const userMessageId = `local-${crypto.randomUUID()}`;
    const root = attemptGroups(messages).find(group => group.attempts.some(attempt => attempt.user.id === source?.id))?.root;
    dispatch({ type: "userSent", text: prompt, toolMode, id: userMessageId, images: source?.images, retryOf: root?.id, editOf: root?.editOf });
    postToHost({ type: "retryMessage", activityId: state.config?.activity?.id, prompt, history: messages, toolMode, sourceMessageId: source?.id, userMessageId, images: source?.images });
  };

  // CGP-CHAT-R-002 — the edited text of the latest prompt goes out as a NEW request: a new id,
  // the original's tool mode (REQ-STUDIO-CHAT-REFERENCE) and the images the learner kept. The
  // original stays in the transcript as version 1; the host re-checks the target and the gates.
  const editResend = (original: ChatMessage, editOf: string, text: string, images: string[]) => {
    const trimmed = text.trim();
    if (!trimmed || !beginRequest()) return false;
    const toolMode = original.toolMode ?? 'auto';
    const userMessageId = `local-${crypto.randomUUID()}`;
    const kept = images.length > 0 ? images : undefined;
    dispatch({ type: "userSent", text: trimmed, images: kept, toolMode, id: userMessageId, editOf });
    postToHost({ type: "sendMessage", activityId: state.config?.activity?.id, userMessageId, toolMode, text: trimmed, history: messages, images: kept, editOf });
    return true;
  };

  // CGP-CHAT-R-005 — a verdict is drawn at once and confirmed (or put back) by the host's answer.
  const judgeAnswer = (messageId: string, next: VerdictState | null) => {
    const requestId = crypto.randomUUID();
    ownVerdictRequests.current.add(requestId);
    latestVerdictRequests.current.set(messageId, requestId);
    pendingVerdicts.current.set(messageId, { requestId, value: next });
    setVerdicts(({ [messageId]: _previous, ...rest }) => next ? { ...rest, [messageId]: next } : rest);
    postToHost({ type: "answerVerdict", requestId, messageId, verdict: next?.verdict ?? null, ...(next?.reason ? { reason: next.reason } : {}), ...(next?.note ? { note: next.note } : {}) });
  };

  // S-04 (#48): "다시 보내기" on a stream error reuses the LAST user prompt
  // that's already in history. The worker idempotently writes turn rows so
  // a retry doesn't double-count.
  const retryLast = () => {
    if (state.streamId || pendingSend.current) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === "user") {
        // #358 — re-attach the failed turn's pending image(s). Without this the
        // retry re-sent text only, so the coach replied "스크린샷을 아직 못
        // 받았어요" even though the student did paste one. Images live only on
        // the in-memory message (single-shot, REQ-C11), which is exactly what a
        // same-session retry needs.
        // Same body as retry(): this runs only behind ChatPanel's guarded onRetryLast press.
        const toolMode = m.toolMode ?? 'auto';
        const userMessageId = `local-${crypto.randomUUID()}`;
        const root = attemptGroups(messages).find(group => group.attempts.some(attempt => attempt.user.id === m.id))?.root;
        if (!beginRequest()) return;
        dispatch({ type: "userSent", text: m.content, toolMode, id: userMessageId, images: m.images, retryOf: root?.id, editOf: root?.editOf });
        postToHost({ type: "retryMessage", activityId: state.config?.activity?.id, prompt: m.content, history: messages, toolMode, sourceMessageId: m.id, userMessageId, images: m.images });
        return;
      }
    }
  };

  const dismissError = () => dispatch({ type: "streamEnd", dismissed: true });

  const cancel = () => {
    if (state.streamId) postToHost({ type: "cancelStream", streamId: state.streamId });
  };

  // streamEnd dispatches don't carry error info; clear-on-end is fine because
  // the existing reducer only sets error on streamError, never on streamEnd.
  const hasLastUserPrompt = messages.some((m) => m.role === "user");
  const runState = deriveTaskRunState({
    preparing: sendPending,
    running: !!state.streamId || !!state.verify?.running,
    approvalPending,
    lastOutcome: state.lastOutcome,
  });

  return (
    <ChatErrorBoundary onReset={() => { setShouldCrash(false); postToHost({ type: "ready" }); }}>
      <CrashIfFlagged crash={shouldCrash} />
      {folderConsent && <FolderConsentDialog key={folderConsent.id} prompt={folderConsent} textSize={state.config?.textSize} onAnswer={(id,level)=>{postToHost({type:'folderConsentAnswer',id,level});setFolderConsent(null);dispatch({type:"visibleProgress"});}}/>}
      {outbound && (isPublicAudiencePrompt(outbound)
        ? <PublicAudienceDialog key={outbound.id} prompt={outbound} textSize={state.config?.textSize} onAnswer={(id,selected)=>{postToHost({type:'outboundAnswer',id,selected});setOutbound(null);dispatch({type:"visibleProgress"});}}/>
        : <OutboundDialog key={outbound.id} prompt={outbound} textSize={state.config?.textSize} onAnswer={(id,selected)=>{postToHost({type:'outboundAnswer',id,selected});setOutbound(null);dispatch({type:"visibleProgress"});}}/>)}
      {browserApproval && <BrowserApprovalDialog key={browserApproval.id} prompt={browserApproval} textSize={state.config?.textSize} onAnswer={(id,choice)=>{postToHost({type:'browserApprovalAnswer',id,choice});setBrowserApproval(null);dispatch({type:"visibleProgress"});}}/>}
      {commandApproval && <CommandApprovalDialog key={commandApproval.id} prompt={commandApproval} textSize={state.config?.textSize} onAnswer={(id,choice)=>{postToHost({type:'commandApprovalAnswer',id,choice});setCommandApproval(null);dispatch({type:"visibleProgress"});}}/>}
      {annotationLeave && <AnnotationLeaveDialog key={annotationLeave.id} prompt={annotationLeave} onAnswer={(id,discard)=>{postToHost({type:'annotationLeaveAnswer',id,discard});setAnnotationLeave(null);dispatch({type:"visibleProgress"});}}/>}
      {writeApproval && <WriteApprovalDialog key={writeApproval.id} prompt={writeApproval} textSize={state.config?.textSize} onAnswer={(id,approved)=>{postToHost({type:'writeApprovalAnswer',id,approved});setWriteApproval(null);dispatch({type:"visibleProgress"});}}/>}
      <TaskWorkspaceFrame view={workspace} messages={messages} busy={!!state.streamId || !!state.verify?.running} error={historySaveError ?? draftSaveError ?? workspaceError} unsavedDraft={!!draftSaveError} unsavedHistory={!!historySaveError} runState={runState} onDismissError={() => setWorkspaceError(null)} onAskAboutFile={askAboutFileAllowed(state.config) ? (path: string) => postToHost({ type: "askAboutFile", path }) : undefined}>
      {/* #1298 — instructor tokens get the extended panel; student tokens get the standard one. */}
      {state.config?.isInstructor ? (
        <InstructorChatPanel
          key={state.config?.activity?.id ?? "disconnected-instructor"}
          incomingImage={incomingImage}
          config={state.config}
          messages={messages}
          trimBoundaryId={trimBoundaryId}
          pageNotice={state.pageNotice}
          aiNotice={state.aiNotice}
          stopNotice={state.stopNotice}
          openWorldId={state.openWorldId}
          publish={state.publish}
          onPublish={() => {
            dispatch({ type: "publishStart" });
            postToHost({ type: "publishToGallery" });
          }}
          streaming={!!state.streamId}
          streamingId={state.timeline.openId}
          runningStreamId={state.streamId}
          progressSince={state.progressSince}
          progressApprovalPending={approvalPending || !!writeApproval || !!outbound || !!browserApproval || !!folderConsent}
          refusal={refusal}
          onDismissRefusal={() => setRefusal(false)}
          error={state.error}
          activityUnavailable={state.error ? state.activityUnavailable : undefined}
          errorRequestId={state.errorRequestId}
          errorRunbookUrl={state.errorRunbookUrl}
          canRetryLast={state.errorRetryable && hasLastUserPrompt && !state.streamId && state.errorRetry}
          onSend={send}
          onRetry={retry}
          onRetryLast={retryLast}
          onDismissError={dismissError}
          onCancel={cancel}
          onClear={() => postToHost({ type: "clearHistory" })}
          onSetToken={() => postToHost({ type: "setToken" })}
          onSettings={() => postToHost({ type: "openSettings" })}
          onRunCode={(html) => postToHost({ type: "runCode", html })}
          onNamingRitual={() => postToHost({ type: "namingRitual" })}
          onSaveCoach={(name, personality) =>
            postToHost({ type: "saveCoach", name, personality })
          }
          onReportProblem={() => postToHost({ type: "openReportModal" })}
          onInstallUpdate={() => postToHost({ type: "installUpdate" })}
          onDismissUpdate={(version) => postToHost({ type: "dismissUpdate", version })}
          // cr-review — a director signed in with an issuer token opens the Weekly Review here.
          verifyPanel={reviewPanel}
        />
      ) : (
      <ChatPanel
        delegationStops={delegationStops}
        onStopDelegations={streamId=>postToHost({type:"stopDelegations",streamId})}
        key={`${state.config?.activity?.id ?? 'disconnected'}:${state.config?.taskWorkspace?.activeTaskId ?? ''}`}
        incomingImage={incomingImage}
        config={state.config}
        messages={messages}
        pageNotice={state.pageNotice}
        elementPreview={state.elementPreview}
        pageAttachment={state.pageAttachment}
        onRemovePageAttachment={() => {
          dispatch({ type: "pageAttachment", attachment: null });
          postToHost({ type: "removePageContext" });
        }}
        fileAttachment={state.fileAttachment}
        fileAttachError={state.fileAttachError}
        fileAttachNotice={state.fileAttachNotice}
        onAttachFile={() => postToHost({ type: "attachWorkspaceFile" })}
        onRemoveFileAttachment={() => {
          dispatch({ type: "fileAttachment", attachment: null });
          postToHost({ type: "removeFileContext" });
        }}
        verifyPanel={carryoverPanel || verifyPanel || publishPanel || evidencePanel || memoryPanel || skillsPanel || reviewPanel ? <>{carryoverPanel}{verifyPanel}{publishPanel}{evidencePanel}{memoryPanel}{skillsPanel}{reviewPanel}</> : null}
        sendLocked={!!state.verify?.running || !!workspace?.error}
        annotationsEnabled={state.annotationsEnabled}
        annotations={state.annotations}
        onAnnotationAction={(action, number, comment) => postToHost({type:'annotationAction', action, number, comment})}
        onRemoveElement={() => {
          dispatch({ type: "elementAttached", element: null });
          postToHost({ type: "removeElementContext" });
        }}
        aiNotice={state.aiNotice}
        stopNotice={state.stopNotice}
        streamFor={state.streamFor}
        openWorldId={state.openWorldId}
        publish={state.publish}
        onPublish={() => {
          // 낙관적으로 uploading 을 먼저 켠다 — 호스트도 같은 값을 보내지만,
          // 그 사이 연타를 막는 것은 이 즉시 반영이다.
          dispatch({ type: "publishStart" });
          postToHost({ type: "publishToGallery" });
        }}
        onPublishSite={() => postToHost({ type: "publishSite" })}
        onSwitchProject={() => postToHost({ type: "switchProject" })}
        streaming={!!state.streamId}
        streamingId={state.timeline.openId}
        runningStreamId={state.streamId}
          progressSince={state.progressSince}
          progressApprovalPending={approvalPending || !!writeApproval || !!outbound || !!browserApproval || !!folderConsent}
        refusal={refusal}
        onDismissRefusal={() => setRefusal(false)}
        error={state.error}
        activityUnavailable={state.error ? state.activityUnavailable : undefined}
          errorRequestId={state.errorRequestId}
        errorRunbookUrl={state.errorRunbookUrl}
        trialEndCard={state.trialEndCard}
        safetyNotice={state.error ? state.safetyNotice : null}
        onTrialEndCardPasses={() => postToHost({ type: "trialEndCardPasses" })}
        canRetryLast={state.errorRetryable && hasLastUserPrompt && !state.streamId && state.errorRetry}
        onSend={send}
        sendPending={sendPending}
        onRetry={retry}
        onRetryLast={retryLast}
        onSelectAttempt={(rootId, attemptId, choose) => {
          if (state.streamId || pendingSend.current) return;
          postToHost({ type: 'selectAnswerAttempt', activityId: state.config?.activity?.id,
            taskId: state.config?.taskWorkspace?.activeTaskId ?? undefined, rootId, attemptId, choose });
        }}
        onEditResend={editResend}
        verdicts={verdicts}
        trimBoundaryId={trimBoundaryId}
        onVerdict={judgeAnswer}
        onAnswerToWiki={(messageId) => postToHost({ type: "answerToWiki", messageId })}
        onDismissError={dismissError}
        onCancel={cancel}
        onClear={() => postToHost({ type: "clearHistory" })}
        onSetToken={() => postToHost({ type: "setToken" })}
        onSettings={() => postToHost({ type: "openSettings" })}
        onRunCode={(html) => postToHost({ type: "runCode", html })}
        onNamingRitual={() => postToHost({ type: "namingRitual" })}
        onSaveCoach={(name, personality) =>
          postToHost({ type: "saveCoach", name, personality })
        }
        onReportProblem={() => postToHost({ type: "openReportModal" })}
        onInstallUpdate={() => postToHost({ type: "installUpdate" })}
        onDismissUpdate={(version) => postToHost({ type: "dismissUpdate", version })}
      />
      )}
      </TaskWorkspaceFrame>
    </ChatErrorBoundary>
  );
}

/**
 * REQ-C7 crash injection. Sits inside the ErrorBoundary tree so a synthetic
 * render-time throw lands in the boundary's componentDidCatch. Production
 * builds never set the flag — it's only triggered by the env-gated
 * HPS_TEST_CRASH_AFTER_MS path on the host side.
 */
function CrashIfFlagged({ crash }: { crash: boolean }) {
  if (crash) {
    throw new Error("hps-test: forced webview crash for REQ-C7 verification");
  }
  return null;
}
