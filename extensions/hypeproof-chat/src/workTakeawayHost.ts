import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { TAKEAWAY_EXCLUSIONS, takeawayFile, writeTakeaway, type TakeawayItem } from './workTakeaway';

import { showWorkTakeawayPanel } from './workTakeawayPanel';

export interface TakeawaySource { root: string; wikiDirectory: string; secrets: string[]; tasks: TakeawayItem[]; owned: Record<string, string>; current(): boolean }
/** Review exact frozen copies; retries never re-read files or repeat successful writes. */
export async function runWorkTakeaway(source: TakeawaySource): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(['파일·팀 브레인과 작업 가져가기', '작업 대화만 가져가기'], { title: '내 작업 가져가기' });
  if (!choice || !source.current()) return false;
  const selected = choice === '작업 대화만 가져가기' ? [] : await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(source.root), canSelectMany: true,
    canSelectFolders: false, canSelectFiles: true, title: '내 작업 가져가기 · 내 파일과 팀 브레인 파일 선택', openLabel: '항목 확인' });
  if (!selected || !source.current()) return false;
  if (selected.length > 100) { await vscode.window.showWarningMessage('한 번에 파일 100개까지 가져갈 수 있어요.'); return false; }
  const items = [...selected.map(uri => uri.scheme === 'file' ? takeawayFile(source.root, uri.fsPath, source.wikiDirectory, source.secrets, source.owned)
    : { label: '원격 파일', category: '남는 것' as const, reason: '이 컴퓨터의 파일만 가져갈 수 있어요.' }), ...source.tasks, ...TAKEAWAY_EXCLUSIONS];
  const destination = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: true, canSelectFiles: false,
    title: '사본을 둘 폴더 선택 · 원래 활동 밖의 폴더', openLabel: '이 위치에 가져가기' });
  if (!destination?.[0] || destination[0].scheme !== 'file' || !source.current()) return false;
  const target = fs.realpathSync(destination[0].fsPath), root = fs.realpathSync(source.root);
  const inside = (a: string, b: string) => { const rel = path.relative(a, b); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
  if (inside(root, target)) { await vscode.window.showWarningMessage('원래 활동 밖의 폴더를 골라 주세요. 원본은 그대로 있어요.'); return false; }
  const current = () => {
    try { return source.current() && fs.realpathSync(target) === target && fs.realpathSync(source.root) === root; }
    catch { return false; }
  };
  const answer = await showWorkTakeawayPanel({ destination: target, items });
  if (answer.action !== 'confirm' || !current()) return false;
  const result = writeTakeaway(target, items, current);
  const results = result.results.map(row => ({ ...row, directory: result.directory }));
  while (true) {
    const action = await showWorkTakeawayPanel({ destination: target, items, results });
    if (action.action !== 'retry') break;
    if (!current()) return false;
    // Retry only the failed snapshot, in a new exclusive directory. Other copies stay intact.
    const item = items[action.index];
    if (!item?.bytes || results[action.index]?.status !== '실패') continue;
    const retried = writeTakeaway(target, [item], current);
    results[action.index] = { ...retried.results[0]!, directory: retried.directory };
  }
  return !results.some(item => item.status === '실패');
}
