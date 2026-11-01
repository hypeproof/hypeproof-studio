// REQ-STUDIO-MEMORY-USE (CGP-KNOW-R-026 / REQ-KNOW-44) — "기억 사용 N" under an answer whose request carried memory.
// N is the host's count of the items laid into that request. Opening it lists those exact items, read from the memory
// files now (a changed or deleted file says so), and each can be left out of the rest of this task or brought back.
// The webview only asks: the host owns the ledger and refuses an item the answer did not use.

import { useEffect, useId, useRef, useState } from 'react';
import { MEMORY_USE_COPY, type MemoryUseEntry } from '../../src/memoryUseView';
import { onHostMessage, postToHost } from './vscode';
import './memoryUse.css';

let requestSeq = 0;
const nextRequestId = () => `memory-use-${Date.now().toString(36)}-${(++requestSeq).toString(36)}`;

/** The host's marks: answer id → count. Anything else is dropped. */
export function acceptMemoryUseMarks(value: unknown): Record<string, number> {
  const out: Record<string, number> = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, n] of Object.entries(value as Record<string, unknown>)) {
    if (id && id.length <= 256 && id !== '__proto__' && typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 20) out[id] = n;
  }
  return out;
}

export function MemoryUseChip({ messageId, count }: { messageId: string; count: number }) {
  const [open, setOpen] = useState(false);
  // undefined: not loaded; null: the host could not answer.
  const [items, setItems] = useState<MemoryUseEntry[] | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const request = useRef<string | null>(null);
  const listId = useId();

  useEffect(() => onHostMessage(message => {
    if (message.type !== 'memoryUseItems' || message.requestId !== request.current || message.messageId !== messageId) return;
    request.current = null;
    setPending(false);
    setItems(message.items);
  }), [messageId]);

  const ask = (extra: { id: string; exclude: boolean } | null) => {
    if (request.current) return;
    const requestId = nextRequestId();
    request.current = requestId;
    setPending(true);
    postToHost({ type: 'memoryUseRequest', requestId, messageId, ...(extra ?? {}) });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Read again on every opening: a file deleted or excluded meanwhile is shown as it is now.
    if (next) { setItems(undefined); ask(null); }
  };

  return <div className="hps-memory-use">
    <button type="button" className="hps-memory-use-chip" aria-expanded={open} aria-controls={listId} onClick={toggle}>
      {MEMORY_USE_COPY.chip(count)}
    </button>
    <div id={listId} className="hps-memory-use-panel" role="region" aria-label={MEMORY_USE_COPY.listLabel} hidden={!open}>
      {open && (items === undefined ? <p className="hps-memory-use-note" role="status">{MEMORY_USE_COPY.loading}</p>
        : items === null ? <p className="hps-memory-use-note" role="status">{MEMORY_USE_COPY.failed}</p>
        : <>
          <p className="hps-memory-use-note">{MEMORY_USE_COPY.intro}</p>
          <ol className="hps-memory-use-list">
            {items.map(item => <li key={item.id} className="hps-memory-use-item">
              {item.text !== null && <p className="hps-memory-use-text" dir="auto">{item.text}</p>}
              {item.state === 'changed' && <p className="hps-memory-use-note">{MEMORY_USE_COPY.changed}</p>}
              {item.state === 'gone' && <p className="hps-memory-use-note">{MEMORY_USE_COPY.gone}</p>}
              {item.excluded && item.state !== 'gone' && <p className="hps-memory-use-note">{MEMORY_USE_COPY.excluded}</p>}
              {item.state !== 'gone' && <button type="button" className="hps-memory-use-action" disabled={pending}
                onClick={() => ask({ id: item.id, exclude: !item.excluded })}>
                {item.excluded ? MEMORY_USE_COPY.include : MEMORY_USE_COPY.exclude}
              </button>}
            </li>)}
          </ol>
        </>)}
    </div>
  </div>;
}
