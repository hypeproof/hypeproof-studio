// #751 G2 · #1008 — what the learner's screen says about the CURRENT step of the confirmed lesson, and what the next turn
// carries because of it. Pure: no vscode import, so the webview build, the host and the tests share one rule.
//
// Three values kept apart, as in the Service (worker/src/lib/lesson-help-mode.ts, learning-design.ts,
// lesson-feature-policy.ts):
//   help mode     teaching strategy the step OFFERS and the learner picked — sent as `x-hps-help-mode` for the next turn
//   work surface  the step's `ui`: a form the learner fills in; its saved text travels with the next turn as context
//   tool grants   untouched here. They come from the served profile only.
// A header names a teaching pointer; the Service re-resolves both against the frozen steps and refuses anything else.

export const HELP_MODES = ["demonstrate", "hint", "co_edit", "independent"] as const;
export type HelpMode = (typeof HELP_MODES)[number];
/** Same words as the Service's HELP_MODE_LABELS; the learner never sees a raw key. */
export const HELP_MODE_LABELS: Record<HelpMode, string> = {
  demonstrate: "시연 보기",
  hint: "힌트 받기",
  co_edit: "함께 수정",
  independent: "직접 해보기",
};
/** Work surfaces this Studio renders. The Service accepts seven `ui` values (MATERIAL_KINDS); the rest are reported as unsupported. */
export const SUPPORTED_SURFACES = ["chat", "criterion_form", "decision_form"] as const;
export const WORK_TEXT_MAX = 1000;

type Step = { id: string; title?: string; help?: { default: string; allowed: string[] }; ui?: string; ui_version?: unknown };
type Lesson = { sha256: string; version: string; content: { steps: Step[] } };
export interface LessonFocus { sha256: string; stepId: string; helpMode: HelpMode | null }

const isMode = (x: unknown): x is HelpMode => typeof x === "string" && (HELP_MODES as readonly string[]).includes(x);

/** The surface this App draws for a step: its own kind, or `unsupported:<kind>` (drawn as a notice, never faked). */
export function surfaceOf(step: Step): string {
  const kind = typeof step.ui === "string" ? step.ui : "chat";
  if (kind !== "chat" && !rendersPin(kind, step.ui_version)) return "unsupported:" + kind;
  return (SUPPORTED_SURFACES as readonly string[]).includes(kind) ? kind : "unsupported:" + kind;
}

/**
 * CGP-LEARN-R-004 — the catalog versions of each block this App draws. A confirmed lesson pins `ui_version` (Service
 * step-ui-catalog); a lesson frozen before pinning has none and means v1. A version this App does not know is drawn as
 * the unsupported notice, never as another version's behaviour. Add a version here only together with its rendering.
 */
export const RENDERED_UI_VERSIONS: Readonly<Record<string, readonly number[]>> = {
  canvas_editor: [1], canvas_preview: [1], criterion_form: [1], evidence_note: [1], coach_request: [1], decision_form: [1], metric_board: [1],
};
export function rendersPin(kind: string, uiVersion: unknown): boolean {
  const version = uiVersion === undefined ? 1 : uiVersion;
  // Own keys only: a lesson's `ui` is data, and "constructor" or "toString" must not resolve through Object.prototype.
  const drawn = Object.prototype.hasOwnProperty.call(RENDERED_UI_VERSIONS, kind) ? RENDERED_UI_VERSIONS[kind] : undefined;
  return Number.isSafeInteger(version) && !!drawn && drawn.includes(version as number);
}

/**
 * CGP-LEARN-R-001 (DEC-19) — a step's learning block lives in the step's existing `ui` field: the seven values the Service's
 * learning-design.ts accepts (STEP_UI_KINDS). No other key and no other value is a block.
 */
