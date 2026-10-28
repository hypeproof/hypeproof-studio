/** REQ-L12 — what the Service reports for a bought pass. `expires_at` is absent until the pass is first connected. */
export interface PassStatus { request_limit: number; requests_used: number; expires_at?: number }
/**
 * TUX-SP-13 / CU-13 — what the Service confirms about a one-hour trial grant (`trial` on /v1/profile).
 * `ends_at` is null until the grant has started. Never sent for a pass, which keeps `pass`.
 */
export interface TrialStatus { state: "not_started" | "active" | "exhausted" | "expired"; ends_at: string | null; request_limit: number; requests_used: number }
import type { StartRequest, StartResponse } from "./startPageProtocol";
// Shared message contract between extension host (Node) and webview (browser).
// Import this file from both sides; do not redefine these types anywhere else.

/**
 * #503 — `"tool"` is a display/persistence-only role. Once the conversation and tool
 * execution became one timeline, a tool line became a `ChatMessage` too. **It never
 * enters the history sent to the model** — `chatTimeline.modelHistory()` filters it
 * out.
 */
export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  /** A receipt measured between observed stream events in this mounted view, never an estimate. */
  elapsedTurn?: { anchorId: string; ms: number; outcome: 'done' | 'stopped' };
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** The user's requested mode for this turn, not proof that a tool ran. */
  toolMode?: import('./turnTools').TurnToolMode;
  /**
   * #503 — filled in only when `role: "tool"`. The display content of a single tool
   * line (`🔧 Write(index.html) ✓`). `id` is the SDK's tool_use id, so the
   * running → done update happens in place.
   */
  tool?: {
    shell?: import("./shellPresentation").ShellPresentation;
    icon: string; label: string; state: "running" | "done" | "error";
    /** REQ-STUDIO-LONG-STEP-HINT — a running tool step in learner words, and when it began (ms). */
    step?: string; since?: number;
  };
  /**
   * #173 — Web search citations attached to an assistant message. Populated
   * by the worker's SSE translator (`hps_citations` delta), accumulated by
   * the chat panel during streaming, persisted with the message.
   */
  citations?: Citation[];
  /**
   * Pasted-image context attached to a user message (website-copyclone
   * curriculum). Each entry is a `data:image/<type>;base64,...` URL produced
   * by the webview's clipboard-paste handler. Carried so the webview can
   * render a thumbnail on the bubble; the model only receives the image on
   * the turn it was pasted (see proxyClient — history is sent text-only, so
   * a screenshot is injected exactly once and never re-sent / persisted).
   */
  images?: string[];
  /**
   * #747 (AE-08) — **the name this turn actually answered under**.
   *
   * Without it: every answer line rendered the one live `coachName` (`hps-msg-role`
   * in `ChatPanel.tsx`). Both child cohorts are `user_names_it`, so when a child
   * renamed the coach mid-lesson, **even what the coach had said BEFORE that was
   * retroactively rewritten as the new name's words.** In a product that claims
   * evidence-based observation, the record was editing itself.
   *
   * The value is defined as **the exact string handed to the runtime when that turn
   * ran**, not "the name currently on screen" — the same value that went out as
   * `coachName` on the SDK path and as `x-hps-coach-name` on the proxy path. When
   * the name changes mid-turn, what the model believed itself to be called while it
   * answered has to survive in the record.
   *
   * Absent → render with the live name; lines written before this change and a
   * bubble still streaming take that path. **It is not backfilled.** It is never
   * attached to a `user` or `tool` line.
   */
  assistantName?: string;
  /**
   * CGP-CHAT-R-002 (REQ-STUDIO-CHAT-EDIT-RESEND) — on a user line only: this line is an edited
   * resend of the prompt whose group root is `editOf` (editResend.ts). Absent = its own root, so a saved
   * conversation written before this field reads as one version per turn.
   */
  editOf?: string;
  /**
   * CGP-ART-R-020 — the successful tool calls of the turn this line closes (taskActivity.ts), carried
   * on the turn's last persisted line. Display only: never part of the model history.
   */
  activity?: import("./taskActivity").TaskActivityFact[];
  retryOf?: string;
  visibleAttemptId?: string;
  chosenAttemptId?: string;
}

/**
 * #173 — Source attached to an assistant message. `tier` (1–4) is computed
 * server-side on the proxy route. SDK typed tool outputs carry no classification,
 * so their sources use tier 4 (unclassified), never inferred domain authority.
 * 1 academic society·edu·gov, 2 paper·DOI, 3 official manufacturer, 4 blog·YouTube·other.
 */
export interface Citation {
  /** Event-owned source kind (web/lesson/file). Missing or future values remain unclassified. */
  kind?: string;
  url: string;
  title: string;
  domain: string;
  tier: 1 | 2 | 3 | 4;
}

export type AssetKey =
  | "taste"
  | "intent_clarity"
  | "context_design"
  | "verification_reflex"
  | "delegation_judgment"
  | "iteration_reflex"
  | "ownership";

export type AssetScores = Record<AssetKey, number>;

export interface AssetScoreChunk {
  type: "asset_score";
  version: 1;
  method: "heuristic-v1";
  scores: AssetScores;
}

export type CourseEffort = 'low' | 'medium' | 'high';
export interface EffortRequestRecord {
  request_id: string; model: string; requested: CourseEffort | null; applied: CourseEffort | null;
  /**
   * `no_receipt` (S4): recorded for its agent attribution alone, with no effort receipt (both levels
   * null). `unknown`: the Service sent a reason this build does not know; observedEffortResult marks
   * that row only (modelSelection.ts).
   */
  reason: 'selected' | 'course_default' | 'unsupported_model' | 'no_receipt' | 'unknown'; status: number; created_at: string;
  /**
   * ADR 0011 (orchestrator spec §4.6, §5.2, §14) — who sent this request, as the Service recorded
   * it: `coach`, a roster helper's name, or `aux` for Claude Code's own background calls. Absent
   * from a Service without the agent ledger, and then the row reads exactly as before.
   */
  agent?: string;
  /** That agent's Korean title, e.g. 검토 도우미. */
  agent_title?: string;
  /** Claude Code's purpose marker: main | subagent | workflow | compaction | auxiliary. */
  request_class?: string;
}
/** CGP-CHAT-R-011 — a work-folder text file queued for the next turn (node-free, shared with the webview). */
export interface FileAttachmentPreview {
  /** Path relative to the work folder, with forward slashes. */
  path: string;
  /** Exactly the file text that goes with the next message. */
  text: string;
  bytes: number;
}

