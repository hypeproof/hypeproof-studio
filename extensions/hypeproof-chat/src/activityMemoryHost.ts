import * as vscode from 'vscode';
import { ActivityMemory, MemoryStoreError, memoryText } from './activityMemory';
import { MEMORY_CORRECTION_MAX, MEMORY_FOLDER_LABEL, type ActivityMemoryAction, type ActivityMemoryResult, type ActivityMemoryView } from './activityMemoryView';
import { buildMemoryOverview, memoryOverviewPasses, memoryStatementRefusal, type MemoryTaskTitle } from './memoryOverview';

// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030) — what the 내 작품 panel may ask of the memory
// store. Memory is always on (DEC-01, DEC-02): there is no setting. The binding is the learner's
// activity folder (the same one the activity trash uses); with no binding there is no view.
const CANCEL: vscode.MessageItem = { title: '취소', isCloseAffordance: true };
const DELETE = '지우기';

export interface ActivityMemoryPanelApi {
  view(): Promise<ActivityMemoryView | null>;
  act(action: ActivityMemoryAction, name: string, scope: string, text?: string): Promise<ActivityMemoryResult>;
}

/**
 * `overview` (REQ-STUDIO-MEMORY-OVERVIEW, CGP-KNOW-R-025): the activity's task names when this seat may see the
 * memory overview, null when it may not (a minor or unknown cohort). Read on every view and every correction.
 */
export function registerActivityMemory(deps: { binding: () => { root: string; scope: string } | undefined; overview?: () => MemoryTaskTitle[] | null }): ActivityMemoryPanelApi {
  let busy = false;
  const current = () => {
    const binding = deps.binding();
    if (!binding) throw new Error('unavailable');
    return { store: new ActivityMemory(binding.root), scope: binding.scope, root: binding.root };
  };
  // The task or activity changed under a press: nothing happens.
  const check = (expected: string, root: string) => {
    const binding = deps.binding();
    if (!binding || binding.scope !== expected || binding.root !== root) throw new Error('activity_changed');
  };
  const message = (error: unknown): string => {
    if (error instanceof MemoryStoreError && error.code === 'unsafe') return '기억 폴더가 링크이거나 폴더가 아니어서 열지 않았어요.';
    if (error instanceof MemoryStoreError && (error.code === 'missing' || error.code === 'not_file')) return '그 기억 파일이 없어요. 목록을 다시 확인해 주세요.';
    if (error instanceof MemoryStoreError && error.code === 'changed') return '기억 파일이 바뀌었어요. 목록을 다시 확인한 뒤 지워 주세요.';
    if ((error as Error | undefined)?.message === 'overview_unavailable') return '이 활동에서는 기억 요약을 쓸 수 없어요.';
    if ((error as Error | undefined)?.message === 'correction_empty') return '고칠 내용을 적어 주세요. 기억을 없애려면 파일 목록에서 지우기를 눌러 주세요.';
    if ((error as Error | undefined)?.message === 'correction_judgment') return '능력이나 성격을 말하는 문장은 기억 요약에 남기지 않아요. 한 일이나 정한 것을 적어 주세요.';
    if (error instanceof MemoryStoreError && error.code === 'invalid') return '고칠 내용이 너무 길어요. 2,000자 안으로 적어 주세요.';
    if (error instanceof MemoryStoreError && error.code === 'full') return '기억 파일이 너무 많아서 고치지 못했어요. 필요 없는 기억을 먼저 지워 주세요.';
    if ((error as Error | undefined)?.message === 'activity_changed' || (error as Error | undefined)?.message === 'unavailable') return '작업 상태가 바뀌었어요. 목록을 다시 확인한 뒤 시도해 주세요.';
    return '기억 파일을 다루지 못했어요. 활동 폴더와 폴더 권한을 확인해 주세요.';
  };
  return {
    async view() {
      try {
        const { store, scope, root } = current();
        const listing = await store.list();
        // A task or activity switch while listing: the list belongs to neither.
        const after = deps.binding();
        if (!after || after.scope !== scope || after.root !== root) return null;
        // The overview is built from the same listing; one that fails the judgment check is not sent at all.
        const tasks = deps.overview?.() ?? null;
        const built = tasks ? buildMemoryOverview(listing.entries, tasks) : null;
        const overview = built && memoryOverviewPasses(built) ? built : null;
        return { scope, folder: MEMORY_FOLDER_LABEL, entries: listing.entries.map(entry => ({ name: entry.name, at: entry.at, text: entry.text })), other: listing.other, unsafe: listing.unsafe, overview };
      } catch { return null; }
    },
    async act(action, name, expected, text) {
      if (busy) return { action, error: '앞의 작업이 끝나면 다시 시도해 주세요.' };
      busy = true;
      try {
        if (action !== 'open' && action !== 'delete' && action !== 'correct') throw new Error('invalid');
        const { store, root } = current();
        check(expected, root);
        // identify() refuses anything but a plainly named regular file inside the store.
        const pinned = await store.identify(name);
        if (action === 'correct') {
          // A correction is the learner's own words for one overview item: a new file with the same task, then the
          // old file (the one pinned above) is removed. Never on a seat without the overview.
          if (!deps.overview?.()) throw new Error('overview_unavailable');
          const entry = (await store.list()).entries.find(item => item.name === name);
          const current = entry?.text?.trim();
          if (!entry || !current || memoryStatementRefusal(current)) throw new MemoryStoreError('missing');
          const next = memoryText(typeof text === 'string' ? text.slice(0, MEMORY_CORRECTION_MAX + 1) : '').trim();
          if (!next) throw new Error('correction_empty');
          if (next === current) return { action, name, unchanged: true };
          if (memoryStatementRefusal(next)) throw new Error('correction_judgment');
          check(expected, root);
          const added = await store.append(next, Date.now(), entry.task);
          try { await store.remove(name, pinned); } catch (error) {
            // The old item changed under the press: keep it, drop the new copy, and say so.
            await store.remove(added).catch(() => undefined);
            throw error;
          }
          return { action, name };
        }
        if (action === 'open') {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pinned.file), { preview: true });
          // Studio never edits a memory file; the editor copy is read-only for this session.
          await Promise.resolve(vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession')).catch(() => undefined);
          return { action, name };
        }
        const answer = await vscode.window.showWarningMessage('이 기억 파일을 지울까요? 지운 기억은 되돌릴 수 없어요.', { modal: true, detail: name }, { title: DELETE }, CANCEL);
        // Only the delete button deletes: 취소, Escape and a closed dialog (undefined) all cancel.
        if (answer?.title !== DELETE) return { action, name, cancelled: true };
        check(expected, root);
        // The file the learner confirmed, not whatever has that name now.
        await store.remove(name, pinned);
        return { action, name };
      } catch (error) {
        return { action, error: message(error) };
      } finally { busy = false; }
    },
  };
}
