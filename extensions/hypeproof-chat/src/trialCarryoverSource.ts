// REQ-L12 ⑫ exception (ot-conversation-carryover) — where the trial conversation actually lives.
// vscode-free so the smoke test drives the same code the host does.
//
// A non-instructor trial/personal activity keeps its conversation in a TaskWorkspaceStore, not in
// workspaceState: appendHistory writes only to the task store once one exists, and workspaceState
// keeps pre-migration history that is imported once on the store's first initialize. The trial
// transcript is therefore read from the trial's own task store, keyed exactly as the host keys it.
import * as path from 'node:path';
import { TaskWorkspaceStore } from './taskWorkspaceStore.ts';
import type { CarryoverMessage, CarryoverSource, CarryoverStores } from './trialCarryoverHelpers';

/** The root handed to TaskWorkspaceStore by the host (chatPanelProvider.prepareTaskWorkspace). */
export const taskWorkspaceRoot = (globalStoragePath: string) => path.join(globalStoragePath, 'task-workspaces');
/** The store scope of one activity — the record id and its canonical home folder. */
export const taskWorkspaceScope = (activity: { id: string; workspace: string }) => JSON.stringify([activity.id, activity.workspace]);

/**
 * The trial conversation to offer: the trial's active task (the one the learner was last working
 * in), read without writing anything. Other tasks of the trial stay where they are.
 *
 * - store file present → its active task, and never the leftover legacy history (already imported
 *   on first initialize, so it would be a stale pre-migration copy);
 * - store unreadable → nothing (no offer rather than a guess);
 * - no store file yet (the trial never opened under the task store) → the legacy history, which
 *   is then still that trial's only record and exactly what initialize would import.
 */
export function readTrialHistory(taskRoot: string, source: CarryoverSource, legacy: () => readonly CarryoverMessage[]): readonly CarryoverMessage[] {
  let store: TaskWorkspaceStore;
  try { store = new TaskWorkspaceStore(taskRoot, taskWorkspaceScope(source)); } catch { return []; }
  const view = store.getView();
  if (view.error) return [];
  if (view.activeTaskId) {
    try { return store.getHistory(); } catch { return []; }
  }
  return legacy();
}

/** The stores the host hands to trialCarryoverHelpers, with the trial read from its task store. */
export function carryoverStoresFor(args: {
  globalStoragePath: string;
  offers: CarryoverStores['offers'];
  legacyHistory: (trialId: string) => readonly CarryoverMessage[];
  passHistory: () => readonly CarryoverMessage[];
}): CarryoverStores {
  const root = taskWorkspaceRoot(args.globalStoragePath);
  return {
    offers: args.offers,
    trialHistory: (source) => readTrialHistory(root, source, () => args.legacyHistory(source.id)),
    passHistory: args.passHistory,
  };
}
