// AE-02 / AE-41 (#555, the `context` work packet) — a text material the learner took out of the conversation stays out of
// every later model request. First slice: 자료 text files only (`kind: "file"`). Pages, images, URLs, instructor notes and
// tool reads are not offered as excludable, so the UI never says they were left out.
//
// What reaches the model is decided by host state, never by text:
// - The material list (activityMaterials.ts) keeps the excluded ids per work folder.
// - A mark beside the transcript records, per user message id, which materials went with that message. It sits beside the
//   transcript like the lesson step marks, so the task file keeps the shape older builds accept.
//
// A material's text itself is never in the saved history: it rode only on its turn's model text. What can still carry it
// are the AI's answers after it was sent, and the host cannot trace those (AE-41). So, from the first message that carried
// an excluded material onward, every assistant answer is replayed as one fixed line. The turn then gets a rebuilt context:
// the learner's confirmed goal and the kept materials from that span, read again from their files. The learner's own
// messages are kept as written.
//
// Prompt safety: OMITTED_REPLY and REBUILT_CONTEXT_HEAD are fixed strings. They describe what was left out and give the
// model no instruction. A learner who types either string changes nothing, because exclusion is keyed by material id in
// host state. The goal and the material text inside the rebuilt context are defused like any other quoted learner text.
//
// Cost: the replay is a pure function of (saved history, marks, excluded ids), so it is the same on every turn until the
// learner changes an exclusion. The provider prompt cache misses once at that change, from the first replaced answer
// onward, and then the prefix is stable again. No runtime session is created for it: every turn already sends its history
// in the prompt (sdkCoach.ts, proxyClient.ts), and an exclusion adds no request.
//
// Pure (no vscode, no fs), so the smoke runs it directly.

import { defuseTag } from "./dataTag.ts";

/** The only kinds that can be taken out in this slice. */
export const EXCLUDABLE_KINDS: readonly string[] = ["file"];
/** At most this many kept materials from the replaced span are read again into the rebuilt context. */
export const REBUILT_MATERIALS_MAX = 3;
/** At most this many marks are kept per workspace; the oldest go first. */
export const MATERIAL_MARKS_MAX = 400;

/** The fixed line that replaces an AI answer the host cannot trace. Descriptive only. */
export const OMITTED_REPLY = "[학습자가 뺀 자료를 보낸 뒤의 답이라 다시 보내지 않습니다.]";
/** The fixed head of the rebuilt context. Descriptive only. */
export const REBUILT_CONTEXT_HEAD = "[학습자가 일부 자료를 이후 대화에서 뺐습니다. 그 자료를 처음 보낸 뒤의 AI 답은 대화에서 빠져 있습니다. 아래는 학습자가 확인한 목표와 계속 쓰는 자료입니다.]";

/** Learner-facing copy lives with the view (the webview imports it); re-exported for the host. */
export { CONTEXT_EXCLUSION_COPY } from "./activityMaterialsView.ts";

export interface ReplayMessage { id?: string; role: string; content: string }
/** Material ids per user message id. */
export type MaterialMarks = Record<string, string[]>;

/** A stored id list read back defensively: id strings only, no duplicates, bounded (newest kept). */
export function excludedList(stored: unknown, max = 200): string[] {
  const raw = Array.isArray(stored) ? stored : [];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 600))].slice(-max);
}

/** The excluded list after taking `id` out (on) or putting it back (off). */
export function withExclusion(stored: unknown, id: string, on: boolean): string[] {
  const rest = excludedList(stored).filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

/** Stored marks read back defensively: message ids to short lists of material ids. Anything else is dropped. */
export function acceptMaterialMarks(stored: unknown): MaterialMarks {
  const out: MaterialMarks = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const [id, ids] of Object.entries(stored as Record<string, unknown>).slice(-MATERIAL_MARKS_MAX)) {
    if (!id || id.length > 256 || !Array.isArray(ids)) continue;
    const list = excludedList(ids, 8);
    if (list.length) out[id] = list;
  }
  return out;
}

/** The marks after recording `ids` for `messageId` (newest last, bounded). */
export function rememberMaterialMark(marks: unknown, messageId: string, ids: readonly string[]): MaterialMarks {
  const rest = Object.entries(acceptMaterialMarks(marks)).filter(([id]) => id !== messageId);
  const list = excludedList(ids, 8);
  return Object.fromEntries((list.length ? [...rest, [messageId, list] as [string, string[]]] : rest).slice(-MATERIAL_MARKS_MAX));
}

const idsOf = (m: ReplayMessage, marks: MaterialMarks): readonly string[] =>
  m.role === "user" && m.id && Object.prototype.hasOwnProperty.call(marks, m.id) ? marks[m.id] : [];

/** Ids of every material that went with a user message in this history. */
export function sentMaterialIds(history: readonly ReplayMessage[], marks: MaterialMarks): Set<string> {
  const out = new Set<string>();
  for (const m of history) for (const id of idsOf(m, marks)) out.add(id);
  return out;
}

/**
 * The history the model gets. Nothing changes unless a user message carried an excluded material. From the first such
 * message, assistant answers become OMITTED_REPLY. `kept` lists the materials from that span that are still in, newest
 * first, for the rebuilt context. Messages keep their other fields.
 */
export function replayHistory<M extends ReplayMessage>(history: readonly M[], marks: MaterialMarks, excluded: ReadonlySet<string>): { history: M[]; cut: boolean; kept: string[] } {
  const at = excluded.size ? history.findIndex((m) => idsOf(m, marks).some((id) => excluded.has(id))) : -1;
  if (at < 0) return { history: [...history], cut: false, kept: [] };
  const kept: string[] = [];
  for (let i = history.length - 1; i >= at; i--) for (const id of idsOf(history[i], marks)) if (!excluded.has(id) && !kept.includes(id)) kept.push(id);
  return {
    history: history.map((m, i) => (i >= at && m.role === "assistant" ? { ...m, content: OMITTED_REPLY } : m)),
    cut: true,
    kept: kept.slice(0, REBUILT_MATERIALS_MAX),
  };
}

/** The model-only context for a replay that was cut: the fixed head, the confirmed goal, and the kept materials' text. */
export function rebuiltContext(goal: string | null | undefined, keptMaterialsText: string | null | undefined): string {
  const parts = [REBUILT_CONTEXT_HEAD];
  if (goal && goal.trim()) parts.push(`학습자가 확인한 목표: ${defuseTag(goal.trim(), "material").replace(/[\r\n]+/g, " ")}`);
  if (keptMaterialsText && keptMaterialsText.trim()) parts.push(keptMaterialsText);
  return parts.join("\n");
}
