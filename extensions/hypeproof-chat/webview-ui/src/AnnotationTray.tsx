import {useRef, useState} from 'react';
import type { AnnotationView } from '../../src/annotationBatch';
import { ANNOTATION_LIMIT, COMMENT_MAX } from '../../src/annotationLimits';
import './annotationTray.css';
/** The numbered chips remain editable while one exact outgoing payload is inspected below. */
export function AnnotationTray({annotations, onAction}: {
  annotations: AnnotationView[];
  onAction(action: 'element' | 'rectangle' | 'remove' | 'comment', number?: number, comment?: string): void;
}) {
  const [selected,setSelected]=useState<number|null>(null);
  const full = annotations.length >= ANNOTATION_LIMIT;
  const shown=annotations.find(a=>a.number===selected);
  const stale=annotations.filter(a=>a.stale);
  return <section className="hps-annotations" aria-label="코치에게 보낼 화면 표시" data-testid="annotation-tray">
    <div className="hps-annotations-head">
      <h3 className="hps-annotations-title">화면 표시 {annotations.length}/{ANNOTATION_LIMIT}</h3>
      <p className="hps-annotations-note">번호를 누르면 보낼 내용을 확인해요. 다음 메시지와 함께 보내요.</p>
    </div>
    <div className="hps-annotations-actions">
      <button type="button" disabled={full} onClick={() => onAction('element')}>요소 추가</button>
      <button type="button" disabled={full} onClick={() => onAction('rectangle')}>영역 추가</button>
    </div>
    {stale.length>0 && <p className="hps-annotation-stale" role="alert">표시 {stale.map(a=>a.number).join(', ')}: 이전 화면의 표시예요. 지우고 다시 골라 주세요. 보내지 않아요.</p>}
    {annotations.length > 0 && <ol className="hps-annotations-list">
      {annotations.map(a => <li key={a.number} className="hps-annotation" data-stale={a.stale ? 'true' : undefined} aria-label={`표시 ${a.number}`}>
        <button type="button" className="hps-annotation-preview" aria-label={`표시 #${a.number} · ${a.kind === 'rectangle' ? '영역' : '요소'}: 보낼 내용 보기`} aria-expanded={selected===a.number}
          onClick={()=>setSelected(selected===a.number?null:a.number)}>#{a.number}</button>
        <AnnotationComment key={a.number} annotation={a} onComment={value=>onAction('comment',a.number,value)} />
        <button type="button" className="hps-annotation-remove" onClick={() => onAction('remove', a.number)} aria-label={`표시 ${a.number} 빼기`}>빼기</button>
      </li>)}
    </ol>}
    {shown && <div className="hps-annotation-payload" role="region" aria-label={`표시 ${shown.number} 보낼 내용`}>
      <h4>표시 #{shown.number} · 보낼 내용</h4><pre tabIndex={0}>{shown.sentText}</pre>
      {shown.imageDataUrl && <img src={shown.imageDataUrl} alt={`표시 ${shown.number}의 화면 영역`} />}
    </div>}
  </section>;
}
function AnnotationComment({annotation:a,onComment}:{annotation:AnnotationView;onComment:(value:string)=>void}) {
  const composing=useRef(false);
  // Uncontrolled editing keeps host echo renders from breaking native IME composition.
  // ChatPanel remounts the tray on activity/task changes, so another task cannot reuse this draft.
  return <input aria-label={`표시 ${a.number} 의견`} maxLength={COMMENT_MAX} defaultValue={a.comment} placeholder="의견"
    onCompositionStart={()=>{composing.current=true;}}
    onCompositionEnd={e=>{composing.current=false;onComment(e.currentTarget.value);}}
    onChange={e=>{if(!composing.current)onComment(e.target.value);}} />;
}
