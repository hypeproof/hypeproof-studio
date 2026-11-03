// REQ-STUDIO-PROBLEM-REPORT (2026-10-29): what Studio knows about a failure, and when it offers to report it.
// Pure: no vscode import, so test/problem-report.smoke.mjs runs it under plain Node.
//
// Level 1 (automatic, default off): a content-free diagnostic, POST {proxy}/problems/auto.
// Level 2 (one click): the in-panel form (ProblemReportDialog.tsx) prefilled with that diagnostic.
// Level 3 (suggested): the same failure twice, or a frustrated message, offers the form; nothing is sent
// until the person submits it.

/** Where the failure surfaced. Must match the Service's PROBLEM_STEPS (worker/src/lib/problem-signals.ts). */
export const PROBLEM_STEPS = ["chat", "agent", "profile", "access", "safety", "workspace", "update", "attachment", "other"] as const;
export type ProblemStep = (typeof PROBLEM_STEPS)[number];

/**
 * The only fields an automatic report may carry. Built from codes, numbers and versions, never from a
 * message, file name, path, prompt or token: an error's prose is not an input to this type.
 */
export interface ProblemDiagnostic {
  code: string;
  step: ProblemStep;
  http_status: number;
  app_version: string;
  os: string;
  fingerprint: string;
  request_id?: string;
}

const CODE_RE = /^[a-z][a-z0-9_]{0,47}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const APP_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,5}(?:-[0-9A-Za-z.]{1,16})?$/;

export function problemOs(platform: string, arch: string): string {
  const family = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : "";
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "";
  const os = family && cpu ? `${family}-${cpu}` : "other";
  return os === "macos-x64" || os === "macos-arm64" || os.startsWith("windows-") || os.startsWith("linux-") ? os : "other";
}

export const problemFingerprint = (code: string, step: string, appVersion: string): string => `${code}:${step}:${appVersion}`;

export interface FailureFacts {
  /** HTTP status of the failed answer; 0 or absent when no HTTP answer arrived. */
  status?: number;
  /** A machine code from the Service body or the app (`trial_model_unpriced`, `workspace_prepare_failed`). */
  code?: string;
  /** Fallbacks when `code` is absent: the error type or the auth failure kind, both machine words. */
  type?: string;
  kind?: string;
  step: ProblemStep;
  requestId?: string;
}

/**
 * The diagnostic for one failure. A code that is not a machine word (prose, a path, a URL) is dropped and the HTTP
 * status names the failure instead, so nothing a person or a model wrote can travel as a "code".
 */
export function problemDiagnostic(f: FailureFacts, env: { appVersion: string; platform: string; arch: string }): ProblemDiagnostic {
  const status = Number.isInteger(f.status) && (f.status as number) >= 400 && (f.status as number) <= 599 ? (f.status as number) : 0;
  const word = [f.code, f.type, f.kind].find((v): v is string => typeof v === "string" && CODE_RE.test(v));
  const code = word ?? (status ? `http_${status}` : "unknown");
  const appVersion = APP_VERSION_RE.test(env.appVersion) ? env.appVersion : "unknown";
  return {
    code, step: f.step, http_status: status, app_version: appVersion, os: problemOs(env.platform, env.arch),
    fingerprint: problemFingerprint(code, f.step, appVersion),
    ...(typeof f.requestId === "string" && REQUEST_ID_RE.test(f.requestId) ? { request_id: f.requestId } : {}),
  };
}

/** The exact automatic-report body: the allowlisted keys and nothing else. */
export function autoReportBody(d: ProblemDiagnostic): Record<string, string | number> {
  const body: Record<string, string | number> = {
    code: d.code, step: d.step, http_status: d.http_status, app_version: d.app_version, os: d.os, fingerprint: d.fingerprint,
  };
  if (d.request_id) body.request_id = d.request_id;
  return body;
}

/**
 * Sends one automatic report. No Authorization header: the signal is not linked to a seat or account. Errors and
 * refusals are swallowed; a lost signal must never become a visible error.
 */
