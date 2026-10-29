/** One local text/attempt record. This never restores cipher keys or execution authority. */
import {parseCompanionPreviewSelection} from '../../src/companionSelection.ts';
import {parseCompanionAuthoringIntent,COMPANION_AUTHORING_TEXT_BYTES} from '../../src/companionAuthoringIntent.ts';
import type {CompanionHostRequest} from '../../src/companionHostDispatch.ts';
export const COMPANION_DRAFT_BYTES=8192;
export type CompanionDraftValue={phase:'editing';selection:CompanionHostRequest;text:string}
 | {phase:'attempted_unknown';selection:CompanionHostRequest;text:string;packet:string;requestId:string;requestHash:string};
export type CompanionDraftRecord=CompanionDraftValue & {schema:'hps-companion-android-draft/1';accountId:string;service:string;revision:number;createdAt:number;updatedAt:number};
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const draftCanonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const draftHash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export function sameDraftSelection(a:CompanionHostRequest,b:CompanionHostRequest):boolean {
 // Request/pair/device identity changes on fresh pairing. They remain provenance, not recovered authority.
 return ['actorId','hostId','workspaceId','projectId','taskId','version','epoch','consentRevision','artifactId','artifactVersion','operation']
  .every(k=>a[k as keyof typeof a]===b[k as keyof typeof b]);
}
export async function validateCompanionDraftValue(raw:unknown):Promise<CompanionDraftValue>{
 if(!obj(raw))throw Error('draft_invalid');
 const keys=['phase','selection','text'];if(raw.phase==='attempted_unknown')keys.push('packet','requestId','requestHash');
 if(!['editing','attempted_unknown'].includes(String(raw.phase))||!exact(raw,keys)||typeof raw.text!=='string'||raw.text.includes('\0')
  ||new TextEncoder().encode(raw.text).length>COMPANION_AUTHORING_TEXT_BYTES||!parseCompanionPreviewSelection(raw.selection))throw Error('draft_invalid');
 if(raw.phase==='attempted_unknown'){
  const intent=typeof raw.packet==='string'?parseCompanionAuthoringIntent(raw.packet):null;
  if(!intent||intent.requestId!==raw.requestId||intent.text!==raw.text||await draftHash(raw.packet as string)!==raw.requestHash
   ||draftCanonical(intent.selection)!==draftCanonical(raw.selection))throw Error('draft_invalid');
 }
 return structuredClone(raw) as CompanionDraftValue;
}
export async function parseCompanionDraftRecord(value:unknown,accountId:string):Promise<CompanionDraftRecord>{
 if(!obj(value)||new TextEncoder().encode(JSON.stringify(value)).length>COMPANION_DRAFT_BYTES)throw Error('draft_invalid');
 const {schema,accountId:account,service,revision,createdAt,updatedAt,...payload}=value;
 if(schema!=='hps-companion-android-draft/1'||account!==accountId||typeof service!=='string'||service.length>512
  ||![revision,createdAt,updatedAt].every(v=>Number.isSafeInteger(v)&&Number(v)>=0)||Number(revision)<1)throw Error('draft_invalid');
 const parsed=await validateCompanionDraftValue(payload);
 return {...parsed,schema,accountId:account,service,revision,createdAt,updatedAt} as CompanionDraftRecord;
}
