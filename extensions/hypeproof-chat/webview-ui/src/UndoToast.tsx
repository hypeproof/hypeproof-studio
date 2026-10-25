// CGP-CHAT-R-029 / CGP-CHAT-D85 (REQ-STUDIO-REMOVAL-UNDO) — the one 되돌리기 toast of the chat panel.
// A low-stakes removal (an attachment chip, a queued message, a task rename) happens at once and
// offers 되돌리기 here for 6 s; the time stops while the toast is hovered or focused. One offer at a
// time: a newer one replaces the older, and the older removal simply stays done. An offer also ends
// when its subject changed since (`stillValid`), when the chat scope changes, and on unmount. Undo
// restores the exact prior state or nothing; a host undo waits for the host's answer.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { REMOVAL_COPY, UNDO_DONE, UNDO_LABEL, UNDO_TOAST_MS, type RemovalKind } from '../../src/removalUndo';
import { onHostMessage } from './vscode';
import { ChatIcon } from './ChatDetails';

export interface UndoOffer {
  kind: RemovalKind;
  /** The chat scope the removal happened in. A field left out is not compared (the task header knows no activity id). */
  scope: UndoScope;
  /** Put the prior state back. Local undos act at once; `hostUndoId` undos wait for removalUndoResult. */
  undo: () => void;
  hostUndoId?: string;
  /** False once the removed thing's surroundings changed, so undo could no longer restore them exactly. */
  stillValid?: () => boolean;
  /** Runs when the offer ends without undo (time out, replaced, invalid, scope change, unmount). */
  onExpire?: () => void;
  /** Where focus goes after undo, when it was on the toast. Default: the composer. */
  focusAfter?: () => HTMLElement | null;
}

export interface UndoScope { activityId?: string | null; taskId?: string | null }
const sameScope = (offer: UndoScope, panel: UndoScope) =>
  (offer.activityId === undefined || offer.activityId === (panel.activityId ?? null)) && (offer.taskId === undefined || offer.taskId === (panel.taskId ?? null));

type Shown = { key: number; offer: UndoOffer; phase: 'offer' | 'pending' | 'done' | 'failed' };
let shown: Shown | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const set = (next: Shown | null) => { shown = next; emit(); };

/** End the current offer without undo: its removal stays, and its commit runs once. */
export function settleUndo(match?: (offer: UndoOffer) => boolean): void {
  const current = shown;
  if (!current || (match && !match(current.offer))) return;
  set(null);
  if (current.phase === 'offer') current.offer.onExpire?.();
}
export function offerUndo(offer: UndoOffer): void {
  settleUndo();
  set({ key: ++seq, offer, phase: 'offer' });
}
/** Unique, host-valid id for a host-side undo (removalUndo.validUndoId). */
export const newUndoId = () => `undo-${Date.now().toString(36)}-${(++seq).toString(36)}`;

const FAILED = '되돌리지 못했어요';
/** `:hover` without throwing where a test DOM cannot match it (treated as not hovered). */
const pointerOver = (element: Element | null) => { try { return !!element?.matches(':hover'); } catch { return false; } };
const HOST_ANSWER_MS = 15000;