export interface ChatConfig {
  /** Server-provided connected class window; absent when not known for this seat. */
  classWindow?: import("./classWindow").ClassWindow | null;
  /** Persisted consent for this activity and canonical folder; never inferred from UI state. */
  folderRestricted?: boolean;
  /** CGP-AGENT-R-032: opaque seat/lesson disclosure receipt, device-local only. */
  lessonCapabilityEntry?: { id: string; seen: boolean };
  /** CGP-AGENT-R-003: what the AI can do on this seat, one row per REQ-M38 key. */
  aiCapabilities?: import('./aiCapabilities').AiCapability[];
  /** CGP-SHELL-R-024: what the AI can do changed on a profile refresh; one card until dismissed. */
  capabilityChange?: import('./aiCapabilities').CapabilityChange;
  /** CGP-DS-R-009: chat text size chosen on this device. */
  textSize?: import('./textSize').TextSize;
  /** CGP-KNOW-R-032: the saved nickname ("" when none); absent on a seat that does not offer it. */
  learnerNickname?: { value: string };
  /** CGP-DS-R-015: `workbench.reduceMotion`: true = on, false = off, absent = system. */
  reduceMotion?: boolean;
  turnTools?: import('./turnTools').TurnToolsAvailability;
  /** CGP-CHAT-R-011 — this seat may attach a work-folder text file (sdk_tools.read, never instructors). */
  fileAttach?: boolean;
  /** Personal/adult profile with the existing workspace read grant. */
  fileMentions?: boolean;
  /** CGP-KNOW-R-003 — this seat has the activity's 자료 list (the file-attach gate). */
  materials?: boolean;
  taskWorkspace?: import('./taskWorkspaceContract').TaskWorkspaceView;
  /** CGP-KNOW-R-009 — what the task menu may offer for moving; absent where there is no task list. */
  taskMove?: import('./taskMove').TaskMoveView;
  activityUnavailable?: import("./activityAvailability").ActivityUnavailable;
  activity?: {id:string;name:string;kind?:'trial'|'personal'|'classroom';workspace:string;verified:boolean;pass?:PassStatus;trial?:TrialStatus;
    /** Free start (SPEC iteration 4 §2.4) — the seat is the free allowance (`studio-open-trial`, no pass): its copy says 무료 사용, never 체험. */
    free?:boolean};
  activityDraft?: import('./activityDraft').ActivityDraft;
  /** REQ-L12 ⑫ — trial carry-over offer or the read-only trial transcript; absent unless the Service advertises it. */
  carryover?: import('./trialCarryoverHelpers').CarryoverView;
  /** AE-01 (#554) — the learner's own goal for the served lesson revision (read from this device); null without a lesson. */
  studentGoal?: import('./studentGoal').StudentGoalView | null;
  access?: import('./accessClient').AccessState;
  /** CGP-SHELL-R-015: host-confirmed cohort policy, never inferred from a local menu. */
  cohortSettings?: { model: boolean; effort: boolean };
  effort?: { value: CourseEffort; allowed: CourseEffort[] };
  effortNotice?: string;
  effortResult?: { state: 'loading' | 'observed' | 'unknown'; requests: EffortRequestRecord[]; truncated?: boolean };
  proxyUrl: string;
  model: string;
  hasToken: boolean;
  workTakeawayEnabled?: boolean;
  coach: CoachInfo;
  profile: ResolvedProfile | null;
  update?: UpdateOffer | null;             // #72 — auto-update banner state
  /**
   * One-click publish is allowed for this seat (host-computed `sitePublishAllowed`: publishing
   * enabled + per_user_github_pages + not a minor). Sent as a decision rather than mirrored in
   * the webview, so the button and the host gate cannot drift apart.
   */
  sitePublish?: boolean;
  // #1298 — true when the active token verified as an issuer via GET /admin/chalk/whoami.
  // Drives rendering of InstructorChatPanel (header band + unrestricted model select).
  isInstructor?: boolean;
  // #1298 — versioned instructor system prompt text from GET /admin/chalk/instructor-brief.
  // Injected as system prompt for instructor-mode chat turns. Absent = use no extra system prompt.
  instructorBrief?: string;
  // #1298 — human-readable connection label shown in the instructor band.
  // "내 Claude 구독" | "내 Codex 구독" (local runtime) or "서버" (proxy/worker path).
  instructorConnection?: string;
  // #1298 — model choices for the instructor band dropdown. Set from localModelSelection
  // when instructor mode is active; profile is null so cannot use profile.model_selection.
  instructorModelChoices?: Array<{ id: string; alias: string; label: string }>;
}

/**
 * Update offer surfaced in the chat panel via a banner (#72). Host computes
 * + pushes; webview only renders + can ask host to install/dismiss.
 */
export interface UpdateOffer {
  version: string;          // "0.1.2"
  notes: string;            // markdown — webview renders as plain text for now
  releaseUrl: string;
  sizeBytes: number;
  /** CGP-SHELL-R-001: a class seat is active, so the banner offers no install. */
  heldForClass?: boolean;
}

export interface CoachInfo {
  name: string;
  personality: string;
  configured: boolean;        // has the user gone through the naming ritual?
}

/**
 * The UX-relevant subset of a server profile, fetched via GET /v1/profile and
 * cached client-side. Stays in sync with Worker's UxConfig type — keep both
 * sides updated together.
 */
/** Kept in this file (not in lessonBinding.ts) because the webview build type-checks protocol.ts and must not follow Node-side imports. */
/**
 * TUX-COND-07 — what the inline end-of-trial card shows. Built by the host (`trialEndCard.ts`)
 * from the Service catalogue; the webview only renders it. No price or count is ever made up here.
 */
export interface TrialEndCardView {
  ending: "exhausted" | "expired";
  title: string;
  facts: string[];
  /** The one Primary. Pressing it is the only way the purchase view opens (REQ-L12 ①). */
  primary: string;
  /** The escape: closes the card. The host only counts the press (offer_dismissed end_card, CONV-FUNNEL-R-003). */
  escape: string;
  /** The catalogue pass whose facts are shown. Absent on the minimal card (CONV-ENDCARD-R-005): no catalogue was read. */
  productId?: string;
  /** Title and facts as one line, for the banner fallback and screen readers. */
  text: string;
  /**
   * Optional "이메일로 소식 받기" section below the pass offer (TUX-COND-08). Present only on a free
   * seat whose `/v1/profile` advertises `notify_optin` (Service HPS_FREE_NOTIFY_OPTIN, default off).
   * Secondary and skippable: it never replaces the Primary and nothing is pre-checked.
   */
  notify?: TrialEndNotifyView;
}

