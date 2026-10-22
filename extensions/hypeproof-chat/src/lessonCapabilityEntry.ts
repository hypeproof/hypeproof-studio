import { createHash } from 'node:crypto';
import type { ResolvedProfile } from './protocol';

/** Device-local disclosure receipt; no credential or lesson content is persisted. */
export function lessonCapabilityEntryId(profile: ResolvedProfile | null, token: string | undefined, service: string, excluded: boolean): string | undefined {
  const lesson = profile?.lesson;
  if (excluded || !token || !lesson) return undefined;
  const parts = [lesson.course_id, lesson.version, lesson.sha256];
  if (!parts.every(part => typeof part === 'string' && part.length > 0 && part.length <= 512)) return undefined;
  // Service activity_id identifies the seat across credential renewal and folders.
  const seat = /^[a-f0-9]{64}$/.test(profile?.activity_id ?? '')
    ? ['activity', profile!.activity_id] : ['credential', token];
  return createHash('sha256').update(JSON.stringify([service, seat, ...parts])).digest('hex');
}
export const entryReceiptKey = (id: string) => 'hps.lessonCapabilityEntry.' + id;
