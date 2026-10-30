/** Development-only activation capability. The exported API accepts factories, never native authority ports. */
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { accountLock } from './accountLock';
import { accountPreviewEnabled, type AccountSession } from './accountSession';
import type { ActivityConnections } from './activityConnections';
import { readPreparedCompanionWorkspace } from './companionWorkspaceHost';
import { companionDigest } from './companionWorkspace';
import { CompanionTransportBudget } from './companionTransportBudget';
import { CompanionDevHostOwner, type CompanionDevHostOwnerPorts } from './companionDevHostOwner';
import { registerDevCompanionHostCommands, type CompanionDevHostCommandOwner } from './companionDevHostCommands';
import type { JournalState, JournalStore } from './classroomOpsCommands';
import type { TaskWorkspaceView } from './taskWorkspaceContract';

export interface CompanionDevActivationApi {
  /** Installs explicit native controls only. No account/network/task work occurs until a gesture. */
  registerClients(clients: CompanionDevHostOwnerPorts['clients']): vscode.Disposable;
}
export interface CompanionDevEntryPorts {
  authoring?: CompanionDevHostOwnerPorts['authoring'];
  execution?: CompanionDevHostOwnerPorts['execution'];
  accounts?: AccountSession;
  connections: ActivityConnections;
  configured(): { service: string; site: string };
  taskView(): TaskWorkspaceView | null;
  epoch(): number;
}
const failure = (code: string) => Error(`companion_dev_entry_${code}`);
interface JournalLease { journal: JournalStore; stopAdmission(): void; release(): Promise<void> }

