import { createHash } from 'node:crypto';
import type { RecordIntent, RecordManifest, RecordScope } from './personalRecordTypes';

/** The only admitted source. No task store, folder, user file or model is read. */
export const SYNTHETIC_RECORD_NOTICE = 'synthetic-record-notice-v1' as const;
export const fixtureText = '<!doctype html>\n<html lang="ko"><meta charset="utf-8"><h1>합성 개인 결과</h1><p>Studio local record fixture</p></html>\n';
export const recordHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function canonicalRecord(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalRecord).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalRecord((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function syntheticRecord(includeFile: boolean): { manifest: RecordManifest; files: RecordIntent['files'] } {
  const bytes = Buffer.from(fixtureText, 'utf8');
  return { manifest: { schema: 'hps-personal-record/1', source: { kind: 'synthetic-personal', task_id: 'studio-host-fixture-2832', revision: 1 }, title: '합성 개인 기록 — 로컬 테스트', messages: [
    { id: 'fixture-question-2832', role: 'user', content: '합성 질문: 선택한 기록만 보관해 주세요.', created_at: 101 },
    { id: 'fixture-answer-2832', role: 'assistant', content: '합성 답변 첫 줄\n두 번째 줄도 그대로 저장합니다.', created_at: 102 },
    { id: 'fixture-followup-2832', role: 'user', content: '실제 대화나 파일은 포함하지 않습니다.', created_at: 103 },
  ], artifacts: includeFile ? [{ client_ref: 'fixture-file', name: 'synthetic-result.html', bytes: bytes.length, sha256: recordHash(bytes), media_type: 'text/html' }] : [] }, files: includeFile ? [{ client_ref: 'fixture-file', base64: bytes.toString('base64') }] : [] };
}
export const sameScope = (a: RecordScope, b: RecordScope): boolean => canonicalRecord(a) === canonicalRecord(b);
/** Recomputed digests alone cannot turn arbitrary imported content into a fixture. */
export function validateIntent(value: unknown, scope: RecordScope): RecordIntent {
  const intent = value as RecordIntent;
  if (!intent || intent.version !== 1 || !sameScope(intent.scope, scope) || !/^[A-Za-z0-9_-]{1,128}$/.test(intent.mutation_id ?? '')) throw Error('outbox_corrupt');
  const fixture = syntheticRecord(intent.manifest?.artifacts?.length === 1);
  if (canonicalRecord(intent.manifest) !== canonicalRecord(fixture.manifest) || canonicalRecord(intent.files) !== canonicalRecord(fixture.files)
    || intent.manifest_sha256 !== recordHash(canonicalRecord(fixture.manifest))
    || canonicalRecord(intent.consent) !== canonicalRecord({ purpose: 'personal-record-save', notice_version: SYNTHETIC_RECORD_NOTICE, manifest_sha256: intent.manifest_sha256 })
    || Object.keys(intent).sort().join(',') !== 'consent,files,manifest,manifest_sha256,mutation_id,scope,version') throw Error('outbox_corrupt');
  return structuredClone(intent);
}
