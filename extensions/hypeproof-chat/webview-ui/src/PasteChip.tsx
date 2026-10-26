import { useId, useRef, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { pasteLines, type DraftPart } from './pastedDraft';
/** CGP-CHAT-D-017: the D06 chip family (icon, label, 44px × remove); the inline editor caps at 240px and scrolls itself. */
export const pasteChipLabel = (text: string): string => `붙여넣은 글 · ${pasteLines(text).toLocaleString('en-US')}줄`;
export function PastedDraft({ part, disabled, onChange, onRemove, onInline }: { part: DraftPart; disabled: boolean; onChange: (text: string) => void; onRemove: () => void; onInline: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId(), editor = useRef<HTMLTextAreaElement>(null);
  const label = pasteChipLabel(part.text);
  return <div className="hps-file-context hps-pasted-chip" role="group" aria-label="붙여넣은 글">
    <button type="button" className="hps-file-context-name hps-pasted-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => { setExpanded(!expanded);if (!expanded) requestAnimationFrame(() => editor.current?.focus()); }}>
      <ChatIcon kind="copy" size={16} /><span>{label}</span><ChatIcon kind={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
    </button>
    <button type="button" className="hps-pasted-inline" disabled={disabled} onClick={onInline}>입력창에 펼치기</button>
    <button type="button" className="hps-page-attachment-remove hps-file-context-remove" disabled={disabled} onClick={onRemove} aria-label="붙여넣은 글 빼기" data-hp-tooltip="붙여넣은 글 빼기"><ChatIcon kind="close" size={16} /></button>
    {expanded && <textarea id={id} ref={editor} className="hps-pasted-editor" aria-label="붙여넣은 글 수정" readOnly={disabled} value={part.text} onChange={event => onChange(event.target.value)} />}
  </div>;
}
