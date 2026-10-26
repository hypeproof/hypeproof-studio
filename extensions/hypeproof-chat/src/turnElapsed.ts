import type { ChatMessage } from './protocol';

export function elapsedWorkLabel(ms: number, outcome: 'done' | 'stopped'): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60);
  const time = minutes ? `${minutes}분${seconds % 60 ? ` ${seconds % 60}초` : ''}` : `${seconds}초`;
  return outcome === 'stopped' ? `${time} 뒤 멈췄어요` : `${time} 동안 작업했어요`;
}

/** Keep observed receipts when the same mounted conversation receives its saved history.
 * Missing anchors mean that turn is no longer present; never move its receipt to another turn. */
export function retainElapsedReceipts(incoming: ChatMessage[], previous: ChatMessage[]): ChatMessage[] {
  const previousById = new Map(previous.map(m => [m.id, m]));
  return incoming.map(message => {
    const receipt = previousById.get(message.id)?.elapsedTurn;
    return !message.elapsedTurn && receipt?.anchorId === message.id ? { ...message, elapsedTurn: receipt } : message;
  });
}
