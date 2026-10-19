import { useEffect, useRef, useState } from 'react';

/**
 * CGP-CHAT-R-001: the response lifecycle reaches assistive tech once per turn.
 *
 * Personal mode already announces the start through `ResponsePending` (role=status), and Stop
 * announces itself through the stop notice; errors have their own banner. What was missing is
 * the start in classroom mode (a plain "생각하는 중… ✨" span) and the completion in both modes.
 * Nothing is announced for the state the panel opens in, so reopening a task stays quiet.
 */
export type LifecycleContext = { personal: boolean; stopped: boolean; failed: boolean };

export function responseAnnouncement(prev: boolean, next: boolean, ctx: LifecycleContext): string | null {
  if (!prev && next) return ctx.personal ? '' : '답변을 시작했어요';
  if (prev && !next) return ctx.stopped || ctx.failed ? '' : '답변이 끝났어요';
  return null;
}

/** How long the completion waits for a Stop notice or error that lands a render later. */
export const COMPLETION_SETTLE_MS = 250;

export function useResponseAnnouncement(streaming: boolean, ctx: LifecycleContext): string {
  const [message, setMessage] = useState('');
  const prev = useRef(streaming);
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    const was = prev.current;
    prev.current = streaming;
    if (was === streaming) return;
    if (streaming) {
      setMessage(responseAnnouncement(was, streaming, latest.current) ?? '');
      return;
    }
    // Clear first so an identical completion line is announced again on the next turn.
    setMessage('');
    const timer = setTimeout(() => setMessage(responseAnnouncement(was, false, latest.current) ?? ''), COMPLETION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [streaming]);
  return message;
}
