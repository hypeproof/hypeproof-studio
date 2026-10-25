import { useId, useLayoutEffect, useRef } from 'react';
import type { TaskMoveView } from '../../src/taskMove';
import { TASK_MOVE_NONE_REASON } from '../../src/taskMove';
import { ChatIcon } from './ChatDetails';
import { imeComposing } from './imeGuard';

interface Props {
  title: string;
  move: TaskMoveView;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (destination: string) => void;
}

/**
 * CGP-KNOW-R-009 / DES-KNOW-14 — the per-task menu in the rail. It offers only "move to another
 * personal activity", with one item per personal activity the host listed. Where moving is not
 * possible (a class task, a trial, or no other personal activity) the move item stays focusable
 * with aria-disabled and its reason as visible, announced description; nothing is offered to pick.
 * The host re-checks every move; this menu never decides eligibility.
 */
export function TaskMenu({ title, move, open, disabled, onOpenChange, onMove }: Props) {
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const headingId = useId();
  const reasonId = useId();
  const items = () => [...(panel.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])];
  const close = (restore: boolean) => { onOpenChange(false); if (restore) toggle.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => { if (open) items()[0]?.focus({ preventScroll: true }); }, [open]);
  const destinations = move.allowed ? move.destinations : [];
  const reason = move.allowed ? (destinations.length ? null : TASK_MOVE_NONE_REASON) : move.reason;
  return <>
    <button ref={toggle} type="button" className="tw-quiet tw-task-menu-toggle" aria-label={`작업 메뉴: ${title}`} data-hp-tooltip="작업 메뉴"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled}
      onClick={() => onOpenChange(!open)}
      onKeyDown={event => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); onOpenChange(true); } }}>
      <ChatIcon kind="dots" size={20} />
    </button>
    {open && <div ref={panel} id={menuId} className="tw-task-menu-panel" role="menu" aria-label={`작업 메뉴: ${title}`}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget !== toggle.current) onOpenChange(false); }}
      onKeyDown={event => {
        if (event.defaultPrevented || imeComposing(event)) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') { onOpenChange(false); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const choices = items();
        if (!choices.length) return;
        event.preventDefault();
        const at = choices.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices[next].focus({ preventScroll: true });
      }}>
      {reason === null
        ? <div role="group" aria-labelledby={headingId}>
          <p id={headingId} className="tw-task-menu-heading">다른 활동으로 옮기기</p>
          {destinations.map(destination => <button key={destination.ref} type="button" role="menuitem" tabIndex={-1} aria-label={`옮기기: ${destination.name}`}
            onClick={() => { close(false); onMove(destination.ref); }}>{destination.name}</button>)}
        </div>
        : <div role="group" aria-label="다른 활동으로 옮기기">
          <button type="button" role="menuitem" tabIndex={-1} aria-disabled="true" aria-describedby={reasonId} onClick={event => event.preventDefault()}>다른 활동으로 옮기기</button>
          <p id={reasonId} className="tw-task-menu-reason">{reason}</p>
        </div>}
    </div>}
  </>;
}
