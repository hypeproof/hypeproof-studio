/** Local pending-intent data only. Not a wire protocol, run resumption or execution authority. */
export interface CompanionDesktopHandoffTarget {
  actorId: string; deviceId: string; pairingId: string; hostId: string; workspaceId: string; projectId: string;
  taskId: string; version: number; epoch: number; consentRevision: number; artifactId: string; artifactVersion: string;
}
export interface CompanionDesktopHandoffRun {
  id: string | null; state: 'not_started' | 'accepted' | 'running' | 'completed' | 'failed' | 'outcome_unknown';
}
export interface CompanionDesktopHandoffCheckpoint {
  schema: 'hps-companion-desktop-handoff-local/1'; id: string; createdAt: number;
  target: CompanionDesktopHandoffTarget;
  originalDraft: string; reviewedIntent: string;
  attachments: [{ artifactId: string; artifactVersion: string }];
  run: CompanionDesktopHandoffRun;
}
export interface CompanionDesktopHandoffRecord {
  checkpoint: CompanionDesktopHandoffCheckpoint; digest: string;
  status: 'pending' | 'accepted'; acceptedAt?: number;
  /** Draft import receipt only; never a model turn or execution receipt. */
  authoringImport?: { requestHash: string; state: 'review' | 'prepared' | 'imported'; revision?: number; presented?: true };
  /** Ordinary desktop Send provenance only. Reservation is not proof of provider dispatch. */
  authoringRun?: CompanionAuthoringRun;
}
export interface CompanionAuthoringSendSource {
  requestId: string; requestHash: string; taskId: string; text: string; artifactId: string; artifactVersion: string;
}
export interface CompanionAuthoringRun {
  userMessageId: string; turnId: string; submittedHash: string;
  restorePointId: string; restoreDigest: string; artifactPath: string; beforeArtifactVersion: string;
  runtime: 'agent-sdk' | 'proxy' | 'local'; state: 'outcome_unknown' | 'completed' | 'failed'; afterArtifactVersion?: string;
}
export const COMPANION_HANDOFF_TEXT_BYTES = 2048;
const encoder = new TextEncoder();
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === 'string' && !v.includes('\0') && encoder.encode(v).length <= COMPANION_HANDOFF_TEXT_BYTES;
const targetIds = ['actorId','deviceId','pairingId','hostId','workspaceId','projectId','taskId','artifactId'];
const targetNumbers = ['version','epoch','consentRevision'];
export function validCompanionDesktopHandoff(value: unknown): value is CompanionDesktopHandoffCheckpoint {
  if (!object(value) || !exact(value,['schema','id','createdAt','target','originalDraft','reviewedIntent','attachments','run'])
    || value.schema !== 'hps-companion-desktop-handoff-local/1' || !id(value.id) || !integer(value.createdAt)
    || !text(value.originalDraft) || !text(value.reviewedIntent) || !value.reviewedIntent.trim() || !object(value.target)
    || !exact(value.target,[...targetIds,...targetNumbers,'artifactVersion'])
    || !targetIds.every(k=>id(value.target && (value.target as Record<string,unknown>)[k]))
    || !targetNumbers.every(k=>integer((value.target as Record<string,unknown>)[k])) || !digest(value.target.artifactVersion)
    || !Array.isArray(value.attachments) || value.attachments.length !== 1 || !object(value.attachments[0])
    || !exact(value.attachments[0],['artifactId','artifactVersion'])
    || value.attachments[0].artifactId !== value.target.artifactId || value.attachments[0].artifactVersion !== value.target.artifactVersion
    || !object(value.run) || !exact(value.run,['id','state']) || typeof value.run.state !== 'string'
    || !['not_started','accepted','running','completed','failed','outcome_unknown'].includes(value.run.state)) return false;
  return (value.run.state === 'not_started' ? value.run.id === null : id(value.run.id))
    && encoder.encode(JSON.stringify(value)).length <= 8192;
}
export function validCompanionDesktopHandoffRecord(value: unknown): value is CompanionDesktopHandoffRecord {
  return object(value) && Object.keys(value).every(k=>['checkpoint','digest','status','acceptedAt','authoringImport','authoringRun'].includes(k))
    && (value.authoringRun === undefined || validCompanionAuthoringRun(value.authoringRun) && object(value.authoringImport) && value.authoringImport.presented === true)
    && (value.authoringImport === undefined || object(value.authoringImport)
      && Object.keys(value.authoringImport).every(k=>['requestHash','state','revision','presented'].includes(k))
      && (value.authoringImport.presented === undefined || value.authoringImport.presented === true && value.authoringImport.state === 'imported')
      && digest(value.authoringImport.requestHash) && ['review','prepared','imported'].includes(String(value.authoringImport.state))
      && (value.authoringImport.state === 'imported' ? integer(value.authoringImport.revision) : value.authoringImport.revision === undefined))
    && validCompanionDesktopHandoff(value.checkpoint) && digest(value.digest)
    && (value.status === 'pending' ? value.acceptedAt === undefined : value.status === 'accepted' && integer(value.acceptedAt));
}
export function validCompanionAuthoringRun(value: unknown): value is CompanionAuthoringRun {
  return object(value) && Object.keys(value).every(k=>['userMessageId','turnId','submittedHash','restorePointId','restoreDigest','artifactPath','beforeArtifactVersion','runtime','state','afterArtifactVersion'].includes(k))
    && id(value.userMessageId) && id(value.turnId) && value.restorePointId === value.turnId && digest(value.submittedHash)
    && digest(value.restoreDigest) && digest(value.beforeArtifactVersion)
    && typeof value.artifactPath === 'string' && value.artifactPath.length > 0 && value.artifactPath.length <= 4096
    && !value.artifactPath.includes('\\') && !value.artifactPath.includes('\0') && !value.artifactPath.startsWith('/') && !value.artifactPath.split('/').includes('..')
    && ['agent-sdk','proxy','local'].includes(String(value.runtime)) && ['outcome_unknown','completed','failed'].includes(String(value.state))
    && (value.afterArtifactVersion === undefined || digest(value.afterArtifactVersion))
    && (value.state !== 'completed' || digest(value.afterArtifactVersion));
}
export function sameCompanionDesktopHandoffTarget(a: CompanionDesktopHandoffTarget, b: CompanionDesktopHandoffTarget): boolean {
  return [...targetIds,...targetNumbers,'artifactVersion'].every(k=>a[k as keyof CompanionDesktopHandoffTarget]===b[k as keyof CompanionDesktopHandoffTarget]);
}
