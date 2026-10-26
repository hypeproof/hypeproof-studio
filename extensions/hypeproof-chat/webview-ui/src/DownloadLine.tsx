// CGP-KNOW-D-021 (DES-KNOW-38) — a Studio-browser download as one quiet line in the chat timeline,
// subordinate to the answers: secondary text at the learner caption size (14px; the register's 13px
// loses to the 14px learner minimum), never a bubble. The host wrote the label
// (browserDownloadNotice.ts); this row only splits it into status word, file name and detail.
//
// - 다운로드 완료: name and size, with 열기 (a Studio editor tab) and 폴더에서 보기 (OS file manager).
//   The host re-checks the file at every press; a refusal shows under the line.
// - 다운로드 실패 / 막힘: name and cause. Stored, so it stays.
// - 다운로드 중: "받는 중", a percentage only when the browser reported a total. The figures are hidden
//   from the live region so a screen reader hears the start and the end, not every refresh.

import { useEffect, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { DOWNLOAD_ACTION_COPY, type DownloadLineView } from '../../src/browserDownloadNotice';
import { onHostMessage, postToHost } from './vscode';

const MARK = {
  done: { icon: 'check', label: '완료' },
  failed: { icon: 'alert', label: '실패' },
  blocked: { icon: 'lock', label: '막힘' },
  running: { icon: 'dots', label: '받는 중' },
} as const;

export function DownloadLine({ id, view }: { id: string; view: DownloadLineView }) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => onHostMessage((m) => { if (m.type === 'downloadLineNotice' && m.id === id) setNotice(m.notice); }), [id]);
  const mark = MARK[view.kind];
  const press = (action: 'open' | 'reveal') => postToHost({ type: 'downloadLineAction', id, action });
  return (
    <div className="hps-download-line" data-download-state={view.kind} data-testid="download-line">
      <p className="hps-download-text" role="status" aria-live="polite">
        <span className="hps-download-mark"><ChatIcon kind={mark.icon} size={16} label={mark.label} /></span>
        <span className="hps-download-status">{view.status}</span>{' '}
        <span className="hps-download-name">{view.name}</span>{' '}
        {view.kind === 'running'
          ? <span className="hps-download-detail">받는 중<span aria-hidden="true">{view.detail.slice('받는 중'.length)}</span></span>
          : <span className="hps-download-detail">{view.kind === 'done' ? `(${view.detail})` : `— ${view.detail}`}</span>}
      </p>
      {view.kind === 'done' && (
        <span className="hps-download-actions">
          <button type="button" aria-label={`${view.name} ${DOWNLOAD_ACTION_COPY.open}`} onClick={() => press('open')}>{DOWNLOAD_ACTION_COPY.open}</button>
          <button type="button" aria-label={`${view.name} ${DOWNLOAD_ACTION_COPY.reveal}`} onClick={() => press('reveal')}>{DOWNLOAD_ACTION_COPY.reveal}</button>
        </span>
      )}
      {notice && <p className="hps-download-notice" role="status">{notice}</p>}
    </div>
  );
}
