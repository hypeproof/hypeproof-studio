/** Local draft contract. No credential or execution permission belongs here. */
/** `imports` (#751 U3): bodiless references to instructor prompts the learner imported into this draft. Local provenance, never an instruction. */
import { validTurnToolMode, type TurnToolMode } from './turnTools.ts';
export interface RecoveredRequest { text: string; toolMode: TurnToolMode; images: string[] }
export interface InlineEditDraft { messageId: string; text: string; images: string[] }
export interface ActivityDraft { inlineEdit?: InlineEditDraft; recovered?: RecoveredRequest[]; text: string; images: string[]; queued: string | null; toolMode?: TurnToolMode; queuedToolMode?: TurnToolMode; queuedPaused?: boolean; imports?: Array<{ object_id: string; revision: number; hash16: string }> }
export const emptyActivityDraft = (): ActivityDraft => ({text:'',images:[],queued:null});
export function validActivityDraft(value: unknown): value is ActivityDraft {
  if (!value || typeof value !== 'object') return false;
  const d=value as ActivityDraft;
  return (d.inlineEdit===undefined || !!d.inlineEdit && typeof d.inlineEdit==='object' && Object.keys(d.inlineEdit).every(k=>['messageId','text','images'].includes(k)) && typeof d.inlineEdit.messageId==='string' && d.inlineEdit.messageId.length>0 && d.inlineEdit.messageId.length<=256 && validActivityDraft({text:d.inlineEdit.text,images:d.inlineEdit.images,queued:null})) &&
    (d.recovered===undefined || Array.isArray(d.recovered) && d.recovered.every(item=>!!item && typeof item==='object' && Object.keys(item).every(k=>['text','toolMode','images'].includes(k)) && validTurnToolMode(item.toolMode) && validActivityDraft({text:item.text,images:item.images,queued:null}))) &&
    typeof d.text==='string' && d.text.length<=200000 &&
    (d.toolMode===undefined || validTurnToolMode(d.toolMode)) &&
    (d.queuedToolMode===undefined || d.queued!==null && validTurnToolMode(d.queuedToolMode)) &&
    (d.queuedPaused===undefined || d.queued!==null && typeof d.queuedPaused==='boolean') &&
    (d.queued===null || typeof d.queued==='string' && d.queued.length<=200000) &&
    Array.isArray(d.images) && d.images.length<=10 && d.images.every(i=>typeof i==='string' && /^data:image\//.test(i) && i.length<=12000000) &&
    (d.imports===undefined || Array.isArray(d.imports) && d.imports.length<=8 && d.imports.every(r=>!!r && typeof r.object_id==='string' && /^[A-Za-z0-9-]{8,64}$/.test(r.object_id) && Number.isSafeInteger(r.revision) && r.revision>0 && typeof r.hash16==='string' && /^[a-f0-9]{16}$/.test(r.hash16) && Object.keys(r).length===3));
}
/**
 * #751 U4 — what "the unsent input was preserved" compares. A stop hands a PARKED message back to the draft (same words,
 * another slot), so the comparison is over the words the learner would still have, in the order they wrote them, plus the
 * attachments and import references — not over which slot holds them. Must stay equal to the panel's `draftAfterStop`.
 */
export function preservedDraftContent(value: unknown): unknown {
  if (!validActivityDraft(value)) return value;
  const parked = value.queued?.trim() ?? '', typed = value.text.trim();
  const mode=value.toolMode??'auto', parkedMode=value.queuedToolMode??'auto';
  const effectiveMode=parked && !typed ? parkedMode : mode;
  return { ...(value.inlineEdit ? {inlineEdit:value.inlineEdit} : {}), ...(value.recovered?.length ? {recovered:value.recovered} : {}), text: parked ? (typed ? `${parked}\n${typed}` : parked) : value.text, images: value.images, imports: value.imports ?? [],
    ...(parked && typed && mode!==parkedMode ? {toolModes:[{text:parked,mode:parkedMode},{text:typed,mode}]} : effectiveMode!=='auto' ? {toolMode:effectiveMode} : {}) };
}
