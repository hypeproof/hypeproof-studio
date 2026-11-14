// CGP-KNOW-R-028 / DES-KNOW-46 — the open task's two memory switches in the chat settings dialog: native
// checkboxes with visible labels. "이 작업에서 기억 쓰기" is locked once the task has a sent message (a lock glyph and
// the reason as text, tied to the box); "이 작업을 기억에 남기기" can change at any time. The host decides the lock and
// re-checks every change; this component only asks.
import { useId } from 'react';
import { ChatIcon } from './ChatDetails';
import { TASK_MEMORY_COPY as COPY, type TaskMemoryView } from '../../src/taskMemorySwitches';
import type { WebviewMessage } from '../../src/protocol';

export function TaskMemorySwitches({ view, post }: { view: TaskMemoryView; post: (m: WebviewMessage) => void }) {
  const useHint = useId(), keepHint = useId(), lockReason = useId();
  return (
    <fieldset className="hps-task-memory">
      <legend>{COPY.legend}</legend>
      <label className="hps-task-memory-row">
        <input type="checkbox" checked={view.use} disabled={view.useLocked}
          aria-describedby={view.useLocked ? `${lockReason} ${useHint}` : useHint}
          onChange={e => post({ type: 'taskMemorySet', taskId: view.taskId, use: e.currentTarget.checked })} />
        <span>{COPY.use}</span>
      </label>
      {view.useLocked && <p id={lockReason} className="hps-task-memory-lock"><ChatIcon kind="lock" size={16} /><span>{COPY.useLocked}</span></p>}
      <p id={useHint} className="hps-task-memory-hint">{COPY.useHint}</p>
      <label className="hps-task-memory-row">
        <input type="checkbox" checked={view.keep} aria-describedby={keepHint}
          onChange={e => post({ type: 'taskMemorySet', taskId: view.taskId, keep: e.currentTarget.checked })} />
        <span>{COPY.keep}</span>
      </label>
      <p id={keepHint} className="hps-task-memory-hint">{COPY.keepHint}</p>
    </fieldset>
  );
}
