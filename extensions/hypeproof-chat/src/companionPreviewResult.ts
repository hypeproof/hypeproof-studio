/** Browser-safe bounded receipt consumer; HTML rendering remains the caller's sandboxed preview responsibility. */
import { CompanionPreviewPayloadReceiver, COMPANION_PREVIEW_ENVELOPE_BYTES } from './companionPreviewPayload.ts';
import type { CompanionPreviewPayloadProgress } from './companionPreviewPayload.ts';
import type { CompanionHostRequest, CompanionDispatchResult } from './companionHostDispatch';
const states = ['denied', 'wait_for_host', 'desktop_handoff', 'accepted', 'running', 'outcome_unknown', 'completed', 'failed'];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export async function verifyCompanionPreviewResult(raw: string, expected: CompanionHostRequest, cryptoApi = globalThis.crypto): Promise<CompanionDispatchResult> {
  return verifyCompleteResult(raw, expected, cryptoApi, 2032);
}
async function verifyCompleteResult(raw: string, expected: CompanionHostRequest, cryptoApi: typeof globalThis.crypto, maxBytes: number): Promise<CompanionDispatchResult> {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > maxBytes) throw Error('companion_result_oversize');
  const packet: unknown = JSON.parse(raw);
  if (!record(packet) || !keys(packet, ['schema', 'requestId', 'outcome']) || packet.schema !== 'hps-companion-host-result/1'
    || packet.requestId !== expected.requestId || !record(packet.outcome)) throw Error('companion_result_context_mismatch');
  const out = packet.outcome;
  if (!keys(out, ['state', 'code', 'requestId', 'artifact']) || typeof out.state !== 'string' || !states.includes(out.state)
    || typeof out.code !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(out.code)
    || (out.requestId !== undefined && out.requestId !== expected.requestId)) throw Error('companion_result_invalid');
  if (out.state !== 'completed') {
    if (out.artifact !== undefined) throw Error('companion_result_unexpected_artifact');
    return out as unknown as CompanionDispatchResult;
  }
  const artifact = out.artifact;
  if (!record(artifact) || Object.keys(artifact).length !== 3 || !keys(artifact, ['id', 'version', 'text'])
    || artifact.id !== expected.artifactId || artifact.version !== expected.artifactVersion || typeof artifact.text !== 'string') throw Error('companion_result_artifact_mismatch');
  const digest = Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(artifact.text))), n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== expected.artifactVersion) throw Error('companion_result_artifact_mismatch');
  return out as unknown as CompanionDispatchResult;
}

/** Request-bound semantic consumer. Partial/reconstructed but unverified HTML is never emitted. */
export class CompanionPreviewResultReceiver {
  private readonly expected: Readonly<CompanionHostRequest>;
  private readonly payload: CompanionPreviewPayloadReceiver;
  private readonly cryptoApi: typeof globalThis.crypto;
  private generation = 0;
  private verified = false;
  constructor(expected: CompanionHostRequest, cryptoApi = globalThis.crypto) {
    this.expected = Object.freeze({ ...expected });
    this.payload = new CompanionPreviewPayloadReceiver(this.expected.requestId);
    this.cryptoApi = cryptoApi;
  }
  get progress(): CompanionPreviewPayloadProgress {
    return Object.freeze({ ...this.payload.progress, complete: this.verified });
  }
  reset(): void { this.generation++; this.verified = false; this.payload.reset(); }
  discard(): void { this.generation++; this.verified = false; this.payload.discard(); }
  async accept(packet: string): Promise<CompanionDispatchResult | null> {
    const generation = this.generation;
    try {
      const raw = await this.payload.accept(packet);
      if (generation !== this.generation) throw Error('companion_result_discarded');
      if (raw === null) return null;
      const result = await verifyCompleteResult(raw, this.expected, this.cryptoApi, COMPANION_PREVIEW_ENVELOPE_BYTES);
      if (generation !== this.generation) throw Error('companion_result_discarded');
      this.verified = true;
      return result;
    } catch (error) {
      if (generation === this.generation) this.discard();
      throw error;
    }
  }
}
