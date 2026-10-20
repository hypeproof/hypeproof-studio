import { contentBytes, OUTBOUND_EXCLUDED } from "../../src/outboundConsent";
import { useEffect, useState } from 'react';
import type { LocalReviewRequest, LocalReviewState, TaskCard } from '../../src/localReviewProtocol';
import { capabilityModel } from '@hypeproof/measurement-core/capability-models';
import './localReview.css';
import { postLocalReview } from "./vscode";
const bridge = { postMessage: postLocalReview };
const submissionLabels: Record<string, string> = { format: "기록 형식", kind: "기록 종류", id: "제출 식별 정보", parent: "이전 제출", reason: "제출 이유", destination: "보관 위치", interpretations: "선택한 해석", revision: "제출 버전", purpose: "작업 목적", observations: "선택한 대화", reviews: "선택한 검토", excluded: "제외 항목", task: "작업 정보", created_at: "작성 시각", versions: "기록 형식 버전", source: "출처", source_digest: "출처 식별 정보", submitted_at: "제출 시각" };
export function LocalReview() {
  const [state, setState] = useState<LocalReviewState>({ type: 'localReviewState', tasks: [], storage: '' });
  const [busy, setBusy] = useState(false);
  const [include, setInclude] = useState(false);
  useEffect(() => { setInclude(false); }, [state.card?.task.id]);
  const send = (m: LocalReviewRequest) => { setBusy(true); bridge.postMessage(m); };
  useEffect(() => {
    const listener = (event: MessageEvent<LocalReviewState>) => { if (event.data?.type === 'localReviewState') { setState(event.data); setBusy(false); } };
    window.addEventListener('message', listener); bridge.postMessage({ type: 'localReview', action: 'load' });
    return () => window.removeEventListener('message', listener);
  }, []);
  return <main className="local-review">
    <header><p className="eyebrow">나의 작업 기록</p><h1>나의 변화 기록</h1><p>근거를 남기고, 내가 내린 판단을 직접 살펴보고, 무엇을 제출할지 고릅니다.</p></header>
    <aside className="record-policy">Local only · Automatic capture off · No automatic expiry · 256 MiB provisional limit
      <details><summary>Storage and scope</summary><p>{state.storage}</p><p>Select one Claude Code or Codex JSONL transcript from the open project. Only visible user and assistant messages are imported. Known secret patterns are removed; review the text before sharing.</p></details>
    </aside>
    <div className="review-toolbar"><button disabled={busy} onClick={() => send({ type: 'localReview', action: 'recent', host: 'claude-code' })}>최근 Claude 세션</button><button disabled={busy} onClick={() => send({ type: 'localReview', action: 'recent', host: 'codex' })}>최근 Codex 세션</button><button disabled={busy} onClick={() => send({ type: 'localReview', action: 'import', host: 'claude-code' })}>Import Claude task</button><button disabled={busy} onClick={() => send({ type: 'localReview', action: 'import', host: 'codex' })}>Import Codex task</button><button disabled={busy} onClick={() => send({ type: 'localReview', action: 'load' })}>Refresh records</button></div>
    {busy && <p role="status">Saving or reading local records…</p>}{state.error && <p role="alert">{state.error}</p>}{state.notice && <p role="status">{state.notice}</p>}
    <nav aria-label="Saved tasks">{state.tasks.map(t => <button key={t.id} aria-current={t.id === state.card?.task.id ? 'page' : undefined} disabled={busy} onClick={() => send({ type: 'localReview', action: 'open', task: t.id })}>{t.project.split('/').pop()} · {t.status} · {t.id.slice(-8)}</button>)}</nav>
    <OmittedRecords count={state.curriculumTasks ?? 0} busy={busy} onDelete={() => send({ type: 'localReview', action: 'deleteCurriculum' })} />
    {!state.card && !state.error && <p>Import a task to start. A receipt records local acceptance, not task completion or capability growth.</p>}
    {state.card && <TaskReview key={state.card.task.id} card={state.card} busy={busy} send={send} />}
    {state.card && <ImprovementReview key={'improve-' + state.card.task.id} card={state.card} all={state.improvements || []} tasks={state.tasks} busy={busy} send={send} />}
    {state.card && <SubmissionArea card={state.card} preview={state.preview} include={include} busy={busy}
      onInclude={(v) => { setInclude(v); setState(s => ({ ...s, preview: undefined })); }}
      onPreview={() => send({ type: 'localReview', action: 'preview', task: state.card!.task.id, includeEvidence: include })}
      onSubmit={(digest) => send({ type: 'localReview', action: 'submit', task: state.card!.task.id, digest })}
      onCancel={() => setState(s => ({ ...s, preview: undefined }))} />}
  </main>;
}
/**
 * REQ-KNOW-09 — the 나의 변화 기록 submit area: where it goes (this device's inbox), every bundle part with its size, what is
 * never included, then 확인하고 제출 or 취소. Learner copy is Korean only; the exact JSON stays available as data.
 */
