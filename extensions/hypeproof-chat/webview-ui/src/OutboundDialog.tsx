import { finishModal } from './modalMotion';
import './modalSurface.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { normalizeTextSize } from '../../src/textSize';
import { MEMORY_SELECTED_LABEL } from '../../src/outboundConsent';
import { outboundPromptItemIds, type OutboundPrompt } from '../../src/outboundApproval';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import './outboundDialog.css';

/** DES-KNOW-51: learner-selected memory files sit in their own group, collapsed and unchecked until opened. */
export const MEMORY_GROUP_LABEL = '기억 파일 (기본 제외)';

/** Show control and bidi characters visibly; the approved bytes are the host's, never this text. */
const visible = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069\ufffd]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * CGP-KNOW-D-006 / DES-KNOW-09 — native HTML modal over one host-frozen R-006 manifest: recipient, an unchecked checklist
 * of every item (all are one atomic payload, so 보내기 needs every box), the fixed 포함하지 않는 것 box, 보내기 / 취소.
 * CGP-KNOW-D-033 / DES-KNOW-51: memory items appear only inside a collapsed "기억 파일 (기본 제외)" group (native
 * details/summary, keyboard operable); opening it checks nothing. With no memory item the group says so.
 */
export function OutboundDialog({ prompt, onAnswer, textSize }: { prompt: OutboundPrompt; onAnswer: (id: string, selected: string[] | null) => void; textSize?: unknown }) {
  const dialog = useRef<HTMLDialogElement>(null), answered = useRef(false), composing = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);
  const ids = outboundPromptItemIds(prompt);
  const complete = ids.length > 0 && ids.every(id => selected.includes(id));
  const memoryIds = prompt.sections.flatMap(s => s.items.filter(i => i.memory).map(i => i.id)), memoryCount = memoryIds.length;
  const memoryPending = memoryIds.some(id => !selected.includes(id));
  const renderItem = (item: OutboundPrompt['sections'][number]['items'][number]) => <label key={item.id} className="hps-outbound-item">
    <input type="checkbox" checked={selected.includes(item.id)} onChange={e => { const on = e.target.checked; setSelected(cur => on ? (cur.includes(item.id) ? cur : [...cur, item.id]) : cur.filter(id => id !== item.id)); }} />
    <span>{visible(item.label)} · {item.bytes.toLocaleString('ko-KR')} 바이트{item.memory && <span> · {MEMORY_SELECTED_LABEL}</span>}</span>
  </label>;
  const finish = (value: string[] | null) => { if (answered.current) return; answered.current = true; finishModal(dialog.current, () => onAnswer(prompt.id, value)); };
  useDialogFocus(dialog, { open: true, kind: 'modal', initialFocus: '[data-outbound-cancel]' });
  useEffect(() => { const node = dialog.current; node?.showModal(); node?.querySelector<HTMLButtonElement>('[data-outbound-cancel]')?.focus(); return () => node?.close(); }, []);
  const excluded = prompt.excluded.replace(/^포함하지 않는 것:\s*/, '').split(/,\s*/).filter(Boolean);
  return <dialog ref={dialog} className="hps-outbound hp-modal" aria-labelledby="outbound-title" data-testid="outbound-dialog"
    style={{ '--hp-font-caption': `calc(14px + ${{ base: 0, large: 2, xlarge: 4 }[normalizeTextSize(textSize)]}px)` } as CSSProperties}
    onCancel={e => { e.preventDefault(); if (!composing.current) finish(null); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDownCapture={e => {
      if (imeComposing(e, composing.current)) { e.stopPropagation(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); }
    }}>
    <h2 id="outbound-title">보내기 전 확인</h2>
    {prompt.sections.map((section, si) => <fieldset key={si} className="hps-outbound-section">
      <legend>{si === 0 ? '받는 곳' : '함께 보내는 것 — 받는 곳'}: <strong data-outbound-recipient>{visible(section.recipient)}</strong></legend>
      {si === 0 && prompt.public && <p>누구나 볼 수 있어요</p>}
      {si === 0 && prompt.notes.map((note, ni) => <p key={ni}>{visible(note)}</p>)}
      {section.items.filter(item => !item.memory).map(renderItem)}
      {(section.items.some(item => item.memory) || (si === 0 && !memoryCount)) && <details className="hps-outbound-memory" data-outbound-memory>
        <summary>{MEMORY_GROUP_LABEL}{section.items.some(item => item.memory) && <span> · {section.items.filter(item => item.memory).length}개</span>}</summary>
        {section.items.some(item => item.memory)
          ? <><p>직접 고른 기억 파일이에요. 펼쳐서 확인해야 함께 보낼 수 있어요.</p>{section.items.filter(item => item.memory).map(renderItem)}</>
          : <p>이 전송에는 기억 파일이 없어요.</p>}
      </details>}
    </fieldset>)}
    <section className="hps-outbound-excluded" aria-labelledby="outbound-excluded-title">
      <h3 id="outbound-excluded-title">포함하지 않는 것</h3>
      <ul>{excluded.map(text => <li key={text}>{text}</li>)}</ul>
    </section>
    {!complete && <p className="hps-outbound-hint" id="outbound-hint">보낼 항목을 모두 확인해야 보낼 수 있어요.{memoryPending && ' 기억 파일도 펼쳐서 확인해 주세요.'}</p>}
    <div className="hps-outbound-actions">
      <button type="button" data-outbound-cancel onClick={() => finish(null)}>취소</button>
      <button type="button" className="hps-outbound-send" disabled={!complete} aria-describedby={complete ? undefined : 'outbound-hint'} onClick={() => { if (complete) finish([...selected]); }}>보내기</button>
    </div>
  </dialog>;
}
