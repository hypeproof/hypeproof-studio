/**
 * CGP-SHELL-R-035 — "새로운 기능" after an update. Local only: no Service call, no event.
 * The record is one globalState entry `{ seen }`: the notes id the learner has already been shown.
 * A fresh install marks the bundled notes as seen (nothing is new to a new learner); an existing
 * profile without a record (updated from a build before this feature) has seen nothing yet.
 */
export interface LearnerNotes { id: string; items: string[] }
export interface WhatsNewState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
  keys(): readonly string[];
}
export const WHATS_NEW_KEY = 'hps.whatsNew.v1';
export const WHATS_NEW_MAX_ITEMS = 3;
export const WHATS_NEW_MAX_CHARS = 40;

// C0/C1 controls, soft hyphen, zero-width/joiners, bidi marks and controls, Hangul/braille blank
// fillers, tag characters and BOM. Line and paragraph separators fold to a space below.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\u2800\ufeff\uffa0]|[\u{e0000}-\u{e007f}]/gu;

/** One line as plain text, or '' when it is empty or over the cap (never truncated mid-word). */
export function cleanNoteLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFC').replace(INVISIBLE, '').replace(/[\s\u2028\u2029]+/gu, ' ').trim();
  return [...text].length <= WHATS_NEW_MAX_CHARS ? text : '';
}

/** Valid notes or null: a safe id and 1-3 clean lines (extra or invalid lines are dropped). */
export function learnerNotes(raw: unknown): LearnerNotes | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, items } = raw as { id?: unknown; items?: unknown };
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(id) || !Array.isArray(items)) return null;
  const lines = items.map(cleanNoteLine).filter(Boolean).slice(0, WHATS_NEW_MAX_ITEMS);
  return lines.length ? { id, items: lines } : null;
}

function seen(state: WhatsNewState): string | null | undefined {
  const record = state.get<{ seen?: unknown }>(WHATS_NEW_KEY);
  if (!record || typeof record !== 'object') return undefined;
  return typeof record.seen === 'string' ? record.seen : null;
}

/** Call first on activation, before anything else writes globalState. */
export async function recordWhatsNewBaseline(state: WhatsNewState, notes: LearnerNotes | null): Promise<void> {
  if (seen(state) !== undefined) return;
  const freshInstall = state.keys().length === 0;
  await state.update(WHATS_NEW_KEY, { seen: freshInstall ? notes?.id ?? null : null });
}

/** Show the panel? `open` is the notes id already shown in this window and not yet dismissed. */
export function whatsNewOffer(state: WhatsNewState, notes: LearnerNotes | null, ctx: { instructor: boolean; open: string | null }): boolean {
  if (!notes || ctx.instructor) return false;
  if (ctx.open === notes.id) return true;
  const value = seen(state);
  // No record means the baseline never ran: fail closed (never surprise the learner twice).
  return value !== undefined && value !== notes.id;
}

/** The panel was drawn: it will not come back after a reload or in a later launch. */
export async function markWhatsNewShown(state: WhatsNewState, notes: LearnerNotes | null, notesId: unknown): Promise<boolean> {
  if (!notes || notesId !== notes.id) return false;
  if (seen(state) !== notes.id) await state.update(WHATS_NEW_KEY, { seen: notes.id });
  return true;
}