/** TUX-COND-08 — the end card's optional email section. Copy comes from the host (trialEndCard.ts). */
export interface TrialEndNotifyView {
  /** The Service's consent version; the host sends it back with the address. */
  consentVersion: string;
  /** This seat already left an address (a local flag; the address itself is never stored). */
  submitted: boolean;
  prompt: string;
  label: string;
  placeholder: string;
  button: string;
  consent: string;
  done: string;
  withdraw: string;
  withdrawn: string;
}
export interface LessonBindingView { key: string; seq: number; source: "token" | "setting" | "base"; object_id: string | null; revision: number | null; enforced: boolean; not_applied?: string }
export interface ResolvedProfile {
  /** #751 U3 — which lesson binding the Service executes this seat under. Present only where bindings are enforced. The app sends `key` back as its expectation; it never selects a lesson with it. */
  lesson_binding?: LessonBindingView;
  /** #751 G2 — present when this code is an instructor's learner-condition rehearsal of `version`. Data only: grants nothing. */
  rehearsal?: { id: string; course_id: string; version: string; expires_at: number; judged: boolean };
  /** Server-verified identity; never an execution grant. */
  activity_id?: string;
  /** Presentation only; derived from authenticated Service access, never grants authority. */
  activity_kind?: "trial" | "personal" | "classroom";
  /** REQ-L12 — present for a bought pass (a native-trial grant with a longer window). Presentation only. */
  pass?: PassStatus;
  /** TUX-SP-13 — present for a one-hour trial grant (never with `pass`). Presentation only; absent on an older Service. */
  trial?: TrialStatus;
  /** TUX-COND-08 — a free seat may leave an email on its end card (Service HPS_FREE_NOTIFY_OPTIN, default off). Absent → no section. */
  notify_optin?: { available: boolean; consent_version: string };
  /** REQ-CGP-LEARN-13 (DEC-LEARN-13a) — the Service turns the 109/1388 help lines on for this seat. Only `true` counts; absent → off. */
  safety_help_lines?: boolean;
  /**
   * REQ-L12 ⑫ exception (ot-conversation-carryover) — the Service offers "체험에서 하던 대화 이어가기"
   * on this pass (Service flag, default off). Absent → the pass starts a new conversation, as before.
   */
  conversation_carryover?: { available: boolean };
  access_identity?:{kind:'account';scope:string};
  model_selection?: {
    revision: 'hps-model-selection/1'; runtime: 'proxy' | 'agent-sdk'; provider: string;
    default: string; source: 'profile' | 'lesson';
    // `provider` arrives **only for a cross-provider cohort**
    // (`worker/src/lib/lesson-model-policy.ts:57` — it is added only when
    // `crossProviderEnabled(profile)`). Outside that, the one top-level `provider`
    // field describes the whole seat, so it is not duplicated per choice.
    //
    // Nothing broke while this field was missing — the webview renders only
    // `alias`/`label`. The problem is that **someone reading the type concludes "the
    // server does not send provider"**, and then the next change that wants to show
    // the provider on a choice cannot see the value already arriving and goes off to
    // fix the server first. What the server sends belongs in the type.
    choices: Array<{
      alias: string; id: string; label: string;
      provider?: string;
      effort?: {default: CourseEffort; allowed: CourseEffort[]};
    }>;
  };
  /**
   * `assess` is the cohort's opt-in to sending a batch off the device, and it is
   * also what decides whether the observation RESULTS panel is drawn during work
   * (SX-59). Absent means no — an older worker that does not serve the field must
   * not be read as permission.
   */
  observation?: { format: string; scope?: string; assess?: boolean };
  /** Immutable teaching content; capability policy remains in the profile. */
  lesson?: {
    course_id: string; version: string; sha256: string;
    content: {
      schema: 'hps-session-design/1'; title: string; audience: string;
      duration_minutes: number; objective: string; prerequisites: string; starter: string;
      /**
       * `help` (#1008) and `ui`/`evidence`/`gate` (SX-56) are **optional keys**, and
       * the Service really does send them (`worker/test/lesson-help-mode.test.mjs`
       * and `worker/test/session-design-learning.test.mjs` confirm it on the
       * `/v1/profile` response). When the type hides what the server sends, the next
       * change cannot see the value already arriving and goes off to fix the server
       * first — which is what happened with `model_selection.provider`.
       */
      steps: Array<{
        id: string; title: string; instructions: string; hint: string; acceptance: string;
        help?: { default: string; allowed: string[] };
        ui?: string; evidence?: string; gate?: string;
      }>;
      /**
       * SX-55~58 — week, mission, completion conditions, observation items, forbidden
       * list. The 6-week curriculum is six data files filling this slot. Definition
       * and validation: `worker/src/lib/learning-design.ts`.
       *
       * `observe` is **kept out of** this type. It is not for the student's screen to
       * read (design §세션 설계 파일: "not shown to the student"), and if it is in the
       * type someone will render it.
       */
      learning?: {
        week: number;
        mission: string;
        completion?: Array<{ id: string; text: string; event: string }>;
        never?: string[];
        evidence_types?: string[];
        source_kinds?: string[];
        reflection?: { changed_mind: boolean; next_experiment: boolean };
      };
      /**
       * #747 — optional lesson-level AI display name. Informational here: the
       * Service already projects it onto `ux.coach` (fixed + fallback_name),
       * which is what the header, message labels and start page render.
       */
      assistant?: { display_name: string };
    };
  };
  profile_id: string;
  display_name: string;
  language: "ko" | "en";
  series_index: number;
  series_total: number;
  assets_focus?: string[];
  welcome: {
    greeting_md: string;
    example_prompts: string[];
  };
  ux: UxConfig;
  /**
   * `default_repo_name` and `custom_domain` belong to the one-click GitHub Pages publish
   * (`strategy: "per_user_github_pages"`, src/publish/). Both are optional because a Service
   * older than that feature omits them: a missing repo name falls back to `dental-homepage`
   * and a missing `custom_domain` hides nothing (the coach may still pass a domain; this flag
   * only says whether the cohort's skill offers it).
   */
  publishing: { enabled: boolean; strategy: string; default_repo_name?: string; custom_domain?: boolean };
  preview: { type: "iframe" | "live_server"; auto_start: boolean };
  // #422 — the cohort's on-disk workspace folder (e.g. "~/HypeProofClinic" for
  // the dental website cohort, "~/HypeProofGames" for kids). The extension opens
  // this folder on onboarding. Absent → the legacy default folder is used.
  workspace_root?: string | null;
  workspace_start?: 'empty' | 'html';
  /** Service-owned image editing capability; absent means unavailable. */
  image_edit?: { enabled: true };
  /** Optional input capabilities (default off). #278 / website-copyclone. */
  input?: {
    page_context?: boolean;
    image_paste?: boolean;
    /** Photos attached as files saved to `images/`, paths only to the model (attachedImages.ts). hype-dental D-028. */
    image_files?: boolean;
  };
  /** Classroom-operation panels per cohort (classroomPanels.ts); absent → shown. hype-dental D-025. */
  classroom_panels?: import("./classroomPanels").ClassroomPanelsSetting;
  /** How much tool work the timeline draws (toolActivity.ts); absent → "detailed". hype-dental D-027. */
  tool_activity?: import("./toolActivity").ToolActivityMode;
  /** #278 Phase 3 — coach's client-driven browser control loop (default off). */
  browser_control?: { enabled: boolean; max_iterations?: number };
  /** CR-02 — Curriculum Runtime switch (`curriculum_runtime.enabled`), off when absent. */
  curriculum_runtime?: { enabled: boolean };
  /**
   * Learning wiki and deck generator (App-side generic skills), off when absent. `plan` is the
   * cohort's specialization: folder, audience, session label, deck template and per-session focus.
   */
  learning_wiki?: { enabled: boolean; plan?: LearningWikiPlan };
  /**
   * #306 — hardened native-browser session for minor cohorts. `mode: "safe"`
   * makes the host enable the locked-down `persist:hp-safe` integrated-browser
   * session (via the hypeproof.browser.safeSession setting). Absent / "browse"
   * → normal browser. Inert on a Studio build without the fork core patch.
   */
  browser_session?: { mode: "safe" | "browse"; allowlist?: string[] };
  // #320 — true when the cohort is a minor cohort (explicit flag or age_range
  // upper bound < 18). Drives minor-specific UX and force-pins the coach to the
  // proxy runtime (#371).
  minor_cohort?: boolean;
  // Drives chat-panel tone (game vs search-webapp UI copy) (#159).
  game?: { template_tier: string };
  /** kids-quest — the list of pre-built worlds (GET /v1/worlds/:id returns the HTML). */
  worlds?: Array<{ id: string; guest: string; emoji: string; chip: string; aliases: string[]; line?: string }>;
  // #282 — provider-hosted tools the cohort profile opted into (sourced from the
  // worker, not inferred client-side). Drives which Agent SDK tools the coach may
  // use. Absent/false → the coach is chat-only for that capability.
  tools?: { web_search?: boolean };
  // #282 Phase 2 — Agent SDK workspace tools, owned by the worker profile
  // (ADR 0003). read → Read/Grep/Glob, write → Write/Edit. Absent/false →
  // chat-only (fail closed). No shell/exec flag exists in the schema; minors'
  // cohorts never carry write:true (harness child_sdk_write FAIL + client-side
  // strip for minor tiers).
  // `browser` (#282 P2 slice 2) grants the in-process "hypeproof" MCP browser
  // tools (browser_open / browser_screenshot / live_preview_start). Adults
  // only — minors never carry browser:true (harness child_sdk_browser FAIL +
  // client-side strip), per the #306/#318 safety posture.
  // `subagents` (#282 P2 slice 3) grants the read-only 코드리뷰어/리서처 SDK
  // subagents (delegation modal-gated; definition tools intersected with the
  // cohort's permitted set). Adults only — minors never carry subagents:true
  // (harness child_sdk_subagents FAIL + client-side strip).
  // `shell` (epic #431) grants the SDK Bash tool. Arbitrary commands are
  // allowed by design — the approval modal is the gate, same as Claude Code.
  sdk_tools?: {
    read?: boolean;
    write?: boolean;
    browser?: boolean;
    subagents?: boolean;
    shell?: boolean;
  };
  // #371 — coach runtime the worker resolved for this cohort. "agent-sdk" only
  // for an adult, sdk_tools-opted-in cohort (worker force-pins minors to
  // "proxy"). Absent → proxy. The client ORs this with the machine-scoped
  // setting; either can select agent-sdk, and canUseTool still gates tools.
  coach_runtime?: "proxy" | "agent-sdk";
  /** #596 — session-log upload opt-in. The client uses it only to decide UI exposure (the server enforces). */
  analytics?: { upload_session_logs?: boolean };
  /**
   * ADR 0011 (orchestrator spec §2.2, §14) — the front-line orchestrator's roster. Served only
   * to an app that sent `x-hps-orchestrator` (proxyClient), and only to an adult agent-sdk seat
   * outside a frozen lesson whose cohort has it on; `{ enabled: false, reason }` when one of
   * those fails, and absent from an older Service or without the header. Never to a minor.
   * Wire data, unvalidated: agentRoster.ts parses it (fail closed) before anything reads it,
   * and a value it refuses is no roster.
   */
  orchestrator?: ServedOrchestratorWire | { enabled: false; reason: string };
}

/**
 * The served `hps-agent-roster/1` roster as it arrives (spec §2.2). Prompts and output contracts
 * stay in the Service: the app gets labels, caps and the context it may attach. Structural only,
 * so the webview build never follows a Node-side import from here.
 */
export interface ServedOrchestratorWire {
  format: string;
  id: string;
  version: string;
  digest?: string;
  /** Korean; rendered into the consult tool description. */
  coach_brief?: string;
  checks?: string[];
  agents: Array<{
    name: string;
    /** Korean product copy shown to the learner, e.g. 검토 도우미. */
    title?: string;
    role: string;
    purpose?: string;
    trigger?: string;
    context?: string[];
    caps?: { per_turn: number; per_session: number };
    enabled?: boolean;
    model?: { id: string; label: string };
  }>;
}

export interface UxConfig {
  coach: {
    naming_mode: "user_names_it" | "fixed" | "pick_from_list";
    fallback_name: string;
    naming_prompt_md: string;
    personality_prompt_md: string;
    revisit_on_entry?: boolean;
  };
  suggestions: {
    initial: SuggestionChip[];
    follow_up: SuggestionChip[];
  };
  hints: {
    short_input: { enabled: boolean; min_chars: number; message_md: string };
    roll_input_button: { enabled: boolean; label: string; probe_md: string };
  };
  retry_button: {
    enabled: boolean;
    show_counter: boolean;
    counter_toast_md?: string;
  };
}

export interface SuggestionChip {
  text: string;
  style: "good" | "weak";
  caption?: string;
}