export function SubmissionArea({ card, preview, include, busy, onInclude, onPreview, onSubmit, onCancel }: {
  card: TaskCard; preview?: LocalReviewState['preview']; include: boolean; busy: boolean;
  onInclude: (v: boolean) => void; onPreview: () => void; onSubmit: (digest: string) => void; onCancel: () => void;
}) {
  return <section data-submission-area=""><h2>이 기기에 제출하기</h2><p>끝나지 않은 작업도 제출할 수 있어요. 검토한 판단과 작업 목적은 들어가고, 가져온 대화 글은 고를 때만 들어가요.</p>
    <label><input type="checkbox" checked={include} onChange={e => onInclude(e.target.checked)} /> 가져온 대화 글도 함께 넣기</label>
    <button disabled={busy} onClick={onPreview}>제출할 내용 미리 보기</button>
    {preview && <div className="submission-preview" data-submission-preview=""><h3>받는 곳: 이 기기의 검토함</h3>
      <ul>{Object.entries(preview.payload).map(([name, value]) => <li key={name} data-submission-item={name}>{submissionLabels[name] ?? '기타 기록 항목'} · {contentBytes(JSON.stringify(value)).toLocaleString('ko-KR')} 바이트</li>)}</ul>
      <p data-submission-excluded="">{OUTBOUND_EXCLUDED}</p>
      <p>대화 {preview.payload.observations.length}개 · 검토 기록 {preview.payload.reviews.length}개 · 뺀 항목 {preview.payload.excluded.length}개</p>
      <p>제출 버전 {preview.payload.revision} · 확인 번호 <code>{preview.digest}</code></p>
      <details><summary>들어가는 것과 빠지는 것을 그대로 보기</summary><pre>{JSON.stringify(preview.payload, null, 2)}</pre></details>
      <button disabled={busy} data-submission-submit="" onClick={() => onSubmit(preview.digest)}>확인하고 제출</button><button disabled={busy} data-submission-cancel="" onClick={onCancel}>취소</button></div>}
    {card.receipts.map(r => <article className="receipt" key={r.revision}><h3>이 기기에 접수됨 · 제출 버전 {r.revision}</h3><p>{r.id} · {new Date(r.accepted_at).toLocaleString('ko-KR', { hour12: false })}</p><code>{r.digest}</code><p>받는 곳: {r.destination === 'local-inbox' ? '이 기기의 검토함' : '이 기기'} · 저장된 내용 확인함</p></article>)}
  </section>;
}
/**
 * MC-27 — what the list above leaves out, said with its count, and the way to delete it (MC-31).
 * A curriculum task record (SX-55) cannot be opened on this screen, so it is not a row; it is
 * never left out silently either. Nothing is drawn when nothing is left out.
 */
