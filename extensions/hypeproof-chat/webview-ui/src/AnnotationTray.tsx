import type { AnnotationView } from '../../src/annotationBatch';
import { ANNOTATION_LIMIT, COMMENT_MAX } from '../../src/annotationLimits';
import './annotationTray.css';
/** CGP-ART-R-001 — the numbered marks queued for the next message, shown exactly as sent. */
export function AnnotationTray({annotations, onAction}: {
  annotations: AnnotationView[];
  onAction(action: 'element' | 'rectangle' | 'remove' | 'comment', number?: number, comment?: string): void;
}) {
  const full = annotations.length >= ANNOTATION_LIMIT;
  return <section className="hps-annotations" aria-label="코치에게 보낼 화면 표시" data-testid="annotation-tray">
    <div className="hps-annotations-head">
      <h3 className="hps-annotations-title">화면 표시 {annotations.length}/{ANNOTATION_LIMIT}</h3>
      <p className="hps-annotations-note">다음 메시지와 함께 한 번에 보내요.</p>
    </div>
    <div className="hps-annotations-actions">
      <button type="button" disabled={full} onClick={() => onAction('element')}>요소 추가</button>
      <button type="button" disabled={full} onClick={() => onAction('rectangle')}>영역 추가</button>
    </div>
    {annotations.length > 0 && <ol className="hps-annotations-list">
      {annotations.map(a => <li key={a.number} className="hps-annotation" data-stale={a.stale ? 'true' : undefined} aria-label={`표시 ${a.number}`}>
        <div className="hps-annotation-head">
          <span className="hps-annotation-number">표시 #{a.number} · {a.kind === 'rectangle' ? '영역' : '요소'}</span>
          <button type="button" className="hps-annotation-remove" onClick={() => onAction('remove', a.number)} aria-label={`표시 ${a.number} 빼기`}>빼기</button>
        </div>
        {a.stale && <p className="hps-annotation-stale" role="alert">이전 화면의 표시예요. 지우고 다시 골라 주세요. 보내지 않아요.</p>}
        <label className="hps-annotation-field"><span>의견 ({COMMENT_MAX}자까지)</span>
          <input aria-label={`표시 ${a.number} 의견`} maxLength={COMMENT_MAX} defaultValue={a.comment} onChange={e => onAction('comment', a.number, e.target.value)} />
        </label>
        <details><summary>보낼 내용 보기</summary>
          <pre>{a.sentText}</pre>
          {a.imageDataUrl && <img src={a.imageDataUrl} alt={`표시 ${a.number}의 화면 영역`} />}
        </details>
      </li>)}
    </ol>}
  </section>;
}
