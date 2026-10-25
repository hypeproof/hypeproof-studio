import { useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';
import type { MentionFile } from '../../src/workspaceFileMentions';
import { onHostMessage, postToHost } from './vscode';
import { ChatIcon } from './ChatDetails';
export function mentionAt(text: string, caret: number): { start: number; end: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]{0,256})$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null;
}
/** Unique per panel: the sidebar and the editor chat each run this module, so a counter would collide. */
export function mentionRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return `mention-${crypto.randomUUID()}`;
  return `mention-${Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function useFileMentions({ enabled, draft, setDraft, editor, composing, activityId, taskId }: {
  enabled: boolean; draft: string; setDraft: Dispatch<SetStateAction<string>>; editor: RefObject<HTMLTextAreaElement>; composing: boolean; activityId?: string; taskId?: string;
}) {
  const [caret, setCaret] = useState(0), [dismissed, setDismissed] = useState('');
  const [state, setState] = useState<{ requestId: string; files: MentionFile[]; loading: boolean; pending: boolean; limited: boolean; error?: string } | null>(null);
  const [selected, setSelected] = useState(0), id = useId();
  const current = useRef(draft);current.current = draft;
  const signature = `${draft}\0${caret}`;
  const trigger = enabled && !composing && dismissed !== signature ? mentionAt(draft, caret) : null;
  const query = trigger?.query, start = trigger?.start;
  useEffect(() => {
    setState(null);setSelected(0);
    if (query === undefined || start === undefined) return;
    const requestId = mentionRequestId();
    let live = true;
    setState({ requestId, files: [], loading: true, pending: false, limited: false });
    const off = onHostMessage(message => {
      if (!live || (message.activityId && message.activityId !== activityId) || (message.taskId && message.taskId !== taskId)) return;
      if (message.type === 'fileMentionResults' && message.requestId === requestId) {
        setState({ requestId, files: message.files, limited: message.limited, loading: false, pending: false, error: message.error });setSelected(0);
      }
      if (message.type === 'fileMentionPicked' && message.requestId === requestId) {
        if (message.ok) {
          setDraft(previous => previous === draft ? previous.slice(0, start) + previous.slice(caret) : previous);
          setState(null);setDismissed(signature);
          requestAnimationFrame(() => { editor.current?.focus({preventScroll:true});if(current.current === draft.slice(0,start)+draft.slice(caret)) editor.current?.setSelectionRange(start,start); });
        } else setState(previous => previous && ({ ...previous, pending: false, error: '파일을 붙이지 못했어요. 내용을 확인하고 다시 골라 주세요.' }));
      }
    });
    const timer = setTimeout(() => postToHost({ type: 'fileMentionSearch', requestId, query, activityId, taskId }), 120);
    return () => { live = false;clearTimeout(timer);off();postToHost({ type: 'fileMentionCancel', requestId, activityId, taskId }); };
  }, [query, start, draft, caret, enabled, composing, dismissed, activityId, taskId]);
  useEffect(() => { if (state?.files[selected]) document.getElementById(`${id}-${selected}`)?.scrollIntoView({block:'nearest'}); }, [selected, state?.files, id]);
  const close = () => { setDismissed(signature);setState(null); };
  const pick = (index: number) => {
    if (!state || state.pending || state.loading || !state.files[index]) return;
    setState({ ...state, pending: true });postToHost({ type: 'fileMentionPick', requestId: state.requestId, path: state.files[index].path, activityId, taskId });
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!state || composing || event.nativeEvent.isComposing) return false;
    if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close();return true; }
    if (event.key === 'Tab') { close();return false; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault();setSelected(value => state.files.length ? (value + (event.key === 'ArrowDown' ? 1 : state.files.length - 1)) % state.files.length : 0);return true; }
    if (event.key === 'Enter') { event.preventDefault();pick(selected);return true; }
    return false;
  };
  const view = state && <div className="hps-file-mentions">
    <p role="status">{state.pending ? '파일을 붙이는 중이에요' : state.loading ? '작업 파일을 찾고 있어요' : state.error ?? (state.files.length ? '붙일 작업 파일을 골라 주세요' : '일치하는 작업 파일이 없어요')}</p>
    {state.limited && <p>일부 파일만 표시했어요. 이름을 더 입력해 주세요.</p>}
    <div id={id} role="listbox" aria-label="현재 작업 폴더 파일">
      {state.files.map((file,index) => <button key={file.path} id={`${id}-${index}`} type="button" role="option" aria-selected={index === selected} tabIndex={-1} disabled={state.pending} className="hps-panel-fallback-retry" onMouseDown={event => event.preventDefault()} onClick={() => pick(index)}>{index === selected && <ChatIcon kind="check" size={16} />}<span>{file.path} · {file.bytes.toLocaleString()} B</span></button>)}
    </div>
  </div>;
  return { view, keyDown, setCaret, open: !!state, listId: id, activeId: state?.files[selected] ? `${id}-${selected}` : undefined };
}
