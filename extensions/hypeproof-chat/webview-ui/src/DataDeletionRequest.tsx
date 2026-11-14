// CGP-SHELL-R-027 / CGP-SHELL-D-026 — "계정과 데이터 삭제 요청" in the chat settings dialog.
// The webview only asks; the host calls the Service, which records the request for an operator.
// Nothing here deletes anything, and the request never touches files on this computer.
import { useEffect, useRef, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { onHostMessage, postToHost } from './vscode';
import {
  DATA_DELETION_COPY as COPY, DELETION_STATUS_LABEL, canRequestAgain, deletionDate,
  type DataDeletionState, type DeletionRequestView,
} from '../../src/dataDeletionRequest';

/** The status row: a chip with icon + word, the dates, and the hold reason inline (DES-SHELL-26). */
export function DeletionStatusRow({ request }: { request: DeletionRequestView }) {
  const label = DELETION_STATUS_LABEL[request.status];
  const created = deletionDate(request.createdAt);
  const updated = deletionDate(request.updatedAt);
  return (
    <div className="hps-deletion-status" data-status={request.status}>
      <span className="hps-deletion-chip"><ChatIcon kind={label.icon} size={16} /><span>{label.word}</span></span>
      <span className="hps-deletion-date">{COPY.requestedOn} {created}</span>
      {request.status !== 'received' && updated && updated !== created && <span className="hps-deletion-date">{COPY.updatedOn} {updated}</span>}
      {request.status === 'held' && request.reason && <span className="hps-deletion-reason">{request.reason}</span>}
    </div>
  );
}

type Stage = 'idle' | 'confirm' | 'sending';

/** Presentational: everything the row draws for one host state and one local stage. */
export function DataDeletionView({ host, stage, onOpen, onConfirm, onCancel, cancelRef }: {
  host: DataDeletionState; stage: Stage;
  onOpen: () => void; onConfirm: () => void; onCancel: () => void;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  const request = host.state === 'ready' ? host.request : host.state === 'error' ? host.request ?? null : null;
  const mayAsk = host.state !== 'loading' && canRequestAgain(request);
  return (
    <section className="hps-data-deletion" aria-labelledby="hps-data-deletion-title">
      <h3 id="hps-data-deletion-title">{COPY.title}</h3>
      <p>{COPY.intro}</p>
      <p>{COPY.localFiles}</p>
      <div role="status" aria-live="polite">
        {host.state === 'loading' && <p>{COPY.loading}</p>}
        {stage === 'sending' && <p>{COPY.sending}</p>}
        {request && <DeletionStatusRow request={request} />}
      </div>
      {host.state === 'error' && <p role="alert" className="hps-deletion-error">{host.message}</p>}
      {mayAsk && stage === 'idle' && (
        <button type="button" className="hps-all-settings hps-deletion-open" onClick={onOpen}>
          {request?.status === 'done' ? COPY.again : COPY.open}
        </button>
      )}
      {mayAsk && stage !== 'idle' && (
        <div className="hps-deletion-confirm" role="group" aria-labelledby="hps-deletion-confirm-title">
          <p id="hps-deletion-confirm-title"><strong>{COPY.confirmTitle}</strong></p>
          <p>{COPY.confirmBody}</p>
          <p>{COPY.localFiles}</p>
          <div className="hps-deletion-actions">
            <button type="button" className="hps-deletion-cancel" ref={cancelRef} onClick={onCancel} disabled={stage === 'sending'}>{COPY.cancel}</button>
            <button type="button" className="hps-deletion-send" onClick={onConfirm} disabled={stage === 'sending'}>{COPY.confirm}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Stateful row: reads the seat's request when mounted (the dialog mounts it while open). */
export function DataDeletionRequest() {
  const [host, setHost] = useState<DataDeletionState>({ state: 'loading' });
  const [stage, setStage] = useState<Stage>('idle');
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const off = onHostMessage(m => {
      if (m.type !== 'dataDeletionState') return;
      const { type: _type, ...state } = m;
      // An error keeps the last request on screen, so a failed refresh never hides a known status.
      setHost(previous => state.state === 'error' && previous.state === 'ready' ? { ...state, request: previous.request } : state);
      setStage('idle');
    });
    postToHost({ type: 'dataDeletion', action: 'load' });
    return off;
  }, []);
  // The confirm step opens with 취소 focused: sending needs a second, deliberate press.
  useEffect(() => { if (stage === 'confirm') cancelRef.current?.focus(); }, [stage]);
  return <DataDeletionView host={host} stage={stage} cancelRef={cancelRef}
    onOpen={() => setStage('confirm')}
    onCancel={() => setStage('idle')}
    onConfirm={() => { setStage('sending'); postToHost({ type: 'dataDeletion', action: 'submit' }); }} />;
}
