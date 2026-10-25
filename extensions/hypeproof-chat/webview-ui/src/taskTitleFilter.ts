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
