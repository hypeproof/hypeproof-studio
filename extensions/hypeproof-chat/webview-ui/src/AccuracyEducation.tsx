import { useEffect, useState, useId, useRef } from 'react';
import { ACCURACY_COPY, type AccuracyOffer } from '../../src/accuracyEducation';
import type { ChatConfig } from '../../src/protocol';
import { onHostMessage, postToHost } from './vscode';
import './accuracyEducation.css';

export function useAccuracyEducation(config: ChatConfig | null, instructor: boolean): AccuracyOffer | null {
  const id = useId(), serial = useRef(0);
  const [offer, setOffer] = useState<AccuracyOffer | null>(null);
  useEffect(() => {
    setOffer(null);
    if (instructor || !config) return;
    let requestId = '';
    const request = () => { requestId = `${id}-${++serial.current}`; postToHost({ type: 'accuracyEducationRequest', requestId }); };
    const off = onHostMessage(message => {
      if (message.type === 'accuracyEducationChanged') request();
      if (message.type === 'accuracyEducation' && message.requestId === requestId) setOffer(message.offer);
    });
    request();
    return off;
  }, [config, instructor]);
  return instructor ? null : offer;
}

/** A check is the learner's comparison, never an AI correctness claim or a score. */
export function AccuracyEducation({ answer, onDismiss }: { answer: string; onDismiss: () => void }) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  return <section className="hps-accuracy-card" aria-label="AI 결과 확인" role="note">
    <div className="hps-accuracy-head">
      <svg className="hps-accuracy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3 2 21h20L12 3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v5m0 3v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <p>{ACCURACY_COPY}</p>
    </div>
    {checking && <div>
      <p>아래 답을 내가 요청한 내용과 비교해 봐요. 중요한 사실은 원래 자료에서도 확인해 봐요.</p>
      <blockquote className="hps-accuracy-answer" tabIndex={0} aria-label="확인할 AI 결과">{answer}</blockquote>
    </div>}
    <div className="hps-accuracy-actions">
      {!checking
        ? <button type="button" className="hps-accuracy-action" onClick={() => setChecking(true)}>결과 확인하기</button>
        : <>
          <button type="button" className="hps-accuracy-action" aria-pressed={checked} onClick={() => setChecked(value => !value)}>요청한 내용과 답을 비교했어요</button>
          <button type="button" disabled={!checked} onClick={() => { if (checked) onDismiss(); }}>확인 마치기</button>
        </>}
      <button type="button" onClick={onDismiss}>닫기</button>
    </div>
  </section>;
}
