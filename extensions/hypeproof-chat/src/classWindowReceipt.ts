import { createHash } from 'node:crypto';
import type { ClassWindow } from './classWindow';

/** Host-only scope: no learner identifiers or credential are stored in the receipt. */
export function classWindowNoticeId(window: ClassWindow | null, identity: Record<string, unknown> | undefined, service: string): string | undefined {
  if (!window || !identity || !['u', 'c', 'p'].every(k => typeof identity[k] === 'string' && identity[k])) return undefined;
  return createHash('sha256').update(JSON.stringify([service, identity.u, identity.c, identity.p, window.id, window.startsAt, window.endsAt])).digest('hex');
}
export const classWindowReceiptKey = (id: string) => 'hps.classWindowDismissed.' + id;
