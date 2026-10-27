/** DEV selection declaration only. Input messages must come from the existing verified host cipher. */
import type { CompanionHostRequest } from './companionHostDispatch';
export const COMPANION_SELECTION_SCHEMA = 'hps-companion-selection/1';
export interface CompanionSelectionPair {
 id: string; status: string; account_id: string; host_id: string; device_id: string;
 workspace_id: string; project_id: string; invitation_digest: string; claim_digest: string;
 grant_expires_at: number; capability: string;
 execution_authorized?: false;
}
export interface CompanionSelectionScope { taskId: string; version: number; epoch: number; consentRevision: number }
export interface CompanionSelectionPublication {
 state: 'transport_accepted' | 'delivery_unconfirmed'; requestId: string; messageId: string; revision: number;
}
interface Selection {
 schema: typeof COMPANION_SELECTION_SCHEMA; revision: number; pairingId: string;
 invitationDigest: string; claimDigest: string; request: CompanionHostRequest; execution_authorized: false;
}
export interface CompanionSelectionMessage { message_id: string; message_hash: string; text: string }
export type CompanionSelectionAccepted = { kind: 'selection' | 'duplicate'; messageId: string; revision: number; request: Readonly<CompanionHostRequest> }
 | { kind: 'stale'; messageId: string; revision: number };
const encoder = new TextEncoder();
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const requestKeys = ['schema','requestId','actorId','deviceId','hostId','workspaceId','projectId','taskId','version','epoch','consentRevision','artifactId','artifactVersion','operation'];
function fail(): never { throw Error('companion_selection_invalid'); }
function request(value: unknown, pair: CompanionSelectionPair): CompanionHostRequest {
 if (!object(value) || !exact(value, requestKeys) || value.schema !== 'hps-companion-host-request/1' || value.operation !== 'preview.read'
  || !['requestId','actorId','deviceId','hostId','workspaceId','projectId','taskId','artifactId'].every(k=>id(value[k]))
  || String(value.requestId).length > 96 || !digest(value.artifactVersion)
  || !['version','epoch','consentRevision'].every(k=>integer(value[k]))
  || value.actorId !== pair.account_id || value.deviceId !== pair.device_id || value.hostId !== pair.host_id
  || value.workspaceId !== pair.workspace_id || value.projectId !== pair.project_id) fail();
 return Object.freeze({...value}) as unknown as CompanionHostRequest;
}
function active(pair: CompanionSelectionPair): void {
 if (!pair || pair.status !== 'paired' || pair.capability !== 'preview.read' || !id(pair.id)
  || ('execution_authorized' in pair && pair.execution_authorized !== false)
  || !digest(pair.invitation_digest) || !digest(pair.claim_digest)
  || !Number.isSafeInteger(pair.grant_expires_at) || pair.grant_expires_at <= Math.floor(Date.now()/1000)) fail();
}
async function messageId(text: string): Promise<string> {
 const hash = await globalThis.crypto.subtle.digest('SHA-256',new Uint8Array(encoder.encode(text)).buffer);
 return 'selection_'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function createCompanionSelection(value: CompanionHostRequest, pair: CompanionSelectionPair, revision: number): Promise<{ text: string; messageId: string; request: Readonly<CompanionHostRequest> }> {
 active(pair); if (!Number.isSafeInteger(revision) || revision < 1 || revision > 64) fail();
 const selected = request(value,pair);
 const payload: Selection = {schema:COMPANION_SELECTION_SCHEMA,revision,pairingId:pair.id,invitationDigest:pair.invitation_digest,
  claimDigest:pair.claim_digest,request:selected,execution_authorized:false};
 const text=JSON.stringify(payload);if(encoder.encode(text).length>2032)fail();
 const identifier=await messageId(text);active(pair);
 return Object.freeze({text,messageId:identifier,request:selected});
}
/** One same-live-pair current declaration. No auth, transport, HTML, durable store or execution authority. */
export class CompanionSelectionReceiver {
 private readonly pair: Readonly<CompanionSelectionPair>;
 private readonly knownScope?: Readonly<CompanionSelectionScope>;
 private held: {revision:number;text:string;messageId:string;request:Readonly<CompanionHostRequest>} | null = null;
 private queue: Promise<unknown> = Promise.resolve();
 private pending = 0;
 private closed = false;
 constructor(options:{pair:CompanionSelectionPair;knownScope?:CompanionSelectionScope}) {
  active(options.pair);this.pair=Object.freeze({...options.pair});this.knownScope=options.knownScope?Object.freeze({...options.knownScope}):undefined;
 }
 /** Only pass messages returned by the current device cipher's authenticated host receive(). */
 accept(message:CompanionSelectionMessage):Promise<CompanionSelectionAccepted|null> {
  if(this.closed)return Promise.reject(Error('companion_selection_closed'));
  if(this.pending>=8)return Promise.reject(Error('companion_selection_overloaded'));
  const saved={...message};this.pending++;
  const work=this.queue.then(()=>this.consume(saved));this.queue=work.catch(()=>{});
  return work.finally(()=>{this.pending--;});
 }
 /** Existing caller closes this on logout, pair/scope replacement or disposal. */
 close():void {this.closed=true;this.held=null;}
 private async consume(message:CompanionSelectionMessage):Promise<CompanionSelectionAccepted|null> {
  if(this.closed)throw Error('companion_selection_closed');
  active(this.pair);
  if(!message||typeof message.text!=='string'||encoder.encode(message.text).length>2032)fail();
  let value:unknown;try{value=JSON.parse(message.text);}catch{fail();}
  if(!object(value)||value.schema!==COMPANION_SELECTION_SCHEMA)return null;
  if(!exact(value,['schema','revision','pairingId','invitationDigest','claimDigest','request','execution_authorized'])
   || value.execution_authorized!==false||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||Number(value.revision)>64
   || value.pairingId!==this.pair.id||value.invitationDigest!==this.pair.invitation_digest||value.claimDigest!==this.pair.claim_digest
   || !digest(message.message_hash))fail();
  const selected=request(value.request,this.pair),revision=Number(value.revision);
  if(this.knownScope&&!Object.entries(this.knownScope).every(([key,v])=>selected[key as keyof CompanionHostRequest]===v))fail();
  if(await messageId(message.text)!==message.message_id)fail();active(this.pair);if(this.closed)throw Error('companion_selection_closed');
  if(this.held&&revision<this.held.revision)return Object.freeze({kind:'stale',messageId:message.message_id,revision});
  if(this.held&&revision===this.held.revision){
   if(this.held.text!==message.text||this.held.messageId!==message.message_id)fail();
   return Object.freeze({kind:'duplicate',messageId:message.message_id,revision,request:this.held.request});
  }
  this.held={revision,text:message.text,messageId:message.message_id,request:selected};
  return Object.freeze({kind:'selection',messageId:message.message_id,revision,request:selected});
 }
}