export function UndoToast({ scope, composer }: { scope: UndoScope; composer: () => HTMLElement | null }) {
  const current = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => shown, () => null);
  const [held, setHeld] = useState({ hover: false, focus: false });
  const box = useRef<HTMLDivElement>(null);
  const refocus = useRef<(() => HTMLElement | null) | null>(null);

  // Every render of the panel re-checks the offer: scope and subject must still be the ones removed from.
  useEffect(() => {
    if (current?.phase === 'offer' && (!sameScope(current.offer.scope, scope) || current.offer.stillValid?.() === false)) settleUndo();
    else if (current && current.phase !== 'offer' && !sameScope(current.offer.scope, scope)) set(null);
  });
  useEffect(() => () => settleUndo(), []);
  // A send from either chat window (sidebar or editor; they share the host) made the host forget what it
  // kept: an offer that waits on the host can no longer restore anything, so it ends.
  useEffect(() => onHostMessage(message => { if (message.type === 'removalsFinal') settleUndo(offer => !!offer.hostUndoId); }), []);
  // A fresh toast starts a fresh 6 s; focus on the old one does not hold this one, a pointer still over it does.
  useEffect(() => setHeld({ hover: pointerOver(box.current), focus: false }), [current?.key]);

  const holding = held.hover || held.focus;
  useEffect(() => {
    if (!current || holding || current.phase === 'pending' || current.phase === 'failed') return;
    const key = current.key;
    const timer = setTimeout(() => { if (shown?.key === key) settleUndo(); }, UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [current, holding]);

  // A host undo: only the answer for this offer's id counts; no answer is a failure, never a success.
  // A late `restored: true` after the time-out still corrects the failure: the toast never contradicts the chip.
  useEffect(() => {
    if ((current?.phase !== 'pending' && current?.phase !== 'failed') || !current.offer.hostUndoId) return;
    const { key } = current, id = current.offer.hostUndoId;
    const finish = (restored: boolean) => {
      if (shown?.key !== key) return;
      if (shown.phase === 'pending') set({ ...shown, phase: restored ? 'done' : 'failed' });
      else if (shown.phase === 'failed' && restored) set({ ...shown, phase: 'done' });
    };
    const off = onHostMessage(message => { if (message.type === 'removalUndoResult' && message.undoId === id) finish(message.restored); });
    const timer = current.phase === 'pending' ? setTimeout(() => finish(false), HOST_ANSWER_MS) : undefined;
    return () => { off(); clearTimeout(timer); };
  }, [current]);

  // The pressed 되돌리기 goes away with the answer; focus that was on it lands on the restored place.
  useEffect(() => {
    if (!refocus.current || current?.phase === 'pending') return;
    const target = refocus.current;
    refocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !box.current?.contains(active)) return;
    (target() ?? composer())?.focus({ preventScroll: true });
  });

  const press = () => {
    if (current?.phase === 'pending') return;   // a second press waits for the same answer
    if (!current || current.phase !== 'offer' || current.offer.stillValid?.() === false) { settleUndo(); return; }
    if (box.current?.contains(document.activeElement)) refocus.current = current.offer.focusAfter ?? composer;
    set({ ...current, phase: current.offer.hostUndoId ? 'pending' : 'done' });
    current.offer.undo();
  };
  const text = !current ? '' : current.phase === 'done' ? UNDO_DONE : current.phase === 'failed' ? FAILED : REMOVAL_COPY[current.offer.kind];
  const withButton = current?.phase === 'offer' || current?.phase === 'pending';

  return <div ref={box} className="hps-undo-toast" role="status" aria-live="polite" aria-atomic="true" data-testid="undo-toast" data-shown={current ? 'true' : 'false'} data-undo-kind={current?.offer.kind}
    onMouseEnter={() => setHeld(value => ({ ...value, hover: true }))} onMouseLeave={() => setHeld(value => ({ ...value, hover: false }))}
    onFocus={() => setHeld(value => ({ ...value, focus: true }))}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(value => ({ ...value, focus: false })); }}>
    {current && <span className="hps-undo-toast-text"><ChatIcon kind={current.phase === 'done' ? 'check' : current.phase === 'failed' ? 'alert' : 'info'} size={16} />{text}</span>}
    {current && ' '}
    {withButton && <button type="button" className="hps-undo-toast-action" aria-disabled={current?.phase === 'pending' || undefined} onClick={press}>{UNDO_LABEL}</button>}
    {current?.phase === 'failed' && <button type="button" className="hps-undo-toast-action" onClick={() => { refocus.current = composer; set(null); }}>닫기</button>}
  </div>;
}
