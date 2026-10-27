/** Prepared submission data for the existing normal turn. No runner or authority issuer. */
import { createHash } from 'node:crypto';
import { parseCompanionAuthoringIntent } from './companionAuthoringIntent.ts';
import type { CompanionExecutionPolicy } from './companionExecutionPolicy.ts';
import type { CompanionAuthoringRun, CompanionAuthoringSendSource, CompanionDesktopHandoffCheckpoint, CompanionExecutionReservation } from './companionDesktopHandoff.ts';

export type CompanionNormalTurnReservation = CompanionExecutionReservation;
export interface PreparedCompanionNormalTurn {
  /** Original encrypted-message plaintext bytes; do not reserialize before hashing. */
  packet: string;
  /** Stable timestamp retained by the owner for retries of this exact request. */
  createdAt: number;
  reservation: CompanionNormalTurnReservation;
  /** Lookup/revalidate the separately approved Service reservation, never mint one here. */
  verifyReservation(): Promise<CompanionNormalTurnReservation>;
  /** Authenticated owner/pair/task/executor/profile/folder/consent scope is still current. */
  current(): boolean;
  executionPolicy: CompanionExecutionPolicy;
  signal: AbortSignal;
}
export interface CompanionNormalTurnResult {
  requestId: string; requestHash: string;
  state: 'denied' | 'outcome_unknown' | 'completed' | 'failed';
  code: string;
  /** Terminal proof exists only after a measured normal turn or durable reconciliation. */
  run?: Readonly<CompanionAuthoringRun>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hex = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function sameCompanionReservation(a: CompanionNormalTurnReservation, b: CompanionNormalTurnReservation): boolean {
  return !!b && Object.keys(b).length === 4 && ['grantId','turnId','requestHash','authorityDigest'].every(key => a[key as keyof typeof a] === b[key as keyof typeof b]);
}
export function freezeCompanionNormalTurn(input: PreparedCompanionNormalTurn) {
  const request = parseCompanionAuthoringIntent(input.packet), reservation = Object.freeze({ ...input.reservation });
  if (!request || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0 || !id(reservation.grantId)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reservation.turnId)
    || !hex(reservation.authorityDigest) || reservation.requestHash !== digest(input.packet)
    || Object.keys(reservation).length !== 4 || !input.executionPolicy || !input.signal) throw Error('companion_turn_invalid');
  const { selection, text } = request;
  if (selection.artifactId !== digest('hps-companion-artifact/1:' + input.executionPolicy.artifactPath)) throw Error('companion_selected_file_changed');
  const { requestId: _selectionRequest, operation: _operation, schema: _schema, ...selected } = selection;
  const checkpoint: CompanionDesktopHandoffCheckpoint = {
    schema: 'hps-companion-desktop-handoff-local/1', id: request.requestId, createdAt: input.createdAt,
    target: { ...selected, pairingId: request.pairingId }, originalDraft: text, reviewedIntent: text,
    attachments: [{ artifactId: selection.artifactId, artifactVersion: selection.artifactVersion }], run: { id: null, state: 'not_started' },
  };
  const source: CompanionAuthoringSendSource = { requestId: request.requestId, requestHash: reservation.requestHash,
    taskId: selection.taskId, text, artifactId: selection.artifactId, artifactVersion: selection.artifactVersion };
  // Capture callbacks/objects now; a caller replacing fields while a modal awaits cannot change the submission.
  const { current: ownerCurrent, verifyReservation, executionPolicy, signal } = input;
  const current = () => {
    try { return !signal.aborted && ownerCurrent() === true; } catch { return false; }
  };
  return Object.freeze({ checkpoint, source, reservation, current, verifyReservation, executionPolicy, signal });
}

/** A stored or newly measured normal turn is proof; a transport ACK or prepared row is not. */
export function companionNormalTurnResult(source: CompanionAuthoringSendSource, reservation: CompanionNormalTurnReservation,
  run?: CompanionAuthoringRun): CompanionNormalTurnResult {
  const base = { requestId: source.requestId, requestHash: source.requestHash };
  if (!run || run.userMessageId !== source.requestId || run.turnId !== reservation.turnId || run.runtime !== 'agent-sdk' || run.restorePointId !== run.turnId
    || run.submittedHash !== digest(source.text) || run.beforeArtifactVersion !== source.artifactVersion
    || !hex(run.restoreDigest) || !hex(run.afterArtifactVersion) || !['completed','failed'].includes(run.state))
    return { ...base, state: 'outcome_unknown', code: 'execution_reconciliation_required' };
  return { ...base, state: run.state as 'completed' | 'failed', code: 'normal_turn_measured', run: Object.freeze({ ...run }) };
}
