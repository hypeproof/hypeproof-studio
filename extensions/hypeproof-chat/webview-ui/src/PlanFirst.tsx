// CGP-CHAT-R-004 / CGP-CHAT-D-004 — "먼저 계획 보기": the composer chip and the plan card. The host owns the state
// (src/planFirst.ts); this file only draws it and posts the learner's decision.
import { useEffect, useId, useRef, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { onHostMessage, postToHost } from './vscode';
import './planFirst.css';

export interface PlanFirstView { on: boolean; plan: { id: string; text: string } | null }
export const PLAN_WAITING_LABEL = '계획 승인 기다리는 중';

/** The host's view for the open task; asked again whenever the task changes. */
export function usePlanFirst(scope: string, instructor: boolean): PlanFirstView {
  const [view, setView] = useState<PlanFirstView>({ on: false, plan: null });
  useEffect(() => {
    if (instructor) return;
    setView({ on: false, plan: null });
    const off = onHostMessage(message => {
      if (message.type === 'planFirstState') setView({ on: message.on === true, plan: message.plan ?? null });
    });
    postToHost({ type: 'planFirstRequest' });
    return off;
  }, [scope, instructor]);
  return instructor ? { on: false, plan: null } : view;
}

export function PlanFirstChip({ on, disabled }: { on: boolean; disabled: boolean }) {
  return <button type="button" className="hps-plan-chip" aria-pressed={on} disabled={disabled}
    onClick={() => postToHost({ type: 'planFirstSet', on: !on })}>
    <ChatIcon kind={on ? 'check-square' : 'square'} size={16} /><span>계획 먼저</span>
  </button>;
}

/** Numbered lines of the plan; a model that wrote prose still shows every line. */
export function planSteps(text: string): string[] {
  return text.split('\n').map(line => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter(Boolean);
}

export function PlanCard({ plan }: { plan: { id: string; text: string } }) {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan.text);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(plan.text); setEditing(false); }, [plan.id, plan.text]);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const text = editing ? draft : plan.text;
  const steps = planSteps(text);
  return <section className="hps-plan-card" role="region" aria-labelledby={titleId} data-testid="plan-card">
    <h2 id={titleId} className="hps-plan-title">이렇게 해 볼까요?</h2>
    {editing
      ? <textarea ref={field} className="hps-plan-edit" aria-label="계획 고치기" value={draft} rows={6} maxLength={6000} onChange={event => setDraft(event.target.value)} />
      : <ol className="hps-plan-steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    <p className="hps-plan-note" role="status">{PLAN_WAITING_LABEL}. 승인하기 전에는 아무것도 실행하지 않아요.</p>
    <div className="hps-plan-actions">
      <button type="button" className="hps-plan-approve" disabled={!draft.trim()} onClick={() => postToHost({ type: 'planFirstApprove', planId: plan.id, text: editing ? draft : plan.text })}>이대로 진행</button>
      <button type="button" className="hps-plan-secondary" aria-pressed={editing} onClick={() => setEditing(value => !value)}>{editing ? '고치기 마치기' : '수정'}</button>
      <button type="button" className="hps-plan-secondary" onClick={() => postToHost({ type: 'planFirstRedo', planId: plan.id, text: editing ? draft : plan.text })}>다시 계획</button>
      <button type="button" className="hps-plan-secondary" onClick={() => postToHost({ type: 'planFirstDecline', planId: plan.id })}>그만두기</button>
    </div>
  </section>;
}

/** Personal seat: the mode shows as a selected-tool pill (like 웹 검색) and is switched on in the tools menu. */
export function SelectedPlanFirst({ locked }: { locked: boolean }) {
  return <button type="button" className="hps-selected-tool hps-selected-plan" disabled={locked} aria-label="계획 먼저 해제" onClick={() => postToHost({ type: 'planFirstSet', on: false })}><ChatIcon kind="check-square" size={16} /><span>계획 먼저</span><span aria-hidden="true">×</span></button>;
}
