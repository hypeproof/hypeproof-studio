import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ActivityTrash, sweepActivityTrash, TRASH_LIMITS, type TrashBudget, type TrashPlan } from './activityTrash';
import type { ActivityTrashAction, ActivityTrashResult, ActivityTrashView } from './activityTrashView';

// Learner gestures: explicit commands and Explorer/applyEdit deletion events.
// Files the coach deletes (SDK Bash `rm`, the codex shell) emit no VS Code delete event and
// do not reach this trash; that limit is recorded in REQ-STUDIO-ACTIVITY-TRASH.
const CANCEL: vscode.MessageItem = { title: '취소', isCloseAffordance: true };
const TOO_BIG = '파일 5,000개 또는 200MB';

/**
 * CGP-KNOW-D-013 — what the 내 작품 panel may ask. `view` is null when the trash is unavailable
 * (setting off, no learner binding, changing activity). `act` never throws: every refusal is a
 * result with Korean `error` copy, so the panel's pending state always ends.
 */
export interface ActivityTrashPanelApi {
  view(): Promise<ActivityTrashView | null>;
  act(action: ActivityTrashAction, target: string, scope: string): Promise<ActivityTrashResult>;
}

export function registerActivityTrash(context: vscode.ExtensionContext, deps: {
  active: () => boolean;
  refusal: (file: string) => string | null;
  binding?: () => { root: string; scope: string } | undefined;
}): ActivityTrashPanelApi {
  const storage = () => context.globalStorageUri?.fsPath;
  // Each store's AES-256-GCM key lives in SecretStorage (the OS keychain), never next to the data.
  const keyring = context.secrets;
  // Retention is the life of the activity folder: drop stores whose folder is gone.
  void Promise.resolve().then(() => { const base = storage(); return base && keyring ? sweepActivityTrash(base, keyring) : 0; }).catch(() => undefined);
  function current(): ActivityTrash {
    const folders = vscode.workspace.workspaceFolders;
    if (!vscode.workspace.getConfiguration('hypeproofChat').get<boolean>('activityTrashEnabled', false)
        || folders?.length !== 1 || folders[0].uri.scheme !== 'file' || !deps.active()) throw new Error('unavailable');
    const binding = deps.binding?.();
    if (deps.binding && !binding) throw new Error('unavailable');
    const base = storage();
    if (!base || !keyring) throw new Error('unavailable');
    return new ActivityTrash(binding?.root ?? folders[0].uri.fsPath, base, keyring);
  }
  const scope = () => deps.binding?.()?.scope ?? 'workspace';
  const rootOf = () => deps.binding?.()?.root ?? vscode.workspace.workspaceFolders![0].uri.fsPath;
  function check(trash: ActivityTrash, file: string, expectedScope = scope()): void {
    if (scope() !== expectedScope || current().root !== trash.root || deps.refusal(file)) throw new Error('activity_changed');
    const inside = (doc: string) => doc === file || doc.startsWith(file + path.sep);
    if (vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && inside(d.uri.fsPath) && d.isDirty)) throw new Error('unsaved');
  }
  async function confirm(text: string, action: string, detail?: string): Promise<boolean> {
    // One close-affordance item: the workbench then adds no second Cancel button.
    const answer = await vscode.window.showWarningMessage(text, detail ? { modal: true, detail } : { modal: true }, { title: action }, CANCEL);
    return answer?.title === action;
  }
  async function run(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch {
      await vscode.window.showWarningMessage('파일 작업을 완료하지 못했어요. 저장하지 않은 파일, 활동 위치와 폴더 권한을 확인해 주세요.');
    }
  }
  const pending = new Map<string, { trash: ActivityTrash; ids: string[] }[]>();
  const key = (uri: vscode.Uri) => path.resolve(uri.fsPath);
  context.subscriptions.push({ dispose: () => { pending.clear(); } });
  context.subscriptions.push(vscode.workspace.onWillDeleteFiles(event => {
    if (!vscode.workspace.getConfiguration('hypeproofChat').get<boolean>('activityTrashEnabled', false) || !deps.active()) return;
    // The copies are asynchronous so the extension host (and chat) keeps running. A cancelled
    // or timed-out participant does not stop VS Code's delete, so cancellation never
    // discards a copy: pending copies of intact originals are collected later by the store.
    event.waitUntil((async () => {
      const trash = current();
      const root = rootOf();
      const cancelled = () => {
        // VS Code deletes the rest anyway; say so instead of skipping in silence.
        void vscode.window.showWarningMessage('삭제 준비가 취소되어 나머지 파일은 활동 휴지통에 보관하지 못했어요. 운영체제 휴지통을 확인해 주세요.');
      };
      // The cap is per gesture: every selected item shares one budget, and over it nothing is kept.
      const budget: TrashBudget = { visited: 0, files: 0, bytes: 0 };
      const planned: { uri: vscode.Uri; plan: TrashPlan }[] = [];
      let partial = false;
      for (const uri of event.files) {
        if (uri.scheme !== 'file') continue;
        if (event.token.isCancellationRequested) { cancelled(); return; }
        const relative = path.relative(root, uri.fsPath).split(path.sep).join('/');
        // Removing the whole activity also removes its trash; never copy it into itself.
        if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) continue;
        try {
          const plan = await trash.expand(relative, TRASH_LIMITS, budget);
          if (plan.over) {
            void vscode.window.showWarningMessage(`삭제할 항목이 너무 커서(${TOO_BIG} 초과) 활동 휴지통에 보관하지 않았어요. 복원이 필요하면 운영체제 휴지통을 확인해 주세요.`);
            return;
          }
          planned.push({ uri, plan });
        } catch { partial = true; }
      }
      for (const { uri, plan } of planned) {
        if (event.token.isCancellationRequested) { cancelled(); break; }
        try {
          // The folder write gate decides per file: a refused file is never copied, the others still are.
          const allowed = plan.files.filter(file => !deps.refusal(path.join(root, file)));
          const result = await trash.prepareNativeDelete(allowed, event.token);
          if (result.ids.length) pending.set(key(uri), [...(pending.get(key(uri)) ?? []), { trash, ids: result.ids }]);
          if (result.failed || plan.skipped || allowed.length < plan.files.length) partial = true;
        } catch { partial = true; }
      }
      // The API does not grant cancellation authority. Keep any completed copies
      // and report the limitation rather than claiming a rejected wait cancels delete.
      if (partial) void vscode.window.showWarningMessage('파일을 활동 휴지통에 모두 보관하지 못했어요. 탐색기의 삭제 결과와 운영체제 휴지통을 확인해 주세요.');
    })().catch(() => { void vscode.window.showWarningMessage('활동 휴지통을 열지 못했어요. 탐색기의 삭제 결과를 확인해 주세요.'); }));
  }));
  context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
    for (const uri of event.files) {
      const batches = pending.get(key(uri)); pending.delete(key(uri));
      for (const batch of batches ?? []) {
        // list() recovers a pending copy whose source is gone after a crash or race.
        void batch.trash.finishNativeDelete(batch.ids).catch(() => undefined);
      }
    }
  }));
  /** A folder the trash cannot hold whole gets a plain permanent-delete confirm instead. */
  async function removeFolder(trash: ActivityTrash, target: string, relative: string, binding: string): Promise<void> {
    const plan: TrashPlan = await trash.expand(relative);
    if (plan.over || plan.skipped || !plan.files.length) {
      const why = plan.over ? `이 폴더는 너무 커서(${TOO_BIG} 초과) 활동 휴지통에 보관할 수 없어요.`
        : plan.skipped ? '이 폴더에는 활동 휴지통에 보관할 수 없는 항목(링크 등)이 있어요.'
        : '이 폴더에는 보관할 파일이 없어요.';
      if (!await confirm(`${why} 폴더를 영구 삭제할까요? 다시 복원할 수 없어요.`, '영구 삭제')) return;
      check(trash, target, binding);
      await trash.removePermanently(relative);
      await vscode.window.showInformationMessage('폴더를 영구 삭제했어요.');
      return;
    }
    if (plan.files.some(file => deps.refusal(path.join(trash.root, file)))) throw new Error('write_refused');
    if (!await confirm(`이 폴더의 파일 ${plan.files.length}개를 활동 휴지통으로 옮길까요?`, '휴지통으로 이동')) return;
    check(trash, target, binding);
    const again = await trash.expand(relative);
    if (again.over || again.skipped || again.files.join('\n') !== plan.files.join('\n')) throw new Error('file_changed');
    await trash.deleteMany(plan.files.map(file => ({ path: file })));
    await trash.removeEmptyDirectories(relative);
    await vscode.window.showInformationMessage(`폴더의 파일 ${plan.files.length}개를 활동 휴지통으로 옮겼어요. 활동 휴지통에서 하나씩 복원할 수 있어요.`);
  }
  context.subscriptions.push(vscode.commands.registerCommand('hypeproof-chat.trashFile', (uri?: vscode.Uri) => run(async () => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || target.scheme !== 'file') return;
    const trash = current();
    const binding = scope();
    const relative = path.relative(rootOf(), target.fsPath).split(path.sep).join('/');
    check(trash, target.fsPath, binding);
    if (fs.lstatSync(target.fsPath).isDirectory()) { await removeFolder(trash, target.fsPath, relative, binding); return; }
    const expected = await trash.inspect(relative);
    if (!await confirm('이 파일을 활동 휴지통으로 옮길까요?', '휴지통으로 이동')) return;
    check(trash, target.fsPath, binding);
    await trash.delete(relative, expected);
    await vscode.window.showInformationMessage('활동 휴지통으로 옮겼어요. 활동 휴지통에서 복원할 수 있어요.');
  })));
  context.subscriptions.push(vscode.commands.registerCommand('hypeproof-chat.activityTrash', () => run(async () => {
    const trash = current();
    const binding = scope();
    const { entries, damaged } = await trash.list();
    if (damaged) void vscode.window.showWarningMessage(`활동 휴지통의 항목 ${damaged}개를 읽지 못해 목록에서 뺐어요. 그 파일은 지우지 않고 남겨 두었어요.`);
    if (!entries.length) {
      await vscode.window.showInformationMessage(damaged ? '복원할 수 있는 항목이 없어요.' : '활동 휴지통이 비어 있어요.');
      return;
    }
    const selected = await vscode.window.showQuickPick(entries.map(entry => ({
      label: entry.originalPath, description: `보관: ${new Date(entry.deletedAt).toLocaleString('ko-KR')}`, entry,
    })), { title: '활동 휴지통', placeHolder: '복원하거나 영구 삭제할 파일을 고르세요' });
    if (!selected) return;
    const action = await vscode.window.showQuickPick(['복원', '영구 삭제'], { title: selected.entry.originalPath });
    if (!action) return;
    const file = path.join(trash.root, selected.entry.originalPath);
    check(trash, file, binding);
    if (action === '영구 삭제') {
      if (!await confirm('이 파일을 영구 삭제할까요? 다시 복원할 수 없어요.', '영구 삭제')) return;
      check(trash, file, binding);
      await trash.purge(selected.entry.id);
      await vscode.window.showInformationMessage('파일을 영구 삭제했어요.');
    } else {
      const restored = await trash.restore(selected.entry.id);
      await vscode.window.showInformationMessage(restored.renamed
        ? `같은 이름의 파일이 있어 “${restored.path}” 이름으로 복원했어요.`
        : `“${restored.path}” 파일을 복원했어요.`);
    }
  })));

  // CGP-KNOW-D-013 — the 내 작품 panel. Same store, same gates (setting, learner binding, task
  // scope, folder write consent, unsaved buffers) as the commands above; the webview only asks.
  // One press at a time: a double press or a second request while one runs is refused, not queued.
  let panelBusy = false;
  const panelError = (error: unknown): string => {
    const code = (error as Error | undefined)?.message;
    if (code === 'unsaved') return '저장하지 않은 변경이 있어요. 저장한 뒤 다시 시도해 주세요.';
    if (code === 'file_changed') return '파일이 바뀌었어요. 목록을 다시 확인한 뒤 시도해 주세요.';
    if (code === 'activity_changed' || code === 'unavailable' || code === 'missing') return '작업 상태가 바뀌었어요. 목록을 다시 확인한 뒤 시도해 주세요.';
    return '파일 작업을 완료하지 못했어요. 작업 폴더와 폴더 권한을 확인해 주세요.';
  };
  const fileOf = (trash: ActivityTrash, relative: string) => path.join(trash.root, ...relative.split('/'));
  return {
    async view() {
      try {
        const trash = current();
        const listed = scope();
        const { entries, damaged } = await trash.list();
        // A task or activity switch while listing: the list belongs to neither, so none is shown.
        if (scope() !== listed || current().root !== trash.root) return null;
        return { scope: listed, entries: entries.map(entry => ({ id: entry.id, path: entry.originalPath, at: entry.deletedAt })), damaged };
      } catch { return null; }
    },
    async act(action, target, expected) {
      if (panelBusy) return { action, error: '앞의 파일 작업이 끝나면 다시 시도해 주세요.' };
      panelBusy = true;
      try {
        if (typeof target !== 'string' || !target || target.length > 2048) throw new Error('invalid');
        // check() below compares the listed scope with the current one before anything changes.
        const trash = current();
        if (action === 'move') {
          // inspect() validates the name, refuses links, folders and hard links, and pins the bytes the learner confirms.
          const pinned = await trash.inspect(target);
          const file = fileOf(trash, target);
          check(trash, file, expected);
          if (!await confirm('이 파일을 휴지통으로 옮길까요?', '휴지통으로 이동', target)) return { action, cancelled: true };
          check(trash, file, expected);
          const entry = await trash.delete(target, pinned);
          return { action, id: entry.id, path: entry.originalPath };
        }
        if (action !== 'restore' && action !== 'purge') throw new Error('invalid');
        const entry = (await trash.list()).entries.find(item => item.id === target);
        if (!entry) throw new Error('missing');
        const file = fileOf(trash, entry.originalPath);
        check(trash, file, expected);
        if (action === 'restore') {
          // Restore never overwrites (a suffixed name on collision), so it needs no native confirm.
          const restored = await trash.restore(entry.id);
          return { action, id: entry.id, path: restored.path, renamed: restored.renamed };
        }
        if (!await confirm('이 파일을 영구 삭제할까요? 다시 복원할 수 없어요.', '영구 삭제', entry.originalPath)) return { action, cancelled: true };
        check(trash, file, expected);
        await trash.purge(entry.id);
        return { action, id: entry.id, path: entry.originalPath };
      } catch (error) {
        return { action, error: panelError(error) };
      } finally { panelBusy = false; }
    },
  };
}
