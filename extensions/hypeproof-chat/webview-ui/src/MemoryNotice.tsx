// REQ-STUDIO-MEMORY-NOTICE (CGP-KNOW-R-031 / REQ-KNOW-49, CGP-KNOW-D-031 / DES-KNOW-49) — the one-time memory notice
// above the composer: four short lines (무엇을, 어디에, 누가 보는지, 지우는 법) and one 확인 button. It is passive
// information, not a switch: it never disables the composer or takes focus when it appears, and there is no off choice.
// The host decides when it is due and keeps the record; the webview only asks again on a task or activity change, after
// a turn, and when the memory list changes.

import { useEffect, useRef, useState } from 'react';
import { ChatIcon } from './ChatDetails';
import { onHostMessage, postToHost } from './vscode';
import { MEMORY_NOTICE_COPY, type MemoryNoticeView } from '../../src/memoryNotice';

export function MemoryNotice({ scopeKey, streaming, onDone }: { scopeKey: string; streaming: boolean; onDone?: () => void }) {
  const [notice, setNotice] = useState<MemoryNoticeView | null>(null);
  const [pending, setPending] = useState(false);
  const pressed = useRef(false);

  useEffect(() => {
    setNotice(null); setPending(false); pressed.current = false;
    const dispose = onHostMessage(message => {
      if (message.type === 'memoryNoticeState') {
        setNotice(message.notice); setPending(false);
        // 확인 removes the button: the learner continues in the composer, never on <body>.
        if (pressed.current && !message.notice) onDone?.();
        pressed.current = false;
      }
      // A delete or a new item in the memory list changes whether memory would be used now.
      else if (message.type === 'activityMemoryState' && !message.requestId) postToHost({ type: 'memoryNoticeRequest' });
    });
    postToHost({ type: 'memoryNoticeRequest' });
    return dispose;
  }, [scopeKey]);

  // A finished turn may have left the first memory item behind.
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) postToHost({ type: 'memoryNoticeRequest' });
    wasStreaming.current = streaming;
  }, [streaming]);

  if (!notice) return null;
  return <section className="hps-memory-notice" aria-labelledby="hps-memory-notice-title" data-testid="memory-notice">
    <p id="hps-memory-notice-title" className="hps-memory-notice-title"><ChatIcon kind="info" size={16} /><span>{MEMORY_NOTICE_COPY.title}</span></p>
    <dl className="hps-memory-notice-lines">
      {MEMORY_NOTICE_COPY.lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.text}</dd></div>)}
    </dl>
    <button type="button" className="hps-memory-notice-confirm" aria-disabled={pending || undefined} onClick={() => {
      // A ref, not the state: a second press before the re-render must not send a second ack.
      if (pressed.current) return;
      setPending(true); pressed.current = true;
      postToHost({ type: 'memoryNoticeAck', activity: notice.activity });
    }}>{MEMORY_NOTICE_COPY.confirm}</button>
  </section>;
}
