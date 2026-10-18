import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function ChatIcon({ kind }: { kind: 'send' | 'stop' | 'copy' | 'check' | 'down' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'send' && <path d="M12 19V5m-6 6 6-6 6 6" />}
    {kind === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />}
    {kind === 'copy' && <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>}
    {kind === 'check' && <path d="m5 12 4 4L19 6" />}
    {kind === 'down' && <path d="M12 5v14m-6-6 6 6 6-6" />}
  </svg>;
}

export function CopyAnswer({ content }: { content: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); if (mounted.current) setState('copied'); }
    catch { if (mounted.current) setState('failed'); }
  };
  return <div className="hps-answer-actions">
    <button type="button" className="hps-copy-answer" onClick={copy} aria-label="답변 복사" title="답변 복사">
      <ChatIcon kind={state === 'copied' ? 'check' : 'copy'} /><span>{state === 'copied' ? '복사됨' : '복사'}</span>
    </button>
    <span role="status" className="hps-copy-status">{state === 'copied' ? '답변을 복사했습니다' : state === 'failed' ? '복사하지 못했습니다. 답변을 선택해 복사해 주세요.' : ''}</span>
  </div>;
}

export function ResponsePending({ hasContent = false }: { hasContent?: boolean }) {
  return <div className="hps-response-pending" role="status">
    <span className="hps-response-dots" aria-hidden="true"><i /><i /><i /></span>
    <span>{hasContent ? '답변 작성 중' : '응답을 준비하고 있어요'}</span>
  </div>;
}

/** Keep live output in view only while the reader chooses to follow the bottom. */
export function useChatViewport(ref: RefObject<HTMLDivElement>, enabled: boolean, revision: unknown) {
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const toLatest = () => {
    follow.current = true;
    setAway(false);
    // Instant positioning avoids a stream of competing smooth-scroll animations.
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  };
  const onScroll = () => {
    if (!enabled || !ref.current) return;
    const node = ref.current;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 48;
    setAway(!follow.current);
  };
  useLayoutEffect(() => {
    if (enabled && follow.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [enabled, revision, ref]);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const node = ref.current;
    const resize = new ResizeObserver(() => {
      if (follow.current) node.scrollTop = node.scrollHeight;
    });
    resize.observe(node);
    for (const child of node.children) resize.observe(child);
    return () => resize.disconnect();
  }, [enabled, revision, ref]);
  return { away, onScroll, toLatest };
}

/** Resize only the local draft, including restored drafts and narrow-panel wrapping. */
export function useGrowingComposer(ref: RefObject<HTMLTextAreaElement>, enabled: boolean, draft: string) {
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const node = ref.current;
    const shell = node.closest<HTMLElement>('.hps-shell');
    const footer = node.closest<HTMLElement>('.hps-input-area');
    const geometry = () => {
      const chrome = shell ? Array.from(shell.children).reduce((height, child) =>
        height + (child === footer || child.classList.contains('hps-messages') ? 0 : (child as HTMLElement).offsetHeight), 0) : 0;
      return [node.clientWidth, shell?.clientHeight ?? 600, (footer?.offsetHeight ?? node.offsetHeight) - node.offsetHeight, chrome];
    };
    let previous = '';
    const fit = () => {
      const dimensions = geometry();
      previous = dimensions.join(':');
      // Keep room for the transcript and fixed controls even in a short split pane.
      const cap = Math.max(44, Math.min(192, dimensions[1] - dimensions[2] - dimensions[3] - 96));
      node.style.maxHeight = `${cap}px`;
      node.style.height = '0px';
      node.style.height = `${Math.min(cap, Math.max(44, node.scrollHeight))}px`;
    };
    fit();
    const resize = new ResizeObserver(() => {
      if (geometry().join(':') !== previous) fit();
    });
    resize.observe(node);
    if (shell) resize.observe(shell);
    if (footer) resize.observe(footer);
    return () => resize.disconnect();
  }, [enabled, draft, ref]);
}
