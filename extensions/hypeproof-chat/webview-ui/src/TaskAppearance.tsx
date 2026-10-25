import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { TASK_COLOURS, TASK_EMOJI, taskColour, taskEmoji, type TaskAppearance, type TaskColourId, type TaskEmojiId } from '../../src/taskAppearance';
import type { TaskSummary } from '../../src/taskWorkspaceContract';
import { ChatIcon } from './ChatDetails';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { finishModal } from './modalMotion';
import { onHostMessage, postToHost } from './vscode';
import './modalSurface.css';
import './taskAppearance.css';

/**
 * CGP-KNOW-R-008 — the mark drawn before a task title in the list. It is decoration only: the task
 * button's accessible name is the title, the mark is aria-hidden, and the title is always drawn next
 * to it, so neither the emoji nor the colour is ever the only cue.
 */
export function TaskMark({ appearance }: { appearance?: TaskAppearance }) {
  const emoji = taskEmoji(appearance?.emoji), colour = taskColour(appearance?.colour);
  if (!emoji && !colour) return null;
  return <span className="tw-task-mark" aria-hidden="true" data-colour={colour?.id}>
    {colour && <span className="tw-task-swatch" />}
    {emoji && <span className="tw-task-emoji">{emoji.glyph}</span>}
  </span>;
}

/** Set by the task workspace when the open task can take a mark; the task menu reads it. */
export const TaskAppearanceContext = createContext<{ open: (() => void) | null }>({ open: null });
export const useTaskAppearance = () => useContext(TaskAppearanceContext);
export const TASK_APPEARANCE_LABEL = '아이콘과 색 정하기';

const requestId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `appearance-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * The picker for one task. It is bound to the task it was opened for: a result for another request
 * or task is ignored, and the workspace unmounts it when the open task changes.
 */
export function TaskAppearanceDialog({ task, onClose }: { task: TaskSummary; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), composing = useRef(false), closing = useRef(false);
  const [emoji, setEmoji] = useState<TaskEmojiId | ''>(task.appearance?.emoji ?? '');
  const [colour, setColour] = useState<TaskColourId | ''>(task.appearance?.colour ?? '');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    finishModal(dialog.current, onClose);
  };
  useDialogFocus(dialog, { open: true, kind: 'modal', initialFocus: 'input:checked', keepFocusOnDismiss: true,
    opener: () => document.querySelector<HTMLElement>('.tw-chat-menu-toggle'), onDismiss: close });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLElement>('input:checked')?.focus();
    return () => node?.close();
  }, []);
  useEffect(() => onHostMessage(message => {
    if (message.type !== 'taskAppearanceResult' || message.requestId !== pendingRef.current || message.taskId !== task.id) return;
    pendingRef.current = null;
    setPending(null);
    if (message.saved) close();
    else setError('아이콘과 색을 저장하지 못했습니다. 고른 것은 그대로 있어요. 다시 시도해 주세요.');
  }), [task.id]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      if (pendingRef.current !== pending) return;
      pendingRef.current = null;
      setPending(null);
      setError('저장 결과를 확인하지 못했습니다. 고른 것은 그대로 있어요. 다시 시도해 주세요.');
    }, 15000);
    return () => clearTimeout(timer);
  }, [pending]);
  const save = () => {
    if (pendingRef.current) return;
    const id = requestId();
    pendingRef.current = id;
    setPending(id);
    setError(null);
    const appearance: TaskAppearance | null = emoji || colour ? { ...(emoji ? { emoji } : {}), ...(colour ? { colour } : {}) } : null;
    postToHost({ type: 'taskAppearance', appearance, requestId: id });
  };
  return <dialog ref={dialog} className="hp-modal tw-appearance" aria-labelledby="task-appearance-title" aria-describedby="task-appearance-help"
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDownCapture={event => { if (imeComposing(event, composing.current)) event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); if (!composing.current) close(); }}>
    <form method="dialog" onSubmit={event => { event.preventDefault(); save(); }}>
      <h2 id="task-appearance-title">{TASK_APPEARANCE_LABEL}</h2>
      <p id="task-appearance-help">목록에서 ‘{task.title}’ 작업을 쉽게 찾도록 표시를 붙여요. 작업 이름은 그대로예요.</p>
      <fieldset className="tw-appearance-group" disabled={!!pending}>
        <legend>아이콘</legend>
        <div className="tw-appearance-options">
          <label className="tw-appearance-option" data-selected={emoji === '' || undefined}>
            <input type="radio" name="task-emoji" value="" checked={emoji === ''} onChange={() => setEmoji('')} />
            <span>없음</span>
          </label>
          {TASK_EMOJI.map(entry => <label key={entry.id} className="tw-appearance-option tw-appearance-emoji" data-selected={emoji === entry.id || undefined} data-hp-tooltip={entry.name}>
            <input type="radio" name="task-emoji" value={entry.id} aria-label={entry.name} checked={emoji === entry.id} onChange={() => setEmoji(entry.id)} />
            <span aria-hidden="true">{entry.glyph}</span>
          </label>)}
        </div>
      </fieldset>
      <fieldset className="tw-appearance-group" disabled={!!pending}>
        <legend>색</legend>
        <div className="tw-appearance-options">
          <label className="tw-appearance-option tw-appearance-colour" data-selected={colour === '' || undefined}>
            <input type="radio" name="task-colour" value="" checked={colour === ''} onChange={() => setColour('')} />
            <span>없음</span>
            {colour === '' && <ChatIcon kind="check" size={16} />}
          </label>
          {TASK_COLOURS.map(entry => <label key={entry.id} className="tw-appearance-option tw-appearance-colour" data-colour={entry.id} data-selected={colour === entry.id || undefined}>
            <input type="radio" name="task-colour" value={entry.id} checked={colour === entry.id} onChange={() => setColour(entry.id)} />
            <span className="tw-task-swatch" aria-hidden="true" />
            <span>{entry.name}</span>
            {colour === entry.id && <ChatIcon kind="check" size={16} />}
          </label>)}
        </div>
      </fieldset>
      {error && <p className="tw-error" role="alert">{error}</p>}
      <div className="tw-appearance-actions">
        <button type="button" className="tw-quiet" onClick={close}>취소</button>
        <button type="submit" className="tw-appearance-save" disabled={!!pending} aria-busy={!!pending}>{pending ? '저장 중…' : '저장'}</button>
      </div>
    </form>
  </dialog>;
}
