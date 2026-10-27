/** Browser-safe bounded receipt consumer; HTML rendering remains the caller's sandboxed preview responsibility. */
import type { CompanionHostRequest, CompanionDispatchResult } from './companionHostDispatch';
const states = ['denied', 'wait_for_host', 'desktop_handoff', 'accepted', 'running', 'outcome_unknown', 'completed', 'failed'];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export async function verifyCompanionPreviewResult(raw: string, expected: CompanionHostRequest, cryptoApi = globalThis.crypto): Promise<CompanionDispatchResult> {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 2032) throw Error('companion_result_oversize');
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
