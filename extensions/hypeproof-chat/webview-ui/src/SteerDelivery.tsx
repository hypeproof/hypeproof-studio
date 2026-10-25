import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../src/protocol';
import { motionReduced } from './motion';

export type SteerDeliverySnapshot = { text: string; from: number; scope: string };

/** Presentation only: the host and normal recovery path still own the request. */
export function SteerDelivery({ delivery, messages, streamFor, streaming, sendPending, onDone }: {
  delivery: SteerDeliverySnapshot;
  messages: ChatMessage[];
  streamFor?: string | null;
  streaming: boolean;
  sendPending?: boolean;
  onDone: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const request = messages.slice(delivery.from).find(message => message.role === 'user');
  useEffect(() => {
    if (streaming && streamFor && request?.id === streamFor && request.content === delivery.text.trim()) setAccepted(true);
  }, [streaming, streamFor, request?.id, request?.content, delivery.text]);
  // A turn can end without a streamStart that names this line (app-written replies, or no stream at
  // all). Never leave "보내는 중…" on screen once the turn is over.
  const ran = useRef(false);
  useEffect(() => {
    if (accepted) return;
    if (streaming) ran.current = true;
    else if (!streaming && ran.current) onDone();
  }, [accepted, streaming, request, onDone]);
  const sawPending = useRef(!!sendPending);
  useEffect(() => {
    if (accepted) return;
    if (sendPending) sawPending.current = true;
    else if (!streaming && sawPending.current && request) onDone();
  }, [accepted, sendPending, streaming, request, onDone]);
  useEffect(() => {
    if (!accepted) return;
    const reduced = motionReduced();
    const timer = setTimeout(onDone, reduced ? 0 : 140);
    const cancel = () => clearTimeout(timer);
    return cancel;
  }, [accepted, onDone]);
  return <div className={`hps-queued hps-steer-delivery${accepted ? ' hps-steer-delivered' : ''}`} aria-hidden={accepted || undefined} role={accepted ? undefined : 'status'}>
    <span className="hps-queued-label">{accepted ? '보낸 메시지' : '보내는 중…'}</span>
    <span className="hps-queued-text">{delivery.text}</span>
  </div>;
}
