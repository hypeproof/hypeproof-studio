// CGP-AGENT-D-006: persisted display data contains only enums, never a runtime error.
import { DENIAL_SOURCE_LABEL, type DenialSource } from './denialSource.ts';
export interface DenialNotice { source: DenialSource; classroom: boolean }
export function denialNotice(source: unknown, classroom = false): DenialNotice {
  return { source: typeof source === 'string' && Object.hasOwn(DENIAL_SOURCE_LABEL, source) ? source as DenialSource : 'unknown', classroom: classroom === true };
}
export function denialNoticeView(value: DenialNotice) {
  const d = denialNotice(value?.source, value?.classroom);
  const text: Record<DenialSource, string> = {
    lesson: d.classroom ? '수업에서 정한 범위 밖의 동작이라 실행하지 않았어요.' : '지금 활동에서 정한 범위 밖의 동작이라 실행하지 않았어요.',
    safety: '안전 규칙에 맞지 않아 실행하지 않았어요.',
    runtime: '지금 앱 환경에서는 이 동작을 할 수 없어요.',
    access: '지금 고른 이용권에서는 이 동작을 할 수 없어요.',
    folder: '이 폴더에 허락한 범위 밖의 동작이라 실행하지 않았어요.',
    unknown: '이 동작을 마치지 못했어요. 이유를 확인하지 못했어요.',
  };
  return { source: d.source, label: DENIAL_SOURCE_LABEL[d.source], text: text[d.source], action: '문제 신고하기' };
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
  for (const source of Object.keys(DENIAL_SOURCE_LABEL)) for (const classroom of [false, true]) {
    const d = denialNotice(source, classroom);
    if (label === denialNoticeLabel(d)) return d;
  }
  return null;
}
