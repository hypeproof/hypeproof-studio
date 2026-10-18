import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { ActivityRecord } from './activityConnections';
import { activityService, canonicalRoot } from './activityConnections';
import { historyKeyForCohort } from './chatPanelHelpers';
import { isSameLocation } from './workspaceRouting';

/**
 * globalState key holding the root we last tried to switch TO. Written before
 * the reload, cleared once we land (or once we decide not to switch). Its only
 * job is to make a failed `vscode.openFolder` fail ONCE: without it, a root that
 * cannot be opened would be retried on every post-reload activation and the
 * learner's window would reload forever mid-lecture.
 */
export const WORKSPACE_SWITCH_ATTEMPT_KEY = 'hypeproofChat.workspaceSwitchAttempt';
export const RESUME_MAX_AGE_MS = 10 * 60_000;
export interface ActivityResume {
  version: 1; id: string; service: string; workspace: string; ref: string; at: number;
  state?: Record<string, unknown>;
}
const canonical = canonicalRoot;
export function resumeKey(root: string): string {
  let physical: string;
  try { physical = canonical(root); } catch { physical = path.resolve(root); }
  return 'hypeproofChat.pendingActivityResume.' + crypto.createHash('sha256').update(physical).digest('hex');
}
export function resumeDecision(marker: ActivityResume | undefined, record: ActivityRecord | undefined, service: string,
  root: string | undefined, now = Date.now()): 'absent' | 'valid' | 'expired' | 'mismatch' {
  if (!marker) return 'absent';
  if (marker.version !== 1 || !record || !root || !Number.isFinite(marker.at) || marker.at > now ||
    marker.id !== record.serverId || marker.ref !== record.ref || typeof marker.workspace !== 'string' || !path.isAbsolute(marker.workspace)) return 'mismatch';
  try {
    if (marker.service !== activityService(service) || marker.service !== record.service ||
      !isSameLocation(root, marker.workspace, canonical) || !isSameLocation(root, record.workspace, canonical)) return 'mismatch';
  } catch { return 'mismatch'; }
  return now - marker.at >= RESUME_MAX_AGE_MS ? 'expired' : 'valid';
}

/** Start each launch/folder activation closed, including a restored workspace layout. */
export async function initializeFilesLayout(execute: (command: string) => Thenable<unknown>): Promise<void> {
  await execute('workbench.action.closeSidebar');
}

/** Browser previews belong to one session; leave later preview requests alone. */
export async function closeRestoredBrowserTabs(tabs: readonly Pick<vscode.BrowserTab, 'close'>[]): Promise<void> {
  const results = await Promise.allSettled([...tabs].map(async tab => { await tab.close(); }));
  if (results.some(result => result.status === 'rejected'))
    console.warn('HypeProof: could not close a restored browser preview tab.');
}

function continuityKeys(scope: string): string[] {
  return [historyKeyForCohort(scope), 'hps.activity.draft.' + scope];
}
/** A one-shot checkpoint of the existing activity stores, never another permanent history store. */
export function activityCheckpoint(context: vscode.ExtensionContext, record: ActivityRecord): Record<string, unknown> {
  return Object.fromEntries(continuityKeys(record.id).flatMap(key => {
    const value = context.workspaceState.get(key);
    return value === undefined ? [] : [[key, value]];
  }));
}
export async function consumeActivityResume(context: vscode.ExtensionContext, record: ActivityRecord | undefined, service: string,
  root: string | undefined): Promise<ReturnType<typeof resumeDecision>> {
  const key = root ? resumeKey(root) : undefined;
  const marker = key ? context.globalState.get<ActivityResume>(key) : undefined;
  const decision = resumeDecision(marker, record, service, root);
  if (decision === 'valid' && record && marker?.state) {
    for (const stateKey of continuityKeys(record.id)) {
      // A destination's own saved work always wins. No other activity's keys can be imported.
      if (Object.prototype.hasOwnProperty.call(marker.state, stateKey) && context.workspaceState.get(stateKey) === undefined)
        await context.workspaceState.update(stateKey, marker.state[stateKey]);
    }
  }
  if (decision === 'valid' && root) {
    const attempted = context.globalState.get<string>(WORKSPACE_SWITCH_ATTEMPT_KEY);
    if (attempted && isSameLocation(attempted, root, canonical))
      await context.globalState.update(WORKSPACE_SWITCH_ATTEMPT_KEY, undefined);
  }
  if (marker && key) await context.globalState.update(key, undefined);
  return decision;
}
