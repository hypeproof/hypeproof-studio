// REQ-STUDIO-MEMORY-NOTICE (CGP-KNOW-R-031 / REQ-KNOW-49, CGP-KNOW-D-031 / DES-KNOW-49; DEC-01, DEC-02) — the one-time
// memory notice: the first time memory would be used in an activity, the learner reads once what is stored, where, who
// reads it and how to delete it, and presses 확인. It is a notice, not a consent switch: memory stays on (DEC-02) and
// there is no 켜기/나중에 choice and no off option. Dependency-free, so the host and the webview import the same words.
//
// The record is the one REQ-KNOW-44 (CGP-KNOW-R-026) reads before a request may carry memory: workspaceState
// `hps.memoryNotice.v1`, activity id → `true`, written only by the learner's 확인 on this notice.

export const MEMORY_NOTICE_KEY = "hps.memoryNotice.v1";
/** At most this many activities are remembered; the oldest go first (an activity seen again is moved to the end). */
export const MEMORY_NOTICE_MAX = 500;
const ACTIVITY_MAX = 600;

/** DES-KNOW-49 — four short lines and one 확인 button. Every cohort reads the same words, minor cohorts included. */
export const MEMORY_NOTICE_COPY = {
  title: "AI 기억 안내",
  lines: [
    { label: "무엇을", text: "이 작업 공간에서 기억해 둔 내용을 짧은 글 파일로 남겨요." },
    { label: "어디에", text: "작업 공간 폴더 안 .hypeproof/memory/ 에 있어요." },
    { label: "누가 보는지", text: "나, 그리고 내 질문에 답할 때 기억을 함께 받는 AI 코치예요." },
    { label: "지우는 법", text: "내 작품의 ‘기억’에서 하나씩 지우거나 모두 지울 수 있어요." },
  ],
  confirm: "확인",
} as const;

/** What the host tells the chat: the activity whose notice is due, or null (seen, no memory to use, or no memory here). */
export interface MemoryNoticeView { activity: string }

const validActivity = (activity: unknown): activity is string =>
  typeof activity === "string" && activity.length > 0 && activity.length <= ACTIVITY_MAX && activity !== "__proto__";

/** Whether the learner pressed 확인 on this activity's notice. Anything but an own `true` is "not seen". */
export function memoryNoticeSeen(stored: unknown, activity: string | null | undefined): boolean {
  if (!activity || !stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  return Object.hasOwn(stored, activity) && (stored as Record<string, unknown>)[activity] === true;
}

/** The record after 확인 in `activity`: valid entries kept, this one added last, capped. null for an unusable activity. */
export function markMemoryNoticeSeen(stored: unknown, activity: unknown): Record<string, true> | null {
  if (!validActivity(activity)) return null;
  const kept = stored && typeof stored === "object" && !Array.isArray(stored)
    ? Object.entries(stored as Record<string, unknown>).filter(([key, value]) => value === true && validActivity(key) && key !== activity).map(([key]) => key)
    : [];
  const out: Record<string, true> = Object.create(null);
  for (const key of [...kept, activity].slice(-MEMORY_NOTICE_MAX)) out[key] = true;
  return out;
}

/**
 * The notice is due when this seat has the activity's personal memory store (the R-005 binding: personal and trial
 * activities, never a class, a lesson or an instructor), the learner has not pressed 확인 here, and the store holds
 * something a request would use. An empty store uses no memory, so it shows nothing yet.
 */
export function memoryNoticeDue(input: { activity: string | null | undefined; bound: boolean; stored: unknown; items: number }): MemoryNoticeView | null {
  if (!input.bound || !validActivity(input.activity) || input.items < 1) return null;
  return memoryNoticeSeen(input.stored, input.activity) ? null : { activity: input.activity };
}