/** Existing cross-process lock, held for a whole runner lifetime in its own companion directory. */
function acquireJournalLease(directory: string, live: () => boolean, signal?: AbortSignal): {
  ready: Promise<JournalLease>; settled: Promise<void>; cancel(): void;
} {
  let resolve!: (lease: JournalLease) => void, reject!: (reason: Error) => void;
  const ready = new Promise<JournalLease>((yes, no) => { resolve = yes; reject = no; });
  let cancelled = false, enteredLock = false, lease: JournalLease | undefined;
  const cancel = () => { cancelled = true; reject(failure('cancelled')); lease?.stopAdmission(); void lease?.release().catch(() => {}); };
  if (signal?.aborted) cancelled = true;
  signal?.addEventListener('abort', cancel, { once: true });
  const settled = accountLock(directory)(async () => {
    enteredLock = true;
    if (cancelled || !live()) { reject(failure('cancelled')); return; }
    let open = true, tail: Promise<void> = Promise.resolve(), unlock!: () => void, releasing: Promise<void> | undefined;
    const released = new Promise<void>(yes => { unlock = yes; });
    let ioFailed = false, ioFailure: unknown;
    const admit = <T>(operation: () => Promise<T>): Promise<T> => {
      if (!open || !live()) return Promise.reject(failure('journal_closed'));
      const work = tail.then(operation);
      tail = work.then(() => undefined, error => { if (!ioFailed) { ioFailed = true; ioFailure = error; } });
      return work;
    };
    const file = path.join(directory, 'journal.json');
    lease = {
      journal: {
        load: () => admit(async () => { try { return JSON.parse(await fs.readFile(file, 'utf8')) as JournalState; }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }),
        save: state => {
          // Snapshot at admission. Already admitted work drains even after admission closes.
          if (!open || !live()) return Promise.reject(failure('journal_closed'));
          const text = JSON.stringify(state);
          return admit(async () => {
            const temporary = path.join(directory, `journal.${process.pid}.${randomUUID()}.tmp`);
            try { await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
            finally { await fs.rm(temporary, { force: true }); }
          });
        },
      },
      stopAdmission: () => { open = false; },
      release: () => {
        open = false;
        if (!releasing) releasing = (async () => { await tail; unlock(); await settled; if (ioFailed) throw ioFailure; })();
        return releasing;
      },
    };
    resolve(lease); await released;
  }).catch(error => {
    reject(error);
    // accountLock has already completed its owner-file cleanup before rejecting.
    // Only its exact contention timeout without entering the critical section is retryable.
    // Never normalize filesystem/acquisition errors or any owned cleanup/IO failure.
    if (!enteredLock && error instanceof Error && error.message === '계정 연결이 다른 창에서 갱신 중이에요. 잠시 뒤 다시 시도해 주세요.') return;
    throw error;
  }).finally(() => signal?.removeEventListener('abort', cancel));
  // Callers retain this promise as a release barrier; attach an observer without changing its failure.
  void settled.catch(() => {});
  if (cancelled) reject(failure('cancelled'));
  return { ready, settled, cancel };
}

/** Production activation gets no API and installs nothing. Native dependencies remain closure-private. */
export function createCompanionDevHostEntry(context: vscode.ExtensionContext, ports: CompanionDevEntryPorts): {
  api: CompanionDevActivationApi; invalidate(): void; dispose(): void;
} | undefined {
  if (context.extensionMode !== vscode.ExtensionMode.Development) return;
  const events = new vscode.EventEmitter<void>();
  let disposed = false, generation = 0, commands: vscode.Disposable | undefined;
  let budget: CompanionTransportBudget | undefined, budgetKey: string | undefined;
  let barrier: Promise<void> = Promise.resolve();
  let pending: ReturnType<typeof acquireJournalLease> | undefined;
  let active: { owner: CompanionDevHostOwner; lease: JournalLease; release(): void } | undefined;
  const retain = (work: Promise<void>) => { barrier = Promise.all([barrier, work]).then(() => undefined);
    void barrier.catch(() => console.warn('Companion DEV journal cleanup failed; a new owner remains blocked.')); };
  const closeActive = () => {
    const old = active; active = undefined;
    if (old) old.release();
    const waiting = pending; pending = undefined;
    if (waiting) { waiting.cancel(); retain(waiting.settled); }
  };
  const invalidate = () => { if (disposed) return; generation++; closeActive(); events.fire(); };
  const createOwner = async (clients: CompanionDevHostOwnerPorts['clients'], signal?: AbortSignal): Promise<CompanionDevHostCommandOwner> => {
    const at = generation;
    const live = () => !disposed && generation === at && !signal?.aborted && context.extensionMode === vscode.ExtensionMode.Development;
    const check = () => { if (!live()) throw failure('cancelled'); };
    check(); closeActive(); await barrier; check();
    const configured = ports.configured(), accounts = ports.accounts;
    if (!accounts || !accounts.matches(configured.service, configured.site) || !accountPreviewEnabled(true, configured.service, configured.site)) throw failure('existing_account_required');
    const stored = await accounts.sessionIdentity(); check(); const account = accounts.view();
    if (!stored || stored.service !== configured.service || account.status !== 'signedIn' || !account.account?.id) throw failure('existing_account_required');
    const prepared = await readPreparedCompanionWorkspace(context, ports.connections); check();
    if (!prepared.preparation || prepared.status !== 'UNPAIRED' || !ports.taskView()?.activeTaskId) throw failure('existing_task_preparation_required');
    const key = JSON.stringify([configured.service, stored.sessionId]);
    if (!budget || budgetKey !== key) { budget?.dispose(); budget = new CompanionTransportBudget({ minSpacingMs: 1200 }); budgetKey = key; }
    const directory = path.join(context.globalStorageUri.fsPath, 'companion-host', companionDigest(JSON.stringify([
      configured.service, account.account.id, stored.sessionId, prepared.preparation.scope, prepared.preparation.hostId, prepared.preparation.projectId,
    ])));
    let owner: CompanionDevHostOwner | undefined;
    const acquisition = acquireJournalLease(directory, () => live() && !['closed', 'revoked'].includes(owner?.view().state ?? ''), signal);
    pending = acquisition;
    let lease: JournalLease;
    try { lease = await acquisition.ready; } catch (error) { retain(acquisition.settled); if (pending === acquisition) pending = undefined; throw error; }
    if (pending === acquisition) pending = undefined;
    if (!live()) { lease.stopAdmission(); retain(lease.release()); throw failure('cancelled'); }
    try {
      owner = new CompanionDevHostOwner({ context, connections: ports.connections, accounts, configured: ports.configured,
        identity: { accountId: account.account.id, sessionId: stored.sessionId }, budget, clients,
        taskView: ports.taskView, epoch: ports.epoch, journal: lease.journal, authoring: ports.authoring, execution:ports.execution });
    } catch (error) { lease.stopAdmission(); retain(lease.release()); throw error; }
    const held = owner;
    let released = false;
    const release = () => {
      if (released) return; released = true;
      // Close admission first, then local client lifecycle, then drain and unlock.
      lease.stopAdmission();
      try { held.close(); } finally { retain(lease.release()); if (active?.owner === held) active = undefined; }
    };
    active = { owner: held, lease, release };
    const invoke = <T>(operation: () => Promise<T>): Promise<T> => operation().finally(() => { if (['closed', 'revoked'].includes(held.view().state)) release(); });
    return {
      view: () => held.view(),
      startInvitation: abort => invoke(() => held.startInvitation(abort)),
      inspectClaim: abort => invoke(() => held.inspectClaim(abort)),
      confirmComparedCode: (code, abort) => invoke(() => held.confirmComparedCode(code, abort)),
      connectCipher: abort => invoke(() => held.connectCipher(abort)),
      describeSelected: (id, abort) => invoke(() => held.describeSelected(id, abort)),
      publishSelected: (id, abort) => invoke(() => held.publishSelected(id, abort)),
      authorizeSelectedExecution: abort => invoke(() => held.authorizeSelectedExecution(abort)),
      receiveAndHandle: abort => invoke(() => held.receiveAndHandle(abort)),
      revoke: abort => invoke(() => held.revoke(abort)),
      close: release,
    };
  };
  return {
    api: Object.freeze({ registerClients(clients: CompanionDevHostOwnerPorts['clients']) {
      if (disposed || context.extensionMode !== vscode.ExtensionMode.Development) throw failure('unavailable');
      invalidate(); commands?.dispose();
      const registered = registerDevCompanionHostCommands(context, { createOwner: signal => createOwner(clients, signal), onDidInvalidate: events.event });
      commands = registered;
      return new vscode.Disposable(() => { registered.dispose(); if (commands === registered) { commands = undefined; invalidate(); } });
    } }),
    invalidate,
    dispose() { if (disposed) return; invalidate(); disposed = true; commands?.dispose(); commands = undefined; budget?.dispose(); events.dispose(); },
  };
}
