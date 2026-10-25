import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RecordPreview } from './personalRecordTypes';

/** Dedicated storage disclosure: generic outbound consent describes a different AI purpose. */
export async function confirmPersonalRecord(preview: RecordPreview): Promise<boolean> {
  const detail = ['로컬 합성 테스트 · 실제 작업은 포함하지 않아요.', `계정: ${preview.account}`, `저장할 서비스: ${preview.service}`, `개인 프로젝트: ${preview.destination}`,
    '이 합성 대화와 고른 파일을 계정의 읽기용 기록으로 저장합니다. 공개하거나 AI를 실행하지 않아요.',
    ...preview.manifest.messages.map(m => `${m.role === 'user' ? '나 (합성)' : 'AI (합성)'}\n${m.content}`),
    ...preview.files.map(f => `${f.name} · ${f.bytes}바이트\nSHA256 ${f.sha256}\n${f.text}`),
    preview.files.length ? '' : '고른 파일 없음', `기록 SHA256 ${preview.digest}`, '입력 중인 글, 숨긴 대화, 실제 파일과 로그인 정보는 포함하지 않아요.'].join('\n\n');
  return await vscode.window.showWarningMessage('합성 기록을 이 개인 프로젝트에 저장할까요?', { modal: true, detail }, '확인하고 저장') === '확인하고 저장';
}

/** The picker is explicit. Exclusive creation preserves every pre-existing destination. */
export async function downloadPersonalRecord(value: { name: string; bytes: Uint8Array; current(): boolean }): Promise<boolean> {
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', value.name)), saveLabel: '확인된 사본 저장', title: '합성 기록의 파일 사본 저장 · 실행하지 않음' });
  if (!target || target.scheme !== 'file' || !value.current()) return false;
  const parent = await fs.realpath(path.dirname(target.fsPath)), destination = path.join(parent, path.basename(target.fsPath));
  if (!value.current()) return false;
  const handle = await fs.open(destination, 'wx', 0o600);
  let keep = false;
  try {
    if (!value.current()) return false;
    await handle.writeFile(value.bytes); await handle.sync();
    keep = value.current(); return keep;
  } finally {
    const original = await handle.stat(); await handle.close();
    if (!keep) { const current = await fs.lstat(destination).catch(() => undefined); if (current?.ino === original.ino && current?.dev === original.dev) await fs.unlink(destination); }
  }
}
