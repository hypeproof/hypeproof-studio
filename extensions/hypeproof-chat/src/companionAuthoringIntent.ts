/** A proposed text draft, never an execution capability. Kept distinct from preview requests. */
import type { CompanionHostRequest } from './companionHostDispatch';
import { parseCompanionPreviewSelection } from './companionSelection.ts';
export interface CompanionAuthoringIntent {
  schema: 'hps-companion-authoring-intent/1'; requestId: string;
  pairingId: string; selection: CompanionHostRequest; text: string;
}
export const COMPANION_AUTHORING_TEXT_BYTES = 1024;
export const COMPANION_AUTHORING_PACKET_BYTES = 2032;
const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
/** Strict envelope validation; the receiver additionally compares every selection field to its native owner. */
export function parseCompanionAuthoringIntent(text: string): CompanionAuthoringIntent | null {
  if (typeof text !== 'string' || encoder.encode(text).length > COMPANION_AUTHORING_PACKET_BYTES) return null;
  let value: unknown; try { value = JSON.parse(text); } catch { return null; }
  if (!object(value) || !exact(value,['schema','requestId','pairingId','selection','text'])
    || value.schema !== 'hps-companion-authoring-intent/1' || !id(value.requestId) || typeof value.pairingId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.pairingId)
    || typeof value.text !== 'string' || !value.text.trim() || value.text.includes('\0')
    || encoder.encode(value.text).length > COMPANION_AUTHORING_TEXT_BYTES || !object(value.selection)) return null;
  const selected = parseCompanionPreviewSelection(value.selection);
  if (!selected || value.requestId === selected.requestId) return null;
  return value as unknown as CompanionAuthoringIntent;
}
/** Freeze one exact packet before encrypted prepare/send; never silently truncate a draft. */
export function createCompanionAuthoringIntent(input: Omit<CompanionAuthoringIntent,'schema'>): Readonly<{text:string;requestId:string}> {
  const text = JSON.stringify({schema:'hps-companion-authoring-intent/1',...input});
  const parsed = parseCompanionAuthoringIntent(text);
  if (!parsed) throw Error('companion_authoring_intent_invalid');
  return Object.freeze({text,requestId:parsed.requestId});
}
