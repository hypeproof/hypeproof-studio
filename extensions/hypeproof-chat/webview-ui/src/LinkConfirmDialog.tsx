import { useEffect, useRef, type CSSProperties } from 'react';
import { LINK_CONFIRM_COPY as C, type LinkConfirmChoice, type LinkConfirmPrompt } from '../../src/linkConfirm';
import { normalizeTextSize } from '../../src/textSize';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { finishModal } from './modalMotion';
import './modalSurface.css';
import './writeApprovalDialog.css';

/**
 * CGP-SHELL-R-026 (REQ-SHELL-26, DES-SHELL-25) — before an external link opens. The host is the bold line (ASCII, so an
 * IDN shows its punycode; the decoded form and a look-alike warning follow when they apply), the full address wraps,
 * and 취소 holds the first focus: Enter on it cancels, Esc cancels, and only 열기 opens.
 *
 * 열기 needs a real activation of 열기 itself: a trusted click, or an Enter/Space keydown that starts on 열기 after the
 * dialog opened (not a repeat). A key held from the composer arrives as repeats and is ignored, and a scripted click
 * (isTrusted false) does nothing. The answer goes to the host with the prompt's single-use id; the host decides.
 */
export function LinkConfirmDialog({ prompt, onAnswer, textSize }: { prompt: LinkConfirmPrompt; onAnswer: (id: string, choice: LinkConfirmChoice) => void; textSize?: unknown }) {
  const dialog = useRef<HTMLDialogElement>(null), answered = useRef(false), composing = useRef(false), keyArmed = useRef(false);
  const finish = (choice: LinkConfirmChoice) => { if (answered.current) return; answered.current = true; finishModal(dialog.current, () => onAnswer(prompt.id, choice)); };
  useDialogFocus(dialog, { open: true, kind: 'modal', initialFocus: '[data-link-cancel]' });
  useEffect(() => { const node = dialog.current; node?.showModal(); node?.querySelector<HTMLButtonElement>('[data-link-cancel]')?.focus(); return () => node?.close(); }, []);
  const step = { base: 0, large: 2, xlarge: 4 }[normalizeTextSize(textSize)];
  return <dialog ref={dialog} className="hps-write-approval hps-link-confirm hp-modal" aria-labelledby="link-confirm-title" aria-describedby="link-confirm-host link-confirm-url"
    style={{ '--hp-font-caption': `calc(14px + ${step}px)`, '--hp-font-body': `calc(16px + ${step}px)` } as CSSProperties}
    onCancel={e => { e.preventDefault(); if (!composing.current) finish('cancel'); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDownCapture={e => {
      if (imeComposing(e, composing.current)) { e.stopPropagation(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); return; }
      // A held key (from the composer or anywhere) activates nothing here.
      if ((e.key === 'Enter' || e.key === ' ') && e.repeat) { e.preventDefault(); e.stopPropagation(); return; }
      keyArmed.current = (e.key === 'Enter' || e.key === ' ') && (e.target as Element | null)?.hasAttribute?.('data-link-open') === true;
    }}>
    <h2 id="link-confirm-title">{C.title}</h2>
    <p id="link-confirm-host"><span className="hps-sr-only">{C.hostLabel} </span><strong className="hps-browser-host" dir="ltr">{prompt.host}</strong>
      {prompt.unicodeHost && <span className="hps-link-unicode"> {C.unicodeLabel} <span dir="ltr">{prompt.unicodeHost}</span></span>}</p>
    {prompt.warning && <p className="hps-link-warning" role="note">{C.warning}</p>}
    <p id="link-confirm-url" className="hps-link-url" dir="ltr">{prompt.url}</p>
    <p>{prompt.source === 'preview' ? `${C.fromPreview} ` : ''}{prompt.where === 'integrated' ? C.whereIntegrated : C.whereSystem}</p>
    <div className="hps-write-actions">
      <button type="button" data-link-cancel onClick={() => finish('cancel')}>{C.cancel}</button>
      <button type="button" data-link-open onClick={e => {
        // A pointer click has detail ≥ 1; a keyboard activation has detail 0 and must have started on this button.
        const real = e.nativeEvent.isTrusted && (e.detail > 0 || keyArmed.current);
        keyArmed.current = false;
        if (real) finish('open');
      }}>{C.open}</button>
      <button type="button" data-link-copy onClick={() => finish('copy')}>{C.copy}</button>
    </div>
  </dialog>;
}
