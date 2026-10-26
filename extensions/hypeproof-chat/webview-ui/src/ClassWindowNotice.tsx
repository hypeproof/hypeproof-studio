import { useEffect, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { postToHost } from './vscode';
import { classWindowNotice, type ClassWindow } from '../../src/classWindow';

/** Passive information: never stops a turn, steals focus or disables the composer. */
export function ClassWindowNotice({ window: classWindow, onDismiss = id => postToHost({ type: 'dismissClassWindow', id }) }: { window?: ClassWindow | null; onDismiss?: (id: string) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [classWindow?.id, classWindow?.startsAt, classWindow?.endsAt]);
  const text = classWindowNotice(classWindow, now);
  return text ? <p className="hps-class-window" role="status" aria-live="polite" data-testid="class-window-notice"><ChatIcon kind="clock" size={16} /><span>{text}</span>{classWindow?.noticeId && <button type="button" aria-label="수업 종료 안내 닫기" onClick={event => {
    const shell = event.currentTarget.closest('.hps-shell');
    onDismiss(classWindow.noticeId!);
    shell?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  }}><ChatIcon kind="close" size={16} /></button>}</p> : null;
}
