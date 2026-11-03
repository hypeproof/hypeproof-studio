// REQ-STUDIO-MISSING-TASK-FOLDER (CGP-AGENT-R-028, DES-CGP-AGENT-57) — one calm notice above the
// composer when the personal task's folder is gone, with two recovery actions. The host owns the state
// (missingTaskFolder.ts); the draft below stays as it is and sending is held while this shows.

import type { MissingTaskFolderNotice } from "../../src/missingTaskFolder";

export function MissingFolderNotice({ notice, onRepick, onRecheck }: { notice: MissingTaskFolderNotice; onRepick: () => void; onRecheck: () => void }) {
  return (
    <div className="hps-missing-folder" role="status" aria-live="polite" data-testid="missing-task-folder">
      <p className="hps-missing-folder-text">{notice.message}</p>
      {notice.note && <p className="hps-missing-folder-note">{notice.note}</p>}
      <div className="hps-missing-folder-actions">
        <button type="button" className="hps-missing-folder-action" onClick={onRecheck}>다시 확인</button>
        <button type="button" className="hps-missing-folder-action" onClick={onRepick}>{notice.action}</button>
      </div>
    </div>
  );
}
