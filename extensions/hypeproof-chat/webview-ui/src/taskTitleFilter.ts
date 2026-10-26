/**
 * REQ-STUDIO-TASK-RAIL-SEARCH (CGP-KNOW-R-001): the task rail search matches task titles only,
 * on the device, with no host or model request.
 *
 * Both sides are compared in Unicode NFC, so a title saved in decomposed jamo (macOS file names,
 * pasted text) still matches the composed syllables a Korean IME commits. Case is folded and the
 * query's outer whitespace is ignored; a blank query shows every task.
 */
export const TASK_SEARCH_MAX = 160; // the longest title the store accepts (taskWorkspaceStore normalizedTitle)

export function taskSearchKey(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

export function filterTasksByTitle<T extends { title: string }>(tasks: readonly T[], query: string): T[] {
  const needle = taskSearchKey(query.trim());
  if (!needle) return [...tasks];
  return tasks.filter(task => taskSearchKey(task.title).includes(needle));
}

/** One slice of a title; `match` marks text the query matched (shown bold, never colour only). */
export interface TitlePart { text: string; match?: true }

const clusters = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * CGP-CHAT-D-026: the title split into plain and matched parts, with the filter's own key. Each
 * grapheme cluster is folded on its own, so a match maps back to the characters as stored (a
 * decomposed syllable included); a match that starts or ends inside a cluster marks the whole
 * cluster. The parts always join back to the exact title, and a title the key cannot place is one
 * plain part.
 */
export function markTitleMatches(title: string, query: string): TitlePart[] {
  const needle = taskSearchKey(query.trim());
  if (!needle) return [{ text: title }];
  const pieces = Array.from(clusters.segment(title), part => part.segment);
  const bounds: number[] = [];
  let key = '';
  for (const piece of pieces) { bounds.push(key.length); key += taskSearchKey(piece); }
  bounds.push(key.length);
  const hit = pieces.map(() => false);
  for (let at = key.indexOf(needle); at !== -1; at = key.indexOf(needle, at + needle.length)) {
    const end = at + needle.length;
    pieces.forEach((_, index) => { if (bounds[index] < end && bounds[index + 1] > at) hit[index] = true; });
  }
  const parts: TitlePart[] = [];
  pieces.forEach((piece, index) => {
    const last = parts[parts.length - 1];
    if (last && !!last.match === hit[index]) last.text += piece;
    else parts.push(hit[index] ? { text: piece, match: true } : { text: piece });
  });
  return parts.length ? parts : [{ text: title }];
}
