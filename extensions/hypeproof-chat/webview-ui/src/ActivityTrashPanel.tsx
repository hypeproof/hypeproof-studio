import { finishModal } from './modalMotion';
import './modalSurface.css';
// CGP-KNOW-D-013 (DES-KNOW-24) — 내 작품 with the activity trash at its bottom. The file list is the
// existing provenance inventory (ArtifactProvenanceList); this adds a move-to-trash press per file,
// the 휴지통 entry, the 8-second "휴지통으로 옮겼어요 · 되돌리기" toast and the permanent-delete
// dialog. The webview only asks: the host checks the setting, seat, scope, folder consent and
// unsaved buffers, and shows its own native confirm before a move or a permanent delete.

import { useEffect, useRef, useState } from 'react';
import type { ArtifactProvenanceView } from '../../src/artifactProvenanceView';
import { TRASH_TOAST_MS, TRASH_UNDO_LABEL, trashResultNotice, trashDeletedTime, type ActivityTrashAction, type ActivityTrashItem, type ActivityTrashView } from '../../src/activityTrashView';
import { ArtifactProvenanceList } from './ArtifactProvenanceList';
import { focusIsLost, returnTarget, useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { onHostMessage, postToHost } from './vscode';

function DeletedTime({ at }: { at: number }) {
  const time = trashDeletedTime(at);
  return time ? <time dateTime={time.iso}>{time.label}</time> : <span>삭제 시각 미확인</span>;
}

interface Toast { key: number; text: string; undo: string | null }

/**
 * Where keyboard focus goes when the control that was pressed goes away. The plan is made when the
 * press happens (the answer arrives later, after a pressed control has already been blurred or
 * removed). `origin` is the control that was pressed: while it is still focused and in the page
 * the plan waits; once focus is lost the plan lands on the next sensible control.
 */
type FocusPlan =
  | { kind: 'move'; index: number; origin: HTMLElement | null }   // a file row's 휴지통으로 옮기기: the next row's, else 휴지통 entry
  | { kind: 'list'; index: number; origin: HTMLElement | null }   // 복원 / 영구 삭제 in the trash list: the next entry's 복원, else 휴지통 entry
  | { kind: 'undo'; origin: HTMLElement | null };                 // the toast's 되돌리기: the restored row, else 휴지통 entry
const FOCUS_PLAN_MS = 3000;
const MOVE_BUTTON = '[data-trash-move]';
const RESTORE_BUTTON = '[data-trash-restore]';

let requestSeq = 0;
const nextRequestId = () => `trash-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;

export function ActivityTrashPanel({ files, scopeKey, onAsk, onOpenTurn }: {
  files: ArtifactProvenanceView | null | undefined;
  /** The task workspace scope: a change drops every pending press, toast and dialog. */
  scopeKey: string;
  onAsk?: (path: string) => void;
  /** CGP-KNOW-D-016 — a turn link in a file's info popover. */
  onOpenTurn?: (taskId: string, messageId: string) => void;
}) {
  const [view, setView] = useState<ActivityTrashView | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [held, setHeld] = useState({ hover: false, focus: false });
  const [purge, setPurge] = useState<ActivityTrashItem | null>(null);
  const request = useRef<string | null>(null);
  const listedScope = useRef<string | null>(null);
  const composing = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const entryButton = useRef<HTMLButtonElement>(null);
  const toastBox = useRef<HTMLDivElement>(null);
  const works = useRef<HTMLElement>(null);
  const focusPlan = useRef<FocusPlan | null>(null);
  const planAnswered = useRef<{ path?: string } | null>(null);
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const purgeOpener = useRef<HTMLElement | null>(null);
  const dismissPurge = () => finishModal(dialog.current, () => setPurge(null));
  useDialogFocus(dialog, { open: !!purge, kind: 'modal', keepFocusOnDismiss: true, onDismiss: dismissPurge });

  useEffect(() => {
    setView(null); setOpen(false); setPending(false); setError(''); setToast(null); setHeld({ hover: false, focus: false }); setPurge(null);
    request.current = null; listedScope.current = null; focusPlan.current = null; planAnswered.current = null; purgeOpener.current = null;
    if (planTimer.current) clearTimeout(planTimer.current);
    const dispose = onHostMessage(message => {
      if (message.type !== 'activityTrashState') return;
      // An answer to another press (or to a press from before a task switch) is not ours.
      if (message.requestId !== undefined && message.requestId !== request.current) return;
      if (message.requestId === undefined && request.current) return;
      // A list for another task or activity: an Undo from the old one must not stay on screen.
      if (listedScope.current !== null && message.view?.scope !== listedScope.current) { setToast(null); setPurge(null); }
      listedScope.current = message.view?.scope ?? null;
      setView(message.view);
      if (message.requestId === undefined) return;
      request.current = null; setPending(false);
      const result = message.result;
      if (!result || result.cancelled) return;
      if (result.error) { setError(result.error); return; }
      setError('');
      // A fresh toast starts a fresh 8 seconds; whatever held the old one does not hold this one.
      setHeld({ hover: false, focus: false });
      setToast({ key: Date.now() + requestSeq, text: trashResultNotice(result), undo: result.action === 'move' && result.id ? result.id : null });
      // The pressed control (a file row, a trash row, the Undo) goes away with the answer: the focus
      // plan made at press time lands once focus is actually lost (see the effect below).
      if (focusPlan.current) {
        planAnswered.current = { path: result.path };
        if (planTimer.current) clearTimeout(planTimer.current);
        planTimer.current = setTimeout(() => { focusPlan.current = null; planAnswered.current = null; }, FOCUS_PLAN_MS);
      }
    });
    postToHost({ type: 'activityTrashRequest' });
    return dispose;
  }, [scopeKey]);

  const holding = held.hover || held.focus || pending;
  useEffect(() => {
    if (!toast || holding) return;
    const timer = setTimeout(() => setToast(null), TRASH_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, holding]);

  // Runs after every render: when the answer is in and the pressed control is gone, put focus on the
  // plan's target. Never <body>, never the composer by accident.
  useEffect(() => {
    const plan = focusPlan.current;
    if (!plan || !planAnswered.current) return;
    const active = document.activeElement;
    if (plan.origin && plan.origin.isConnected && active === plan.origin) return;   // still there: wait for the list to refresh
    if (!focusIsLost()) { focusPlan.current = null; planAnswered.current = null; return; }   // the learner moved on
    const root = works.current;
    const all = (selector: string) => [...(root?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(item => item !== plan.origin);
    let next: HTMLElement | null | undefined;
    if (plan.kind === 'undo') {
      const label = planAnswered.current.path ? `휴지통으로 옮기기: ${planAnswered.current.path}` : null;
      next = label ? all(MOVE_BUTTON).find(item => item.getAttribute('aria-label') === label) : null;
    } else {
      const items = all(plan.kind === 'move' ? MOVE_BUTTON : RESTORE_BUTTON);
      next = items[Math.min(plan.index, items.length - 1)];
    }
    returnTarget(next, entryButton.current)?.focus({ preventScroll: true });
    focusPlan.current = null; planAnswered.current = null;
  });

  const act = (action: ActivityTrashAction, target: string, plan: FocusPlan | null = null) => {
    if (!view || request.current) return;
    focusPlan.current = plan; planAnswered.current = null;
    const requestId = nextRequestId();
    request.current = requestId; setPending(true); setError('');
    postToHost({ type: 'activityTrashAction', requestId, scope: view.scope, action, target });
  };

  return <section ref={works} className="tw-works" aria-label="내 작품" data-testid="my-works">
    <ArtifactProvenanceList view={files} onAsk={onAsk} onOpenTurn={onOpenTurn} onTrash={view ? (file, button) => act('move', file, { kind: 'move', index: [...(works.current?.querySelectorAll(MOVE_BUTTON) ?? [])].indexOf(button), origin: button }) : undefined} trashPending={pending} />
    {error && <p role="alert" className="tw-trash-error">{error} <button type="button" onClick={() => { setError(''); postToHost({ type: 'activityTrashRequest' }); }}>다시 확인</button></p>}
    {view && <div className="tw-trash" data-testid="activity-trash">
      <button ref={entryButton} type="button" className="tw-trash-entry" aria-expanded={open} aria-controls="tw-trash-list" onClick={() => setOpen(value => !value)}>
        휴지통 · {view.entries.length}개
      </button>
      {open && <div id="tw-trash-list" className="tw-trash-list">
        <p className="tw-trash-note">이 활동에서 지운 파일이에요. 저절로 지워지지 않아요.</p>
        {view.damaged > 0 && <p className="tw-trash-note">읽지 못한 항목 {view.damaged}개는 목록에서 뺐어요.</p>}
        {view.entries.length === 0 ? <p className="tw-trash-note">휴지통이 비어 있어요.</p>
          : <ul aria-label="휴지통의 파일">{view.entries.map(entry => <li key={entry.id}>
            <span className="tw-trash-name">{entry.path}</span>
            <DeletedTime at={entry.at} />
            <div className="tw-trash-actions">
              <button type="button" data-trash-restore="" aria-disabled={pending || undefined} aria-label={`복원: ${entry.path}`} onClick={event => { if (pending) return; act('restore', entry.id, { kind: 'list', index: view.entries.indexOf(entry), origin: event.currentTarget }); }}>복원</button>
              <button type="button" aria-disabled={pending || undefined} aria-label={`영구 삭제: ${entry.path}`} onClick={event => { if (pending) return; purgeOpener.current = event.currentTarget; setPurge(entry); }}>영구 삭제…</button>
            </div>
          </li>)}</ul>}
      </div>}
    </div>}
    {purge && <div className="tw-trash-backdrop hp-modal-backdrop">
      <div ref={dialog} className="tw-trash-dialog hp-modal" role="dialog" aria-modal="true" aria-labelledby="tw-trash-purge-title" aria-describedby="tw-trash-purge-file tw-trash-purge-note"
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (imeComposing(event, composing.current) && event.key === 'Enter') event.preventDefault(); }}>
        <h3 id="tw-trash-purge-title">이 파일을 영구 삭제할까요?</h3>
        <p id="tw-trash-purge-file" className="tw-trash-name">{purge.path}</p>
        <p id="tw-trash-purge-note">영구 삭제한 파일은 다시 복원할 수 없어요.</p>
        <div className="tw-trash-actions">
          <button type="button" data-trash-cancel="" onClick={dismissPurge}>취소</button>
          <button type="button" className="tw-trash-danger" onClick={() => { if (composing.current) return; const target = purge.id; const index = view?.entries.findIndex(item => item.id === target) ?? 0; finishModal(dialog.current, () => { setPurge(null); act('purge', target, { kind: 'list', index, origin: purgeOpener.current }); }); }}>영구 삭제</button>
        </div>
      </div>
    </div>}
    <div ref={toastBox} className="tw-trash-toast" role="status" aria-live="polite" aria-atomic="true" data-testid="trash-toast" data-shown={toast ? 'true' : 'false'}
      onMouseEnter={() => setHeld(value => ({ ...value, hover: true }))} onMouseLeave={() => setHeld(value => ({ ...value, hover: false }))}
      onFocus={() => setHeld(value => ({ ...value, focus: true }))}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(value => ({ ...value, focus: false })); }}>
      {toast && <span>{toast.text}{toast.undo ? ' · ' : ''}</span>}
      {toast?.undo && <button type="button" className="tw-trash-undo" aria-disabled={pending || undefined} onClick={event => { if (pending) return; act('restore', toast.undo!, { kind: 'undo', origin: event.currentTarget }); }}>{TRASH_UNDO_LABEL}</button>}
    </div>
  </section>;
}
