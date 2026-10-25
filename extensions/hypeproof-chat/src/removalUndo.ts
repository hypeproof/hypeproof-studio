// CGP-CHAT-R-029 (REQ-STUDIO-REMOVAL-UNDO) — low-stakes removals offer 되돌리기 instead of a confirm.
// Shared by the host (file/page chip snapshots, task rename) and the webview (the toast).
//
// Rules this module encodes:
// - One undo at a time. A newer removal replaces the older toast, and the older removal stays done.
// - Undo restores the exact prior state or nothing: the host restores the snapshot it kept, never
//   content the webview sends back, and only while the slot is still empty, in the same task scope.
// - Recovery items (보내지 못한 메시지, UX38) are not low-stakes: they keep confirm + 취소.

/** How long the toast stays up, while neither hovered nor focused (CGP-CHAT-D85). */
export const UNDO_TOAST_MS = 6000;
export const UNDO_LABEL = '되돌리기';
export const UNDO_DONE = '되돌렸어요';

export type RemovalKind = 'image' | 'photo' | 'paste' | 'file' | 'page' | 'queued' | 'rename';

/** Learner copy: what just happened, in plain words. The undo button carries the action. */
export const REMOVAL_COPY: Record<RemovalKind, string> = {
  image: '이미지를 뺐어요',
  photo: '사진을 뺐어요',
  paste: '붙여넣은 글을 뺐어요',
  file: '파일을 뺐어요',
  page: '페이지를 뺐어요',
  queued: '예약을 취소했어요. 글은 입력창에 있어요',
  rename: '작업 이름을 바꿨어요',
};

/** Undo ids travel webview → host; anything else is ignored. */
export const validUndoId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/**
 * One host-held snapshot of a removed attachment. `restore` puts the exact object back and returns
 * whether it did. The slot forgets the snapshot on restore, on a newer removal and on `forget()`.
 */
export interface RemovedSnapshot<T> { id: string; scope: string; value: T }
export class RemovalSlot<T> {
  private held: RemovedSnapshot<T> | null = null;
  keep(id: unknown, scope: string, value: T): void {
    this.held = validUndoId(id) ? { id, scope, value } : null;
  }
  /** Drop the snapshot; true when one was held. */
  forget(): boolean { const had = this.held !== null; this.held = null; return had; }
  /** The snapshot for this id and scope, consumed; null when it is gone, another id or another scope. */
  take(id: unknown, scope: string): T | null {
    const held = this.held;
    if (!held || !validUndoId(id) || held.id !== id || held.scope !== scope) return null;
    this.held = null;
    return held.value;
  }
}

/** What a rename changed, kept by the host so 되돌리기 can put the title and its origin back. */
export interface RenameUndo<Origin extends string = string> {
  taskId: string;
  renamedTo: string;
  title: string;
  titleOrigin: Origin | undefined;
}
