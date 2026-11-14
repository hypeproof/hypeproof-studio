// CGP-AGENT-R-031 / CGP-AGENT-D-027 (REQ-CGP-AGENT-66, DES-CGP-AGENT-66): while the Service reads as
// busy, one calm amber info line sits above the composer: icon + text + a close button. It holds
// nothing: the draft, Send and every control stay usable. It never names a provider or a cause.
// It has no motion, so reduced motion needs no override. Closing it hides it for the rest of this
// panel's session, and it also leaves on its own once the Service reads healthy. It does not
// replace the stall watchdog (REQ-M26). All text is React text, never HTML.

import { ChatIcon } from './ChatDetails';

export const BUSY_BANNER_TEXT = 'AI가 지금 붐벼요. 답이 늦을 수 있어요.';
export const BUSY_BANNER_CLOSE_LABEL = '붐빔 알림 닫기';

/** Shown only while busy and not closed in this session. */
export function busyBannerShown(busy: boolean, dismissed: boolean): boolean {
  return busy && !dismissed;
}

export function BusyBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="hps-busy-banner" role="status" aria-live="polite" aria-atomic="true" data-testid="busy-banner">
      <ChatIcon kind="clock" size={16} />
      <span className="hps-busy-banner-text">{BUSY_BANNER_TEXT}</span>
      <button type="button" className="hps-busy-banner-close" aria-label={BUSY_BANNER_CLOSE_LABEL} data-hp-tooltip={BUSY_BANNER_CLOSE_LABEL} onClick={onDismiss}>
        <ChatIcon kind="close" size={16} />
      </button>
    </div>
  );
}
