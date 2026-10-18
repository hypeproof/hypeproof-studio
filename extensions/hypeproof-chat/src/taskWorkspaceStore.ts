import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { hostname } from 'node:os';
import { emptyActivityDraft, validActivityDraft } from './activityDraft.ts';
import type { ActivityDraft } from './activityDraft';
import type { ChatMessage } from './protocol';
import type {
  TaskDocument, TaskSurfaceSelection, TaskWorkspaceErrorCode, TaskWorkspaceExpected, TaskWorkspaceView,
} from './taskWorkspaceContract';

interface WorkspaceData {
  version: 1;
  scope: string;
  revision: number;
  activeTaskId: string;
  tasks: TaskDocument[];
}

interface LockOwner { version: 1; host: string; pid: number; nonce: string; createdAt: number }
interface LockRecord { owner: LockOwner; dev: number; ino: number }
interface LockLease extends LockRecord { path: string }

export class TaskWorkspaceStoreError extends Error {
  readonly code: TaskWorkspaceErrorCode;
  constructor(code: TaskWorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'TaskWorkspaceStoreError';
    this.code = code;
  }
}

const fail = (code: TaskWorkspaceErrorCode, message: string): never => {
  throw new TaskWorkspaceStoreError(code, message);
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonempty = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const codeOf = (error: unknown) => isRecord(error) ? error.code : undefined;
const hostIdentity = hash(hostname());
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function validOwner(value: unknown): value is LockOwner {
  return isRecord(value) && exactKeys(value, ['version', 'host', 'pid', 'nonce', 'createdAt']) && value.version === 1 &&
    typeof value.host === 'string' && /^[a-f0-9]{64}$/.test(value.host) &&
    typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 0x7fffffff &&
    typeof value.nonce === 'string' && uuid.test(value.nonce) && timestamp(value.createdAt);
}

function demonstrablyDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return codeOf(error) === 'ESRCH'; }
}

const sameLock = (a: LockRecord | undefined, b: LockRecord) => !!a &&
  a.dev === b.dev && a.ino === b.ino && a.owner.nonce === b.owner.nonce;

function validMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || !exactKeys(value, ['id', 'role', 'content', 'createdAt', 'tool', 'citations', 'images', 'assistantName', 'toolMode'])) return false;
  if (!nonempty(value.id, 256) || typeof value.role !== 'string' || !['user', 'assistant', 'system', 'tool'].includes(value.role) ||
      typeof value.content !== 'string' || !timestamp(value.createdAt)) return false;
  if (value.assistantName !== undefined && typeof value.assistantName !== 'string') return false;
  if (value.toolMode !== undefined && (value.role !== 'user' || !['auto', 'web-search'].includes(value.toolMode as string))) return false;
  if (value.images !== undefined && (!Array.isArray(value.images) || !value.images.every(image => typeof image === 'string' && image.startsWith('data:image/')))) return false;
  if (value.tool !== undefined && (!isRecord(value.tool) || !exactKeys(value.tool, ['icon', 'label', 'state']) ||
      typeof value.tool.icon !== 'string' || typeof value.tool.label !== 'string' || typeof value.tool.state !== 'string' || !['running', 'done', 'error'].includes(value.tool.state))) return false;
  if (value.citations !== undefined && (!Array.isArray(value.citations) || !value.citations.every(citation =>
    isRecord(citation) && exactKeys(citation, ['url', 'title', 'domain', 'tier']) &&
    typeof citation.url === 'string' && typeof citation.title === 'string' && typeof citation.domain === 'string' &&
    typeof citation.tier === 'number' && [1, 2, 3, 4].includes(citation.tier)))) return false;
  return true;
}

function validDraft(value: unknown): value is ActivityDraft {
  return isRecord(value) && exactKeys(value, ['text', 'images', 'queued', 'imports', 'toolMode', 'queuedToolMode', 'queuedPaused']) && validActivityDraft(value);
}

