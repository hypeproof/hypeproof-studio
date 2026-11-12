// CGP-KNOW-D-027 (DES-KNOW-45) — a memory write as one quiet line in the turn that caused it: secondary text, a
// bookmark glyph, the quoted item on one line (expandable) and a 되돌리기 button. The host wrote the label
// (memoryWriteLine.ts); undoing asks the host, which reverts exactly that write or refuses with a calm sentence.

import { useEffect, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { MEMORY_WRITE_COPY, type MemoryWriteLineView } from '../../src/memoryWriteLine';
import { onHostMessage, postToHost } from './vscode';

export function MemoryWriteLine({ id, view }: { id: string; view: MemoryWriteLineView }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => onHostMessage((m) => { if (m.type === 'memoryWriteResult' && m.id === id) setNotice(m.notice); }), [id]);
  const written = view.kind === 'written';
  const lead = written ? MEMORY_WRITE_COPY.written : view.kind === 'undone' ? MEMORY_WRITE_COPY.undone : MEMORY_WRITE_COPY.restored;
  const quoted = `“${view.item}”`;
  return (
    <div className="hps-memory-write" data-memory-write-state={view.kind} data-testid="memory-write-line">
      <p className="hps-memory-write-text" role="status" aria-live="polite">
        <span className="hps-memory-write-mark"><ChatIcon kind="bookmark" size={16} /></span>
        <span className="hps-memory-write-lead">{lead.trimEnd()}</span>{' '}
        <span className={open ? 'hps-memory-write-item hps-memory-write-item-open' : 'hps-memory-write-item'} data-testid="memory-write-item">{quoted}</span>
      </p>
      <button type="button" className="hps-memory-write-expand" aria-expanded={open} aria-label={`${open ? MEMORY_WRITE_COPY.collapse : MEMORY_WRITE_COPY.expand}: ${view.item.slice(0, 40)}`} onClick={() => setOpen(!open)}>
        {open ? MEMORY_WRITE_COPY.collapse : MEMORY_WRITE_COPY.expand}
      </button>
      {written && (
        <button type="button" className="hps-memory-write-undo" aria-label={`${MEMORY_WRITE_COPY.undo}: ${view.item.slice(0, 40)}`} onClick={() => postToHost({ type: 'memoryWriteUndo', id })}>
          {MEMORY_WRITE_COPY.undo}
        </button>
      )}
      {notice && <p className="hps-memory-write-notice" role="status">{notice}</p>}
    </div>
  );
}
