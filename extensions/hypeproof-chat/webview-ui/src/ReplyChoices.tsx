import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MarkdownText } from './MarkdownText';
import { CodeBlockScope } from './CodeBlock';
import { imeComposing } from './imeGuard';
import type { ReplyChoices as Choices } from './replyChoiceParser';

/** Selection prepares the existing draft. Only a separate confirmation may submit it. */
export function ReplyChoices({ question, onPick, onWrite, onSubmit, typing = false, selectionValid = true }: {
  question: Choices; onPick: (answer: string) => void; onWrite: () => void;
  onSubmit?: (answer: string) => boolean; typing?: boolean; selectionValid?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState(false);
  const sent = useRef(false);
  const composing = useRef(false);
  // ChatMessage keys the card to the exact completed turn/content, never the latest turn.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const editing = active?.isContentEditable || (active?.matches?.('input, textarea') && !!(active as HTMLInputElement).value);
    if (typing || editing) { setNotice(true); return; }
    card.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (!selectionValid) setSelected(null); }, [selectionValid]);
  const answer = (index: number) => `${question.options[index].number}. ${question.options[index].label}`;
  const pick = (index: number) => {
    if (sent.current) return;
    setSelected(index); setCursor(index); setNotice(false); onPick(answer(index));
  };
  const confirm = () => {
    if (selected === null || sent.current || composing.current || !onSubmit) return;
    // Latch before invoking the parent: two synchronous Enter events cannot send twice.
    sent.current = true;
    if (!onSubmit(answer(selected))) sent.current = false;
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (imeComposing(event, composing.current)) { event.preventDefault(); event.stopPropagation(); return; }
    // Prose links and explicit controls retain their own keyboard behavior.
    if (event.target !== card.current && !options.current.includes(event.target as HTMLButtonElement)) return;
    if (['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = (cursor + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + question.options.length) % question.options.length;
      setCursor(next); options.current[next]?.focus();
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) pick(cursor);
    } else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) confirm();
    }
  };
  return <div ref={card} className="hps-reply-question" tabIndex={-1} role="group" aria-label="AI의 질문"
    onKeyDown={key} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}>
    <CodeBlockScope id="q-before"><MarkdownText text={question.before} /></CodeBlockScope>
    {notice && <div className="hps-question-arrived" role="status" data-quote-skip="">질문이 왔어요</div>}
    <div className="hps-reply-choices" role="radiogroup" aria-label="답변 선택" data-quote-skip="">
      {question.options.map((option, index) => <button type="button" key={option.number} ref={element => { options.current[index] = element; }}
        role="radio" aria-checked={selected === index} tabIndex={cursor === index ? 0 : -1}
        onFocus={() => setCursor(index)} onClick={() => pick(index)}>
        <span className="hps-choice-number" aria-hidden="true">{option.number}</span><span>{option.label}</span>
        {option.recommended && <span className="hps-choice-recommended">추천</span>}
      </button>)}
    </div>
    <div className="hps-choice-help" data-quote-skip=""><span>선택하면 입력창에 들어갑니다. 확인한 뒤 보내 주세요.</span>
      <button type="button" onClick={() => { setSelected(null); setNotice(false); onWrite(); }}>직접 입력</button>
      {onSubmit && <button type="button" disabled={selected === null} onClick={confirm}>선택한 답변 보내기</button>}
    </div>
    {question.after && <CodeBlockScope id="q-after"><MarkdownText text={question.after} /></CodeBlockScope>}
  </div>;
}
