// #4102 — the rehearsal panel's state and words. The verdicts and notes live here (not in React state) so the send
// button in the lesson step panel can read the checklist it reports. Only the rehearsal seat draws any of this.

export type ChecklistVerdict = "fits" | "fix";
export interface ChecklistEntry { verdict?: ChecklistVerdict; note?: string }
export interface ChecklistMark { id: string; verdict: ChecklistVerdict; note?: string }

const entries = new Map<string, ChecklistEntry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version += 1; listeners.forEach((listener) => listener()); };

export function subscribeChecklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const checklistVersion = (): number => version;
export const getChecklistEntry = (id: string): ChecklistEntry | undefined => entries.get(id);

/** 알맞음 / 고칠 것. `undefined` unmarks the item (it is then not sent). */
export function setChecklistVerdict(id: string, verdict: ChecklistVerdict | undefined): void {
  entries.set(id, { ...entries.get(id), verdict });
  emit();
}
export function setChecklistNote(id: string, note: string): void {
  entries.set(id, { ...entries.get(id), note });
  emit();
}
/** The marked items only, for the rehearsal report. */
export function checklistSnapshot(): ChecklistMark[] {
  const out: ChecklistMark[] = [];
  for (const [id, entry] of entries) {
    if (!entry.verdict) continue;
    out.push(entry.verdict === "fix" && entry.note ? { id, verdict: "fix", note: entry.note } : { id, verdict: entry.verdict });
  }
  return out;
}
export function resetChecklist(): void {
  entries.clear();
  emit();
}

// ── Approved wording (chalk-po 2026-11-14, copied as is) ──
export const ROUTE_TITLE = "리허설과 수업의 차이";
export const CHECKLIST_TITLE = "예상 막힘 점검";
export const CHECKLIST_EMPTY = "계획서 13절에 예상 막힘이 없습니다.";
export const INSERT_BUTTON = "학생 말 넣기";
export const VERDICT_FITS = "알맞음";
export const VERDICT_FIX = "고칠 것";
export const NOTE_HINT = "무엇을 고칠지 적으세요";
export const MODEL_DIFFERS = "리허설 모델과 수업 모델이 다릅니다. 학생이 받는 답과 다를 수 있습니다.";
export const MINOR_LINES = ["리허설에서는 미성년 내용 검사가 없습니다.", "리허설에서는 미성년 답변 길이 제한이 없습니다."] as const;
export const RECORD_LINE = "리허설 대화는 서버 기록에 남지 않습니다.";
const UNKNOWN_MODEL = "알 수 없음";

export interface RehearsalRoute { rehearsalModel: string | null; lessonModel: string | null; minor: boolean }

/** The route band's lines. The difference is only said when both names are known and differ. */
export function routeLines(route: RehearsalRoute): { rehearsal: string; lesson: string; difference?: string; minor: string[]; record: string } {
  const rehearsal = route.rehearsalModel ?? UNKNOWN_MODEL;
  const lesson = route.lessonModel ?? UNKNOWN_MODEL;
  const differs = route.rehearsalModel !== null && route.lessonModel !== null && route.rehearsalModel !== route.lessonModel;
  return {
    rehearsal: `리허설: 내 구독 · ${rehearsal}`,
    lesson: `수업: 서버 · ${lesson}`,
    ...(differs ? { difference: MODEL_DIFFERS } : {}),
    minor: route.minor ? [...MINOR_LINES] : [],
    record: RECORD_LINE,
  };
}
