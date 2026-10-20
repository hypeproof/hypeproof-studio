// REQ-STUDIO-MISSING-TASK-FOLDER (CGP-AGENT-R-028, DES-CGP-AGENT-57) — one calm notice above the
// composer when the personal task's folder is gone, with one action. The host owns the state
// (missingTaskFolder.ts); the draft below stays as it is and sending is held while this shows.

import type { MissingTaskFolderNotice } from "../../src/missingTaskFolder";

export function MissingFolderNotice({ notice, onRepick }: { notice: MissingTaskFolderNotice; onRepick: () => void }) {
  return (
    <div className="hps-missing-folder" role="status" aria-live="polite" data-testid="missing-task-folder">
      <p className="hps-missing-folder-text">{notice.message}</p>
      {notice.note && <p className="hps-missing-folder-note">{notice.note}</p>}
      <button type="button" className="hps-missing-folder-action" onClick={onRepick}>{notice.action}</button>
    </div>
  );
}
