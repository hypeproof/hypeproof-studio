// CGP-AGENT-D-006: persisted display data contains only enums, never a runtime error.
import { DENIAL_SOURCE_LABEL, type DenialSource } from './denialSource.ts';
/**
 * `detail` names the one safety cause whose reason a learner can act on (#3221/#3224, Jay 2026-10-29: a bare
 * "안전 규칙에 맞지 않아 실행하지 않았어요" after the coach tried to write to /tmp said nothing). Still an enum: no path.
 */
export type DenialDetail = 'outside_folder' | 'macos_privacy';
/** The source each detail belongs to; a detail on any other source is dropped. */
const DETAIL_SOURCE: Record<DenialDetail, DenialSource> = { outside_folder: 'safety', macos_privacy: 'runtime' };
export interface DenialNotice { source: DenialSource; classroom: boolean; detail?: DenialDetail }
export function denialNotice(source: unknown, classroom = false, detail?: unknown): DenialNotice {
  const s: DenialSource = typeof source === 'string' && Object.hasOwn(DENIAL_SOURCE_LABEL, source) ? source as DenialSource : 'unknown';
  const known = typeof detail === 'string' && Object.hasOwn(DETAIL_SOURCE, detail) && DETAIL_SOURCE[detail as DenialDetail] === s;
  return { source: s, classroom: classroom === true, ...(known ? { detail: detail as DenialDetail } : {}) };
}
const DETAIL_TEXT: Record<DenialDetail, string> = {
  outside_folder: '작업 폴더 밖이라 실행하지 않았어요. AI는 작업 폴더 안에서만 파일을 만들고 고쳐요.',
  // #3221 — macOS (TCC) refused the file: Studio's own rules allowed it, the Mac's privacy setting did not.
  macos_privacy: "macOS가 이 폴더 접근을 막았어요. 시스템 설정 › 개인정보 보호 및 보안 › 파일 및 폴더에서 HypeProof Studio를 켜 주세요.",
};
/**
 * An error from a file tool that macOS's privacy protection (TCC) caused. On macOS a user file that Studio may open
 * by its own rules fails with EPERM ("Operation not permitted") only when the Mac's privacy setting refused it;
 * a plain permission problem is EACCES and is not this.
 */
/** The SDK's file tools; only their EPERM is read as macOS privacy. */
export const FILE_TOOL_NAMES: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);
/** System Settings › Privacy & Security › Files and Folders. */
export const MAC_PRIVACY_FILES_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';
export function macPrivacyBlocked(reason: unknown, platform: string): boolean {
  return platform === 'darwin' && typeof reason === 'string' && /\bEPERM\b|operation not permitted/i.test(reason);
}
export function denialNoticeView(value: DenialNotice) {
  const d = denialNotice(value?.source, value?.classroom, value?.detail);
  const text: Record<DenialSource, string> = {
    lesson: d.classroom ? '수업에서 정한 범위 밖의 동작이라 실행하지 않았어요.' : '지금 활동에서 정한 범위 밖의 동작이라 실행하지 않았어요.',
    safety: '안전 규칙에 맞지 않아 실행하지 않았어요.',
    runtime: '지금 앱 환경에서는 이 동작을 할 수 없어요.',
    access: '지금 고른 이용권에서는 이 동작을 할 수 없어요.',
    folder: '이 폴더에 허락한 범위 밖의 동작이라 실행하지 않았어요.',
    unknown: '이 동작을 마치지 못했어요. 이유를 확인하지 못했어요.',
  };
  if (d.detail === 'macos_privacy') return { source: d.source, label: DENIAL_SOURCE_LABEL[d.source], text: DETAIL_TEXT.macos_privacy, action: 'macOS 설정 열기', settings: true as const };
  return { source: d.source, label: DENIAL_SOURCE_LABEL[d.source], text: d.detail ? DETAIL_TEXT[d.detail] : text[d.source], action: '문제 신고하기' };
}
/** Adapter for existing host-generated tagged tool results. Never inspect arbitrary error prose. */
export function taggedDenialSource(value: unknown): DenialSource | null {
  if (typeof value !== 'string') return null;
  for (const [source, label] of Object.entries(DENIAL_SOURCE_LABEL)) {
    if (value.startsWith(`[${label}] `)) return source as DenialSource;
  }
  return null;
}

/** Existing task files accept only icon/label/state. Keep them backward-readable. */
export function denialNoticeLabel(d: DenialNotice): string {
  const view = denialNoticeView(d);
  return `[${view.label}] ${view.text}`;
}
/** Decode only our complete canonical sentence, never a tag followed by arbitrary prose. */
export function storedDenialNotice(label: unknown): DenialNotice | null {
  for (const source of Object.keys(DENIAL_SOURCE_LABEL)) for (const classroom of [false, true]) for (const detail of [undefined, 'outside_folder', 'macos_privacy']) {
    const d = denialNotice(source, classroom, detail);
    if ((detail === undefined || d.detail) && label === denialNoticeLabel(d)) return d;
  }
  return null;
}