export const MATERIAL_KINDS = ["canvas_editor", "canvas_preview", "criterion_form", "evidence_note", "coach_request", "decision_form", "metric_board"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export interface StepMaterial { kind: MaterialKind; stepId: string; version: string; sha256: string; uiVersion: number }

/**
 * The block the confirmed lesson version attaches to ONE step, or null. The only source is the served lesson (pinned by its
 * version and sha256); a coach reply, a host message or the learner cannot add one. A step without `ui`, or with a value outside the
 * seven kinds, has no block.
 */
export function stepMaterial(lesson: Lesson | null | undefined, stepId: string): StepMaterial | null {
  const step = lesson?.content.steps.find((s) => s.id === stepId);
  const kind = step?.ui;
  if (!lesson || !step || typeof kind !== "string" || !(MATERIAL_KINDS as readonly string[]).includes(kind)) return null;
  // CGP-LEARN-R-004 — only a pinned version this App renders; otherwise no block (the step shows the unsupported notice).
  if (!rendersPin(kind, step.ui_version)) return null;
  return { kind: kind as MaterialKind, stepId: step.id, version: lesson.version, sha256: lesson.sha256, uiVersion: (step.ui_version as number | undefined) ?? 1 };
}

/** What a block's state sentence is computed from: the fields as the learner has them now, and the last save, if any. */
export interface MaterialInput { text: string; reason: string; saved?: { text: string; reason?: string } }
export interface MaterialState { key: string; sentence: string }
export interface MaterialText { title: string; controlsHelp: string; state: (input: MaterialInput) => MaterialState }

const UNDRAWN = (title: string): MaterialText => ({
  title,
  controlsHelp: "이 자료에는 누를 곳이나 적을 칸이 없어요. 대화로 진행하고 강사에게 알려 주세요.",
  state: () => ({ key: "unavailable", sentence: "이 Studio에서는 아직 열 수 없는 자료예요. 바뀌는 내용이 없어요." }),
});

/**
 * CGP-LEARN-R-003 (REQ-STUDIO-LEARNING-BLOCK-TEXT) — the live text equivalent of every block kind: a title, one sentence on
 * how to work its controls, and a state sentence computed from what the learner has in the fields now. The sentence names the
 * state (empty, written, saved, changed after saving), not every keystroke: a polite region that re-read the text on each key
 * would talk over the screen reader's own typing echo. Words only; no score, grade or right/wrong (REQ-CGP-LEARN-02).
 */
export const MATERIAL_TEXT: Record<MaterialKind, MaterialText> = {
  criterion_form: {
    title: "확인 기준 적기",
    controlsHelp: "아래 칸에 무엇이 되면 잘 된 것인지 한 줄로 적고 '기준 저장'을 누르세요. 저장한 기준은 다음 질문에 함께 보내요. '처음으로'는 칸을 비우고, '되돌리기'는 바로 전에 고친 것을 되돌려요.",
    state: ({ text, saved }) => {
      const t = text.trim();
      if (saved && t === saved.text) return { key: "saved", sentence: "기준을 저장했어요. 다음 질문에 함께 보내요." };
      if (saved) return t
        ? { key: "edited", sentence: "저장한 기준과 다르게 고쳤어요. 아직 저장하지 않았어요." }
        : { key: "cleared", sentence: "칸을 비웠어요. 전에 저장한 기준은 그대로 있어요." };
      return t
        ? { key: "written", sentence: "기준을 적었어요. 아직 저장하지 않았어요." }
        : { key: "empty", sentence: "아직 기준을 적지 않았어요." };
    },
  },
  decision_form: {
    title: "결정과 이유 적기",
    controlsHelp: "첫 칸에 무엇을 바꾸기로 했는지, 둘째 칸에 그 이유를 적고 '결정 저장'을 누르세요. 두 칸을 모두 적어야 저장할 수 있어요. '처음으로'는 두 칸을 비우고, '되돌리기'는 바로 전에 고친 것을 되돌려요.",
    state: ({ text, reason, saved }) => {
      const t = text.trim(), r = reason.trim();
      if (saved && t === saved.text && r === (saved.reason ?? "")) return { key: "saved", sentence: "결정과 이유를 저장했어요. 다음 질문에 함께 보내요." };
      const tail = saved ? " 전에 저장한 결정은 그대로 있어요." : "";
      if (t && r) return { key: saved ? "edited" : "written", sentence: (saved ? "저장한 결정과 다르게 고쳤어요." : "결정과 이유를 모두 적었어요.") + " 아직 저장하지 않았어요." };
      if (t) return { key: "need-reason", sentence: "결정을 적었어요. 이유를 적으면 저장할 수 있어요." + tail };
      if (r) return { key: "need-decision", sentence: "이유를 적었어요. 무엇을 바꾸기로 했는지 적으면 저장할 수 있어요." + tail };
      return { key: saved ? "cleared" : "empty", sentence: saved ? "두 칸을 비웠어요. 전에 저장한 결정은 그대로 있어요." : "아직 결정과 이유를 적지 않았어요." };
    },
  },
  canvas_editor: UNDRAWN("작업 화면에서 고치기"),
  canvas_preview: UNDRAWN("작업 화면 미리 보기"),
  evidence_note: UNDRAWN("근거 메모"),
  coach_request: UNDRAWN("코치에게 부탁하기"),
  metric_board: UNDRAWN("수치 살펴보기"),
};

/**
 * CGP-LEARN-R-010 — reset and undo for a block's fields. The preset of every block this App draws (catalog v1, no params)
 * is empty fields, so "처음으로" empties them; the learner's saved work is the host's and stays until a new save. Undo
 * steps back one change, where a change is one burst of typing (it ends on blur, after a pause, on reset or on undo) or
 * one reset. Neither sends anything to the host: no save, no observation event.
 */
export interface BlockFields { text: string; reason: string }
export interface BlockHistory { past: BlockFields[]; burst: boolean }
export const BLOCK_PRESET: BlockFields = { text: "", reason: "" };
export const BLOCK_HISTORY_MAX = 50;
export const EMPTY_HISTORY: BlockHistory = { past: [], burst: false };
const sameFields = (a: BlockFields, b: BlockFields) => a.text === b.text && a.reason === b.reason;
/** Before a field edit: the first edit of a burst records the fields as they were. */
export function historyEdit(h: BlockHistory, before: BlockFields): BlockHistory {
  return h.burst ? h : { past: [...h.past, { ...before }].slice(-BLOCK_HISTORY_MAX), burst: true };
}
/** A burst ends (blur, pause): the next edit is a new change. */
export const historyBoundary = (h: BlockHistory): BlockHistory => (h.burst ? { ...h, burst: false } : h);
/** "처음으로": the preset, recorded as one change. Null when the fields already are the preset (the button is disabled). */
export function historyReset(h: BlockHistory, current: BlockFields): { history: BlockHistory; fields: BlockFields } | null {
  if (sameFields(current, BLOCK_PRESET)) return null;
  return { history: { past: [...h.past, { ...current }].slice(-BLOCK_HISTORY_MAX), burst: false }, fields: { ...BLOCK_PRESET } };
}
/** "되돌리기": the fields before the last change. Null when there is nothing to undo (the button is disabled). */
export function historyUndo(h: BlockHistory): { history: BlockHistory; fields: BlockFields } | null {
  const last = h.past[h.past.length - 1];
  return last ? { history: { past: h.past.slice(0, -1), burst: false }, fields: { ...last } } : null;
}

/**
 * CGP-LEARN-R-011 (c) — "접기": a learner puts away a block they do not want. The collapsed set is the learner's own view state for
 * this session, kept in the webview's state and never posted: it is not work, not a report and not an observation event. Keys
 * are the block's lesson version and step (the open/closed key), so a new lesson version starts with every block shown.
 */
export const COLLAPSED_BLOCKS_MAX = 50;
const COLLAPSED_KEY_MAX = 512;
/** The collapsed keys read back from webview state; anything malformed is dropped. */
export function collapsedBlocksFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= COLLAPSED_KEY_MAX);
  return [...new Set(keys)].slice(-COLLAPSED_BLOCKS_MAX);
}
/**
 * The seat the collapsed set belongs to. Classroom PCs are shared: a second learner signing in on the same window must not
 * inherit the first learner's collapsed blocks. The order of preference:
 * - the Service's seat id (`activity_id`, 64 hex);
 * - the lesson capability receipt id, a hash of the service, the seat or credential, and the lesson;
 * - the local activity id.
 * Empty when none is known.
 */
