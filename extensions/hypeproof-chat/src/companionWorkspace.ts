import { createHash } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';

/** Preparation only: no credentials, content, device grant, or execution capability. */
export interface CompanionScope {
  activityId: string;
  workspace: string;
  activityLabel: string;
  hostId: string;
  hostLabel: string;
  trusted: boolean;
  local: boolean;
}
export interface CompanionPreparation {
  version: 1;
  scope: string;
  workspace: string;
  projectId: string;
  activityId: string;
  hostId: string;
  preparedAt: number;
}
export interface CompanionState {
  status: 'UNPAIRED' | 'UNSUPPORTED' | 'BLOCKED';
  message: string;
  preparation?: CompanionPreparation;
}
export const companionDigest = (text: string) => createHash('sha256').update(text).digest('hex');
export const companionScope = (scope: CompanionScope) => JSON.stringify([scope.activityId, scope.workspace]);
export const companionKey = (scope: CompanionScope) => `hps.companion.workspace.v1.${companionDigest(companionScope(scope))}`;
export const companionHostId = (machineId: string) => companionDigest(`studio-companion-host-v1:${machineId}`);

const fields = ['version', 'scope', 'workspace', 'projectId', 'activityId', 'hostId', 'preparedAt'];
export function validCompanionPreparation(value: unknown, scope: CompanionScope): value is CompanionPreparation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === fields.length && Object.keys(record).every(key => fields.includes(key)) &&
    record.version === 1 && record.scope === companionScope(scope) && record.workspace === scope.workspace &&
    record.projectId === companionDigest(companionScope(scope)) && record.activityId === scope.activityId && record.hostId === scope.hostId &&
    typeof record.preparedAt === 'number' && Number.isSafeInteger(record.preparedAt) && record.preparedAt >= 0;
}

/** Inspect just the selected directory; never enumerate or read project content. */
export async function inspectCompanionWorkspace(selected: string, scope: CompanionScope): Promise<string> {
  if (!scope.local || !scope.trusted) throw new Error('신뢰한 로컬 작업 폴더에서만 준비할 수 있어요.');
  if (!scope.activityId || !scope.hostId || !path.isAbsolute(selected)) throw new Error('활동과 컴퓨터 정보를 확인해 주세요.');
  const canonical = (await realpath(selected)).replace(/^[a-z]:/, drive => drive.toUpperCase());
  if (canonical !== scope.workspace) throw new Error('현재 활동에 연결된 작업 폴더를 선택해 주세요. 다른 활동의 폴더는 사용할 수 없어요.');
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error('기존 작업 폴더를 선택해 주세요.');
  if ((info.mode & 0o222) === 0) throw new Error('읽기 전용 폴더는 준비할 수 없어요. 원본 파일은 그대로 있어요.');
  await access(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
  return canonical;
}

export async function companionState(scope: CompanionScope | undefined, stored: unknown): Promise<CompanionState> {
  if (!scope || !scope.local) return { status: 'UNSUPPORTED', message: '로컬 컴퓨터에서 기존 활동과 작업 폴더를 먼저 열어 주세요.' };
  try {
    await inspectCompanionWorkspace(scope.workspace, scope);
    if (stored === undefined) return { status: 'UNPAIRED', message: '아직 준비를 저장하지 않았어요. 휴대폰 연결은 지원 준비 중이에요.' };
    if (!validCompanionPreparation(stored, scope)) throw new Error('저장된 준비 정보가 현재 활동·폴더·컴퓨터와 일치하지 않아요. 원본은 보존돼요.');
    return { status: 'UNPAIRED', message: '이 컴퓨터에 준비 정보가 저장됐어요. 연결된 휴대폰은 없어요.', preparation: stored };
  } catch (error) {
    return { status: 'BLOCKED', message: error instanceof Error ? error.message : '작업 폴더를 확인하지 못했어요.' };
  }
}
