import { useEffect, useRef, useState } from 'react';
import { imeComposing } from './imeGuard';

/** Review the selected answer locally; the host still previews and confirms the proposed writes. */
export function AnswerWikiReview({ content, turnId, onCancel, onContinue }: {
  content: string; turnId: string; onCancel: () => void; onContinue: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const continued = useRef(false);
  useEffect(() => { cancel.current?.focus({ preventScroll: true }); }, []);
  return <section className="hps-wiki-review" aria-label="팀 브레인에 정리할 답 확인" onKeyDown={event => {
    if (event.key === 'Escape' && !imeComposing(event)) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }}>
    <strong>이 답을 팀 브레인에 정리할까요?</strong>
    <blockquote className="hps-wiki-excerpt" data-expanded={expanded || undefined}>{content}</blockquote>
    <button type="button" className="hps-answer-action" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '인용문 접기' : '인용문 전체 보기'}</button>
    <p className="hps-wiki-turn">답변 ID: <span>{turnId}</span></p>
    <p>이 답이 속한 응답과 질문으로 정리할 내용을 만들어요. 실제 쓰기 전에 내용을 보여 주고 다시 확인해요.</p>
    <div className="hps-wiki-review-actions">
      <button ref={cancel} type="button" className="hps-answer-action" onClick={onCancel}>취소</button>
      <button type="button" className="hps-answer-action" onClick={() => { if (continued.current) return; continued.current = true; onContinue(); }}>정리할 내용 미리보기</button>
    </div>
  </section>;
}
