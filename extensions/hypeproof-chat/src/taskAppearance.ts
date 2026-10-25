/**
 * CGP-KNOW-R-008 / REQ-STUDIO-TASK-APPEARANCE — an optional emoji and colour per task, so a learner
 * who reads slowly can find a task in the list. Both are picked from fixed lists and stored as ids:
 * no free text reaches the task list, the store or the accessible name. The task title stays the
 * accessible name; the emoji is drawn aria-hidden and colour is never the only cue (the title is
 * always shown next to it).
 *
 * Shared by the host (validation, the sidecar) and the webview (picker, rail mark).
 */

/** Learner-chosen pictures are task content, not status icons, so they are emoji (CGP-DS-R-018 covers status glyphs). */
export const TASK_EMOJI = [
  { id: 'star', glyph: '⭐', name: '별' },
  { id: 'rocket', glyph: '🚀', name: '로켓' },
  { id: 'palette', glyph: '🎨', name: '그림' },
  { id: 'books', glyph: '📚', name: '책' },
  { id: 'microscope', glyph: '🔬', name: '실험' },
  { id: 'music', glyph: '🎵', name: '음악' },
  { id: 'sprout', glyph: '🌱', name: '새싹' },
  { id: 'cat', glyph: '🐱', name: '고양이' },
  { id: 'ball', glyph: '⚽', name: '공' },
  { id: 'bulb', glyph: '💡', name: '아이디어' },
  { id: 'puzzle', glyph: '🧩', name: '퍼즐' },
  { id: 'house', glyph: '🏠', name: '집' },
] as const;

/** DES-KNOW-13: eight colours, each with a Korean name. The drawn value is a design token per theme. */
export const TASK_COLOURS = [
  { id: 'red', name: '빨강' },
  { id: 'orange', name: '주황' },
  { id: 'yellow', name: '노랑' },
  { id: 'green', name: '초록' },
  { id: 'teal', name: '청록' },
  { id: 'blue', name: '파랑' },
  { id: 'purple', name: '보라' },
  { id: 'pink', name: '분홍' },
] as const;

export type TaskEmojiId = typeof TASK_EMOJI[number]['id'];
export type TaskColourId = typeof TASK_COLOURS[number]['id'];
/** At least one of the two is set; "no appearance" is the absence of the record. */
export interface TaskAppearance { emoji?: TaskEmojiId; colour?: TaskColourId }

const emojiIds: readonly string[] = TASK_EMOJI.map(entry => entry.id);
const colourIds: readonly string[] = TASK_COLOURS.map(entry => entry.id);

/** Exact shape: only known keys, only listed ids, at least one set. */
export function validTaskAppearance(value: unknown): value is TaskAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length || keys.some(key => key !== 'emoji' && key !== 'colour')) return false;
  if (record.emoji !== undefined && (typeof record.emoji !== 'string' || !emojiIds.includes(record.emoji))) return false;
  if (record.colour !== undefined && (typeof record.colour !== 'string' || !colourIds.includes(record.colour))) return false;
  return record.emoji !== undefined || record.colour !== undefined;
}

/** A save request: an appearance, or null to clear it. Anything else is refused. */
export function parseTaskAppearanceRequest(value: unknown): TaskAppearance | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  // Keep only defined keys, so `{ emoji: undefined }` after JSON transport reads as nothing chosen.
  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined);
  if (!entries.length) return null;
  const candidate: unknown = Object.fromEntries(entries);
  if (!validTaskAppearance(candidate)) return undefined;
  return { ...(candidate.emoji ? { emoji: candidate.emoji } : {}), ...(candidate.colour ? { colour: candidate.colour } : {}) };
}

export const taskEmoji = (id: TaskEmojiId | undefined) => TASK_EMOJI.find(entry => entry.id === id);
export const taskColour = (id: TaskColourId | undefined) => TASK_COLOURS.find(entry => entry.id === id);
