import { useEffect, useRef, useState } from 'react';
import type { AutomationQuestion } from '../../src/automationProtocol';
import type { WebviewMessage } from '../../src/protocol';
import './UserQuestionCard.css';

type Answer = Extract<WebviewMessage, { type: 'automationAnswer' }>;
const affirmative = (question: AutomationQuestion) => ({ connect: 'Google 계정 연결하기', preview: `${question.preview?.messages.length ?? 0}명에게 보내기`, publish: '우리 반에 공유하기', install: '이 스킬 가져오기' }[question.kind as 'connect' | 'preview' | 'publish' | 'install'] ?? '답변 보내기');

/** Ephemeral host-only form; never passes an answer through the chat composer. */
export function UserQuestionCard({ question, onAnswer }: { question: AutomationQuestion; onAnswer(answer: Answer): void }) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const submitted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = `question-title-${question.id}`;
  const helpId = `question-help-${question.id}`;
  const isInput = question.kind === 'text' || question.kind === 'sheet';
  const isChoice = question.kind === 'choice';
  const needsReview = question.kind === 'preview' || question.kind === 'publish';
  const freeText = choice === '__free_text__';
  const ready = isInput ? !!text.trim() : isChoice ? !!choice && (!freeText || !!text.trim()) : !needsReview || reviewed;
  const canSubmit = ready && !pending && (question.kind !== 'preview' || !!question.preview?.messages.length);
  useEffect(() => { setPending(false); submitted.current = false; }, [question]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [question.id]);
  const send = (cancelled = false) => {
    if (submitted.current || (!cancelled && !canSubmit)) return;
    submitted.current = true; setPending(true);
    const answer: Answer = { type: 'automationAnswer', questionId: question.id };
    if (cancelled) answer.cancelled = true;
    else if (isInput || freeText) answer.text = text.trim();
    else if (isChoice && choice) answer.choiceId = choice;
    else answer.approved = true;
    onAnswer(answer);
  };
  return <section className="hps-user-question" aria-labelledby={titleId} aria-busy={pending} data-testid="user-question-card" data-question-id={question.id}>
    <div className="hps-question-label"><span aria-hidden="true">◇</span> 함께 정할 것</div>
    <h3 ref={heading} tabIndex={-1} id={titleId}>{question.title}</h3>
    {question.description && <p className="hps-question-description">{question.description}</p>}
    <p className="hps-question-privacy" id={helpId}>{question.private ? '이 답변과 실제 데이터는 AI 대화에 보내지 않아요.' : '업무의 방식만 알려 주세요. 실제 이름·이메일 주소·회사 정보는 넣지 마세요.'}</p>
    {question.error && <p className="hps-question-error" role="alert">{question.error}</p>}
    <form onSubmit={event => { event.preventDefault(); send(); }} onKeyDown={event => { event.stopPropagation(); if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }}>
      <fieldset disabled={pending} aria-describedby={helpId}>
        <legend className="hps-question-sr">{question.title}</legend>
        {isChoice && <div className="hps-question-options">{question.choices?.map(option => <label className="hps-question-option" key={option.id} data-selected={choice === option.id}><input type="radio" name={`choice-${question.id}`} value={option.id} checked={choice === option.id} onChange={() => setChoice(option.id)} /><span>{option.label}</span></label>)}
          {question.allowFreeText && <label className="hps-question-option" data-selected={freeText}><input type="radio" name={`choice-${question.id}`} value="__free_text__" checked={freeText} onChange={() => setChoice('__free_text__')} /><span>직접 설명할게요</span></label>}
        </div>}
        {(isInput || (isChoice && freeText)) && <label className="hps-question-input-label"><span>{question.kind === 'sheet' ? '내 Google Sheets 주소' : '내 답변'}</span>{question.kind === 'sheet' ? <input type="url" value={text} onChange={event => setText(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" autoComplete="off" spellCheck={false} maxLength={4096} required /> : <textarea value={text} onChange={event => setText(event.target.value)} placeholder="평소 어떻게 처리하는지 편하게 알려 주세요." autoComplete="off" rows={3} maxLength={2000} required />}</label>}
        {question.kind === 'connect' && <p className="hps-question-context">Google 창에서 사용할 계정과 권한을 직접 확인해요. 연결 정보는 이 기기에 보관돼요.</p>}
        {question.preview && <div className="hps-question-preview" aria-label="전송 전 메일 전체 미리보기"><p className="hps-question-count">아직 보내지 않았어요 · {question.preview.messages.length}명</p>{question.preview.messages.map((message,index) => <article key={message.id} className="hps-question-mail"><div className="hps-question-mail-to"><span>{index + 1}</span><b>{message.to}</b></div><h4>{message.subject}</h4><pre>{message.body}</pre></article>)}</div>}
        {question.recipe && <article className="hps-question-skill" aria-label="공유할 이메일 스킬"><div className="hps-question-skill-kind">이메일 스킬 · Google Sheets → Gmail</div><h4>{question.recipe.title}</h4><p>{question.recipe.description}</p><dl><dt>메일 제목</dt><dd>{question.recipe.subjectTemplate}</dd><dt>메일 내용</dt><dd><pre>{question.recipe.bodyTemplate}</pre></dd><dt>명단의 열 이름</dt><dd>{Object.values(question.recipe.columns).join(' · ')}</dd></dl><p className="hps-question-privacy">명단과 Google 연결 정보는 공유하지 않아요. 스킬 안에 직접 적은 업무 정보도 확인해 주세요.</p></article>}
        {needsReview && <label className="hps-question-review"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /><span>{question.kind === 'preview' ? '받는 주소와 모든 메일 내용을 확인했어요.' : '공유할 내용에 실제 이름·주소·회사 정보·비밀값이 없음을 확인했어요.'}</span></label>}
      </fieldset>
      <div className="hps-question-actions"><button type="submit" className="hps-question-submit" disabled={!canSubmit}>{pending ? '답변 확인 중…' : affirmative(question)}</button><button type="button" className="hps-question-cancel" disabled={pending} onClick={() => send(true)}>{question.kind === 'preview' ? '보내지 않기' : '지금은 그만하기'}</button><span role="status" aria-live="polite">{pending ? '입력한 내용을 확인하고 있어요.' : ''}</span></div>
    </form>
  </section>;
}
