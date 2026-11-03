import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { ActivityMemory, MEMORY_LIMITS, MemoryStoreError, memoryText, type MemoryFile, type MemoryFileId } from './activityMemory';
import { MEMORY_CORRECTION_MAX, MEMORY_FOLDER_LABEL, type ActivityMemoryAction, type ActivityMemoryResult, type ActivityMemoryView, type MemorySource } from './activityMemoryView';
import { buildMemoryOverview, memoryOverviewPasses, memoryStatementRefusal, type MemoryTaskTitle } from './memoryOverview';

// REQ-STUDIO-ACTIVITY-MEMORY-FILES (CGP-KNOW-R-030) — what the 내 작품 panel may ask of the memory
// store. Memory is always on (DEC-01, DEC-02): there is no setting. The binding is the learner's
// activity folder (the same one the activity trash uses); with no binding there is no view.
const CANCEL: vscode.MessageItem = { title: '취소', isCloseAffordance: true };
const DELETE = '지우기';
const DELETE_ALL = '모두 지우기';
const DELETE_OLD = '오래된 기억 지우기';

/** REQ-STUDIO-MEMORY-MANAGER (CGP-KNOW-R-023) — one task of the activity, listed or in 보관함. */
export interface MemoryTaskRef { id: string; title: string; archived: boolean }
const TITLE_MAX = 80;

