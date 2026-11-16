// REQ-QUEST-OFFER / REQ-QUEST-LIST (#4283) — the "퀘스트 생성하기" offer card and the quest card above the composer. The host owns
// the state (src/questIntake.ts); this file only draws it and posts the learner's clicks. The questions themselves are
// ordinary coach replies whose numbered options ReplyChoices already draws.
import { useEffect, useId, useState } from 'react';
import { onHostMessage, postToHost } from './vscode';
import { QUEST_CREATE_LABEL, type QuestIntakeView } from '../../src/questIntake';
import './planFirst.css';
import './questIntake.css';

const NONE: QuestIntakeView = { phase: null };

/** The host's view for the open task; asked again whenever the task changes. */
export function useQuestIntake(scope: string, instructor: boolean): QuestIntakeView {
  const [view, setView] = useState<QuestIntakeView>(NONE);
  useEffect(() => {
    if (instructor) return;
    setView(NONE);
    const off = onHostMessage(message => { if (message.type === 'questIntakeState') setView(message.view ?? NONE); });
    postToHost({ type: 'questIntakeRequest' });
    return off;
  }, [scope, instructor]);
  return instructor ? NONE : view;
}

export function QuestOfferCard({ view }: { view: QuestIntakeView }) {
  const titleId = useId();
  if ((view.phase !== 'offered' && view.phase !== 'generating') || !view.offerId || !view.summary) return null;
  const offerId = view.offerId;
  const generating = view.phase === 'generating';
  return <section className="hps-plan-card hps-quest-offer" role="region" aria-labelledby={titleId} data-testid="quest-offer">
    <h2 id={titleId} className="hps-plan-title">목표를 이렇게 이해했어요</h2>
    <p className="hps-quest-summary">{view.summary}</p>
    {view.error && <p className="hps-plan-note hps-quest-error" role="alert">{view.error}</p>}
    {generating && <p className="hps-plan-note" role="status">퀘스트를 만들고 있어요…</p>}
    <div className="hps-plan-actions">
      <button type="button" className="hps-plan-approve" disabled={generating} onClick={() => postToHost({ type: 'questIntakeCreate', offerId })}>{QUEST_CREATE_LABEL}</button>
      <button type="button" className="hps-plan-secondary" disabled={generating} onClick={() => postToHost({ type: 'questIntakeDismiss', offerId })}>그냥 대화하기</button>
    </div>
  </section>;
}

export function QuestCard({ view }: { view: QuestIntakeView }) {
  const titleId = useId();
  const quest = view.quest;
  const [open, setOpen] = useState(true);
  useEffect(() => { setOpen(true); }, [quest?.title]);
  if (view.phase !== 'quest' || !quest) return null;
  const done = quest.steps.filter(step => step.status === 'succeeded').length;
  const current = quest.steps.find(step => step.status === 'current');
  const finished = done === quest.steps.length;
  return <section className="hps-plan-card hps-quest-card" role="region" aria-labelledby={titleId} data-testid="quest-card">
    <div className="hps-quest-head">
      <h2 id={titleId} className="hps-plan-title">{quest.title}</h2>
      <span className="hps-quest-count">{done} / {quest.steps.length} 완료</span>
    </div>
    {open && <ol className="hps-quest-steps">
      {quest.steps.map((step, index) => <li key={step.id} className={`hps-quest-step ${step.status}`} data-step-id={step.id} aria-current={step.status === 'current' ? 'step' : undefined}>
        <span className="hps-quest-mark" aria-hidden="true">{step.status === 'succeeded' ? '✓' : index + 1}</span>
        <span className="hps-quest-text">
          <span className="hps-quest-label">{step.label}{step.status === 'current' && <span className="hps-quest-now">지금 할 단계</span>}</span>
          {step.description && <span className="hps-quest-desc">{step.description}</span>}
        </span>
      </li>)}
    </ol>}
    <div className="hps-plan-actions">
      {current && <button type="button" className="hps-plan-approve" onClick={() => postToHost({ type: 'questIntakeStep', stepId: current.id })}>「{current.label}」 완료</button>}
      {finished && <p className="hps-plan-note" role="status">모든 단계를 완료했어요.</p>}
      <button type="button" className="hps-plan-secondary" onClick={() => postToHost({ type: 'questIntakeShow' })}>퀘스트 지도 보기</button>
      <button type="button" className="hps-plan-secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '목록 접기' : '목록 펼치기'}</button>
    </div>
  </section>;
}
