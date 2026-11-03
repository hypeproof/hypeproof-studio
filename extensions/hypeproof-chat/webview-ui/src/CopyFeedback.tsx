import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';

type Notice = { failed: boolean; className: string; children: ReactNode };
type Publish = (id: string, notice: Notice | null) => void;
// Lazy contexts keep imports of the shared icon helpers usable outside a DOM renderer.
function contexts() {
  return channels ??= { publish: createContext<Publish | null>(null), notices: createContext<Map<string, Notice>>(new Map()) };
}
let channels: { publish: ReturnType<typeof createContext<Publish | null>>; notices: ReturnType<typeof createContext<Map<string, Notice>>> } | undefined;

export function CopyFeedbackRegion({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState(new Map<string, Notice>());
  const publish = useCallback<Publish>((id, notice) => setNotices(current => {
    const next = new Map(current);
    if (notice) next.set(id, notice); else next.delete(id);
    return next;
  }), []);
  const channel = contexts();
  return <channel.publish.Provider value={publish}><channel.notices.Provider value={notices}>{children}</channel.notices.Provider></channel.publish.Provider>;
}
function noticeElement({ failed, className, children }: Notice, toast = false) {
  return <span {...(toast ? {} : { role: failed ? 'alert' : 'status' })} className={`hps-copy-status ${className}${toast ? ' hps-copy-toast' : ''}`}>{children}</span>;
}
// Screen readers announce text written INTO a live region that was already mounted. A region
// created together with its text is often skipped, so the two regions below never unmount.
// The error region is aria-live=assertive rather than role=alert: safety-notice.test asserts a panel holds no alert node.
// The visual toast is a hidden-from-AT copy that exists only while a notice exists.
export function CopyFeedbackOutlet() {
  const notices = useContext(contexts().notices);
  const entries = Array.from(notices);
  const live = (failed: boolean) => entries.filter(([, notice]) => notice.failed === failed).map(([id, notice]) => <span key={id}>{notice.children}</span>);
  return <div className="hps-copy-feedback">
    <div role="status" aria-live="polite" className="hps-sr-only hps-copy-live">{live(false)}</div>
    <div aria-live="assertive" aria-atomic="true" className="hps-sr-only hps-copy-live">{live(true)}</div>
    {entries.length > 0 && <div className="hps-copy-toasts" aria-hidden="true">{entries.map(([id, notice]) => <span className="hps-copy-toast-entry" key={id}>{noticeElement(notice, true)}</span>)}</div>}
  </div>;
}
export function CopyFeedback({ failed, className = '', children }: { failed: boolean; className?: string; children?: ReactNode }) {
  const publish = useContext(contexts().publish);
  const id = useId();
  useEffect(() => {
    // An idle tool (no children) publishes nothing, so the outlet's toast list stays empty.
    publish?.(id, children ? { failed, className, children } : null);
    return () => publish?.(id, null);
  }, [publish, id, failed, className, children]);
  // The originating tool still owns timing and cleanup. No document-global target exists.
  return publish ? null : noticeElement({ failed, className, children });
}