function validSurface(value: unknown): value is TaskSurfaceSelection | null {
  if (value === null) return true;
  if (!isRecord(value) || !exactKeys(value, ['url', 'pinned']) || typeof value.url !== 'string' || typeof value.pinned !== 'boolean') return false;
  try {
    const url = new URL(value.url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function validTask(value: unknown): value is TaskDocument {
  if (!isRecord(value) || !exactKeys(value, ['id', 'title', 'createdAt', 'updatedAt', 'messageCount', 'messages', 'draft', 'sourceSelection', 'importedLegacy'])) return false;
  return nonempty(value.id, 256) && nonempty(value.title, 160) && timestamp(value.createdAt) && timestamp(value.updatedAt) &&
    value.updatedAt >= value.createdAt && Array.isArray(value.messages) && value.messages.every(validMessage) &&
    new Set(value.messages.map(message => message.id)).size === value.messages.length && value.messageCount === value.messages.length &&
    validDraft(value.draft) && validSurface(value.sourceSelection) && typeof value.importedLegacy === 'boolean';
}

function decode(text: string, scope: string): WorkspaceData {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return fail('corrupt', '작업 기록 파일을 읽을 수 없습니다. 원본을 보존했습니다.'); }
  if (!isRecord(envelope) || !exactKeys(envelope, ['checksum', 'data']) || !isRecord(envelope.data) ||
      typeof envelope.checksum !== 'string' || envelope.checksum !== hash(JSON.stringify(envelope.data))) {
    return fail('corrupt', '작업 기록의 무결성을 확인할 수 없습니다. 원본을 보존했습니다.');
  }
  const data = envelope.data;
  if (!exactKeys(data, ['version', 'scope', 'revision', 'activeTaskId', 'tasks']) || data.version !== 1 || data.scope !== scope ||
      !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || !Array.isArray(data.tasks) || !data.tasks.length ||
      !data.tasks.every(validTask) || new Set(data.tasks.map(task => task.id)).size !== data.tasks.length ||
      !data.tasks.some(task => task.id === data.activeTaskId)) {
    return fail('corrupt', '작업 기록의 형식이나 계정 범위가 일치하지 않습니다. 원본을 보존했습니다.');
  }
  return data as unknown as WorkspaceData;
}

function normalizedTitle(value: string): string {
  if (typeof value !== 'string') return fail('invalid', '작업 이름이 올바르지 않습니다.');
  const title = value.trim();
  if (!title || title.length > 160) return fail('invalid', '작업 이름은 1자에서 160자까지 입력할 수 있습니다.');
  return title;
}

/**
 * Full local task history, independent from the model's bounded context and telemetry retention.
 * One atomic snapshot is the commit boundary. Writers serialize in-process and use an exclusive
 * on-disk lock plus revision comparison across processes. Recovery requires a demonstrably
 * dead same-host owner and an atomically claimed owner lease; age is never authority.
 */
export class TaskWorkspaceStore {
  readonly scope: string;
  readonly filePath: string;
  private readonly directory: string;
  private readonly rootPath: string;
  private data?: WorkspaceData;
  private loadError?: TaskWorkspaceStoreError;
  private queue: Promise<void> = Promise.resolve();

  constructor(rootPath: string, scope: string) {
    if (!nonempty(rootPath, 4096) || !nonempty(scope, 16384)) fail('invalid', '작업 저장 범위가 필요합니다.');
    this.scope = hash(scope);
    this.rootPath = rootPath;
    this.directory = join(rootPath, 'task-workspaces');
    this.filePath = join(this.directory, `${this.scope}.json`);
    this.load();
  }

  private load(): void {
    try {
      const root = lstatSync(this.rootPath);
      if (!root.isDirectory() || root.isSymbolicLink()) fail('corrupt', '작업 저장 폴더의 위치를 확인해야 합니다.');
      const directory = lstatSync(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) fail('corrupt', '작업 저장 폴더의 위치를 확인해야 합니다.');
      const stat = lstatSync(this.filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 기록 파일의 위치를 확인해야 합니다.');
      this.data = decode(readFileSync(this.filePath, 'utf8'), this.scope);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return;
      this.loadError = error instanceof TaskWorkspaceStoreError ? error :
        new TaskWorkspaceStoreError('io', '작업 기록을 읽지 못했습니다. 원본을 보존했습니다.');
    }
  }

  getView(): TaskWorkspaceView {
    return {
      scope: this.scope,
      revision: this.data?.revision ?? 0,
      activeTaskId: this.data?.activeTaskId ?? null,
      tasks: (this.data?.tasks ?? []).map(({ id, title, createdAt, updatedAt, messageCount }) =>
        ({ id, title, createdAt, updatedAt, messageCount })).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
      sourceSelection: clone(this.data?.tasks.find(task => task.id === this.data?.activeTaskId)?.sourceSelection ?? null),
      ...(this.loadError ? { error: { code: this.loadError.code, message: this.loadError.message } } : {}),
    };
  }

  getActiveTask(): TaskDocument | undefined { return this.getTask(this.data?.activeTaskId); }
  getTask(taskId: string | undefined): TaskDocument | undefined {
    if (this.loadError) throw this.loadError;
    const task = this.data?.tasks.find(value => value.id === taskId);
    return task ? clone(task) : undefined;
  }
  getHistory(taskId = this.data?.activeTaskId): ChatMessage[] { return this.getTask(taskId)?.messages ?? []; }
  getDraft(taskId = this.data?.activeTaskId): ActivityDraft { return this.getTask(taskId)?.draft ?? emptyActivityDraft(); }

  initialize(legacyMessages: ChatMessage[] = [], legacyDraft: ActivityDraft = emptyActivityDraft()): Promise<TaskWorkspaceView> {
    return this.mutate(data => {
      if (data) return data;
      if (!Array.isArray(legacyMessages) || !legacyMessages.every(validMessage) || !validDraft(legacyDraft)) fail('invalid', '이전 작업 기록의 형식을 확인해야 합니다.');
      const now = Date.now();
      const task = this.newTask('새 작업', now);
      task.messages = this.mergeMessages([], legacyMessages);
      task.messageCount = task.messages.length;
      task.draft = clone(legacyDraft);
      task.importedLegacy = task.messages.length > 0 || !!task.draft.text || !!task.draft.queued || task.draft.images.length > 0 || !!task.draft.imports?.length;
      if (task.importedLegacy) task.title = '이전 대화';
      return { version: 1, scope: this.scope, revision: 0, activeTaskId: task.id, tasks: [task] };
    }).catch(error => {
      // Failed first import must not look like an empty, ready workspace.
      if (!this.data) this.loadError = error instanceof TaskWorkspaceStoreError ? error :
        new TaskWorkspaceStoreError('io', '작업 기록을 준비하지 못했습니다. 원본을 보존했습니다. 앱을 다시 열어 주세요.');
      throw error;
    });
  }

  create(title: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    return this.mutate(data => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      const task = this.newTask(normalizedTitle(title), Date.now());
      current.tasks.push(task);
      current.activeTaskId = task.id;
      return current;
    });
  }

  select(taskId: string, expected: TaskWorkspaceExpected): Promise<TaskWorkspaceView> {
    return this.mutate(data => {
      const current = this.requireData(data);
      this.checkExpected(current, expected);
      this.requireTask(current, taskId);
      current.activeTaskId = taskId;
      return current;
    });
  }

  rename(taskId: string, title: string): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => { task.title = normalizedTitle(title); });
  }
  append(taskId: string, messages: ChatMessage[]): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => {
      if (!Array.isArray(messages) || !messages.every(validMessage)) fail('invalid', '저장할 대화 형식이 올바르지 않습니다.');
      task.messages = this.mergeMessages(task.messages, messages);
      task.messageCount = task.messages.length;
    });
  }
  saveDraft(taskId: string, draft: ActivityDraft): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => {
      if (!validDraft(draft)) fail('invalid', '저장할 초안 형식이 올바르지 않습니다.');
      task.draft = clone(draft);
    });
  }
  clearHistory(taskId: string): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => { task.messages = []; task.messageCount = 0; });
  }
  saveSurface(taskId: string, selection: TaskSurfaceSelection | null): Promise<TaskWorkspaceView> {
    return this.updateTask(taskId, task => {
      if (!validSurface(selection)) fail('invalid', '저장할 출처 주소가 올바르지 않습니다.');
      task.sourceSelection = clone(selection);
    });
  }

  private newTask(title: string, now: number): TaskDocument {
    return { id: randomUUID(), title, createdAt: now, updatedAt: now, messageCount: 0,
      messages: [], draft: emptyActivityDraft(), sourceSelection: null, importedLegacy: false };
  }
  private mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    const merged = existing.map(message => clone(message));
    const positions = new Map(merged.map((message, index) => [message.id, index]));
    for (const message of incoming) {
      const position = positions.get(message.id);
      if (position === undefined) { positions.set(message.id, merged.length); merged.push(clone(message)); }
      else merged[position] = clone(message);
    }
    return merged;
  }
  private requireData(data: WorkspaceData | undefined): WorkspaceData {
    return data ?? fail('not_initialized', '작업 저장소를 먼저 준비해야 합니다.');
  }
  private requireTask(data: WorkspaceData, taskId: string): TaskDocument {
    return data.tasks.find(task => task.id === taskId) ?? fail('not_found', '이 작업을 찾을 수 없습니다. 작업 목록을 다시 열어 주세요.');
  }
  private checkExpected(data: WorkspaceData, expected: TaskWorkspaceExpected): void {
    if (!expected || data.activeTaskId !== expected.taskId || data.revision !== expected.revision) fail('stale', '작업이 변경되었습니다. 최신 화면에서 다시 선택해 주세요.');
  }
  private updateTask(taskId: string, update: (task: TaskDocument) => void): Promise<TaskWorkspaceView> {
    return this.mutate(data => {
      const current = this.requireData(data);
      if (taskId !== current.activeTaskId) fail('stale', '다른 작업의 저장 요청입니다. 현재 작업에서 다시 시도해 주세요.');
      const task = this.requireTask(current, taskId);
      update(task);
      task.updatedAt = Math.max(Date.now(), task.updatedAt);
      return current;
    });
  }

  private async readLock(path: string): Promise<LockRecord | undefined> {
    try {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink()) fail('locked', '작업 저장 잠금의 소유자를 확인할 수 없습니다.');
      let owner: unknown;
      try { owner = JSON.parse(await readFile(path, 'utf8')); }
      catch { return fail('locked', '작업 저장 잠금의 소유자를 확인할 수 없습니다.'); }
      const after = await lstat(path);
      if (!validOwner(owner)) return fail('locked', '작업 저장 잠금의 소유자를 확인할 수 없습니다.');
      if (before.dev !== after.dev || before.ino !== after.ino) fail('locked', '작업 저장 잠금이 변경되었습니다. 다시 시도해 주세요.');
      return { owner, dev: after.dev, ino: after.ino };
    } catch (error) { if (codeOf(error) === 'ENOENT') return undefined; throw error; }
  }

  private async recoverDeadLock(lockPath: string): Promise<void> {
    const original = await this.readLock(lockPath);
    if (!original) return;
    if (original.owner.host !== hostIdentity || !demonstrablyDead(original.owner.pid)) fail('locked', '다른 창에서 작업을 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요.');
    const ownerName = `${basename(lockPath)}.owner-${original.owner.nonce}-${original.owner.pid}`;
    const reclaimPrefix = `${basename(lockPath)}.reclaim-${original.owner.nonce}-`;
    const leases: Array<{ path: string; pid: number }> = [];
    for (const name of await readdir(this.directory)) {
      if (name === ownerName) leases.push({ path: join(this.directory, name), pid: original.owner.pid });
      else if (name.startsWith(reclaimPrefix)) {
        const suffix = name.slice(reclaimPrefix.length);
        const separator = suffix.indexOf('-');
        const pid = Number(suffix.slice(0, separator));
        if (separator < 1 || !Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff || !uuid.test(suffix.slice(separator + 1))) {
          fail('locked', '작업 저장 잠금의 복구 상태를 확인해야 합니다.');
        }
        leases.push({ path: join(this.directory, name), pid });
      }
    }
    if (leases.length !== 1 || !demonstrablyDead(leases[0].pid)) fail('locked', '작업 저장 잠금의 복구를 다른 창에서 확인하고 있습니다.');
    const lease = leases[0];
    if (!sameLock(await this.readLock(lease.path), original)) fail('locked', '작업 저장 잠금의 소유자가 일치하지 않습니다.');
    // Renaming one existing lease is an atomic claim: two recoverers cannot both win.
    // A crashed recoverer leaves its PID in the new name, so recovery itself can resume.
    const claimPath = `${lockPath}.reclaim-${original.owner.nonce}-${process.pid}-${randomUUID()}`;
    try { await rename(lease.path, claimPath); }
    catch (error) { if (codeOf(error) === 'ENOENT') fail('locked', '다른 창에서 작업 기록을 복구하고 있습니다.'); throw error; }
    let removed = false;
    try {
      if (!sameLock(await this.readLock(lockPath), original) || !demonstrablyDead(original.owner.pid)) fail('locked', '작업 저장 잠금이 변경되었습니다. 다시 시도해 주세요.');
      await unlink(lockPath);
      removed = true;
      await unlink(`${this.filePath}.tmp-${original.owner.nonce}`).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
    } finally {
      if (removed) await unlink(claimPath);
      else await rename(claimPath, lease.path);
    }
  }

  private async acquireLock(): Promise<LockLease> {
    const lockPath = `${this.filePath}.lock`;
    const owner: LockOwner = { version: 1, host: hostIdentity, pid: process.pid, nonce: randomUUID(), createdAt: Date.now() };
    const path = `${lockPath}.owner-${owner.nonce}-${owner.pid}`;
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
      finally { await handle.close(); }
      const stat = await lstat(path);
      try { await link(path, lockPath); }
      catch (error) {
        if (codeOf(error) !== 'EEXIST') throw error;
        await this.recoverDeadLock(lockPath);
        try { await link(path, lockPath); }
        catch (retryError) {
          if (codeOf(retryError) === 'EEXIST') fail('locked', '다른 창에서 작업을 저장하고 있습니다. 잠시 뒤 다시 시도해 주세요.');
          throw retryError;
        }
      }
      return { owner, path, dev: stat.dev, ino: stat.ino };
    } catch (error) {
      await unlink(path).catch(cleanup => { if (codeOf(cleanup) !== 'ENOENT') throw cleanup; });
      throw error;
    }
  }

  private async releaseLock(lease: LockLease): Promise<void> {
    const lockPath = `${this.filePath}.lock`;
    if (!sameLock(await this.readLock(lockPath), lease)) fail('locked', '작업 저장 잠금이 변경되어 다른 창의 잠금을 보존했습니다.');
    await unlink(lockPath);
    await unlink(lease.path);
  }

  private mutate(change: (data: WorkspaceData | undefined) => WorkspaceData): Promise<TaskWorkspaceView> {
    const operation = this.queue.then(async () => {
      if (this.loadError) throw this.loadError;
      try {
        await mkdir(this.rootPath, { recursive: true, mode: 0o700 });
        const rootStat = await lstat(this.rootPath);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('io', '작업 저장 폴더의 위치를 확인해야 합니다.');
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const directoryStat = await lstat(this.directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail('io', '작업 저장 폴더의 위치를 확인해야 합니다.');
        await chmod(this.directory, 0o700);
        const lock = await this.acquireLock();
        try {
          let disk: WorkspaceData | undefined;
          try {
            const stat = await lstat(this.filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) fail('corrupt', '작업 기록 파일의 위치를 확인해야 합니다.');
            disk = decode(await readFile(this.filePath, 'utf8'), this.scope);
          } catch (error) { if (codeOf(error) !== 'ENOENT') throw error; }
          if ((disk?.revision ?? 0) !== (this.data?.revision ?? 0) || JSON.stringify(disk) !== JSON.stringify(this.data)) fail('stale', '다른 창에서 기록이 변경되었습니다. 작업을 다시 열어 주세요.');
          const next = change(this.data ? clone(this.data) : undefined);
          if (this.data && JSON.stringify(next) === JSON.stringify(this.data)) return this.getView();
          next.revision = (this.data?.revision ?? 0) + 1;
          const content = JSON.stringify({ checksum: hash(JSON.stringify(next)), data: next });
          decode(content, this.scope);
          const temporaryPath = `${this.filePath}.tmp-${lock.owner.nonce}`;
          try {
            const temporary = await open(temporaryPath, 'wx', 0o600);
            try { await temporary.writeFile(content, 'utf8'); await temporary.sync(); }
            finally { await temporary.close(); }
            await rename(temporaryPath, this.filePath);
            this.data = next;
          } finally {
            await unlink(temporaryPath).catch(error => { if (codeOf(error) !== 'ENOENT') throw error; });
          }
          return this.getView();
        } finally {
          await this.releaseLock(lock);
        }
      } catch (error) {
        if (error instanceof TaskWorkspaceStoreError) throw error;
        throw new TaskWorkspaceStoreError('io', '작업을 저장하지 못했습니다. 기록을 다시 확인한 뒤 재시도해 주세요.');
      }
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }
}
