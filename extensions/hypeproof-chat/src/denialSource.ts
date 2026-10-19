// Denial source (REQ-STUDIO-DENIAL-SOURCE; CGP-AGENT-R-007, extends AE-12).
//
// Every denied tool call or disabled feature names WHO decided it, in the learner's words,
// with one next step:
//
//   lesson  — 수업 설정: the Service profile / lesson features (REQ-M38) turned it off;
//   safety  — 안전 규칙: a platform rule (minor protections, a path outside the workspace,
//             a refused address, a tool Studio never gives learners);
//   runtime — 앱 버전/환경: this install cannot run it (missing SDK or binary, a tool this
//             app does not know yet, a connection that does not support it);
//   unknown — 확인 안 됨: the site cannot tell which of the three it is. A site that cannot
//             tell MUST use this rather than guess (AE-12: never mislabel the source).
//
// The coach-facing tool_result text carries the same Korean label as a bracketed tag
// (`denialToolText`), so the coach does not retell a lesson setting as a safety rule.
//
// Pure: no vscode, no DOM, no Node imports. Both the extension host and tests import it.

import type { SeatAudience } from "./seatVocabulary.ts";

export type DenialSource = "lesson" | "safety" | "runtime" | "unknown";

/** The learner-facing label of each source, also the tag in coach-facing tool results. */
export const DENIAL_SOURCE_LABEL: Readonly<Record<DenialSource, string>> = {
  lesson: "수업 설정",
  safety: "안전 규칙",
  runtime: "앱 버전/환경",
  unknown: "확인 안 됨",
};

/**
 * The causes a denial site can actually observe. The classifier maps each to its source;
 * any other value (a new Service code, an empty string, a typo) is `unknown`.
 */
export const DENIAL_CAUSES = {
  // 수업 설정 — the served profile / lesson features decided.
  profile_tool_not_granted: "lesson",
  lesson_feature_off: "lesson",
  // 안전 규칙 — a platform rule decided, whatever the lesson says.
  never_for_learners: "safety",
  path_outside_workspace: "safety",
  url_policy: "safety",
  outside_preview_scope: "safety",
  subagent_not_in_catalog: "safety",
  minor_protection: "safety",
  moderation: "safety",
  // 앱 버전/환경 — this install cannot run it.
  tool_drift: "runtime",
  runtime_unsupported: "runtime",
  sdk_missing: "runtime",
  binary_missing: "runtime",
  needs_newer_app: "runtime",
} as const satisfies Record<string, Exclude<DenialSource, "unknown">>;

export type DenialCause = keyof typeof DENIAL_CAUSES;

/** The source of a cause; anything the table does not list is `unknown` (never a guess). */
export function classifyDenial(cause: string | null | undefined): DenialSource {
  if (typeof cause !== "string") return "unknown";
  return Object.prototype.hasOwnProperty.call(DENIAL_CAUSES, cause)
    ? DENIAL_CAUSES[cause as DenialCause]
    : "unknown";
}

export interface Denial {
  source: DenialSource;
  /** The feature in the learner's words ("커리큘럼 스킬", "명령 실행"). */
  feature?: string;
  /** The site's specific reason in the learner's words, no trailing period needed. */
  reason?: string;
  /**
   * Replaces the default next step for a reader the default does not fit (an instructor
   * surface cannot be told to ask the teacher). One step, no trailing period needed.
   */
  next?: string;
}

