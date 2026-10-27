import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChatIcon, type IconKind } from './ChatDetails';
import { companionSelectionIdentity, companionSessionPresentation, type CompanionSessionSnapshot, type CompanionSessionController, type CompanionSessionPresentation } from './companionSessionPresentation';
import './companionSessionView.css';
export type { CompanionSessionSnapshot, CompanionSessionController } from './companionSessionPresentation';
export interface CompanionSessionViewProps {
  snapshot: CompanionSessionSnapshot;
  controller: CompanionSessionController;
  /** Reuse the caller's existing isolated preview renderer. Never inject raw HTML into this view. */
  renderPreview(artifact: NonNullable<CompanionSessionPresentation['preview']>): ReactNode;
}
const icon = (phase: CompanionSessionPresentation['phase']): IconKind => ['completed', 'local_cleared'].includes(phase) ? 'check' : ['denied', 'stale', 'failed'].includes(phase) ? 'lock' : phase === 'desktop_handoff' ? 'open-window' : 'clock';
/** Controlled touch surface; no auth, transport, approval, executor, credential or persistent store. */
export function CompanionSessionView({ snapshot, controller, renderPreview }: CompanionSessionViewProps) {
  const identity = companionSelectionIdentity(snapshot.selection?.request);
  const [forgetStage, setForgetStage] = useState<'idle' | 'confirming' | 'pending' | 'failed' | 'cleared'>('idle');
  const presentation: CompanionSessionPresentation = forgetStage === 'cleared'
    ? { phase: 'local_cleared', title: '이 기기의 보기 기록을 지웠어요', body: '컴퓨터의 원본은 그대로 있어요. 이미 허용한 컴퓨터 작업은 되돌리지 않았어요.', action: null, actionLabel: '', preview: null }
    : companionSessionPresentation(snapshot);
  const forgetTitle = useId(), forgetDescription = useId();
  const forgetEntry = useRef<HTMLButtonElement>(null), cancelForget = useRef<HTMLButtonElement>(null), status = useRef<HTMLDivElement>(null);
  const returnToForget = useRef(false), owner = useRef(controller); owner.current = controller;
  const [pending, setPending] = useState(false), [note, setNote] = useState<string | null>(null);
  const current = useRef(identity), inFlight = useRef(false), mounted = useRef(true);
  current.current = identity;
  useEffect(() => { setNote(null); }, [identity, controller]);
  useEffect(() => { setForgetStage('idle'); }, [controller]);
  useEffect(() => {
    if (forgetStage === 'confirming') cancelForget.current?.focus();
    if (forgetStage === 'cleared') status.current?.focus();
    if (forgetStage === 'idle' && returnToForget.current) { returnToForget.current = false; forgetEntry.current?.focus(); }
  }, [forgetStage]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function act() {
    if (inFlight.current || snapshot.busy || !presentation.action || ['confirming', 'pending', 'failed'].includes(forgetStage)) return;
    inFlight.current = true; setPending(true); setNote(null);
    const selectedIdentity = identity;
    try {
      if (presentation.action === 'request_preview' && snapshot.selection) await controller.requestPreview(snapshot.selection.request);
      else await controller.reconnect(snapshot.selection?.request ?? null);
    } catch {
      if (mounted.current && current.current === selectedIdentity) setNote('연결 상태를 확인하지 못했어요. 컴퓨터의 연결을 확인한 뒤 다시 눌러 주세요.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }
  function askForget() {
    if (inFlight.current || snapshot.busy || !controller.forget) return;
    setNote(null); setForgetStage('confirming');
  }
  async function forget() {
    if (inFlight.current || snapshot.busy || !controller.forget || !['confirming', 'failed'].includes(forgetStage)) return;
    inFlight.current = true; setPending(true); setForgetStage('pending'); setNote(null);
    const selectedOwner = controller;
    try {
      await selectedOwner.forget!();
      if (mounted.current && owner.current === selectedOwner) setForgetStage('cleared');
    } catch {
      if (mounted.current && owner.current === selectedOwner) setForgetStage('failed');
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const selected = snapshot.selection, busy = snapshot.busy || pending;
  const confirmingForget = !!controller.forget && ['confirming', 'pending', 'failed'].includes(forgetStage);
  return <section className="hps-companion-session" aria-label="컴퓨터 결과 보기" data-state={presentation.phase}>
    <header className="hps-companion-heading">
      <p className="hps-companion-project">{selected?.projectName ?? '컴퓨터와 함께 보기'}</p>
      <h2>{selected?.artifactName ?? '내가 만든 결과'}</h2>
      <p className="hps-companion-computer"><ChatIcon kind={snapshot.connection === 'connected' ? 'plug' : 'moon'} size={20}/><span>{snapshot.computerName}</span><span>{snapshot.connection === 'connected' ? '연결됨' : snapshot.connection === 'reconnecting' ? '연결 확인 중' : '연결 기다림'}</span></p>
    </header>
    <div ref={status} tabIndex={-1} className="hps-companion-status" role="status" aria-live="polite" aria-atomic="true">
      <ChatIcon kind={icon(presentation.phase)} size={24}/>
      <div><h3>{presentation.title}</h3><p>{presentation.body}</p></div>
    </div>
    {presentation.preview && <div className="hps-companion-preview" key={identity} aria-label="컴퓨터에서 선택한 결과" data-testid="companion-preview">{renderPreview(presentation.preview)}</div>}
    {presentation.action && <button type="button" className={'hps-companion-action' + (presentation.preview ? ' hps-companion-action-quiet' : '')} disabled={busy || confirmingForget} aria-busy={busy || undefined} onClick={() => { void act(); }}>
      <ChatIcon kind={presentation.action === 'request_preview' ? 'eye' : 'retry'} size={20}/>{forgetStage === 'pending' ? '지우는 중' : busy ? '확인 중' : presentation.actionLabel}
    </button>}
    {controller.forget && forgetStage !== 'cleared' && (confirmingForget
      ? <div className="hps-companion-forget-confirmation" role="group" aria-labelledby={forgetTitle} aria-describedby={forgetDescription} aria-busy={forgetStage === 'pending' || undefined}>
          <h3 id={forgetTitle}>이 기기의 보기 기록을 지울까요?</h3>
          <p id={forgetDescription}>컴퓨터의 원본은 그대로 남아요. 이미 허용한 컴퓨터 작업은 되돌리지 않아요.</p>
          {forgetStage === 'failed' && <p className="hps-companion-note" role="alert">보기 기록을 지웠는지 확인하지 못했어요. 다시 시도해 주세요.</p>}
          <button type="button" className="hps-companion-action" disabled={busy} onClick={() => { void forget(); }}>{forgetStage === 'pending' ? '지우는 중' : forgetStage === 'failed' ? '다시 지우기' : '이 기기의 보기 기록 지우기'}</button>
          <button ref={cancelForget} type="button" className="hps-companion-action hps-companion-action-quiet" disabled={busy} onClick={() => { if (inFlight.current) return; returnToForget.current = true; setForgetStage('idle'); }}>계속 보기</button>
        </div>
      : <button ref={forgetEntry} type="button" className="hps-companion-action hps-companion-action-quiet" disabled={busy} onClick={askForget}>이 기기의 보기 기록 지우기</button>)}
    {note && <p className="hps-companion-note" role="status">{note}</p>}
    <aside className="hps-companion-origin">
      <ChatIcon kind="folder" size={20}/><div><p>원본은 컴퓨터에 있어요.</p><p>휴대폰에서는 전달받은 결과를 봐요. 파일 변경과 허용 확인은 컴퓨터에서 해요.</p></div>
    </aside>
    {selected && forgetStage !== 'cleared' && <details className="hps-companion-details"><summary>어떤 결과를 보고 있나요?</summary><dl><dt>작업</dt><dd>{selected.projectName}</dd><dt>결과</dt><dd>{selected.artifactName}</dd><dt>컴퓨터에서 고른 판</dt><dd><code>{selected.request.artifactVersion.slice(0,12)}</code></dd></dl><p>컴퓨터에서 선택이 바뀌면 이전 결과 대신 새 선택을 확인해요.</p></details>}
  </section>;
}