// Webview → Host
export type WebviewMessage = (
  | {type:'browserApprovalAnswer';id:string;choice:import('./browserApprovalPrompt').BrowserApprovalChoice}
  | {type:'commandApprovalAnswer';id:string;choice:import('./commandApprovalPrompt').CommandApprovalChoice}
  | {type:'annotationLeaveAnswer';id:string;discard:boolean}
  | { type: "stopRunningProcess"; id: string }
  | {type:'writeApprovalAnswer';id:string;approved:boolean}
  /** CGP-ART-D-021: open the file now beside the text after the call; never an answer. */
  | {type:'writeApprovalDiff';id:string;index:number}
  | {type:'folderConsentAnswer';id:string;level:import('./folderConsent').FolderConsentLevel|null}
  | {type:'outboundAnswer';id:string;selected:string[]|null}
  | { type: 'taskCreate' }
  | { type: 'taskRecoverDraft' }
  | { type: 'taskSelect'; id: string }
  | { type: 'taskRename'; title: string; requestId?: string }
  /** CGP-CHAT-R-029 — 되돌리기 on the rename toast: the host puts back the rename it kept under this id. */
  | { type: 'taskRenameUndo'; undoId: string }
  /** CGP-CHAT-R-025 — 보관하기 (the open task) and 보관함's 다시 열기 (an archived task). */
  | { type: 'taskArchive' }
  | { type: 'taskRestore'; id: string }
  /** CGP-KNOW-R-008 — ids from TASK_EMOJI / TASK_COLOURS, or null to clear. Validated again on the host. */
  | { type: 'taskAppearance'; appearance: import('./taskAppearance').TaskAppearance | null; requestId: string }
  /** CGP-KNOW-R-009 — move task `id` to the personal activity `destination` (an activity ref the host re-checks). */
  | { type: 'taskMove'; id: string; destination: string; requestId?: string }
  | { type: 'taskSourceSelection'; selection: import('./taskWorkspaceContract').TaskSurfaceSelection }
  | { type: 'taskOpenSource'; url: string; requestId?: string }
  | { type: 'taskReturnFromSource'; requestId: string; url: string }
  /** CGP-CHAT-R-026 — search this activity's own tasks on this device. */
  | { type: 'taskSearch'; query: string; requestId: string }
  | {type:'saveActivityDraft';activityId:string;draft:import('./activityDraft').ActivityDraft;nonce?:string;imagePreparationFailed?:boolean}
  /** REQ-STUDIO-QUIT-GUARD — whether this chat surface holds a queued, unsent message. */
  | { type: 'queueState'; queued: boolean }
  /**
   * #897 (VO-01) — the **raw observation** from the voice capability probe. It
   * carries no verdict: the webview measures, the host's voiceCapabilityHelpers
   * judges. Observing and judging in the same place mixes up "could not measure"
   * with "measured, and it is blocked".
   */
  | { type: 'voiceCapabilityProbeResult'; probeId: string;
      observations: import('./voiceCapabilityHelpers').VoiceProbeObservations }
  | {type:'workTakeaway'}
  /** CGP-SHELL-R-028 — 내 작업 내보내기 from the settings dialog. */
  | {type:'exportMyWork'}
  | {type:'activityLocalFile'; action:'open'|'export'}
  | {type:'refreshAccess'}
  | {type:'selectFunding';id:string}
  /** REQ-L12 ⑫ — the learner's explicit answer to the trial carry-over offer. */
  | {type:'carryoverDecision';decision:'confirm'|'decline'}
  | {type:'requestBudget';note:string}
  | { type: 'observationOpen' }
  /**
   * SX-45 rule 2 — a learning event is made **only by a webview form submission**.
   * The host calls `learningEventRequest(..., {sender:"webview-form"})` only where it
   * receives this message, and never from a coach stream callback. The webview does
   * not send `actor` or `context` — and if it does, the host throws them away.
   */
  | { type: 'learningEvent'; draft: { kind: string } & Record<string, unknown>; stepId?: string }
  /** The open state of drawer D. A view state, so the webview owns it and the host only records it. */
  | { type: 'learningDrawer'; open: boolean }
  /**
   * SX-14 — "완료" was pressed. **The webview's disabled state is not evidence**:
   * the host re-judges the gate with `acceptSubmit()` and refuses when it does not
   * pass. The requirement document's negative condition ("sending a completion by
   * keyboard or by calling the API directly is still refused") means exactly this
   * re-judgment.
   */
  | { type: 'submitTask'; task: string }
  | { type: 'observationCancel' }
  | { type: 'observationAssess'; scope: string; eventIds: string[] }
  | { type: 'observationCorrect'; scope: string; text: string }
  | StartRequest
  | { type: "ready" }
  // CR-09 — the student removes the picked element before sending (CR switch only).
  | { type: "annotationAction"; action: "element" | "rectangle" | "remove" | "comment"; number?: number; comment?: string }
  | { type: "removeElementContext" }
  /** CGP-ART-R-006 — preview one offered style value on the picked element (null = reset that property). */
  | { type: "styleTweakSet"; id: string; prop: string; value: string | null }
  /** CGP-ART-R-007 — the learner removed the attached page; nothing from the page is sent. */
  | { type: "removePageContext"; undoId?: string }
  /** CGP-CHAT-R-029 — 되돌리기: the host restores the page/file snapshot it kept under this id, or nothing. */
  | { type: "restorePageContext"; undoId: string }
  | { type: "restoreFileContext"; undoId: string }
  /** CGP-CHAT-R-011 — open the work-folder file picker (host re-checks the gate). */
  | { type: "retryAttachment"; id: string }
  | { type: "repickAttachment"; id: string; name: string }
  | { type: "discardAttachmentFailure"; id: string }
  | { type: "attachWorkspaceFile" }
  | { type: "fileMentionSearch"; requestId: string; query: string }
  | { type: "fileMentionPick"; requestId: string; path: string }
  | { type: "fileMentionCancel"; requestId: string }
  /** CGP-KNOW-R-015 — "이 파일에 대해 묻기" from the 작업 자료 list: attach this work-folder path (relative) through the same checks, then focus the composer. */
  | { type: "askAboutFile"; path: string }
  /** CGP-VOICE-R-009 — voice "보여주기": ask for the two-item menu, then attach one chosen target per click. */
  | { type: "voiceShowThisMenu"; requestId: string }
  | { type: "voiceShowThis"; requestId: string; target: string }
  /** CGP-CHAT-R-011 — the learner removed the attached file; nothing from it is sent. */
  | { type: "removeFileContext"; undoId?: string }
  /** CGP-KNOW-R-003 — the activity's 자료 list: read it, add a file (host picker) or an https address, select an item for the next message, take a learner item off the list. `scope` is the list the press was made on. */
  | { type: "materialsRequest" }
  | { type: "materialAddFile"; requestId: string }
  | { type: "materialAddUrl"; requestId: string; url: string }
  | { type: "materialAddDrop"; requestId: string; name: string; size: number; base64: string }
  | { type: "materialSelect"; requestId: string; scope: string; id: string; selected: boolean }
  | { type: "materialRemove"; requestId: string; scope: string; id: string }
  // cr-verify — "Test my product" (CR-12–CR-16; CR switch only, re-checked by the host).
  | { type: "verifyOpen" }
  // `requestId`: the panel that asked; only it sends the resulting `sendText` (two chat views receive every post).
  | { type: "verifyStart"; requestId: string; criteria: Array<{ text: string; proposed_by: "student" | "ai"; confirmed: boolean; adopted_from?: string }> }
  | { type: "verifyRetest" }
  | { type: "verifyFix"; requestId: string; criterionId: string; text: string }
  /** CGP-SHELL-R-011 N1 — the handed-back turn could not be sent (offline): keep it off other turns. */
  | { type: "verifyPark" }
  /** The learner pressed the same button again: hand the parked turn back once, unrecorded. */
  | { type: "verifyResume"; requestId: string }
  // cr-publish — "Publish for user test" (CR-17–CR-22, CR-39, CR-73; CR switch only, re-checked by the host).
  | { type: "publishOpen"; manifest?: string[] }
  | { type: "publishRefresh" }
  | { type: "publishClose" }
  | { type: "publishCopy"; versionId: string }
  | { type: "publishSubmit"; form: import("./publishView").PublishForm }
  | { type: "publishLink"; experimentId: string; channel?: string; expiresInDays?: number }
  | { type: "publishRevoke"; linkId: string }
  // cr-evidence — the experiment evidence panel (CR-24–CR-27, CR-69; CR switch only, re-checked by the host).
  | { type: "evidenceOpen"; experimentId?: string }
  | { type: "evidenceNote"; experimentId: string; note: import("./evidenceView").NoteForm }
  | { type: "evidenceDraft"; experimentId: string }
  | { type: "evidenceReview"; experimentId: string; draftId: string; revision: number; actions: Array<{ item: string; action: "accept" | "edit" | "reject"; text?: string }> }
  | { type: "evidenceDelete"; experimentId: string; sessionId?: string }
  // cr-memory — the Venture Memory panel (CR-35–CR-38, CR-77; CR switch only, re-checked by the host).
  | { type: "memoryOpen" }
  | { type: "memoryDiff"; from: string; to: string }
  | { type: "memoryDecision"; form: import("./memoryView").DecisionForm }
  // cr-skills — the curriculum skills panel (CR-43–CR-47; CR switch only, re-checked by the host).
  | { type: "skillsOpen" }
  | { type: "skillRun"; skill: string; form: import("./skillView").SkillForm }
  // cr-review — the Weekly Review panel (CR-48–CR-53). The student's two messages are behind the CR
  // switch; the director's two behind the switch as the Service answers the issuer token. Both re-checked by the host.
  | { type: "reviewOpen"; week?: number }
  | { type: "reviewPrepare"; week?: number }
  | { type: "reviewDirectorOpen"; projectId?: string | null; week?: number }
  | { type: "reviewDecision"; projectId: string; week: number; revision: number; form: import("./reviewView").DirectorDecisionForm }
  | { type: "selectModel"; alias: string }
  // #1298 — instructor-only: free-form model id that bypasses the profile's choices list.
  | { type: "selectModelDirect"; modelId: string }
  | { type: "selectEffort"; value: CourseEffort }
  | { type: "refreshEffort" }
  | { type: "sendMessage"; activityId?:string; text: string; history: ChatMessage[]; images?: string[]; /** #751 U3 — instructor prompts imported into the draft this message was sent from (bodiless). */ imports?: Array<{ object_id: string; revision: number; hash16: string }>;
      /** D-028 — stage ids of photos attached as files; the host moves them into images/ on send. */
      attachments?: string[]; toolMode?: import('./turnTools').TurnToolMode; userMessageId?: string;
      /** CGP-CHAT-R-002 — this send is an edited resend of the latest prompt group (its root user-message id). */
      editOf?: string }
  /** D-028 — a photo dropped or pasted into the chat, kept in the host's staging folder until sent. */
  | { type: "prepareAttachments"; requestId: string; sketch?: boolean; files: Array<{ id: string; stageId?: string; dataUrl?: string }> }
  | { type: "stageImage"; stageId: string; name: string; mime: string; base64: string }
  /** D-028 — the participant removed a staged photo before sending; the host deletes it. */
  | { type: "discardStagedImage"; stageId: string }
  | { type: "selectAnswerAttempt"; activityId?: string; taskId?: string; rootId: string; attemptId: string; choose: boolean }
  | { type: "retryMessage"; activityId?:string; prompt: string; history: ChatMessage[]; images?: string[]; toolMode?: import('./turnTools').TurnToolMode; sourceMessageId?: string; userMessageId?: string }
  | { type: "cancelStream"; streamId: string }
  | { type: "stopDelegations"; streamId: string }
  /** CGP-SHELL-R-023 — local first-result education; no verdict or telemetry. */
  | { type: "accuracyEducationRequest"; requestId: string }
  | { type: "accuracyEducationDismiss"; messageId: string }
  /** CGP-SHELL-R-035 — "새로운 기능" after an update; local record only, no telemetry. */
  | { type: "whatsNewRequest"; requestId: string }
  | { type: "whatsNewShown"; notesId: string }
  | { type: "whatsNewDismiss"; notesId: string }
  /**
   * CGP-CHAT-R-005 (REQ-STUDIO-ANSWER-VERDICT) — the learner's verdict on one finished answer in a
   * personal task; `verdict: null` removes it. Stored locally and recorded in the spool (DEC-09).
   */
  | { type: "answerVerdict"; requestId?: string; messageId: string; verdict: import('./answerVerdict').AnswerVerdict | null; reason?: import('./answerVerdict').VerdictReason; note?: string }
  /** CGP-KNOW-R-004 — "팀 브레인에 정리하기" on one finished answer; the host builds, confirms and writes. */
  | { type: "answerToWiki"; messageId: string }
  | { type: "requestAction"; action: ActionRequest }
  | { type: "openSettings" }
  /** CGP-DS-R-009 — the learner picked a chat text size; the host stores it for this device. */
  | { type: "setTextSize"; size: string }
  /** CGP-KNOW-R-032 — the learner saved (or cleared, with "") the nickname the AI calls them by. */
  | { type: "setLearnerNickname"; nickname: string }
  | { type: "setToken" }
  | { type: "openReportModal" }            // #64: user clicked 🚨 on error banner
  /** TUX-COND-07 — the person pressed "이용권 살펴보기" on the end-of-trial card. Nothing else opens the purchase view. */
  // CONV-FUNNEL-R-006 — `header_menu` when the press came from the chat header link; absent = the end card.
  | { type: "trialEndCardPasses"; surface?: "header_menu" }
  /** CONV-FUNNEL-R-003 — the person pressed the end card's escape (오늘은 여기까지); the webview closes the card. */
  | { type: "trialEndCardDismiss" }
  | { type: "trialEndCardClaude"; draft: string }
  /** TUX-COND-08 — the optional email on the end card. The address goes to the host and on to the Service only. */
  | { type: "notifyOptinSubmit"; email: string }
  | { type: "notifyOptinWithdraw" }
  | { type: "installUpdate" }              // #72: user clicked "Install Now" on update banner
  | { type: "dismissUpdate"; version: string }  // #72: user clicked "Later" — silence for 7d
  /** CGP-SHELL-R-024 — the learner closed the "AI가 할 수 있는 일이 바뀌었어요" card. */
  | { type: "acknowledgeLessonCapabilities"; id: string }
  | { type: "dismissClassWindow"; id: string }
  | { type: "dismissCapabilityChange"; id: string }
  | { type: "clearHistory" }
  | { type: "namingRitual" }
  | { type: "saveCoach"; name: string; personality: string }
  | { type: "runCode"; html: string }       // from chat panel → host → preview
  | { type: "previewReady" }                // from preview webview only
  | { type: "openExternal"; url: string }   // #173 — citation chip click → host opens browser
  /**
   * "갤러리에 올리기" — sends the world currently open to the lab gallery.
   *
   * The webview **carries nothing with it.** Which world it is and whose it is are
   * both known to the host (the open world id + the token in secret storage + the
   * index.html in the work folder). The webview NOT holding the HTML is the contract
   * here rather than an oversight — what goes up must be **what is saved on disk**,
   * not what is on screen.
   */
  | { type: "publishToGallery" }
  // One-click publish (src/publish/): the chat header button. The host re-checks the gate.
  | { type: "publishSite" }
  | { type: "switchProject" }
  // Trace signals (#9). Webview fires; host forwards via POST /v1/trace/event.
  // The host-side HTTP forwarding lands in a follow-up — keep these in sync
  // with worker/src/routes/trace.ts TraceEvent union.
  // #751 F4 — explicit learner step action in the lesson panel (never inferred from chat volume).
  | { type: "lessonStep"; stepId: string; status: "in_progress" | "submitted" }
  // #751 G2 — the step on screen and the help mode the learner picked for the NEXT turn; the host re-checks both against the lesson.
  | { type: "lessonFocus"; stepId: string; helpMode: string | null }
  // #751 G2 — a work-surface save (criterion_form → criterion, decision_form → decision) for one step of the current lesson.
  | { type: "lessonWork"; stepId: string; kind: "criterion" | "decision"; text: string; reason?: string }
  // #751 G2 — rehearsal only: what the panel DREW for each step, read back from the rendered DOM. The host adds App identity and sends it.
  | { type: "rehearsalSend"; steps: import("./lessonFocus").RenderedStep[]; mission?: import("./lessonFocus").RenderedMission }
  // AE-01 (#554) — the learner saves their own goal and completion criteria for the lesson revision `lesson` (sha256),
  // starting from revision `base`; `requestId` is the sending view's id for the save. Only these fields are read; the
  // lesson's own criteria are never part of it.
  | ({ type: "goalSave" } & import("./studentGoal").GoalSaveRequest)
  // #751 U2 — the inbox of instructor notices/materials. `generation` is the connection the card list was drawn under: the
  // host answers a callback from an older one with nothing. Opening a card is kept on this device; it is not reported.
  | { type: "inboxRequest" }
  // AE-15 / CGP-ART-R-002 — the learner's decision on the last turn's review bar; `turnId` must name the bar the host holds.
  | { type: "turnReviewRequest" }
  /** REQ-STUDIO-MISSING-TASK-FOLDER — ask for the notice state; 다시 고르기. */
  | { type: "missingTaskFolderRequest" }
  /** REQ-KNOW-35 (CGP-KNOW-R-019) — ask the host to measure free space on the work folder's volume now; `mount` = the panel has no state yet, so the host re-sends even an unchanged one. */
  | { type: "lowDiskRequest"; mount?: boolean }
  /** CGP-AGENT-D-026 (REQ-STUDIO-PERF-TRACE) — ask whether a 느려요 기록 is running; stop the one recording `id` names (the pill's own id). */
  | { type: "perfTraceStateRequest" }
  | { type: "perfTraceStop"; id: string }
  | { type: "missingTaskFolderRepick" }
  /** REQ-STUDIO-PREVIEW-RECOVERY — ask for the preview's measured state; run the one action its cause line names. */
  | { type: "previewRecoveryRequest" }
  | { type: "previewRecoveryAction"; action: string }
  | { type: "turnRevert"; turnId: string; path?: string }
  | { type: "turnKeep"; turnId: string }
  | { type: "turnReviewClose"; turnId: string }
  /** CGP-AGENT-R-027 — save the work folder as a checkpoint with the message the learner reviewed. Never pushed. */
  | { type: "checkpointSave"; turnId: string; message: string }
  // REQ-STUDIO-ARTIFACT-PROVENANCE — the 작업 자료 panel asks for the work folder's provenance list.
  // CGP-KNOW-D-013 — the 내 작품 panel's trash: list, and one press (move a file, restore or purge an item) bound to the listed scope.
  | { type: "activityTrashRequest" }
  | { type: "activityTrashAction"; requestId: string; scope: string; action: import("./activityTrashView").ActivityTrashAction; target: string }
  | { type: "activityMemoryRequest" }
  | { type: "activityMemoryAction"; requestId: string; scope: string; action: import("./activityMemoryView").ActivityMemoryAction; name: string }
  | { type: "artifactProvenanceRequest" }
  // CGP-KNOW-D-011 — the 내 작품 drawer asks for one listed image's thumbnail when its row scrolls into view.
  | { type: "artifactThumbnailRequest"; requestId: string; path: string }
  /** CGP-KNOW-D-016 — the info popover of one listed work-folder file; answered once per request id. */
  | { type: "artifactInfoRequest"; requestId: string; path: string }
  // REQ-STUDIO-PAGE-CARD — a press on a page card row; the host acts only on a row of a card it issued, inside the work folder.
  | { type: "pageCardsRequest" }
  | { type: "pageCardOpen"; turnId: string; path: string }
  | { type: "pageCardReveal"; turnId: string; path: string }
  // CGP-KNOW-D-021 — 열기 / 폴더에서 보기 on a stored "다운로드 완료" line of the open task; the host re-checks the file.
  | { type: "downloadLineAction"; id: string; action: "open" | "reveal" }
  | { type: "inboxOpen"; objectId: string; generation: number }
  | { type: "inboxLink"; objectId: string; url: string; generation: number; action: "open" | "copy" }
  // #751 native help — every message names the learner-in-class key the view was drawn under; the host ignores a mismatch.
  | { type: "helpRequest" }
  // #751 U1b — the learner opens the approval question for the current index.html (the host asks; nothing is approved or sent by this message).
  | { type: "artifactApprove" }
  | { type: "helpDraft"; key: string; draft: { question: string; turnId: string | null; duration: number } }
  | { type: "helpPreview"; key: string; draft: { question: string; turnId: string | null; duration: number } }
  | { type: "helpCancel"; key: string; requestId: string }
  | { type: "helpSend"; key: string; requestId: string; consent: boolean }
  | { type: "helpRetry"; key: string }
  | { type: "helpDiscard"; key: string; requestId: string }
  | { type: "helpConfirm"; key: string; id: string; revision: number }
  | { type: "helpWithdraw"; key: string; id: string }
  | { type: "traceTrialStart"; taskLabel?: string }
  | { type: "traceTrialEnd"; trialId: string }
  | {
      type: "traceValidationRun";
      trialId: string;
      turnId?: string;
      outcome: "pass" | "fail" | "partial" | "error";
      errorsFound?: number;
      errorsFixed?: number;
    }
  | {
      type: "traceHumanAction";
      trialId: string;
      turnId?: string;
      kind: "accept" | "reject" | "edit" | "replace";
      diffChars?: number;
    }
  // S-04 (#48): React render-time crash caught by ChatErrorBoundary. Host
  // logs to output channel so post-incident reconstruction has a trail.
  | {
      type: "webviewError";
      /** Opaque response-row identity; the host can correlate current rows to their stream. */
      messageId?: string;
      message: string;
      stack: string;
      componentStack: string;
    }) & {activityId?:string; taskId?:string};

