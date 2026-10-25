import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { MY_QUESTION_ATTR, MY_QUESTIONS_LABEL, type MyQuestion } from '../../src/myQuestions';
import { useDialogFocus } from './dialogFocus';
import { scrollBehavior } from './motion';
import './myQuestions.css';

/** The drawn user row for one prompt id, looked up by attribute value (never a built selector). */
export function myQuestionRow(box: HTMLElement | null, id: string): HTMLElement | null {
  if (!box) return null;
  const find = (attr: string) => [...box.querySelectorAll<HTMLElement>(`[${attr}]`)].find(row => row.getAttribute(attr) === id) ?? null;
  // A prompt whose row failed to render is drawn as its turn fallback box (CGP-CHAT-R50); jump there.
  return find(MY_QUESTION_ATTR) ?? find('data-turn-fallback');
}

/**
 * Scroll the transcript so the prompt's row sits at its top and move keyboard focus onto its bubble.
 * The bubble takes focus only for this jump (tabindex -1, removed when it loses focus), so the
 * transcript's Tab order is unchanged. Returns false when the row is no longer drawn.
 */
export function jumpToMyQuestion(box: HTMLElement | null, id: string): boolean {
  const row = myQuestionRow(box, id);
  if (!box || !row) return false;
  box.scrollTo({ top: row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop, behavior: scrollBehavior() });
  // Focus lands on the bubble itself (the prompt text), so the ring hugs it rather than the full-width
  // row; a prompt being edited in place focuses its editor; a fallback box takes focus itself.
  const editor = row.querySelector<HTMLElement>('textarea');
  const target = row.querySelector<HTMLElement>(':scope > .hps-msg-body') ?? editor ?? row;
  const temporary = target !== editor && !target.hasAttribute('tabindex');
  if (temporary) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
  }
  target.focus({ preventScroll: true });
  // Focus did not take (hidden or inert): leave no stray tab stop behind.
  if (temporary && document.activeElement !== target) target.removeAttribute('tabindex');
  return true;
}

/**
 * CGP-CHAT-R-028 (CGP-CHAT-D81) — "내 질문": a header button that opens a numbered list of the
 * learner's prompts as drawn. Choosing one scrolls to it and focuses it. `items` is empty below
 * MY_QUESTIONS_MIN prompts, and then nothing is drawn.
 */
export function MyQuestions({ items, scrollRoot, scope, onBeforeJump }: {
  items: readonly MyQuestion[];
  scrollRoot: RefObject<HTMLElement | null>;
  /** The conversation the list belongs to; a change closes the list. */
  scope: string;
  /** Explicit history navigation: stop following the live answer first. */
  onBeforeJump?: () => void;
}) {
  // Open for one conversation only: a task or activity switch closes it in the same render.
  const [openScope, setOpenScope] = useState<string | null>(null);
  const open = openScope === scope;
  const setOpen = (next: boolean) => setOpenScope(next ? scope : null);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const visible = items.length > 0;
  useEffect(() => { if (!visible) setOpenScope(null); }, [visible]);
  const focus = useDialogFocus(panel, { open: open && visible, kind: 'popover', scope: root, opener: () => toggle.current, onDismiss: () => setOpen(false) });
  if (!visible) return null;
  const choose = (id: string) => {
    onBeforeJump?.();
    focus.release();
    const jumped = jumpToMyQuestion(scrollRoot.current, id);
    setOpen(false);
    if (!jumped) toggle.current?.focus({ preventScroll: true });
  };
  return <div className="hps-myq" ref={root}>
    <button ref={toggle} type="button" className="hps-myq-toggle" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? listId : undefined}
      data-hp-tooltip="내 질문으로 바로 가기" onClick={() => setOpen(!open)}>{MY_QUESTIONS_LABEL}</button>
    {open && <div ref={panel} id={listId} className="hps-myq-panel" role="dialog" aria-label={MY_QUESTIONS_LABEL}>
      <ol className="hps-myq-list">
        {items.map(item => <li key={item.id}>
          <button type="button" className="hps-myq-item" data-my-question-target={item.id} onClick={() => choose(item.id)}>
            <span className="hps-myq-n">{item.n}</span>
            <span className="hps-myq-line">{item.line}</span>
          </button>
        </li>)}
      </ol>
    </div>}
  </div>;
}