export async function postAutoReport(proxyBase: string, d: ProblemDiagnostic, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(proxyBase.replace(/\/+$/, "") + "/problems/auto", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(autoReportBody(d)),
      signal: AbortSignal.timeout(5_000),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

/** Frustration in the person's own words. Whole short phrases only; a long message that mentions "안 돼" in passing is not a complaint. */
const FRUSTRATION = /(왜\s*안\s*(돼|되|됨)|안\s*(돼요?|되네|되잖아|됨)[\s.!?ㅠㅜ]*$|또\s*(오류|에러|안\s*돼)|계속\s*(오류|에러|안\s*돼)|오류\s*(나요|났어|떠요|뜨네)|에러\s*(나요|났어|떠요|뜨네)|먹통|고장\s*났)/;
export function soundsFrustrated(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 80 && FRUSTRATION.test(t);
}

export type OfferReason = "repeat" | "frustration";
export type ProblemNote = { send: boolean; offer: boolean; count: number };

/**
 * One app session's memory of failures. Nothing persists: it lives as long as the extension host.
 * - `send`: the first time a fingerprint is seen, and again only after `resendMs`; at most `maxSends` per session.
 * - `offer`: the second occurrence of a fingerprint, once per fingerprint; a frustrated message at most every `offerGapMs`.
 */
export class ProblemTracker {
  private counts = new Map<string, number>();
  private sentAt = new Map<string, number>();
  private offered = new Set<string>();
  private sends = 0;
  private lastFrustrationOffer = -Infinity;
  private readonly opts: { resendMs: number; maxSends: number; offerGapMs: number; repeatAt: number };
  constructor(opts: Partial<{ resendMs: number; maxSends: number; offerGapMs: number; repeatAt: number }> = {}) {
    this.opts = { resendMs: 10 * 60_000, maxSends: 20, offerGapMs: 30 * 60_000, repeatAt: 2, ...opts };
  }
  note(d: ProblemDiagnostic, now = Date.now()): ProblemNote {
    const count = (this.counts.get(d.fingerprint) ?? 0) + 1;
    this.counts.set(d.fingerprint, count);
    const last = this.sentAt.get(d.fingerprint);
    const send = this.sends < this.opts.maxSends && (last === undefined || now - last >= this.opts.resendMs);
    if (send) { this.sentAt.set(d.fingerprint, now); this.sends++; }
    const offer = count >= this.opts.repeatAt && !this.offered.has(d.fingerprint);
    if (offer) this.offered.add(d.fingerprint);
    return { send, offer, count };
  }
  frustration(text: string, now = Date.now()): boolean {
    if (!soundsFrustrated(text) || now - this.lastFrustrationOffer < this.opts.offerGapMs) return false;
    this.lastFrustrationOffer = now;
    return true;
  }
}

// ── Level 2: the in-panel form ────────────────────────────────────────────

export type ProblemFormReason = "manual" | "error" | "crash" | OfferReason;

/** What the form shows. Labels are Korean product copy; values are the diagnostic as sent. */
export interface ProblemReportFormView {
  id: string;
  reason: ProblemFormReason;
  /** Read-only rows of what goes with every report. */
  details: Array<{ label: string; value: string }>;
  contactPrompt: string;
  contactPlaceholder: string;
  /** How many recent messages the opt-in would attach (0 hides the checkbox). */
  recentTurns: number;
  /** The level-1 switch as stored on this machine (default off). */
  autoReport: boolean;
  /**
   * REQ-STUDIO-REPORT-LOGS: recent webview crashes always go with the report (`errorCount`); the session log tails go
   * only when the box is ticked. `available` is false when neither log file could be found (the box is hidden);
   * `checked` is the initial state: on when the screen crashed in this app session.
   */
  logs: { available: boolean; checked: boolean; errorCount: number };
  /**
   * REQ-STUDIO-DOCTOR: 「진단 결과 첨부」. Ticked by default (Jay 2026-11-03): the attachment carries check ids and
   * result codes only (studioDoctor.doctorAttachment). Absent from an older host: no box, nothing attached.
   */
  doctor?: { available: boolean; checked: boolean };
}

/** REQ-STUDIO-DOCTOR — the report form's attachment box (here, not in studioDoctor.ts, which the webview cannot bundle). */
export const DOCTOR_ATTACH_LABEL = "진단 결과 첨부";
export const DOCTOR_ATTACH_HINT = "확인한 항목의 이름과 결과 코드만 보내요. 파일 이름·경로·대화 내용은 보내지 않아요.";
export const LOGS_LABEL = "앱 기록 파일 첨부 (화면·확장 로그 마지막 부분)";
export const LOGS_HINT = "renderer.log·exthost.log 의 마지막 부분이에요. 보내기 전에 토큰·이메일·내 컴퓨터 사용자 이름을 지워요.";

/** The toggle's label and its statement of what it sends (REQ-H10). */
export const AUTO_REPORT_LABEL = "오류가 나면 오류 정보만 자동으로 보내기";
export const AUTO_REPORT_HINT = "오류 코드·단계·응답 상태·앱 버전·운영체제·요청 번호만 보내요. 대화 내용, 파일 이름과 경로, 프롬프트, 토큰은 보내지 않고 계정과 연결하지 않아요. 기본으로 켜져 있고, 여기서 끌 수 있어요.";

export interface ProblemReportAnswer { description: string; contact: string; includeRecentTurns: boolean; includeLogs: boolean; includeDoctor?: boolean }

/**
 * REQ-STUDIO-FEEDBACK-ENTRY — the visible way in (대화 메뉴, start page) and the form's title when opened from it:
 * one name for both a complaint and a failure, so the learner does not have to decide which one it is first.
 */
export const FEEDBACK_ENTRY_LABEL = "의견·문제 보내기";

/** The form's title: the entry's own name when the learner opened it, 문제 보내기 when a failure did. */
export function problemFormTitle(reason: ProblemFormReason): string {
  return reason === "manual" ? FEEDBACK_ENTRY_LABEL : "문제 보내기";
}

export const PROBLEM_FORM_LEAD: Record<ProblemFormReason, string> = {
  manual: "안 되는 것도, 「이게 불편해요」 같은 한마디도 좋아요. Studio 운영팀이 읽고 고쳐요.",
  error: "방금 생긴 문제를 Studio 운영팀에 알려요. 한 줄만 적어 주셔도 충분해요.",
  crash: "화면이 멈춘 문제를 Studio 운영팀에 알려요. 앱 기록을 함께 보내면 원인을 찾을 수 있어요.",
  repeat: "같은 문제가 반복되고 있어요. 보내 주시면 원인을 찾는 데 도움이 돼요.",
  frustration: "잘 안 되고 있나요? 무슨 일이 있었는지 보내 주시면 운영팀이 확인해요.",
};

export const PROBLEM_DESCRIPTION_MAX = 200;
export const PROBLEM_CONTACT_MAX = 200;

const STEP_LABEL: Record<ProblemStep, string> = {
  chat: "AI 대화", agent: "AI 작업", profile: "연결 확인", access: "사용 권한", safety: "안전 규칙",
  workspace: "작업 폴더 준비", update: "업데이트", attachment: "첨부", other: "기타",
};

export function problemDetailRows(d: ProblemDiagnostic | undefined, appVersion: string, os: string): ProblemReportFormView["details"] {
  if (!d) return [{ label: "앱 버전", value: appVersion }, { label: "운영체제", value: os }];
  return [
    { label: "오류 코드", value: d.code },
    { label: "단계", value: STEP_LABEL[d.step] },
    ...(d.http_status ? [{ label: "응답 상태", value: String(d.http_status) }] : []),
    { label: "앱 버전", value: d.app_version },
    { label: "운영체제", value: d.os },
    ...(d.request_id ? [{ label: "요청 번호", value: d.request_id }] : []),
  ];
}

/** Validates the webview's answer. Anything malformed is a cancel, never a partial send. */
export function parseProblemAnswer(v: unknown): ProblemReportAnswer | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (typeof a.description !== "string" || typeof a.contact !== "string" || typeof a.includeRecentTurns !== "boolean") return null;
  // An answer without the logs choice (an older panel) attaches no log file.
  if (a.includeLogs !== undefined && typeof a.includeLogs !== "boolean") return null;
  if (a.includeDoctor !== undefined && typeof a.includeDoctor !== "boolean") return null;
  const description = a.description.replace(/\s+/g, " ").trim(), contact = a.contact.trim();
  if (description.length > PROBLEM_DESCRIPTION_MAX || contact.length > PROBLEM_CONTACT_MAX) return null;
  return { description, contact, includeRecentTurns: a.includeRecentTurns, includeLogs: a.includeLogs === true, ...(a.includeDoctor === true ? { includeDoctor: true } : {}) };
}

/** #3426 — where the report form was opened from. */
export type ProblemReportEntry = "start_page" | "chat_panel" | "command" | "error_card" | "crash_screen" | "offer" | "unknown";
const ENTRY_LABEL: Record<ProblemReportEntry, string> = {
  start_page: "시작 화면", chat_panel: "대화 창", command: "명령", error_card: "오류 안내", crash_screen: "멈춤 화면", offer: "도움 제안", unknown: "",
};
export interface ProblemReportUiState {
  entry: ProblemReportEntry;
  chat_surface: "editor" | "sidebar" | "hidden";
  active_tab?: string;
  last_error?: { code: string; step: string; age_s: number };
}

/**
 * #3426 — the last visible UI state a report carries, so a report sent with no description still says which screen
 * and action it came from. Only kinds and codes: an open file is named by its extension, never its name or path; a
 * webview by its view type (Studio's own identifiers). No conversation content.
 */
export function problemReportUiState(input: {
  entry: unknown;
  chatSurface: "editor" | "sidebar" | "hidden";
  activeTab?: { kind: "text"; fileName: string } | { kind: "webview"; viewType: string } | { kind: "other" };
  lastProblem?: { diagnostic: { code: string; step: string }; at: number };
  now?: number;
}): ProblemReportUiState {
  const entry = typeof input.entry === "string" && input.entry in ENTRY_LABEL ? input.entry as ProblemReportEntry : "unknown";
  const tab = input.activeTab;
  let active_tab: string | undefined;
  if (tab?.kind === "text") {
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(tab.fileName)?.[1];
    active_tab = `text:${ext ? `.${ext.toLowerCase()}` : "none"}`;
  } else if (tab?.kind === "webview") active_tab = `webview:${tab.viewType.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80)}`;
  else if (tab?.kind === "other") active_tab = "other";
  const lp = input.lastProblem;
  return {
    entry,
    chat_surface: input.chatSurface,
    ...(active_tab ? { active_tab } : {}),
    ...(lp ? { last_error: { code: lp.diagnostic.code, step: lp.diagnostic.step, age_s: Math.max(0, Math.round(((input.now ?? Date.now()) - lp.at) / 1000)) } } : {}),
  };
}

/**
 * The POST /v1/report body for a submitted form. Recent turns are attached only when the person ticked the box;
 * an empty description is replaced by a line naming the diagnostic, because the report route requires one.
 */
export function problemReportBody(
  answer: ProblemReportAnswer,
  ctx: { diagnostic?: ProblemDiagnostic; recentTurns: Array<{ role: "user" | "assistant"; content: string }>; metadata: Record<string, unknown>; requestId?: string; profileId?: string; reason: ProblemFormReason; logs?: { webview_errors: unknown[]; renderer_log?: string; exthost_log?: string }; uiState?: ProblemReportUiState; doctor?: import("./studioDoctor").DoctorAttachment },
): Record<string, unknown> {
  const d = ctx.diagnostic;
  const from = ctx.uiState && ENTRY_LABEL[ctx.uiState.entry] ? ` ${ENTRY_LABEL[ctx.uiState.entry]}에서 보냄` : "";
  const fallback = d ? `(설명 없음) ${d.code} · ${STEP_LABEL[d.step]}` : ctx.reason === "crash" ? "(설명 없음) 화면이 멈췄어요" : `(설명 없음)${from}`;
  // REQ-STUDIO-REPORT-LOGS: crash records always (already redacted, no conversation); log tails only when ticked.
  const errors = ctx.logs?.webview_errors ?? [];
  const tails = answer.includeLogs ? { ...(ctx.logs?.renderer_log ? { renderer_log: ctx.logs.renderer_log } : {}), ...(ctx.logs?.exthost_log ? { exthost_log: ctx.logs.exthost_log } : {}) } : {};
  const logs = errors.length || Object.keys(tails).length ? { webview_errors: errors, ...tails } : undefined;
  return {
    description: answer.description || fallback,
    request_id: d?.request_id ?? ctx.requestId,
    profile_id: ctx.profileId,
    contact: answer.contact || undefined,
    include_recent_turns: answer.includeRecentTurns,
    recent_turns: answer.includeRecentTurns ? ctx.recentTurns : undefined,
    attachments: { ...ctx.metadata, report_source: ctx.reason, ...(d ? { diagnostic: autoReportBody(d) } : {}), ...(ctx.uiState ? { ui_state: ctx.uiState } : {}), ...(answer.includeDoctor && ctx.doctor ? { doctor: ctx.doctor } : {}) },
    ...(logs ? { logs } : {}),
  };
}
