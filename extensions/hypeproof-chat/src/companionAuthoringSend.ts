/** Provenance admission for the existing desktop Send. This module cannot invoke a runner. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { RestoreManifest } from './turnRestore';
import type { CompanionAuthoringRun, CompanionAuthoringSendSource } from './companionDesktopHandoff';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** A terminal receipt says the normal turn ended, never that an edit was accepted or changed a file. */
export function companionAuthoringRunState(value: {aborted:boolean;failed:boolean;refused:boolean;terminalObserved:boolean;artifactMeasured:boolean}): CompanionAuthoringRun['state'] {
  if (value.aborted) return 'outcome_unknown';
  if (value.failed || value.refused) return 'failed';
  return value.terminalObserved && value.artifactMeasured ? 'completed' : 'outcome_unknown';
}
export function companionAuthoringRun(source: CompanionAuthoringSendSource, userMessageId: string, turnId: string,
  before: {root:string;point:RestoreManifest} | null, runtime: CompanionAuthoringRun['runtime']): CompanionAuthoringRun {
  const file = before?.point.files.find(file=>hash('hps-companion-artifact/1:'+join(before.root,file.path))===source.artifactId);
  if (!before || !before.point.complete || before.point.notCovered.length || before.point.id !== turnId || before.point.turnId !== turnId
    || !file || file.sha256 !== source.artifactVersion)
    throw Error('휴대폰 요청 전의 파일 버전을 보관하지 못했어요. 실행하지 않았어요. 입력을 확인하고 다시 보내 주세요.');
  return {userMessageId,turnId,submittedHash:hash(source.text),restorePointId:before.point.id,restoreDigest:before.point.digest,
    artifactPath:file.path,beforeArtifactVersion:file.sha256,runtime,state:'outcome_unknown'};
}