/** Final consonant of the last Hangul syllable (0 = none), for 을/를 after a feature name. */
function finalConsonant(w: string): number {
  const t = w.trim();
  const c = t.charCodeAt(t.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
}
const object = (w: string) => `${w}${finalConsonant(w) ? "을" : "를"}`;
const clause = (s: string | undefined, fallback: string) => {
  const t = (s ?? "").trim().replace(/[.。]+$/u, "");
  return t.length > 0 ? t : fallback;
};

/** Where a solo seat (trial, pass, personal) can go: there is no teacher behind it. */
const SOLO_REPORT = "‘문제 신고하기’로 알려 주세요";

/** The learner-facing sentence for a denial. Solo seats never see teacher wording. */
export function denialCopy(d: Denial, audience: SeatAudience = "classroom"): string {
  const feature = clause(d.feature, "이 기능");
  const solo = audience === "solo";
  const next = (fallback: string) => `${clause(d.next, fallback)}.`;
  switch (d.source) {
    case "lesson":
      return solo
        ? `지금 활동에서는 ${object(feature)} 쓰지 않도록 정해져 있어요. ${next("다른 방법으로 이어서 해 볼 수 있어요")}`
        : `이 수업에서는 ${object(feature)} 쓰지 않도록 정해져 있어요. ${next("필요하면 선생님께 이야기해 주세요")}`;
    case "safety":
      return `안전을 위해 Studio가 막았어요 — ${clause(d.reason, "Studio 안전 규칙에 맞지 않는 요청이에요")}. ${next("다른 방법으로 해 볼 수 있어요")}`;
    case "runtime":
      return `이 기능은 지금 앱에서 쓸 수 없어요 — ${clause(d.reason, "이 앱이 아직 지원하지 않아요")}. ${next(`앱을 업데이트하거나 ${solo ? SOLO_REPORT : "선생님께 알려 주세요"}`)}`;
    default:
      return `지금은 ${object(feature)} 쓸 수 없어요 — ${clause(d.reason, "왜 막혔는지 Studio가 확인하지 못했어요")}. ${next(`계속되면 ${solo ? SOLO_REPORT : "선생님께 알려 주세요"}`)}`;
  }
}

/** The bracketed tag the coach and the tool log see in front of the copy. */
export const denialTag = (source: DenialSource): string => `[${DENIAL_SOURCE_LABEL[source]}]`;

/**
 * Coach-facing tool_result text: the tag, the learner copy, and optionally the site's
 * existing instruction to the model. The SDK shows the same text in the learner's tool
 * log, so the learner part comes first and stays in Korean.
 */
export function denialToolText(d: Denial, audience: SeatAudience = "classroom", coachHint?: string): string {
  const hint = coachHint?.trim();
  return `${denialTag(d.source)} ${denialCopy(d, audience)}${hint ? ` ${hint}` : ""}`;
}

/** Shorthand for the commonest site: a lesson feature switched off by the served profile. */
export const lessonFeatureOff = (feature: string, audience: SeatAudience = "classroom"): string =>
  denialCopy({ source: "lesson", feature }, audience);

/** A denial built from an observed cause: the classifier picks the source. */
export const denialFor = (cause: string | null | undefined, rest: Omit<Denial, "source"> = {}): Denial => ({
  source: classifyDenial(cause),
  ...rest,
});

/**
 * The learner's name for an Agent SDK tool, for the lesson-setting copy. Anything not
 * listed is "이 도구": a raw tool name is an English identifier the learner never reads.
 */
export function toolFeatureName(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n === "bash" || n === "powershell" || n === "bashoutput" || n === "killshell" || n === "killbash") return "명령 실행";
  if (n === "websearch" || n === "webfetch") return "웹 검색";
  if (n === "write" || n === "edit" || n === "multiedit" || n === "notebookedit") return "파일 고치기";
  if (n === "read" || n === "glob" || n === "grep" || n === "ls" || n === "notebookread") return "파일 읽기";
  if (n === "agent" || n === "task") return "도우미에게 맡기기";
  if (n === "mcp__hypeproof__consult") return "도우미에게 묻기";
  if (n === "mcp__hypeproof__publish_site") return "홈페이지 올리기";
  if (n.startsWith("mcp__hypeproof__browser_") || n === "mcp__hypeproof__live_preview_start") return "브라우저";
  return "이 도구";
}