export function collapseSeat(input: { activityId?: unknown; entryId?: unknown; localActivityId?: unknown }): string {
  if (typeof input.activityId === "string" && /^[a-f0-9]{64}$/.test(input.activityId)) return "seat:" + input.activityId;
  if (typeof input.entryId === "string" && input.entryId.length > 0 && input.entryId.length <= 128) return "entry:" + input.entryId;
  if (typeof input.localActivityId === "string" && input.localActivityId.length > 0 && input.localActivityId.length <= 200) return "local:" + input.localActivityId;
  return "";
}
export interface CollapsedState { seat: string; keys: string[] }
/** The stored set, read back from webview state: `{ seat, keys }`. Anything else, including #4023's bare array, is null. */
export function collapsedStateFrom(value: unknown): CollapsedState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { seat?: unknown; keys?: unknown };
  return typeof v.seat === "string" && v.seat.length <= 256 ? { seat: v.seat, keys: collapsedBlocksFrom(v.keys) } : null;
}
/** The collapsed keys this seat may see: only its own; another seat's set, or none, is empty. */
export const collapsedFor = (state: CollapsedState | null, seat: string): string[] => (state && state.seat === seat ? state.keys : []);
/** The set after 접기 (on) or 다시 보기 (off) for one block; newest last, bounded. */
export function collapseBlock(keys: readonly string[], key: string, on: boolean): string[] {
  const rest = keys.filter((k) => k !== key);
  return on ? [...rest, key].slice(-COLLAPSED_BLOCKS_MAX) : rest;
}

