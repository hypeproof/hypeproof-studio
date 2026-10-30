import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AUTO_REPORT_HINT, AUTO_REPORT_LABEL, PROBLEM_CONTACT_MAX, PROBLEM_DESCRIPTION_MAX, PROBLEM_FORM_LEAD, type OfferReason, type ProblemReportAnswer, type ProblemReportFormView } from '../../src/problemReport';
import { normalizeTextSize } from '../../src/textSize';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { finishModal } from './modalMotion';
import './modalSurface.css';
import './outboundDialog.css';
import './problemReport.css';

/**
 * REQ-STUDIO-PROBLEM-REPORT level 2 — the in-panel report form (replaces the old three input boxes).
 * It shows what goes with every report, asks for one optional line and an optional contact, and attaches recent
 * messages only when the box is ticked (unticked on every open). 보내기 hands the answer to the host, which still
 * shows the item-by-item confirmation (REQ-KNOW-09) before anything leaves; 취소 and Escape send nothing.
 */
export function ProblemReportDialog({ form, onAnswer, onAutoReport, textSize }: {
  form: ProblemReportFormView; onAnswer(id: string, answer: ProblemReportAnswer | null): void; onAutoReport?(enabled: boolean): void; textSize?: unknown;
}) {
  const dialog = useRef<HTMLDialogElement>(null), answered = useRef(false), composing = useRef(false);
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [includeRecentTurns, setInclude] = useState(false);
  const [autoReport, setAutoReport] = useState(form.autoReport);
  const finish = (answer: ProblemReportAnswer | null) => {
    if (answered.current) return;
    answered.current = true;
    finishModal(dialog.current, () => onAnswer(form.id, answer));
  };
  const submit = () => finish({ description: description.trim(), contact: contact.trim(), includeRecentTurns });
  useDialogFocus(dialog, { open: true, kind: 'modal', initialFocus: '[data-problem-description]' });
  useEffect(() => {
    const node = dialog.current; node?.showModal(); node?.querySelector<HTMLElement>('[data-problem-description]')?.focus();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="hps-outbound hp-modal hps-problem-report" aria-labelledby="problem-report-title" aria-describedby="problem-report-lead"
    style={{ '--hp-font-caption': `calc(14px + ${{ base: 0, large: 2, xlarge: 4 }[normalizeTextSize(textSize)]}px)` } as CSSProperties}
    onCancel={event => { event.preventDefault(); if (!composing.current) finish(null); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDownCapture={event => {
      if (imeComposing(event, composing.current)) { event.stopPropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
    }}>
    <h2 id="problem-report-title">문제 보내기</h2>
    <p id="problem-report-lead">{PROBLEM_FORM_LEAD[form.reason]}</p>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <label className="hps-problem-field">
        <span>무슨 일이 있었나요? <small>(선택)</small></span>
        <input data-problem-description type="text" value={description} maxLength={PROBLEM_DESCRIPTION_MAX}
          placeholder="예: 보내기를 누르면 계속 오류가 나요" onChange={event => setDescription(event.target.value)} />
      </label>
      <label className="hps-problem-field">
        <span>{form.contactPrompt} <small>(선택)</small></span>
        <input data-problem-contact type="text" value={contact} maxLength={PROBLEM_CONTACT_MAX}
          placeholder={form.contactPlaceholder} onChange={event => setContact(event.target.value)} />
      </label>
      {form.recentTurns > 0 && <label className="hps-outbound-item hps-problem-optin">
        <input data-problem-recent type="checkbox" checked={includeRecentTurns} onChange={event => setInclude(event.target.checked)} />
        <span>최근 대화 {form.recentTurns}개 함께 보내기
          <small>내가 보낸 말과 AI의 답이 그대로 가요. 개인정보가 있으면 체크하지 마세요.</small></span>
      </label>}
      <details className="hps-problem-details">
        <summary>함께 보내는 정보 {form.details.length}가지</summary>
        <dl>{form.details.map(row => <div key={row.label}><dt>{row.label}</dt><dd><code>{row.value}</code></dd></div>)}</dl>
      </details>
      <label className="hps-outbound-item hps-problem-optin">
        <input data-problem-auto type="checkbox" checked={autoReport} onChange={event => { setAutoReport(event.target.checked); onAutoReport?.(event.target.checked); }} />
        <span>{AUTO_REPORT_LABEL}<small>{AUTO_REPORT_HINT}</small></span>
      </label>
      <p className="hps-problem-note">파일 이름·경로·토큰은 보내지 않아요. 보내기 전에 한 번 더 확인해요.</p>
      <div className="hps-outbound-actions">
        <button type="button" data-problem-cancel onClick={() => finish(null)}>취소</button>
        <button type="submit" className="hps-outbound-send" data-problem-send>보내기</button>
      </div>
    </form>
  </dialog>;
}

/** Level 3 — a calm offer, not a dialog: nothing is sent unless the person opens the form and submits it. */
export function ProblemReportOffer({ reason, onAnswer }: { reason: OfferReason; onAnswer(accept: boolean): void }) {
  return <div className="hps-problem-offer" role="status" data-problem-offer={reason}>
    <span>{reason === 'repeat' ? '같은 문제가 또 생겼어요. 문제를 보낼까요?' : '잘 안 되고 있나요? 문제를 보낼까요?'}</span>
    <button type="button" className="hps-problem-offer-send" onClick={() => onAnswer(true)}>문제 보내기</button>
    <button type="button" onClick={() => onAnswer(false)}>괜찮아요</button>
  </div>;
}