// Host → Webview
export type HostMessage = (
  | {type:'browserApprovalPrompt';prompt:import('./browserApprovalPrompt').BrowserApprovalPrompt|null}
  | {type:'commandApprovalPrompt';prompt:import('./commandApprovalPrompt').CommandApprovalPrompt|null}
  | {type:'annotationLeavePrompt';prompt:import('./annotationLeavePrompt').AnnotationLeavePrompt|null}
  | { type: "runningProcesses"; entries: import("./runningProcesses").RunningProcess[] }
  | {type:'writeApprovalPrompt';prompt:import('./writeApprovalPrompt').WriteApprovalPrompt|null}
  | {type:'folderConsentPrompt';prompt:import('./folderConsentPrompt').FolderConsentPrompt|null}
  | {type:'outboundPrompt';prompt:import('./outboundApproval').AnyOutboundPrompt|null}
  | { type: 'sourceOpenResult'; requestId: string; url: string; taskId: string; opened: boolean; error?: string }
  | { type: 'sourceReturn'; requestId: string; url: string; taskId: string }
  | { type: 'taskRenameResult'; requestId: string; saved: boolean; undoId?: string }
  /** CGP-CHAT-R-029 — whether a host-side 되돌리기 (file, page, rename) put the prior state back. */
  | { type: 'removalUndoResult'; undoId: string; restored: boolean }
  /** CGP-CHAT-R-029 — a send started: every host-held 되돌리기 (file, page, rename) is gone; offers end. */
  | { type: 'removalsFinal' }
  | { type: 'taskSearchResult'; requestId: string; scope: string; results: import('./taskSearch').TaskSearchResult[] | null }
  | { type: 'taskAppearanceResult'; requestId: string; taskId: string; saved: boolean }
  | { type: 'taskMoveResult'; requestId: string; moved: boolean; title?: string; destination?: string }
  | { type: 'taskWorkspaceState'; view: import('./taskWorkspaceContract').TaskWorkspaceView }
  | { type: 'taskWorkspaceError'; verdictRequestId?: string; verdictMessageId?: string; error: string | null; draftSaveFailed?: boolean; historySaveFailed?: boolean }
  /** Explicit Focus command targets the existing editor composer, not background restore. */
  | {type:'focusInput'}
  | { type: "attachmentsPrepared"; requestId: string; failures: import("./attachmentFailure").AttachmentFailure[] }
  | {type:'inputRejected';text:string;images?:string[];photos?:Array<{id:string;name:string}>;toolMode?:import('./turnTools').TurnToolMode}
  /** D-028 — the host did not keep a staged photo; the webview drops its chip and says why. */
  | {type:'imageStageRefused';stageId:string;reason:string}
  /** D-028 — a photo dropped from Finder (it opened as a tab) is staged; draw its chip. `dataUrl` only for a drawable photo up to 8 MB. */
  | {type:'imageStagedByHost';stageId:string;name:string;dataUrl?:string}
  /** D-028 — the photos of the message just sent were saved; `note` is the `[첨부한 사진]` list. */
  | {type:'attachedImagesSaved';note:string}
  | {type:'activityFreeze';frozen:boolean;nonce?:string}
  | {type:'activityDraftError';error:string}
  /** #897 (VO-01) — a request to run the probe. Raised only by a command, never at activation time. */
  | { type: 'probeVoiceCapability'; probeId: string }
  // `capabilityModel` travels WITH the findings: the screen labels each key in
  // the model that key belongs to, and a stored record may be either one.
  | { type: 'observationState'; capabilityModel?: string; assessedEventCount?: number; learningPath?: {title:string;url:string;reason:string} | null; batch: import('./nativeObservationContract').ObservationBatch | null; error: string | null; findings?: import('./nativeObservationContract').ObservationFinding[] }
  /**
   * SX-14·15·17 — the learning state the host computed. **The webview does not
   * recompute it** (design §정보 구조 "호스트·웹뷰·워커의 경계"). The disabled
   * Complete CTA also just draws `complete.ok` as given. The gate result is never
   * stored, so this message always carries a freshly computed value.
   */
  | { type: 'learningState'; state: import('./learningStateHelpers').LearningStatePayload }
  | StartResponse
  | { type: "config"; config: ChatConfig }
  /** #751 G2 — the learner's saved work-surface entries for the lesson `sha256` (read from this device), and the rehearsal result. */
  | { type: "lessonWorkState"; sha256: string; work: Record<string, import("./lessonFocus").StepWork> }
  | { type: "rehearsalState"; state: "sending" | "sent" | "error"; verdict?: string; reasons?: string[]; message?: string }
  /**
   * AE-01 (#554) — the answer to one goal save, sent to every chat view. `requestId` names the save, so only the view that
   * sent it shows the note (`saved`, or `error`: the sentence to show). `view` is the goal as stored after a save, or the
   * newer goal a `stale` save lost to; any other refusal carries none, so every view keeps the goal and the text it shows.
   */
  | ({ type: "goalState" } & import("./studentGoal").GoalAnswer)
  /** #751 U2 — always read from disk by the host; the webview holds no copy of record. */
  | { type: "inboxState"; inbox: import("./classroomInbox").InboxView }
  /** AE-15 / CGP-ART-R-002 — the review bar for the last coach turn's file changes; null removes it. */
  | { type: "turnReviewState"; view: import("./turnReviewView").TurnReviewView | null }
  /** REQ-STUDIO-MISSING-TASK-FOLDER — the personal task's folder is gone: one notice with 다시 고르기; null hides it. */
  | { type: "missingTaskFolder"; notice: import("./missingTaskFolder").MissingTaskFolderNotice | null }
  /** REQ-KNOW-35 (CGP-KNOW-R-019) — free space on the work folder's volume is under the threshold: one persistent bar above the composer; null hides it. */
  | { type: "lowDisk"; notice: import("./lowDisk").LowDiskNotice | null }
  /** CGP-AGENT-D-026 (REQ-STUDIO-PERF-TRACE) — a 느려요 기록 is running (red 기록 중 · 멈추기 pill above the composer) or not; `id` names the recording. */
  | { type: "perfTraceState"; recording: boolean; id: string | null }
  /** REQ-STUDIO-PREVIEW-RECOVERY — the learner's preview tab as measured (server state, HTTP status); null = no preview tab. `result` answers a press. */
  | { type: "previewRecovery"; signals: import("./previewFailure").PreviewSignals | null; result?: import("./previewFailure").PreviewRecoveryResult }
  /** REQ-STUDIO-ARTIFACT-PROVENANCE — one label per work-folder file, from recorded events only; null when there is no folder. */
  /** CGP-KNOW-D-013 — the current activity's trash; null when unavailable. `requestId`/`result` answer one press. */
  | { type: "activityTrashState"; view: import("./activityTrashView").ActivityTrashView | null; requestId?: string; result?: import("./activityTrashView").ActivityTrashResult }
  | { type: "activityMemoryState"; view: import("./activityMemoryView").ActivityMemoryView | null; requestId?: string; result?: import("./activityMemoryView").ActivityMemoryResult }
  | { type: "artifactProvenance"; view: import("./artifactProvenanceView").ArtifactProvenanceView | null }
  /** CGP-KNOW-D-011 — an inline data: image read from inside the work folder, or null (the row keeps its type glyph). */
  | { type: "artifactThumbnail"; requestId: string; path: string; src: string | null }
  | { type: "artifactInfo"; requestId: string; info: import("./artifactProvenanceView").ArtifactInfo | null }
  /** REQ-STUDIO-PAGE-CARD — every page card of the current task this session (in memory only); [] removes them. */
  | { type: "pageCardsState"; cards: import("./pageCard").PageCardView[] }
  | { type: "helpState"; help: import("./classroomHelp").HelpView }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "answerAttemptSelected"; root: ChatMessage; scope: string }
  /** REQ-STUDIO-CONTEXT-TRIM-MARKER — first saved message the next model call still sends, when older ones are clamped. */
  | { type: "contextTrim"; boundaryId: string | null }
  /** CGP-CHAT-R-005 — the active task's latest verdict per answer, read from the local sidecar. */
  | { type: "answerVerdicts"; requestId?: string; messageId?: string; taskId?: string; verdicts: import('./answerVerdict').VerdictMap }
  /** `userMessageId` (REQ-STUDIO-STEER-NOW): the learner request this turn answers; absent for app-initiated replies. */
  | { type: "streamStart"; streamId: string; messageId: string; userMessageId?: string; /** CGP-CHAT-R-023 */ lessonStep?: import("./lessonStepMarks").LessonStepMark }
  /** CGP-CHAT-R-023 — served lesson step per user message id, for the transcript's step dividers. */
  | { type: "lessonStepMarks"; marks: import("./lessonStepMarks").LessonStepMarks; /** CGP-CHAT-R-023 — a delta: these ids lose their mark (lessonStepMarks.nextStepMarks). */ forget?: string[] }
  | { type: "streamChunk"; streamId: string; delta: string }
  | { type: "delegationStopState"; streamId: string; state: import("./delegationStop").DelegationStopState }
  | { type: "streamCitations"; streamId: string; citations: Citation[] }  // #173
  // SX-59 — the host message that used to leak capability scores to the webview
  // (#204) has been removed. A score reaches the working screen in no shape at all.
  // The `AssetScoreChunk` type above **stays** — the proxy SSE parser still has to
  // keep reading and discarding the worker's `asset_score` chunk (`proxyClient.ts`,
  // `test/proxy-client-asset-score.smoke.mjs`).
  // The message name is deliberately not written here again:
  // `test/sx-legacy-score-removed.smoke.mjs` checks this file for the absence of
  // that name.
  /** `failed` — the stream closed normally but the turn's result was a failure (#751 U4); the task rail shows 오류, not 끝남. */
  | { type: "streamEnd"; streamId: string; failed?: true }
  /** REQ-STUDIO-TASK-RUN-STATE — a tool approval modal is open (`waiting: true`) or has just been answered. */
  | { type: "approvalWait"; waiting: boolean }
  // #497 — user pressed Stop. Distinct from streamEnd (the turn did NOT finish)
  // and from streamError (nothing went wrong — the user asked for this, so no
  // "문제가 생겼어요" banner and no 🚨 신고하기 button). The webview leaves the
  // streaming state and shows a plain notice inviting the next message.
  /** `by: "instructor"` — stopped by a classroom command (#751), so the learner is told who stopped it and that nothing was lost. */
  | { type: "streamStopped"; streamId: string; by?: "instructor" }
  // #278 Phase 3 — agentic browser tool loop action log (auto-run + log, no
  // modal). One line per tool call; `state` flips running → done/error.
  // #503 — there is one channel, so arrival order IS occurrence order. The webview
  // splices this line into the **same array** as `streamChunk` to build
  // [bubble] → [tool] → [bubble]. `at` is the SDK's own timestamp as it sent it (ms;
  // the host clock when absent) — the createdAt of the persisted line.
  // CGP-ART-R-020 — one successful tool call of a running turn, bound to the task it started in.
  | { type: "taskActivityFact"; streamId: string; fact: import("./taskActivity").TaskActivityFact; activityId?: string; taskId?: string }
  | { type: "toolLog"; shell?: import("./shellPresentation").ShellPresentation; streamId: string; id: string; icon: string; label: string; state: "running" | "done" | "error"; at?: number; step?: string; since?: number }
  // #308 — the "페이지를 코치에게" completion notice. Raising a VS Code notification
  // toast stops the integrated browser with "Paused due to Notification" (core
  // behaviour), so this is announced on the chat panel's inline status line instead
  // of a toast.
  | { type: "denialNotice"; id: string; label: string; at: number }
  // CGP-KNOW-R-021 — how a download from the Studio browser ended (re-checked by the webview).
  | { type: "downloadNotice"; id: string; icon: string; label: string; state: "done" | "error" | "running"; at: number }
  // CGP-KNOW-D-021 — the outcome of a 열기 / 폴더에서 보기 press: a refusal line, or null once it went through.
  | { type: "downloadLineNotice"; id: string; notice: string | null }
  | { type: "pageAttached"; label: string }
  // CR-09 — the picked element queued for the next turn (null = none): exactly what goes.
  | { type: "annotations"; enabled: boolean; annotations: import("./annotationBatch").AnnotationView[] }
  | { type: "elementAttached"; element: ElementPreview | null }
  /** CGP-ART-R-007 — the page text queued for the next turn, shown in full and removable. */
  | { type: "pageAttachment"; attachment: import("./pageContext").PageAttachmentPreview | null }
  /** CGP-CHAT-R-011 — the work-folder file queued for the next turn (null = none), why a pick was refused, or a one-line notice. The host owns the chip's lifetime. */
  | { type: "attachmentFailure"; failure: import("./attachmentFailure").AttachmentFailure }
  | { type: "attachmentFailureResolved"; id: string }
  | { type: "fileAttachment"; attachment: FileAttachmentPreview | null; error?: string; notice?: string }
  | { type: "fileMentionResults"; requestId: string; files: import("./workspaceFileMentions").MentionFile[]; limited: boolean; error?: string }
  | { type: "fileMentionPicked"; requestId: string; ok: boolean }
  /** CGP-VOICE-R-009 — the menu state (re-read on every open) and the result of one attach click. */
  | { type: "voiceShowThisMenu"; requestId: string; items: import("./voicePopupHelpers").ShowThisItem[] }
  | { type: "voiceShowThisResult"; requestId: string; target: import("./voicePopupHelpers").ShowThisTarget | null; ok: boolean; reference?: import("./voicePopupHelpers").ReferenceTarget; error?: string }
  /** CGP-KNOW-R-003 — the 자료 list (null = this seat has none). `requestId` answers that press; `error`/`notice` say what happened. */
  | { type: "materialsState"; view: import("./activityMaterialsView").MaterialsView | null; requestId?: string; error?: string; notice?: string }
  // cr-verify — the "Test my product" panel (null = hidden). `sendText`: the student's own
  // sentence the panel sends next through the normal send path (the coach context rides
  // with it, model-only). `error`: why the last action was refused.
  | { type: "verifyState"; view: import("./verifyView").VerifyView | null; sendText?: string; requestId?: string; error?: string }
  // cr-publish — the "사용자 테스트용으로 공개" panel (null = hidden). `error`/`errorLines`: why the
  // last action was refused (the file and line of a refused set); `shareUrl`: the link just made.
  | { type: "publishState"; view: import("./publishView").PublishView | null; error?: string; errorLines?: string[]; shareUrl?: string }
  // cr-evidence — the "실험 증거" panel (null = hidden). `error`: why the last action was refused; `done`: what it did.
  | { type: "evidenceState"; view: import("./evidenceView").EvidenceView | null; error?: string; done?: string }
  | { type: "memoryState"; view: import("./memoryView").MemoryView | null; error?: string; done?: string }
  // cr-skills — the "커리큘럼 스킬" panel (null = hidden); `running` while a skill runs.
  | { type: "skillsState"; view: import("./skillView").SkillsView | null; running?: boolean; error?: string; done?: string }
  // cr-review — the "주간 리뷰" panel, the student's or the director's (null = hidden).
  | { type: "reviewState"; view: import("./reviewView").ReviewView | null; error?: string; done?: string }
  // #320 — AI disclosure notice (Anthropic Usage Policy: consumer-facing chat
  // must disclose "you are interacting with AI" at minimum at session start).
  // Host posts once per session — first webview mount of this run and again
  // right after a history clear; hide/show remounts within the same session
  // stay silent (host-side AiDisclosureGate remembers). Webview renders a
  // compact role=note + aria-live=polite banner at the top of the messages.
  | { type: "aiDisclosure"; text: string }
  | { type: "accuracyEducationChanged" }
  | { type: "accuracyEducation"; requestId: string; offer: import("./accuracyEducation").AccuracyOffer | null }
  | { type: "whatsNewChanged" }
  | { type: "whatsNew"; requestId: string; notes: import("./whatsNew").LearnerNotes | null; show: boolean }
  // #384 — an image opened in an editor tab (VS Code intercepts file drops onto
  // the editor and opens them). The host reads the bytes and hands the webview
  // a data URL to attach to the next turn — making "drag a screenshot in" work
  // WITH VS Code's drop behavior instead of fighting it. image_paste-gated.
  | { type: "attachImage"; dataUrl: string; name: string }
  // #649 — a pre-built world actually came up on screen. Why it is a message
  // separate from config: config arrives only when the profile changes, whereas the
  // world changes several times within one session. The webview uses this to
  // highlight the currently open world in the friend strip (aria-pressed).
  | { type: "worldOpened"; id: string; guest: string; emoji: string }
  /**
   * The result of "갤러리에 올리기". Why `state` has three values: the upload takes a
   * few seconds, and with nothing shown during them a child keeps pressing the button
   * (and that hits the server rate limit). `uploading` is sent first, at the start.
   */
  | {
      type: "publishResult";
      state: "uploading" | "done" | "error";
      /** When done — the gallery URL, shown to the child exactly as it is. */
      url?: string;
      /** When error — the Korean sentence the server produced. */
      message?: string;
    }
  /** `retry: false` — resending cannot help (REQ-M45 missing SDK binary); the panel hides "다시 보내기". `retryable: false` (#1819) — the answer could not be saved; same effect. */
  | { type: "streamRefusal"; streamId: string }
  | { type: "streamError"; streamId: string; error: string; activityUnavailable?: import("./activityAvailability").ActivityUnavailable; requestId?: string; runbookUrl?: string; retry?: false; retryable?: boolean; trialEndCard?: TrialEndCardView; safetyNotice?: import("./safetyNotice").SafetyNoticeView }
  | { type: "actionResult"; requestId: string; approved: boolean }
  /** TUX-COND-08 — the answer to notifyOptinSubmit / notifyOptinWithdraw. Never carries the address. */
  | { type: "notifyOptinResult"; state: "subscribed" | "withdrawn" | "error"; message?: string }
  | { type: "renderPreview"; html: string }
  // Test-only: forces a React render-time throw so e2e can verify the
  // ChatErrorBoundary fallback path (REQ-C7). Only sent from the
  // host-side __test_crashWebview command which is itself env-gated.
  | { type: "webviewTestCrash" }) & {activityId?:string; taskId?:string};

