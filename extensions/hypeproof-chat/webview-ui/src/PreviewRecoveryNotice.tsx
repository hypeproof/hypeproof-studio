// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009 / REQ-ART-09, DES-ART-09) — when the learner's preview cannot show a
// page: one calm cause line and exactly one action. The cause comes from the host's measurement plus
// navigator.onLine (previewFailure.ts); the technical code stays folded under 자세히, never in the line.
// After a press that did not run (refused for the state measured at press time, or failed) one more line says so.

import type { PreviewRecoveryAction, PreviewRecoveryView } from "../../src/previewFailure";
import { PREVIEW_RECOVERY_COPY } from "../../src/previewFailure";

export function PreviewRecoveryNotice({ view, note, busy, onAction }: { view: PreviewRecoveryView | null; note: string | null; busy: boolean; onAction: (action: PreviewRecoveryAction) => void }) {
  if (!view) {
    return note ? <p className="hps-preview-recovery hps-preview-recovery-solo" role="status" aria-live="polite" data-testid="preview-recovery-note">{note}</p> : null;
  }
  return (
    <div className="hps-preview-recovery" role="status" aria-live="polite" data-testid="preview-recovery" data-cause={view.cause}>
      <p className="hps-preview-recovery-text">{view.text}</p>
      <button type="button" className="hps-preview-recovery-action" aria-disabled={busy || undefined} onClick={() => { if (!busy) onAction(view.action); }}>{view.actionLabel}</button>
      {note && <p className="hps-preview-recovery-note" data-testid="preview-recovery-note">{note}</p>}
      <details className="hps-preview-recovery-detail">
        <summary>{PREVIEW_RECOVERY_COPY.detailSummary}</summary>
        <code>{view.detail}</code>
      </details>
    </div>
  );
}
