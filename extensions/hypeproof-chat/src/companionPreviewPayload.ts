/** Payload framing only: no authority, encryption, rendering or durable retention. */
export const COMPANION_PREVIEW_PACKET_BYTES = 2032;
export const COMPANION_PREVIEW_ENVELOPE_BYTES = 32 * 1024;
export const COMPANION_PREVIEW_MAX_PARTS = 48;
/** Explicit DEV framing version; older /1-only receivers cannot consume this producer. */
export const COMPANION_PREVIEW_FRAMING_SCHEMA = 'hps-companion-result-part/2';
const SLICE_BYTES = 1280;
const LEGACY_SCHEMA = 'hps-companion-result-part/1';
const sliceBytesFor = (schema: unknown) => schema === COMPANION_PREVIEW_FRAMING_SCHEMA ? SLICE_BYTES : schema === LEGACY_SCHEMA ? 1024 : 0;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function fail(): never { throw Error('companion_preview_payload_invalid'); }
const validId = (id: string) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), n => n.toString(16).padStart(2, '0')).join('');
}
function envelope(raw: string, requestId: string): void {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schema !== 'hps-companion-host-result/1' || value.requestId !== requestId
    || Object.keys(value).length !== 3 || !record(value.outcome)) fail();
  // Result/artifact semantics remain the existing result verifier's responsibility.
}
/** Preserve the exact serialized envelope, including whitespace and Unicode. */
export async function packCompanionPreviewPayload(raw: string, expectedRequestId: string): Promise<readonly string[]> {
  if (!validId(expectedRequestId) || typeof raw !== 'string') fail();
  const bytes = encoder.encode(raw);
  if (bytes.length > COMPANION_PREVIEW_ENVELOPE_BYTES || decoder.decode(bytes) !== raw) fail();
  envelope(raw, expectedRequestId);
  if (bytes.length <= COMPANION_PREVIEW_PACKET_BYTES) return [raw];
  const sha256Hex = await sha256(bytes);
  const count = Math.ceil(bytes.length / SLICE_BYTES);
  if (count > COMPANION_PREVIEW_MAX_PARTS) fail();
  return Array.from({ length: count }, (_, index) => {
    const packet = JSON.stringify({ schema: COMPANION_PREVIEW_FRAMING_SCHEMA, requestId: expectedRequestId, sha256: sha256Hex,
      length: bytes.length, count, index, data: base64(bytes.subarray(index * SLICE_BYTES, (index + 1) * SLICE_BYTES)) });
    if (encoder.encode(packet).length > COMPANION_PREVIEW_PACKET_BYTES) fail();
    return packet;
  });
}
interface Metadata { schema: string; sha256: string; length: number; count: number }
export interface CompanionPreviewPayloadProgress {
  readonly received: number; readonly total: number; readonly bytes: number;
  readonly complete: boolean; readonly discarded: boolean;
}
/** One bounded in-memory transfer per expected request. Caller explicitly resets/discards it. */
export class CompanionPreviewPayloadReceiver {
  private parts = new Map<number, Uint8Array>();
  private metadata: Metadata | undefined;
  private single: string | undefined;
  private complete = false;
  private discarded = false;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = { count: 0 };
  private readonly expectedRequestId: string;
  constructor(expectedRequestId: string) {
    if (!validId(expectedRequestId)) fail();
    this.expectedRequestId = expectedRequestId;
  }
  get progress(): CompanionPreviewPayloadProgress {
    return Object.freeze({ received: this.single !== undefined ? 1 : this.parts.size,
      total: this.single !== undefined ? 1 : this.metadata?.count ?? 0,
      bytes: this.single !== undefined ? encoder.encode(this.single).length : Array.from(this.parts.values()).reduce((sum, part) => sum + part.length, 0),
      complete: this.complete, discarded: this.discarded });
  }
  reset(): void {
    this.generation++; this.pending = { count: 0 }; this.parts.clear(); this.metadata = undefined; this.single = undefined;
    this.complete = false; this.discarded = false;
  }
  discard(): void { this.reset(); this.discarded = true; }
  /** Null means partial or an exact duplicate; only the complete verified text is emitted. */
  accept(packet: string): Promise<string | null> {
    if (typeof packet !== 'string' || encoder.encode(packet).length > COMPANION_PREVIEW_PACKET_BYTES
      || this.discarded || this.pending.count >= COMPANION_PREVIEW_MAX_PARTS) {
      this.discard();
      return Promise.reject(Error('companion_preview_payload_invalid'));
    }
    const generation = this.generation;
    const pending = this.pending;
    pending.count++;
    const next = this.queue.then(async () => {
      if (generation !== this.generation || this.discarded) fail();
      try { return await this.consume(packet, generation); }
      catch (error) { if (generation === this.generation) this.discard(); throw error; }
    });
    const settled = next.finally(() => { pending.count--; });
    this.queue = settled.catch(() => {});
    return settled;
  }
  private async consume(packet: string, generation: number): Promise<string | null> {
    if (typeof packet !== 'string' || encoder.encode(packet).length > COMPANION_PREVIEW_PACKET_BYTES) fail();
    const part: unknown = JSON.parse(packet);
    if (!record(part)) fail();
    if (part.schema === 'hps-companion-host-result/1') {
      envelope(packet, this.expectedRequestId);
      if (this.metadata || (this.single !== undefined && this.single !== packet)) fail();
      if (this.complete) return null;
      this.single = packet; this.complete = true; return packet;
    }
    const sliceBytes = sliceBytesFor(part.schema);
    if (this.single !== undefined || !sliceBytes || part.requestId !== this.expectedRequestId
      || Object.keys(part).length !== 7 || !Object.keys(part).every(k => ['schema', 'requestId', 'sha256', 'length', 'count', 'index', 'data'].includes(k))
      || typeof part.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.sha256)
      || !Number.isSafeInteger(part.length) || Number(part.length) <= COMPANION_PREVIEW_PACKET_BYTES || Number(part.length) > COMPANION_PREVIEW_ENVELOPE_BYTES
      || !Number.isSafeInteger(part.count) || Number(part.count) !== Math.ceil(Number(part.length) / sliceBytes) || Number(part.count) > COMPANION_PREVIEW_MAX_PARTS
      || !Number.isSafeInteger(part.index) || Number(part.index) < 0 || Number(part.index) >= Number(part.count)
      || typeof part.data !== 'string') fail();
    const metadata = { schema: String(part.schema), sha256: part.sha256 as string, length: Number(part.length), count: Number(part.count) };
    if (this.metadata && (this.metadata.schema !== metadata.schema || this.metadata.sha256 !== metadata.sha256 || this.metadata.length !== metadata.length || this.metadata.count !== metadata.count)) fail();
    const index = Number(part.index);
    const bytes = Uint8Array.from(atob(part.data as string), c => c.charCodeAt(0));
    if (base64(bytes) !== part.data || bytes.length !== Math.min(sliceBytes, metadata.length - index * sliceBytes)) fail();
    const previous = this.parts.get(index);
    if (previous) { if (base64(previous) !== part.data) fail(); return null; }
    this.metadata = metadata; this.parts.set(index, bytes);
    if (this.parts.size !== metadata.count) return null;
    const joined = new Uint8Array(metadata.length);
    for (let i = 0; i < metadata.count; i++) joined.set(this.parts.get(i)!, i * sliceBytes);
    if (await sha256(joined) !== metadata.sha256) fail();
    if (generation !== this.generation) fail();
    const raw = decoder.decode(joined);
    envelope(raw, this.expectedRequestId);
    this.complete = true;
    return raw;
  }
}