export function OmittedRecords({ count, busy, onDelete }: { count: number; busy: boolean; onDelete: () => void }) {
  if (!(count > 0)) return null;
  return <div className="record-omitted"><p>수업 과제 진행 기록 {count}개는 이 화면에서 열 수 없어 목록에서 뺐어요.</p><button className="danger" disabled={busy} onClick={onDelete}>수업 과제 진행 기록 지우기</button></div>;
}
function TaskReview({ card, busy, send }: { card: TaskCard; busy: boolean; send: (m: LocalReviewRequest) => void }) {
  const [purpose, setPurpose] = useState(card.task.purpose?.text || '');
  const model = capabilityModel(card.interpretation.versions.capability_model.id, card.interpretation.versions.capability_model.revision);
  const userCount = card.observations.filter(o => o.event.kind === 'user').length;
  return <>
    <section><h2>관찰 요약 · Recorded observations</h2><p>사용자 메시지 {userCount} · AI 메시지 {card.observations.length - userCount} · 보존된 검토 {card.reviews.length}건 · 가져온 스냅샷 {card.source.snapshots?.length || 1}개</p><p>Work models: {Array.isArray(card.interpretation.versions.work_ai_models) ? card.interpretation.versions.work_ai_models.join(', ') : 'Unknown'}</p><p>대화량은 역량 점수가 아닙니다. 작업 성공·실제 소요 시간·학습 변화는 미측정입니다.</p><details><summary>기록된 모델 조건과 변경</summary>{card.source.conditions?.map((c,i) => <p key={i}>{c.at || 'Unknown time'} · {c.model} · reasoning: {c.reasoning || 'unknown'} · source line-{c.line}</p>)}<p>Tools, budgets, human help and unrecorded configuration remain unknown. Model names do not guarantee a pinned model version.</p></details></section>
    <section><h2>Task purpose</h2><p>{card.source.host} · {card.source.evidence} · Purpose: {card.task.purpose_state}</p><label>Purpose<textarea value={purpose} maxLength={2000} onChange={e => setPurpose(e.target.value)} /></label><button disabled={busy || !purpose.trim()} onClick={() => send({ type: 'localReview', action: 'purpose', task: card.task.id, text: purpose })}>Save and confirm purpose</button>
      <details><summary>Observation limits and provenance</summary><ul>{card.source.limitations.map(l => <li key={l}>{l}</li>)}</ul><p>Exclusions: {card.source.exclusions.join(', ') || 'No known secret pattern found; not an anonymity guarantee.'}</p><p>Source digest: <code>{card.source.digest}</code></p><p>Model: {card.interpretation.versions.capability_model.id} · Definitions: {card.interpretation.versions.definition_revision}</p></details>
    </section>
    <section><h2>Source evidence</h2><p>These are recorded statements. Assistant claims do not establish executed checks or independent human behavior.</p>{card.observations.map(o => <details key={o.key}><summary>{o.event.kind === 'user' ? 'User message' : 'AI message'} · {o.event.id} · {new Date(o.event.at).toLocaleString()}</summary><pre>{o.event.text}</pre></details>)}</section>
    <section><h2>근거에 연결한 해석</h2><p>Manual review · No AI assessment or score. Confirmation records your judgment about one item.</p><div className="capability-grid">{model?.capabilities.map(c => <Finding key={c.key} card={card} capability={c.key} label={c.key[0] + c.key.slice(1).toLowerCase()} definition={c.observe} insufficient={c.insufficient} busy={busy} send={send} />)}</div></section>
    <section><h2>Results and next check</h2><p>Artifacts and executed verification: not captured by this message import. Task outcome remains {card.task.status}. Record limits or your next check in a capability review note.</p><button className="danger" disabled={busy} onClick={() => send({ type: 'localReview', action: 'delete', task: card.task.id })}>Delete local task</button></section>
  </>;
}
function Finding({ card, capability, label, definition, insufficient, busy, send }: { card: TaskCard; capability: string; label: string; definition: string; insufficient: string; busy: boolean; send: (m: LocalReviewRequest) => void }) {
  const reviews = card.reviews.filter(r => r.capability === capability);
  const last = reviews[reviews.length - 1];
  const [text, setText] = useState(last?.corrected_claim || last?.note || '');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [decision, setDecision] = useState<'confirm' | 'correct' | 'dispute' | 'exclude' | 'hold'>('correct');
  return <article className="capability"><h3>{label}</h3><p>{definition}</p><p>이것만으로는 부족: {insufficient}</p><p>{last ? `Human review: ${last.action}` : 'Insufficient evidence · unreviewed'}</p><p>{last?.corrected_claim || last?.note || card.interpretation.findings.find(f => f.capability === capability)?.claim}</p>
    <details><summary>근거 메시지 선택 ({evidence.length}/10)</summary>{card.observations.map(o => <label key={o.key}><input type="checkbox" checked={evidence.includes(o.key)} disabled={!evidence.includes(o.key) && evidence.length >= 10} onChange={e => setEvidence(v => e.target.checked ? [...v, o.key] : v.filter(k => k !== o.key))} />{o.event.kind === 'user' ? 'User' : 'AI'} · {o.event.id}<pre>{o.event.text.slice(0, 600)}{o.event.text.length > 600 ? '… (full text in Source evidence)' : ''}</pre></label>)}</details>
    <label>{label} judgment and evidence references<textarea maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder="Describe your judgment, cite a message ID, or explain what remains unknown." /></label>
    <label>{label} review decision<select value={decision} onChange={e => setDecision(e.target.value as typeof decision)}><option value="correct">Correct / add judgment</option><option value="confirm">Confirm</option><option value="dispute">Dispute</option><option value="exclude">Exclude from submission</option><option value="hold">Hold</option></select></label>
    <button disabled={busy || (decision === 'correct' && !text.trim())} onClick={() => send({ type: 'localReview', action: 'review', task: card.task.id, capability, decision, text, evidence })}>Save {label} review</button>
    {reviews.length > 0 && <details><summary>{reviews.length} preserved review revision(s)</summary>{reviews.map(r => <p key={r.key}>{r.action}: {r.note || r.corrected_claim || 'No note'} · {new Date(r.at).toLocaleString()}</p>)}</details>}
  </article>;
}

