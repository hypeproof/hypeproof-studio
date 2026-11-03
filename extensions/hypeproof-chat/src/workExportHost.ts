// CGP-SHELL-R-028 host flow: native folder picker → progress notification → "저장했어요: <폴더>" with 폴더 열기.
// No network, no token, no access check: it works offline and after a pass ends (AB-13).
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exportWork, isInside, WorkExportTooLarge, type TranscriptTask } from './workExport';

export interface WorkExportSource { root: string; secrets: string[]; tasks: TranscriptTask[]; current(): boolean }

export const WORK_EXPORT_COPY = {
  pickTitle: '내 작업을 저장할 폴더 선택',
  pickLabel: '여기에 저장',
  progress: '내 작업을 내보내는 중이에요',
  saved: (folder: string) => `저장했어요: ${folder}`,
  openFolder: '폴더 열기',
  inside: '작업 폴더 밖의 폴더를 골라 주세요. 작업 폴더 안에 두면 다음 내보내기에 섞여 들어가요.',
  remote: '이 컴퓨터의 폴더만 고를 수 있어요.',
  stale: '내보내는 동안 작업이 바뀌어서 멈췄어요. 저장한 파일은 없어요. 다시 눌러 주세요.',
  tooLarge: '작업 폴더가 너무 커서 내보내지 못했어요 (최대 300MB, 파일 2만 개). 큰 파일을 정리한 뒤 다시 시도해 주세요.',
  failed: '내 작업을 내보내지 못했어요. 원본은 그대로 있어요. 저장할 폴더와 권한을 확인해 주세요.',
} as const;

/** DES-SHELL-27: the result line's folder, made safe to show. The notification runs `[text](command:…)`
 *  in its message as a link (allowCommands) and draws control and bidi characters, and it cuts a message
 *  past 1000 characters; a picked folder name is untrusted. Those characters become U+FFFD, brackets
 *  before `(` become full-width so no link forms, and a long path keeps its start and end. 폴더 열기 still
 *  reveals the real file. */
export function displayFolder(folder: string): string {
  let text = folder.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/gu, '\ufffd');
  if (/\]\s*\(/u.test(text)) text = text.replace(/\[/g, '\uff3b').replace(/\]/g, '\uff3d');
  const chars = Array.from(text);
  return chars.length > 120 ? chars.slice(0, 40).join('') + '…' + chars.slice(-79).join('') : text;
}

/** Returns the zip path written, or undefined when cancelled, refused or failed (each says why). */
export async function runWorkExport(source: WorkExportSource): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    title: WORK_EXPORT_COPY.pickTitle, openLabel: WORK_EXPORT_COPY.pickLabel });
  const folder = picked?.[0];
  if (!folder) return undefined;
  if (folder.scheme !== 'file') { void vscode.window.showWarningMessage(WORK_EXPORT_COPY.remote); return undefined; }
  if (!source.current()) { void vscode.window.showWarningMessage(WORK_EXPORT_COPY.stale); return undefined; }
  try {
    if (isInside(fs.realpathSync(source.root), fs.realpathSync(folder.fsPath))) { void vscode.window.showWarningMessage(WORK_EXPORT_COPY.inside); return undefined; }
  } catch { void vscode.window.showWarningMessage(WORK_EXPORT_COPY.failed); return undefined; }
  let result: Awaited<ReturnType<typeof exportWork>>;
  try {
    result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: WORK_EXPORT_COPY.progress, cancellable: false },
      async progress => exportWork({ root: source.root, destination: folder.fsPath, secrets: source.secrets, tasks: source.tasks, current: source.current,
        onFile: count => { if (count % 50 === 0) progress.report({ message: `파일 ${count}개 담는 중` }); } }));
  } catch (error) {
    void vscode.window.showWarningMessage(error instanceof WorkExportTooLarge ? WORK_EXPORT_COPY.tooLarge
      : (error as Error)?.message === 'work_export_destination_inside' ? WORK_EXPORT_COPY.inside : WORK_EXPORT_COPY.failed);
    return undefined;
  }
  if (result === 'stale') { void vscode.window.showWarningMessage(WORK_EXPORT_COPY.stale); return undefined; }
  // A non-modal message shows no `detail`, so the one line carries the file and the counts.
  const line = [WORK_EXPORT_COPY.saved(displayFolder(path.dirname(result.file))), path.basename(result.file), `작업 파일 ${result.files}개 · 대화 ${result.tasks}개`,
    ...(result.skipped ? [`넣지 않은 파일 ${result.skipped}개는 zip 안 내보내기-안내.txt에 적었어요`] : [])].join(' · ');
  void vscode.window.showInformationMessage(line, WORK_EXPORT_COPY.openFolder).then(answer => {
    if (answer === WORK_EXPORT_COPY.openFolder) void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.file));
  });
  return result.file;
}
