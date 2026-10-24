import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../src/protocol';
import { motionReduced } from './motion';

export type SteerDeliverySnapshot = { text: string; from: number; scope: string };

/** Presentation only: the host and normal recovery path still own the request. */
export function SteerDelivery({ delivery, messages, streamFor, streaming, onDone }: {
  delivery: SteerDeliverySnapshot;
  messages: ChatMessage[];
  streamFor?: string | null;
  streaming: boolean;
  onDone: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const request = messages.slice(delivery.from).find(message => message.role === 'user');
  useEffect(() => {
    if (streaming && streamFor && request?.id === streamFor && request.content === delivery.text.trim()) setAccepted(true);
  }, [streaming, streamFor, request?.id, request?.content, delivery.text]);
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
