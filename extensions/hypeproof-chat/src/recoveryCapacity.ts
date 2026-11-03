import type { RecoveredRequest } from './activityDraft.ts';

// Backpressure before a new dispatch; never trim already-owned input.
// Legacy and late receipts remain readable above the admission limits.
export const MAX_RECOVERED_REQUESTS = 8;
export const MAX_RECOVERY_BYTES = 24 * 1024 * 1024;
export const recoveryBytes = (items: RecoveredRequest[]): number =>
  new TextEncoder().encode(JSON.stringify(items)).byteLength;
export function recoveryFull(items: RecoveredRequest[]): boolean {
  return items.length >= MAX_RECOVERED_REQUESTS || recoveryBytes(items) >= MAX_RECOVERY_BYTES;
}
export function canReserveRecovery(items: RecoveredRequest[], next: RecoveredRequest): boolean {
  return items.length < MAX_RECOVERED_REQUESTS && recoveryBytes([...items, next]) <= MAX_RECOVERY_BYTES;
}
