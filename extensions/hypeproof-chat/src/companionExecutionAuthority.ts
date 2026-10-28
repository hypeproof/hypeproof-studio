/** Match an authenticated Service reservation to the exact native owner and phone packet.
 * This parses evidence; it performs no authentication, network call, consent, or dispatch.
 * Call only with the bounded response of the existing native authenticated transport.
 * The caller must still use live Service validation and the durable created-once record.
 */
import { createHash } from 'node:crypto';
import { parseCompanionAuthoringIntent, type CompanionAuthoringIntent } from './companionAuthoringIntent.ts';
import type { CompanionHostRequest } from './companionHostDispatch';
import type { CompanionExecutionReservation } from './companionDesktopHandoff';

export interface CompanionExecutionExpectation {
  packet: string;
  /** Current desktop-selected scope, not a selection taken from incoming mobile JSON. */
  selection: Readonly<CompanionHostRequest>;
  pairingId: string; accountId: string; hostSessionId: string; deviceSessionId: string;
  grantId: string; grantDigest: string; turnId: string;
  /** Existing Service-activated pass identity, separate from the native account session. */
  modelSessionId: string; modelTokenJti: string; modelProfileId: string;
  /** The exact independently approved lease limits; expiry uses Unix seconds. */
  expiresAt: number; maxTurns: number; maxCallsPerTurn: number;
}
export interface VerifiedCompanionExecutionReservation {
  reservation: Readonly<CompanionExecutionReservation>;
  intent: Readonly<CompanionAuthoringIntent>;
  headers: Readonly<{ 'x-hps-turn-id': string; 'x-hps-companion-execution': string }>;
  expiresAtMs: number;
  sdkBinding: Readonly<CompanionExecutionSdkBinding>;
}
/** Fixed Service binding, not an arbitrary SDK-header extension point or grant. */
export interface CompanionExecutionSdkBinding {
  turnId: string; grant_id: string; request_id: string; request_hash: string;
  task_id: string; epoch: number; consent_revision: number; selection_hash: string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
function fail(): never { throw Error('companion_execution_reservation_mismatch'); }

export function companionExecutionHeader(binding: Readonly<CompanionExecutionSdkBinding>, turnId: string | undefined): string {
  if (!object(binding) || !exact(binding,['turnId','grant_id','request_id','request_hash','task_id','epoch','consent_revision','selection_hash'])
    || typeof turnId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(turnId) || binding.turnId !== turnId
    || !/^ceg_[a-f0-9]{32}$/.test(binding.grant_id) || !id(binding.request_id) || !id(binding.task_id)
    || !digest(binding.request_hash) || !digest(binding.selection_hash)
    || !integer(binding.epoch,1,2147483647) || !integer(binding.consent_revision,1,Number.MAX_SAFE_INTEGER)) fail();
  return JSON.stringify({grant_id:binding.grant_id,request_id:binding.request_id,request_hash:binding.request_hash,
    task_id:binding.task_id,epoch:binding.epoch,consent_revision:binding.consent_revision,selection_hash:binding.selection_hash});
}

/** Reconstruct canonical key order instead of trusting the response's JSON property order. */
export function verifyCompanionExecutionReservation(raw: string, expected: CompanionExecutionExpectation, nowMs = Date.now()): VerifiedCompanionExecutionReservation {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16_384 || !integer(nowMs,0,Number.MAX_SAFE_INTEGER)) fail();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail(); }
  if (!object(value) || !exact(value,['schema','capability','grant','turn','authority','authority_digest','scope_authority','dispatch_requires_live_validation'])
    || value.schema !== 'hps-companion-selected-html-execution/1' || value.capability !== 'authoring.selected-html'
    || value.scope_authority !== 'authenticated_host_lease' || value.dispatch_requires_live_validation !== true) fail();
  const intent = parseCompanionAuthoringIntent(expected.packet), selected = expected.selection;
  if (!intent || !selected || Object.keys(selected).length !== Object.keys(intent.selection).length
    || !Object.entries(selected).every(([k,v]) => intent.selection[k as keyof CompanionHostRequest] === v)
    || intent.selection.operation !== 'preview.read' || intent.pairingId !== expected.pairingId || selected.actorId !== expected.accountId
    || ![expected.pairingId,expected.accountId,expected.hostSessionId,expected.deviceSessionId,expected.turnId,
      expected.modelSessionId,expected.modelTokenJti,expected.modelProfileId].every(id)
    || expected.hostSessionId === expected.deviceSessionId || !/^ceg_[a-f0-9]{32}$/.test(expected.grantId) || !digest(expected.grantDigest)
    || !integer(selected.epoch,1,2147483647) || !integer(selected.consentRevision,1,Number.MAX_SAFE_INTEGER)
    || !integer(expected.maxTurns,1,2) || !integer(expected.maxCallsPerTurn,1,12)
    || !integer(expected.expiresAt,1,Math.floor(Number.MAX_SAFE_INTEGER / 1000))
    || expected.expiresAt * 1000 <= nowMs || expected.expiresAt > Math.floor(nowMs / 1000) + 600) fail();
  const authority = {
    schema:'hps-companion-execution-reservation/1', capability:'authoring.selected-html',
    grant_id:expected.grantId, grant_digest:expected.grantDigest, turn_id:expected.turnId,
    request_id:intent.requestId, request_hash:hash(expected.packet), selection_hash:selected.artifactVersion,
    model_session_id:expected.modelSessionId, model_token_jti:expected.modelTokenJti, model_profile_id:expected.modelProfileId,
    account_id:expected.accountId, host_session_id:expected.hostSessionId, device_session_id:expected.deviceSessionId,
    pairing_id:expected.pairingId, host_id:selected.hostId, device_id:selected.deviceId,
    workspace_id:selected.workspaceId, project_id:selected.projectId, task_id:selected.taskId, artifact_id:selected.artifactId,
    epoch:selected.epoch, consent_revision:selected.consentRevision, expires_at:expected.expiresAt,
    max_turns:expected.maxTurns, max_calls_per_turn:expected.maxCallsPerTurn,
  };
  const supplied = value.authority, authorityDigest = hash(JSON.stringify(authority));
  if (!object(supplied) || !exact(supplied,Object.keys(authority))
    || !Object.entries(authority).every(([k,v]) => supplied[k] === v) || value.authority_digest !== authorityDigest) fail();
  const grant = value.grant, turn = value.turn;
  if (!object(grant) || !object(turn) || grant.id !== authority.grant_id || grant.grant_digest !== authority.grant_digest
    || grant.revoked_at !== null || grant.current_selection_hash !== authority.selection_hash
    || !digest(grant.selection_hash) || !integer(grant.created_at,0,Math.floor(nowMs / 1000))
    || Number(grant.created_at) >= expected.expiresAt
    || !['account_id','host_session_id','device_session_id','pairing_id','host_id','device_id','workspace_id','project_id','task_id','artifact_id',
      'epoch','consent_revision','expires_at','max_turns','max_calls_per_turn'].every(k => grant[k] === authority[k as keyof typeof authority])
    || !exact(turn,['turn_id','grant_id','request_id','request_hash','selection_hash','model_session_id','model_token_jti','model_profile_id','ordinal','state','result_hash','created_at','finished_at'])
    || !['turn_id','grant_id','request_id','request_hash','selection_hash','model_session_id','model_token_jti','model_profile_id'].every(k => turn[k] === authority[k as keyof typeof authority])
    || turn.state !== 'reserved' || turn.result_hash !== null || turn.finished_at !== null
    || !integer(turn.ordinal,1,expected.maxTurns) || !integer(turn.created_at,Number(grant.created_at),Math.floor(nowMs / 1000))) fail();
  const binding = {grant_id:authority.grant_id,request_id:authority.request_id,request_hash:authority.request_hash,
    task_id:authority.task_id,epoch:authority.epoch,consent_revision:authority.consent_revision,selection_hash:authority.selection_hash};
  const sdkBinding = Object.freeze({turnId:authority.turn_id,...binding});
  return Object.freeze({
    reservation:Object.freeze({grantId:authority.grant_id,turnId:authority.turn_id,requestHash:authority.request_hash,authorityDigest}),
    intent:Object.freeze({...intent,selection:Object.freeze({...intent.selection})}),
    headers:Object.freeze({'x-hps-turn-id':authority.turn_id,'x-hps-companion-execution':companionExecutionHeader(sdkBinding,authority.turn_id)}),
    sdkBinding,
    expiresAtMs:expected.expiresAt * 1000,
  });
}