export interface ActionRequest {
  requestId: string;
  // #282 — extended beyond writeFile/executeShell so Agent SDK tool calls map to
  // an accurate kind: Read/Glob → readFile, WebSearch/WebFetch → webSearch. The
  // approval policy (resolveActionApproval) keys its tiers on these.
  // "openBrowser" (#282 P2 slice 2): the hypeproof MCP browser_open tool — an
  // outward action, modal-gated by default (requireApprovalFor).
  // "delegateAgent" (#282 P2 slice 3): the coach wants to hand a task to a
  // read-only subagent (코드리뷰어/리서처) via the SDK Agent/Task tool. The
  // modal makes the student consciously decide the delegation — the
  // delegation_judgment asset IS this decision (docs/seven-assets.md §5).
  // "publishSite": the coach's publish_site tool makes the workspace public on GitHub Pages.
  // Its own tier in resolveActionApproval (confirmed once per repository per session) and
  // deliberately NOT in `requireApprovalFor`: a setting must not be able to remove the one
  // confirmation in front of an irreversible "everyone can read this" act.
  // "consultHelper" (ADR 0011, orchestrator spec §5.1): the coach asks a roster helper one
  // question through mcp__hypeproof__consult. The helper has no tools and sees only the
  // excerpts the host attaches, so it runs without a modal by default: the kind is in
  // `requireApprovalFor`'s enum but not its default, and a machine that lists it gets one.
  kind: "writeFile" | "executeShell" | "readFile" | "webSearch" | "openBrowser" | "delegateAgent" | "browserClick" | "browserType" | "publishSite" | "consultHelper";
  /**
   * epic #431, shell only — the command is unrecoverable if approved by
   * reflex (`rm`, `sudo`, `git push --force`, pipe-to-shell). The host shows
   * the strong confirm and refuses to remember it under "항상 허용".
   */
  destructive?: boolean;
  description: string;
  payload: unknown;
}

