import { useId, useRef, useState } from 'react';
import { pasteLines, type DraftPart } from './pastedDraft';
export function PastedDraft({ part, disabled, onChange, onRemove, onInline }: { part: DraftPart; disabled: boolean; onChange: (text: string) => void; onRemove: () => void; onInline: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId(), editor = useRef<HTMLTextAreaElement>(null);
  return <div className="hps-panel-fallback hps-pasted-chip" role="group" aria-label="붙여넣은 글">
    <button type="button" className="hps-panel-fallback-retry" aria-expanded={expanded} aria-controls={id} onClick={() => { setExpanded(!expanded);if (!expanded) requestAnimationFrame(() => editor.current?.focus()); }}>붙여넣은 글 ({pasteLines(part.text)}줄)</button>
    <button type="button" className="hps-panel-fallback-retry" disabled={disabled} onClick={onInline}>입력창에 펼치기</button>
    <button type="button" className="hps-panel-fallback-retry" disabled={disabled} onClick={onRemove}>삭제</button>
    {expanded && <textarea id={id} ref={editor} className="hps-pasted-editor" aria-label="붙여넣은 글 수정" readOnly={disabled} value={part.text} onChange={event => onChange(event.target.value)} />}
  </div>;
}