/** Catalog check: every kind needs a title, a controls help sentence and a state sentence in Korean. Returns the gaps. */
export function materialTextGaps(catalog: Record<string, MaterialText | undefined> = MATERIAL_TEXT): string[] {
  const hangul = (s: unknown) => typeof s === "string" && /[가-힣]/.test(s) && s.trim() === s && s.length > 0;
  const gaps: string[] = [];
  for (const kind of MATERIAL_KINDS) {
    const c = catalog[kind];
    if (!c) { gaps.push(kind + ": missing"); continue; }
    if (!hangul(c.title)) gaps.push(kind + ": title");
    if (!hangul(c.controlsHelp)) gaps.push(kind + ": controlsHelp");
    const s = typeof c.state === "function" ? c.state({ text: "", reason: "" }) : null;
    if (!s || !hangul(s.sentence) || !s.key) gaps.push(kind + ": stateDescription");
  }
  return gaps;
}

/** Help choices the step offers, in the lesson's order, known modes only. Empty = this step has no help choice. */
export function helpChoices(step: Step): HelpMode[] {
  return (step.help?.allowed ?? []).filter(isMode);
}

/** A focus message from the webview, checked against the lesson this profile carries. Anything else is dropped. */
export function acceptFocus(lesson: Lesson | null | undefined, msg: { stepId?: unknown; helpMode?: unknown }): LessonFocus | null {
  if (!lesson || typeof msg.stepId !== "string") return null;
  const step = lesson.content.steps.find((s) => s.id === msg.stepId);
  if (!step) return null;
  const helpMode = isMode(msg.helpMode) && helpChoices(step).includes(msg.helpMode) ? msg.helpMode : null;
  return { sha256: lesson.sha256, stepId: step.id, helpMode };
}

/**
 * What ONE turn sends, captured at turn start with the turn's profile: the step the learner is on and, only where the step
 * offers it and the learner chose, the help mode. A focus made under another lesson (the class switched meanwhile) is not
 * carried; the turn then names the lesson's first step, as the screen shows it, and the Service applies that step's default.
 */
export function turnLesson(lesson: Lesson | null | undefined, focus: LessonFocus | null): { step?: string; helpMode?: HelpMode } {
  if (!lesson || !lesson.content.steps.length) return {};
  const own = focus && focus.sha256 === lesson.sha256 ? lesson.content.steps.find((s) => s.id === focus.stepId) : undefined;
  const step = own ?? lesson.content.steps[0];
  const helpMode = own && focus!.helpMode && helpChoices(step).includes(focus!.helpMode) ? focus!.helpMode : undefined;
  return { step: step.id, ...(helpMode ? { helpMode } : {}) };
}

export interface StepWork { kind: "criterion" | "decision"; text: string; reason?: string; savedAt: number }
/** A save from a work surface: only the kind the step's surface asks for, bounded, non-blank. */
export function acceptWork(lesson: Lesson | null | undefined, msg: { stepId?: unknown; kind?: unknown; text?: unknown; reason?: unknown }, now: number): { stepId: string; work: StepWork } | null {
  if (!lesson || typeof msg.stepId !== "string" || typeof msg.text !== "string") return null;
  const step = lesson.content.steps.find((s) => s.id === msg.stepId);
  if (!step) return null;
  const surface = surfaceOf(step), kind = surface === "criterion_form" ? "criterion" : surface === "decision_form" ? "decision" : null;
  if (!kind || msg.kind !== kind) return null;
  const text = msg.text.trim().slice(0, WORK_TEXT_MAX);
  if (!text) return null;
  const reason = typeof msg.reason === "string" ? msg.reason.trim().slice(0, WORK_TEXT_MAX) : "";
  if (kind === "decision" && !reason) return null;
  return { stepId: step.id, work: { kind, text, ...(kind === "decision" ? { reason } : {}), savedAt: now } };
}