/** CR-09 — what the chat panel shows of a picked element before it is sent. */
export interface ElementPreview {
  ref: string;
  tag: string;
  text: string;
  /** `file:line`, or "unmapped" when the source could not be located without guessing. */
  source: string;
  /** The exact text block the coach will receive. */
  sentText: string;
  /** The element crop as it will be sent, or null when the cohort sends no images. */
  imageDataUrl: string | null;
  /** CGP-ART-R-006 — the style tweak offered for this element, or null/absent when none. */
  styleTweak?: import("./styleTweak").StyleTweakView | null;
}

/** Cohort plan for the learning wiki and deck skills (served as `learning_wiki.plan`; learningWiki.ts re-exports it). */
export interface LearningWikiPlan {
  /** What students call the wiki in the chat and in the copy (default "팀 브레인"). */
  name?: string;
  /** Folder in the workspace (default "wiki"). */
  dir?: string;
  /** Who the learners are, in the prompt's words (default "학습 팀"). */
  audience?: string;
  /** What one session is called (default "회차"; the founder course says "주차"). */
  session_label?: string;
  /** Deck template for the deck skill; `hint` tells the skill what the slide must and must not show. */
  deck?: { title?: string; slides: Array<{ no: number; title: string; question: string; hint?: string }> };
  /** Per session: the slides the deck skill drafts that session and the session's question. */
  sessions?: Array<{ session: number; focus?: number[]; question?: string }>;
}
