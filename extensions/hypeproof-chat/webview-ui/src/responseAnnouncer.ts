import { useEffect, useRef, useState } from 'react';

/**
 * CGP-CHAT-R-001: the response lifecycle reaches assistive tech once per turn.
 *
 * One stable, invisible region owns start/completion/stop in both modes. Visible
 * pending and stop content has no live semantics. Errors retain their own alert.
 * Opening or switching tasks stays quiet, including an already-running task.
 */
export type LifecycleContext = { personal: boolean; stopped: boolean; failed: boolean; scope?: string };

export function responseAnnouncement(prev: boolean, next: boolean, ctx: LifecycleContext): string | null {
  if (!prev && next) return '답변을 시작했어요';
  if (prev && !next) return ctx.failed ? '' : ctx.stopped ? '답변을 멈췄어요' : '답변이 끝났어요';
  return null;
}

/** How long the completion waits for a Stop notice or error that lands a render later. */
export const COMPLETION_SETTLE_MS = 250;

export function useResponseAnnouncement(streaming: boolean, ctx: LifecycleContext): string {
  const [message, setMessage] = useState('');
  const prev = useRef(streaming);
  const scope = useRef(ctx.scope);
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    if (scope.current !== ctx.scope) {
      scope.current = ctx.scope;
      prev.current = streaming;
      setMessage('');
      return;
    }
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
  }, [streaming, ctx.scope]);
  return message;
}