/** The task an item was kept from, resolved against the activity's tasks now. A title is shown as text, capped. */
export function memorySource(task: string | null, tasks: readonly MemoryTaskRef[] | null): MemorySource {
  if (!task) return { kind: 'none' };
  const found = tasks?.find(item => item.id === task);
  if (!found) return { kind: 'gone' };
  const clean = memoryText(found.title).replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  const title = !clean ? '이름 없는 작업' : chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join('')}…` : clean;
  return found.archived ? { kind: 'archived', title } : { kind: 'task', id: found.id, title };
}

/** CGP-KNOW-D-023 — a listed file's identity as one opaque token (no words, no path). */
export function memoryPin(id: MemoryFileId): string {
  return createHash('sha256').update([id.dev, id.ino, id.ctimeNs, id.birthtimeNs, id.size, id.digest ?? ''].join(':')).digest('hex').slice(0, 32);
}

export interface ActivityMemoryPanelApi {
  view(): Promise<ActivityMemoryView | null>;
  /**
   * `names` (deleteAll only): the files the learner's list showed; nothing else is removed. `confirmedPin` (delete only,
   * CGP-KNOW-D-023): the learner confirmed this delete in the chat's own dialog for the file listed with this pin; the host
   * then asks no second time and deletes only if the file still has exactly that identity.
   */
  act(action: ActivityMemoryAction, name: string, scope: string, text?: string, names?: readonly string[], confirmedPin?: string): Promise<ActivityMemoryResult>;
}

/**
 * `overview` (REQ-STUDIO-MEMORY-OVERVIEW, CGP-KNOW-R-025): the activity's task names when this seat may see the
 * memory overview, null when it may not (a minor or unknown cohort). Read on every view and every correction.
 */
/**
 * `tasks` (REQ-STUDIO-MEMORY-MANAGER, CGP-KNOW-R-023): every task of the activity, for each file's source link on every
 * seat that has the view; null or absent means no task can be named.
 */
export function registerActivityMemory(deps: { binding: () => { root: string; scope: string } | undefined; overview?: () => MemoryTaskTitle[] | null; tasks?: () => MemoryTaskRef[] | null }): ActivityMemoryPanelApi {
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
    if ((error as Error | undefined)?.message === 'nothing_to_delete') return '지울 기억 파일이 없어요. 목록을 다시 확인해 주세요.';
    if ((error as Error | undefined)?.message === 'overview_unavailable') return '이 활동에서는 기억 요약을 쓸 수 없어요.';
    if ((error as Error | undefined)?.message === 'correction_empty') return '고칠 내용을 적어 주세요. 기억을 없애려면 파일 목록에서 지우기를 눌러 주세요.';
    if ((error as Error | undefined)?.message === 'correction_judgment') return '능력이나 성격을 말하는 문장은 기억 요약에 남기지 않아요. 한 일이나 정한 것을 적어 주세요.';
    if (error instanceof MemoryStoreError && error.code === 'invalid') return '고칠 내용이 너무 길어요. 2,000자 안으로 적어 주세요.';
    if (error instanceof MemoryStoreError && error.code === 'full') return '기억 파일이 너무 많아서 고치지 못했어요. 필요 없는 기억을 먼저 지워 주세요.';
    if ((error as Error | undefined)?.message === 'activity_changed' || (error as Error | undefined)?.message === 'unavailable') return '작업 상태가 바뀌었어요. 목록을 다시 확인한 뒤 시도해 주세요.';
    return '기억 파일을 다루지 못했어요. 활동 폴더와 폴더 권한을 확인해 주세요.';
  };
  /**
   * REQ-STUDIO-MEMORY-MANAGER — 모두 지우기: the files the learner's list showed that are still listed now, each pinned
   * before the first confirm. Two native modals, each with one 취소; only the second's button deletes. A file added,
   * replaced or removed meanwhile is kept and counted; files the list never showed (unsafe names, links) are untouched.
   */
  // REQ-STUDIO-MEMORY-CAPACITY (CGP-KNOW-R-024) — 오래된 기억 정리 uses the same path for the learner's pick of old items
  // (`old`): its own words, and `kept` counts only the picked files that were not removed.
  const deleteAll = async (store: ActivityMemory, expected: string, root: string, names: readonly string[], old = false): Promise<ActivityMemoryResult> => {
    const action = old ? 'deleteOld' as const : 'deleteAll' as const;
    const seen = new Set(names.slice(0, MEMORY_LIMITS.items));
    const listing = await store.list();
    const pinned: Array<{ entry: MemoryFile; id: MemoryFileId }> = [];
    for (const entry of listing.entries) {
      if (!seen.has(entry.name)) continue;
      const id = await store.identify(entry.name).catch(() => null);
      if (id) pinned.push({ entry, id });
    }
    if (!pinned.length) throw new Error('nothing_to_delete');
    const count = pinned.length;
    const untouched = listing.other ? ` 목록에 없는 파일 ${listing.other}개는 지우지 않아요.` : '';
    const firstButton = old ? DELETE_OLD : DELETE_ALL;
    const first = old
      ? await vscode.window.showWarningMessage(`고른 오래된 기억 ${count}개를 지울까요?`, { modal: true, detail: `이 활동의 ${MEMORY_FOLDER_LABEL} 안에 있는 기억 파일이에요. 고르지 않은 기억은 그대로 두어요. 지운 기억은 되돌릴 수 없어요.` }, { title: DELETE_OLD }, CANCEL)
      : await vscode.window.showWarningMessage(`기억 파일 ${count}개를 모두 지울까요?`, { modal: true, detail: `이 활동의 ${MEMORY_FOLDER_LABEL} 안에 있는 기억 파일이에요. 지운 기억은 되돌릴 수 없어요.${untouched}` }, { title: DELETE_ALL }, CANCEL);
    if (first?.title !== firstButton) return { action, cancelled: true };
    check(expected, root);
    const second = await vscode.window.showWarningMessage(`정말 기억 파일 ${count}개를 지울까요?`, { modal: true, detail: '한 번 더 확인해요. 지우면 되돌릴 수 없어요.' }, { title: `${count}개 지우기` }, CANCEL);
    if (second?.title !== `${count}개 지우기`) return { action, cancelled: true };
    check(expected, root);
    let removed = 0;
    for (const { entry, id } of pinned) {
      // The file the learner confirmed, not whatever has that name now.
      try { await store.remove(entry.name, id); removed++; } catch { /* kept: counted below */ }
    }
    if (old) return { action, removed, kept: count - removed };
    // Whatever is still listed (replaced, added meanwhile, or never shown) is what the learner still has.
    const kept = (await store.list().catch(() => null))?.entries.length ?? 0;
    return { action, removed, kept };
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
        const known = deps.tasks?.() ?? null;
        const entries = [];
        for (const entry of listing.entries) {
          // CGP-KNOW-D-023 — the identity as listed, for a delete confirmed in the chat's dialog.
          const pin = await store.identify(entry.name).then(memoryPin, () => undefined);
          entries.push({ name: entry.name, at: entry.at, text: entry.text, source: memorySource(entry.task, known), ...(pin ? { pin } : {}) });
        }
        return { scope, folder: MEMORY_FOLDER_LABEL, entries, other: listing.other, unsafe: listing.unsafe, overview, limit: MEMORY_LIMITS.items };
      } catch { return null; }
    },
    async act(action, name, expected, text, names, confirmedPin) {
      if (busy) return { action, error: '앞의 작업이 끝나면 다시 시도해 주세요.' };
      busy = true;
      try {
        if (action !== 'open' && action !== 'delete' && action !== 'correct' && action !== 'deleteAll' && action !== 'deleteOld') throw new Error('invalid');
        const { store, root } = current();
        check(expected, root);
        if (action === 'deleteAll' || action === 'deleteOld') return await deleteAll(store, expected, root, names ?? [], action === 'deleteOld');
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
          // REQ-STUDIO-MEMORY-CAPACITY — a replacement, not an addition: allowed in a full store (the old file goes next).
          const added = await store.append(next, Date.now(), entry.task, name);
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
        if (typeof confirmedPin === 'string') {
          // CGP-KNOW-D-023 — confirmed in the chat's own dialog (취소 has the first focus there). Only the exact file the
          // learner saw: a file replaced or rewritten since the listing has another identity and is refused.
          if (memoryPin(pinned) !== confirmedPin) throw new MemoryStoreError('changed');
        } else {
          const answer = await vscode.window.showWarningMessage('이 기억 파일을 지울까요? 지운 기억은 되돌릴 수 없어요.', { modal: true, detail: name }, { title: DELETE }, CANCEL);
          // Only the delete button deletes: 취소, Escape and a closed dialog (undefined) all cancel.
          if (answer?.title !== DELETE) return { action, name, cancelled: true };
        }
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
