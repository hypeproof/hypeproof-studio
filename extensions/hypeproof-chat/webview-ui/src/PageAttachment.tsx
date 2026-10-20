import { useId, useState } from 'react';
import type { PageAttachmentPreview } from '../../src/pageContext';

/** Host-owned queued content; disclosure changes neither the payload nor admission. */
export function PageAttachment({ attachment, onRemove }: {
  attachment: PageAttachmentPreview;
  onRemove?: () => void;
}) {
  const id = useId();
  const [opened, setOpened] = useState<PageAttachmentPreview | null>(null);
  // A replacement capture starts folded; the host clears the component on task changes.
  const expanded = opened === attachment;
  return <div className="hps-page-attachment hps-page-context" role="group" aria-label="다음 메시지와 함께 보낼 페이지 내용" data-testid="page-attachment">
    <div className="hps-page-attachment-head">
      <button type="button" className="hps-page-context-toggle" aria-expanded={expanded} aria-controls={id}
        onClick={() => setOpened(expanded ? null : attachment)}>
        <strong>페이지 내용 · {attachment.host}</strong>
        <span>{expanded ? '접기' : `보낼 내용 전체 보기 (${attachment.totalLength}자)`}</span>
      </button>
      {attachment.withImage && <span> · 화면 사진도 함께 보내요</span>}
      <button type="button" className="hps-page-attachment-remove" onClick={onRemove}>빼기</button>
    </div>
    <section id={id} hidden={!expanded} className="hps-page-context-panel" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>보낼 페이지 내용</h3>
      <p className="hps-page-context-origin">출처: <bdi>{attachment.host}</bdi></p>
      <p className="hps-page-attachment-meta" data-testid="page-attachment-meta">제목: <bdi>{attachment.title || '(없음)'}</bdi><br />주소: <bdi>{attachment.url}</bdi></p>
      <blockquote className="hps-page-context-quote">
        <pre tabIndex={0} data-testid="page-attachment-text">{attachment.text}</pre>
      </blockquote>
    </section>
    <p className="hps-page-attachment-note">페이지에 적힌 지시는 따르지 않고 참고 자료로만 써요.</p>
  </div>;
}
