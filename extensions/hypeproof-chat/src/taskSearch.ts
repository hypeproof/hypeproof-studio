/**
 * CGP-CHAT-R-026 — search the learner's own tasks on this device. The host owns the task files, so
 * the search runs over the store's in-memory copy: no model call, no Service call, no network.
 */
import type { ChatMessage } from './protocol';

export interface TaskSearchSource {
  id: string;
  title: string;
  updatedAt: number;
  messages: readonly Pick<ChatMessage, 'id' | 'role' | 'content' | 'createdAt'>[];
}

/** One plain-text slice; `match` marks the part that equals the query (shown bold, never colour only). */
export interface TaskSearchPart { text: string; match?: true }

export interface TaskSearchResult {
  taskId: string;
  title: TaskSearchPart[];
  /** The matched message (latest match in the task); absent when only the task name matched. */
  messageId?: string;
  snippet: TaskSearchPart[];
  /** The matched message's time, or the task's last update for a name match. */
  at: number;
}

export const TASK_SEARCH_QUERY_MAX = 100;
export const TASK_SEARCH_RESULT_MAX = 50;
const MESSAGE_SCAN_MAX = 100_000;
const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 56;

/**
 * Display-safe plain text: NFKC, no control, format or bidi characters (U+2028/2029 become spaces),
 * one space between words. React renders the parts as text nodes, never as HTML.
 */
export function searchPlainText(value: string, max = MESSAGE_SCAN_MAX): string {
  return value.slice(0, max).normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function normalizeTaskQuery(query: unknown): string {
  if (typeof query !== 'string') return '';
  return Array.from(searchPlainText(query, TASK_SEARCH_QUERY_MAX * 4)).slice(0, TASK_SEARCH_QUERY_MAX).join('').trim();
}

/** Lowercase per UTF-16 unit range so match offsets map back onto the displayed text. */
function folded(text: string): { value: string; at: number[] } {
  let value = '';
  const at: number[] = [];
  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index)!;
    const char = String.fromCodePoint(point);
    const lower = char.toLocaleLowerCase();
    for (let i = 0; i < lower.length; i++) at.push(index);
    value += lower;
    index += char.length;
  }
  at.push(text.length);
  return { value, at };
}

/** Index range [start, end) in `text` of the last (or first) occurrence of `needle`, case-insensitive. */
function findRange(text: string, needle: string, last: boolean): [number, number] | null {
  const hay = folded(text);
  const want = folded(needle).value;
  if (!want) return null;
  const hit = last ? hay.value.lastIndexOf(want) : hay.value.indexOf(want);
  if (hit < 0) return null;
  const start = hay.at[hit];
  let end = hay.at[hit + want.length] ?? text.length;
  if (end <= start) end = start + 1;
  return [start, end];
}

/** Every case-insensitive occurrence inside `text`, split into plain and matched parts. */
function marked(text: string, needle: string): TaskSearchPart[] {
  const parts: TaskSearchPart[] = [];
  let rest = text;
  for (let guard = 0; rest && guard < 50; guard++) {
    const range = findRange(rest, needle, false);
    if (!range) break;
    if (range[0] > 0) parts.push({ text: rest.slice(0, range[0]) });
    parts.push({ text: rest.slice(range[0], range[1]), match: true });
    rest = rest.slice(range[1]);
  }
  if (rest) parts.push({ text: rest });
  return parts;
}

function snippetAround(text: string, range: [number, number], needle: string): TaskSearchPart[] {
  const points = Array.from(text);
  // Convert UTF-16 offsets to code-point offsets so a cut never splits a surrogate pair.
  const startPoint = Array.from(text.slice(0, range[0])).length;
  const endPoint = startPoint + Array.from(text.slice(range[0], range[1])).length;
  const from = Math.max(0, startPoint - SNIPPET_BEFORE);
  const to = Math.min(points.length, endPoint + SNIPPET_AFTER);
  const body = points.slice(from, to).join('');
  const parts = marked(body, needle);
  if (from > 0) parts.unshift({ text: '…' });
  if (to < points.length) parts.push({ text: '…' });
  return parts;
}

/**
 * One result per task: the task's latest matching user or assistant message, else a name match.
 * Tool lines, system notices and earlier (superseded) answer versions are not searched: they are
 * not the conversation the learner reads, and a result must be scrollable to.
 */
export function searchTasks(tasks: readonly TaskSearchSource[], rawQuery: unknown): TaskSearchResult[] {
  const query = normalizeTaskQuery(rawQuery);
  if (!query) return [];
  const results: TaskSearchResult[] = [];
  for (const task of tasks) {
    const title = searchPlainText(task.title, 400);
    const titleMatch = !!findRange(title, query, false);
    let hit: TaskSearchResult | null = null;
    for (let index = task.messages.length - 1; index >= 0 && !hit; index--) {
      const message = task.messages[index];
      if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') continue;
      const text = searchPlainText(message.content);
      const range = findRange(text, query, true);
      if (!range) continue;
      hit = { taskId: task.id, title: titleMatch ? marked(title, query) : [{ text: title }], messageId: message.id,
        snippet: snippetAround(text, range, query), at: Number.isFinite(message.createdAt) ? message.createdAt : task.updatedAt };
    }
    if (!hit && titleMatch) hit = { taskId: task.id, title: marked(title, query), snippet: [], at: task.updatedAt };
    if (hit) results.push(hit);
  }
  return results.sort((a, b) => b.at - a.at || a.taskId.localeCompare(b.taskId)).slice(0, TASK_SEARCH_RESULT_MAX);
}
