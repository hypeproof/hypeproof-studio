// REQ-STUDIO-ARTIFACT-PROVENANCE (CGP-KNOW-R-012) — the work folder's files in the 작업 자료 panel,
// each with the provenance label the host derived from recorded events. Text plus a shape symbol,
// never colour alone; no score or capability name. With the activity trash on, each row can move
// its file to the trash (CGP-KNOW-D-013, ActivityTrashPanel). Each row's 정보 opens the file's info
// popover (CGP-KNOW-D-016, ArtifactInfoPopover).

import { useEffect, useRef, useState } from 'react';

import type { ArtifactProvenanceView } from '../../src/artifactProvenanceView';
import { provenanceHistoryText } from '../../src/artifactProvenanceView';
import { ASK_ABOUT_FILE_LABEL } from './askAboutFile';
import { ArtifactInfoPopover } from './ArtifactInfoPopover';

const ROW = { display: 'flex', flexDirection: 'column', gap: 'var(--ds-c-inline-row-gap)', padding: 'var(--ds-c-inline-row-padding)', minHeight: 'var(--ds-c-inline-hit-target)', boxSizing: 'border-box' } as const;
const NOTE = { fontSize: 'var(--ds-c-inline-note-font)', padding: 'var(--ds-c-inline-note-padding)', margin: 'var(--ds-c-inline-note-margin)', lineHeight: 'var(--ds-c-inline-note-leading)' } as const;

/**
 * `view` undefined: not answered yet; null: no work folder to describe. `onAsk` (CGP-KNOW-R-015)
 * is passed only where the seat may attach work-folder files; each row then offers 이 파일에 대해 묻기.
 */
export function ArtifactProvenanceList({ view, onAsk, onTrash, onOpenTurn, trashPending = false }: {
  view: ArtifactProvenanceView | null | undefined;
  onAsk?: (path: string) => void;
  /** CGP-KNOW-D-013 — present only while the activity trash is available; the host confirms natively. */
  onTrash?: (path: string, button: HTMLButtonElement) => void;
  trashPending?: boolean;
  /** CGP-KNOW-D-016 — open a task at a turn; without it the popover still shows its rows, links as plain titles. */
  onOpenTurn?: (taskId: string, messageId: string) => void;
}) {
  // At most one popover; a new list (another task, a turn's end, a reopened panel) closes it.
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const openers = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  const closeInfo = (path: string, restoreFocus: boolean) => {
    refocus.current = restoreFocus ? path : null;
    setInfoFor(null);
  };
  useEffect(() => {
    // A list that replaces the open popover hands focus back to that file's 정보 button, if focus was inside.
    if (infoFor !== null && document.activeElement?.closest?.('[data-artifact-info]')) refocus.current = infoFor;
    setInfoFor(null);
  }, [view]);
  // Escape belongs to the popover first. A native listener on the list runs before the narrow 작업 자료
  // dialog's own native Escape handler (an ancestor), which would otherwise close the whole panel.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = section.current;
    if (infoFor === null || !list) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      const target = event.target as Element | null;
      if (!target?.closest?.('[data-artifact-info]') && target !== openers.current.get(infoFor)) return;
      event.preventDefault();
      event.stopPropagation();
      closeInfo(infoFor, true);
    };
    list.addEventListener('keydown', key);
    return () => list.removeEventListener('keydown', key);
  }, [infoFor]);
  useEffect(() => {
    const path = refocus.current;
    refocus.current = null;
    if (path !== null && infoFor === null) openers.current.get(path)?.focus();
  }, [infoFor, view]);
  return <section ref={section} className="tw-artifacts" aria-labelledby="task-artifacts-title" data-testid="artifact-provenance">
    <h3 id="task-artifacts-title" className="tw-source-list-title">작업 폴더의 파일</h3>
    {view === undefined ? <p className="tw-source-list-title" style={NOTE} role="status">파일 기록을 불러오는 중…</p>
      : view === null ? <p className="tw-source-list-title" style={NOTE}>작업 폴더가 열려 있지 않아서 보여 줄 파일이 없어요.</p>
      : view.unobserved ? <p className="tw-source-list-title" style={NOTE}>아직 기록이 없어요. 이 목록을 열거나 AI에게 요청을 보내면 그때부터 기록해요.</p>
      : <>
        <p className="tw-source-list-title" style={NOTE}>기록에 남은 일로만 표시해요. 무슨 일이 있었는지 기록이 없으면 &lsquo;기록 없음&rsquo;이라고 써요.</p>
        {view.unconfirmed && <p className="tw-source-list-title" style={NOTE} role="status" data-testid="artifact-provenance-unconfirmed">지금 작업 폴더를 다 확인하지 못해서 모든 파일을 &lsquo;기록 없음&rsquo;으로 보여 줘요. 파일이 아주 많거나, Studio를 다시 열었거나, GitHub에서 가져온 뒤에는 이렇게 보여요.</p>}
        {view.entries.length === 0 ? <p className="tw-source-list-title" style={NOTE}>작업 폴더에 아직 파일이 없어요.</p>
          : <ul className="tw-source-list" aria-label="작업 폴더의 파일과 기록">{view.entries.map((entry, index) => {
            const history = provenanceHistoryText(entry);
            const open = infoFor === entry.path;
            const popoverId = `tw-artifact-info-${index}`;
            return <li key={entry.path}><div style={ROW} data-provenance={entry.kind}>
              <span>{entry.path}</span>
              <small><span className="tw-provenance-chip"><span aria-hidden="true" data-provenance-symbol>{entry.symbol}</span><strong>{entry.label}</strong></span>{history && <> · 지금까지: {history}</>}</small>
              {onTrash && <button type="button" className="tw-artifact-ask" data-trash-move="" aria-disabled={trashPending || undefined} aria-label={`휴지통으로 옮기기: ${entry.path}`} onClick={event => { if (!trashPending) onTrash(entry.path, event.currentTarget); }}>휴지통으로 옮기기</button>}
              {onAsk && <button type="button" className="tw-artifact-ask" aria-label={`${ASK_ABOUT_FILE_LABEL}: ${entry.path}`} onClick={() => onAsk(entry.path)}>{ASK_ABOUT_FILE_LABEL}</button>}
              <button type="button" className="tw-artifact-ask" data-artifact-info-open={entry.path} aria-label={`정보: ${entry.path}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popoverId : undefined}
                ref={button => { if (button) openers.current.set(entry.path, button); else openers.current.delete(entry.path); }}
                onClick={() => (open ? closeInfo(entry.path, true) : setInfoFor(entry.path))}>정보</button>
              {open && <ArtifactInfoPopover path={entry.path} id={popoverId} onClose={restore => closeInfo(entry.path, restore)} onOpenTurn={(taskId, messageId) => onOpenTurn?.(taskId, messageId)} />}
            </div></li>;
          })}</ul>}
        {view.more > 0 && <p className="tw-source-list-title" style={NOTE}>파일 {view.more}개는 더 있어서 여기에 다 보여 주지 못했어요.</p>}
      </>}
  </section>;
}
