import { useEffect, useRef, useState, type ReactNode } from 'react';
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
const icon = (phase: CompanionSessionPresentation['phase']): IconKind => phase === 'completed' ? 'check' : ['denied', 'stale', 'failed'].includes(phase) ? 'lock' : phase === 'desktop_handoff' ? 'open-window' : 'clock';
/** Controlled touch surface; no auth, transport, approval, executor, credential or persistent store. */
export function CompanionSessionView({ snapshot, controller, renderPreview }: CompanionSessionViewProps) {
  const presentation = companionSessionPresentation(snapshot), identity = companionSelectionIdentity(snapshot.selection?.request);
  const [pending, setPending] = useState(false), [note, setNote] = useState<string | null>(null);
  const current = useRef(identity), inFlight = useRef(false), mounted = useRef(true);
  current.current = identity;
  useEffect(() => { setNote(null); }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function act() {
    if (inFlight.current || snapshot.busy || !presentation.action) return;
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
  const selected = snapshot.selection, busy = snapshot.busy || pending;
  return <section className="hps-companion-session" aria-label="컴퓨터 결과 보기" data-state={presentation.phase}>
    <header className="hps-companion-heading">
      <p className="hps-companion-project">{selected?.projectName ?? '컴퓨터와 함께 보기'}</p>
      <h2>{selected?.artifactName ?? '내가 만든 결과'}</h2>
      <p className="hps-companion-computer"><ChatIcon kind={snapshot.connection === 'connected' ? 'plug' : 'moon'} size={20}/><span>{snapshot.computerName}</span><span>{snapshot.connection === 'connected' ? '연결됨' : snapshot.connection === 'reconnecting' ? '연결 확인 중' : '연결 기다림'}</span></p>
    </header>
    <div className="hps-companion-status" role="status" aria-live="polite" aria-atomic="true">
      <ChatIcon kind={icon(presentation.phase)} size={24}/>
      <div><h3>{presentation.title}</h3><p>{presentation.body}</p></div>
    </div>
    {presentation.preview && <div className="hps-companion-preview" key={identity} aria-label="컴퓨터에서 선택한 결과" data-testid="companion-preview">{renderPreview(presentation.preview)}</div>}
    {presentation.action && <button type="button" className={'hps-companion-action' + (presentation.preview ? ' hps-companion-action-quiet' : '')} disabled={busy} aria-busy={busy || undefined} onClick={() => { void act(); }}>
      <ChatIcon kind={presentation.action === 'request_preview' ? 'eye' : 'retry'} size={20}/>{busy ? '확인 중' : presentation.actionLabel}
    </button>}
    {note && <p className="hps-companion-note" role="status">{note}</p>}
    <aside className="hps-companion-origin">
      <ChatIcon kind="folder" size={20}/><div><p>원본은 컴퓨터에 있어요.</p><p>휴대폰에서는 전달받은 결과를 봐요. 파일 변경과 허용 확인은 컴퓨터에서 해요.</p></div>
    </aside>
    {selected && <details className="hps-companion-details"><summary>어떤 결과를 보고 있나요?</summary><dl><dt>작업</dt><dd>{selected.projectName}</dd><dt>결과</dt><dd>{selected.artifactName}</dd><dt>컴퓨터에서 고른 판</dt><dd><code>{selected.request.artifactVersion.slice(0,12)}</code></dd></dl><p>컴퓨터에서 선택이 바뀌면 이전 결과 대신 새 선택을 확인해요.</p></details>}
  </section>;
}
