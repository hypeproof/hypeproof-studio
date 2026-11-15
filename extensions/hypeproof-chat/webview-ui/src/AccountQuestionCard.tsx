import { useEffect, useRef, useState } from 'react';
import type { QuestionView } from '../../src/accountCards';
import type { StartRequest } from '../../src/startPageProtocol';

/** Render a server question as text. This component cannot approve GitHub changes. */
export function AccountQuestionCard({view, post}: {view: QuestionView; post: (message: StartRequest) => void}) {
  const card = view.card;
  const [choice,setChoice] = useState<string>();
  const [text,setText] = useState(card?.text?.value ?? '');
  const shown = useRef<string>();
  useEffect(() => {
    if (!card || !view.binding || view.busy || document.visibilityState === 'hidden') return;
    if (shown.current === view.binding) return;
    shown.current = view.binding;
    post({type:'questionCardAct',binding:view.binding,key:card.key,action:'shown'});
  }, [card,view.binding,view.busy,post]);
  if (!card) return view.message ? <section className="studio-question" aria-label="오늘의 질문"><p role="status">{view.message}</p>{view.status === 'error' && <button onClick={() => post({type:'questionCardRefresh'})}>다시 조회</button>}</section> : null;
  const act = (action: 'answer' | 'skip', selected = choice, selectedAction?: string) => {
    if (!view.binding || view.busy) return;
    post({type:'questionCardAct',binding:view.binding,key:card.key,action,...(action === 'answer' ? {answer:{...(selected ? {choice:selected} : {}),...(selectedAction ? {action:selectedAction} : {}),...(card.text ? {text} : {})}} : {})});
  };
  return <section className="studio-question" aria-label={card.title ?? '오늘의 질문'} data-testid="account-question-card" aria-busy={view.busy}>
    {card.title && <p className="studio-eyebrow">{card.title}</p>}
    {card.preface && <p>{card.preface}</p>}
    <h2 id="start-title">{card.prompt}</h2>
    {card.segments.map((s,i) => <div key={i}>{s.label && <strong>{s.label}</strong>}<p>{s.text}</p></div>)}
    <div className="studio-question-choices">{card.choices.map(c => <button key={c.id} disabled={view.busy} aria-pressed={choice === c.id} onClick={() => card.select === 'tap' ? act('answer',c.id) : setChoice(c.id)}>{c.label}</button>)}</div>
    {card.text && <label>{card.text.label}<textarea value={text} maxLength={card.text.max} placeholder={card.text.placeholder} disabled={view.busy} onChange={e => setText(e.target.value)} /></label>}
    <div className="studio-question-choices">{card.actions.map(a => <button key={a.id} className={a.primary ? 'studio-primary' : undefined} disabled={view.busy || (a.needs_answer && !choice && !text.trim())} onClick={() => act('answer',choice,a.id)}>{a.label}</button>)}{card.skip !== null && <button disabled={view.busy} className="studio-text-button" onClick={() => act('skip')}>{card.skip}</button>}</div>
    {card.note && <p className="studio-card-description">{card.note}</p>}
  </section>;
}
