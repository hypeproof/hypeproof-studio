import { useEffect, useState } from 'react';
import { classWindowNotice, type ClassWindow } from '../../src/classWindow';

/** Passive information: never stops a turn, steals focus or disables the composer. */
export function ClassWindowNotice({ window: classWindow }: { window?: ClassWindow | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, [classWindow?.id, classWindow?.startsAt, classWindow?.endsAt]);
  const text = classWindowNotice(classWindow, now);
  return text ? <p className="hps-class-window" role="status" aria-live="polite" data-testid="class-window-notice">{text}</p> : null;
}