/** The learner's own saved work for the step of this turn, as model-facing context. Their words, labelled, never a grant. */
export function workContext(stepTitle: string, work: StepWork | undefined): string {
  if (!work) return "";
  return work.kind === "criterion"
    ? `[이 단계('${stepTitle}')에서 학생이 직접 저장한 확인 기준]\n${work.text}\n[/확인 기준 — 학생이 정한 기준입니다. 대신 바꾸지 말고 이 기준으로 함께 확인하세요.]`
    : `[이 단계('${stepTitle}')에서 학생이 저장한 결정과 이유]\n결정: ${work.text}\n이유: ${work.reason ?? ""}\n[/결정 — 학생의 판단입니다. 다른 결정을 강요하지 마세요.]`;
}

export interface RenderedStep { id: string; visited: boolean; help_offered: string[]; help_default: string | null; surface: string }
/** What the mission header (MissionHeader.tsx) drew, as text read back from the DOM: week line, mission sentence, completion items. */
export interface RenderedMission { week: string | null; sentence: string; completion: string[] }
const MISSION_TEXT_MAX = 240;
/** Bounds a webview read-back to the report schema. Never fills in anything the screen did not show. */
export function boundMission(m: unknown): RenderedMission | undefined {
  if (!m || typeof m !== "object") return undefined;
  const x = m as { week?: unknown; sentence?: unknown; completion?: unknown };
  if (typeof x.sentence !== "string") return undefined;
  return {
    week: typeof x.week === "string" ? x.week.slice(0, 20) : null,
    sentence: x.sentence.slice(0, MISSION_TEXT_MAX),
    completion: Array.isArray(x.completion) ? x.completion.filter((t): t is string => typeof t === "string").slice(0, 10).map((t) => t.slice(0, MISSION_TEXT_MAX)) : [],
  };
}
/**
 * The rehearsal report the App sends: per step, what the screen actually DREW (read back from the rendered panel by the
 * webview), plus the App identity. The host only drops entries for steps this lesson does not have; it never fills in
 * what was not drawn.
 */
export function rehearsalReport(lesson: Lesson, rendered: RenderedStep[], app: { extension_version: string; host: string; runtime: string; sdk?: string; os: string; arch: string }, mission?: unknown, checklist?: { schema: "hps-rehearsal-checklist/1"; items: { id: string; verdict: "fits" | "fix"; note?: string }[] }) {
  const byId = new Map(rendered.map((r) => [r.id, r]));
  const drawn = boundMission(mission);
  return {
    ...(drawn ? { mission: drawn } : {}),
    ...(checklist ? { checklist } : {}),
    schema: "hps-rehearsal-report/1" as const,
    app,
    steps: lesson.content.steps.map((s) => {
      const r = byId.get(s.id);
      return r ? { id: s.id, visited: !!r.visited, help_offered: r.help_offered.filter(isMode), help_default: isMode(r.help_default) ? r.help_default : null, surface: String(r.surface).slice(0, 64) }
        : { id: s.id, visited: false, help_offered: [], help_default: null, surface: "not_drawn" };
    }),
  };
}

/** Learner-facing words for the Service's rehearsal verdict reasons (the instructor sees the same codes in Chalk). */
export const REHEARSAL_REASON_WORDS: Record<string, string> = {
  steps_not_visited: "열어 보지 않은 단계가 있습니다",
  help_mismatch: "도움 방식 선택지가 수업 설계와 다릅니다",
  surface_mismatch: "작업 화면이 수업 설계와 다릅니다",
  surface_unsupported: "이 Studio가 아직 그리지 못하는 작업 화면이 있습니다",
  no_completed_request: "끝까지 완료된 AI 요청이 없습니다",
  step_not_sent: "요청에 현재 단계가 실리지 않았습니다",
  other_lesson_requests: "다른 수업 버전으로 간 요청이 있습니다",
  tool_boundary_crossed: "허용하지 않은 도구가 요청에 실렸습니다",
  allowed_tool_missing: "허용한 도구가 요청에 없습니다",
  steps_not_in_candidate: "후보에 없는 단계가 보고됐습니다",
  mission_mismatch: "화면의 미션이 이 수업 후보와 다릅니다",
  mission_not_reported: "화면의 미션을 확인하지 못했습니다",
};