function ImprovementReview({ card, all, tasks, busy, send }: { card: TaskCard; all: NonNullable<LocalReviewState['improvements']>; tasks: LocalReviewState['tasks']; busy: boolean; send: (m: LocalReviewRequest) => void }) {
  const [text, setText] = useState(card.improvements[0]?.text || '');
  const previous = all.filter(i => i.task !== card.task.id && i.choice !== 'skipped' && tasks.some(t => t.id === i.task && t.project === card.task.project));
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState<'tried' | 'not_tried' | 'unknown'>('unknown');
  const [observed, setObserved] = useState('');
  return <section><h2>다음 작업에서 바꿀 행동 하나</h2><label>내가 선택할 행동<textarea maxLength={500} value={text} onChange={e => setText(e.target.value)} /></label><button disabled={busy || !text.trim()} onClick={() => send({ type: 'localReview', action: 'improvement', task: card.task.id, text })}>개선 행동 저장</button>{card.improvements.map(i => <p key={i.id}>선택됨: {i.text} · {i.history.length} revisions</p>)}
    {previous.length > 0 && <><h3>이전 행동을 이번 작업에서 시도했나요?</h3><label>이전 작업의 개선 행동<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">선택하세요</option>{previous.map(i => <option key={i.id} value={i.id}>{i.text}</option>)}</select></label><label>시도 여부<select value={attempt} onChange={e => setAttempt(e.target.value as typeof attempt)}><option value="unknown">아직 모름</option><option value="tried">시도함</option><option value="not_tried">시도하지 않음</option></select></label><label>실제로 관찰한 결과<textarea maxLength={2000} value={observed} onChange={e => setObserved(e.target.value)} /></label><button disabled={busy || !selected} onClick={() => send({ type: 'localReview', action: 'followUp', task: card.task.id, improvement: selected, attempt, observed })}>후속 결과 저장</button>{previous.flatMap(i => i.follow_ups.filter(f => f.task === card.task.id).map((f,n) => <p key={i.id + n}>{i.text} · {f.attempt} · {f.observed || '결과 미확인'} · {new Date(f.at).toLocaleString()}</p>))}</>}
    <p>선택과 후속 기록은 로컬에 보존됩니다. 현재 제출 묶음에는 포함되지 않으며, 기록만으로 역량 향상이 확인되지는 않습니다.</p>
  </section>;
}
