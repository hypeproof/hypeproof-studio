/** Local-only data checkpoint. No credentials, key material, transport counters or authority are stored. */
import type { CompanionHostRequest } from '../../src/companionHostDispatch';
export const COMPANION_CHECKPOINT_TTL_MS = 15 * 60_000;
export const COMPANION_CHECKPOINT_MAX_BYTES = 256 * 1024;
export interface CompanionCheckpointContext {
  accountId: string; sessionId: string; deviceId: string; pairingId: string; cipherContext: string;
  workspaceId: string; artifactId: string; artifactVersion: string; epoch: number;
}
export interface CompanionCheckpointMessage { message_id: string; text: string }
export interface CompanionSessionCheckpoint {
  schema: 'hps-companion-local-checkpoint/1'; createdAt: number; expiresAt: number;
  context: CompanionCheckpointContext; request: CompanionHostRequest;
  validated: CompanionCheckpointMessage[]; pendingAcks: string[];
  batch: CompanionCheckpointMessage[]; cursor: number;
}
/** Owner supplies isolated, atomic local replace/remove; never generic browser storage or cloud sync. */
export interface CompanionCheckpointStorage {
  read(): Promise<string | null>;
  replace(raw: string): Promise<void>;
  remove(): Promise<void>;
}
const encoder = new TextEncoder();
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const requestKeys = ['schema','requestId','actorId','deviceId','hostId','workspaceId','projectId','taskId','version','epoch','consentRevision','artifactId','artifactVersion','operation'];
const contextKeys = ['accountId','sessionId','deviceId','pairingId','cipherContext','workspaceId','artifactId','artifactVersion','epoch'];
function invalid(): never { throw Error('companion_checkpoint_invalid'); }
export function companionCheckpointContext(value: unknown, request: Readonly<CompanionHostRequest>): CompanionCheckpointContext {
  if (!object(value) || !exact(value, contextKeys) || !['accountId','sessionId','deviceId','pairingId','workspaceId','artifactId'].every(k=>id(value[k]))
    || !hash(value.cipherContext) || !hash(value.artifactVersion) || !integer(value.epoch)
    || value.deviceId !== request.deviceId || value.workspaceId !== request.workspaceId || value.artifactId !== request.artifactId
    || value.artifactVersion !== request.artifactVersion || value.epoch !== request.epoch) invalid();
  return Object.freeze({ ...value }) as unknown as CompanionCheckpointContext;
}
export const sameCompanionCheckpointContext = (a: CompanionCheckpointContext, b: CompanionCheckpointContext): boolean => contextKeys.every(k=>a[k as keyof CompanionCheckpointContext]===b[k as keyof CompanionCheckpointContext]);
/** Strict shape/bounds only. Received bytes are semantically reverified by the existing receiver on restore. */
export function parseCompanionSessionCheckpoint(raw: string, now: number): CompanionSessionCheckpoint {
  if (typeof raw !== 'string' || encoder.encode(raw).length > COMPANION_CHECKPOINT_MAX_BYTES) invalid();
  const v: unknown = JSON.parse(raw);
  if (!object(v) || !exact(v,['schema','createdAt','expiresAt','context','request','validated','pendingAcks','batch','cursor'])
    || v.schema !== 'hps-companion-local-checkpoint/1' || !integer(v.createdAt) || !integer(v.expiresAt)
    || v.createdAt > now || v.expiresAt <= now || v.expiresAt <= v.createdAt || v.expiresAt-v.createdAt > COMPANION_CHECKPOINT_TTL_MS
    || !object(v.request) || !exact(v.request,requestKeys)) invalid();
  const r=v.request;
  if (r.schema!=='hps-companion-host-request/1' || r.operation!=='preview.read'
    || !['requestId','actorId','deviceId','hostId','workspaceId','projectId','taskId','artifactId'].every(k=>id(r[k]))
    || !['version','epoch','consentRevision'].every(k=>integer(r[k])) || !hash(r.artifactVersion)) invalid();
  const request = r as unknown as CompanionHostRequest;
  const context=companionCheckpointContext(v.context,request);
  function messages(value: unknown): CompanionCheckpointMessage[] {
    if (!Array.isArray(value) || value.length>64) invalid();
    return value.map(m=>{
      if (!object(m)||!exact(m,['message_id','text'])||!id(m.message_id)||typeof m.text!=='string'||encoder.encode(m.text).length>2032) invalid();
      return {message_id:m.message_id,text:m.text};
    });
  }
  const validated=messages(v.validated),batch=messages(v.batch),byId=new Map(validated.map(m=>[m.message_id,m.text]));
  if (byId.size!==validated.length || !Array.isArray(v.pendingAcks) || v.pendingAcks.length>64
    || v.pendingAcks.some(k=>!id(k)||!byId.has(k)) || new Set(v.pendingAcks).size!==v.pendingAcks.length
    || !integer(v.cursor)||v.cursor>batch.length || batch.slice(0,v.cursor).some(m=>byId.get(m.message_id)!==m.text)) invalid();
  return {schema:v.schema,createdAt:v.createdAt,expiresAt:v.expiresAt,context,request:{...request},validated,pendingAcks:[...v.pendingAcks],batch,cursor:v.cursor};
}
/** Serialized local writes; terminal forget always removes after all already-started replacements. */
const owners = new WeakMap<CompanionCheckpointStorage, { queue: Promise<unknown>; generation: number; pending: number }>();
export class CompanionLocalCheckpoint {
  private readonly owner: { queue: Promise<unknown>; generation: number; pending: number };
  private readonly generation: number;
  private closed = false;
  private readonly storage: CompanionCheckpointStorage;
  private readonly now: () => number;
  constructor(storage: CompanionCheckpointStorage, now = Date.now) {
    this.storage=storage;this.now=now;
    let owner=owners.get(storage);
    if(!owner){owner={queue:Promise.resolve(),generation:0,pending:0};owners.set(storage,owner);}
    this.owner=owner;this.generation=owner.generation;
  }
  time(): number { return this.now(); }
  async load(): Promise<CompanionSessionCheckpoint | null> {
    await this.owner.queue;
    if(this.closed||this.generation!==this.owner.generation)return null;
    const raw=await this.storage.read();
    if(this.closed||this.generation!==this.owner.generation||raw===null)return null;
    try { return parseCompanionSessionCheckpoint(raw,this.now()); }
    catch (error) { await this.forget(); throw error; }
  }
  save(value: CompanionSessionCheckpoint): Promise<void> {
    if(this.closed||this.generation!==this.owner.generation)return Promise.reject(Error('companion_checkpoint_forgotten'));
    const raw=JSON.stringify(value);
    if(this.owner.pending>=2)return Promise.reject(Error('companion_checkpoint_write_bound'));
    try { parseCompanionSessionCheckpoint(raw,this.now()); }
    catch (error) { return this.forget().then(()=>{throw error;}); }
    this.owner.pending++;
    const pending=this.owner.queue.catch(()=>{}).then(()=>this.storage.replace(raw)).finally(()=>{this.owner.pending--;});
    this.owner.queue=pending;return pending;
  }
  forget(): Promise<void> {
    this.closed=true;this.owner.generation++;
    const pending=this.owner.queue.catch(()=>{}).then(()=>this.storage.remove());
    this.owner.queue=pending;return pending;
  }
}
