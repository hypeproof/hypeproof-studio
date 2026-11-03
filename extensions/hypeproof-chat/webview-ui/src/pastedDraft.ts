/** View-only paste segments. Persistence, queueing and sending always use fullDraft(). */
export type DraftPart = { text: string; id?: number };
export const pasteLines = (text: string): number => text.split(/\r\n|\r|\n/).length;
export const longPaste = (text: string): boolean => [...text].length > 2000 || pasteLines(text) > 40;
export const fullDraft = (parts: DraftPart[]): string => parts.map(p => p.text).join('');
export const visibleDraft = (parts: DraftPart[]): string => parts.filter(p => p.id === undefined).map(p => p.text).join('');
export function normalizeDraft(parts: DraftPart[]): DraftPart[] {
  const result: DraftPart[] = [{ text: '' }];
  for (const part of parts) {
    const last = result[result.length - 1];
    if (part.id === undefined && last.id === undefined) last.text += part.text;
    else result.push({ ...part });
  }
  if (result[result.length - 1].id !== undefined) result.push({ text: '' });
  return result;
}
/** Visible selections never silently delete hidden paste content; each chip has explicit removal. */
export function replaceVisible(parts: DraftPart[], start: number, end: number, inserted: DraftPart): DraftPart[] {
  const length = visibleDraft(parts).length;
  start = Math.max(0, Math.min(start, length));end = Math.max(start, Math.min(end, length));
  let position = 0, target = 0;
  // At a collapsed boundary the caret is after existing chips, so consecutive pastes retain order.
  parts.forEach((part, index) => {
    if (part.id !== undefined) return;
    if (start >= position && start <= position + part.text.length) target = index;
    position += part.text.length;
  });
  position = 0;
  const result: DraftPart[] = [];
  parts.forEach((part, index) => {
    if (part.id !== undefined) { result.push(part);return; }
    const from = Math.max(0, Math.min(part.text.length, start - position));
    const to = Math.max(from, Math.min(part.text.length, end - position));
    result.push({ text: part.text.slice(0, from) });
    if (index === target) result.push(inserted);
    result.push({ text: part.text.slice(to) });position += part.text.length;
  });
  return normalizeDraft(result);
}
/** Browser input/IME supplies the next visible value; preserve every folded segment. */
export function editVisible(parts: DraftPart[], next: string): DraftPart[] {
  const before = visibleDraft(parts);
  let start = 0, suffix = 0;
  while (start < before.length && start < next.length && before[start] === next[start]) start++;
  while (suffix < before.length - start && suffix < next.length - start && before[before.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  return replaceVisible(parts, start, before.length - suffix, { text: next.slice(start, next.length - suffix) });
}
export function changePaste(parts: DraftPart[], id: number, text: string | null, inline = false): DraftPart[] {
  return normalizeDraft(parts.flatMap(part => part.id !== id ? [part] : text === null ? [] : [{ text, ...(inline ? {} : { id }) }]));
}
