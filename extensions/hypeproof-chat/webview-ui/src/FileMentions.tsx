import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react';
import type { MentionFile } from '../../src/workspaceFileMentions';
import { onHostMessage, postToHost } from './vscode';
import { ChatIcon } from './ChatDetails';
export function mentionAt(text: string, caret: number): { start: number; end: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]{0,256})$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null;
}
/** Textarea properties that decide where a character lands; copied onto the measuring mirror. */
const MIRRORED = ['box-sizing', 'width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'letter-spacing', 'word-spacing', 'line-height', 'text-transform', 'text-indent', 'tab-size', 'direction', 'overflow-wrap', 'word-break'];
/**
 * CGP-CHAT-D-018: the inline-start offset (CSS px) of the character at `index` inside `area`, measured
 * against `container`'s inline-start edge. A hidden mirror copies the textarea's text metrics and wrapping,
 * so a wrapped draft and a scrolled textarea are measured where the glyph is drawn. Never renders the
 * draft as HTML: the mirror gets text nodes only.
 */
export function caretInlineOffset(area: HTMLTextAreaElement, index: number, container: Element): number {
  const style = getComputedStyle(area), mirror = document.createElement('div'), mark = document.createElement('span');
  for (const name of MIRRORED) mirror.style.setProperty(name, style.getPropertyValue(name));
  mirror.style.setProperty('position', 'absolute');mirror.style.setProperty('visibility', 'hidden');mirror.style.setProperty('top', '0');mirror.style.setProperty('left', '0');
  mirror.style.setProperty('white-space', 'pre-wrap');mirror.style.setProperty('overflow-x', 'hidden');mirror.style.setProperty('overflow-y', area.scrollHeight > area.clientHeight ? 'scroll' : 'hidden');mirror.style.setProperty('height', 'auto');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.textContent = area.value.slice(0, index);mark.textContent = area.value.slice(index, index + 1) || '@';mirror.append(mark);
  (area.ownerDocument.body ?? area.ownerDocument.documentElement).append(mirror);
  const mirrorBox = mirror.getBoundingClientRect(), markBox = mark.getBoundingClientRect();
  mirror.remove();
  const areaBox = area.getBoundingClientRect(), box = container.getBoundingClientRect();
  if (style.direction === 'rtl') return Math.max(0, box.right - (areaBox.left + markBox.right - mirrorBox.left - area.scrollLeft));
  return Math.max(0, areaBox.left + markBox.left - mirrorBox.left - area.scrollLeft - box.left);
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
  const [anchor, setAnchor] = useState(0), list = useRef<HTMLDivElement>(null);
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
        } else { setState(previous => previous && ({ ...previous, pending: false, error: '파일을 붙이지 못했어요. 내용을 확인하고 다시 골라 주세요.' }));requestAnimationFrame(() => editor.current?.focus({preventScroll:true})); }
      }
    });
    const timer = setTimeout(() => postToHost({ type: 'fileMentionSearch', requestId, query, activityId, taskId }), 120);
    return () => { live = false;clearTimeout(timer);off();postToHost({ type: 'fileMentionCancel', requestId, activityId, taskId }); };
  }, [query, start, draft, caret, enabled, composing, dismissed, activityId, taskId]);
  // CGP-CHAT-D-018: the popover's inline start follows the `@` that opened it (CSS clamps it into the composer).
  const opened = !!state;
  useLayoutEffect(() => {
    const area = editor.current, card = area?.closest('.hps-input');
    if (!opened || start === undefined || !area || !card) return;
    const measure = () => setAnchor(Math.round(caretInlineOffset(area, start, card)));
    measure();
    // A wider or narrower card, a text-size change or rewrapped text before the `@` moves the glyph.
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    watch?.observe(card);watch?.observe(area);
    return () => watch?.disconnect();
  }, [opened, start, draft, editor]);
  // Only the list scrolls to keep the chosen row in view; scrollIntoView would also move the transcript.
  useEffect(() => {
    const box = list.current, row = box && state?.files[selected] ? document.getElementById(`${id}-${selected}`) : null;
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [selected, state?.files, id]);
  const close = () => { setDismissed(signature);setState(null); };
  /** Focus leaving the composer closes the popover (a row press keeps focus); an in-flight pick still lands. */
  const blur = () => { if (state && !state.pending) close(); };
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
  const view = state && <div className="hps-file-mentions" data-testid="file-mentions" onMouseDown={event => event.preventDefault()} style={{ '--hps-file-mentions-anchor': `${anchor}px` } as CSSProperties}>
    <p role="status">{state.pending ? '파일을 붙이는 중이에요' : state.loading ? '작업 파일을 찾고 있어요' : state.error ?? (state.files.length ? '붙일 작업 파일을 골라 주세요' : '일치하는 작업 파일이 없어요')}</p>
    {state.limited && <p>일부 파일만 표시했어요. 이름을 더 입력해 주세요.</p>}
    <div ref={list} id={id} role="listbox" aria-label="현재 작업 폴더 파일" className="hps-file-mentions-list">
      {state.files.map((file,index) => {
        const cut = file.path.lastIndexOf('/'), name = file.path.slice(cut + 1), folder = cut > 0 ? file.path.slice(0, cut) : '';
        return <button key={file.path} id={`${id}-${index}`} type="button" role="option" aria-selected={index === selected} aria-label={`${file.path} · ${file.bytes.toLocaleString()} B`} data-hp-tooltip={file.path} tabIndex={-1} disabled={state.pending} className="hps-file-mention" onMouseDown={event => event.preventDefault()} onClick={() => pick(index)}>
          {index === selected ? <ChatIcon kind="check" size={16} /> : <span className="hps-file-mention-mark" aria-hidden="true" />}
          <span className="hps-file-mention-name">{name}</span>
          {folder && <span className="hps-file-mention-folder">{folder}</span>}
          <span className="hps-file-mention-size">{file.bytes.toLocaleString()} B</span>
        </button>;
      })}
    </div>
  </div>;
  return { view, keyDown, setCaret, blur, open: !!state, listId: id, activeId: state?.files[selected] ? `${id}-${selected}` : undefined };
}
