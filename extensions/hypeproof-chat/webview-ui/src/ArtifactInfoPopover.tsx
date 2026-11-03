// CGP-KNOW-D-016 (DES-KNOW-29 / REQ-KNOW-29) — the info popover of one work-folder file: 종류, 크기,
// 만든 대화, 마지막으로 바꾼 대화. The host answers from the saved provenance ledger and resolves each
// turn against the task store when asked, so a turn that is gone comes back as plain text, never as a
// dead link. Non-modal: Escape (handled by the list) or 닫기 closes it and returns focus to the row's 정보 button.

import { useEffect, useRef, useState } from 'react';
import type { ArtifactInfo, ArtifactTurnLink } from '../../src/artifactProvenanceView';
import { onHostMessage, postToHost } from './vscode';

let requestSeq = 0;
const nextRequestId = () => `info-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;

export const ARTIFACT_INFO_ROWS = ['종류', '크기', '만든 대화', '마지막으로 바꾼 대화'] as const;

function TurnValue({ link, onOpenTurn }: { link: ArtifactTurnLink; onOpenTurn: (taskId: string, messageId: string) => void }) {
  if (link.kind === 'text') return <span data-artifact-info-text="">{link.text}</span>;
  return <button type="button" className="tw-artifact-info-link" data-artifact-info-link="" onClick={() => onOpenTurn(link.taskId, link.messageId)}>{`‘${link.taskTitle}’ 대화로 가기`}</button>;
}

export function ArtifactInfoPopover({ path, id, onClose, onOpenTurn }: {
  path: string;
  id: string;
  /** `restoreFocus` false when the popover closes because a turn link was followed. */
  onClose: (restoreFocus: boolean) => void;
  onOpenTurn: (taskId: string, messageId: string) => void;
}) {
  // undefined: not answered yet; null: the host could not describe the file.
  const [info, setInfo] = useState<ArtifactInfo | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const requestId = nextRequestId();
    // Only this popover's own request is shown: an answer for an earlier file or opening is dropped.
    const off = onHostMessage(message => {
      if (message.type !== 'artifactInfo' || message.requestId !== requestId) return;
      setInfo(message.info && message.info.path === path ? message.info : null);
    });
    postToHost({ type: 'artifactInfoRequest', requestId, path });
    return off;
  }, [path]);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  const values: (ArtifactTurnLink | string)[] | null = info ? [info.type, info.size, info.created, info.changed] : null;
  // Escape is handled by the list (ArtifactProvenanceList), before any ancestor dialog sees it.
  return <div ref={box} id={id} className="tw-artifact-info" role="dialog" aria-label={`파일 정보: ${path}`} tabIndex={-1} data-artifact-info="">
    {info === undefined ? <p role="status">파일 정보를 불러오는 중…</p>
      : values === null ? <p role="status">파일 정보를 불러오지 못했어요. 목록을 닫았다가 다시 열어 주세요.</p>
      : <dl>{ARTIFACT_INFO_ROWS.map((label, i) => {
        const value = values[i];
        return <div key={label} data-artifact-info-row={label}><dt>{label}</dt><dd>{typeof value === 'string' ? value : <TurnValue link={value} onOpenTurn={(taskId, messageId) => { onClose(false); onOpenTurn(taskId, messageId); }} />}</dd></div>;
      })}</dl>}
    <button type="button" className="tw-artifact-ask tw-artifact-info-close" onClick={() => onClose(true)}>닫기</button>
  </div>;
}
